-- MedicHall Sprint 5: user-controlled transactional alerts and weekly digest.
--
-- Browser-visible events continue to use matchmaking_notifications. Eligible
-- events are projected into a private, retryable email outbox. Delivery is
-- intentionally asynchronous: provider or configuration failures must never
-- roll back the business event which created the notification.

begin;

do $preflight$
begin
  if to_regclass('public.matchmaking_notifications') is null
    or to_regclass('public.opportunity_matches') is null
    or to_regclass('public.matchmaking_matches') is null
    or to_regclass('public.matchmaking_profiles') is null
    or to_regclass('public.companies') is null
    or to_regclass('public.buyer_profiles') is null
    or to_regclass('public.tenders') is null
    or to_regprocedure(
      'public.portal_add_notification(uuid,uuid,text,bigint,text,text,text,text,text,text,boolean,jsonb)'
    ) is null then
    raise exception 'Sprint 5 notification dependency is missing';
  end if;
end
$preflight$;

create table public.user_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  immediate_rfq_message_enabled boolean not null default true,
  tender_alerts_enabled boolean not null default true,
  matchmaking_alerts_enabled boolean not null default true,
  meeting_reminders_enabled boolean not null default true,
  weekly_digest_enabled boolean not null default true,
  timezone text not null default 'UTC'
    check (length(timezone) between 1 and 80),
  next_digest_at timestamptz not null default (now() + interval '7 days'),
  last_digest_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_notification_preferences enable row level security;

create policy "users view own notification preferences"
on public.user_notification_preferences
for select to authenticated
using (user_id = auth.uid());

revoke all on table public.user_notification_preferences from public, anon;
grant select on table public.user_notification_preferences to authenticated;
grant all on table public.user_notification_preferences to service_role;

-- Existing accounts begin one full week from deployment. This prevents an
-- unsolicited backlog digest during release while preserving the requested
-- default for newly activated accounts.
insert into public.user_notification_preferences (user_id, next_digest_at)
select user_record.id, now() + interval '7 days'
from auth.users user_record
on conflict (user_id) do nothing;

create or replace function public.ensure_user_notification_preferences(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.user_notification_preferences (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
exception when foreign_key_violation then
  -- A concurrent auth-user deletion is harmless.
  null;
end;
$function$;

create or replace function public.ensure_company_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.ensure_user_notification_preferences(new.owner_id);
  return new;
end;
$function$;

create trigger ensure_company_notification_preferences
after insert or update of owner_id on public.companies
for each row execute function public.ensure_company_notification_preferences();

create or replace function public.ensure_buyer_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.ensure_user_notification_preferences(new.user_id);
  return new;
end;
$function$;

create trigger ensure_buyer_notification_preferences
after insert on public.buyer_profiles
for each row execute function public.ensure_buyer_notification_preferences();

create or replace function public.ensure_matchmaking_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.ensure_user_notification_preferences(new.user_id);
  return new;
end;
$function$;

create trigger ensure_matchmaking_notification_preferences
after insert on public.matchmaking_profiles
for each row execute function public.ensure_matchmaking_notification_preferences();

create or replace function public.get_user_notification_preferences()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  preference public.user_notification_preferences;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform public.ensure_user_notification_preferences(auth.uid());
  select * into strict preference
  from public.user_notification_preferences
  where user_id = auth.uid();
  return to_jsonb(preference) - 'user_id';
end;
$function$;

create or replace function public.update_user_notification_preferences(
  p_immediate_rfq_message_enabled boolean,
  p_tender_alerts_enabled boolean,
  p_matchmaking_alerts_enabled boolean,
  p_meeting_reminders_enabled boolean,
  p_weekly_digest_enabled boolean,
  p_timezone text default 'UTC'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  safe_timezone text := left(trim(coalesce(p_timezone, 'UTC')), 80);
  preference public.user_notification_preferences;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if safe_timezone = '' or not exists (
    select 1 from pg_timezone_names where name = safe_timezone
  ) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;

  insert into public.user_notification_preferences (
    user_id,
    immediate_rfq_message_enabled,
    tender_alerts_enabled,
    matchmaking_alerts_enabled,
    meeting_reminders_enabled,
    weekly_digest_enabled,
    timezone,
    updated_at
  ) values (
    auth.uid(),
    coalesce(p_immediate_rfq_message_enabled, true),
    coalesce(p_tender_alerts_enabled, true),
    coalesce(p_matchmaking_alerts_enabled, true),
    coalesce(p_meeting_reminders_enabled, true),
    coalesce(p_weekly_digest_enabled, true),
    safe_timezone,
    now()
  )
  on conflict (user_id) do update set
    immediate_rfq_message_enabled = excluded.immediate_rfq_message_enabled,
    tender_alerts_enabled = excluded.tender_alerts_enabled,
    matchmaking_alerts_enabled = excluded.matchmaking_alerts_enabled,
    meeting_reminders_enabled = excluded.meeting_reminders_enabled,
    weekly_digest_enabled = excluded.weekly_digest_enabled,
    timezone = excluded.timezone,
    next_digest_at = case
      when excluded.weekly_digest_enabled
       and not user_notification_preferences.weekly_digest_enabled
        then now() + interval '7 days'
      else user_notification_preferences.next_digest_at
    end,
    updated_at = now()
  returning * into preference;

  return to_jsonb(preference) - 'user_id';
end;
$function$;

revoke all on function public.ensure_user_notification_preferences(uuid)
  from public, anon, authenticated;
revoke all on function public.ensure_company_notification_preferences()
  from public, anon, authenticated;
revoke all on function public.ensure_buyer_notification_preferences()
  from public, anon, authenticated;
revoke all on function public.ensure_matchmaking_notification_preferences()
  from public, anon, authenticated;
revoke all on function public.get_user_notification_preferences()
  from public, anon;
revoke all on function public.update_user_notification_preferences(
  boolean, boolean, boolean, boolean, boolean, text
) from public, anon;
grant execute on function public.get_user_notification_preferences()
  to authenticated, service_role;
grant execute on function public.update_user_notification_preferences(
  boolean, boolean, boolean, boolean, boolean, text
) to authenticated, service_role;

create table public.user_notification_email_outbox (
  id bigint generated by default as identity primary key,
  notification_id bigint not null unique
    references public.matchmaking_notifications(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'NEW_TENDER_MATCH',
    'HIGH_TENDER_MATCH',
    'NEW_COMPANY_MATCH',
    'CONNECTION_REQUEST',
    'CONNECTION_ACCEPTED',
    'NEW_RFQ',
    'NEW_MESSAGE',
    'MEETING_REQUEST',
    'MEETING_CONFIRMED',
    'MEETING_REMINDER',
    'IMPORT_COMPLETE',
    'TENDER_DEADLINE_APPROACHING',
    'WEEKLY_DIGEST'
  )),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','retry','sent','failed','suppressed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  provider_message_id text,
  error_code text,
  error_redacted text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null))
);

create index user_notification_email_outbox_due_idx
on public.user_notification_email_outbox(status, next_attempt_at, id)
where status in ('pending','retry','processing');

alter table public.user_notification_email_outbox enable row level security;
alter table public.user_notification_email_outbox force row level security;
revoke all on table public.user_notification_email_outbox
  from public, anon, authenticated;
grant all on table public.user_notification_email_outbox to service_role;
grant usage, select on sequence public.user_notification_email_outbox_id_seq
  to service_role;

create or replace function public.user_notification_event_enabled(
  p_user_id uuid,
  p_event_type text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when p_event_type in ('NEW_RFQ', 'NEW_MESSAGE')
      then coalesce(preference.immediate_rfq_message_enabled, true)
    when p_event_type in (
      'NEW_TENDER_MATCH', 'HIGH_TENDER_MATCH',
      'IMPORT_COMPLETE', 'TENDER_DEADLINE_APPROACHING'
    ) then coalesce(preference.tender_alerts_enabled, true)
    when p_event_type in (
      'NEW_COMPANY_MATCH', 'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED'
    ) then coalesce(preference.matchmaking_alerts_enabled, true)
    when p_event_type in (
      'MEETING_REQUEST', 'MEETING_CONFIRMED', 'MEETING_REMINDER'
    ) then coalesce(preference.meeting_reminders_enabled, true)
    when p_event_type = 'WEEKLY_DIGEST'
      then coalesce(preference.weekly_digest_enabled, true)
    else false
  end
  from (select 1) seed
  left join public.user_notification_preferences preference
    on preference.user_id = p_user_id;
$function$;

create or replace function public.project_portal_notification_to_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  email_event text;
begin
  email_event := case new.notification_type
    when 'tender_match' then 'NEW_TENDER_MATCH'
    when 'tender_match_high' then 'HIGH_TENDER_MATCH'
    when 'company_match' then 'NEW_COMPANY_MATCH'
    when 'connection_requested' then 'CONNECTION_REQUEST'
    when 'connection_accepted' then 'CONNECTION_ACCEPTED'
    when 'rfq_request' then 'NEW_RFQ'
    when 'rfq_message' then 'NEW_MESSAGE'
    when 'relationship_message' then 'NEW_MESSAGE'
    when 'meeting_proposed' then 'MEETING_REQUEST'
    when 'meeting_counter_proposed' then 'MEETING_REQUEST'
    when 'meeting_confirmed' then 'MEETING_CONFIRMED'
    when 'meeting_24h' then 'MEETING_REMINDER'
    when 'meeting_15m' then 'MEETING_REMINDER'
    when 'meeting_start' then 'MEETING_REMINDER'
    when 'tender_import_completed' then 'IMPORT_COMPLETE'
    when 'tender_import_partial' then 'IMPORT_COMPLETE'
    when 'tender_deadline_7d' then 'TENDER_DEADLINE_APPROACHING'
    when 'tender_deadline_3d' then 'TENDER_DEADLINE_APPROACHING'
    when 'tender_deadline_1d' then 'TENDER_DEADLINE_APPROACHING'
    when 'weekly_digest' then 'WEEKLY_DIGEST'
    else null
  end;

  if email_event is null or new.recipient_user_id is null
    or not public.user_notification_event_enabled(
      new.recipient_user_id, email_event
    ) then
    return new;
  end if;

  insert into public.user_notification_email_outbox (
    notification_id,
    recipient_user_id,
    event_type,
    idempotency_key,
    payload
  ) values (
    new.id,
    new.recipient_user_id,
    email_event,
    'user-notification/' || new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'title', new.title,
      'body', new.body,
      'company_name', new.company_name,
      'action_url', new.action_url,
      'source_kind', new.source_kind,
      'source_id', new.source_id,
      'event', new.payload
    ))
  )
  on conflict (notification_id) do nothing;

  return new;
exception when others then
  raise warning 'User notification email projection failed (SQLSTATE %)',
    sqlstate;
  return new;
end;
$function$;

create trigger project_portal_notification_to_email
after insert on public.matchmaking_notifications
for each row execute function public.project_portal_notification_to_email();

create or replace function public.notify_new_tender_opportunity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  owner_user_id uuid;
  company_name text;
  tender_title text;
begin
  if new.opportunity_type <> 'tender' or new.tender_id is null
    or new.status = 'dismissed' then
    return new;
  end if;
  select company.owner_id, company.name
  into owner_user_id, company_name
  from public.companies company where company.id = new.company_id;
  select tender.title into tender_title
  from public.tenders tender where tender.id = new.tender_id;

  perform public.portal_add_notification(
    owner_user_id,
    null,
    'tender',
    new.tender_id,
    case when new.match_score >= 80 then 'tender_match_high'
      else 'tender_match' end,
    case when new.match_score >= 80 then 'High-potential tender match'
      else 'New tender match' end,
    coalesce(tender_title, 'A tender') || ' matched your company at ' ||
      new.match_score || '%.',
    company_name,
    'tender-match:' || new.id,
    '#opportunity=' || new.id,
    false,
    jsonb_build_object(
      'opportunity_match_id', new.id,
      'tender_id', new.tender_id,
      'match_score', new.match_score
    )
  );
  return new;
end;
$function$;

create trigger notify_new_tender_opportunity
after insert on public.opportunity_matches
for each row execute function public.notify_new_tender_opportunity();

create or replace function public.notify_new_company_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  recipient_user_id uuid;
  target_user_id uuid;
  target_name text;
begin
  if new.status = 'dismissed' then
    return new;
  end if;
  select user_id into recipient_user_id
  from public.matchmaking_profiles where id = new.source_profile_id;
  select user_id, display_name into target_user_id, target_name
  from public.matchmaking_profiles where id = new.target_profile_id;

  perform public.portal_add_notification(
    recipient_user_id,
    target_user_id,
    'matchmaking',
    new.id,
    'company_match',
    'New company match',
    coalesce(target_name, 'A MedicHall company') || ' matched at ' ||
      new.match_score || '%.',
    target_name,
    'company-match:' || new.id,
    '#matchmaking',
    false,
    jsonb_build_object(
      'match_id', new.id,
      'target_profile_id', new.target_profile_id,
      'match_score', new.match_score
    )
  );
  return new;
end;
$function$;

create trigger notify_new_company_match
after insert on public.matchmaking_matches
for each row execute function public.notify_new_company_match();

create or replace function public.schedule_user_retention_notifications()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  deadline_match record;
  due_preference record;
  deadline_count integer := 0;
  digest_count integer := 0;
  tender_count integer;
  company_match_count integer;
  rfq_count integer;
  meeting_count integer;
  strongest jsonb;
  notification_id bigint;
  digest_week text := to_char(date_trunc('week', now()), 'IYYY-IW');
begin
  for deadline_match in
    select
      opportunity.id as opportunity_id,
      opportunity.match_score,
      opportunity.company_id,
      company.owner_id,
      company.name as company_name,
      tender.id as tender_id,
      tender.title,
      tender.deadline_at,
      (tender.deadline_at::date - current_date) as days_remaining
    from public.opportunity_matches opportunity
    join public.companies company on company.id = opportunity.company_id
    join public.tenders tender on tender.id = opportunity.tender_id
    where opportunity.opportunity_type = 'tender'
      and opportunity.status in ('saved','contacted','applied','new','viewed')
      and (opportunity.status in ('saved','contacted','applied')
        or opportunity.match_score >= 80)
      and company.owner_id is not null
      and tender.status = 'open'
      and (tender.deadline_at::date - current_date) in (7,3,1)
  loop
    if public.user_notification_event_enabled(
      deadline_match.owner_id, 'TENDER_DEADLINE_APPROACHING'
    ) then
      notification_id := public.portal_add_notification(
        deadline_match.owner_id,
        null,
        'tender',
        deadline_match.tender_id,
        'tender_deadline_' || deadline_match.days_remaining || 'd',
        'Tender deadline in ' || deadline_match.days_remaining ||
          case when deadline_match.days_remaining = 1 then ' day' else ' days' end,
        deadline_match.title || ' closes soon. Match score: ' ||
          deadline_match.match_score || '%.',
        deadline_match.company_name,
        'tender-deadline:' || deadline_match.opportunity_id || ':' ||
          deadline_match.days_remaining || 'd',
        '#opportunity=' || deadline_match.opportunity_id,
        true,
        jsonb_build_object(
          'opportunity_match_id', deadline_match.opportunity_id,
          'tender_id', deadline_match.tender_id,
          'match_score', deadline_match.match_score,
          'deadline_at', deadline_match.deadline_at,
          'days_remaining', deadline_match.days_remaining
        )
      );
      if notification_id is not null then
        deadline_count := deadline_count + 1;
      end if;
    end if;
  end loop;

  for due_preference in
    select preference.user_id
    from public.user_notification_preferences preference
    where preference.weekly_digest_enabled = true
      and preference.next_digest_at <= now()
    order by preference.next_digest_at, preference.user_id
    limit 500
    for update skip locked
  loop
    select count(*) into tender_count
    from public.opportunity_matches opportunity
    join public.companies company on company.id = opportunity.company_id
    where company.owner_id = due_preference.user_id
      and opportunity.opportunity_type = 'tender'
      and opportunity.generated_at >= now() - interval '7 days'
      and opportunity.status <> 'dismissed';

    select count(*) into company_match_count
    from public.matchmaking_matches match_item
    join public.matchmaking_profiles profile
      on profile.id = match_item.source_profile_id
    where profile.user_id = due_preference.user_id
      and match_item.generated_at >= now() - interval '7 days'
      and match_item.status <> 'dismissed';

    select count(*) into rfq_count
    from public.rfq_requests request
    join public.companies company on company.id = request.company_id
    where company.owner_id = due_preference.user_id
      and request.created_at >= now() - interval '7 days';

    select count(distinct meeting.id) into meeting_count
    from public.matchmaking_meeting_requests meeting
    join public.matchmaking_profiles profile
      on profile.id in (meeting.requester_profile_id, meeting.recipient_profile_id)
    where profile.user_id = due_preference.user_id
      and meeting.status in ('confirmed','scheduled')
      and coalesce(meeting.confirmed_start, meeting.proposed_start) >= now();

    select jsonb_strip_nulls(jsonb_build_object(
      'opportunity_match_id', opportunity.id,
      'tender_id', tender.id,
      'title', tender.title,
      'match_score', opportunity.match_score,
      'deadline_at', tender.deadline_at
    )) into strongest
    from public.opportunity_matches opportunity
    join public.companies company on company.id = opportunity.company_id
    join public.tenders tender on tender.id = opportunity.tender_id
    where company.owner_id = due_preference.user_id
      and opportunity.opportunity_type = 'tender'
      and opportunity.status <> 'dismissed'
      and tender.status = 'open'
      and (tender.deadline_at is null or tender.deadline_at > now())
    order by opportunity.match_score desc,
      tender.deadline_at asc nulls last, opportunity.id desc
    limit 1;

    notification_id := public.portal_add_notification(
      due_preference.user_id,
      null,
      'digest',
      null,
      'weekly_digest',
      'Your MedicHall week',
      tender_count || ' tender matches · ' || company_match_count ||
        ' company matches · ' || rfq_count || ' RFQs · ' || meeting_count ||
        ' upcoming meetings.',
      null,
      'weekly-digest:' || digest_week || ':' || due_preference.user_id,
      '#dashboard',
      false,
      jsonb_build_object(
        'period_days', 7,
        'new_tender_matches', tender_count,
        'new_company_matches', company_match_count,
        'new_rfqs', rfq_count,
        'upcoming_meetings', meeting_count,
        'strongest_opportunity', strongest
      )
    );

    update public.user_notification_preferences
    set last_digest_at = now(),
        next_digest_at = now() + interval '7 days',
        updated_at = now()
    where user_id = due_preference.user_id;

    if notification_id is not null then
      digest_count := digest_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'deadline_notifications', deadline_count,
    'weekly_digests', digest_count
  );
end;
$function$;

create or replace function public.claim_user_notification_emails(
  p_limit integer default 40,
  p_lease_seconds integer default 120
)
returns table (
  outbox_id bigint,
  recipient_user_id uuid,
  event_type text,
  payload jsonb,
  attempt_count integer,
  idempotency_key text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 40), 100));
  safe_lease integer := greatest(30, least(coalesce(p_lease_seconds, 120), 600));
begin
  update public.user_notification_email_outbox queue
  set status = 'suppressed',
      lease_expires_at = null,
      error_code = 'preference_disabled',
      error_redacted = 'preference_disabled',
      updated_at = now()
  where queue.status in ('pending','retry','processing')
    and not public.user_notification_event_enabled(
      queue.recipient_user_id, queue.event_type
    );

  return query
  with due as (
    select queue.id
    from public.user_notification_email_outbox queue
    where (
      queue.status in ('pending','retry')
      and queue.next_attempt_at <= now()
    ) or (
      queue.status = 'processing'
      and queue.lease_expires_at <= now()
    )
    order by queue.next_attempt_at, queue.id
    limit safe_limit
    for update skip locked
  ), leased as (
    update public.user_notification_email_outbox queue
    set status = 'processing',
        attempt_count = queue.attempt_count + 1,
        lease_expires_at = now() + make_interval(secs => safe_lease),
        error_code = null,
        error_redacted = null,
        updated_at = now()
    from due
    where queue.id = due.id
    returning queue.*
  )
  select leased.id, leased.recipient_user_id, leased.event_type,
    leased.payload, leased.attempt_count, leased.idempotency_key
  from leased
  order by leased.id;
end;
$function$;

create or replace function public.complete_user_notification_email(
  p_outbox_id bigint,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if nullif(trim(coalesce(p_provider_message_id, '')), '') is null then
    raise exception 'Provider message ID is required' using errcode = '22023';
  end if;
  update public.user_notification_email_outbox
  set status = 'sent',
      provider_message_id = left(trim(p_provider_message_id), 300),
      sent_at = now(),
      lease_expires_at = null,
      error_code = null,
      error_redacted = null,
      updated_at = now()
  where id = p_outbox_id and status = 'processing';
  return found;
end;
$function$;

create or replace function public.retry_user_notification_email(
  p_outbox_id bigint,
  p_error_code text,
  p_error_redacted text,
  p_retry_after_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  result_status text;
begin
  update public.user_notification_email_outbox queue
  set status = case when queue.attempt_count >= queue.max_attempts
      then 'failed' else 'retry' end,
      next_attempt_at = case when queue.attempt_count >= queue.max_attempts
        then queue.next_attempt_at
        else now() + make_interval(secs => least(21600, greatest(
          30,
          coalesce(p_retry_after_seconds,
            (30 * power(2, greatest(queue.attempt_count - 1, 0)))::integer)
        )))
      end,
      lease_expires_at = null,
      error_code = left(regexp_replace(
        lower(coalesce(p_error_code, 'delivery_error')),
        '[^a-z0-9_]+', '_', 'g'
      ), 80),
      error_redacted = left(coalesce(p_error_redacted, 'delivery_error'), 300),
      updated_at = now()
  where queue.id = p_outbox_id and queue.status = 'processing'
  returning queue.status into result_status;
  return result_status;
end;
$function$;

revoke all on function public.user_notification_event_enabled(uuid,text)
  from public, anon, authenticated;
revoke all on function public.project_portal_notification_to_email()
  from public, anon, authenticated;
revoke all on function public.notify_new_tender_opportunity()
  from public, anon, authenticated;
revoke all on function public.notify_new_company_match()
  from public, anon, authenticated;
revoke all on function public.schedule_user_retention_notifications()
  from public, anon, authenticated;
revoke all on function public.claim_user_notification_emails(integer,integer)
  from public, anon, authenticated;
revoke all on function public.complete_user_notification_email(bigint,text)
  from public, anon, authenticated;
revoke all on function public.retry_user_notification_email(bigint,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.user_notification_event_enabled(uuid,text)
  to service_role;
grant execute on function public.schedule_user_retention_notifications()
  to service_role;
grant execute on function public.claim_user_notification_emails(integer,integer)
  to service_role;
grant execute on function public.complete_user_notification_email(bigint,text)
  to service_role;
grant execute on function public.retry_user_notification_email(bigint,text,text,integer)
  to service_role;

create or replace function public.dispatch_user_retention_notifications()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $function$
declare
  project_url text;
  cron_secret text;
  request_id bigint;
begin
  select max(decrypted_secret) filter (where name = 'medichall_project_url'),
         max(decrypted_secret) filter (where name = 'medichall_cron_secret')
  into project_url, cron_secret
  from vault.decrypted_secrets
  where name in ('medichall_project_url', 'medichall_cron_secret');

  if project_url is null or cron_secret is null then
    raise exception 'Notification cron Vault configuration is incomplete';
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/user-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb
  ) into request_id;
  return request_id;
end;
$function$;

revoke all on function public.dispatch_user_retention_notifications()
  from public, anon, authenticated;
grant execute on function public.dispatch_user_retention_notifications()
  to service_role;

do $schedule$
declare
  scheduled_job bigint;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable; user notification dispatcher remains callable';
    return;
  end if;
  begin
    perform cron.unschedule('medichall-user-notifications');
  exception when others then
    null;
  end;
  scheduled_job := cron.schedule(
    'medichall-user-notifications',
    '*/15 * * * *',
    'select public.dispatch_user_retention_notifications();'
  );
  raise notice 'Scheduled user notification job %', scheduled_job;
exception when others then
  raise notice 'User notification automation was not scheduled: %', sqlerrm;
end
$schedule$;

commit;

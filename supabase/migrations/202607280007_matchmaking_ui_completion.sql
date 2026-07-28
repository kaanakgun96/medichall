begin;

do $migration$
begin
  if to_regclass('public.matchmaking_notifications') is null
     or to_regclass('public.matchmaking_meeting_requests') is null
     or to_regclass('public.rfq_requests') is null
     or to_regclass('public.rfq_messages') is null
     or to_regclass('public.rfq_offers') is null then
    raise exception 'Matchmaking Workspace and RFQ compatibility objects must exist first';
  end if;
end
$migration$;

create or replace function public.mm_validate_proposal_slots(
  p_slots jsonb,
  p_timezone text,
  p_require_future boolean default true
)
returns table (
  slot_number smallint,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  slot_record record;
  parsed_start timestamptz;
  parsed_end timestamptz;
  parsed_duration integer;
begin
  if p_slots is null
     or jsonb_typeof(p_slots) <> 'array'
     or jsonb_array_length(p_slots) <> 3 then
    raise exception 'Meeting requests must contain exactly three proposed times'
      using errcode = '22023';
  end if;
  if nullif(trim(p_timezone), '') is null
     or not exists (
       select 1
       from pg_timezone_names
       where name = trim(p_timezone)
     ) then
    raise exception 'Use a valid IANA timezone'
      using errcode = '22023';
  end if;

  for slot_record in
    select value, ordinality
    from jsonb_array_elements(p_slots) with ordinality
  loop
    begin
      parsed_start := (slot_record.value ->> 'start_at')::timestamptz;
      parsed_end := (slot_record.value ->> 'end_at')::timestamptz;
    exception when others then
      raise exception 'Each meeting proposal needs valid ISO start_at and end_at values'
        using errcode = '22007';
    end;

    if parsed_end <= parsed_start then
      raise exception 'A meeting end time must be after its start time'
        using errcode = '22023';
    end if;
    parsed_duration :=
      round(extract(epoch from (parsed_end - parsed_start)) / 60.0)::integer;
    if parsed_duration not between 15 and 240 then
      raise exception 'Meeting duration must be between 15 and 240 minutes'
        using errcode = '22023';
    end if;
    if p_require_future
       and parsed_start < now() + interval '5 minutes' then
      raise exception 'Meeting proposals must start at least five minutes from now'
        using errcode = '22023';
    end if;

    slot_number := slot_record.ordinality::smallint;
    start_at := parsed_start;
    end_at := parsed_end;
    duration_minutes := parsed_duration;
    return next;
  end loop;
end;
$function$;

alter table public.matchmaking_notifications
  add column if not exists recipient_user_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists source_kind text,
  add column if not exists source_id bigint,
  add column if not exists company_name text,
  add column if not exists action_required boolean not null default false,
  add column if not exists resolved_at timestamptz;

update public.matchmaking_notifications notification
set
  recipient_user_id = (
    select recipient.user_id
    from public.matchmaking_profiles recipient
    where recipient.id = notification.recipient_profile_id
  ),
  actor_user_id = (
    select actor.user_id
    from public.matchmaking_profiles actor
    where actor.id = notification.actor_profile_id
  ),
  source_kind = case
    when notification.meeting_id is not null then 'meeting'
    when notification.connection_id is not null then 'connection'
    else 'system'
  end,
  source_id = coalesce(notification.meeting_id, notification.connection_id),
  company_name = (
    select actor.display_name
    from public.matchmaking_profiles actor
    where actor.id = notification.actor_profile_id
  ),
  action_required = notification.notification_type in (
    'connection_requested',
    'meeting_proposed',
    'meeting_counter_proposed'
  )
where exists (
    select 1
    from public.matchmaking_profiles recipient
    where recipient.id = notification.recipient_profile_id
  )
  and (
    notification.recipient_user_id is null
    or notification.source_kind is null
  );

update public.matchmaking_notifications notification
set resolved_at = coalesce(notification.resolved_at, now())
where notification.action_required = true
  and notification.resolved_at is null
  and (
    (
      notification.meeting_id is not null
      and not exists (
        select 1
        from public.matchmaking_meeting_requests meeting
        where meeting.id = notification.meeting_id
          and meeting.status in (
            'proposed',
            'awaiting_response',
            'counter_proposed'
          )
      )
    )
    or (
      notification.connection_id is not null
      and notification.meeting_id is null
      and not exists (
        select 1
        from public.business_connections connection
        where connection.id = notification.connection_id
          and connection.status = 'pending'
      )
    )
  );

alter table public.matchmaking_notifications
  alter column recipient_profile_id drop not null;

create unique index if not exists matchmaking_notifications_user_dedupe_unique
  on public.matchmaking_notifications(recipient_user_id, dedupe_key)
  where recipient_user_id is not null;

create index if not exists matchmaking_notifications_user_state_idx
  on public.matchmaking_notifications(
    recipient_user_id,
    action_required,
    resolved_at,
    read_at,
    created_at desc
  );

drop policy if exists "users view own portal notifications"
  on public.matchmaking_notifications;

create policy "users view own portal notifications"
on public.matchmaking_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

create or replace function public.mm_add_notification(
  p_recipient_profile_id uuid,
  p_actor_profile_id uuid,
  p_connection_id bigint,
  p_meeting_id bigint,
  p_notification_type text,
  p_title text,
  p_body text,
  p_dedupe_key text,
  p_action_url text default '#matchmaking',
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  notification_id bigint;
  recipient_user_id uuid;
  actor_user_id uuid;
  actor_name text;
begin
  select profile.user_id
  into recipient_user_id
  from public.matchmaking_profiles profile
  where profile.id = p_recipient_profile_id;

  select profile.user_id, profile.display_name
  into actor_user_id, actor_name
  from public.matchmaking_profiles profile
  where profile.id = p_actor_profile_id;

  insert into public.matchmaking_notifications (
    recipient_profile_id,
    recipient_user_id,
    actor_profile_id,
    actor_user_id,
    connection_id,
    meeting_id,
    source_kind,
    source_id,
    notification_type,
    title,
    body,
    company_name,
    action_url,
    payload,
    dedupe_key,
    action_required
  )
  values (
    p_recipient_profile_id,
    recipient_user_id,
    p_actor_profile_id,
    actor_user_id,
    p_connection_id,
    p_meeting_id,
    case
      when p_meeting_id is not null then 'meeting'
      when p_connection_id is not null then 'connection'
      else 'system'
    end,
    coalesce(p_meeting_id, p_connection_id),
    p_notification_type,
    left(trim(p_title), 200),
    left(trim(p_body), 1000),
    actor_name,
    p_action_url,
    coalesce(p_payload, '{}'::jsonb),
    left(p_dedupe_key, 240),
    p_notification_type in (
      'connection_requested',
      'meeting_proposed',
      'meeting_counter_proposed'
    )
  )
  on conflict (recipient_profile_id, dedupe_key) do update
  set
    recipient_user_id = excluded.recipient_user_id,
    actor_user_id = excluded.actor_user_id,
    source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    company_name = excluded.company_name,
    action_required = excluded.action_required
  returning id into notification_id;

  return notification_id;
end;
$function$;

create or replace function public.portal_add_notification(
  p_recipient_user_id uuid,
  p_actor_user_id uuid,
  p_source_kind text,
  p_source_id bigint,
  p_notification_type text,
  p_title text,
  p_body text,
  p_company_name text,
  p_dedupe_key text,
  p_action_url text,
  p_action_required boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  notification_id bigint;
  recipient_profile_id uuid;
  actor_profile_id uuid;
begin
  if p_recipient_user_id is null then
    return null;
  end if;

  select id
  into recipient_profile_id
  from public.matchmaking_profiles
  where user_id = p_recipient_user_id
  limit 1;

  select id
  into actor_profile_id
  from public.matchmaking_profiles
  where user_id = p_actor_user_id
  limit 1;

  insert into public.matchmaking_notifications (
    recipient_profile_id,
    recipient_user_id,
    actor_profile_id,
    actor_user_id,
    source_kind,
    source_id,
    notification_type,
    title,
    body,
    company_name,
    action_url,
    payload,
    dedupe_key,
    action_required
  )
  values (
    recipient_profile_id,
    p_recipient_user_id,
    actor_profile_id,
    p_actor_user_id,
    left(trim(p_source_kind), 40),
    p_source_id,
    left(trim(p_notification_type), 80),
    left(trim(p_title), 200),
    left(trim(p_body), 1000),
    nullif(left(trim(p_company_name), 200), ''),
    p_action_url,
    coalesce(p_payload, '{}'::jsonb),
    left(p_dedupe_key, 240),
    coalesce(p_action_required, false)
  )
  on conflict (recipient_user_id, dedupe_key)
    where recipient_user_id is not null
  do update
  set
    title = excluded.title,
    body = excluded.body,
    company_name = excluded.company_name,
    action_url = excluded.action_url,
    payload = excluded.payload,
    action_required = excluded.action_required
  returning id into notification_id;

  return notification_id;
end;
$function$;

create or replace function public.get_portal_notification_center(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(notification) order by notification.created_at desc),
    '[]'::jsonb
  )
  into items
  from (
    select
      id,
      source_kind,
      source_id,
      connection_id,
      meeting_id,
      notification_type,
      title,
      body,
      company_name,
      action_url,
      payload,
      action_required,
      read_at,
      resolved_at,
      created_at
    from public.matchmaking_notifications
    where recipient_user_id = auth.uid()
    order by created_at desc, id desc
    limit safe_limit
  ) notification;

  return jsonb_build_object(
    'notifications', items,
    'unread_count', (
      select count(*)
      from public.matchmaking_notifications
      where recipient_user_id = auth.uid()
        and read_at is null
    ),
    'action_required_count', (
      select count(*)
      from public.matchmaking_notifications
      where recipient_user_id = auth.uid()
        and action_required = true
        and resolved_at is null
    ),
    'badge_count', (
      select count(*)
      from public.matchmaking_notifications
      where recipient_user_id = auth.uid()
        and (
          read_at is null
          or (action_required = true and resolved_at is null)
        )
    ),
    'generated_at', now()
  );
end;
$function$;

create or replace function public.mark_portal_notifications_read(
  p_notification_ids bigint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  update public.matchmaking_notifications
  set read_at = coalesce(read_at, now())
  where recipient_user_id = auth.uid()
    and (
      p_notification_ids is null
      or id = any(p_notification_ids)
    );

  get diagnostics affected = row_count;

  return jsonb_build_object(
    'updated_count', affected,
    'unread_count', (
      select count(*)
      from public.matchmaking_notifications
      where recipient_user_id = auth.uid()
        and read_at is null
    )
  );
end;
$function$;

create or replace function public.portal_resolve_connection_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  target_user_id uuid;
begin
  if old.status = 'pending' and new.status <> 'pending' then
    select user_id
    into target_user_id
    from public.matchmaking_profiles
    where id = new.recipient_profile_id;

    update public.matchmaking_notifications notification
    set resolved_at = coalesce(resolved_at, now())
    where notification.recipient_user_id = target_user_id
      and notification.connection_id = new.id
      and notification.action_required = true
      and notification.resolved_at is null;
  end if;
  return new;
end;
$function$;

drop trigger if exists portal_resolve_connection_notifications
  on public.business_connections;

create trigger portal_resolve_connection_notifications
after update of status on public.business_connections
for each row
execute function public.portal_resolve_connection_notifications();

create or replace function public.portal_resolve_meeting_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if old.proposal_round is distinct from new.proposal_round
     or (
       old.status in ('proposed', 'awaiting_response', 'counter_proposed')
       and new.status not in ('proposed', 'awaiting_response', 'counter_proposed')
     ) then
    update public.matchmaking_notifications
    set resolved_at = coalesce(resolved_at, now())
    where meeting_id = new.id
      and action_required = true
      and resolved_at is null;
  end if;
  return new;
end;
$function$;

drop trigger if exists portal_resolve_meeting_notifications
  on public.matchmaking_meeting_requests;

create trigger portal_resolve_meeting_notifications
after update of status, proposal_round
on public.matchmaking_meeting_requests
for each row
execute function public.portal_resolve_meeting_notifications();

create or replace function public.portal_notify_rfq_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  recipient_user_id uuid;
  recipient_company_name text;
  actor_company_name text;
begin
  select company.owner_id, company.name
  into recipient_user_id, recipient_company_name
  from public.companies company
  where company.id = new.company_id;

  select coalesce(
    nullif(trim(buyer.company_name), ''),
    nullif(trim(new.company), ''),
    'A buyer'
  )
  into actor_company_name
  from (select 1) seed
  left join public.buyer_profiles buyer
    on buyer.user_id = new.user_id;

  perform public.portal_add_notification(
    recipient_user_id,
    new.user_id,
    'rfq',
    new.id,
    'rfq_request',
    'New quotation request',
    actor_company_name || ' requested a quotation for ' ||
      coalesce(nullif(trim(new.product_name), ''), 'a product inquiry') || '.',
    actor_company_name,
    'rfq:' || new.id || ':request',
    '#rfq-request=' || new.id,
    new.user_id is not null,
    jsonb_build_object(
      'rfq_id', new.id,
      'recipient_company', recipient_company_name
    )
  );
  return new;
end;
$function$;

drop trigger if exists portal_notify_rfq_request
  on public.rfq_requests;

create trigger portal_notify_rfq_request
after insert on public.rfq_requests
for each row
execute function public.portal_notify_rfq_request();

create or replace function public.portal_notify_rfq_offer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  recipient_user_id uuid;
  manufacturer_user_id uuid;
  actor_company_name text;
begin
  select request.user_id
  into recipient_user_id
  from public.rfq_requests request
  where request.id = new.rfq_id;

  select company.owner_id, company.name
  into manufacturer_user_id, actor_company_name
  from public.companies company
  where company.id = new.company_id;

  update public.matchmaking_notifications notification
  set resolved_at = coalesce(resolved_at, now())
  where notification.recipient_user_id = manufacturer_user_id
    and notification.source_kind = 'rfq'
    and notification.source_id = new.rfq_id
    and notification.notification_type = 'rfq_request'
    and notification.action_required = true
    and notification.resolved_at is null;

  perform public.portal_add_notification(
    recipient_user_id,
    manufacturer_user_id,
    'rfq',
    new.rfq_id,
    'rfq_offer',
    case
      when tg_op = 'UPDATE' then 'Quotation offer updated'
      else 'Quotation offer received'
    end,
    coalesce(actor_company_name, 'A manufacturer') ||
      case
        when tg_op = 'UPDATE'
          then ' updated an offer for your quotation request.'
        else ' submitted an offer for your quotation request.'
      end,
    actor_company_name,
    'rfq:' || new.rfq_id || ':offer:' || new.id ||
      case
        when tg_op = 'UPDATE'
          then ':v:' || md5(new.updated_at::text)
        else ''
      end,
    '#rfq-request=' || new.rfq_id,
    false,
    jsonb_build_object('rfq_id', new.rfq_id, 'offer_id', new.id)
  );
  return new;
end;
$function$;

drop trigger if exists portal_notify_rfq_offer
  on public.rfq_offers;

create trigger portal_notify_rfq_offer
after insert or update on public.rfq_offers
for each row
execute function public.portal_notify_rfq_offer();

create or replace function public.portal_notify_rfq_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  buyer_user_id uuid;
  manufacturer_user_id uuid;
  recipient_user_id uuid;
  actor_company_name text;
begin
  select request.user_id, company.owner_id
  into buyer_user_id, manufacturer_user_id
  from public.rfq_requests request
  join public.companies company
    on company.id = request.company_id
  where request.id = new.rfq_id;

  recipient_user_id := case
    when new.sender_id = buyer_user_id then manufacturer_user_id
    else buyer_user_id
  end;

  select coalesce(
    (
      select company.name
      from public.companies company
      where company.owner_id = new.sender_id
      limit 1
    ),
    (
      select buyer.company_name
      from public.buyer_profiles buyer
      where buyer.user_id = new.sender_id
      limit 1
    ),
    'MedicHall partner'
  )
  into actor_company_name;

  perform public.portal_add_notification(
    recipient_user_id,
    new.sender_id,
    'rfq',
    new.rfq_id,
    'rfq_message',
    'New RFQ message',
    actor_company_name || ': ' || left(trim(new.body), 160),
    actor_company_name,
    'rfq:' || new.rfq_id || ':message:' || new.id,
    '#rfq-chat=' || new.rfq_id,
    false,
    jsonb_build_object('rfq_id', new.rfq_id, 'message_id', new.id)
  );
  return new;
end;
$function$;

drop trigger if exists portal_notify_rfq_message
  on public.rfq_messages;

create trigger portal_notify_rfq_message
after insert on public.rfq_messages
for each row
execute function public.portal_notify_rfq_message();

create or replace function public.revise_matchmaking_meeting_proposal(
  p_meeting_id bigint,
  p_expected_version integer,
  p_title text,
  p_agenda text,
  p_timezone text,
  p_language text,
  p_slots jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  other_profile public.matchmaking_profiles;
  meeting_row public.matchmaking_meeting_requests;
  current_proposer_id uuid;
  validated_slot record;
  idempotency record;
  expected_duration integer;
  first_start timestamptz;
  first_end timestamptz;
  latest_end timestamptz;
  seen_starts timestamptz[] := '{}'::timestamptz[];
  new_round integer;
  result jsonb;
begin
  if nullif(trim(p_title), '') is null
     or char_length(trim(p_title)) > 160 then
    raise exception 'Meeting title must contain between 1 and 160 characters'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_agenda, '')) > 4000
     or char_length(coalesce(p_language, '')) > 40 then
    raise exception 'Meeting agenda or language exceeds the allowed length'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_slots) <> 'array'
     or jsonb_array_length(p_slots) <> 3 then
    raise exception 'Meeting requests must contain exactly three proposed times'
      using errcode = '22023';
  end if;

  select *
  into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid();

  if current_profile.id is null then
    raise exception 'Create your matchmaking profile first'
      using errcode = '42501';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile.id,
    'revise_meeting_proposal',
    p_idempotency_key,
    jsonb_build_object(
      'meeting_id', p_meeting_id,
      'expected_version', p_expected_version,
      'title', trim(p_title),
      'agenda', nullif(trim(p_agenda), ''),
      'timezone', trim(p_timezone),
      'language', nullif(trim(p_language), ''),
      'slots', p_slots
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into meeting_row
  from public.matchmaking_meeting_requests
  where id = p_meeting_id
  for update;

  if meeting_row.id is null
     or current_profile.id not in (
       meeting_row.requester_profile_id,
       meeting_row.recipient_profile_id
     ) then
    raise exception 'Meeting not found or access denied'
      using errcode = '42501';
  end if;
  if meeting_row.status not in (
    'proposed',
    'awaiting_response',
    'counter_proposed'
  ) then
    raise exception 'This meeting proposal can no longer be edited'
      using errcode = '40001';
  end if;
  if p_expected_version is null
     or meeting_row.state_version <> p_expected_version then
    raise exception 'This meeting changed. Refresh before editing.'
      using errcode = '40001';
  end if;

  select proposed_by_profile_id
  into current_proposer_id
  from public.matchmaking_meeting_proposals
  where meeting_id = meeting_row.id
    and proposal_round = meeting_row.proposal_round
    and status = 'active'
  order by slot_number
  limit 1;

  if current_proposer_id is distinct from current_profile.id then
    raise exception 'Only the participant awaiting a response may edit these times'
      using errcode = '42501';
  end if;

  for validated_slot in
    select *
    from public.mm_validate_proposal_slots(p_slots, trim(p_timezone), true)
  loop
    if expected_duration is null then
      expected_duration := validated_slot.duration_minutes;
      first_start := validated_slot.start_at;
      first_end := validated_slot.end_at;
    elsif expected_duration <> validated_slot.duration_minutes then
      raise exception 'All proposed times must use the same duration'
        using errcode = '22023';
    end if;
    if validated_slot.start_at = any(seen_starts) then
      raise exception 'Meeting proposals must use distinct start times'
        using errcode = '22023';
    end if;
    seen_starts := array_append(seen_starts, validated_slot.start_at);
    latest_end := greatest(
      coalesce(latest_end, validated_slot.end_at),
      validated_slot.end_at
    );
  end loop;

  update public.matchmaking_meeting_proposals
  set status = 'superseded'
  where meeting_id = meeting_row.id
    and proposal_round = meeting_row.proposal_round
    and status = 'active';

  new_round := meeting_row.proposal_round + 1;

  for validated_slot in
    select *
    from public.mm_validate_proposal_slots(p_slots, trim(p_timezone), true)
  loop
    insert into public.matchmaking_meeting_proposals (
      meeting_id,
      proposal_round,
      slot_number,
      proposed_by_profile_id,
      start_at,
      end_at,
      source_timezone,
      status
    )
    values (
      meeting_row.id,
      new_round,
      validated_slot.slot_number,
      current_profile.id,
      validated_slot.start_at,
      validated_slot.end_at,
      trim(p_timezone),
      'active'
    );
  end loop;

  update public.matchmaking_meeting_requests
  set
    title = trim(p_title),
    agenda = nullif(trim(p_agenda), ''),
    language = nullif(trim(p_language), ''),
    timezone = trim(p_timezone),
    creator_timezone = trim(p_timezone),
    duration_minutes = expected_duration,
    proposal_round = new_round,
    proposed_start = first_start,
    proposed_end = first_end,
    expires_at = latest_end + interval '7 days',
    state_version = state_version + 1,
    last_activity_at = now(),
    updated_at = now()
  where id = meeting_row.id
  returning * into meeting_row;

  update public.matchmaking_meeting_participants
  set
    response_status = case
      when profile_id = current_profile.id then 'accepted'
      else 'needs_action'
    end,
    responded_at = case
      when profile_id = current_profile.id then now()
      else null
    end
  where meeting_id = meeting_row.id;

  select *
  into other_profile
  from public.matchmaking_profiles
  where id = case
    when meeting_row.requester_profile_id = current_profile.id
      then meeting_row.recipient_profile_id
    else meeting_row.requester_profile_id
  end;

  perform public.mm_add_meeting_event(
    meeting_row.id,
    meeting_row.connection_id,
    current_profile.id,
    'meeting_proposal_revised',
    meeting_row.status,
    meeting_row.status,
    jsonb_build_object(
      'proposal_round', new_round,
      'proposal_count', 3,
      'timezone', trim(p_timezone)
    )
  );
  perform public.mm_add_system_message(
    meeting_row.connection_id,
    current_profile.display_name || ' edited the proposed meeting times.',
    jsonb_build_object(
      'event_type', 'meeting_proposal_revised',
      'meeting_id', meeting_row.id
    )
  );
  perform public.mm_add_notification(
    other_profile.id,
    current_profile.id,
    meeting_row.connection_id,
    meeting_row.id,
    'meeting_counter_proposed',
    'Updated meeting times',
    current_profile.display_name || ' edited the three proposed meeting times.',
    'meeting:' || meeting_row.id || ':revised:v' || meeting_row.state_version,
    '#matchmaking-meeting=' || meeting_row.id
  );

  update public.business_connections
  set last_activity_at = now(), updated_at = now()
  where id = meeting_row.connection_id;

  result := public.mm_meeting_snapshot(meeting_row.id);
  perform public.mm_complete_idempotent_operation(
    current_profile.id,
    'revise_meeting_proposal',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.reschedule_matchmaking_meeting(
  p_meeting_id bigint,
  p_expected_version integer,
  p_title text,
  p_agenda text,
  p_timezone text,
  p_language text,
  p_slots jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid;
  connection_id bigint;
begin
  select profile.id
  into current_profile_id
  from public.matchmaking_profiles profile
  where profile.user_id = auth.uid();

  select meeting.connection_id
  into connection_id
  from public.matchmaking_meeting_requests meeting
  where meeting.id = p_meeting_id
    and current_profile_id in (
      meeting.requester_profile_id,
      meeting.recipient_profile_id
    );

  if connection_id is null then
    raise exception 'Meeting not found or access denied'
      using errcode = '42501';
  end if;

  perform public.respond_matchmaking_meeting(
    p_meeting_id,
    'cancel',
    p_expected_version,
    p_idempotency_key,
    null,
    null,
    null,
    'Rescheduled with three new time options'
  );

  return public.propose_matchmaking_meeting(
    connection_id,
    p_title,
    p_agenda,
    p_timezone,
    p_language,
    p_slots,
    false,
    p_idempotency_key
  );
end;
$function$;

revoke all on function public.portal_add_notification(
  uuid, uuid, text, bigint, text, text, text, text, text, text, boolean, jsonb
) from public, anon, authenticated;

revoke all on function public.get_portal_notification_center(integer)
  from public, anon, authenticated;
grant execute on function public.get_portal_notification_center(integer)
  to authenticated;

revoke all on function public.mark_portal_notifications_read(bigint[])
  from public, anon, authenticated;
grant execute on function public.mark_portal_notifications_read(bigint[])
  to authenticated;

revoke all on function public.revise_matchmaking_meeting_proposal(
  bigint, integer, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.revise_matchmaking_meeting_proposal(
  bigint, integer, text, text, text, text, jsonb, uuid
) to authenticated;

revoke all on function public.reschedule_matchmaking_meeting(
  bigint, integer, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.reschedule_matchmaking_meeting(
  bigint, integer, text, text, text, text, jsonb, uuid
) to authenticated;

revoke insert, update, delete
on public.matchmaking_notifications
from anon, authenticated;

insert into supabase_migrations.schema_migrations(version, name, statements)
values (
  '202607280007',
  'matchmaking_ui_completion',
  array['matchmaking UI completion and global notification center']
)
on conflict (version) do nothing;

commit;

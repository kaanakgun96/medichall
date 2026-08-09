-- Run after 202608090004_user_retention_notifications.sql.
-- Every identity, company, tender, notification and outbox fixture is rolled back.

begin;

do $contract$
begin
  if to_regclass('public.user_notification_preferences') is null
    or to_regclass('public.user_notification_email_outbox') is null then
    raise exception 'Sprint 5 notification relations are missing';
  end if;
  if to_regprocedure('public.get_user_notification_preferences()') is null
    or to_regprocedure(
      'public.update_user_notification_preferences(boolean,boolean,boolean,boolean,boolean,text)'
    ) is null
    or to_regprocedure('public.schedule_user_retention_notifications()') is null
    or to_regprocedure('public.claim_user_notification_emails(integer,integer)') is null
    or to_regprocedure('public.complete_user_notification_email(bigint,text)') is null
    or to_regprocedure(
      'public.retry_user_notification_email(bigint,text,text,integer)'
    ) is null then
    raise exception 'Sprint 5 notification RPC contract is incomplete';
  end if;
  if has_table_privilege('anon', 'public.user_notification_preferences', 'SELECT')
    or has_table_privilege('anon', 'public.user_notification_email_outbox', 'SELECT')
    or has_table_privilege('authenticated', 'public.user_notification_email_outbox', 'SELECT')
    or has_table_privilege('authenticated', 'public.user_notification_email_outbox', 'INSERT') then
    raise exception 'Notification data grants are too broad';
  end if;
  if has_function_privilege('anon', 'public.get_user_notification_preferences()', 'EXECUTE')
    or has_function_privilege(
      'authenticated',
      'public.claim_user_notification_emails(integer,integer)',
      'EXECUTE'
    ) then
    raise exception 'Notification RPC grants are too broad';
  end if;
  if not has_function_privilege(
      'authenticated', 'public.get_user_notification_preferences()', 'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.claim_user_notification_emails(integer,integer)',
      'EXECUTE'
    ) then
    raise exception 'Required notification RPC grant is missing';
  end if;
end
$contract$;

create temporary table retention_fixture (
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  tender_id bigint,
  opportunity_id bigint
) on commit drop;

insert into retention_fixture (ordinal, user_id) values
  (1, '60000000-0000-4000-8000-000000000001'),
  (2, '60000000-0000-4000-8000-000000000002');

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select user_id, 'authenticated', 'authenticated',
  'retention-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), false, false
from retention_fixture;

with inserted as (
  insert into public.companies (
    owner_id, name, type, country, is_approved, is_active
  )
  select user_id, 'Retention QA ' || ordinal,
    'Medical device manufacturer', 'Germany', true, true
  from retention_fixture
  returning id, owner_id
)
update retention_fixture fixture
set company_id = inserted.id
from inserted where inserted.owner_id = fixture.user_id;

do $preference_backfill$
begin
  if (select count(*) from public.user_notification_preferences
      where user_id in (select user_id from retention_fixture)) <> 2 then
    raise exception 'Company activation did not create notification preferences';
  end if;
end
$preference_backfill$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $tenant_preferences$
declare
  state jsonb;
begin
  state := public.get_user_notification_preferences();
  if state ->> 'tender_alerts_enabled' <> 'true' then
    raise exception 'Default tender preference is not enabled';
  end if;

  state := public.update_user_notification_preferences(
    true, false, true, true, true, 'Europe/Istanbul'
  );
  if state ->> 'tender_alerts_enabled' <> 'false'
    or state ->> 'timezone' <> 'Europe/Istanbul' then
    raise exception 'Preference update did not persist';
  end if;

  if (select count(*) from public.user_notification_preferences) <> 1 then
    raise exception 'Preference RLS exposed another user';
  end if;
end
$tenant_preferences$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with inserted as (
  insert into public.tenders (
    source, source_notice_id, title, country_code, country_name,
    cpv_codes, product_keywords, deadline_at, status
  )
  select 'retention-regression', 'fixture-' || ordinal,
    'Synthetic sterile drape tender ' || ordinal,
    'DE', 'Germany', array['33140000'], array['sterile drape'],
    case when ordinal = 1 then now() + interval '7 days'
      else now() + interval '20 days' end,
    'open'
  from retention_fixture
  returning id, source_notice_id
)
update retention_fixture fixture
set tender_id = inserted.id
from inserted
where inserted.source_notice_id = 'fixture-' || fixture.ordinal;

with inserted as (
  insert into public.opportunity_matches (
    company_id, opportunity_type, tender_id, match_score, confidence_score,
    keyword_score, geography_score, certification_score, category_score,
    reasons, risks, status, generated_by
  )
  select company_id, 'tender', tender_id,
    case when ordinal = 1 then 94 else 82 end,
    80, 90, 80, 75, 90,
    '["Sterile drape product relevance"]'::jsonb,
    '[]'::jsonb,
    case when ordinal = 1 then 'saved' else 'new' end,
    'retention-regression'
  from retention_fixture
  returning id, company_id
)
update retention_fixture fixture
set opportunity_id = inserted.id
from inserted where inserted.company_id = fixture.company_id;

do $disabled_tender_alert$
begin
  if not exists (
    select 1 from public.matchmaking_notifications notification
    where notification.recipient_user_id =
      '60000000-0000-4000-8000-000000000001'
      and notification.notification_type = 'tender_match_high'
  ) then
    raise exception 'In-app tender match notification was not created';
  end if;
  if exists (
    select 1 from public.user_notification_email_outbox queue
    where queue.recipient_user_id =
      '60000000-0000-4000-8000-000000000001'
      and queue.event_type = 'HIGH_TENDER_MATCH'
  ) then
    raise exception 'Disabled tender preference still queued email';
  end if;
  if not exists (
    select 1 from public.user_notification_email_outbox queue
    where queue.recipient_user_id =
      '60000000-0000-4000-8000-000000000002'
      and queue.event_type = 'HIGH_TENDER_MATCH'
  ) then
    raise exception 'Enabled tender preference did not queue email';
  end if;
end
$disabled_tender_alert$;

update public.user_notification_preferences
set tender_alerts_enabled = true, next_digest_at = now() - interval '1 minute'
where user_id = '60000000-0000-4000-8000-000000000001';

select public.portal_add_notification(
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  'rfq', 9001, 'rfq_message', 'New RFQ message',
  'Synthetic partner: Can you quote this product?', 'Synthetic partner',
  'retention-regression:rfq-message:1', '#rfq-chat=9001', false,
  '{"rfq_id":9001}'::jsonb
);
select public.portal_add_notification(
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  'rfq', 9001, 'rfq_message', 'New RFQ message',
  'Synthetic partner: Can you quote this product?', 'Synthetic partner',
  'retention-regression:rfq-message:1', '#rfq-chat=9001', false,
  '{"rfq_id":9001}'::jsonb
);

do $event_idempotency$
begin
  if (select count(*) from public.matchmaking_notifications
      where dedupe_key = 'retention-regression:rfq-message:1') <> 1
    or (select count(*) from public.user_notification_email_outbox queue
        join public.matchmaking_notifications notification
          on notification.id = queue.notification_id
        where notification.dedupe_key =
          'retention-regression:rfq-message:1') <> 1 then
    raise exception 'Duplicate event created duplicate notification or email';
  end if;
end
$event_idempotency$;

do $deadline_and_digest$
declare
  first_result jsonb;
  second_result jsonb;
  digest_event jsonb;
begin
  first_result := public.schedule_user_retention_notifications();
  second_result := public.schedule_user_retention_notifications();
  if (first_result ->> 'deadline_notifications')::integer < 1
    or (first_result ->> 'weekly_digests')::integer <> 1 then
    raise exception 'Due deadline or weekly digest was not scheduled: %',
      first_result;
  end if;
  if (second_result ->> 'weekly_digests')::integer <> 0 then
    raise exception 'Repeated scheduler created a duplicate weekly digest';
  end if;
  if (select count(*) from public.matchmaking_notifications
      where dedupe_key like 'tender-deadline:%:7d'
        and recipient_user_id =
          '60000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Deadline alert is missing or duplicated';
  end if;

  select notification.payload
  into digest_event
  from public.matchmaking_notifications notification
  where notification.recipient_user_id =
    '60000000-0000-4000-8000-000000000001'
    and notification.notification_type = 'weekly_digest'
  order by notification.id desc limit 1;

  if (digest_event ->> 'new_tender_matches')::integer <> 1
    or (digest_event #>> '{strongest_opportunity,match_score}')::integer <> 94
    or digest_event #>> '{strongest_opportunity,title}' is null then
    raise exception 'Weekly digest counts or strongest opportunity are wrong: %',
      digest_event;
  end if;
end
$deadline_and_digest$;

create temporary table claimed_retention_jobs as
select * from public.claim_user_notification_emails(100, 120);

do $claim_contract$
begin
  if not exists (
    select 1 from claimed_retention_jobs
    where event_type = 'NEW_MESSAGE'
      and idempotency_key like 'user-notification/%'
  ) then
    raise exception 'Due email was not leased with a stable idempotency key';
  end if;
end
$claim_contract$;

select public.complete_user_notification_email(
  (select outbox_id from claimed_retention_jobs
   where event_type = 'NEW_MESSAGE' limit 1),
  'provider-regression-redacted'
);

do $sent_not_released$
begin
  if exists (
    select 1 from public.claim_user_notification_emails(100, 120)
    where event_type = 'NEW_MESSAGE'
  ) then
    raise exception 'Completed notification was leased again';
  end if;
end
$sent_not_released$;

select public.portal_add_notification(
  '60000000-0000-4000-8000-000000000001', null,
  'rfq', 9002, 'rfq_message', 'Retry fixture', 'Retry safely.', null,
  'retention-regression:retry', '#rfq-chat=9002', false, '{}'::jsonb
);

create temporary table first_retry_claim as
select * from public.claim_user_notification_emails(100, 120)
where event_type = 'NEW_MESSAGE';

select public.retry_user_notification_email(
  (select outbox_id from first_retry_claim limit 1),
  'resend_http_503', 'resend_http_503', 30
);

update public.user_notification_email_outbox
set next_attempt_at = now() - interval '1 second'
where id = (select outbox_id from first_retry_claim limit 1);

create temporary table second_retry_claim as
select * from public.claim_user_notification_emails(100, 120)
where event_type = 'NEW_MESSAGE';

do $retry_idempotency$
begin
  if (select idempotency_key from first_retry_claim limit 1)
    is distinct from
    (select idempotency_key from second_retry_claim limit 1) then
    raise exception 'Retry changed provider idempotency key';
  end if;
end
$retry_idempotency$;

update public.user_notification_preferences
set immediate_rfq_message_enabled = false
where user_id = '60000000-0000-4000-8000-000000000001';

select public.retry_user_notification_email(
  (select outbox_id from second_retry_claim limit 1),
  'resend_http_503', 'resend_http_503', 30
);

select * from public.claim_user_notification_emails(100, 120);

do $preference_recheck$
begin
  if not exists (
    select 1 from public.user_notification_email_outbox
    where id = (select outbox_id from second_retry_claim limit 1)
      and status = 'suppressed'
      and error_code = 'preference_disabled'
  ) then
    raise exception 'Queued email was not suppressed after preference change';
  end if;
end
$preference_recheck$;

rollback;

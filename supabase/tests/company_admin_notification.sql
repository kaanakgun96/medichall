-- Run after 202608010001_company_admin_notification_outbox.sql.
-- Exercises durable enqueueing, duplicate suppression, failure isolation,
-- claim/retry/completion behavior, privilege boundaries and credential hygiene.
-- Every fixture is rolled back.

begin;

do $structure$
declare
  notify_source text;
begin
  if to_regclass('public.company_admin_notification_outbox') is null then
    raise exception 'Company admin notification outbox is missing';
  end if;
  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'company_admin_notification_outbox'
      and relation.relrowsecurity
  ) then
    raise exception 'RLS is disabled on the company notification outbox';
  end if;
  if has_table_privilege(
    'anon',
    'public.company_admin_notification_outbox',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'public.company_admin_notification_outbox',
    'select'
  ) then
    raise exception 'An API role can read the internal notification outbox';
  end if;

  if to_regprocedure(
    'public.claim_company_admin_notifications(integer,integer)'
  ) is null or to_regprocedure(
    'public.complete_company_admin_notification(bigint,text)'
  ) is null or to_regprocedure(
    'public.retry_company_admin_notification(bigint,text,text,integer)'
  ) is null then
    raise exception 'A company notification RPC is missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.claim_company_admin_notifications(integer,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_company_admin_notifications(integer,integer)',
    'execute'
  ) then
    raise exception 'An API role can claim admin notification jobs';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.claim_company_admin_notifications(integer,integer)',
    'execute'
  ) then
    raise exception 'Service role cannot claim admin notification jobs';
  end if;

  select procedure.prosrc
  into notify_source
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'notify_email'
  limit 1;

  if notify_source not like '%vault.decrypted_secrets%' then
    raise exception 'Legacy email helper does not read its key from Vault';
  end if;
  if notify_source ~ 're_[A-Za-z0-9]{12,}' then
    raise exception 'Legacy email helper contains a probable provider key';
  end if;
end
$structure$;

delete from public.company_admin_notification_outbox;

create temporary table company_admin_notification_test_company (
  id bigint primary key
) on commit drop;

with inserted as (
  insert into public.companies (name, type, country)
  values ('Notification QA One', 'manufacturer', 'Türkiye')
  returning id
)
insert into company_admin_notification_test_company (id)
select id from inserted;

do $enqueue$
declare
  company_id_value bigint;
  outbox_count integer;
begin
  select id into company_id_value
  from company_admin_notification_test_company;

  select count(*) into outbox_count
  from public.company_admin_notification_outbox queue
  where queue.company_id = company_id_value
    and queue.event_type = 'company_registered';
  if outbox_count <> 1 then
    raise exception 'Company insert queued % notifications, expected 1',
      outbox_count;
  end if;

  insert into public.company_admin_notification_outbox (
    company_id,
    event_type
  )
  values (company_id_value, 'company_registered')
  on conflict (company_id, event_type) do nothing;

  select count(*) into outbox_count
  from public.company_admin_notification_outbox queue
  where queue.company_id = company_id_value
    and queue.event_type = 'company_registered';
  if outbox_count <> 1 then
    raise exception 'Duplicate event was not suppressed';
  end if;
end
$enqueue$;

-- Force only the trigger's outbox insert to fail. The company registration
-- itself must still commit inside this transaction.
alter table public.company_admin_notification_outbox
  add constraint company_admin_notification_test_reject_new
  check (company_id < 0) not valid;

insert into public.companies (name, type, country)
values ('Notification QA Failure Isolation', 'buyer', 'Germany');

alter table public.company_admin_notification_outbox
  drop constraint company_admin_notification_test_reject_new;

do $failure_isolation$
declare
  company_count integer;
  outbox_count integer;
begin
  select count(*) into company_count
  from public.companies
  where name = 'Notification QA Failure Isolation';
  if company_count <> 1 then
    raise exception 'Outbox failure rolled back company registration';
  end if;

  select count(*) into outbox_count
  from public.company_admin_notification_outbox queue
  join public.companies company on company.id = queue.company_id
  where company.name = 'Notification QA Failure Isolation';
  if outbox_count <> 0 then
    raise exception 'Failure-isolation fixture unexpectedly queued a job';
  end if;
end
$failure_isolation$;

create temporary table company_admin_notification_claim as
select *
from public.claim_company_admin_notifications(1, 120);

do $claim$
declare
  claimed record;
begin
  select * into claimed
  from company_admin_notification_claim;
  if claimed.outbox_id is null
     or claimed.attempt_count <> 1
     or claimed.idempotency_key <> 'company-registration/'
       || claimed.outbox_id::text then
    raise exception 'Claim did not return a stable first-attempt job';
  end if;
end
$claim$;

select public.retry_company_admin_notification(
  (select outbox_id from company_admin_notification_claim),
  'resend_http_429',
  'resend_http_429',
  180
);

do $retry$
declare
  queue_row record;
begin
  select queue.* into queue_row
  from public.company_admin_notification_outbox queue
  where queue.id = (
    select outbox_id from company_admin_notification_claim
  );
  if queue_row.status <> 'retry'
     or queue_row.last_error_code <> 'resend_http_429'
     or queue_row.next_attempt_at < now() + interval '170 seconds'
     or queue_row.next_attempt_at > now() + interval '190 seconds' then
    raise exception 'Retry state or provider delay was not recorded safely';
  end if;
end
$retry$;

update public.company_admin_notification_outbox queue
set next_attempt_at = now()
where queue.id = (select outbox_id from company_admin_notification_claim);

truncate table company_admin_notification_claim;
insert into company_admin_notification_claim
select *
from public.claim_company_admin_notifications(1, 120);

do $second_claim$
declare
  claimed record;
begin
  select * into claimed
  from company_admin_notification_claim;
  if claimed.attempt_count <> 2 then
    raise exception 'Retry claim did not increment attempt_count';
  end if;
end
$second_claim$;

select public.complete_company_admin_notification(
  (select outbox_id from company_admin_notification_claim),
  'provider-message-qa'
);

do $completion$
declare
  queue_row record;
begin
  select queue.* into queue_row
  from public.company_admin_notification_outbox queue
  where queue.id = (
    select outbox_id from company_admin_notification_claim
  );
  if queue_row.status <> 'sent'
     or queue_row.provider_message_id <> 'provider-message-qa'
     or queue_row.sent_at is null
     or queue_row.lease_expires_at is not null then
    raise exception 'Successful delivery was not completed correctly';
  end if;
end
$completion$;

rollback;

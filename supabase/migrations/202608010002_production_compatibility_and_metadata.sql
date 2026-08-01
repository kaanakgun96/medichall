-- Forward-only production compatibility after baseline reconstruction.
--
-- This migration repairs only catalog drift verified on 2026-08-01. It does
-- not install Universal Tender Import and does not change customer rows.

begin;

-- ---------------------------------------------------------------------------
-- Core helper hardening
-- ---------------------------------------------------------------------------

alter function public.is_admin()
  set search_path to public, pg_temp;
alter function public.set_company_slug()
  set search_path to public, pg_temp;
alter function public.mh_email_from()
  set search_path to public, pg_temp;
alter function public.mh_site_url()
  set search_path to public, pg_temp;
alter function public.mh_admin_email()
  set search_path to public, pg_temp;
alter function public.trg_rfq_created()
  set search_path to public, pg_temp;
alter function public.trg_message_created()
  set search_path to public, pg_temp;
alter function public.trg_offer_touch()
  set search_path to public, pg_temp;
alter function public.trg_offer_created()
  set search_path to public, pg_temp;

-- PostgreSQL cannot rename an input parameter with CREATE OR REPLACE. The
-- only verified dependency is this product-read policy, so replace both in
-- one transaction without CASCADE.
drop policy if exists "public read products" on public.products;
drop function public.company_is_public(bigint);

create function public.company_is_public(p_company_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.is_approved
      and company.is_active
  );
$function$;

create policy "public read products"
on public.products for select
using (
  is_active
  and (
    company_id is null
    or public.company_is_public(company_id)
  )
);

-- Replace the retired embedded-provider implementation. Missing Vault or
-- network support remains a safe no-op so a business write never fails solely
-- because notification delivery is unavailable.
create or replace function public.notify_email(
  p_to text,
  p_subject text,
  p_html text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $function$
declare
  resend_api_key text;
begin
  if nullif(btrim(p_to), '') is null then
    return;
  end if;

  begin
    select decrypted_secret
    into resend_api_key
    from vault.decrypted_secrets
    where name = 'medichall_resend_api_key'
    limit 1;
  exception
    when undefined_table then
      return;
  end;

  if nullif(resend_api_key, '') is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || resend_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', public.mh_email_from(),
      'to', jsonb_build_array(p_to),
      'subject', p_subject,
      'html', p_html
    )
  );
exception
  when undefined_function then
    return;
end;
$function$;

revoke all on function public.notify_email(text, text, text)
from public, anon, authenticated;
grant execute on function public.notify_email(text, text, text)
to service_role;

revoke all on function public.trg_rfq_created()
from public, anon, authenticated;
revoke all on function public.trg_message_created()
from public, anon, authenticated;
revoke all on function public.trg_offer_created()
from public, anon, authenticated;
revoke all on function public.trg_offer_touch()
from public, anon, authenticated;
revoke all on function public.set_company_slug()
from public, anon, authenticated;

grant execute on function public.is_admin()
to anon, authenticated, service_role;
grant execute on function public.company_is_public(bigint)
to anon, authenticated, service_role;

-- The dashboard-built production schema has table grants on the original
-- matchmaking relations, while an empty migration install did not. Restore
-- only the API privileges required by existing RLS-protected portal behavior;
-- do not reproduce production's legacy anonymous table grants.
grant select, insert, update on table public.matchmaking_profiles
to authenticated;
grant select on table
  public.matchmaking_matches,
  public.business_connections,
  public.matchmaking_meeting_requests
to authenticated;

grant select, insert, update, delete on table
  public.matchmaking_profiles,
  public.matchmaking_matches,
  public.business_connections,
  public.matchmaking_meeting_requests,
  public.matchmaking_meeting_proposals,
  public.matchmaking_meeting_participants,
  public.matchmaking_meeting_events,
  public.matchmaking_notifications,
  public.matchmaking_relationship_messages,
  public.matchmaking_private_notes,
  public.matchmaking_meeting_outcomes,
  public.matchmaking_meeting_reminders,
  public.matchmaking_idempotency_keys,
  public.matchmaking_video_access_log
to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Exact public statistics contract
-- ---------------------------------------------------------------------------

create or replace function public.medichall_public_stats()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select json_build_object(
    'open_tenders',
      (
        select count(*)
        from public.tenders
        where deadline_at is not null
          and deadline_at >= now()
      ),
    'tenders',
      (select count(*) from public.tenders),
    'tender_countries',
      (
        select count(distinct country_name)
        from public.tenders
        where country_name is not null
          and country_name <> ''
          and deadline_at is not null
          and deadline_at >= now()
      ),
    'products',
      (
        select count(*)
        from public.products
        where is_active
      ),
    'manufacturers',
      (
        select count(*)
        from public.companies
        where is_approved
          and is_active
      )
  );
$function$;

revoke all on function public.medichall_public_stats()
from public;
grant execute on function public.medichall_public_stats()
to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Repository-owned pipeline metadata
-- ---------------------------------------------------------------------------
-- content_sha256, live_verification_status, and live_verified_at are retained
-- exactly as found. They describe deployed runtime evidence, not repository
-- source ownership. Only namespaced metadata keys are reconciled below.

update public.pipeline_versions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'production_compatibility_migration', '202608010002',
  'repository_entrypoint_sha256',
    '6aa03c4e1c1d16a4b9bc456681e992ed586a5c38f3db9df216043c2ff82b8907',
  'repository_shared_source_sha256',
    'a82c9ab3da43532da40f4dec1865b28b50a1ed5c002490f16ef8a8fd27245140'
)
where component = 'document_discovery'
  and version_identifier = 'document-discovery-v2.0.0'
  and is_repository_current;

update public.pipeline_versions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'production_compatibility_migration', '202608010002',
  'repository_entrypoint_sha256',
    '4ce9e0c04e81769bb25b546775a9cf3eb0aa3845b67858d5cf70f99299ce9d5e',
  'repository_shared_source_sha256',
    'a82c9ab3da43532da40f4dec1865b28b50a1ed5c002490f16ef8a8fd27245140'
)
where component = 'document_retrieval'
  and version_identifier = 'document-retrieval-v2.0.0'
  and is_repository_current;

update public.pipeline_versions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'production_compatibility_migration', '202608010002',
  'repository_shared_source_sha256',
    '4696204f734d8a37bb8cd3dc8206bb57934081685cace18657049e8009fc0f71'
)
where component = 'document_parsing'
  and version_identifier = 'document-chunking-v3.1.0'
  and is_repository_current;

update public.pipeline_versions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'production_compatibility_migration', '202608010002',
  'repository_entrypoint_sha256',
    '355fb054bf0b36f6e86e4e59426564aff1a4d9bfec6bf98b8953635f07af3459',
  'repository_handler_sha256',
    '273307c22ffe5ee7f35e7ad4ce38701d87f64b40d28d341562bc9745830b8392',
  'repository_shared_source_sha256',
    '4696204f734d8a37bb8cd3dc8206bb57934081685cace18657049e8009fc0f71',
  'repository_deno_contract_test_sha256',
    'e44c68dc7dca655350caf9e070983ee58d8fb4814a4826f9ba01dc322909395c',
  'repository_sql_contract_test_sha256',
    '0b22b810c4ee7589dade4f575080a2e324adb8e34220d598e0b61731d666e64f'
)
where component = 'ai_extraction'
  and version_identifier = 'tender-extraction-v3.1.0'
  and is_repository_current;

do $verification$
declare
  v_reconciled_count integer;
  v_function text;
  v_function_config text[];
  v_notify_source text;
  v_stats_body_sha256 text;
begin
  select count(*)
  into v_reconciled_count
  from public.pipeline_versions
  where is_repository_current
    and (component, version_identifier) in (
      ('document_discovery', 'document-discovery-v2.0.0'),
      ('document_retrieval', 'document-retrieval-v2.0.0'),
      ('document_parsing', 'document-chunking-v3.1.0'),
      ('ai_extraction', 'tender-extraction-v3.1.0')
    )
    and metadata ->> 'production_compatibility_migration' = '202608010002'
    and content_sha256 ~ '^[0-9a-f]{64}$'
    and live_verification_status is not null;

  if v_reconciled_count <> 4 then
    raise exception
      'Production compatibility metadata is incomplete: expected 4, found %',
      v_reconciled_count;
  end if;

  if pg_get_function_identity_arguments(
    'public.company_is_public(bigint)'::regprocedure
  ) <> 'p_company_id bigint' then
    raise exception 'company_is_public argument metadata was not reconciled';
  end if;

  foreach v_function in array array[
    'public.is_admin()',
    'public.company_is_public(bigint)',
    'public.set_company_slug()',
    'public.mh_email_from()',
    'public.mh_site_url()',
    'public.mh_admin_email()',
    'public.trg_rfq_created()',
    'public.trg_message_created()',
    'public.trg_offer_touch()',
    'public.trg_offer_created()',
    'public.medichall_public_stats()'
  ]
  loop
    select procedure.proconfig
    into v_function_config
    from pg_proc procedure
    where procedure.oid = v_function::regprocedure;
    if v_function_config is distinct from
      array['search_path=public, pg_temp'] then
      raise exception 'Unexpected search_path for %: %',
        v_function, v_function_config;
    end if;
  end loop;

  select procedure.prosrc
  into v_notify_source
  from pg_proc procedure
  where procedure.oid =
    'public.notify_email(text,text,text)'::regprocedure;
  if v_notify_source not like '%vault.decrypted_secrets%'
     or v_notify_source not like '%medichall_resend_api_key%'
     or v_notify_source ~ 're_[A-Za-z0-9_-]{12,}' then
    raise exception 'notify_email is not credential-safe and Vault-backed';
  end if;

  select encode(
    extensions.digest(
      regexp_replace(procedure.prosrc, E'\\s+', '', 'g'),
      'sha256'
    ),
    'hex'
  )
  into v_stats_body_sha256
  from pg_proc procedure
  where procedure.oid =
    'public.medichall_public_stats()'::regprocedure;
  if v_stats_body_sha256 <>
    '96e7484c2a0f04a8513d54874e844a03549fbe006fb1a1f4d5bb8a13b1dddbb3'
  then
    raise exception 'Unexpected normalized public stats body hash: %',
      v_stats_body_sha256;
  end if;

  if has_function_privilege(
    'anon', 'public.notify_email(text,text,text)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.notify_email(text,text,text)', 'EXECUTE'
  ) then
    raise exception 'Browser roles retain notify_email execution';
  end if;

  foreach v_function in array array[
    'public.set_company_slug()',
    'public.trg_rfq_created()',
    'public.trg_message_created()',
    'public.trg_offer_touch()',
    'public.trg_offer_created()'
  ]
  loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege(
         'authenticated', v_function, 'EXECUTE'
       ) then
      raise exception 'Browser execution remains on %', v_function;
    end if;
  end loop;

  if not has_table_privilege(
    'authenticated', 'public.matchmaking_profiles', 'INSERT'
  ) or not has_table_privilege(
    'authenticated', 'public.business_connections', 'SELECT'
  ) then
    raise exception 'Authenticated portal table privileges are incomplete';
  end if;
end
$verification$;

notify pgrst, 'reload schema';

commit;

-- Rollback: reapply this migration. It is idempotent apart from the deliberate
-- transactional function OID replacement needed to restore argument metadata.

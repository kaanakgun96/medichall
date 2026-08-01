-- Exact regression for 202608010002_production_compatibility_and_metadata.sql.
-- Read-only against production; no fixture or customer row is changed.

begin;
set transaction read only;

do $functions$
declare
  v_stats_body_sha256 text;
  v_notify_source text;
  v_config text[];
  v_signature text;
  v_function text;
begin
  select pg_get_function_identity_arguments(procedure.oid)
  into v_signature
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'company_is_public';

  if v_signature <> 'p_company_id bigint' then
    raise exception 'Unexpected company_is_public identity arguments: %',
      v_signature;
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
    into v_config
    from pg_proc procedure
    where procedure.oid = v_function::regprocedure;
    if v_config is distinct from array['search_path=public, pg_temp'] then
      raise exception 'Unexpected search_path for %: %', v_function, v_config;
    end if;
  end loop;

  select procedure.proconfig, procedure.prosrc
  into v_config, v_notify_source
  from pg_proc procedure
  where procedure.oid = 'public.notify_email(text,text,text)'::regprocedure;
  if v_config is distinct from
    array['search_path=public, extensions, vault, pg_temp'] then
    raise exception 'Unexpected notify_email search_path: %', v_config;
  end if;
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
  where procedure.oid = 'public.medichall_public_stats()'::regprocedure;
  if v_stats_body_sha256 <>
    '96e7484c2a0f04a8513d54874e844a03549fbe006fb1a1f4d5bb8a13b1dddbb3'
  then
    raise exception 'Unexpected normalized public stats body hash: %',
      v_stats_body_sha256;
  end if;

  if has_function_privilege(
    'anon', 'public.notify_email(text,text,text)', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.notify_email(text,text,text)', 'execute'
  ) or not has_function_privilege(
    'service_role', 'public.notify_email(text,text,text)', 'execute'
  ) then
    raise exception 'notify_email grants do not match the server-only contract';
  end if;

  foreach v_function in array array[
    'public.set_company_slug()',
    'public.trg_rfq_created()',
    'public.trg_message_created()',
    'public.trg_offer_touch()',
    'public.trg_offer_created()'
  ]
  loop
    if has_function_privilege('anon', v_function, 'execute')
       or has_function_privilege('authenticated', v_function, 'execute') then
      raise exception 'Browser execution remains on %', v_function;
    end if;
  end loop;

  foreach v_function in array array[
    'public.is_admin()',
    'public.company_is_public(bigint)',
    'public.medichall_public_stats()'
  ]
  loop
    if not has_function_privilege('anon', v_function, 'execute')
       or not has_function_privilege('authenticated', v_function, 'execute')
       or not has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'Intended portal execution is missing on %', v_function;
    end if;
  end loop;
end
$functions$;

do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname = 'public read products'
      and qual like '%company_is_public(company_id)%'
  ) then
    raise exception 'Product visibility policy was not restored';
  end if;

  if not has_table_privilege(
    'authenticated', 'public.matchmaking_profiles', 'select,insert,update'
  ) or not has_table_privilege(
    'authenticated', 'public.matchmaking_matches', 'select'
  ) or not has_table_privilege(
    'authenticated', 'public.business_connections', 'select'
  ) or not has_table_privilege(
    'authenticated', 'public.matchmaking_meeting_requests', 'select'
  ) then
    raise exception 'Authenticated portal table privileges are incomplete';
  end if;

  if has_table_privilege(
    'anon', 'public.matchmaking_meeting_events', 'select'
  ) or has_table_privilege(
    'authenticated', 'public.matchmaking_video_access_log', 'select'
  ) then
    raise exception 'A restricted matchmaking table is browser-readable';
  end if;
end
$policy$;

do $metadata$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.pipeline_versions
  where is_repository_current
    and (component, version_identifier) in (
      ('document_discovery', 'document-discovery-v2.0.0'),
      ('document_retrieval', 'document-retrieval-v2.0.0'),
      ('document_parsing', 'document-chunking-v3.1.0'),
      ('ai_extraction', 'tender-extraction-v3.1.0')
    )
    and metadata ->> 'production_compatibility_migration' = '202608010002'
    and metadata ->> 'repository_shared_source_sha256'
      ~ '^[0-9a-f]{64}$'
    and content_sha256 ~ '^[0-9a-f]{64}$'
    and live_verification_status is not null;

  if v_count <> 4 then
    raise exception 'Expected four valid compatibility metadata rows, found %',
      v_count;
  end if;
end
$metadata$;

rollback;

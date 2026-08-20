-- Rollback-only regression for 202608200004_external_registry_coverage.sql.
begin;

do $structure$
begin
  if to_regclass('public.external_registry_request_cache') is null then
    raise exception 'Registry response cache is missing';
  end if;
  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.external_registry_request_cache'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then
    raise exception 'Registry cache RLS is not enabled and forced';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'external_company_activities'
      and column_name = 'mapping_confidence'
      and is_nullable = 'NO'
  ) then
    raise exception 'Activity mapping confidence is missing or nullable';
  end if;
  if has_table_privilege('anon', 'public.external_registry_request_cache',
      'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.external_registry_request_cache',
      'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Browser role has raw registry cache access';
  end if;
  if not has_table_privilege('service_role',
      'public.external_registry_request_cache', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Service role lacks registry cache access';
  end if;
  if has_function_privilege('anon',
      'public.get_admin_external_prospect_metrics_v1()', 'EXECUTE') then
    raise exception 'Anonymous role can execute admin registry metrics';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('external_registry_request_cache', 'external_company_activities')
      and column_name in (
        'contact_email', 'email', 'phone', 'contact_name', 'linkedin_url',
        'director', 'officer', 'employee'
      )
  ) then
    raise exception 'Registry coverage schema contains a prohibited personal-contact field';
  end if;
end
$structure$;

insert into public.external_registry_request_cache(
  provider_code, request_key_hash, country_code, source_url,
  normalized_candidates, fetch_status, fetched_at, expires_at
) values (
  'PL_KRS_OPEN_API', repeat('a', 64), 'PL',
  'https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000000000?rejestr=P&format=json',
  '[{"name":"QA Legal Entity SA","activity":{"nationalCode":"46.46.Z"}}]'::jsonb,
  'ACTIVE', now(), now() + interval '180 days'
);

update public.external_registry_request_cache
set hit_count = hit_count + 1, last_hit_at = now()
where provider_code = 'PL_KRS_OPEN_API' and request_key_hash = repeat('a', 64);

do $cache_behavior$
declare
  v_hits integer;
begin
  select hit_count into v_hits
  from public.external_registry_request_cache
  where provider_code = 'PL_KRS_OPEN_API'
    and request_key_hash = repeat('a', 64);
  if v_hits <> 1 then raise exception 'Registry cache hit accounting failed'; end if;

  begin
    insert into public.external_registry_request_cache(
      provider_code, request_key_hash, country_code, source_url,
      normalized_candidates, fetch_status, fetched_at, expires_at
    ) values (
      'PL_KRS_OPEN_API', repeat('b', 64), 'PL', 'https://example.invalid/registry',
      '[{"name":"QA Entity","email":"private@example.invalid"}]'::jsonb,
      'ACTIVE', now(), now() + interval '1 day'
    );
    raise exception 'Registry cache accepted a contact field';
  exception when check_violation then null;
  end;
end
$cache_behavior$;

set local role anon;
do $anonymous_denial$
begin
  begin
    perform count(*) from public.external_registry_request_cache;
    raise exception 'Anonymous cache select succeeded';
  exception when insufficient_privilege then null;
  end;
end
$anonymous_denial$;
reset role;

set local role authenticated;
do $authenticated_denial$
begin
  begin
    update public.external_registry_request_cache set hit_count = hit_count + 1;
    raise exception 'Authenticated cache update succeeded';
  exception when insufficient_privilege then null;
  end;
end
$authenticated_denial$;
reset role;

rollback;

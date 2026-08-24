-- Rollback-only security regression for 202608240002.
begin;

do $structure$
begin
  if to_regclass('public.external_public_web_request_cache') is null then
    raise exception 'Public-web cache is missing';
  end if;
  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.external_public_web_request_cache'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'Public-web cache RLS is not enabled and forced'; end if;
  if has_table_privilege('anon', 'public.external_public_web_request_cache',
      'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.external_public_web_request_cache',
      'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Browser role has raw public-web cache access';
  end if;
  if not has_table_privilege('service_role',
      'public.external_public_web_request_cache', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Service role lacks public-web cache access';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'external_public_web_request_cache'
      and column_name in (
        'raw_query','snippet','description','contact_email','email','phone',
        'contact_name','linkedin_url','raw_response','api_key'
      )
  ) then raise exception 'Public-web cache contains a prohibited field'; end if;
  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.external_prospect_discovery_runs'::regclass
      and constraint_row.conname = 'external_prospect_runs_provider_requests_bounded_check'
      and pg_get_constraintdef(constraint_row.oid) ~ 'provider_requests.*>= 0'
      and pg_get_constraintdef(constraint_row.oid) ~ 'provider_requests.*<= 6'
  ) then raise exception 'Provider request bound is missing'; end if;
end
$structure$;

insert into public.external_public_web_request_cache(
  provider_code, request_key_hash, product_family_key, country_code,
  search_language, query_variant, normalized_candidates, fetch_status,
  fetched_at, expires_at
) values (
  'BRAVE_SEARCH_API', repeat('a',64), 'sterile-equipment-cover-family',
  'IT', 'it', 0,
  '[{"name":"QA Medical SRL","pageUrl":"https://qa-medical.example.invalid/camera-covers","canonicalDomain":"qa-medical.example.invalid","countryCode":"IT"}]'::jsonb,
  'ACTIVE', now(), now() + interval '14 days'
);

update public.external_public_web_request_cache
set hit_count = hit_count + 1, last_hit_at = now()
where provider_code = 'BRAVE_SEARCH_API' and request_key_hash = repeat('a',64);

do $bounds_and_privacy$
declare
  v_hits integer;
begin
  select hit_count into v_hits from public.external_public_web_request_cache
  where provider_code = 'BRAVE_SEARCH_API' and request_key_hash = repeat('a',64);
  if v_hits <> 1 then raise exception 'Public-web cache hit accounting failed'; end if;

  begin
    insert into public.external_public_web_request_cache(
      provider_code, request_key_hash, product_family_key, country_code,
      search_language, query_variant, normalized_candidates, fetch_status,
      fetched_at, expires_at
    ) values (
      'BRAVE_SEARCH_API', repeat('b',64), 'sterile-equipment-cover-family',
      'FR', 'fr', 1,
      '[{"name":"QA Entity","email":"private@example.invalid"}]'::jsonb,
      'ACTIVE', now(), now() + interval '14 days'
    );
    raise exception 'Public-web cache accepted a contact field';
  exception when check_violation then null;
  end;

end
$bounds_and_privacy$;

set local role anon;
do $anonymous_denial$
begin
  begin
    perform count(*) from public.external_public_web_request_cache;
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
    update public.external_public_web_request_cache set hit_count=hit_count+1;
    raise exception 'Authenticated cache update succeeded';
  exception when insufficient_privilege then null;
  end;
end
$authenticated_denial$;
reset role;

rollback;

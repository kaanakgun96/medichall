begin;

do $test$
declare
  function_definition text;
  run_mode_check text;
begin
  if to_regclass('public.buyer_discovery_search_spaces') is null
     or to_regclass('public.buyer_discovery_partitions') is null
     or to_regclass('public.buyer_discovery_seen_companies') is null
     or to_regclass('public.buyer_discovery_run_partitions') is null then
    raise exception 'vNext search-space persistence is incomplete';
  end if;
  if to_regprocedure('public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text)') is null
     or to_regprocedure('public.get_external_prospect_workspace_v3(bigint,integer)') is null
     or to_regprocedure('public.accept_buyer_discovery_execution_v1(uuid)') is null then
    raise exception 'vNext callable contract is incomplete';
  end if;
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.buyer_discovery_search_spaces'::regclass)
     or not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.buyer_discovery_partitions'::regclass)
     or not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.buyer_discovery_seen_companies'::regclass)
     or not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.buyer_discovery_run_partitions'::regclass) then
    raise exception 'row_security_active/forced regression';
  end if;
  if has_table_privilege('anon', 'public.buyer_discovery_search_spaces', 'SELECT')
     or has_table_privilege('anon', 'public.buyer_discovery_partitions', 'SELECT')
     or has_table_privilege('anon', 'public.buyer_discovery_seen_companies', 'SELECT')
     or has_table_privilege('anon', 'public.buyer_discovery_run_partitions', 'SELECT') then
    raise exception 'anonymous search-history access must remain denied';
  end if;
  if has_table_privilege('authenticated', 'public.buyer_discovery_search_spaces', 'INSERT')
     or has_table_privilege('authenticated', 'public.buyer_discovery_partitions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.buyer_discovery_seen_companies', 'DELETE')
     or has_table_privilege('authenticated', 'public.buyer_discovery_run_partitions', 'INSERT') then
    raise exception 'anon mutation must remain denied and authenticated mutation must be service-only';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated discovery execute grant is missing';
  end if;
  if has_function_privilege(
    'authenticated', 'public.accept_buyer_discovery_execution_v1(uuid)', 'EXECUTE'
  ) or not has_function_privilege(
    'service_role', 'public.accept_buyer_discovery_execution_v1(uuid)', 'EXECUTE'
  ) then
    raise exception 'provider execution acceptance must remain service-only';
  end if;
  select pg_get_functiondef(
    'public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text)'::regprocedure
  ) into function_definition;
  if function_definition !~ 'cached_intent_14_days'
     or function_definition !~ 'public.is_admin\(\)'
     or function_definition !~ 'v_admin_daily >= 50'
     or function_definition !~ 'Customer Fresh Discovery is feature-gated'
     or function_definition !~ 'Product resolution event is unavailable'
     or function_definition !~ 'active manufacturer match profile'
     or function_definition !~ 'pg_advisory_xact_lock' then
    raise exception 'normal cache, admin authorization/cap or concurrency contract regressed';
  end if;
  select pg_get_constraintdef(oid) into run_mode_check
  from pg_constraint
  where conrelid = 'public.external_prospect_discovery_runs'::regclass
    and pg_get_constraintdef(oid) like '%ADMIN_QA_FRESH%';
  if run_mode_check is null then
    raise exception 'explicit discovery run modes are not constrained';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'buyer_discovery_search_spaces', 'buyer_discovery_partitions',
        'buyer_discovery_seen_companies', 'buyer_discovery_run_partitions'
      )
      and column_name ~* '(email|phone|contact|whatsapp|linkedin)'
  ) then
    raise exception 'contact collection entered search-space persistence';
  end if;
end
$test$;

create temporary table buyer_discovery_vnext_fixtures(
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  initial_run_id uuid,
  fresh_run_id uuid,
  search_space_id uuid
) on commit drop;

insert into buyer_discovery_vnext_fixtures(ordinal, user_id) values
  (1, gen_random_uuid()), (2, gen_random_uuid());

insert into auth.users(
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select user_id, 'authenticated', 'authenticated',
  'buyer-vnext-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), false, false
from buyer_discovery_vnext_fixtures;

with inserted as (
  insert into public.companies(
    owner_id, name, type, website, country, is_approved, is_active
  )
  select user_id, 'Buyer vNext Tenant ' || ordinal,
    'Medical device manufacturer',
    'https://buyer-vnext-' || ordinal || '.example.invalid',
    'Türkiye', false, true
  from buyer_discovery_vnext_fixtures
  returning id, owner_id
)
update buyer_discovery_vnext_fixtures fixture
set company_id = inserted.id
from inserted where inserted.owner_id = fixture.user_id;

insert into public.matchmaking_profiles(
  user_id, company_id, role, display_name, country, target_countries,
  partner_types_sought, profile_completeness, is_active
)
select user_id, company_id, 'manufacturer',
  'Buyer vNext manufacturer ' || ordinal, 'Türkiye', array['France'],
  array['distributor','importer'], 80, true
from buyer_discovery_vnext_fixtures;

insert into public.buyer_discovery_search_spaces(company_id, intent_hash)
select company_id, repeat('b', 64)
from buyer_discovery_vnext_fixtures where ordinal = 2;

grant all on buyer_discovery_vnext_fixtures to authenticated, service_role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from buyer_discovery_vnext_fixtures where ordinal = 1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $tenant_and_cache$
declare
  v_company bigint := (
    select company_id from buyer_discovery_vnext_fixtures where ordinal = 1
  );
  v_other bigint := (
    select company_id from buyer_discovery_vnext_fixtures where ordinal = 2
  );
  v_taxonomy bigint := (
    select id from public.medical_product_taxonomy
    where is_active and node_type <> 'family' order by id limit 1
  );
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
begin
  v_first := public.start_external_prospect_discovery_v3(
    v_company, v_key,
    jsonb_build_object(
      'intent_source', 'AD_HOC_PRODUCT',
      'taxonomy_ids', jsonb_build_array(v_taxonomy),
      'target_countries', jsonb_build_array('FR')
    ), 'NORMAL_DISCOVERY'
  );
  v_retry := public.start_external_prospect_discovery_v3(
    v_company, v_key,
    jsonb_build_object(
      'intent_source', 'AD_HOC_PRODUCT',
      'taxonomy_ids', jsonb_build_array(v_taxonomy),
      'target_countries', jsonb_build_array('FR')
    ), 'NORMAL_DISCOVERY'
  );
  if (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or v_first->>'run_id' <> v_retry->>'run_id'
     or v_first->>'search_space_id' is null then
    raise exception 'normal creation/idempotency/search-space linkage failed';
  end if;
  if (select count(*) from public.buyer_discovery_search_spaces
      where company_id = v_other) <> 0 then
    raise exception 'cross-company search-space RLS isolation failed';
  end if;
  begin
    perform public.start_external_prospect_discovery_v3(
      v_company, gen_random_uuid(),
      jsonb_build_object(
        'intent_source', 'AD_HOC_PRODUCT',
        'taxonomy_ids', jsonb_build_array(v_taxonomy),
        'target_countries', jsonb_build_array('FR')
      ), 'FRESH_DISCOVERY'
    );
    raise exception 'ordinary customer bypassed the Fresh feature gate';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.start_external_prospect_discovery_v3(
      v_other, gen_random_uuid(),
      jsonb_build_object(
        'intent_source', 'AD_HOC_PRODUCT',
        'taxonomy_ids', jsonb_build_array(v_taxonomy),
        'target_countries', jsonb_build_array('FR')
      ), 'NORMAL_DISCOVERY'
    );
    raise exception 'cross-company discovery start succeeded';
  exception when insufficient_privilege then null;
  end;
  update buyer_discovery_vnext_fixtures
  set initial_run_id = (v_first->>'run_id')::uuid,
      search_space_id = (v_first->>'search_space_id')::uuid
  where ordinal = 1;
end
$tenant_and_cache$;
reset role;

insert into public.admins(user_id)
select user_id from buyer_discovery_vnext_fixtures where ordinal = 1;

set local role authenticated;
do $admin_fresh$
declare
  v_company bigint := (
    select company_id from buyer_discovery_vnext_fixtures where ordinal = 1
  );
  v_taxonomy bigint := (
    select id from public.medical_product_taxonomy
    where is_active and node_type <> 'family' order by id limit 1
  );
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
  v_active jsonb;
begin
  v_first := public.start_external_prospect_discovery_v3(
    v_company, v_key,
    jsonb_build_object(
      'intent_source', 'AD_HOC_PRODUCT',
      'taxonomy_ids', jsonb_build_array(v_taxonomy),
      'target_countries', jsonb_build_array('FR')
    ), 'ADMIN_QA_FRESH'
  );
  v_retry := public.start_external_prospect_discovery_v3(
    v_company, v_key,
    jsonb_build_object(
      'intent_source', 'AD_HOC_PRODUCT',
      'taxonomy_ids', jsonb_build_array(v_taxonomy),
      'target_countries', jsonb_build_array('FR')
    ), 'ADMIN_QA_FRESH'
  );
  v_active := public.start_external_prospect_discovery_v3(
    v_company, gen_random_uuid(),
    jsonb_build_object(
      'intent_source', 'AD_HOC_PRODUCT',
      'taxonomy_ids', jsonb_build_array(v_taxonomy),
      'target_countries', jsonb_build_array('FR')
    ), 'ADMIN_QA_FRESH'
  );
  if (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or not (v_active->>'reused')::boolean
     or v_first->>'run_id' <> v_retry->>'run_id'
     or v_first->>'run_id' <> v_active->>'run_id'
     or v_first->>'credit_disposition' <> 'WAIVED_ADMIN_QA' then
    raise exception 'admin Fresh idempotency/active-run/waiver semantics failed';
  end if;
  update buyer_discovery_vnext_fixtures
  set fresh_run_id = (v_first->>'run_id')::uuid
  where ordinal = 1;
end
$admin_fresh$;
reset role;

do $execution_fixture$
declare
  v_partition_id bigint;
begin
  insert into public.buyer_discovery_partitions(
    search_space_id, partition_key, provider_kind, partition_type,
    terminology, language_code, country_codes, market_region,
    buyer_archetype, retrieval_kind, priority
  ) values (
    (select search_space_id from buyer_discovery_vnext_fixtures where ordinal = 1),
    'web|qa-medical|fr|distributor', 'PUBLIC_WEB', 'COMMERCIAL_WEB',
    '["qa medical product"]'::jsonb, 'fr', array['FR'], 'WESTERN_EUROPE',
    'DISTRIBUTOR', 'DIRECT_TERMS', 100
  ) returning id into v_partition_id;
  insert into public.buyer_discovery_run_partitions(
    run_id, partition_id, ordinal, novelty
  ) values (
    (select fresh_run_id from buyer_discovery_vnext_fixtures where ordinal = 1),
    v_partition_id, 0, 'NEW_PARTITION'
  );
end
$execution_fixture$;

set local role authenticated;
do $execution_role_denial$
begin
  begin
    perform public.accept_buyer_discovery_execution_v1(
      (select fresh_run_id from buyer_discovery_vnext_fixtures where ordinal = 1)
    );
    raise exception 'authenticated role accepted provider execution';
  exception when insufficient_privilege then null;
  end;
end
$execution_role_denial$;
reset role;

set local role service_role;
do $execution_acceptance$
declare
  v_first jsonb;
  v_retry jsonb;
begin
  v_first := public.accept_buyer_discovery_execution_v1(
    (select fresh_run_id from buyer_discovery_vnext_fixtures where ordinal = 1)
  );
  v_retry := public.accept_buyer_discovery_execution_v1(
    (select fresh_run_id from buyer_discovery_vnext_fixtures where ordinal = 1)
  );
  if not (v_first->>'accepted')::boolean
     or (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or v_first->>'credit_disposition' <> 'WAIVED_ADMIN_QA' then
    raise exception 'transaction-safe provider execution acceptance failed';
  end if;
end
$execution_acceptance$;
reset role;

rollback;

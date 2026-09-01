-- Rollback-only SQL/RLS regression for Adaptive Medical Commercial Retrieval V1.
begin;

create temporary table adaptive_retrieval_flag_baseline as
select
  (select smart_resolver_enabled
   from public.smart_product_resolver_feature_state where singleton)
    as smart_resolver_enabled,
  (select customer_fresh_enabled
   from public.buyer_discovery_credit_feature_state where singleton)
    as customer_fresh_enabled;

do $structure$
begin
  if to_regclass('public.adaptive_medical_retrieval_feature_state') is null
     or to_regclass('public.adaptive_medical_retrieval_cache') is null
     or to_regprocedure(
       'public.reserve_adaptive_medical_retrieval_v1(text,text,text,text,text)'
     ) is null
     or to_regprocedure(
       'public.complete_adaptive_medical_retrieval_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer)'
     ) is null
     or to_regprocedure(
       'public.fail_adaptive_medical_retrieval_v1(uuid,text)'
     ) is null then
    raise exception 'Adaptive retrieval database contract is incomplete';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
      where oid='public.adaptive_medical_retrieval_feature_state'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class
      where oid='public.adaptive_medical_retrieval_cache'::regclass) then
    raise exception 'Adaptive retrieval RLS must be enabled and forced';
  end if;
  if (select adaptive_medical_commercial_retrieval_enabled
      from public.adaptive_medical_retrieval_feature_state where singleton) then
    raise exception 'Adaptive retrieval must default disabled';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='adaptive_medical_retrieval_cache'
      and column_name ~* '(company|tenant|user|email|phone|contact|message|prompt|url)'
  ) then
    raise exception 'Tenant/private fields entered global adaptive cache';
  end if;
  if has_table_privilege('anon','public.adaptive_medical_retrieval_cache',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated','public.adaptive_medical_retrieval_cache',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role','public.adaptive_medical_retrieval_cache',
       'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('service_role',
       'public.adaptive_medical_retrieval_cache','SELECT') then
    raise exception 'Adaptive retrieval table privileges are unsafe';
  end if;
  if has_function_privilege('anon',
       'public.reserve_adaptive_medical_retrieval_v1(text,text,text,text,text)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.complete_adaptive_medical_retrieval_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer)',
       'EXECUTE')
     or not has_function_privilege('service_role',
       'public.fail_adaptive_medical_retrieval_v1(uuid,text)','EXECUTE') then
    raise exception 'Adaptive retrieval service boundary regressed';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.external_prospect_discovery_runs'::regclass
      and conname='external_prospect_discovery_runs_provider_requests_check'
      and pg_get_constraintdef(oid) like '%17%'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid='public.external_prospect_discovery_runs'::regclass
      and conname='external_prospect_discovery_runs_estimated_cost_usd_check'
      and pg_get_constraintdef(oid) like '%0.155000%'
  ) then
    raise exception 'Bounded adaptive request/cost observability constraints are missing';
  end if;
end
$structure$;

select set_config('request.jwt.claims',
  jsonb_build_object('role','service_role')::text,true);
set local role service_role;

do $disabled$
declare
  v_disabled jsonb;
begin
  v_disabled := public.reserve_adaptive_medical_retrieval_v1(
    repeat('a',64),'diagnostic imaging injector','diagnostic imaging equipment',
    'SMART_PRODUCT_RESOLVER_V1',
    'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V1'
  );
  if v_disabled->>'decision' <> 'DISABLED'
     or exists (select 1 from public.adaptive_medical_retrieval_cache) then
    raise exception 'Disabled adaptive retrieval created a cache row';
  end if;
end
$disabled$;

reset role;
update public.adaptive_medical_retrieval_feature_state
set adaptive_medical_commercial_retrieval_enabled=true where singleton;
set local role service_role;

do $cache$
declare
  v_reserved jsonb;
  v_completed jsonb;
  v_cached jsonb;
  v_invalid_failed boolean := false;
  v_result jsonb := jsonb_build_object(
    'canonical_product','diagnostic imaging injector',
    'product_family','diagnostic imaging equipment',
    'commercial_synonyms',jsonb_build_array('diagnostic imaging injector'),
    'clinical_contexts',jsonb_build_array('contrast imaging procedure'),
    'procurement_terms',jsonb_build_array('diagnostic injector system'),
    'channel_archetypes',jsonb_build_array('imaging equipment distributor'),
    'adjacent_commercial_terms',jsonb_build_array('contrast delivery equipment'),
    'negative_contexts',jsonb_build_array('industrial injector'),
    'localized_terms','[]'::jsonb,
    'search_confidence','HIGH'
  );
begin
  v_reserved := public.reserve_adaptive_medical_retrieval_v1(
    repeat('a',64),'diagnostic imaging injector','diagnostic imaging equipment',
    'SMART_PRODUCT_RESOLVER_V1',
    'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V1'
  );
  if v_reserved->>'decision' <> 'PROCEED' then
    raise exception 'Adaptive retrieval reservation did not proceed: %',v_reserved;
  end if;
  v_completed := public.complete_adaptive_medical_retrieval_v1(
    (v_reserved->>'cache_id')::uuid,v_result,'claude-haiku-4-5',
    'qa-provider-redacted',300,120,420,0.000900,180
  );
  if v_completed->>'status' <> 'COMPLETED' then
    raise exception 'Adaptive retrieval completion failed';
  end if;
  v_cached := public.reserve_adaptive_medical_retrieval_v1(
    repeat('a',64),'diagnostic imaging injector','diagnostic imaging equipment',
    'SMART_PRODUCT_RESOLVER_V1',
    'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V1'
  );
  if v_cached->>'decision' <> 'CACHED'
     or v_cached->>'cache_id' <> v_reserved->>'cache_id'
     or (select count(*) from public.adaptive_medical_retrieval_cache) <> 1 then
    raise exception 'Adaptive retrieval cache reuse failed';
  end if;
  begin
    perform public.reserve_adaptive_medical_retrieval_v1(
      repeat('b',64),'diagnostic imaging injector','diagnostic imaging equipment',
      'SMART_PRODUCT_RESOLVER_V1',
      'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V2'
    );
  exception when invalid_parameter_value then
    v_invalid_failed := true;
  end;
  if not v_invalid_failed then
    raise exception 'Retrieval-version cache invalidation contract failed';
  end if;
end
$cache$;

reset role;

do $flag_regressions$
begin
  if (select smart_resolver_enabled
      from public.smart_product_resolver_feature_state where singleton)
       is distinct from
       (select smart_resolver_enabled from adaptive_retrieval_flag_baseline)
     or (select customer_fresh_enabled
      from public.buyer_discovery_credit_feature_state where singleton)
       is distinct from
       (select customer_fresh_enabled from adaptive_retrieval_flag_baseline) then
    raise exception 'Existing feature flags changed during adaptive regression';
  end if;
end
$flag_regressions$;

rollback;

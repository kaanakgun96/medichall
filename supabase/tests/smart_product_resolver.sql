-- Rollback-only SQL/RLS regression for Smart Product Resolver V1.
begin;

do $structure$
begin
  if to_regclass('public.smart_product_resolver_feature_state') is null
     or to_regclass('public.smart_product_resolution_cache') is null
     or to_regprocedure('public.reserve_smart_product_resolution_v1(bigint,uuid,text,text,text)') is null
     or to_regprocedure('public.complete_smart_product_resolution_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer)') is null
     or to_regprocedure('public.record_smart_product_resolution_event_v1(bigint,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.record_product_resolution_event_v1(bigint,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public.confirm_smart_product_resolution_option_v1(bigint,uuid,uuid,integer)') is null
     or to_regprocedure('public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb)') is null then
    raise exception 'Smart Product Resolver database contract is incomplete';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
      where oid='public.smart_product_resolution_cache'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class
      where oid='public.smart_product_resolver_feature_state'::regclass) then
    raise exception 'Smart Resolver RLS must be enabled and forced';
  end if;
  if (select smart_resolver_enabled from public.smart_product_resolver_feature_state
      where singleton) then
    raise exception 'Smart Resolver feature flag must default false';
  end if;
  if (select customer_fresh_enabled from public.buyer_discovery_credit_feature_state
      where singleton) then
    raise exception 'Customer Fresh must remain disabled';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name in ('smart_product_resolution_cache','product_resolution_events')
      and column_name ~* '(email|phone|contact|message|whatsapp|linkedin|prompt)'
  ) then raise exception 'Private/contact/model-prompt fields entered resolver persistence'; end if;
  if has_table_privilege('anon','public.smart_product_resolution_cache','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.smart_product_resolution_cache','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role','public.smart_product_resolution_cache','INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('service_role','public.smart_product_resolution_cache','SELECT') then
    raise exception 'Smart Resolver cache privileges are unsafe';
  end if;
  if has_function_privilege('anon',
       'public.reserve_smart_product_resolution_v1(bigint,uuid,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.complete_smart_product_resolution_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer)','EXECUTE')
     or not has_function_privilege('service_role',
       'public.record_smart_product_resolution_event_v1(bigint,uuid,uuid,uuid,text)','EXECUTE') then
    raise exception 'Smart Resolver service boundary regressed';
  end if;
end
$structure$;

create temporary table smart_resolver_tenants(
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint
) on commit drop;
grant select on smart_resolver_tenants to authenticated, service_role;
insert into smart_resolver_tenants(ordinal,user_id)
values (1,gen_random_uuid()),(2,gen_random_uuid());

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
select user_id,'authenticated','authenticated',
  'smart-resolver-'||ordinal||'@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now(),false,false from smart_resolver_tenants;

with inserted as (
  insert into public.companies(
    owner_id,name,type,website,country,is_approved,is_active
  )
  select user_id,'Smart Resolver Tenant '||ordinal,
    'Medical device manufacturer',
    'https://smart-resolver-'||ordinal||'.example.invalid',
    'Türkiye',false,true
  from smart_resolver_tenants returning id,owner_id
)
update smart_resolver_tenants fixture set company_id=inserted.id
from inserted where inserted.owner_id=fixture.user_id;

select set_config('request.jwt.claims',
  jsonb_build_object('role','service_role')::text,true);
set local role service_role;
do $disabled_feature_gate$
declare
  v_company bigint := (select company_id from smart_resolver_tenants where ordinal=1);
  v_user uuid := (select user_id from smart_resolver_tenants where ordinal=1);
  v_reserved jsonb;
begin
  v_reserved := public.reserve_smart_product_resolution_v1(
    v_company,v_user,'abdominal mesh','en','SMART_PRODUCT_RESOLVER_V1'
  );
  if v_reserved->>'decision' <> 'DISABLED'
     or v_reserved->>'resolver_version' <> 'SMART_PRODUCT_RESOLVER_V1'
     or exists (
       select 1 from public.smart_product_resolution_cache
       where company_id=v_company and normalized_phrase='abdominal mesh'
     ) then
    raise exception 'Disabled resolver created a reservation or cache row';
  end if;
end
$disabled_feature_gate$;
reset role;

-- This update represents an explicit deployment/rollout action. It rolls back.
update public.smart_product_resolver_feature_state
set smart_resolver_enabled=true where singleton;

select set_config('request.jwt.claims',
  jsonb_build_object('role','service_role')::text,true);
set local role service_role;

do $service_cache_and_idempotency$
declare
  v_company bigint := (select company_id from smart_resolver_tenants where ordinal=1);
  v_other bigint := (select company_id from smart_resolver_tenants where ordinal=2);
  v_user uuid := (select user_id from smart_resolver_tenants where ordinal=1);
  v_key uuid := gen_random_uuid();
  v_reserved jsonb;
  v_completed jsonb;
  v_cached jsonb;
  v_event jsonb;
  v_result jsonb := jsonb_build_object(
    'is_medical_product',true,'confidence','HIGH','ambiguity','NONE',
    'input_language','en','canonical_concept','Abdominal wall surgical mesh',
    'product_family','Surgical mesh','suggested_taxonomy_ids','[]'::jsonb,
    'suggested_labels','[]'::jsonb,
    'commercial_terms_en',jsonb_build_array('Abdominal wall mesh','Hernia repair mesh'),
    'clarification_options','[]'::jsonb,
    'reason_code','TEMPORARY_MEDICAL_INTENT'
  );
begin
  v_reserved := public.reserve_smart_product_resolution_v1(
    v_company,v_user,'abdominal mesh','en','SMART_PRODUCT_RESOLVER_V1'
  );
  if v_reserved->>'decision' <> 'PROCEED' then
    raise exception 'First resolver reservation did not proceed: %',v_reserved;
  end if;
  v_completed := public.complete_smart_product_resolution_v1(
    (v_reserved->>'cache_id')::uuid,v_result,'claude-haiku-4-5','qa-provider-id',
    300,100,400,0.000800,240
  );
  if v_completed->>'status' <> 'COMPLETED' then
    raise exception 'Resolver cache completion failed';
  end if;
  v_cached := public.reserve_smart_product_resolution_v1(
    v_company,v_user,'abdominal mesh','en','SMART_PRODUCT_RESOLVER_V1'
  );
  if v_cached->>'decision' <> 'CACHED'
     or v_cached->>'cache_id' <> v_reserved->>'cache_id'
     or (select count(*) from public.smart_product_resolution_cache
       where company_id=v_company and normalized_phrase='abdominal mesh') <> 1 then
    raise exception 'Normalized cache/idempotency reuse failed';
  end if;
  v_event := public.record_smart_product_resolution_event_v1(
    v_company,v_user,v_key,(v_reserved->>'cache_id')::uuid,'AI'
  );
  perform public.record_smart_product_resolution_event_v1(
    v_company,v_user,v_key,(v_reserved->>'cache_id')::uuid,'AI'
  );
  if (select count(*) from public.product_resolution_events
      where company_id=v_company and idempotency_key=v_key) <> 1 then
    raise exception 'Resolver event idempotency failed';
  end if;
  begin
    perform public.reserve_smart_product_resolution_v1(
      v_other,v_user,'abdominal mesh','en','SMART_PRODUCT_RESOLVER_V1'
    );
    raise exception 'Cross-company resolver reservation succeeded';
  exception when insufficient_privilege then null;
  end;
end
$service_cache_and_idempotency$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select user_id from smart_resolver_tenants where ordinal=1),
  'role','authenticated')::text,true);
set local role authenticated;
do $tenant_visibility$
declare
  v_company bigint := (select company_id from smart_resolver_tenants where ordinal=1);
  v_other bigint := (select company_id from smart_resolver_tenants where ordinal=2);
  v_key uuid := gen_random_uuid();
  v_phrase text := public.normalize_unknown_product_phrase_v1('Camera Cover');
  v_event jsonb;
begin
  v_event := public.record_product_resolution_event_v1(
    v_company,
    v_key,
    v_phrase,
    public.unknown_product_phrase_signature_v1(v_phrase),
    'EXACT_APPROVED',
    '[]'::jsonb
  );
  if v_event->>'resolution_status' <> 'EXACT_APPROVED'
     or not exists (
       select 1 from public.product_resolution_events
       where company_id=v_company and idempotency_key=v_key
         and normalized_phrase=v_phrase
         and input_normalized_phrase=v_phrase
         and resolver_type='DETERMINISTIC'
         and resolver_version='DETERMINISTIC_V2'
         and confidence_label='HIGH'
         and medical_product_confirmed
         and user_decision='NOT_REQUIRED'
     ) then
    raise exception 'Deterministic resolver event is incompatible with Smart Resolver metadata';
  end if;
  if (select count(*) from public.product_resolution_events where company_id=v_company) <> 2
     or exists (select 1 from public.product_resolution_events where company_id=v_other) then
    raise exception 'Tenant-scoped resolver history visibility failed';
  end if;
  begin
    perform count(*) from public.smart_product_resolution_cache;
    raise exception 'Authenticated direct cache read succeeded';
  exception when insufficient_privilege then null;
  end;
end
$tenant_visibility$;
reset role;

do $final_invariants$
begin
  if exists (
    select 1 from public.medical_product_aliases
    where normalized_alias='abdominal mesh'
  ) then raise exception 'Smart result auto-published a global alias'; end if;
  if (select customer_fresh_enabled from public.buyer_discovery_credit_feature_state
      where singleton) then
    raise exception 'Resolver QA activated customer Fresh';
  end if;
end
$final_invariants$;

rollback;

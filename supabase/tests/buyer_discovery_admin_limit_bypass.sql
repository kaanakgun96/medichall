begin;

do $contract$
declare
  v_helper text;
  v_standard text;
  v_smart text;
  v_vnext text;
begin
  if to_regprocedure(
    'public.enforce_buyer_discovery_customer_limits_v1(bigint)'
  ) is null then
    raise exception 'central customer-limit helper is missing';
  end if;

  select pg_get_functiondef(
    'public.enforce_buyer_discovery_customer_limits_v1(bigint)'::regprocedure
  ) into v_helper;
  select pg_get_functiondef(
    'public.start_external_prospect_discovery_v2(bigint,uuid,jsonb)'::regprocedure
  ) into v_standard;
  select pg_get_functiondef(
    'public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb)'::regprocedure
  ) into v_smart;
  select pg_get_functiondef(
    'public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text)'::regprocedure
  ) into v_vnext;

  if v_helper !~ 'public.is_admin\(\)'
     or v_helper !~ 'interval ''30 minutes'''
     or v_helper !~ 'v_daily >= 3'
     or v_helper !~ 'v_monthly >= 20' then
    raise exception 'customer commercial-limit contract regressed';
  end if;
  if v_standard !~ 'enforce_buyer_discovery_customer_limits_v1\(p_company_id\)'
     or v_smart !~ 'enforce_buyer_discovery_customer_limits_v1\(p_company_id\)' then
    raise exception 'standard and Smart Resolver discovery do not share the admin-safe limit gate';
  end if;
  if v_vnext !~ 'cached_intent_14_days'
     or v_vnext !~ 'v_admin_daily >= 50'
     or v_vnext !~ 'WAIVED_ADMIN_QA'
     or v_vnext !~ 'public.is_admin\(\)' then
    raise exception 'cache or bounded Admin QA Fresh safety semantics regressed';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.enforce_buyer_discovery_customer_limits_v1(bigint)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.enforce_buyer_discovery_customer_limits_v1(bigint)',
    'EXECUTE'
  ) then
    raise exception 'customer-limit helper is directly callable';
  end if;
end
$contract$;

create temporary table buyer_admin_limit_fixtures(
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint
) on commit drop;

insert into buyer_admin_limit_fixtures(ordinal,user_id) values
  (1,gen_random_uuid()),
  (2,gen_random_uuid());

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
select user_id,'authenticated','authenticated',
  'buyer-admin-limit-'||ordinal||'@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  clock_timestamp(),clock_timestamp(),false,false
from buyer_admin_limit_fixtures;

with inserted as (
  insert into public.companies(
    owner_id,name,type,website,country,is_approved,is_active
  )
  select user_id,'Buyer Admin Limit Tenant '||ordinal,
    'Medical device manufacturer',
    'https://buyer-admin-limit-'||ordinal||'.example.invalid',
    'Türkiye',false,true
  from buyer_admin_limit_fixtures
  returning id,owner_id
)
update buyer_admin_limit_fixtures fixture
set company_id=inserted.id
from inserted where inserted.owner_id=fixture.user_id;

insert into public.matchmaking_profiles(
  user_id,company_id,role,display_name,country,target_countries,
  partner_types_sought,profile_completeness,is_active
)
select user_id,company_id,'manufacturer',
  'Buyer Admin Limit '||ordinal,'Türkiye',array['France'],
  array['distributor','importer'],80,true
from buyer_admin_limit_fixtures;

insert into public.admins(user_id)
select user_id from buyer_admin_limit_fixtures where ordinal=1;

insert into public.external_prospect_discovery_runs(
  company_id,requested_by,status,idempotency_key,intent_hash,stage,
  intent_source,intent_context,run_mode,credit_disposition,created_at
)
select fixture.company_id,fixture.user_id,'COMPLETED',gen_random_uuid(),
  encode(digest((fixture.ordinal::text||':'||series.n)::text,'sha256'),'hex'),
  'completed','PROFILE_PRODUCT','{}'::jsonb,'NORMAL_DISCOVERY',
  'NOT_APPLICABLE',clock_timestamp()-interval '5 minutes'
from buyer_admin_limit_fixtures fixture
cross join generate_series(1,3) series(n);

grant all on buyer_admin_limit_fixtures to authenticated,service_role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select user_id from buyer_admin_limit_fixtures where ordinal=2),
  'role','authenticated')::text,true);
set local role authenticated;
do $customer_limits$
declare
  v_company bigint := (
    select company_id from buyer_admin_limit_fixtures where ordinal=2
  );
  v_taxonomy bigint := (
    select id from public.medical_product_taxonomy
    where is_active and node_type <> 'family' order by id limit 1
  );
begin
  if public.is_admin() then
    raise exception 'ordinary customer was recognized as admin';
  end if;
  begin
    perform public.start_external_prospect_discovery_v3(
      v_company,gen_random_uuid(),
      jsonb_build_object(
        'intent_source','AD_HOC_PRODUCT',
        'taxonomy_ids',jsonb_build_array(v_taxonomy),
        'target_countries',jsonb_build_array('FR')
      ),'NORMAL_DISCOVERY'
    );
    raise exception 'customer cooldown was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Discovery cooldown is active' then raise; end if;
  end;
  begin
    perform public.start_external_prospect_discovery_v3(
      (select company_id from buyer_admin_limit_fixtures where ordinal=1),
      gen_random_uuid(),
      jsonb_build_object(
        'intent_source','AD_HOC_PRODUCT',
        'taxonomy_ids',jsonb_build_array((
          select id from public.medical_product_taxonomy
          where is_active and node_type <> 'family' order by id limit 1
        )),
        'target_countries',jsonb_build_array('FR')
      ),'NORMAL_DISCOVERY'
    );
    raise exception 'cross-company customer discovery succeeded';
  exception when insufficient_privilege then null;
  end;
end
$customer_limits$;
reset role;

update public.external_prospect_discovery_runs
set created_at=clock_timestamp()-interval '90 minutes'
where company_id=(select company_id from buyer_admin_limit_fixtures where ordinal=2);

set local role authenticated;
do $customer_daily$
declare
  v_company bigint := (
    select company_id from buyer_admin_limit_fixtures where ordinal=2
  );
  v_taxonomy bigint := (
    select id from public.medical_product_taxonomy
    where is_active and node_type <> 'family' order by id limit 1
  );
begin
  begin
    perform public.start_external_prospect_discovery_v3(
      v_company,gen_random_uuid(),
      jsonb_build_object(
        'intent_source','AD_HOC_PRODUCT',
        'taxonomy_ids',jsonb_build_array(v_taxonomy),
        'target_countries',jsonb_build_array('FR')
      ),'NORMAL_DISCOVERY'
    );
    raise exception 'customer daily limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Daily discovery limit reached' then raise; end if;
  end;
end
$customer_daily$;
reset role;

update public.external_prospect_discovery_runs
set created_at=date_trunc('month',clock_timestamp())+interval '1 hour'
where company_id=(select company_id from buyer_admin_limit_fixtures where ordinal=2);

insert into public.external_prospect_discovery_runs(
  company_id,requested_by,status,idempotency_key,intent_hash,stage,
  intent_source,intent_context,run_mode,credit_disposition,created_at
)
select fixture.company_id,fixture.user_id,'COMPLETED',gen_random_uuid(),
  encode(digest(('monthly:'||series.n)::text,'sha256'),'hex'),
  'completed','PROFILE_PRODUCT','{}'::jsonb,'NORMAL_DISCOVERY',
  'NOT_APPLICABLE',date_trunc('month',clock_timestamp())+interval '1 hour'
from buyer_admin_limit_fixtures fixture
cross join generate_series(4,20) series(n)
where fixture.ordinal=2;

set local role authenticated;
do $customer_monthly$
declare
  v_company bigint := (
    select company_id from buyer_admin_limit_fixtures where ordinal=2
  );
  v_taxonomy bigint := (
    select id from public.medical_product_taxonomy
    where is_active and node_type <> 'family' order by id limit 1
  );
begin
  begin
    perform public.start_external_prospect_discovery_v3(
      v_company,gen_random_uuid(),
      jsonb_build_object(
        'intent_source','AD_HOC_PRODUCT',
        'taxonomy_ids',jsonb_build_array(v_taxonomy),
        'target_countries',jsonb_build_array('FR')
      ),'NORMAL_DISCOVERY'
    );
    raise exception 'customer monthly limit was bypassed';
  exception when raise_exception then
    if sqlerrm <> 'Monthly discovery limit reached' then raise; end if;
  end;
end
$customer_monthly$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select user_id from buyer_admin_limit_fixtures where ordinal=1),
  'role','authenticated')::text,true);
set local role authenticated;
do $admin_paths$
declare
  v_company bigint := (
    select company_id from buyer_admin_limit_fixtures where ordinal=1
  );
  v_taxonomy bigint := (
    select id from public.medical_product_taxonomy
    where is_active and node_type <> 'family' order by id limit 1
  );
  v_intent jsonb;
  v_normal jsonb;
  v_cached jsonb;
  v_fresh jsonb;
  v_ledger_before integer;
begin
  if not public.is_admin() then
    raise exception 'authoritative admin was not recognized';
  end if;
  if not public.company_owner_authorized_v1((
    select company_id from buyer_admin_limit_fixtures where ordinal=2
  )) then
    raise exception 'existing explicit platform-admin company override regressed';
  end if;
  select count(*) into v_ledger_before
  from public.buyer_discovery_credit_ledger where company_id=v_company;
  v_intent := jsonb_build_object(
    'intent_source','AD_HOC_PRODUCT',
    'taxonomy_ids',jsonb_build_array(v_taxonomy),
    'target_countries',jsonb_build_array('FR')
  );
  v_normal := public.start_external_prospect_discovery_v3(
    v_company,gen_random_uuid(),v_intent,'NORMAL_DISCOVERY'
  );
  v_cached := public.start_external_prospect_discovery_v3(
    v_company,gen_random_uuid(),v_intent,'NORMAL_DISCOVERY'
  );
  v_fresh := public.start_external_prospect_discovery_v3(
    v_company,gen_random_uuid(),v_intent,'ADMIN_QA_FRESH'
  );
  if (v_normal->>'reused')::boolean
     or v_normal->>'credit_disposition' <> 'NOT_APPLICABLE'
     or not (v_cached->>'reused')::boolean
     or v_cached->>'run_mode' <> 'CACHED_REUSE'
     or v_fresh->>'credit_disposition' <> 'WAIVED_ADMIN_QA'
     or (select count(*) from public.buyer_discovery_credit_ledger
         where company_id=v_company) <> v_ledger_before then
    raise exception 'admin normal/cache/Fresh credit semantics regressed';
  end if;
end
$admin_paths$;
reset role;

do $feature_state$
begin
  if (select customer_fresh_enabled
      from public.buyer_discovery_credit_feature_state where singleton=true) then
    raise exception 'customer Fresh was unexpectedly enabled';
  end if;
end
$feature_state$;

rollback;

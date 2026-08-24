-- Rollback-only regression for 202608240001_buyer_discovery_product_intents.sql.
begin;

do $structure$
begin
  if to_regclass('public.company_website_product_scans') is null then
    raise exception 'Website product scan cache is missing';
  end if;
  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.company_website_product_scans'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'Website scan RLS is not enabled and forced'; end if;
  if has_table_privilege('anon', 'public.company_website_product_scans', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.company_website_product_scans', 'INSERT,UPDATE,DELETE') then
    raise exception 'Browser role has raw website scan mutation access';
  end if;
  if has_function_privilege('anon',
      'public.start_external_prospect_discovery_v2(bigint,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.start_company_website_product_scan_v1(bigint,uuid,boolean)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.get_external_prospect_workspace_v2(bigint,integer)', 'EXECUTE') then
    raise exception 'Anonymous role can execute private Buyer Discovery RPCs';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'company_website_product_scans'
      and column_name in ('contact_email','email','phone','contact_name','linkedin_url','raw_content')
  ) then raise exception 'Website scan cache contains a prohibited contact/raw-content field'; end if;
end
$structure$;

create temporary table buyer_intent_test_tenants(
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint
) on commit drop;
insert into buyer_intent_test_tenants values
  (1, gen_random_uuid(), null), (2, gen_random_uuid(), null);

insert into auth.users(
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select user_id, 'authenticated', 'authenticated',
  'buyer-intent-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), false, false
from buyer_intent_test_tenants;

with inserted as (
  insert into public.companies(owner_id,name,type,website,country,is_approved,is_active)
  select user_id, 'Buyer Intent Tenant ' || ordinal, 'Medical device manufacturer',
    'https://buyer-intent-' || ordinal || '.example.invalid', 'Türkiye', false, true
  from buyer_intent_test_tenants returning id, owner_id
)
update buyer_intent_test_tenants fixture set company_id = inserted.id
from inserted where fixture.user_id = inserted.owner_id;

insert into public.matchmaking_profiles(
  user_id,company_id,role,display_name,country,target_countries,
  partner_types_sought,profile_completeness,is_active
)
select user_id,company_id,'manufacturer','Zero-product manufacturer ' || ordinal,
  'Türkiye',array['France'],array['distributor','wholesaler'],80,true
from buyer_intent_test_tenants;

grant select on buyer_intent_test_tenants to authenticated, service_role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from buyer_intent_test_tenants where ordinal=1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $zero_product_intent$
declare
  v_company bigint := (select company_id from buyer_intent_test_tenants where ordinal=1);
  v_other bigint := (select company_id from buyer_intent_test_tenants where ordinal=2);
  v_taxonomy bigint := (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers');
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
  v_synonym jsonb;
  v_workspace jsonb;
  v_scan jsonb;
begin
  if exists (select 1 from public.products where company_id=v_company) then
    raise exception 'Zero-product fixture unexpectedly has a product';
  end if;
  v_first := public.start_external_prospect_discovery_v2(v_company,v_key,
    jsonb_build_object('intent_source','AD_HOC_PRODUCT','taxonomy_ids',jsonb_build_array(v_taxonomy),
      'target_countries',jsonb_build_array('FR','DE')));
  v_retry := public.start_external_prospect_discovery_v2(v_company,v_key,
    jsonb_build_object('intent_source','AD_HOC_PRODUCT','taxonomy_ids',jsonb_build_array(v_taxonomy),
      'target_countries',jsonb_build_array('FR','DE')));
  v_synonym := public.start_external_prospect_discovery_v2(v_company,gen_random_uuid(),
    jsonb_build_object('intent_source','WEBSITE_DETECTED_PRODUCT','taxonomy_ids',jsonb_build_array(v_taxonomy),
      'target_countries',jsonb_build_array('FR','DE')));
  if (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean or v_retry->>'reason' <> 'idempotency_key'
     or not (v_synonym->>'reused')::boolean or v_synonym->>'reason' <> 'cached_intent'
     or v_first->>'run_id' <> v_retry->>'run_id'
     or v_first->>'run_id' <> v_synonym->>'run_id' then
    raise exception 'Normalized intent caching/idempotency failed';
  end if;
  if (v_first->'intent_context') ? 'raw_product_query'
     or (v_first->'intent_context'->>'normalized_product_label') <> 'Ultrasound Probe Covers' then
    raise exception 'Intent context is not normalized/privacy-minimized';
  end if;
  v_workspace := public.get_external_prospect_workspace_v2(v_company,10);
  if jsonb_array_length(v_workspace->'product_context'->'products') <> 0
     or jsonb_array_length(v_workspace->'runs') <> 1 then
    raise exception 'Zero-product workspace or recent runs are incorrect';
  end if;
  v_scan := public.start_company_website_product_scan_v1(v_company,gen_random_uuid(),false);
  if (v_scan->>'reused')::boolean or v_scan->>'stage' <> 'reading_website' then
    raise exception 'Website scan start failed';
  end if;
  begin
    perform public.start_external_prospect_discovery_v2(v_other,gen_random_uuid(),
      jsonb_build_object('intent_source','AD_HOC_PRODUCT','taxonomy_ids',jsonb_build_array(v_taxonomy),
        'target_countries','[]'::jsonb));
    raise exception 'Cross-company discovery start succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_external_prospect_workspace_v2(v_other,10);
    raise exception 'Cross-company workspace read succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.start_external_prospect_discovery_v2(v_company,gen_random_uuid(),
      jsonb_build_object('intent_source','AD_HOC_PRODUCT','taxonomy_ids',jsonb_build_array(v_taxonomy),
        'target_countries','[]'::jsonb,'raw_product_query','private raw text'));
    raise exception 'Unsupported raw intent field was accepted';
  exception when invalid_parameter_value then null;
  end;
end
$zero_product_intent$;
reset role;

do $snapshot_constraints$
declare
  v_company bigint := (select company_id from buyer_intent_test_tenants where ordinal=1);
begin
  begin
    insert into public.company_website_product_scans(
      company_id,requested_by,idempotency_key,website_hash,source_domain,suggestions
    ) values (
      v_company,(select user_id from buyer_intent_test_tenants where ordinal=1),
      gen_random_uuid(),repeat('a',64),'example.invalid',
      '[{"taxonomy_id":1,"contact_email":"private@example.invalid"}]'::jsonb
    );
    raise exception 'Website scan cache accepted a contact field';
  exception when check_violation then null;
  end;
end
$snapshot_constraints$;

rollback;

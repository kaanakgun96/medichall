-- Run after 202608110001_medical_product_taxonomy.sql.
-- Every fixture and mutation is transaction-local and rolled back.

begin;

do $structure$
declare relation_name text; function_name text;
begin
  foreach relation_name in array array[
    'medical_product_taxonomy','medical_product_aliases',
    'product_taxonomy_mappings','matchmaking_taxonomy_interests',
    'tender_taxonomy_mappings','medical_product_taxonomy_review_queue'
  ] loop
    if to_regclass('public.'||relation_name) is null then
      raise exception 'Required taxonomy relation is missing: %',relation_name;
    end if;
    if not exists(select 1 from pg_class relation join pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='public'
      and relation.relname=relation_name and relation.relrowsecurity) then
      raise exception 'RLS is disabled on %',relation_name;
    end if;
  end loop;
  foreach function_name in array array[
    'public.search_medical_product_taxonomy_v1(text,integer)',
    'public.resolve_medical_product_term_v1(text,integer)',
    'public.save_matchmaking_taxonomy_interests_v1(uuid,jsonb)',
    'public.set_product_taxonomy_mapping_v1(bigint,bigint,text)',
    'public.clear_product_taxonomy_mapping_v1(bigint)',
    'public.queue_product_taxonomy_review_v1(bigint,text)',
    'public.mm_taxonomy_product_compatibility_v1(uuid,uuid)',
    'public.refresh_tender_taxonomy_mappings_v1(bigint)',
    'public.get_tender_taxonomy_compatibility_v1(bigint,bigint)',
    'public.get_admin_medical_taxonomy_v1(text,integer)'
  ] loop
    if to_regprocedure(function_name) is null then
      raise exception 'Required taxonomy RPC is missing: %',function_name;
    end if;
  end loop;
  if has_function_privilege('anon',
    'public.save_matchmaking_taxonomy_interests_v1(uuid,jsonb)','execute')
    or has_function_privilege('anon',
    'public.set_product_taxonomy_mapping_v1(bigint,bigint,text)','execute')
    or has_function_privilege('anon',
    'public.get_admin_medical_taxonomy_v1(text,integer)','execute') then
    raise exception 'Anonymous role can execute a private taxonomy RPC';
  end if;
  if not has_function_privilege('anon',
    'public.search_medical_product_taxonomy_v1(text,integer)','execute') then
    raise exception 'Anonymous catalog users cannot search the public taxonomy';
  end if;
  if has_function_privilege('authenticated',
    'public.mm_taxonomy_product_compatibility_v1(uuid,uuid)','execute') then
    raise exception 'Authenticated users can directly inspect private compatibility evidence';
  end if;
end
$structure$;

do $seed_and_aliases$
declare resolution jsonb;
begin
  if (select count(*) from public.medical_product_taxonomy where is_active)<40 then
    raise exception 'Taxonomy v1 hierarchy was not seeded';
  end if;
  if (select count(*) from public.product_taxonomy_mappings mapping
      join public.products product on product.id=mapping.product_id
      where product.is_active and mapping.status='approved')
     <> (select count(*) from public.products where is_active) then
    raise exception 'Active catalog products were not deterministically mapped exactly once';
  end if;
  foreach resolution in array array[
    public.resolve_medical_product_term_v1('Ultrasound Probe Cover',5),
    public.resolve_medical_product_term_v1('Ultrasound Transducer Cover',5),
    public.resolve_medical_product_term_v1('Ultrasound Transducer Sheath',5),
    public.resolve_medical_product_term_v1('Probe Sheath',5),
    public.resolve_medical_product_term_v1('Ultrasound Sheath',5),
    public.resolve_medical_product_term_v1('Protective sterile sheath for ultrasound transducer',5),
    public.resolve_medical_product_term_v1('C-Arm Cover',5),
    public.resolve_medical_product_term_v1('C Arm Drape',5),
    public.resolve_medical_product_term_v1('C-Arm Protective Cover',5),
    public.resolve_medical_product_term_v1('Sterile C-Arm Equipment Drape',5)
  ] loop
    if resolution->>'resolution'<>'high_confidence' then
      raise exception 'Required alias did not resolve with high confidence: %',resolution;
    end if;
  end loop;
  if public.resolve_medical_product_term_v1('zzzxqv unmatched widget',5)
      ->>'resolution'<>'unmapped' then
    raise exception 'Low-confidence unrelated term was silently mapped';
  end if;
  if public.medical_taxonomy_pair_score_v1(
      (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers'),
      (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers'))<>100
    or public.medical_taxonomy_pair_score_v1(
      (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers'),
      (select id from public.medical_product_taxonomy where slug='equipment-covers'))<>75
    or public.medical_taxonomy_pair_score_v1(
      (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers'),
      (select id from public.medical_product_taxonomy where slug='wound-care'))<>0 then
    raise exception 'Exact, family, or unrelated taxonomy scoring is incorrect';
  end if;
end
$seed_and_aliases$;

create temporary table taxonomy_test_tenants(
  ordinal integer primary key,user_id uuid not null,company_id bigint,
  profile_id uuid,product_one bigint,product_two bigint,tender_id bigint
) on commit drop;
grant select on taxonomy_test_tenants to anon, authenticated, service_role;
insert into taxonomy_test_tenants(ordinal,user_id)
values(1,gen_random_uuid()),(2,gen_random_uuid());

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous)
select user_id,'authenticated','authenticated',
  'qa-taxonomy-'||ordinal||'-'||user_id||'@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now(),false,false from taxonomy_test_tenants;

with inserted as(
  insert into public.companies(owner_id,name,type,country,is_approved,is_active)
  select user_id,'QA Taxonomy '||case ordinal when 1 then 'Manufacturer' else 'Distributor' end,
    case ordinal when 1 then 'Medical device manufacturer' else 'Medical distributor' end,
    case ordinal when 1 then 'Türkiye' else 'Germany' end,false,true
  from taxonomy_test_tenants order by ordinal returning id,owner_id
)
update taxonomy_test_tenants fixture set company_id=inserted.id
from inserted where fixture.user_id=inserted.owner_id;

with inserted as(
  insert into public.matchmaking_profiles(user_id,company_id,role,display_name,
    country,offered_products,interested_products,partner_types_sought,
    profile_completeness,is_active)
  select user_id,company_id,case ordinal when 1 then 'manufacturer' else 'distributor' end,
    'QA Taxonomy Profile '||ordinal,case ordinal when 1 then 'Türkiye' else 'Germany' end,
    case ordinal when 1 then array['Sterile Ultrasound Transducer Sheath','Sterile Camera Sleeve'] else '{}'::text[] end,
    case ordinal when 2 then array['Ultrasound Probe Cover','Camera Cover'] else '{}'::text[] end,
    case ordinal when 1 then array['distributor'] else array['manufacturer'] end,
    90,true from taxonomy_test_tenants order by ordinal returning id,user_id
)
update taxonomy_test_tenants fixture set profile_id=inserted.id
from inserted where fixture.user_id=inserted.user_id;

with inserted as(
  insert into public.products(ref,name,category,company_id,is_active)
  select 'QA-TAXONOMY-'||tenant.ordinal||'-'||series.product_number||'-'||gen_random_uuid(),
    case series.product_number when 1 then 'Sterile Ultrasound Transducer Sheath'
      else 'Sterile Camera Sleeve' end,'Medical Devices',company_id,true
  from taxonomy_test_tenants tenant
  cross join generate_series(1,2) as series(product_number)
  where tenant.ordinal=1 returning id,name,company_id
)
update taxonomy_test_tenants fixture set
  product_one=case when inserted.name='Sterile Ultrasound Transducer Sheath' then inserted.id else fixture.product_one end,
  product_two=case when inserted.name='Sterile Camera Sleeve' then inserted.id else fixture.product_two end
from inserted where fixture.company_id=inserted.company_id;

-- The update above can see one returned row at a time; fill deterministically.
update taxonomy_test_tenants fixture set
  product_one=(select id from public.products where company_id=fixture.company_id
    and name='Sterile Ultrasound Transducer Sheath'),
  product_two=(select id from public.products where company_id=fixture.company_id
    and name='Sterile Camera Sleeve')
where ordinal=1;

select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=1),true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.set_product_taxonomy_mapping_v1(
  (select product_one from taxonomy_test_tenants where ordinal=1),
  (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers'),
  'Sterile Ultrasound Transducer Sheath');
select public.set_product_taxonomy_mapping_v1(
  (select product_two from taxonomy_test_tenants where ordinal=1),
  (select id from public.medical_product_taxonomy where slug='camera-covers'),
  'Sterile Camera Sleeve');

reset role;

select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=2),true);
set local role authenticated;
do $isolation$
begin
  begin
    perform public.set_product_taxonomy_mapping_v1(
      (select product_one from taxonomy_test_tenants where ordinal=1),
      (select id from public.medical_product_taxonomy where slug='camera-covers'),
      'forbidden');
    raise exception 'Company B changed Company A product mapping';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_admin_medical_taxonomy_v1(null,20);
    raise exception 'Normal user accessed taxonomy administration';
  exception when insufficient_privilege then null;
  end;
end
$isolation$;

select public.save_matchmaking_taxonomy_interests_v1(
  (select profile_id from taxonomy_test_tenants where ordinal=2),
  jsonb_build_array(
    jsonb_build_object('interest_kind','interested','taxonomy_id',
      (select id from public.medical_product_taxonomy where slug='ultrasound-probe-covers')),
    jsonb_build_object('interest_kind','interested','taxonomy_id',
      (select id from public.medical_product_taxonomy where slug='camera-covers')),
    jsonb_build_object('interest_kind','interested','taxonomy_id',
      (select id from public.medical_product_taxonomy where slug='camera-covers'))
  ));
reset role;

do $dedupe$
begin
  if (select count(*) from public.matchmaking_taxonomy_interests interest
      where interest.profile_id=(select profile_id from taxonomy_test_tenants where ordinal=2))<>2 then
    raise exception 'Duplicate taxonomy selection was not suppressed';
  end if;
end
$dedupe$;

select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=1),true);
set local role authenticated;
select public.refresh_matchmaking_matches(
  (select profile_id from taxonomy_test_tenants where ordinal=1));
reset role;

do $exact_match$
declare compatibility jsonb;
begin
  compatibility:=public.mm_taxonomy_product_compatibility_v1(
    (select profile_id from taxonomy_test_tenants where ordinal=1),
    (select profile_id from taxonomy_test_tenants where ordinal=2));
  if (compatibility->>'score')::integer<>100 then
    raise exception 'Alias-equivalent products did not produce an exact taxonomy match: %',compatibility;
  end if;
  if (select product_score from public.matchmaking_matches
      where source_profile_id=(select profile_id from taxonomy_test_tenants where ordinal=1)
      and target_profile_id=(select profile_id from taxonomy_test_tenants where ordinal=2))<>100 then
    raise exception 'Taxonomy score was not integrated into matchmaking';
  end if;
end
$exact_match$;

select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=2),true);
set local role authenticated;
select public.save_matchmaking_taxonomy_interests_v1(
  (select profile_id from taxonomy_test_tenants where ordinal=2),
  jsonb_build_array(jsonb_build_object('interest_kind','interested','taxonomy_id',
    (select id from public.medical_product_taxonomy where slug='equipment-covers'))));
reset role;
select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=1),true);
set local role authenticated;
select public.refresh_matchmaking_matches(
  (select profile_id from taxonomy_test_tenants where ordinal=1));
reset role;

do $family_match$
begin
  if (select product_score from public.matchmaking_matches
      where source_profile_id=(select profile_id from taxonomy_test_tenants where ordinal=1)
      and target_profile_id=(select profile_id from taxonomy_test_tenants where ordinal=2))<>75 then
    raise exception 'Broad Equipment Covers interest did not score 75';
  end if;
end
$family_match$;

select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=2),true);
set local role authenticated;
select public.save_matchmaking_taxonomy_interests_v1(
  (select profile_id from taxonomy_test_tenants where ordinal=2),
  jsonb_build_array(jsonb_build_object('interest_kind','interested','taxonomy_id',
    (select id from public.medical_product_taxonomy where slug='wound-care'))));
reset role;
select set_config('request.jwt.claim.sub',
  (select user_id::text from taxonomy_test_tenants where ordinal=1),true);
set local role authenticated;
select public.refresh_matchmaking_matches(
  (select profile_id from taxonomy_test_tenants where ordinal=1));
reset role;

do $unrelated_match$
begin
  if (select product_score from public.matchmaking_matches
      where source_profile_id=(select profile_id from taxonomy_test_tenants where ordinal=1)
      and target_profile_id=(select profile_id from taxonomy_test_tenants where ordinal=2))<>0 then
    raise exception 'Unrelated Wound Care interest produced a false Equipment Covers match';
  end if;
end
$unrelated_match$;

with inserted as(
  insert into public.tenders(source,source_notice_id,title,status,extracted_products)
  values('qa-taxonomy-test','qa-taxonomy-'||gen_random_uuid(),
    'QA Taxonomy Tender','open',jsonb_build_array(
      jsonb_build_object('lot_number','lot-1','product_name',
        'Protective sterile sheath for ultrasound transducer'),
      jsonb_build_object('lot_number','lot-2','product_name','Sterile C-Arm Drapes'),
      jsonb_build_object('lot_number','lot-3','product_name','Surgical Camera Sleeves'),
      jsonb_build_object('lot_number','lot-4','product_name','Unrelated unknown item')
    )) returning id
)
update taxonomy_test_tenants set tender_id=inserted.id from inserted where ordinal=1;
insert into public.opportunity_matches(company_id,opportunity_type,tender_id,
  match_score,keyword_score,geography_score,certification_score,category_score,generated_by)
select company_id,'tender',tender_id,50,50,50,50,50,'qa-taxonomy-test'
from taxonomy_test_tenants where ordinal=1;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.refresh_tender_taxonomy_mappings_v1(
  (select tender_id from taxonomy_test_tenants where ordinal=1));
reset role;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select user_id from taxonomy_test_tenants where ordinal=1),
  'role','authenticated')::text,true);

do $tender_and_lot$
declare compatibility jsonb;
begin
  if (select count(*) from public.tender_taxonomy_mappings mapping
      where mapping.tender_id=(select tender_id from taxonomy_test_tenants where ordinal=1))<>3 then
    raise exception 'Tender mapping did not map exactly the three supported lots';
  end if;
  compatibility:=public.get_tender_taxonomy_compatibility_v1(
    (select company_id from taxonomy_test_tenants where ordinal=1),
    (select tender_id from taxonomy_test_tenants where ordinal=1));
  if (compatibility->>'score')::integer<>100
     or not exists(select 1 from jsonb_array_elements(compatibility->'matches') match
       where match->>'lot_key'='lot-1' and (match->>'score')::integer=100)
     or not exists(select 1 from jsonb_array_elements(compatibility->'matches') match
       where match->>'lot_key'='lot-3' and (match->>'score')::integer=100) then
    raise exception 'Tender lot taxonomy evidence is incorrect: %',compatibility;
  end if;
  if exists(select 1 from public.tender_taxonomy_mappings mapping
    where mapping.tender_id=(select tender_id from taxonomy_test_tenants where ordinal=1)
      and mapping.lot_key='lot-4') then
    raise exception 'Unrelated tender lot received a false taxonomy mapping';
  end if;
end
$tender_and_lot$;

set local role anon;
do $anonymous_mutation$
begin
  begin
    insert into public.medical_product_taxonomy(hierarchy_level,node_type,
      canonical_name,slug) values(1,'family','Forbidden','forbidden');
    raise exception 'Anonymous taxonomy mutation succeeded';
  exception when insufficient_privilege then null;
  end;
end
$anonymous_mutation$;
reset role;

do $no_provider_or_email_fanout$
begin
  if exists(select 1 from public.user_notification_email_outbox outbox
    join taxonomy_test_tenants fixture on fixture.user_id=outbox.recipient_user_id
    where outbox.provider_message_id is not null or outbox.status='sent')
    or exists(select 1 from public.company_admin_notification_outbox outbox
      join taxonomy_test_tenants fixture on fixture.company_id=outbox.company_id
      where outbox.provider_message_id is not null or outbox.status='sent') then
    raise exception 'Taxonomy QA dispatched provider-backed email';
  end if;
end
$no_provider_or_email_fanout$;

rollback;

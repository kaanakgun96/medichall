-- Rollback-only regression for 202608200003_external_prospect_discovery.sql.
begin;

do $structure$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'external_companies', 'external_company_evidence',
    'external_company_taxonomy', 'external_company_activities',
    'external_prospect_discovery_runs', 'company_external_prospect_matches',
    'external_prospect_feedback'
  ] loop
    if to_regclass('public.' || relation_name) is null then
      raise exception 'External prospect relation is missing: %', relation_name;
    end if;
    if not exists (
      select 1 from pg_class relation where relation.oid =
        ('public.' || relation_name)::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then raise exception 'RLS is not enabled and forced on %', relation_name; end if;
    if has_table_privilege('anon', 'public.' || relation_name, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', 'public.' || relation_name, 'INSERT,UPDATE,DELETE') then
      raise exception 'Browser role has raw access to %', relation_name;
    end if;
  end loop;
  if has_function_privilege('anon',
      'public.start_external_prospect_discovery_v1(bigint,uuid)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.get_external_prospect_workspace_v1(bigint,integer)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.set_external_prospect_feedback_v1(bigint,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.get_admin_external_prospect_metrics_v1()', 'EXECUTE') then
    raise exception 'Anonymous role can execute a private prospect RPC';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('external_companies', 'external_company_evidence', 'external_company_activities')
      and column_name in ('contact_email', 'email', 'phone', 'contact_name', 'linkedin_url')
  ) then raise exception 'External prospect schema contains a prohibited contact field'; end if;
end
$structure$;

create temporary table external_prospect_test_tenants (
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  profile_id uuid,
  product_id bigint,
  match_id bigint
) on commit drop;

insert into external_prospect_test_tenants(ordinal, user_id)
values (1, gen_random_uuid()), (2, gen_random_uuid()), (3, gen_random_uuid());

insert into auth.users(
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select user_id, 'authenticated', 'authenticated',
  'external-prospect-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), false, false
from external_prospect_test_tenants;

with inserted as (
  insert into public.companies(owner_id, name, type, website, country, is_approved, is_active)
  select user_id, 'External Prospect Tenant ' || ordinal,
    case when ordinal < 3 then 'Medical device manufacturer' else 'Administrator' end,
    'https://tenant-' || ordinal || '.example.invalid',
    case ordinal when 1 then 'Türkiye' when 2 then 'Germany' else 'France' end,
    false, true
  from external_prospect_test_tenants
  returning id, owner_id
)
update external_prospect_test_tenants fixture set company_id = inserted.id
from inserted where fixture.user_id = inserted.owner_id;

insert into public.admins(user_id)
select user_id from external_prospect_test_tenants where ordinal = 3;

with inserted as (
  insert into public.matchmaking_profiles(
    user_id, company_id, role, display_name, country, target_countries,
    partner_types_sought, offered_products, profile_completeness, is_active
  )
  select user_id, company_id, 'manufacturer', 'Prospect Manufacturer ' || ordinal,
    case ordinal when 1 then 'Türkiye' else 'Germany' end,
    case ordinal when 1 then array['France'] else array['Norway'] end,
    array['distributor','wholesaler'], array['Ultrasound probe covers'], 90, true
  from external_prospect_test_tenants where ordinal in (1,2)
  returning id, user_id
)
update external_prospect_test_tenants fixture set profile_id = inserted.id
from inserted where fixture.user_id = inserted.user_id;

with inserted as (
  insert into public.products(ref, name, category, company_id, is_active)
  select 'QA-EXTERNAL-' || ordinal || '-' || gen_random_uuid(),
    'Ultrasound Probe Cover', 'Medical Devices', company_id, true
  from external_prospect_test_tenants where ordinal in (1,2)
  returning id, company_id
)
update external_prospect_test_tenants fixture set product_id = inserted.id
from inserted where fixture.company_id = inserted.company_id;

insert into public.product_taxonomy_mappings(
  product_id, taxonomy_id, mapping_source, confidence, status, is_primary
)
select product_id,
  (select id from public.medical_product_taxonomy where slug = 'ultrasound-probe-covers'),
  'owner_selected', 1, 'approved', true
from external_prospect_test_tenants where ordinal in (1,2);

insert into public.company_match_profiles(company_id, cpv_codes, target_countries, target_partner_types)
select company_id, array['33124100'],
  case ordinal when 1 then array['FR'] else array['NO'] end,
  array['distributor','wholesaler']
from external_prospect_test_tenants where ordinal in (1,2);

-- Role-switching assertions still need access to their synthetic identifiers.
-- This temp-table grant exists only inside the rollback-only test transaction.
grant select on external_prospect_test_tenants to anon, authenticated, service_role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from external_prospect_test_tenants where ordinal=1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $start_gate$
declare
  v_company bigint := (select company_id from external_prospect_test_tenants where ordinal=1);
  v_other bigint := (select company_id from external_prospect_test_tenants where ordinal=2);
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
  v_cached jsonb;
begin
  v_first := public.start_external_prospect_discovery_v1(v_company, v_key);
  v_retry := public.start_external_prospect_discovery_v1(v_company, v_key);
  v_cached := public.start_external_prospect_discovery_v1(v_company, gen_random_uuid());
  if (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or v_retry->>'reason' <> 'idempotency_key'
     or not (v_cached->>'reused')::boolean
     or v_cached->>'reason' <> 'cached_intent'
     or v_first->>'run_id' <> v_retry->>'run_id'
     or v_first->>'run_id' <> v_cached->>'run_id' then
    raise exception 'Discovery idempotency or intent caching failed';
  end if;
  begin
    perform public.start_external_prospect_discovery_v1(v_other, gen_random_uuid());
    raise exception 'Cross-tenant discovery start succeeded';
  exception when insufficient_privilege then null;
  end;
end
$start_gate$;
reset role;

insert into public.external_companies(
  company_name, country_code, country_name, company_type, website_url,
  registry_identifier, last_verified_at
) values (
  'Independent Prospect France', 'FR', 'France', 'Distributor',
  'https://independent-prospect.example.invalid', 'FR-PUBLIC-1', now()
);

insert into public.external_company_evidence(
  external_company_id, source_type, evidence_kind, source_url, source_domain, source_title,
  evidence_snippet, taxonomy_signals, cpv_codes, notice_id, evidence_date,
  confidence, source_hash, last_verified_at
)
select id, 'TED_AWARD', 'INDIRECT_COMMERCIAL_EVIDENCE', 'https://ted.europa.eu/en/notice/-/detail/qa-2026',
  'ted.europa.eu', 'Public procurement award',
  'Related diagnostic equipment accessories',
  jsonb_build_array(jsonb_build_object('taxonomy_id',
    (select id from public.medical_product_taxonomy where slug = 'ultrasound-probe-covers'))),
  array['33124100'], 'qa-2026', current_date, 0.9, repeat('a',64), now()
from public.external_companies where normalized_domain = 'independent-prospect.example.invalid';

insert into public.external_company_evidence(
  external_company_id, source_type, evidence_kind, source_url, source_domain, source_title,
  evidence_snippet, confidence, source_hash, last_verified_at
)
select id, 'PUBLIC_REGISTRY', 'INDIRECT_COMMERCIAL_EVIDENCE',
  'https://recherche-entreprises.api.gouv.fr/search?q=qa',
  'recherche-entreprises.api.gouv.fr', 'Official registry activity',
  '46.46Z Wholesale of relevant goods', 0.82, repeat('b',64), now()
from public.external_companies where normalized_domain = 'independent-prospect.example.invalid';

insert into public.external_company_activities(
  external_company_id, evidence_id, provider_code, jurisdiction_country_code,
  registry_identifier, national_activity_code, national_classification,
  activity_description, normalized_nace_code, nace_revision,
  normalized_activity_class, signal_strength
)
select company.id, evidence.id, 'FR_RECHERCHE_ENTREPRISES', 'FR', 'FR-PUBLIC-1',
  '46.46Z', 'NAF/APE', 'Wholesale of relevant medical goods', '46.46',
  'NACE_REV_2', 'PHARMACEUTICAL_WHOLESALE', 'STRONG_INDIRECT'
from public.external_companies company
join public.external_company_evidence evidence on evidence.external_company_id = company.id
where company.normalized_domain = 'independent-prospect.example.invalid'
  and evidence.source_type = 'PUBLIC_REGISTRY';

insert into public.external_company_taxonomy(
  external_company_id, taxonomy_id, mapping_source, confidence
)
select id,
  (select id from public.medical_product_taxonomy where slug = 'ultrasound-probe-covers'),
  'cpv_mapping', 0.9
from public.external_companies where normalized_domain = 'independent-prospect.example.invalid';

update public.external_prospect_discovery_runs run
set status = 'COMPLETED', stage = 'completed', candidates_found = 1,
  candidates_accepted = 1, completed_at = now(), created_at = now() - interval '2 hours'
where run.company_id = (select company_id from external_prospect_test_tenants where ordinal=1);

insert into public.external_prospect_discovery_runs(
  company_id, requested_by, status, idempotency_key, intent_hash, stage,
  candidates_found, candidates_accepted, completed_at
)
select company_id, user_id, 'COMPLETED', gen_random_uuid(), repeat(ordinal::text,64),
  'completed', 1, 1, now()
from external_prospect_test_tenants where ordinal = 2;

insert into public.external_prospect_discovery_runs(
  company_id, requested_by, status, idempotency_key, intent_hash, stage,
  created_at, completed_at
)
select company_id, user_id, 'COMPLETED', gen_random_uuid(), repeat(value,64),
  'completed', now() - interval '90 minutes', now() - interval '89 minutes'
from external_prospect_test_tenants
cross join (values ('c'),('d')) additional(value)
where ordinal = 1;

update public.matchmaking_profiles
set target_countries = array['France','Spain']
where company_id = (select company_id from external_prospect_test_tenants where ordinal=1);

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from external_prospect_test_tenants where ordinal=1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $daily_limit$
begin
  begin
    perform public.start_external_prospect_discovery_v1(
      (select company_id from external_prospect_test_tenants where ordinal=1),
      gen_random_uuid()
    );
    raise exception 'Daily discovery limit was not enforced';
  exception when raise_exception then
    if sqlerrm <> 'Daily discovery limit reached' then raise; end if;
  end;
end
$daily_limit$;
reset role;

with inserted as (
  insert into public.company_external_prospect_matches(
    company_id, external_company_id, discovery_run_id, relevance_score,
    product_taxonomy_score, geography_score, company_type_score,
    procurement_signal_score, evidence_quality_score, recency_score,
    reason_summary, reasons
  )
  select fixture.company_id, company.id, run.id, 90, 40, 15, 15, 15, 5, 0,
    'Direct and independent commercial evidence.',
    '[{"kind":"DIRECT_PRODUCT_EVIDENCE","text":"Public award evidence."}]'::jsonb
  from external_prospect_test_tenants fixture
  join public.external_prospect_discovery_runs run on run.company_id = fixture.company_id
  cross join public.external_companies company
  where fixture.ordinal in (1,2)
    and company.normalized_domain = 'independent-prospect.example.invalid'
    and run.candidates_accepted = 1
  returning id, company_id
)
update external_prospect_test_tenants fixture set match_id = inserted.id
from inserted where fixture.company_id = inserted.company_id;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from external_prospect_test_tenants where ordinal=1),
  'role', 'authenticated')::text, true);
set local role authenticated;

do $tenant_one$
declare
  v_company bigint := (select company_id from external_prospect_test_tenants where ordinal=1);
  v_other bigint := (select company_id from external_prospect_test_tenants where ordinal=2);
  v_match bigint := (select match_id from external_prospect_test_tenants where ordinal=1);
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_second jsonb;
begin
  if jsonb_array_length(public.get_external_prospect_workspace_v1(v_company,100)->'prospects') <> 1 then
    raise exception 'Tenant one cannot read its external prospect workspace';
  end if;
  begin
    perform public.get_external_prospect_workspace_v1(v_other,100);
    raise exception 'Cross-tenant workspace access succeeded';
  exception when insufficient_privilege then null;
  end;
  v_first := public.set_external_prospect_feedback_v1(v_match,'SAVED','Private tenant note',v_key);
  v_second := public.set_external_prospect_feedback_v1(v_match,'SAVED','Private tenant note',v_key);
  if not (v_first->>'recorded')::boolean or not (v_second->>'deduplicated')::boolean then
    raise exception 'Feedback idempotency failed';
  end if;
  perform public.set_external_prospect_feedback_v1(
    v_match, 'NOTE_ONLY', 'Updated note without a workflow change', gen_random_uuid());
  if coalesce((
    select prospect->>'workflow_status'
    from jsonb_array_elements(
      public.get_external_prospect_workspace_v1(v_company,100)->'prospects'
    ) prospect
    where (prospect->>'match_id')::bigint = v_match
  ), '') <> 'SAVED' then
    raise exception 'Private note changed the prospect workflow state';
  end if;
  begin
    perform public.set_external_prospect_feedback_v1(
      (select match_id from external_prospect_test_tenants where ordinal=2),
      'DISMISSED', null, gen_random_uuid());
    raise exception 'Cross-tenant feedback mutation succeeded';
  exception when insufficient_privilege then null;
  end;
end
$tenant_one$;

reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from external_prospect_test_tenants where ordinal=3),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $admin$
declare metrics jsonb;
begin
  metrics := public.get_admin_external_prospect_metrics_v1();
  if (metrics->>'external_entities')::integer < 1
     or (metrics->>'registry_activity_records')::integer < 1
     or coalesce((metrics->'source_mix'->>'TED_AWARD')::integer, 0) < 1
     or (metrics->>'provider_requests_30d')::integer <> 0
     or (metrics->>'estimated_cost_usd_30d')::numeric <> 0 then
    raise exception 'Admin prospect metrics are incomplete or report provider cost';
  end if;
end
$admin$;
reset role;

-- A later MedicHall registration with the same verified domain promotes the
-- global entity and removes it from every external workspace.
insert into public.companies(
  owner_id, name, type, website, country, is_approved, is_active
) values (
  null, 'Independent Prospect France', 'Distributor',
  'https://independent-prospect.example.invalid/about', 'France', true, true
);

do $promotion$
begin
  if not exists (
    select 1 from public.external_companies
    where normalized_domain = 'independent-prospect.example.invalid'
      and membership_status = 'ON_MEDICHALL'
      and medichall_company_id is not null
  ) then raise exception 'External entity was not promoted to its MedicHall record'; end if;
end
$promotion$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from external_prospect_test_tenants where ordinal=1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $promotion_visibility$
begin
  if jsonb_array_length(public.get_external_prospect_workspace_v1(
    (select company_id from external_prospect_test_tenants where ordinal=1),100
  )->'prospects') <> 0 then
    raise exception 'Promoted MedicHall company remains visible as an external prospect';
  end if;
end
$promotion_visibility$;
reset role;

rollback;

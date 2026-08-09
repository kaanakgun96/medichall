-- Run after 202608090001_onboarding_activation.sql.
-- All role, score, opportunity, and isolation fixtures are rolled back.

begin;

do $contract$
begin
  if to_regclass('public.account_onboarding_progress') is null then
    raise exception 'account_onboarding_progress table is missing';
  end if;
  if to_regprocedure('public.get_account_activation_state_v1()') is null
    or to_regprocedure('public.set_account_onboarding_progress_v1(text,boolean,boolean)') is null then
    raise exception 'onboarding activation RPC contract is incomplete';
  end if;
  if has_table_privilege('anon', 'public.account_onboarding_progress', 'SELECT')
    or has_table_privilege('anon', 'public.account_onboarding_progress', 'INSERT')
    or has_table_privilege('anon', 'public.account_onboarding_progress', 'UPDATE') then
    raise exception 'anonymous onboarding progress access is not denied';
  end if;
  if has_function_privilege('anon', 'public.get_account_activation_state_v1()', 'EXECUTE')
    or has_function_privilege(
      'anon',
      'public.set_account_onboarding_progress_v1(text,boolean,boolean)',
      'EXECUTE'
    ) then
    raise exception 'anonymous onboarding RPC execution is not denied';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.get_account_activation_state_v1()',
    'EXECUTE'
  ) then
    raise exception 'authenticated activation read is not callable';
  end if;
end
$contract$;

create temporary table onboarding_activation_tenants (
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  profile_id uuid
) on commit drop;

insert into onboarding_activation_tenants (ordinal, user_id)
values
  (1, '30000000-0000-4000-8000-000000000001'),
  (2, '30000000-0000-4000-8000-000000000002'),
  (3, '30000000-0000-4000-8000-000000000003');

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select
  user_id,
  'authenticated',
  'authenticated',
  'onboarding-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from onboarding_activation_tenants;

with inserted as (
  insert into public.companies (
    owner_id, name, type, description, country, certifications, logo_url,
    is_approved, is_active
  ) values
    (
      '30000000-0000-4000-8000-000000000001',
      'Onboarding Manufacturer QA',
      'Medical device manufacturer',
      'A complete synthetic manufacturer description used only for activation regression.',
      'Türkiye',
      'CE MDR, ISO 13485',
      'https://example.invalid/manufacturer-logo.png',
      false,
      true
    ),
    (
      '30000000-0000-4000-8000-000000000002',
      'Onboarding Distributor QA',
      'Medical device distributor',
      null,
      'Germany',
      null,
      null,
      false,
      true
    )
  returning id, owner_id
)
update onboarding_activation_tenants fixture
set company_id = inserted.id
from inserted
where fixture.user_id = inserted.owner_id;

insert into public.buyer_profiles (user_id, full_name, company_name, country)
values (
  '30000000-0000-4000-8000-000000000003',
  'Onboarding Buyer QA',
  null,
  'France'
);

insert into public.products (ref, name, category, company_id, is_active)
select
  'MH-ONBOARDING-QA-001',
  'Onboarding QA Product',
  'Medical Devices',
  company_id,
  true
from onboarding_activation_tenants
where ordinal = 1;

insert into public.company_match_profiles (
  company_id, target_countries, product_keywords, cpv_codes, certifications,
  profile_complete_score
)
select
  company_id,
  array['Germany', 'France'],
  array['sterile drape'],
  array['33140000'],
  array['CE MDR'],
  100
from onboarding_activation_tenants
where ordinal = 1;

with inserted as (
  insert into public.matchmaking_profiles (
    user_id, company_id, role, display_name, country, description,
    offered_products, interested_products, product_categories,
    target_countries, preferred_supplier_countries, partner_types_sought,
    profile_completeness
  )
  select
    user_id,
    company_id,
    case ordinal when 1 then 'manufacturer' when 2 then 'distributor' else 'buyer' end,
    case ordinal when 1 then 'Onboarding Manufacturer QA' when 2 then 'Onboarding Distributor QA' else 'Onboarding Buyer QA' end,
    case ordinal when 1 then 'Türkiye' when 2 then 'Germany' else 'France' end,
    'Synthetic activation regression profile with sufficient structured information.',
    case when ordinal = 1 then array['sterile drapes'] else '{}'::text[] end,
    case when ordinal in (2, 3) then array['sterile drapes'] else '{}'::text[] end,
    array['Medical Devices'],
    case when ordinal = 1 then array['Germany', 'France'] else '{}'::text[] end,
    case when ordinal in (2, 3) then array['Türkiye'] else '{}'::text[] end,
    case when ordinal = 1 then array['distributor', 'buyer'] else array['manufacturer'] end,
    case when ordinal in (1, 3) then 80 else 35 end
  from onboarding_activation_tenants
  order by ordinal
  returning id, user_id
)
update onboarding_activation_tenants fixture
set profile_id = inserted.id
from inserted
where fixture.user_id = inserted.user_id;

insert into public.matchmaking_matches (
  source_profile_id, target_profile_id, match_score, confidence_level,
  product_score, geography_score, partner_type_score, certification_score,
  commercial_score, status
)
select source.profile_id, target.profile_id, 88, 'high', 90, 85, 90, 85, 80, 'viewed'
from onboarding_activation_tenants source
cross join onboarding_activation_tenants target
where source.ordinal = 1 and target.ordinal = 2;

insert into public.tenders (
  source, source_notice_id, title, country_code, country_name, cpv_codes,
  product_keywords, status
)
values (
  'QA', 'ONBOARDING-ACTIVATION-QA-001', 'Onboarding activation QA tender',
  'DE', 'Germany', array['33140000'], array['sterile drape'], 'open'
);

insert into public.opportunity_matches (
  company_id, opportunity_type, tender_id, match_score, confidence_score,
  keyword_score, geography_score, certification_score, category_score,
  status, generated_by
)
select fixture.company_id, 'tender', tender.id, 91, 90, 95, 85, 90, 90,
       'viewed', 'onboarding-activation-regression'
from onboarding_activation_tenants fixture
cross join public.tenders tender
where fixture.ordinal = 1
  and tender.source = 'QA'
  and tender.source_notice_id = 'ONBOARDING-ACTIVATION-QA-001';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $manufacturer$
declare
  state jsonb;
begin
  state := public.get_account_activation_state_v1();
  if state ->> 'account_kind' <> 'company'
    or state ->> 'account_role' <> 'manufacturer' then
    raise exception 'manufacturer role was not derived safely';
  end if;
  if (state ->> 'profile_score')::integer <> 100 then
    raise exception 'complete manufacturer score was not 100: %', state ->> 'profile_score';
  end if;
  if (state #>> '{first_value,company_matches}')::integer <> 1
    or (state #>> '{first_value,tender_matches}')::integer <> 1 then
    raise exception 'first-value counts are not based on actual fixture matches';
  end if;
  if (state ->> 'show_guidance')::boolean then
    raise exception 'complete existing company was unnecessarily restarted';
  end if;

  state := public.set_account_onboarding_progress_v1('tender_match', true, false);
  if state #>> '{progress,last_step}' <> 'tender_match'
    or state #>> '{progress,dismissed_at}' is null then
    raise exception 'onboarding dismiss/resume state was not stored';
  end if;
  state := public.set_account_onboarding_progress_v1('dashboard', false, true);
  if state #>> '{progress,dismissed_at}' is not null
    or state #>> '{progress,completed_at}' is null then
    raise exception 'onboarding resume/completion state was not stored';
  end if;
end
$manufacturer$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $distributor$
declare
  state jsonb;
begin
  state := public.get_account_activation_state_v1();
  if state ->> 'account_role' <> 'distributor' then
    raise exception 'distributor account was treated as manufacturer-only';
  end if;
  if (state ->> 'profile_score')::integer >= 70 then
    raise exception 'incomplete distributor received a ready score';
  end if;
  if exists (select 1 from public.account_onboarding_progress) then
    raise exception 'onboarding progress leaked across users';
  end if;
end
$distributor$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '30000000-0000-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $buyer$
declare
  state jsonb;
  check_keys text[];
begin
  state := public.get_account_activation_state_v1();
  if state ->> 'account_kind' <> 'buyer'
    or state ->> 'account_role' <> 'buyer' then
    raise exception 'buyer activation state is incorrect';
  end if;
  if (state ->> 'profile_score')::integer <> 100 then
    raise exception 'complete buyer score was not 100: %', state ->> 'profile_score';
  end if;
  select array_agg(item ->> 'key') into check_keys
  from jsonb_array_elements(state -> 'checks') item;
  if 'first_tender_match' = any(check_keys)
    or 'first_product' = any(check_keys)
    or 'company_logo' = any(check_keys) then
    raise exception 'buyer activation includes irrelevant company tasks';
  end if;
end
$buyer$;

rollback;

-- Run after 202607230003_match_score_v2.sql.
-- All fixtures and score rows are transaction-local and rolled back.

begin;

do $unit_tests$
declare
  v_exact integer;
  v_semantic integer;
  v_match integer;
  v_mismatch integer;
  v_first integer;
  v_second integer;
begin
  v_exact := public.match_v2_exact_product_score(
    array['Sterile nitrile examination glove'],
    array['Sterile nitrile examination glove']
  );
  v_semantic := public.match_v2_text_similarity(
    'Sterile nitrile examination glove',
    'Powder-free medical hand protection'
  );
  if v_exact <> 100 or v_exact <= coalesce(v_semantic, 0) then
    raise exception 'Exact product match must outrank semantic-only similarity';
  end if;

  if public.match_v2_cpv_score(
    array['33140000-3'],
    array['33140000']
  ) <> 100 then
    raise exception 'Exact normalized CPV match must score 100';
  end if;
  if public.match_v2_cpv_score(
    array['33141000'],
    array['33141900']
  ) <= public.match_v2_cpv_score(
    array['33141000'],
    array['33600000']
  ) then
    raise exception 'Related CPV hierarchy must outrank unrelated CPV';
  end if;

  v_match := public.match_v2_weighted_score(
    '{"exact_product":{"score":80},"certification":{"score":100}}'::jsonb
  );
  v_mismatch := public.match_v2_weighted_score(
    '{"exact_product":{"score":80},"certification":{"score":0}}'::jsonb
  );
  if v_mismatch >= v_match then
    raise exception 'Certification mismatch must lower the weighted score';
  end if;

  if public.match_v2_quantity_score(1000, 500) <= 0
    or public.match_v2_quantity_score(1000, 500)
      >= public.match_v2_quantity_score(1000, 1000)
  then
    raise exception 'Quantity mismatch must lower, but not zero, the score';
  end if;

  if public.match_v2_weighted_score(
    '{"exact_product":{"score":null},"normalized_text":{"score":70}}'::jsonb
  ) <> 70 then
    raise exception 'Missing components must not create false confidence or zero penalties';
  end if;

  v_first := public.match_v2_weighted_score(
    '{"exact_product":{"score":91},"cpv":{"score":80},"country":{"score":100}}'::jsonb
  );
  v_second := public.match_v2_weighted_score(
    '{"country":{"score":100},"cpv":{"score":80},"exact_product":{"score":91}}'::jsonb
  );
  if v_first <> v_second then
    raise exception 'Match Score v2 must be deterministic';
  end if;
end
$unit_tests$;

create temporary table match_v2_test_tenants (
  ordinal integer primary key,
  company_id bigint,
  owner_id uuid not null,
  tender_id bigint,
  opportunity_match_id bigint
) on commit drop;

insert into match_v2_test_tenants (ordinal, owner_id)
values
  (1, gen_random_uuid()),
  (2, gen_random_uuid());

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
select
  owner_id,
  'authenticated',
  'authenticated',
  'match-v2-' || owner_id::text || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from match_v2_test_tenants;

with inserted as (
  insert into public.companies (
    owner_id,
    name,
    type,
    country,
    certifications,
    is_approved,
    is_active
  )
  select
    owner_id,
    'Match Score v2 test company ' || ordinal,
    'Medical device manufacturer',
    'Germany',
    'ISO 13485',
    true,
    true
  from match_v2_test_tenants
  order by ordinal
  returning id, owner_id
)
update match_v2_test_tenants tenant
set company_id = inserted.id
from inserted
where inserted.owner_id = tenant.owner_id;

do $fixture_gate$
begin
  if (
    select count(*)
    from match_v2_test_tenants
    where company_id is not null
  ) <> 2 then
    raise exception 'Tenant-isolation fixtures were not created';
  end if;
end
$fixture_gate$;

insert into public.company_match_profiles (
  company_id,
  target_countries,
  product_keywords,
  cpv_codes,
  certifications,
  profile_complete_score
)
select
  company_id,
  array['DE'],
  array['sterile nitrile examination glove'],
  array['33141420'],
  array['ISO 13485'],
  80
from match_v2_test_tenants
on conflict (company_id) do update set
  target_countries = excluded.target_countries,
  product_keywords = excluded.product_keywords,
  cpv_codes = excluded.cpv_codes,
  certifications = excluded.certifications,
  profile_complete_score = excluded.profile_complete_score;

insert into public.products (
  ref,
  name,
  category,
  description,
  company_id,
  is_active
)
select
  'match-v2-test-' || ordinal || '-' || gen_random_uuid()::text,
  'Sterile nitrile examination glove',
  'Medical gloves',
  'Powder-free sterile nitrile gloves packed 100 pieces per box',
  company_id,
  true
from match_v2_test_tenants;

with inserted as (
  insert into public.tenders (
    source,
    source_notice_id,
    title,
    description,
    country_code,
    country_name,
    cpv_codes,
    deadline_at,
    extracted_products,
    document_analysis_status,
    document_confidence_score,
    data_completeness_score,
    document_evidence_count,
    status
  )
  select
    'match-v2-test',
    'fixture-' || ordinal || '-' || gen_random_uuid()::text,
    'Sterile nitrile examination glove procurement',
    'Supply of sterile medical gloves in boxes',
    'DE',
    'Germany',
    array['33141420'],
    now() + interval '30 days',
    jsonb_build_array(jsonb_build_object(
      'product_name', 'Sterile nitrile examination glove',
      'packaging', '100 pieces per box',
      'required_certifications', jsonb_build_array('ISO 13485'),
      'technical_requirements', jsonb_build_array('powder-free nitrile'),
      'evidence', jsonb_build_array()
    )),
    'partial',
    70,
    65,
    0,
    'open'
  from match_v2_test_tenants
  order by ordinal
  returning id, source_notice_id
)
update match_v2_test_tenants tenant
set tender_id = inserted.id
from inserted
where split_part(inserted.source_notice_id, '-', 2)::integer = tenant.ordinal;

with inserted as (
  insert into public.opportunity_matches (
    company_id,
    opportunity_type,
    tender_id,
    match_score,
    confidence_score,
    keyword_score,
    geography_score,
    certification_score,
    category_score,
    generated_by
  )
  select
    company_id,
    'tender',
    tender_id,
    40,
    50,
    60,
    100,
    0,
    100,
    'match-v2-test'
  from match_v2_test_tenants
  returning id, company_id
)
update match_v2_test_tenants tenant
set opportunity_match_id = inserted.id
from inserted
where inserted.company_id = tenant.company_id;

select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

do $idempotency$
declare
  v_company_id bigint;
  v_tender_id bigint;
  v_first jsonb;
  v_second jsonb;
  v_legacy_score integer;
begin
  select company_id, tender_id
  into v_company_id, v_tender_id
  from match_v2_test_tenants
  where ordinal = 1;

  v_first := public.refresh_opportunity_match_score_v2(
    v_company_id,
    v_tender_id,
    null
  );
  v_second := public.refresh_opportunity_match_score_v2(
    v_company_id,
    v_tender_id,
    null
  );
  if coalesce((v_first ->> 'changed')::boolean, false) is not true
    or coalesce((v_second ->> 'changed')::boolean, true) is not false
  then
    raise exception 'Targeted Match Score v2 refresh is not idempotent';
  end if;
  if v_first ->> 'document_evidence_status' <> 'pending' then
    raise exception 'Missing document evidence must be explicitly pending';
  end if;
  if (v_first ->> 'data_completeness_score')::integer >= 100 then
    raise exception 'Missing components must reduce data completeness';
  end if;

  select match_score into v_legacy_score
  from public.opportunity_matches
  where company_id = v_company_id and tender_id = v_tender_id;
  if v_legacy_score <> 40 then
    raise exception 'V2 refresh modified the legacy match score';
  end if;
end
$idempotency$;

-- Create a comparison row for tenant two without running a full refresh.
insert into public.opportunity_match_scores_v2 (
  opportunity_match_id,
  company_id,
  tender_id,
  score_v2,
  previous_score,
  score_delta,
  confidence_score,
  data_completeness_score,
  document_evidence_status,
  components,
  input_snapshot,
  input_hash,
  scoring_version
)
select
  opportunity_match_id,
  company_id,
  tender_id,
  50,
  40,
  10,
  50,
  50,
  'pending',
  '{}'::jsonb,
  '{}'::jsonb,
  repeat('a', 64),
  'matching-score-v2.0.0'
from match_v2_test_tenants
where ordinal = 2;

select set_config(
  'medichall.test_tender_one',
  (select tender_id::text from match_v2_test_tenants where ordinal = 1),
  true
);
select set_config(
  'medichall.test_tender_two',
  (select tender_id::text from match_v2_test_tenants where ordinal = 2),
  true
);
select set_config(
  'medichall.test_company_one',
  (select company_id::text from match_v2_test_tenants where ordinal = 1),
  true
);
select set_config(
  'medichall.test_company_two',
  (select company_id::text from match_v2_test_tenants where ordinal = 2),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    (select owner_id from match_v2_test_tenants where ordinal = 1),
    'role',
    'authenticated'
  )::text,
  true
);
set local role authenticated;

do $tenant_one$
declare
  v_visible_own integer;
  v_visible_other integer;
  v_safe_score jsonb;
begin
  select count(*) into v_visible_own
  from public.opportunity_match_scores_v2
  where tender_id = current_setting('medichall.test_tender_one', true)::bigint;

  select count(*) into v_visible_other
  from public.opportunity_match_scores_v2
  where tender_id = current_setting('medichall.test_tender_two', true)::bigint;

  if v_visible_own <> 0 or v_visible_other <> 0 then
    raise exception 'Internal Match Score v2 rows are visible to an ordinary user';
  end if;

  v_safe_score := public.get_opportunity_match_score_v2(
    current_setting('medichall.test_company_one', true)::bigint,
    current_setting('medichall.test_tender_one', true)::bigint
  );
  if v_safe_score is null
    or v_safe_score ? 'input_snapshot'
    or v_safe_score ? 'input_hash'
    or v_safe_score ? 'score_trace_id'
  then
    raise exception 'Safe owner score RPC is missing or exposes internal diagnostics';
  end if;

  begin
    perform public.get_opportunity_match_score_v2(
      current_setting('medichall.test_company_two', true)::bigint,
      current_setting('medichall.test_tender_two', true)::bigint
    );
    raise exception 'Tenant one accessed tenant two score diagnostics';
  exception
    when insufficient_privilege then
      null;
    when raise_exception then
      if sqlerrm <> 'Access denied' then
        raise;
      end if;
  end;
end
$tenant_one$;

reset role;
rollback;

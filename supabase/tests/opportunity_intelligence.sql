-- Run after 202608090002_opportunity_intelligence.sql.
-- All tenant, tender, evidence, answer-cache, and usage fixtures are rolled back.

begin;

do $contract$
declare
  explanation jsonb;
begin
  if to_regclass('public.tender_question_answers') is null
    or to_regprocedure('public.get_tender_opportunity_intelligence_v1(bigint,bigint)') is null
    or to_regprocedure('public.reserve_tender_question_v1(uuid,bigint,bigint,text,text,text,text,integer)') is null
    or to_regprocedure('public.complete_tender_question_v1(uuid,bigint,text,text,text,jsonb,text,text,text,integer,integer,integer,numeric,text)') is null then
    raise exception 'Sprint 4 opportunity intelligence contract is incomplete';
  end if;
  if has_table_privilege('anon', 'public.tender_question_answers', 'SELECT')
    or has_table_privilege('authenticated', 'public.tender_question_answers', 'SELECT')
    or has_table_privilege('authenticated', 'public.tender_question_answers', 'INSERT') then
    raise exception 'Tender answer cache is browser-accessible';
  end if;
  if has_function_privilege('anon', 'public.get_tender_opportunity_intelligence_v1(bigint,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reserve_tender_question_v1(uuid,bigint,bigint,text,text,text,text,integer)', 'EXECUTE') then
    raise exception 'Opportunity intelligence RPC grants are too broad';
  end if;
  if not has_function_privilege('authenticated', 'public.get_tender_opportunity_intelligence_v1(bigint,bigint)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.reserve_tender_question_v1(uuid,bigint,bigint,text,text,text,text,integer)', 'EXECUTE') then
    raise exception 'Required Sprint 4 RPC grant is missing';
  end if;

  explanation := public.mm_build_match_explanation(
    50, 'low', 50, 50, 50, 50, 50, '{}'::jsonb, '{}'::jsonb
  );
  if jsonb_array_length(explanation -> 'top_reasons') <> 0
    or explanation #>> '{method,unknown_is_not_positive_evidence}' <> 'true'
    or exists (
      select 1 from jsonb_array_elements(explanation -> 'components') component
      where component ->> 'evidence_status' <> 'unknown'
    ) then
    raise exception 'Unknown profile fields were presented as supported evidence';
  end if;
end
$contract$;

create temporary table opportunity_intelligence_fixture (
  ordinal integer primary key,
  owner_id uuid not null,
  company_id bigint,
  tender_id bigint,
  opportunity_id bigint,
  document_id bigint
) on commit drop;

insert into opportunity_intelligence_fixture (ordinal, owner_id)
values
  (1, '40000000-0000-4000-8000-000000000001'),
  (2, '40000000-0000-4000-8000-000000000002');

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select owner_id, 'authenticated', 'authenticated',
       'opportunity-intelligence-' || ordinal || '@example.invalid',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       now(), now(), false, false
from opportunity_intelligence_fixture;

with inserted as (
  insert into public.companies (
    owner_id, name, type, country, certifications, is_approved, is_active
  )
  select owner_id, 'Opportunity Intelligence QA ' || ordinal,
         'Medical device manufacturer', 'Germany', 'CE MDR, ISO 13485',
         true, true
  from opportunity_intelligence_fixture
  order by ordinal
  returning id, owner_id
)
update opportunity_intelligence_fixture fixture
set company_id = inserted.id
from inserted
where inserted.owner_id = fixture.owner_id;

with inserted as (
  insert into public.tenders (
    source, source_notice_id, title, country_code, country_name, cpv_codes,
    product_keywords, status, document_analysis_status,
    document_confidence_score, data_completeness_score, extracted_products
  )
  select 'opportunity-intelligence-test', 'fixture-' || ordinal,
         'Synthetic sterile drape tender ' || ordinal, 'DE', 'Germany',
         array['33140000'], array['sterile drape'], 'open',
         case when ordinal = 1 then 'completed' else 'not_started' end,
         case when ordinal = 1 then 90 else 0 end,
         case when ordinal = 1 then 85 else 20 end,
         case when ordinal = 1 then '[{"product_name":"Sterile surgical drape","quantity_value":1000,"quantity_unit":"units","required_certifications":["CE MDR"]}]'::jsonb else '[]'::jsonb end
  from opportunity_intelligence_fixture
  order by ordinal
  returning id, source_notice_id
)
update opportunity_intelligence_fixture fixture
set tender_id = inserted.id
from inserted
where inserted.source_notice_id = 'fixture-' || fixture.ordinal;

with inserted as (
  insert into public.opportunity_matches (
    company_id, opportunity_type, tender_id, match_score, confidence_score,
    keyword_score, geography_score, certification_score, category_score,
    opportunity_score, confidence_level, missing_information, evidence,
    status, generated_by
  )
  select company_id, 'tender', tender_id,
         case when ordinal = 1 then 86 else 70 end,
         case when ordinal = 1 then 82 else 45 end,
         case when ordinal = 1 then 90 else 60 end, 100, 100, 100,
         case when ordinal = 1 then 86 else 70 end,
         case when ordinal = 1 then 'high' else 'low' end,
         case when ordinal = 1 then '{}'::text[] else array['Document evidence pending'] end,
         '[]'::jsonb, 'new', 'opportunity-intelligence-regression'
  from opportunity_intelligence_fixture
  returning id, company_id
)
update opportunity_intelligence_fixture fixture
set opportunity_id = inserted.id
from inserted
where inserted.company_id = fixture.company_id;

insert into public.opportunity_match_scores_v2 (
  opportunity_match_id, company_id, tender_id, score_v2, previous_score,
  score_delta, confidence_score, data_completeness_score,
  document_evidence_status, components, matched_reasons,
  missing_requirements, risk_indicators, input_snapshot, input_hash,
  scoring_version
)
select opportunity_id, company_id, tender_id,
       case when ordinal = 1 then 86 else 70 end,
       case when ordinal = 1 then 86 else 70 end, 0,
       case when ordinal = 1 then 82 else 45 end,
       case when ordinal = 1 then 85 else 20 end,
       case when ordinal = 1 then 'available' else 'pending' end,
       jsonb_build_object(
         'exact_product', jsonb_build_object(
           'score', case when ordinal = 1 then 100 else null end,
           'weight', 24,
           'source', 'company products and document-extracted product names'
         ),
         'country', jsonb_build_object('score', 100, 'weight', 8, 'source', 'structured country comparison')
       ),
       case when ordinal = 1 then '["Exact product match"]'::jsonb else '[]'::jsonb end,
       case when ordinal = 1 then '{}'::text[] else array['Document evidence pending'] end,
       '[]'::jsonb, '{}'::jsonb, repeat(ordinal::text, 64),
       'matching-score-v2.0.0'
from opportunity_intelligence_fixture;

with inserted as (
  insert into public.tender_documents (
    tender_id, title, file_name, file_url, mime_type, document_type
  )
  select tender_id, 'Synthetic specification', 'qa-specification.pdf',
         'https://example.invalid/qa-specification.pdf', 'application/pdf',
         'technical_specification'
  from opportunity_intelligence_fixture
  where ordinal = 1
  returning id, tender_id
)
update opportunity_intelligence_fixture fixture
set document_id = inserted.id
from inserted
where inserted.tender_id = fixture.tender_id;

insert into public.tender_document_evidence (
  tender_id, document_id, evidence_type, product_name, field_name,
  extracted_value, quantity_value, quantity_unit, lot_number, page_number,
  source_quote, confidence_score
)
select tender_id, document_id, 'product_requirement', 'Sterile surgical drape',
       'quantity', '1000 units', 1000, 'units', '1', 2,
       'Lot 1 requires 1000 sterile surgical drapes with CE MDR.', 94
from opportunity_intelligence_fixture
where ordinal = 1;

-- Persist fixture IDs in transaction-local settings after returning to the
-- migration runner role so authenticated RPC checks can use scalar values.
select set_config('medichall.company_one', (select company_id::text from opportunity_intelligence_fixture where ordinal = 1), true);
select set_config('medichall.company_two', (select company_id::text from opportunity_intelligence_fixture where ordinal = 2), true);
select set_config('medichall.tender_one', (select tender_id::text from opportunity_intelligence_fixture where ordinal = 1), true);
select set_config('medichall.tender_two', (select tender_id::text from opportunity_intelligence_fixture where ordinal = 2), true);

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

do $intelligence$
declare
  payload jsonb;
  denied boolean := false;
begin
  payload := public.get_tender_opportunity_intelligence_v1(
    current_setting('medichall.company_one')::bigint,
    current_setting('medichall.tender_one')::bigint
  );
  if payload ->> 'status' <> 'match'
    or payload ->> 'document_evidence_status' <> 'available'
    or payload #>> '{provenance,scoring_version}' <> 'matching-score-v2.0.0' then
    raise exception 'Strong evidenced fixture did not return a grounded MATCH';
  end if;
  begin
    perform public.get_tender_opportunity_intelligence_v1(
      current_setting('medichall.company_two')::bigint,
      current_setting('medichall.tender_two')::bigint
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'Cross-company opportunity intelligence leaked'; end if;
end
$intelligence$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $cache$
declare
  first_reservation jsonb;
  duplicate_reservation jsonb;
  cached_reservation jsonb;
  failed_reservation jsonb;
  failed_duplicate jsonb;
  denied boolean := false;
  answer_id uuid;
  failed_answer_id uuid;
begin
  first_reservation := public.reserve_tender_question_v1(
    '40000000-0000-4000-8000-000000000001',
    current_setting('medichall.company_one')::bigint,
    current_setting('medichall.tender_one')::bigint,
    'Which quantity is evidenced?', 'which quantity is evidenced?',
    repeat('a', 64), repeat('b', 64), 120
  );
  answer_id := (first_reservation ->> 'answer_id')::uuid;
  if not (first_reservation ->> 'should_execute')::boolean then
    raise exception 'First tender question did not acquire a provider lease';
  end if;
  duplicate_reservation := public.reserve_tender_question_v1(
    '40000000-0000-4000-8000-000000000001',
    current_setting('medichall.company_one')::bigint,
    current_setting('medichall.tender_one')::bigint,
    'Which quantity is evidenced?', 'which quantity is evidenced?',
    repeat('a', 64), repeat('b', 64), 120
  );
  if (duplicate_reservation ->> 'should_execute')::boolean
    or duplicate_reservation ->> 'status' <> 'processing' then
    raise exception 'Live lease allowed a duplicate provider request';
  end if;
  perform public.complete_tender_question_v1(
    answer_id, null, 'completed', 'The cited quantity is 1000 units [E1].',
    'Confirm the final official schedule.',
    '[{"id":"E1","kind":"evidence","label":"Quantity","excerpt":"1000 units"}]'::jsonb,
    'SyntheticProvider', 'synthetic-model', 'redacted-provider-id',
    100, 25, 125, 0.000100, null
  );
  cached_reservation := public.reserve_tender_question_v1(
    '40000000-0000-4000-8000-000000000001',
    current_setting('medichall.company_one')::bigint,
    current_setting('medichall.tender_one')::bigint,
    'Which quantity is evidenced?', 'which quantity is evidenced?',
    repeat('a', 64), repeat('b', 64), 120
  );
  if (cached_reservation ->> 'should_execute')::boolean
    or cached_reservation ->> 'cached' <> 'true'
    or jsonb_array_length(cached_reservation -> 'citations') <> 1 then
    raise exception 'Completed answer was not returned from the idempotent cache';
  end if;
  failed_reservation := public.reserve_tender_question_v1(
    '40000000-0000-4000-8000-000000000001',
    current_setting('medichall.company_one')::bigint,
    current_setting('medichall.tender_one')::bigint,
    'Which requirement failed?', 'which requirement failed?',
    repeat('e', 64), repeat('f', 64), 120
  );
  failed_answer_id := (failed_reservation ->> 'answer_id')::uuid;
  perform public.complete_tender_question_v1(
    failed_answer_id, null, 'failed', null, null, '[]'::jsonb,
    'SyntheticProvider', 'synthetic-model', 'redacted-failed-id',
    null, null, null, null, 'INVALID_PROVIDER_JSON'
  );
  failed_duplicate := public.reserve_tender_question_v1(
    '40000000-0000-4000-8000-000000000001',
    current_setting('medichall.company_one')::bigint,
    current_setting('medichall.tender_one')::bigint,
    'Which requirement failed?', 'which requirement failed?',
    repeat('e', 64), repeat('f', 64), 120
  );
  if (failed_duplicate ->> 'should_execute')::boolean
    or failed_duplicate ->> 'status' <> 'failed'
    or failed_duplicate ->> 'retry_after' is null then
    raise exception 'Immediate failed-question retry was not deduplicated';
  end if;
  if exists (
    select 1 from public.tender_question_answers
    where id = failed_answer_id
      and (input_tokens is not null or estimated_cost_usd is not null)
  ) then
    raise exception 'Unavailable failed-provider accounting was recorded as zero';
  end if;
  begin
    perform public.reserve_tender_question_v1(
      '40000000-0000-4000-8000-000000000001',
      current_setting('medichall.company_two')::bigint,
      current_setting('medichall.tender_two')::bigint,
      'Cross tenant?', 'cross tenant?', repeat('c', 64), repeat('d', 64), 120
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'Tender answer reservation crossed company ownership'; end if;
  if (select count(*) from public.tender_question_answers where question_hash = repeat('a', 64)) <> 1 then
    raise exception 'Idempotent tender question created duplicate cache rows';
  end if;
end
$cache$;

reset role;
rollback;

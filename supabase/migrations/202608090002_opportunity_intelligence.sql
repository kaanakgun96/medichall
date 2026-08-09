-- MedicHall Sprint 4: grounded opportunity intelligence and tender Q&A cache.

begin;

alter table public.medichall_ai_usage
  add column if not exists feature text,
  add column if not exists company_id bigint
    references public.companies(id) on delete set null,
  add column if not exists tender_id bigint
    references public.tenders(id) on delete set null,
  add column if not exists tender_import_id uuid
    references public.tender_imports(id) on delete set null,
  add column if not exists provider_name text,
  add column if not exists model_name text,
  add column if not exists request_key text,
  add column if not exists estimated_cost_usd numeric(14, 6)
    check (estimated_cost_usd is null or estimated_cost_usd >= 0);

create index if not exists medichall_ai_usage_feature_context_idx
  on public.medichall_ai_usage (
    feature,
    company_id,
    tender_id,
    created_at desc
  );

create table if not exists public.tender_question_answers (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  question text not null check (length(question) between 3 and 600),
  normalized_question text not null check (
    length(normalized_question) between 3 and 600
  ),
  question_hash text not null check (question_hash ~ '^[a-f0-9]{64}$'),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'processing' check (
    status in ('processing', 'completed', 'failed')
  ),
  answer text,
  uncertainty text,
  citations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(citations) = 'array'
  ),
  provider_name text,
  model_name text,
  provider_request_id text,
  usage_id bigint references public.medichall_ai_usage(id) on delete set null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  estimated_cost_usd numeric(14, 6) check (
    estimated_cost_usd is null or estimated_cost_usd >= 0
  ),
  attempt_count integer not null default 1 check (attempt_count > 0),
  lease_expires_at timestamptz,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tender_id, question_hash, context_hash),
  check (
    (status = 'completed' and answer is not null and completed_at is not null)
    or status in ('processing', 'failed')
  )
);

create index if not exists tender_question_answers_user_created_idx
  on public.tender_question_answers (requested_by, created_at desc);

create index if not exists tender_question_answers_processing_idx
  on public.tender_question_answers (lease_expires_at)
  where status = 'processing';

drop trigger if exists tender_question_answers_set_updated_at
  on public.tender_question_answers;
create trigger tender_question_answers_set_updated_at
before update on public.tender_question_answers
for each row execute function public.set_updated_at();

alter table public.tender_question_answers enable row level security;
alter table public.tender_question_answers force row level security;

revoke all on table public.tender_question_answers
from public, anon, authenticated;
grant select, insert, update, delete on table public.tender_question_answers
to service_role;

comment on table public.tender_question_answers is
  'Private, tenant-scoped cache for citation-grounded questions about one tender. Browser clients use the authenticated Edge Function and never access this table directly.';

create or replace function public.mm_build_match_explanation(
  p_match_score integer,
  p_confidence_level text,
  p_product_score integer,
  p_geography_score integer,
  p_partner_type_score integer,
  p_certification_score integer,
  p_commercial_score integer,
  p_reasons jsonb,
  p_risks jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $function$
  with components(key, reason_key, risk_key, label, score, weight) as (
    values
      ('product', 'products', 'products', 'Product compatibility', coalesce(p_product_score, 0), 40),
      ('geography', 'geography', 'geography', 'Market compatibility', coalesce(p_geography_score, 0), 20),
      ('partner_type', 'partner_type', 'partner_type', 'Company role compatibility', coalesce(p_partner_type_score, 0), 15),
      ('commercial', 'commercial', 'commercial', 'Business relevance', coalesce(p_commercial_score, 0), 15),
      ('certification', 'certifications', 'certifications', 'Certification compatibility', coalesce(p_certification_score, 0), 10)
  ),
  explained as (
    select
      key,
      label,
      score,
      weight,
      round(score * weight / 100.0, 1) as weighted_points,
      nullif(trim(coalesce(p_reasons ->> reason_key, '')), '') as reason,
      nullif(trim(coalesce(p_risks ->> risk_key, '')), '') as risk
    from components
  ),
  supported as (
    select * from explained where reason is not null
  ),
  top_drivers as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', key,
          'label', label,
          'score', score,
          'weight_percent', weight,
          'weighted_points', weighted_points,
          'reason', reason,
          'evidence_status', 'supported'
        )
        order by weighted_points desc, weight desc, label
      ),
      '[]'::jsonb
    ) as value
    from (
      select * from supported
      order by weighted_points desc, weight desc, label
      limit 3
    ) top_three
  ),
  all_components as (
    select jsonb_agg(
      jsonb_build_object(
        'key', key,
        'label', label,
        'score', score,
        'weight_percent', weight,
        'weighted_points', weighted_points,
        'evidence_status', case
          when reason is not null then 'supported'
          when risk is not null then 'risk'
          else 'unknown'
        end,
        'reason', coalesce(
          reason,
          risk,
          'No explicit structured profile evidence is available for this component.'
        )
      )
      order by weight desc, label
    ) as value
    from explained
  )
  select jsonb_build_object(
    'version', 2,
    'summary', case
      when (select count(*) from supported) = 0 then
        'Directional score only; complete both profiles before relying on this match.'
      when coalesce(p_match_score, 0) >= 85 then
        'Strong fit across the supported structured profile evidence.'
      when coalesce(p_match_score, 0) >= 70 then
        'Promising fit with points that should be validated together.'
      when coalesce(p_match_score, 0) >= 50 then
        'Possible fit; review the evidence gaps before engaging.'
      else
        'Limited supported fit; review the risks before engaging.'
    end,
    'score', coalesce(p_match_score, 0),
    'confidence', coalesce(p_confidence_level, 'low'),
    'confidence_note', case coalesce(p_confidence_level, 'low')
      when 'high' then
        'Both profiles contain enough structured fields for a higher-confidence signal.'
      when 'medium' then
        'The score uses partial profile data and must be validated in conversation.'
      else
        'Profile evidence is limited; this score is directional, not a guarantee.'
    end,
    'top_reasons', (select value from top_drivers),
    'components', (select value from all_components),
    'source_reasons', coalesce(p_reasons, '{}'::jsonb),
    'risk_signals', coalesce(p_risks, '{}'::jsonb),
    'method', jsonb_build_object(
      'product_weight_percent', 40,
      'geography_weight_percent', 20,
      'partner_type_weight_percent', 15,
      'commercial_weight_percent', 15,
      'certification_weight_percent', 10,
      'unknown_is_not_positive_evidence', true
    )
  );
$function$;

update public.matchmaking_matches
set explanation = public.mm_build_match_explanation(
  match_score,
  confidence_level,
  product_score,
  geography_score,
  partner_type_score,
  certification_score,
  commercial_score,
  reasons,
  risks
);

create or replace function public.get_tender_opportunity_intelligence_v1(
  p_company_id bigint,
  p_tender_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  opportunity public.opportunity_matches%rowtype;
  score public.opportunity_match_scores_v2%rowtype;
  tender public.tenders%rowtype;
  lot_payload jsonb := '{}'::jsonb;
  overall_score integer := 0;
  evidence_available boolean := false;
  result_status text := 'review_required';
  confidence integer := 0;
  summary text;
begin
  if not (
    public.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1 from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select match.* into opportunity
  from public.opportunity_matches match
  where match.company_id = p_company_id
    and match.tender_id = p_tender_id
    and match.opportunity_type = 'tender';

  if opportunity.id is null then
    raise exception 'Tender opportunity not found' using errcode = 'P0002';
  end if;

  select current_score.* into score
  from public.opportunity_match_scores_v2 current_score
  where current_score.company_id = p_company_id
    and current_score.tender_id = p_tender_id;

  select source.* into tender
  from public.tenders source
  where source.id = p_tender_id;

  select exists (
    select 1 from public.tender_document_evidence evidence
    where evidence.tender_id = p_tender_id
      and evidence.document_id is not null
  ) into evidence_available;

  lot_payload := public.get_tender_lot_matches_v1(p_company_id, p_tender_id);
  overall_score := greatest(0, least(100, coalesce(
    score.score_v2,
    opportunity.opportunity_score,
    opportunity.match_score,
    0
  )));
  confidence := greatest(0, least(100, coalesce(
    score.confidence_score,
    opportunity.confidence_score,
    0
  )));

  result_status := case
    when overall_score >= 80 and evidence_available and confidence >= 65
      then 'match'
    when overall_score >= 60 then 'possible_match'
    when overall_score >= 35 then 'review_required'
    else 'not_supported'
  end;

  summary := case result_status
    when 'match' then
      'Structured company data and available tender evidence support a strong match. Verify every requirement before deciding to bid.'
    when 'possible_match' then
      'The available data indicates a possible match, but evidence or company information is incomplete.'
    when 'review_required' then
      'Some relevance is present, but material gaps require review before this opportunity can be qualified.'
    else
      'The current company and tender evidence does not support this opportunity as a fit.'
  end;

  return jsonb_build_object(
    'version', 1,
    'company_id', p_company_id,
    'tender_id', p_tender_id,
    'opportunity_match_id', opportunity.id,
    'overall_score', overall_score,
    'status', result_status,
    'status_label', replace(initcap(replace(result_status, '_', ' ')), 'Match', 'Match'),
    'summary', summary,
    'confidence_score', confidence,
    'confidence_level', coalesce(opportunity.confidence_level, 'low'),
    'document_evidence_status', case
      when evidence_available then 'available'
      else 'pending'
    end,
    'components', case
      when score.opportunity_match_id is not null then score.components
      else coalesce(opportunity.evidence, '[]'::jsonb)
    end,
    'matched_reasons', case
      when score.opportunity_match_id is not null then score.matched_reasons
      else coalesce(opportunity.reasons, '[]'::jsonb)
    end,
    'missing_requirements', case
      when score.opportunity_match_id is not null
        then to_jsonb(coalesce(score.missing_requirements, '{}'::text[]))
      else to_jsonb(coalesce(opportunity.missing_information, '{}'::text[]))
    end,
    'risk_indicators', case
      when score.opportunity_match_id is not null then score.risk_indicators
      else '[]'::jsonb
    end,
    'tender', jsonb_build_object(
      'title', tender.title,
      'country_code', tender.country_code,
      'country_name', tender.country_name,
      'deadline_at', tender.deadline_at,
      'cpv_codes', tender.cpv_codes,
      'buyer_name', tender.buyer_name,
      'extracted_products', tender.extracted_products,
      'missing_information', tender.missing_information,
      'document_analysis_status', tender.document_analysis_status
    ),
    'lot_matches', lot_payload,
    'provenance', jsonb_build_object(
      'scoring_version', coalesce(score.scoring_version, opportunity.scoring_version),
      'input_hash', score.input_hash,
      'scored_at', score.scored_at,
      'explanation_version', opportunity.explanation_version,
      'lot_calculation_version', score.lot_match_calculation_version,
      'generated_at', opportunity.generated_at
    )
  );
end;
$function$;

comment on function public.get_tender_opportunity_intelligence_v1(bigint, bigint) is
  'Returns tenant-scoped deterministic tender match explanations, risks, gaps, provenance, and persisted lot evidence without invoking AI.';

revoke all on function public.get_tender_opportunity_intelligence_v1(bigint, bigint)
from public, anon;
grant execute on function public.get_tender_opportunity_intelligence_v1(bigint, bigint)
to authenticated, service_role;

create or replace function public.reserve_tender_question_v1(
  p_user_id uuid,
  p_company_id bigint,
  p_tender_id bigint,
  p_question text,
  p_normalized_question text,
  p_question_hash text,
  p_context_hash text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  cached public.tender_question_answers%rowtype;
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 300));
begin
  if p_user_id is null
    or not exists (
      select 1 from public.companies company
      where company.id = p_company_id
        and company.owner_id = p_user_id
    )
    or not exists (
      select 1 from public.opportunity_matches match
      where match.company_id = p_company_id
        and match.tender_id = p_tender_id
        and match.opportunity_type = 'tender'
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_question, ''))) not between 3 and 600
    or p_question_hash !~ '^[a-f0-9]{64}$'
    or p_context_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid question reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_tender_id::text || ':' ||
    p_question_hash || ':' || p_context_hash,
    0
  ));

  select answer.* into cached
  from public.tender_question_answers answer
  where answer.company_id = p_company_id
    and answer.tender_id = p_tender_id
    and answer.question_hash = p_question_hash
    and answer.context_hash = p_context_hash;

  if cached.id is not null and cached.status = 'completed' then
    return jsonb_build_object(
      'answer_id', cached.id,
      'should_execute', false,
      'status', 'completed',
      'cached', true,
      'answer', cached.answer,
      'uncertainty', cached.uncertainty,
      'citations', cached.citations,
      'input_tokens', cached.input_tokens,
      'output_tokens', cached.output_tokens,
      'total_tokens', cached.total_tokens,
      'estimated_cost_usd', cached.estimated_cost_usd
    );
  end if;

  if cached.id is not null
    and cached.status = 'processing'
    and cached.lease_expires_at > now()
  then
    return jsonb_build_object(
      'answer_id', cached.id,
      'should_execute', false,
      'status', 'processing',
      'cached', false
    );
  end if;

  if cached.id is null then
    insert into public.tender_question_answers (
      requested_by,
      company_id,
      tender_id,
      question,
      normalized_question,
      question_hash,
      context_hash,
      lease_expires_at
    ) values (
      p_user_id,
      p_company_id,
      p_tender_id,
      trim(p_question),
      trim(p_normalized_question),
      p_question_hash,
      p_context_hash,
      now() + make_interval(secs => lease_seconds)
    )
    returning * into cached;
  else
    update public.tender_question_answers answer
    set requested_by = p_user_id,
        question = trim(p_question),
        normalized_question = trim(p_normalized_question),
        status = 'processing',
        answer = null,
        uncertainty = null,
        citations = '[]'::jsonb,
        provider_name = null,
        model_name = null,
        provider_request_id = null,
        usage_id = null,
        input_tokens = null,
        output_tokens = null,
        total_tokens = null,
        estimated_cost_usd = null,
        error_code = null,
        completed_at = null,
        attempt_count = answer.attempt_count + 1,
        lease_expires_at = now() + make_interval(secs => lease_seconds),
        updated_at = now()
    where answer.id = cached.id
    returning * into cached;
  end if;

  return jsonb_build_object(
    'answer_id', cached.id,
    'should_execute', true,
    'status', 'processing',
    'cached', false,
    'attempt_count', cached.attempt_count
  );
end;
$function$;

create or replace function public.complete_tender_question_v1(
  p_answer_id uuid,
  p_usage_id bigint,
  p_status text,
  p_answer text default null,
  p_uncertainty text default null,
  p_citations jsonb default '[]'::jsonb,
  p_provider_name text default null,
  p_model_name text default null,
  p_provider_request_id text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_total_tokens integer default null,
  p_estimated_cost_usd numeric default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_status not in ('completed', 'failed')
    or jsonb_typeof(coalesce(p_citations, '[]'::jsonb)) <> 'array'
    or (p_status = 'completed' and nullif(trim(coalesce(p_answer, '')), '') is null)
  then
    raise exception 'Invalid tender answer completion' using errcode = '22023';
  end if;

  update public.tender_question_answers answer_row
  set status = p_status,
      answer = case when p_status = 'completed' then left(p_answer, 12000) else null end,
      uncertainty = case when p_status = 'completed' then left(p_uncertainty, 1200) else null end,
      citations = case when p_status = 'completed' then p_citations else '[]'::jsonb end,
      provider_name = left(p_provider_name, 80),
      model_name = left(p_model_name, 160),
      provider_request_id = left(p_provider_request_id, 200),
      usage_id = p_usage_id,
      input_tokens = greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
      total_tokens = greatest(coalesce(p_total_tokens, 0), 0),
      estimated_cost_usd = greatest(coalesce(p_estimated_cost_usd, 0), 0),
      error_code = case when p_status = 'failed' then left(p_error_code, 100) else null end,
      lease_expires_at = null,
      completed_at = case when p_status = 'completed' then now() else null end,
      updated_at = now()
  where answer_row.id = p_answer_id
    and answer_row.status = 'processing';

  if not found then
    raise exception 'Tender answer reservation not found' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.reserve_tender_question_v1(
  uuid, bigint, bigint, text, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.complete_tender_question_v1(
  uuid, bigint, text, text, text, jsonb, text, text, text,
  integer, integer, integer, numeric, text
) from public, anon, authenticated;
grant execute on function public.reserve_tender_question_v1(
  uuid, bigint, bigint, text, text, text, text, integer
) to service_role;
grant execute on function public.complete_tender_question_v1(
  uuid, bigint, text, text, text, jsonb, text, text, text,
  integer, integer, integer, numeric, text
) to service_role;

commit;

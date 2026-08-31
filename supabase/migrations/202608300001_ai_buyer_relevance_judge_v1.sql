-- AI Buyer Relevance Judge V1: feature-gated, tenant-scoped second-stage
-- commercial reasoning over verified Buyer Discovery evidence. The
-- deterministic evidence gate remains authoritative and provider failure is
-- a deterministic-result fallback.

begin;

do $preflight$
begin
  if to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.company_external_prospect_matches') is null
     or to_regprocedure('public.smart_product_resolver_request_authorized_v1(bigint,uuid)') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'AI Buyer Relevance Judge V1 preflight failed';
  end if;
end
$preflight$;

create table public.ai_buyer_relevance_judge_feature_state (
  singleton boolean primary key default true check (singleton),
  ai_buyer_judge_enabled boolean not null default false,
  judge_version text not null default 'AI_BUYER_RELEVANCE_JUDGE_V1' check (
    judge_version ~ '^AI_BUYER_RELEVANCE_JUDGE_V[0-9]+$'
  ),
  implementation_version text not null default 'AI_BUYER_RELEVANCE_JUDGE_V1_0'
    check (implementation_version ~ '^AI_BUYER_RELEVANCE_JUDGE_V[0-9]+_[0-9]+$'),
  model_name text not null default 'claude-haiku-4-5' check (
    length(model_name) between 3 and 100
  ),
  maximum_candidates_per_run integer not null default 30 check (
    maximum_candidates_per_run between 1 and 30
  ),
  maximum_candidates_per_batch integer not null default 5 check (
    maximum_candidates_per_batch between 1 and 10
  ),
  maximum_cost_usd_per_run numeric(12,6) not null default 0.090000 check (
    maximum_cost_usd_per_run between 0.001000 and 0.090000
  ),
  cache_ttl_days integer not null default 30 check (
    cache_ttl_days between 1 and 180
  ),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.ai_buyer_relevance_judge_feature_state(singleton)
values (true);

alter table public.ai_buyer_relevance_judge_feature_state enable row level security;
alter table public.ai_buyer_relevance_judge_feature_state force row level security;

create table public.buyer_relevance_judgments (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  discovery_run_id uuid references public.external_prospect_discovery_runs(id)
    on delete set null,
  candidate_key text not null check (candidate_key ~ '^[a-f0-9]{64}$'),
  candidate_name text not null check (length(candidate_name) between 2 and 180),
  candidate_domain text check (
    candidate_domain is null or (
      length(candidate_domain) between 3 and 253
      and candidate_domain !~* '(https?://|/|@)'
    )
  ),
  product_intent_key text not null check (product_intent_key ~ '^[a-f0-9]{64}$'),
  product_label text not null check (length(product_label) between 2 and 160),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  judge_version text not null check (
    judge_version ~ '^AI_BUYER_RELEVANCE_JUDGE_V[0-9]+$'
  ),
  implementation_version text not null check (
    implementation_version ~ '^AI_BUYER_RELEVANCE_JUDGE_V[0-9]+_[0-9]+$'
  ),
  model_name text not null check (length(model_name) between 3 and 100),
  status text not null default 'RESOLVING' check (
    status in ('RESOLVING', 'COMPLETED', 'FAILED')
  ),
  deterministic_grade text not null check (deterministic_grade in (
    'DIRECT_BUYER', 'ADJACENT_BUYER', 'PRODUCT_RELEVANT_NOT_BUYER',
    'GENERIC_SUPPORT', 'REJECTED'
  )),
  deterministic_score integer not null check (deterministic_score between 0 and 100),
  ai_recommended_grade text check (ai_recommended_grade is null or ai_recommended_grade in (
    'DIRECT_BUYER', 'ADJACENT_BUYER', 'PRODUCT_RELEVANT_NOT_BUYER', 'REJECTED'
  )),
  final_grade text check (final_grade is null or final_grade in (
    'DIRECT_BUYER', 'ADJACENT_BUYER', 'PRODUCT_RELEVANT_NOT_BUYER',
    'GENERIC_SUPPORT', 'REJECTED'
  )),
  buyer_fit_score integer check (buyer_fit_score is null or buyer_fit_score between 0 and 100),
  structured_result jsonb check (
    structured_result is null or (
      jsonb_typeof(structured_result) = 'object'
      and octet_length(structured_result::text) <= 8192
      and structured_result::text !~* '(https?://|www\.|email|e-mail|phone|telephone|whatsapp|linkedin|api[_ -]?key|password|secret|system prompt)'
    )
  ),
  provider_request_id text check (
    provider_request_id is null or length(provider_request_id) between 3 and 160
  ),
  input_tokens integer check (input_tokens is null or input_tokens between 0 and 12000),
  output_tokens integer check (output_tokens is null or output_tokens between 0 and 4000),
  total_tokens integer check (total_tokens is null or total_tokens between 0 and 16000),
  estimated_cost_usd numeric(12,6) check (
    estimated_cost_usd is null or estimated_cost_usd between 0 and 0.015000
  ),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 30000),
  attempt_count integer not null default 1 check (attempt_count between 1 and 10000),
  cache_hit_count integer not null default 0 check (cache_hit_count between 0 and 1000000),
  last_cache_hit_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,100}$'
  ),
  expires_at timestamptz not null default clock_timestamp() + interval '45 seconds',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (
    company_id, candidate_key, product_intent_key, evidence_fingerprint,
    judge_version, model_name
  )
);

create index buyer_relevance_judgments_company_idx
on public.buyer_relevance_judgments(company_id, updated_at desc);
create index buyer_relevance_judgments_cache_idx
on public.buyer_relevance_judgments(status, expires_at);
create index buyer_relevance_judgments_run_idx
on public.buyer_relevance_judgments(discovery_run_id)
where discovery_run_id is not null;

create trigger buyer_relevance_judgments_set_updated_at
before update on public.buyer_relevance_judgments
for each row execute function public.set_updated_at();

alter table public.buyer_relevance_judgments enable row level security;
alter table public.buyer_relevance_judgments force row level security;

alter table public.company_external_prospect_matches
  add column buyer_fit_score integer,
  add column buyer_fit_grade text,
  add column ai_buyer_judge_status text not null default 'DISABLED',
  add column ai_buyer_recommended_grade text,
  add column ai_buyer_reason_codes jsonb not null default '[]'::jsonb,
  add column ai_buyer_short_explanation text;

update public.company_external_prospect_matches
set buyer_fit_score=relevance_score,
    buyer_fit_grade=case
      when relevance_score >= 75 then 'HIGH'
      when relevance_score >= 60 then 'MEDIUM'
      else 'LOW'
    end
where buyer_fit_score is null or buyer_fit_grade is null;

alter table public.company_external_prospect_matches
  alter column buyer_fit_score set not null,
  alter column buyer_fit_grade set not null,
  add constraint company_external_matches_buyer_fit_score_check
    check (buyer_fit_score between 0 and 100),
  add constraint company_external_matches_buyer_fit_grade_check
    check (buyer_fit_grade in ('HIGH','MEDIUM','LOW')),
  add constraint company_external_matches_ai_judge_status_check
    check (ai_buyer_judge_status in (
      'NOT_ELIGIBLE','DISABLED','CACHED','REVIEWED',
      'NOT_SELECTED_FALLBACK','IN_PROGRESS_FALLBACK',
      'RECENT_FAILURE_FALLBACK','AI_JUDGE_FAILED_FALLBACK'
    )),
  add constraint company_external_matches_ai_grade_check
    check (ai_buyer_recommended_grade is null or ai_buyer_recommended_grade in (
      'DIRECT_BUYER','ADJACENT_BUYER','PRODUCT_RELEVANT_NOT_BUYER','REJECTED'
    )),
  add constraint company_external_matches_ai_reason_codes_check check (
    jsonb_typeof(ai_buyer_reason_codes)='array'
    and jsonb_array_length(ai_buyer_reason_codes) <= 6
    and octet_length(ai_buyer_reason_codes::text) <= 2048
  ),
  add constraint company_external_matches_ai_explanation_check check (
    ai_buyer_short_explanation is null or (
      length(ai_buyer_short_explanation) between 3 and 320
      and ai_buyer_short_explanation !~* '(https?://|www\.|email|e-mail|phone|telephone|whatsapp|linkedin|api[_ -]?key|password|secret)'
    )
  );

create index company_external_matches_buyer_fit_idx
on public.company_external_prospect_matches(
  company_id,workflow_status,buyer_fit_score desc,last_scored_at desc
);

alter table public.external_prospect_discovery_runs
  drop constraint if exists external_prospect_discovery_runs_ai_classifications_check,
  drop constraint if exists external_prospect_discovery_runs_provider_requests_check,
  drop constraint if exists external_prospect_runs_provider_requests_bounded_check,
  drop constraint if exists external_prospect_discovery_runs_estimated_cost_usd_check;

alter table public.external_prospect_discovery_runs
  add constraint external_prospect_discovery_runs_ai_classifications_check
    check (ai_classifications between 0 and 30),
  add constraint external_prospect_discovery_runs_provider_requests_check
    check (provider_requests between 0 and 16),
  add constraint external_prospect_discovery_runs_estimated_cost_usd_check
    check (estimated_cost_usd between 0 and 0.150000);

create or replace function public.reserve_ai_buyer_relevance_judgment_v1(
  p_company_id bigint,
  p_requested_by uuid,
  p_discovery_run_id uuid,
  p_candidate_key text,
  p_candidate_name text,
  p_candidate_domain text,
  p_product_intent_key text,
  p_product_label text,
  p_evidence_fingerprint text,
  p_judge_version text,
  p_implementation_version text,
  p_model_name text,
  p_deterministic_grade text,
  p_deterministic_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_feature public.ai_buyer_relevance_judge_feature_state%rowtype;
  v_cache public.buyer_relevance_judgments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if not public.smart_product_resolver_request_authorized_v1(
    p_company_id, p_requested_by
  ) or not exists (
    select 1 from public.external_prospect_discovery_runs run
    where run.id=p_discovery_run_id and run.company_id=p_company_id
  ) then
    raise exception 'Company access denied' using errcode='42501';
  end if;
  select * into v_feature
  from public.ai_buyer_relevance_judge_feature_state where singleton;
  if v_feature.singleton is null or not v_feature.ai_buyer_judge_enabled then
    return jsonb_build_object('decision','DISABLED','enabled',false);
  end if;
  if p_candidate_key !~ '^[a-f0-9]{64}$'
     or p_product_intent_key !~ '^[a-f0-9]{64}$'
     or p_evidence_fingerprint !~ '^[a-f0-9]{64}$'
     or p_judge_version <> v_feature.judge_version
     or p_implementation_version <> v_feature.implementation_version
     or p_model_name <> v_feature.model_name
     or length(trim(coalesce(p_candidate_name,''))) not between 2 and 180
     or length(trim(coalesce(p_product_label,''))) not between 2 and 160
     or p_deterministic_grade not in (
       'DIRECT_BUYER','ADJACENT_BUYER','PRODUCT_RELEVANT_NOT_BUYER',
       'GENERIC_SUPPORT','REJECTED'
     ) or p_deterministic_score not between 0 and 100 then
    raise exception 'Invalid AI Buyer Judge reservation' using errcode='22023';
  end if;
  if p_candidate_domain is not null and (
    length(p_candidate_domain) not between 3 and 253
    or p_candidate_domain ~* '(https?://|/|@)'
  ) then
    raise exception 'Invalid AI Buyer Judge candidate domain' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ai-buyer-judge:' || p_company_id::text || ':' || p_candidate_key || ':' ||
    p_product_intent_key || ':' || p_evidence_fingerprint || ':' ||
    p_judge_version || ':' || p_model_name,
    300001
  ));
  select * into v_cache from public.buyer_relevance_judgments cache
  where cache.company_id=p_company_id
    and cache.candidate_key=p_candidate_key
    and cache.product_intent_key=p_product_intent_key
    and cache.evidence_fingerprint=p_evidence_fingerprint
    and cache.judge_version=p_judge_version
    and cache.model_name=p_model_name
  for update;
  if v_cache.id is not null and v_cache.status='COMPLETED'
     and v_cache.expires_at > clock_timestamp() then
    update public.buyer_relevance_judgments set
      discovery_run_id=p_discovery_run_id,
      requested_by=p_requested_by,
      cache_hit_count=cache_hit_count+1,
      last_cache_hit_at=clock_timestamp(),
      updated_at=clock_timestamp()
    where id=v_cache.id;
    return jsonb_build_object(
      'decision','CACHED','enabled',true,'cache_id',v_cache.id,
      'structured_result',v_cache.structured_result,
      'estimated_cost_usd',0
    );
  end if;
  if v_cache.id is not null and v_cache.status='RESOLVING'
     and v_cache.updated_at > clock_timestamp() - interval '45 seconds' then
    return jsonb_build_object(
      'decision','IN_PROGRESS','enabled',true,'cache_id',v_cache.id
    );
  end if;
  if v_cache.id is not null and v_cache.status='FAILED'
     and v_cache.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'decision','RECENT_FAILURE','enabled',true,'cache_id',v_cache.id
    );
  end if;

  insert into public.buyer_relevance_judgments(
    company_id,requested_by,discovery_run_id,candidate_key,candidate_name,
    candidate_domain,product_intent_key,product_label,evidence_fingerprint,
    judge_version,implementation_version,model_name,status,
    deterministic_grade,deterministic_score,expires_at
  ) values (
    p_company_id,p_requested_by,p_discovery_run_id,p_candidate_key,
    trim(p_candidate_name),nullif(lower(trim(coalesce(p_candidate_domain,''))),''),
    p_product_intent_key,trim(p_product_label),p_evidence_fingerprint,
    p_judge_version,p_implementation_version,p_model_name,'RESOLVING',
    p_deterministic_grade,p_deterministic_score,
    clock_timestamp()+interval '45 seconds'
  ) on conflict (
    company_id,candidate_key,product_intent_key,evidence_fingerprint,
    judge_version,model_name
  ) do update set
    requested_by=excluded.requested_by,
    discovery_run_id=excluded.discovery_run_id,
    candidate_name=excluded.candidate_name,
    candidate_domain=excluded.candidate_domain,
    product_label=excluded.product_label,
    implementation_version=excluded.implementation_version,
    status='RESOLVING',structured_result=null,provider_request_id=null,
    input_tokens=null,output_tokens=null,total_tokens=null,
    estimated_cost_usd=null,latency_ms=null,ai_recommended_grade=null,
    final_grade=null,buyer_fit_score=null,last_error_code=null,
    attempt_count=public.buyer_relevance_judgments.attempt_count+1,
    expires_at=clock_timestamp()+interval '45 seconds',
    updated_at=clock_timestamp()
  returning * into v_cache;
  return jsonb_build_object(
    'decision','PROCEED','enabled',true,'cache_id',v_cache.id,
    'maximum_candidates_per_run',v_feature.maximum_candidates_per_run,
    'maximum_candidates_per_batch',v_feature.maximum_candidates_per_batch,
    'maximum_cost_usd_per_run',v_feature.maximum_cost_usd_per_run
  );
end
$function$;

create or replace function public.complete_ai_buyer_relevance_judgment_v1(
  p_cache_id uuid,
  p_structured_result jsonb,
  p_ai_recommended_grade text,
  p_final_grade text,
  p_buyer_fit_score integer,
  p_model_name text,
  p_provider_request_id text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_estimated_cost_usd numeric,
  p_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2200ms'
as $function$
declare
  v_cache public.buyer_relevance_judgments%rowtype;
  v_feature public.ai_buyer_relevance_judge_feature_state%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into v_cache from public.buyer_relevance_judgments
  where id=p_cache_id for update;
  if v_cache.id is null or v_cache.status <> 'RESOLVING' then
    raise exception 'AI Buyer Judge reservation unavailable' using errcode='22023';
  end if;
  if jsonb_typeof(p_structured_result) <> 'object'
     or octet_length(p_structured_result::text) > 8192
     or p_structured_result::text ~* '(https?://|www\.|email|e-mail|phone|telephone|whatsapp|linkedin|api[_ -]?key|password|secret|system prompt)'
     or p_structured_result->>'candidate_id' !~ '^[a-f0-9]{24}$'
     or p_structured_result->>'candidate_id' <> left(v_cache.candidate_key,24)
     or coalesce(p_structured_result->>'product_fit','') not in ('HIGH','MEDIUM','LOW')
     or coalesce(p_structured_result->>'buyer_role','') not in (
       'DISTRIBUTOR','IMPORTER','WHOLESALER','TENDER_SUPPLIER',
       'PROCUREMENT_ORGANIZATION','HOSPITAL_BUYER','OEM_PRIVATE_LABEL',
       'ASSEMBLER','MANUFACTURER_ONLY','RESELLER','UNKNOWN'
     )
     or coalesce(p_structured_result->>'buyer_role_confidence','') not in ('HIGH','MEDIUM','LOW')
     or coalesce(p_structured_result->>'commercial_fit','') not in ('HIGH','MEDIUM','LOW')
     or coalesce(p_structured_result->>'sales_actionability','') not in ('HIGH','MEDIUM','LOW')
     or coalesce(p_structured_result->>'contradiction','') not in ('NONE','WEAK','STRONG')
     or coalesce(p_structured_result->>'recommended_grade','') not in (
       'DIRECT_BUYER','ADJACENT_BUYER','PRODUCT_RELEVANT_NOT_BUYER','REJECTED'
     )
     or coalesce(p_structured_result->>'buyer_fit_score','') !~ '^[0-9]{1,3}$'
     or (p_structured_result->>'buyer_fit_score')::integer not between 0 and 100
     or jsonb_typeof(p_structured_result->'reason_codes') <> 'array'
     or jsonb_array_length(p_structured_result->'reason_codes') > 6
     or exists (
       select 1 from jsonb_array_elements_text(
         p_structured_result->'reason_codes'
       ) reason_code
       where reason_code not in (
         'EXACT_PRODUCT_PROCUREMENT','MEDICAL_DISTRIBUTOR_PRODUCT_MATCH',
         'TENDER_SUPPLIER_PRODUCT_MATCH','HOSPITAL_PROCUREMENT_PRODUCT_MATCH',
         'OEM_SOURCING_SIGNAL','ASSEMBLY_SOURCING_SIGNAL',
         'PRODUCT_FAMILY_ADJACENCY','MANUFACTURER_ONLY_NO_BUYER_SIGNAL',
         'PRODUCT_MATCH_BUYER_ROLE_WEAK','NON_MEDICAL_CONTEXT',
         'UNRELATED_PROCUREMENT','EDITORIAL_ONLY','HISTORICAL_EVIDENCE',
         'INSUFFICIENT_VERIFIED_EVIDENCE'
       )
     )
     or length(coalesce(p_structured_result->>'short_explanation','')) not between 3 and 320 then
    raise exception 'Malformed AI Buyer Judge result' using errcode='22023';
  end if;
  if p_ai_recommended_grade not in (
       'DIRECT_BUYER','ADJACENT_BUYER','PRODUCT_RELEVANT_NOT_BUYER','REJECTED'
     ) or p_final_grade not in (
       'DIRECT_BUYER','ADJACENT_BUYER','PRODUCT_RELEVANT_NOT_BUYER',
       'GENERIC_SUPPORT','REJECTED'
     ) or p_buyer_fit_score not between 0 and 100
     or p_ai_recommended_grade <> p_structured_result->>'recommended_grade'
     or p_model_name <> v_cache.model_name
     or p_input_tokens not between 0 and 12000
     or p_output_tokens not between 0 and 4000
     or p_total_tokens <> p_input_tokens+p_output_tokens
     or p_estimated_cost_usd not between 0 and 0.015000
     or p_latency_ms not between 0 and 30000 then
    raise exception 'Invalid AI Buyer Judge usage metadata' using errcode='22023';
  end if;
  select * into v_feature
  from public.ai_buyer_relevance_judge_feature_state where singleton;
  update public.buyer_relevance_judgments set
    status='COMPLETED',structured_result=p_structured_result,
    ai_recommended_grade=p_ai_recommended_grade,final_grade=p_final_grade,
    buyer_fit_score=p_buyer_fit_score,
    provider_request_id=nullif(left(trim(coalesce(p_provider_request_id,'')),160),''),
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,
    total_tokens=p_total_tokens,estimated_cost_usd=p_estimated_cost_usd,
    latency_ms=p_latency_ms,last_error_code=null,
    expires_at=clock_timestamp()+make_interval(days=>v_feature.cache_ttl_days),
    updated_at=clock_timestamp()
  where id=p_cache_id returning * into v_cache;
  return jsonb_build_object(
    'cache_id',v_cache.id,'status',v_cache.status,'expires_at',v_cache.expires_at
  );
end
$function$;

create or replace function public.fail_ai_buyer_relevance_judgment_v1(
  p_cache_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1200ms'
as $function$
declare
  v_error text := upper(regexp_replace(
    coalesce(p_error_code,''),'[^A-Za-z0-9_]','_','g'
  ));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if v_error !~ '^[A-Z0-9_]{2,100}$' then
    v_error := 'AI_BUYER_JUDGE_FAILED';
  end if;
  update public.buyer_relevance_judgments set
    status='FAILED',structured_result=null,last_error_code=left(v_error,100),
    expires_at=clock_timestamp()+interval '5 minutes',
    updated_at=clock_timestamp()
  where id=p_cache_id and status='RESOLVING';
end
$function$;

create or replace function public.get_ai_buyer_relevance_judge_diagnostics_v1(
  p_company_id bigint,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1800ms'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode='42501';
  end if;
  select jsonb_build_object(
    'company_id',p_company_id,
    'judgments',coalesce((
      select jsonb_agg(to_jsonb(item) order by item.updated_at desc)
      from (
        select judgment.candidate_name,judgment.candidate_domain,
          judgment.product_label,judgment.deterministic_grade,
          judgment.ai_recommended_grade,judgment.final_grade,
          judgment.buyer_fit_score,
          judgment.structured_result->'reason_codes' as reason_codes,
          judgment.structured_result->>'short_explanation' as short_explanation,
          judgment.judge_version,judgment.implementation_version,
          judgment.model_name,judgment.estimated_cost_usd,
          judgment.latency_ms,judgment.cache_hit_count,judgment.status,
          judgment.last_error_code,judgment.updated_at
        from public.buyer_relevance_judgments judgment
        where judgment.company_id=p_company_id
        order by judgment.updated_at desc
        limit least(greatest(coalesce(p_limit,50),1),100)
      ) item
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;

revoke all on table public.ai_buyer_relevance_judge_feature_state,
  public.buyer_relevance_judgments
from public,anon,authenticated,service_role;
grant select on table public.ai_buyer_relevance_judge_feature_state,
  public.buyer_relevance_judgments to service_role;

revoke all on function
  public.reserve_ai_buyer_relevance_judgment_v1(
    bigint,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer
  ),
  public.complete_ai_buyer_relevance_judgment_v1(
    uuid,jsonb,text,text,integer,text,text,integer,integer,integer,numeric,integer
  ),
  public.fail_ai_buyer_relevance_judgment_v1(uuid,text),
  public.get_ai_buyer_relevance_judge_diagnostics_v1(bigint,integer)
from public,anon,authenticated,service_role;

grant execute on function
  public.reserve_ai_buyer_relevance_judgment_v1(
    bigint,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer
  ),
  public.complete_ai_buyer_relevance_judgment_v1(
    uuid,jsonb,text,text,integer,text,text,integer,integer,integer,numeric,integer
  ),
  public.fail_ai_buyer_relevance_judgment_v1(uuid,text)
to service_role;
grant execute on function
  public.get_ai_buyer_relevance_judge_diagnostics_v1(bigint,integer)
to authenticated,service_role;

comment on table public.ai_buyer_relevance_judge_feature_state is
  'Server-controlled AI Buyer Relevance Judge policy. Disabled by default and independent of Smart Resolver and Customer Fresh.';
comment on table public.buyer_relevance_judgments is
  'Tenant-scoped cache and audit metadata for second-stage AI commercial reasoning over bounded verified public evidence. Contains no contacts, prompts, private messages or private profile data.';

commit;

-- Adaptive Medical Commercial Retrieval V1: independently gated, globally
-- reusable medical terminology intelligence. No tenant, buyer or contact data.

begin;

do $preflight$
begin
  if to_regclass('public.smart_product_resolver_feature_state') is null
     or to_regclass('public.buyer_discovery_search_spaces') is null
     or to_regclass('public.buyer_discovery_partitions') is null then
    raise exception 'Adaptive Medical Commercial Retrieval V1 preflight failed';
  end if;
end
$preflight$;

create table public.adaptive_medical_retrieval_feature_state (
  singleton boolean primary key default true check (singleton),
  adaptive_medical_commercial_retrieval_enabled boolean not null default false,
  retrieval_version text not null
    default 'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V1'
    check (retrieval_version ~ '^ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V[0-9]+$'),
  implementation_version text not null
    default 'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V1_0'
    check (length(implementation_version) between 8 and 100),
  model_name text not null default 'claude-haiku-4-5'
    check (length(model_name) between 3 and 100),
  cache_ttl_days integer not null default 90
    check (cache_ttl_days between 1 and 365),
  maximum_cost_usd numeric(12,6) not null default 0.005000
    check (maximum_cost_usd between 0 and 0.005000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.adaptive_medical_retrieval_feature_state(singleton)
values (true);

alter table public.adaptive_medical_retrieval_feature_state enable row level security;
alter table public.adaptive_medical_retrieval_feature_state force row level security;

create table public.adaptive_medical_retrieval_cache (
  id uuid primary key default gen_random_uuid(),
  retrieval_key_hash text not null check (retrieval_key_hash ~ '^[a-f0-9]{64}$'),
  canonical_concept text not null check (length(canonical_concept) between 3 and 120),
  product_family text not null check (length(product_family) between 3 and 120),
  resolver_version text not null check (length(resolver_version) between 3 and 100),
  retrieval_version text not null check (
    retrieval_version ~ '^ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V[0-9]+$'
  ),
  implementation_version text not null check (
    length(implementation_version) between 8 and 100
  ),
  requested_model_name text not null check (
    length(requested_model_name) between 3 and 100
  ),
  status text not null default 'RESOLVING'
    check (status in ('RESOLVING', 'COMPLETED', 'FAILED')),
  structured_result jsonb check (
    structured_result is null or (
      jsonb_typeof(structured_result) = 'object'
      and octet_length(structured_result::text) <= 16384
      and structured_result::text !~* '(https?://|www\.|email|phone|whatsapp|linkedin|api[_ -]?key|password|secret|system prompt)'
    )
  ),
  model_name text check (model_name is null or length(model_name) between 3 and 100),
  provider_request_id text check (
    provider_request_id is null or length(provider_request_id) between 3 and 160
  ),
  input_tokens integer check (input_tokens is null or input_tokens between 0 and 10000),
  output_tokens integer check (output_tokens is null or output_tokens between 0 and 2000),
  total_tokens integer check (total_tokens is null or total_tokens between 0 and 12000),
  estimated_cost_usd numeric(12,6) check (
    estimated_cost_usd is null or estimated_cost_usd between 0 and 0.005000
  ),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 30000),
  attempt_count integer not null default 1 check (attempt_count between 1 and 1000),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,100}$'
  ),
  expires_at timestamptz not null default clock_timestamp() + interval '30 seconds',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (retrieval_key_hash, resolver_version, retrieval_version)
);

create index adaptive_medical_retrieval_cache_expiry_idx
on public.adaptive_medical_retrieval_cache(status, expires_at);

create trigger adaptive_medical_retrieval_cache_set_updated_at
before update on public.adaptive_medical_retrieval_cache
for each row execute function public.set_updated_at();

alter table public.adaptive_medical_retrieval_cache enable row level security;
alter table public.adaptive_medical_retrieval_cache force row level security;

-- Existing maxima are 10 Public Web requests plus six AI Buyer Judge batches.
-- Adaptive vocabulary adds at most one independent cold-cache AI request; it
-- does not raise either discovery-provider execution ceiling.
alter table public.external_prospect_discovery_runs
  drop constraint if exists external_prospect_discovery_runs_provider_requests_check,
  drop constraint if exists external_prospect_discovery_runs_estimated_cost_usd_check;
alter table public.external_prospect_discovery_runs
  add constraint external_prospect_discovery_runs_provider_requests_check
    check (provider_requests between 0 and 17),
  add constraint external_prospect_discovery_runs_estimated_cost_usd_check
    check (estimated_cost_usd between 0 and 0.155000);

create or replace function public.reserve_adaptive_medical_retrieval_v1(
  p_retrieval_key_hash text,
  p_canonical_concept text,
  p_product_family text,
  p_resolver_version text,
  p_retrieval_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1800ms'
as $function$
declare
  v_feature public.adaptive_medical_retrieval_feature_state%rowtype;
  v_cache public.adaptive_medical_retrieval_cache%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_feature
  from public.adaptive_medical_retrieval_feature_state where singleton;
  if v_feature.singleton is null
     or not v_feature.adaptive_medical_commercial_retrieval_enabled then
    return jsonb_build_object(
      'decision', 'DISABLED', 'enabled', false,
      'retrieval_version', coalesce(
        v_feature.retrieval_version,
        'ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_V1'
      )
    );
  end if;
  if p_retrieval_key_hash !~ '^[a-f0-9]{64}$'
     or length(trim(coalesce(p_canonical_concept, ''))) not between 3 and 120
     or length(trim(coalesce(p_product_family, ''))) not between 3 and 120
     or length(trim(coalesce(p_resolver_version, ''))) not between 3 and 100
     or p_retrieval_version <> v_feature.retrieval_version then
    raise exception 'Invalid adaptive retrieval reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'adaptive-medical-retrieval:' || p_retrieval_key_hash || ':' ||
      p_resolver_version || ':' || p_retrieval_version,
      831001
    )
  );
  select * into v_cache from public.adaptive_medical_retrieval_cache cache
  where cache.retrieval_key_hash = p_retrieval_key_hash
    and cache.resolver_version = p_resolver_version
    and cache.retrieval_version = p_retrieval_version
  for update;
  if v_cache.id is not null and v_cache.status = 'COMPLETED'
     and v_cache.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'decision', 'CACHED', 'enabled', true, 'cache_id', v_cache.id,
      'structured_result', v_cache.structured_result,
      'retrieval_version', v_cache.retrieval_version,
      'implementation_version', v_feature.implementation_version,
      'model_name', v_cache.model_name, 'estimated_cost_usd', 0
    );
  end if;
  if v_cache.id is not null and v_cache.status = 'RESOLVING'
     and v_cache.updated_at > clock_timestamp() - interval '30 seconds' then
    return jsonb_build_object(
      'decision', 'IN_PROGRESS', 'enabled', true, 'cache_id', v_cache.id
    );
  end if;
  if v_cache.id is not null and v_cache.status = 'FAILED'
     and v_cache.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'decision', 'RECENT_FAILURE', 'enabled', true, 'cache_id', v_cache.id
    );
  end if;

  insert into public.adaptive_medical_retrieval_cache(
    retrieval_key_hash, canonical_concept, product_family,
    resolver_version, retrieval_version, implementation_version,
    requested_model_name, status, expires_at
  ) values (
    p_retrieval_key_hash, trim(p_canonical_concept), trim(p_product_family),
    trim(p_resolver_version), p_retrieval_version,
    v_feature.implementation_version, v_feature.model_name, 'RESOLVING',
    clock_timestamp() + interval '30 seconds'
  ) on conflict (retrieval_key_hash, resolver_version, retrieval_version)
  do update set
    canonical_concept = excluded.canonical_concept,
    product_family = excluded.product_family,
    implementation_version = excluded.implementation_version,
    requested_model_name = excluded.requested_model_name,
    status = 'RESOLVING', structured_result = null, model_name = null,
    provider_request_id = null, input_tokens = null, output_tokens = null,
    total_tokens = null, estimated_cost_usd = null, latency_ms = null,
    last_error_code = null,
    attempt_count = public.adaptive_medical_retrieval_cache.attempt_count + 1,
    expires_at = clock_timestamp() + interval '30 seconds',
    updated_at = clock_timestamp()
  returning * into v_cache;
  return jsonb_build_object(
    'decision', 'PROCEED', 'enabled', true, 'cache_id', v_cache.id,
    'retrieval_version', v_cache.retrieval_version,
    'implementation_version', v_feature.implementation_version,
    'model_name', v_feature.model_name,
    'maximum_cost_usd', v_feature.maximum_cost_usd,
    'cache_ttl_days', v_feature.cache_ttl_days
  );
end
$function$;

create or replace function public.complete_adaptive_medical_retrieval_v1(
  p_cache_id uuid,
  p_structured_result jsonb,
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
set statement_timeout = '1800ms'
as $function$
declare
  v_cache public.adaptive_medical_retrieval_cache%rowtype;
  v_feature public.adaptive_medical_retrieval_feature_state%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_cache from public.adaptive_medical_retrieval_cache
  where id = p_cache_id for update;
  select * into v_feature
  from public.adaptive_medical_retrieval_feature_state where singleton;
  if v_cache.id is null or v_cache.status <> 'RESOLVING' then
    raise exception 'Adaptive retrieval reservation is unavailable'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_structured_result) <> 'object'
     or octet_length(p_structured_result::text) > 16384
     or p_structured_result::text ~* '(https?://|www\.|email|phone|whatsapp|linkedin|api[_ -]?key|password|secret|system prompt)'
     or coalesce(jsonb_typeof(p_structured_result->'commercial_synonyms'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'commercial_synonyms') > 6
     or coalesce(jsonb_typeof(p_structured_result->'clinical_contexts'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'clinical_contexts') > 4
     or coalesce(jsonb_typeof(p_structured_result->'procurement_terms'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'procurement_terms') > 4
     or coalesce(jsonb_typeof(p_structured_result->'channel_archetypes'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'channel_archetypes') > 5
     or coalesce(jsonb_typeof(p_structured_result->'adjacent_commercial_terms'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'adjacent_commercial_terms') > 3
     or coalesce(jsonb_typeof(p_structured_result->'negative_contexts'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'negative_contexts') > 5
     or coalesce(jsonb_typeof(p_structured_result->'localized_terms'),'') <> 'array'
     or jsonb_array_length(p_structured_result->'localized_terms') > 6
     or coalesce(p_structured_result->>'search_confidence','') not in ('HIGH','MEDIUM') then
    raise exception 'Malformed adaptive retrieval result' using errcode = '22023';
  end if;
  if p_input_tokens is null or p_output_tokens is null or p_total_tokens is null
     or p_estimated_cost_usd is null or p_latency_ms is null
     or p_total_tokens <> p_input_tokens + p_output_tokens
     or p_input_tokens not between 0 and 10000
     or p_output_tokens not between 0 and 2000
     or p_estimated_cost_usd not between 0 and v_feature.maximum_cost_usd
     or p_latency_ms not between 0 and 30000
     or length(trim(coalesce(p_model_name,''))) not between 3 and 100 then
    raise exception 'Adaptive retrieval usage metadata is invalid'
      using errcode = '22023';
  end if;
  update public.adaptive_medical_retrieval_cache set
    status = 'COMPLETED', structured_result = p_structured_result,
    model_name = trim(p_model_name),
    provider_request_id = nullif(left(trim(coalesce(p_provider_request_id,'')),160),''),
    input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    total_tokens = p_total_tokens, estimated_cost_usd = p_estimated_cost_usd,
    latency_ms = p_latency_ms, last_error_code = null,
    expires_at = clock_timestamp() + make_interval(days => v_feature.cache_ttl_days),
    updated_at = clock_timestamp()
  where id = p_cache_id returning * into v_cache;
  return jsonb_build_object(
    'cache_id', v_cache.id, 'status', v_cache.status,
    'expires_at', v_cache.expires_at
  );
end
$function$;

create or replace function public.fail_adaptive_medical_retrieval_v1(
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
    coalesce(p_error_code,''), '[^A-Za-z0-9_]', '_', 'g'
  ));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if v_error !~ '^[A-Z0-9_]{2,100}$' then
    v_error := 'ADAPTIVE_RETRIEVAL_FAILED';
  end if;
  update public.adaptive_medical_retrieval_cache set
    status = 'FAILED', structured_result = null,
    last_error_code = left(v_error, 100),
    expires_at = clock_timestamp() + interval '5 minutes',
    updated_at = clock_timestamp()
  where id = p_cache_id and status = 'RESOLVING';
end
$function$;

revoke all on table public.adaptive_medical_retrieval_feature_state,
  public.adaptive_medical_retrieval_cache
from public, anon, authenticated, service_role;
grant select on table public.adaptive_medical_retrieval_feature_state,
  public.adaptive_medical_retrieval_cache to service_role;

revoke all on function
  public.reserve_adaptive_medical_retrieval_v1(text,text,text,text,text),
  public.complete_adaptive_medical_retrieval_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer),
  public.fail_adaptive_medical_retrieval_v1(uuid,text)
from public, anon, authenticated, service_role;
grant execute on function
  public.reserve_adaptive_medical_retrieval_v1(text,text,text,text,text),
  public.complete_adaptive_medical_retrieval_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer),
  public.fail_adaptive_medical_retrieval_v1(uuid,text)
to service_role;

comment on table public.adaptive_medical_retrieval_cache is
  'Global versioned cache for generic medical terminology intelligence only. Contains no tenant, company, buyer, contact, message, prompt or evidence data.';

commit;

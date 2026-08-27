-- Smart Product Resolver V1: tenant-scoped AI resolution cache, structured
-- learning metadata, and safe temporary-intent discovery boundaries.

begin;

do $preflight$
begin
  if to_regclass('public.product_resolution_events') is null
     or to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.buyer_discovery_search_spaces') is null
     or to_regprocedure('public.company_owner_authorized_v1(bigint)') is null
     or to_regprocedure('public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text)') is null
     or to_regprocedure('public.reserve_medichall_ai_request(uuid,text,text,integer,integer)') is null then
    raise exception 'Smart Product Resolver V1 preflight failed';
  end if;
end
$preflight$;

create table public.smart_product_resolver_feature_state (
  singleton boolean primary key default true check (singleton),
  smart_resolver_enabled boolean not null default false,
  resolver_version text not null default 'SMART_PRODUCT_RESOLVER_V1' check (
    resolver_version ~ '^SMART_PRODUCT_RESOLVER_V[0-9]+$'
  ),
  daily_limit integer not null default 20 check (daily_limit between 1 and 100),
  cache_ttl_days integer not null default 90 check (cache_ttl_days between 1 and 365),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.smart_product_resolver_feature_state(singleton)
values (true);

alter table public.smart_product_resolver_feature_state enable row level security;
alter table public.smart_product_resolver_feature_state force row level security;

create table public.smart_product_resolution_cache (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  normalized_phrase text not null check (
    length(normalized_phrase) between 3 and 160
    and normalized_phrase = public.normalize_unknown_product_phrase_v1(normalized_phrase)
  ),
  phrase_hash text not null check (phrase_hash ~ '^[a-f0-9]{64}$'),
  input_language text not null default 'und' check (
    input_language ~ '^[a-z]{2,3}(-[a-z]{2})?$' or input_language = 'und'
  ),
  resolver_version text not null check (
    resolver_version ~ '^SMART_PRODUCT_RESOLVER_V[0-9]+$'
  ),
  status text not null default 'RESOLVING' check (
    status in ('RESOLVING', 'COMPLETED', 'FAILED')
  ),
  structured_result jsonb check (
    structured_result is null or (
      jsonb_typeof(structured_result) = 'object'
      and octet_length(structured_result::text) <= 12288
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
  unique (company_id, normalized_phrase, resolver_version)
);

create index smart_product_resolution_cache_expiry_idx
on public.smart_product_resolution_cache(status, expires_at);
create index smart_product_resolution_cache_company_idx
on public.smart_product_resolution_cache(company_id, updated_at desc);

create trigger smart_product_resolution_cache_set_updated_at
before update on public.smart_product_resolution_cache
for each row execute function public.set_updated_at();

alter table public.smart_product_resolution_cache enable row level security;
alter table public.smart_product_resolution_cache force row level security;

alter table public.product_resolution_events
  add column input_normalized_phrase text,
  add column resolver_type text not null default 'DETERMINISTIC' check (
    resolver_type in ('DETERMINISTIC', 'AI', 'CACHED_AI')
  ),
  add column resolver_version text not null default 'DETERMINISTIC_V2' check (
    length(resolver_version) between 3 and 80
  ),
  add column resolved_concept text check (
    resolved_concept is null or length(resolved_concept) between 3 and 120
  ),
  add column product_family text check (
    product_family is null or length(product_family) between 3 and 100
  ),
  add column confidence_label text check (
    confidence_label is null or confidence_label in ('HIGH', 'MEDIUM', 'LOW')
  ),
  add column ambiguity text not null default 'NONE' check (
    ambiguity in ('NONE', 'MATERIAL', 'UNCERTAIN')
  ),
  add column clarification_options jsonb not null default '[]'::jsonb check (
    jsonb_typeof(clarification_options) = 'array'
    and jsonb_array_length(clarification_options) <= 4
    and octet_length(clarification_options::text) <= 8192
    and clarification_options::text !~* '(https?://|www\.|email|phone|whatsapp|linkedin|api[_ -]?key|password|secret)'
  ),
  add column commercial_terms jsonb not null default '[]'::jsonb check (
    jsonb_typeof(commercial_terms) = 'array'
    and jsonb_array_length(commercial_terms) <= 6
    and octet_length(commercial_terms::text) <= 4096
    and commercial_terms::text !~* '(https?://|www\.|email|phone|whatsapp|linkedin|api[_ -]?key|password|secret)'
  ),
  add column reason_code text check (
    reason_code is null or reason_code in (
      'MEDICAL_PRODUCT_RESOLVED', 'AMBIGUOUS_MEDICAL_PRODUCT',
      'TEMPORARY_MEDICAL_INTENT', 'NON_MEDICAL_PRODUCT'
    )
  ),
  add column medical_product_confirmed boolean not null default false,
  add column ai_model text check (ai_model is null or length(ai_model) between 3 and 100),
  add column ai_request_used boolean not null default false,
  add column ai_latency_ms integer check (
    ai_latency_ms is null or ai_latency_ms between 0 and 30000
  ),
  add column cache_hit boolean not null default false,
  add column resolver_cache_id uuid references public.smart_product_resolution_cache(id)
    on delete set null,
  add column user_decision text not null default 'PENDING' check (
    user_decision in ('PENDING', 'ACCEPTED', 'REJECTED', 'NOT_REQUIRED')
  ),
  add column selected_option_index integer check (
    selected_option_index is null or selected_option_index between 0 and 3
  ),
  add column decision_at timestamptz;

update public.product_resolution_events
set input_normalized_phrase = normalized_phrase,
    resolver_version = 'DETERMINISTIC_V2',
    confidence_label = case
      when resolution_status = 'EXACT_APPROVED' then 'HIGH'
      when resolution_status in ('SUGGESTED', 'CONFIRMED') then 'MEDIUM'
      else null
    end,
    medical_product_confirmed = resolution_status in (
      'EXACT_APPROVED', 'SUGGESTED', 'CONFIRMED', 'UNMAPPED_SEARCH'
    ),
    user_decision = case
      when resolution_status in ('CONFIRMED', 'UNMAPPED_SEARCH') then 'ACCEPTED'
      when resolution_status = 'EXACT_APPROVED' then 'NOT_REQUIRED'
      else 'PENDING'
    end,
    decision_at = case
      when resolution_status in ('CONFIRMED', 'UNMAPPED_SEARCH') then updated_at
      else null
    end;

alter table public.product_resolution_events
  alter column input_normalized_phrase set not null;
alter table public.product_resolution_events
  add constraint product_resolution_input_phrase_check check (
    length(input_normalized_phrase) between 3 and 160
    and input_normalized_phrase = public.normalize_unknown_product_phrase_v1(input_normalized_phrase)
  );

alter table public.product_resolution_events
  drop constraint product_resolution_events_resolution_status_check;
alter table public.product_resolution_events
  add constraint product_resolution_events_resolution_status_check check (
    resolution_status in (
      'EXACT_APPROVED', 'SUGGESTED', 'UNMAPPED', 'CONFIRMED',
      'UNMAPPED_SEARCH', 'AI_AMBIGUOUS', 'AI_NON_MEDICAL'
    )
  );

create index product_resolution_events_resolver_diagnostics_idx
on public.product_resolution_events(company_id, resolver_type, created_at desc);

create or replace function public.smart_product_resolver_request_authorized_v1(
  p_company_id bigint,
  p_requested_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    exists (
      select 1 from public.companies company
      where company.id = p_company_id and company.owner_id = p_requested_by
    )
    or exists (
      select 1 from public.admins admin_user
      where admin_user.user_id = p_requested_by
    ),
    false
  )
$function$;

create or replace function public.reserve_smart_product_resolution_v1(
  p_company_id bigint,
  p_requested_by uuid,
  p_normalized_phrase text,
  p_input_language text,
  p_resolver_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '2000ms'
as $function$
declare
  v_feature public.smart_product_resolver_feature_state%rowtype;
  v_cache public.smart_product_resolution_cache%rowtype;
  v_phrase text := public.normalize_unknown_product_phrase_v1(p_normalized_phrase);
  v_language text := lower(trim(coalesce(p_input_language, 'und')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if not public.smart_product_resolver_request_authorized_v1(
    p_company_id, p_requested_by
  ) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  select * into v_feature from public.smart_product_resolver_feature_state
  where singleton;
  if v_feature.singleton is null or not v_feature.smart_resolver_enabled then
    return jsonb_build_object(
      'decision', 'DISABLED', 'enabled', false,
      'resolver_version', coalesce(v_feature.resolver_version, 'SMART_PRODUCT_RESOLVER_V1')
    );
  end if;
  if v_phrase <> p_normalized_phrase or length(v_phrase) not between 3 and 160
     or p_resolver_version <> v_feature.resolver_version
     or not (v_language ~ '^[a-z]{2,3}(-[a-z]{2})?$' or v_language = 'und') then
    raise exception 'Invalid Smart Resolver reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'smart-product-resolver:' || p_company_id::text || ':' ||
      encode(digest(v_phrase, 'sha256'), 'hex') || ':' || p_resolver_version,
      270002
    )
  );
  select * into v_cache from public.smart_product_resolution_cache cache
  where cache.company_id = p_company_id
    and cache.normalized_phrase = v_phrase
    and cache.resolver_version = p_resolver_version
  for update;
  if v_cache.id is not null and v_cache.status = 'COMPLETED'
     and v_cache.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'decision', 'CACHED', 'enabled', true,
      'cache_id', v_cache.id, 'resolver_version', v_cache.resolver_version,
      'structured_result', v_cache.structured_result,
      'model_name', v_cache.model_name, 'estimated_cost_usd', 0,
      'latency_ms', v_cache.latency_ms, 'daily_limit', v_feature.daily_limit
    );
  end if;
  if v_cache.id is not null and v_cache.status = 'RESOLVING'
     and v_cache.updated_at > clock_timestamp() - interval '30 seconds' then
    return jsonb_build_object(
      'decision', 'IN_PROGRESS', 'enabled', true,
      'cache_id', v_cache.id, 'resolver_version', v_cache.resolver_version,
      'daily_limit', v_feature.daily_limit
    );
  end if;
  if v_cache.id is not null and v_cache.status = 'FAILED'
     and v_cache.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'decision', 'RECENT_FAILURE', 'enabled', true,
      'cache_id', v_cache.id, 'resolver_version', v_cache.resolver_version,
      'daily_limit', v_feature.daily_limit
    );
  end if;

  insert into public.smart_product_resolution_cache(
    company_id, requested_by, normalized_phrase, phrase_hash, input_language,
    resolver_version, status, expires_at
  ) values (
    p_company_id, p_requested_by, v_phrase,
    encode(digest(v_phrase, 'sha256'), 'hex'), v_language,
    p_resolver_version, 'RESOLVING', clock_timestamp() + interval '30 seconds'
  ) on conflict (company_id, normalized_phrase, resolver_version) do update set
    requested_by = excluded.requested_by,
    input_language = excluded.input_language,
    status = 'RESOLVING', structured_result = null, model_name = null,
    provider_request_id = null, input_tokens = null, output_tokens = null,
    total_tokens = null, estimated_cost_usd = null, latency_ms = null,
    last_error_code = null,
    attempt_count = public.smart_product_resolution_cache.attempt_count + 1,
    expires_at = clock_timestamp() + interval '30 seconds',
    updated_at = clock_timestamp()
  returning * into v_cache;
  return jsonb_build_object(
    'decision', 'PROCEED', 'enabled', true,
    'cache_id', v_cache.id, 'resolver_version', v_cache.resolver_version,
    'daily_limit', v_feature.daily_limit,
    'cache_ttl_days', v_feature.cache_ttl_days
  );
end
$function$;

create or replace function public.complete_smart_product_resolution_v1(
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
set statement_timeout = '2000ms'
as $function$
declare
  v_cache public.smart_product_resolution_cache%rowtype;
  v_feature public.smart_product_resolver_feature_state%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into v_cache from public.smart_product_resolution_cache
  where id = p_cache_id for update;
  if v_cache.id is null or v_cache.status <> 'RESOLVING' then
    raise exception 'Smart Resolver cache reservation is unavailable'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_structured_result) <> 'object'
     or octet_length(p_structured_result::text) > 12288
     or p_structured_result::text ~* '(https?://|www\.|email|phone|whatsapp|linkedin|api[_ -]?key|password|secret|system prompt)'
     or jsonb_typeof(p_structured_result->'suggested_taxonomy_ids') <> 'array'
     or jsonb_array_length(p_structured_result->'suggested_taxonomy_ids') > 3
     or jsonb_typeof(p_structured_result->'commercial_terms_en') <> 'array'
     or jsonb_array_length(p_structured_result->'commercial_terms_en') > 6
     or jsonb_typeof(p_structured_result->'clarification_options') <> 'array'
     or jsonb_array_length(p_structured_result->'clarification_options') > 4
     or coalesce(p_structured_result->>'confidence', '') not in ('HIGH','MEDIUM','LOW')
     or coalesce(p_structured_result->>'ambiguity', '') not in ('NONE','MATERIAL','UNCERTAIN')
     or coalesce(p_structured_result->>'reason_code', '') not in (
       'MEDICAL_PRODUCT_RESOLVED', 'AMBIGUOUS_MEDICAL_PRODUCT',
       'TEMPORARY_MEDICAL_INTENT', 'NON_MEDICAL_PRODUCT'
     ) then
    raise exception 'Malformed Smart Resolver structured result'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_structured_result->'suggested_taxonomy_ids') value
    where value !~ '^[0-9]{1,18}$'
       or not exists (
         select 1 from public.medical_product_taxonomy taxonomy
         where taxonomy.id = case when value ~ '^[0-9]{1,18}$'
           then value::bigint else null end
           and taxonomy.is_active
       )
  ) or exists (
    select 1
    from jsonb_array_elements(p_structured_result->'clarification_options') option
    where nullif(option->>'taxonomy_id', '') is not null
      and (
        option->>'taxonomy_id' !~ '^[0-9]{1,18}$'
        or not exists (
         select 1 from public.medical_product_taxonomy taxonomy
          where taxonomy.id = case
            when option->>'taxonomy_id' ~ '^[0-9]{1,18}$'
              then (option->>'taxonomy_id')::bigint
            else null
          end
            and taxonomy.is_active
        )
      )
  ) then
    raise exception 'Smart Resolver returned an unavailable taxonomy category'
      using errcode = '22023';
  end if;
  if p_input_tokens is null or p_output_tokens is null
     or p_total_tokens is null or p_estimated_cost_usd is null
     or p_latency_ms is null
     or length(trim(coalesce(p_model_name, ''))) not between 3 and 100
     or p_input_tokens not between 0 and 10000
     or p_output_tokens not between 0 and 2000
     or p_total_tokens <> p_input_tokens + p_output_tokens
     or p_estimated_cost_usd not between 0 and 0.005000
     or p_latency_ms not between 0 and 30000 then
    raise exception 'Smart Resolver usage metadata is invalid'
      using errcode = '22023';
  end if;
  select * into v_feature from public.smart_product_resolver_feature_state
  where singleton;
  update public.smart_product_resolution_cache set
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

create or replace function public.fail_smart_product_resolution_v1(
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
  v_error text := upper(regexp_replace(coalesce(p_error_code,''), '[^A-Za-z0-9_]', '_', 'g'));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if v_error !~ '^[A-Z0-9_]{2,100}$' then v_error := 'SMART_RESOLVER_FAILED'; end if;
  update public.smart_product_resolution_cache set
    status = 'FAILED', structured_result = null,
    last_error_code = left(v_error, 100),
    expires_at = clock_timestamp() + interval '5 minutes',
    updated_at = clock_timestamp()
  where id = p_cache_id and status = 'RESOLVING';
end
$function$;

create or replace function public.record_smart_product_resolution_event_v1(
  p_company_id bigint,
  p_requested_by uuid,
  p_idempotency_key uuid,
  p_cache_id uuid,
  p_resolver_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2200ms'
as $function$
declare
  v_cache public.smart_product_resolution_cache%rowtype;
  v_result jsonb;
  v_status text;
  v_suggestions jsonb := '[]'::jsonb;
  v_event public.product_resolution_events%rowtype;
  v_resolver_type text := upper(trim(coalesce(p_resolver_type,'')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or v_resolver_type not in ('AI','CACHED_AI')
     or not public.smart_product_resolver_request_authorized_v1(
       p_company_id, p_requested_by
     ) then
    raise exception 'Smart Resolver event access denied' using errcode = '42501';
  end if;
  select * into v_cache from public.smart_product_resolution_cache cache
  where cache.id = p_cache_id and cache.company_id = p_company_id
    and cache.status = 'COMPLETED' and cache.expires_at > clock_timestamp();
  if v_cache.id is null then
    raise exception 'Completed Smart Resolver result is unavailable'
      using errcode = '22023';
  end if;
  v_result := v_cache.structured_result;
  v_status := case
    when not coalesce((v_result->>'is_medical_product')::boolean, false)
      then 'AI_NON_MEDICAL'
    when v_result->>'ambiguity' in ('MATERIAL','UNCERTAIN') then 'AI_AMBIGUOUS'
    when jsonb_array_length(v_result->'suggested_taxonomy_ids') > 0
      then 'SUGGESTED'
    else 'UNMAPPED'
  end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'canonical_taxonomy_id', taxonomy.id,
    'canonical_name', taxonomy.canonical_name,
    'slug', taxonomy.slug,
    'node_type', taxonomy.node_type,
    'confidence', case when v_result->>'confidence' = 'HIGH' then 0.9 else 0.72 end,
    'confidence_label', v_result->>'confidence',
    'reasoning', 'Smart Resolver candidate validated against active taxonomy.',
    'signal_sources', jsonb_build_array('smart_product_resolver','validated_active_taxonomy')
  ) order by taxonomy.id), '[]'::jsonb)
  into v_suggestions
  from public.medical_product_taxonomy taxonomy
  where taxonomy.id in (
    select value::bigint
    from jsonb_array_elements_text(v_result->'suggested_taxonomy_ids') value
  ) and taxonomy.is_active;

  insert into public.product_resolution_events(
    company_id, requested_by, idempotency_key, normalized_phrase,
    input_normalized_phrase, phrase_signature, resolution_status,
    alias_candidate_eligible, suggestions, resolver_type, resolver_version,
    resolved_concept, product_family, confidence_label, ambiguity,
    clarification_options, commercial_terms, reason_code,
    medical_product_confirmed, ai_model, ai_request_used, ai_latency_ms,
    cache_hit, resolver_cache_id, user_decision
  ) values (
    p_company_id, p_requested_by, p_idempotency_key, v_cache.normalized_phrase,
    v_cache.normalized_phrase,
    public.unknown_product_phrase_signature_v1(v_cache.normalized_phrase),
    v_status, v_status = 'SUGGESTED', v_suggestions,
    v_resolver_type, v_cache.resolver_version,
    nullif(v_result->>'canonical_concept',''),
    nullif(v_result->>'product_family',''), v_result->>'confidence',
    v_result->>'ambiguity', v_result->'clarification_options',
    v_result->'commercial_terms_en', v_result->>'reason_code',
    coalesce((v_result->>'is_medical_product')::boolean, false),
    v_cache.model_name, v_resolver_type = 'AI', v_cache.latency_ms,
    v_resolver_type = 'CACHED_AI', v_cache.id,
    case when v_status = 'AI_NON_MEDICAL' then 'NOT_REQUIRED' else 'PENDING' end
  ) on conflict (company_id, idempotency_key) do nothing
  returning * into v_event;
  if v_event.id is null then
    select * into v_event from public.product_resolution_events
    where company_id = p_company_id and idempotency_key = p_idempotency_key;
    if v_event.resolver_cache_id is distinct from v_cache.id then
      raise exception 'Resolution idempotency key has different semantics'
        using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object(
    'resolution_event_id', v_event.id,
    'resolution_status', v_event.resolution_status,
    'reused', v_event.created_at < clock_timestamp() - interval '1 millisecond'
  );
end
$function$;

create or replace function public.confirm_smart_product_resolution_option_v1(
  p_company_id bigint,
  p_requested_by uuid,
  p_event_id uuid,
  p_option_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1800ms'
as $function$
declare
  v_event public.product_resolution_events%rowtype;
  v_option jsonb;
  v_taxonomy_id bigint;
  v_suggestions jsonb := '[]'::jsonb;
  v_rejected bigint[] := '{}';
begin
  if auth.role() <> 'service_role'
     or not public.smart_product_resolver_request_authorized_v1(
       p_company_id, p_requested_by
     ) then
    raise exception 'Smart Resolver confirmation denied' using errcode = '42501';
  end if;
  select * into v_event from public.product_resolution_events event
  where event.id = p_event_id and event.company_id = p_company_id
    and event.requested_by = p_requested_by
    and event.resolver_type in ('AI','CACHED_AI')
  for update;
  if v_event.id is null or v_event.resolution_status <> 'AI_AMBIGUOUS'
     or p_option_index not between 0 and 3
     or p_option_index >= jsonb_array_length(v_event.clarification_options) then
    raise exception 'Smart Resolver clarification is unavailable'
      using errcode = '22023';
  end if;
  v_option := v_event.clarification_options->p_option_index;
  v_taxonomy_id := nullif(v_option->>'taxonomy_id','')::bigint;
  if v_taxonomy_id is not null then
    select jsonb_build_array(jsonb_build_object(
      'canonical_taxonomy_id', taxonomy.id,
      'canonical_name', taxonomy.canonical_name,
      'slug', taxonomy.slug,
      'node_type', taxonomy.node_type,
      'confidence', 0.9,
      'confidence_label', 'HIGH',
      'reasoning', 'User selected a Smart Resolver clarification.',
      'signal_sources', jsonb_build_array('smart_product_resolver','user_clarification')
    )) into v_suggestions
    from public.medical_product_taxonomy taxonomy
    where taxonomy.id = v_taxonomy_id and taxonomy.is_active;
    if jsonb_array_length(coalesce(v_suggestions,'[]'::jsonb)) <> 1 then
      raise exception 'Selected taxonomy category is unavailable'
        using errcode = '22023';
    end if;
  end if;
  select coalesce(array_agg(distinct (option->>'taxonomy_id')::bigint), '{}')
  into v_rejected
  from jsonb_array_elements(v_event.clarification_options) with ordinality item(option, ordinal)
  where item.ordinal - 1 <> p_option_index
    and nullif(option->>'taxonomy_id','') is not null;

  update public.product_resolution_events set
    resolution_status = case when v_taxonomy_id is null then 'UNMAPPED' else 'SUGGESTED' end,
    alias_candidate_eligible = v_taxonomy_id is not null,
    suggestions = coalesce(v_suggestions,'[]'::jsonb),
    resolved_concept = v_option->>'canonical_concept',
    product_family = v_option->>'product_family',
    confidence_label = 'HIGH', ambiguity = 'NONE',
    commercial_terms = v_option->'commercial_terms_en',
    rejected_taxonomy_ids = v_rejected,
    user_decision = 'ACCEPTED', selected_option_index = p_option_index,
    decision_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_event.id returning * into v_event;
  return jsonb_build_object(
    'resolution_event_id', v_event.id,
    'resolution_status', v_event.resolution_status,
    'normalized_source_text', v_event.input_normalized_phrase,
    'resolved_concept', v_event.resolved_concept,
    'product_family', v_event.product_family,
    'confidence', v_event.confidence_label,
    'ambiguity', v_event.ambiguity,
    'commercial_terms_en', v_event.commercial_terms,
    'suggestions', v_event.suggestions,
    'resolver_type', v_event.resolver_type,
    'resolver_version', v_event.resolver_version
  );
end
$function$;

create or replace function public.mark_smart_product_resolution_decision_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if old.resolver_type in ('AI','CACHED_AI')
     and old.user_decision = 'PENDING'
     and new.resolution_status in ('CONFIRMED','UNMAPPED_SEARCH') then
    new.user_decision := 'ACCEPTED';
    new.decision_at := coalesce(new.decision_at, clock_timestamp());
  end if;
  return new;
end
$function$;

create trigger product_resolution_events_smart_decision
before update on public.product_resolution_events
for each row execute function public.mark_smart_product_resolution_decision_v1();

create or replace function public.start_smart_external_prospect_discovery_v1(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_intent jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '4000ms'
as $function$
declare
  v_profile public.matchmaking_profiles%rowtype;
  v_event public.product_resolution_events%rowtype;
  v_target_countries text[];
  v_phrase text;
  v_context jsonb;
  v_intent_hash text;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_run public.external_prospect_discovery_runs%rowtype;
  v_space public.buyer_discovery_search_spaces%rowtype;
  v_generation integer;
  v_daily integer;
  v_monthly integer;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_intent) <> 'object'
     or octet_length(p_intent::text) > 4096
     or exists (
       select 1 from jsonb_object_keys(p_intent) keys(key)
       where keys.key not in (
         'intent_source','taxonomy_ids','target_countries',
         'normalized_product_phrase','resolution_event_id'
       )
     )
     or upper(coalesce(p_intent->>'intent_source','')) <> 'UNMAPPED_PRODUCT'
     or jsonb_array_length(coalesce(p_intent->'taxonomy_ids','[]'::jsonb)) <> 0
     or coalesce(p_intent->>'resolution_event_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Bounded Smart Resolver intent required' using errcode = '22023';
  end if;
  v_phrase := public.normalize_unknown_product_phrase_v1(
    p_intent->>'normalized_product_phrase'
  );
  select * into v_event from public.product_resolution_events event
  where event.id = (p_intent->>'resolution_event_id')::uuid
    and event.company_id = p_company_id
    and event.requested_by = auth.uid()
    and event.input_normalized_phrase = v_phrase
    and event.resolver_type in ('AI','CACHED_AI')
    and event.resolution_status in ('UNMAPPED','UNMAPPED_SEARCH')
    and event.medical_product_confirmed
    and event.confidence_label in ('HIGH','MEDIUM')
    and event.ambiguity = 'NONE'
    and event.resolved_concept is not null;
  if v_event.id is null then
    raise exception 'Confirmed Smart Resolver intent is unavailable'
      using errcode = '42501';
  end if;
  select * into v_profile from public.matchmaking_profiles
  where company_id = p_company_id and is_active;
  if v_profile.id is null or v_profile.role <> 'manufacturer' then
    raise exception 'Buyer Discovery requires an active manufacturer match profile'
      using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct upper(value) order by upper(value)), '{}')
  into v_target_countries
  from jsonb_array_elements_text(coalesce(p_intent->'target_countries','[]'::jsonb)) value
  where value ~ '^[A-Za-z]{2}$';
  if jsonb_array_length(coalesce(p_intent->'target_countries','[]'::jsonb))
     <> cardinality(v_target_countries) or cardinality(v_target_countries) > 32 then
    raise exception 'Target countries must be unique two-letter country codes'
      using errcode = '22023';
  end if;
  v_context := jsonb_build_object(
    'intent_source','UNMAPPED_PRODUCT',
    'normalized_product_label',v_event.resolved_concept,
    'normalized_product_phrase',v_phrase,
    'resolved_product_concept',v_event.resolved_concept,
    'product_family',v_event.product_family,
    'commercial_terms_en',v_event.commercial_terms,
    'taxonomy','[]'::jsonb,
    'target_countries',to_jsonb(v_target_countries),
    'country_scope',case when cardinality(v_target_countries)=0
      then 'EUROPE_WIDE' else 'SELECTED_COUNTRIES' end,
    'temporary_intent',true,
    'resolver_type',v_event.resolver_type,
    'resolver_version',v_event.resolver_version
  );
  v_intent_hash := encode(digest(jsonb_build_object(
    'intent_source','UNMAPPED_PRODUCT',
    'input_phrase_signature',public.unknown_product_phrase_signature_v1(v_phrase),
    'resolved_concept',public.normalize_unknown_product_phrase_v1(v_event.resolved_concept),
    'resolver_version',v_event.resolver_version,
    'target_countries',to_jsonb(v_target_countries)
  )::text,'sha256'),'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('buyer-discovery-vnext:' || p_company_id::text, 925)
  );
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is null then
    select * into v_existing from public.external_prospect_discovery_runs
    where company_id = p_company_id and intent_hash = v_intent_hash
      and status in ('QUEUED','RUNNING','PARTIAL','COMPLETED')
    order by created_at desc limit 1;
  end if;
  if v_existing.id is not null
     and v_existing.created_at >= clock_timestamp() - interval '14 days' then
    update public.product_resolution_events set
      resolution_status = 'UNMAPPED_SEARCH', discovery_run_id = v_existing.id,
      user_decision = 'ACCEPTED', decision_at = coalesce(decision_at,clock_timestamp()),
      updated_at = clock_timestamp()
    where id = v_event.id;
    return jsonb_build_object(
      'run_id',v_existing.id,'status',v_existing.status,'stage',v_existing.stage,
      'intent_hash',v_existing.intent_hash,'intent_context',v_existing.intent_context,
      'reused',true,'reason','cached_intent_14_days','run_mode','CACHED_REUSE',
      'search_space_id',v_existing.search_space_id,
      'search_generation',v_existing.search_generation,
      'last_verified_at',v_existing.completed_at,
      'credit_disposition','NOT_APPLICABLE'
    );
  end if;
  if exists (
    select 1 from public.external_prospect_discovery_runs
    where company_id = p_company_id
      and created_at >= clock_timestamp() - interval '30 minutes'
  ) then raise exception 'Discovery cooldown is active' using errcode = 'P0001'; end if;
  select count(*)::integer into v_daily from public.external_prospect_discovery_runs
  where company_id=p_company_id and created_at>=date_trunc('day',clock_timestamp());
  select count(*)::integer into v_monthly from public.external_prospect_discovery_runs
  where company_id=p_company_id and created_at>=date_trunc('month',clock_timestamp());
  if v_daily >= 3 then raise exception 'Daily discovery limit reached' using errcode='P0001'; end if;
  if v_monthly >= 20 then raise exception 'Monthly discovery limit reached' using errcode='P0001'; end if;

  insert into public.buyer_discovery_search_spaces(company_id,intent_hash)
  values (p_company_id,v_intent_hash)
  on conflict (company_id,intent_hash) do update set updated_at=clock_timestamp()
  returning * into v_space;
  update public.buyer_discovery_search_spaces set
    generation_count=generation_count+1,last_discovery_at=clock_timestamp()
  where id=v_space.id returning generation_count into v_generation;
  insert into public.external_prospect_discovery_runs(
    company_id,requested_by,idempotency_key,intent_hash,intent_source,
    intent_context,resolution_event_id,search_space_id,run_mode,
    search_generation,fresh_request_state,credit_disposition
  ) values (
    p_company_id,auth.uid(),p_idempotency_key,v_intent_hash,'UNMAPPED_PRODUCT',
    v_context,v_event.id,v_space.id,'NORMAL_DISCOVERY',v_generation,
    'NOT_FRESH','NOT_APPLICABLE'
  ) returning * into v_run;
  update public.product_resolution_events set
    resolution_status='UNMAPPED_SEARCH',discovery_run_id=v_run.id,
    user_decision='ACCEPTED',decision_at=coalesce(decision_at,clock_timestamp()),
    updated_at=clock_timestamp()
  where id=v_event.id;
  return jsonb_build_object(
    'run_id',v_run.id,'status',v_run.status,'stage',v_run.stage,
    'intent_hash',v_run.intent_hash,'intent_context',v_run.intent_context,
    'reused',false,'reason','smart_temporary_intent_created',
    'requested_run_mode','NORMAL_DISCOVERY','run_mode','NORMAL_DISCOVERY',
    'search_space_id',v_space.id,'search_generation',v_generation,
    'credit_disposition','NOT_APPLICABLE'
  );
end
$function$;

create or replace function public.start_smart_product_admin_fresh_v1(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_base_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_base public.external_prospect_discovery_runs%rowtype;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_run public.external_prospect_discovery_runs%rowtype;
  v_space public.buyer_discovery_search_spaces%rowtype;
  v_daily integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_base_run_id is null then
    raise exception 'Admin Fresh request is incomplete' using errcode = '22023';
  end if;
  select * into v_base from public.external_prospect_discovery_runs
  where id=p_base_run_id and company_id=p_company_id
    and status in ('COMPLETED','PARTIAL') and search_space_id is not null
    and intent_context->>'resolver_type' in ('AI','CACHED_AI');
  if v_base.id is null then
    raise exception 'Completed Smart Resolver discovery is required'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('buyer-discovery-vnext:' || p_company_id::text,925)
  );
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id=p_company_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'run_id',v_existing.id,'status',v_existing.status,'stage',v_existing.stage,
      'intent_hash',v_existing.intent_hash,'intent_context',v_existing.intent_context,
      'reused',true,'reason','idempotency_key','run_mode','ADMIN_QA_FRESH',
      'search_space_id',v_existing.search_space_id,
      'search_generation',v_existing.search_generation,
      'credit_disposition','WAIVED_ADMIN_QA'
    );
  end if;
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id=p_company_id and intent_hash=v_base.intent_hash
    and run_mode='ADMIN_QA_FRESH' and status in ('QUEUED','RUNNING')
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'run_id',v_existing.id,'status',v_existing.status,'stage',v_existing.stage,
      'intent_hash',v_existing.intent_hash,'intent_context',v_existing.intent_context,
      'reused',true,'reason','active_fresh_run','run_mode','ADMIN_QA_FRESH',
      'search_space_id',v_existing.search_space_id,
      'search_generation',v_existing.search_generation,
      'credit_disposition','WAIVED_ADMIN_QA'
    );
  end if;
  select count(*)::integer into v_daily
  from public.external_prospect_discovery_runs
  where requested_by=auth.uid() and run_mode='ADMIN_QA_FRESH'
    and created_at>=date_trunc('day',clock_timestamp());
  if v_daily>=50 then
    raise exception 'Daily Admin QA Fresh Discovery limit reached'
      using errcode='P0001';
  end if;
  select * into v_space from public.buyer_discovery_search_spaces
  where id=v_base.search_space_id and company_id=p_company_id for update;
  if v_space.id is null then
    raise exception 'Buyer Discovery search space is unavailable'
      using errcode='22023';
  end if;
  update public.buyer_discovery_search_spaces set
    generation_count=generation_count+1,fresh_run_count=fresh_run_count+1,
    last_discovery_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=v_space.id returning * into v_space;
  insert into public.external_prospect_discovery_runs(
    company_id,requested_by,idempotency_key,intent_hash,intent_source,
    intent_context,resolution_event_id,search_space_id,run_mode,
    search_generation,product_profile,fresh_request_state,credit_disposition
  ) values (
    p_company_id,auth.uid(),p_idempotency_key,v_base.intent_hash,
    v_base.intent_source,v_base.intent_context,v_base.resolution_event_id,
    v_space.id,'ADMIN_QA_FRESH',v_space.generation_count,
    v_space.product_profile,'ACCEPTED','WAIVED_ADMIN_QA'
  ) returning * into v_run;
  return jsonb_build_object(
    'run_id',v_run.id,'status',v_run.status,'stage',v_run.stage,
    'intent_hash',v_run.intent_hash,'intent_context',v_run.intent_context,
    'reused',false,'reason','smart_admin_fresh_created',
    'run_mode','ADMIN_QA_FRESH','search_space_id',v_run.search_space_id,
    'search_generation',v_run.search_generation,
    'credit_disposition','WAIVED_ADMIN_QA'
  );
end
$function$;

create or replace function public.get_smart_product_resolver_diagnostics_v1(
  p_company_id bigint,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
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
    'events',coalesce((
      select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc)
      from (
        select event.id,event.input_normalized_phrase,event.resolver_type,
          event.resolver_version,event.confidence_label,event.resolved_concept,
          event.product_family,event.ambiguity,event.resolution_status,
          event.ai_model,event.ai_request_used,event.ai_latency_ms,event.cache_hit,
          event.user_decision,event.created_at
        from public.product_resolution_events event
        where event.company_id=p_company_id
        order by event.created_at desc
        limit least(greatest(coalesce(p_limit,50),1),100)
      ) row_value
    ),'[]'::jsonb),
    'cache',coalesce((
      select jsonb_agg(to_jsonb(cache_value) order by cache_value.updated_at desc)
      from (
        select cache.normalized_phrase,cache.resolver_version,cache.status,
          cache.model_name,cache.input_tokens,cache.output_tokens,
          cache.total_tokens,cache.estimated_cost_usd,cache.latency_ms,
          cache.attempt_count,cache.expires_at,cache.updated_at
        from public.smart_product_resolution_cache cache
        where cache.company_id=p_company_id
        order by cache.updated_at desc
        limit least(greatest(coalesce(p_limit,50),1),100)
      ) cache_value
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;

revoke all on table public.smart_product_resolver_feature_state,
  public.smart_product_resolution_cache from public, anon, authenticated,
  service_role;
grant select on table public.smart_product_resolver_feature_state,
  public.smart_product_resolution_cache to service_role;

revoke all on function
  public.smart_product_resolver_request_authorized_v1(bigint,uuid),
  public.reserve_smart_product_resolution_v1(bigint,uuid,text,text,text),
  public.complete_smart_product_resolution_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer),
  public.fail_smart_product_resolution_v1(uuid,text),
  public.record_smart_product_resolution_event_v1(bigint,uuid,uuid,uuid,text),
  public.confirm_smart_product_resolution_option_v1(bigint,uuid,uuid,integer),
  public.mark_smart_product_resolution_decision_v1(),
  public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb),
  public.start_smart_product_admin_fresh_v1(bigint,uuid,uuid),
  public.get_smart_product_resolver_diagnostics_v1(bigint,integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.reserve_smart_product_resolution_v1(bigint,uuid,text,text,text),
  public.complete_smart_product_resolution_v1(uuid,jsonb,text,text,integer,integer,integer,numeric,integer),
  public.fail_smart_product_resolution_v1(uuid,text),
  public.record_smart_product_resolution_event_v1(bigint,uuid,uuid,uuid,text),
  public.confirm_smart_product_resolution_option_v1(bigint,uuid,uuid,integer)
to service_role;
grant execute on function
  public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb),
  public.start_smart_product_admin_fresh_v1(bigint,uuid,uuid),
  public.get_smart_product_resolver_diagnostics_v1(bigint,integer)
to authenticated, service_role;

comment on table public.smart_product_resolution_cache is
  'Tenant-scoped, versioned, structured Smart Product Resolver cache. Contains no company profile, contact, message, prompt or buyer evidence data.';
comment on function public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb) is
  'Starts normal Buyer Discovery only from a company-owned, user-confirmed, server-validated Smart Resolver temporary medical intent.';

commit;

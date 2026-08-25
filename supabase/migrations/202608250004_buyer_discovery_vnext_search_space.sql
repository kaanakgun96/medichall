-- Buyer Discovery vNext: persistent search-space memory, explicit Fresh
-- Discovery semantics and a future atomic credit-debit attachment point.
-- No billing, contacts, provider content, emails, messages or notifications.

begin;

do $migration_gate$
begin
  if to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.company_external_prospect_matches') is null
     or to_regclass('public.external_public_web_request_cache') is null
     or to_regclass('public.product_resolution_events') is null
     or to_regprocedure('public.start_external_prospect_discovery_v2(bigint,uuid,jsonb)') is null
     or to_regprocedure('public.get_external_prospect_workspace_v2(bigint,integer)') is null
     or to_regprocedure('public.unknown_product_phrase_signature_v1(text)') is null
     or to_regprocedure('public.is_bounded_medical_product_phrase_v1(text)') is null then
    raise exception 'Buyer Discovery V2.3 and Unknown Product Validator Expansion must be installed first';
  end if;
end
$migration_gate$;

alter table public.external_prospect_discovery_runs
  drop constraint if exists external_prospect_discovery_runs_queries_generated_check,
  drop constraint if exists external_prospect_discovery_runs_provider_requests_check,
  drop constraint if exists external_prospect_runs_provider_requests_bounded_check,
  drop constraint if exists external_prospect_discovery_runs_estimated_cost_usd_check;

alter table public.external_prospect_discovery_runs
  add constraint external_prospect_discovery_runs_queries_generated_check
    check (queries_generated between 0 and 16),
  add constraint external_prospect_discovery_runs_provider_requests_check
    check (provider_requests between 0 and 10),
  add constraint external_prospect_discovery_runs_estimated_cost_usd_check
    check (estimated_cost_usd between 0 and 0.050000);

alter table public.external_public_web_request_cache
  drop constraint if exists external_public_web_request_cache_query_variant_check,
  add constraint external_public_web_request_cache_query_variant_check
    check (query_variant between 0 and 9);

alter table public.external_public_web_request_cache
  drop constraint if exists external_public_web_request_cache_normalized_candidates_check,
  add constraint external_public_web_request_cache_normalized_candidates_check check (
    jsonb_typeof(normalized_candidates) = 'array'
    and jsonb_array_length(normalized_candidates) <= 40
    and octet_length(normalized_candidates::text) <= 65536
    and lower(normalized_candidates::text) !~
      '"(snippet|description|raw_query|query|email|e-mail|phone|telephone|mobile|whatsapp|contact|contact_name|linkedin|person|employee|director|officer|shareholder)"[[:space:]]*:'
  );

create table public.buyer_discovery_search_spaces (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  intent_hash text not null check (intent_hash ~ '^[a-f0-9]{64}$'),
  product_profile text not null default 'STANDARD' check (
    product_profile in ('BROAD', 'STANDARD', 'NICHE')
  ),
  generation_count integer not null default 0 check (generation_count between 0 and 1000000),
  fresh_run_count integer not null default 0 check (fresh_run_count between 0 and 1000000),
  cumulative_verified_buyers integer not null default 0 check (
    cumulative_verified_buyers between 0 and 1000000
  ),
  last_new_buyer_yield integer not null default 0 check (
    last_new_buyer_yield between 0 and 30
  ),
  zero_new_streak integer not null default 0 check (zero_new_streak between 0 and 1000000),
  saturation_signal text not null default 'NONE' check (
    saturation_signal in ('NONE', 'DECLINING_YIELD', 'ZERO_RECENT_YIELD')
  ),
  last_discovery_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, intent_hash)
);

create table public.buyer_discovery_partitions (
  id bigint generated always as identity primary key,
  search_space_id uuid not null references public.buyer_discovery_search_spaces(id) on delete cascade,
  partition_key text not null check (
    length(partition_key) between 8 and 240
    and partition_key ~ '^[a-z0-9|_-]+$'
  ),
  provider_kind text not null check (provider_kind in ('PUBLIC_WEB', 'TED')),
  partition_type text not null check (partition_type in (
    'COMMERCIAL_WEB', 'TED_PRODUCT_TERMS', 'TED_RELATED_CPV'
  )),
  terminology jsonb not null default '[]'::jsonb check (
    jsonb_typeof(terminology) = 'array'
    and jsonb_array_length(terminology) between 1 and 12
    and octet_length(terminology::text) <= 4096
  ),
  language_code text not null check (language_code ~ '^[a-z]{2,3}$'),
  country_codes text[] not null default '{}'::text[] check (
    cardinality(country_codes) between 0 and 32
  ),
  market_region text not null check (market_region ~ '^[A-Z0-9_]{2,64}$'),
  buyer_archetype text not null check (buyer_archetype ~ '^[A-Z0-9_]{2,64}$'),
  retrieval_kind text not null check (
    retrieval_kind in ('DIRECT_TERMS', 'ADJACENT_TERMS', 'RELATED_CPV')
  ),
  priority integer not null check (priority between 0 and 200),
  status text not null default 'AVAILABLE' check (
    status in ('AVAILABLE', 'EXPLORED', 'STALE')
  ),
  executions integer not null default 0 check (executions between 0 and 1000000),
  new_buyer_yield integer not null default 0 check (new_buyer_yield between 0 and 30),
  updated_buyer_yield integer not null default 0 check (updated_buyer_yield between 0 and 30),
  direct_verified_yield integer not null default 0 check (
    direct_verified_yield between 0 and 1000000
  ),
  provider_requests integer not null default 0 check (provider_requests between 0 and 10),
  last_explored_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (search_space_id, partition_key)
);

create table public.buyer_discovery_seen_companies (
  id bigint generated always as identity primary key,
  search_space_id uuid not null references public.buyer_discovery_search_spaces(id) on delete cascade,
  external_company_id bigint not null references public.external_companies(id) on delete cascade,
  first_discovery_run_id uuid references public.external_prospect_discovery_runs(id) on delete set null,
  last_discovery_run_id uuid references public.external_prospect_discovery_runs(id) on delete set null,
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  first_relevance_score integer not null check (first_relevance_score between 0 and 100),
  last_relevance_score integer not null check (last_relevance_score between 0 and 100),
  times_verified integer not null default 1 check (times_verified between 1 and 1000000),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (search_space_id, external_company_id)
);

create table public.buyer_discovery_run_partitions (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.external_prospect_discovery_runs(id) on delete cascade,
  partition_id bigint not null references public.buyer_discovery_partitions(id) on delete cascade,
  ordinal integer not null check (ordinal between 0 and 15),
  novelty text not null check (novelty in ('NEW_PARTITION', 'STALE_REVISIT')),
  status text not null default 'PLANNED' check (
    status in ('PLANNED', 'STARTED', 'COMPLETED', 'FAILED', 'SKIPPED')
  ),
  provider_requests integer not null default 0 check (provider_requests between 0 and 10),
  candidate_observations integer not null default 0 check (
    candidate_observations between 0 and 300
  ),
  new_buyer_yield integer not null default 0 check (new_buyer_yield between 0 and 30),
  updated_buyer_yield integer not null default 0 check (updated_buyer_yield between 0 and 30),
  direct_verified_yield integer not null default 0 check (
    direct_verified_yield between 0 and 30
  ),
  estimated_cost_usd numeric(10,6) not null default 0 check (
    estimated_cost_usd between 0 and 0.050000
  ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (run_id, partition_id)
);

alter table public.external_prospect_discovery_runs
  add column search_space_id uuid references public.buyer_discovery_search_spaces(id) on delete set null,
  add column run_mode text not null default 'NORMAL_DISCOVERY' check (
    run_mode in ('NORMAL_DISCOVERY', 'FRESH_DISCOVERY', 'ADMIN_QA_FRESH')
  ),
  add column search_generation integer not null default 0 check (
    search_generation between 0 and 1000000
  ),
  add column product_profile text not null default 'STANDARD' check (
    product_profile in ('BROAD', 'STANDARD', 'NICHE')
  ),
  add column fresh_request_state text not null default 'NOT_FRESH' check (
    fresh_request_state in (
      'NOT_FRESH', 'ACCEPTED', 'PROVIDER_STARTED', 'TERMINAL',
      'FAILED_PRE_PROVIDER', 'FAILED_AFTER_PROVIDER'
    )
  ),
  add column credit_disposition text not null default 'NOT_APPLICABLE' check (
    credit_disposition in (
      'NOT_APPLICABLE', 'WAIVED_ADMIN_QA', 'FUTURE_ATOMIC_DEBIT'
    )
  ),
  add column partition_summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(partition_summary) = 'object'
    and octet_length(partition_summary::text) <= 32768
    and partition_summary::text !~* '(email|phone|whatsapp|contact_name|linkedin_url|provider_api_key)'
  ),
  add column new_verified_buyers integer not null default 0 check (
    new_verified_buyers between 0 and 30
  ),
  add column updated_verified_buyers integer not null default 0 check (
    updated_verified_buyers between 0 and 30
  ),
  add column previously_discovered_buyers integer not null default 0 check (
    previously_discovered_buyers between 0 and 30
  ),
  add column cumulative_verified_buyers integer not null default 0 check (
    cumulative_verified_buyers between 0 and 1000000
  ),
  add column provider_execution_started_at timestamptz;

alter table public.company_external_prospect_matches
  add column discovery_state text not null default 'PREVIOUSLY_DISCOVERED' check (
    discovery_state in ('NEW', 'UPDATED', 'PREVIOUSLY_DISCOVERED')
  ),
  add column evidence_fingerprint text check (
    evidence_fingerprint is null or evidence_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  add column first_discovery_run_id uuid references public.external_prospect_discovery_runs(id) on delete set null,
  add column last_discovery_run_id uuid references public.external_prospect_discovery_runs(id) on delete set null;

insert into public.buyer_discovery_search_spaces(
  company_id, intent_hash, generation_count, fresh_run_count,
  cumulative_verified_buyers, last_discovery_at
)
select run.company_id, run.intent_hash, count(*)::integer, 0,
  count(distinct match.external_company_id)::integer, max(run.completed_at)
from public.external_prospect_discovery_runs run
left join public.company_external_prospect_matches match
  on match.company_id = run.company_id and match.intent_hash = run.intent_hash
group by run.company_id, run.intent_hash
on conflict (company_id, intent_hash) do nothing;

with ranked_runs as (
  select run.id,
    row_number() over (
      partition by run.company_id, run.intent_hash
      order by run.created_at, run.id
    )::integer as generation
  from public.external_prospect_discovery_runs run
)
update public.external_prospect_discovery_runs run
set search_space_id = space.id,
    search_generation = ranked.generation
from public.buyer_discovery_search_spaces space
join ranked_runs ranked on true
where ranked.id = run.id
  and space.company_id = run.company_id
  and space.intent_hash = run.intent_hash;

update public.company_external_prospect_matches match
set evidence_fingerprint = encode(extensions.digest(
      coalesce(match.evidence_snapshot::text, '[]'), 'sha256'
    ), 'hex'),
    first_discovery_run_id = match.discovery_run_id,
    last_discovery_run_id = match.discovery_run_id,
    discovery_state = 'PREVIOUSLY_DISCOVERED';

alter table public.company_external_prospect_matches
  alter column evidence_fingerprint set not null;

insert into public.buyer_discovery_seen_companies(
  search_space_id, external_company_id, first_discovery_run_id,
  last_discovery_run_id, evidence_fingerprint, first_relevance_score,
  last_relevance_score, first_seen_at, last_seen_at
)
select space.id, match.external_company_id, match.first_discovery_run_id,
  match.last_discovery_run_id, match.evidence_fingerprint,
  match.relevance_score, match.relevance_score,
  match.created_at, match.last_scored_at
from public.company_external_prospect_matches match
join public.buyer_discovery_search_spaces space
  on space.company_id = match.company_id and space.intent_hash = match.intent_hash
on conflict (search_space_id, external_company_id) do nothing;

create index buyer_discovery_spaces_company_updated_idx
  on public.buyer_discovery_search_spaces(company_id, updated_at desc);
create index buyer_discovery_partitions_available_idx
  on public.buyer_discovery_partitions(search_space_id, status, priority desc);
create index buyer_discovery_seen_space_last_idx
  on public.buyer_discovery_seen_companies(search_space_id, last_seen_at desc);
create index buyer_discovery_run_partitions_run_idx
  on public.buyer_discovery_run_partitions(run_id, ordinal);
create index external_prospect_admin_fresh_daily_idx
  on public.external_prospect_discovery_runs(requested_by, created_at)
  where run_mode = 'ADMIN_QA_FRESH';

create trigger buyer_discovery_spaces_set_updated_at before update
on public.buyer_discovery_search_spaces for each row execute function public.set_updated_at();
create trigger buyer_discovery_partitions_set_updated_at before update
on public.buyer_discovery_partitions for each row execute function public.set_updated_at();
create trigger buyer_discovery_seen_set_updated_at before update
on public.buyer_discovery_seen_companies for each row execute function public.set_updated_at();
create trigger buyer_discovery_run_partitions_set_updated_at before update
on public.buyer_discovery_run_partitions for each row execute function public.set_updated_at();

alter table public.buyer_discovery_search_spaces enable row level security;
alter table public.buyer_discovery_search_spaces force row level security;
alter table public.buyer_discovery_partitions enable row level security;
alter table public.buyer_discovery_partitions force row level security;
alter table public.buyer_discovery_seen_companies enable row level security;
alter table public.buyer_discovery_seen_companies force row level security;
alter table public.buyer_discovery_run_partitions enable row level security;
alter table public.buyer_discovery_run_partitions force row level security;

create policy buyer_discovery_spaces_tenant_read
on public.buyer_discovery_search_spaces for select to authenticated
using (public.company_owner_authorized_v1(company_id));

create policy buyer_discovery_partitions_tenant_read
on public.buyer_discovery_partitions for select to authenticated
using (exists (
  select 1 from public.buyer_discovery_search_spaces space
  where space.id = buyer_discovery_partitions.search_space_id
    and public.company_owner_authorized_v1(space.company_id)
));

create policy buyer_discovery_seen_tenant_read
on public.buyer_discovery_seen_companies for select to authenticated
using (exists (
  select 1 from public.buyer_discovery_search_spaces space
  where space.id = buyer_discovery_seen_companies.search_space_id
    and public.company_owner_authorized_v1(space.company_id)
));

create policy buyer_discovery_run_partitions_tenant_read
on public.buyer_discovery_run_partitions for select to authenticated
using (exists (
  select 1 from public.external_prospect_discovery_runs run
  where run.id = buyer_discovery_run_partitions.run_id
    and public.company_owner_authorized_v1(run.company_id)
));

create or replace function public.start_external_prospect_discovery_v3(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_intent jsonb,
  p_run_mode text default 'NORMAL_DISCOVERY'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '4500ms'
as $function$
declare
  v_mode text := upper(trim(coalesce(p_run_mode, 'NORMAL_DISCOVERY')));
  v_source text := upper(trim(coalesce(p_intent->>'intent_source', '')));
  v_profile public.matchmaking_profiles%rowtype;
  v_resolution_event public.product_resolution_events%rowtype;
  v_target_countries text[];
  v_taxonomy_ids bigint[];
  v_phrase text;
  v_signature text;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_run public.external_prospect_discovery_runs%rowtype;
  v_base jsonb;
  v_space public.buyer_discovery_search_spaces%rowtype;
  v_generation integer;
  v_admin_daily integer;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_intent) <> 'object'
     or octet_length(p_intent::text) > 4096 then
    raise exception 'Valid bounded discovery intent is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_intent) as keys(key)
    where keys.key not in (
      'intent_source', 'taxonomy_ids', 'target_countries',
      'normalized_product_phrase', 'resolution_event_id'
    )
  ) then
    raise exception 'Unsupported discovery intent field' using errcode = '22023';
  end if;
  if v_mode not in ('NORMAL_DISCOVERY', 'FRESH_DISCOVERY', 'ADMIN_QA_FRESH') then
    raise exception 'Unsupported discovery run mode' using errcode = '22023';
  end if;
  if v_source not in (
    'PROFILE_PRODUCT', 'AD_HOC_PRODUCT', 'WEBSITE_DETECTED_PRODUCT',
    'UNMAPPED_PRODUCT'
  ) then
    raise exception 'Unsupported discovery intent source' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_intent->'target_countries', '[]'::jsonb)) <> 'array' then
    raise exception 'Discovery intent arrays are invalid' using errcode = '22023';
  end if;

  select * into v_profile from public.matchmaking_profiles
  where company_id = p_company_id and is_active;
  if v_profile.id is null or v_profile.role <> 'manufacturer' then
    raise exception 'Buyer Discovery requires an active manufacturer match profile'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct upper(value) order by upper(value)), '{}'::text[])
  into v_target_countries
  from jsonb_array_elements_text(coalesce(p_intent->'target_countries', '[]'::jsonb)) value
  where value ~ '^[A-Za-z]{2}$';
  if jsonb_array_length(coalesce(p_intent->'target_countries', '[]'::jsonb))
     <> cardinality(v_target_countries) or cardinality(v_target_countries) > 32 then
    raise exception 'Target countries must be unique two-letter country codes'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct value::bigint order by value::bigint), '{}'::bigint[])
  into v_taxonomy_ids
  from jsonb_array_elements_text(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb)) value
  where value ~ '^[0-9]{1,18}$';
  if not (v_source = 'PROFILE_PRODUCT'
          and jsonb_array_length(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb)) = 0)
     and jsonb_array_length(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb))
       <> cardinality(v_taxonomy_ids) then
    raise exception 'Discovery taxonomy identifiers are invalid' using errcode = '22023';
  end if;
  if v_source = 'PROFILE_PRODUCT' and cardinality(v_taxonomy_ids) = 0 then
    select coalesce(array_agg(distinct mapping.taxonomy_id order by mapping.taxonomy_id), '{}'::bigint[])
    into v_taxonomy_ids
    from public.products product
    join public.product_taxonomy_mappings mapping
      on mapping.product_id = product.id and mapping.status = 'approved' and mapping.is_primary
    where product.company_id = p_company_id and product.is_active;
  end if;
  if v_source = 'UNMAPPED_PRODUCT' then
    v_phrase := public.normalize_unknown_product_phrase_v1(
      p_intent->>'normalized_product_phrase'
    );
    v_signature := public.unknown_product_phrase_signature_v1(v_phrase);
    if cardinality(v_taxonomy_ids) <> 0
       or v_phrase <> coalesce(p_intent->>'normalized_product_phrase', '')
       or not public.is_bounded_medical_product_phrase_v1(v_phrase)
       or coalesce(p_intent->>'resolution_event_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'A bounded unmapped medical-product intent is required'
        using errcode = '22023';
    end if;
    select * into v_resolution_event from public.product_resolution_events event
    where event.id = (p_intent->>'resolution_event_id')::uuid
      and event.company_id = p_company_id
      and event.phrase_signature = v_signature
      and event.resolution_status in ('UNMAPPED', 'UNMAPPED_SEARCH');
    if v_resolution_event.id is null then
      raise exception 'Product resolution event is unavailable' using errcode = '42501';
    end if;
  elsif cardinality(v_taxonomy_ids) < 1 or cardinality(v_taxonomy_ids) > 8 then
    raise exception 'Select between one and eight confirmed medical product categories'
      using errcode = '22023';
  else
    if (select count(*) from public.medical_product_taxonomy taxonomy
        where taxonomy.id = any(v_taxonomy_ids) and taxonomy.is_active)
       <> cardinality(v_taxonomy_ids) then
      raise exception 'Discovery intent contains an unavailable taxonomy category'
        using errcode = '22023';
    end if;
    if v_source = 'PROFILE_PRODUCT' and exists (
      select 1 from unnest(v_taxonomy_ids) requested_id
      where not exists (
        select 1 from public.products product
        join public.product_taxonomy_mappings mapping
          on mapping.product_id = product.id and mapping.status = 'approved'
          and mapping.is_primary
        where product.company_id = p_company_id and product.is_active
          and mapping.taxonomy_id = requested_id
      )
    ) then
      raise exception 'Profile-product intent contains a category outside this company'
        using errcode = '42501';
    end if;
    if v_source = 'AD_HOC_PRODUCT'
       and nullif(p_intent->>'resolution_event_id', '') is not null then
      select * into v_resolution_event from public.product_resolution_events event
      where event.id = (p_intent->>'resolution_event_id')::uuid
        and event.company_id = p_company_id
        and event.resolution_status in ('EXACT_APPROVED', 'SUGGESTED', 'CONFIRMED');
      if v_resolution_event.id is null or cardinality(v_taxonomy_ids) <> 1
         or not exists (
           select 1 from jsonb_array_elements(v_resolution_event.suggestions) suggestion
           where (suggestion->>'canonical_taxonomy_id')::bigint = v_taxonomy_ids[1]
         ) then
        raise exception 'Confirmed product resolution is unavailable' using errcode = '42501';
      end if;
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('buyer-discovery-vnext:' || p_company_id::text, 925)
  );
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'idempotency_key', 'requested_run_mode', v_mode,
      'run_mode', case when v_existing.run_mode = 'NORMAL_DISCOVERY'
        then 'CACHED_REUSE' else v_existing.run_mode end,
      'search_space_id', v_existing.search_space_id,
      'search_generation', v_existing.search_generation,
      'credit_disposition', v_existing.credit_disposition
    );
  end if;

  select * into v_existing
  from public.external_prospect_discovery_runs run
  where run.company_id = p_company_id
    and run.intent_source = v_source
    and coalesce(run.intent_context->'target_countries', '[]'::jsonb)
      = to_jsonb(v_target_countries)
    and (
      (v_source = 'UNMAPPED_PRODUCT'
        and public.unknown_product_phrase_signature_v1(
          run.intent_context->>'normalized_product_phrase'
        ) = v_signature)
      or
      (v_source <> 'UNMAPPED_PRODUCT' and coalesce((
        select array_agg((node->>'taxonomy_id')::bigint order by (node->>'taxonomy_id')::bigint)
        from jsonb_array_elements(coalesce(run.intent_context->'taxonomy', '[]'::jsonb)) node
      ), '{}'::bigint[]) = v_taxonomy_ids)
    )
    and run.status in ('QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED')
  order by run.created_at desc limit 1;

  if v_mode = 'NORMAL_DISCOVERY' then
    if v_existing.id is not null
       and v_existing.created_at >= clock_timestamp() - interval '14 days' then
      if v_existing.search_space_id is null then
        insert into public.buyer_discovery_search_spaces(
          company_id, intent_hash, generation_count, last_discovery_at
        ) values (
          p_company_id, v_existing.intent_hash, 1,
          coalesce(v_existing.completed_at, v_existing.created_at)
        ) on conflict (company_id, intent_hash) do update
          set generation_count = greatest(
                public.buyer_discovery_search_spaces.generation_count, 1
              ),
              updated_at = clock_timestamp()
        returning * into v_space;
        update public.external_prospect_discovery_runs
        set search_space_id = v_space.id,
            search_generation = greatest(search_generation, 1)
        where id = v_existing.id;
        v_existing.search_space_id := v_space.id;
        v_existing.search_generation := greatest(v_existing.search_generation, 1);
      end if;
      return jsonb_build_object(
        'run_id', v_existing.id, 'status', v_existing.status,
        'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
        'intent_context', v_existing.intent_context, 'reused', true,
        'reason', 'cached_intent_14_days',
        'requested_run_mode', 'NORMAL_DISCOVERY', 'run_mode', 'CACHED_REUSE',
        'search_space_id', v_existing.search_space_id,
        'search_generation', v_existing.search_generation,
        'last_verified_at', v_existing.completed_at,
        'credit_disposition', 'NOT_APPLICABLE'
      );
    end if;
    v_base := public.start_external_prospect_discovery_v2(
      p_company_id, p_idempotency_key, p_intent
    );
    select * into v_run from public.external_prospect_discovery_runs
    where id = (v_base->>'run_id')::uuid;
    insert into public.buyer_discovery_search_spaces(company_id, intent_hash)
    values (p_company_id, v_run.intent_hash)
    on conflict (company_id, intent_hash) do update
      set updated_at = clock_timestamp()
    returning * into v_space;
    if coalesce((v_base->>'reused')::boolean, false) then
      update public.external_prospect_discovery_runs
      set search_space_id = v_space.id
      where id = v_run.id and search_space_id is distinct from v_space.id;
      return v_base || jsonb_build_object(
        'requested_run_mode', 'NORMAL_DISCOVERY', 'run_mode', 'CACHED_REUSE',
        'search_space_id', v_space.id,
        'search_generation', v_run.search_generation,
        'credit_disposition', 'NOT_APPLICABLE'
      );
    end if;
    update public.buyer_discovery_search_spaces
    set generation_count = generation_count + 1,
        last_discovery_at = clock_timestamp()
    where id = v_space.id returning generation_count into v_generation;
    update public.external_prospect_discovery_runs
    set search_space_id = v_space.id,
        run_mode = 'NORMAL_DISCOVERY',
        search_generation = v_generation,
        fresh_request_state = 'NOT_FRESH',
        credit_disposition = 'NOT_APPLICABLE'
    where id = v_run.id;
    return v_base || jsonb_build_object(
      'requested_run_mode', 'NORMAL_DISCOVERY', 'run_mode', 'NORMAL_DISCOVERY',
      'search_space_id', v_space.id, 'search_generation', v_generation,
      'credit_disposition', 'NOT_APPLICABLE'
    );
  end if;

  if v_mode = 'FRESH_DISCOVERY' then
    raise exception 'Customer Fresh Discovery is feature-gated until billing entitlement is enabled'
      using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'Platform admin access required for Admin QA Fresh Discovery'
      using errcode = '42501';
  end if;
  if v_existing.id is null then
    raise exception 'Initial discovery is required before Fresh Discovery'
      using errcode = '22023';
  end if;

  select * into v_run from public.external_prospect_discovery_runs run
  where run.company_id = p_company_id and run.intent_hash = v_existing.intent_hash
    and run.run_mode = 'ADMIN_QA_FRESH' and run.status in ('QUEUED', 'RUNNING')
  order by run.created_at desc limit 1;
  if v_run.id is not null then
    return jsonb_build_object(
      'run_id', v_run.id, 'status', v_run.status, 'stage', v_run.stage,
      'intent_hash', v_run.intent_hash, 'intent_context', v_run.intent_context,
      'reused', true, 'reason', 'active_fresh_run',
      'requested_run_mode', v_mode, 'run_mode', 'ADMIN_QA_FRESH',
      'search_space_id', v_run.search_space_id,
      'search_generation', v_run.search_generation,
      'credit_disposition', 'WAIVED_ADMIN_QA'
    );
  end if;

  select count(*)::integer into v_admin_daily
  from public.external_prospect_discovery_runs
  where requested_by = auth.uid() and run_mode = 'ADMIN_QA_FRESH'
    and created_at >= date_trunc('day', clock_timestamp());
  if v_admin_daily >= 50 then
    raise exception 'Daily Admin QA Fresh Discovery limit reached' using errcode = 'P0001';
  end if;

  insert into public.buyer_discovery_search_spaces(company_id, intent_hash)
  values (p_company_id, v_existing.intent_hash)
  on conflict (company_id, intent_hash) do update
    set generation_count = public.buyer_discovery_search_spaces.generation_count + 1,
        fresh_run_count = public.buyer_discovery_search_spaces.fresh_run_count + 1,
        last_discovery_at = clock_timestamp(),
        updated_at = clock_timestamp()
  returning * into v_space;
  if v_space.generation_count = 0 then
    update public.buyer_discovery_search_spaces
    set generation_count = 1, fresh_run_count = 1
    where id = v_space.id returning * into v_space;
  end if;

  insert into public.external_prospect_discovery_runs(
    company_id, requested_by, idempotency_key, intent_hash, intent_source,
    intent_context, resolution_event_id, search_space_id, run_mode,
    search_generation, fresh_request_state, credit_disposition
  ) values (
    p_company_id, auth.uid(), p_idempotency_key, v_existing.intent_hash,
    v_existing.intent_source, v_existing.intent_context,
    v_existing.resolution_event_id, v_space.id, 'ADMIN_QA_FRESH',
    v_space.generation_count, 'ACCEPTED', 'WAIVED_ADMIN_QA'
  ) returning * into v_run;

  -- This creates the bounded Fresh request only. Future customer credit debit
  -- belongs in accept_buyer_discovery_execution_v1, after an executable plan
  -- exists. Cached reuse and pre-provider planning failure never reach it.
  return jsonb_build_object(
    'run_id', v_run.id, 'status', v_run.status, 'stage', v_run.stage,
    'intent_hash', v_run.intent_hash, 'intent_context', v_run.intent_context,
    'reused', false, 'reason', 'admin_fresh_created',
    'requested_run_mode', v_mode, 'run_mode', 'ADMIN_QA_FRESH',
    'search_space_id', v_space.id,
    'search_generation', v_space.generation_count,
    'credit_disposition', 'WAIVED_ADMIN_QA'
  );
end
$function$;

create or replace function public.accept_buyer_discovery_execution_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_run public.external_prospect_discovery_runs%rowtype;
  v_partition_count integer;
begin
  select * into v_run from public.external_prospect_discovery_runs
  where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Discovery run is unavailable' using errcode = '22023';
  end if;
  if v_run.status not in ('QUEUED', 'RUNNING') then
    raise exception 'Discovery run is not executable' using errcode = '22023';
  end if;
  if v_run.provider_execution_started_at is not null then
    return jsonb_build_object(
      'run_id', v_run.id, 'accepted', true, 'reused', true,
      'run_mode', v_run.run_mode,
      'credit_disposition', v_run.credit_disposition
    );
  end if;
  select count(*)::integer into v_partition_count
  from public.buyer_discovery_run_partitions
  where run_id = v_run.id and status = 'PLANNED';
  if v_partition_count < 1 then
    raise exception 'No fresh search partition is ready for execution'
      using errcode = '22023';
  end if;

  -- Future customer-credit debit attaches here, in this transaction, after
  -- executable partitions exist and while the run row is locked. CACHED_REUSE
  -- has no new run/partitions and cannot reach this boundary. ADMIN_QA_FRESH is
  -- explicitly waived. A failure before this boundary remains pre-provider.
  update public.external_prospect_discovery_runs
  set provider_execution_started_at = clock_timestamp(),
      fresh_request_state = case when run_mode = 'NORMAL_DISCOVERY'
        then 'NOT_FRESH' else 'PROVIDER_STARTED' end
  where id = v_run.id;
  return jsonb_build_object(
    'run_id', v_run.id, 'accepted', true, 'reused', false,
    'run_mode', v_run.run_mode,
    'partition_count', v_partition_count,
    'credit_disposition', v_run.credit_disposition
  );
end
$function$;

create or replace function public.get_external_prospect_workspace_v3(
  p_company_id bigint,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '4000ms'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  v_result := public.get_external_prospect_workspace_v2(p_company_id, p_limit);
  v_result := jsonb_set(v_result, '{runs}', coalesce((
    select jsonb_agg(to_jsonb(run_row) order by run_row.created_at desc)
    from (
      select id, status, stage, intent_hash, intent_source, intent_context,
        run_mode, search_space_id, search_generation, product_profile,
        fresh_request_state, credit_disposition, partition_summary,
        new_verified_buyers, updated_verified_buyers,
        previously_discovered_buyers, cumulative_verified_buyers,
        queries_generated, sources_checked, candidates_found,
        candidates_deduplicated, candidates_accepted, candidates_rejected,
        taxonomy_mapped, ai_classifications, provider_requests,
        estimated_cost_usd, error_code, started_at, completed_at, created_at
      from public.external_prospect_discovery_runs
      where company_id = p_company_id
      order by created_at desc limit 20
    ) run_row
  ), '[]'::jsonb));
  v_result := jsonb_set(v_result, '{search_spaces}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', space.id, 'intent_hash', space.intent_hash,
      'product_profile', space.product_profile,
      'generation_count', space.generation_count,
      'fresh_run_count', space.fresh_run_count,
      'cumulative_verified_buyers', space.cumulative_verified_buyers,
      'last_new_buyer_yield', space.last_new_buyer_yield,
      'zero_new_streak', space.zero_new_streak,
      'saturation_signal', space.saturation_signal,
      'last_discovery_at', space.last_discovery_at
    ) order by space.updated_at desc)
    from public.buyer_discovery_search_spaces space
    where space.company_id = p_company_id
  ), '[]'::jsonb), true);
  v_result := jsonb_set(v_result, '{prospects}', coalesce((
    select jsonb_agg(prospect || jsonb_build_object(
      'discovery_state', match.discovery_state,
      'first_discovery_run_id', match.first_discovery_run_id,
      'last_discovery_run_id', match.last_discovery_run_id
    ) order by (prospect->>'relevance_score')::integer desc)
    from jsonb_array_elements(v_result->'prospects') prospect
    join public.company_external_prospect_matches match
      on match.id = (prospect->>'match_id')::bigint
      and match.company_id = p_company_id
  ), '[]'::jsonb));
  return v_result;
end
$function$;

revoke all on table public.buyer_discovery_search_spaces,
  public.buyer_discovery_partitions, public.buyer_discovery_seen_companies,
  public.buyer_discovery_run_partitions from public, anon, authenticated;
grant select on table public.buyer_discovery_search_spaces,
  public.buyer_discovery_partitions, public.buyer_discovery_seen_companies,
  public.buyer_discovery_run_partitions to authenticated;
grant all on table public.buyer_discovery_search_spaces,
  public.buyer_discovery_partitions, public.buyer_discovery_seen_companies,
  public.buyer_discovery_run_partitions to service_role;
grant usage, select on sequence public.buyer_discovery_partitions_id_seq,
  public.buyer_discovery_seen_companies_id_seq,
  public.buyer_discovery_run_partitions_id_seq to service_role;

revoke all on function public.start_external_prospect_discovery_v3(
  bigint, uuid, jsonb, text
), public.get_external_prospect_workspace_v3(bigint, integer),
  public.accept_buyer_discovery_execution_v1(uuid)
from public, anon, authenticated;
grant execute on function public.start_external_prospect_discovery_v3(
  bigint, uuid, jsonb, text
), public.get_external_prospect_workspace_v3(bigint, integer)
to authenticated, service_role;
grant execute on function public.accept_buyer_discovery_execution_v1(uuid)
to service_role;

comment on table public.buyer_discovery_search_spaces is
  'Tenant-scoped canonical product search memory and cumulative verified-buyer yield. No contacts or raw provider content.';
comment on table public.buyer_discovery_partitions is
  'Bounded deterministic terminology, language, market, archetype and TED partitions. No raw provider queries or content.';
comment on table public.buyer_discovery_seen_companies is
  'Tenant/product-scoped verified company memory used for NEW, UPDATED and PREVIOUSLY_DISCOVERED semantics.';
comment on function public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text) is
  'Atomic normal/cache/admin-fresh gate. Customer Fresh remains disabled until billing entitlements exist; admin fresh is capped at 50/day/admin.';
comment on function public.accept_buyer_discovery_execution_v1(uuid) is
  'Service-only transaction-safe provider-execution boundary and future Fresh Discovery credit-debit attachment point.';

commit;

-- Universal High-Recall Medical Buyer Discovery V2
--
-- Forward-only persistence and rollout controls for the high-recall ranking
-- contract. The release remains OFF by default. The wider database ceilings
-- are storage safety bounds only; provider execution remains controlled by
-- the server-side feature state and Edge Function budgets.

begin;

do $preflight$
begin
  if to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.company_external_prospect_matches') is null
     or to_regclass('public.buyer_discovery_search_spaces') is null
     or to_regclass('public.buyer_discovery_partitions') is null
     or to_regclass('public.buyer_discovery_run_partitions') is null
     or to_regclass('public.external_public_web_request_cache') is null
     or to_regclass('public.ai_buyer_relevance_judge_feature_state') is null
     or to_regclass('public.buyer_relevance_judgments') is null
     or to_regprocedure('public.get_external_prospect_workspace_v3(bigint,integer)') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Universal High-Recall Buyer Discovery V2 preflight failed';
  end if;
end
$preflight$;

-- Rollout policy is deliberately independent from Smart Resolver, AI Buyer
-- Judge, Adaptive Retrieval and Customer Fresh flags.
create table public.universal_high_recall_buyer_discovery_feature_state (
  singleton boolean primary key default true check (singleton),
  high_recall_enabled boolean not null default false,
  architecture_version text not null default 'UNIVERSAL_HIGH_RECALL_V2' check (
    architecture_version ~ '^UNIVERSAL_HIGH_RECALL_V[0-9]+$'
  ),
  baseline_public_web_request_ceiling integer not null default 10 check (
    baseline_public_web_request_ceiling between 1 and 10
  ),
  high_recall_public_web_checkpoint_1 integer not null default 10 check (
    high_recall_public_web_checkpoint_1 between 1 and 25
  ),
  high_recall_public_web_checkpoint_2 integer not null default 15 check (
    high_recall_public_web_checkpoint_2 between 1 and 25
  ),
  high_recall_public_web_checkpoint_3 integer not null default 25 check (
    high_recall_public_web_checkpoint_3 between 1 and 25
  ),
  high_recall_public_web_maximum integer not null default 25 check (
    high_recall_public_web_maximum between 10 and 25
  ),
  baseline_shallow_verification_ceiling integer not null default 6 check (
    baseline_shallow_verification_ceiling between 1 and 6
  ),
  baseline_deep_verification_ceiling integer not null default 6 check (
    baseline_deep_verification_ceiling between 1 and 6
  ),
  high_recall_shallow_verification_ceiling integer not null default 50 check (
    high_recall_shallow_verification_ceiling between 6 and 50
  ),
  high_recall_deep_verification_ceiling integer not null default 12 check (
    high_recall_deep_verification_ceiling between 6 and 12
  ),
  broad_display_target integer not null default 50 check (
    broad_display_target between 1 and 100
  ),
  standard_display_target integer not null default 35 check (
    standard_display_target between 1 and 100
  ),
  niche_display_target integer not null default 20 check (
    niche_display_target between 1 and 100
  ),
  maximum_persisted_prospects integer not null default 100 check (
    maximum_persisted_prospects between 25 and 100
  ),
  default_page_size integer not null default 25 check (
    default_page_size between 1 and 50
  ),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    high_recall_public_web_checkpoint_1
      <= high_recall_public_web_checkpoint_2
    and high_recall_public_web_checkpoint_2
      <= high_recall_public_web_checkpoint_3
    and high_recall_public_web_checkpoint_3
      <= high_recall_public_web_maximum
  ),
  check (niche_display_target <= standard_display_target),
  check (standard_display_target <= broad_display_target)
);

insert into public.universal_high_recall_buyer_discovery_feature_state(singleton)
values (true);

alter table public.universal_high_recall_buyer_discovery_feature_state
  enable row level security;
alter table public.universal_high_recall_buyer_discovery_feature_state
  force row level security;

create or replace function public.set_universal_high_recall_buyer_discovery_v2(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  v_state public.universal_high_recall_buyer_discovery_feature_state%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Explicit feature state is required' using errcode = '22023';
  end if;
  update public.universal_high_recall_buyer_discovery_feature_state
  set high_recall_enabled = p_enabled,
      updated_by = auth.uid(),
      updated_at = clock_timestamp()
  where singleton
  returning * into v_state;
  return jsonb_build_object(
    'high_recall_enabled', v_state.high_recall_enabled,
    'architecture_version', v_state.architecture_version,
    'updated_at', v_state.updated_at
  );
end
$function$;

-- Expand persisted run counters to the bounded V2 capacity. These constraints
-- do not themselves authorize more provider calls.
alter table public.external_prospect_discovery_runs
  drop constraint if exists external_prospect_discovery_runs_queries_generated_check,
  drop constraint if exists external_prospect_discovery_runs_provider_requests_check,
  drop constraint if exists external_prospect_discovery_runs_estimated_cost_usd_check,
  drop constraint if exists external_prospect_discovery_runs_sources_checked_check,
  drop constraint if exists external_prospect_discovery_runs_candidates_found_check,
  drop constraint if exists external_prospect_discovery_runs_candidates_deduplicated_check,
  drop constraint if exists external_prospect_discovery_runs_candidates_accepted_check,
  drop constraint if exists external_prospect_discovery_runs_candidates_rejected_check,
  drop constraint if exists external_prospect_discovery_runs_new_verified_buyers_check,
  drop constraint if exists external_prospect_discovery_runs_updated_verified_buyers_check,
  drop constraint if exists external_prospect_discovery_runs_previously_discovered_buyers_check;

alter table public.external_prospect_discovery_runs
  add constraint external_prospect_discovery_runs_queries_generated_v2_check
    check (queries_generated between 0 and 32),
  add constraint external_prospect_discovery_runs_provider_requests_v2_check
    check (provider_requests between 0 and 32),
  add constraint external_prospect_discovery_runs_estimated_cost_usd_v2_check
    check (estimated_cost_usd between 0 and 0.250000),
  add constraint external_prospect_discovery_runs_sources_checked_v2_check
    check (sources_checked between 0 and 300),
  add constraint external_prospect_discovery_runs_candidates_found_v2_check
    check (candidates_found between 0 and 300),
  add constraint external_prospect_discovery_runs_candidates_deduplicated_v2_check
    check (candidates_deduplicated between 0 and 300),
  add constraint external_prospect_discovery_runs_candidates_accepted_v2_check
    check (candidates_accepted between 0 and 100),
  add constraint external_prospect_discovery_runs_candidates_rejected_v2_check
    check (candidates_rejected between 0 and 300),
  add constraint external_prospect_discovery_runs_new_verified_buyers_v2_check
    check (new_verified_buyers between 0 and 100),
  add constraint external_prospect_discovery_runs_updated_verified_buyers_v2_check
    check (updated_verified_buyers between 0 and 100),
  add constraint external_prospect_discovery_runs_previously_discovered_buyers_v2_check
    check (previously_discovered_buyers between 0 and 100);

alter table public.buyer_discovery_search_spaces
  drop constraint if exists buyer_discovery_search_spaces_last_new_buyer_yield_check;
alter table public.buyer_discovery_search_spaces
  add constraint buyer_discovery_search_spaces_last_new_buyer_yield_v2_check
    check (last_new_buyer_yield between 0 and 100);

alter table public.buyer_discovery_partitions
  drop constraint if exists buyer_discovery_partitions_new_buyer_yield_check,
  drop constraint if exists buyer_discovery_partitions_updated_buyer_yield_check,
  drop constraint if exists buyer_discovery_partitions_provider_requests_check;
alter table public.buyer_discovery_partitions
  add constraint buyer_discovery_partitions_new_buyer_yield_v2_check
    check (new_buyer_yield between 0 and 1000000),
  add constraint buyer_discovery_partitions_updated_buyer_yield_v2_check
    check (updated_buyer_yield between 0 and 1000000),
  add constraint buyer_discovery_partitions_provider_requests_v2_check
    check (provider_requests between 0 and 1000000);

-- High-recall query variants are still server-generated and capped at 25,
-- but the shared cache must be able to persist waves beyond legacy variants
-- 0..9.
alter table public.external_public_web_request_cache
  drop constraint if exists external_public_web_request_cache_query_variant_check;
alter table public.external_public_web_request_cache
  add constraint external_public_web_request_cache_query_variant_v2_check
    check (query_variant between 0 and 24);

alter table public.buyer_discovery_run_partitions
  drop constraint if exists buyer_discovery_run_partitions_ordinal_check,
  drop constraint if exists buyer_discovery_run_partitions_new_buyer_yield_check,
  drop constraint if exists buyer_discovery_run_partitions_updated_buyer_yield_check,
  drop constraint if exists buyer_discovery_run_partitions_direct_verified_yield_check;
alter table public.buyer_discovery_run_partitions
  add constraint buyer_discovery_run_partitions_ordinal_v2_check
    check (ordinal between 0 and 31),
  add constraint buyer_discovery_run_partitions_new_buyer_yield_v2_check
    check (new_buyer_yield between 0 and 100),
  add constraint buyer_discovery_run_partitions_updated_buyer_yield_v2_check
    check (updated_buyer_yield between 0 and 100),
  add constraint buyer_discovery_run_partitions_direct_verified_yield_v2_check
    check (direct_verified_yield between 0 and 100);

-- Add the separated product-fit, evidence-confidence and sales-actionability
-- dimensions without erasing the legacy relevance/buyer-fit contract.
alter table public.company_external_prospect_matches
  add column prospect_tier text,
  add column sales_actionability_score integer,
  add column sales_actionability_grade text,
  add column evidence_level integer,
  add column evidence_facets jsonb,
  add column evidence_confidence_score integer,
  add column evidence_confidence_grade text,
  add column final_rank_score integer,
  add column ranking_version text,
  add column displayable boolean;

update public.company_external_prospect_matches match
set prospect_tier = case
      when match.buyer_fit_score >= 75 then 'STRONG_COMMERCIAL_PROSPECT'
      else 'LIKELY_COMMERCIAL_PROSPECT'
    end,
    sales_actionability_score = least(100, greatest(0,
      match.company_type_score * 4 + match.geography_score * 2 +
      match.procurement_signal_score * 2
    )),
    sales_actionability_grade = case
      when match.company_type_score * 4 + match.geography_score * 2 +
           match.procurement_signal_score * 2 >= 70 then 'HIGH'
      when match.company_type_score * 4 + match.geography_score * 2 +
           match.procurement_signal_score * 2 >= 40 then 'MEDIUM'
      else 'LOW'
    end,
    evidence_facets = jsonb_build_object(
      'company', true,
      'category', jsonb_array_length(match.taxonomy_snapshot) > 0
        or jsonb_array_length(match.activity_snapshot) > 0,
      'product', jsonb_path_exists(
        match.evidence_snapshot,
        '$[*] ? (@.relevance_class == "DIRECT" || @.relevance_class == "ADJACENT")'
      ),
      'commercial', match.company_type_score > 0
        or match.procurement_signal_score > 0
        or jsonb_array_length(match.activity_snapshot) > 0
    ),
    evidence_level = case
      when jsonb_path_exists(
        match.evidence_snapshot,
        '$[*] ? (@.relevance_class == "DIRECT" || @.relevance_class == "ADJACENT")'
      ) and (
        match.company_type_score > 0 or match.procurement_signal_score > 0
        or jsonb_array_length(match.activity_snapshot) > 0
      ) then 4
      when jsonb_path_exists(
        match.evidence_snapshot,
        '$[*] ? (@.relevance_class == "DIRECT" || @.relevance_class == "ADJACENT")'
      ) then 3
      when jsonb_array_length(match.taxonomy_snapshot) > 0
        or jsonb_array_length(match.activity_snapshot) > 0 then 2
      else 1
    end,
    evidence_confidence_score = least(100, greatest(0,
      match.evidence_quality_score * 10
    )),
    evidence_confidence_grade = case
      when match.evidence_quality_score >= 8 then 'HIGH'
      when match.evidence_quality_score >= 5 then 'MEDIUM'
      else 'LOW'
    end,
    final_rank_score = match.buyer_fit_score,
    ranking_version = 'LEGACY_V1',
    displayable = true;

alter table public.company_external_prospect_matches
  alter column prospect_tier set default 'LIKELY_COMMERCIAL_PROSPECT',
  alter column prospect_tier set not null,
  alter column sales_actionability_score set default 0,
  alter column sales_actionability_score set not null,
  alter column sales_actionability_grade set default 'LOW',
  alter column sales_actionability_grade set not null,
  alter column evidence_level set default 1,
  alter column evidence_level set not null,
  alter column evidence_facets set default
    '{"company":true,"category":false,"product":false,"commercial":false}'::jsonb,
  alter column evidence_facets set not null,
  alter column evidence_confidence_score set default 0,
  alter column evidence_confidence_score set not null,
  alter column evidence_confidence_grade set default 'LOW',
  alter column evidence_confidence_grade set not null,
  alter column final_rank_score set default 0,
  alter column final_rank_score set not null,
  alter column ranking_version set default 'LEGACY_V1',
  alter column ranking_version set not null,
  alter column displayable set default true,
  alter column displayable set not null,
  add constraint company_external_matches_prospect_tier_check check (
    prospect_tier in (
      'STRONG_COMMERCIAL_PROSPECT', 'LIKELY_COMMERCIAL_PROSPECT',
      'POTENTIAL_COMMERCIAL_PROSPECT', 'LOW_CONFIDENCE', 'HARD_REJECT'
    )
  ),
  add constraint company_external_matches_sales_actionability_score_check
    check (sales_actionability_score between 0 and 100),
  add constraint company_external_matches_sales_actionability_grade_check
    check (sales_actionability_grade in ('HIGH', 'MEDIUM', 'LOW')),
  add constraint company_external_matches_evidence_level_check
    check (evidence_level between 0 and 4),
  add constraint company_external_matches_evidence_facets_check check (
    jsonb_typeof(evidence_facets) = 'object'
    and jsonb_typeof(evidence_facets->'company') = 'boolean'
    and jsonb_typeof(evidence_facets->'category') = 'boolean'
    and jsonb_typeof(evidence_facets->'product') = 'boolean'
    and jsonb_typeof(evidence_facets->'commercial') = 'boolean'
    and octet_length(evidence_facets::text) <= 256
  ),
  add constraint company_external_matches_evidence_confidence_score_check
    check (evidence_confidence_score between 0 and 100),
  add constraint company_external_matches_evidence_confidence_grade_check
    check (evidence_confidence_grade in ('HIGH', 'MEDIUM', 'LOW')),
  add constraint company_external_matches_final_rank_score_check
    check (final_rank_score between 0 and 100),
  add constraint company_external_matches_ranking_version_check check (
    ranking_version ~ '^[A-Z0-9_]{3,80}$'
  ),
  add constraint company_external_matches_displayable_tier_check check (
    not displayable or prospect_tier in (
      'STRONG_COMMERCIAL_PROSPECT', 'LIKELY_COMMERCIAL_PROSPECT',
      'POTENTIAL_COMMERCIAL_PROSPECT'
    )
  );

create index company_external_matches_v2_rank_idx
on public.company_external_prospect_matches(
  company_id, intent_hash, displayable, final_rank_score desc, id
);

-- Keep an immutable-per-run ranked membership/rank snapshot. The canonical
-- company/match row may be refreshed in a later run; this relation preserves
-- which ranked prospects belonged to each cached run.
create table public.buyer_discovery_run_ranked_prospects (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.external_prospect_discovery_runs(id)
    on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  intent_hash text not null check (intent_hash ~ '^[a-f0-9]{64}$'),
  match_id bigint not null references public.company_external_prospect_matches(id)
    on delete cascade,
  external_company_id bigint not null references public.external_companies(id)
    on delete cascade,
  prospect_tier text not null check (prospect_tier in (
    'STRONG_COMMERCIAL_PROSPECT', 'LIKELY_COMMERCIAL_PROSPECT',
    'POTENTIAL_COMMERCIAL_PROSPECT', 'LOW_CONFIDENCE', 'HARD_REJECT'
  )),
  buyer_fit_score integer not null check (buyer_fit_score between 0 and 100),
  buyer_fit_grade text not null check (buyer_fit_grade in ('HIGH','MEDIUM','LOW')),
  sales_actionability_score integer not null check (
    sales_actionability_score between 0 and 100
  ),
  sales_actionability_grade text not null check (
    sales_actionability_grade in ('HIGH','MEDIUM','LOW')
  ),
  evidence_level integer not null check (evidence_level between 0 and 4),
  evidence_facets jsonb not null check (
    jsonb_typeof(evidence_facets) = 'object'
    and octet_length(evidence_facets::text) <= 256
  ),
  evidence_confidence_score integer not null check (
    evidence_confidence_score between 0 and 100
  ),
  evidence_confidence_grade text not null check (
    evidence_confidence_grade in ('HIGH','MEDIUM','LOW')
  ),
  final_rank_score integer not null check (final_rank_score between 0 and 100),
  relevance_score integer not null check (relevance_score between 0 and 100),
  ranking_version text not null check (ranking_version ~ '^[A-Z0-9_]{3,80}$'),
  displayable boolean not null,
  ranked_at timestamptz not null default clock_timestamp(),
  unique (run_id, match_id)
);

create index buyer_discovery_run_ranked_prospects_page_idx
on public.buyer_discovery_run_ranked_prospects(
  company_id, run_id, displayable, final_rank_score desc, match_id
);

alter table public.buyer_discovery_run_ranked_prospects enable row level security;
alter table public.buyer_discovery_run_ranked_prospects force row level security;

create policy buyer_discovery_run_ranked_prospects_tenant_read
on public.buyer_discovery_run_ranked_prospects for select to authenticated
using (public.company_owner_authorized_v1(company_id));

create or replace function public.sync_buyer_discovery_run_ranked_prospect_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run_id uuid := coalesce(new.last_discovery_run_id, new.discovery_run_id);
begin
  if v_run_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.external_prospect_discovery_runs run
    where run.id = v_run_id and run.company_id = new.company_id
      and run.intent_hash = new.intent_hash
  ) then
    raise exception 'Ranked prospect run scope is invalid' using errcode = '23514';
  end if;
  if not new.displayable then
    delete from public.buyer_discovery_run_ranked_prospects snapshot
    where snapshot.run_id = v_run_id and snapshot.match_id = new.id;
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('buyer-discovery-run-rank:' || v_run_id::text, 904001)
  );
  if not exists (
    select 1 from public.buyer_discovery_run_ranked_prospects snapshot
    where snapshot.run_id = v_run_id and snapshot.match_id = new.id
  ) and (
    select count(*) from public.buyer_discovery_run_ranked_prospects snapshot
    where snapshot.run_id = v_run_id
  ) >= 100 then
    raise exception 'A discovery run cannot persist more than 100 ranked prospects'
      using errcode = '23514';
  end if;
  insert into public.buyer_discovery_run_ranked_prospects(
    run_id, company_id, intent_hash, match_id, external_company_id,
    prospect_tier, buyer_fit_score, buyer_fit_grade,
    sales_actionability_score, sales_actionability_grade,
    evidence_level, evidence_facets, evidence_confidence_score,
    evidence_confidence_grade, final_rank_score, relevance_score,
    ranking_version, displayable, ranked_at
  ) values (
    v_run_id, new.company_id, new.intent_hash, new.id,
    new.external_company_id, new.prospect_tier, new.buyer_fit_score,
    new.buyer_fit_grade, new.sales_actionability_score,
    new.sales_actionability_grade, new.evidence_level, new.evidence_facets,
    new.evidence_confidence_score, new.evidence_confidence_grade,
    new.final_rank_score, new.relevance_score, new.ranking_version,
    new.displayable, clock_timestamp()
  ) on conflict (run_id, match_id) do update set
    prospect_tier = excluded.prospect_tier,
    buyer_fit_score = excluded.buyer_fit_score,
    buyer_fit_grade = excluded.buyer_fit_grade,
    sales_actionability_score = excluded.sales_actionability_score,
    sales_actionability_grade = excluded.sales_actionability_grade,
    evidence_level = excluded.evidence_level,
    evidence_facets = excluded.evidence_facets,
    evidence_confidence_score = excluded.evidence_confidence_score,
    evidence_confidence_grade = excluded.evidence_confidence_grade,
    final_rank_score = excluded.final_rank_score,
    relevance_score = excluded.relevance_score,
    ranking_version = excluded.ranking_version,
    displayable = excluded.displayable,
    ranked_at = clock_timestamp();
  return new;
end
$function$;

create trigger sync_buyer_discovery_run_ranked_prospect_v2
after insert or update on public.company_external_prospect_matches
for each row execute function public.sync_buyer_discovery_run_ranked_prospect_v2();

insert into public.buyer_discovery_run_ranked_prospects(
  run_id, company_id, intent_hash, match_id, external_company_id,
  prospect_tier, buyer_fit_score, buyer_fit_grade,
  sales_actionability_score, sales_actionability_grade,
  evidence_level, evidence_facets, evidence_confidence_score,
  evidence_confidence_grade, final_rank_score, relevance_score,
  ranking_version, displayable, ranked_at
)
select coalesce(match.last_discovery_run_id, match.discovery_run_id),
  match.company_id, match.intent_hash, match.id, match.external_company_id,
  match.prospect_tier, match.buyer_fit_score, match.buyer_fit_grade,
  match.sales_actionability_score, match.sales_actionability_grade,
  match.evidence_level, match.evidence_facets,
  match.evidence_confidence_score, match.evidence_confidence_grade,
  match.final_rank_score, match.relevance_score, match.ranking_version,
  match.displayable, match.last_scored_at
from public.company_external_prospect_matches match
where match.displayable
  and coalesce(match.last_discovery_run_id, match.discovery_run_id) is not null
on conflict (run_id, match_id) do nothing;

-- Stable keyset pagination over one tenant/run. The response deliberately
-- includes only public company evidence already exposed by the workspace RPC.
create or replace function public.get_buyer_discovery_ranked_prospects_v2(
  p_company_id bigint,
  p_run_id uuid,
  p_page_size integer default 25,
  p_after_final_rank_score integer default null,
  p_after_match_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3500ms'
as $function$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
  v_result jsonb;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_run_id is null or not exists (
    select 1 from public.external_prospect_discovery_runs run
    where run.id = p_run_id and run.company_id = p_company_id
  ) then
    raise exception 'Discovery run is unavailable' using errcode = '42501';
  end if;
  if (p_after_final_rank_score is null) <> (p_after_match_id is null)
     or (p_after_final_rank_score is not null
         and p_after_final_rank_score not between 0 and 100)
     or (p_after_match_id is not null and p_after_match_id < 1) then
    raise exception 'Invalid prospect page cursor' using errcode = '22023';
  end if;

  with eligible as (
    select snapshot.*, match.workflow_status, match.reason_summary,
      match.reasons, match.evidence_snapshot, match.activity_snapshot,
      match.taxonomy_snapshot, match.ai_buyer_judge_status,
      match.ai_buyer_recommended_grade, match.ai_buyer_reason_codes,
      match.ai_buyer_short_explanation, match.discovery_state,
      external_company.company_name, external_company.country_code,
      external_company.country_name, external_company.city_region,
      external_company.company_type, external_company.website_url,
      external_company.business_description, external_company.membership_status
    from public.buyer_discovery_run_ranked_prospects snapshot
    join public.company_external_prospect_matches match
      on match.id = snapshot.match_id and match.company_id = snapshot.company_id
    join public.external_companies external_company
      on external_company.id = snapshot.external_company_id
    where snapshot.company_id = p_company_id
      and snapshot.run_id = p_run_id
      and snapshot.displayable
      and external_company.membership_status = 'NOT_ON_MEDICHALL'
      and external_company.duplicate_status = 'ACTIVE'
      and (
        p_after_final_rank_score is null
        or snapshot.final_rank_score < p_after_final_rank_score
        or (
          snapshot.final_rank_score = p_after_final_rank_score
          and snapshot.match_id > p_after_match_id
        )
      )
    order by snapshot.final_rank_score desc, snapshot.match_id
    limit v_page_size + 1
  ), page_rows as (
    select * from eligible
    order by final_rank_score desc, match_id
    limit v_page_size
  ), page_tail as (
    select final_rank_score, match_id from page_rows
    order by final_rank_score, match_id desc limit 1
  )
  select jsonb_build_object(
    'run_id', p_run_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'match_id', item.match_id,
        'external_company_id', item.external_company_id,
        'company_name', item.company_name,
        'country_code', item.country_code,
        'country_name', item.country_name,
        'city_region', item.city_region,
        'company_type', item.company_type,
        'website_url', item.website_url,
        'business_description', item.business_description,
        'prospect_tier', item.prospect_tier,
        'buyer_fit_score', item.buyer_fit_score,
        'buyer_fit_grade', item.buyer_fit_grade,
        'sales_actionability_score', item.sales_actionability_score,
        'sales_actionability_grade', item.sales_actionability_grade,
        'evidence_level', item.evidence_level,
        'evidence_facets', item.evidence_facets,
        'evidence_confidence_score', item.evidence_confidence_score,
        'evidence_confidence_grade', item.evidence_confidence_grade,
        'final_rank_score', item.final_rank_score,
        'relevance_score', item.relevance_score,
        'ranking_version', item.ranking_version,
        'reason_summary', item.reason_summary,
        'reasons', item.reasons,
        'evidence', item.evidence_snapshot,
        'activities', item.activity_snapshot,
        'taxonomy', item.taxonomy_snapshot,
        'workflow_status', item.workflow_status,
        'discovery_state', item.discovery_state,
        'ai_buyer_judge_status', item.ai_buyer_judge_status,
        'ai_buyer_recommended_grade', item.ai_buyer_recommended_grade,
        'ai_buyer_reason_codes', item.ai_buyer_reason_codes,
        'ai_buyer_short_explanation', item.ai_buyer_short_explanation,
        'ranked_at', item.ranked_at
      ) order by item.final_rank_score desc, item.match_id)
      from page_rows item
    ), '[]'::jsonb),
    'page', jsonb_build_object(
      'page_size', v_page_size,
      'returned_count', (select count(*) from page_rows),
      'has_more', (select count(*) from eligible) > v_page_size,
      'next_cursor', case
        when (select count(*) from eligible) > v_page_size then (
          select jsonb_build_object(
            'final_rank_score', page_tail.final_rank_score,
            'match_id', page_tail.match_id
          ) from page_tail
        ) else null end
    ),
    'total_displayable', (
      select count(*) from public.buyer_discovery_run_ranked_prospects snapshot
      where snapshot.company_id = p_company_id
        and snapshot.run_id = p_run_id and snapshot.displayable
    )
  ) into v_result;
  return v_result;
end
$function$;

-- The feature identifier remains V1; implementation V2 is patch-level
-- behavior. Expire older completed cache entries so changed ranking semantics
-- cannot silently reuse V1_0 judgments.
update public.ai_buyer_relevance_judge_feature_state
set implementation_version = 'AI_BUYER_RELEVANCE_JUDGE_V2_0',
    updated_at = clock_timestamp()
where singleton;

update public.buyer_relevance_judgments
set expires_at = least(expires_at, clock_timestamp()),
    updated_at = clock_timestamp()
where implementation_version <> 'AI_BUYER_RELEVANCE_JUDGE_V2_0'
  and status in ('COMPLETED', 'FAILED');

revoke all on table public.universal_high_recall_buyer_discovery_feature_state,
  public.buyer_discovery_run_ranked_prospects
from public, anon, authenticated, service_role;
grant select on table public.universal_high_recall_buyer_discovery_feature_state,
  public.buyer_discovery_run_ranked_prospects
to service_role;

revoke all on function
  public.sync_buyer_discovery_run_ranked_prospect_v2(),
  public.set_universal_high_recall_buyer_discovery_v2(boolean),
  public.get_buyer_discovery_ranked_prospects_v2(
    bigint, uuid, integer, integer, bigint
  )
from public, anon, authenticated, service_role;
grant execute on function
  public.set_universal_high_recall_buyer_discovery_v2(boolean),
  public.get_buyer_discovery_ranked_prospects_v2(
    bigint, uuid, integer, integer, bigint
  )
to authenticated, service_role;

comment on table public.universal_high_recall_buyer_discovery_feature_state is
  'Independent server-controlled rollout and bounded capacity policy for Universal High-Recall Buyer Discovery V2. Disabled by default.';
comment on table public.buyer_discovery_run_ranked_prospects is
  'Tenant-scoped ranked prospect membership snapshot supporting up to 100 displayable prospects per discovery run and stable keyset pagination.';
comment on function public.get_buyer_discovery_ranked_prospects_v2(
  bigint, uuid, integer, integer, bigint
) is
  'Tenant-authorized run-scoped keyset pagination ordered by final rank and match id. Returns at most 50 public-evidence prospects per page.';
comment on function public.set_universal_high_recall_buyer_discovery_v2(boolean) is
  'Admin-only Universal High-Recall Buyer Discovery V2 rollout switch. Independent of Customer Fresh and other AI feature flags.';

commit;

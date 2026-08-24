-- Buyer Discovery: normalized profile/ad-hoc/website product intents.
-- Forward-only extension of the existing External Prospect Discovery engine.

do $migration_gate$
begin
  if to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.company_external_prospect_matches') is null
     or to_regprocedure('public.start_external_prospect_discovery_v1(bigint,uuid)') is null
     or to_regprocedure('public.resolve_medical_product_term_v1(text,integer)') is null then
    raise exception 'Buyer Discovery Phase 2 and Medical Product Taxonomy must be installed first';
  end if;
end
$migration_gate$;

alter table public.external_prospect_discovery_runs
  add column intent_source text,
  add column intent_context jsonb;

update public.external_prospect_discovery_runs
set intent_source = 'PROFILE_PRODUCT',
    intent_context = jsonb_build_object(
      'intent_source', 'PROFILE_PRODUCT',
      'normalized_product_label', 'Profile products',
      'taxonomy', '[]'::jsonb,
      'target_countries', '[]'::jsonb
    )
where intent_source is null or intent_context is null;

alter table public.external_prospect_discovery_runs
  alter column intent_source set not null,
  alter column intent_context set not null,
  alter column intent_context set default '{}'::jsonb,
  add constraint external_prospect_runs_intent_source_check check (
    intent_source in ('PROFILE_PRODUCT', 'AD_HOC_PRODUCT', 'WEBSITE_DETECTED_PRODUCT')
  ),
  add constraint external_prospect_runs_intent_context_check check (
    jsonb_typeof(intent_context) = 'object'
    and octet_length(intent_context::text) <= 8192
    and intent_context::text !~* '"(?:raw_product_query|email|phone|whatsapp|contact_name|linkedin_url)"'
  );

alter table public.company_external_prospect_matches
  add column intent_hash text,
  add column evidence_snapshot jsonb not null default '[]'::jsonb,
  add column activity_snapshot jsonb not null default '[]'::jsonb,
  add column taxonomy_snapshot jsonb not null default '[]'::jsonb;

update public.company_external_prospect_matches match
set intent_hash = coalesce(
  (select run.intent_hash from public.external_prospect_discovery_runs run
   where run.id = match.discovery_run_id),
  encode(extensions.digest(
    'legacy:' || match.company_id::text || ':' || match.external_company_id::text,
    'sha256'
  ), 'hex')
)
where intent_hash is null;

alter table public.company_external_prospect_matches
  alter column intent_hash set not null,
  add constraint company_external_matches_intent_hash_check check (
    intent_hash ~ '^[a-f0-9]{64}$'
  ),
  add constraint company_external_matches_evidence_snapshot_check check (
    jsonb_typeof(evidence_snapshot) = 'array'
    and octet_length(evidence_snapshot::text) <= 32768
    and evidence_snapshot::text !~* '"(?:contact_email|contact_name|phone|whatsapp|linkedin_url)"'
  ),
  add constraint company_external_matches_activity_snapshot_check check (
    jsonb_typeof(activity_snapshot) = 'array'
    and octet_length(activity_snapshot::text) <= 16384
  ),
  add constraint company_external_matches_taxonomy_snapshot_check check (
    jsonb_typeof(taxonomy_snapshot) = 'array'
    and octet_length(taxonomy_snapshot::text) <= 8192
  );

alter table public.company_external_prospect_matches
  drop constraint company_external_prospect_mat_company_id_external_company_i_key;
alter table public.company_external_prospect_matches
  add constraint company_external_matches_company_entity_intent_key
  unique (company_id, external_company_id, intent_hash);

create index company_external_matches_intent_rank_idx
on public.company_external_prospect_matches(
  company_id, intent_hash, workflow_status, relevance_score desc, last_scored_at desc
);

create table public.company_website_product_scans (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  idempotency_key uuid not null,
  website_hash text not null check (website_hash ~ '^[a-f0-9]{64}$'),
  source_domain text not null check (
    source_domain ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    and source_domain !~* '(?:^|\.)(?:localhost|local)$'
  ),
  status text not null default 'QUEUED' check (
    status in ('QUEUED', 'RUNNING', 'COMPLETED', 'NO_PRODUCTS', 'FAILED', 'ROBOTS_DENIED')
  ),
  stage text not null default 'reading_website' check (
    stage in ('reading_website', 'finding_product_pages', 'identifying_products',
      'matching_categories', 'ready', 'failed')
  ),
  pages_checked integer not null default 0 check (pages_checked between 0 and 12),
  suggestions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(suggestions) = 'array'
    and jsonb_array_length(suggestions) <= 8
    and octet_length(suggestions::text) <= 32768
    and suggestions::text !~* '"(?:contact_email|contact_name|phone|whatsapp|linkedin_url|website_content)"'
  ),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{2,80}$'),
  cache_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, idempotency_key)
);

create index company_website_product_scans_company_idx
on public.company_website_product_scans(company_id, created_at desc);
create index company_website_product_scans_cache_idx
on public.company_website_product_scans(company_id, website_hash, cache_expires_at desc)
where status in ('COMPLETED', 'NO_PRODUCTS');

create trigger company_website_product_scans_set_updated_at
before update on public.company_website_product_scans
for each row execute function public.set_updated_at();

alter table public.company_website_product_scans enable row level security;
alter table public.company_website_product_scans force row level security;
create policy company_website_product_scans_tenant_read
on public.company_website_product_scans for select to authenticated
using (public.company_owner_authorized_v1(company_id));

revoke all on table public.company_website_product_scans from public, anon, authenticated;
grant all on table public.company_website_product_scans to service_role;

create or replace function public.get_buyer_discovery_product_context_v1(
  p_company_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.matchmaking_profiles profile
    where profile.company_id = p_company_id and profile.is_active
      and profile.role = 'manufacturer'
  ) then
    raise exception 'Buyer Discovery requires an active manufacturer match profile'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'company_id', company.id,
    'website_available', public.normalize_company_domain_v1(company.website) is not null
      and company.website ~* '^https://',
    'website_domain', public.normalize_company_domain_v1(company.website),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', product.id,
        'product_name', product.name,
        'category', product.category,
        'is_active', product.is_active,
        'taxonomy_id', taxonomy.id,
        'canonical_name', taxonomy.canonical_name,
        'slug', taxonomy.slug
      ) order by product.name, product.id)
      from public.products product
      left join public.product_taxonomy_mappings mapping
        on mapping.product_id = product.id and mapping.status = 'approved'
        and mapping.is_primary
      left join public.medical_product_taxonomy taxonomy
        on taxonomy.id = mapping.taxonomy_id and taxonomy.is_active
      where product.company_id = p_company_id and product.is_active
    ), '[]'::jsonb)
  ) into v_result
  from public.companies company where company.id = p_company_id;
  return coalesce(v_result, '{}'::jsonb);
end
$function$;

create or replace function public.start_external_prospect_discovery_v2(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_intent jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '3500ms'
as $function$
declare
  v_profile public.matchmaking_profiles%rowtype;
  v_source text := upper(trim(coalesce(p_intent->>'intent_source', '')));
  v_taxonomy_ids bigint[];
  v_target_countries text[];
  v_taxonomy jsonb;
  v_label text;
  v_context jsonb;
  v_intent_hash text;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_daily integer;
  v_monthly integer;
  v_run public.external_prospect_discovery_runs%rowtype;
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
    where keys.key not in ('intent_source', 'taxonomy_ids', 'target_countries')
  ) then
    raise exception 'Unsupported discovery intent field' using errcode = '22023';
  end if;
  if v_source not in ('PROFILE_PRODUCT', 'AD_HOC_PRODUCT', 'WEBSITE_DETECTED_PRODUCT') then
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

  select array_agg(distinct value::bigint order by value::bigint)
  into v_taxonomy_ids
  from jsonb_array_elements_text(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb)) value
  where value ~ '^[0-9]{1,18}$';
  v_taxonomy_ids := coalesce(v_taxonomy_ids, '{}'::bigint[]);

  if v_source = 'PROFILE_PRODUCT' and cardinality(v_taxonomy_ids) = 0 then
    select coalesce(array_agg(distinct mapping.taxonomy_id order by mapping.taxonomy_id), '{}'::bigint[])
    into v_taxonomy_ids
    from public.products product
    join public.product_taxonomy_mappings mapping
      on mapping.product_id = product.id and mapping.status = 'approved' and mapping.is_primary
    join public.medical_product_taxonomy taxonomy
      on taxonomy.id = mapping.taxonomy_id and taxonomy.is_active
    where product.company_id = p_company_id and product.is_active;
  end if;
  if cardinality(v_taxonomy_ids) < 1 or cardinality(v_taxonomy_ids) > 8 then
    raise exception 'Select between one and eight confirmed medical product categories'
      using errcode = '22023';
  end if;
  if v_source = 'PROFILE_PRODUCT' and exists (
    select 1 from unnest(v_taxonomy_ids) requested_id
    where not exists (
      select 1 from public.products product
      join public.product_taxonomy_mappings mapping
        on mapping.product_id = product.id and mapping.status = 'approved' and mapping.is_primary
      where product.company_id = p_company_id and product.is_active
        and mapping.taxonomy_id = requested_id
    )
  ) then
    raise exception 'Profile-product intent contains a category outside this company'
      using errcode = '42501';
  end if;
  if (select count(*) from public.medical_product_taxonomy taxonomy
      where taxonomy.id = any(v_taxonomy_ids) and taxonomy.is_active)
     <> cardinality(v_taxonomy_ids) then
    raise exception 'Discovery intent contains an unavailable taxonomy category'
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

  select jsonb_agg(jsonb_build_object(
      'taxonomy_id', taxonomy.id,
      'canonical_name', taxonomy.canonical_name,
      'slug', taxonomy.slug,
      'node_type', taxonomy.node_type,
      'cpv_codes', case
        when taxonomy.slug ~ '(drape|gown|pack|cover|pouch|tape|dressing|bandage|adhesive|sterilization)' then '["33140000"]'::jsonb
        when taxonomy.slug ~ '(imaging|anesthesia|ventilation|equipment)' then '["33100000"]'::jsonb
        else '["33190000"]'::jsonb
      end
    ) order by taxonomy.id),
    string_agg(taxonomy.canonical_name, ', ' order by taxonomy.canonical_name)
  into v_taxonomy, v_label
  from public.medical_product_taxonomy taxonomy
  where taxonomy.id = any(v_taxonomy_ids) and taxonomy.is_active;

  v_context := jsonb_build_object(
    'intent_source', v_source,
    'normalized_product_label', v_label,
    'taxonomy', coalesce(v_taxonomy, '[]'::jsonb),
    'target_countries', to_jsonb(v_target_countries),
    'country_scope', case when cardinality(v_target_countries) = 0 then 'EUROPE_WIDE' else 'SELECTED_COUNTRIES' end
  );
  v_intent_hash := encode(digest(jsonb_build_object(
    'taxonomy_ids', to_jsonb(v_taxonomy_ids),
    'target_countries', to_jsonb(v_target_countries)
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('external-prospect:' || p_company_id::text, 823));
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'idempotency_key');
  end if;
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and intent_hash = v_intent_hash
    and created_at >= clock_timestamp() - interval '24 hours'
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'cached_intent');
  end if;
  if exists (
    select 1 from public.external_prospect_discovery_runs
    where company_id = p_company_id and created_at >= clock_timestamp() - interval '30 minutes'
  ) then
    raise exception 'Discovery cooldown is active' using errcode = 'P0001';
  end if;
  select count(*)::integer into v_daily from public.external_prospect_discovery_runs
  where company_id = p_company_id and created_at >= date_trunc('day', clock_timestamp());
  select count(*)::integer into v_monthly from public.external_prospect_discovery_runs
  where company_id = p_company_id and created_at >= date_trunc('month', clock_timestamp());
  if v_daily >= 3 then raise exception 'Daily discovery limit reached' using errcode = 'P0001'; end if;
  if v_monthly >= 20 then raise exception 'Monthly discovery limit reached' using errcode = 'P0001'; end if;

  insert into public.external_prospect_discovery_runs(
    company_id, requested_by, idempotency_key, intent_hash, intent_source, intent_context
  ) values (
    p_company_id, auth.uid(), p_idempotency_key, v_intent_hash, v_source, v_context
  ) returning * into v_run;
  return jsonb_build_object('run_id', v_run.id, 'status', v_run.status,
    'stage', v_run.stage, 'intent_hash', v_run.intent_hash,
    'intent_context', v_run.intent_context, 'reused', false, 'reason', 'created');
end
$function$;

create or replace function public.start_company_website_product_scan_v1(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_force_rescan boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  v_website text;
  v_domain text;
  v_hash text;
  v_existing public.company_website_product_scans%rowtype;
  v_daily integer;
  v_monthly integer;
  v_scan public.company_website_product_scans%rowtype;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or not exists (
    select 1 from public.matchmaking_profiles profile
    where profile.company_id = p_company_id and profile.is_active and profile.role = 'manufacturer'
  ) then
    raise exception 'Valid manufacturer website scan request required' using errcode = '22023';
  end if;
  select trim(company.website), public.normalize_company_domain_v1(company.website)
  into v_website, v_domain from public.companies company where company.id = p_company_id;
  if v_domain is null or v_website !~* '^https://' then
    raise exception 'A valid public HTTPS company website is required' using errcode = '22023';
  end if;
  v_hash := encode(digest(lower(v_domain), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('website-product-scan:' || p_company_id::text, 829));

  select * into v_existing from public.company_website_product_scans
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('scan_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'reused', true, 'reason', 'idempotency_key');
  end if;
  if not coalesce(p_force_rescan, false) then
    select * into v_existing from public.company_website_product_scans
    where company_id = p_company_id and website_hash = v_hash
      and status in ('COMPLETED', 'NO_PRODUCTS') and cache_expires_at > clock_timestamp()
    order by created_at desc limit 1;
    if v_existing.id is not null then
      return jsonb_build_object('scan_id', v_existing.id, 'status', v_existing.status,
        'stage', v_existing.stage, 'reused', true, 'reason', 'cached_website');
    end if;
  end if;
  select * into v_existing from public.company_website_product_scans
  where company_id = p_company_id and status in ('QUEUED', 'RUNNING')
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('scan_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'reused', true, 'reason', 'active_scan');
  end if;
  if exists (
    select 1 from public.company_website_product_scans
    where company_id = p_company_id and created_at >= clock_timestamp() - interval '24 hours'
  ) then
    raise exception 'Website rescan cooldown is active' using errcode = 'P0001';
  end if;
  select count(*)::integer into v_daily from public.company_website_product_scans
  where company_id = p_company_id and created_at >= date_trunc('day', clock_timestamp());
  select count(*)::integer into v_monthly from public.company_website_product_scans
  where company_id = p_company_id and created_at >= date_trunc('month', clock_timestamp());
  if v_daily >= 2 then raise exception 'Daily website scan limit reached' using errcode = 'P0001'; end if;
  if v_monthly >= 10 then raise exception 'Monthly website scan limit reached' using errcode = 'P0001'; end if;

  insert into public.company_website_product_scans(
    company_id, requested_by, idempotency_key, website_hash, source_domain
  ) values (p_company_id, auth.uid(), p_idempotency_key, v_hash, lower(v_domain))
  returning * into v_scan;
  return jsonb_build_object('scan_id', v_scan.id, 'status', v_scan.status,
    'stage', v_scan.stage, 'reused', false, 'reason', 'created');
end
$function$;

create or replace function public.get_external_prospect_workspace_v2(
  p_company_id bigint,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3500ms'
as $function$
declare
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'product_context', public.get_buyer_discovery_product_context_v1(p_company_id),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(run_row) order by run_row.created_at desc)
      from (select id, status, stage, intent_hash, intent_source, intent_context,
        queries_generated, sources_checked, candidates_found, candidates_deduplicated,
        candidates_accepted, candidates_rejected, taxonomy_mapped, ai_classifications,
        provider_requests, estimated_cost_usd, error_code, started_at, completed_at, created_at
        from public.external_prospect_discovery_runs
        where company_id = p_company_id order by created_at desc limit 10) run_row
    ), '[]'::jsonb),
    'website_scans', coalesce((
      select jsonb_agg(to_jsonb(scan_row) order by scan_row.created_at desc)
      from (select id, status, stage, source_domain, pages_checked, suggestions,
        error_code, cache_expires_at, started_at, completed_at, created_at
        from public.company_website_product_scans
        where company_id = p_company_id order by created_at desc limit 5) scan_row
    ), '[]'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(to_jsonb(prospect_row) order by prospect_row.relevance_score desc,
        prospect_row.last_scored_at desc)
      from (
        select match.id as match_id, match.intent_hash,
          external_company.id as external_company_id, external_company.company_name,
          external_company.country_code, external_company.country_name,
          external_company.city_region, external_company.company_type,
          external_company.website_url, external_company.business_description,
          external_company.membership_status, match.relevance_score,
          match.product_taxonomy_score, match.geography_score,
          match.company_type_score, match.procurement_signal_score,
          match.evidence_quality_score, match.recency_score, match.target_market,
          match.reason_summary, match.reasons, match.workflow_status,
          match.last_scored_at, feedback.feedback_state, feedback.private_note,
          case when external_company.last_verified_at >= now() - interval '90 days' then 'RECENT'
            when external_company.last_verified_at >= now() - interval '365 days' then 'AGING'
            else 'STALE' end as freshness,
          case when jsonb_array_length(match.evidence_snapshot) > 0 then match.evidence_snapshot
            else coalesce((select jsonb_agg(jsonb_build_object(
              'source_type', evidence.source_type, 'evidence_kind', evidence.evidence_kind,
              'source_url', evidence.source_url, 'source_domain', evidence.source_domain,
              'source_title', evidence.source_title, 'evidence_snippet', evidence.evidence_snippet,
              'notice_id', evidence.notice_id, 'evidence_date', evidence.evidence_date,
              'confidence', evidence.confidence, 'verification_status', evidence.verification_status
            ) order by evidence.confidence desc)
            from public.external_company_evidence evidence
            where evidence.external_company_id = external_company.id), '[]'::jsonb) end as evidence,
          case when jsonb_array_length(match.taxonomy_snapshot) > 0 then match.taxonomy_snapshot
            else coalesce((select jsonb_agg(jsonb_build_object(
              'taxonomy_id', taxonomy.id, 'canonical_name', taxonomy.canonical_name,
              'slug', taxonomy.slug, 'confidence', mapping.confidence,
              'mapping_source', mapping.mapping_source
            ) order by mapping.confidence desc)
            from public.external_company_taxonomy mapping
            join public.medical_product_taxonomy taxonomy on taxonomy.id = mapping.taxonomy_id
            where mapping.external_company_id = external_company.id), '[]'::jsonb) end as taxonomy,
          case when jsonb_array_length(match.activity_snapshot) > 0 then match.activity_snapshot
            else coalesce((select jsonb_agg(jsonb_build_object(
              'provider_code', activity.provider_code,
              'jurisdiction_country_code', activity.jurisdiction_country_code,
              'national_activity_code', activity.national_activity_code,
              'national_classification', activity.national_classification,
              'activity_description', activity.activity_description,
              'normalized_nace_code', activity.normalized_nace_code,
              'nace_revision', activity.nace_revision,
              'normalized_activity_class', activity.normalized_activity_class,
              'signal_strength', activity.signal_strength,
              'evidence_kind', 'INDIRECT_COMMERCIAL_EVIDENCE'
            ) order by activity.signal_strength, activity.activity_description)
            from public.external_company_activities activity
            where activity.external_company_id = external_company.id), '[]'::jsonb) end as activities
        from public.company_external_prospect_matches match
        join public.external_companies external_company on external_company.id = match.external_company_id
        left join public.external_prospect_feedback feedback on feedback.match_id = match.id
        where match.company_id = p_company_id
          and external_company.membership_status = 'NOT_ON_MEDICHALL'
          and external_company.duplicate_status = 'ACTIVE'
        order by match.relevance_score desc, match.last_scored_at desc limit v_limit
      ) prospect_row
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;

revoke all on function public.get_buyer_discovery_product_context_v1(bigint),
  public.start_external_prospect_discovery_v2(bigint, uuid, jsonb),
  public.start_company_website_product_scan_v1(bigint, uuid, boolean),
  public.get_external_prospect_workspace_v2(bigint, integer)
from public, anon, authenticated;
grant execute on function public.get_buyer_discovery_product_context_v1(bigint),
  public.start_external_prospect_discovery_v2(bigint, uuid, jsonb),
  public.start_company_website_product_scan_v1(bigint, uuid, boolean),
  public.get_external_prospect_workspace_v2(bigint, integer)
to authenticated, service_role;

comment on table public.company_website_product_scans is
  'Tenant-private bounded cache of taxonomy suggestions from the authenticated company stored public domain. No raw website content or contacts.';
comment on function public.start_external_prospect_discovery_v2(bigint, uuid, jsonb) is
  'One company-scoped rate/idempotency gate for profile, ad-hoc and website-confirmed normalized taxonomy intents.';
comment on function public.start_company_website_product_scan_v1(bigint, uuid, boolean) is
  'Owner/admin-only stored-domain website product-scan gate with 14-day cache, 24-hour rescan cooldown, daily 2 and monthly 10 caps.';

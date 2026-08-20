-- MedicHall External Prospect Discovery MVP.
-- Global public-company evidence is separated from tenant-scoped scores,
-- workflow state, private notes, and discovery runs. V1 stores no personal
-- contact coordinates and performs no outreach.

begin;

do $preflight$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.products') is null
     or to_regclass('public.matchmaking_profiles') is null
     or to_regclass('public.medical_product_taxonomy') is null
     or to_regclass('public.product_taxonomy_mappings') is null
     or to_regclass('public.traffic_analytics_conversions') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.company_owner_authorized_v1(bigint)') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'External prospect discovery preflight failed';
  end if;
end
$preflight$;

create or replace function public.normalize_external_company_name_v1(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  select nullif(trim(regexp_replace(
    regexp_replace(lower(coalesce(p_value, '')), '&', ' and ', 'g'),
    '[^[:alnum:]]+', ' ', 'g'
  )), '')
$function$;

create or replace function public.normalize_company_domain_v1(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  select nullif(
    regexp_replace(
      split_part(
        split_part(
          regexp_replace(lower(trim(coalesce(p_value, ''))), '^https?://', ''),
          '/', 1
        ),
        ':', 1
      ),
      '^www\.', ''
    ),
    ''
  )
$function$;

create table public.external_companies (
  id bigint generated always as identity primary key,
  company_name text not null check (length(trim(company_name)) between 2 and 240),
  normalized_company_name text generated always as (
    public.normalize_external_company_name_v1(company_name)
  ) stored,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  country_name text check (country_name is null or length(country_name) <= 120),
  city_region text check (city_region is null or length(city_region) <= 160),
  company_type text not null default 'Unknown' check (company_type in (
    'Distributor', 'Wholesaler', 'Importer', 'Hospital supplier', 'Reseller',
    'Manufacturer', 'Mixed', 'Unknown'
  )),
  website_url text check (
    website_url is null or (website_url ~ '^https://[^[:space:]]+$' and length(website_url) <= 1000)
  ),
  normalized_domain text generated always as (
    public.normalize_company_domain_v1(website_url)
  ) stored,
  business_description text check (
    business_description is null or length(business_description) <= 1600
  ),
  registry_identifier text check (
    registry_identifier is null or length(registry_identifier) <= 240
  ),
  membership_status text not null default 'NOT_ON_MEDICHALL' check (
    membership_status in ('NOT_ON_MEDICHALL', 'ON_MEDICHALL')
  ),
  medichall_company_id bigint unique references public.companies(id) on delete set null,
  duplicate_status text not null default 'ACTIVE' check (
    duplicate_status in ('ACTIVE', 'MERGED', 'REVIEW_REQUIRED')
  ),
  merged_into_id bigint references public.external_companies(id) on delete restrict,
  first_discovered_at timestamptz not null default clock_timestamp(),
  last_verified_at timestamptz,
  source_last_seen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (merged_into_id is null or merged_into_id <> id),
  check (
    (membership_status = 'ON_MEDICHALL' and medichall_company_id is not null)
    or (membership_status = 'NOT_ON_MEDICHALL' and medichall_company_id is null)
  )
);

create unique index external_companies_domain_uidx
on public.external_companies(normalized_domain)
where normalized_domain is not null and duplicate_status = 'ACTIVE';

create unique index external_companies_name_country_uidx
on public.external_companies(normalized_company_name, coalesce(country_code, ''))
where normalized_domain is null and duplicate_status = 'ACTIVE';

create unique index external_companies_registry_identifier_uidx
on public.external_companies(country_code, registry_identifier)
where country_code is not null and registry_identifier is not null
  and duplicate_status = 'ACTIVE';

create index external_companies_membership_idx
on public.external_companies(membership_status, duplicate_status, last_verified_at desc);

create table public.external_company_evidence (
  id bigint generated always as identity primary key,
  external_company_id bigint not null references public.external_companies(id) on delete cascade,
  source_type text not null check (source_type in (
    'COMPANY_WEBSITE', 'PRODUCT_CATALOGUE', 'TED_AWARD',
    'ASSOCIATION_DIRECTORY', 'EXHIBITOR_DIRECTORY', 'PUBLIC_REGISTRY',
    'OTHER_PUBLIC_SOURCE'
  )),
  evidence_kind text not null check (evidence_kind in (
    'DIRECT_PRODUCT_EVIDENCE', 'INDIRECT_COMMERCIAL_EVIDENCE', 'WEAK_CONTEXT'
  )),
  source_url text not null check (
    source_url ~ '^https://[^[:space:]]+$' and length(source_url) <= 1200
  ),
  source_domain text not null check (
    source_domain ~ '^[a-z0-9.-]+$' and length(source_domain) <= 253
  ),
  source_title text check (source_title is null or length(source_title) <= 300),
  evidence_snippet text check (evidence_snippet is null or length(evidence_snippet) <= 1600),
  taxonomy_signals jsonb not null default '[]'::jsonb check (jsonb_typeof(taxonomy_signals) = 'array'),
  cpv_codes text[] not null default '{}',
  notice_id text check (notice_id is null or length(notice_id) <= 100),
  procurement_buyer text check (procurement_buyer is null or length(procurement_buyer) <= 300),
  lot_context text check (lot_context is null or length(lot_context) <= 1000),
  evidence_date date,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  verification_status text not null default 'ACTIVE' check (
    verification_status in ('ACTIVE', 'UNAVAILABLE', 'STALE')
  ),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  last_verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (external_company_id, source_hash),
  check (
    coalesce(evidence_snippet, '') !~* '[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
  )
);

create index external_company_evidence_company_idx
on public.external_company_evidence(external_company_id, verification_status, evidence_date desc);
create index external_company_evidence_notice_idx
on public.external_company_evidence(notice_id)
where notice_id is not null;

create table public.external_company_taxonomy (
  id bigint generated always as identity primary key,
  external_company_id bigint not null references public.external_companies(id) on delete cascade,
  taxonomy_id bigint not null references public.medical_product_taxonomy(id) on delete restrict,
  evidence_id bigint references public.external_company_evidence(id) on delete set null,
  mapping_source text not null check (mapping_source in (
    'canonical_name', 'approved_alias', 'cpv_mapping', 'verified_public_evidence'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (external_company_id, taxonomy_id)
);

create index external_company_taxonomy_taxonomy_idx
on public.external_company_taxonomy(taxonomy_id, external_company_id);

-- Country/provider adapters retain the source classification and normalize it
-- to a deliberately coarse commercial-activity model. Activity evidence is
-- always indirect: it may establish commercial relevance, never exact product
-- ownership or availability.
create table public.external_company_activities (
  id bigint generated always as identity primary key,
  external_company_id bigint not null references public.external_companies(id) on delete cascade,
  evidence_id bigint not null references public.external_company_evidence(id) on delete cascade,
  provider_code text not null check (provider_code ~ '^[A-Z0-9_]{3,80}$'),
  jurisdiction_country_code text not null check (jurisdiction_country_code ~ '^[A-Z]{2}$'),
  registry_identifier text check (registry_identifier is null or length(registry_identifier) <= 240),
  national_activity_code text not null check (length(national_activity_code) between 2 and 40),
  national_classification text not null check (length(national_classification) between 2 and 80),
  activity_description text not null check (length(activity_description) between 2 and 500),
  normalized_nace_code text check (
    normalized_nace_code is null or normalized_nace_code ~ '^[0-9]{2}(\.[0-9]{1,2})?$'
  ),
  nace_revision text not null check (nace_revision in (
    'NACE_REV_2', 'NACE_REV_2_1', 'NATIONAL_ONLY'
  )),
  normalized_activity_class text not null check (normalized_activity_class in (
    'PHARMACEUTICAL_WHOLESALE', 'MEDICAL_EQUIPMENT_WHOLESALE',
    'MEDICAL_DEVICE_DISTRIBUTION', 'HEALTHCARE_SUPPLIES',
    'HOSPITAL_EQUIPMENT_SUPPLY', 'MEDICAL_IMPORT_EXPORT',
    'OTHER_RELEVANT', 'NON_MATCH'
  )),
  signal_strength text not null check (signal_strength in (
    'STRONG_INDIRECT', 'WEAK_INDIRECT', 'NON_MATCH'
  )),
  is_direct_product_evidence boolean not null default false check (not is_direct_product_evidence),
  effective_from date,
  verified_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (external_company_id, provider_code, national_activity_code, evidence_id)
);

create index external_company_activities_company_idx
on public.external_company_activities(external_company_id, signal_strength, normalized_activity_class);
create index external_company_activities_nace_idx
on public.external_company_activities(normalized_nace_code, jurisdiction_country_code)
where normalized_nace_code is not null;

create table public.external_prospect_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED'
  )),
  idempotency_key uuid not null,
  intent_hash text not null check (intent_hash ~ '^[a-f0-9]{64}$'),
  stage text not null default 'queued' check (length(stage) between 2 and 80),
  queries_generated integer not null default 0 check (queries_generated between 0 and 4),
  sources_checked integer not null default 0 check (sources_checked between 0 and 60),
  candidates_found integer not null default 0 check (candidates_found between 0 and 100),
  candidates_deduplicated integer not null default 0 check (candidates_deduplicated between 0 and 100),
  candidates_accepted integer not null default 0 check (candidates_accepted between 0 and 30),
  candidates_rejected integer not null default 0 check (candidates_rejected between 0 and 100),
  taxonomy_mapped integer not null default 0 check (taxonomy_mapped between 0 and 100),
  ai_classifications integer not null default 0 check (ai_classifications = 0),
  provider_requests integer not null default 0 check (provider_requests = 0),
  estimated_cost_usd numeric(10,6) not null default 0 check (estimated_cost_usd = 0),
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{2,80}$'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, idempotency_key)
);

create index external_prospect_runs_company_created_idx
on public.external_prospect_discovery_runs(company_id, created_at desc);
create index external_prospect_runs_status_idx
on public.external_prospect_discovery_runs(status, created_at)
where status in ('QUEUED', 'RUNNING');

create table public.company_external_prospect_matches (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  external_company_id bigint not null references public.external_companies(id) on delete cascade,
  discovery_run_id uuid references public.external_prospect_discovery_runs(id) on delete set null,
  relevance_score integer not null check (relevance_score between 0 and 100),
  product_taxonomy_score integer not null check (product_taxonomy_score between 0 and 40),
  geography_score integer not null check (geography_score between 0 and 15),
  company_type_score integer not null check (company_type_score between 0 and 15),
  procurement_signal_score integer not null check (procurement_signal_score between 0 and 15),
  evidence_quality_score integer not null check (evidence_quality_score between 0 and 10),
  recency_score integer not null check (recency_score between 0 and 5),
  target_market boolean not null default false,
  reason_summary text not null check (length(reason_summary) between 1 and 1200),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  workflow_status text not null default 'NEW' check (workflow_status in (
    'NEW', 'SAVED', 'INTERESTING', 'DISMISSED'
  )),
  last_scored_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, external_company_id),
  check (relevance_score = product_taxonomy_score + geography_score +
    company_type_score + procurement_signal_score + evidence_quality_score + recency_score)
);

create index company_external_matches_rank_idx
on public.company_external_prospect_matches(company_id, workflow_status, relevance_score desc, last_scored_at desc);

create table public.external_prospect_feedback (
  id bigint generated always as identity primary key,
  match_id bigint not null unique references public.company_external_prospect_matches(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  feedback_state text not null check (feedback_state in (
    'SAVED', 'INTERESTING', 'DISMISSED', 'RELEVANT', 'NOT_RELEVANT', 'NOTE_ONLY'
  )),
  private_note text check (private_note is null or length(private_note) <= 2000),
  idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, idempotency_key)
);

create index external_prospect_feedback_company_idx
on public.external_prospect_feedback(company_id, updated_at desc);

create trigger external_companies_set_updated_at before update on public.external_companies
for each row execute function public.set_updated_at();
create trigger external_company_evidence_set_updated_at before update on public.external_company_evidence
for each row execute function public.set_updated_at();
create trigger external_company_taxonomy_set_updated_at before update on public.external_company_taxonomy
for each row execute function public.set_updated_at();
create trigger external_company_activities_set_updated_at before update on public.external_company_activities
for each row execute function public.set_updated_at();
create trigger external_prospect_runs_set_updated_at before update on public.external_prospect_discovery_runs
for each row execute function public.set_updated_at();
create trigger company_external_matches_set_updated_at before update on public.company_external_prospect_matches
for each row execute function public.set_updated_at();
create trigger external_prospect_feedback_set_updated_at before update on public.external_prospect_feedback
for each row execute function public.set_updated_at();

create or replace function public.external_company_apply_membership_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_company_id bigint;
begin
  select company.id into v_company_id
  from public.companies company
  where company.is_active
    and (
      (public.normalize_company_domain_v1(new.website_url) is not null
       and public.normalize_company_domain_v1(company.website) = public.normalize_company_domain_v1(new.website_url))
      or (
        public.normalize_external_company_name_v1(company.name) = public.normalize_external_company_name_v1(new.company_name)
        and coalesce(upper(company.country), '') in (
          coalesce(new.country_code, ''), coalesce(upper(new.country_name), '')
        )
      )
    )
  order by company.is_approved desc, company.id
  limit 1;
  new.medichall_company_id := v_company_id;
  new.membership_status := case when v_company_id is null
    then 'NOT_ON_MEDICHALL' else 'ON_MEDICHALL' end;
  return new;
end
$function$;

create trigger external_company_apply_membership
before insert or update of company_name, country_code, country_name, website_url
on public.external_companies
for each row execute function public.external_company_apply_membership_v1();

create or replace function public.reconcile_external_company_membership_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  update public.external_companies external_company
  set medichall_company_id = new.id,
      membership_status = 'ON_MEDICHALL'
  where external_company.duplicate_status = 'ACTIVE'
    and (
      (external_company.normalized_domain is not null
       and external_company.normalized_domain = public.normalize_company_domain_v1(new.website))
      or (
        external_company.normalized_company_name = public.normalize_external_company_name_v1(new.name)
        and coalesce(upper(new.country), '') in (
          coalesce(external_company.country_code, ''),
          coalesce(upper(external_company.country_name), '')
        )
      )
    );
  return new;
end
$function$;

create trigger reconcile_external_company_membership
after insert or update of name, country, website, is_active on public.companies
for each row when (new.is_active)
execute function public.reconcile_external_company_membership_v1();

alter table public.external_companies enable row level security;
alter table public.external_companies force row level security;
alter table public.external_company_evidence enable row level security;
alter table public.external_company_evidence force row level security;
alter table public.external_company_taxonomy enable row level security;
alter table public.external_company_taxonomy force row level security;
alter table public.external_company_activities enable row level security;
alter table public.external_company_activities force row level security;
alter table public.external_prospect_discovery_runs enable row level security;
alter table public.external_prospect_discovery_runs force row level security;
alter table public.company_external_prospect_matches enable row level security;
alter table public.company_external_prospect_matches force row level security;
alter table public.external_prospect_feedback enable row level security;
alter table public.external_prospect_feedback force row level security;

create policy external_companies_admin_read on public.external_companies
for select to authenticated using (public.is_admin());
create policy external_evidence_admin_read on public.external_company_evidence
for select to authenticated using (public.is_admin());
create policy external_taxonomy_admin_read on public.external_company_taxonomy
for select to authenticated using (public.is_admin());
create policy external_activities_admin_read on public.external_company_activities
for select to authenticated using (public.is_admin());
create policy external_runs_tenant_read on public.external_prospect_discovery_runs
for select to authenticated using (public.company_owner_authorized_v1(company_id));
create policy external_matches_tenant_read on public.company_external_prospect_matches
for select to authenticated using (public.company_owner_authorized_v1(company_id));
create policy external_feedback_tenant_read on public.external_prospect_feedback
for select to authenticated using (public.company_owner_authorized_v1(company_id));

revoke all on table public.external_companies, public.external_company_evidence,
  public.external_company_taxonomy, public.external_company_activities,
  public.external_prospect_discovery_runs,
  public.company_external_prospect_matches, public.external_prospect_feedback
from public, anon, authenticated;
grant all on table public.external_companies, public.external_company_evidence,
  public.external_company_taxonomy, public.external_company_activities,
  public.external_prospect_discovery_runs,
  public.company_external_prospect_matches, public.external_prospect_feedback
to service_role;
grant usage, select on sequence public.external_companies_id_seq,
  public.external_company_evidence_id_seq,
  public.external_company_taxonomy_id_seq,
  public.external_company_activities_id_seq,
  public.company_external_prospect_matches_id_seq,
  public.external_prospect_feedback_id_seq
to service_role;

create or replace function public.start_external_prospect_discovery_v1(
  p_company_id bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  v_profile public.matchmaking_profiles%rowtype;
  v_intent jsonb;
  v_intent_hash text;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_daily integer;
  v_monthly integer;
  v_run public.external_prospect_discovery_runs%rowtype;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required' using errcode = '22023';
  end if;
  select * into v_profile from public.matchmaking_profiles
  where company_id = p_company_id and is_active;
  if v_profile.id is null or v_profile.role <> 'manufacturer' then
    raise exception 'External prospect discovery requires an active manufacturer match profile'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.products product
    where product.company_id = p_company_id and product.is_active
  ) then
    raise exception 'Add at least one active product before discovering prospects'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'role', v_profile.role,
    'target_countries', coalesce(v_profile.target_countries, '{}'),
    'partner_types', coalesce(v_profile.partner_types_sought, '{}'),
    'company', coalesce((select jsonb_build_object(
      'type', company.type, 'country', company.country,
      'description', company.description, 'certifications', company.certifications
    ) from public.companies company where company.id = p_company_id), '{}'::jsonb),
    'match_profile', coalesce((select jsonb_build_object(
      'target_countries', match_profile.target_countries,
      'target_partner_types', match_profile.target_partner_types,
      'product_keywords', match_profile.product_keywords,
      'cpv_codes', match_profile.cpv_codes,
      'certifications', match_profile.certifications,
      'oem_available', match_profile.oem_available,
      'private_label_available', match_profile.private_label_available,
      'min_match_score', match_profile.min_match_score
    ) from public.company_match_profiles match_profile
      where match_profile.company_id = p_company_id), '{}'::jsonb),
    'products', coalesce(jsonb_agg(jsonb_build_object(
      'id', product.id, 'name', product.name, 'category', product.category,
      'description', product.description, 'taxonomy_id', mapping.taxonomy_id
    ) order by product.id), '[]'::jsonb)
  ) into v_intent
  from public.products product
  left join public.product_taxonomy_mappings mapping
    on mapping.product_id = product.id and mapping.status = 'approved' and mapping.is_primary
  where product.company_id = p_company_id and product.is_active;
  v_intent_hash := encode(digest(v_intent::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('external-prospect:' || p_company_id::text, 823));
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'reused', true, 'reason', 'idempotency_key');
  end if;
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and intent_hash = v_intent_hash
    and created_at >= clock_timestamp() - interval '24 hours'
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'reused', true, 'reason', 'cached_intent');
  end if;
  if exists (
    select 1 from public.external_prospect_discovery_runs
    where company_id = p_company_id
      and created_at >= clock_timestamp() - interval '30 minutes'
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
    company_id, requested_by, idempotency_key, intent_hash
  ) values (p_company_id, auth.uid(), p_idempotency_key, v_intent_hash)
  returning * into v_run;
  return jsonb_build_object('run_id', v_run.id, 'status', v_run.status,
    'stage', v_run.stage, 'reused', false, 'reason', 'created');
end
$function$;

create or replace function public.get_external_prospect_workspace_v1(
  p_company_id bigint,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'runs', coalesce((
      select jsonb_agg(to_jsonb(run_row) order by run_row.created_at desc)
      from (select id, status, stage, queries_generated, sources_checked,
        candidates_found, candidates_deduplicated, candidates_accepted,
        candidates_rejected, taxonomy_mapped, ai_classifications,
        provider_requests, estimated_cost_usd, error_code, started_at,
        completed_at, created_at
        from public.external_prospect_discovery_runs
        where company_id = p_company_id order by created_at desc limit 10) run_row
    ), '[]'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(to_jsonb(prospect_row) order by prospect_row.relevance_score desc,
        prospect_row.last_scored_at desc)
      from (
        select match.id as match_id, external_company.id as external_company_id,
          external_company.company_name, external_company.country_code,
          external_company.country_name, external_company.city_region,
          external_company.company_type, external_company.website_url,
          external_company.business_description,
          external_company.membership_status, match.relevance_score,
          match.product_taxonomy_score, match.geography_score,
          match.company_type_score, match.procurement_signal_score,
          match.evidence_quality_score, match.recency_score,
          match.target_market,
          match.reason_summary, match.reasons, match.workflow_status,
          match.last_scored_at,
          case
            when external_company.last_verified_at >= now() - interval '90 days' then 'RECENT'
            when external_company.last_verified_at >= now() - interval '365 days' then 'AGING'
            else 'STALE'
          end as freshness,
          feedback.feedback_state, feedback.private_note,
          coalesce((select jsonb_agg(jsonb_build_object(
            'source_type', evidence.source_type,
            'evidence_kind', evidence.evidence_kind,
            'source_url', evidence.source_url,
            'source_domain', evidence.source_domain,
            'source_title', evidence.source_title,
            'evidence_snippet', evidence.evidence_snippet,
            'notice_id', evidence.notice_id,
            'evidence_date', evidence.evidence_date,
            'confidence', evidence.confidence,
            'verification_status', evidence.verification_status
          ) order by evidence.confidence desc, evidence.evidence_date desc nulls last)
          from public.external_company_evidence evidence
          where evidence.external_company_id = external_company.id), '[]'::jsonb) as evidence,
          coalesce((select jsonb_agg(jsonb_build_object(
            'taxonomy_id', taxonomy.id, 'canonical_name', taxonomy.canonical_name,
            'slug', taxonomy.slug, 'confidence', mapping.confidence,
            'mapping_source', mapping.mapping_source
          ) order by mapping.confidence desc, taxonomy.canonical_name)
          from public.external_company_taxonomy mapping
          join public.medical_product_taxonomy taxonomy on taxonomy.id = mapping.taxonomy_id
          where mapping.external_company_id = external_company.id), '[]'::jsonb) as taxonomy
          ,coalesce((select jsonb_agg(jsonb_build_object(
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
          where activity.external_company_id = external_company.id), '[]'::jsonb) as activities
        from public.company_external_prospect_matches match
        join public.external_companies external_company
          on external_company.id = match.external_company_id
        left join public.external_prospect_feedback feedback on feedback.match_id = match.id
        where match.company_id = p_company_id
          and external_company.membership_status = 'NOT_ON_MEDICHALL'
          and external_company.duplicate_status = 'ACTIVE'
        order by match.relevance_score desc, match.last_scored_at desc
        limit v_limit
      ) prospect_row
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;

create or replace function public.set_external_prospect_feedback_v1(
  p_match_id bigint,
  p_feedback_state text,
  p_private_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2000ms'
as $function$
declare
  v_match public.company_external_prospect_matches%rowtype;
  v_state text := upper(trim(coalesce(p_feedback_state, '')));
  v_existing public.external_prospect_feedback%rowtype;
begin
  select * into v_match from public.company_external_prospect_matches where id = p_match_id;
  if v_match.id is null or auth.uid() is null
     or not public.company_owner_authorized_v1(v_match.company_id) then
    raise exception 'Prospect access denied' using errcode = '42501';
  end if;
  if v_state not in ('SAVED', 'INTERESTING', 'DISMISSED', 'RELEVANT', 'NOT_RELEVANT', 'NOTE_ONLY')
     or p_idempotency_key is null
     or length(coalesce(p_private_note, '')) > 2000 then
    raise exception 'Invalid prospect feedback' using errcode = '22023';
  end if;
  select * into v_existing from public.external_prospect_feedback
  where company_id = v_match.company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('recorded', false, 'deduplicated', true,
      'match_id', p_match_id, 'feedback_state', v_existing.feedback_state);
  end if;
  insert into public.external_prospect_feedback(
    match_id, company_id, user_id, feedback_state, private_note, idempotency_key
  ) values (
    p_match_id, v_match.company_id, auth.uid(), v_state,
    nullif(trim(coalesce(p_private_note, '')), ''), p_idempotency_key
  )
  on conflict (match_id) do update set
    user_id = excluded.user_id,
    feedback_state = excluded.feedback_state,
    private_note = excluded.private_note,
    idempotency_key = excluded.idempotency_key,
    updated_at = clock_timestamp();
  update public.company_external_prospect_matches
  set workflow_status = case
    when v_state in ('RELEVANT', 'NOT_RELEVANT', 'NOTE_ONLY') then workflow_status
    else v_state
  end
  where id = p_match_id;
  return jsonb_build_object('recorded', true, 'deduplicated', false,
    'match_id', p_match_id, 'feedback_state', v_state);
end
$function$;

create or replace function public.get_admin_external_prospect_metrics_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'external_entities', (select count(*) from public.external_companies where duplicate_status = 'ACTIVE'),
    'not_on_medichall', (select count(*) from public.external_companies where membership_status = 'NOT_ON_MEDICHALL' and duplicate_status = 'ACTIVE'),
    'promoted_to_medichall', (select count(*) from public.external_companies where membership_status = 'ON_MEDICHALL'),
    'evidence_records', (select count(*) from public.external_company_evidence),
    'stale_evidence', (select count(*) from public.external_company_evidence
      where verification_status = 'STALE'
         or last_verified_at < now() - interval '365 days'),
    'source_mix', coalesce((select jsonb_object_agg(source_type, source_count)
      from (select source_type, count(*) as source_count
        from public.external_company_evidence group by source_type) source_counts), '{}'::jsonb),
    'registry_activity_records', (select count(*) from public.external_company_activities),
    'tenant_matches', (select count(*) from public.company_external_prospect_matches),
    'saved', (select count(*) from public.company_external_prospect_matches where workflow_status in ('SAVED', 'INTERESTING')),
    'dismissed', (select count(*) from public.company_external_prospect_matches where workflow_status = 'DISMISSED'),
    'new_discoveries_30d', (select count(*) from public.external_companies
      where first_discovered_at >= now() - interval '30 days'),
    'runs_30d', (select count(*) from public.external_prospect_discovery_runs where created_at >= now() - interval '30 days'),
    'completed_30d', (select count(*) from public.external_prospect_discovery_runs where status in ('COMPLETED', 'PARTIAL') and created_at >= now() - interval '30 days'),
    'failed_30d', (select count(*) from public.external_prospect_discovery_runs where status = 'FAILED' and created_at >= now() - interval '30 days'),
    'provider_requests_30d', (select coalesce(sum(provider_requests), 0) from public.external_prospect_discovery_runs where created_at >= now() - interval '30 days'),
    'estimated_cost_usd_30d', (select coalesce(sum(estimated_cost_usd), 0) from public.external_prospect_discovery_runs where created_at >= now() - interval '30 days')
  ) into v_result;
  return v_result;
end
$function$;

revoke all on function public.normalize_external_company_name_v1(text),
  public.normalize_company_domain_v1(text),
  public.external_company_apply_membership_v1(),
  public.reconcile_external_company_membership_v1()
from public, anon, authenticated;
grant execute on function public.normalize_external_company_name_v1(text),
  public.normalize_company_domain_v1(text)
to service_role;

revoke all on function public.start_external_prospect_discovery_v1(bigint, uuid),
  public.get_external_prospect_workspace_v1(bigint, integer),
  public.set_external_prospect_feedback_v1(bigint, text, text, uuid),
  public.get_admin_external_prospect_metrics_v1()
from public, anon, authenticated;
grant execute on function public.start_external_prospect_discovery_v1(bigint, uuid),
  public.get_external_prospect_workspace_v1(bigint, integer),
  public.set_external_prospect_feedback_v1(bigint, text, text, uuid),
  public.get_admin_external_prospect_metrics_v1()
to authenticated, service_role;

comment on table public.external_companies is
  'Global deduplicated public business entities. No personal contact coordinates.';
comment on table public.company_external_prospect_matches is
  'Tenant-private scores and workflow state for global external entities.';
comment on function public.start_external_prospect_discovery_v1(bigint, uuid) is
  'Owner/admin-only manual discovery gate with 24h intent cache, 30m cooldown, daily 3 and monthly 20 caps.';

-- Extend the existing first-party aggregate-safe conversion allowlist. These
-- events store no prospect identity, query, website, note, or company ID.
alter table public.traffic_analytics_conversions
drop constraint if exists traffic_analytics_conversions_event_type_check;
alter table public.traffic_analytics_conversions
add constraint traffic_analytics_conversions_event_type_check check (event_type in (
  'signup_started', 'signup_completed', 'company_profile_created',
  'profile_completed', 'product_added', 'matchmaking_profile_created',
  'match_viewed', 'connection_requested', 'rfq_created', 'meeting_scheduled',
  'external_prospect_discovery_started', 'external_prospect_discovery_completed',
  'external_prospect_viewed', 'external_prospect_saved',
  'external_prospect_dismissed', 'external_prospect_website_clicked'
));

create or replace function public.record_traffic_conversion_v1(
  p_event_id uuid,
  p_visitor_id uuid,
  p_session_id uuid,
  p_event_type text,
  p_is_authenticated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  recorded_at timestamptz := clock_timestamp();
  existing_id bigint;
  session_row public.traffic_analytics_sessions%rowtype;
  session_conversion_count integer;
begin
  if p_event_id is null or p_visitor_id is null or p_session_id is null
    or p_event_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_visitor_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_session_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Valid event, visitor, and session identifiers are required' using errcode = '22023';
  end if;
  if p_event_type is null or p_event_type not in (
    'signup_started', 'signup_completed', 'company_profile_created',
    'profile_completed', 'product_added', 'matchmaking_profile_created',
    'match_viewed', 'connection_requested', 'rfq_created', 'meeting_scheduled',
    'external_prospect_discovery_started', 'external_prospect_discovery_completed',
    'external_prospect_viewed', 'external_prospect_saved',
    'external_prospect_dismissed', 'external_prospect_website_clicked'
  ) then raise exception 'Invalid conversion event' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 727));
  select id into existing_id from public.traffic_analytics_conversions where event_id = p_event_id;
  if existing_id is not null then
    return jsonb_build_object('recorded', false, 'deduplicated', true, 'event_id', p_event_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_visitor_id::text, 719));
  select * into session_row from public.traffic_analytics_sessions where session_id = p_session_id;
  if session_row.session_id is null or session_row.visitor_id is distinct from p_visitor_id then
    raise exception 'Conversion session is unavailable' using errcode = '22023';
  end if;
  if session_row.last_seen_at < recorded_at - interval '30 minutes' then
    raise exception 'Analytics session has expired' using errcode = '22023';
  end if;
  select count(*)::integer into session_conversion_count
  from public.traffic_analytics_conversions where session_id = p_session_id;
  if session_conversion_count >= 100 then
    raise exception 'Analytics conversion limit reached' using errcode = '22023';
  end if;
  insert into public.traffic_analytics_conversions(
    event_id, visitor_id, session_id, occurred_at, event_type,
    is_authenticated, acquisition_source, utm_source, utm_medium, utm_campaign
  ) values (
    p_event_id, p_visitor_id, p_session_id, recorded_at, p_event_type,
    coalesce(p_is_authenticated, false), session_row.acquisition_source,
    session_row.utm_source, session_row.utm_medium, session_row.utm_campaign
  );
  return jsonb_build_object('recorded', true, 'deduplicated', false, 'event_id', p_event_id);
end
$function$;

revoke all on function public.record_traffic_conversion_v1(uuid,uuid,uuid,text,boolean)
from public, anon, authenticated;
grant execute on function public.record_traffic_conversion_v1(uuid,uuid,uuid,text,boolean)
to service_role;

notify pgrst, 'reload schema';
commit;

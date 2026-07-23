-- MedicHall matching engine Phase 0: observability, versioning and benchmark baseline.
-- Additive only. This migration does not replace scoring RPCs or change score weights.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Central taxonomies
-- ---------------------------------------------------------------------------

create table if not exists public.pipeline_error_categories (
  code text primary key,
  category_group text not null,
  description text not null,
  created_at timestamptz not null default now()
);

insert into public.pipeline_error_categories (code, category_group, description)
values
  ('network', 'technical', 'DNS, connection or transport failure'),
  ('timeout', 'technical', 'A bounded operation exceeded its time limit'),
  ('redirect', 'technical', 'Redirect handling failed or requires a separate step'),
  ('authentication', 'restricted', 'A valid authenticated session is required'),
  ('authorization', 'restricted', 'The current identity is not authorized'),
  ('captcha', 'restricted', 'A human CAPTCHA challenge is required'),
  ('membership', 'restricted', 'Membership or subscription is required'),
  ('payment', 'restricted', 'Paid access is required'),
  ('terms_acceptance', 'restricted', 'Terms must be accepted by an authorized person'),
  ('dynamic_page', 'manual', 'The public page requires client-side JavaScript'),
  ('malformed_url', 'technical', 'The URL is invalid or uses a prohibited protocol'),
  ('unavailable_resource', 'technical', 'The resource is missing, expired or unavailable'),
  ('unsupported_format', 'technical', 'The file format is not supported by this pipeline'),
  ('archive_error', 'technical', 'Archive inspection or extraction failed'),
  ('parser_error', 'technical', 'Document parsing failed'),
  ('ocr_needed', 'manual', 'The document appears to need OCR'),
  ('ai_provider', 'technical', 'The AI provider request failed'),
  ('ai_response_validation', 'technical', 'The AI response failed structured validation'),
  ('database', 'technical', 'A database operation failed'),
  ('scoring', 'technical', 'Candidate generation or scoring failed'),
  ('stale_data', 'data_quality', 'Stored output no longer matches current inputs or versions'),
  ('configuration', 'technical', 'Required safe runtime configuration is absent'),
  ('unknown', 'unknown', 'The failure could not be classified safely')
on conflict (code) do update set
  category_group = excluded.category_group,
  description = excluded.description;

create table if not exists public.document_access_statuses (
  code text primary key,
  access_class text not null check (
    access_class in (
      'public',
      'publicly_accessible_but_unsupported',
      'restricted',
      'manual',
      'technical_failure',
      'processed'
    )
  ),
  description text not null,
  manual_action_required boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.document_access_statuses (
  code,
  access_class,
  description,
  manual_action_required
)
values
  ('no_document_link_found', 'technical_failure', 'No candidate document link was found', true),
  ('public_direct_download', 'public', 'A public direct-download link was identified', false),
  ('public_detail_page', 'public', 'A public detail page was identified', false),
  ('redirect_required', 'public', 'A redirect must be followed', false),
  ('session_required', 'restricted', 'A session-bound download is required', true),
  ('login_required', 'restricted', 'An authorized login is required', true),
  ('membership_required', 'restricted', 'Authorized membership is required', true),
  ('paid_access_required', 'restricted', 'Authorized paid access is required', true),
  ('captcha_required', 'restricted', 'A human must complete a CAPTCHA', true),
  ('terms_acceptance_required', 'restricted', 'An authorized person must accept terms', true),
  ('dynamic_javascript_required', 'publicly_accessible_but_unsupported', 'The public page requires JavaScript', true),
  ('access_forbidden', 'restricted', 'The server refused access', true),
  ('rate_limited', 'technical_failure', 'The remote source rate-limited the request', false),
  ('expired_link', 'technical_failure', 'The document link has expired', true),
  ('broken_link', 'technical_failure', 'The document link is broken or unavailable', true),
  ('unsupported_file_type', 'publicly_accessible_but_unsupported', 'The public file type is unsupported', true),
  ('file_too_large', 'publicly_accessible_but_unsupported', 'The public file exceeds the safe size limit', true),
  ('download_timeout', 'technical_failure', 'The public download timed out', false),
  ('archive_processing_required', 'publicly_accessible_but_unsupported', 'The file requires archive processing', false),
  ('manual_review_required', 'manual', 'A person must review the access path', true),
  ('downloaded', 'processed', 'The document was downloaded lawfully', false),
  ('parsed', 'processed', 'The downloaded document was parsed', false),
  ('parsing_failed', 'technical_failure', 'The downloaded document could not be parsed', true)
on conflict (code) do update set
  access_class = excluded.access_class,
  description = excluded.description,
  manual_action_required = excluded.manual_action_required;

-- ---------------------------------------------------------------------------
-- 2) Repository and live-version inventory
-- ---------------------------------------------------------------------------

create table if not exists public.pipeline_versions (
  id bigint generated by default as identity primary key,
  component text not null check (
    component in (
      'tender_ingestion',
      'document_discovery',
      'document_retrieval',
      'document_parsing',
      'ai_extraction',
      'candidate_generation',
      'scoring',
      'explanation_generation'
    )
  ),
  version_identifier text not null,
  semantic_version text,
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_path text,
  migration_path text,
  repository_commit text,
  is_repository_current boolean not null default false,
  live_verification_status text not null default 'unknown' check (
    live_verification_status in (
      'verified_live',
      'repository_only',
      'conflicting',
      'unknown'
    )
  ),
  live_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (component, version_identifier)
);

create unique index if not exists pipeline_versions_repository_current_uidx
  on public.pipeline_versions(component)
  where is_repository_current;

-- Hashes are filled with the exact final repository content by this migration
-- commit. A repository version is not evidence of live deployment.
insert into public.pipeline_versions (
  component,
  version_identifier,
  semantic_version,
  content_sha256,
  source_path,
  migration_path,
  is_repository_current,
  live_verification_status,
  metadata
)
values
  (
    'tender_ingestion',
    'ted-sync-v1.5+phase0.1',
    '1.5.0-phase0.1',
    '64d5331f3e6903994f8ca8e4811cb4f136df42da1e4ed944342e20241027c12a',
    'supabase/functions/ted-sync/index.ts',
    null,
    true,
    'repository_only',
    '{"expected_caller":"pg_cron or authorized manual POST"}'::jsonb
  ),
  (
    'document_discovery',
    'document-discovery-v1+phase0.1',
    '1.0.0-phase0.1',
    '9daa1c0b705c99b33750f176da954cf19a40f6c9cab34612b3afc3cfffe7d1a8',
    'supabase/functions/tender-attachment-discovery/index.ts',
    'supabase/migrations/202607100007_tender_attachment_discovery.sql',
    true,
    'repository_only',
    '{"expected_caller":"authorized partner Edge Function request","related_source_hashes":{"supabase/functions/ted-notice-resolver/index.ts":"8fe782572898e3b8c1e20048931d1a6708258cedc7d534462605c5edec734451"}}'::jsonb
  ),
  (
    'document_retrieval',
    'document-retrieval-v1+phase0.1',
    '1.0.0-phase0.1',
    'ce909fa2d9d6c5bda01de0a5aa7b6716ee6c28e30fd8e0b1edc36b41a425db99',
    'supabase/functions/_shared/matching-observability.ts',
    null,
    true,
    'repository_only',
    '{"scope":"lawful access classification and download attempts"}'::jsonb
  ),
  (
    'document_parsing',
    'document-parsing-v1+phase0.1',
    '1.0.0-phase0.1',
    'a1bcb941d44240fc444183cb8e85af804e9158b7b8e15c964fd31b2dee2c315d',
    'supabase/functions/tender-document-engine/index.ts',
    'supabase/migrations/202607100006_tender_document_engine.sql',
    true,
    'repository_only',
    '{"parsers":["provider-native PDF","UTF-8 text","UTF-8 CSV","archive worker Office conversion"],"related_source_hashes":{"supabase/functions/tender-archive-worker/index.ts":"0b1d8aa608c32a6cc65c182bea2d0ee5da1551ef7e24b735db78ecbffd6924ca"}}'::jsonb
  ),
  (
    'ai_extraction',
    'tender-extraction-prompt-v1+phase0.1',
    '1.0.0-phase0.1',
    'a1bcb941d44240fc444183cb8e85af804e9158b7b8e15c964fd31b2dee2c315d',
    'supabase/functions/tender-document-engine/index.ts',
    'supabase/migrations/202607100005_explainable_match_engine.sql',
    true,
    'repository_only',
    '{"provider":"Anthropic","prompt_behavior_changed":false}'::jsonb
  ),
  (
    'candidate_generation',
    'candidate-generation-202607200002',
    '202607200002',
    '18c2109170b057adf050b1e5b6b3e49553b6e3379b0da3d38913f0fbad202120',
    null,
    'supabase/migrations/202607200002_english_normalization.sql',
    true,
    'conflicting',
    '{"conflict":"supabase/setup/CPV-YAMA.sql may replace the same RPC"}'::jsonb
  ),
  (
    'scoring',
    'matching-score-202607200002',
    '202607200002',
    '18c2109170b057adf050b1e5b6b3e49553b6e3379b0da3d38913f0fbad202120',
    null,
    'supabase/migrations/202607200002_english_normalization.sql',
    true,
    'conflicting',
    '{"weights_changed":false,"conflict":"supabase/setup/CPV-YAMA.sql may replace the same RPC"}'::jsonb
  ),
  (
    'explanation_generation',
    'explainable-match-202607100005',
    '202607100005',
    'f77d662ea3018b14065f55428f98f6829bf503636926b215d1af549dd3f1d65d',
    null,
    'supabase/migrations/202607100005_explainable_match_engine.sql',
    true,
    'repository_only',
    '{"weights_changed":false}'::jsonb
  )
on conflict (component, version_identifier) do update set
  semantic_version = excluded.semantic_version,
  content_sha256 = excluded.content_sha256,
  source_path = excluded.source_path,
  migration_path = excluded.migration_path,
  is_repository_current = excluded.is_repository_current,
  live_verification_status = excluded.live_verification_status,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- 3) End-to-end runs and stages
-- ---------------------------------------------------------------------------

create table if not exists public.pipeline_runs (
  trace_id uuid primary key default gen_random_uuid(),
  parent_trace_id uuid references public.pipeline_runs(trace_id) on delete set null,
  pipeline_component text not null,
  source text,
  status text not null default 'running' check (
    status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  pipeline_version text not null,
  attempt_number integer not null default 1 check (attempt_number > 0),
  error_category text references public.pipeline_error_categories(code),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (parent_trace_id is null or parent_trace_id <> trace_id)
);

create index if not exists pipeline_runs_component_started_idx
  on public.pipeline_runs(pipeline_component, started_at desc);
create index if not exists pipeline_runs_status_started_idx
  on public.pipeline_runs(status, started_at desc);

create table if not exists public.pipeline_run_stages (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references public.pipeline_runs(trace_id) on delete cascade,
  parent_stage_id uuid references public.pipeline_run_stages(id) on delete set null,
  tender_id bigint references public.tenders(id) on delete set null,
  company_id bigint references public.companies(id) on delete set null,
  document_id bigint references public.tender_documents(id) on delete set null,
  source text,
  stage_name text not null check (
    stage_name in (
      'scheduled_execution',
      'source_fetch',
      'tender_ingestion',
      'tender_update',
      'document_link_discovery',
      'document_access_attempt',
      'document_download',
      'archive_extraction',
      'parsing',
      'ocr_eligibility',
      'ai_extraction',
      'structured_validation',
      'candidate_generation',
      'score_calculation',
      'explanation_generation',
      'opportunity_upsert',
      'profile_refresh',
      'frontend_retrieval'
    )
  ),
  status text not null default 'running' check (
    status in (
      'queued',
      'running',
      'completed',
      'partial',
      'skipped',
      'failed',
      'restricted',
      'manual_review'
    )
  ),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  pipeline_version text not null,
  attempt_number integer not null default 1 check (attempt_number > 0),
  error_category text references public.pipeline_error_categories(code),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (parent_stage_id is null or parent_stage_id <> id)
);

create index if not exists pipeline_run_stages_trace_idx
  on public.pipeline_run_stages(trace_id, started_at);
create index if not exists pipeline_run_stages_tender_idx
  on public.pipeline_run_stages(tender_id, started_at desc)
  where tender_id is not null;
create index if not exists pipeline_run_stages_company_idx
  on public.pipeline_run_stages(company_id, started_at desc)
  where company_id is not null;
create index if not exists pipeline_run_stages_failure_idx
  on public.pipeline_run_stages(error_category, started_at desc)
  where status = 'failed';

create or replace function public.validate_pipeline_stage_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_trace_id uuid;
begin
  if new.parent_stage_id is null then return new; end if;
  select trace_id into v_parent_trace_id
  from public.pipeline_run_stages
  where id = new.parent_stage_id;
  if v_parent_trace_id is null or v_parent_trace_id <> new.trace_id then
    raise exception 'Parent stage must belong to the same trace';
  end if;
  return new;
end;
$$;

drop trigger if exists pipeline_stage_parent_trace_check on public.pipeline_run_stages;
create trigger pipeline_stage_parent_trace_check
before insert or update of parent_stage_id, trace_id
on public.pipeline_run_stages
for each row execute function public.validate_pipeline_stage_parent();

-- ---------------------------------------------------------------------------
-- 4) Document access attempts and lawful manual provenance
-- ---------------------------------------------------------------------------

create table if not exists public.document_access_attempts (
  id bigint generated by default as identity primary key,
  trace_id uuid not null references public.pipeline_runs(trace_id) on delete cascade,
  stage_id uuid references public.pipeline_run_stages(id) on delete set null,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  document_id bigint references public.tender_documents(id) on delete set null,
  portal_url text,
  portal_domain text,
  url_sha256 text check (url_sha256 is null or url_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null references public.document_access_statuses(code),
  access_class text not null,
  source_type text not null,
  source_confidence text not null default 'unknown' check (
    source_confidence in (
      'official_verified',
      'official_unverified',
      'authorized_upload',
      'third_party_verified',
      'unknown'
    )
  ),
  http_status integer,
  redirect_count integer check (redirect_count is null or redirect_count >= 0),
  content_type text,
  content_length_bytes bigint check (
    content_length_bytes is null or content_length_bytes >= 0
  ),
  attempt_number integer not null default 1 check (attempt_number > 0),
  error_category text references public.pipeline_error_categories(code),
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_access_attempts_tender_idx
  on public.document_access_attempts(tender_id, created_at desc);
create index if not exists document_access_attempts_domain_idx
  on public.document_access_attempts(portal_domain, created_at desc);
create index if not exists document_access_attempts_status_idx
  on public.document_access_attempts(status, created_at desc);

create or replace function public.set_document_access_class()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select access_class into new.access_class
  from public.document_access_statuses
  where code = new.status;
  if new.access_class is null then
    raise exception 'Unknown document access status';
  end if;
  return new;
end;
$$;

drop trigger if exists document_access_attempts_set_class
on public.document_access_attempts;
create trigger document_access_attempts_set_class
before insert or update of status
on public.document_access_attempts
for each row execute function public.set_document_access_class();

alter table public.tenders
  add column if not exists ingestion_version text,
  add column if not exists ingestion_trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists source_snapshot_hash text,
  add column if not exists document_discovery_version text,
  add column if not exists document_discovery_trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists document_parser_version text,
  add column if not exists ai_extraction_version text,
  add column if not exists document_analysis_trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null;

alter table public.tender_documents
  add column if not exists access_status text
    references public.document_access_statuses(code),
  add column if not exists access_checked_at timestamptz,
  add column if not exists access_source text,
  add column if not exists source_confidence text check (
    source_confidence is null or source_confidence in (
      'official_verified',
      'official_unverified',
      'authorized_upload',
      'third_party_verified',
      'unknown'
    )
  ),
  add column if not exists retrieval_version text,
  add column if not exists parser_version text,
  add column if not exists pipeline_trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists uploaded_at timestamptz,
  add column if not exists upload_provenance jsonb not null default '{}'::jsonb;

alter table public.tender_document_analysis_jobs
  add column if not exists trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists extraction_version text,
  add column if not exists prompt_schema_version text,
  add column if not exists input_snapshot_hash text,
  add column if not exists provider_request_id text,
  add column if not exists provider_usage jsonb not null default '{}'::jsonb,
  add column if not exists duration_ms bigint check (
    duration_ms is null or duration_ms >= 0
  );

alter table public.tender_document_discovery_jobs
  add column if not exists trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists pipeline_version text;

alter table public.tender_archive_jobs
  add column if not exists trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists retrieval_version text,
  add column if not exists parser_version text;

-- Existing production setup files do not consistently provide updated_at for
-- company and product rows. Add it so staleness can be detected without
-- scheduling a recomputation.
alter table public.companies
  add column if not exists updated_at timestamptz not null default now();
alter table public.products
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.phase_zero_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists companies_phase_zero_updated_at on public.companies;
create trigger companies_phase_zero_updated_at
before update on public.companies
for each row execute function public.phase_zero_set_updated_at();

drop trigger if exists products_phase_zero_updated_at on public.products;
create trigger products_phase_zero_updated_at
before update on public.products
for each row execute function public.phase_zero_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Score/explanation lineage and non-triggering staleness detection
-- ---------------------------------------------------------------------------

alter table public.opportunity_matches
  add column if not exists candidate_generation_version text,
  add column if not exists scoring_version text,
  add column if not exists explanation_version text,
  add column if not exists score_trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists explanation_trace_id uuid
    references public.pipeline_runs(trace_id) on delete set null,
  add column if not exists company_snapshot_at timestamptz,
  add column if not exists profile_snapshot_at timestamptz,
  add column if not exists product_snapshot_at timestamptz,
  add column if not exists tender_snapshot_at timestamptz,
  add column if not exists document_snapshot_at timestamptz,
  add column if not exists scored_at timestamptz,
  add column if not exists explained_at timestamptz;

create or replace function public.stamp_company_match_observability(
  p_company_id bigint,
  p_trace_id uuid,
  p_candidate_version text,
  p_scoring_version text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  update public.opportunity_matches om
  set
    candidate_generation_version = p_candidate_version,
    scoring_version = p_scoring_version,
    score_trace_id = p_trace_id,
    company_snapshot_at = c.updated_at,
    profile_snapshot_at = cmp.updated_at,
    product_snapshot_at = (
      select max(p.updated_at)
      from public.products p
      where p.company_id = p_company_id
    ),
    tender_snapshot_at = t.updated_at,
    document_snapshot_at = greatest(
      t.last_document_analysis_at,
      (
        select max(td.updated_at)
        from public.tender_documents td
        where td.tender_id = t.id
      )
    ),
    scored_at = now()
  from public.companies c
  join public.company_match_profiles cmp on cmp.company_id = c.id
  join public.tenders t on true
  where om.company_id = p_company_id
    and om.company_id = c.id
    and om.opportunity_type = 'tender'
    and om.tender_id = t.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.stamp_company_match_observability(
  bigint, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.stamp_company_match_observability(
  bigint, uuid, text, text
) to service_role;

create or replace function public.stamp_explainable_match_observability(
  p_company_id bigint,
  p_trace_id uuid,
  p_explanation_version text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  update public.opportunity_matches om
  set
    explanation_version = p_explanation_version,
    explanation_trace_id = p_trace_id,
    tender_snapshot_at = t.updated_at,
    document_snapshot_at = greatest(
      t.last_document_analysis_at,
      (
        select max(td.updated_at)
        from public.tender_documents td
        where td.tender_id = t.id
      )
    ),
    explained_at = now()
  from public.tenders t
  where om.company_id = p_company_id
    and om.opportunity_type = 'tender'
    and om.tender_id = t.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.stamp_explainable_match_observability(
  bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.stamp_explainable_match_observability(
  bigint, uuid, text
) to service_role;

create or replace view public.opportunity_match_staleness
with (security_invoker = true)
as
with current_versions as (
  select
    max(version_identifier) filter (
      where component = 'candidate_generation' and is_repository_current
    ) as candidate_generation_version,
    max(version_identifier) filter (
      where component = 'scoring' and is_repository_current
    ) as scoring_version,
    max(version_identifier) filter (
      where component = 'ai_extraction' and is_repository_current
    ) as ai_extraction_version,
    max(version_identifier) filter (
      where component = 'explanation_generation' and is_repository_current
    ) as explanation_version
  from public.pipeline_versions
),
stale_rows as (
  select
    om.id as opportunity_match_id,
    om.company_id,
    om.tender_id,
    om.scoring_version,
    om.explanation_version,
    om.scored_at,
    om.explained_at,
    array_remove(array[
      case
        when om.candidate_generation_version is null
        then 'unversioned_candidate_generation'
        when om.candidate_generation_version
          is distinct from cv.candidate_generation_version
        then 'candidate_generation_version_updated'
      end,
      case when om.scoring_version is null then 'unversioned_score' end,
      case
        when om.scoring_version is distinct from cv.scoring_version
        then 'scoring_version_updated'
      end,
      case
        when om.company_snapshot_at is null or c.updated_at > om.company_snapshot_at
        then 'company_updated'
      end,
      case
        when om.profile_snapshot_at is null or cmp.updated_at > om.profile_snapshot_at
        then 'company_profile_updated'
      end,
      case
        when exists (
          select 1
          from public.products p
          where p.company_id = om.company_id
            and (
              om.product_snapshot_at is null
              or p.updated_at > om.product_snapshot_at
            )
        )
        then 'company_product_updated'
      end,
      case
        when om.tender_snapshot_at is null or t.updated_at > om.tender_snapshot_at
        then 'tender_updated'
      end,
      case
        when t.last_document_analysis_at is not null
          and (
            om.document_snapshot_at is null
            or t.last_document_analysis_at > om.document_snapshot_at
          )
        then 'document_analysis_updated'
      end,
      case
        when exists (
          select 1
          from public.tender_documents td
          where td.tender_id = om.tender_id
            and (
              om.document_snapshot_at is null
              or td.updated_at > om.document_snapshot_at
            )
        )
        then 'document_uploaded_or_reparsed'
      end,
      case
        when t.document_analysis_status in ('completed', 'partial')
          and t.ai_extraction_version
            is distinct from cv.ai_extraction_version
        then 'ai_extraction_version_updated'
      end,
      case
        when om.explanation_version is null
        then 'unversioned_explanation'
        when om.explanation_version is distinct from cv.explanation_version
        then 'explanation_version_updated'
      end
    ], null)::text[] as stale_reasons
  from public.opportunity_matches om
  join public.companies c on c.id = om.company_id
  join public.company_match_profiles cmp on cmp.company_id = om.company_id
  join public.tenders t on t.id = om.tender_id
  cross join current_versions cv
  where om.opportunity_type = 'tender'
)
select
  *,
  cardinality(stale_reasons) > 0 as is_stale
from stale_rows;

-- ---------------------------------------------------------------------------
-- 6) Human benchmark structure
-- ---------------------------------------------------------------------------

create table if not exists public.benchmark_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  benchmark_version text not null,
  tender_id bigint not null references public.tenders(id) on delete restrict,
  company_id bigint not null references public.companies(id) on delete restrict,
  tender_snapshot_version text not null,
  company_profile_snapshot_version text not null,
  document_availability_status text not null check (
    document_availability_status in (
      'complete',
      'partial',
      'notice_only',
      'missing',
      'captcha_restricted',
      'login_restricted',
      'membership_restricted',
      'paid_restricted',
      'scanned',
      'archive',
      'unknown'
    )
  ),
  final_relevance_label text check (
    final_relevance_label is null or final_relevance_label in (
      'highly_relevant',
      'potentially_relevant',
      'irrelevant'
    )
  ),
  expected_score_min integer check (
    expected_score_min is null or expected_score_min between 0 and 100
  ),
  expected_score_max integer check (
    expected_score_max is null or expected_score_max between 0 and 100
  ),
  product_relevance text check (
    product_relevance is null or product_relevance in (
      'exact',
      'synonym',
      'category_only',
      'incompatible',
      'unknown'
    )
  ),
  country_eligibility text check (
    country_eligibility is null or country_eligibility in (
      'eligible',
      'ineligible',
      'unknown',
      'not_applicable'
    )
  ),
  certificate_eligibility text check (
    certificate_eligibility is null or certificate_eligibility in (
      'eligible',
      'ineligible',
      'unknown',
      'not_applicable'
    )
  ),
  commercial_eligibility text check (
    commercial_eligibility is null or commercial_eligibility in (
      'eligible',
      'ineligible',
      'unknown',
      'not_applicable'
    )
  ),
  technical_specification_compatibility text check (
    technical_specification_compatibility is null
    or technical_specification_compatibility in (
      'compatible',
      'incompatible',
      'partial',
      'unknown',
      'not_applicable'
    )
  ),
  human_explanation text,
  adjudicated_by uuid references auth.users(id) on delete set null,
  adjudicated_at timestamptz,
  review_status text not null default 'pending' check (
    review_status in ('pending', 'in_review', 'ready', 'adjudicated', 'rejected')
  ),
  actual_engine_score integer check (
    actual_engine_score is null or actual_engine_score between 0 and 100
  ),
  scoring_version text,
  false_positive boolean,
  false_negative boolean,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    expected_score_min is null
    or expected_score_max is null
    or expected_score_min <= expected_score_max
  )
);

create unique index if not exists benchmark_cases_pair_version_uidx
  on public.benchmark_cases(benchmark_version, tender_id, company_id);

create table if not exists public.benchmark_annotations (
  id uuid primary key default gen_random_uuid(),
  benchmark_case_id uuid not null
    references public.benchmark_cases(id) on delete cascade,
  annotator_id uuid not null references auth.users(id) on delete restrict,
  relevance_label text not null check (
    relevance_label in (
      'highly_relevant',
      'potentially_relevant',
      'irrelevant'
    )
  ),
  expected_score_min integer check (
    expected_score_min is null or expected_score_min between 0 and 100
  ),
  expected_score_max integer check (
    expected_score_max is null or expected_score_max between 0 and 100
  ),
  product_relevance text not null check (
    product_relevance in (
      'exact',
      'synonym',
      'category_only',
      'incompatible',
      'unknown'
    )
  ),
  country_eligibility text not null check (
    country_eligibility in ('eligible', 'ineligible', 'unknown', 'not_applicable')
  ),
  certificate_eligibility text not null check (
    certificate_eligibility in ('eligible', 'ineligible', 'unknown', 'not_applicable')
  ),
  commercial_eligibility text not null check (
    commercial_eligibility in ('eligible', 'ineligible', 'unknown', 'not_applicable')
  ),
  technical_specification_compatibility text not null check (
    technical_specification_compatibility in (
      'compatible',
      'incompatible',
      'partial',
      'unknown',
      'not_applicable'
    )
  ),
  human_explanation text not null,
  notes text,
  annotated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (benchmark_case_id, annotator_id),
  check (
    expected_score_min is null
    or expected_score_max is null
    or expected_score_min <= expected_score_max
  )
);

create index if not exists benchmark_annotations_case_idx
  on public.benchmark_annotations(benchmark_case_id, annotated_at);

drop trigger if exists benchmark_cases_updated_at on public.benchmark_cases;
create trigger benchmark_cases_updated_at
before update on public.benchmark_cases
for each row execute function public.phase_zero_set_updated_at();

drop trigger if exists benchmark_annotations_updated_at
on public.benchmark_annotations;
create trigger benchmark_annotations_updated_at
before update on public.benchmark_annotations
for each row execute function public.phase_zero_set_updated_at();

create or replace view public.benchmark_case_review_summary
with (security_invoker = true)
as
select
  bc.id as benchmark_case_id,
  bc.case_key,
  bc.benchmark_version,
  bc.review_status,
  count(ba.id)::integer as annotation_count,
  count(distinct ba.annotator_id)::integer as independent_annotator_count,
  count(distinct ba.relevance_label)::integer as distinct_label_count,
  case
    when count(distinct ba.annotator_id) < 2 then false
    else true
  end as ready_for_adjudication,
  case
    when count(distinct ba.annotator_id) >= 2
      and count(distinct ba.relevance_label) = 1
    then min(ba.relevance_label)
    else null
  end as agreed_label
from public.benchmark_cases bc
left join public.benchmark_annotations ba
  on ba.benchmark_case_id = bc.id
group by bc.id, bc.case_key, bc.benchmark_version, bc.review_status;

create or replace function public.adjudicate_benchmark_case(
  p_case_id uuid,
  p_final_label text,
  p_human_explanation text,
  p_notes text default null
)
returns public.benchmark_cases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.benchmark_cases;
  v_annotators integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_final_label not in (
    'highly_relevant',
    'potentially_relevant',
    'irrelevant'
  ) then
    raise exception 'Invalid benchmark label';
  end if;
  select count(distinct annotator_id)
  into v_annotators
  from public.benchmark_annotations
  where benchmark_case_id = p_case_id;
  if v_annotators < 2 then
    raise exception 'Two independent annotations are required';
  end if;
  update public.benchmark_cases
  set
    final_relevance_label = p_final_label,
    human_explanation = nullif(trim(p_human_explanation), ''),
    notes = coalesce(p_notes, notes),
    review_status = 'adjudicated',
    adjudicated_by = auth.uid(),
    adjudicated_at = now()
  where id = p_case_id
  returning * into v_case;
  if v_case.id is null then raise exception 'Benchmark case not found'; end if;
  return v_case;
end;
$$;

revoke all on function public.adjudicate_benchmark_case(
  uuid, text, text, text
) from public, anon;
grant execute on function public.adjudicate_benchmark_case(
  uuid, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Health and staleness reporting
-- ---------------------------------------------------------------------------

create or replace view public.pipeline_health_daily
with (security_invoker = true)
as
select
  date_trunc('day', started_at)::date as metric_date,
  source,
  stage_name,
  pipeline_version,
  count(*) as stage_count,
  count(*) filter (where status = 'completed') as completed_count,
  count(*) filter (where status = 'partial') as partial_count,
  count(*) filter (where status = 'failed') as failed_count,
  count(*) filter (where status in ('restricted', 'manual_review'))
    as restricted_or_manual_count,
  round(
    100.0 * count(*) filter (where status = 'completed')
    / nullif(count(*), 0),
    2
  ) as success_rate_percent,
  round(avg(duration_ms)::numeric, 2) as average_duration_ms
from public.pipeline_run_stages
group by
  date_trunc('day', started_at)::date,
  source,
  stage_name,
  pipeline_version;

create or replace view public.document_access_health_daily
with (security_invoker = true)
as
select
  date_trunc('day', daa.started_at)::date as metric_date,
  daa.source_type,
  daa.portal_domain,
  count(*) as attempt_count,
  count(*) filter (where prs.stage_name = 'document_download')
    as public_retrieval_attempt_count,
  count(*) filter (
    where prs.stage_name = 'document_download'
      and daa.status in ('downloaded', 'parsed')
  )
    as public_retrieval_success_count,
  count(*) filter (where daa.access_class = 'restricted')
    as restricted_access_count,
  count(*) filter (where daa.status = 'captcha_required')
    as captcha_required_count,
  count(*) filter (where daa.status = 'login_required')
    as login_required_count,
  count(*) filter (where daa.status = 'membership_required')
    as membership_required_count,
  count(*) filter (
    where daa.access_class in ('manual', 'restricted')
      or daa.status = 'manual_review_required'
  ) as manual_review_count,
  count(*) filter (
    where prs.stage_name = 'document_download'
      and daa.access_class = 'technical_failure'
  ) as technical_failure_count,
  count(*) filter (
    where prs.stage_name = 'document_link_discovery'
      and daa.access_class = 'technical_failure'
  ) as discovery_technical_failure_count,
  round(
    100.0 * count(*) filter (
      where prs.stage_name = 'document_download'
        and daa.status in ('downloaded', 'parsed')
    )
    / nullif(
      count(*) filter (
        where prs.stage_name = 'document_download'
          and daa.access_class in (
            'public',
            'publicly_accessible_but_unsupported',
            'processed',
            'technical_failure'
          )
      ),
      0
    ),
    2
  ) as public_retrieval_success_rate_percent,
  round(
    100.0 * count(*) filter (where daa.access_class = 'restricted')
    / nullif(count(*), 0),
    2
  ) as restricted_access_rate_percent,
  round(
    100.0 * count(*) filter (
      where prs.stage_name = 'document_download'
        and daa.access_class = 'technical_failure'
    )
    / nullif(
      count(*) filter (
        where prs.stage_name = 'document_download'
          and daa.access_class <> 'restricted'
      ),
      0
    ),
    2
  ) as technical_failure_rate_percent,
  round(avg(daa.duration_ms)::numeric, 2) as average_duration_ms
from public.document_access_attempts daa
left join public.pipeline_run_stages prs on prs.id = daa.stage_id
group by
  date_trunc('day', daa.started_at)::date,
  daa.source_type,
  daa.portal_domain;

-- ---------------------------------------------------------------------------
-- 8) Security
-- ---------------------------------------------------------------------------

alter table public.pipeline_error_categories enable row level security;
alter table public.document_access_statuses enable row level security;
alter table public.pipeline_versions enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.pipeline_run_stages enable row level security;
alter table public.document_access_attempts enable row level security;
alter table public.benchmark_cases enable row level security;
alter table public.benchmark_annotations enable row level security;

drop policy if exists "admins read pipeline error categories"
on public.pipeline_error_categories;
create policy "admins read pipeline error categories"
on public.pipeline_error_categories for select to authenticated
using (public.is_admin());

drop policy if exists "admins read document access statuses"
on public.document_access_statuses;
create policy "admins read document access statuses"
on public.document_access_statuses for select to authenticated
using (public.is_admin());

drop policy if exists "admins read pipeline versions"
on public.pipeline_versions;
create policy "admins read pipeline versions"
on public.pipeline_versions for select to authenticated
using (public.is_admin());

drop policy if exists "admins read pipeline runs"
on public.pipeline_runs;
create policy "admins read pipeline runs"
on public.pipeline_runs for select to authenticated
using (public.is_admin());

drop policy if exists "admins read pipeline stages"
on public.pipeline_run_stages;
create policy "admins read pipeline stages"
on public.pipeline_run_stages for select to authenticated
using (public.is_admin());

drop policy if exists "admins read document access attempts"
on public.document_access_attempts;
create policy "admins read document access attempts"
on public.document_access_attempts for select to authenticated
using (public.is_admin());

drop policy if exists "admins manage benchmark cases"
on public.benchmark_cases;
create policy "admins manage benchmark cases"
on public.benchmark_cases for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins manage benchmark annotations"
on public.benchmark_annotations;
create policy "admins manage benchmark annotations"
on public.benchmark_annotations for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update, delete on table
  public.benchmark_cases,
  public.benchmark_annotations
to authenticated;

-- Edge Functions use service_role and bypass RLS for trace writes. Normal
-- authenticated users cannot write diagnostics or annotations unless admin.
revoke all on table
  public.pipeline_error_categories,
  public.document_access_statuses,
  public.pipeline_versions,
  public.pipeline_runs,
  public.pipeline_run_stages,
  public.document_access_attempts
from anon, authenticated;

grant select on table
  public.pipeline_error_categories,
  public.document_access_statuses,
  public.pipeline_versions,
  public.pipeline_runs,
  public.pipeline_run_stages,
  public.document_access_attempts
to authenticated;

grant all on table
  public.pipeline_error_categories,
  public.document_access_statuses,
  public.pipeline_versions,
  public.pipeline_runs,
  public.pipeline_run_stages,
  public.document_access_attempts,
  public.benchmark_cases,
  public.benchmark_annotations
to service_role;

grant usage, select on sequence
  public.pipeline_versions_id_seq,
  public.document_access_attempts_id_seq
to service_role;

revoke all on
  public.pipeline_health_daily,
  public.document_access_health_daily,
  public.opportunity_match_staleness,
  public.benchmark_case_review_summary
from anon, authenticated;

grant select on
  public.pipeline_health_daily,
  public.document_access_health_daily,
  public.opportunity_match_staleness,
  public.benchmark_case_review_summary
to service_role;

commit;

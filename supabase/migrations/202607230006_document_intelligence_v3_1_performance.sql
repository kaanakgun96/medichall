-- MedicHall Document Intelligence v3.1
--
-- Additive performance, cache, progress, cost-guardrail, benchmark, and
-- quality observability support. Existing queue/status RPC signatures,
-- extraction payloads, authentication, storage, scoring, and RLS contracts
-- remain unchanged.

begin;

alter table public.tender_document_analysis_jobs
  add column if not exists ai_request_count integer not null default 0,
  add column if not exists total_input_tokens bigint not null default 0,
  add column if not exists total_output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists provider_name text,
  add column if not exists ai_duration_ms bigint not null default 0,
  add column if not exists inspection_duration_ms bigint not null default 0,
  add column if not exists chunk_generation_duration_ms bigint
    not null default 0,
  add column if not exists merge_duration_ms bigint not null default 0,
  add column if not exists database_duration_ms bigint not null default 0,
  add column if not exists network_duration_ms bigint not null default 0,
  add column if not exists early_completion_reason text,
  add column if not exists termination_reason text,
  add column if not exists progress_stage text
    not null default 'downloading_attachments',
  add column if not exists progress_percent integer not null default 0,
  add column if not exists estimated_remaining_seconds integer,
  add column if not exists benchmark_mode boolean not null default false,
  add column if not exists benchmark_result jsonb not null default '{}'::jsonb,
  add column if not exists cache_hit_count integer not null default 0,
  add column if not exists cache_miss_count integer not null default 0,
  add column if not exists documents_cached integer not null default 0,
  add column if not exists chunks_ignored integer not null default 0,
  add column if not exists duplicate_facts_removed integer not null default 0,
  add column if not exists conflicts_detected integer not null default 0,
  add column if not exists products_extracted integer not null default 0,
  add column if not exists requirements_extracted integer not null default 0;

alter table public.tender_document_analysis_chunks
  add column if not exists provider_name text,
  add column if not exists provider_duration_ms bigint not null default 0,
  add column if not exists cache_key text,
  add column if not exists cache_hit boolean not null default false,
  add column if not exists processing_order integer,
  add column if not exists ignored_reason text,
  add column if not exists estimated_input_tokens bigint not null default 0,
  add column if not exists density_score integer not null default 0,
  add column if not exists ai_request_count integer not null default 0;

alter table public.tender_document_analysis_chunks
  drop constraint if exists tender_document_analysis_chunks_status_check;
alter table public.tender_document_analysis_chunks
  add constraint tender_document_analysis_chunks_status_check
  check (status in ('queued', 'processing', 'completed', 'failed', 'ignored'));

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_analysis_jobs_v31_metrics_check'
  ) then
    alter table public.tender_document_analysis_jobs
      add constraint tender_analysis_jobs_v31_metrics_check
      check (
        ai_request_count >= 0
        and total_input_tokens >= 0
        and total_output_tokens >= 0
        and total_tokens = total_input_tokens + total_output_tokens
        and ai_duration_ms >= 0
        and inspection_duration_ms >= 0
        and chunk_generation_duration_ms >= 0
        and merge_duration_ms >= 0
        and database_duration_ms >= 0
        and network_duration_ms >= 0
        and progress_percent between 0 and 100
        and (
          estimated_remaining_seconds is null
          or estimated_remaining_seconds >= 0
        )
        and cache_hit_count >= 0
        and cache_miss_count >= 0
        and documents_cached >= 0
        and chunks_ignored >= 0
        and duplicate_facts_removed >= 0
        and conflicts_detected >= 0
        and products_extracted >= 0
        and requirements_extracted >= 0
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_analysis_jobs_v31_progress_stage_check'
  ) then
    alter table public.tender_document_analysis_jobs
      add constraint tender_analysis_jobs_v31_progress_stage_check
      check (
        progress_stage in (
          'downloading_attachments',
          'inspecting_document',
          'finding_technical_sections',
          'reading_specifications',
          'extracting_products',
          'matching_supplier',
          'calculating_score',
          'generating_summary',
          'complete'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_analysis_chunks_v31_metrics_check'
  ) then
    alter table public.tender_document_analysis_chunks
      add constraint tender_analysis_chunks_v31_metrics_check
      check (
        provider_duration_ms >= 0
        and estimated_input_tokens >= 0
        and density_score between 0 and 100
        and ai_request_count >= 0
        and (processing_order is null or processing_order >= 0)
      );
  end if;
end
$constraints$;

create table if not exists public.tender_document_extraction_cache (
  id bigint generated by default as identity primary key,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  cache_version text not null,
  extraction_version text not null,
  prompt_schema_version text not null,
  model_name text not null,
  normalized_result jsonb not null,
  page_count integer not null default 0 check (page_count >= 0),
  confidence_score integer not null default 0 check (
    confidence_score between 0 and 100
  ),
  products_extracted integer not null default 0 check (
    products_extracted >= 0
  ),
  requirements_extracted integer not null default 0 check (
    requirements_extracted >= 0
  ),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  source_job_id bigint references public.tender_document_analysis_jobs(id)
    on delete set null,
  source_document_id bigint references public.tender_documents(id)
    on delete set null,
  provider_name text,
  ai_request_count integer not null default 0 check (ai_request_count >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(14, 6) not null default 0 check (
    estimated_cost_usd >= 0
  ),
  hit_count bigint not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    content_sha256,
    cache_version,
    extraction_version,
    prompt_schema_version,
    model_name
  )
);

create index if not exists tender_document_extraction_cache_lookup_idx
  on public.tender_document_extraction_cache (
    content_sha256,
    cache_version,
    extraction_version,
    prompt_schema_version,
    model_name,
    expires_at desc
  );

create table if not exists public.tender_document_analysis_progress_events (
  id bigint generated by default as identity primary key,
  job_id bigint not null references public.tender_document_analysis_jobs(id)
    on delete cascade,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  stage text not null check (
    stage in (
      'downloading_attachments',
      'inspecting_document',
      'finding_technical_sections',
      'reading_specifications',
      'extracting_products',
      'matching_supplier',
      'calculating_score',
      'generating_summary',
      'complete'
    )
  ),
  progress_percent integer not null check (progress_percent between 0 and 100),
  estimated_remaining_seconds integer check (
    estimated_remaining_seconds is null
    or estimated_remaining_seconds >= 0
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tender_analysis_progress_job_created_idx
  on public.tender_document_analysis_progress_events(job_id, created_at, id);

alter table public.tender_document_extraction_cache enable row level security;
alter table public.tender_document_analysis_progress_events
  enable row level security;

drop policy if exists "admins read document extraction cache"
  on public.tender_document_extraction_cache;
create policy "admins read document extraction cache"
on public.tender_document_extraction_cache for select
to authenticated
using (public.is_admin());

drop policy if exists "users read accessible document analysis progress"
  on public.tender_document_analysis_progress_events;
create policy "users read accessible document analysis progress"
on public.tender_document_analysis_progress_events for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.tender_document_analysis_jobs job
    left join public.companies company on company.id = job.company_id
    where job.id = job_id
      and (
        job.requested_by = auth.uid()
        or company.owner_id = auth.uid()
      )
  )
);

revoke all on public.tender_document_extraction_cache
  from public, anon, authenticated;
revoke all on public.tender_document_analysis_progress_events
  from public, anon, authenticated;
grant select on public.tender_document_extraction_cache to authenticated;
grant select on public.tender_document_analysis_progress_events
  to authenticated;
grant all on public.tender_document_extraction_cache to service_role;
grant all on public.tender_document_analysis_progress_events to service_role;
grant usage, select on sequence
  public.tender_document_extraction_cache_id_seq to service_role;
grant usage, select on sequence
  public.tender_document_analysis_progress_events_id_seq to service_role;

create or replace function public.get_tender_document_analysis_progress_v3(
  p_tender_id bigint,
  p_company_id bigint
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_job as (
    select job.*
    from public.tender_document_analysis_jobs job
    where job.tender_id = p_tender_id
      and job.company_id = p_company_id
      and (
        public.is_admin()
        or job.requested_by = auth.uid()
        or exists (
          select 1
          from public.companies company
          where company.id = job.company_id
            and company.owner_id = auth.uid()
        )
      )
    order by job.created_at desc
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'job_id', job.id,
        'status', job.status,
        'stage', job.progress_stage,
        'progress_percent', job.progress_percent,
        'estimated_remaining_seconds', job.estimated_remaining_seconds,
        'termination_reason', job.termination_reason,
        'events', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'stage', event.stage,
                'progress_percent', event.progress_percent,
                'estimated_remaining_seconds',
                  event.estimated_remaining_seconds,
                'metadata', event.metadata,
                'created_at', event.created_at
              )
              order by event.created_at, event.id
            )
            from public.tender_document_analysis_progress_events event
            where event.job_id = job.id
          ),
          '[]'::jsonb
        )
      )
      from selected_job job
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_tender_document_analysis_progress_v3(
  bigint,
  bigint
) from public, anon;
grant execute on function public.get_tender_document_analysis_progress_v3(
  bigint,
  bigint
) to authenticated;

create or replace view public.document_intelligence_metrics_v3_1
with (security_invoker = true)
as
select
  date_trunc('day', job.created_at) as metric_day,
  count(*) as analysis_count,
  count(*) filter (where job.status = 'completed') as completed_count,
  count(*) filter (where job.status = 'partial') as partial_count,
  round(avg(job.duration_ms)::numeric, 2) as average_analysis_duration_ms,
  round(avg(job.ai_duration_ms)::numeric, 2) as average_ai_duration_ms,
  round(avg(job.estimated_ai_cost_usd)::numeric, 6)
    as average_ai_cost_usd,
  round(avg(job.chunks_total)::numeric, 2) as average_chunks_per_analysis,
  round(avg(job.chunks_completed)::numeric, 2)
    as average_chunks_processed,
  round(avg(job.selected_pages)::numeric, 2) as average_pages_analysed,
  round(avg(job.ignored_pages)::numeric, 2) as average_pages_skipped,
  round(
    avg((job.v3_merge_result ->> 'document_confidence_score')::numeric),
    2
  ) as average_confidence,
  sum(job.documents_cached) as documents_cached,
  sum(job.cache_hit_count) as cache_hits,
  sum(job.cache_miss_count) as cache_misses,
  round(
    sum(job.cache_hit_count)::numeric
      / nullif(sum(job.cache_hit_count + job.cache_miss_count), 0),
    4
  ) as cache_hit_ratio,
  count(*) filter (where job.early_completion_reason = 'EARLY_COMPLETION')
    as early_completion_count,
  round(
    count(*) filter (
      where job.early_completion_reason = 'EARLY_COMPLETION'
    )::numeric / nullif(count(*), 0),
    4
  ) as early_completion_ratio,
  sum(job.ai_request_count) as ai_requests,
  sum(job.total_tokens) as total_tokens,
  sum(job.products_extracted) as products_extracted,
  sum(job.requirements_extracted) as requirements_extracted,
  sum(job.duplicate_facts_removed) as duplicate_facts_removed,
  sum(job.conflicts_detected) as conflicts_detected,
  sum(job.chunks_ignored) as chunks_ignored
from public.tender_document_analysis_jobs job
group by date_trunc('day', job.created_at);

revoke all on public.document_intelligence_metrics_v3_1
  from public, anon, authenticated;
grant select on public.document_intelligence_metrics_v3_1 to authenticated;
grant select on public.document_intelligence_metrics_v3_1 to service_role;

update public.pipeline_versions
set is_repository_current = false
where component in ('document_parsing', 'ai_extraction')
  and is_repository_current;

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
    'document_parsing',
    'document-chunking-v3.1.0',
    '3.1.0',
    '914fc2350531aa35733ecd56daac020ef0b887afec256c2fca6f9cc0484bfe1d',
    'supabase/functions/_shared/pdf-processing-v3.ts',
    'supabase/migrations/202607230006_document_intelligence_v3_1_performance.sql',
    true,
    'repository_only',
    '{"adaptive_chunking":true,"priority_ordering":true,"page_count_rejection":false,"core_source_hash":"675fd9cd234556f3f86431d28424c32e000a7f1f87ef4fe222d83d8da87a5fcc","performance_source_hash":"044ae02bd2db91a4524f957bbbcdfbaee6cb19a507add8e0861e4582a87ecd8c"}'::jsonb
  ),
  (
    'ai_extraction',
    'tender-extraction-v3.1.0',
    '3.1.0',
    'a57b60c5c0727a7e9cc879359b0330bcd21d7a3b15b076764b76ae0c9bcfcbfc',
    'supabase/functions/tender-document-engine/index.ts',
    'supabase/migrations/202607230006_document_intelligence_v3_1_performance.sql',
    true,
    'repository_only',
    '{"prompt_schema":"medichall-tender-facts-v3","provider":"Anthropic","bounded_parallelism":true,"document_cache":true,"early_completion":true,"cost_guardrails":true,"benchmark_mode":true,"performance_source_hash":"044ae02bd2db91a4524f957bbbcdfbaee6cb19a507add8e0861e4582a87ecd8c"}'::jsonb
  )
on conflict (component, version_identifier) do update set
  semantic_version = excluded.semantic_version,
  content_sha256 = excluded.content_sha256,
  source_path = excluded.source_path,
  migration_path = excluded.migration_path,
  is_repository_current = excluded.is_repository_current,
  live_verification_status = excluded.live_verification_status,
  metadata = excluded.metadata;

commit;

-- Rollback:
--   1. Redeploy the preceding tender-document-engine bundle.
--   2. Mark the v3.1 parsing/extraction versions non-current and restore the
--      v3.0 versions as repository-current.
--   3. Stop writing the additive v3.1 columns, cache, and progress events.
--   4. Keep cache, progress, accounting, and benchmark rows for audit.
--   5. Do not delete production tender data or rewrite migration history.

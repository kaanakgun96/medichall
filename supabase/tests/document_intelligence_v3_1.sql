-- Run after 202607230006_document_intelligence_v3_1_performance.sql.
-- All fixtures are transaction-local.

begin;

do $structure$
declare
  v_missing_columns integer;
  v_current_versions integer;
begin
  select count(*) into v_missing_columns
  from (
    values
      ('tender_document_analysis_jobs', 'ai_request_count'),
      ('tender_document_analysis_jobs', 'total_input_tokens'),
      ('tender_document_analysis_jobs', 'total_output_tokens'),
      ('tender_document_analysis_jobs', 'total_tokens'),
      ('tender_document_analysis_jobs', 'provider_name'),
      ('tender_document_analysis_jobs', 'progress_stage'),
      ('tender_document_analysis_jobs', 'progress_percent'),
      ('tender_document_analysis_jobs', 'termination_reason'),
      ('tender_document_analysis_jobs', 'benchmark_result'),
      ('tender_document_analysis_jobs', 'cache_hit_count'),
      ('tender_document_analysis_jobs', 'chunks_ignored'),
      ('tender_document_analysis_jobs', 'products_extracted'),
      ('tender_document_analysis_jobs', 'requirements_extracted'),
      ('tender_document_analysis_chunks', 'provider_duration_ms'),
      ('tender_document_analysis_chunks', 'cache_key'),
      ('tender_document_analysis_chunks', 'cache_hit'),
      ('tender_document_analysis_chunks', 'processing_order'),
      ('tender_document_analysis_chunks', 'ignored_reason'),
      ('tender_document_analysis_chunks', 'estimated_input_tokens'),
      ('tender_document_analysis_chunks', 'density_score'),
      ('tender_document_analysis_chunks', 'ai_request_count')
  ) expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns definition
    where definition.table_schema = 'public'
      and definition.table_name = expected.table_name
      and definition.column_name = expected.column_name
  );
  if v_missing_columns <> 0 then
    raise exception 'Document intelligence v3.1 is missing % columns',
      v_missing_columns;
  end if;

  if to_regclass('public.tender_document_extraction_cache') is null
    or to_regclass(
      'public.tender_document_analysis_progress_events'
    ) is null
    or to_regclass('public.document_intelligence_metrics_v3_1') is null
  then
    raise exception 'Document intelligence v3.1 relations are missing';
  end if;

  if to_regprocedure(
    'public.get_tender_document_analysis_progress_v3(bigint,bigint)'
  ) is null then
    raise exception 'Document progress RPC is missing';
  end if;

  if to_regprocedure(
    'public.queue_tender_document_analysis(bigint,bigint)'
  ) is null
    or to_regprocedure(
      'public.get_tender_document_analysis_status(bigint,bigint)'
    ) is null
    or to_regprocedure(
      'public.claim_tender_document_analysis_chunk_v3(bigint,bigint,integer,integer)'
    ) is null
  then
    raise exception 'A compatibility RPC is missing';
  end if;

  select count(*) into v_current_versions
  from public.pipeline_versions
  where is_repository_current
    and (component, version_identifier) in (
      ('document_parsing', 'document-chunking-v3.1.0'),
      ('ai_extraction', 'tender-extraction-v3.1.0')
    );
  if v_current_versions <> 2 then
    raise exception 'Expected two repository-current v3.1 versions';
  end if;

  if has_function_privilege(
    'anon',
    'public.get_tender_document_analysis_progress_v3(bigint,bigint)',
    'execute'
  ) then
    raise exception 'Anonymous users must not read analysis progress';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tender_document_extraction_cache'
      and policyname = 'admins read document extraction cache'
  )
    or not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'tender_document_analysis_progress_events'
        and policyname = 'users read accessible document analysis progress'
    )
  then
    raise exception 'Document intelligence v3.1 RLS policies are missing';
  end if;
end
$structure$;

create temporary table document_v31_fixture (
  tender_id bigint,
  job_id bigint
) on commit drop;

with tender as (
  insert into public.tenders (
    source,
    source_notice_id,
    title,
    status
  )
  values (
    'document-v31-test',
    'fixture-' || gen_random_uuid()::text,
    'Document intelligence v3.1 fixture',
    'open'
  )
  returning id
), job as (
  insert into public.tender_document_analysis_jobs (
    tender_id,
    status,
    selected_document_ids,
    extraction_version,
    prompt_schema_version,
    ai_request_count,
    total_input_tokens,
    total_output_tokens,
    total_tokens,
    progress_stage,
    progress_percent
  )
  select
    id,
    'processing',
    '{}',
    'tender-extraction-v3.1.0',
    'medichall-tender-facts-v3',
    2,
    900,
    100,
    1000,
    'extracting_products',
    65
  from tender
  returning id, tender_id
)
insert into document_v31_fixture (tender_id, job_id)
select tender_id, id
from job;

insert into public.tender_document_analysis_chunks (
  job_id,
  tender_id,
  source_document_key,
  content_sha256,
  chunk_index,
  page_start,
  page_end,
  page_numbers,
  input_hash,
  extraction_version,
  prompt_schema_version,
  status,
  ignored_reason,
  processing_order,
  density_score,
  estimated_input_tokens
)
select
  job_id,
  tender_id,
  'document-v31-test',
  repeat('a', 64),
  0,
  1,
  8,
  array(select generate_series(1, 8)),
  repeat('b', 64),
  'tender-extraction-v3.1.0',
  'medichall-tender-facts-v3',
  'ignored',
  'EARLY_COMPLETION',
  0,
  90,
  12000
from document_v31_fixture;

insert into public.tender_document_analysis_progress_events (
  job_id,
  tender_id,
  stage,
  progress_percent,
  estimated_remaining_seconds,
  metadata
)
select
  job_id,
  tender_id,
  'extracting_products',
  65,
  12,
  '{"test":true}'::jsonb
from document_v31_fixture;

insert into public.tender_document_extraction_cache (
  content_sha256,
  cache_version,
  extraction_version,
  prompt_schema_version,
  model_name,
  normalized_result,
  page_count,
  source_job_id,
  expires_at
)
select
  repeat('a', 64),
  'document-cache-v3.1.0',
  'tender-extraction-v3.1.0',
  'medichall-tender-facts-v3',
  'test-model',
  '{"analysis_status":"partial"}'::jsonb,
  8,
  job_id,
  now() + interval '1 day'
from document_v31_fixture;

do $fixture_assertions$
begin
  if not exists (
    select 1
    from public.tender_document_analysis_chunks
    where status = 'ignored'
      and ignored_reason = 'EARLY_COMPLETION'
  ) then
    raise exception 'Early-completion chunk disposition was not persisted';
  end if;
  if not exists (
    select 1 from public.tender_document_extraction_cache
    where cache_version = 'document-cache-v3.1.0'
  ) then
    raise exception 'Extraction cache row was not persisted';
  end if;
  if not exists (
    select 1 from public.tender_document_analysis_progress_events
    where stage = 'extracting_products' and progress_percent = 65
  ) then
    raise exception 'Progress event was not persisted';
  end if;
end
$fixture_assertions$;

rollback;

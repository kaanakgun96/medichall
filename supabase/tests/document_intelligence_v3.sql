-- Run after 202607230004_document_intelligence_v3.sql.
-- All fixtures and chunk-state transitions are transaction-local.

begin;

do $structure$
declare
  v_missing_columns integer;
  v_current_versions integer;
begin
  select count(*) into v_missing_columns
  from (
    values
      ('tender_documents', 'content_sha256'),
      ('tender_documents', 'page_count'),
      ('tender_documents', 'inspection_status'),
      ('tender_documents', 'inspection_version'),
      ('tender_documents', 'last_inspected_at'),
      ('tender_document_analysis_jobs', 'total_pages'),
      ('tender_document_analysis_jobs', 'selected_pages'),
      ('tender_document_analysis_jobs', 'ignored_pages'),
      ('tender_document_analysis_jobs', 'ai_pages_processed'),
      ('tender_document_analysis_jobs', 'chunks_total'),
      ('tender_document_analysis_jobs', 'chunks_completed'),
      ('tender_document_analysis_jobs', 'chunks_failed'),
      ('tender_document_analysis_jobs', 'chunks_reused'),
      ('tender_document_analysis_jobs', 'resume_count'),
      ('tender_document_analysis_jobs', 'processing_statistics'),
      ('tender_document_analysis_jobs', 'v3_plan_hash'),
      ('tender_document_analysis_jobs', 'v3_merge_result'),
      ('tenders', 'document_extraction_v3')
  ) expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns definition
    where definition.table_schema = 'public'
      and definition.table_name = expected.table_name
      and definition.column_name = expected.column_name
  );
  if v_missing_columns <> 0 then
    raise exception 'Document intelligence v3 is missing % columns',
      v_missing_columns;
  end if;

  if to_regclass('public.tender_document_inspections') is null
    or to_regclass('public.tender_document_analysis_chunks') is null
  then
    raise exception 'Document intelligence v3 tables are missing';
  end if;

  if to_regprocedure(
    'public.claim_tender_document_analysis_chunk_v3(bigint,bigint,integer,integer)'
  ) is null then
    raise exception 'Chunk claim RPC is missing';
  end if;

  -- Existing portal contracts must remain byte-for-byte signature compatible.
  if to_regprocedure(
    'public.queue_tender_document_analysis(bigint,bigint)'
  ) is null
    or to_regprocedure(
      'public.get_tender_document_analysis_status(bigint,bigint)'
    ) is null
  then
    raise exception 'An existing document queue/status RPC is missing';
  end if;

  select count(*) into v_current_versions
  from public.pipeline_versions
  where is_repository_current
    and (component, version_identifier) in (
      ('document_parsing', 'document-chunking-v3.0.0'),
      ('ai_extraction', 'tender-extraction-v3.0.0')
    );
  if v_current_versions <> 2 then
    raise exception 'Expected two repository-current v3 versions';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.claim_tender_document_analysis_chunk_v3(bigint,bigint,integer,integer)',
    'execute'
  ) then
    raise exception 'Authenticated users must not claim analysis chunks';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'tender_document_inspections'
      and policyname = 'admins read document inspections'
  )
    or not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'tender_document_analysis_chunks'
        and policyname = 'admins read document analysis chunks'
    )
  then
    raise exception 'Document intelligence v3 RLS policies are missing';
  end if;
end
$structure$;

create temporary table document_v3_fixture (
  tender_id bigint,
  job_id bigint,
  chunk_id bigint
) on commit drop;

with tender as (
  insert into public.tenders (
    source,
    source_notice_id,
    title,
    status
  )
  values (
    'document-v3-test',
    'fixture-' || gen_random_uuid()::text,
    'Document intelligence v3 fixture',
    'open'
  )
  returning id
), job as (
  insert into public.tender_document_analysis_jobs (
    tender_id,
    status,
    selected_document_ids,
    extraction_version,
    prompt_schema_version
  )
  select
    id,
    'processing',
    '{}',
    'tender-extraction-v3.0.0',
    'medichall-tender-facts-v3'
  from tender
  returning id, tender_id
), chunk as (
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
    prompt_schema_version
  )
  select
    job.id,
    job.tender_id,
    'document-v3-test',
    repeat('a', 64),
    0,
    101,
    124,
    array(select generate_series(101, 124)),
    repeat('b', 64),
    'tender-extraction-v3.0.0',
    'medichall-tender-facts-v3'
  from job
  returning id, job_id, tender_id
)
insert into document_v3_fixture (tender_id, job_id, chunk_id)
select tender_id, job_id, id
from chunk;

-- Service-role claims are atomic and a live lease cannot be claimed twice.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $claim_and_resume$
declare
  v_job_id bigint;
  v_chunk_id bigint;
  v_first public.tender_document_analysis_chunks;
  v_duplicate public.tender_document_analysis_chunks;
  v_resumed public.tender_document_analysis_chunks;
begin
  select job_id, chunk_id into v_job_id, v_chunk_id
  from document_v3_fixture;

  v_first := public.claim_tender_document_analysis_chunk_v3(
    v_job_id,
    v_chunk_id,
    60,
    3
  );
  if v_first.id is null
    or v_first.status <> 'processing'
    or v_first.attempt_count <> 1
  then
    raise exception 'First chunk claim did not create a processing lease';
  end if;

  v_duplicate := public.claim_tender_document_analysis_chunk_v3(
    v_job_id,
    v_chunk_id,
    60,
    3
  );
  if v_duplicate.id is not null then
    raise exception 'A live chunk lease was claimed twice';
  end if;

  update public.tender_document_analysis_chunks
  set lease_expires_at = now() - interval '1 second'
  where id = v_chunk_id;

  v_resumed := public.claim_tender_document_analysis_chunk_v3(
    v_job_id,
    v_chunk_id,
    60,
    3
  );
  if v_resumed.id is null
    or v_resumed.attempt_count <> 2
    or v_resumed.resume_count <> 1
  then
    raise exception 'Expired chunk processing did not resume safely';
  end if;

  update public.tender_document_analysis_chunks
  set
    status = 'completed',
    normalized_result = '{"analysis_status":"partial"}'::jsonb,
    lease_expires_at = null,
    completed_at = now()
  where id = v_chunk_id;

  v_duplicate := public.claim_tender_document_analysis_chunk_v3(
    v_job_id,
    v_chunk_id,
    60,
    3
  );
  if v_duplicate.id is not null then
    raise exception 'A completed chunk was claimed again';
  end if;
end
$claim_and_resume$;

-- An ordinary authenticated session cannot see direct chunk rows.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', gen_random_uuid()::text
  )::text,
  true
);
set local role authenticated;

do $rls_isolation$
begin
  if exists (
    select 1
    from public.tender_document_analysis_chunks
    where source_document_key = 'document-v3-test'
  ) then
    raise exception 'Ordinary authenticated user can read v3 chunk rows';
  end if;
end
$rls_isolation$;

reset role;
rollback;

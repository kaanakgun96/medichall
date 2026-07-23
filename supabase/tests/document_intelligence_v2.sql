-- Run after 202607230002_document_intelligence_v2.sql.

begin;

do $tests$
declare
  v_missing_columns integer;
  v_current_versions integer;
begin
  select count(*) into v_missing_columns
  from (
    values
      ('tender_documents', 'source_url'),
      ('tender_documents', 'resolved_url'),
      ('tender_documents', 'discovery_score'),
      ('tender_documents', 'discovery_confidence'),
      ('tender_document_discovery_jobs', 'result_summary'),
      ('tender_document_analysis_jobs', 'normalized_result'),
      ('tender_document_analysis_jobs', 'result_applied'),
      ('tender_document_analysis_jobs', 'reused_job_id'),
      ('tender_document_evidence', 'normalized_value'),
      ('tender_document_evidence', 'requirement_status'),
      ('tenders', 'document_extraction_v2'),
      ('tenders', 'document_evidence_count')
  ) expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = expected.table_name
      and column_definition.column_name = expected.column_name
  );
  if v_missing_columns <> 0 then
    raise exception 'Document intelligence v2 is missing % columns',
      v_missing_columns;
  end if;

  select count(*) into v_current_versions
  from public.pipeline_versions
  where is_repository_current
    and (component, version_identifier) in (
      ('document_discovery', 'document-discovery-v2.0.0'),
      ('document_retrieval', 'document-retrieval-v2.0.0'),
      ('document_parsing', 'document-parsing-v2.0.0'),
      ('ai_extraction', 'tender-extraction-v2.0.0')
    );
  if v_current_versions <> 4 then
    raise exception 'Expected four repository-current document v2 versions';
  end if;

  if exists (
    select 1
    from public.pipeline_versions
    where component in (
      'document_discovery',
      'document_retrieval',
      'document_parsing',
      'ai_extraction'
    )
      and is_repository_current
    group by component
    having count(*) <> 1
  ) then
    raise exception 'A document pipeline component has multiple current versions';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tender_document_analysis_jobs'
      and policyname = 'users read own analysis jobs'
  ) then
    raise exception 'Existing analysis-job RLS policy was not preserved';
  end if;
end
$tests$;

rollback;

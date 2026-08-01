-- Current-source metadata reconciliation
--
-- Historical deployment manifests and migrations intentionally retain the
-- hashes of the bundles they described. This forward-only migration records
-- the canonical repository sources used for empty-project reconstruction.
-- It changes no application data, RLS policy, RPC signature, Storage object,
-- authentication behavior, or Edge Function runtime configuration.

begin;

update public.pipeline_versions
set
  content_sha256 =
    '6aa03c4e1c1d16a4b9bc456681e992ed586a5c38f3db9df216043c2ff82b8907',
  live_verification_status = 'repository_only',
  live_verified_at = null,
  metadata = metadata || jsonb_build_object(
    'baseline_reconciliation_migration',
    '202607290003',
    'current_shared_source_hash',
    'a82c9ab3da43532da40f4dec1865b28b50a1ed5c002490f16ef8a8fd27245140'
  )
where component = 'document_discovery'
  and version_identifier = 'document-discovery-v2.0.0'
  and is_repository_current;

update public.pipeline_versions
set
  content_sha256 =
    'a82c9ab3da43532da40f4dec1865b28b50a1ed5c002490f16ef8a8fd27245140',
  live_verification_status = 'repository_only',
  live_verified_at = null,
  metadata = metadata || jsonb_build_object(
    'baseline_reconciliation_migration',
    '202607290003',
    'current_archive_worker_hash',
    '4ce9e0c04e81769bb25b546775a9cf3eb0aa3845b67858d5cf70f99299ce9d5e'
  )
where component = 'document_retrieval'
  and version_identifier = 'document-retrieval-v2.0.0'
  and is_repository_current;

update public.pipeline_versions
set
  live_verification_status = 'repository_only',
  live_verified_at = null,
  metadata = metadata || jsonb_build_object(
    'baseline_reconciliation_migration',
    '202607290003',
    'current_performance_source_hash',
    '4696204f734d8a37bb8cd3dc8206bb57934081685cace18657049e8009fc0f71'
  )
where component = 'document_parsing'
  and version_identifier = 'document-chunking-v3.1.0'
  and is_repository_current;

update public.pipeline_versions
set
  content_sha256 =
    '355fb054bf0b36f6e86e4e59426564aff1a4d9bfec6bf98b8953635f07af3459',
  live_verification_status = 'repository_only',
  live_verified_at = null,
  metadata = metadata || jsonb_build_object(
    'baseline_reconciliation_migration',
    '202607290003',
    'current_handler_hash',
    '273307c22ffe5ee7f35e7ad4ce38701d87f64b40d28d341562bc9745830b8392',
    'current_performance_source_hash',
    '4696204f734d8a37bb8cd3dc8206bb57934081685cace18657049e8009fc0f71',
    'deno_contract_test_hash',
    'e44c68dc7dca655350caf9e070983ee58d8fb4814a4826f9ba01dc322909395c',
    'sql_contract_test_hash',
    '0b22b810c4ee7589dade4f575080a2e324adb8e34220d598e0b61731d666e64f'
  )
where component = 'ai_extraction'
  and version_identifier = 'tender-extraction-v3.1.0'
  and is_repository_current;

do $verification$
declare
  v_reconciled_count integer;
begin
  select count(*)
  into v_reconciled_count
  from public.pipeline_versions
  where is_repository_current
    and component in (
      'document_discovery',
      'document_retrieval',
      'document_parsing',
      'ai_extraction'
    )
    and metadata ->> 'baseline_reconciliation_migration' = '202607290003';

  if v_reconciled_count <> 4 then
    raise exception
      'Current-source metadata reconciliation is incomplete: expected 4, found %',
      v_reconciled_count;
  end if;
end
$verification$;

commit;

-- Rollback:
--   Reapply the preceding metadata hashes from the historical migrations.
--   No application row, schema, RLS, Storage, or function rollback is needed.

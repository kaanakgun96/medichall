-- Document Intelligence v3 runtime compatibility metadata
--
-- The initial schema migration is unchanged. Supabase's server-side bundler
-- returned an internal error for the pdfjs npm dependency graph, so the same
-- pinned pdfjs-dist 4.10.38 parser is consumed through its compact modern-Deno
-- ESM build. This migration records the final deployable source and manifest
-- hashes. It changes no table, RPC, RLS, Storage, authentication, or data
-- contract.

begin;

update public.pipeline_versions
set
  content_sha256 =
    'c52549417ad319f3ad2add87ab57597164063e09aea7c09c03c7510483d797cf',
  live_verification_status = 'repository_only',
  live_verified_at = null,
  metadata = metadata || jsonb_build_object(
    'related_source_hash',
    '8cc9093646608470a2377a733cbae3ff3499aad55485eb5de177e428e58439d4',
    'manifest_hash',
    '1de7362946d9fab9b676489fb205208cd384edfed7923f8f18830b0ebaa986ed',
    'bootstrap_manifest_hash',
    '225ff44d2719b387c831bd5878e583679442715d0e2bd33b2f2ad4e5afa363ef',
    'pdf_parser',
    'pdfjs-dist@4.10.38 modern-Deno ESM',
    'runtime_compatibility_migration',
    '202607230005'
  )
where component = 'document_parsing'
  and version_identifier = 'document-chunking-v3.0.0';

update public.pipeline_versions
set
  content_sha256 =
    '24a8ee04fb054e8ed1786f7bd2bbaf8b10743d722c93b993b886946bea735e6c',
  live_verification_status = 'repository_only',
  live_verified_at = null,
  metadata = metadata || jsonb_build_object(
    'manifest_hash',
    '1de7362946d9fab9b676489fb205208cd384edfed7923f8f18830b0ebaa986ed',
    'bootstrap_manifest_hash',
    '225ff44d2719b387c831bd5878e583679442715d0e2bd33b2f2ad4e5afa363ef',
    'runtime_compatibility_migration',
    '202607230005'
  )
where component = 'ai_extraction'
  and version_identifier = 'tender-extraction-v3.0.0';

do $verification$
begin
  if (
    select count(*)
    from public.pipeline_versions
    where is_repository_current
      and (component, content_sha256) in (
        (
          'document_parsing',
          'c52549417ad319f3ad2add87ab57597164063e09aea7c09c03c7510483d797cf'
        ),
        (
          'ai_extraction',
          '24a8ee04fb054e8ed1786f7bd2bbaf8b10743d722c93b993b886946bea735e6c'
        )
      )
  ) <> 2 then
    raise exception 'Document Intelligence v3 runtime metadata is incomplete';
  end if;
end
$verification$;

commit;

-- Rollback:
--   Redeploy the preceding function bundle and restore the preceding
--   repository source/manifest hashes. No schema or production-row rollback
--   is required because this migration changes version metadata only.

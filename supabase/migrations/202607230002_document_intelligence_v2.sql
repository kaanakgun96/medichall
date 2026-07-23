-- MedicHall document intelligence v2.
--
-- Additive only: legacy tender/document/job fields and RPC signatures remain
-- unchanged. The new columns retain source/resolved URL provenance, bounded
-- discovery diagnostics, normalized extraction output, and evidence metadata.

begin;

alter table public.tender_documents
  add column if not exists source_url text,
  add column if not exists resolved_url text,
  add column if not exists discovery_source text,
  add column if not exists discovery_score integer,
  add column if not exists discovery_confidence text,
  add column if not exists last_http_status integer,
  add column if not exists redirect_count integer;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_documents_discovery_score_check'
  ) then
    alter table public.tender_documents
      add constraint tender_documents_discovery_score_check
      check (discovery_score is null or discovery_score between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_documents_discovery_confidence_check'
  ) then
    alter table public.tender_documents
      add constraint tender_documents_discovery_confidence_check
      check (
        discovery_confidence is null
        or discovery_confidence in ('low', 'medium', 'high')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_documents_http_status_check'
  ) then
    alter table public.tender_documents
      add constraint tender_documents_http_status_check
      check (
        last_http_status is null
        or last_http_status between 100 and 599
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_documents_redirect_count_check'
  ) then
    alter table public.tender_documents
      add constraint tender_documents_redirect_count_check
      check (redirect_count is null or redirect_count between 0 and 5);
  end if;
end
$constraints$;

create index if not exists tender_documents_discovery_priority_idx
  on public.tender_documents (
    tender_id,
    discovery_score desc nulls last,
    discovered_at desc
  )
  where is_active = true;

alter table public.tender_document_discovery_jobs
  add column if not exists restricted_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists maximum_depth integer not null default 0,
  add column if not exists duration_ms bigint,
  add column if not exists result_summary jsonb not null default '{}'::jsonb;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_discovery_jobs_v2_counts_check'
  ) then
    alter table public.tender_document_discovery_jobs
      add constraint tender_discovery_jobs_v2_counts_check
      check (
        restricted_count >= 0
        and failure_count >= 0
        and maximum_depth between 0 and 2
        and (duration_ms is null or duration_ms >= 0)
      );
  end if;
end
$constraints$;

alter table public.tender_document_analysis_jobs
  add column if not exists normalized_result jsonb not null default '{}'::jsonb,
  add column if not exists result_applied boolean,
  add column if not exists superseded_by_confidence boolean not null default false,
  add column if not exists reused_job_id bigint
    references public.tender_document_analysis_jobs(id) on delete set null;

create index if not exists tender_analysis_jobs_idempotency_idx
  on public.tender_document_analysis_jobs (
    tender_id,
    company_id,
    input_snapshot_hash,
    extraction_version,
    completed_at desc
  )
  where status in ('completed', 'partial')
    and input_snapshot_hash is not null;

alter table public.tender_document_evidence
  add column if not exists normalized_value text,
  add column if not exists requirement_status text,
  add column if not exists source_language text,
  add column if not exists extraction_version text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_evidence_requirement_status_check'
  ) then
    alter table public.tender_document_evidence
      add constraint tender_evidence_requirement_status_check
      check (
        requirement_status is null
        or requirement_status in ('mandatory', 'descriptive', 'unknown')
      );
  end if;
end
$constraints$;

create index if not exists tender_document_evidence_version_idx
  on public.tender_document_evidence (
    tender_id,
    extraction_version,
    confidence_score desc
  );

alter table public.tenders
  add column if not exists document_extraction_v2 jsonb
    not null default '{}'::jsonb,
  add column if not exists document_evidence_count integer
    not null default 0;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenders_document_evidence_count_check'
  ) then
    alter table public.tenders
      add constraint tenders_document_evidence_count_check
      check (document_evidence_count >= 0);
  end if;
end
$constraints$;

-- Compatibility repair for the existing portal upload RPC. The live
-- definition referenced the nonexistent file_size column and a document_type
-- rejected by the existing constraint. The public signature and integer
-- return shape remain unchanged; authorization is tightened to the company
-- owner/admin path and registered storage objects are verified.
create or replace function public.register_uploaded_tender_documents(
  p_tender_id bigint,
  p_company_id bigint,
  p_files jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
  v_count integer := 0;
  v_changed integer := 0;
  v_url text;
  v_name text;
  v_path text;
  v_declared_size bigint;
  v_storage_size bigint;
begin
  if not (
    public.is_admin()
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  if not exists (
    select 1 from public.tenders where id = p_tender_id
  ) then
    raise exception 'Tender not found';
  end if;

  if jsonb_typeof(p_files) <> 'array'
    or jsonb_array_length(p_files) not between 1 and 8
  then
    raise exception 'Provide 1-8 files';
  end if;

  for v_file in
    select value from jsonb_array_elements(p_files)
  loop
    v_url := trim(coalesce(v_file ->> 'file_url', ''));
    v_name := left(
      trim(coalesce(v_file ->> 'file_name', 'document.pdf')),
      200
    );
    v_path := substring(
      v_url from
      '/storage/v1/object/public/tender-documents/(user-uploads/[^?#]+)$'
    );
    v_declared_size := case
      when coalesce(v_file ->> 'file_size', '') ~ '^[0-9]+$'
        then (v_file ->> 'file_size')::bigint
      else null
    end;

    if v_url !~ '^https://'
      or v_name !~* '[.]pdf$'
      or v_path is null
      or v_path not like (
        'user-uploads/' || p_tender_id || '/' || p_company_id || '-%'
      )
    then
      continue;
    end if;

    select nullif(storage_object.metadata ->> 'size', '')::bigint
    into v_storage_size
    from storage.objects storage_object
    where storage_object.bucket_id = 'tender-documents'
      and storage_object.name = v_path
    limit 1;

    if v_storage_size is null
      or v_storage_size > 20 * 1024 * 1024
      or (
        v_declared_size is not null
        and v_declared_size <> v_storage_size
      )
    then
      continue;
    end if;

    insert into public.tender_documents (
      tender_id,
      title,
      file_name,
      file_url,
      source_url,
      resolved_url,
      mime_type,
      document_type,
      file_size_bytes,
      is_active,
      access_status,
      access_checked_at,
      access_source,
      source_confidence,
      uploaded_by,
      uploaded_at,
      upload_provenance,
      created_at,
      updated_at
    )
    values (
      p_tender_id,
      v_name,
      v_name,
      v_url,
      v_url,
      v_url,
      'application/pdf',
      'other',
      v_storage_size,
      true,
      'public_direct_download',
      now(),
      'authorized_upload',
      'authorized_upload',
      auth.uid(),
      now(),
      jsonb_build_object(
        'method', 'partner_portal_upload',
        'company_id', p_company_id,
        'storage_path', v_path
      ),
      now(),
      now()
    )
    on conflict (tender_id, file_url) do update set
      title = excluded.title,
      file_name = excluded.file_name,
      file_size_bytes = excluded.file_size_bytes,
      source_url = excluded.source_url,
      resolved_url = excluded.resolved_url,
      is_active = true,
      access_status = excluded.access_status,
      access_checked_at = excluded.access_checked_at,
      access_source = excluded.access_source,
      source_confidence = excluded.source_confidence,
      uploaded_by = excluded.uploaded_by,
      uploaded_at = excluded.uploaded_at,
      upload_provenance = excluded.upload_provenance,
      updated_at = now();

    get diagnostics v_changed = row_count;
    v_count := v_count + v_changed;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.register_uploaded_tender_documents(
  bigint,
  bigint,
  jsonb
) from public, anon;
grant execute on function public.register_uploaded_tender_documents(
  bigint,
  bigint,
  jsonb
) to authenticated, service_role;

-- Version lineage only. Existing extraction rows remain unchanged and are not
-- falsely stamped as v2.
update public.pipeline_versions
set is_repository_current = false
where component in (
  'document_discovery',
  'document_retrieval',
  'document_parsing',
  'ai_extraction'
)
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
    'document_discovery',
    'document-discovery-v2.0.0',
    '2.0.0',
    'a71fddc68c08f25861d0fea9809de9f98f127eccabb796436fa77a5154990823',
    'supabase/functions/tender-attachment-discovery/index.ts',
    'supabase/migrations/202607230002_document_intelligence_v2.sql',
    true,
    'repository_only',
    '{"bounded":{"pages":8,"depth":2,"links":180,"redirects":5,"crawl_timeout_ms":45000},"source_and_resolved_urls":true}'::jsonb
  ),
  (
    'document_retrieval',
    'document-retrieval-v2.0.0',
    '2.0.0',
    '98f5ece0ec16612bb1378cacd19668b3f112c5599bbf9f5ed04bcbc62e4e3769',
    'supabase/functions/_shared/attachment-discovery.ts',
    'supabase/migrations/202607230002_document_intelligence_v2.sql',
    true,
    'repository_only',
    '{"public_only":true,"manual_redirect_validation":true,"restricted_access_is_not_bypassed":true}'::jsonb
  ),
  (
    'document_parsing',
    'document-parsing-v2.0.0',
    '2.0.0',
    '49b2e9210b37c001877f113c15c802dbe122d51b309ee896c099145f44e3daa8',
    'supabase/functions/tender-document-engine/index.ts',
    'supabase/migrations/202607230002_document_intelligence_v2.sql',
    true,
    'repository_only',
    '{"formats":["pdf","txt","csv","docx","xls","xlsx"],"limits":{"documents":6,"file_bytes":20971520,"text_characters":200000}}'::jsonb
  ),
  (
    'ai_extraction',
    'tender-extraction-v2.0.0',
    '2.0.0',
    '3a1454c1b56964a01c1c9c1507b770039a2ba6e643b80a11353dfaacd2524918',
    'supabase/functions/_shared/document-extraction-v2.ts',
    'supabase/migrations/202607230002_document_intelligence_v2.sql',
    true,
    'repository_only',
    '{"prompt_schema":"medichall-tender-facts-v2","provider":"Anthropic","higher_confidence_result_preserved":true}'::jsonb
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
--   1. Undeploy the v2 discovery/document-engine bundles.
--   2. Mark the four v2 pipeline_versions rows non-current and restore the
--      Phase 0 rows as repository-current.
--   3. Leave additive columns and historical evidence in place. Dropping them
--      is intentionally not part of the production rollback.

-- MedicHall Universal Tender Import v1
--
-- Adds a private, company-scoped import envelope around the existing
-- document-discovery, archive, Document Intelligence v3.1, evidence,
-- progress, retry, lot-matching, and notification services.

begin;

do $preflight$
declare
  required_relation text;
  required_relations constant text[] := array[
    'public.companies',
    'public.tenders',
    'public.tender_documents',
    'public.tender_document_discovery_jobs',
    'public.tender_archive_jobs',
    'public.tender_document_analysis_jobs',
    'public.tender_document_evidence',
    'public.matchmaking_notifications',
    'storage.buckets',
    'storage.objects'
  ];
  required_signature text;
  required_signatures constant text[] := array[
    'public.queue_tender_document_discovery(bigint,bigint)',
    'public.get_tender_document_discovery_status(bigint,bigint)',
    'public.queue_tender_archive_jobs(bigint,bigint)',
    'public.get_tender_archive_status(bigint,bigint)',
    'public.queue_tender_document_analysis(bigint,bigint)',
    'public.get_tender_document_analysis_status(bigint,bigint)',
    'public.get_tender_document_analysis_progress_v3(bigint,bigint)',
    'public.is_admin()',
    'public.portal_add_notification(uuid,uuid,text,bigint,text,text,text,text,text,text,boolean,jsonb)'
  ];
begin
  foreach required_relation in array required_relations
  loop
    if to_regclass(required_relation) is null then
      raise exception 'Universal Tender Import dependency is missing: %',
        required_relation;
    end if;
  end loop;

  foreach required_signature in array required_signatures
  loop
    if to_regprocedure(required_signature) is null then
      raise exception 'Universal Tender Import RPC dependency is missing: %',
        required_signature;
    end if;
  end loop;
end
$preflight$;

create table if not exists public.tender_imports (
  id uuid primary key default gen_random_uuid(),
  tender_id bigint not null unique
    references public.tenders(id) on delete cascade,
  company_id bigint not null
    references public.companies(id) on delete cascade,
  requested_by uuid
    references auth.users(id) on delete set null,
  source_kind text not null
    check (source_kind in ('files', 'url')),
  source_url text,
  display_name text not null,
  status text not null default 'draft'
    check (status in (
      'draft',
      'uploading',
      'queued',
      'discovering',
      'extracting_archive',
      'analyzing',
      'completed',
      'partial',
      'failed',
      'cancelled'
    )),
  stage text not null default 'preparing_import',
  progress_percent integer not null default 0
    check (progress_percent between 0 and 100),
  file_count integer not null default 0
    check (file_count between 0 and 60),
  processed_file_count integer not null default 0
    check (processed_file_count between 0 and 60),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 20),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_kind = 'files' and source_url is null)
    or
    (
      source_kind = 'url'
      and source_url ~ '^https://'
      and length(source_url) <= 2048
    )
  )
);

create index if not exists tender_imports_company_created_idx
  on public.tender_imports(company_id, created_at desc);

create index if not exists tender_imports_active_idx
  on public.tender_imports(status, updated_at)
  where status in (
    'draft',
    'uploading',
    'queued',
    'discovering',
    'extracting_archive',
    'analyzing'
  );

alter table public.tender_documents
  add column if not exists storage_bucket text;

comment on column public.tender_documents.storage_bucket is
  'Private storage bucket for server-side document retrieval. Null keeps the existing public-URL retrieval contract.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'tender-imports',
  'tender-imports',
  false,
  31457280,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.tender_imports enable row level security;

revoke all on table public.tender_imports from public, anon;
grant select on table public.tender_imports to authenticated;
grant select, insert, update, delete on table public.tender_imports
to service_role;

drop policy if exists "owners read own tender imports"
  on public.tender_imports;
create policy "owners read own tender imports"
on public.tender_imports
for select to authenticated
using (
  public.is_admin()
  or requested_by = auth.uid()
  or exists (
    select 1
    from public.companies company
    where company.id = tender_imports.company_id
      and company.owner_id = auth.uid()
  )
);

drop policy if exists "admin manage tender imports"
  on public.tender_imports;
create policy "admin manage tender imports"
on public.tender_imports
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "owners read own imported tenders"
  on public.tenders;
create policy "owners read own imported tenders"
on public.tenders
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.tender_imports tender_import
    join public.companies company
      on company.id = tender_import.company_id
    where tender_import.tender_id = tenders.id
      and (
        tender_import.requested_by = auth.uid()
        or company.owner_id = auth.uid()
      )
  )
);

-- Existing public procurement documents remain visible to authenticated
-- partners. Documents that belong to a private import are visible only to
-- that import's company owner/requester or an administrator.
drop policy if exists "authenticated read tender documents"
  on public.tender_documents;
create policy "authenticated read tender documents"
on public.tender_documents
for select to authenticated
using (
  is_active = true
  and (
    public.is_admin()
    or not exists (
      select 1
      from public.tender_imports tender_import
      where tender_import.tender_id = tender_documents.tender_id
    )
    or exists (
      select 1
      from public.tender_imports tender_import
      join public.companies company
        on company.id = tender_import.company_id
      where tender_import.tender_id = tender_documents.tender_id
        and (
          tender_import.requested_by = auth.uid()
          or company.owner_id = auth.uid()
        )
    )
  )
);

drop policy if exists "owners upload private tender imports"
  on storage.objects;
create policy "owners upload private tender imports"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tender-imports'
  and exists (
    select 1
    from public.tender_imports tender_import
    join public.companies company
      on company.id = tender_import.company_id
    where company.id::text = split_part(name, '/', 1)
      and tender_import.id::text = split_part(name, '/', 2)
      and tender_import.company_id = company.id
      and tender_import.status = 'uploading'
      and (
        tender_import.requested_by = auth.uid()
        or company.owner_id = auth.uid()
      )
  )
);

drop policy if exists "owners read private tender imports"
  on storage.objects;
create policy "owners read private tender imports"
on storage.objects
for select to authenticated
using (
  bucket_id = 'tender-imports'
  and exists (
    select 1
    from public.tender_imports tender_import
    join public.companies company
      on company.id = tender_import.company_id
    where company.id::text = split_part(name, '/', 1)
      and tender_import.id::text = split_part(name, '/', 2)
      and tender_import.company_id = company.id
      and (
        tender_import.requested_by = auth.uid()
        or company.owner_id = auth.uid()
      )
  )
);

drop policy if exists "owners delete private tender imports"
  on storage.objects;
create policy "owners delete private tender imports"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'tender-imports'
  and exists (
    select 1
    from public.tender_imports tender_import
    join public.companies company
      on company.id = tender_import.company_id
    where company.id::text = split_part(name, '/', 1)
      and tender_import.id::text = split_part(name, '/', 2)
      and tender_import.company_id = company.id
      and (
        tender_import.requested_by = auth.uid()
        or company.owner_id = auth.uid()
      )
  )
);

create or replace function public.create_universal_tender_import(
  p_company_id bigint,
  p_source_kind text,
  p_display_name text,
  p_source_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  import_id uuid := gen_random_uuid();
  tender_id bigint;
  normalized_kind text := lower(trim(coalesce(p_source_kind, '')));
  normalized_name text := left(
    trim(coalesce(p_display_name, 'Imported tender')),
    200
  );
  normalized_url text := nullif(trim(p_source_url), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;
  if not (
    public.is_admin()
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;
  if normalized_kind not in ('files', 'url') then
    raise exception 'Import source must be files or url'
      using errcode = '22023';
  end if;
  if normalized_name = '' then
    raise exception 'Import name is required'
      using errcode = '22023';
  end if;
  if normalized_kind = 'url' and (
    normalized_url is null
    or normalized_url !~ '^https://'
    or length(normalized_url) > 2048
  ) then
    raise exception 'A public HTTPS tender URL is required'
      using errcode = '22023';
  end if;
  if normalized_kind = 'files' then
    normalized_url := null;
  end if;

  insert into public.tenders (
    source,
    source_notice_id,
    title,
    source_url,
    raw_payload,
    status
  )
  values (
    'PORTAL_IMPORT',
    import_id::text,
    normalized_name,
    normalized_url,
    jsonb_build_object(
      'import_id', import_id,
      'company_id', p_company_id,
      'source_kind', normalized_kind
    ),
    'draft'
  )
  returning id into tender_id;

  insert into public.tender_imports (
    id,
    tender_id,
    company_id,
    requested_by,
    source_kind,
    source_url,
    display_name,
    status,
    stage
  )
  values (
    import_id,
    tender_id,
    p_company_id,
    auth.uid(),
    normalized_kind,
    normalized_url,
    normalized_name,
    case when normalized_kind = 'files' then 'uploading' else 'queued' end,
    case
      when normalized_kind = 'files' then 'uploading_documents'
      else 'waiting_for_discovery'
    end
  );

  return jsonb_build_object(
    'import_id', import_id,
    'tender_id', tender_id,
    'company_id', p_company_id,
    'source_kind', normalized_kind,
    'status', case
      when normalized_kind = 'files' then 'uploading'
      else 'queued'
    end
  );
end;
$function$;

revoke all on function public.create_universal_tender_import(
  bigint,
  text,
  text,
  text
) from public, anon;
grant execute on function public.create_universal_tender_import(
  bigint,
  text,
  text,
  text
) to authenticated, service_role;

create or replace function public.register_universal_tender_documents(
  p_import_id uuid,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $function$
declare
  tender_import public.tender_imports;
  file_value jsonb;
  file_name text;
  storage_path text;
  extension text;
  detected_mime text;
  stored_mime text;
  declared_size bigint;
  stored_size bigint;
  maximum_size bigint;
  total_size bigint := 0;
  registered_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  select *
  into tender_import
  from public.tender_imports
  where id = p_import_id
  for update;

  if tender_import.id is null then
    raise exception 'Tender import not found'
      using errcode = 'P0002';
  end if;
  if tender_import.source_kind <> 'files' then
    raise exception 'This import expects a public URL'
      using errcode = '22023';
  end if;
  if tender_import.status <> 'uploading' then
    raise exception 'This import is no longer accepting uploads'
      using errcode = '55000';
  end if;
  if not (
    public.is_admin()
    or tender_import.requested_by = auth.uid()
    or exists (
      select 1
      from public.companies company
      where company.id = tender_import.company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_files) <> 'array'
    or jsonb_array_length(p_files) not between 1 and 6
  then
    raise exception 'Provide 1-6 supported documents'
      using errcode = '22023';
  end if;

  for file_value in
    select value
    from jsonb_array_elements(p_files)
  loop
    file_name := left(
      trim(coalesce(file_value ->> 'file_name', '')),
      200
    );
    storage_path := trim(coalesce(file_value ->> 'storage_path', ''));
    extension := lower(substring(file_name from '[.]([^.]+)$'));
    declared_size := case
      when coalesce(file_value ->> 'file_size', '') ~ '^[0-9]+$'
        then (file_value ->> 'file_size')::bigint
      else null
    end;

    detected_mime := case extension
      when 'pdf' then 'application/pdf'
      when 'docx' then
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      when 'xlsx' then
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      when 'csv' then 'text/csv'
      when 'zip' then 'application/zip'
      else null
    end;
    maximum_size := case
      when extension = 'zip' then 30 * 1024 * 1024
      else 25 * 1024 * 1024
    end;

    if file_name = ''
      or detected_mime is null
      or storage_path not like (
        tender_import.company_id || '/' || tender_import.id || '/%'
      )
      or storage_path like '%..%'
      or storage_path like '%//%'
    then
      raise exception 'Invalid or unsupported uploaded document: %',
        coalesce(nullif(file_name, ''), 'unnamed file')
        using errcode = '22023';
    end if;

    select
      nullif(storage_object.metadata ->> 'size', '')::bigint,
      lower(nullif(storage_object.metadata ->> 'mimetype', ''))
    into stored_size, stored_mime
    from storage.objects storage_object
    where storage_object.bucket_id = 'tender-imports'
      and storage_object.name = storage_path
    limit 1;

    if stored_size is null
      or stored_size <= 0
      or stored_size > maximum_size
      or (
        declared_size is not null
        and declared_size <> stored_size
      )
    then
      raise exception 'Uploaded document size is invalid: %', file_name
        using errcode = '22023';
    end if;
    if stored_mime is not null
      and stored_mime not in (
        detected_mime,
        'application/octet-stream',
        'application/zip',
        'application/x-zip-compressed',
        'text/plain',
        'application/vnd.ms-excel'
      )
    then
      raise exception 'Uploaded document type does not match its file name: %',
        file_name
        using errcode = '22023';
    end if;

    total_size := total_size + stored_size;
    if total_size > 100 * 1024 * 1024 then
      raise exception 'The import exceeds the 100 MB total limit'
        using errcode = '22023';
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
      storage_bucket,
      storage_path,
      archive_processing_status,
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
      tender_import.tender_id,
      file_name,
      file_name,
      'storage://tender-imports/' || storage_path,
      null,
      null,
      detected_mime,
      'other',
      stored_size,
      true,
      'tender-imports',
      storage_path,
      case when extension = 'zip' then 'pending' else 'not_applicable' end,
      'uploaded_private',
      now(),
      'authorized_import_upload',
      'authorized_upload',
      auth.uid(),
      now(),
      jsonb_build_object(
        'method', 'universal_tender_import',
        'import_id', tender_import.id,
        'company_id', tender_import.company_id,
        'storage_bucket', 'tender-imports',
        'storage_path', storage_path
      ),
      now(),
      now()
    )
    on conflict (tender_id, file_url) do update set
      title = excluded.title,
      file_name = excluded.file_name,
      mime_type = excluded.mime_type,
      file_size_bytes = excluded.file_size_bytes,
      is_active = true,
      storage_bucket = excluded.storage_bucket,
      storage_path = excluded.storage_path,
      archive_processing_status = excluded.archive_processing_status,
      access_status = excluded.access_status,
      access_checked_at = excluded.access_checked_at,
      access_source = excluded.access_source,
      source_confidence = excluded.source_confidence,
      uploaded_by = excluded.uploaded_by,
      uploaded_at = excluded.uploaded_at,
      upload_provenance = excluded.upload_provenance,
      updated_at = now();

    registered_count := registered_count + 1;
  end loop;

  select
    count(*),
    coalesce(sum(document.file_size_bytes), 0)
  into registered_count, total_size
  from public.tender_documents document
  where document.tender_id = tender_import.tender_id
    and document.is_active
    and document.storage_bucket = 'tender-imports';

  if registered_count > 6 or total_size > 100 * 1024 * 1024 then
    raise exception 'The import exceeds its document or total byte limit'
      using errcode = '22023';
  end if;

  update public.tender_imports
  set
    status = 'queued',
    stage = 'waiting_for_processing',
    progress_percent = 5,
    file_count = registered_count,
    error_message = null,
    updated_at = now()
  where id = tender_import.id;

  return jsonb_build_object(
    'import_id', tender_import.id,
    'tender_id', tender_import.tender_id,
    'registered_count', registered_count,
    'status', 'queued'
  );
end;
$function$;

revoke all on function public.register_universal_tender_documents(
  uuid,
  jsonb
) from public, anon;
grant execute on function public.register_universal_tender_documents(
  uuid,
  jsonb
) to authenticated, service_role;

create or replace function public.fail_universal_tender_import(
  p_import_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  tender_import public.tender_imports;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  select *
  into tender_import
  from public.tender_imports
  where id = p_import_id;

  if tender_import.id is null then
    raise exception 'Tender import not found'
      using errcode = 'P0002';
  end if;
  if not (
    public.is_admin()
    or tender_import.requested_by = auth.uid()
    or exists (
      select 1
      from public.companies company
      where company.id = tender_import.company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;
  if tender_import.status not in ('uploading', 'draft', 'queued', 'failed') then
    raise exception 'A processing import cannot be marked as an upload failure'
      using errcode = '55000';
  end if;

  update public.tender_imports
  set
    status = 'failed',
    stage = 'upload_failed',
    progress_percent = 100,
    error_message = left(
      trim(coalesce(p_error_message, 'Document upload could not be completed.')),
      500
    ),
    completed_at = now(),
    updated_at = now()
  where id = p_import_id;
end;
$function$;

revoke all on function public.fail_universal_tender_import(
  uuid,
  text
) from public, anon;
grant execute on function public.fail_universal_tender_import(
  uuid,
  text
) to authenticated, service_role;

create or replace function public.get_universal_tender_imports(
  p_company_id bigint,
  p_import_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;
  if not (
    public.is_admin()
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(import_row) order by import_row.created_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      tender_import.id,
      tender_import.tender_id,
      tender_import.company_id,
      tender_import.source_kind,
      tender_import.source_url,
      tender_import.display_name,
      tender_import.status,
      tender_import.stage,
      tender_import.progress_percent,
      tender_import.file_count,
      tender_import.processed_file_count,
      tender_import.attempt_count,
      tender_import.error_message,
      tender_import.started_at,
      tender_import.completed_at,
      tender_import.created_at,
      tender_import.updated_at,
      tender.title,
      tender.buyer_name,
      tender.country_name,
      tender.cpv_codes,
      tender.deadline_at,
      tender.document_analysis_status,
      tender.document_confidence_score,
      tender.data_completeness_score,
      tender.analyzed_document_count,
      tender.document_evidence_count,
      jsonb_array_length(coalesce(tender.extracted_products, '[]'::jsonb))
        as products_extracted,
      jsonb_array_length(coalesce(tender.ai_lots, '[]'::jsonb))
        as lots_extracted,
      coalesce(document_summary.document_count, 0)::integer
        as document_count,
      coalesce(document_summary.documents, '[]'::jsonb)
        as documents,
      discovery_job.status as discovery_status,
      discovery_job.documents_found,
      archive_summary.archive_status,
      archive_summary.archive_files_created,
      analysis_job.id as analysis_job_id,
      analysis_job.status as analysis_status,
      analysis_job.progress_stage as analysis_stage,
      analysis_job.progress_percent as analysis_progress_percent,
      analysis_job.error_message as analysis_error_message
    from public.tender_imports tender_import
    join public.tenders tender
      on tender.id = tender_import.tender_id
    left join lateral (
      select
        count(*)::integer as document_count,
        jsonb_agg(
          jsonb_build_object(
            'id', document.id,
            'file_name', document.file_name,
            'mime_type', document.mime_type,
            'file_size_bytes', document.file_size_bytes,
            'archive_processing_status', document.archive_processing_status,
            'extracted_from_archive', document.extracted_from_archive
          )
          order by document.id
        ) as documents
      from public.tender_documents document
      where document.tender_id = tender_import.tender_id
        and document.is_active
    ) document_summary on true
    left join lateral (
      select
        discovery.status,
        discovery.documents_found
      from public.tender_document_discovery_jobs discovery
      where discovery.tender_id = tender_import.tender_id
        and discovery.company_id = tender_import.company_id
      order by discovery.created_at desc
      limit 1
    ) discovery_job on true
    left join lateral (
      select
        case
          when count(*) = 0 then null
          when count(*) filter (
            where archive_job.status in ('queued', 'processing')
          ) > 0 then 'processing'
          when count(*) filter (where archive_job.status = 'failed') > 0
            and coalesce(sum(archive_job.files_created), 0) = 0
            then 'failed'
          when count(*) filter (where archive_job.status = 'partial') > 0
            or count(*) filter (where archive_job.status = 'failed') > 0
            then 'partial'
          else 'completed'
        end as archive_status,
        coalesce(sum(archive_job.files_created), 0)::integer
          as archive_files_created
      from public.tender_archive_jobs archive_job
      where archive_job.tender_id = tender_import.tender_id
        and archive_job.company_id = tender_import.company_id
    ) archive_summary on true
    left join lateral (
      select
        analysis.id,
        analysis.status,
        analysis.progress_stage,
        analysis.progress_percent,
        analysis.error_message
      from public.tender_document_analysis_jobs analysis
      where analysis.tender_id = tender_import.tender_id
        and analysis.company_id = tender_import.company_id
      order by analysis.created_at desc
      limit 1
    ) analysis_job on true
    where tender_import.company_id = p_company_id
      and (
        p_import_id is null
        or tender_import.id = p_import_id
      )
    order by tender_import.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) import_row;

  return result;
end;
$function$;

revoke all on function public.get_universal_tender_imports(
  bigint,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_universal_tender_imports(
  bigint,
  uuid,
  integer
) to authenticated, service_role;

create or replace function public.sync_universal_tender_import_analysis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  tender_import public.tender_imports;
  company_name text;
  terminal_status text;
begin
  select *
  into tender_import
  from public.tender_imports
  where tender_id = new.tender_id;

  if tender_import.id is null then
    return new;
  end if;

  terminal_status := case
    when new.status = 'completed' then 'completed'
    when new.status = 'partial' then 'partial'
    when new.status = 'failed' then 'failed'
    else null
  end;

  update public.tender_imports
  set
    status = coalesce(terminal_status, 'analyzing'),
    stage = case
      when new.status = 'completed' then 'complete'
      when new.status = 'partial' then 'complete_with_warnings'
      when new.status = 'failed' then 'analysis_failed'
      else coalesce(nullif(new.progress_stage, ''), 'analyzing_documents')
    end,
    progress_percent = case
      when terminal_status is not null then 100
      else greatest(
        tender_import.progress_percent,
        least(99, coalesce(new.progress_percent, 70))
      )
    end,
    processed_file_count = case
      when terminal_status is not null
        then greatest(
          tender_import.processed_file_count,
          coalesce(cardinality(new.selected_document_ids), 0)
        )
      else tender_import.processed_file_count
    end,
    error_message = case
      when new.status = 'failed' then new.error_message
      else null
    end,
    completed_at = case
      when terminal_status is not null
        then coalesce(new.completed_at, now())
      else null
    end,
    updated_at = now()
  where id = tender_import.id;

  if terminal_status is not null
    and (
      tg_op = 'INSERT'
      or old.status is distinct from new.status
    )
  then
    select company.name
    into company_name
    from public.companies company
    where company.id = tender_import.company_id;

    perform public.portal_add_notification(
      tender_import.requested_by,
      tender_import.requested_by,
      'tender_import',
      tender_import.tender_id,
      'tender_import_' || terminal_status,
      case terminal_status
        when 'completed' then 'Tender import ready'
        when 'partial' then 'Tender import completed with warnings'
        else 'Tender import needs attention'
      end,
      case terminal_status
        when 'completed' then
          tender_import.display_name || ' is ready to review.'
        when 'partial' then
          tender_import.display_name ||
          ' was analyzed, but some information could not be verified.'
        else
          tender_import.display_name ||
          ' could not be analyzed. You can retry the import.'
      end,
      company_name,
      'tender-import:' || tender_import.id || ':' || new.id || ':' ||
        terminal_status,
      '/portal.html#tender-import=' || tender_import.id,
      terminal_status = 'failed',
      jsonb_build_object(
        'import_id', tender_import.id,
        'tender_id', tender_import.tender_id,
        'analysis_job_id', new.id,
        'status', terminal_status
      )
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_universal_tender_import_analysis()
from public, anon, authenticated;

drop trigger if exists sync_universal_tender_import_analysis
  on public.tender_document_analysis_jobs;
create trigger sync_universal_tender_import_analysis
after insert or update of
  status,
  progress_stage,
  progress_percent,
  error_message,
  completed_at
on public.tender_document_analysis_jobs
for each row
execute function public.sync_universal_tender_import_analysis();

notify pgrst, 'reload schema';

commit;

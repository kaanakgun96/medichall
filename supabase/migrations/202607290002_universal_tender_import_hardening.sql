-- Universal Tender Import blocker remediation and hardening.
--
-- This migration is additive and idempotent. Rolling it back requires first
-- removing imports created through the six-argument idempotent RPC, then
-- dropping the new indexes/columns/functions and restoring the three Storage
-- policies. The two document access status rows are shared reference data and
-- must not be removed while tender_documents rows reference them.

begin;

insert into public.document_access_statuses (
  code,
  access_class,
  description,
  manual_action_required
)
values
  (
    'uploaded_private',
    'processed',
    'A company-authorized private document was uploaded and registered',
    false
  ),
  (
    'validated_private_upload',
    'processed',
    'A private upload passed server-side format and archive validation',
    false
  )
on conflict (code) do nothing;

alter table public.tender_imports
  add column if not exists idempotency_key text,
  add column if not exists source_fingerprint text,
  add column if not exists idempotency_expires_at timestamptz,
  add column if not exists retry_of_import_id uuid
    references public.tender_imports(id) on delete set null;

update public.tender_imports
set
  idempotency_key = coalesce(
    idempotency_key,
    'legacy:' || id::text
  ),
  source_fingerprint = coalesce(
    source_fingerprint,
    encode(digest('legacy:' || id::text, 'sha256'), 'hex')
  ),
  idempotency_expires_at = coalesce(
    idempotency_expires_at,
    created_at + interval '30 days'
  )
where idempotency_key is null
  or source_fingerprint is null
  or idempotency_expires_at is null;

alter table public.tender_imports
  alter column idempotency_key set not null,
  alter column source_fingerprint set not null,
  alter column idempotency_expires_at set not null;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tender_imports'::regclass
      and conname = 'tender_imports_idempotency_key_format'
  ) then
    alter table public.tender_imports
      add constraint tender_imports_idempotency_key_format
      check (
        length(idempotency_key) between 8 and 160
        and idempotency_key !~ '[[:cntrl:]]'
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tender_imports'::regclass
      and conname = 'tender_imports_source_fingerprint_format'
  ) then
    alter table public.tender_imports
      add constraint tender_imports_source_fingerprint_format
      check (source_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
end
$constraints$;

create unique index if not exists tender_imports_company_idempotency_unique
  on public.tender_imports(company_id, idempotency_key);

create unique index if not exists tender_imports_company_source_unique
  on public.tender_imports(company_id, source_kind, source_fingerprint);

comment on column public.tender_imports.idempotency_key is
  'Caller operation key. Replay is guaranteed for at least 30 days and remains durable while the import record exists.';
comment on column public.tender_imports.source_fingerprint is
  'SHA-256 of the normalized URL or the order-independent uploaded file hash set.';
comment on column public.tender_imports.idempotency_expires_at is
  'Minimum replay-retention boundary. Records are not automatically deleted at this time.';

-- Remove PostgreSQL default table mutation grants before restoring the
-- intentionally narrow read surface. All mutations are RPC/service-only.
revoke all on table public.tender_imports
from public, anon, authenticated;
grant select on table public.tender_imports to authenticated;
grant select, insert, update, delete on table public.tender_imports
to service_role;

-- Every policy explicitly references storage.objects.name. The path must be
-- <company-id>/<import-uuid>/<non-empty relative object path>.
drop policy if exists "owners upload private tender imports"
  on storage.objects;
create policy "owners upload private tender imports"
on storage.objects
for insert to authenticated
with check (
  storage.objects.bucket_id = 'tender-imports'
  and storage.objects.name ~
    '^[0-9]+/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[^/].*$'
  and storage.objects.name !~ '(^|/)[.][.]?(/|$)'
  and storage.objects.name !~ '//'
  and position(chr(92) in storage.objects.name) = 0
  and exists (
    select 1
    from public.tender_imports import_record
    join public.companies import_company
      on import_company.id = import_record.company_id
    where import_record.company_id::text =
        split_part(storage.objects.name, '/', 1)
      and import_record.id::text =
        lower(split_part(storage.objects.name, '/', 2))
      and (
        public.is_admin()
        or (
          import_record.status = 'uploading'
          and (
            import_record.requested_by = auth.uid()
            or import_company.owner_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists "owners read private tender imports"
  on storage.objects;
create policy "owners read private tender imports"
on storage.objects
for select to authenticated
using (
  storage.objects.bucket_id = 'tender-imports'
  and storage.objects.name ~
    '^[0-9]+/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[^/].*$'
  and storage.objects.name !~ '(^|/)[.][.]?(/|$)'
  and storage.objects.name !~ '//'
  and position(chr(92) in storage.objects.name) = 0
  and exists (
    select 1
    from public.tender_imports import_record
    join public.companies import_company
      on import_company.id = import_record.company_id
    where import_record.company_id::text =
        split_part(storage.objects.name, '/', 1)
      and import_record.id::text =
        lower(split_part(storage.objects.name, '/', 2))
      and (
        public.is_admin()
        or import_record.requested_by = auth.uid()
        or import_company.owner_id = auth.uid()
      )
  )
);

drop policy if exists "owners delete private tender imports"
  on storage.objects;
create policy "owners delete private tender imports"
on storage.objects
for delete to authenticated
using (
  storage.objects.bucket_id = 'tender-imports'
  and storage.objects.name ~
    '^[0-9]+/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[^/].*$'
  and storage.objects.name !~ '(^|/)[.][.]?(/|$)'
  and storage.objects.name !~ '//'
  and position(chr(92) in storage.objects.name) = 0
  and exists (
    select 1
    from public.tender_imports import_record
    join public.companies import_company
      on import_company.id = import_record.company_id
    where import_record.company_id::text =
        split_part(storage.objects.name, '/', 1)
      and import_record.id::text =
        lower(split_part(storage.objects.name, '/', 2))
      and (
        public.is_admin()
        or import_record.requested_by = auth.uid()
        or import_company.owner_id = auth.uid()
      )
  )
  and (
    public.is_admin()
    or not exists (
      select 1
      from public.tender_documents document
      where document.storage_bucket = 'tender-imports'
        and document.storage_path = storage.objects.name
        and document.is_active
    )
  )
);

create or replace function public.normalize_tender_import_source_url(
  p_url text
)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $function$
declare
  clean_url text := split_part(trim(p_url), '#', 1);
  authority text;
  suffix text;
  path_part text;
  query_part text;
  normalized_query text;
begin
  if clean_url ~ '[[:cntrl:][:space:]]'
    or clean_url !~* '^https://[^/?#]+(?:[/?][^#]*)?$'
  then
    raise exception 'A public HTTPS tender URL is required'
      using errcode = '22023';
  end if;
  authority := lower(substring(clean_url from '^https://([^/?#]+)'));
  if authority like '%@%' then
    raise exception 'URL credentials are not permitted'
      using errcode = '22023';
  end if;
  if (
    authority like '[%'
    and authority !~ '^\[[0-9a-fA-F:.]+\](?::443)?$'
  ) or (
    authority not like '[%'
    and (
      authority !~ '^[a-z0-9.-]+(:443)?$'
      or regexp_replace(authority, ':443$', '') like '%..%'
    )
  ) then
    raise exception 'A valid HTTPS host on port 443 is required'
      using errcode = '22023';
  end if;
  authority := regexp_replace(authority, ':443$', '');
  suffix := substring(clean_url from '^https://[^/?#]+(.*)$');
  path_part := split_part(coalesce(suffix, ''), '?', 1);
  if path_part <> '/' then
    path_part := regexp_replace(path_part, '/+$', '');
  end if;
  if path_part = '/' then path_part := ''; end if;
  query_part := case
    when position('?' in coalesce(suffix, '')) > 0
      then substring(suffix from position('?' in suffix) + 1)
    else null
  end;
  select string_agg(parameter, '&' order by lower(parameter), parameter)
  into normalized_query
  from unnest(string_to_array(coalesce(query_part, ''), '&')) parameter
  where parameter <> ''
    and lower(split_part(parameter, '=', 1)) not in (
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'ref',
      'source',
      'utm_campaign',
      'utm_content',
      'utm_medium',
      'utm_source',
      'utm_term'
    )
    and lower(split_part(parameter, '=', 1)) not like 'utm\_%' escape '\';
  return 'https://' || authority || coalesce(path_part, '') ||
    case
      when normalized_query is null then ''
      else '?' || normalized_query
    end;
end;
$function$;

revoke all on function public.normalize_tender_import_source_url(text)
from public, anon, authenticated;
grant execute on function public.normalize_tender_import_source_url(text)
to service_role;

create or replace function public.create_universal_tender_import(
  p_company_id bigint,
  p_source_kind text,
  p_display_name text,
  p_source_url text,
  p_idempotency_key text,
  p_source_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  import_id uuid := gen_random_uuid();
  tender_id bigint;
  existing_import public.tender_imports;
  idempotency_import public.tender_imports;
  source_import public.tender_imports;
  normalized_kind text := lower(trim(coalesce(p_source_kind, '')));
  normalized_name text := left(
    trim(coalesce(p_display_name, 'Imported tender')),
    200
  );
  normalized_url text := nullif(trim(p_source_url), '');
  normalized_key text := left(trim(coalesce(p_idempotency_key, '')), 160);
  normalized_fingerprint text := lower(
    trim(coalesce(p_source_fingerprint, ''))
  );
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
  if length(normalized_key) < 8 then
    raise exception 'A valid idempotency key is required'
      using errcode = '22023';
  end if;

  if normalized_kind = 'url' then
    normalized_url := public.normalize_tender_import_source_url(
      normalized_url
    );
    normalized_fingerprint := encode(
      digest(normalized_url, 'sha256'),
      'hex'
    );
  else
    normalized_url := null;
    if normalized_fingerprint !~ '^[0-9a-f]{64}$' then
      raise exception 'A SHA-256 file-set fingerprint is required'
        using errcode = '22023';
    end if;
  end if;

  -- The advisory lock prevents the tender row from being created twice before
  -- either unique index becomes visible to a concurrent transaction.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_company_id::text || ':' || normalized_kind || ':' ||
        normalized_fingerprint,
      0
    )
  );

  select *
  into idempotency_import
  from public.tender_imports candidate
  where candidate.company_id = p_company_id
    and candidate.idempotency_key = normalized_key
  limit 1;

  select *
  into source_import
  from public.tender_imports candidate
  where candidate.company_id = p_company_id
    and candidate.source_kind = normalized_kind
    and candidate.source_fingerprint = normalized_fingerprint
  limit 1;

  if idempotency_import.id is not null
    and source_import.id is not null
    and idempotency_import.id <> source_import.id
  then
    raise exception 'Idempotency key conflicts with an existing source'
      using errcode = '22023';
  end if;
  if source_import.id is not null then
    existing_import := source_import;
  elsif idempotency_import.id is not null then
    if idempotency_import.source_kind <> normalized_kind
      or idempotency_import.source_fingerprint <> normalized_fingerprint
    then
      raise exception 'Idempotency key was already used for another source'
        using errcode = '22023';
    end if;
    existing_import := idempotency_import;
  end if;

  if existing_import.id is not null then
    return jsonb_build_object(
      'import_id', existing_import.id,
      'tender_id', existing_import.tender_id,
      'company_id', existing_import.company_id,
      'source_kind', existing_import.source_kind,
      'status', existing_import.status,
      'replayed', true,
      'retry_eligible', existing_import.status in (
        'failed',
        'partial'
      )
    );
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
      'source_kind', normalized_kind,
      'source_fingerprint', normalized_fingerprint
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
    stage,
    idempotency_key,
    source_fingerprint,
    idempotency_expires_at
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
    end,
    normalized_key,
    normalized_fingerprint,
    now() + interval '30 days'
  );

  return jsonb_build_object(
    'import_id', import_id,
    'tender_id', tender_id,
    'company_id', p_company_id,
    'source_kind', normalized_kind,
    'status', case
      when normalized_kind = 'files' then 'uploading'
      else 'queued'
    end,
    'replayed', false,
    'retry_eligible', false
  );
end;
$function$;

revoke all on function public.create_universal_tender_import(
  bigint, text, text, text, text, text
) from public, anon;
grant execute on function public.create_universal_tender_import(
  bigint, text, text, text, text, text
) to authenticated, service_role;

-- Preserve the original portal/API contract during staged rollout. URL calls
-- receive server-side deduplication; legacy file calls remain unique because
-- they do not contain a content fingerprint.
create or replace function public.create_universal_tender_import(
  p_company_id bigint,
  p_source_kind text,
  p_display_name text,
  p_source_url text default null
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.create_universal_tender_import(
    p_company_id,
    p_source_kind,
    p_display_name,
    p_source_url,
    gen_random_uuid()::text,
    encode(
      digest(
        case
          when lower(trim(coalesce(p_source_kind, ''))) = 'url'
            then public.normalize_tender_import_source_url(p_source_url)
          else gen_random_uuid()::text
        end,
        'sha256'
      ),
      'hex'
    )
  );
$function$;

revoke all on function public.create_universal_tender_import(
  bigint, text, text, text
) from public, anon;
grant execute on function public.create_universal_tender_import(
  bigint, text, text, text
) to authenticated, service_role;

-- Re-selecting the same files is an explicit retry only when the failed upload
-- never registered a document. Failed processing imports keep their documents
-- and must use the coordinator's normal retry action instead.
create or replace function public.reopen_universal_tender_file_import(
  p_import_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  import_record public.tender_imports;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  select *
  into import_record
  from public.tender_imports
  where id = p_import_id
  for update;

  if import_record.id is null then
    raise exception 'Tender import not found'
      using errcode = 'P0002';
  end if;
  if not (
    public.is_admin()
    or import_record.requested_by = auth.uid()
    or exists (
      select 1
      from public.companies company
      where company.id = import_record.company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;
  if import_record.source_kind <> 'files'
    or import_record.status <> 'failed'
  then
    raise exception 'Only a failed file upload can be reopened'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.tender_documents document
    where document.tender_id = import_record.tender_id
      and document.storage_bucket = 'tender-imports'
      and document.is_active
  ) then
    return jsonb_build_object(
      'import_id', import_record.id,
      'status', import_record.status,
      'reopened', false,
      'reason', 'registered_documents_exist'
    );
  end if;

  update public.tender_imports
  set
    status = 'uploading',
    stage = 'retry_upload',
    progress_percent = 0,
    error_message = null,
    completed_at = null,
    updated_at = now()
  where id = import_record.id;

  return jsonb_build_object(
    'import_id', import_record.id,
    'status', 'uploading',
    'reopened', true
  );
end;
$function$;

revoke all on function public.reopen_universal_tender_file_import(uuid)
from public, anon;
grant execute on function public.reopen_universal_tender_file_import(uuid)
to authenticated, service_role;

create or replace function public.notify_universal_tender_import_terminal(
  p_import_id uuid,
  p_terminal_status text,
  p_failure_category text default null,
  p_safe_reason text default null,
  p_retry_eligible boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  import_record public.tender_imports;
  company_name text;
  normalized_status text := lower(trim(coalesce(p_terminal_status, '')));
  safe_category text := left(
    regexp_replace(
      lower(trim(coalesce(p_failure_category, 'unknown'))),
      '[^a-z0-9_]+',
      '_',
      'g'
    ),
    80
  );
  safe_reason text := left(
    regexp_replace(
      trim(coalesce(p_safe_reason, 'The import could not be completed.')),
      '[[:cntrl:]]+',
      ' ',
      'g'
    ),
    500
  );
begin
  if normalized_status not in ('completed', 'partial', 'failed') then
    raise exception 'Unsupported terminal import status'
      using errcode = '22023';
  end if;

  select *
  into import_record
  from public.tender_imports
  where id = p_import_id;

  if import_record.id is null then
    return null;
  end if;

  select company.name
  into company_name
  from public.companies company
  where company.id = import_record.company_id;

  return public.portal_add_notification(
    import_record.requested_by,
    import_record.requested_by,
    'tender_import',
    import_record.tender_id,
    'tender_import_' || normalized_status,
    case normalized_status
      when 'completed' then 'Tender import ready'
      when 'partial' then 'Tender import completed with warnings'
      else 'Tender import needs attention'
    end,
    case normalized_status
      when 'completed' then import_record.display_name || ' is ready to review.'
      when 'partial' then import_record.display_name ||
        ' was analyzed, but some information could not be verified.'
      else import_record.display_name || ' could not be completed. ' ||
        safe_reason
    end,
    company_name,
    'tender-import:' || import_record.id || ':terminal:' ||
      import_record.attempt_count,
    '/portal.html#tender-import=' || import_record.id,
    normalized_status = 'failed' and p_retry_eligible,
    jsonb_build_object(
      'category', case
        when normalized_status = 'failed' then safe_category
        else null
      end,
      'import_id', import_record.id,
      'tender_id', import_record.tender_id,
      'status', normalized_status,
      'attempt', import_record.attempt_count,
      'safe_reason', case
        when normalized_status = 'failed' then safe_reason
        else null
      end,
      'retry_eligible', normalized_status = 'failed' and p_retry_eligible
    )
  );
end;
$function$;

revoke all on function public.notify_universal_tender_import_terminal(
  uuid, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.notify_universal_tender_import_terminal(
  uuid, text, text, text, boolean
) to service_role;

create or replace function public.mark_universal_tender_import_failed(
  p_import_id uuid,
  p_stage text,
  p_failure_category text,
  p_safe_reason text,
  p_retry_eligible boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  changed boolean := false;
begin
  update public.tender_imports
  set
    status = 'failed',
    stage = left(
      regexp_replace(
        lower(trim(coalesce(p_stage, 'import_failed'))),
        '[^a-z0-9_]+',
        '_',
        'g'
      ),
      80
    ),
    progress_percent = 100,
    error_message = left(
      regexp_replace(
        trim(coalesce(p_safe_reason, 'The import could not be completed.')),
        '[[:cntrl:]]+',
        ' ',
        'g'
      ),
      500
    ),
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_import_id
    and status not in ('completed', 'partial', 'cancelled')
  returning true into changed;

  if changed then
    perform public.notify_universal_tender_import_terminal(
      p_import_id,
      'failed',
      p_failure_category,
      p_safe_reason,
      p_retry_eligible
    );
  end if;
  return coalesce(changed, false);
end;
$function$;

revoke all on function public.mark_universal_tender_import_failed(
  uuid, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.mark_universal_tender_import_failed(
  uuid, text, text, text, boolean
) to service_role;

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
  import_record public.tender_imports;
  safe_reason text := left(
    regexp_replace(
      trim(coalesce(
        p_error_message,
        'Document upload could not be completed.'
      )),
      '[[:cntrl:]]+',
      ' ',
      'g'
    ),
    500
  );
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  select *
  into import_record
  from public.tender_imports
  where id = p_import_id
  for update;

  if import_record.id is null then
    raise exception 'Tender import not found'
      using errcode = 'P0002';
  end if;
  if not (
    public.is_admin()
    or import_record.requested_by = auth.uid()
    or exists (
      select 1
      from public.companies company
      where company.id = import_record.company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;
  if import_record.status not in ('uploading', 'draft', 'queued', 'failed') then
    raise exception 'A processing import cannot be marked as an upload failure'
      using errcode = '55000';
  end if;

  perform public.mark_universal_tender_import_failed(
    p_import_id,
    'upload_failed',
    'upload_validation',
    safe_reason,
    true
  );
end;
$function$;

revoke all on function public.fail_universal_tender_import(uuid, text)
from public, anon;
grant execute on function public.fail_universal_tender_import(uuid, text)
to authenticated, service_role;

create or replace function public.list_stale_tender_import_orphans(
  p_older_than interval
)
returns table (
  object_name text,
  company_id bigint,
  import_id uuid,
  object_created_at timestamptz,
  stale_import boolean
)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $function$
begin
  if p_older_than is null
    or p_older_than < interval '15 minutes'
    or p_older_than > interval '90 days'
  then
    raise exception 'Orphan age must be between 15 minutes and 90 days'
      using errcode = '22023';
  end if;

  return query
  select
    storage.objects.name,
    nullif(split_part(storage.objects.name, '/', 1), '')::bigint,
    nullif(split_part(storage.objects.name, '/', 2), '')::uuid,
    storage.objects.created_at,
    import_record.status in (
      'draft',
      'uploading',
      'queued',
      'discovering',
      'extracting_archive',
      'analyzing'
    )
  from storage.objects
  left join public.tender_imports import_record
    on import_record.id::text =
      lower(split_part(storage.objects.name, '/', 2))
    and import_record.company_id::text =
      split_part(storage.objects.name, '/', 1)
  where storage.objects.bucket_id = 'tender-imports'
    and storage.objects.created_at < now() - p_older_than
    and storage.objects.name ~
      '^[0-9]+/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/[^/].*$'
    and not exists (
      select 1
      from public.tender_documents document
      where document.storage_bucket = 'tender-imports'
        and document.storage_path = storage.objects.name
        and document.is_active
    )
    and (
      import_record.id is null
      or import_record.status in (
        'completed',
        'partial',
        'failed',
        'cancelled'
      )
      or import_record.updated_at < now() - p_older_than
    )
  order by storage.objects.created_at, storage.objects.name;
end;
$function$;

revoke all on function public.list_stale_tender_import_orphans(interval)
from public, anon, authenticated;
grant execute on function public.list_stale_tender_import_orphans(interval)
to service_role;

create or replace function public.sync_universal_tender_import_analysis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  import_record public.tender_imports;
  terminal_status text;
begin
  select *
  into import_record
  from public.tender_imports
  where tender_id = new.tender_id;

  if import_record.id is null then
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
        import_record.progress_percent,
        least(99, coalesce(new.progress_percent, 70))
      )
    end,
    processed_file_count = case
      when terminal_status is not null
        then greatest(
          import_record.processed_file_count,
          coalesce(cardinality(new.selected_document_ids), 0)
        )
      else import_record.processed_file_count
    end,
    error_message = case
      when new.status = 'failed'
        then left(coalesce(new.error_message, 'Analysis failed'), 500)
      else null
    end,
    completed_at = case
      when terminal_status is not null
        then coalesce(new.completed_at, now())
      else null
    end,
    updated_at = now()
  where id = import_record.id;

  if terminal_status is not null
    and (
      tg_op = 'INSERT'
      or old.status is distinct from new.status
    )
  then
    perform public.notify_universal_tender_import_terminal(
      import_record.id,
      terminal_status,
      case when terminal_status = 'failed' then 'document_analysis' end,
      case
        when terminal_status = 'failed'
          then coalesce(new.error_message, 'Document analysis failed.')
      end,
      terminal_status = 'failed'
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_universal_tender_import_analysis()
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;

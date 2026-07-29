-- Run after:
--   202607290001_universal_tender_import.sql
--   202607290002_universal_tender_import_hardening.sql
-- All fixtures are transaction-local and rolled back.

begin;

do $structure$
declare
  required_signature text;
  missing_columns integer;
  policy_expression text;
begin
  if to_regclass('public.tender_imports') is null then
    raise exception 'tender_imports table is missing';
  end if;
  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'tender_imports'
      and relation.relrowsecurity
  ) then
    raise exception 'RLS is not enabled for tender_imports';
  end if;

  select count(*)
  into missing_columns
  from (
    values
      ('tender_id'),
      ('company_id'),
      ('requested_by'),
      ('source_kind'),
      ('status'),
      ('stage'),
      ('progress_percent'),
      ('file_count'),
      ('attempt_count'),
      ('error_message'),
      ('idempotency_key'),
      ('source_fingerprint'),
      ('idempotency_expires_at')
  ) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns definition
    where definition.table_schema = 'public'
      and definition.table_name = 'tender_imports'
      and definition.column_name = expected.column_name
  );
  if missing_columns <> 0 then
    raise exception 'Tender imports are missing % required columns',
      missing_columns;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tender_documents'
      and column_name = 'storage_bucket'
  ) then
    raise exception 'Private document storage reference is missing';
  end if;
  if not exists (
    select 1
    from storage.buckets
    where id = 'tender-imports'
      and public = false
      and file_size_limit = 31457280
  ) then
    raise exception 'Private tender-imports storage bucket is invalid';
  end if;
  if (
    select count(*)
    from public.document_access_statuses
    where code in ('uploaded_private', 'validated_private_upload')
      and access_class = 'processed'
  ) <> 2 then
    raise exception 'Private document access statuses are not registered';
  end if;
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'tender_imports_company_idempotency_unique'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ) or not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'tender_imports_company_source_unique'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ) then
    raise exception 'Tender import idempotency indexes are missing';
  end if;

  foreach required_signature in array array[
    'public.create_universal_tender_import(bigint,text,text,text)',
    'public.create_universal_tender_import(bigint,text,text,text,text,text)',
    'public.reopen_universal_tender_file_import(uuid)',
    'public.register_universal_tender_documents(uuid,jsonb)',
    'public.fail_universal_tender_import(uuid,text)',
    'public.get_universal_tender_imports(bigint,uuid,integer)'
  ]
  loop
    if to_regprocedure(required_signature) is null then
      raise exception 'Universal Tender Import RPC is missing: %',
        required_signature;
    end if;
    if has_function_privilege('anon', required_signature, 'execute') then
      raise exception 'Anonymous role can execute %', required_signature;
    end if;
    if not has_function_privilege(
      'authenticated',
      required_signature,
      'execute'
    ) then
      raise exception 'Authenticated role cannot execute %',
        required_signature;
    end if;
  end loop;

  foreach required_signature in array array[
    'public.notify_universal_tender_import_terminal(uuid,text,text,text,boolean)',
    'public.mark_universal_tender_import_failed(uuid,text,text,text,boolean)',
    'public.list_stale_tender_import_orphans(interval)'
  ]
  loop
    if to_regprocedure(required_signature) is null then
      raise exception 'Service reconciliation RPC is missing: %',
        required_signature;
    end if;
    if has_function_privilege(
      'authenticated',
      required_signature,
      'execute'
    ) or has_function_privilege('anon', required_signature, 'execute') then
      raise exception 'Non-service role can execute %', required_signature;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.tender_imports', 'select') then
    raise exception 'Anonymous role can read private tender imports';
  end if;
  if not has_table_privilege(
    'authenticated',
    'public.tender_imports',
    'select'
  ) then
    raise exception 'Authenticated role cannot exercise import RLS';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.tender_imports',
    'insert'
  ) or has_table_privilege(
    'authenticated',
    'public.tender_imports',
    'update'
  ) or has_table_privilege(
    'authenticated',
    'public.tender_imports',
    'delete'
  ) then
    raise exception 'Authenticated users must mutate imports through RPCs';
  end if;

  foreach required_signature in array array[
    'owners upload private tender imports',
    'owners read private tender imports',
    'owners delete private tender imports'
  ]
  loop
    select coalesce(qual, '') || ' ' || coalesce(with_check, '')
    into policy_expression
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = required_signature;
    if policy_expression is null then
      raise exception 'Private import Storage policy is missing: %',
        required_signature;
    end if;
    if policy_expression not like '%bucket_id%'
      or policy_expression not like '%split_part%'
      or policy_expression not like '%import_record%'
    then
      raise exception 'Storage policy does not validate bucket and path ownership: %',
        required_signature;
    end if;
  end loop;
end
$structure$;

create temporary table tender_import_test_tenants (
  ordinal integer primary key,
  owner_id uuid not null,
  company_id bigint,
  import_id uuid,
  object_path text
) on commit drop;

grant select, update on tender_import_test_tenants
to authenticated, service_role;

insert into tender_import_test_tenants (ordinal, owner_id)
values (1, gen_random_uuid()), (2, gen_random_uuid());

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
select
  owner_id,
  'authenticated',
  'authenticated',
  'tender-import-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from tender_import_test_tenants;

with inserted as (
  insert into public.companies (
    owner_id,
    name,
    type,
    country,
    is_approved,
    is_active
  )
  select
    owner_id,
    'Tender import test company ' || ordinal,
    'Medical device manufacturer',
    'Türkiye',
    true,
    true
  from tender_import_test_tenants
  order by ordinal
  returning id, owner_id
)
update tender_import_test_tenants fixture
set company_id = inserted.id
from inserted
where inserted.owner_id = fixture.owner_id;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    (select owner_id from tender_import_test_tenants where ordinal = 1),
    'role',
    'authenticated'
  )::text,
  true
);
set local role authenticated;

do $owner_one$
declare
  own_company_id bigint := (
    select company_id from tender_import_test_tenants where ordinal = 1
  );
  other_company_id bigint := (
    select company_id from tender_import_test_tenants where ordinal = 2
  );
  created jsonb;
  replayed jsonb;
  file_import jsonb;
  upload_retry jsonb;
  created_import_id uuid;
  file_import_id uuid;
  upload_retry_id uuid;
  owner_path text;
  notification_count integer;
begin
  created := public.create_universal_tender_import(
    own_company_id,
    'url',
    'Hospital glove tender',
    'https://procurement.example.invalid/tender/123',
    'test-url-operation-0001',
    repeat('f', 64)
  );
  created_import_id := (created ->> 'import_id')::uuid;
  replayed := public.create_universal_tender_import(
    own_company_id,
    'url',
    'Same hospital glove tender',
    'https://PROCUREMENT.EXAMPLE.INVALID:443/tender/123?utm_source=qa#documents',
    'test-url-operation-0002',
    repeat('e', 64)
  );
  if replayed ->> 'replayed' <> 'true'
    or (replayed ->> 'import_id')::uuid <> created_import_id
  then
    raise exception 'Normalized URL replay did not return the existing import';
  end if;
  if (
    select count(*)
    from public.tender_imports
    where company_id = own_company_id
      and source_kind = 'url'
  ) <> 1 then
    raise exception 'URL replay created a duplicate import';
  end if;
  if not exists (
    select 1
    from public.tenders tender
    join public.tender_imports import_record
      on import_record.tender_id = tender.id
    where import_record.id = created_import_id
      and tender.status = 'draft'
      and tender.source = 'PORTAL_IMPORT'
  ) then
    raise exception 'Private canonical tender was not created';
  end if;

  file_import := public.create_universal_tender_import(
    own_company_id,
    'files',
    'Owner storage test',
    null,
    'test-file-operation-0001',
    repeat('a', 64)
  );
  file_import_id := (file_import ->> 'import_id')::uuid;
  begin
    perform public.create_universal_tender_import(
      own_company_id,
      'files',
      'Conflicting operation key',
      null,
      'test-file-operation-0001',
      repeat('b', 64)
    );
    raise exception 'Reused idempotency key accepted a different source';
  exception when invalid_parameter_value then null;
  end;
  owner_path := own_company_id || '/' || file_import_id ||
    '/owner-specification.pdf';
  update tender_import_test_tenants
  set import_id = file_import_id, object_path = owner_path
  where ordinal = 1;

  insert into storage.objects (bucket_id, name, metadata)
  values (
    'tender-imports',
    owner_path,
    '{"size":"120","mimetype":"application/pdf"}'::jsonb
  );
  if (
    select count(*)
    from storage.objects
    where bucket_id = 'tender-imports'
      and storage.objects.name = owner_path
  ) <> 1 then
    raise exception 'Owner cannot read the uploaded object';
  end if;

  perform public.register_universal_tender_documents(
    file_import_id,
    jsonb_build_array(jsonb_build_object(
      'file_name', 'owner-specification.pdf',
      'storage_path', owner_path,
      'file_size', 120
    ))
  );
  if not exists (
    select 1
    from public.tender_documents document
    where document.tender_id = (file_import ->> 'tender_id')::bigint
      and document.storage_bucket = 'tender-imports'
      and document.storage_path = owner_path
      and document.access_status = 'uploaded_private'
  ) then
    raise exception 'Owner document registration did not complete';
  end if;
  perform public.fail_universal_tender_import(
    file_import_id,
    'Synthetic registration-stage failure'
  );
  perform public.fail_universal_tender_import(
    file_import_id,
    'Synthetic replay of the same failure'
  );
  select count(*)
  into notification_count
  from public.matchmaking_notifications notification
  where notification.recipient_user_id = auth.uid()
    and notification.source_kind = 'tender_import'
    and notification.source_id = (file_import ->> 'tender_id')::bigint;
  if notification_count <> 1 then
    raise exception 'Terminal upload failure created % notifications',
      notification_count;
  end if;

  upload_retry := public.create_universal_tender_import(
    own_company_id,
    'files',
    'Interrupted upload retry test',
    null,
    'test-file-operation-retry',
    repeat('d', 64)
  );
  upload_retry_id := (upload_retry ->> 'import_id')::uuid;
  perform public.fail_universal_tender_import(
    upload_retry_id,
    'Synthetic pre-registration upload failure'
  );
  upload_retry := public.reopen_universal_tender_file_import(upload_retry_id);
  if upload_retry ->> 'reopened' <> 'true'
    or upload_retry ->> 'status' <> 'uploading'
  then
    raise exception 'Explicit pre-registration upload retry was not reopened';
  end if;
  if (
    select status <> 'uploading'
      or stage <> 'retry_upload'
      or error_message is not null
    from public.tender_imports
    where id = upload_retry_id
  ) then
    raise exception 'Reopened upload did not reset its retryable state';
  end if;

  upload_retry := public.reopen_universal_tender_file_import(file_import_id);
  if upload_retry ->> 'reopened' <> 'false'
    or upload_retry ->> 'reason' <> 'registered_documents_exist'
  then
    raise exception 'Registered failed import was reopened for duplicate upload';
  end if;

  begin
    perform public.create_universal_tender_import(
      other_company_id,
      'files',
      'Cross-tenant import',
      null,
      'cross-tenant-operation',
      repeat('b', 64)
    );
    raise exception 'Cross-tenant import was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_universal_tender_import(
      own_company_id,
      'url',
      'Unsafe URL import',
      'http://127.0.0.1/private',
      'unsafe-url-operation',
      repeat('c', 64)
    );
    raise exception 'Non-HTTPS URL was accepted';
  exception when invalid_parameter_value then null;
  end;
end
$owner_one$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    (select owner_id from tender_import_test_tenants where ordinal = 2),
    'role',
    'authenticated'
  )::text,
  true
);
set local role authenticated;

do $owner_two$
declare
  own_company_id bigint := (
    select company_id from tender_import_test_tenants where ordinal = 2
  );
  first_company_id bigint := (
    select company_id from tender_import_test_tenants where ordinal = 1
  );
  first_path text := (
    select object_path from tender_import_test_tenants where ordinal = 1
  );
  created jsonb;
  other_path text;
begin
  created := public.create_universal_tender_import(
    own_company_id,
    'files',
    'Second tenant storage test',
    null,
    'test-file-operation-tenant-two',
    repeat('a', 64)
  );
  other_path := own_company_id || '/' || (created ->> 'import_id') ||
    '/other-specification.pdf';
  update tender_import_test_tenants
  set import_id = (created ->> 'import_id')::uuid,
      object_path = other_path
  where ordinal = 2;

  begin
    insert into storage.objects (bucket_id, name, metadata)
    values (
      'tender-imports',
      first_company_id || '/' || (select import_id
        from tender_import_test_tenants where ordinal = 1) ||
        '/cross-tenant.pdf',
      '{"size":"50","mimetype":"application/pdf"}'::jsonb
    );
    raise exception 'Cross-tenant object upload was accepted';
  exception when insufficient_privilege then null;
  end;

  if (
    select count(*)
    from storage.objects
    where bucket_id = 'tender-imports'
      and storage.objects.name = first_path
  ) <> 0 then
    raise exception 'Another company can read an owner object';
  end if;
  -- The same source fingerprint is intentionally reusable by a different
  -- company because both unique contracts are company-scoped.
  if created ->> 'replayed' <> 'false' then
    raise exception 'Cross-company file source was incorrectly deduplicated';
  end if;
end
$owner_two$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"anon"}',
  true
);
set local role anon;

do $anonymous$
begin
  begin
    perform 1 from public.tender_imports limit 1;
    raise exception 'Anonymous role can read private imports';
  exception when insufficient_privilege then null;
  end;
  if exists (
    select 1
    from storage.objects
    where bucket_id = 'tender-imports'
  ) then
    raise exception 'Anonymous role can read private import objects';
  end if;
end
$anonymous$;

reset role;
set local role service_role;

do $service_admin$
declare
  fixture_company_id bigint := (
    select company_id from tender_import_test_tenants where ordinal = 2
  );
  fixture_import_id uuid := (
    select import_id from tender_import_test_tenants where ordinal = 2
  );
  admin_path text := (
    select object_path from tender_import_test_tenants where ordinal = 2
  );
  stale_path text := fixture_company_id || '/' || fixture_import_id ||
    '/client-disconnected.pdf';
  referenced_path text := (
    select object_path from tender_import_test_tenants where ordinal = 1
  );
begin
  insert into storage.objects (bucket_id, name, metadata)
  values (
    'tender-imports',
    admin_path,
    '{"size":"50","mimetype":"application/pdf"}'::jsonb
  );
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'tender-imports'
      and storage.objects.name = admin_path
  ) then
    raise exception 'Service administrator cannot read private object';
  end if;
  update storage.objects
  set created_at = now() - interval '2 hours'
  where bucket_id = 'tender-imports'
    and storage.objects.name = referenced_path;
  update public.tender_imports
  set updated_at = now() - interval '2 hours'
  where id = (
    select import_id from tender_import_test_tenants where ordinal = 1
  );
  if exists (
    select 1
    from public.list_stale_tender_import_orphans(interval '15 minutes')
    where object_name = referenced_path
  ) then
    raise exception 'Referenced private object was classified as an orphan';
  end if;

  insert into storage.objects (bucket_id, name, metadata, created_at)
  values (
    'tender-imports',
    stale_path,
    '{"size":"50","mimetype":"application/pdf"}'::jsonb,
    now() - interval '2 hours'
  );
  update public.tender_imports
  set updated_at = now() - interval '2 hours'
  where id = fixture_import_id;
  if not exists (
    select 1
    from public.list_stale_tender_import_orphans(interval '15 minutes')
    where object_name = stale_path
      and stale_import
  ) then
    raise exception 'Interrupted stale upload was not classified as an orphan';
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'tender-imports'
      and storage.objects.name = stale_path
  ) then
    raise exception 'Dry-run orphan listing deleted an object';
  end if;
end
$service_admin$;

reset role;
rollback;

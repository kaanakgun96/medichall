-- Run after 202607290001_universal_tender_import.sql.
-- All fixtures are transaction-local and rolled back.

begin;

do $structure$
declare
  required_signature text;
  missing_columns integer;
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
      ('error_message')
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

  foreach required_signature in array array[
    'public.create_universal_tender_import(bigint,text,text,text)',
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

  if has_table_privilege(
    'anon',
    'public.tender_imports',
    'select'
  ) then
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

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'owners upload private tender imports'
  ) then
    raise exception 'Private import upload policy is missing';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tender_documents'
      and policyname = 'authenticated read tender documents'
      and qual like '%tender_imports%'
  ) then
    raise exception 'Imported tender document metadata is not tenant scoped';
  end if;
end
$structure$;

create temporary table tender_import_test_tenants (
  ordinal integer primary key,
  owner_id uuid not null,
  company_id bigint
) on commit drop;

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
    (select owner_id
     from tender_import_test_tenants
     where ordinal = 1),
    'role',
    'authenticated'
  )::text,
  true
);
set local role authenticated;

do $behavior$
declare
  own_company_id bigint := (
    select company_id
    from tender_import_test_tenants
    where ordinal = 1
  );
  other_company_id bigint := (
    select company_id
    from tender_import_test_tenants
    where ordinal = 2
  );
  created jsonb;
  import_rows jsonb;
  created_import_id uuid;
begin
  created := public.create_universal_tender_import(
    own_company_id,
    'url',
    'Hospital glove tender',
    'https://procurement.example.invalid/tender/123'
  );
  created_import_id := (created ->> 'import_id')::uuid;

  if created ->> 'status' <> 'queued' then
    raise exception 'URL import was not queued';
  end if;
  if not exists (
    select 1
    from public.tenders tender
    join public.tender_imports tender_import
      on tender_import.tender_id = tender.id
    where tender_import.id = created_import_id
      and tender.status = 'draft'
      and tender.source = 'PORTAL_IMPORT'
  ) then
    raise exception 'Private canonical tender was not created';
  end if;

  import_rows := public.get_universal_tender_imports(
    own_company_id,
    created_import_id,
    1
  );
  if jsonb_array_length(import_rows) <> 1 then
    raise exception 'Owner could not read the created import';
  end if;

  begin
    perform public.create_universal_tender_import(
      other_company_id,
      'files',
      'Cross-tenant import',
      null
    );
    raise exception 'Cross-tenant import was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_universal_tender_import(
      own_company_id,
      'url',
      'Unsafe URL import',
      'http://127.0.0.1/private'
    );
    raise exception 'Non-HTTPS URL was accepted';
  exception when invalid_parameter_value then null;
  end;
end
$behavior$;

reset role;
rollback;

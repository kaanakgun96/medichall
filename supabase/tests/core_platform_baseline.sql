-- Core baseline reconstruction regression.
-- Run after the complete migration history. No fixtures persist.

begin;

do $structure$
declare
  required_relation text;
  required_signature text;
begin
  foreach required_relation in array array[
    'public.admins',
    'public.ai_usage_logs',
    'public.banners',
    'public.buyer_profiles',
    'public.companies',
    'public.company_catalogs',
    'public.company_certificates',
    'public.favorites',
    'public.partners',
    'public.products',
    'public.rfq_messages',
    'public.rfq_offers',
    'public.rfq_requests'
  ]
  loop
    if to_regclass(required_relation) is null then
      raise exception 'Core baseline relation is missing: %',
        required_relation;
    end if;
    if not exists (
      select 1
      from pg_class relation
      where relation.oid = to_regclass(required_relation)
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled: %', required_relation;
    end if;
  end loop;

  foreach required_signature in array array[
    'public.company_is_public(bigint)',
    'public.is_admin()',
    'public.medichall_public_stats()',
    'public.mh_admin_email()',
    'public.mh_email_from()',
    'public.mh_site_url()',
    'public.notify_email(text,text,text)',
    'public.set_company_slug()',
    'public.trg_message_created()',
    'public.trg_offer_created()',
    'public.trg_offer_touch()',
    'public.trg_rfq_created()'
  ]
  loop
    if to_regprocedure(required_signature) is null then
      raise exception 'Core baseline function is missing: %',
        required_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'companies'
      and column_name = 'is_verified'
      and is_nullable = 'NO'
  ) then
    raise exception 'Production-compatible companies.is_verified is missing';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'company_certificates'
      and column_name in (
        'id',
        'company_id',
        'title',
        'file_url',
        'created_at'
      )
  ) <> 5 then
    raise exception 'Company certificate contract is incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenders'
      and column_name = 'ai_lots'
      and data_type = 'jsonb'
      and is_nullable = 'NO'
  ) then
    raise exception 'Tender detail ai_lots contract is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'opportunity_matches'
      and column_name = 'fit_narrative'
      and data_type = 'text'
  ) then
    raise exception 'Opportunity fit narrative contract is missing';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'media'
      and public
  ) then
    raise exception 'Public media bucket is missing';
  end if;
  if not exists (
    select 1
    from storage.buckets
    where id = 'tender-documents'
      and public
      and file_size_limit = 104857600
  ) then
    raise exception 'Tender documents bucket contract is invalid';
  end if;
  if exists (
    select 1
    from storage.buckets
    where id = 'tender-imports'
  ) then
    raise exception 'Intentionally undeployed tender imports bucket exists';
  end if;
  if to_regclass('public.tender_imports') is not null
     or to_regprocedure(
       'public.create_universal_tender_import(bigint,text,text,text)'
     ) is not null then
    raise exception 'Intentionally undeployed Module 1 objects exist';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'company_certificates'
      and policyname in (
        'admin all certificates',
        'owner manage certificates',
        'public read certificates'
      )
  ) <> 3 then
    raise exception 'Company certificate policies are incomplete';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'authenticated upload tender documents'
      and with_check like '%tender-documents%'
      and with_check like '%user-uploads/%'
  ) then
    raise exception 'Tender document upload policy is missing';
  end if;

  if has_column_privilege(
    'anon',
    'public.companies',
    'contact_email',
    'select'
  ) or has_column_privilege(
    'anon',
    'public.companies',
    'owner_id',
    'select'
  ) then
    raise exception 'Anonymous company access exposes private columns';
  end if;
  if not has_column_privilege(
    'anon',
    'public.companies',
    'name',
    'select'
  ) then
    raise exception 'Anonymous company access is missing public columns';
  end if;

  if has_function_privilege(
    'anon',
    'public.notify_email(text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.notify_email(text,text,text)',
    'execute'
  ) then
    raise exception 'Provider-backed e-mail helper is browser-callable';
  end if;

  if pg_get_functiondef(
    'public.notify_email(text,text,text)'::regprocedure
  ) ~ 'Bearer[[:space:]]+re_[A-Za-z0-9_-]+' then
    raise exception 'Provider credential is embedded in notify_email';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where not trigger.tgisinternal
      and namespace.nspname = 'public'
      and relation.relname = 'companies'
      and trigger.tgname = 'company_slug'
  ) then
    raise exception 'Company slug trigger is missing';
  end if;
end;
$structure$;

do $application_contract$
declare
  public_stats json;
begin
  public_stats := public.medichall_public_stats();
  if public_stats is null
     or not (public_stats::jsonb ?& array[
       'open_tenders',
       'tenders',
       'tender_countries',
       'products',
       'manufacturers'
     ]) then
    raise exception 'Public statistics RPC returned an invalid contract';
  end if;
end;
$application_contract$;

rollback;

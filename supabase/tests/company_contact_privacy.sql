-- Run after 202608170002_company_contact_privacy.sql.
-- Synthetic contact values and all fixture rows are transaction-local.

begin;

do $structure$
begin
  if to_regprocedure(
    'public.get_public_companies_v1(bigint,text,integer)'
  ) is null or to_regprocedure(
    'public.get_my_company_private_v1()'
  ) is null or to_regprocedure(
    'public.get_admin_companies_private_v1()'
  ) is null or to_regprocedure(
    'public.company_owner_authorized_v1(bigint)'
  ) is null then
    raise exception 'Company privacy RPC boundary is incomplete';
  end if;

  if has_column_privilege('anon', 'public.companies', 'phone', 'select')
     or has_column_privilege(
       'authenticated', 'public.companies', 'phone', 'select'
     ) then
    raise exception 'Phone remains directly readable by a browser role';
  end if;
  if has_column_privilege(
    'anon', 'public.companies', 'contact_email', 'select'
  ) or has_column_privilege(
    'authenticated', 'public.companies', 'contact_email', 'select'
  ) then
    raise exception 'Private email remains directly readable by a browser role';
  end if;
  if has_column_privilege(
    'anon', 'public.companies', 'owner_id', 'select'
  ) or has_column_privilege(
    'authenticated', 'public.companies', 'owner_id', 'select'
  ) then
    raise exception 'Company ownership remains exposed to a browser role';
  end if;
  if has_column_privilege(
    'anon', 'public.companies', 'description', 'select'
  ) or has_column_privilege(
    'authenticated', 'public.companies', 'certifications', 'select'
  ) then
    raise exception 'Unsanitized company free text remains directly readable';
  end if;
  if not has_column_privilege(
    'anon', 'public.companies', 'name', 'select'
  ) or not has_column_privilege(
    'authenticated', 'public.companies', 'slug', 'select'
  ) then
    raise exception 'Safe public company relationships were broken';
  end if;

  if not has_function_privilege(
    'anon',
    'public.get_public_companies_v1(bigint,text,integer)',
    'execute'
  ) or has_function_privilege(
    'anon', 'public.get_my_company_private_v1()', 'execute'
  ) or has_function_privilege(
    'anon', 'public.get_admin_companies_private_v1()', 'execute'
  ) then
    raise exception 'Company privacy RPC grants are incorrect';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'products'
      and policy.policyname = 'owner manage own products'
      and policy.qual like '%company_owner_authorized_v1%'
      and policy.with_check like '%company_owner_authorized_v1%'
  ) or not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'rfq_requests'
      and policy.policyname = 'owner read own rfq'
      and policy.qual like '%company_owner_authorized_v1%'
  ) then
    raise exception 'Admin-safe product/RFQ ownership policies are missing';
  end if;
end
$structure$;

create temporary table company_privacy_test (
  ordinal integer primary key,
  owner_id uuid not null,
  company_id bigint,
  is_admin boolean not null default false
) on commit drop;

insert into company_privacy_test (ordinal, owner_id, is_admin)
values
  (1, gen_random_uuid(), false),
  (2, gen_random_uuid(), false),
  (3, gen_random_uuid(), true);

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
  'company-privacy-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from company_privacy_test;

insert into public.admins (user_id)
select owner_id from company_privacy_test where is_admin;

with inserted as (
  insert into public.companies (
    owner_id,
    name,
    type,
    description,
    website,
    contact_email,
    phone,
    country,
    city,
    certifications,
    is_approved,
    is_active
  )
  select
    owner_id,
    'Company privacy fixture ' || ordinal,
    case when ordinal = 1 then 'Buyer' else 'Manufacturer' end,
    'Contact private-' || ordinal || '@example.invalid or +90 555 000 000' || ordinal,
    'https://example.invalid/company-' || ordinal,
    'private-' || ordinal || '@example.invalid',
    '+90 555 000 000' || ordinal,
    'Türkiye',
    'Istanbul',
    'ISO 13485; WhatsApp +90 555 000 000' || ordinal,
    true,
    true
  from company_privacy_test
  returning id, owner_id
)
update company_privacy_test fixture
set company_id = inserted.id
from inserted
where inserted.owner_id = fixture.owner_id;

do $public_projection$
declare
  v_company_id bigint := (
    select company_id from company_privacy_test where ordinal = 2
  );
  v_public jsonb;
  v_row jsonb;
begin
  v_public := public.get_public_companies_v1(v_company_id, null, 1);
  if jsonb_array_length(v_public) <> 1 then
    raise exception 'Public company DTO did not return the requested company';
  end if;
  v_row := v_public -> 0;
  if v_row ? 'phone'
     or v_row ? 'contact_email'
     or v_row ? 'owner_id' then
    raise exception 'Public company DTO contains a private field';
  end if;
  if coalesce(v_row ->> 'description', '') ~* '@|\+90|555[[:space:]]+000'
     or coalesce(v_row ->> 'certifications', '') ~* '\+90|555[[:space:]]+000' then
    raise exception 'Public company free text contains a contact coordinate';
  end if;
  if v_row ->> 'website' <> 'https://example.invalid/company-2' then
    raise exception 'The explicitly public website field was removed';
  end if;
end
$public_projection$;

-- Company A cannot use the public DTO to retrieve Company B contacts, while
-- Company A's private RPC returns only Company A's stored record.
select set_config(
  'company_privacy_test.company_a_id',
  (select company_id::text from company_privacy_test where ordinal = 1),
  true
);
select set_config(
  'company_privacy_test.company_b_id',
  (select company_id::text from company_privacy_test where ordinal = 2),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select owner_id from company_privacy_test where ordinal = 1),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $owner_and_cross_company$
declare
  v_company_a bigint :=
    current_setting('company_privacy_test.company_a_id')::bigint;
  v_company_b bigint :=
    current_setting('company_privacy_test.company_b_id')::bigint;
  v_own jsonb;
  v_other_public jsonb;
  v_updated integer;
begin
  v_own := public.get_my_company_private_v1();
  if jsonb_array_length(v_own) <> 1
     or (v_own #>> '{0,id}')::bigint <> v_company_a
     or v_own #>> '{0,phone}' <> '+90 555 000 0001'
     or v_own #>> '{0,contact_email}' <> 'private-1@example.invalid' then
    raise exception 'Authorized owner cannot read its own stored contacts';
  end if;
  if public.company_owner_authorized_v1(v_company_a) is not true
     or public.company_owner_authorized_v1(v_company_b) is not false then
    raise exception 'Company ownership authorization crossed tenant boundaries';
  end if;
  v_other_public := public.get_public_companies_v1(v_company_b, null, 1);
  if (v_other_public -> 0) ? 'phone'
     or (v_other_public -> 0) ? 'contact_email' then
    raise exception 'Authenticated Company A retrieved Company B contacts';
  end if;

  begin
    execute format(
      'select phone, contact_email from public.companies where id = %s',
      v_company_b
    );
    raise exception 'Raw cross-company contact SELECT unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  update public.companies
  set phone = '+90 555 000 0099'
  where id = v_company_a;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Authorized owner cannot edit its own private contact';
  end if;

  update public.companies
  set phone = '+90 555 000 0098'
  where id = v_company_b;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'Company A modified Company B private contact';
  end if;

  update public.companies
  set phone = '+90 555 000 0001'
  where id = v_company_a;
end
$owner_and_cross_company$;

reset role;

-- The existing MedicHall admin boundary retains legitimate private access.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select owner_id from company_privacy_test where ordinal = 3),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $admin_access$
declare
  v_company_b bigint :=
    current_setting('company_privacy_test.company_b_id')::bigint;
  v_admin jsonb;
begin
  v_admin := public.get_admin_companies_private_v1();
  if not exists (
    select 1
    from jsonb_array_elements(v_admin) company
    where (company ->> 'id')::bigint = v_company_b
      and company ->> 'phone' = '+90 555 000 0002'
      and company ->> 'contact_email' = 'private-2@example.invalid'
  ) then
    raise exception 'Admin private company access was broken';
  end if;

  -- These are the exact relation reads performed concurrently by admin.html.
  -- Before the forward-only hotfix both failed with SQLSTATE 42501 because an
  -- owner policy queried public.companies under the authenticated caller.
  perform count(*) from public.products;
  perform count(*) from public.rfq_requests;
end
$admin_access$;

reset role;

do $stored_values_preserved$
begin
  if exists (
    select 1
    from company_privacy_test fixture
    join public.companies company on company.id = fixture.company_id
    where company.phone is distinct from '+90 555 000 000' || fixture.ordinal
       or company.contact_email is distinct from
          'private-' || fixture.ordinal || '@example.invalid'
  ) then
    raise exception 'Stored customer contact values were modified';
  end if;
end
$stored_values_preserved$;

rollback;

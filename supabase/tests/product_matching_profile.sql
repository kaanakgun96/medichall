-- Run after 202607270003_product_matching_profile.sql.
-- All compatibility and tenant fixtures are rolled back.

begin;

do $structure$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from (
    values
      ('normalized_category'),
      ('product_subtype'),
      ('material'),
      ('dimensions'),
      ('sterility_status'),
      ('use_type'),
      ('packaging_description'),
      ('units_per_package'),
      ('product_certifications'),
      ('regulatory_class'),
      ('sterilization_method'),
      ('production_capacity'),
      ('capacity_unit'),
      ('capacity_period'),
      ('technical_specifications'),
      ('matching_profile_sources')
  ) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns definition
    where definition.table_schema = 'public'
      and definition.table_name = 'products'
      and definition.column_name = expected.column_name
  );
  if v_missing <> 0 then
    raise exception 'Product matching profile is missing % columns', v_missing;
  end if;
  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'products'
      and relation.relrowsecurity
  ) then
    raise exception 'Products RLS must remain enabled';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'products'
      and policyname = 'owner manage own products'
  ) then
    raise exception 'Existing owner product policy was removed';
  end if;
end
$structure$;

create temporary table product_profile_test_tenants (
  ordinal integer primary key,
  owner_id uuid not null,
  company_id bigint,
  product_id bigint
) on commit drop;

insert into product_profile_test_tenants (ordinal, owner_id)
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
  'product-profile-' || owner_id::text || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from product_profile_test_tenants;

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
    'Product profile test company ' || ordinal,
    'Medical device manufacturer',
    'Türkiye',
    false,
    true
  from product_profile_test_tenants
  order by ordinal
  returning id, owner_id
)
update product_profile_test_tenants fixture
set company_id = inserted.id
from inserted
where inserted.owner_id = fixture.owner_id;

-- Backwards compatibility: all historical required columns still suffice.
with inserted as (
  insert into public.products (
    ref,
    name,
    category,
    company_id
  )
  select
    'product-profile-test-' || ordinal || '-' || gen_random_uuid()::text,
    'Legacy product ' || ordinal,
    'Medical Devices',
    company_id
  from product_profile_test_tenants
  order by ordinal
  returning id, company_id
)
update product_profile_test_tenants fixture
set product_id = inserted.id
from inserted
where inserted.company_id = fixture.company_id;

do $defaults$
begin
  if exists (
    select 1
    from public.products product
    join product_profile_test_tenants fixture
      on fixture.product_id = product.id
    where product.sterility_status <> 'unknown'
      or product.use_type <> 'unknown'
      or product.product_certifications <> '{}'
      or product.technical_specifications <> '{}'
      or product.matching_profile_sources <> '{}'
  ) then
    raise exception 'Legacy product defaults are not backwards compatible';
  end if;
end
$defaults$;

do $validation$
declare
  v_product_id bigint := (
    select product_id
    from product_profile_test_tenants
    where ordinal = 1
  );
begin
  begin
    update public.products
    set sterility_status = 'probably_sterile'
    where id = v_product_id;
    raise exception 'Unsupported sterility value was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.products
    set matching_profile_sources = '{"arbitrary":"explicit"}'::jsonb
    where id = v_product_id;
    raise exception 'Arbitrary provenance JSON was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.products
    set
      production_capacity = 1000,
      capacity_unit = null,
      capacity_period = null
    where id = v_product_id;
    raise exception 'Partial production capacity was accepted';
  exception when check_violation then null;
  end;
end
$validation$;

select set_config(
  'medichall.product_profile_owner_one',
  (select owner_id::text
   from product_profile_test_tenants
   where ordinal = 1),
  true
);
select set_config(
  'medichall.product_profile_product_one',
  (select product_id::text
   from product_profile_test_tenants
   where ordinal = 1),
  true
);
select set_config(
  'medichall.product_profile_product_two',
  (select product_id::text
   from product_profile_test_tenants
   where ordinal = 2),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    current_setting('medichall.product_profile_owner_one', true),
    'role',
    'authenticated'
  )::text,
  true
);
set local role authenticated;

do $tenant_isolation$
declare
  v_count integer;
begin
  update public.products
  set product_subtype = 'epidural drape'
  where id = current_setting(
    'medichall.product_profile_product_one',
    true
  )::bigint;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Owner could not update own structured product profile';
  end if;

  update public.products
  set product_subtype = 'cross tenant mutation'
  where id = current_setting(
    'medichall.product_profile_product_two',
    true
  )::bigint;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'Cross-tenant product update was permitted';
  end if;
end
$tenant_isolation$;

rollback;

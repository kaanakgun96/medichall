-- Run after 202607270001_lot_level_tender_matching.sql.
-- All fixtures and lot-match rows are transaction-local and rolled back.

begin;

do $structure$
declare
  v_missing_columns integer;
begin
  if to_regclass('public.tender_lot_matches') is null then
    raise exception 'tender_lot_matches table is missing';
  end if;
  if to_regprocedure(
    'public.get_tender_lot_matches_v1(bigint,bigint)'
  ) is null then
    raise exception 'Lot-match read RPC is missing';
  end if;

  select count(*) into v_missing_columns
  from (
    values
      ('lot_key'),
      ('lot_number'),
      ('match_score'),
      ('recommendation'),
      ('confidence_score'),
      ('score_components'),
      ('matched_requirements'),
      ('gaps'),
      ('blockers'),
      ('unknowns'),
      ('tender_evidence'),
      ('company_evidence'),
      ('input_hash'),
      ('calculation_version')
  ) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns definition
    where definition.table_schema = 'public'
      and definition.table_name = 'tender_lot_matches'
      and definition.column_name = expected.column_name
  );
  if v_missing_columns <> 0 then
    raise exception 'Lot matching is missing % persistence columns',
      v_missing_columns;
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'tender_lot_matches'
      and relation.relrowsecurity
  ) then
    raise exception 'RLS is not enabled for tender_lot_matches';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tender_lot_matches'
      and policyname = 'owners and admins read tender lot matches'
  ) then
    raise exception 'Owner/admin lot-match read policy is missing';
  end if;
  if has_table_privilege(
    'authenticated', 'public.tender_lot_matches', 'select'
  ) or has_table_privilege(
    'authenticated', 'public.tender_lot_matches', 'insert'
  ) or has_table_privilege(
    'authenticated', 'public.tender_lot_matches', 'update'
  ) or has_table_privilege(
    'authenticated', 'public.tender_lot_matches', 'delete'
  ) then
    raise exception 'Authenticated users must use the safe lot-match RPC';
  end if;
  if not has_table_privilege(
    'service_role', 'public.tender_lot_matches', 'select'
  ) or not has_table_privilege(
    'service_role', 'public.tender_lot_matches', 'insert'
  ) or not has_table_privilege(
    'service_role', 'public.tender_lot_matches', 'update'
  ) or has_table_privilege(
    'service_role', 'public.tender_lot_matches', 'delete'
  ) then
    raise exception 'Service-role lot-match grants are not minimal';
  end if;
  if has_function_privilege(
    'anon',
    'public.get_tender_lot_matches_v1(bigint,bigint)',
    'execute'
  ) then
    raise exception 'Anonymous users must not execute the lot-match RPC';
  end if;
end
$structure$;

create temporary table lot_match_test_tenants (
  ordinal integer primary key,
  owner_id uuid not null,
  company_id bigint,
  tender_id bigint,
  product_id bigint,
  opportunity_match_id bigint
) on commit drop;

insert into lot_match_test_tenants (ordinal, owner_id)
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
  'lot-match-' || owner_id::text || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from lot_match_test_tenants;

with inserted as (
  insert into public.companies (
    owner_id,
    name,
    type,
    country,
    certifications,
    is_approved,
    is_active
  )
  select
    owner_id,
    'Lot match test company ' || ordinal,
    'Medical device manufacturer',
    'Germany',
    'ISO 13485',
    true,
    true
  from lot_match_test_tenants
  order by ordinal
  returning id, owner_id
)
update lot_match_test_tenants fixture
set company_id = inserted.id
from inserted
where inserted.owner_id = fixture.owner_id;

with inserted as (
  insert into public.products (
    ref,
    name,
    category,
    description,
    company_id,
    is_active
  )
  select
    'lot-match-test-' || ordinal || '-' || gen_random_uuid()::text,
    'Sterile nitrile examination glove',
    'Medical gloves',
    'Powder-free sterile nitrile glove',
    company_id,
    true
  from lot_match_test_tenants
  order by ordinal
  returning id, company_id
)
update lot_match_test_tenants fixture
set product_id = inserted.id
from inserted
where inserted.company_id = fixture.company_id;

with inserted as (
  insert into public.tenders (
    source,
    source_notice_id,
    title,
    status
  )
  select
    'lot-match-test',
    'fixture-' || ordinal || '-' || gen_random_uuid()::text,
    'Lot match fixture ' || ordinal,
    'open'
  from lot_match_test_tenants
  order by ordinal
  returning id, source_notice_id
)
update lot_match_test_tenants fixture
set tender_id = inserted.id
from inserted
where split_part(inserted.source_notice_id, '-', 2)::integer = fixture.ordinal;

with inserted as (
  insert into public.opportunity_matches (
    company_id,
    opportunity_type,
    tender_id,
    match_score,
    keyword_score,
    geography_score,
    certification_score,
    category_score,
    generated_by
  )
  select
    company_id,
    'tender',
    tender_id,
    70,
    70,
    70,
    70,
    70,
    'lot-match-test'
  from lot_match_test_tenants
  returning id, company_id
)
update lot_match_test_tenants fixture
set opportunity_match_id = inserted.id
from inserted
where inserted.company_id = fixture.company_id;

insert into public.opportunity_match_scores_v2 (
  opportunity_match_id,
  company_id,
  tender_id,
  score_v2,
  previous_score,
  score_delta,
  confidence_score,
  data_completeness_score,
  document_evidence_status,
  components,
  input_snapshot,
  input_hash,
  scoring_version
)
select
  opportunity_match_id,
  company_id,
  tender_id,
  70,
  70,
  0,
  70,
  70,
  'available',
  '{}'::jsonb,
  '{}'::jsonb,
  repeat(ordinal::text, 64),
  'matching-score-v2.0.0'
from lot_match_test_tenants;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into public.tender_lot_matches (
  company_id,
  tender_id,
  lot_key,
  lot_number,
  lot_title,
  status,
  match_score,
  recommendation,
  confidence_score,
  best_company_product_id,
  best_company_product_name,
  score_components,
  matched_requirements,
  input_hash,
  calculation_version
)
select
  company_id,
  tender_id,
  'lot:1',
  '1',
  'Sterile examination gloves',
  'completed',
  92,
  'strong_match',
  88,
  product_id,
  'Sterile nitrile examination glove',
  '{"product_identity":{"score":30,"max_score":30,"status":"matched"}}'::jsonb,
  '[{"code":"product_identity_match","message":"Exact match"}]'::jsonb,
  repeat(ordinal::text, 64),
  'lot-match-v1'
from lot_match_test_tenants
on conflict (company_id, tender_id, lot_key, calculation_version)
do update set input_hash = excluded.input_hash;

-- Repeating the same logical persistence operation must not create a row.
insert into public.tender_lot_matches (
  company_id,
  tender_id,
  lot_key,
  lot_number,
  lot_title,
  status,
  match_score,
  recommendation,
  confidence_score,
  best_company_product_id,
  best_company_product_name,
  input_hash,
  calculation_version
)
select
  company_id,
  tender_id,
  'lot:1',
  '1',
  'Sterile examination gloves',
  'completed',
  92,
  'strong_match',
  88,
  product_id,
  'Sterile nitrile examination glove',
  repeat(ordinal::text, 64),
  'lot-match-v1'
from lot_match_test_tenants
on conflict (company_id, tender_id, lot_key, calculation_version)
do update set input_hash = excluded.input_hash;

do $idempotency$
begin
  if (
    select count(*)
    from public.tender_lot_matches
    where calculation_version = 'lot-match-v1'
      and lot_key = 'lot:1'
  ) <> 2 then
    raise exception 'Lot-match persistence is not idempotent per tenant';
  end if;
end
$idempotency$;

select set_config(
  'medichall.lot_company_one',
  (select company_id::text from lot_match_test_tenants where ordinal = 1),
  true
);
select set_config(
  'medichall.lot_company_two',
  (select company_id::text from lot_match_test_tenants where ordinal = 2),
  true
);
select set_config(
  'medichall.lot_tender_one',
  (select tender_id::text from lot_match_test_tenants where ordinal = 1),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub',
    (select owner_id from lot_match_test_tenants where ordinal = 1),
    'role',
    'authenticated'
  )::text,
  true
);
set local role authenticated;

do $tenant_isolation$
declare
  v_rpc jsonb;
begin
  begin
    perform 1 from public.tender_lot_matches;
    raise exception 'Owner directly read private lot-match rows';
  exception
    when insufficient_privilege then null;
  end;

  v_rpc := public.get_tender_lot_matches_v1(
    current_setting('medichall.lot_company_one', true)::bigint,
    current_setting('medichall.lot_tender_one', true)::bigint
  );
  if jsonb_array_length(v_rpc -> 'lots') <> 1
    or (v_rpc -> 'lots' -> 0) ? 'input_hash'
    or (v_rpc -> 'lots' -> 0) ? 'normalized_lot'
  then
    raise exception 'Owner RPC is missing or exposes private calculation input';
  end if;

  begin
    perform public.get_tender_lot_matches_v1(
      current_setting('medichall.lot_company_two', true)::bigint,
      current_setting('medichall.lot_tender_one', true)::bigint
    );
    raise exception 'Owner accessed another company lot matches';
  exception
    when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm <> 'Access denied' then raise; end if;
  end;
end
$tenant_isolation$;

rollback;

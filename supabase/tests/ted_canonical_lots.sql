-- Run after 202608170001_ted_canonical_lots.sql.
-- All TED fixtures and reconciliation writes are transaction-local.

begin;

do $structure$
declare
  v_missing integer;
begin
  if to_regclass('public.tender_canonical_lots') is null
     or to_regclass('public.tender_canonical_lot_revisions') is null
     or to_regclass('public.tender_document_chunk_lot_mappings') is null then
    raise exception 'TED canonical lot persistence is incomplete';
  end if;
  if to_regprocedure(
    'public.replace_ted_canonical_lots_v1(bigint,text,text,text,jsonb)'
  ) is null then
    raise exception 'TED canonical lot replacement RPC is missing';
  end if;
  if to_regprocedure(
    'public.get_tender_canonical_lots_v1(bigint,bigint)'
  ) is null then
    raise exception 'TED canonical lot read RPC is missing';
  end if;

  select count(*) into v_missing
  from (
    values
      ('canonical_lots'),
      ('canonical_lot_count'),
      ('lot_structure_status'),
      ('lot_structure_source'),
      ('lot_structure_snapshot_hash'),
      ('lot_structure_diagnostics'),
      ('lot_structure_updated_at')
  ) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns definition
    where definition.table_schema = 'public'
      and definition.table_name = 'tenders'
      and definition.column_name = expected.column_name
  );
  if v_missing <> 0 then
    raise exception 'Tender canonical lot projection is missing % columns',
      v_missing;
  end if;

  if has_function_privilege(
    'anon',
    'public.replace_ted_canonical_lots_v1(bigint,text,text,text,jsonb)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.replace_ted_canonical_lots_v1(bigint,text,text,text,jsonb)',
    'execute'
  ) then
    raise exception 'Only service_role may replace authoritative TED lots';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.replace_ted_canonical_lots_v1(bigint,text,text,text,jsonb)',
    'execute'
  ) then
    raise exception 'Service role cannot replace authoritative TED lots';
  end if;
  if has_table_privilege(
    'authenticated', 'public.tender_canonical_lots', 'select'
  ) or has_table_privilege(
    'anon', 'public.tender_canonical_lots', 'select'
  ) then
    raise exception 'Browser roles must use the scoped canonical lot RPC';
  end if;
end
$structure$;

create temporary table ted_canonical_test (
  tender_id bigint not null,
  owner_id uuid not null,
  company_id bigint not null
) on commit drop;

with fixture_user as (
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
  ) values (
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'ted-canonical-fixture@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    false,
    false
  ) returning id
), fixture_company as (
  insert into public.companies (
    owner_id,
    name,
    type,
    country,
    is_approved,
    is_active
  )
  select
    id,
    'TED canonical fixture company',
    'Medical device manufacturer',
    'France',
    true,
    true
  from fixture_user
  returning id, owner_id
), fixture_tender as (
  insert into public.tenders (
    source,
    source_notice_id,
    title,
    source_url,
    status
  ) values (
    'TED',
    '499462-2026',
    'TED canonical 32-lot fixture',
    'https://ted.europa.eu/en/notice/-/detail/499462-2026',
    'open'
  ) returning id
)
insert into ted_canonical_test (tender_id, owner_id, company_id)
select fixture_tender.id, fixture_company.owner_id, fixture_company.id
from fixture_tender cross join fixture_company;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

with payload as (
  select jsonb_agg(
    jsonb_build_object(
      'position', ordinal,
      'official_lot_identifier',
        'LOT-' || lpad(ordinal::text, 4, '0'),
      'internal_lot_identifier',
        case ordinal
          when 30 then '159'
          when 31 then '160'
          when 32 then '161'
          else ordinal::text
        end,
      'lot_number', 'LOT-' || lpad(ordinal::text, 4, '0'),
      'lot_title', 'Official title ' || ordinal,
      'description', 'Official description ' || ordinal,
      'cpv_codes', jsonb_build_array('33141000'),
      'deadline_at', '2026-09-04',
      'estimated_value', null,
      'currency', null,
      'status', 'active',
      'source_type', 'TED_STRUCTURED',
      'publication_number', '499462-2026',
      'source_url',
        'https://ted.europa.eu/en/notice/-/detail/499462-2026',
      'source_payload', jsonb_build_object(
        'official_lot_identifier',
        'LOT-' || lpad(ordinal::text, 4, '0')
      )
    ) order by ordinal
  ) as lots
  from generate_series(1, 32) ordinal
)
select public.replace_ted_canonical_lots_v1(
  (select tender_id from ted_canonical_test),
  '499462-2026',
  'https://ted.europa.eu/en/notice/-/detail/499462-2026',
  repeat('a', 64),
  payload.lots
)
from payload;

do $reference_case$
declare
  v_tender_id bigint := (select tender_id from ted_canonical_test);
begin
  if (
    select canonical_lot_count from public.tenders where id = v_tender_id
  ) <> 32 then
    raise exception '499462-2026 did not reconcile to exactly 32 lots';
  end if;
  if (
    select count(*) from public.tender_canonical_lots
    where tender_id = v_tender_id and status = 'active'
  ) <> 32 then
    raise exception 'Canonical table and tender lot counts disagree';
  end if;
  if not exists (
    select 1 from public.tender_canonical_lots
    where tender_id = v_tender_id
      and official_lot_identifier = 'LOT-0030'
      and internal_lot_identifier = '159'
  ) then
    raise exception 'Internal identifier 159 was not aliased to LOT-0030';
  end if;
  if exists (
    select 1 from public.tender_canonical_lots
    where tender_id = v_tender_id
      and official_lot_identifier in ('159', '160', '161')
  ) then
    raise exception 'Numeric internal identifiers became phantom canonical lots';
  end if;
  if (
    select jsonb_array_length(canonical_lots)
    from public.tenders where id = v_tender_id
  ) <> 32 then
    raise exception 'UI projection does not contain all 32 canonical lots';
  end if;
end
$reference_case$;

-- Identical processing must not duplicate identities or revisions.
with payload as (
  select canonical_lots as lots
  from public.tenders
  where id = (select tender_id from ted_canonical_test)
)
select public.replace_ted_canonical_lots_v1(
  (select tender_id from ted_canonical_test),
  '499462-2026',
  'https://ted.europa.eu/en/notice/-/detail/499462-2026',
  repeat('a', 64),
  payload.lots
)
from payload;

do $idempotency$
declare
  v_tender_id bigint := (select tender_id from ted_canonical_test);
begin
  if (
    select count(*) from public.tender_canonical_lots
    where tender_id = v_tender_id and status = 'active'
  ) <> 32 then
    raise exception 'Identical processing duplicated canonical lots';
  end if;
  if (
    select count(*) from public.tender_canonical_lot_revisions
    where tender_id = v_tender_id
  ) <> 32 then
    raise exception 'Identical processing duplicated lot revisions';
  end if;
end
$idempotency$;

-- Simulate a structured amendment: rename LOT-0001 and remove LOT-0032.
with payload as (
  select jsonb_agg(
    case
      when item ->> 'official_lot_identifier' = 'LOT-0001'
      then jsonb_set(item, '{lot_title}', '"Amended official title"'::jsonb)
      else item
    end order by (item ->> 'position')::integer
  ) as lots
  from public.tenders tender,
    lateral jsonb_array_elements(tender.canonical_lots) item
  where tender.id = (select tender_id from ted_canonical_test)
    and item ->> 'official_lot_identifier' <> 'LOT-0032'
)
select public.replace_ted_canonical_lots_v1(
  (select tender_id from ted_canonical_test),
  '499462-2026',
  'https://ted.europa.eu/en/notice/-/detail/499462-2026',
  repeat('b', 64),
  payload.lots
)
from payload;

do $amendment$
declare
  v_tender_id bigint := (select tender_id from ted_canonical_test);
begin
  if (
    select canonical_lot_count from public.tenders where id = v_tender_id
  ) <> 31 then
    raise exception 'Amended canonical projection did not update its count';
  end if;
  if not exists (
    select 1 from public.tender_canonical_lots
    where tender_id = v_tender_id
      and official_lot_identifier = 'LOT-0001'
      and official_title = 'Amended official title'
      and status = 'active'
  ) then
    raise exception 'Canonical identity was not preserved across rename';
  end if;
  if not exists (
    select 1 from public.tender_canonical_lots
    where tender_id = v_tender_id
      and official_lot_identifier = 'LOT-0032'
      and status = 'removed'
      and removed_at is not null
  ) then
    raise exception 'Removed official lot was not deactivated safely';
  end if;
  if (
    select count(*) from public.tender_canonical_lot_revisions
    where tender_id = v_tender_id
      and official_lot_identifier = 'LOT-0001'
  ) <> 2 then
    raise exception 'Lot amendment history was not preserved';
  end if;
end
$amendment$;

-- The owner-scoped read path returns only the selected tender projection.
select set_config(
  'ted_canonical_test.tender_id',
  (select tender_id::text from ted_canonical_test),
  true
);
select set_config(
  'ted_canonical_test.company_id',
  (select company_id::text from ted_canonical_test),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select owner_id from ted_canonical_test),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $owner_read$
declare
  v_result jsonb;
begin
  v_result := public.get_tender_canonical_lots_v1(
    current_setting('ted_canonical_test.company_id')::bigint,
    current_setting('ted_canonical_test.tender_id')::bigint
  );
  if (v_result ->> 'canonical_lot_count')::integer <> 31 then
    raise exception 'Owner-scoped canonical lot RPC returned the wrong count';
  end if;
end
$owner_read$;

reset role;

-- An authenticated user who does not own the supplied company cannot cross
-- the tenant boundary, even though the read RPC itself is executable.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', gen_random_uuid(),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $tenant_isolation$
begin
  begin
    perform public.get_tender_canonical_lots_v1(
      current_setting('ted_canonical_test.company_id')::bigint,
      current_setting('ted_canonical_test.tender_id')::bigint
    );
    raise exception 'Unauthorized tenant read unexpectedly succeeded';
  exception
    when sqlstate '42501' then null;
  end;
end
$tenant_isolation$;

reset role;

rollback;

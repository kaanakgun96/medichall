-- Run after 202608200002_ted_canonical_lots_access_hotfix.sql.
-- All authorization fixtures and writes are transaction-local.

begin;

do $structure$
declare
  v_policy record;
begin
  for v_policy in
    select tablename, policyname, coalesce(qual, '') as qual,
      coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname = 'public'
      and (tablename, policyname) in (
        ('company_match_profiles', 'owner manage own match profile'),
        ('opportunity_matches', 'owner read own opportunity matches'),
        ('tender_imports', 'owners read own tender imports'),
        ('tenders', 'owners read own imported tenders')
      )
  loop
    if (v_policy.qual || v_policy.with_check)
       not like '%company_owner_authorized_v1%' then
      raise exception 'Policy %.% does not use the privileged owner helper',
        v_policy.tablename, v_policy.policyname;
    end if;
    if (v_policy.qual || v_policy.with_check) ~* '\m(from|join)\M[^;]*\mcompanies\M' then
      raise exception 'Policy %.% still queries companies as the caller',
        v_policy.tablename, v_policy.policyname;
    end if;
  end loop;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and (tablename, policyname) in (
        ('company_match_profiles', 'owner manage own match profile'),
        ('opportunity_matches', 'owner read own opportunity matches'),
        ('tender_imports', 'owners read own tender imports'),
        ('tenders', 'owners read own imported tenders')
      )
  ) <> 4 then
    raise exception 'Tender access hotfix policy set is incomplete';
  end if;

  if has_column_privilege(
    'authenticated', 'public.companies', 'contact_email', 'select'
  ) or has_column_privilege(
    'authenticated', 'public.companies', 'phone', 'select'
  ) or has_column_privilege(
    'authenticated', 'public.companies', 'owner_id', 'select'
  ) then
    raise exception 'Company privacy was weakened by the tender hotfix';
  end if;

  if has_table_privilege(
    'authenticated', 'public.tender_canonical_lots', 'select'
  ) then
    raise exception 'Canonical lot table received a broad browser grant';
  end if;
end
$structure$;

create temporary table tender_access_hotfix_test (
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  tender_id bigint
) on commit drop;

insert into tender_access_hotfix_test (ordinal, user_id)
values
  (1, gen_random_uuid()),
  (2, gen_random_uuid()),
  (3, gen_random_uuid());

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
  user_id,
  'authenticated',
  'authenticated',
  'tender-access-hotfix-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from tender_access_hotfix_test;

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
    user_id,
    'Tender access hotfix fixture ' || ordinal,
    'Medical device manufacturer',
    'Türkiye',
    true,
    true
  from tender_access_hotfix_test
  returning id, owner_id
)
update tender_access_hotfix_test fixture
set company_id = inserted.id
from inserted
where inserted.owner_id = fixture.user_id;

insert into public.admins (user_id)
select user_id from tender_access_hotfix_test where ordinal = 3;

with inserted as (
  insert into public.tenders (
    source,
    source_notice_id,
    title,
    source_url,
    status
  ) values (
    'QA',
    'TENDER-ACCESS-HOTFIX-20260820',
    'Tender access hotfix fixture',
    'https://example.invalid/tender-access-hotfix',
    'open'
  ) returning id
)
update tender_access_hotfix_test
set tender_id = inserted.id
from inserted;

insert into public.company_match_profiles (company_id, product_keywords)
select company_id, array['surgical drape']::text[]
from tender_access_hotfix_test
where ordinal in (1, 2);

insert into public.opportunity_matches (
  company_id,
  opportunity_type,
  tender_id,
  match_score,
  generated_by
)
select
  company_id,
  'tender',
  tender_id,
  75,
  'tender-access-hotfix-regression'
from tender_access_hotfix_test
where ordinal in (1, 2);

insert into public.tender_imports (
  tender_id,
  company_id,
  requested_by,
  source_kind,
  display_name,
  idempotency_key,
  source_fingerprint,
  idempotency_expires_at
)
select
  tender_id,
  company_id,
  user_id,
  'files',
  'Access hotfix fixture',
  'tender-access-hotfix-20260820',
  repeat('a', 64),
  now() + interval '30 days'
from tender_access_hotfix_test
where ordinal = 1;

select set_config(
  'tender_access_hotfix.company_a_id',
  (select company_id::text from tender_access_hotfix_test where ordinal = 1),
  true
);
select set_config(
  'tender_access_hotfix.company_b_id',
  (select company_id::text from tender_access_hotfix_test where ordinal = 2),
  true
);
select set_config(
  'tender_access_hotfix.tender_id',
  (select tender_id::text from tender_access_hotfix_test where ordinal = 1),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from tender_access_hotfix_test where ordinal = 1),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $company_a$
declare
  v_company_a bigint :=
    current_setting('tender_access_hotfix.company_a_id')::bigint;
  v_company_b bigint :=
    current_setting('tender_access_hotfix.company_b_id')::bigint;
  v_tender_id bigint :=
    current_setting('tender_access_hotfix.tender_id')::bigint;
  v_canonical jsonb;
begin
  if (select count(*) from public.company_match_profiles
      where company_id = v_company_a) <> 1
     or (select count(*) from public.company_match_profiles
         where company_id = v_company_b) <> 0 then
    raise exception 'Company match profile ownership is not isolated';
  end if;

  if (
    select count(*)
    from public.opportunity_matches match_row
    join public.tenders tender on tender.id = match_row.tender_id
    where match_row.company_id = v_company_a
      and tender.id = v_tender_id
  ) <> 1 then
    raise exception 'My Matches tender relationship is unavailable';
  end if;

  if (
    select count(*)
    from public.tenders tender
    where tender.id = v_tender_id
      and tender.canonical_lot_count = 0
      and jsonb_array_length(tender.canonical_lots) = 0
  ) <> 1 then
    raise exception 'Tender canonical projection is unavailable';
  end if;

  if (select count(*) from public.tender_imports
      where tender_id = v_tender_id and company_id = v_company_a) <> 1 then
    raise exception 'Owner tender import access is unavailable';
  end if;

  v_canonical := public.get_tender_canonical_lots_v1(
    v_company_a,
    v_tender_id
  );
  if (v_canonical ->> 'canonical_lot_count')::integer <> 0 then
    raise exception 'Canonical lot RPC returned an unexpected projection';
  end if;

  if not exists (
    select 1
    from public.search_tenders(
      p_query => 'Tender access hotfix fixture',
      p_limit => 20,
      p_offset => 0
    ) result
    where result.id = v_tender_id
  ) then
    raise exception 'All Tenders search cannot return the fixture';
  end if;
end
$company_a$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from tender_access_hotfix_test where ordinal = 2),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $company_b$
declare
  v_company_a bigint :=
    current_setting('tender_access_hotfix.company_a_id')::bigint;
  v_company_b bigint :=
    current_setting('tender_access_hotfix.company_b_id')::bigint;
  v_tender_id bigint :=
    current_setting('tender_access_hotfix.tender_id')::bigint;
begin
  if (select count(*) from public.company_match_profiles
      where company_id = v_company_b) <> 1
     or (select count(*) from public.company_match_profiles
         where company_id = v_company_a) <> 0 then
    raise exception 'Cross-company match profile isolation failed';
  end if;

  if (select count(*) from public.opportunity_matches
      where company_id = v_company_b and tender_id = v_tender_id) <> 1
     or (select count(*) from public.opportunity_matches
         where company_id = v_company_a) <> 0 then
    raise exception 'Cross-company My Matches isolation failed';
  end if;

  if (select count(*) from public.tender_imports
      where tender_id = v_tender_id) <> 0 then
    raise exception 'Cross-company private tender import became visible';
  end if;

  if (select count(*) from public.tenders where id = v_tender_id) <> 1 then
    raise exception 'Open tender discovery changed for another company';
  end if;
end
$company_b$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from tender_access_hotfix_test where ordinal = 3),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

do $admin$
declare
  v_tender_id bigint :=
    current_setting('tender_access_hotfix.tender_id')::bigint;
begin
  if not public.is_admin()
     or (select count(*) from public.company_match_profiles) < 2
     or (select count(*) from public.opportunity_matches
         where tender_id = v_tender_id) <> 2
     or (select count(*) from public.tender_imports
         where tender_id = v_tender_id) <> 1 then
    raise exception 'Admin tender access regressed';
  end if;
end
$admin$;

reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $anonymous$
declare
  v_tender_id bigint :=
    current_setting('tender_access_hotfix.tender_id')::bigint;
begin
  if (select count(*) from public.tenders where id = v_tender_id) <> 0 then
    raise exception 'Anonymous tender behavior broadened unexpectedly';
  end if;
  if has_table_privilege(
    'anon', 'public.tender_canonical_lots', 'select'
  ) then
    raise exception 'Anonymous canonical table access was added';
  end if;
end
$anonymous$;

reset role;

select 'PASS'::text as ted_canonical_lots_access_hotfix_regression;

rollback;

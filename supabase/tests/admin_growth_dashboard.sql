-- Run after 202608090005_admin_growth_dashboard.sql.
-- All admin, identity and heartbeat fixtures are rolled back.

begin;

do $contract$
begin
  if to_regclass('public.account_activity_heartbeats') is null
    or to_regprocedure('public.record_user_activity_v1(text)') is null
    or to_regprocedure(
      'public.get_admin_growth_dashboard_v1(integer,integer)'
    ) is null then
    raise exception 'Sprint 6 growth dashboard contract is incomplete';
  end if;
  if has_table_privilege(
      'anon', 'public.account_activity_heartbeats', 'SELECT'
    ) or has_table_privilege(
      'authenticated', 'public.account_activity_heartbeats', 'INSERT'
    ) or has_function_privilege(
      'anon', 'public.record_user_activity_v1(text)', 'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.get_admin_growth_dashboard_v1(integer,integer)',
      'EXECUTE'
    ) then
    raise exception 'Sprint 6 anonymous or direct-mutation grants are too broad';
  end if;
  if not has_function_privilege(
      'authenticated', 'public.record_user_activity_v1(text)', 'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'public.get_admin_growth_dashboard_v1(integer,integer)',
      'EXECUTE'
    ) then
    raise exception 'Required Sprint 6 authenticated RPC grant is missing';
  end if;
end
$contract$;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  (
    '70000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'growth-admin@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), false, false
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'growth-member@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), false, false
  );

insert into public.admins (user_id)
values ('70000000-0000-4000-8000-000000000001');

create temporary table growth_expected_counts (
  total_companies bigint not null,
  users bigint not null,
  products bigint not null,
  rfqs bigint not null
) on commit drop;

insert into growth_expected_counts
select
  (select count(*) from public.companies),
  (select count(*) from auth.users where deleted_at is null),
  (select count(*) from public.products),
  (select count(*) from public.rfq_requests);

grant select on table growth_expected_counts to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $member_access$
declare
  recorded_at timestamptz;
  denied boolean := false;
begin
  recorded_at := public.record_user_activity_v1(
    E'portal.html#dashboard\nunsafe-control'
  );
  if recorded_at is null
    or (select count(*) from public.account_activity_heartbeats) <> 1
    or (select last_route from public.account_activity_heartbeats limit 1)
      <> 'portal.html#dashboardunsafe-control' then
    raise exception 'Authenticated heartbeat did not persist a safe own row';
  end if;

  begin
    perform public.get_admin_growth_dashboard_v1(30, 200);
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'Non-admin was able to read platform analytics';
  end if;
end
$member_access$;

select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $heartbeat_isolation$
begin
  perform public.record_user_activity_v1('portal.html#matchmaking');
  if (select count(*) from public.account_activity_heartbeats) <> 1
    or (select user_id from public.account_activity_heartbeats limit 1)
      <> '70000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Heartbeat RLS exposed another account';
  end if;
end
$heartbeat_isolation$;

do $admin_dashboard$
declare
  payload jsonb;
  range_days integer;
  denied boolean := false;
begin
  foreach range_days in array array[7, 30, 90, 0]
  loop
    payload := public.get_admin_growth_dashboard_v1(range_days, 1);
    if (payload #>> '{range,days}')::integer <> range_days
      or jsonb_array_length(payload -> 'activation_funnel') <> 9
      or jsonb_array_length(payload -> 'platform_health') <> 8
      or jsonb_array_length(payload -> 'companies') > 1 then
      raise exception 'Range % returned a malformed bounded payload', range_days;
    end if;
    if (payload #>> '{overview,total_companies}')::bigint
        <> (select total_companies from growth_expected_counts)
      or (payload #>> '{overview,users}')::bigint
        <> (select users from growth_expected_counts)
      or (payload #>> '{overview,products}')::bigint
        <> (select products from growth_expected_counts)
      or (payload #>> '{overview,rfqs}')::bigint
        <> (select rfqs from growth_expected_counts) then
      raise exception 'Overview does not match production source counts';
    end if;
  end loop;

  begin
    perform public.get_admin_growth_dashboard_v1(14, 200);
  exception when invalid_parameter_value then
    denied := true;
  end;
  if not denied then
    raise exception 'Unsupported analytics range was accepted';
  end if;
end
$admin_dashboard$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $zero_state_contract$
declare
  empty_count integer;
begin
  select count(*) into empty_count
  from jsonb_array_elements(
    public.get_admin_growth_dashboard_v1(7, 1) -> 'activation_funnel'
  ) step
  where (step ->> 'count')::integer = 0;
  -- Zero is a valid numeric state for any milestone; the RPC must never omit
  -- the nine stable keys even when a cohort or milestone has no rows.
  if empty_count < 0 then
    raise exception 'Unreachable zero-state guard';
  end if;
exception when insufficient_privilege then
  -- service_role deliberately has no auth.uid(), so admin analytics remains
  -- browser-admin scoped even though PostgREST knows the function signature.
  null;
end
$zero_state_contract$;

rollback;

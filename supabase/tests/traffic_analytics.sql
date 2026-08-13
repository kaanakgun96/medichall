-- Run after 202608130002_traffic_analytics.sql.
-- All synthetic visitors, sessions, views, identities and admin rows roll back.

begin;

do $contract$
begin
  if to_regclass('public.traffic_analytics_visitors') is null
    or to_regclass('public.traffic_analytics_sessions') is null
    or to_regclass('public.traffic_analytics_page_views') is null
    or to_regprocedure(
      'public.record_traffic_page_view_v1(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean)'
    ) is null
    or to_regprocedure('public.get_admin_traffic_analytics_v1(text)') is null
    or to_regprocedure('public.prune_traffic_analytics_v1()') is null then
    raise exception 'Traffic analytics contract is incomplete';
  end if;
  if has_table_privilege('anon', 'public.traffic_analytics_page_views', 'SELECT')
    or has_table_privilege('authenticated', 'public.traffic_analytics_page_views', 'SELECT')
    or has_table_privilege('anon', 'public.traffic_analytics_sessions', 'INSERT')
    or has_function_privilege(
      'anon',
      'public.record_traffic_page_view_v1(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.record_traffic_page_view_v1(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon', 'public.get_admin_traffic_analytics_v1(text)', 'EXECUTE'
    ) then
    raise exception 'Traffic analytics grants are too broad';
  end if;
  if not has_function_privilege(
    'authenticated', 'public.get_admin_traffic_analytics_v1(text)', 'EXECUTE'
  ) then
    raise exception 'Admin traffic aggregate grant is missing';
  end if;
end
$contract$;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  (
    '84000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'traffic-admin@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), false, false
  ),
  (
    '84000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'traffic-member@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), false, false
  );

insert into public.admins (user_id)
values ('84000000-0000-4000-8000-000000000001');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select public.record_traffic_page_view_v1(
  '85000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000011',
  '85000000-0000-4000-8000-000000000021',
  'homepage', 'TR', 'direct', null, null, null, null,
  'desktop', 'chrome', false
);
select public.record_traffic_page_view_v1(
  '85000000-0000-4000-8000-000000000002',
  '85000000-0000-4000-8000-000000000011',
  '85000000-0000-4000-8000-000000000021',
  'products', 'TR', 'internal', 'medichall.com', null, null, null,
  'desktop', 'chrome', true
);
select public.record_traffic_page_view_v1(
  '85000000-0000-4000-8000-000000000003',
  '85000000-0000-4000-8000-000000000012',
  '85000000-0000-4000-8000-000000000022',
  'tenders', null, 'linkedin', 'linkedin.com',
  'linkedin', 'social', 'open beta', 'mobile', 'safari', false
);

do $idempotency$
declare
  result jsonb;
begin
  result := public.record_traffic_page_view_v1(
    '85000000-0000-4000-8000-000000000003',
    '85000000-0000-4000-8000-000000000012',
    '85000000-0000-4000-8000-000000000022',
    'tenders', null, 'linkedin', 'linkedin.com',
    'linkedin', 'social', 'open beta', 'mobile', 'safari', false
  );
  if result ->> 'deduplicated' <> 'true'
    or (select count(*) from public.traffic_analytics_page_views
      where event_id = '85000000-0000-4000-8000-000000000003') <> 1
    or (select total_views from public.traffic_analytics_visitors
      where visitor_id = '85000000-0000-4000-8000-000000000012') <> 1 then
    raise exception 'Duplicate event changed traffic counters';
  end if;
end
$idempotency$;

do $validation$
declare denied boolean := false;
begin
  begin
    perform public.record_traffic_page_view_v1(
      '85000000-0000-4000-8000-000000000004',
      '85000000-0000-4000-8000-000000000011',
      '85000000-0000-4000-8000-000000000021',
      '/products?token=private', null, 'direct', null, null, null, null,
      'desktop', 'chrome', false
    );
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'Invalid raw route was accepted'; end if;
end
$validation$;

reset role;

do $bounded_fixture$
begin
  if (select count(*) from public.traffic_analytics_visitors
      where visitor_id::text like '85000000-%') <> 2
    or (select count(*) from public.traffic_analytics_sessions
      where session_id::text like '85000000-%') <> 2
    or (select count(*) from public.traffic_analytics_page_views
      where event_id::text like '85000000-%') <> 3 then
    raise exception 'Bounded traffic fixture count is incorrect';
  end if;
end
$bounded_fixture$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"84000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $member_denial$
declare denied boolean := false;
begin
  begin perform public.get_admin_traffic_analytics_v1('30d');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Non-admin read global traffic analytics'; end if;
end
$member_denial$;

select set_config(
  'request.jwt.claims',
  '{"sub":"84000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $admin_aggregation$
declare
  payload jsonb;
  range_key text;
  denied boolean := false;
begin
  foreach range_key in array array['today','7d','30d','90d','all'] loop
    payload := public.get_admin_traffic_analytics_v1(range_key);
    if payload #>> '{range,key}' <> range_key
      or jsonb_typeof(payload -> 'summary') <> 'object'
      or jsonb_typeof(payload -> 'top_pages') <> 'array'
      or jsonb_typeof(payload -> 'countries') <> 'array'
      or jsonb_typeof(payload -> 'sources') <> 'array'
      or jsonb_typeof(payload -> 'campaigns') <> 'array' then
      raise exception 'Traffic aggregate malformed for %', range_key;
    end if;
  end loop;
  payload := public.get_admin_traffic_analytics_v1('30d');
  if (payload #>> '{summary,page_views}')::integer < 3
    or (payload #>> '{summary,unique_visitors}')::integer < 2
    or (payload #>> '{summary,sessions}')::integer < 2
    or (payload #>> '{live,active_5m}')::integer < 2 then
    raise exception 'Traffic summary or live calculation omitted QA events';
  end if;
  begin perform public.get_admin_traffic_analytics_v1('14d');
  exception when invalid_parameter_value then denied := true;
  end;
  if not denied then raise exception 'Invalid traffic time filter was accepted'; end if;
end
$admin_aggregation$;

rollback;

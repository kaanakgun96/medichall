-- Rollback-only production contract for Sprint 7 acquisition analytics.
begin;

do $contract$
declare
  forbidden_columns integer;
begin
  if to_regclass('public.traffic_analytics_conversions') is null
    or to_regprocedure('public.record_traffic_conversion_v1(uuid,uuid,uuid,text,boolean)') is null
    or to_regprocedure('public.get_admin_acquisition_funnel_v1(text)') is null then
    raise exception 'Sprint 7 acquisition analytics objects are missing';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.traffic_analytics_conversions'::regclass) then
    raise exception 'Conversion RLS is not enabled and forced';
  end if;
  if has_table_privilege('anon', 'public.traffic_analytics_conversions', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.traffic_analytics_conversions', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Browser role can mutate or read raw conversions';
  end if;
  if has_function_privilege('anon', 'public.record_traffic_conversion_v1(uuid,uuid,uuid,text,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_traffic_conversion_v1(uuid,uuid,uuid,text,boolean)', 'EXECUTE') then
    raise exception 'Browser role can call conversion ingress directly';
  end if;
  select count(*) into forbidden_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'traffic_analytics_conversions'
    and column_name in ('user_id','company_id','email','raw_url','search_text','event_payload','ip_address');
  if forbidden_columns <> 0 then
    raise exception 'Conversion table contains an identity or content field';
  end if;
end
$contract$;

set local role service_role;

insert into public.traffic_analytics_visitors (
  visitor_id, first_seen_at, last_seen_at, first_session_id, last_session_id,
  session_count, total_views
) values (
  '85000000-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(),
  '85000000-0000-4000-8000-000000000002',
  '85000000-0000-4000-8000-000000000002', 1, 1
);

insert into public.traffic_analytics_sessions (
  session_id, visitor_id, started_at, last_seen_at, view_count,
  is_new_visitor, has_authenticated_view, acquisition_source,
  utm_source, utm_medium, utm_campaign, device_category, browser_family
) values (
  '85000000-0000-4000-8000-000000000002',
  '85000000-0000-4000-8000-000000000001',
  clock_timestamp(), clock_timestamp(), 1, true, true, 'linkedin',
  'linkedin', 'organic-social', 'open-beta', 'desktop', 'safari'
);

select public.record_traffic_conversion_v1(
  '85000000-0000-4000-8000-000000000003',
  '85000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000002',
  'signup_completed', true
);

select public.record_traffic_conversion_v1(
  '85000000-0000-4000-8000-000000000003',
  '85000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000002',
  'signup_completed', true
);

do $idempotency$
begin
  if (select count(*) from public.traffic_analytics_conversions where event_id = '85000000-0000-4000-8000-000000000003') <> 1 then
    raise exception 'Conversion retry was not idempotent';
  end if;
  if (select acquisition_source from public.traffic_analytics_conversions where event_id = '85000000-0000-4000-8000-000000000003') <> 'linkedin' then
    raise exception 'First-touch acquisition source was not inherited from the session';
  end if;
end
$idempotency$;

rollback;

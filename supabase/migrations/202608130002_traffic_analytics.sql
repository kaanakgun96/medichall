-- MedicHall first-party, privacy-minimized website traffic analytics.
-- Existing business growth metrics remain unchanged. Browser traffic reaches
-- only the traffic-analytics Edge Function; raw tables have no browser grants.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null
    or to_regclass('cron.job') is null then
    raise exception 'Traffic analytics dependency is missing';
  end if;
end
$preflight$;

create table public.traffic_analytics_visitors (
  visitor_id uuid primary key,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  first_session_id uuid not null,
  last_session_id uuid not null,
  session_count integer not null default 0 check (session_count >= 0),
  total_views bigint not null default 0 check (total_views >= 0),
  check (visitor_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (first_session_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (last_session_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

create table public.traffic_analytics_sessions (
  session_id uuid primary key,
  visitor_id uuid not null
    references public.traffic_analytics_visitors(visitor_id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  view_count integer not null default 0 check (view_count >= 0),
  is_new_visitor boolean not null,
  has_authenticated_view boolean not null default false,
  country_code text,
  acquisition_source text not null,
  referrer_domain text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device_category text not null,
  browser_family text not null,
  check (session_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  check (acquisition_source in (
    'direct', 'google', 'linkedin', 'bing', 'other_search',
    'other_referral', 'internal'
  )),
  check (referrer_domain is null or (
    length(referrer_domain) between 1 and 253
    and referrer_domain ~ '^[a-z0-9.-]+$'
  )),
  check (utm_source is null or (
    length(utm_source) between 1 and 64 and utm_source ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (utm_medium is null or (
    length(utm_medium) between 1 and 64 and utm_medium ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (utm_campaign is null or (
    length(utm_campaign) between 1 and 100 and utm_campaign ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (device_category in ('desktop', 'mobile', 'tablet', 'other')),
  check (browser_family in ('chrome', 'safari', 'edge', 'firefox', 'other'))
);

create table public.traffic_analytics_page_views (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  visitor_id uuid not null
    references public.traffic_analytics_visitors(visitor_id) on delete cascade,
  session_id uuid not null
    references public.traffic_analytics_sessions(session_id) on delete cascade,
  occurred_at timestamptz not null default clock_timestamp(),
  route_id text not null,
  is_authenticated boolean not null default false,
  country_code text,
  acquisition_source text not null,
  referrer_domain text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  device_category text not null,
  browser_family text not null,
  check (event_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (route_id in (
    'homepage', 'products', 'product_detail', 'companies',
    'company_showroom', 'tenders', 'tender_detail', 'matchmaking',
    'login', 'signup', 'portal', 'portal_dashboard', 'portal_products',
    'portal_opportunities', 'portal_messages', 'portal_matchmaking',
    'portal_profile', 'portal_ai', 'react_dashboard', 'react_all_tenders',
    'react_opportunities', 'react_company_profile'
  )),
  check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  check (acquisition_source in (
    'direct', 'google', 'linkedin', 'bing', 'other_search',
    'other_referral', 'internal'
  )),
  check (referrer_domain is null or (
    length(referrer_domain) between 1 and 253
    and referrer_domain ~ '^[a-z0-9.-]+$'
  )),
  check (utm_source is null or (
    length(utm_source) between 1 and 64 and utm_source ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (utm_medium is null or (
    length(utm_medium) between 1 and 64 and utm_medium ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (utm_campaign is null or (
    length(utm_campaign) between 1 and 100 and utm_campaign ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (device_category in ('desktop', 'mobile', 'tablet', 'other')),
  check (browser_family in ('chrome', 'safari', 'edge', 'firefox', 'other'))
);

create index traffic_analytics_visitors_last_seen_idx
on public.traffic_analytics_visitors(last_seen_at desc);

create index traffic_analytics_sessions_started_idx
on public.traffic_analytics_sessions(started_at desc);

create index traffic_analytics_sessions_last_seen_idx
on public.traffic_analytics_sessions(last_seen_at desc);

create index traffic_analytics_sessions_visitor_started_idx
on public.traffic_analytics_sessions(visitor_id, started_at desc);

create index traffic_analytics_sessions_source_started_idx
on public.traffic_analytics_sessions(acquisition_source, started_at desc);

create index traffic_analytics_page_views_occurred_idx
on public.traffic_analytics_page_views(occurred_at desc);

create index traffic_analytics_page_views_route_occurred_idx
on public.traffic_analytics_page_views(route_id, occurred_at desc);

create index traffic_analytics_page_views_visitor_occurred_idx
on public.traffic_analytics_page_views(visitor_id, occurred_at desc);

create index traffic_analytics_page_views_session_occurred_idx
on public.traffic_analytics_page_views(session_id, occurred_at desc);

create index traffic_analytics_page_views_country_occurred_idx
on public.traffic_analytics_page_views(country_code, occurred_at desc)
where country_code is not null;

create index traffic_analytics_page_views_source_occurred_idx
on public.traffic_analytics_page_views(acquisition_source, occurred_at desc);

alter table public.traffic_analytics_visitors enable row level security;
alter table public.traffic_analytics_visitors force row level security;
alter table public.traffic_analytics_sessions enable row level security;
alter table public.traffic_analytics_sessions force row level security;
alter table public.traffic_analytics_page_views enable row level security;
alter table public.traffic_analytics_page_views force row level security;

revoke all on table public.traffic_analytics_visitors
  from public, anon, authenticated;
revoke all on table public.traffic_analytics_sessions
  from public, anon, authenticated;
revoke all on table public.traffic_analytics_page_views
  from public, anon, authenticated;
grant all on table public.traffic_analytics_visitors to service_role;
grant all on table public.traffic_analytics_sessions to service_role;
grant all on table public.traffic_analytics_page_views to service_role;
grant usage, select on sequence public.traffic_analytics_page_views_id_seq
  to service_role;

create or replace function public.record_traffic_page_view_v1(
  p_event_id uuid,
  p_visitor_id uuid,
  p_session_id uuid,
  p_route_id text,
  p_country_code text default null,
  p_acquisition_source text default 'direct',
  p_referrer_domain text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_device_category text default 'other',
  p_browser_family text default 'other',
  p_is_authenticated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  recorded_at timestamptz := clock_timestamp();
  existing_id bigint;
  existing_session_visitor uuid;
  existing_session_last_seen timestamptz;
  existing_session_views integer;
  visitor_created boolean := false;
  session_created boolean := false;
  safe_country text := nullif(upper(trim(coalesce(p_country_code, ''))), '');
  safe_referrer text := nullif(lower(trim(coalesce(p_referrer_domain, ''))), '');
  safe_utm_source text := nullif(lower(trim(coalesce(p_utm_source, ''))), '');
  safe_utm_medium text := nullif(lower(trim(coalesce(p_utm_medium, ''))), '');
  safe_utm_campaign text := nullif(lower(trim(coalesce(p_utm_campaign, ''))), '');
begin
  if p_event_id is null or p_visitor_id is null or p_session_id is null
    or p_event_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_visitor_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_session_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Valid event, visitor, and session identifiers are required'
      using errcode = '22023';
  end if;
  if p_route_id is null or p_route_id not in (
    'homepage', 'products', 'product_detail', 'companies',
    'company_showroom', 'tenders', 'tender_detail', 'matchmaking',
    'login', 'signup', 'portal', 'portal_dashboard', 'portal_products',
    'portal_opportunities', 'portal_messages', 'portal_matchmaking',
    'portal_profile', 'portal_ai', 'react_dashboard', 'react_all_tenders',
    'react_opportunities', 'react_company_profile'
  ) then
    raise exception 'Invalid normalized route' using errcode = '22023';
  end if;
  if safe_country is not null and safe_country !~ '^[A-Z]{2}$' then
    raise exception 'Invalid country code' using errcode = '22023';
  end if;
  if p_acquisition_source is null or p_acquisition_source not in (
    'direct', 'google', 'linkedin', 'bing', 'other_search',
    'other_referral', 'internal'
  ) then
    raise exception 'Invalid acquisition source' using errcode = '22023';
  end if;
  if safe_referrer is not null and (
    length(safe_referrer) > 253 or safe_referrer !~ '^[a-z0-9.-]+$'
  ) then
    raise exception 'Invalid referrer domain' using errcode = '22023';
  end if;
  if safe_utm_source is not null and (
      length(safe_utm_source) > 64
      or safe_utm_source !~ '^[a-z0-9][a-z0-9._ -]*$'
    ) or safe_utm_medium is not null and (
      length(safe_utm_medium) > 64
      or safe_utm_medium !~ '^[a-z0-9][a-z0-9._ -]*$'
    ) or safe_utm_campaign is not null and (
      length(safe_utm_campaign) > 100
      or safe_utm_campaign !~ '^[a-z0-9][a-z0-9._ -]*$'
    ) then
    raise exception 'Invalid campaign attribution' using errcode = '22023';
  end if;
  if p_device_category not in ('desktop', 'mobile', 'tablet', 'other')
    or p_browser_family not in ('chrome', 'safari', 'edge', 'firefox', 'other') then
    raise exception 'Invalid device classification' using errcode = '22023';
  end if;

  -- Serialize identical event IDs before touching counters so a retry is a
  -- true no-op even when the original request is still in flight.
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 713));
  select id into existing_id
  from public.traffic_analytics_page_views
  where event_id = p_event_id;
  if existing_id is not null then
    return jsonb_build_object(
      'recorded', false, 'deduplicated', true, 'event_id', p_event_id
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_visitor_id::text, 719));
  insert into public.traffic_analytics_visitors (
    visitor_id, first_seen_at, last_seen_at, first_session_id, last_session_id
  ) values (
    p_visitor_id, recorded_at, recorded_at, p_session_id, p_session_id
  )
  on conflict (visitor_id) do nothing;
  visitor_created := found;

  insert into public.traffic_analytics_sessions (
    session_id, visitor_id, started_at, last_seen_at, is_new_visitor,
    has_authenticated_view, country_code, acquisition_source,
    referrer_domain, utm_source, utm_medium, utm_campaign,
    device_category, browser_family
  ) values (
    p_session_id, p_visitor_id, recorded_at, recorded_at, visitor_created,
    coalesce(p_is_authenticated, false), safe_country, p_acquisition_source,
    safe_referrer, safe_utm_source, safe_utm_medium, safe_utm_campaign,
    p_device_category, p_browser_family
  )
  on conflict (session_id) do nothing;
  session_created := found;

  if not session_created then
    select visitor_id, last_seen_at, view_count
    into existing_session_visitor, existing_session_last_seen, existing_session_views
    from public.traffic_analytics_sessions
    where session_id = p_session_id;
    if existing_session_visitor is distinct from p_visitor_id then
      raise exception 'Session identifier belongs to another visitor'
        using errcode = '22023';
    end if;
    if existing_session_last_seen < recorded_at - interval '30 minutes' then
      raise exception 'Analytics session has expired' using errcode = '22023';
    end if;
    if existing_session_views >= 200 then
      raise exception 'Analytics session event limit reached' using errcode = '22023';
    end if;
  end if;

  -- Persist first-touch session attribution on every event. This prevents
  -- internal navigation from being mislabelled as a new acquisition source.
  insert into public.traffic_analytics_page_views (
    event_id, visitor_id, session_id, occurred_at, route_id,
    is_authenticated, country_code, acquisition_source, referrer_domain,
    utm_source, utm_medium, utm_campaign, device_category, browser_family
  )
  select
    p_event_id, p_visitor_id, p_session_id, recorded_at, p_route_id,
    coalesce(p_is_authenticated, false), session.country_code,
    session.acquisition_source, session.referrer_domain, session.utm_source,
    session.utm_medium, session.utm_campaign, session.device_category,
    session.browser_family
  from public.traffic_analytics_sessions session
  where session.session_id = p_session_id;

  update public.traffic_analytics_sessions
  set last_seen_at = recorded_at,
      view_count = view_count + 1,
      has_authenticated_view = has_authenticated_view
        or coalesce(p_is_authenticated, false)
  where session_id = p_session_id;

  update public.traffic_analytics_visitors
  set last_seen_at = recorded_at,
      last_session_id = p_session_id,
      total_views = total_views + 1,
      session_count = session_count + case when session_created then 1 else 0 end
  where visitor_id = p_visitor_id;

  return jsonb_build_object(
    'recorded', true,
    'deduplicated', false,
    'new_visitor', visitor_created,
    'new_session', session_created,
    'event_id', p_event_id
  );
end;
$function$;

comment on function public.record_traffic_page_view_v1(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean
) is 'Service-only, idempotent ingress for constrained first-party page views; accepts no raw URL, IP, query, identity, or arbitrary event payload.';

revoke all on function public.record_traffic_page_view_v1(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean
) from public, anon, authenticated;
grant execute on function public.record_traffic_page_view_v1(
  uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean
) to service_role;

create or replace function public.get_admin_traffic_analytics_v1(
  p_range text default '30d'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  safe_range text := lower(trim(coalesce(p_range, '30d')));
  since_time timestamptz;
  range_label text;
  collected_since timestamptz;
  live_payload jsonb;
  summary_payload jsonb;
  trend_payload jsonb;
  pages_payload jsonb;
  countries_payload jsonb;
  sources_payload jsonb;
  referrers_payload jsonb;
  campaigns_payload jsonb;
  devices_payload jsonb;
  browsers_payload jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if safe_range not in ('today', '7d', '30d', '90d', 'all') then
    raise exception 'Range must be today, 7d, 30d, 90d, or all'
      using errcode = '22023';
  end if;

  since_time := case safe_range
    when 'today' then date_trunc('day', now() at time zone 'Europe/Istanbul')
      at time zone 'Europe/Istanbul'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '90d' then now() - interval '90 days'
    else '-infinity'::timestamptz
  end;
  range_label := case safe_range
    when 'today' then 'Today'
    when '7d' then '7 days'
    when '30d' then '30 days'
    when '90d' then '90 days'
    else 'All retained traffic'
  end;

  select min(occurred_at) into collected_since
  from public.traffic_analytics_page_views;

  select jsonb_build_object(
    'active_5m', count(distinct visitor_id) filter (
      where occurred_at >= now() - interval '5 minutes'
    ),
    'active_30m', count(distinct visitor_id),
    'pages', coalesce((
      select jsonb_agg(to_jsonb(page_row) order by page_row.active_visitors desc,
        page_row.recent_views desc, page_row.route_id)
      from (
        select route_id,
          count(distinct visitor_id) filter (
            where occurred_at >= now() - interval '5 minutes'
          )::integer as active_visitors,
          count(*)::integer as recent_views,
          max(occurred_at) as last_seen_at
        from public.traffic_analytics_page_views
        where occurred_at >= now() - interval '30 minutes'
        group by route_id
        order by active_visitors desc, recent_views desc
        limit 20
      ) page_row
    ), '[]'::jsonb)
  ) into live_payload
  from public.traffic_analytics_page_views
  where occurred_at >= now() - interval '30 minutes';

  select jsonb_build_object(
    'page_views', count(*),
    'unique_visitors', count(distinct event.visitor_id),
    'sessions', count(distinct event.session_id),
    'new_visitors', count(distinct event.visitor_id) filter (
      where visitor.first_seen_at >= since_time
    ),
    'returning_visitors', count(distinct event.visitor_id) filter (
      where visitor.first_seen_at < since_time
    ),
    'authenticated_views', count(*) filter (where event.is_authenticated),
    'anonymous_views', count(*) filter (where not event.is_authenticated)
  ) into summary_payload
  from public.traffic_analytics_page_views event
  join public.traffic_analytics_visitors visitor using (visitor_id)
  where event.occurred_at >= since_time;

  select coalesce(jsonb_agg(to_jsonb(trend_row) order by trend_row.bucket), '[]'::jsonb)
  into trend_payload
  from (
    select
      case
        when safe_range = 'today' then date_trunc('hour', occurred_at at time zone 'Europe/Istanbul')
        when safe_range = 'all' then date_trunc('month', occurred_at at time zone 'Europe/Istanbul')
        else date_trunc('day', occurred_at at time zone 'Europe/Istanbul')
      end as bucket,
      count(*)::integer as page_views,
      count(distinct visitor_id)::integer as unique_visitors,
      count(distinct session_id)::integer as sessions
    from public.traffic_analytics_page_views
    where occurred_at >= since_time
    group by 1
    order by 1
    limit 400
  ) trend_row;

  select coalesce(jsonb_agg(to_jsonb(page_row) order by page_row.page_views desc,
    page_row.route_id), '[]'::jsonb)
  into pages_payload
  from (
    select route_id, count(*)::integer as page_views,
      count(distinct visitor_id)::integer as unique_visitors
    from public.traffic_analytics_page_views
    where occurred_at >= since_time
    group by route_id
    order by page_views desc
    limit 30
  ) page_row;

  select coalesce(jsonb_agg(to_jsonb(country_row) order by country_row.page_views desc,
    country_row.country_code), '[]'::jsonb)
  into countries_payload
  from (
    select country_code, count(distinct visitor_id)::integer as unique_visitors,
      count(*)::integer as page_views,
      round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as traffic_percent
    from public.traffic_analytics_page_views
    where occurred_at >= since_time
    group by country_code
    order by page_views desc
    limit 50
  ) country_row;

  select coalesce(jsonb_agg(to_jsonb(source_row) order by source_row.page_views desc,
    source_row.acquisition_source), '[]'::jsonb)
  into sources_payload
  from (
    select event.acquisition_source,
      count(distinct event.visitor_id)::integer as unique_visitors,
      count(distinct event.session_id)::integer as sessions,
      count(*)::integer as page_views
    from public.traffic_analytics_page_views event
    where event.occurred_at >= since_time
    group by event.acquisition_source
    order by page_views desc
  ) source_row;

  select coalesce(jsonb_agg(to_jsonb(referrer_row) order by referrer_row.page_views desc,
    referrer_row.referrer_domain), '[]'::jsonb)
  into referrers_payload
  from (
    select event.referrer_domain,
      count(distinct event.visitor_id)::integer as unique_visitors,
      count(distinct event.session_id)::integer as sessions,
      count(*)::integer as page_views
    from public.traffic_analytics_page_views event
    where event.occurred_at >= since_time
      and event.referrer_domain is not null
      and event.referrer_domain <> 'medichall.com'
      and event.referrer_domain not like '%.medichall.com'
    group by event.referrer_domain
    order by page_views desc
    limit 50
  ) referrer_row;

  select coalesce(jsonb_agg(to_jsonb(campaign_row) order by campaign_row.sessions desc,
    campaign_row.utm_source, campaign_row.utm_campaign), '[]'::jsonb)
  into campaigns_payload
  from (
    select event.utm_source, event.utm_medium, event.utm_campaign,
      count(distinct event.visitor_id)::integer as unique_visitors,
      count(distinct event.session_id)::integer as sessions,
      count(*)::integer as page_views
    from public.traffic_analytics_page_views event
    where event.occurred_at >= since_time and event.utm_source is not null
    group by event.utm_source, event.utm_medium, event.utm_campaign
    order by sessions desc
    limit 50
  ) campaign_row;

  select coalesce(jsonb_agg(to_jsonb(device_row) order by device_row.page_views desc,
    device_row.device_category), '[]'::jsonb)
  into devices_payload
  from (
    select device_category, count(distinct visitor_id)::integer as unique_visitors,
      count(*)::integer as page_views
    from public.traffic_analytics_page_views
    where occurred_at >= since_time
    group by device_category
    order by page_views desc
  ) device_row;

  select coalesce(jsonb_agg(to_jsonb(browser_row) order by browser_row.page_views desc,
    browser_row.browser_family), '[]'::jsonb)
  into browsers_payload
  from (
    select browser_family, count(distinct visitor_id)::integer as unique_visitors,
      count(*)::integer as page_views
    from public.traffic_analytics_page_views
    where occurred_at >= since_time
    group by browser_family
    order by page_views desc
  ) browser_row;

  return jsonb_build_object(
    'range', jsonb_build_object(
      'key', safe_range,
      'label', range_label,
      'since', case when safe_range = 'all' then null else since_time end,
      'reliable_from', collected_since,
      'raw_retention_days', 400,
      'timezone', 'Europe/Istanbul'
    ),
    'live', live_payload,
    'summary', summary_payload,
    'trend', trend_payload,
    'top_pages', pages_payload,
    'countries', countries_payload,
    'sources', sources_payload,
    'referrers', referrers_payload,
    'campaigns', campaigns_payload,
    'devices', devices_payload,
    'browsers', browsers_payload
  );
end;
$function$;

comment on function public.get_admin_traffic_analytics_v1(text) is
  'Admin-only aggregate traffic dashboard. It exposes no raw visitor history, URL, IP address, token, customer content, or arbitrary event payload.';

revoke all on function public.get_admin_traffic_analytics_v1(text)
  from public, anon;
grant execute on function public.get_admin_traffic_analytics_v1(text)
  to authenticated;

create or replace function public.prune_traffic_analytics_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $function$
declare
  deleted_views integer := 0;
  deleted_sessions integer := 0;
  deleted_visitors integer := 0;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Traffic retention maintenance access denied'
      using errcode = '42501';
  end if;
  delete from public.traffic_analytics_page_views
  where occurred_at < now() - interval '400 days';
  get diagnostics deleted_views = row_count;
  delete from public.traffic_analytics_sessions
  where last_seen_at < now() - interval '400 days';
  get diagnostics deleted_sessions = row_count;
  delete from public.traffic_analytics_visitors
  where last_seen_at < now() - interval '400 days';
  get diagnostics deleted_visitors = row_count;
  return jsonb_build_object(
    'page_views', deleted_views,
    'sessions', deleted_sessions,
    'visitors', deleted_visitors,
    'retention_days', 400
  );
end;
$function$;

comment on function public.prune_traffic_analytics_v1() is
  'Daily bounded-retention maintenance for pseudonymous traffic records older than 400 days.';

revoke all on function public.prune_traffic_analytics_v1()
  from public, anon, authenticated, service_role;

do $schedule$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'traffic-analytics-retention-v1';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'traffic-analytics-retention-v1',
    '17 3 * * *',
    $command$select public.prune_traffic_analytics_v1();$command$
  );
end
$schedule$;

commit;

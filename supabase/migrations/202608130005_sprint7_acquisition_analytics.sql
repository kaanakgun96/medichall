-- Sprint 7 aggregate-safe conversion measurement.
-- Stores only constrained event names linked to the existing pseudonymous
-- traffic session. No user/company IDs, content, raw URLs, emails or searches.

begin;

do $preflight$
begin
  if to_regclass('public.traffic_analytics_visitors') is null
    or to_regclass('public.traffic_analytics_sessions') is null
    or to_regprocedure('public.is_admin()') is null then
    raise exception 'Sprint 7 acquisition analytics dependency is missing';
  end if;
end
$preflight$;

create table public.traffic_analytics_conversions (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  visitor_id uuid not null
    references public.traffic_analytics_visitors(visitor_id) on delete cascade,
  session_id uuid not null
    references public.traffic_analytics_sessions(session_id) on delete cascade,
  occurred_at timestamptz not null default clock_timestamp(),
  event_type text not null,
  is_authenticated boolean not null default false,
  acquisition_source text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  check (event_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (event_type in (
    'signup_started', 'signup_completed', 'company_profile_created',
    'profile_completed', 'product_added', 'matchmaking_profile_created',
    'match_viewed', 'connection_requested', 'rfq_created',
    'meeting_scheduled'
  )),
  check (acquisition_source in (
    'direct', 'google', 'linkedin', 'bing', 'other_search',
    'other_referral', 'internal'
  )),
  check (utm_source is null or (
    length(utm_source) between 1 and 64 and utm_source ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (utm_medium is null or (
    length(utm_medium) between 1 and 64 and utm_medium ~ '^[a-z0-9][a-z0-9._ -]*$'
  )),
  check (utm_campaign is null or (
    length(utm_campaign) between 1 and 100 and utm_campaign ~ '^[a-z0-9][a-z0-9._ -]*$'
  ))
);

create index traffic_analytics_conversions_occurred_idx
on public.traffic_analytics_conversions(occurred_at desc);

create index traffic_analytics_conversions_type_occurred_idx
on public.traffic_analytics_conversions(event_type, occurred_at desc);

create index traffic_analytics_conversions_source_occurred_idx
on public.traffic_analytics_conversions(acquisition_source, occurred_at desc);

create index traffic_analytics_conversions_session_occurred_idx
on public.traffic_analytics_conversions(session_id, occurred_at desc);

alter table public.traffic_analytics_conversions enable row level security;
alter table public.traffic_analytics_conversions force row level security;

revoke all on table public.traffic_analytics_conversions
  from public, anon, authenticated;
grant all on table public.traffic_analytics_conversions to service_role;
grant usage, select on sequence public.traffic_analytics_conversions_id_seq
  to service_role;

create or replace function public.record_traffic_conversion_v1(
  p_event_id uuid,
  p_visitor_id uuid,
  p_session_id uuid,
  p_event_type text,
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
  session_row public.traffic_analytics_sessions%rowtype;
  session_conversion_count integer;
begin
  if p_event_id is null or p_visitor_id is null or p_session_id is null
    or p_event_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_visitor_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_session_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Valid event, visitor, and session identifiers are required'
      using errcode = '22023';
  end if;
  if p_event_type is null or p_event_type not in (
    'signup_started', 'signup_completed', 'company_profile_created',
    'profile_completed', 'product_added', 'matchmaking_profile_created',
    'match_viewed', 'connection_requested', 'rfq_created',
    'meeting_scheduled'
  ) then
    raise exception 'Invalid conversion event' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 727));
  select id into existing_id
  from public.traffic_analytics_conversions
  where event_id = p_event_id;
  if existing_id is not null then
    return jsonb_build_object(
      'recorded', false, 'deduplicated', true, 'event_id', p_event_id
    );
  end if;

  -- The page-view ingress uses the same visitor lock. This makes a conversion
  -- wait for its first page-view transaction rather than racing the session FK.
  perform pg_advisory_xact_lock(hashtextextended(p_visitor_id::text, 719));
  select * into session_row
  from public.traffic_analytics_sessions
  where session_id = p_session_id;
  if session_row.session_id is null
    or session_row.visitor_id is distinct from p_visitor_id then
    raise exception 'Conversion session is unavailable'
      using errcode = '22023';
  end if;
  if session_row.last_seen_at < recorded_at - interval '30 minutes' then
    raise exception 'Analytics session has expired' using errcode = '22023';
  end if;
  select count(*)::integer into session_conversion_count
  from public.traffic_analytics_conversions
  where session_id = p_session_id;
  if session_conversion_count >= 100 then
    raise exception 'Analytics conversion limit reached' using errcode = '22023';
  end if;

  insert into public.traffic_analytics_conversions (
    event_id, visitor_id, session_id, occurred_at, event_type,
    is_authenticated, acquisition_source, utm_source, utm_medium, utm_campaign
  ) values (
    p_event_id, p_visitor_id, p_session_id, recorded_at, p_event_type,
    coalesce(p_is_authenticated, false), session_row.acquisition_source,
    session_row.utm_source, session_row.utm_medium, session_row.utm_campaign
  );

  return jsonb_build_object(
    'recorded', true, 'deduplicated', false, 'event_id', p_event_id
  );
end;
$function$;

comment on function public.record_traffic_conversion_v1(
  uuid,uuid,uuid,text,boolean
) is 'Service-only, idempotent ingress for allowlisted acquisition conversions; accepts no identity, company, content, URL, email, search, or arbitrary payload.';

revoke all on function public.record_traffic_conversion_v1(
  uuid,uuid,uuid,text,boolean
) from public, anon, authenticated;
grant execute on function public.record_traffic_conversion_v1(
  uuid,uuid,uuid,text,boolean
) to service_role;

create or replace function public.get_admin_acquisition_funnel_v1(
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
  funnel_payload jsonb;
  sources_payload jsonb;
  campaigns_payload jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if safe_range not in ('today', '7d', '30d', '90d', 'all') then
    raise exception 'Range must be today, 7d, 30d, 90d, or all'
      using errcode = '22023';
  end if;
  since_time := case safe_range
    when 'today' then date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '90d' then now() - interval '90 days'
    else '-infinity'::timestamptz
  end;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.stage_order), '[]'::jsonb)
  into funnel_payload
  from (
    select event_type,
      case event_type
        when 'signup_started' then 1 when 'signup_completed' then 2
        when 'company_profile_created' then 3 when 'profile_completed' then 4
        when 'product_added' then 5 when 'matchmaking_profile_created' then 6
        when 'match_viewed' then 7 when 'connection_requested' then 8
        when 'rfq_created' then 9 when 'meeting_scheduled' then 10
      end as stage_order,
      count(*)::bigint as events,
      count(distinct visitor_id)::bigint as unique_visitors,
      count(distinct session_id)::bigint as sessions
    from public.traffic_analytics_conversions
    where occurred_at >= since_time
    group by event_type
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.useful_actions desc, row_data.visitors desc), '[]'::jsonb)
  into sources_payload
  from (
    select acquisition_source,
      count(distinct visitor_id)::bigint as visitors,
      count(distinct session_id)::bigint as sessions,
      count(*) filter (where event_type = 'signup_completed')::bigint as signups,
      count(*) filter (where event_type in ('company_profile_created','profile_completed','product_added','matchmaking_profile_created'))::bigint as activation_actions,
      count(*) filter (where event_type in ('connection_requested','rfq_created','meeting_scheduled'))::bigint as useful_actions
    from public.traffic_analytics_conversions
    where occurred_at >= since_time
    group by acquisition_source
  ) row_data;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.useful_actions desc, row_data.events desc), '[]'::jsonb)
  into campaigns_payload
  from (
    select utm_source, utm_medium, utm_campaign,
      count(*)::bigint as events,
      count(distinct visitor_id)::bigint as visitors,
      count(*) filter (where event_type in ('connection_requested','rfq_created','meeting_scheduled'))::bigint as useful_actions
    from public.traffic_analytics_conversions
    where occurred_at >= since_time and utm_source is not null
    group by utm_source, utm_medium, utm_campaign
    limit 50
  ) row_data;

  return jsonb_build_object(
    'range', safe_range,
    'funnel', funnel_payload,
    'sources', sources_payload,
    'campaigns', campaigns_payload,
    'privacy', jsonb_build_object(
      'aggregate_only', true,
      'identity_fields_stored', false,
      'content_fields_stored', false
    )
  );
end;
$function$;

comment on function public.get_admin_acquisition_funnel_v1(text)
is 'Admin-only acquisition funnel aggregates by first-touch source and allowlisted conversion stage.';

revoke all on function public.get_admin_acquisition_funnel_v1(text)
from public, anon, authenticated;
grant execute on function public.get_admin_acquisition_funnel_v1(text)
to authenticated, service_role;

commit;

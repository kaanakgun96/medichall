-- MedicHall Sprint 6: founder-facing growth and activation operations.
-- Aggregate and company engagement data is exposed only through an explicit
-- admin-authorized RPC. No source table receives broader browser grants.

begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null
    or to_regclass('public.companies') is null
    or to_regclass('public.products') is null
    or to_regclass('public.company_certificates') is null
    or to_regclass('public.company_match_profiles') is null
    or to_regclass('public.opportunity_matches') is null
    or to_regclass('public.matchmaking_profiles') is null
    or to_regclass('public.matchmaking_matches') is null
    or to_regclass('public.business_connections') is null
    or to_regclass('public.matchmaking_meeting_requests') is null
    or to_regclass('public.rfq_requests') is null
    or to_regclass('public.rfq_messages') is null
    or to_regclass('public.rfq_offers') is null
    or to_regclass('public.matchmaking_relationship_messages') is null
    or to_regclass('public.tender_document_analysis_jobs') is null
    or to_regclass('public.tender_imports') is null then
    raise exception 'Sprint 6 admin growth dependency is missing';
  end if;
end
$preflight$;

create table public.account_activity_heartbeats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_active_at timestamptz not null default now(),
  last_route text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_route is null or length(last_route) between 1 and 100)
);

create index account_activity_heartbeats_active_idx
on public.account_activity_heartbeats(last_active_at desc);

alter table public.account_activity_heartbeats enable row level security;
alter table public.account_activity_heartbeats force row level security;

create policy "users view own activity heartbeat"
on public.account_activity_heartbeats
for select to authenticated
using (user_id = auth.uid());

revoke all on table public.account_activity_heartbeats
  from public, anon, authenticated;
grant select on table public.account_activity_heartbeats to authenticated;
grant all on table public.account_activity_heartbeats to service_role;

create or replace function public.record_user_activity_v1(
  p_route text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  safe_route text := nullif(left(regexp_replace(
    trim(coalesce(p_route, '')),
    '[[:cntrl:]]+', '', 'g'
  ), 100), '');
  recorded_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  insert into public.account_activity_heartbeats (
    user_id, last_active_at, last_route, updated_at
  ) values (
    auth.uid(), now(), safe_route, now()
  )
  on conflict (user_id) do update set
    last_active_at = excluded.last_active_at,
    last_route = coalesce(excluded.last_route,
      account_activity_heartbeats.last_route),
    updated_at = now()
  returning last_active_at into recorded_at;
  return recorded_at;
end;
$function$;

comment on function public.record_user_activity_v1(text) is
  'Records an authenticated portal heartbeat for admin last-active operations; accepts no user or company identifier.';

revoke all on function public.record_user_activity_v1(text)
  from public, anon;
grant execute on function public.record_user_activity_v1(text)
  to authenticated, service_role;

create or replace function public.company_activation_score_v1(
  p_company_id bigint
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  company_row public.companies%rowtype;
  match_profile public.matchmaking_profiles%rowtype;
  match_preferences public.company_match_profiles%rowtype;
  company_information integer := 0;
  match_score integer := 0;
  preference_score integer := 0;
  product_count integer := 0;
  score integer := 10;
  is_buyer boolean := false;
  has_certifications boolean := false;
  has_interests boolean := false;
  has_markets boolean := false;
begin
  select * into company_row from public.companies where id = p_company_id;
  if company_row.id is null then return 0; end if;

  select * into match_profile from public.matchmaking_profiles
  where company_id = company_row.id;
  select * into match_preferences from public.company_match_profiles
  where company_id = company_row.id;
  select count(*)::integer into product_count from public.products
  where company_id = company_row.id;

  is_buyer := lower(coalesce(company_row.type, '')) like any(
    array['%buyer%','%hospital%','%procurement%']
  );
  has_certifications := nullif(trim(coalesce(company_row.certifications, '')), '')
      is not null
    or exists (select 1 from public.company_certificates
      where company_id = company_row.id);

  if nullif(trim(company_row.name), '') is not null then
    company_information := company_information + 5;
  end if;
  if nullif(trim(coalesce(company_row.type, '')), '') is not null then
    company_information := company_information + 5;
  end if;
  if nullif(trim(coalesce(company_row.country, '')), '') is not null then
    company_information := company_information + 5;
  end if;
  if length(trim(coalesce(company_row.description, ''))) >= 40 then
    company_information := company_information + 5;
  end if;

  if is_buyer then
    if match_profile.id is not null then match_score := 10; end if;
    if coalesce(match_profile.profile_completeness, 0) >= 60 then
      match_score := 25;
    end if;
    has_interests := cardinality(coalesce(
      match_profile.interested_products, '{}'::text[]
    )) > 0 or cardinality(coalesce(
      match_profile.product_categories, '{}'::text[]
    )) > 0;
    has_markets := cardinality(coalesce(
      match_profile.preferred_supplier_countries, '{}'::text[]
    )) > 0 or cardinality(coalesce(
      match_profile.target_countries, '{}'::text[]
    )) > 0 or cardinality(coalesce(
      match_profile.served_countries, '{}'::text[]
    )) > 0;
    score := 15 + company_information
      + case when nullif(trim(coalesce(company_row.logo_url, '')), '')
        is not null then 10 else 0 end
      + match_score
      + case when has_interests then 15 else 0 end
      + case when has_markets then 15 else 0 end;
  else
    if cardinality(coalesce(match_preferences.target_countries, '{}'::text[]))
      > 0 then preference_score := preference_score + 8; end if;
    if cardinality(coalesce(match_preferences.product_keywords, '{}'::text[]))
      > 0 or cardinality(coalesce(match_preferences.cpv_codes, '{}'::text[]))
      > 0 then preference_score := preference_score + 7; end if;
    if match_profile.id is not null then match_score := 7; end if;
    if coalesce(match_profile.profile_completeness, 0) >= 60 then
      match_score := 15;
    end if;
    score := 10 + company_information
      + case when nullif(trim(coalesce(company_row.logo_url, '')), '')
        is not null then 10 else 0 end
      + case when has_certifications then 10 else 0 end
      + case when product_count > 0 then 20 else 0 end
      + preference_score + match_score;
  end if;
  return greatest(0, least(100, score));
end;
$function$;

comment on function public.company_activation_score_v1(bigint) is
  'Uses the same deterministic, role-aware company activation weights as Sprint 3; it never reads behavioral guesses or AI output.';

revoke all on function public.company_activation_score_v1(bigint)
  from public, anon, authenticated;

create index if not exists products_company_created_idx
on public.products(company_id, created_at);
create index if not exists rfq_requests_company_created_idx
on public.rfq_requests(company_id, created_at);
create index if not exists rfq_requests_user_created_idx
on public.rfq_requests(user_id, created_at);
create index if not exists opportunity_matches_company_status_score_idx
on public.opportunity_matches(company_id, status, match_score desc);
create index if not exists business_connections_requester_created_idx
on public.business_connections(requester_profile_id, created_at);
create index if not exists business_connections_recipient_status_idx
on public.business_connections(recipient_profile_id, status, created_at);
create index if not exists tender_imports_company_status_idx
on public.tender_imports(company_id, status, created_at);

create or replace function public.get_admin_growth_dashboard_v1(
  p_range_days integer default 30,
  p_company_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  range_days integer := coalesce(p_range_days, 30);
  company_limit integer := greatest(1, least(coalesce(p_company_limit, 200), 500));
  since_time timestamptz;
  overview jsonb;
  funnel jsonb;
  health jsonb;
  companies_payload jsonb;
  range_label text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if range_days not in (0, 7, 30, 90) then
    raise exception 'Range must be 7, 30, 90, or 0 for all time'
      using errcode = '22023';
  end if;
  since_time := case when range_days = 0 then null
    else now() - make_interval(days => range_days) end;
  range_label := case when range_days = 0 then 'All time'
    else range_days || ' days' end;

  select jsonb_build_object(
    'total_companies', (select count(*) from public.companies),
    'active_companies', (select count(*) from public.companies where is_active),
    'users', (select count(*) from auth.users where deleted_at is null),
    'products', (select count(*) from public.products),
    'rfqs', (select count(*) from public.rfq_requests),
    'messages',
      (select count(*) from public.rfq_messages) +
      (select count(*) from public.matchmaking_relationship_messages),
    'tender_analyses', (select count(*)
      from public.tender_document_analysis_jobs where status = 'completed'),
    'tender_imports', (select count(*) from public.tender_imports),
    'matchmaking_profiles', (select count(*)
      from public.matchmaking_profiles),
    'connections', (select count(*) from public.business_connections),
    'meetings', (select count(*)
      from public.matchmaking_meeting_requests)
  ) into overview;

  with cohort as (
    select company.id, company.owner_id
    from public.companies company
    where since_time is null or company.created_at >= since_time
  ), steps as (
    select
      count(*)::integer as registered,
      count(*) filter (
        where public.company_activation_score_v1(cohort.id) >= 70
      )::integer as profile_completed,
      count(*) filter (where exists (
        select 1 from public.products product
        where product.company_id = cohort.id
      ))::integer as first_product,
      count(*) filter (where exists (
        select 1 from public.matchmaking_profiles profile
        where profile.company_id = cohort.id
          and profile.profile_completeness >= 60
      ))::integer as matchmaking_completed,
      count(*) filter (where exists (
        select 1
        from public.matchmaking_profiles profile
        join public.matchmaking_matches match_item
          on match_item.source_profile_id = profile.id
        where profile.company_id = cohort.id and match_item.status <> 'new'
      ))::integer as first_match_viewed,
      count(*) filter (where exists (
        select 1
        from public.matchmaking_profiles profile
        join public.business_connections connection
          on connection.requester_profile_id = profile.id
        where profile.company_id = cohort.id
      ))::integer as first_connection_sent,
      count(*) filter (where exists (
        select 1 from public.opportunity_matches opportunity
        where opportunity.company_id = cohort.id
          and opportunity.opportunity_type = 'tender'
          and opportunity.status <> 'new'
      ))::integer as first_tender_viewed,
      count(*) filter (where exists (
        select 1 from public.rfq_requests request
        where request.company_id = cohort.id
           or request.user_id = cohort.owner_id
      ))::integer as first_rfq,
      count(*) filter (where exists (
        select 1
        from public.matchmaking_profiles profile
        join public.matchmaking_meeting_requests meeting
          on profile.id in (
            meeting.requester_profile_id, meeting.recipient_profile_id
          )
        where profile.company_id = cohort.id
          and meeting.status in ('confirmed','completed')
      ))::integer as meeting_booked
    from cohort
  )
  select jsonb_build_array(
    jsonb_build_object('key','registered','label','Registered','count',registered,
      'definition','Companies registered inside the selected cohort window.'),
    jsonb_build_object('key','profile_completed','label','Company profile completed','count',profile_completed,
      'definition','Current deterministic Sprint 3 activation score is at least 70%.'),
    jsonb_build_object('key','first_product','label','First product added','count',first_product,
      'definition','At least one canonical product belongs to the company.'),
    jsonb_build_object('key','matchmaking_completed','label','Matchmaking completed','count',matchmaking_completed,
      'definition','A matchmaking profile exists with completeness of at least 60%.'),
    jsonb_build_object('key','first_match_viewed','label','First match viewed','count',first_match_viewed,
      'definition','A generated company match has moved from the new state.'),
    jsonb_build_object('key','first_connection_sent','label','First connection sent','count',first_connection_sent,
      'definition','A business connection exists with the company profile as requester.'),
    jsonb_build_object('key','first_tender_viewed','label','First tender viewed','count',first_tender_viewed,
      'definition','A tender opportunity has moved from the new state.'),
    jsonb_build_object('key','first_rfq','label','First RFQ sent or received','count',first_rfq,
      'definition','An RFQ is owned by the company or was sent by its owner.'),
    jsonb_build_object('key','meeting_booked','label','Meeting booked','count',meeting_booked,
      'definition','A participant meeting reached confirmed or completed state.')
  ) into funnel from steps;

  with period_rfqs as (
    select request.id
    from public.rfq_requests request
    where since_time is null or request.created_at >= since_time
  ), period_analysis as (
    select job.status
    from public.tender_document_analysis_jobs job
    where since_time is null or job.created_at >= since_time
  )
  select jsonb_build_array(
    jsonb_build_object('key','tender_matches','label','Tender matches generated',
      'value',(select count(*) from public.opportunity_matches opportunity
        where opportunity.opportunity_type = 'tender'
          and (since_time is null or opportunity.generated_at >= since_time)),
      'definition','Rule-engine tender opportunity rows generated in the selected period.'),
    jsonb_build_object('key','high_tender_matches','label','High-confidence tender matches',
      'value',(select count(*) from public.opportunity_matches opportunity
        where opportunity.opportunity_type = 'tender'
          and opportunity.match_score >= 80
          and coalesce(opportunity.confidence_score, 0) >= 70
          and (since_time is null or opportunity.generated_at >= since_time)),
      'definition','Tender matches with score at least 80 and confidence at least 70.'),
    jsonb_build_object('key','company_matches','label','Company matches generated',
      'value',(select count(*) from public.matchmaking_matches match_item
        where since_time is null or match_item.generated_at >= since_time),
      'definition','Two-sided company match rows generated in the selected period.'),
    jsonb_build_object('key','connections','label','Connections created',
      'value',(select count(*) from public.business_connections connection
        where since_time is null or connection.created_at >= since_time),
      'definition','Business connection requests created in the selected period.'),
    jsonb_build_object('key','meetings','label','Meetings booked',
      'value',(select count(*) from public.matchmaking_meeting_requests meeting
        where meeting.status in ('confirmed','completed')
          and (since_time is null or meeting.confirmed_at >= since_time)),
      'definition','Meetings confirmed in the selected period.'),
    jsonb_build_object('key','rfqs','label','RFQs created',
      'value',(select count(*) from period_rfqs),
      'definition','Quotation requests created in the selected period.'),
    jsonb_build_object('key','rfq_response_rate','label','RFQ response rate',
      'value',case when (select count(*) from period_rfqs) = 0 then 0
        else round(100.0 * (select count(*) from period_rfqs rfq
          where exists (select 1 from public.rfq_offers offer
            where offer.rfq_id = rfq.id)) / (select count(*) from period_rfqs), 1)
        end,
      'unit','%',
      'definition','Share of period RFQs with at least one submitted offer.'),
    jsonb_build_object('key','tender_analysis_usage','label','Tender analysis usage',
      'value',(select count(*) from period_analysis),
      'secondary_value',(select count(*) from period_analysis
        where status = 'completed'),
      'secondary_label','completed',
      'definition','Document-analysis jobs requested in the period; secondary value is completed jobs.')
  ) into health;

  with company_base as (
    select
      company.*,
      public.company_activation_score_v1(company.id) as profile_completion,
      heartbeat.last_active_at,
      heartbeat.last_route,
      profile.id as match_profile_id,
      coalesce(profile.profile_completeness, 0) as matchmaking_completion
    from public.companies company
    left join public.account_activity_heartbeats heartbeat
      on heartbeat.user_id = company.owner_id
    left join public.matchmaking_profiles profile
      on profile.company_id = company.id
    order by company.created_at desc, company.id desc
    limit company_limit
  ), engagement as (
    select base.*,
      (select count(*) from public.products product
        where product.company_id = base.id) as product_count,
      (select count(*) from public.opportunity_matches opportunity
        where opportunity.company_id = base.id
          and opportunity.opportunity_type = 'tender') as tender_match_count,
      (select count(*) from public.matchmaking_matches match_item
        where match_item.source_profile_id = base.match_profile_id) as company_match_count,
      (select count(*) from public.business_connections connection
        where base.match_profile_id in (
          connection.requester_profile_id, connection.recipient_profile_id
        )) as connection_count,
      (select count(*) from public.rfq_requests request
        where request.company_id = base.id
           or request.user_id = base.owner_id) as rfq_count,
      (select count(*) from public.rfq_messages message
        join public.rfq_requests request on request.id = message.rfq_id
        where request.company_id = base.id or request.user_id = base.owner_id)
        + (select count(*) from public.matchmaking_relationship_messages message
          join public.business_connections connection
            on connection.id = message.connection_id
          where base.match_profile_id in (
            connection.requester_profile_id, connection.recipient_profile_id
          )) as message_count,
      (select count(*) from public.matchmaking_meeting_requests meeting
        where base.match_profile_id in (
          meeting.requester_profile_id, meeting.recipient_profile_id
        )) as meeting_count,
      (select count(*) from public.tender_imports tender_import
        where tender_import.company_id = base.id) as tender_import_count,
      (select count(*) from public.opportunity_matches opportunity
        where opportunity.company_id = base.id
          and opportunity.opportunity_type = 'tender'
          and opportunity.match_score >= 80
          and opportunity.status = 'new') as unopened_high_tender_count,
      (select count(*) from public.business_connections connection
        where connection.recipient_profile_id = base.match_profile_id
          and connection.status = 'pending') as unanswered_connection_count,
      (select count(*) from public.rfq_requests request
        where request.company_id = base.id
          and not exists (select 1 from public.rfq_offers offer
            where offer.rfq_id = request.id)) as unanswered_rfq_count
    from company_base base
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'company_id', engagement.id,
    'name', engagement.name,
    'company_type', engagement.type,
    'country', engagement.country,
    'registration_date', engagement.created_at,
    'last_active_at', engagement.last_active_at,
    'last_route', engagement.last_route,
    'profile_completion', engagement.profile_completion,
    'matchmaking_completion', engagement.matchmaking_completion,
    'products', engagement.product_count,
    'tender_matches', engagement.tender_match_count,
    'company_matches', engagement.company_match_count,
    'connections', engagement.connection_count,
    'rfqs', engagement.rfq_count,
    'messages', engagement.message_count,
    'meetings', engagement.meeting_count,
    'tender_imports', engagement.tender_import_count,
    'attention',
      (case when engagement.created_at >= now() - interval '14 days'
          and engagement.profile_completion < 70
        then jsonb_build_array(jsonb_build_object(
          'key','onboarding_incomplete','label','New company — onboarding incomplete',
          'count',1,'priority','high')) else '[]'::jsonb end)
      || (case when engagement.product_count = 0
        then jsonb_build_array(jsonb_build_object(
          'key','no_products','label','No products uploaded',
          'count',1,'priority','medium')) else '[]'::jsonb end)
      || (case when engagement.created_at < now() - interval '7 days'
          and (engagement.last_active_at is null
            or engagement.last_active_at < now() - interval '7 days')
        then jsonb_build_array(jsonb_build_object(
          'key','inactive_7d','label','No recorded activity in 7 days',
          'count',1,'priority','medium')) else '[]'::jsonb end)
      || (case when engagement.unopened_high_tender_count > 0
        then jsonb_build_array(jsonb_build_object(
          'key','high_tender_unopened','label','High tender match not opened',
          'count',engagement.unopened_high_tender_count,'priority','high'))
        else '[]'::jsonb end)
      || (case when engagement.unanswered_connection_count > 0
        then jsonb_build_array(jsonb_build_object(
          'key','connection_unanswered','label','Connection awaiting response',
          'count',engagement.unanswered_connection_count,'priority','high'))
        else '[]'::jsonb end)
      || (case when engagement.unanswered_rfq_count > 0
        then jsonb_build_array(jsonb_build_object(
          'key','rfq_unanswered','label','RFQ awaiting offer',
          'count',engagement.unanswered_rfq_count,'priority','high'))
        else '[]'::jsonb end)
  )) order by engagement.created_at desc, engagement.id desc), '[]'::jsonb)
  into companies_payload
  from engagement;

  return jsonb_build_object(
    'version', 1,
    'generated_at', now(),
    'range', jsonb_build_object(
      'days', range_days, 'label', range_label, 'since', since_time
    ),
    'definitions', jsonb_build_object(
      'active_company','Company is_active is true (not administratively disabled).',
      'last_active','Latest authenticated portal heartbeat; null means not recorded since Sprint 6 release.',
      'profile_completion','Role-aware deterministic Sprint 3 activation score; 70% is complete.',
      'cohort','Companies registered inside the selected range, evaluated against current achieved activation facts.'
    ),
    'overview', overview,
    'activation_funnel', funnel,
    'platform_health', health,
    'companies', companies_payload,
    'company_limit', company_limit
  );
end;
$function$;

comment on function public.get_admin_growth_dashboard_v1(integer,integer) is
  'Admin-only bounded growth dashboard: all-time platform overview, selected-period activation cohort and health, plus operational company engagement/attention segments.';

revoke all on function public.get_admin_growth_dashboard_v1(integer,integer)
  from public, anon;
grant execute on function public.get_admin_growth_dashboard_v1(integer,integer)
  to authenticated, service_role;

commit;

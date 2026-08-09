-- MedicHall Sprint 3: resumable onboarding and deterministic activation state.

begin;

create table if not exists public.account_onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_kind text not null check (account_kind in ('company', 'buyer', 'unclassified')),
  last_step text,
  dismissed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_step is null or length(last_step) between 1 and 80)
);

comment on table public.account_onboarding_progress is
  'User-owned resume/dismiss state for the non-blocking MedicHall activation guide. Completion facts remain derived from canonical business records.';

drop trigger if exists account_onboarding_progress_set_updated_at
on public.account_onboarding_progress;
create trigger account_onboarding_progress_set_updated_at
before update on public.account_onboarding_progress
for each row execute function public.set_updated_at();

alter table public.account_onboarding_progress enable row level security;
alter table public.account_onboarding_progress force row level security;

drop policy if exists "users read own onboarding progress"
on public.account_onboarding_progress;
create policy "users read own onboarding progress"
on public.account_onboarding_progress
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "users insert own onboarding progress"
on public.account_onboarding_progress;
create policy "users insert own onboarding progress"
on public.account_onboarding_progress
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "users update own onboarding progress"
on public.account_onboarding_progress;
create policy "users update own onboarding progress"
on public.account_onboarding_progress
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on table public.account_onboarding_progress from public, anon;
grant select, insert, update on table public.account_onboarding_progress to authenticated;

create or replace function public.get_account_activation_state_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  current_user_id uuid := auth.uid();
  company_row public.companies%rowtype;
  buyer_row public.buyer_profiles%rowtype;
  match_profile public.matchmaking_profiles%rowtype;
  match_preferences public.company_match_profiles%rowtype;
  progress_row public.account_onboarding_progress%rowtype;
  account_kind text := 'unclassified';
  account_role text := 'unclassified';
  profile_score integer := 10;
  company_information_score integer := 0;
  preference_score integer := 0;
  matchmaking_score integer := 0;
  product_count integer := 0;
  tender_match_count integer := 0;
  partner_match_count integer := 0;
  distributor_match_count integer := 0;
  viewed_tender_match_count integer := 0;
  viewed_partner_match_count integer := 0;
  has_certifications boolean := false;
  has_interests boolean := false;
  has_markets boolean := false;
  checks jsonb := '[]'::jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select company.*
  into company_row
  from public.companies company
  where company.owner_id = current_user_id
  order by company.created_at
  limit 1;

  select buyer.*
  into buyer_row
  from public.buyer_profiles buyer
  where buyer.user_id = current_user_id;

  select profile.*
  into match_profile
  from public.matchmaking_profiles profile
  where profile.user_id = current_user_id;

  select progress.*
  into progress_row
  from public.account_onboarding_progress progress
  where progress.user_id = current_user_id;

  if company_row.id is not null then
    account_kind := 'company';
    account_role := case
      when lower(coalesce(company_row.type, '')) like '%distributor%' then 'distributor'
      when lower(coalesce(company_row.type, '')) like '%buyer%'
        or lower(coalesce(company_row.type, '')) like '%hospital%'
        or lower(coalesce(company_row.type, '')) like '%procurement%' then 'buyer'
      when lower(coalesce(company_row.type, '')) like '%supplier%' then 'supplier'
      when lower(coalesce(company_row.type, '')) like '%manufacturer%'
        or lower(coalesce(company_row.type, '')) like '%manufactur%' then 'manufacturer'
      else 'company'
    end;

    select preference.*
    into match_preferences
    from public.company_match_profiles preference
    where preference.company_id = company_row.id;

    select count(*)::integer
    into product_count
    from public.products product
    where product.company_id = company_row.id;

    has_certifications := nullif(trim(coalesce(company_row.certifications, '')), '') is not null
      or exists (
        select 1 from public.company_certificates certificate
        where certificate.company_id = company_row.id
      );

    if nullif(trim(company_row.name), '') is not null then company_information_score := company_information_score + 5; end if;
    if nullif(trim(coalesce(company_row.type, '')), '') is not null then company_information_score := company_information_score + 5; end if;
    if nullif(trim(coalesce(company_row.country, '')), '') is not null then company_information_score := company_information_score + 5; end if;
    if length(trim(coalesce(company_row.description, ''))) >= 40 then company_information_score := company_information_score + 5; end if;

    if cardinality(coalesce(match_preferences.target_countries, '{}'::text[])) > 0 then
      preference_score := preference_score + 8;
    end if;
    if cardinality(coalesce(match_preferences.product_keywords, '{}'::text[])) > 0
      or cardinality(coalesce(match_preferences.cpv_codes, '{}'::text[])) > 0 then
      preference_score := preference_score + 7;
    end if;

    if account_role = 'buyer' then
      if match_profile.id is not null then matchmaking_score := 10; end if;
      if coalesce(match_profile.profile_completeness, 0) >= 60 then matchmaking_score := 25; end if;
      has_interests := cardinality(coalesce(match_profile.interested_products, '{}'::text[])) > 0
        or cardinality(coalesce(match_profile.product_categories, '{}'::text[])) > 0;
      has_markets := cardinality(coalesce(match_profile.preferred_supplier_countries, '{}'::text[])) > 0
        or cardinality(coalesce(match_profile.target_countries, '{}'::text[])) > 0
        or cardinality(coalesce(match_profile.served_countries, '{}'::text[])) > 0;
      profile_score := 15
        + company_information_score
        + case when nullif(trim(coalesce(company_row.logo_url, '')), '') is not null then 10 else 0 end
        + matchmaking_score
        + case when has_interests then 15 else 0 end
        + case when has_markets then 15 else 0 end;
    else
      if match_profile.id is not null then matchmaking_score := 7; end if;
      if coalesce(match_profile.profile_completeness, 0) >= 60 then matchmaking_score := 15; end if;
      profile_score := 10
        + company_information_score
        + case when nullif(trim(coalesce(company_row.logo_url, '')), '') is not null then 10 else 0 end
        + case when has_certifications then 10 else 0 end
        + case when product_count > 0 then 20 else 0 end
        + preference_score
        + matchmaking_score;
    end if;

    if match_profile.id is not null then
      select count(*)::integer,
             count(*) filter (where match_item.status <> 'new')::integer
      into partner_match_count, viewed_partner_match_count
      from public.matchmaking_matches match_item
      where match_item.source_profile_id = match_profile.id;
    end if;

    select count(*) filter (where opportunity.opportunity_type = 'tender')::integer,
           count(*) filter (where opportunity.opportunity_type = 'distributor')::integer,
           count(*) filter (
             where opportunity.opportunity_type = 'tender'
               and opportunity.status <> 'new'
           )::integer
    into tender_match_count, distributor_match_count, viewed_tender_match_count
    from public.opportunity_matches opportunity
    where opportunity.company_id = company_row.id;

    if account_role = 'buyer' then
      checks := jsonb_build_array(
        jsonb_build_object('key','account_created','label','Create account','completed',true,'earned',15,'weight',15,'action','dashboard'),
        jsonb_build_object('key','company_information','label','Complete company information','completed',company_information_score = 20,'earned',company_information_score,'weight',20,'action','company_profile'),
        jsonb_build_object('key','company_logo','label','Add company logo','completed',nullif(trim(coalesce(company_row.logo_url, '')), '') is not null,'earned',case when nullif(trim(coalesce(company_row.logo_url, '')), '') is not null then 10 else 0 end,'weight',10,'action','company_logo'),
        jsonb_build_object('key','matchmaking_profile','label','Complete matchmaking profile','completed',matchmaking_score = 25,'earned',matchmaking_score,'weight',25,'action','matchmaking_profile'),
        jsonb_build_object('key','product_interests','label','Add product interests','completed',has_interests,'earned',case when has_interests then 15 else 0 end,'weight',15,'action','matchmaking_profile'),
        jsonb_build_object('key','target_markets','label','Select supplier markets','completed',has_markets,'earned',case when has_markets then 15 else 0 end,'weight',15,'action','matchmaking_profile'),
        jsonb_build_object('key','first_company_match','label','Explore first company match','completed',viewed_partner_match_count > 0,'earned',0,'weight',0,'available_count',partner_match_count,'action','company_match')
      );
    else
      checks := jsonb_build_array(
        jsonb_build_object('key','account_created','label','Create account','completed',true,'earned',10,'weight',10,'action','dashboard'),
        jsonb_build_object('key','company_information','label','Complete company information','completed',company_information_score = 20,'earned',company_information_score,'weight',20,'action','company_profile'),
        jsonb_build_object('key','company_logo','label','Add company logo','completed',nullif(trim(coalesce(company_row.logo_url, '')), '') is not null,'earned',case when nullif(trim(coalesce(company_row.logo_url, '')), '') is not null then 10 else 0 end,'weight',10,'action','company_logo'),
        jsonb_build_object('key','certifications','label','Add certifications','completed',has_certifications,'earned',case when has_certifications then 10 else 0 end,'weight',10,'action','certifications'),
        jsonb_build_object('key','first_product','label','Add first product','completed',product_count > 0,'earned',case when product_count > 0 then 20 else 0 end,'weight',20,'action','first_product'),
        jsonb_build_object('key','tender_preferences','label','Select target markets and product categories','completed',preference_score = 15,'earned',preference_score,'weight',15,'action','tender_preferences'),
        jsonb_build_object('key','matchmaking_profile','label','Complete matchmaking profile','completed',matchmaking_score = 15,'earned',matchmaking_score,'weight',15,'action','matchmaking_profile'),
        jsonb_build_object('key','first_company_match','label','Explore first company match','completed',viewed_partner_match_count > 0,'earned',0,'weight',0,'available_count',partner_match_count,'action','company_match'),
        jsonb_build_object('key','first_tender_match','label','Explore first tender match','completed',viewed_tender_match_count > 0,'earned',0,'weight',0,'available_count',tender_match_count,'action','tender_match')
      );
    end if;
  elsif buyer_row.user_id is not null then
    account_kind := 'buyer';
    account_role := 'buyer';
    profile_score := 15;
    if nullif(trim(coalesce(buyer_row.full_name, '')), '') is not null then profile_score := profile_score + 20; end if;
    if nullif(trim(coalesce(buyer_row.country, '')), '') is not null then profile_score := profile_score + 15; end if;

    if match_profile.id is not null then matchmaking_score := 10; end if;
    if coalesce(match_profile.profile_completeness, 0) >= 60 then matchmaking_score := 25; end if;
    profile_score := profile_score + matchmaking_score;

    has_interests := cardinality(coalesce(match_profile.interested_products, '{}'::text[])) > 0
      or cardinality(coalesce(match_profile.product_categories, '{}'::text[])) > 0;
    has_markets := cardinality(coalesce(match_profile.preferred_supplier_countries, '{}'::text[])) > 0
      or cardinality(coalesce(match_profile.target_countries, '{}'::text[])) > 0
      or cardinality(coalesce(match_profile.served_countries, '{}'::text[])) > 0;
    if has_interests then profile_score := profile_score + 15; end if;
    if has_markets then profile_score := profile_score + 10; end if;

    if match_profile.id is not null then
      select count(*)::integer,
             count(*) filter (where match_item.status <> 'new')::integer
      into partner_match_count, viewed_partner_match_count
      from public.matchmaking_matches match_item
      where match_item.source_profile_id = match_profile.id;
    end if;

    checks := jsonb_build_array(
      jsonb_build_object('key','account_created','label','Create account','completed',true,'earned',15,'weight',15,'action','buyer_dashboard'),
      jsonb_build_object('key','buyer_profile','label','Complete buyer profile','completed',nullif(trim(coalesce(buyer_row.full_name, '')), '') is not null and nullif(trim(coalesce(buyer_row.country, '')), '') is not null,'earned',(case when nullif(trim(coalesce(buyer_row.full_name, '')), '') is not null then 20 else 0 end) + (case when nullif(trim(coalesce(buyer_row.country, '')), '') is not null then 15 else 0 end),'weight',35,'action','buyer_profile'),
      jsonb_build_object('key','matchmaking_profile','label','Complete matchmaking profile','completed',matchmaking_score = 25,'earned',matchmaking_score,'weight',25,'action','matchmaking_profile'),
      jsonb_build_object('key','product_interests','label','Add product interests','completed',has_interests,'earned',case when has_interests then 15 else 0 end,'weight',15,'action','matchmaking_profile'),
      jsonb_build_object('key','target_markets','label','Select target markets','completed',has_markets,'earned',case when has_markets then 10 else 0 end,'weight',10,'action','matchmaking_profile'),
      jsonb_build_object('key','first_company_match','label','Explore first company match','completed',viewed_partner_match_count > 0,'earned',0,'weight',0,'available_count',partner_match_count,'action','company_match')
    );
  else
    checks := jsonb_build_array(
      jsonb_build_object('key','account_created','label','Create account','completed',true,'earned',10,'weight',10,'action','dashboard'),
      jsonb_build_object('key','account_type','label','Choose how you will use MedicHall','completed',false,'earned',0,'weight',90,'action','account_type')
    );
  end if;

  profile_score := greatest(0, least(100, profile_score));

  return jsonb_build_object(
    'version', 1,
    'account_kind', account_kind,
    'account_role', account_role,
    'profile_score', profile_score,
    'profile_ready', profile_score >= 70,
    'checks', checks,
    'first_value', jsonb_build_object(
      'company_matches', partner_match_count,
      'tender_matches', tender_match_count,
      'distributor_matches', distributor_match_count,
      'products', product_count
    ),
    'progress', jsonb_build_object(
      'last_step', progress_row.last_step,
      'dismissed_at', progress_row.dismissed_at,
      'completed_at', progress_row.completed_at
    ),
    'show_guidance', profile_score < 100
      and progress_row.dismissed_at is null
      and progress_row.completed_at is null
  );
end;
$function$;

comment on function public.get_account_activation_state_v1() is
  'Returns the authenticated user deterministic onboarding checklist, weighted profile score, and actual available opportunity counts without accepting a tenant identifier.';

create or replace function public.set_account_onboarding_progress_v1(
  p_last_step text default null,
  p_dismissed boolean default false,
  p_completed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_user_id uuid := auth.uid();
  current_account_kind text := 'unclassified';
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_last_step is not null and p_last_step not in (
    'dashboard', 'buyer_dashboard', 'account_type', 'company_profile',
    'company_logo', 'certifications', 'first_product', 'tender_preferences',
    'matchmaking_profile', 'company_match', 'tender_match', 'buyer_profile'
  ) then
    raise exception 'Unsupported onboarding step' using errcode = '22023';
  end if;

  if exists (select 1 from public.companies company where company.owner_id = current_user_id) then
    current_account_kind := 'company';
  elsif exists (select 1 from public.buyer_profiles buyer where buyer.user_id = current_user_id) then
    current_account_kind := 'buyer';
  end if;

  insert into public.account_onboarding_progress (
    user_id, account_kind, last_step, dismissed_at, completed_at
  ) values (
    current_user_id,
    current_account_kind,
    p_last_step,
    case when p_dismissed then now() else null end,
    case when p_completed then now() else null end
  )
  on conflict (user_id) do update
  set account_kind = excluded.account_kind,
      last_step = coalesce(excluded.last_step, account_onboarding_progress.last_step),
      dismissed_at = excluded.dismissed_at,
      completed_at = case
        when p_completed then now()
        else account_onboarding_progress.completed_at
      end,
      updated_at = now();

  return public.get_account_activation_state_v1();
end;
$function$;

comment on function public.set_account_onboarding_progress_v1(text, boolean, boolean) is
  'Stores only resume/dismiss/completion UI state for auth.uid(); canonical completion facts remain derived.';

revoke all on function public.get_account_activation_state_v1() from public, anon;
revoke all on function public.set_account_onboarding_progress_v1(text, boolean, boolean) from public, anon;
grant execute on function public.get_account_activation_state_v1() to authenticated;
grant execute on function public.set_account_onboarding_progress_v1(text, boolean, boolean) to authenticated;

commit;

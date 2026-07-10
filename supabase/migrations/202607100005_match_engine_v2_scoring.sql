-- MedicHall Match Engine v2 scoring
-- Fixes three weaknesses of the v1.1 rules:
--  1) Keyword matching was exact array equality ("probe cover" did not match
--     "ultrasound probe cover"). Now keywords are searched inside the tender
--     title + description text, with partial matching.
--  2) Empty profile fields (e.g. no CPV codes) silently dragged scores down.
--     Weights are now redistributed when a component is not applicable.
--  3) refresh_company_opportunity_matches deleted all matches on every run,
--     losing saved/contacted statuses, and could not be called by the TED
--     sync job. It now upserts (status preserved) and allows service_role.
-- Also: reasons are now a JSON array of strings (matches the portal UI).
-- Safe to run multiple times.

begin;

-- ---------------------------------------------------------------------------
-- 1) Text-aware keyword scoring
-- ---------------------------------------------------------------------------

create or replace function public.keyword_text_score(
  p_profile_keywords text[],
  p_opportunity_keywords text[],
  p_haystack text
)
returns integer
language sql
immutable
as $$
  with pk as (
    select distinct lower(trim(k)) as k
      from unnest(coalesce(p_profile_keywords, '{}'::text[])) as k
     where trim(k) <> ''
  ),
  ok as (
    select distinct lower(trim(v)) as v
      from unnest(coalesce(p_opportunity_keywords, '{}'::text[])) as v
     where trim(v) <> ''
  ),
  hay as (
    select lower(coalesce(p_haystack, '')) as h
  ),
  matched as (
    select count(*) as c
      from pk
     where exists (select 1 from hay where hay.h like '%' || pk.k || '%')
        or exists (
             select 1 from ok
              where ok.v like '%' || pk.k || '%'
                 or pk.k like '%' || ok.v || '%'
           )
  ),
  total as (select count(*) as c from pk)
  select case
    when total.c = 0 then 0
    else least(100, round(100.0 * matched.c / total.c)::integer)
  end
  from matched, total;
$$;

create or replace function public.matched_keyword_list(
  p_profile_keywords text[],
  p_opportunity_keywords text[],
  p_haystack text
)
returns text[]
language sql
immutable
as $$
  with pk as (
    select distinct lower(trim(k)) as k
      from unnest(coalesce(p_profile_keywords, '{}'::text[])) as k
     where trim(k) <> ''
  ),
  ok as (
    select distinct lower(trim(v)) as v
      from unnest(coalesce(p_opportunity_keywords, '{}'::text[])) as v
     where trim(v) <> ''
  ),
  hay as (
    select lower(coalesce(p_haystack, '')) as h
  )
  select coalesce(array_agg(pk.k order by pk.k), '{}'::text[])
    from pk
   where exists (select 1 from hay where hay.h like '%' || pk.k || '%')
      or exists (
           select 1 from ok
            where ok.v like '%' || pk.k || '%'
               or pk.k like '%' || ok.v || '%'
         );
$$;

-- ---------------------------------------------------------------------------
-- 2) Rebuilt match generator
-- ---------------------------------------------------------------------------

create or replace function public.refresh_company_opportunity_matches(
  p_company_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.company_match_profiles;
  v_tender_count integer := 0;
  v_distributor_count integer := 0;
  v_has_cpv boolean;
begin
  if not (
    public.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1
        from public.companies c
       where c.id = p_company_id
         and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  select * into v_profile
    from public.company_match_profiles
   where company_id = p_company_id;

  if v_profile.company_id is null then
    raise exception 'Company match profile not found';
  end if;

  v_has_cpv := coalesce(array_length(v_profile.cpv_codes, 1), 0) > 0;

  -- Tender matches (upsert; user status is preserved)
  insert into public.opportunity_matches (
    company_id, opportunity_type, tender_id,
    match_score, confidence_score,
    keyword_score, geography_score, certification_score, category_score,
    reasons, risks, generated_by, generated_at, updated_at
  )
  select
    p_company_id,
    'tender',
    t.id,
    case
      when v_has_cpv then round(0.50 * s.kw + 0.30 * s.geo + 0.20 * s.cpvs)::integer
      else round(0.60 * s.kw + 0.40 * s.geo)::integer
    end,
    70,
    s.kw,
    s.geo,
    0,
    s.cpvs,
    to_jsonb(
      array_remove(
        array[
          case
            when coalesce(array_length(s.mk, 1), 0) > 0
            then 'Keywords: ' || array_to_string(s.mk, ', ')
          end,
          case
            when s.geo = 100
            then 'Target country: ' || coalesce(t.country_name, t.country_code, '')
          end,
          case when s.cpvs > 0 then 'CPV codes overlap' end
        ],
        null
      )
    ),
    case
      when t.deadline_at is not null and t.deadline_at < now() + interval '7 days'
      then jsonb_build_array('Deadline is within 7 days')
      else '[]'::jsonb
    end,
    'rules-v2',
    now(),
    now()
  from public.tenders t
  cross join lateral (
    select
      public.keyword_text_score(
        v_profile.product_keywords,
        t.product_keywords,
        coalesce(t.title, '') || ' ' || coalesce(t.description, '')
      ) as kw,
      public.country_match_score(v_profile.target_countries, t.country_code, t.country_name) as geo,
      public.array_overlap_score(v_profile.cpv_codes, t.cpv_codes) as cpvs,
      public.matched_keyword_list(
        v_profile.product_keywords,
        t.product_keywords,
        coalesce(t.title, '') || ' ' || coalesce(t.description, '')
      ) as mk
  ) s
  where t.status = 'open'
    and (t.deadline_at is null or t.deadline_at > now())
  on conflict (company_id, tender_id)
  where tender_id is not null
  do update set
    match_score = excluded.match_score,
    keyword_score = excluded.keyword_score,
    geography_score = excluded.geography_score,
    certification_score = excluded.certification_score,
    category_score = excluded.category_score,
    reasons = excluded.reasons,
    risks = excluded.risks,
    generated_by = excluded.generated_by,
    generated_at = excluded.generated_at,
    updated_at = excluded.updated_at;

  get diagnostics v_tender_count = row_count;

  -- Distributor matches (upsert; user status is preserved)
  insert into public.opportunity_matches (
    company_id, opportunity_type, distributor_id,
    match_score, confidence_score,
    keyword_score, geography_score, certification_score, category_score,
    reasons, risks, generated_by, generated_at, updated_at
  )
  select
    p_company_id,
    'distributor',
    d.id,
    round(0.55 * s.kw + 0.45 * s.geo)::integer,
    70,
    s.kw,
    s.geo,
    public.array_overlap_score(v_profile.certifications, d.certifications),
    public.array_overlap_score(v_profile.product_keywords, d.product_keywords),
    to_jsonb(
      array_remove(
        array[
          case
            when coalesce(array_length(s.mk, 1), 0) > 0
            then 'Keywords: ' || array_to_string(s.mk, ', ')
          end,
          case
            when s.geo = 100
            then 'Target country: ' || coalesce(d.country_name, d.country_code, '')
          end,
          case
            when d.verification_status = 'verified' then 'Verified distributor'
          end
        ],
        null
      )
    ),
    '[]'::jsonb,
    'rules-v2',
    now(),
    now()
  from public.distributor_candidates d
  cross join lateral (
    select
      public.keyword_text_score(
        v_profile.product_keywords,
        d.product_keywords,
        coalesce(d.name, '') || ' ' ||
        array_to_string(coalesce(d.product_keywords, '{}'::text[]), ' ') || ' ' ||
        array_to_string(coalesce(d.product_categories, '{}'::text[]), ' ')
      ) as kw,
      public.country_match_score(v_profile.target_countries, d.country_code, d.country_name) as geo,
      public.matched_keyword_list(
        v_profile.product_keywords,
        d.product_keywords,
        coalesce(d.name, '') || ' ' ||
        array_to_string(coalesce(d.product_keywords, '{}'::text[]), ' ')
      ) as mk
  ) s
  where d.is_active = true
    and d.verification_status in ('reviewed', 'verified')
  on conflict (company_id, distributor_id)
  where distributor_id is not null
  do update set
    match_score = excluded.match_score,
    keyword_score = excluded.keyword_score,
    geography_score = excluded.geography_score,
    certification_score = excluded.certification_score,
    category_score = excluded.category_score,
    reasons = excluded.reasons,
    risks = excluded.risks,
    generated_by = excluded.generated_by,
    generated_at = excluded.generated_at,
    updated_at = excluded.updated_at;

  get diagnostics v_distributor_count = row_count;

  -- Drop untouched matches whose tender has closed (keep saved/contacted history)
  delete from public.opportunity_matches om
   using public.tenders t
   where om.company_id = p_company_id
     and om.tender_id = t.id
     and om.status = 'new'
     and (t.status <> 'open' or (t.deadline_at is not null and t.deadline_at <= now()));

  update public.company_match_profiles
     set last_indexed_at = now(),
         updated_at = now()
   where company_id = p_company_id;

  return jsonb_build_object(
    'company_id', p_company_id,
    'tender_rows_processed', v_tender_count,
    'distributor_rows_processed', v_distributor_count,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.refresh_company_opportunity_matches(bigint) from public;
grant execute on function public.refresh_company_opportunity_matches(bigint) to authenticated;
grant execute on function public.refresh_company_opportunity_matches(bigint) to service_role;

commit;

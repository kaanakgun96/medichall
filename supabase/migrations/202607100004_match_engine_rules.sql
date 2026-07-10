-- MedicHall Match Engine v1.1
-- Run AFTER 202607100003_match_engine_foundation.sql
-- Adds safe workflow updates and the first deterministic matching engine.

begin;

-- ---------------------------------------------------------------------------
-- 1) Owners must not be able to edit scores, reasons or AI summaries directly.
--    They change only the workflow status through an RPC function.
-- ---------------------------------------------------------------------------

drop policy if exists "owner update own opportunity matches"
on public.opportunity_matches;

create or replace function public.set_opportunity_match_status(
  p_match_id bigint,
  p_status text
)
returns public.opportunity_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.opportunity_matches;
begin
  if p_status not in ('new', 'viewed', 'saved', 'contacted', 'dismissed', 'applied') then
    raise exception 'Invalid opportunity status';
  end if;

  update public.opportunity_matches om
     set status = p_status,
         updated_at = now()
   where om.id = p_match_id
     and (
       public.is_admin()
       or exists (
         select 1
           from public.companies c
          where c.id = om.company_id
            and c.owner_id = auth.uid()
       )
     )
  returning * into v_match;

  if v_match.id is null then
    raise exception 'Opportunity not found or access denied';
  end if;

  return v_match;
end;
$$;

revoke all on function public.set_opportunity_match_status(bigint, text) from public;
grant execute on function public.set_opportunity_match_status(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Reusable overlap helpers
-- ---------------------------------------------------------------------------

create or replace function public.array_overlap_score(
  p_profile_values text[],
  p_opportunity_values text[]
)
returns integer
language sql
immutable
as $$
  with profile_values as (
    select distinct lower(trim(value)) as value
      from unnest(coalesce(p_profile_values, '{}'::text[])) as value
     where trim(value) <> ''
  ),
  opportunity_values as (
    select distinct lower(trim(value)) as value
      from unnest(coalesce(p_opportunity_values, '{}'::text[])) as value
     where trim(value) <> ''
  ),
  totals as (
    select
      (select count(*) from profile_values) as profile_count,
      (
        select count(*)
          from profile_values p
          join opportunity_values o using (value)
      ) as overlap_count
  )
  select case
    when profile_count = 0 then 0
    else least(100, round(100.0 * overlap_count / profile_count)::integer)
  end
  from totals;
$$;

create or replace function public.country_match_score(
  p_target_countries text[],
  p_country_code text,
  p_country_name text
)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(array_length(p_target_countries, 1), 0) = 0 then 50
    when exists (
      select 1
        from unnest(p_target_countries) target
       where lower(trim(target)) in (
         lower(trim(coalesce(p_country_code, ''))),
         lower(trim(coalesce(p_country_name, '')))
       )
    ) then 100
    else 0
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3) First rule-based match generator
--    AI enrichment will later process only high-value matches.
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
begin
  if not (
    public.is_admin()
    or exists (
      select 1
        from public.companies c
       where c.id = p_company_id
         and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  select *
    into v_profile
    from public.company_match_profiles
   where company_id = p_company_id;

  if v_profile.company_id is null then
    raise exception 'Company match profile not found';
  end if;

  -- Tender matches
  insert into public.opportunity_matches (
    company_id,
    opportunity_type,
    tender_id,
    match_score,
    confidence_score,
    keyword_score,
    geography_score,
    certification_score,
    category_score,
    reasons,
    risks,
    generated_by,
    generated_at,
    updated_at
  )
  select
    p_company_id,
    'tender',
    t.id,
    round(
      0.40 * public.array_overlap_score(v_profile.product_keywords, t.product_keywords)
      + 0.20 * public.country_match_score(
          v_profile.target_countries,
          t.country_code,
          t.country_name
        )
      + 0.20 * public.array_overlap_score(
          v_profile.certifications,
          coalesce(
            array(
              select jsonb_array_elements_text(
                coalesce(t.raw_payload -> 'required_certifications', '[]'::jsonb)
              )
            ),
            '{}'::text[]
          )
        )
      + 0.20 * public.array_overlap_score(v_profile.cpv_codes, t.cpv_codes)
    )::integer,
    70,
    public.array_overlap_score(v_profile.product_keywords, t.product_keywords),
    public.country_match_score(v_profile.target_countries, t.country_code, t.country_name),
    public.array_overlap_score(
      v_profile.certifications,
      coalesce(
        array(
          select jsonb_array_elements_text(
            coalesce(t.raw_payload -> 'required_certifications', '[]'::jsonb)
          )
        ),
        '{}'::text[]
      )
    ),
    public.array_overlap_score(v_profile.cpv_codes, t.cpv_codes),
    jsonb_strip_nulls(
      jsonb_build_object(
        'product_keywords',
        case
          when public.array_overlap_score(v_profile.product_keywords, t.product_keywords) > 0
          then 'Product keywords overlap'
        end,
        'country',
        case
          when public.country_match_score(
            v_profile.target_countries,
            t.country_code,
            t.country_name
          ) = 100
          then 'Target country matches'
        end,
        'cpv',
        case
          when public.array_overlap_score(v_profile.cpv_codes, t.cpv_codes) > 0
          then 'CPV codes overlap'
        end
      )
    ),
    case
      when t.deadline_at is not null and t.deadline_at < now() + interval '7 days'
      then jsonb_build_array('Deadline is within 7 days')
      else '[]'::jsonb
    end,
    'rules-v1.1',
    now(),
    now()
  from public.tenders t
  where t.status = 'open'
    and (t.deadline_at is null or t.deadline_at > now())
  on conflict (company_id, tender_id)
  where tender_id is not null
  do update set
    match_score = excluded.match_score,
    confidence_score = excluded.confidence_score,
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

  -- Distributor matches
  insert into public.opportunity_matches (
    company_id,
    opportunity_type,
    distributor_id,
    match_score,
    confidence_score,
    keyword_score,
    geography_score,
    certification_score,
    category_score,
    reasons,
    risks,
    generated_by,
    generated_at,
    updated_at
  )
  select
    p_company_id,
    'distributor',
    d.id,
    round(
      0.45 * public.array_overlap_score(v_profile.product_keywords, d.product_keywords)
      + 0.25 * public.country_match_score(
          v_profile.target_countries,
          d.country_code,
          d.country_name
        )
      + 0.15 * public.array_overlap_score(v_profile.certifications, d.certifications)
      + 0.15 * public.array_overlap_score(v_profile.target_partner_types, array[d.company_type])
    )::integer,
    case d.verification_status
      when 'verified' then 90
      when 'reviewed' then 75
      else 55
    end,
    public.array_overlap_score(v_profile.product_keywords, d.product_keywords),
    public.country_match_score(v_profile.target_countries, d.country_code, d.country_name),
    public.array_overlap_score(v_profile.certifications, d.certifications),
    public.array_overlap_score(v_profile.target_partner_types, array[d.company_type]),
    jsonb_strip_nulls(
      jsonb_build_object(
        'product_keywords',
        case
          when public.array_overlap_score(v_profile.product_keywords, d.product_keywords) > 0
          then 'Product portfolio overlaps'
        end,
        'country',
        case
          when public.country_match_score(
            v_profile.target_countries,
            d.country_code,
            d.country_name
          ) = 100
          then 'Located in a target market'
        end,
        'verification',
        case
          when d.verification_status = 'verified'
          then 'Candidate is verified'
        end
      )
    ),
    case
      when d.verification_status = 'unverified'
      then jsonb_build_array('Candidate has not been verified yet')
      else '[]'::jsonb
    end,
    'rules-v1.1',
    now(),
    now()
  from public.distributor_candidates d
  where d.is_active = true
    and d.verification_status in ('reviewed', 'verified')
  on conflict (company_id, distributor_id)
  where distributor_id is not null
  do update set
    match_score = excluded.match_score,
    confidence_score = excluded.confidence_score,
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

commit;

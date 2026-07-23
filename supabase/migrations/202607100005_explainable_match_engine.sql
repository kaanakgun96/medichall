-- MedicHall Explainable Match Engine v1
-- Run after:
--   202607100003_match_engine_foundation.sql
--   202607100004_match_engine_rules.sql

begin;

-- Tender-level document extraction state.
alter table public.tenders
  add column if not exists document_analysis_status text not null default 'not_started',
  add column if not exists document_confidence_score integer not null default 0,
  add column if not exists data_completeness_score integer not null default 0,
  add column if not exists analyzed_document_count integer not null default 0,
  add column if not exists extracted_products jsonb not null default '[]'::jsonb,
  add column if not exists missing_information text[] not null default '{}',
  add column if not exists document_analysis_notes text,
  add column if not exists last_document_analysis_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenders_document_analysis_status_check'
  ) then
    alter table public.tenders
      add constraint tenders_document_analysis_status_check
      check (
        document_analysis_status in (
          'not_started',
          'queued',
          'processing',
          'completed',
          'partial',
          'failed'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenders_document_confidence_score_check'
  ) then
    alter table public.tenders
      add constraint tenders_document_confidence_score_check
      check (document_confidence_score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenders_data_completeness_score_check'
  ) then
    alter table public.tenders
      add constraint tenders_data_completeness_score_check
      check (data_completeness_score between 0 and 100);
  end if;
end
$$;

-- Opportunity rows keep separate scores instead of presenting one unexplained number.
alter table public.opportunity_matches
  add column if not exists profile_match_score integer,
  add column if not exists document_match_score integer,
  add column if not exists opportunity_score integer,
  add column if not exists confidence_level text not null default 'low',
  add column if not exists score_basis text not null default 'structured_data',
  add column if not exists missing_information text[] not null default '{}',
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists next_best_action text;

update public.opportunity_matches
set
  profile_match_score = coalesce(profile_match_score, match_score),
  opportunity_score = coalesce(opportunity_score, match_score),
  confidence_level = case
    when coalesce(confidence_score, 0) >= 85 then 'high'
    when coalesce(confidence_score, 0) >= 60 then 'medium'
    else 'low'
  end
where profile_match_score is null
   or opportunity_score is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunity_matches_profile_match_score_check'
  ) then
    alter table public.opportunity_matches
      add constraint opportunity_matches_profile_match_score_check
      check (profile_match_score is null or profile_match_score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunity_matches_document_match_score_check'
  ) then
    alter table public.opportunity_matches
      add constraint opportunity_matches_document_match_score_check
      check (document_match_score is null or document_match_score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunity_matches_opportunity_score_check'
  ) then
    alter table public.opportunity_matches
      add constraint opportunity_matches_opportunity_score_check
      check (opportunity_score is null or opportunity_score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunity_matches_confidence_level_check'
  ) then
    alter table public.opportunity_matches
      add constraint opportunity_matches_confidence_level_check
      check (confidence_level in ('low', 'medium', 'high'));
  end if;
end
$$;

-- Build explicit missing-information list from structured tender data.
create or replace function public.tender_missing_information(p_tender public.tenders)
returns text[]
language sql
stable
as $$
  select array_remove(array[
    case
      when coalesce(jsonb_array_length(p_tender.extracted_products), 0) = 0
      then 'Product names and technical specifications'
    end,
    case
      when not exists (
        select 1
        from jsonb_array_elements(coalesce(p_tender.extracted_products, '[]'::jsonb)) item
        where nullif(trim(item ->> 'quantity'), '') is not null
           or nullif(trim(item ->> 'quantity_value'), '') is not null
      )
      then 'Product quantities'
    end,
    case
      when coalesce(array_length(p_tender.cpv_codes, 1), 0) = 0
      then 'CPV classification'
    end,
    case
      when coalesce(
        jsonb_array_length(
          coalesce(p_tender.raw_payload -> 'required_certifications', '[]'::jsonb)
        ),
        0
      ) = 0
      then 'Required certificates'
    end,
    case
      when p_tender.deadline_at is null
      then 'Submission deadline'
    end,
    case
      when p_tender.estimated_value is null
      then 'Estimated tender value'
    end
  ], null);
$$;

-- Recalculate explainable tender scores.
create or replace function public.refresh_explainable_tender_matches(
  p_company_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Reuse the existing deterministic generator first.
  perform public.refresh_company_opportunity_matches(p_company_id);

  update public.opportunity_matches om
  set
    profile_match_score = om.match_score,
    document_match_score = case
      when t.document_analysis_status in ('completed', 'partial')
        then greatest(0, least(100, t.document_confidence_score))
      else null
    end,
    opportunity_score = case
      when t.document_analysis_status = 'completed'
        then round(
          (om.match_score * 0.45)
          + (coalesce(t.document_confidence_score, 0) * 0.35)
          + (coalesce(t.data_completeness_score, 0) * 0.20)
        )::integer
      when t.document_analysis_status = 'partial'
        then round(
          (om.match_score * 0.70)
          + (coalesce(t.document_confidence_score, 0) * 0.20)
          + (coalesce(t.data_completeness_score, 0) * 0.10)
        )::integer
      else om.match_score
    end,
    confidence_level = case
      when t.document_analysis_status = 'completed'
       and t.data_completeness_score >= 75
       and t.document_confidence_score >= 75
        then 'high'
      when t.document_analysis_status in ('completed', 'partial')
        then 'medium'
      else 'low'
    end,
    score_basis = case
      when t.document_analysis_status = 'completed'
        then 'structured_and_documents'
      when t.document_analysis_status = 'partial'
        then 'structured_and_partial_documents'
      else 'structured_data'
    end,
    missing_information = public.tender_missing_information(t),
    evidence = jsonb_build_array(
      jsonb_build_object(
        'label', 'Product/category overlap',
        'score', om.keyword_score,
        'source', 'structured tender data'
      ),
      jsonb_build_object(
        'label', 'Target country',
        'score', om.geography_score,
        'source', 'structured tender data'
      ),
      jsonb_build_object(
        'label', 'CPV/category',
        'score', om.category_score,
        'source', 'structured tender data'
      ),
      jsonb_build_object(
        'label', 'Certificates',
        'score', om.certification_score,
        'source',
          case
            when t.document_analysis_status in ('completed', 'partial')
              then 'tender documents'
            else 'structured tender data'
          end
      )
    ),
    next_best_action = case
      when t.document_analysis_status = 'not_started'
        then 'Analyze tender documents'
      when t.document_analysis_status = 'queued'
        then 'Document analysis is queued'
      when t.document_analysis_status = 'processing'
        then 'Wait for document analysis to finish'
      when t.document_analysis_status = 'failed'
        then 'Retry document analysis'
      when coalesce(array_length(public.tender_missing_information(t), 1), 0) > 0
        then 'Review missing tender information'
      else 'Review opportunity and prepare application'
    end,
    confidence_score = case
      when t.document_analysis_status = 'completed'
        then round(
          (t.document_confidence_score * 0.60)
          + (t.data_completeness_score * 0.40)
        )::integer
      when t.document_analysis_status = 'partial'
        then least(
          79,
          round(
            (t.document_confidence_score * 0.55)
            + (t.data_completeness_score * 0.25)
          )::integer
        )
      else least(55, greatest(20, om.confidence_score))
    end,
    updated_at = now()
  from public.tenders t
  where om.company_id = p_company_id
    and om.opportunity_type = 'tender'
    and om.tender_id = t.id;

  select jsonb_build_object(
    'company_id', p_company_id,
    'tender_matches', count(*),
    'generated_at', now()
  )
  into v_result
  from public.opportunity_matches
  where company_id = p_company_id
    and opportunity_type = 'tender';

  return v_result;
end;
$$;

revoke all on function public.refresh_explainable_tender_matches(bigint) from public;
grant execute on function public.refresh_explainable_tender_matches(bigint) to authenticated;

-- Admin/service-side function used by the future document extractor.
create or replace function public.save_tender_document_analysis(
  p_tender_id bigint,
  p_status text,
  p_document_confidence_score integer,
  p_data_completeness_score integer,
  p_analyzed_document_count integer,
  p_extracted_products jsonb,
  p_missing_information text[],
  p_notes text default null
)
returns public.tenders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tender public.tenders;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_status not in ('completed', 'partial', 'failed') then
    raise exception 'Invalid analysis status';
  end if;

  update public.tenders
  set
    document_analysis_status = p_status,
    document_confidence_score = greatest(0, least(100, p_document_confidence_score)),
    data_completeness_score = greatest(0, least(100, p_data_completeness_score)),
    analyzed_document_count = greatest(0, p_analyzed_document_count),
    extracted_products = coalesce(p_extracted_products, '[]'::jsonb),
    missing_information = coalesce(p_missing_information, '{}'::text[]),
    document_analysis_notes = p_notes,
    last_document_analysis_at = now(),
    updated_at = now()
  where id = p_tender_id
  returning * into v_tender;

  if v_tender.id is null then
    raise exception 'Tender not found';
  end if;

  return v_tender;
end;
$$;

revoke all on function public.save_tender_document_analysis(
  bigint, text, integer, integer, integer, jsonb, text[], text
) from public;

grant execute on function public.save_tender_document_analysis(
  bigint, text, integer, integer, integer, jsonb, text[], text
) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Consolidated from the former duplicate-version migration
-- 202607100005_match_engine_v2_scoring.sql. Keeping both changes under one
-- numeric migration version preserves the repository's historical execution
-- order while making the chain unambiguous to the Supabase CLI.
-- ---------------------------------------------------------------------------

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

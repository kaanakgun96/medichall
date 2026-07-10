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

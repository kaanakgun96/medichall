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
-- MedicHall Tender Document Engine v1
-- Run after 202607100005_explainable_match_engine.sql

begin;

create table if not exists public.tender_documents (
  id bigint generated by default as identity primary key,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  title text,
  file_name text,
  file_url text not null,
  mime_type text,
  file_size_bytes bigint,
  source_page_url text,
  document_type text not null default 'other',
  language_code text,
  is_active boolean not null default true,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tender_id, file_url)
);

create table if not exists public.tender_document_analysis_jobs (
  id bigint generated by default as identity primary key,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  company_id bigint references public.companies(id) on delete set null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  selected_document_ids bigint[] not null default '{}',
  model_name text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_document_evidence (
  id bigint generated by default as identity primary key,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  document_id bigint references public.tender_documents(id) on delete cascade,
  job_id bigint references public.tender_document_analysis_jobs(id) on delete cascade,
  evidence_type text not null,
  product_name text,
  field_name text,
  extracted_value text,
  quantity_value numeric,
  quantity_unit text,
  lot_number text,
  page_number integer,
  sheet_name text,
  cell_range text,
  source_quote text,
  confidence_score integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tender_documents_tender_idx
  on public.tender_documents(tender_id);

create index if not exists tender_analysis_jobs_tender_status_idx
  on public.tender_document_analysis_jobs(tender_id, status, created_at desc);

create index if not exists tender_document_evidence_tender_idx
  on public.tender_document_evidence(tender_id, evidence_type);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_analysis_jobs_status_check'
  ) then
    alter table public.tender_document_analysis_jobs
      add constraint tender_analysis_jobs_status_check
      check (status in ('queued','processing','completed','partial','failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_documents_type_check'
  ) then
    alter table public.tender_documents
      add constraint tender_documents_type_check
      check (document_type in (
        'technical_specification',
        'price_schedule',
        'boq',
        'contract_notice',
        'administrative',
        'lot_document',
        'other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_document_evidence_confidence_check'
  ) then
    alter table public.tender_document_evidence
      add constraint tender_document_evidence_confidence_check
      check (confidence_score between 0 and 100);
  end if;
end
$$;

alter table public.tender_documents enable row level security;
alter table public.tender_document_analysis_jobs enable row level security;
alter table public.tender_document_evidence enable row level security;

drop policy if exists "authenticated read tender documents" on public.tender_documents;
create policy "authenticated read tender documents"
on public.tender_documents for select
to authenticated
using (is_active = true);

drop policy if exists "admin manage tender documents" on public.tender_documents;
create policy "admin manage tender documents"
on public.tender_documents for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "users read own analysis jobs" on public.tender_document_analysis_jobs;
create policy "users read own analysis jobs"
on public.tender_document_analysis_jobs for select
to authenticated
using (
  requested_by = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.companies c
    where c.id = company_id and c.owner_id = auth.uid()
  )
);

drop policy if exists "users read evidence for accessible jobs" on public.tender_document_evidence;
create policy "users read evidence for accessible jobs"
on public.tender_document_evidence for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.tender_document_analysis_jobs j
    left join public.companies c on c.id = j.company_id
    where j.id = job_id
      and (j.requested_by = auth.uid() or c.owner_id = auth.uid())
  )
);

create or replace function public.queue_tender_document_analysis(
  p_tender_id bigint,
  p_company_id bigint
)
returns public.tender_document_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.tender_document_analysis_jobs;
  v_document_ids bigint[];
begin
  if not (
    public.is_admin()
    or exists (
      select 1 from public.companies c
      where c.id = p_company_id and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  if not exists (select 1 from public.tenders where id = p_tender_id) then
    raise exception 'Tender not found';
  end if;

  select coalesce(array_agg(id order by id), '{}'::bigint[])
  into v_document_ids
  from (
    select id
    from public.tender_documents
    where tender_id = p_tender_id
      and is_active = true
      and lower(coalesce(mime_type, '')) in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'text/plain'
      )
    order by
      case document_type
        when 'technical_specification' then 1
        when 'boq' then 2
        when 'price_schedule' then 3
        when 'lot_document' then 4
        else 9
      end,
      id
    limit 6
  ) selected;

  if coalesce(array_length(v_document_ids, 1), 0) = 0 then
    raise exception 'No supported tender documents are registered';
  end if;

  if exists (
    select 1 from public.tender_document_analysis_jobs
    where tender_id = p_tender_id
      and company_id = p_company_id
      and status in ('queued','processing')
  ) then
    select *
    into v_job
    from public.tender_document_analysis_jobs
    where tender_id = p_tender_id
      and company_id = p_company_id
      and status in ('queued','processing')
    order by created_at desc
    limit 1;

    return v_job;
  end if;

  insert into public.tender_document_analysis_jobs (
    tender_id,
    requested_by,
    company_id,
    status,
    selected_document_ids
  )
  values (
    p_tender_id,
    auth.uid(),
    p_company_id,
    'queued',
    v_document_ids
  )
  returning * into v_job;

  update public.tenders
  set
    document_analysis_status = 'queued',
    updated_at = now()
  where id = p_tender_id;

  return v_job;
end;
$$;

revoke all on function public.queue_tender_document_analysis(bigint, bigint) from public;
grant execute on function public.queue_tender_document_analysis(bigint, bigint) to authenticated;

create or replace function public.get_tender_document_analysis_status(
  p_tender_id bigint,
  p_company_id bigint
)
returns table (
  job_id bigint,
  status text,
  error_message text,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    j.id,
    j.status,
    j.error_message,
    j.created_at,
    j.started_at,
    j.completed_at
  from public.tender_document_analysis_jobs j
  where j.tender_id = p_tender_id
    and j.company_id = p_company_id
    and (
      public.is_admin()
      or j.requested_by = auth.uid()
      or exists (
        select 1 from public.companies c
        where c.id = j.company_id and c.owner_id = auth.uid()
      )
    )
  order by j.created_at desc
  limit 1;
$$;

revoke all on function public.get_tender_document_analysis_status(bigint, bigint) from public;
grant execute on function public.get_tender_document_analysis_status(bigint, bigint) to authenticated;

commit;
begin;

create table if not exists public.tender_document_discovery_jobs (
  id bigint generated by default as identity primary key,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','partial','failed')),
  source_url text,
  pages_scanned integer not null default 0,
  links_examined integer not null default 0,
  documents_found integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tender_document_discovery_jobs enable row level security;

drop policy if exists "users read own discovery jobs"
on public.tender_document_discovery_jobs;

create policy "users read own discovery jobs"
on public.tender_document_discovery_jobs
for select to authenticated
using (
  public.is_admin()
  or requested_by = auth.uid()
  or exists (
    select 1 from public.companies c
    where c.id = company_id and c.owner_id = auth.uid()
  )
);

create or replace function public.queue_tender_document_discovery(
  p_tender_id bigint,
  p_company_id bigint
)
returns public.tender_document_discovery_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tender public.tenders;
  v_job public.tender_document_discovery_jobs;
begin
  if not (
    public.is_admin()
    or exists (
      select 1 from public.companies c
      where c.id = p_company_id and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  select * into v_tender from public.tenders where id = p_tender_id;
  if v_tender.id is null then raise exception 'Tender not found'; end if;
  if nullif(trim(v_tender.source_url), '') is null then
    raise exception 'Tender source URL is missing';
  end if;

  select * into v_job
  from public.tender_document_discovery_jobs
  where tender_id = p_tender_id
    and company_id = p_company_id
    and status in ('queued','processing')
  order by created_at desc
  limit 1;

  if v_job.id is not null then return v_job; end if;

  insert into public.tender_document_discovery_jobs (
    tender_id, company_id, requested_by, source_url
  )
  values (p_tender_id, p_company_id, auth.uid(), v_tender.source_url)
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.queue_tender_document_discovery(bigint,bigint) from public;
grant execute on function public.queue_tender_document_discovery(bigint,bigint) to authenticated;

create or replace function public.get_tender_document_discovery_status(
  p_tender_id bigint,
  p_company_id bigint
)
returns table (
  job_id bigint,
  status text,
  pages_scanned integer,
  links_examined integer,
  documents_found integer,
  error_message text,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select j.id,j.status,j.pages_scanned,j.links_examined,j.documents_found,
         j.error_message,j.completed_at
  from public.tender_document_discovery_jobs j
  where j.tender_id = p_tender_id
    and j.company_id = p_company_id
    and (
      public.is_admin()
      or j.requested_by = auth.uid()
      or exists (
        select 1 from public.companies c
        where c.id = j.company_id and c.owner_id = auth.uid()
      )
    )
  order by j.created_at desc
  limit 1;
$$;

revoke all on function public.get_tender_document_discovery_status(bigint,bigint) from public;
grant execute on function public.get_tender_document_discovery_status(bigint,bigint) to authenticated;

commit;
-- MedicHall Tender Automation v1
-- Adds TED resolution and safe archive preprocessing.
-- Run after 202607100007_tender_attachment_discovery.sql.

begin;

alter table public.tenders
  add column if not exists procurement_documents_url text,
  add column if not exists ted_resolution_status text not null default 'not_started',
  add column if not exists ted_resolved_at timestamptz,
  add column if not exists ted_resolution_notes text;

alter table public.tender_documents
  add column if not exists parent_document_id bigint
    references public.tender_documents(id) on delete cascade,
  add column if not exists storage_path text,
  add column if not exists sha256 text,
  add column if not exists archive_processing_status text not null default 'not_applicable',
  add column if not exists extracted_from_archive boolean not null default false,
  add column if not exists original_archive_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_documents_archive_status_check'
  ) then
    alter table public.tender_documents
      add constraint tender_documents_archive_status_check
      check (
        archive_processing_status in (
          'not_applicable','pending','processing','completed','partial','failed'
        )
      );
  end if;
end
$$;

create table if not exists public.tender_archive_jobs (
  id bigint generated by default as identity primary key,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  archive_document_id bigint not null
    references public.tender_documents(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','partial','failed')),
  files_examined integer not null default 0,
  files_created integer not null default 0,
  compressed_bytes bigint not null default 0,
  extracted_bytes bigint not null default 0,
  skipped_files jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (archive_document_id, status)
);

create index if not exists tender_archive_jobs_tender_idx
  on public.tender_archive_jobs(tender_id, created_at desc);

alter table public.tender_archive_jobs enable row level security;

drop policy if exists "users read own archive jobs" on public.tender_archive_jobs;
create policy "users read own archive jobs"
on public.tender_archive_jobs for select to authenticated
using (
  public.is_admin()
  or requested_by = auth.uid()
  or exists (
    select 1 from public.companies c
    where c.id = company_id and c.owner_id = auth.uid()
  )
);

-- Public procurement documents can be fetched by Claude through stable URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tender-documents', 'tender-documents', true, 104857600)
on conflict (id) do update set
  public = true,
  file_size_limit = 104857600;

drop policy if exists "public read tender document storage" on storage.objects;
create policy "public read tender document storage"
on storage.objects for select
using (bucket_id = 'tender-documents');

create or replace function public.queue_tender_archive_jobs(
  p_tender_id bigint,
  p_company_id bigint
)
returns setof public.tender_archive_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archive public.tender_documents;
  v_job public.tender_archive_jobs;
begin
  if not (
    public.is_admin()
    or exists (
      select 1 from public.companies c
      where c.id = p_company_id and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  for v_archive in
    select *
    from public.tender_documents
    where tender_id = p_tender_id
      and is_active = true
      and (
        lower(coalesce(mime_type,'')) = 'application/zip'
        or lower(coalesce(file_name,'')) like '%.zip'
        or lower(file_url) like '%.zip%'
      )
      and archive_processing_status not in ('processing','completed')
  loop
    select *
    into v_job
    from public.tender_archive_jobs
    where archive_document_id = v_archive.id
      and status in ('queued','processing')
    order by created_at desc
    limit 1;

    if v_job.id is null then
      insert into public.tender_archive_jobs (
        tender_id, archive_document_id, company_id, requested_by
      )
      values (
        p_tender_id, v_archive.id, p_company_id, auth.uid()
      )
      returning * into v_job;

      update public.tender_documents
      set archive_processing_status = 'pending', updated_at = now()
      where id = v_archive.id;
    end if;

    return next v_job;
  end loop;

  return;
end;
$$;

revoke all on function public.queue_tender_archive_jobs(bigint,bigint) from public;
grant execute on function public.queue_tender_archive_jobs(bigint,bigint)
to authenticated;

create or replace function public.get_tender_archive_status(
  p_tender_id bigint,
  p_company_id bigint
)
returns table (
  pending_count bigint,
  processing_count bigint,
  completed_count bigint,
  failed_count bigint,
  files_created bigint,
  last_error text
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where j.status='queued'),
    count(*) filter (where j.status='processing'),
    count(*) filter (where j.status in ('completed','partial')),
    count(*) filter (where j.status='failed'),
    coalesce(sum(j.files_created),0),
    (
      select j2.error_message
      from public.tender_archive_jobs j2
      where j2.tender_id=p_tender_id
        and j2.company_id=p_company_id
        and j2.error_message is not null
      order by j2.created_at desc limit 1
    )
  from public.tender_archive_jobs j
  where j.tender_id=p_tender_id
    and j.company_id=p_company_id
    and (
      public.is_admin()
      or j.requested_by=auth.uid()
      or exists (
        select 1 from public.companies c
        where c.id=j.company_id and c.owner_id=auth.uid()
      )
    );
$$;

revoke all on function public.get_tender_archive_status(bigint,bigint) from public;
grant execute on function public.get_tender_archive_status(bigint,bigint)
to authenticated;

commit;
-- ============================================================
-- 3-YAMA.sql — Bildirim-analizi (notice-only) moduna izin ver
-- Sorun: queue_tender_document_analysis, hiç doküman kaydı yoksa
-- 'No supported tender documents are registered' hatasıyla işi
-- reddediyordu. Motor artık doküman yoksa TED bildirim sayfasını
-- analiz edebildiği için bu engel kaldırılıyor: iş, boş doküman
-- listesiyle de kuyruğa girebilir. Diğer her şey birebir aynı.
-- Tekrar çalıştırmaya dayanıklıdır.
-- ============================================================

create or replace function public.queue_tender_document_analysis(
  p_tender_id bigint,
  p_company_id bigint
)
returns public.tender_document_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.tender_document_analysis_jobs;
  v_document_ids bigint[];
begin
  if not (
    public.is_admin()
    or exists (
      select 1 from public.companies c
      where c.id = p_company_id and c.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  if not exists (select 1 from public.tenders where id = p_tender_id) then
    raise exception 'Tender not found';
  end if;

  select coalesce(array_agg(id order by id), '{}'::bigint[])
  into v_document_ids
  from (
    select id
    from public.tender_documents
    where tender_id = p_tender_id
      and is_active = true
      and lower(coalesce(mime_type, '')) in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'text/plain'
      )
    order by
      case document_type
        when 'technical_specification' then 1
        when 'boq' then 2
        when 'price_schedule' then 3
        when 'lot_document' then 4
        else 9
      end,
      id
    limit 6
  ) selected;

  -- DEĞİŞİKLİK: doküman yoksa hata ATMA — motor TED bildirimini analiz eder.
  -- (Eski davranış: raise exception 'No supported tender documents are registered')

  if exists (
    select 1 from public.tender_document_analysis_jobs
    where tender_id = p_tender_id
      and company_id = p_company_id
      and status in ('queued','processing')
  ) then
    select *
    into v_job
    from public.tender_document_analysis_jobs
    where tender_id = p_tender_id
      and company_id = p_company_id
      and status in ('queued','processing')
    order by created_at desc
    limit 1;

    return v_job;
  end if;

  insert into public.tender_document_analysis_jobs (
    tender_id,
    requested_by,
    company_id,
    status,
    selected_document_ids
  )
  values (
    p_tender_id,
    auth.uid(),
    p_company_id,
    'queued',
    v_document_ids
  )
  returning * into v_job;

  update public.tenders
  set
    document_analysis_status = 'queued',
    updated_at = now()
  where id = p_tender_id;

  return v_job;
end;
$$;

select 'yama tamam' as sonuc;

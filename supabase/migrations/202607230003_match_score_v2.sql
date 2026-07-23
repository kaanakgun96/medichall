-- MedicHall Match Score v2.
--
-- This migration is additive. It does not replace or change
-- refresh_company_opportunity_matches(bigint), existing opportunity score
-- columns, candidate generation, or user workflow state. V2 scores are
-- calculated only through explicit bounded RPC calls and are stored beside
-- the legacy score for controlled comparison.

begin;

create extension if not exists pg_trgm with schema extensions;

create or replace function public.match_v2_normalize_text(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    trim(
      regexp_replace(
        lower(coalesce(p_value, '')),
        '[^[:alnum:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create or replace function public.match_v2_text_similarity(
  p_left text,
  p_right text
)
returns integer
language plpgsql
immutable
parallel safe
as $$
declare
  v_left text := public.match_v2_normalize_text(p_left);
  v_right text := public.match_v2_normalize_text(p_right);
  v_trigram numeric;
  v_jaccard numeric;
begin
  if v_left is null or v_right is null then
    return null;
  end if;
  if v_left = v_right then
    return 100;
  end if;

  v_trigram := similarity(v_left, v_right);
  with
    left_tokens as (
      select distinct token
      from regexp_split_to_table(v_left, '[[:space:]]+') token
      where length(token) >= 3
    ),
    right_tokens as (
      select distinct token
      from regexp_split_to_table(v_right, '[[:space:]]+') token
      where length(token) >= 3
    ),
    token_union as (
      select token from left_tokens
      union
      select token from right_tokens
    ),
    token_intersection as (
      select token from left_tokens
      intersect
      select token from right_tokens
    )
  select
    case
      when (select count(*) from token_union) = 0 then 0
      else
        (select count(*) from token_intersection)::numeric
        / (select count(*) from token_union)::numeric
    end
  into v_jaccard;

  return greatest(
    0,
    least(100, round(100 * greatest(v_trigram, v_jaccard))::integer)
  );
end;
$$;

create or replace function public.match_v2_exact_product_score(
  p_company_products text[],
  p_tender_products text[]
)
returns integer
language sql
immutable
parallel safe
as $$
  with
    company_products as (
      select distinct public.match_v2_normalize_text(value) as value
      from unnest(coalesce(p_company_products, '{}'::text[])) value
      where public.match_v2_normalize_text(value) is not null
    ),
    tender_products as (
      select distinct public.match_v2_normalize_text(value) as value
      from unnest(coalesce(p_tender_products, '{}'::text[])) value
      where public.match_v2_normalize_text(value) is not null
    )
  select case
    when not exists (select 1 from company_products)
      or not exists (select 1 from tender_products)
      then null
    when exists (
      select 1
      from company_products company_product
      join tender_products tender_product
        on tender_product.value = company_product.value
    )
      then 100
    else 0
  end;
$$;

create or replace function public.match_v2_product_similarity_score(
  p_company_products text[],
  p_tender_products text[]
)
returns integer
language sql
immutable
parallel safe
as $$
  with
    company_products as (
      select distinct value
      from unnest(coalesce(p_company_products, '{}'::text[])) value
      where public.match_v2_normalize_text(value) is not null
    ),
    tender_products as (
      select distinct value
      from unnest(coalesce(p_tender_products, '{}'::text[])) value
      where public.match_v2_normalize_text(value) is not null
    )
  select case
    when not exists (select 1 from company_products)
      or not exists (select 1 from tender_products)
      then null
    else coalesce((
      select max(public.match_v2_text_similarity(
        company_product.value,
        tender_product.value
      ))
      from company_products company_product
      cross join tender_products tender_product
    ), 0)
  end;
$$;

create or replace function public.match_v2_cpv_score(
  p_company_codes text[],
  p_tender_codes text[]
)
returns integer
language sql
immutable
parallel safe
as $$
  with
    company_codes as (
      select distinct left(regexp_replace(value, '[^0-9]', '', 'g'), 8) as code
      from unnest(coalesce(p_company_codes, '{}'::text[])) value
      where length(regexp_replace(value, '[^0-9]', '', 'g')) >= 8
    ),
    tender_codes as (
      select distinct left(regexp_replace(value, '[^0-9]', '', 'g'), 8) as code
      from unnest(coalesce(p_tender_codes, '{}'::text[])) value
      where length(regexp_replace(value, '[^0-9]', '', 'g')) >= 8
    )
  select case
    when not exists (select 1 from company_codes)
      or not exists (select 1 from tender_codes)
      then null
    else coalesce((
      select max(
        case
          when company_code.code = tender_code.code then 100
          when left(company_code.code, 5) = left(tender_code.code, 5) then 80
          when left(company_code.code, 4) = left(tender_code.code, 4) then 65
          when left(company_code.code, 3) = left(tender_code.code, 3) then 50
          when left(company_code.code, 2) = left(tender_code.code, 2) then 30
          else 0
        end
      )
      from company_codes company_code
      cross join tender_codes tender_code
    ), 0)
  end;
$$;

create or replace function public.match_v2_required_array_score(
  p_available text[],
  p_required text[]
)
returns integer
language sql
immutable
parallel safe
as $$
  with
    available as (
      select distinct public.match_v2_normalize_text(value) as value
      from unnest(coalesce(p_available, '{}'::text[])) value
      where public.match_v2_normalize_text(value) is not null
    ),
    required as (
      select distinct public.match_v2_normalize_text(value) as value
      from unnest(coalesce(p_required, '{}'::text[])) value
      where public.match_v2_normalize_text(value) is not null
    )
  select case
    when not exists (select 1 from required) then null
    when not exists (select 1 from available) then 0
    else round(
      100.0 * (
        select count(*)
        from required
        where exists (
          select 1
          from available
          where available.value = required.value
            or available.value like '%' || required.value || '%'
            or required.value like '%' || available.value || '%'
        )
      ) / (select count(*) from required)
    )::integer
  end;
$$;

create or replace function public.match_v2_quantity_score(
  p_required numeric,
  p_capacity numeric
)
returns integer
language sql
immutable
parallel safe
as $$
  select case
    when p_required is null or p_capacity is null
      or p_required <= 0 or p_capacity < 0
      then null
    when p_capacity >= p_required then 100
    else greatest(10, least(99, round(100 * p_capacity / p_required)::integer))
  end;
$$;

create or replace function public.match_v2_engagement_score(p_status text)
returns integer
language sql
immutable
parallel safe
as $$
  select case lower(coalesce(p_status, ''))
    when 'saved' then 75
    when 'contacted' then 85
    when 'applied' then 100
    when 'dismissed' then 0
    else null
  end;
$$;

create or replace function public.match_v2_weighted_score(
  p_components jsonb
)
returns integer
language sql
immutable
parallel safe
as $$
  with weights(component, weight) as (
    values
      ('exact_product', 24::numeric),
      ('normalized_text', 14::numeric),
      ('cpv', 14::numeric),
      ('semantic_similarity', 8::numeric),
      ('technical_specification', 10::numeric),
      ('country', 8::numeric),
      ('certification', 8::numeric),
      ('quantity_capacity', 5::numeric),
      ('packaging_unit', 3::numeric),
      ('supplier_profile', 2::numeric),
      ('engagement_signal', 4::numeric)
  ),
  applicable as (
    select
      weight,
      nullif(p_components -> component ->> 'score', '')::numeric as score
    from weights
    where jsonb_typeof(p_components -> component -> 'score') = 'number'
  )
  select case
    when coalesce(sum(weight), 0) = 0 then null
    else greatest(
      0,
      least(100, round(sum(weight * score) / sum(weight))::integer)
    )
  end
  from applicable;
$$;

create table if not exists public.opportunity_match_scores_v2 (
  opportunity_match_id bigint primary key
    references public.opportunity_matches(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  tender_id bigint not null references public.tenders(id) on delete cascade,
  score_v2 integer not null check (score_v2 between 0 and 100),
  previous_score integer not null check (previous_score between 0 and 100),
  score_delta integer not null check (score_delta between -100 and 100),
  confidence_score integer not null check (confidence_score between 0 and 100),
  data_completeness_score integer not null
    check (data_completeness_score between 0 and 100),
  exact_product_score integer check (
    exact_product_score is null or exact_product_score between 0 and 100
  ),
  normalized_text_score integer check (
    normalized_text_score is null or normalized_text_score between 0 and 100
  ),
  cpv_score integer check (cpv_score is null or cpv_score between 0 and 100),
  semantic_similarity_score integer check (
    semantic_similarity_score is null
    or semantic_similarity_score between 0 and 100
  ),
  technical_specification_score integer check (
    technical_specification_score is null
    or technical_specification_score between 0 and 100
  ),
  country_score integer check (
    country_score is null or country_score between 0 and 100
  ),
  certification_score integer check (
    certification_score is null or certification_score between 0 and 100
  ),
  quantity_capacity_score integer check (
    quantity_capacity_score is null
    or quantity_capacity_score between 0 and 100
  ),
  packaging_unit_score integer check (
    packaging_unit_score is null or packaging_unit_score between 0 and 100
  ),
  supplier_profile_score integer check (
    supplier_profile_score is null or supplier_profile_score between 0 and 100
  ),
  engagement_signal_score integer check (
    engagement_signal_score is null or engagement_signal_score between 0 and 100
  ),
  document_evidence_status text not null check (
    document_evidence_status in ('available', 'pending', 'not_applicable')
  ),
  components jsonb not null,
  matched_reasons jsonb not null default '[]'::jsonb,
  missing_requirements text[] not null default '{}',
  risk_indicators jsonb not null default '[]'::jsonb,
  input_snapshot jsonb not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  previous_scoring_version text,
  scoring_version text not null,
  score_trace_id uuid references public.pipeline_runs(trace_id) on delete set null,
  scored_at timestamptz not null default now(),
  unique (company_id, tender_id)
);

create index if not exists opportunity_match_scores_v2_company_score_idx
  on public.opportunity_match_scores_v2 (
    company_id,
    score_v2 desc,
    scored_at desc
  );

alter table public.opportunity_match_scores_v2 enable row level security;

drop policy if exists "admins manage v2 match scores"
on public.opportunity_match_scores_v2;
create policy "admins manage v2 match scores"
on public.opportunity_match_scores_v2
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on table public.opportunity_match_scores_v2
from public, anon, authenticated;
grant select on table public.opportunity_match_scores_v2 to authenticated;

-- Targeted compatibility refresh for the one opportunity whose documents were
-- analyzed. Unlike the historical plural RPC, this never regenerates every
-- tender candidate for a company.
create or replace function public.refresh_explainable_tender_match(
  p_company_id bigint,
  p_tender_id bigint,
  p_trace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_has_evidence boolean := false;
begin
  if not (
    public.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  select exists (
    select 1
    from public.tender_document_evidence evidence
    where evidence.tender_id = p_tender_id
      and evidence.document_id is not null
  )
  into v_has_evidence;

  update public.opportunity_matches opportunity
  set
    profile_match_score = opportunity.match_score,
    document_match_score = case
      when v_has_evidence
        and tender.document_analysis_status in ('completed', 'partial')
        then greatest(0, least(100, tender.document_confidence_score))
      else null
    end,
    opportunity_score = case
      when v_has_evidence and tender.document_analysis_status = 'completed'
        then round(
          (opportunity.match_score * 0.45)
          + (coalesce(tender.document_confidence_score, 0) * 0.35)
          + (coalesce(tender.data_completeness_score, 0) * 0.20)
        )::integer
      when v_has_evidence and tender.document_analysis_status = 'partial'
        then round(
          (opportunity.match_score * 0.70)
          + (coalesce(tender.document_confidence_score, 0) * 0.20)
          + (coalesce(tender.data_completeness_score, 0) * 0.10)
        )::integer
      else opportunity.match_score
    end,
    confidence_level = case
      when v_has_evidence
        and tender.document_analysis_status = 'completed'
        and tender.data_completeness_score >= 75
        and tender.document_confidence_score >= 75
        then 'high'
      when v_has_evidence
        and tender.document_analysis_status in ('completed', 'partial')
        then 'medium'
      else 'low'
    end,
    score_basis = case
      when v_has_evidence and tender.document_analysis_status = 'completed'
        then 'structured_and_documents'
      when v_has_evidence and tender.document_analysis_status = 'partial'
        then 'structured_and_partial_documents'
      else 'structured_data'
    end,
    missing_information = public.tender_missing_information(tender)
      || case
        when v_has_evidence then '{}'::text[]
        else array['Document evidence pending']
      end,
    evidence = jsonb_build_array(
      jsonb_build_object(
        'label', 'Product/category overlap',
        'score', opportunity.keyword_score,
        'source', 'structured tender data'
      ),
      jsonb_build_object(
        'label', 'Target country',
        'score', opportunity.geography_score,
        'source', 'structured tender data'
      ),
      jsonb_build_object(
        'label', 'CPV/category',
        'score', opportunity.category_score,
        'source', 'structured tender data'
      ),
      jsonb_build_object(
        'label', 'Certificates',
        'score', opportunity.certification_score,
        'source', case
          when v_has_evidence then 'tender documents'
          else 'document evidence pending'
        end
      )
    ),
    next_best_action = case
      when not v_has_evidence then 'Document analysis pending'
      when coalesce(
        array_length(public.tender_missing_information(tender), 1),
        0
      ) > 0 then 'Review missing tender information'
      else 'Review opportunity and prepare application'
    end,
    confidence_score = case
      when v_has_evidence and tender.document_analysis_status = 'completed'
        then round(
          (tender.document_confidence_score * 0.60)
          + (tender.data_completeness_score * 0.40)
        )::integer
      when v_has_evidence and tender.document_analysis_status = 'partial'
        then least(
          79,
          round(
            (tender.document_confidence_score * 0.55)
            + (tender.data_completeness_score * 0.25)
          )::integer
        )
      else least(55, greatest(20, opportunity.confidence_score))
    end,
    explanation_version = 'explainable-match-v2-targeted',
    explanation_trace_id = p_trace_id,
    tender_snapshot_at = tender.updated_at,
    document_snapshot_at = greatest(
      tender.last_document_analysis_at,
      (
        select max(document.updated_at)
        from public.tender_documents document
        where document.tender_id = tender.id
      )
    ),
    explained_at = now(),
    updated_at = now()
  from public.tenders tender
  where opportunity.company_id = p_company_id
    and opportunity.tender_id = p_tender_id
    and opportunity.opportunity_type = 'tender'
    and tender.id = opportunity.tender_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Opportunity match not found';
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'tender_id', p_tender_id,
    'updated', true,
    'document_evidence_status',
      case when v_has_evidence then 'available' else 'pending' end
  );
end;
$$;

revoke all on function public.refresh_explainable_tender_match(
  bigint,
  bigint,
  uuid
) from public, anon;
grant execute on function public.refresh_explainable_tender_match(
  bigint,
  bigint,
  uuid
) to authenticated, service_role;

create or replace function public.calculate_opportunity_match_score_v2(
  p_company_id bigint,
  p_tender_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_company public.companies;
  v_profile public.company_match_profiles;
  v_tender public.tenders;
  v_match public.opportunity_matches;
  v_company_products text[] := '{}'::text[];
  v_company_product_text text := '';
  v_tender_products text[] := '{}'::text[];
  v_tender_text text := '';
  v_required_certifications text[] := '{}'::text[];
  v_technical_requirements text[] := '{}'::text[];
  v_packaging_requirements text[] := '{}'::text[];
  v_company_certifications text[] := '{}'::text[];
  v_exact_product integer;
  v_normalized_text integer;
  v_cpv integer;
  v_semantic integer;
  v_technical integer;
  v_country integer;
  v_certification integer;
  v_quantity integer := null;
  v_packaging integer;
  v_supplier_profile integer;
  v_engagement integer;
  v_evidence_count integer := 0;
  v_evidence_confidence integer := 0;
  v_document_status text;
  v_components jsonb;
  v_score integer;
  v_completeness integer;
  v_confidence integer;
  v_input_snapshot jsonb;
  v_input_hash text;
begin
  if not (
    public.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  select * into v_company
  from public.companies
  where id = p_company_id;
  select * into v_profile
  from public.company_match_profiles
  where company_id = p_company_id;
  select * into v_tender
  from public.tenders
  where id = p_tender_id;
  select * into v_match
  from public.opportunity_matches
  where company_id = p_company_id
    and tender_id = p_tender_id
    and opportunity_type = 'tender';

  if v_company.id is null
    or v_profile.company_id is null
    or v_tender.id is null
    or v_match.id is null
  then
    raise exception 'Company profile, tender, or opportunity match not found';
  end if;

  select
    coalesce(array_agg(product.name order by product.id), '{}'::text[]),
    coalesce(string_agg(
      concat_ws(' ', product.name, product.category, product.description),
      ' '
      order by product.id
    ), '')
  into v_company_products, v_company_product_text
  from public.products product
  where product.company_id = p_company_id
    and product.is_active;

  select coalesce(array_agg(product ->> 'product_name'), '{}'::text[])
  into v_tender_products
  from jsonb_array_elements(
    coalesce(v_tender.extracted_products, '[]'::jsonb)
  ) product
  where nullif(trim(product ->> 'product_name'), '') is not null;

  select coalesce(array_agg(distinct certification), '{}'::text[])
  into v_required_certifications
  from jsonb_array_elements(
    coalesce(v_tender.extracted_products, '[]'::jsonb)
  ) product
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(product -> 'required_certifications') = 'array'
        then product -> 'required_certifications'
      else '[]'::jsonb
    end
  ) certification;

  select coalesce(array_agg(distinct requirement), '{}'::text[])
  into v_technical_requirements
  from jsonb_array_elements(
    coalesce(v_tender.extracted_products, '[]'::jsonb)
  ) product
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(product -> 'technical_requirements') = 'array'
        then product -> 'technical_requirements'
      else '[]'::jsonb
    end
  ) requirement;

  select coalesce(array_agg(distinct packaging), '{}'::text[])
  into v_packaging_requirements
  from jsonb_array_elements(
    coalesce(v_tender.extracted_products, '[]'::jsonb)
  ) product
  cross join lateral (
    select nullif(trim(product ->> 'packaging'), '') as packaging
  ) value
  where packaging is not null;

  v_company_certifications := coalesce(v_profile.certifications, '{}'::text[])
    || regexp_split_to_array(
      coalesce(v_company.certifications, ''),
      '[,;|\n]+'
    );
  v_tender_text := concat_ws(
    ' ',
    v_tender.title,
    v_tender.title_en,
    v_tender.description,
    v_tender.description_en,
    array_to_string(v_tender_products, ' '),
    array_to_string(v_technical_requirements, ' ')
  );

  v_exact_product := public.match_v2_exact_product_score(
    v_company_products || coalesce(v_profile.product_keywords, '{}'::text[]),
    v_tender_products
  );
  v_normalized_text := public.match_v2_product_similarity_score(
    v_company_products || coalesce(v_profile.product_keywords, '{}'::text[]),
    case
      when cardinality(v_tender_products) > 0 then v_tender_products
      else array[v_tender.title, v_tender.title_en]
    end
  );
  v_cpv := public.match_v2_cpv_score(
    v_profile.cpv_codes,
    v_tender.cpv_codes
  );
  v_semantic := public.match_v2_text_similarity(
    concat_ws(
      ' ',
      v_company.description,
      v_company_product_text,
      array_to_string(v_profile.product_keywords, ' ')
    ),
    v_tender_text
  );
  v_technical := case
    when cardinality(v_technical_requirements) = 0 then null
    when public.match_v2_normalize_text(v_company_product_text) is null then 0
    else public.match_v2_text_similarity(
      v_company_product_text,
      array_to_string(v_technical_requirements, ' ')
    )
  end;
  v_country := case
    when cardinality(v_profile.target_countries) = 0 then null
    else public.country_match_score(
      v_profile.target_countries,
      v_tender.country_code,
      v_tender.country_name
    )
  end;
  v_certification := public.match_v2_required_array_score(
    v_company_certifications,
    v_required_certifications
  );
  -- No company capacity unit exists in the current backend. Quantity remains
  -- non-applicable instead of comparing incompatible numbers.
  v_quantity := null;
  v_packaging := case
    when cardinality(v_packaging_requirements) = 0 then null
    when public.match_v2_normalize_text(v_company_product_text) is null then 0
    else public.match_v2_text_similarity(
      v_company_product_text,
      array_to_string(v_packaging_requirements, ' ')
    )
  end;
  v_supplier_profile := case
    when v_tender_text !~* '\m(oem|private[ -]?label|manufacturer|distributor)\M'
      then null
    when (
      v_profile.oem_available
      or v_profile.private_label_available
      or lower(coalesce(v_company.type, '')) in (
        'manufacturer',
        'distributor',
        'supplier'
      )
    ) then 100
    else 0
  end;
  v_engagement := public.match_v2_engagement_score(v_match.status);

  select
    count(*)::integer,
    coalesce(round(avg(evidence.confidence_score))::integer, 0)
  into v_evidence_count, v_evidence_confidence
  from public.tender_document_evidence evidence
  where evidence.tender_id = p_tender_id
    and evidence.document_id is not null;
  v_document_status := case
    when v_evidence_count > 0 then 'available'
    else 'pending'
  end;

  v_components := jsonb_build_object(
    'exact_product', jsonb_build_object(
      'score', v_exact_product,
      'weight', 24,
      'source', 'company products and document-extracted product names'
    ),
    'normalized_text', jsonb_build_object(
      'score', v_normalized_text,
      'weight', 14,
      'source', 'normalized product and tender text'
    ),
    'cpv', jsonb_build_object(
      'score', v_cpv,
      'weight', 14,
      'source', 'exact or hierarchical CPV relationship'
    ),
    'semantic_similarity', jsonb_build_object(
      'score', v_semantic,
      'weight', 8,
      'source', 'deterministic trigram and token-set similarity'
    ),
    'technical_specification', jsonb_build_object(
      'score', v_technical,
      'weight', 10,
      'source', 'company product descriptions and extracted requirements'
    ),
    'country', jsonb_build_object(
      'score', v_country,
      'weight', 8,
      'source', 'company target countries and tender country'
    ),
    'certification', jsonb_build_object(
      'score', v_certification,
      'weight', 8,
      'source', 'company certificates and evidenced tender requirements'
    ),
    'quantity_capacity', jsonb_build_object(
      'score', v_quantity,
      'weight', 5,
      'source', 'pending: company capacity unit is not in the backend'
    ),
    'packaging_unit', jsonb_build_object(
      'score', v_packaging,
      'weight', 3,
      'source', 'product descriptions and evidenced packaging requirements'
    ),
    'supplier_profile', jsonb_build_object(
      'score', v_supplier_profile,
      'weight', 2,
      'source', 'company role/OEM capability and explicit tender wording'
    ),
    'engagement_signal', jsonb_build_object(
      'score', v_engagement,
      'weight', 4,
      'source', 'saved/contacted/applied/dismissed workflow state'
    )
  );
  v_score := public.match_v2_weighted_score(v_components);
  if v_score is null then
    raise exception 'No applicable Match Score v2 components';
  end if;

  select coalesce(sum((component.value ->> 'weight')::integer), 0)
  into v_completeness
  from jsonb_each(v_components) component
  where jsonb_typeof(component.value -> 'score') = 'number';
  v_completeness := greatest(0, least(100, v_completeness));
  v_confidence := greatest(
    0,
    least(
      100,
      round(
        v_completeness * case
          when v_evidence_count > 0
            then 0.75 + (0.25 * v_evidence_confidence / 100.0)
          else 0.70
        end
      )::integer
    )
  );

  v_input_snapshot := jsonb_build_object(
    'company_id', p_company_id,
    'tender_id', p_tender_id,
    'company_products', v_company_products,
    'company_product_text', v_company_product_text,
    'company_description', v_company.description,
    'company_type', v_company.type,
    'profile_keywords', v_profile.product_keywords,
    'profile_cpv_codes', v_profile.cpv_codes,
    'profile_countries', v_profile.target_countries,
    'oem_available', v_profile.oem_available,
    'private_label_available', v_profile.private_label_available,
    'company_certifications', v_company_certifications,
    'tender_products', v_tender_products,
    'tender_title', v_tender.title,
    'tender_title_en', v_tender.title_en,
    'tender_description', v_tender.description,
    'tender_description_en', v_tender.description_en,
    'tender_country_code', v_tender.country_code,
    'tender_country_name', v_tender.country_name,
    'tender_deadline_at', v_tender.deadline_at,
    'tender_cpv_codes', v_tender.cpv_codes,
    'required_certifications', v_required_certifications,
    'technical_requirements', v_technical_requirements,
    'packaging_requirements', v_packaging_requirements,
    'document_evidence_count', v_evidence_count,
    'document_extraction_version', v_tender.ai_extraction_version,
    'engagement_status', v_match.status
  );
  v_input_hash := encode(
    digest(v_input_snapshot::text, 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'opportunity_match_id', v_match.id,
    'company_id', p_company_id,
    'tender_id', p_tender_id,
    'score_v2', v_score,
    'previous_score', v_match.match_score,
    'score_delta', v_score - v_match.match_score,
    'confidence_score', v_confidence,
    'data_completeness_score', v_completeness,
    'document_evidence_status', v_document_status,
    'components', v_components,
    'matched_reasons', to_jsonb(array_remove(array[
      case when v_exact_product = 100 then 'Exact product match' end,
      case when v_normalized_text >= 70 then 'Strong normalized product similarity' end,
      case when v_cpv = 100 then 'Exact CPV match' end,
      case when v_cpv between 50 and 99 then 'Related CPV hierarchy' end,
      case when v_technical >= 70 then 'Technical requirements align' end,
      case when v_country = 100 then 'Target country aligns' end,
      case when v_certification = 100 then 'Required certifications align' end,
      case when v_packaging >= 70 then 'Packaging language aligns' end,
      case when v_engagement >= 75 then 'Positive saved-opportunity signal' end
    ], null)),
    'missing_requirements', to_jsonb(array_remove(array[
      case when v_exact_product is null then 'Document-evidenced product names' end,
      case when v_cpv is null then 'Comparable CPV classifications' end,
      case when v_technical is null then 'Document-evidenced technical requirements' end,
      case when v_certification is null then 'Document-evidenced certification requirements' end,
      case when v_quantity is null then 'Comparable quantity and company capacity units' end,
      case when v_packaging is null then 'Comparable packaging and unit requirements' end,
      case when v_evidence_count = 0 then 'Document evidence pending' end
    ], null)),
    'risk_indicators', to_jsonb(array_remove(array[
      case when v_country = 0 then 'Tender country is outside current targets' end,
      case when v_certification = 0 then 'Required certifications are not evidenced in the company profile' end,
      case when v_technical is not null and v_technical < 35
        then 'Low confirmed technical-specification alignment' end,
      case when v_packaging is not null and v_packaging < 35
        then 'Low confirmed packaging/unit alignment' end,
      case when v_match.status = 'dismissed' then 'Opportunity was dismissed' end,
      case when v_tender.deadline_at is not null
        and v_tender.deadline_at < now() + interval '7 days'
        then 'Deadline is within 7 days' end
    ], null)),
    'input_snapshot', v_input_snapshot,
    'input_hash', v_input_hash,
    'previous_scoring_version', v_match.scoring_version,
    'scoring_version', 'matching-score-v2.0.0'
  );
end;
$$;

revoke all on function public.calculate_opportunity_match_score_v2(
  bigint,
  bigint
) from public, anon;
grant execute on function public.calculate_opportunity_match_score_v2(
  bigint,
  bigint
) to service_role;

create or replace function public.refresh_opportunity_match_score_v2(
  p_company_id bigint,
  p_tender_id bigint,
  p_trace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_changed integer := 0;
begin
  v_result := public.calculate_opportunity_match_score_v2(
    p_company_id,
    p_tender_id
  );

  insert into public.opportunity_match_scores_v2 (
    opportunity_match_id,
    company_id,
    tender_id,
    score_v2,
    previous_score,
    score_delta,
    confidence_score,
    data_completeness_score,
    exact_product_score,
    normalized_text_score,
    cpv_score,
    semantic_similarity_score,
    technical_specification_score,
    country_score,
    certification_score,
    quantity_capacity_score,
    packaging_unit_score,
    supplier_profile_score,
    engagement_signal_score,
    document_evidence_status,
    components,
    matched_reasons,
    missing_requirements,
    risk_indicators,
    input_snapshot,
    input_hash,
    previous_scoring_version,
    scoring_version,
    score_trace_id,
    scored_at
  )
  values (
    (v_result ->> 'opportunity_match_id')::bigint,
    p_company_id,
    p_tender_id,
    (v_result ->> 'score_v2')::integer,
    (v_result ->> 'previous_score')::integer,
    (v_result ->> 'score_delta')::integer,
    (v_result ->> 'confidence_score')::integer,
    (v_result ->> 'data_completeness_score')::integer,
    (v_result #>> '{components,exact_product,score}')::integer,
    (v_result #>> '{components,normalized_text,score}')::integer,
    (v_result #>> '{components,cpv,score}')::integer,
    (v_result #>> '{components,semantic_similarity,score}')::integer,
    (v_result #>> '{components,technical_specification,score}')::integer,
    (v_result #>> '{components,country,score}')::integer,
    (v_result #>> '{components,certification,score}')::integer,
    (v_result #>> '{components,quantity_capacity,score}')::integer,
    (v_result #>> '{components,packaging_unit,score}')::integer,
    (v_result #>> '{components,supplier_profile,score}')::integer,
    (v_result #>> '{components,engagement_signal,score}')::integer,
    v_result ->> 'document_evidence_status',
    v_result -> 'components',
    v_result -> 'matched_reasons',
    array(
      select jsonb_array_elements_text(v_result -> 'missing_requirements')
    ),
    v_result -> 'risk_indicators',
    v_result -> 'input_snapshot',
    v_result ->> 'input_hash',
    v_result ->> 'previous_scoring_version',
    v_result ->> 'scoring_version',
    p_trace_id,
    now()
  )
  on conflict (opportunity_match_id) do update set
    score_v2 = excluded.score_v2,
    previous_score = excluded.previous_score,
    score_delta = excluded.score_delta,
    confidence_score = excluded.confidence_score,
    data_completeness_score = excluded.data_completeness_score,
    exact_product_score = excluded.exact_product_score,
    normalized_text_score = excluded.normalized_text_score,
    cpv_score = excluded.cpv_score,
    semantic_similarity_score = excluded.semantic_similarity_score,
    technical_specification_score = excluded.technical_specification_score,
    country_score = excluded.country_score,
    certification_score = excluded.certification_score,
    quantity_capacity_score = excluded.quantity_capacity_score,
    packaging_unit_score = excluded.packaging_unit_score,
    supplier_profile_score = excluded.supplier_profile_score,
    engagement_signal_score = excluded.engagement_signal_score,
    document_evidence_status = excluded.document_evidence_status,
    components = excluded.components,
    matched_reasons = excluded.matched_reasons,
    missing_requirements = excluded.missing_requirements,
    risk_indicators = excluded.risk_indicators,
    input_snapshot = excluded.input_snapshot,
    input_hash = excluded.input_hash,
    previous_scoring_version = excluded.previous_scoring_version,
    scoring_version = excluded.scoring_version,
    score_trace_id = excluded.score_trace_id,
    scored_at = excluded.scored_at
  where opportunity_match_scores_v2.input_hash is distinct from excluded.input_hash
     or opportunity_match_scores_v2.previous_score is distinct from excluded.previous_score;

  get diagnostics v_changed = row_count;
  return (v_result - 'input_snapshot' - 'input_hash')
    || jsonb_build_object('changed', v_changed = 1);
end;
$$;

revoke all on function public.refresh_opportunity_match_score_v2(
  bigint,
  bigint,
  uuid
) from public, anon;
grant execute on function public.refresh_opportunity_match_score_v2(
  bigint,
  bigint,
  uuid
) to authenticated, service_role;

create or replace function public.get_opportunity_match_score_v2(
  p_company_id bigint,
  p_tender_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score public.opportunity_match_scores_v2;
begin
  if not (
    public.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    )
  ) then
    raise exception 'Access denied';
  end if;

  select * into v_score
  from public.opportunity_match_scores_v2 score
  where score.company_id = p_company_id
    and score.tender_id = p_tender_id;
  if v_score.opportunity_match_id is null then
    return null;
  end if;

  return to_jsonb(v_score)
    - 'input_snapshot'
    - 'input_hash'
    - 'score_trace_id';
end;
$$;

revoke all on function public.get_opportunity_match_score_v2(
  bigint,
  bigint
) from public, anon;
grant execute on function public.get_opportunity_match_score_v2(
  bigint,
  bigint
) to authenticated, service_role;

create or replace function public.refresh_company_match_scores_v2(
  p_company_id bigint,
  p_limit integer default 50,
  p_trace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_processed integer := 0;
  v_changed integer := 0;
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;

  -- Authorization is enforced again by the per-opportunity calculator.
  for v_match in
    select opportunity.tender_id
    from public.opportunity_matches opportunity
    join public.tenders tender on tender.id = opportunity.tender_id
    where opportunity.company_id = p_company_id
      and opportunity.opportunity_type = 'tender'
      and opportunity.tender_id is not null
      and tender.status = 'open'
      and (tender.deadline_at is null or tender.deadline_at > now())
    order by opportunity.updated_at desc, opportunity.id desc
    limit p_limit
  loop
    v_result := public.refresh_opportunity_match_score_v2(
      p_company_id,
      v_match.tender_id,
      p_trace_id
    );
    v_processed := v_processed + 1;
    if coalesce((v_result ->> 'changed')::boolean, false) then
      v_changed := v_changed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'company_id', p_company_id,
    'processed', v_processed,
    'changed', v_changed,
    'limit', p_limit,
    'scoring_version', 'matching-score-v2.0.0'
  );
end;
$$;

revoke all on function public.refresh_company_match_scores_v2(
  bigint,
  integer,
  uuid
) from public, anon;
grant execute on function public.refresh_company_match_scores_v2(
  bigint,
  integer,
  uuid
) to authenticated, service_role;

update public.pipeline_versions
set is_repository_current = false
where component = 'scoring'
  and is_repository_current;

insert into public.pipeline_versions (
  component,
  version_identifier,
  semantic_version,
  content_sha256,
  source_path,
  migration_path,
  is_repository_current,
  live_verification_status,
  metadata
)
values (
  'scoring',
  'matching-score-v2.0.0',
  '2.0.0',
  'e3748c62defc19a8db6b4837ced21360863537926b2206c2267efb8738d656f5',
  'supabase/observability/match-score-v2.json',
  'supabase/migrations/202607230003_match_score_v2.sql',
  true,
  'repository_only',
  '{"legacy_score_unchanged":true,"automatic_full_recompute":false,"maximum_batch":100,"semantic_method":"deterministic trigram plus token-set proxy","quantity_without_comparable_capacity":"not_applicable"}'::jsonb
)
on conflict (component, version_identifier) do update set
  semantic_version = excluded.semantic_version,
  content_sha256 = excluded.content_sha256,
  source_path = excluded.source_path,
  migration_path = excluded.migration_path,
  is_repository_current = excluded.is_repository_current,
  live_verification_status = excluded.live_verification_status,
  metadata = excluded.metadata;

commit;

-- Rollback:
--   1. Stop calling the v2 refresh RPCs.
--   2. Mark matching-score-v2.0.0 non-current and restore the previous scoring
--      pipeline version as repository-current.
--   3. Keep opportunity_match_scores_v2 for audit/comparison. No legacy score,
--      opportunity status, candidate rule, or RPC contract needs restoration.

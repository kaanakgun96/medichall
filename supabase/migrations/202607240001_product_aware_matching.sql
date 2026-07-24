-- ============================================================================
-- MedicHall — Ürün bazlı eşleştirme yaması
-- Migration: 202607240001_product_aware_matching.sql
--
-- KÖK NEDEN: Doküman motoru ihale dokümanlarından ürünleri çıkarıp
-- tenders.extracted_products'a yazıyordu, AMA eşleştirme motoru bu alana
-- HİÇ bakmıyordu — yalnız başlık + açıklamayı tarıyordu. Ürünler veritabanında
-- duruyor, skorlama onları görmüyordu. PRODUCT %0 sonucunun sebebi buydu.
--
-- ÇÖZÜM: keyword samanlığına çıkarılan ürün metinleri ve lot başlıkları eklendi.
-- Fonksiyon gövdesi 202607200002'deki (İngilizce normalize) sürümden BİREBİR
-- alındı; yalnız iki samanlık ifadesi genişletildi. Ağırlıklar, kurallar,
-- skorlama mantığı DEĞİŞMEDİ.
--
-- İdempotent. Kurulumdan sonra eşleşmelerin yenilenmesi gerekir
-- (portalda "Find matches" veya ted-sync'in günlük koşusu).
-- ============================================================================

-- extracted_products jsonb'sinden aranabilir metin üretir.
-- Yapı değişse bile çökmez: dizi değilse boş döner, alan yoksa atlar.
create or replace function public.tender_product_text(p jsonb)
returns text
language sql
immutable
as $fn$
  select coalesce(
    (select string_agg(
       concat_ws(' ',
         nullif(e->>'product_name', ''),
         nullif(e->>'material', ''),
         nullif(e->>'dimensions', ''),
         nullif(e->>'sterility', ''),
         nullif(e->>'category', ''),
         nullif(e->>'description', '')
       ), ' ')
     from jsonb_array_elements(
       case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
     ) e),
    ''
  );
$fn$;

-- ai_lots jsonb'sinden lot başlıklarını çıkarır (lot adları da ürün tarifidir).
create or replace function public.tender_lot_text(p jsonb)
returns text
language sql
immutable
as $fn$
  select coalesce(
    (select string_agg(
       concat_ws(' ',
         nullif(e->>'lot_title', ''),
         nullif(e->>'lot_description', '')
       ), ' ')
     from jsonb_array_elements(
       case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
     ) e),
    ''
  );
$fn$;

grant execute on function public.tender_product_text(jsonb) to anon, authenticated;
grant execute on function public.tender_lot_text(jsonb) to anon, authenticated;

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
        coalesce(t.title, '') || ' ' || coalesce(t.description, '') || ' ' || coalesce(t.title_en, '') || ' ' || coalesce(t.description_en, '')
           || ' ' || public.tender_product_text(t.extracted_products)
           || ' ' || public.tender_lot_text(t.ai_lots)
      ) as kw,
      public.country_match_score(v_profile.target_countries, t.country_code, t.country_name) as geo,
      public.array_overlap_score(v_profile.cpv_codes, t.cpv_codes) as cpvs,
      public.matched_keyword_list(
        v_profile.product_keywords,
        t.product_keywords,
        coalesce(t.title, '') || ' ' || coalesce(t.description, '') || ' ' || coalesce(t.title_en, '') || ' ' || coalesce(t.description_en, '')
           || ' ' || public.tender_product_text(t.extracted_products)
           || ' ' || public.tender_lot_text(t.ai_lots)
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

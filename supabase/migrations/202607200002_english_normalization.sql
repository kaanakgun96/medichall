-- ============================================================================
-- MedicHall — İngilizce normalize katmanı (veri + arama + skorlama)
-- Migration: 202607200002_english_normalization.sql
-- İdempotent; iki kez çalıştırmak güvenlidir.
--
-- 1) tenders.title_en / description_en / translation_status kolonları.
--    Doldurma işi ted-sync v1.5'te (Haiku, makine çevirisi olarak etiketli).
-- 2) search_tenders v3: metin araması artık İngilizce kolonları DA tarar
--    ("ultrasound" araması Almanca ihaleyi bulur — title_en'de geçiyorsa).
-- 3) refresh_company_opportunity_matches: keyword samanlığına İngilizce
--    kolonlar eklendi. Fonksiyon metni repodaki canlı sürümden (202607100005)
--    BİREBİR alınıp yalnız 2 haystack ifadesi genişletildi — başka hiçbir
--    satırına dokunulmadı. PRODUCT %0 sorununun ilacı burası: profil
--    keyword'leri İngilizce, ihale metni değildi; artık ikisi de taranıyor.
-- ============================================================================

alter table public.tenders add column if not exists title_en        text;
alter table public.tenders add column if not exists description_en  text;
alter table public.tenders add column if not exists translation_status text
  check (translation_status in ('pending','done','failed') or translation_status is null);

-- Çevrilecekleri hızlı bulmak için (ted-sync v1.5 kuyruğu)
create index if not exists tenders_translation_pending_idx
  on public.tenders (id) where translation_status is null or translation_status = 'pending';

-- Mevcut kayıtları kuyruğa al (yalnız hiç işaretlenmemişleri — idempotent)
update public.tenders set translation_status = 'pending'
 where translation_status is null and status = 'open';

-- --- search_tenders v3 --------------------------------------------------
drop function if exists public.search_tenders(text, text[], text[], text[], integer, numeric, numeric, boolean, integer, integer);
create or replace function public.search_tenders(
  p_query                text     default null,
  p_countries            text[]   default null,   -- country_name listesi
  p_cpv                  text[]   default null,   -- serbest metin: "3319", "33190000-8", "33 19"
  p_notice_types         text[]   default null,
  p_deadline_within_days integer  default null,   -- 7 / 30 / 90
  p_value_min_eur        numeric  default null,
  p_value_max_eur        numeric  default null,
  p_include_unknown_value boolean default true,
  p_limit                integer  default 20,
  p_offset               integer  default 0
)
returns table (
  id                  bigint,
  title               text,
  title_en            text,
  buyer_name          text,
  country_name        text,
  publication_date    date,
  deadline_at         timestamptz,
  estimated_value     numeric,
  currency            text,
  estimated_value_eur numeric,
  eur_rate_as_of      date,
  cpv_codes           text[],
  notice_type         text,
  source_url          text,
  total_count         bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with cpv_prefixes as (
    -- Kullanıcı ne yazarsa yazsın rakama indir: "3319" -> "3319",
    -- "33190000-8" -> "33190000". Prefix eşleşmesi hiyerarşiyi getirir:
    -- "3319" -> 33190000 VE 33192000 ✓
    select distinct left(regexp_replace(c, '[^0-9]', '', 'g'), 8) as p
    from unnest(coalesce(p_cpv, array[]::text[])) as c
    where regexp_replace(c, '[^0-9]', '', 'g') <> ''
  ),
  filtered as (
    select t.*
      from public.tenders t
     where t.status = 'open'

       and (p_query is null or btrim(p_query) = '' or (
              t.title       ilike '%' || btrim(p_query) || '%'
           or t.buyer_name  ilike '%' || btrim(p_query) || '%'
           or t.country_name ilike '%' || btrim(p_query) || '%'
           or t.description ilike '%' || btrim(p_query) || '%'
           or t.title_en       ilike '%' || btrim(p_query) || '%'
           or t.description_en ilike '%' || btrim(p_query) || '%'
       ))

       and (p_countries is null or cardinality(p_countries) = 0
            or t.country_name = any(p_countries))

       and (p_notice_types is null or cardinality(p_notice_types) = 0
            or t.notice_type = any(p_notice_types))

       and (not exists (select 1 from cpv_prefixes)
            or exists (
                 select 1
                   from unnest(t.cpv_codes_norm) as code
                   join cpv_prefixes cp on code like cp.p || '%'
               ))

       and (p_deadline_within_days is null
            or (t.deadline_at is not null
                and t.deadline_at >= now()
                and t.deadline_at <= now() + make_interval(days => p_deadline_within_days)))

       -- Değer filtresi. Kur bilinmiyorsa estimated_value_eur NULL'dur ve o
       -- ihale "değeri bilinmeyen" muamelesi görür — sessizce kaybolmaz.
       and (
             (p_value_min_eur is null and p_value_max_eur is null)
          or (t.estimated_value_eur is null and p_include_unknown_value)
          or (t.estimated_value_eur is not null
              and (p_value_min_eur is null or t.estimated_value_eur >= p_value_min_eur)
              and (p_value_max_eur is null or t.estimated_value_eur <= p_value_max_eur))
       )
  )
  select f.id, f.title, f.title_en, f.buyer_name, f.country_name, f.publication_date,
         f.deadline_at, f.estimated_value, f.currency, f.estimated_value_eur,
         f.eur_rate_as_of, f.cpv_codes, f.notice_type, f.source_url,
         count(*) over () as total_count
    from filtered f
   order by f.publication_date desc nulls last, f.id desc
   limit  greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.search_tenders(
  text, text[], text[], text[], integer, numeric, numeric, boolean, integer, integer
) to anon, authenticated;

-- --- skorlama yaması (repo 202607100005 tabanlı) --------------------
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
      ) as kw,
      public.country_match_score(v_profile.target_countries, t.country_code, t.country_name) as geo,
      public.array_overlap_score(v_profile.cpv_codes, t.cpv_codes) as cpvs,
      public.matched_keyword_list(
        v_profile.product_keywords,
        t.product_keywords,
        coalesce(t.title, '') || ' ' || coalesce(t.description, '') || ' ' || coalesce(t.title_en, '') || ' ' || coalesce(t.description_en, '')
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

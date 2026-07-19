-- ============================================================================
-- MedicHall — Sprint A: Tender filter data layer
-- Migration: 202607170001_tender_filters.sql
--
-- Bu dosya TEKRAR TEKRAR çalıştırılabilir (idempotent). İki kez koşarsan
-- hata vermez, veriyi bozmaz.
--
-- Ne yapar:
--   1. tenders.notice_type kolonu + raw_payload'dan GERİYE DÖNÜK doldurma
--      (TED'i yeniden taramaya GEREK YOK — veri zaten raw_payload'da)
--   2. CPV normalizasyonu: cpv_codes_norm generated column + GIN indeks
--      (kontrol hanesi atılır: "33190000-8" -> "33190000")
--   3. fx_rates tablosu — ECB resmi günlük kurları (uydurma kur YOK)
--   4. tenders.estimated_value_eur + eur_rate_as_of — "≈" ile gösterilecek
--   5. search_tenders() RPC — tüm filtreler, sunucu tarafında, sayfalamalı
--   6. tender_filter_facets() RPC — ülke/notice-type listeleri (1000 satır
--      çekmeye son)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) NOTICE TYPE
-- ---------------------------------------------------------------------------
alter table public.tenders add column if not exists notice_type text;

-- TED çok dilli alanları üç ayrı şekilde gelebiliyor:
--   {"eng":["Contract notice"]}   |   "cn-standard"   |   ["Contract notice"]
-- Üçünü de tek fonksiyonla düzleştiriyoruz (ted-sync.ts'teki firstText()
-- mantığının SQL karşılığı).
create or replace function public.ted_first_text(v jsonb)
returns text
language plpgsql
immutable
as $$
declare
  k text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;

  if jsonb_typeof(v) = 'string' then
    return nullif(trim(v #>> '{}'), '');
  end if;

  if jsonb_typeof(v) = 'array' then
    if jsonb_array_length(v) = 0 then return null; end if;
    return public.ted_first_text(v -> 0);
  end if;

  if jsonb_typeof(v) = 'object' then
    -- İngilizce varsa onu tercih et (ted-sync ile aynı davranış).
    if v ? 'eng' then
      return public.ted_first_text(v -> 'eng');
    end if;
    for k in select jsonb_object_keys(v) limit 1 loop
      return public.ted_first_text(v -> k);
    end loop;
    return null;
  end if;

  return nullif(trim(v #>> '{}'), '');
end;
$$;

-- Geriye dönük doldurma. Sadece boş olanları doldurur → tekrar çalıştırmak
-- güvenli, elle düzeltilmiş kayıtları ezmez.
update public.tenders
   set notice_type = public.ted_first_text(raw_payload -> 'notice-type')
 where notice_type is null
   and raw_payload ? 'notice-type';

-- ---------------------------------------------------------------------------
-- 2) CPV NORMALİZASYONU
-- ---------------------------------------------------------------------------
-- cpv_overlap_score() içindeki mantığın aynısı, ama tabloya kalıcı yazılıyor:
-- rakam dışı her şey atılır, İLK 8 hane alınır.  "33190000-8" -> "33190000"
-- IMMUTABLE olmak ZORUNDA, yoksa generated column kabul edilmez.
create or replace function public.cpv_normalize_arr(codes text[])
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct n order by n),
    array[]::text[]
  )
  from (
    select left(regexp_replace(coalesce(c, ''), '[^0-9]', '', 'g'), 8) as n
    from unnest(coalesce(codes, array[]::text[])) as c
  ) s
  where n <> '';
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'tenders'
       and column_name  = 'cpv_codes_norm'
  ) then
    alter table public.tenders
      add column cpv_codes_norm text[]
      generated always as (public.cpv_normalize_arr(cpv_codes)) stored;
  end if;
end $$;

create index if not exists tenders_cpv_norm_gin
  on public.tenders using gin (cpv_codes_norm);

-- ---------------------------------------------------------------------------
-- 3) ECB KUR TABLOSU
-- ---------------------------------------------------------------------------
-- Kaynak: ECB euro foreign exchange reference rates (resmi, ücretsiz, günlük).
-- rate_to_eur = 1 birim yabancı para kaç EUR eder.
-- ted-sync her koşuda buraya yazar. Kur UYDURULMAZ; kur yoksa çeviri yapılmaz.
create table if not exists public.fx_rates (
  currency     text primary key,
  rate_to_eur  numeric not null check (rate_to_eur > 0),
  as_of        date    not null,
  updated_at   timestamptz not null default now()
);

alter table public.fx_rates enable row level security;

-- Kurlar kamuya açık bilgi; okuma serbest, yazma yalnız service_role.
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates
  for select using (true);

-- EUR'nun kendisi her zaman 1.0 — ECB listesinde yer almaz.
insert into public.fx_rates (currency, rate_to_eur, as_of)
values ('EUR', 1, current_date)
on conflict (currency) do update
  set rate_to_eur = 1, as_of = current_date, updated_at = now();

-- ---------------------------------------------------------------------------
-- 4) EUR KARŞILIĞI
-- ---------------------------------------------------------------------------
alter table public.tenders add column if not exists estimated_value_eur numeric;
alter table public.tenders add column if not exists eur_rate_as_of      date;

-- Generated column KULLANILAMAZ: başka tabloya (fx_rates) bakıyor, yani
-- IMMUTABLE değil. Bu yüzden açık bir tazeleme fonksiyonu.
-- Kuru olmayan para birimi -> estimated_value_eur NULL kalır (uydurmuyoruz),
-- UI orijinal değeri "12 000 000 SEK" olarak gösterir, "≈" göstermez.
create or replace function public.refresh_tender_eur_values()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.tenders t
     set estimated_value_eur = round(t.estimated_value * f.rate_to_eur, 2),
         eur_rate_as_of      = f.as_of
    from public.fx_rates f
   where upper(trim(t.currency)) = f.currency
     and t.estimated_value is not null
     and (
          t.estimated_value_eur is null
       or t.eur_rate_as_of is distinct from f.as_of
     );
  get diagnostics touched = row_count;

  -- Değeri veya para birimi olmayanlarda EUR alanı kesinlikle boş kalsın.
  update public.tenders
     set estimated_value_eur = null,
         eur_rate_as_of      = null
   where estimated_value_eur is not null
     and (estimated_value is null or currency is null);

  return touched;
end;
$$;

create index if not exists tenders_value_eur_idx
  on public.tenders (estimated_value_eur) where status = 'open';
create index if not exists tenders_deadline_idx
  on public.tenders (deadline_at) where status = 'open';
create index if not exists tenders_notice_type_idx
  on public.tenders (notice_type) where status = 'open';
create index if not exists tenders_country_idx
  on public.tenders (country_name) where status = 'open';

-- Mevcut satırlar için ilk doldurma (EUR olanlar hemen dolar).
select public.refresh_tender_eur_values();

-- ---------------------------------------------------------------------------
-- 5) ARAMA RPC'si
-- ---------------------------------------------------------------------------
-- Tüm filtreler tek sunucu çağrısında. PostgREST query string'iyle CPV aile
-- eşleşmesi (prefix) YAPILAMIYOR, o yüzden RPC şart.
--
-- ÖNEMLİ — p_include_unknown_value:
--   true  (varsayılan) => değeri belirtilmemiş ihaleler HER ZAMAN listede kalır
--   false             => kullanıcı bilerek elemiştir
-- "Skorlama ≠ filtre" ilkesi: kullanıcı neyi elediğini bilmeden elememeli.
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
  select f.id, f.title, f.buyer_name, f.country_name, f.publication_date,
         f.deadline_at, f.estimated_value, f.currency, f.estimated_value_eur,
         f.eur_rate_as_of, f.cpv_codes, f.notice_type, f.source_url,
         count(*) over () as total_count
    from filtered f
   order by f.publication_date desc nulls last, f.id desc
   limit  greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ---------------------------------------------------------------------------
-- 6) FİLTRE SEÇENEKLERİ (facets)
-- ---------------------------------------------------------------------------
-- Eski portal.html ülke listesi için 1000 satır çekiyordu. Artık tek çağrı,
-- sadece gerçekten beslemede olan değerler döner (boş liste = boş dropdown,
-- uydurma seçenek yok).
create or replace function public.tender_filter_facets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'countries', coalesce((
        select jsonb_agg(x.country_name order by x.country_name)
          from (select distinct country_name
                  from public.tenders
                 where status = 'open' and country_name is not null) x
      ), '[]'::jsonb),
    'notice_types', coalesce((
        select jsonb_agg(x.notice_type order by x.notice_type)
          from (select distinct notice_type
                  from public.tenders
                 where status = 'open' and notice_type is not null) x
      ), '[]'::jsonb),
    'currencies', coalesce((
        select jsonb_agg(x.currency order by x.currency)
          from (select distinct currency
                  from public.tenders
                 where status = 'open' and currency is not null) x
      ), '[]'::jsonb),
    'fx_as_of', (select max(as_of) from public.fx_rates where currency <> 'EUR')
  );
$$;

-- ---------------------------------------------------------------------------
-- 7) YETKİLER
-- ---------------------------------------------------------------------------
grant execute on function public.search_tenders(
  text, text[], text[], text[], integer, numeric, numeric, boolean, integer, integer
) to anon, authenticated;
grant execute on function public.tender_filter_facets() to anon, authenticated;
grant execute on function public.refresh_tender_eur_values() to service_role;
grant select on public.fx_rates to anon, authenticated;

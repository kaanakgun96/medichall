-- ============================================================================
-- MedicHall — Sprint C: Kayıtlı aramalar + günlük digest altyapısı
-- Migration: 202607200003_saved_searches.sql
-- İdempotent; iki kez çalıştırmak güvenlidir.
--
-- 1) saved_searches — kullanıcının kaydettiği filtre setleri (ayrık kolonlar,
--    JSON yorumlayıcı YOK: digest, filtreleri search_tenders'a aynen geçirir).
-- 2) search_tenders v4 — opsiyonel p_created_after parametresi (digest "son
--    koşudan beri YENİ düşenler"i bununla çeker). Geriye uyumlu: portal
--    çağrıları değişmeden çalışır.
-- 3) digest_due_saved_searches() — e-posta isteyen aramaları sahibinin
--    user_id'siyle döndürür (tender-digest fonksiyonu tüketir).
-- 4) mark_saved_search_digested() — başarılı gönderim sonrası damga.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) SAVED SEARCHES
-- ---------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id              bigint generated always as identity primary key,
  user_id         uuid not null default auth.uid(),
  name            text not null check (length(trim(name)) between 1 and 80),
  -- Filtreler: portal'daki feed filtreleriyle birebir aynı yapı
  query           text,
  countries       text[],
  cpv             text[],
  notice_types    text[],
  deadline_days   integer check (deadline_days is null or deadline_days > 0),
  value_min_eur   numeric check (value_min_eur is null or value_min_eur >= 0),
  value_max_eur   numeric check (value_max_eur is null or value_max_eur >= 0),
  include_unknown_value boolean not null default true,
  -- Digest ayarı
  email_alerts    boolean not null default true,
  last_digest_at  timestamptz not null default now(),  -- kayıttan ÖNCEKİ ihaleler mail olmaz
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists saved_searches_user_idx   on public.saved_searches (user_id);
create index if not exists saved_searches_alert_idx  on public.saved_searches (email_alerts) where email_alerts;

alter table public.saved_searches enable row level security;

-- Herkes yalnız KENDİ aramalarını görür/yönetir; digest servisi service_role ile girer.
drop policy if exists saved_searches_own on public.saved_searches;
create policy saved_searches_own on public.saved_searches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.saved_searches to authenticated;

-- Kullanıcı başına makul tavan (kötüye kullanım/maliyet koruması)
create or replace function public.saved_searches_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 20 then
    raise exception 'Saved search limit reached (20). Delete one to add another.';
  end if;
  return new;
end $$;

drop trigger if exists saved_searches_cap_trg on public.saved_searches;
create trigger saved_searches_cap_trg
  before insert on public.saved_searches
  for each row execute function public.saved_searches_cap();

-- ---------------------------------------------------------------------------
-- 2) SEARCH_TENDERS v4 — p_created_after (digest için; portal'a etkisiz)
-- ---------------------------------------------------------------------------
drop function if exists public.search_tenders(text, text[], text[], text[], integer, numeric, numeric, boolean, integer, integer);
drop function if exists public.search_tenders(text, text[], text[], text[], integer, numeric, numeric, boolean, integer, integer, timestamptz);
create or replace function public.search_tenders(
  p_query                text     default null,
  p_countries            text[]   default null,
  p_cpv                  text[]   default null,
  p_notice_types         text[]   default null,
  p_deadline_within_days integer  default null,
  p_value_min_eur        numeric  default null,
  p_value_max_eur        numeric  default null,
  p_include_unknown_value boolean default true,
  p_limit                integer  default 20,
  p_offset               integer  default 0,
  p_created_after        timestamptz default null   -- v4: yalnız bundan sonra eklenenler
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
    select distinct left(regexp_replace(c, '[^0-9]', '', 'g'), 8) as p
    from unnest(coalesce(p_cpv, array[]::text[])) as c
    where regexp_replace(c, '[^0-9]', '', 'g') <> ''
  ),
  filtered as (
    select t.*
      from public.tenders t
     where t.status = 'open'

       and (p_created_after is null or t.created_at > p_created_after)

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
  text, text[], text[], text[], integer, numeric, numeric, boolean, integer, integer, timestamptz
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) DIGEST YARDIMCILARI (yalnız service_role — tender-digest fonksiyonu)
-- ---------------------------------------------------------------------------
create or replace function public.digest_due_saved_searches()
returns table (
  search_id bigint, user_id uuid, name text,
  query text, countries text[], cpv text[], notice_types text[],
  deadline_days integer, value_min_eur numeric, value_max_eur numeric,
  include_unknown_value boolean, last_digest_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select s.id, s.user_id, s.name, s.query, s.countries, s.cpv, s.notice_types,
         s.deadline_days, s.value_min_eur, s.value_max_eur,
         s.include_unknown_value, s.last_digest_at
    from public.saved_searches s
   where s.email_alerts
   order by s.user_id, s.id;
$$;

create or replace function public.mark_saved_search_digested(p_ids bigint[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare touched integer;
begin
  update public.saved_searches
     set last_digest_at = now(), updated_at = now()
   where id = any(coalesce(p_ids, array[]::bigint[]));
  get diagnostics touched = row_count;
  return touched;
end $$;

grant execute on function public.digest_due_saved_searches() to service_role;
grant execute on function public.mark_saved_search_digested(bigint[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4) DIGEST ZAMANLAMASI
-- ---------------------------------------------------------------------------
-- Cron is intentionally not installed by a schema migration. Project URLs
-- and credentials are environment configuration, not schema. After the
-- required Vault entries exist, run supabase/setup/CONFIGURE-CRON.sql through
-- an authorized administrative session. That script configures both the TED
-- sync and digest jobs without storing a credential literal in cron.job.

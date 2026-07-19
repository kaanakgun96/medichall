-- ============================================================
-- MedicHall — Ana sayfa canlı istatistikleri (v2)
-- v2 yeniliği: "açık ihale" sayısı (son teslim tarihi geçmemiş) —
-- ziyaretçiye toplam arşiv yerine ŞU AN AÇIK fırsatları söylemek
-- hem daha dürüst hem daha güncel bir mesajdır.
-- Sadece toplam sayılar döner; hiçbir satır sızmaz. Anon için güvenli.
-- Tekrar çalıştırmaya dayanıklı (v1'in üzerine yazar).
-- ============================================================

create or replace function public.medichall_public_stats()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'open_tenders',     (select count(*) from public.tenders
                          where deadline_at is not null and deadline_at >= now()),
    'tenders',          (select count(*) from public.tenders),
    'tender_countries', (select count(distinct country_name) from public.tenders
                          where country_name is not null and country_name <> ''
                            and deadline_at is not null and deadline_at >= now()),
    'products',         (select count(*) from public.products where is_active = true),
    'manufacturers',    (select count(*) from public.companies
                          where is_approved = true and is_active = true)
  );
$$;

grant execute on function public.medichall_public_stats() to anon, authenticated;
select public.medichall_public_stats() as canli_rakamlar;

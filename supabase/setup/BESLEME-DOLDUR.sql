-- ============================================================
-- BESLEME-DOLDUR.sql — Tüm AB, son 30 gün geriye dönük doldurma
--
-- ÖNCE: ted-sync-v13.ts'yi ted-sync fonksiyonuna deploy et!
-- (v1.3 = ülke kısıtı kalktı; eski sürümle bu SQL yine 3 ülke çeker)
--
-- Aşağıda CRON_SECRET'INI_YAZ yerine kendi CRON_SECRET değerini koy
-- (Edge Functions → ted-sync → Secrets içinde görebilirsin).
-- ============================================================

-- 1) Elle tetikle: son 30 gün, 10 sayfa (≈ tüm AB medikal ihaleleri)
select net.http_post(
  url := 'https://azdmuarzntzqdyirysux.supabase.co/functions/v1/ted-sync',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', 'CRON_SECRET_INI_YAZ'
  ),
  body := jsonb_build_object('lookback_days', 30, 'max_pages', 10),
  timeout_milliseconds := 120000
) as istek_id;

-- 2) ~2 dakika bekle, sonra sonucu gör:
-- select id, status_code, left(content::text, 400)
--   from net._http_response order by id desc limit 1;

-- 3) Ülke dağılımını kontrol et (artık uzun bir liste görmelisin):
-- select country_name, count(*) from public.tenders
--  group by 1 order by 2 desc;

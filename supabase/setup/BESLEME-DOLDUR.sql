-- ============================================================
-- BESLEME-DOLDUR.sql — Tüm AB, son 30 gün geriye dönük doldurma
--
-- ÖNCE: ted-sync-v13.ts'yi ted-sync fonksiyonuna deploy et!
-- (v1.3 = ülke kısıtı kalktı; eski sürümle bu SQL yine 3 ülke çeker)
--
-- Bu betik URL veya secret literal'i içermez. Önce Supabase Vault içinde
-- medichall_project_url ve medichall_cron_secret kayıtlarını oluştur.
-- ============================================================

-- 1) Elle tetikle: son 30 gün, 10 sayfa (≈ tüm AB medikal ihaleleri)
do $backfill$
declare
  v_project_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'medichall_project_url'
   limit 1;

  select decrypted_secret
    into v_cron_secret
    from vault.decrypted_secrets
   where name = 'medichall_cron_secret'
   limit 1;

  if v_project_url is null or v_project_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Missing or invalid Vault secret: medichall_project_url';
  end if;

  if v_cron_secret is null or length(v_cron_secret) < 32 then
    raise exception 'Missing or too-short Vault secret: medichall_cron_secret';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/ted-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object('lookback_days', 30, 'max_pages', 10),
    timeout_milliseconds := 120000
  )
  into v_request_id;

  raise notice 'TED backfill request queued with id %', v_request_id;
end
$backfill$;

-- 2) ~2 dakika bekle, sonra sonucu gör:
-- select id, status_code, left(content::text, 400)
--   from net._http_response order by id desc limit 1;

-- 3) Ülke dağılımını kontrol et (artık uzun bir liste görmelisin):
-- select country_name, count(*) from public.tenders
--  group by 1 order by 2 desc;

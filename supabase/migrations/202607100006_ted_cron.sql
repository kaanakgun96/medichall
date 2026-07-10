-- MedicHall — TED sync günlük zamanlama (pg_cron)
--
-- !!! ÇALIŞTIRMADAN ÖNCE !!!
-- Aşağıdaki 'BURAYA_CRON_SECRET_YAZ' metnini, Edge Function secrets'a
-- eklediğin CRON_SECRET değeriyle DEĞİŞTİR (2 yerde değil, 1 yerde geçiyor).
--
-- Zamanlama: her gün 06:30 UTC (Türkiye saatiyle 09:30).
-- TED yeni ihaleleri sabah CET saatlerinde yayınlar; 09:30 TR ideal.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Varsa eski zamanlamayı kaldır (ilk kurulumda hata vermez).
do $$
begin
  perform cron.unschedule('medichall-ted-sync');
exception when others then
  null;
end $$;

select cron.schedule(
  'medichall-ted-sync',
  '30 6 * * *',
  $cron$
  select net.http_post(
    url     := 'https://azdmuarzntzqdyirysux.supabase.co/functions/v1/ted-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'mh_ted_9f3kQz71LpXw2026'
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- Kontrol: zamanlanmış işleri listele
select jobid, jobname, schedule from cron.job;

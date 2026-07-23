-- MedicHall cron configuration
--
-- Prerequisites:
--   1. Create an Edge Function secret named CRON_SECRET.
--   2. Create these Supabase Vault secrets through an authorized channel:
--        medichall_project_url  = the HTTPS Supabase project URL
--        medichall_cron_secret  = the same value as CRON_SECRET
--
-- This script never embeds either decrypted value in cron.job. Each job reads
-- the Vault values at execution time, so rotating the Vault entry does not
-- require rewriting the stored cron command. Run this script manually after
-- migrations; it is not part of the schema migration chain.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $configure$
declare
  v_project_url text;
  v_cron_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is unavailable';
  end if;

  execute $query$
    select decrypted_secret
      from vault.decrypted_secrets
     where name = 'medichall_project_url'
     limit 1
  $query$
  into v_project_url;

  execute $query$
    select decrypted_secret
      from vault.decrypted_secrets
     where name = 'medichall_cron_secret'
     limit 1
  $query$
  into v_cron_secret;

  if v_project_url is null or v_project_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Missing or invalid Vault secret: medichall_project_url';
  end if;

  if v_cron_secret is null or length(v_cron_secret) < 32 then
    raise exception 'Missing or too-short Vault secret: medichall_cron_secret';
  end if;

  begin
    perform cron.unschedule('medichall-ted-sync');
  exception when others then
    null;
  end;

  begin
    perform cron.unschedule('medichall-tender-digest');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'medichall-ted-sync',
    '30 6 * * *',
    $job$
    with runtime_config as (
      select
        max(decrypted_secret) filter (
          where name = 'medichall_project_url'
        ) as project_url,
        max(decrypted_secret) filter (
          where name = 'medichall_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets
    )
    select net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/ted-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', cron_secret
      ),
      body := '{}'::jsonb
    )
    from runtime_config
    where project_url is not null
      and cron_secret is not null;
    $job$
  );

  perform cron.schedule(
    'medichall-tender-digest',
    '0 7 * * *',
    $job$
    with runtime_config as (
      select
        max(decrypted_secret) filter (
          where name = 'medichall_project_url'
        ) as project_url,
        max(decrypted_secret) filter (
          where name = 'medichall_cron_secret'
        ) as cron_secret
      from vault.decrypted_secrets
    )
    select net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/tender-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', cron_secret
      ),
      body := '{}'::jsonb
    )
    from runtime_config
    where project_url is not null
      and cron_secret is not null;
    $job$
  );
end
$configure$;

select jobid, jobname, schedule
from cron.job
where jobname in ('medichall-ted-sync', 'medichall-tender-digest')
order by jobname;

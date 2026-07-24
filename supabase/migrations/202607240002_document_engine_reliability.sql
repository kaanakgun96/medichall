-- MedicHall Document Engine Reliability
-- Run after 202607240001_product_aware_matching.sql
--
-- Measured production failure (2026-07-24, project azdmuarzntzqdyirysux):
-- the edge worker running a background analysis job is terminated by the
-- Supabase runtime at ~150 seconds of wall clock. function_logs recorded
-- shutdown reason "WallClockTime" for the worker of analysis job 50
-- (booted 04:38:16Z, killed 04:40:47Z, cpu_time_used 521ms, memory 38MB),
-- so the binding resource ceiling is wall clock, not CPU or memory.
-- The kill bypasses all in-process error handling, which left jobs in
-- 'processing' forever with orphaned chunk leases and nothing ever
-- re-invoking them. This migration adds:
--   1. an atomic job claim so only one worker runs a job at a time,
--   2. stale-job recovery that requeues or finalizes abandoned jobs,
--   3. a pg_cron sweeper that runs recovery and re-invokes the engine
--      for queued jobs (resume dispatch).

begin;

create or replace function public.claim_tender_document_analysis_job_v3(
  p_job_id bigint,
  p_stale_seconds integer default 150
)
returns public.tender_document_analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.tender_document_analysis_jobs;
begin
  if auth.jwt() is not null
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
  then
    raise exception 'Access denied';
  end if;

  if p_stale_seconds < 30 or p_stale_seconds > 3600 then
    raise exception 'Invalid job claim configuration';
  end if;

  update public.tender_document_analysis_jobs job
  set
    status = 'processing',
    attempt_count = job.attempt_count + 1,
    resume_count = job.resume_count + case
      when job.attempt_count > 0 then 1
      else 0
    end,
    last_resumed_at = case
      when job.attempt_count > 0 then now()
      else job.last_resumed_at
    end,
    started_at = coalesce(job.started_at, now()),
    updated_at = now()
  where job.id = p_job_id
    and (
      job.status = 'queued'
      or (
        job.status = 'processing'
        and job.updated_at < now() - make_interval(secs => p_stale_seconds)
      )
    )
  returning job.* into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_tender_document_analysis_job_v3(
  bigint,
  integer
) from public, anon, authenticated;
grant execute on function public.claim_tender_document_analysis_job_v3(
  bigint,
  integer
) to service_role;

create or replace function public.recover_stale_tender_document_analysis_jobs(
  p_stale_minutes integer default 5,
  p_max_attempts integer default 4
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leases_released integer := 0;
  v_requeued bigint[] := '{}';
  v_finalized_partial bigint[] := '{}';
  v_finalized_failed bigint[] := '{}';
begin
  if auth.jwt() is not null
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    and not public.is_admin()
  then
    raise exception 'Access denied';
  end if;

  if p_stale_minutes < 1 or p_stale_minutes > 1440
    or p_max_attempts < 1 or p_max_attempts > 10
  then
    raise exception 'Invalid recovery configuration';
  end if;

  -- Chunk leases orphaned by a dead worker become claimable again.
  with released as (
    update public.tender_document_analysis_chunks chunk
    set
      status = 'queued',
      lease_expires_at = null,
      updated_at = now()
    where chunk.status = 'processing'
      and chunk.lease_expires_at < now()
    returning chunk.id
  )
  select count(*) into v_leases_released from released;

  -- Stale jobs with attempts left are requeued for the resume dispatcher.
  with requeued as (
    update public.tender_document_analysis_jobs job
    set
      status = 'queued',
      termination_reason = 'STALE_WORKER_LOST',
      error_code = null,
      error_message = null,
      updated_at = now()
    where job.status = 'processing'
      and job.updated_at < now() - make_interval(mins => p_stale_minutes)
      and job.attempt_count < p_max_attempts
    returning job.id
  )
  select coalesce(array_agg(id), '{}') into v_requeued from requeued;

  -- Stale jobs out of attempts keep their partial results if any chunk
  -- completed, and otherwise fail with an explicit termination reason.
  with finalized as (
    update public.tender_document_analysis_jobs job
    set
      status = 'partial',
      termination_reason = 'STALE_WORKER_LOST_MAX_ATTEMPTS',
      error_code = 'DOCUMENT_ENGINE_WORKER_LOST',
      error_message =
        'The analysis worker stopped reporting progress and the retry '
        || 'limit was reached. Partial extraction results were kept.',
      completed_at = now(),
      updated_at = now()
    where job.status in ('processing', 'queued')
      and job.updated_at < now() - make_interval(mins => p_stale_minutes)
      and job.attempt_count >= p_max_attempts
      and (
        job.normalized_result is not null
        or exists (
          select 1
          from public.tender_document_analysis_chunks chunk
          where chunk.job_id = job.id
            and chunk.status = 'completed'
        )
      )
    returning job.id, job.tender_id
  ),
  mirrored as (
    update public.tenders tender
    set
      document_analysis_status = 'partial',
      updated_at = now()
    from finalized
    where tender.id = finalized.tender_id
      and tender.document_analysis_status in ('queued', 'processing')
    returning tender.id
  )
  select coalesce(array_agg(id), '{}') into v_finalized_partial
  from finalized;

  with finalized as (
    update public.tender_document_analysis_jobs job
    set
      status = 'failed',
      termination_reason = 'STALE_WORKER_LOST_MAX_ATTEMPTS',
      error_code = 'DOCUMENT_ENGINE_WORKER_LOST',
      error_message =
        'The analysis worker stopped reporting progress and the retry '
        || 'limit was reached before any document chunk completed.',
      completed_at = now(),
      updated_at = now()
    where job.status in ('processing', 'queued')
      and job.updated_at < now() - make_interval(mins => p_stale_minutes)
      and job.attempt_count >= p_max_attempts
      and job.normalized_result is null
      and not exists (
        select 1
        from public.tender_document_analysis_chunks chunk
        where chunk.job_id = job.id
          and chunk.status = 'completed'
      )
    returning job.id, job.tender_id
  ),
  mirrored as (
    update public.tenders tender
    set
      document_analysis_status = 'failed',
      updated_at = now()
    from finalized
    where tender.id = finalized.tender_id
      and tender.document_analysis_status in ('queued', 'processing')
    returning tender.id
  )
  select coalesce(array_agg(id), '{}') into v_finalized_failed
  from finalized;

  return jsonb_build_object(
    'leases_released', v_leases_released,
    'requeued_job_ids', to_jsonb(v_requeued),
    'finalized_partial_job_ids', to_jsonb(v_finalized_partial),
    'finalized_failed_job_ids', to_jsonb(v_finalized_failed)
  );
end;
$$;

revoke all on function public.recover_stale_tender_document_analysis_jobs(
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.recover_stale_tender_document_analysis_jobs(
  integer,
  integer
) to service_role;

-- Sweeper: recover stale jobs every minute and dispatch a resume
-- invocation when queued work is waiting. Uses the same Vault-backed
-- configuration as the existing MedicHall cron jobs.
select cron.schedule(
  'medichall-doc-engine-recovery',
  '* * * * *',
  $cron$
    select public.recover_stale_tender_document_analysis_jobs();

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
      url := rtrim(project_url, '/') || '/functions/v1/tender-document-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', cron_secret
      ),
      body := jsonb_build_object('action', 'resume')
    )
    from runtime_config
    where project_url is not null
      and cron_secret is not null
      and exists (
        select 1
        from public.tender_document_analysis_jobs
        where status = 'queued'
          and updated_at < now() - interval '45 seconds'
      );
  $cron$
);

commit;

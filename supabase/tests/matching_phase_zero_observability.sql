-- Run against an isolated database after applying all migrations.
-- This test is read-only and does not create benchmark labels.

begin;

do $$
declare
  v_status_count integer;
  v_error_count integer;
begin
  select count(*) into v_status_count
  from public.document_access_statuses
  where code in (
    'no_document_link_found',
    'public_direct_download',
    'public_detail_page',
    'redirect_required',
    'session_required',
    'login_required',
    'membership_required',
    'paid_access_required',
    'captcha_required',
    'terms_acceptance_required',
    'dynamic_javascript_required',
    'access_forbidden',
    'rate_limited',
    'expired_link',
    'broken_link',
    'unsupported_file_type',
    'file_too_large',
    'download_timeout',
    'archive_processing_required',
    'manual_review_required',
    'downloaded',
    'parsed',
    'parsing_failed'
  );
  if v_status_count <> 23 then
    raise exception 'Expected 23 required document access statuses, found %',
      v_status_count;
  end if;

  if exists (
    select 1
    from public.document_access_statuses
    where code in (
      'captcha_required',
      'login_required',
      'membership_required',
      'paid_access_required'
    )
      and access_class <> 'restricted'
  ) then
    raise exception 'Restricted document status mapped to wrong access class';
  end if;

  select count(*) into v_error_count
  from public.pipeline_error_categories;
  if v_error_count < 23 then
    raise exception 'Expected the full Phase 0 error taxonomy';
  end if;

  if to_regclass('public.pipeline_runs') is null
    or to_regclass('public.pipeline_run_stages') is null
    or to_regclass('public.benchmark_cases') is null
    or to_regclass('public.benchmark_annotations') is null
  then
    raise exception 'A required Phase 0 table is missing';
  end if;

  if (
    select count(*)
    from public.pipeline_versions
    where is_repository_current
      and content_sha256 ~ '^[a-f0-9]{64}$'
  ) <> 8 then
    raise exception 'Expected eight hashed repository-current pipeline versions';
  end if;
end;
$$;

rollback;

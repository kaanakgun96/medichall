-- Existing public RPC signatures that the legacy and React portals depend on
-- must remain available after the additive v2 migrations.

begin;

do $tests$
begin
  if to_regprocedure(
    'public.refresh_company_opportunity_matches(bigint)'
  ) is null then
    raise exception 'Legacy match refresh RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.refresh_explainable_tender_matches(bigint)'
  ) is null then
    raise exception 'Legacy explainable match RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.queue_tender_document_analysis(bigint,bigint)'
  ) is null then
    raise exception 'Document queue RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.get_tender_document_analysis_status(bigint,bigint)'
  ) is null then
    raise exception 'Document status RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.queue_tender_document_discovery(bigint,bigint)'
  ) is null then
    raise exception 'Discovery queue RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.get_tender_document_discovery_status(bigint,bigint)'
  ) is null then
    raise exception 'Discovery status RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.queue_tender_archive_jobs(bigint,bigint)'
  ) is null then
    raise exception 'Archive queue RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.get_tender_archive_status(bigint,bigint)'
  ) is null then
    raise exception 'Archive status RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.search_tenders(text,text[],text[],text[],integer,numeric,numeric,boolean,integer,integer,timestamptz)'
  ) is null then
    raise exception 'Tender search RPC signature is missing';
  end if;
  if to_regprocedure(
    'public.register_uploaded_tender_documents(bigint,bigint,jsonb)'
  ) is null then
    raise exception 'Tender upload registration RPC signature is missing';
  end if;

  if to_regprocedure(
    'public.calculate_opportunity_match_score_v2(bigint,bigint)'
  ) is null
    or to_regprocedure(
      'public.refresh_opportunity_match_score_v2(bigint,bigint,uuid)'
    ) is null
    or to_regprocedure(
      'public.refresh_company_match_scores_v2(bigint,integer,uuid)'
    ) is null
    or to_regprocedure(
      'public.get_opportunity_match_score_v2(bigint,bigint)'
    ) is null
  then
    raise exception 'A Match Score v2 RPC signature is missing';
  end if;
end
$tests$;

rollback;

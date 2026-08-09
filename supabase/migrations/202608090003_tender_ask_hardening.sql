-- MedicHall Sprint 4 hardening: failed-request cooldown and complete provider accounting.

begin;

create or replace function public.reserve_tender_question_v1(
  p_user_id uuid,
  p_company_id bigint,
  p_tender_id bigint,
  p_question text,
  p_normalized_question text,
  p_question_hash text,
  p_context_hash text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  cached public.tender_question_answers%rowtype;
  lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 300));
  failed_retry_after timestamptz;
begin
  if p_user_id is null
    or not exists (
      select 1 from public.companies company
      where company.id = p_company_id
        and company.owner_id = p_user_id
    )
    or not exists (
      select 1 from public.opportunity_matches match
      where match.company_id = p_company_id
        and match.tender_id = p_tender_id
        and match.opportunity_type = 'tender'
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_question, ''))) not between 3 and 600
    or p_question_hash !~ '^[a-f0-9]{64}$'
    or p_context_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid question reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':' || p_tender_id::text || ':' ||
    p_question_hash || ':' || p_context_hash,
    0
  ));

  select answer.* into cached
  from public.tender_question_answers answer
  where answer.company_id = p_company_id
    and answer.tender_id = p_tender_id
    and answer.question_hash = p_question_hash
    and answer.context_hash = p_context_hash;

  if cached.id is not null and cached.status = 'completed' then
    return jsonb_build_object(
      'answer_id', cached.id,
      'should_execute', false,
      'status', 'completed',
      'cached', true,
      'answer', cached.answer,
      'uncertainty', cached.uncertainty,
      'citations', cached.citations,
      'input_tokens', cached.input_tokens,
      'output_tokens', cached.output_tokens,
      'total_tokens', cached.total_tokens,
      'estimated_cost_usd', cached.estimated_cost_usd
    );
  end if;

  if cached.id is not null
    and cached.status = 'processing'
    and cached.lease_expires_at > now()
  then
    return jsonb_build_object(
      'answer_id', cached.id,
      'should_execute', false,
      'status', 'processing',
      'cached', false
    );
  end if;

  failed_retry_after := cached.updated_at + interval '5 minutes';
  if cached.id is not null
    and cached.status = 'failed'
    and failed_retry_after > now()
  then
    return jsonb_build_object(
      'answer_id', cached.id,
      'should_execute', false,
      'status', 'failed',
      'cached', false,
      'retry_after', failed_retry_after,
      'error_code', cached.error_code
    );
  end if;

  if cached.id is null then
    insert into public.tender_question_answers (
      requested_by,
      company_id,
      tender_id,
      question,
      normalized_question,
      question_hash,
      context_hash,
      lease_expires_at
    ) values (
      p_user_id,
      p_company_id,
      p_tender_id,
      trim(p_question),
      trim(p_normalized_question),
      p_question_hash,
      p_context_hash,
      now() + make_interval(secs => lease_seconds)
    )
    returning * into cached;
  else
    update public.tender_question_answers answer
    set requested_by = p_user_id,
        question = trim(p_question),
        normalized_question = trim(p_normalized_question),
        status = 'processing',
        answer = null,
        uncertainty = null,
        citations = '[]'::jsonb,
        provider_name = null,
        model_name = null,
        provider_request_id = null,
        usage_id = null,
        input_tokens = null,
        output_tokens = null,
        total_tokens = null,
        estimated_cost_usd = null,
        error_code = null,
        completed_at = null,
        attempt_count = answer.attempt_count + 1,
        lease_expires_at = now() + make_interval(secs => lease_seconds),
        updated_at = now()
    where answer.id = cached.id
    returning * into cached;
  end if;

  return jsonb_build_object(
    'answer_id', cached.id,
    'should_execute', true,
    'status', 'processing',
    'cached', false,
    'attempt_count', cached.attempt_count
  );
end;
$function$;

create or replace function public.complete_tender_question_v1(
  p_answer_id uuid,
  p_usage_id bigint,
  p_status text,
  p_answer text default null,
  p_uncertainty text default null,
  p_citations jsonb default '[]'::jsonb,
  p_provider_name text default null,
  p_model_name text default null,
  p_provider_request_id text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_total_tokens integer default null,
  p_estimated_cost_usd numeric default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_status not in ('completed', 'failed')
    or jsonb_typeof(coalesce(p_citations, '[]'::jsonb)) <> 'array'
    or (p_status = 'completed' and nullif(trim(coalesce(p_answer, '')), '') is null)
  then
    raise exception 'Invalid tender answer completion' using errcode = '22023';
  end if;

  update public.tender_question_answers answer_row
  set status = p_status,
      answer = case when p_status = 'completed' then left(p_answer, 12000) else null end,
      uncertainty = case when p_status = 'completed' then left(p_uncertainty, 1200) else null end,
      citations = case when p_status = 'completed' then p_citations else '[]'::jsonb end,
      provider_name = left(p_provider_name, 80),
      model_name = left(p_model_name, 160),
      provider_request_id = left(p_provider_request_id, 200),
      usage_id = p_usage_id,
      input_tokens = case when p_input_tokens is null then null else greatest(p_input_tokens, 0) end,
      output_tokens = case when p_output_tokens is null then null else greatest(p_output_tokens, 0) end,
      total_tokens = case when p_total_tokens is null then null else greatest(p_total_tokens, 0) end,
      estimated_cost_usd = case
        when p_estimated_cost_usd is null then null
        else greatest(p_estimated_cost_usd, 0)
      end,
      error_code = case when p_status = 'failed' then left(p_error_code, 100) else null end,
      lease_expires_at = null,
      completed_at = case when p_status = 'completed' then now() else null end,
      updated_at = now()
  where answer_row.id = p_answer_id
    and answer_row.status = 'processing';

  if not found then
    raise exception 'Tender answer reservation not found' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.reserve_tender_question_v1(
  uuid, bigint, bigint, text, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.complete_tender_question_v1(
  uuid, bigint, text, text, text, jsonb, text, text, text,
  integer, integer, integer, numeric, text
) from public, anon, authenticated;
grant execute on function public.reserve_tender_question_v1(
  uuid, bigint, bigint, text, text, text, text, integer
) to service_role;
grant execute on function public.complete_tender_question_v1(
  uuid, bigint, text, text, text, jsonb, text, text, text,
  integer, integer, integer, numeric, text
) to service_role;

comment on function public.reserve_tender_question_v1(
  uuid, bigint, bigint, text, text, text, text, integer
) is 'Atomically leases one tenant-scoped tender question. Completed answers are cached, live work is deduplicated, and failed identical requests receive a five-minute retry cooldown.';

commit;

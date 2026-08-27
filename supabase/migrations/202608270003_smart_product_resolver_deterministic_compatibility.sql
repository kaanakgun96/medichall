-- Smart Product Resolver V1 deterministic compatibility hotfix.
-- Keeps the existing deterministic resolver RPC compatible with the required
-- event metadata introduced by 202608270002.

begin;

do $preflight$
begin
  if to_regprocedure(
       'public.record_product_resolution_event_v1(bigint,uuid,text,text,text,jsonb)'
     ) is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'product_resolution_events'
         and column_name = 'input_normalized_phrase'
         and is_nullable = 'NO'
     ) then
    raise exception 'Smart Resolver deterministic compatibility preflight failed';
  end if;
end
$preflight$;

create or replace function public.record_product_resolution_event_v1(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_normalized_phrase text,
  p_phrase_signature text,
  p_resolution_status text,
  p_suggestions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2000ms'
as $function$
declare
  v_phrase text := public.normalize_unknown_product_phrase_v1(p_normalized_phrase);
  v_signature text := public.unknown_product_phrase_signature_v1(p_normalized_phrase);
  v_status text := upper(trim(coalesce(p_resolution_status, '')));
  v_event public.product_resolution_events%rowtype;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or v_phrase <> p_normalized_phrase
     or v_signature <> p_phrase_signature
     or v_status not in ('EXACT_APPROVED', 'SUGGESTED', 'UNMAPPED')
     or jsonb_typeof(p_suggestions) <> 'array'
     or jsonb_array_length(p_suggestions) > 3
     or octet_length(p_suggestions::text) > 8192 then
    raise exception 'Invalid bounded product-resolution event' using errcode = '22023';
  end if;
  if v_status = 'UNMAPPED' and not public.is_bounded_medical_product_phrase_v1(v_phrase) then
    raise exception 'A specific medical product phrase is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_suggestions) suggestion
    where not coalesce(suggestion->>'canonical_taxonomy_id', '') ~ '^[0-9]{1,18}$'
       or not exists (
         select 1 from public.medical_product_taxonomy taxonomy
         where taxonomy.id = (suggestion->>'canonical_taxonomy_id')::bigint
           and taxonomy.is_active
       )
  ) then
    raise exception 'Resolution suggestions contain an unavailable taxonomy category'
      using errcode = '22023';
  end if;

  insert into public.product_resolution_events(
    company_id, requested_by, idempotency_key, normalized_phrase,
    input_normalized_phrase, phrase_signature, resolution_status,
    alias_candidate_eligible, suggestions, resolver_type, resolver_version,
    confidence_label, reason_code, medical_product_confirmed, user_decision
  ) values (
    p_company_id, auth.uid(), p_idempotency_key, v_phrase,
    v_phrase, v_signature, v_status,
    v_status = 'SUGGESTED', p_suggestions, 'DETERMINISTIC', 'DETERMINISTIC_V2',
    case
      when v_status = 'EXACT_APPROVED' then 'HIGH'
      when v_status = 'SUGGESTED' then 'MEDIUM'
      else null
    end,
    case when v_status in ('EXACT_APPROVED', 'SUGGESTED')
      then 'MEDICAL_PRODUCT_RESOLVED' else null end,
    v_status in ('EXACT_APPROVED', 'SUGGESTED', 'UNMAPPED'),
    case when v_status = 'EXACT_APPROVED' then 'NOT_REQUIRED' else 'PENDING' end
  ) on conflict (company_id, idempotency_key) do nothing
  returning * into v_event;
  if v_event.id is null then
    select * into v_event from public.product_resolution_events
    where company_id = p_company_id and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object(
    'resolution_event_id', v_event.id,
    'resolution_status', v_event.resolution_status,
    'reused', v_event.created_at < clock_timestamp() - interval '1 millisecond'
  );
end
$function$;

revoke all on function public.record_product_resolution_event_v1(
  bigint,uuid,text,text,text,jsonb
) from public, anon;
grant execute on function public.record_product_resolution_event_v1(
  bigint,uuid,text,text,text,jsonb
) to authenticated, service_role;

comment on function public.record_product_resolution_event_v1(
  bigint,uuid,text,text,text,jsonb
) is 'Tenant-scoped deterministic product resolution event writer compatible with Smart Product Resolver V1 metadata.';

commit;

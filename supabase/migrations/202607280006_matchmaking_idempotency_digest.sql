-- Resolve pgcrypto from Supabase's extension schema explicitly.

begin;

create or replace function public.mm_begin_idempotent_operation(
  p_actor_profile_id uuid,
  p_operation text,
  p_idempotency_key uuid,
  p_payload jsonb,
  out is_replay boolean,
  out replay_response jsonb
)
returns record
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  payload_hash text;
  stored_hash text;
begin
  if p_actor_profile_id is null then
    raise exception 'A matchmaking profile is required'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required'
      using errcode = '22023';
  end if;
  if nullif(trim(p_operation), '') is null then
    raise exception 'An operation name is required'
      using errcode = '22023';
  end if;

  payload_hash := encode(
    extensions.digest(
      convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.matchmaking_idempotency_keys (
    actor_profile_id,
    operation,
    idempotency_key,
    request_hash
  )
  values (
    p_actor_profile_id,
    p_operation,
    p_idempotency_key,
    payload_hash
  )
  on conflict (actor_profile_id, operation, idempotency_key) do nothing;

  if found then
    is_replay := false;
    replay_response := null;
    return;
  end if;

  select request_hash, response
  into stored_hash, replay_response
  from public.matchmaking_idempotency_keys
  where actor_profile_id = p_actor_profile_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key;

  if stored_hash is distinct from payload_hash then
    raise exception 'Idempotency key was reused with a different request'
      using errcode = '22023';
  end if;
  if replay_response is null then
    raise exception 'The matching operation is still processing'
      using errcode = '40001';
  end if;

  is_replay := true;
end;
$function$;

revoke all on function public.mm_begin_idempotent_operation(
  uuid, text, uuid, jsonb
) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;

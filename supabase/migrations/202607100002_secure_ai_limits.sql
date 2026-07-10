-- MedicHall AI: authenticated usage reservation and atomic daily limits.
-- Run after 202607100001_ai_usage.sql.

alter table public.medichall_ai_usage
  add column if not exists status text not null default 'reserved',
  add column if not exists error_code text,
  add column if not exists completed_at timestamptz;

alter table public.medichall_ai_usage
  drop constraint if exists medichall_ai_usage_status_check;

alter table public.medichall_ai_usage
  add constraint medichall_ai_usage_status_check
  check (status in ('reserved', 'completed', 'failed'));

create index if not exists medichall_ai_usage_user_created_idx
  on public.medichall_ai_usage (user_id, created_at desc);

create index if not exists medichall_ai_usage_daily_limit_idx
  on public.medichall_ai_usage (user_id, created_at)
  where status in ('reserved', 'completed');

create or replace function public.reserve_medichall_ai_request(
  p_user_id uuid,
  p_mode text,
  p_role text,
  p_input_chars integer,
  p_daily_limit integer default 20
)
returns table (
  allowed boolean,
  usage_id bigint,
  used_today integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_usage_id bigint;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  if p_daily_limit < 1 or p_daily_limit > 500 then
    raise exception 'invalid daily limit';
  end if;

  -- Serializes reservations per user/day so parallel calls cannot bypass the limit.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || current_date::text, 0)
  );

  select count(*)::integer
    into v_used
  from public.medichall_ai_usage
  where user_id = p_user_id
    and created_at >= date_trunc('day', now())
    and created_at < date_trunc('day', now()) + interval '1 day'
    and status in ('reserved', 'completed');

  if v_used >= p_daily_limit then
    return query select false, null::bigint, v_used;
    return;
  end if;

  insert into public.medichall_ai_usage (
    user_id,
    role,
    mode,
    input_chars,
    status
  )
  values (
    p_user_id,
    nullif(left(coalesce(p_role, ''), 80), ''),
    left(coalesce(p_mode, 'general'), 80),
    greatest(coalesce(p_input_chars, 0), 0),
    'reserved'
  )
  returning id into v_usage_id;

  return query select true, v_usage_id, v_used + 1;
end;
$$;

create or replace function public.finish_medichall_ai_request(
  p_usage_id bigint,
  p_status text,
  p_output_chars integer,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_total_tokens integer,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'invalid final status';
  end if;

  update public.medichall_ai_usage
  set status = p_status,
      output_chars = greatest(coalesce(p_output_chars, 0), 0),
      prompt_tokens = p_prompt_tokens,
      completion_tokens = p_completion_tokens,
      total_tokens = p_total_tokens,
      error_code = nullif(left(coalesce(p_error_code, ''), 100), ''),
      completed_at = now()
  where id = p_usage_id
    and status = 'reserved';
end;
$$;

-- Only privileged server-side clients may call these functions.
revoke all on function public.reserve_medichall_ai_request(uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finish_medichall_ai_request(bigint, text, integer, integer, integer, integer, text)
  from public, anon, authenticated;

grant execute on function public.reserve_medichall_ai_request(uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.finish_medichall_ai_request(bigint, text, integer, integer, integer, integer, text)
  to service_role;

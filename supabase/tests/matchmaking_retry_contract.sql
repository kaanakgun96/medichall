-- Focused matchmaking retry-contract regression.
-- This test is metadata-only and always rolls back.

begin;

do $contract$
declare
  required_rpc text;
  retryable_count integer;
  conflict_routine_count integer;
  conflict_branch_count integer;
begin
  foreach required_rpc in array array[
    'public.claim_matchmaking_video_room(bigint)',
    'public.complete_matchmaking_video_room(bigint,text,text,text,text,timestamptz)',
    'public.fail_matchmaking_video_room(bigint,text)',
    'public.mm_begin_idempotent_operation(uuid,text,uuid,jsonb)',
    'public.request_business_connection_v2(uuid,text,uuid)',
    'public.respond_business_connection_v2(bigint,text,integer,uuid)',
    'public.respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)',
    'public.revise_matchmaking_meeting_proposal(bigint,integer,text,text,text,text,jsonb,uuid)',
    'public.submit_matchmaking_meeting_outcome(bigint,text,text,text,timestamptz,uuid)',
    'public.update_matchmaking_meeting_draft(bigint,integer,text,text,text,text,jsonb,uuid)'
  ]
  loop
    if to_regprocedure(required_rpc) is null then
      raise exception 'Required matchmaking routine is missing: %', required_rpc;
    end if;
    if pg_get_functiondef(to_regprocedure(required_rpc)) like
       '%errcode = ''40001''%' then
      raise exception 'Retryable 40001 remains in business-conflict routine: %',
        required_rpc;
    end if;
    if pg_get_functiondef(to_regprocedure(required_rpc)) not like
       '%errcode = ''PT409''%' then
      raise exception 'Non-retryable PT409 contract is missing from %',
        required_rpc;
    end if;
  end loop;

  select
    count(*) filter (where p.prosrc like '%errcode = ''40001''%'),
    count(*) filter (where p.prosrc like '%errcode = ''PT409''%'),
    coalesce(sum(
      (length(p.prosrc) - length(replace(
        p.prosrc,
        'errcode = ''PT409''',
        ''
      ))) / length('errcode = ''PT409''')
    ), 0)
  into retryable_count, conflict_routine_count, conflict_branch_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';

  if retryable_count <> 0 then
    raise exception 'Unexpected explicit public 40001 routine count: %',
      retryable_count;
  end if;
  if conflict_routine_count <> 10 or conflict_branch_count <> 20 then
    raise exception 'Expected 10 PT409 routines / 20 branches, found % / %',
      conflict_routine_count,
      conflict_branch_count;
  end if;

  if has_function_privilege(
    'anon',
    'public.respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)',
    'execute'
  ) then
    raise exception 'Anonymous role can execute meeting response';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)',
    'execute'
  ) then
    raise exception 'Authenticated role cannot execute meeting response';
  end if;
end
$contract$;

rollback;

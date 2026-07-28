-- MedicHall Matchmaking Workspace: transactional reads and lifecycle RPCs.

begin;

do $preflight$
begin
  if to_regclass('public.matchmaking_meeting_events') is null
     or to_regclass('public.matchmaking_idempotency_keys') is null then
    raise exception
      'Matchmaking Workspace workflow preflight failed: apply 202607280002 first';
  end if;
end
$preflight$;

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

create or replace function public.set_matchmaking_match_status(
  p_match_id bigint,
  p_status text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  match_row public.matchmaking_matches;
  idempotency record;
  result jsonb;
begin
  if p_status not in ('new', 'viewed', 'saved', 'dismissed') then
    raise exception 'Match status must be new, viewed, saved, or dismissed'
      using errcode = '22023';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile_id,
    'set_match_status',
    p_idempotency_key,
    jsonb_build_object('match_id', p_match_id, 'status', p_status)
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  update public.matchmaking_matches match_item
  set status = p_status, updated_at = now()
  where match_item.id = p_match_id
    and match_item.source_profile_id = current_profile_id
    and match_item.status not in ('connection_requested', 'connected')
  returning * into match_row;

  if match_row.id is null then
    raise exception 'Match not found, access denied, or relationship already active'
      using errcode = '42501';
  end if;

  result := jsonb_build_object(
    'match_id', match_row.id,
    'status', match_row.status,
    'updated_at', match_row.updated_at
  );
  perform public.mm_complete_idempotent_operation(
    current_profile_id,
    'set_match_status',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.send_matchmaking_relationship_message(
  p_connection_id bigint,
  p_body text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  other_profile_id uuid;
  connection_row public.business_connections;
  message_row public.matchmaking_relationship_messages;
  idempotency record;
  result jsonb;
begin
  if nullif(trim(p_body), '') is null
     or char_length(trim(p_body)) > 4000 then
    raise exception 'Messages must contain between 1 and 4000 characters'
      using errcode = '22023';
  end if;

  select * into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid();

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile.id,
    'send_relationship_message',
    p_idempotency_key,
    jsonb_build_object(
      'connection_id', p_connection_id,
      'body', trim(p_body)
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into connection_row
  from public.business_connections connection
  where connection.id = p_connection_id
    and connection.status = 'accepted'
    and current_profile.id in (
      connection.requester_profile_id,
      connection.recipient_profile_id
    )
  for share;

  if connection_row.id is null then
    raise exception 'An accepted relationship is required to send messages'
      using errcode = '42501';
  end if;

  other_profile_id := case
    when connection_row.requester_profile_id = current_profile.id
      then connection_row.recipient_profile_id
    else connection_row.requester_profile_id
  end;

  insert into public.matchmaking_relationship_messages (
    connection_id,
    sender_profile_id,
    message_type,
    body
  )
  values (
    connection_row.id,
    current_profile.id,
    'human',
    trim(p_body)
  )
  returning * into message_row;

  update public.business_connections
  set last_activity_at = now(), updated_at = now()
  where id = connection_row.id;

  perform public.mm_add_notification(
    other_profile_id,
    current_profile.id,
    connection_row.id,
    null,
    'relationship_message',
    'New relationship message',
    current_profile.display_name || ': ' || left(trim(p_body), 160),
    'connection:' || connection_row.id || ':message:' || message_row.id,
    '#matchmaking-relationship=' || connection_row.id
  );

  result := to_jsonb(message_row) ||
    jsonb_build_object('sender_name', current_profile.display_name);
  perform public.mm_complete_idempotent_operation(
    current_profile.id,
    'send_relationship_message',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.upsert_matchmaking_private_note(
  p_connection_id bigint,
  p_meeting_id bigint,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  note_row public.matchmaking_private_notes;
  idempotency record;
  result jsonb;
begin
  if nullif(trim(p_note), '') is null
     or char_length(trim(p_note)) > 8000 then
    raise exception 'Private notes must contain between 1 and 8000 characters'
      using errcode = '22023';
  end if;
  if not public.mm_is_connection_participant(p_connection_id) then
    raise exception 'Relationship not found or access denied'
      using errcode = '42501';
  end if;
  if p_meeting_id is not null and not exists (
    select 1
    from public.matchmaking_meeting_requests meeting
    where meeting.id = p_meeting_id
      and meeting.connection_id = p_connection_id
      and current_profile_id in (
        meeting.requester_profile_id,
        meeting.recipient_profile_id
      )
      and (
        meeting.status <> 'draft'
        or meeting.requester_profile_id = current_profile_id
      )
  ) then
    raise exception 'Meeting not found in this relationship'
      using errcode = '42501';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile_id,
    'upsert_private_note',
    p_idempotency_key,
    jsonb_build_object(
      'connection_id', p_connection_id,
      'meeting_id', p_meeting_id,
      'note', trim(p_note)
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into note_row
  from public.matchmaking_private_notes note
  where note.connection_id = p_connection_id
    and note.owner_profile_id = current_profile_id
    and note.meeting_id is not distinct from p_meeting_id
  for update;

  if note_row.id is null then
    insert into public.matchmaking_private_notes (
      connection_id,
      meeting_id,
      owner_profile_id,
      note
    )
    values (
      p_connection_id,
      p_meeting_id,
      current_profile_id,
      trim(p_note)
    )
    returning * into note_row;
  else
    update public.matchmaking_private_notes
    set note = trim(p_note), updated_at = now()
    where id = note_row.id
    returning * into note_row;
  end if;

  result := to_jsonb(note_row);
  perform public.mm_complete_idempotent_operation(
    current_profile_id,
    'upsert_private_note',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.submit_matchmaking_meeting_outcome(
  p_meeting_id bigint,
  p_outcome_status text,
  p_shared_summary text,
  p_next_step text,
  p_follow_up_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  other_profile_id uuid;
  meeting_row public.matchmaking_meeting_requests;
  outcome_row public.matchmaking_meeting_outcomes;
  idempotency record;
  result jsonb;
begin
  if p_outcome_status not in (
    'positive',
    'neutral',
    'negative',
    'follow_up_needed',
    'no_decision'
  ) then
    raise exception 'Invalid meeting outcome'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_shared_summary, '')) > 8000
     or char_length(coalesce(p_next_step, '')) > 2000 then
    raise exception 'Meeting outcome text is too long'
      using errcode = '22023';
  end if;
  if p_follow_up_at is not null and p_follow_up_at <= now() then
    raise exception 'Follow-up time must be in the future'
      using errcode = '22023';
  end if;

  select * into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid();

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile.id,
    'submit_meeting_outcome',
    p_idempotency_key,
    jsonb_build_object(
      'meeting_id', p_meeting_id,
      'outcome_status', p_outcome_status,
      'shared_summary', nullif(trim(p_shared_summary), ''),
      'next_step', nullif(trim(p_next_step), ''),
      'follow_up_at', p_follow_up_at
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into meeting_row
  from public.matchmaking_meeting_requests meeting
  where meeting.id = p_meeting_id
    and current_profile.id in (
      meeting.requester_profile_id,
      meeting.recipient_profile_id
    )
  for share;

  if meeting_row.id is null then
    raise exception 'Meeting not found or access denied'
      using errcode = '42501';
  end if;
  if meeting_row.status not in ('completed', 'no_show') then
    raise exception 'Close the meeting before recording an outcome'
      using errcode = '40001';
  end if;

  insert into public.matchmaking_meeting_outcomes (
    meeting_id,
    author_profile_id,
    outcome_status,
    shared_summary,
    next_step,
    follow_up_at
  )
  values (
    meeting_row.id,
    current_profile.id,
    p_outcome_status,
    nullif(trim(p_shared_summary), ''),
    nullif(trim(p_next_step), ''),
    p_follow_up_at
  )
  on conflict (meeting_id, author_profile_id) do update
  set
    outcome_status = excluded.outcome_status,
    shared_summary = excluded.shared_summary,
    next_step = excluded.next_step,
    follow_up_at = excluded.follow_up_at,
    updated_at = now()
  returning * into outcome_row;

  other_profile_id := case
    when meeting_row.requester_profile_id = current_profile.id
      then meeting_row.recipient_profile_id
    else meeting_row.requester_profile_id
  end;

  perform public.mm_add_meeting_event(
    meeting_row.id,
    meeting_row.connection_id,
    current_profile.id,
    'meeting_outcome_shared',
    meeting_row.status,
    meeting_row.status,
    jsonb_build_object(
      'outcome_status', p_outcome_status,
      'follow_up_at', p_follow_up_at
    )
  );
  perform public.mm_add_notification(
    other_profile_id,
    current_profile.id,
    meeting_row.connection_id,
    meeting_row.id,
    'meeting_outcome_shared',
    'Meeting follow-up added',
    current_profile.display_name || ' added a shared meeting outcome.',
    'meeting:' || meeting_row.id || ':outcome:' || current_profile.id ||
      ':' || outcome_row.updated_at,
    '#matchmaking-meeting=' || meeting_row.id
  );

  if p_follow_up_at is not null then
    insert into public.matchmaking_meeting_reminders (
      meeting_id,
      recipient_profile_id,
      reminder_type,
      channel,
      due_at,
      dedupe_key
    )
    values (
      meeting_row.id,
      current_profile.id,
      'post_meeting_follow_up',
      'in_app',
      p_follow_up_at,
      'meeting:' || meeting_row.id || ':follow-up:' || current_profile.id
    )
    on conflict (dedupe_key) do update
    set
      due_at = excluded.due_at,
      status = 'scheduled',
      claimed_at = null,
      sent_at = null,
      error_code = null;
  end if;

  result := to_jsonb(outcome_row);
  perform public.mm_complete_idempotent_operation(
    current_profile.id,
    'submit_meeting_outcome',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.mark_matchmaking_notifications_read(
  p_notification_ids bigint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  affected_count integer;
begin
  if current_profile_id is null then
    raise exception 'Create your matchmaking profile first'
      using errcode = '42501';
  end if;

  update public.matchmaking_notifications
  set read_at = coalesce(read_at, now())
  where recipient_profile_id = current_profile_id
    and (
      p_notification_ids is null
      or id = any(p_notification_ids)
    )
    and read_at is null;

  get diagnostics affected_count = row_count;
  return jsonb_build_object(
    'updated_count', affected_count,
    'unread_count', (
      select count(*)
      from public.matchmaking_notifications
      where recipient_profile_id = current_profile_id
        and read_at is null
    )
  );
end;
$function$;

-- Preserve the original portal contracts while routing them through the
-- reconciled transactional workflows.
create or replace function public.request_business_connection(
  p_recipient_profile_id uuid,
  p_message text default null
)
returns public.business_connections
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  operation_result jsonb;
  connection_row public.business_connections;
begin
  operation_result := public.request_business_connection_v2(
    p_recipient_profile_id,
    p_message,
    gen_random_uuid()
  );

  select *
  into connection_row
  from public.business_connections
  where id = (operation_result ->> 'connection_id')::bigint;

  return connection_row;
end;
$function$;

create or replace function public.respond_business_connection(
  p_connection_id bigint,
  p_status text
)
returns public.business_connections
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  connection_row public.business_connections;
begin
  select *
  into connection_row
  from public.business_connections
  where id = p_connection_id;

  perform public.respond_business_connection_v2(
    p_connection_id,
    p_status,
    connection_row.state_version,
    gen_random_uuid()
  );

  select *
  into connection_row
  from public.business_connections
  where id = p_connection_id;

  return connection_row;
end;
$function$;

create or replace function public.request_matchmaking_meeting(
  p_recipient_profile_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text,
  p_agenda text default null
)
returns public.matchmaking_meeting_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  connection_id bigint;
  operation_result jsonb;
  meeting_row public.matchmaking_meeting_requests;
begin
  select connection.id
  into connection_id
  from public.business_connections connection
  where connection.status = 'accepted'
    and (
      (
        connection.requester_profile_id = current_profile_id
        and connection.recipient_profile_id = p_recipient_profile_id
      ) or (
        connection.recipient_profile_id = current_profile_id
        and connection.requester_profile_id = p_recipient_profile_id
      )
    )
  order by connection.updated_at desc
  limit 1;

  if connection_id is null then
    raise exception 'An accepted connection is required before requesting a meeting'
      using errcode = '42501';
  end if;

  operation_result := public.propose_matchmaking_meeting(
    connection_id,
    'Matchmaking meeting',
    p_agenda,
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    null,
    jsonb_build_array(
      jsonb_build_object('start_at', p_start, 'end_at', p_end)
    ),
    false,
    gen_random_uuid()
  );

  select *
  into meeting_row
  from public.matchmaking_meeting_requests
  where id = (operation_result ->> 'id')::bigint;

  return meeting_row;
end;
$function$;

create or replace function public.request_business_connection_v2(
  p_recipient_profile_id uuid,
  p_message text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  requester public.matchmaking_profiles;
  recipient public.matchmaking_profiles;
  connection_row public.business_connections;
  idempotency record;
  result jsonb;
  created_connection boolean := false;
begin
  select * into requester
  from public.matchmaking_profiles
  where user_id = auth.uid();

  if requester.id is null then
    raise exception 'Create your matchmaking profile first'
      using errcode = '42501';
  end if;
  if requester.id = p_recipient_profile_id then
    raise exception 'You cannot connect with your own profile'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_message, '')) > 2000 then
    raise exception 'Introduction messages are limited to 2000 characters'
      using errcode = '22023';
  end if;

  select * into recipient
  from public.matchmaking_profiles
  where id = p_recipient_profile_id
    and is_active = true;

  if recipient.id is null then
    raise exception 'The selected partner profile is unavailable'
      using errcode = '22023';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    requester.id,
    'request_connection',
    p_idempotency_key,
    jsonb_build_object(
      'recipient_profile_id', p_recipient_profile_id,
      'message', nullif(trim(p_message), '')
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into connection_row
  from public.business_connections connection
  where (
    (
      connection.requester_profile_id = requester.id
      and connection.recipient_profile_id = recipient.id
    ) or (
      connection.requester_profile_id = recipient.id
      and connection.recipient_profile_id = requester.id
    )
  )
    and connection.status in ('pending', 'accepted')
  order by connection.updated_at desc
  limit 1
  for update;

  if connection_row.id is null then
    begin
      insert into public.business_connections (
        requester_profile_id,
        recipient_profile_id,
        status,
        introduction_message,
        state_version,
        last_activity_at
      )
      values (
        requester.id,
        recipient.id,
        'pending',
        nullif(trim(p_message), ''),
        1,
        now()
      )
      returning * into connection_row;
      created_connection := true;
    exception when unique_violation then
      select *
      into connection_row
      from public.business_connections connection
      where (
        (
          connection.requester_profile_id = requester.id
          and connection.recipient_profile_id = recipient.id
        ) or (
          connection.requester_profile_id = recipient.id
          and connection.recipient_profile_id = requester.id
        )
      )
        and connection.status in ('pending', 'accepted')
      order by connection.updated_at desc
      limit 1;
    end;
  end if;

  if connection_row.id is null then
    raise exception 'The connection request could not be created'
      using errcode = '40001';
  end if;

  update public.matchmaking_matches
  set status = case
      when connection_row.status = 'accepted' then 'connected'
      else 'connection_requested'
    end,
    updated_at = now()
  where source_profile_id = requester.id
    and target_profile_id = recipient.id;

  if created_connection then
    perform public.mm_add_system_message(
      connection_row.id,
      requester.display_name || ' requested a business connection.',
      jsonb_build_object('event_type', 'connection_requested')
    );
    perform public.mm_add_notification(
      recipient.id,
      requester.id,
      connection_row.id,
      null,
      'connection_requested',
      'New connection request',
      requester.display_name || ' would like to connect.',
      'connection:' || connection_row.id || ':requested',
      '#matchmaking-relationship=' || connection_row.id
    );
  end if;

  result := jsonb_build_object(
    'connection_id', connection_row.id,
    'status', connection_row.status,
    'state_version', connection_row.state_version,
    'created', created_connection
  );
  perform public.mm_complete_idempotent_operation(
    requester.id,
    'request_connection',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.respond_business_connection_v2(
  p_connection_id bigint,
  p_status text,
  p_expected_version integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  connection_row public.business_connections;
  idempotency record;
  result jsonb;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'Connection response must be accepted or declined'
      using errcode = '22023';
  end if;

  select * into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid();

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile.id,
    'respond_connection',
    p_idempotency_key,
    jsonb_build_object(
      'connection_id', p_connection_id,
      'status', p_status,
      'expected_version', p_expected_version
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into connection_row
  from public.business_connections
  where id = p_connection_id
  for update;

  if connection_row.id is null
     or connection_row.recipient_profile_id <> current_profile.id then
    raise exception 'Connection request not found or access denied'
      using errcode = '42501';
  end if;
  if connection_row.status <> 'pending' then
    raise exception 'This connection request has already been resolved'
      using errcode = '40001';
  end if;
  if p_expected_version is not null
     and connection_row.state_version <> p_expected_version then
    raise exception 'This connection changed. Refresh before responding.'
      using errcode = '40001';
  end if;

  update public.business_connections
  set
    status = p_status,
    responded_at = now(),
    accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
    state_version = state_version + 1,
    last_activity_at = now(),
    updated_at = now()
  where id = connection_row.id
  returning * into connection_row;

  update public.matchmaking_matches
  set
    status = case when p_status = 'accepted' then 'connected' else 'dismissed' end,
    updated_at = now()
  where (
    source_profile_id = connection_row.requester_profile_id
    and target_profile_id = connection_row.recipient_profile_id
  ) or (
    source_profile_id = connection_row.recipient_profile_id
    and target_profile_id = connection_row.requester_profile_id
  );

  perform public.mm_add_system_message(
    connection_row.id,
    current_profile.display_name ||
      case when p_status = 'accepted'
        then ' accepted the business connection.'
        else ' declined the business connection.'
      end,
    jsonb_build_object('event_type', 'connection_' || p_status)
  );
  perform public.mm_add_notification(
    connection_row.requester_profile_id,
    current_profile.id,
    connection_row.id,
    null,
    'connection_' || p_status,
    case when p_status = 'accepted'
      then 'Connection accepted'
      else 'Connection declined'
    end,
    current_profile.display_name || ' ' || p_status || ' your connection request.',
    'connection:' || connection_row.id || ':' || p_status ||
      ':v' || connection_row.state_version,
    '#matchmaking-relationship=' || connection_row.id
  );

  result := jsonb_build_object(
    'connection_id', connection_row.id,
    'status', connection_row.status,
    'state_version', connection_row.state_version
  );
  perform public.mm_complete_idempotent_operation(
    current_profile.id,
    'respond_connection',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.propose_matchmaking_meeting(
  p_connection_id bigint,
  p_title text,
  p_agenda text,
  p_timezone text,
  p_language text,
  p_slots jsonb,
  p_save_as_draft boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  other_profile public.matchmaking_profiles;
  connection_row public.business_connections;
  meeting_row public.matchmaking_meeting_requests;
  validated_slot record;
  idempotency record;
  result jsonb;
  first_start timestamptz;
  first_end timestamptz;
  latest_end timestamptz;
  expected_duration integer;
  seen_starts timestamptz[] := '{}'::timestamptz[];
  initial_status text;
begin
  select * into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid();

  if current_profile.id is null then
    raise exception 'Create your matchmaking profile first'
      using errcode = '42501';
  end if;
  if nullif(trim(p_title), '') is null
     or char_length(trim(p_title)) > 160 then
    raise exception 'Meeting title must contain between 1 and 160 characters'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_agenda, '')) > 4000 then
    raise exception 'Meeting agendas are limited to 4000 characters'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_language, '')) > 40 then
    raise exception 'Meeting language is limited to 40 characters'
      using errcode = '22023';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile.id,
    'propose_meeting',
    p_idempotency_key,
    jsonb_build_object(
      'connection_id', p_connection_id,
      'title', trim(p_title),
      'agenda', nullif(trim(p_agenda), ''),
      'timezone', trim(p_timezone),
      'language', nullif(trim(p_language), ''),
      'slots', p_slots,
      'save_as_draft', coalesce(p_save_as_draft, false)
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into connection_row
  from public.business_connections connection
  where connection.id = p_connection_id
    and connection.status = 'accepted'
    and current_profile.id in (
      connection.requester_profile_id,
      connection.recipient_profile_id
    )
  for share;

  if connection_row.id is null then
    raise exception 'An accepted relationship is required before proposing a meeting'
      using errcode = '42501';
  end if;

  select * into other_profile
  from public.matchmaking_profiles
  where id = case
    when connection_row.requester_profile_id = current_profile.id
      then connection_row.recipient_profile_id
    else connection_row.requester_profile_id
  end;

  for validated_slot in
    select *
    from public.mm_validate_proposal_slots(
      p_slots,
      trim(p_timezone),
      not coalesce(p_save_as_draft, false)
    )
  loop
    if expected_duration is null then
      expected_duration := validated_slot.duration_minutes;
      first_start := validated_slot.start_at;
      first_end := validated_slot.end_at;
    elsif expected_duration <> validated_slot.duration_minutes then
      raise exception 'All proposed times must use the same duration'
        using errcode = '22023';
    end if;
    if validated_slot.start_at = any(seen_starts) then
      raise exception 'Meeting proposals must use distinct start times'
        using errcode = '22023';
    end if;
    seen_starts := array_append(seen_starts, validated_slot.start_at);
    latest_end := greatest(coalesce(latest_end, validated_slot.end_at), validated_slot.end_at);
  end loop;

  initial_status := case
    when coalesce(p_save_as_draft, false) then 'draft'
    else 'proposed'
  end;

  insert into public.matchmaking_meeting_requests (
    connection_id,
    requester_profile_id,
    recipient_profile_id,
    proposed_start,
    proposed_end,
    timezone,
    agenda,
    status,
    title,
    language,
    creator_timezone,
    duration_minutes,
    state_version,
    proposal_round,
    submitted_at,
    expires_at,
    last_activity_at
  )
  values (
    connection_row.id,
    current_profile.id,
    other_profile.id,
    first_start,
    first_end,
    trim(p_timezone),
    nullif(trim(p_agenda), ''),
    initial_status,
    trim(p_title),
    nullif(trim(p_language), ''),
    trim(p_timezone),
    expected_duration,
    1,
    1,
    case when initial_status = 'proposed' then now() end,
    latest_end + interval '7 days',
    now()
  )
  returning * into meeting_row;

  for validated_slot in
    select *
    from public.mm_validate_proposal_slots(
      p_slots,
      trim(p_timezone),
      not coalesce(p_save_as_draft, false)
    )
  loop
    insert into public.matchmaking_meeting_proposals (
      meeting_id,
      proposal_round,
      slot_number,
      proposed_by_profile_id,
      start_at,
      end_at,
      source_timezone,
      status
    )
    values (
      meeting_row.id,
      1,
      validated_slot.slot_number,
      current_profile.id,
      validated_slot.start_at,
      validated_slot.end_at,
      trim(p_timezone),
      'active'
    );
  end loop;

  insert into public.matchmaking_meeting_participants (
    meeting_id,
    profile_id,
    participant_role,
    response_status
  )
  values
    (meeting_row.id, current_profile.id, 'organizer', 'accepted'),
    (meeting_row.id, other_profile.id, 'required', 'needs_action');

  perform public.mm_add_meeting_event(
    meeting_row.id,
    connection_row.id,
    current_profile.id,
    case when initial_status = 'draft'
      then 'draft_created'
      else 'meeting_proposed'
    end,
    null,
    initial_status,
    jsonb_build_object(
      'proposal_round', 1,
      'proposal_count', jsonb_array_length(p_slots),
      'timezone', trim(p_timezone)
    )
  );

  if initial_status = 'proposed' then
    perform public.mm_add_system_message(
      connection_row.id,
      current_profile.display_name || ' proposed a meeting with ' ||
        jsonb_array_length(p_slots) || ' time option(s).',
      jsonb_build_object(
        'event_type', 'meeting_proposed',
        'meeting_id', meeting_row.id
      )
    );
    perform public.mm_add_notification(
      other_profile.id,
      current_profile.id,
      connection_row.id,
      meeting_row.id,
      'meeting_proposed',
      'New meeting proposal',
      current_profile.display_name || ' proposed a meeting.',
      'meeting:' || meeting_row.id || ':proposed:v1',
      '#matchmaking-meeting=' || meeting_row.id
    );
  end if;

  update public.business_connections
  set last_activity_at = now(), updated_at = now()
  where id = connection_row.id;

  result := public.mm_meeting_snapshot(meeting_row.id);
  perform public.mm_complete_idempotent_operation(
    current_profile.id,
    'propose_meeting',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;


create or replace function public.mm_complete_idempotent_operation(
  p_actor_profile_id uuid,
  p_operation text,
  p_idempotency_key uuid,
  p_response jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $function$
  update public.matchmaking_idempotency_keys
  set response = coalesce(p_response, '{}'::jsonb)
  where actor_profile_id = p_actor_profile_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key;
$function$;

create or replace function public.mm_add_meeting_event(
  p_meeting_id bigint,
  p_connection_id bigint,
  p_actor_profile_id uuid,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_event_data jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  event_id bigint;
begin
  insert into public.matchmaking_meeting_events (
    meeting_id,
    connection_id,
    actor_profile_id,
    event_type,
    from_status,
    to_status,
    event_data
  )
  values (
    p_meeting_id,
    p_connection_id,
    p_actor_profile_id,
    p_event_type,
    p_from_status,
    p_to_status,
    coalesce(p_event_data, '{}'::jsonb)
  )
  returning id into event_id;

  return event_id;
end;
$function$;

create or replace function public.mm_add_system_message(
  p_connection_id bigint,
  p_body text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  message_id bigint;
begin
  insert into public.matchmaking_relationship_messages (
    connection_id,
    sender_profile_id,
    message_type,
    body,
    metadata
  )
  values (
    p_connection_id,
    null,
    'system',
    left(trim(p_body), 4000),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into message_id;

  return message_id;
end;
$function$;

create or replace function public.mm_add_notification(
  p_recipient_profile_id uuid,
  p_actor_profile_id uuid,
  p_connection_id bigint,
  p_meeting_id bigint,
  p_notification_type text,
  p_title text,
  p_body text,
  p_dedupe_key text,
  p_action_url text default '#matchmaking',
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  notification_id bigint;
begin
  insert into public.matchmaking_notifications (
    recipient_profile_id,
    actor_profile_id,
    connection_id,
    meeting_id,
    notification_type,
    title,
    body,
    action_url,
    payload,
    dedupe_key
  )
  values (
    p_recipient_profile_id,
    p_actor_profile_id,
    p_connection_id,
    p_meeting_id,
    p_notification_type,
    left(trim(p_title), 200),
    left(trim(p_body), 1000),
    p_action_url,
    coalesce(p_payload, '{}'::jsonb),
    left(p_dedupe_key, 240)
  )
  on conflict (recipient_profile_id, dedupe_key) do update
  set dedupe_key = excluded.dedupe_key
  returning id into notification_id;

  return notification_id;
end;
$function$;

create or replace function public.mm_validate_proposal_slots(
  p_slots jsonb,
  p_timezone text,
  p_require_future boolean default true
)
returns table (
  slot_number smallint,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  slot_record record;
  parsed_start timestamptz;
  parsed_end timestamptz;
  parsed_duration integer;
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Meeting proposals must be a JSON array'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_slots) not between 1 and 3 then
    raise exception 'Choose between one and three meeting times'
      using errcode = '22023';
  end if;
  if nullif(trim(p_timezone), '') is null
     or not exists (
       select 1 from pg_timezone_names
       where name = trim(p_timezone)
     ) then
    raise exception 'Use a valid IANA timezone'
      using errcode = '22023';
  end if;

  for slot_record in
    select value, ordinality
    from jsonb_array_elements(p_slots) with ordinality
  loop
    begin
      parsed_start := (slot_record.value ->> 'start_at')::timestamptz;
      parsed_end := (slot_record.value ->> 'end_at')::timestamptz;
    exception when others then
      raise exception 'Each meeting proposal needs valid ISO start_at and end_at values'
        using errcode = '22007';
    end;

    if parsed_end <= parsed_start then
      raise exception 'A meeting end time must be after its start time'
        using errcode = '22023';
    end if;
    parsed_duration :=
      round(extract(epoch from (parsed_end - parsed_start)) / 60.0)::integer;
    if parsed_duration not between 15 and 240 then
      raise exception 'Meeting duration must be between 15 and 240 minutes'
        using errcode = '22023';
    end if;
    if p_require_future and parsed_start < now() + interval '5 minutes' then
      raise exception 'Meeting proposals must start at least five minutes from now'
        using errcode = '22023';
    end if;

    slot_number := slot_record.ordinality::smallint;
    start_at := parsed_start;
    end_at := parsed_end;
    duration_minutes := parsed_duration;
    return next;
  end loop;
end;
$function$;

create or replace function public.mm_meeting_snapshot(p_meeting_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    to_jsonb(meeting) ||
    jsonb_build_object(
      'proposals',
      coalesce((
        select jsonb_agg(to_jsonb(proposal) order by proposal.proposal_round, proposal.slot_number)
        from public.matchmaking_meeting_proposals proposal
        where proposal.meeting_id = meeting.id
      ), '[]'::jsonb),
      'participants',
      coalesce((
        select jsonb_agg(
          to_jsonb(participant) ||
          jsonb_build_object(
            'profile',
            jsonb_build_object(
              'id', profile.id,
              'display_name', profile.display_name,
              'role', profile.role,
              'country', profile.country
            )
          )
          order by participant.participant_role, profile.display_name
        )
        from public.matchmaking_meeting_participants participant
        join public.matchmaking_profiles profile
          on profile.id = participant.profile_id
        where participant.meeting_id = meeting.id
      ), '[]'::jsonb)
    )
  from public.matchmaking_meeting_requests meeting
  where meeting.id = p_meeting_id;
$function$;

create or replace function public.get_matchmaking_workspace(
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  safe_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  matches_json jsonb := '[]'::jsonb;
  connections_json jsonb := '[]'::jsonb;
  meetings_json jsonb := '[]'::jsonb;
  notifications_json jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  select *
  into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid()
  limit 1;

  if current_profile.id is null then
    return jsonb_build_object(
      'profile', null,
      'matches', matches_json,
      'connections', connections_json,
      'meetings', meetings_json,
      'notifications', notifications_json,
      'unread_count', 0,
      'generated_at', now()
    );
  end if;

  select coalesce(jsonb_agg(item order by score desc, match_id desc), '[]'::jsonb)
  into matches_json
  from (
    select
      match_row.id as match_id,
      match_row.match_score as score,
      to_jsonb(match_row) ||
      jsonb_build_object(
        'target',
        jsonb_build_object(
          'id', target.id,
          'display_name', target.display_name,
          'role', target.role,
          'country', target.country,
          'website', target.website,
          'description', target.description,
          'company_size', target.company_size,
          'offered_products', target.offered_products,
          'interested_products', target.interested_products,
          'product_categories', target.product_categories,
          'target_countries', target.target_countries,
          'served_countries', target.served_countries,
          'sales_channels', target.sales_channels,
          'certifications', target.certifications,
          'partner_types_sought', target.partner_types_sought,
          'profile_completeness', target.profile_completeness
        ),
        'connection',
        (
          select jsonb_build_object(
            'id', connection.id,
            'status', connection.status,
            'state_version', connection.state_version,
            'requester_profile_id', connection.requester_profile_id,
            'recipient_profile_id', connection.recipient_profile_id
          )
          from public.business_connections connection
          where (
            connection.requester_profile_id = current_profile.id
            and connection.recipient_profile_id = target.id
          ) or (
            connection.recipient_profile_id = current_profile.id
            and connection.requester_profile_id = target.id
          )
          order by
            case connection.status when 'accepted' then 0 when 'pending' then 1 else 2 end,
            connection.updated_at desc
          limit 1
        )
      ) as item
    from public.matchmaking_matches match_row
    join public.matchmaking_profiles target
      on target.id = match_row.target_profile_id
    where match_row.source_profile_id = current_profile.id
      and target.is_active = true
    order by match_row.match_score desc, match_row.id desc
    limit safe_limit
  ) workspace_matches;

  select coalesce(jsonb_agg(item order by activity_at desc, connection_id desc), '[]'::jsonb)
  into connections_json
  from (
    select
      connection.id as connection_id,
      connection.last_activity_at as activity_at,
      to_jsonb(connection) ||
      jsonb_build_object(
        'other_profile',
        jsonb_build_object(
          'id', other_profile.id,
          'display_name', other_profile.display_name,
          'role', other_profile.role,
          'country', other_profile.country,
          'website', other_profile.website,
          'description', other_profile.description,
          'profile_completeness', other_profile.profile_completeness
        ),
        'unread_count',
        (
          select count(*)
          from public.matchmaking_notifications notification
          where notification.connection_id = connection.id
            and notification.recipient_profile_id = current_profile.id
            and notification.read_at is null
        )
      ) as item
    from public.business_connections connection
    join public.matchmaking_profiles other_profile
      on other_profile.id = case
        when connection.requester_profile_id = current_profile.id
          then connection.recipient_profile_id
        else connection.requester_profile_id
      end
    where current_profile.id in (
      connection.requester_profile_id,
      connection.recipient_profile_id
    )
    order by connection.last_activity_at desc, connection.id desc
    limit safe_limit
  ) workspace_connections;

  select coalesce(jsonb_agg(item order by activity_at desc, meeting_id desc), '[]'::jsonb)
  into meetings_json
  from (
    select
      meeting.id as meeting_id,
      meeting.last_activity_at as activity_at,
      public.mm_meeting_snapshot(meeting.id) ||
      jsonb_build_object(
        'other_profile',
        jsonb_build_object(
          'id', other_profile.id,
          'display_name', other_profile.display_name,
          'role', other_profile.role,
          'country', other_profile.country
        )
      ) as item
    from public.matchmaking_meeting_requests meeting
    join public.matchmaking_profiles other_profile
      on other_profile.id = case
        when meeting.requester_profile_id = current_profile.id
          then meeting.recipient_profile_id
        else meeting.requester_profile_id
      end
    where current_profile.id in (
      meeting.requester_profile_id,
      meeting.recipient_profile_id
    )
      and (
        meeting.status <> 'draft'
        or meeting.requester_profile_id = current_profile.id
      )
    order by meeting.last_activity_at desc, meeting.id desc
    limit safe_limit
  ) workspace_meetings;

  select coalesce(jsonb_agg(to_jsonb(notification) order by notification.created_at desc), '[]'::jsonb)
  into notifications_json
  from (
    select *
    from public.matchmaking_notifications
    where recipient_profile_id = current_profile.id
    order by created_at desc
    limit safe_limit
  ) notification;

  return jsonb_build_object(
    'profile', to_jsonb(current_profile),
    'matches', matches_json,
    'connections', connections_json,
    'meetings', meetings_json,
    'notifications', notifications_json,
    'unread_count', (
      select count(*)
      from public.matchmaking_notifications
      where recipient_profile_id = current_profile.id
        and read_at is null
    ),
    'generated_at', now()
  );
end;
$function$;

create or replace function public.get_matchmaking_relationship(
  p_connection_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  connection_row public.business_connections;
  other_profile public.matchmaking_profiles;
begin
  select *
  into connection_row
  from public.business_connections
  where id = p_connection_id
    and current_profile_id in (requester_profile_id, recipient_profile_id);

  if connection_row.id is null then
    raise exception 'Relationship not found or access denied'
      using errcode = '42501';
  end if;

  select *
  into other_profile
  from public.matchmaking_profiles
  where id = case
    when connection_row.requester_profile_id = current_profile_id
      then connection_row.recipient_profile_id
    else connection_row.requester_profile_id
  end;

  return jsonb_build_object(
    'connection', to_jsonb(connection_row),
    'other_profile', jsonb_build_object(
      'id', other_profile.id,
      'display_name', other_profile.display_name,
      'role', other_profile.role,
      'country', other_profile.country,
      'website', other_profile.website,
      'description', other_profile.description,
      'offered_products', other_profile.offered_products,
      'interested_products', other_profile.interested_products,
      'product_categories', other_profile.product_categories,
      'served_countries', other_profile.served_countries,
      'target_countries', other_profile.target_countries,
      'certifications', other_profile.certifications
    ),
    'messages', coalesce((
      select jsonb_agg(
        to_jsonb(message) ||
        jsonb_build_object(
          'sender_name', sender.display_name
        )
        order by message.created_at, message.id
      )
      from public.matchmaking_relationship_messages message
      left join public.matchmaking_profiles sender
        on sender.id = message.sender_profile_id
      where message.connection_id = connection_row.id
    ), '[]'::jsonb),
    'private_notes', coalesce((
      select jsonb_agg(to_jsonb(note) order by note.updated_at desc)
      from public.matchmaking_private_notes note
      where note.connection_id = connection_row.id
        and note.owner_profile_id = current_profile_id
    ), '[]'::jsonb),
    'meetings', coalesce((
      select jsonb_agg(
        public.mm_meeting_snapshot(meeting.id) ||
        jsonb_build_object(
          'events', coalesce((
            select jsonb_agg(
              to_jsonb(event) ||
              jsonb_build_object('actor_name', actor.display_name)
              order by event.created_at, event.id
            )
            from public.matchmaking_meeting_events event
            left join public.matchmaking_profiles actor
              on actor.id = event.actor_profile_id
            where event.meeting_id = meeting.id
          ), '[]'::jsonb),
          'outcomes', coalesce((
            select jsonb_agg(
              to_jsonb(outcome) ||
              jsonb_build_object('author_name', author.display_name)
              order by outcome.created_at
            )
            from public.matchmaking_meeting_outcomes outcome
            join public.matchmaking_profiles author
              on author.id = outcome.author_profile_id
            where outcome.meeting_id = meeting.id
          ), '[]'::jsonb),
          'my_reminders', coalesce((
            select jsonb_agg(to_jsonb(reminder) order by reminder.due_at)
            from public.matchmaking_meeting_reminders reminder
            where reminder.meeting_id = meeting.id
              and reminder.recipient_profile_id = current_profile_id
          ), '[]'::jsonb)
        )
        order by meeting.last_activity_at desc, meeting.id desc
      )
      from public.matchmaking_meeting_requests meeting
      where meeting.connection_id = connection_row.id
        and (
          meeting.status <> 'draft'
          or meeting.requester_profile_id = current_profile_id
        )
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.mark_matchmaking_meeting_viewed(
  p_meeting_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  meeting_row public.matchmaking_meeting_requests;
  proposal_author_id uuid;
  from_status text;
begin
  select *
  into meeting_row
  from public.matchmaking_meeting_requests
  where id = p_meeting_id
  for update;

  if meeting_row.id is null
     or current_profile_id not in (
       meeting_row.requester_profile_id,
       meeting_row.recipient_profile_id
     ) then
    raise exception 'Meeting not found or access denied'
      using errcode = '42501';
  end if;

  select proposed_by_profile_id
  into proposal_author_id
  from public.matchmaking_meeting_proposals
  where meeting_id = meeting_row.id
    and proposal_round = meeting_row.proposal_round
    and status = 'active'
  order by slot_number
  limit 1;

  if meeting_row.status in ('proposed', 'counter_proposed')
     and proposal_author_id is distinct from current_profile_id then
    from_status := meeting_row.status;
    update public.matchmaking_meeting_requests
    set
      status = 'awaiting_response',
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    perform public.mm_add_meeting_event(
      meeting_row.id,
      meeting_row.connection_id,
      current_profile_id,
      'proposal_viewed',
      from_status,
      'awaiting_response',
      jsonb_build_object('proposal_round', meeting_row.proposal_round)
    );
  end if;

  return public.mm_meeting_snapshot(meeting_row.id);
end;
$function$;

create or replace function public.respond_matchmaking_meeting(
  p_meeting_id bigint,
  p_action text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_proposal_id bigint default null,
  p_slots jsonb default null,
  p_timezone text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile public.matchmaking_profiles;
  other_profile public.matchmaking_profiles;
  meeting_row public.matchmaking_meeting_requests;
  selected_proposal public.matchmaking_meeting_proposals;
  current_proposer_id uuid;
  validated_slot record;
  idempotency record;
  result jsonb;
  from_status text;
  event_type text;
  system_body text;
  notification_title text;
  notification_body text;
  event_data jsonb := '{}'::jsonb;
  expected_duration integer;
  first_start timestamptz;
  first_end timestamptz;
  latest_end timestamptz;
  seen_starts timestamptz[] := '{}'::timestamptz[];
  new_round integer;
begin
  if p_action not in (
    'submit',
    'accept',
    'counter',
    'decline',
    'cancel',
    'complete',
    'no_show'
  ) then
    raise exception 'Unsupported meeting action'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'Response notes are limited to 1000 characters'
      using errcode = '22023';
  end if;

  select * into current_profile
  from public.matchmaking_profiles
  where user_id = auth.uid();

  if current_profile.id is null then
    raise exception 'Create your matchmaking profile first'
      using errcode = '42501';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile.id,
    'respond_meeting',
    p_idempotency_key,
    jsonb_build_object(
      'meeting_id', p_meeting_id,
      'action', p_action,
      'expected_version', p_expected_version,
      'proposal_id', p_proposal_id,
      'slots', p_slots,
      'timezone', p_timezone,
      'reason', nullif(trim(p_reason), '')
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into meeting_row
  from public.matchmaking_meeting_requests
  where id = p_meeting_id
  for update;

  if meeting_row.id is null
     or current_profile.id not in (
       meeting_row.requester_profile_id,
       meeting_row.recipient_profile_id
     ) then
    raise exception 'Meeting not found or access denied'
      using errcode = '42501';
  end if;
  if p_expected_version is null
     or meeting_row.state_version <> p_expected_version then
    raise exception 'This meeting changed. Refresh before responding.'
      using errcode = '40001';
  end if;

  select * into other_profile
  from public.matchmaking_profiles
  where id = case
    when meeting_row.requester_profile_id = current_profile.id
      then meeting_row.recipient_profile_id
    else meeting_row.requester_profile_id
  end;

  from_status := meeting_row.status;

  select proposed_by_profile_id
  into current_proposer_id
  from public.matchmaking_meeting_proposals
  where meeting_id = meeting_row.id
    and proposal_round = meeting_row.proposal_round
    and status = 'active'
  order by slot_number
  limit 1;

  if p_action = 'submit' then
    if meeting_row.status <> 'draft'
       or meeting_row.requester_profile_id <> current_profile.id then
      raise exception 'Only the meeting creator can submit this draft'
        using errcode = '42501';
    end if;
    if exists (
      select 1
      from public.matchmaking_meeting_proposals
      where meeting_id = meeting_row.id
        and proposal_round = meeting_row.proposal_round
        and status = 'active'
        and start_at < now() + interval '5 minutes'
    ) then
      raise exception 'Draft proposals must be moved to future times before submission'
        using errcode = '22023';
    end if;

    update public.matchmaking_meeting_requests
    set
      status = 'proposed',
      submitted_at = now(),
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    event_type := 'meeting_proposed';
    system_body := current_profile.display_name || ' proposed a meeting.';
    notification_title := 'New meeting proposal';
    notification_body := current_profile.display_name || ' proposed a meeting.';
    event_data := jsonb_build_object(
      'proposal_round', meeting_row.proposal_round,
      'submitted_from_draft', true
    );

  elsif p_action = 'accept' then
    if meeting_row.status not in (
      'proposed',
      'awaiting_response',
      'counter_proposed'
    ) then
      raise exception 'This meeting is not awaiting a proposal response'
        using errcode = '40001';
    end if;

    select *
    into selected_proposal
    from public.matchmaking_meeting_proposals
    where id = p_proposal_id
      and meeting_id = meeting_row.id
      and proposal_round = meeting_row.proposal_round
      and status = 'active'
    for update;

    if selected_proposal.id is null then
      raise exception 'The selected proposal is no longer available'
        using errcode = '40001';
    end if;
    if selected_proposal.proposed_by_profile_id = current_profile.id then
      raise exception 'The other participant must accept a proposed time'
        using errcode = '42501';
    end if;
    if selected_proposal.start_at <= now() then
      raise exception 'The selected proposal has expired'
        using errcode = '22023';
    end if;

    update public.matchmaking_meeting_proposals
    set status = case
      when id = selected_proposal.id then 'accepted'
      else 'superseded'
    end
    where meeting_id = meeting_row.id
      and proposal_round = meeting_row.proposal_round
      and status = 'active';

    update public.matchmaking_meeting_requests
    set
      status = 'accepted',
      accepted_proposal_id = selected_proposal.id,
      confirmed_start = selected_proposal.start_at,
      confirmed_end = selected_proposal.end_at,
      responded_at = now(),
      video_status = 'not_requested',
      video_error_code = null,
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    update public.matchmaking_meeting_participants
    set response_status = 'accepted', responded_at = now()
    where meeting_id = meeting_row.id;

    event_type := 'proposal_accepted';
    system_body := current_profile.display_name || ' accepted a meeting time.';
    notification_title := 'Meeting time accepted';
    notification_body := current_profile.display_name ||
      ' accepted a proposed meeting time. Secure video is being prepared.';
    event_data := jsonb_build_object(
      'proposal_id', selected_proposal.id,
      'start_at', selected_proposal.start_at,
      'end_at', selected_proposal.end_at,
      'proposal_round', selected_proposal.proposal_round
    );

  elsif p_action = 'counter' then
    if meeting_row.status not in (
      'proposed',
      'awaiting_response',
      'counter_proposed'
    ) then
      raise exception 'This meeting is not open for a counter-proposal'
        using errcode = '40001';
    end if;
    if current_proposer_id = current_profile.id then
      raise exception 'Wait for the other participant to respond to your proposal'
        using errcode = '42501';
    end if;

    for validated_slot in
      select *
      from public.mm_validate_proposal_slots(
        p_slots,
        trim(p_timezone),
        true
      )
    loop
      if expected_duration is null then
        expected_duration := validated_slot.duration_minutes;
        first_start := validated_slot.start_at;
        first_end := validated_slot.end_at;
      elsif expected_duration <> validated_slot.duration_minutes then
        raise exception 'All proposed times must use the same duration'
          using errcode = '22023';
      end if;
      if validated_slot.start_at = any(seen_starts) then
        raise exception 'Meeting proposals must use distinct start times'
          using errcode = '22023';
      end if;
      seen_starts := array_append(seen_starts, validated_slot.start_at);
      latest_end := greatest(coalesce(latest_end, validated_slot.end_at), validated_slot.end_at);
    end loop;

    update public.matchmaking_meeting_proposals
    set status = 'superseded'
    where meeting_id = meeting_row.id
      and proposal_round = meeting_row.proposal_round
      and status = 'active';

    new_round := meeting_row.proposal_round + 1;
    for validated_slot in
      select *
      from public.mm_validate_proposal_slots(
        p_slots,
        trim(p_timezone),
        true
      )
    loop
      insert into public.matchmaking_meeting_proposals (
        meeting_id,
        proposal_round,
        slot_number,
        proposed_by_profile_id,
        start_at,
        end_at,
        source_timezone,
        status
      )
      values (
        meeting_row.id,
        new_round,
        validated_slot.slot_number,
        current_profile.id,
        validated_slot.start_at,
        validated_slot.end_at,
        trim(p_timezone),
        'active'
      );
    end loop;

    update public.matchmaking_meeting_requests
    set
      status = 'counter_proposed',
      proposal_round = new_round,
      proposed_start = first_start,
      proposed_end = first_end,
      timezone = trim(p_timezone),
      creator_timezone = trim(p_timezone),
      duration_minutes = expected_duration,
      accepted_proposal_id = null,
      confirmed_start = null,
      confirmed_end = null,
      expires_at = latest_end + interval '7 days',
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    update public.matchmaking_meeting_participants
    set
      response_status = case
        when profile_id = current_profile.id then 'accepted'
        else 'needs_action'
      end,
      responded_at = case
        when profile_id = current_profile.id then now()
        else null
      end
    where meeting_id = meeting_row.id;

    event_type := 'meeting_counter_proposed';
    system_body := current_profile.display_name || ' suggested new meeting times.';
    notification_title := 'New meeting times proposed';
    notification_body := current_profile.display_name ||
      ' sent a counter-proposal with ' || jsonb_array_length(p_slots) ||
      ' time option(s).';
    event_data := jsonb_build_object(
      'proposal_round', new_round,
      'proposal_count', jsonb_array_length(p_slots),
      'timezone', trim(p_timezone)
    );

  elsif p_action = 'decline' then
    if meeting_row.status not in (
      'proposed',
      'awaiting_response',
      'counter_proposed'
    ) then
      raise exception 'This meeting is not awaiting a response'
        using errcode = '40001';
    end if;
    if current_proposer_id = current_profile.id then
      raise exception 'The other participant must respond to your proposal'
        using errcode = '42501';
    end if;

    update public.matchmaking_meeting_proposals
    set status = 'withdrawn'
    where meeting_id = meeting_row.id
      and proposal_round = meeting_row.proposal_round
      and status = 'active';

    update public.matchmaking_meeting_requests
    set
      status = 'declined',
      responded_at = now(),
      cancellation_reason = nullif(trim(p_reason), ''),
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    update public.matchmaking_meeting_participants
    set response_status = 'declined', responded_at = now()
    where meeting_id = meeting_row.id
      and profile_id = current_profile.id;

    event_type := 'meeting_declined';
    system_body := current_profile.display_name || ' declined the meeting proposal.';
    notification_title := 'Meeting proposal declined';
    notification_body := current_profile.display_name || ' declined the meeting proposal.';
    event_data := jsonb_strip_nulls(
      jsonb_build_object('reason', nullif(trim(p_reason), ''))
    );

  elsif p_action = 'cancel' then
    if meeting_row.status not in (
      'draft',
      'proposed',
      'awaiting_response',
      'counter_proposed',
      'accepted',
      'confirmed'
    ) then
      raise exception 'This meeting can no longer be cancelled'
        using errcode = '40001';
    end if;
    if meeting_row.status = 'draft'
       and meeting_row.requester_profile_id <> current_profile.id then
      raise exception 'Only the meeting creator can cancel this draft'
        using errcode = '42501';
    end if;

    update public.matchmaking_meeting_proposals
    set status = case when status = 'active' then 'withdrawn' else status end
    where meeting_id = meeting_row.id;

    update public.matchmaking_meeting_requests
    set
      status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_profile_id = current_profile.id,
      cancellation_reason = nullif(trim(p_reason), ''),
      video_status = case
        when video_status in ('ready', 'creating', 'failed') then 'revoked'
        else video_status
      end,
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    update public.matchmaking_meeting_reminders
    set status = 'cancelled'
    where meeting_id = meeting_row.id
      and status in ('scheduled', 'processing');

    event_type := 'meeting_cancelled';
    system_body := current_profile.display_name || ' cancelled the meeting.';
    notification_title := 'Meeting cancelled';
    notification_body := current_profile.display_name || ' cancelled the meeting.';
    event_data := jsonb_strip_nulls(
      jsonb_build_object('reason', nullif(trim(p_reason), ''))
    );

  elsif p_action in ('complete', 'no_show') then
    if meeting_row.status <> 'confirmed'
       or meeting_row.confirmed_start is null
       or now() < meeting_row.confirmed_start then
      raise exception 'The meeting cannot be closed before its confirmed start'
        using errcode = '40001';
    end if;

    update public.matchmaking_meeting_requests
    set
      status = case when p_action = 'complete' then 'completed' else 'no_show' end,
      completed_at = case when p_action = 'complete' then now() else completed_at end,
      no_show_at = case when p_action = 'no_show' then now() else no_show_at end,
      state_version = state_version + 1,
      last_activity_at = now(),
      updated_at = now()
    where id = meeting_row.id
    returning * into meeting_row;

    update public.matchmaking_meeting_reminders
    set status = 'cancelled'
    where meeting_id = meeting_row.id
      and reminder_type <> 'post_meeting_follow_up'
      and status in ('scheduled', 'processing');

    event_type := case when p_action = 'complete'
      then 'meeting_completed'
      else 'meeting_marked_no_show'
    end;
    system_body := current_profile.display_name ||
      case when p_action = 'complete'
        then ' marked the meeting complete.'
        else ' marked the meeting as a no-show.'
      end;
    notification_title := case when p_action = 'complete'
      then 'Meeting completed'
      else 'Meeting marked as no-show'
    end;
    notification_body := system_body;
    event_data := jsonb_strip_nulls(
      jsonb_build_object('note', nullif(trim(p_reason), ''))
    );
  end if;

  perform public.mm_add_meeting_event(
    meeting_row.id,
    meeting_row.connection_id,
    current_profile.id,
    event_type,
    from_status,
    meeting_row.status,
    event_data
  );
  perform public.mm_add_system_message(
    meeting_row.connection_id,
    system_body,
    jsonb_build_object(
      'event_type', event_type,
      'meeting_id', meeting_row.id
    )
  );
  perform public.mm_add_notification(
    other_profile.id,
    current_profile.id,
    meeting_row.connection_id,
    meeting_row.id,
    event_type,
    notification_title,
    notification_body,
    'meeting:' || meeting_row.id || ':' || event_type ||
      ':v' || meeting_row.state_version,
    '#matchmaking-meeting=' || meeting_row.id
  );

  update public.business_connections
  set last_activity_at = now(), updated_at = now()
  where id = meeting_row.connection_id;

  result := public.mm_meeting_snapshot(meeting_row.id);
  perform public.mm_complete_idempotent_operation(
    current_profile.id,
    'respond_meeting',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

create or replace function public.update_matchmaking_meeting_draft(
  p_meeting_id bigint,
  p_expected_version integer,
  p_title text,
  p_agenda text,
  p_timezone text,
  p_language text,
  p_slots jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_profile_id uuid := public.mm_current_profile_id();
  meeting_row public.matchmaking_meeting_requests;
  validated_slot record;
  idempotency record;
  result jsonb;
  first_start timestamptz;
  first_end timestamptz;
  latest_end timestamptz;
  expected_duration integer;
  seen_starts timestamptz[] := '{}'::timestamptz[];
  new_round integer;
begin
  if nullif(trim(p_title), '') is null
     or char_length(trim(p_title)) > 160
     or char_length(coalesce(p_agenda, '')) > 4000
     or char_length(coalesce(p_language, '')) > 40 then
    raise exception 'Draft meeting fields are invalid'
      using errcode = '22023';
  end if;

  select *
  into idempotency
  from public.mm_begin_idempotent_operation(
    current_profile_id,
    'update_meeting_draft',
    p_idempotency_key,
    jsonb_build_object(
      'meeting_id', p_meeting_id,
      'expected_version', p_expected_version,
      'title', trim(p_title),
      'agenda', nullif(trim(p_agenda), ''),
      'timezone', trim(p_timezone),
      'language', nullif(trim(p_language), ''),
      'slots', p_slots
    )
  );
  if idempotency.is_replay then
    return idempotency.replay_response;
  end if;

  select *
  into meeting_row
  from public.matchmaking_meeting_requests
  where id = p_meeting_id
  for update;

  if meeting_row.id is null
     or meeting_row.status <> 'draft'
     or meeting_row.requester_profile_id <> current_profile_id then
    raise exception 'Meeting draft not found or access denied'
      using errcode = '42501';
  end if;
  if meeting_row.state_version <> p_expected_version then
    raise exception 'This draft changed. Refresh before editing.'
      using errcode = '40001';
  end if;

  for validated_slot in
    select *
    from public.mm_validate_proposal_slots(p_slots, trim(p_timezone), false)
  loop
    if expected_duration is null then
      expected_duration := validated_slot.duration_minutes;
      first_start := validated_slot.start_at;
      first_end := validated_slot.end_at;
    elsif expected_duration <> validated_slot.duration_minutes then
      raise exception 'All proposed times must use the same duration'
        using errcode = '22023';
    end if;
    if validated_slot.start_at = any(seen_starts) then
      raise exception 'Meeting proposals must use distinct start times'
        using errcode = '22023';
    end if;
    seen_starts := array_append(seen_starts, validated_slot.start_at);
    latest_end := greatest(coalesce(latest_end, validated_slot.end_at), validated_slot.end_at);
  end loop;

  update public.matchmaking_meeting_proposals
  set status = 'superseded'
  where meeting_id = meeting_row.id
    and proposal_round = meeting_row.proposal_round
    and status = 'active';

  new_round := meeting_row.proposal_round + 1;
  for validated_slot in
    select *
    from public.mm_validate_proposal_slots(p_slots, trim(p_timezone), false)
  loop
    insert into public.matchmaking_meeting_proposals (
      meeting_id,
      proposal_round,
      slot_number,
      proposed_by_profile_id,
      start_at,
      end_at,
      source_timezone,
      status
    )
    values (
      meeting_row.id,
      new_round,
      validated_slot.slot_number,
      current_profile_id,
      validated_slot.start_at,
      validated_slot.end_at,
      trim(p_timezone),
      'active'
    );
  end loop;

  update public.matchmaking_meeting_requests
  set
    title = trim(p_title),
    agenda = nullif(trim(p_agenda), ''),
    language = nullif(trim(p_language), ''),
    timezone = trim(p_timezone),
    creator_timezone = trim(p_timezone),
    duration_minutes = expected_duration,
    proposed_start = first_start,
    proposed_end = first_end,
    proposal_round = new_round,
    expires_at = latest_end + interval '7 days',
    state_version = state_version + 1,
    last_activity_at = now(),
    updated_at = now()
  where id = meeting_row.id
  returning * into meeting_row;

  perform public.mm_add_meeting_event(
    meeting_row.id,
    meeting_row.connection_id,
    current_profile_id,
    'draft_updated',
    'draft',
    'draft',
    jsonb_build_object(
      'proposal_round', new_round,
      'proposal_count', jsonb_array_length(p_slots)
    )
  );

  result := public.mm_meeting_snapshot(meeting_row.id);
  perform public.mm_complete_idempotent_operation(
    current_profile_id,
    'update_meeting_draft',
    p_idempotency_key,
    result
  );
  return result;
end;
$function$;

revoke all on function public.mm_begin_idempotent_operation(
  uuid, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.mm_complete_idempotent_operation(
  uuid, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.mm_add_meeting_event(
  bigint, bigint, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.mm_add_system_message(
  bigint, text, jsonb
) from public, anon, authenticated;
revoke all on function public.mm_add_notification(
  uuid, uuid, bigint, bigint, text, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.mm_validate_proposal_slots(
  jsonb, text, boolean
) from public, anon, authenticated;
revoke all on function public.mm_meeting_snapshot(bigint)
  from public, anon, authenticated;

revoke all on function public.get_matchmaking_workspace(integer)
  from public, anon;
grant execute on function public.get_matchmaking_workspace(integer)
  to authenticated, service_role;

revoke all on function public.get_matchmaking_relationship(bigint)
  from public, anon;
grant execute on function public.get_matchmaking_relationship(bigint)
  to authenticated, service_role;

revoke all on function public.set_matchmaking_match_status(
  bigint, text, uuid
) from public, anon;
grant execute on function public.set_matchmaking_match_status(
  bigint, text, uuid
) to authenticated, service_role;

revoke all on function public.request_business_connection_v2(
  uuid, text, uuid
) from public, anon;
grant execute on function public.request_business_connection_v2(
  uuid, text, uuid
) to authenticated, service_role;

revoke all on function public.respond_business_connection_v2(
  bigint, text, integer, uuid
) from public, anon;
grant execute on function public.respond_business_connection_v2(
  bigint, text, integer, uuid
) to authenticated, service_role;

revoke all on function public.propose_matchmaking_meeting(
  bigint, text, text, text, text, jsonb, boolean, uuid
) from public, anon;
grant execute on function public.propose_matchmaking_meeting(
  bigint, text, text, text, text, jsonb, boolean, uuid
) to authenticated, service_role;

revoke all on function public.update_matchmaking_meeting_draft(
  bigint, integer, text, text, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.update_matchmaking_meeting_draft(
  bigint, integer, text, text, text, text, jsonb, uuid
) to authenticated, service_role;

revoke all on function public.mark_matchmaking_meeting_viewed(bigint)
  from public, anon;
grant execute on function public.mark_matchmaking_meeting_viewed(bigint)
  to authenticated, service_role;

revoke all on function public.respond_matchmaking_meeting(
  bigint, text, integer, uuid, bigint, jsonb, text, text
) from public, anon;
grant execute on function public.respond_matchmaking_meeting(
  bigint, text, integer, uuid, bigint, jsonb, text, text
) to authenticated, service_role;

revoke all on function public.send_matchmaking_relationship_message(
  bigint, text, uuid
) from public, anon;
grant execute on function public.send_matchmaking_relationship_message(
  bigint, text, uuid
) to authenticated, service_role;

revoke all on function public.upsert_matchmaking_private_note(
  bigint, bigint, text, uuid
) from public, anon;
grant execute on function public.upsert_matchmaking_private_note(
  bigint, bigint, text, uuid
) to authenticated, service_role;

revoke all on function public.submit_matchmaking_meeting_outcome(
  bigint, text, text, text, timestamptz, uuid
) from public, anon;
grant execute on function public.submit_matchmaking_meeting_outcome(
  bigint, text, text, text, timestamptz, uuid
) to authenticated, service_role;

revoke all on function public.mark_matchmaking_notifications_read(bigint[])
  from public, anon;
grant execute on function public.mark_matchmaking_notifications_read(bigint[])
  to authenticated, service_role;

revoke all on function public.request_business_connection(uuid, text)
  from public, anon;
grant execute on function public.request_business_connection(uuid, text)
  to authenticated, service_role;

revoke all on function public.respond_business_connection(bigint, text)
  from public, anon;
grant execute on function public.respond_business_connection(bigint, text)
  to authenticated, service_role;

revoke all on function public.request_matchmaking_meeting(
  uuid, timestamptz, timestamptz, text, text
) from public, anon;
grant execute on function public.request_matchmaking_meeting(
  uuid, timestamptz, timestamptz, text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Run after 202607280002 through 202607280007.
-- Exercises tenant isolation, lifecycle concurrency, idempotency and audit
-- immutability. Every fixture is rolled back.

begin;

do $structure$
declare
  required_relation text;
  required_rpc text;
begin
  foreach required_relation in array array[
    'public.matchmaking_meeting_proposals',
    'public.matchmaking_meeting_participants',
    'public.matchmaking_meeting_events',
    'public.matchmaking_notifications',
    'public.matchmaking_relationship_messages',
    'public.matchmaking_private_notes',
    'public.matchmaking_meeting_outcomes',
    'public.matchmaking_meeting_reminders',
    'public.matchmaking_idempotency_keys',
    'public.matchmaking_video_access_log'
  ]
  loop
    if to_regclass(required_relation) is null then
      raise exception 'Required workspace relation is missing: %',
        required_relation;
    end if;
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = split_part(required_relation, '.', 1)
        and relation.relname = split_part(required_relation, '.', 2)
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is disabled on %', required_relation;
    end if;
  end loop;

  foreach required_rpc in array array[
    'public.get_matchmaking_workspace(integer)',
    'public.get_matchmaking_relationship(bigint)',
    'public.set_matchmaking_match_status(bigint,text,uuid)',
    'public.request_business_connection_v2(uuid,text,uuid)',
    'public.respond_business_connection_v2(bigint,text,integer,uuid)',
    'public.propose_matchmaking_meeting(bigint,text,text,text,text,jsonb,boolean,uuid)',
    'public.update_matchmaking_meeting_draft(bigint,integer,text,text,text,text,jsonb,uuid)',
    'public.respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)',
    'public.send_matchmaking_relationship_message(bigint,text,uuid)',
    'public.upsert_matchmaking_private_note(bigint,bigint,text,uuid)',
    'public.submit_matchmaking_meeting_outcome(bigint,text,text,text,timestamptz,uuid)',
    'public.authorize_matchmaking_video_action(bigint,text)',
    'public.get_portal_notification_center(integer)',
    'public.mark_portal_notifications_read(bigint[])',
    'public.revise_matchmaking_meeting_proposal(bigint,integer,text,text,text,text,jsonb,uuid)',
    'public.reschedule_matchmaking_meeting(bigint,integer,text,text,text,text,jsonb,uuid)'
  ]
  loop
    if to_regprocedure(required_rpc) is null then
      raise exception 'Required workspace RPC is missing: %', required_rpc;
    end if;
    if has_function_privilege('anon', required_rpc, 'execute') then
      raise exception 'Anonymous role can execute %', required_rpc;
    end if;
    if not has_function_privilege('authenticated', required_rpc, 'execute') then
      raise exception 'Authenticated role cannot execute %', required_rpc;
    end if;
  end loop;

  foreach required_rpc in array array[
    'public.mm_begin_idempotent_operation(uuid,text,uuid,jsonb)',
    'public.mm_complete_idempotent_operation(uuid,text,uuid,jsonb)',
    'public.mm_add_meeting_event(bigint,bigint,uuid,text,text,text,jsonb)',
    'public.mm_add_system_message(bigint,text,jsonb)',
    'public.mm_add_notification(uuid,uuid,bigint,bigint,text,text,text,text,text,jsonb)',
    'public.mm_validate_proposal_slots(jsonb,text,boolean)',
    'public.mm_meeting_snapshot(bigint)',
    'public.mm_has_service_role()',
    'public.portal_add_notification(uuid,uuid,text,bigint,text,text,text,text,text,text,boolean,jsonb)'
  ]
  loop
    if has_function_privilege('anon', required_rpc, 'execute')
       or has_function_privilege('authenticated', required_rpc, 'execute') then
      raise exception 'Internal helper is exposed to an API role: %',
        required_rpc;
    end if;
  end loop;

  if has_function_privilege(
    'authenticated',
    'public.claim_matchmaking_video_room(bigint)',
    'execute'
  ) then
    raise exception 'Authenticated role can claim provider rooms directly';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.complete_matchmaking_video_room(bigint,text,text,text,text,timestamptz)',
    'execute'
  ) then
    raise exception 'Authenticated role can finalize provider rooms directly';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.claim_matchmaking_video_room(bigint)',
    'execute'
  ) then
    raise exception 'Service role cannot claim provider rooms';
  end if;
end
$structure$;

create temporary table matchmaking_workspace_test_tenants (
  ordinal integer primary key,
  user_id uuid not null,
  profile_id uuid
) on commit drop;

insert into matchmaking_workspace_test_tenants (ordinal, user_id)
values
  (1, gen_random_uuid()),
  (2, gen_random_uuid()),
  (3, gen_random_uuid());

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
select
  user_id,
  'authenticated',
  'authenticated',
  'matchmaking-workspace-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  false
from matchmaking_workspace_test_tenants;

with inserted as (
  insert into public.matchmaking_profiles (
    user_id,
    role,
    display_name,
    country,
    description,
    offered_products,
    interested_products,
    product_categories,
    target_countries,
    served_countries,
    partner_types_sought,
    certifications,
    required_certifications,
    profile_completeness,
    is_active
  )
  select
    user_id,
    case ordinal
      when 1 then 'manufacturer'
      when 2 then 'distributor'
      else 'buyer'
    end,
    'Workspace tenant ' || ordinal,
    case ordinal when 1 then 'Türkiye' when 2 then 'Germany' else 'France' end,
    'Isolated matchmaking workspace test tenant',
    case when ordinal = 1 then array['surgical drapes'] else '{}'::text[] end,
    case when ordinal <> 1 then array['surgical drapes'] else '{}'::text[] end,
    array['medical disposables'],
    array['Germany', 'France'],
    array['Türkiye', 'Germany'],
    case when ordinal = 1
      then array['distributor', 'buyer']
      else array['manufacturer']
    end,
    array['ISO 13485'],
    array['ISO 13485'],
    90,
    true
  from matchmaking_workspace_test_tenants
  order by ordinal
  returning id, user_id
)
update matchmaking_workspace_test_tenants fixture
set profile_id = inserted.id
from inserted
where inserted.user_id = fixture.user_id;

insert into public.matchmaking_matches (
  source_profile_id,
  target_profile_id,
  match_score,
  confidence_level,
  product_score,
  geography_score,
  partner_type_score,
  certification_score,
  commercial_score,
  reasons,
  risks
)
select
  source.profile_id,
  target.profile_id,
  88,
  'high',
  95,
  80,
  90,
  100,
  70,
  '{"products":"Portfolio aligns"}'::jsonb,
  '{}'::jsonb
from matchmaking_workspace_test_tenants source
join matchmaking_workspace_test_tenants target
  on source.ordinal = 1 and target.ordinal in (2, 3);

select set_config(
  'medichall.mm_user_one',
  (select user_id::text from matchmaking_workspace_test_tenants where ordinal = 1),
  true
);
select set_config(
  'medichall.mm_user_two',
  (select user_id::text from matchmaking_workspace_test_tenants where ordinal = 2),
  true
);
select set_config(
  'medichall.mm_user_three',
  (select user_id::text from matchmaking_workspace_test_tenants where ordinal = 3),
  true
);
select set_config(
  'medichall.mm_profile_one',
  (select profile_id::text from matchmaking_workspace_test_tenants where ordinal = 1),
  true
);
select set_config(
  'medichall.mm_profile_two',
  (select profile_id::text from matchmaking_workspace_test_tenants where ordinal = 2),
  true
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_one', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $workspace_read$
declare
  workspace jsonb;
begin
  workspace := public.get_matchmaking_workspace(100);
  if workspace #>> '{profile,id}' <>
     current_setting('medichall.mm_profile_one', true) then
    raise exception 'Workspace returned the wrong tenant profile';
  end if;
  if jsonb_array_length(workspace -> 'matches') <> 2 then
    raise exception 'Workspace did not return only the source tenant matches';
  end if;
  if (workspace #>> '{matches,0,explanation,version}')::integer <> 2
     or (workspace #>> '{matches,0,explanation,method,unknown_is_not_positive_evidence}')::boolean is not true then
    raise exception 'Current transparent match explanation was not generated';
  end if;
end
$workspace_read$;

do $request_connection$
declare
  response jsonb;
begin
  response := public.request_business_connection_v2(
    current_setting('medichall.mm_profile_two', true)::uuid,
    'We would like to discuss distribution.',
    '10000000-0000-4000-8000-000000000001'::uuid
  );
  perform set_config(
    'medichall.mm_connection',
    response ->> 'connection_id',
    true
  );
  if response ->> 'status' <> 'pending' then
    raise exception 'Connection request did not enter pending state';
  end if;
end
$request_connection$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_three', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $third_tenant_connection_isolation$
declare
  visible_count integer;
begin
  select count(*)
  into visible_count
  from public.business_connections
  where id = current_setting('medichall.mm_connection', true)::bigint;
  if visible_count <> 0 then
    raise exception 'Third tenant can read a foreign relationship';
  end if;

  begin
    perform public.get_matchmaking_relationship(
      current_setting('medichall.mm_connection', true)::bigint
    );
    raise exception 'Third tenant opened a foreign relationship';
  exception when insufficient_privilege then null;
  end;
end
$third_tenant_connection_isolation$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_two', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $accept_connection$
declare
  response jsonb;
begin
  response := public.respond_business_connection_v2(
    current_setting('medichall.mm_connection', true)::bigint,
    'accepted',
    1,
    '20000000-0000-4000-8000-000000000001'::uuid
  );
  if response ->> 'status' <> 'accepted'
     or (response ->> 'state_version')::integer <> 2 then
    raise exception 'Connection acceptance did not advance atomically';
  end if;
end
$accept_connection$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_one', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $propose_meeting$
declare
  response jsonb;
begin
  response := public.propose_matchmaking_meeting(
    current_setting('medichall.mm_connection', true)::bigint,
    'Portfolio review',
    'Review product fit and agree next steps.',
    'Europe/Istanbul',
    'English',
    jsonb_build_array(
      jsonb_build_object(
        'start_at', now() + interval '2 days',
        'end_at', now() + interval '2 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '3 days',
        'end_at', now() + interval '3 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '4 days',
        'end_at', now() + interval '4 days 30 minutes'
      )
    ),
    false,
    '30000000-0000-4000-8000-000000000001'::uuid
  );
  perform set_config('medichall.mm_meeting', response ->> 'id', true);
  if response ->> 'status' <> 'proposed'
     or jsonb_array_length(response -> 'proposals') <> 3 then
    raise exception 'Meeting did not preserve three proposals';
  end if;
end
$propose_meeting$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_two', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $notification_read_is_not_resolution$
declare
  center jsonb;
  notification_id bigint;
  after_mark jsonb;
  notification_state record;
begin
  center := public.get_portal_notification_center(100);
  select (item ->> 'id')::bigint
  into notification_id
  from jsonb_array_elements(center -> 'notifications') item
  where (item ->> 'meeting_id')::bigint =
    current_setting('medichall.mm_meeting', true)::bigint
    and (item ->> 'action_required')::boolean
  limit 1;

  if notification_id is null
     or (center ->> 'action_required_count')::integer < 1 then
    raise exception 'Recipient did not receive an actionable meeting notification';
  end if;

  after_mark := public.mark_portal_notifications_read(
    array[notification_id]::bigint[]
  );
  select read_at, resolved_at
  into notification_state
  from public.matchmaking_notifications
  where id = notification_id;

  if notification_state.read_at is null
     or notification_state.resolved_at is not null then
    raise exception 'Reading a notification incorrectly resolved its action';
  end if;
end
$notification_read_is_not_resolution$;

do $view_and_counter$
declare
  viewed jsonb;
  countered jsonb;
begin
  viewed := public.mark_matchmaking_meeting_viewed(
    current_setting('medichall.mm_meeting', true)::bigint
  );
  if viewed ->> 'status' <> 'awaiting_response'
     or (viewed ->> 'state_version')::integer <> 2 then
    raise exception 'Viewing did not produce an explicit awaiting-response state';
  end if;

  countered := public.respond_matchmaking_meeting(
    current_setting('medichall.mm_meeting', true)::bigint,
    'counter',
    2,
    '40000000-0000-4000-8000-000000000001'::uuid,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'start_at', now() + interval '5 days',
        'end_at', now() + interval '5 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '6 days',
        'end_at', now() + interval '6 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '7 days',
        'end_at', now() + interval '7 days 30 minutes'
      )
    ),
    'Europe/Berlin',
    null
  );
  if countered ->> 'status' <> 'counter_proposed'
     or (countered ->> 'proposal_round')::integer <> 2
     or jsonb_array_length(countered -> 'proposals') <> 6 then
    raise exception 'Counter-proposal did not preserve immutable history';
  end if;
end
$view_and_counter$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_one', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $accept_concurrently_safe$
declare
  selected_id bigint;
  accepted jsonb;
  replayed jsonb;
begin
  select proposal.id
  into selected_id
  from public.matchmaking_meeting_proposals proposal
  where proposal.meeting_id =
      current_setting('medichall.mm_meeting', true)::bigint
    and proposal.proposal_round = 2
    and proposal.status = 'active'
  order by proposal.slot_number
  limit 1;

  accepted := public.respond_matchmaking_meeting(
    current_setting('medichall.mm_meeting', true)::bigint,
    'accept',
    3,
    '50000000-0000-4000-8000-000000000001'::uuid,
    selected_id,
    null,
    null,
    null
  );
  if accepted ->> 'status' <> 'accepted'
     or accepted ->> 'accepted_proposal_id' <> selected_id::text then
    raise exception 'Proposal acceptance was not atomic';
  end if;

  replayed := public.respond_matchmaking_meeting(
    current_setting('medichall.mm_meeting', true)::bigint,
    'accept',
    3,
    '50000000-0000-4000-8000-000000000001'::uuid,
    selected_id,
    null,
    null,
    null
  );
  if replayed is distinct from accepted then
    raise exception 'Idempotent acceptance did not replay its first result';
  end if;

  begin
    perform public.respond_matchmaking_meeting(
      current_setting('medichall.mm_meeting', true)::bigint,
      'accept',
      3,
      '50000000-0000-4000-8000-000000000002'::uuid,
      selected_id,
      null,
      null,
      null
    );
    raise exception 'A stale second acceptance succeeded';
  exception when serialization_failure then null;
  end;
end
$accept_concurrently_safe$;

do $private_note_owner_one$
begin
  perform public.upsert_matchmaking_private_note(
    current_setting('medichall.mm_connection', true)::bigint,
    current_setting('medichall.mm_meeting', true)::bigint,
    'Private commercial qualification for tenant one.',
    '60000000-0000-4000-8000-000000000001'::uuid
  );
end
$private_note_owner_one$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_two', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $private_note_isolation$
declare
  visible_count integer;
  relationship jsonb;
begin
  select count(*)
  into visible_count
  from public.matchmaking_private_notes
  where meeting_id = current_setting('medichall.mm_meeting', true)::bigint;
  if visible_count <> 0 then
    raise exception 'Other participant can read a private note';
  end if;

  relationship := public.get_matchmaking_relationship(
    current_setting('medichall.mm_connection', true)::bigint
  );
  if jsonb_array_length(relationship -> 'private_notes') <> 0 then
    raise exception 'Relationship RPC leaked another tenant private note';
  end if;
end
$private_note_isolation$;

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

do $video_configuration_gate$
declare
  claim jsonb;
  confirmed jsonb;
begin
  claim := public.claim_matchmaking_video_room(
    current_setting('medichall.mm_meeting', true)::bigint
  );
  if claim ->> 'claim_granted' <> 'true'
     or claim ->> 'video_status' <> 'creating' then
    raise exception 'Service role could not claim accepted meeting video';
  end if;

  confirmed := public.complete_matchmaking_video_room(
    current_setting('medichall.mm_meeting', true)::bigint,
    'disabled',
    'unconfigured',
    claim ->> 'room_name',
    null,
    (claim ->> 'room_expires_at')::timestamptz
  );
  if confirmed ->> 'status' <> 'confirmed'
     or confirmed ->> 'video_status' <> 'unconfigured' then
    raise exception 'Configuration-disabled meeting was not truthfully confirmed';
  end if;
end
$video_configuration_gate$;

reset role;

update public.matchmaking_meeting_requests
set
  confirmed_start = now() - interval '1 hour',
  confirmed_end = now() - interval '30 minutes'
where id = current_setting('medichall.mm_meeting', true)::bigint;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_one', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $complete_and_follow_up$
declare
  current_version integer;
  completed jsonb;
  outcome jsonb;
  video_context jsonb;
  outcome_count integer;
begin
  select state_version
  into current_version
  from public.matchmaking_meeting_requests
  where id = current_setting('medichall.mm_meeting', true)::bigint;

  completed := public.respond_matchmaking_meeting(
    current_setting('medichall.mm_meeting', true)::bigint,
    'complete',
    current_version,
    '70000000-0000-4000-8000-000000000001'::uuid,
    null,
    null,
    null,
    'Productive meeting'
  );
  if completed ->> 'status' <> 'completed' then
    raise exception 'Confirmed meeting did not complete';
  end if;

  outcome := public.submit_matchmaking_meeting_outcome(
    current_setting('medichall.mm_meeting', true)::bigint,
    'positive',
    'Both parties agreed to exchange samples.',
    'Send technical dossier.',
    now() + interval '2 days',
    '70000000-0000-4000-8000-000000000002'::uuid
  );
  if outcome ->> 'outcome_status' <> 'positive' then
    raise exception 'Post-meeting outcome was not persisted';
  end if;

  select count(*)
  into outcome_count
  from public.matchmaking_meeting_outcomes
  where meeting_id = current_setting('medichall.mm_meeting', true)::bigint
    and author_profile_id =
      current_setting('medichall.mm_profile_one', true)::uuid;
  if outcome_count <> 1 then
    raise exception 'Post-meeting outcome was duplicated';
  end if;

  video_context := public.get_matchmaking_video_context(
    current_setting('medichall.mm_meeting', true)::bigint
  );
  if (video_context ->> 'can_join')::boolean then
    raise exception 'Completed meeting remained joinable';
  end if;

  begin
    perform public.respond_matchmaking_meeting(
      current_setting('medichall.mm_meeting', true)::bigint,
      'cancel',
      (completed ->> 'state_version')::integer,
      '70000000-0000-4000-8000-000000000003'::uuid,
      null,
      null,
      null,
      null
    );
    raise exception 'Completed meeting was cancelled';
  exception when serialization_failure then null;
  end;
end
$complete_and_follow_up$;

do $create_cancellation_fixture$
declare
  response jsonb;
begin
  response := public.propose_matchmaking_meeting(
    current_setting('medichall.mm_connection', true)::bigint,
    'Cancellation fixture',
    null,
    'Europe/Istanbul',
    'English',
    jsonb_build_array(
      jsonb_build_object(
        'start_at', now() + interval '8 days',
        'end_at', now() + interval '8 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '8 days 1 hour',
        'end_at', now() + interval '8 days 1 hour 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '8 days 2 hours',
        'end_at', now() + interval '8 days 2 hours 30 minutes'
      )
    ),
    false,
    '71000000-0000-4000-8000-000000000001'::uuid
  );
  perform set_config('medichall.mm_cancel_meeting', response ->> 'id', true);
end
$create_cancellation_fixture$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_two', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $cancel_and_block_join$
declare
  cancelled jsonb;
  video_context jsonb;
begin
  cancelled := public.respond_matchmaking_meeting(
    current_setting('medichall.mm_cancel_meeting', true)::bigint,
    'cancel',
    1,
    '71000000-0000-4000-8000-000000000002'::uuid,
    null,
    null,
    null,
    'Scheduling changed'
  );
  if cancelled ->> 'status' <> 'cancelled' then
    raise exception 'Open meeting was not cancelled';
  end if;

  video_context := public.get_matchmaking_video_context(
    current_setting('medichall.mm_cancel_meeting', true)::bigint
  );
  if (video_context ->> 'can_join')::boolean then
    raise exception 'Cancelled meeting remained joinable';
  end if;

  begin
    perform public.respond_matchmaking_meeting(
      current_setting('medichall.mm_cancel_meeting', true)::bigint,
      'counter',
      (cancelled ->> 'state_version')::integer,
      '71000000-0000-4000-8000-000000000003'::uuid,
      null,
      jsonb_build_array(
        jsonb_build_object(
          'start_at', now() + interval '9 days',
          'end_at', now() + interval '9 days 30 minutes'
        ),
        jsonb_build_object(
          'start_at', now() + interval '9 days 1 hour',
          'end_at', now() + interval '9 days 1 hour 30 minutes'
        ),
        jsonb_build_object(
          'start_at', now() + interval '9 days 2 hours',
          'end_at', now() + interval '9 days 2 hours 30 minutes'
        )
      ),
      'Europe/Berlin',
      null
    );
    raise exception 'Cancelled meeting accepted a counter-proposal';
  exception when serialization_failure then null;
  end;
end
$cancel_and_block_join$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_one', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $create_expiration_fixture$
declare
  response jsonb;
begin
  response := public.propose_matchmaking_meeting(
    current_setting('medichall.mm_connection', true)::bigint,
    'Expiration fixture',
    null,
    'Europe/Istanbul',
    'English',
    jsonb_build_array(
      jsonb_build_object(
        'start_at', now() + interval '10 days',
        'end_at', now() + interval '10 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '10 days 1 hour',
        'end_at', now() + interval '10 days 1 hour 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '10 days 2 hours',
        'end_at', now() + interval '10 days 2 hours 30 minutes'
      )
    ),
    false,
    '72000000-0000-4000-8000-000000000001'::uuid
  );
  perform set_config('medichall.mm_expire_meeting', response ->> 'id', true);
end
$create_expiration_fixture$;

reset role;
update public.matchmaking_meeting_requests
set expires_at = now() - interval '1 minute'
where id = current_setting('medichall.mm_expire_meeting', true)::bigint;

select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

do $expire_and_dedupe$
declare
  automation_result jsonb;
  expired_status text;
  duplicate_notifications integer;
begin
  automation_result := public.process_matchmaking_automation(200);
  select status
  into expired_status
  from public.matchmaking_meeting_requests
  where id = current_setting('medichall.mm_expire_meeting', true)::bigint;
  if expired_status <> 'expired'
     or (automation_result ->> 'expired_meetings')::integer < 1 then
    raise exception 'Automation did not expire an overdue meeting';
  end if;

  perform public.process_matchmaking_automation(200);
  select count(*)
  into duplicate_notifications
  from (
    select recipient_profile_id, dedupe_key
    from public.matchmaking_notifications
    where meeting_id in (
      current_setting('medichall.mm_meeting', true)::bigint,
      current_setting('medichall.mm_cancel_meeting', true)::bigint,
      current_setting('medichall.mm_expire_meeting', true)::bigint
    )
    group by recipient_profile_id, dedupe_key
    having count(*) > 1
  ) duplicates;
  if duplicate_notifications <> 0 then
    raise exception 'Meeting notifications were duplicated';
  end if;
end
$expire_and_dedupe$;

reset role;

do $immutable_audit$
declare
  event_id bigint;
begin
  select min(id)
  into event_id
  from public.matchmaking_meeting_events
  where meeting_id = current_setting('medichall.mm_meeting', true)::bigint;

  begin
    update public.matchmaking_meeting_events
    set event_type = 'tampered'
    where id = event_id;
    raise exception 'Immutable meeting event was updated';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from public.matchmaking_meeting_events
    where id = event_id;
    raise exception 'Immutable meeting event was deleted';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$immutable_audit$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_one', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $create_reschedule_fixture$
declare
  response jsonb;
begin
  response := public.propose_matchmaking_meeting(
    current_setting('medichall.mm_connection', true)::bigint,
    'Reschedule fixture',
    'Verify atomic cancellation and replacement.',
    'Europe/Istanbul',
    'English',
    jsonb_build_array(
      jsonb_build_object(
        'start_at', now() + interval '20 days',
        'end_at', now() + interval '20 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '21 days',
        'end_at', now() + interval '21 days 30 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '22 days',
        'end_at', now() + interval '22 days 30 minutes'
      )
    ),
    false,
    '73000000-0000-4000-8000-000000000001'::uuid
  );
  perform set_config(
    'medichall.mm_reschedule_meeting',
    response ->> 'id',
    true
  );
end
$create_reschedule_fixture$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_two', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $accept_and_reschedule$
declare
  proposal_id bigint;
  accepted jsonb;
  replacement jsonb;
  original_status text;
begin
  select id
  into proposal_id
  from public.matchmaking_meeting_proposals
  where meeting_id =
      current_setting('medichall.mm_reschedule_meeting', true)::bigint
    and proposal_round = 1
    and slot_number = 1;

  accepted := public.respond_matchmaking_meeting(
    current_setting('medichall.mm_reschedule_meeting', true)::bigint,
    'accept',
    1,
    '73000000-0000-4000-8000-000000000002'::uuid,
    proposal_id,
    null,
    null,
    null
  );
  replacement := public.reschedule_matchmaking_meeting(
    current_setting('medichall.mm_reschedule_meeting', true)::bigint,
    (accepted ->> 'state_version')::integer,
    'Rescheduled fixture',
    'Replacement meeting with three options.',
    'Europe/Berlin',
    'English',
    jsonb_build_array(
      jsonb_build_object(
        'start_at', now() + interval '23 days',
        'end_at', now() + interval '23 days 45 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '24 days',
        'end_at', now() + interval '24 days 45 minutes'
      ),
      jsonb_build_object(
        'start_at', now() + interval '25 days',
        'end_at', now() + interval '25 days 45 minutes'
      )
    ),
    '73000000-0000-4000-8000-000000000003'::uuid
  );

  select status
  into original_status
  from public.matchmaking_meeting_requests
  where id =
    current_setting('medichall.mm_reschedule_meeting', true)::bigint;

  if original_status <> 'cancelled'
     or replacement ->> 'status' <> 'proposed'
     or jsonb_array_length(replacement -> 'proposals') <> 3 then
    raise exception 'Rescheduling did not atomically replace the meeting';
  end if;
end
$accept_and_reschedule$;

reset role;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('medichall.mm_user_three', true),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $third_tenant_meeting_isolation$
declare
  visible_meetings integer;
  visible_proposals integer;
  visible_events integer;
  visible_notifications integer;
  portal_center jsonb;
begin
  select count(*) into visible_meetings
  from public.matchmaking_meeting_requests
  where id = current_setting('medichall.mm_meeting', true)::bigint;
  select count(*) into visible_proposals
  from public.matchmaking_meeting_proposals
  where meeting_id = current_setting('medichall.mm_meeting', true)::bigint;
  select count(*) into visible_events
  from public.matchmaking_meeting_events
  where meeting_id = current_setting('medichall.mm_meeting', true)::bigint;
  select count(*) into visible_notifications
  from public.matchmaking_notifications
  where meeting_id = current_setting('medichall.mm_meeting', true)::bigint;
  portal_center := public.get_portal_notification_center(200);

  if visible_meetings <> 0
     or visible_proposals <> 0
     or visible_events <> 0
     or visible_notifications <> 0
     or jsonb_array_length(portal_center -> 'notifications') <> 0 then
    raise exception 'Third tenant can read foreign meeting lifecycle data';
  end if;

  begin
    insert into public.matchmaking_meeting_events (
      meeting_id,
      connection_id,
      event_type
    )
    values (
      current_setting('medichall.mm_meeting', true)::bigint,
      current_setting('medichall.mm_connection', true)::bigint,
      'forged_event'
    );
    raise exception 'Authenticated tenant inserted a forged audit event';
  exception when insufficient_privilege then null;
  end;
end
$third_tenant_meeting_isolation$;

rollback;

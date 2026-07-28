-- MedicHall Matchmaking Workspace: additive schema and row-level security.
-- Extends the production two-sided matchmaking model without replacing it.

begin;

do $preflight$
declare
  required_relation text;
begin
  foreach required_relation in array array[
    'public.matchmaking_profiles',
    'public.matchmaking_matches',
    'public.business_connections',
    'public.matchmaking_meeting_requests'
  ]
  loop
    if to_regclass(required_relation) is null then
      raise exception 'Matchmaking Workspace preflight failed: % is missing',
        required_relation;
    end if;
  end loop;
end
$preflight$;

alter table public.matchmaking_matches
  add column if not exists explanation jsonb not null default '{}'::jsonb;

create or replace function public.mm_build_match_explanation(
  p_match_score integer,
  p_confidence_level text,
  p_product_score integer,
  p_geography_score integer,
  p_partner_type_score integer,
  p_certification_score integer,
  p_commercial_score integer,
  p_reasons jsonb,
  p_risks jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $function$
  with components(label, score, weight, reason) as (
    values
      ('Product fit', coalesce(p_product_score, 0), 40,
        'Portfolio and stated product needs align'),
      ('Geography', coalesce(p_geography_score, 0), 20,
        'Target and served markets align'),
      ('Partner type', coalesce(p_partner_type_score, 0), 15,
        'The requested partner roles align'),
      ('Commercial fit', coalesce(p_commercial_score, 0), 15,
        'Commercial capacity and preferences align'),
      ('Certifications', coalesce(p_certification_score, 0), 10,
        'Certification requirements align')
  ),
  ranked as (
    select
      label,
      score,
      weight,
      reason,
      round(score * weight / 100.0, 1) as weighted_points
    from components
    order by score * weight desc, weight desc, label
  ),
  top_drivers as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'label', label,
          'score', score,
          'weight_percent', weight,
          'weighted_points', weighted_points,
          'reason', reason
        )
        order by weighted_points desc, weight desc
      ),
      '[]'::jsonb
    ) as value
    from (select * from ranked limit 3) top_three
  ),
  all_components as (
    select jsonb_agg(
      jsonb_build_object(
        'label', label,
        'score', score,
        'weight_percent', weight,
        'weighted_points', weighted_points
      )
      order by weight desc, label
    ) as value
    from ranked
  )
  select jsonb_build_object(
    'version', 1,
    'summary', case
      when coalesce(p_match_score, 0) >= 85 then
        'Excellent fit based on the available profile evidence.'
      when coalesce(p_match_score, 0) >= 70 then
        'Strong fit with a few points to validate together.'
      when coalesce(p_match_score, 0) >= 50 then
        'Promising fit that needs additional qualification.'
      else
        'Early fit signal; review the risks before engaging.'
    end,
    'score', coalesce(p_match_score, 0),
    'confidence', coalesce(p_confidence_level, 'low'),
    'confidence_note', case coalesce(p_confidence_level, 'low')
      when 'high' then
        'Both profiles contain enough structured data for a stronger signal.'
      when 'medium' then
        'The score uses partial profile data and should be validated in conversation.'
      else
        'Profile evidence is limited; this score is directional, not a guarantee.'
    end,
    'top_reasons', (select value from top_drivers),
    'components', (select value from all_components),
    'source_reasons', coalesce(p_reasons, '{}'::jsonb),
    'risk_signals', coalesce(p_risks, '{}'::jsonb),
    'method', jsonb_build_object(
      'product_weight_percent', 40,
      'geography_weight_percent', 20,
      'partner_type_weight_percent', 15,
      'commercial_weight_percent', 15,
      'certification_weight_percent', 10
    )
  );
$function$;

create or replace function public.mm_set_match_explanation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.explanation := public.mm_build_match_explanation(
    new.match_score,
    new.confidence_level,
    new.product_score,
    new.geography_score,
    new.partner_type_score,
    new.certification_score,
    new.commercial_score,
    new.reasons,
    new.risks
  );
  return new;
end;
$function$;

drop trigger if exists set_matchmaking_match_explanation
  on public.matchmaking_matches;

create trigger set_matchmaking_match_explanation
before insert or update of
  match_score,
  confidence_level,
  product_score,
  geography_score,
  partner_type_score,
  certification_score,
  commercial_score,
  reasons,
  risks
on public.matchmaking_matches
for each row execute function public.mm_set_match_explanation();

update public.matchmaking_matches
set explanation = public.mm_build_match_explanation(
  match_score,
  confidence_level,
  product_score,
  geography_score,
  partner_type_score,
  certification_score,
  commercial_score,
  reasons,
  risks
);

alter table public.business_connections
  add column if not exists state_version integer not null default 1,
  add column if not exists accepted_at timestamptz,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists closed_reason text;

alter table public.business_connections
  drop constraint if exists business_connections_state_version_check;

alter table public.business_connections
  add constraint business_connections_state_version_check
  check (state_version > 0);

update public.business_connections
set accepted_at = coalesce(accepted_at, responded_at, updated_at)
where status = 'accepted'
  and accepted_at is null;

alter table public.matchmaking_meeting_requests
  drop constraint if exists matchmaking_meeting_requests_status_check;

alter table public.matchmaking_meeting_requests
  add column if not exists title text not null default 'Matchmaking meeting',
  add column if not exists language text,
  add column if not exists creator_timezone text,
  add column if not exists duration_minutes integer,
  add column if not exists state_version integer not null default 1,
  add column if not exists proposal_round integer not null default 1,
  add column if not exists accepted_proposal_id bigint,
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_start timestamptz,
  add column if not exists confirmed_end timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_profile_id uuid
    references public.matchmaking_profiles(id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists completed_at timestamptz,
  add column if not exists no_show_at timestamptz,
  add column if not exists video_provider text not null default 'daily',
  add column if not exists video_status text not null default 'not_requested',
  add column if not exists video_room_name text,
  add column if not exists video_room_url text,
  add column if not exists video_room_expires_at timestamptz,
  add column if not exists video_created_at timestamptz,
  add column if not exists video_claimed_at timestamptz,
  add column if not exists video_error_code text,
  add column if not exists last_activity_at timestamptz not null default now();

update public.matchmaking_meeting_requests
set
  status = case status when 'pending' then 'proposed' else status end,
  title = coalesce(nullif(trim(title), ''), 'Matchmaking meeting'),
  creator_timezone = coalesce(
    nullif(trim(creator_timezone), ''),
    nullif(trim(timezone), ''),
    'UTC'
  ),
  duration_minutes = coalesce(
    duration_minutes,
    case
      when proposed_start is not null
       and proposed_end is not null
       and proposed_end > proposed_start
      then greatest(
        15,
        least(
          240,
          round(extract(epoch from (proposed_end - proposed_start)) / 60.0)::integer
        )
      )
    end,
    30
  ),
  submitted_at = coalesce(submitted_at, created_at),
  expires_at = coalesce(
    expires_at,
    proposed_end + interval '7 days',
    created_at + interval '30 days'
  ),
  last_activity_at = coalesce(last_activity_at, updated_at, created_at);

alter table public.matchmaking_meeting_requests
  alter column creator_timezone set default 'UTC',
  alter column creator_timezone set not null,
  alter column duration_minutes set default 30,
  alter column duration_minutes set not null;

alter table public.matchmaking_meeting_requests
  add constraint matchmaking_meeting_requests_status_check
  check (
    status in (
      'draft',
      'proposed',
      'awaiting_response',
      'counter_proposed',
      'accepted',
      'confirmed',
      'declined',
      'cancelled',
      'completed',
      'no_show',
      'expired'
    )
  ),
  add constraint matchmaking_meeting_requests_state_version_check
  check (state_version > 0),
  add constraint matchmaking_meeting_requests_proposal_round_check
  check (proposal_round > 0),
  add constraint matchmaking_meeting_requests_duration_check
  check (duration_minutes between 15 and 240),
  add constraint matchmaking_meeting_requests_confirmed_time_check
  check (
    (confirmed_start is null and confirmed_end is null)
    or (
      confirmed_start is not null
      and confirmed_end is not null
      and confirmed_end > confirmed_start
    )
  ),
  add constraint matchmaking_meeting_requests_video_provider_check
  check (video_provider in ('daily', 'disabled')),
  add constraint matchmaking_meeting_requests_video_status_check
  check (
    video_status in (
      'not_requested',
      'creating',
      'ready',
      'unconfigured',
      'failed',
      'revoked'
    )
  );

create table if not exists public.matchmaking_meeting_proposals (
  id bigint generated by default as identity primary key,
  meeting_id bigint not null
    references public.matchmaking_meeting_requests(id) on delete cascade,
  proposal_round integer not null check (proposal_round > 0),
  slot_number smallint not null check (slot_number between 1 and 3),
  proposed_by_profile_id uuid not null
    references public.matchmaking_profiles(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source_timezone text not null,
  status text not null default 'active'
    check (status in ('active', 'accepted', 'superseded', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (meeting_id, proposal_round, slot_number),
  check (end_at > start_at)
);

insert into public.matchmaking_meeting_proposals (
  meeting_id,
  proposal_round,
  slot_number,
  proposed_by_profile_id,
  start_at,
  end_at,
  source_timezone,
  status,
  created_at
)
select
  meeting.id,
  1,
  1,
  meeting.requester_profile_id,
  meeting.proposed_start,
  meeting.proposed_end,
  meeting.creator_timezone,
  case
    when meeting.status in ('accepted', 'completed') then 'accepted'
    else 'active'
  end,
  meeting.created_at
from public.matchmaking_meeting_requests meeting
where meeting.proposed_start is not null
  and meeting.proposed_end is not null
  and not exists (
    select 1
    from public.matchmaking_meeting_proposals proposal
    where proposal.meeting_id = meeting.id
  );

update public.matchmaking_meeting_requests meeting
set
  accepted_proposal_id = proposal.id,
  confirmed_start = coalesce(meeting.confirmed_start, proposal.start_at),
  confirmed_end = coalesce(meeting.confirmed_end, proposal.end_at),
  confirmed_at = coalesce(meeting.confirmed_at, meeting.responded_at)
from public.matchmaking_meeting_proposals proposal
where proposal.meeting_id = meeting.id
  and proposal.status = 'accepted'
  and meeting.status in ('accepted', 'completed')
  and meeting.accepted_proposal_id is null;

alter table public.matchmaking_meeting_requests
  add constraint matchmaking_meeting_requests_accepted_proposal_fkey
  foreign key (accepted_proposal_id)
  references public.matchmaking_meeting_proposals(id)
  on delete set null;

create table if not exists public.matchmaking_meeting_participants (
  meeting_id bigint not null
    references public.matchmaking_meeting_requests(id) on delete cascade,
  profile_id uuid not null
    references public.matchmaking_profiles(id) on delete restrict,
  participant_role text not null
    check (participant_role in ('organizer', 'required', 'optional')),
  response_status text not null default 'needs_action'
    check (
      response_status in (
        'needs_action',
        'accepted',
        'declined',
        'tentative'
      )
    ),
  added_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (meeting_id, profile_id)
);

insert into public.matchmaking_meeting_participants (
  meeting_id,
  profile_id,
  participant_role,
  response_status,
  added_at
)
select
  id,
  requester_profile_id,
  'organizer',
  'accepted',
  created_at
from public.matchmaking_meeting_requests
on conflict (meeting_id, profile_id) do nothing;

insert into public.matchmaking_meeting_participants (
  meeting_id,
  profile_id,
  participant_role,
  response_status,
  added_at,
  responded_at
)
select
  id,
  recipient_profile_id,
  'required',
  case
    when status in ('accepted', 'confirmed', 'completed') then 'accepted'
    when status = 'declined' then 'declined'
    else 'needs_action'
  end,
  created_at,
  responded_at
from public.matchmaking_meeting_requests
on conflict (meeting_id, profile_id) do nothing;

create table if not exists public.matchmaking_meeting_events (
  id bigint generated by default as identity primary key,
  meeting_id bigint not null
    references public.matchmaking_meeting_requests(id) on delete restrict,
  connection_id bigint not null
    references public.business_connections(id) on delete restrict,
  actor_profile_id uuid
    references public.matchmaking_profiles(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.matchmaking_notifications (
  id bigint generated by default as identity primary key,
  recipient_profile_id uuid not null
    references public.matchmaking_profiles(id) on delete cascade,
  actor_profile_id uuid
    references public.matchmaking_profiles(id) on delete set null,
  connection_id bigint
    references public.business_connections(id) on delete cascade,
  meeting_id bigint
    references public.matchmaking_meeting_requests(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  action_url text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_profile_id, dedupe_key)
);

create table if not exists public.matchmaking_relationship_messages (
  id bigint generated by default as identity primary key,
  connection_id bigint not null
    references public.business_connections(id) on delete cascade,
  sender_profile_id uuid
    references public.matchmaking_profiles(id) on delete set null,
  message_type text not null default 'human'
    check (message_type in ('human', 'system')),
  body text not null check (char_length(body) between 1 and 4000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (message_type = 'human' and sender_profile_id is not null)
    or message_type = 'system'
  )
);

create table if not exists public.matchmaking_private_notes (
  id bigint generated by default as identity primary key,
  connection_id bigint not null
    references public.business_connections(id) on delete cascade,
  meeting_id bigint
    references public.matchmaking_meeting_requests(id) on delete cascade,
  owner_profile_id uuid not null
    references public.matchmaking_profiles(id) on delete cascade,
  note text not null check (char_length(note) between 1 and 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists matchmaking_private_notes_relationship_unique
on public.matchmaking_private_notes(connection_id, owner_profile_id)
where meeting_id is null;

create unique index if not exists matchmaking_private_notes_meeting_unique
on public.matchmaking_private_notes(meeting_id, owner_profile_id)
where meeting_id is not null;

create table if not exists public.matchmaking_meeting_outcomes (
  id bigint generated by default as identity primary key,
  meeting_id bigint not null
    references public.matchmaking_meeting_requests(id) on delete cascade,
  author_profile_id uuid not null
    references public.matchmaking_profiles(id) on delete restrict,
  outcome_status text not null
    check (
      outcome_status in (
        'positive',
        'neutral',
        'negative',
        'follow_up_needed',
        'no_decision'
      )
    ),
  shared_summary text check (char_length(shared_summary) <= 8000),
  next_step text check (char_length(next_step) <= 2000),
  follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, author_profile_id)
);

create table if not exists public.matchmaking_meeting_reminders (
  id bigint generated by default as identity primary key,
  meeting_id bigint not null
    references public.matchmaking_meeting_requests(id) on delete cascade,
  recipient_profile_id uuid not null
    references public.matchmaking_profiles(id) on delete cascade,
  reminder_type text not null
    check (
      reminder_type in (
        'meeting_24h',
        'meeting_15m',
        'meeting_start',
        'post_meeting_follow_up'
      )
    ),
  channel text not null default 'in_app'
    check (channel in ('in_app', 'email')),
  due_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'sent', 'cancelled', 'failed')),
  dedupe_key text not null unique,
  claimed_at timestamptz,
  sent_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.matchmaking_idempotency_keys (
  id bigint generated by default as identity primary key,
  actor_profile_id uuid not null
    references public.matchmaking_profiles(id) on delete cascade,
  operation text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique (actor_profile_id, operation, idempotency_key)
);

create index if not exists matchmaking_matches_workspace_idx
  on public.matchmaking_matches(source_profile_id, status, match_score desc);

create index if not exists business_connections_participants_idx
  on public.business_connections(requester_profile_id, recipient_profile_id, updated_at desc);

create index if not exists matchmaking_meetings_connection_activity_idx
  on public.matchmaking_meeting_requests(connection_id, last_activity_at desc);

create index if not exists matchmaking_meetings_status_time_idx
  on public.matchmaking_meeting_requests(status, confirmed_start);

create index if not exists matchmaking_meeting_proposals_active_idx
  on public.matchmaking_meeting_proposals(meeting_id, proposal_round, status);

create index if not exists matchmaking_meeting_events_timeline_idx
  on public.matchmaking_meeting_events(meeting_id, created_at, id);

create index if not exists matchmaking_notifications_unread_idx
  on public.matchmaking_notifications(recipient_profile_id, created_at desc)
  where read_at is null;

create index if not exists matchmaking_messages_connection_idx
  on public.matchmaking_relationship_messages(connection_id, created_at, id);

create index if not exists matchmaking_reminders_due_idx
  on public.matchmaking_meeting_reminders(due_at, status)
  where status = 'scheduled';

insert into public.matchmaking_meeting_events (
  meeting_id,
  connection_id,
  actor_profile_id,
  event_type,
  from_status,
  to_status,
  event_data,
  created_at
)
select
  meeting.id,
  meeting.connection_id,
  meeting.requester_profile_id,
  'legacy_meeting_imported',
  null,
  meeting.status,
  jsonb_build_object('migration', '202607280002'),
  meeting.created_at
from public.matchmaking_meeting_requests meeting
where meeting.connection_id is not null
  and not exists (
    select 1
    from public.matchmaking_meeting_events event
    where event.meeting_id = meeting.id
  );

create or replace function public.mm_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select profile.id
  from public.matchmaking_profiles profile
  where profile.user_id = auth.uid()
  limit 1;
$function$;

create or replace function public.mm_is_connection_participant(
  p_connection_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.business_connections connection
    where connection.id = p_connection_id
      and public.mm_current_profile_id() in (
        connection.requester_profile_id,
        connection.recipient_profile_id
      )
  );
$function$;

create or replace function public.mm_is_meeting_participant(
  p_meeting_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.matchmaking_meeting_requests meeting
    where meeting.id = p_meeting_id
      and public.mm_current_profile_id() in (
        meeting.requester_profile_id,
        meeting.recipient_profile_id
      )
      and (
        meeting.status <> 'draft'
        or meeting.requester_profile_id = public.mm_current_profile_id()
      )
  );
$function$;

revoke all on function public.mm_build_match_explanation(
  integer, text, integer, integer, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;

revoke all on function public.mm_current_profile_id() from public, anon;
grant execute on function public.mm_current_profile_id()
  to authenticated, service_role;

revoke all on function public.mm_is_connection_participant(bigint)
  from public, anon;
grant execute on function public.mm_is_connection_participant(bigint)
  to authenticated, service_role;

revoke all on function public.mm_is_meeting_participant(bigint)
  from public, anon;
grant execute on function public.mm_is_meeting_participant(bigint)
  to authenticated, service_role;

alter table public.matchmaking_meeting_proposals enable row level security;
alter table public.matchmaking_meeting_participants enable row level security;
alter table public.matchmaking_meeting_events enable row level security;
alter table public.matchmaking_notifications enable row level security;
alter table public.matchmaking_relationship_messages enable row level security;
alter table public.matchmaking_private_notes enable row level security;
alter table public.matchmaking_meeting_outcomes enable row level security;
alter table public.matchmaking_meeting_reminders enable row level security;
alter table public.matchmaking_idempotency_keys enable row level security;

drop policy if exists "participants view meeting requests"
  on public.matchmaking_meeting_requests;

create policy "participants view meeting requests"
on public.matchmaking_meeting_requests
for select to authenticated
using (public.mm_is_meeting_participant(id));

create policy "participants view meeting proposals"
on public.matchmaking_meeting_proposals
for select to authenticated
using (public.mm_is_meeting_participant(meeting_id));

create policy "participants view meeting participants"
on public.matchmaking_meeting_participants
for select to authenticated
using (public.mm_is_meeting_participant(meeting_id));

create policy "participants view meeting events"
on public.matchmaking_meeting_events
for select to authenticated
using (public.mm_is_meeting_participant(meeting_id));

create policy "recipients view own matchmaking notifications"
on public.matchmaking_notifications
for select to authenticated
using (recipient_profile_id = public.mm_current_profile_id());

create policy "connection participants view relationship messages"
on public.matchmaking_relationship_messages
for select to authenticated
using (public.mm_is_connection_participant(connection_id));

create policy "owners view private matchmaking notes"
on public.matchmaking_private_notes
for select to authenticated
using (owner_profile_id = public.mm_current_profile_id());

create policy "meeting participants view shared outcomes"
on public.matchmaking_meeting_outcomes
for select to authenticated
using (public.mm_is_meeting_participant(meeting_id));

create policy "recipients view own meeting reminders"
on public.matchmaking_meeting_reminders
for select to authenticated
using (recipient_profile_id = public.mm_current_profile_id());

revoke all on table
  public.matchmaking_meeting_proposals,
  public.matchmaking_meeting_participants,
  public.matchmaking_meeting_events,
  public.matchmaking_notifications,
  public.matchmaking_relationship_messages,
  public.matchmaking_private_notes,
  public.matchmaking_meeting_outcomes,
  public.matchmaking_meeting_reminders,
  public.matchmaking_idempotency_keys
from anon;

revoke insert, update, delete on table
  public.matchmaking_meeting_proposals,
  public.matchmaking_meeting_participants,
  public.matchmaking_meeting_events,
  public.matchmaking_notifications,
  public.matchmaking_relationship_messages,
  public.matchmaking_private_notes,
  public.matchmaking_meeting_outcomes,
  public.matchmaking_meeting_reminders,
  public.matchmaking_idempotency_keys
from authenticated;

grant select on table
  public.matchmaking_meeting_proposals,
  public.matchmaking_meeting_participants,
  public.matchmaking_meeting_events,
  public.matchmaking_notifications,
  public.matchmaking_relationship_messages,
  public.matchmaking_private_notes,
  public.matchmaking_meeting_outcomes,
  public.matchmaking_meeting_reminders
to authenticated;

create or replace function public.mm_reject_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_setting('medichall.allow_audit_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Matchmaking meeting events are immutable'
    using errcode = '55000';
end;
$function$;

drop trigger if exists reject_matchmaking_event_mutation
  on public.matchmaking_meeting_events;

create trigger reject_matchmaking_event_mutation
before update or delete on public.matchmaking_meeting_events
for each row execute function public.mm_reject_event_mutation();

notify pgrst, 'reload schema';

commit;

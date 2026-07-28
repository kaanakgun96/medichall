-- Matchmaking Workspace explicit function privilege hardening.
--
-- The production project grants API roles function EXECUTE through default
-- privileges. Revoke the roles explicitly so only the intended RPC surface is
-- callable. This is idempotent and changes no application data.

begin;

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

revoke all on function public.mm_has_service_role()
  from public, anon, authenticated;

revoke all on function public.claim_matchmaking_video_room(bigint)
  from public, anon, authenticated;
grant execute on function public.claim_matchmaking_video_room(bigint)
  to service_role;

revoke all on function public.complete_matchmaking_video_room(
  bigint, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_matchmaking_video_room(
  bigint, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.fail_matchmaking_video_room(bigint, text)
  from public, anon, authenticated;
grant execute on function public.fail_matchmaking_video_room(bigint, text)
  to service_role;

revoke all on function public.get_matchmaking_video_context(bigint)
  from public, anon;
grant execute on function public.get_matchmaking_video_context(bigint)
  to authenticated, service_role;

revoke all on function public.authorize_matchmaking_video_action(bigint, text)
  from public, anon;
grant execute on function public.authorize_matchmaking_video_action(bigint, text)
  to authenticated, service_role;

revoke all on function public.record_matchmaking_video_revocation(bigint)
  from public, anon, authenticated;
grant execute on function public.record_matchmaking_video_revocation(bigint)
  to service_role;

revoke all on function public.process_matchmaking_automation(integer)
  from public, anon, authenticated;
grant execute on function public.process_matchmaking_automation(integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

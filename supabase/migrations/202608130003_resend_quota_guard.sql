-- MedicHall Resend quota incident remediation.
--
-- Tender opportunity discovery remains an in-app notification and weekly
-- digest input. It must not project one provider email per opportunity.
-- Transactional events, deadline reminders and weekly digests remain eligible
-- for email under the existing user preferences.

begin;

create or replace function public.project_portal_notification_to_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  email_event text;
begin
  email_event := case new.notification_type
    -- tender_match and tender_match_high are intentionally in-app only.
    -- The weekly digest already aggregates tender opportunity counts.
    when 'company_match' then 'NEW_COMPANY_MATCH'
    when 'connection_requested' then 'CONNECTION_REQUEST'
    when 'connection_accepted' then 'CONNECTION_ACCEPTED'
    when 'rfq_request' then 'NEW_RFQ'
    when 'rfq_message' then 'NEW_MESSAGE'
    when 'relationship_message' then 'NEW_MESSAGE'
    when 'meeting_proposed' then 'MEETING_REQUEST'
    when 'meeting_counter_proposed' then 'MEETING_REQUEST'
    when 'meeting_confirmed' then 'MEETING_CONFIRMED'
    when 'meeting_24h' then 'MEETING_REMINDER'
    when 'meeting_15m' then 'MEETING_REMINDER'
    when 'meeting_start' then 'MEETING_REMINDER'
    when 'tender_import_completed' then 'IMPORT_COMPLETE'
    when 'tender_import_partial' then 'IMPORT_COMPLETE'
    when 'tender_deadline_7d' then 'TENDER_DEADLINE_APPROACHING'
    when 'tender_deadline_3d' then 'TENDER_DEADLINE_APPROACHING'
    when 'tender_deadline_1d' then 'TENDER_DEADLINE_APPROACHING'
    when 'weekly_digest' then 'WEEKLY_DIGEST'
    else null
  end;

  if email_event is null or new.recipient_user_id is null
    or not public.user_notification_event_enabled(
      new.recipient_user_id, email_event
    ) then
    return new;
  end if;

  insert into public.user_notification_email_outbox (
    notification_id,
    recipient_user_id,
    event_type,
    idempotency_key,
    payload
  ) values (
    new.id,
    new.recipient_user_id,
    email_event,
    'user-notification/' || new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'title', new.title,
      'body', new.body,
      'company_name', new.company_name,
      'action_url', new.action_url,
      'source_kind', new.source_kind,
      'source_id', new.source_id,
      'event', new.payload
    ))
  )
  on conflict (notification_id) do nothing;

  return new;
exception when others then
  raise warning 'User notification email projection failed (SQLSTATE %)',
    sqlstate;
  return new;
end;
$function$;

revoke all on function public.project_portal_notification_to_email()
from public, anon, authenticated;

-- Stop only unsent low-priority tender mail. Sent and terminal rows are kept as
-- immutable incident evidence. Processing rows are not changed so an active
-- worker cannot send successfully and then lose its completion transition.
update public.user_notification_email_outbox
set status = 'suppressed',
    lease_expires_at = null,
    error_code = 'batched_to_weekly_digest',
    error_redacted = 'batched_to_weekly_digest',
    updated_at = now()
where event_type in ('NEW_TENDER_MATCH', 'HIGH_TENDER_MATCH')
  and status in ('pending', 'retry');

create or replace function public.retry_user_notification_email(
  p_outbox_id bigint,
  p_error_code text,
  p_error_redacted text,
  p_retry_after_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  result_status text;
  safe_error_code text := left(regexp_replace(
    lower(coalesce(p_error_code, 'delivery_error')),
    '[^a-z0-9_]+', '_', 'g'
  ), 80);
  permanent_failure boolean;
  retry_delay integer;
begin
  permanent_failure := safe_error_code in (
    'resend_http_400',
    'resend_http_401',
    'resend_http_403',
    'resend_http_404',
    'resend_http_422'
  );

  retry_delay := least(21600, greatest(
    30,
    coalesce(
      p_retry_after_seconds,
      case
        when safe_error_code = 'resend_http_429' then 21600
        else null
      end,
      30
    )
  ));

  update public.user_notification_email_outbox queue
  set status = case
        when permanent_failure or queue.attempt_count >= queue.max_attempts
          then 'failed'
        else 'retry'
      end,
      next_attempt_at = case
        when permanent_failure or queue.attempt_count >= queue.max_attempts
          then queue.next_attempt_at
        when p_retry_after_seconds is not null
          or safe_error_code = 'resend_http_429'
          then now() + make_interval(secs => retry_delay)
        else now() + make_interval(secs => least(
          21600,
          greatest(
            30,
            (30 * power(2, greatest(queue.attempt_count - 1, 0)))::integer
          )
        ))
      end,
      lease_expires_at = null,
      error_code = safe_error_code,
      error_redacted = left(
        coalesce(p_error_redacted, 'delivery_error'),
        300
      ),
      updated_at = now()
  where queue.id = p_outbox_id and queue.status = 'processing'
  returning queue.status into result_status;

  return result_status;
end;
$function$;

revoke all on function public.retry_user_notification_email(
  bigint, text, text, integer
) from public, anon, authenticated;
grant execute on function public.retry_user_notification_email(
  bigint, text, text, integer
) to service_role;

commit;

# Matchmaking Workspace functional completion report

**Date:** 2026-07-28
**Branch:** `react-migration`
**Production frontend source:** root `portal.html`
**Supabase project:** `azdmuarzntzqdyirysux`
**Frontend deployment:** cPanel replacement prepared; manual upload required

## Outcome

The meeting and notification flows are now role-aware and were exercised in
the real portal with two authenticated production-backed QA accounts. The
proposer and responder no longer receive the same `Proposed` presentation.
Meeting requests require exactly three explicit date/time options, an IANA
timezone, and a duration. Accepted meetings leave Requests and appear in
Upcoming Meetings with details, calendar actions, and configuration-gated
video.

Migration `202607280007_matchmaking_ui_completion` was applied to production.
The complete SQL lifecycle/RLS suite then passed in a transaction and rolled
back all of its synthetic fixtures.

The root portal frontend has not been uploaded to cPanel by Codex. Production
still requires the complete artifact from
`deliverables/medichall-matchmaking-workspace-2026-07-28/portal.html`.

## Root cause

The previous card renderer called the generic
`MatchmakingUtils.statusLabel(meeting.status)`. Both participants therefore
received the same label for a `proposed` row, even though the active proposal
already identified which profile was waiting and which profile had to act.
The Meetings view also placed every lifecycle state into one queue.

Notifications were profile-scoped only and appeared only inside Matchmaking.
RFQ messages, RFQ requests, and offers had a separate transient unread query,
so the portal had no persistent cross-workspace notification source or
action/read/resolved distinction.

## Role-aware frontend mapping

| Backend condition | Active proposer sees | Other participant sees |
|---|---|---|
| `draft` | Draft; edit and submit | Not visible |
| `proposed` / `awaiting_response` | Awaiting response; edit or withdraw | Action required; accept a slot, decline, or propose different times |
| `counter_proposed` | Awaiting response; edit or withdraw | New time proposal; accept a slot, decline, or propose different times |
| `accepted` / `confirmed` | Confirmed in Upcoming Meetings | Confirmed in Upcoming Meetings |
| terminal state | Past Meetings | Past Meetings |

The role is derived from the active proposal's
`proposed_by_profile_id`, not from assumptions about who originally created
the meeting. This keeps counter-proposals correct when the responder becomes
the new proposer.

The Matchmaking navigation is:

1. Matches
2. Requests
3. Upcoming Meetings
4. Past Meetings
5. Connections

Accepted and confirmed meetings are excluded from Requests.

## Meeting RPC and UI mapping

| Portal action | RPC / backend action |
|---|---|
| Create request or draft | `propose_matchmaking_meeting` |
| Edit draft | `update_matchmaking_meeting_draft` |
| Edit submitted active proposal | `revise_matchmaking_meeting_proposal` |
| Accept, counter, decline, cancel, complete, no-show | `respond_matchmaking_meeting` |
| Reschedule a confirmed meeting | `reschedule_matchmaking_meeting` |
| Open details/timeline | `get_matchmaking_relationship` |
| Prepare/join/revoke video | authenticated `meeting-video` Edge Function |

The server-side slot validator now requires exactly three distinct future
slots. The portal uses separate date and time inputs, a duration selector, and
an IANA timezone selector. Wall-clock values are converted to UTC only after
the timezone is selected; proposal rows retain their source timezone.

`revise_matchmaking_meeting_proposal` uses a row lock, expected
`state_version`, idempotency key, immutable superseded proposal history,
participant response reset, event, system message, and recipient notification.

`reschedule_matchmaking_meeting` atomically cancels the confirmed meeting and
creates a replacement three-slot request on the same accepted connection. The
shared idempotency key is safe because the cancel and propose operations use
separate operation namespaces.

## Meeting Details

The dedicated Meeting Details surface includes:

- both participants;
- topic and agenda;
- source timezone, viewer timezone, duration, and confirmed slot;
- all proposal slots and statuses;
- role-aware actions;
- immutable event timeline;
- private meeting notes;
- shared outcome/follow-up controls for completed/no-show meetings;
- calendar actions;
- video state and Join only when the backend status is `confirmed` and
  `video_status` is `ready`;
- cancel and reschedule controls.

Production has no Daily secret configured. The authenticated live flow
therefore reached `confirmed` with `video_status=unconfigured`, displayed the
exact text `Video meetings are not configured yet.`, exposed calendar actions,
and exposed no Join button.

## Global notification architecture

`matchmaking_notifications` remains the persistent notification store and now
also contains:

- `recipient_user_id` and `actor_user_id`;
- `source_kind` and `source_id`;
- actor company name;
- `action_required`;
- `resolved_at`;
- existing independent `read_at`.

The new user-scoped RPCs are:

- `get_portal_notification_center(integer)`;
- `mark_portal_notifications_read(bigint[])`.

Both use `auth.uid()`. Anonymous execution is revoked, authenticated users can
read or mark only their own notifications, and direct browser insert/update/
delete remains revoked.

Sources are:

- connection and meeting events through the existing notification helper;
- RFQ request, offer insert/update, and message triggers;
- automation/reminder/system notifications through the same meeting helper.

The global header bell is visible on every authenticated portal panel and
polls every ten seconds, with focus/visibility refresh. It provides All,
Action Required, Unread, Read, and Resolved views. Opening one notification
marks it read and follows its validated hash deep link; it does not resolve
the underlying action. Connection and meeting transition triggers resolve the
action only when the response occurs.

The badge is one set-union count:

`unread OR (action_required AND unresolved)`

It is not the sum of two counts, so one record cannot be double-counted.
Formatting is `1` through `9`, `9+` for `10` through `99`, and `99+` from
`100`.

Dashboard work summaries show Action required, Open requests, Upcoming
meetings, and Unread updates for both account types.

## Authenticated two-account proof

The live browser run used two isolated accounts with clearly marked QA company
names and the production backend:

1. manufacturer sent a connection request;
2. buyer's global bell showed one item and Requests showed an incoming
   `Action required` card;
3. buyer accepted; the connection disappeared from Requests;
4. buyer proposed exactly three slots in `Europe/Istanbul`;
5. buyer saw `Awaiting response`, three slots, Edit proposed times, and
   Withdraw request, with no Accept control;
6. buyer edited the first slot from 10:00 to 10:15 through
   `revise_matchmaking_meeting_proposal`;
7. manufacturer saw `Meeting request from Anatolia Buyer QA`,
   `Action required`, three slot-level Accept controls, Propose different
   times, and Decline;
8. opening the updated-times notification changed the center from
   `1 action required · 3 unread` to `1 action required · 2 unread`, proving
   read and action state are independent;
9. the notification deep-linked into Meeting Details with participants,
   agenda, proposals, timeline, and private note;
10. manufacturer accepted one slot; Requests became empty and Upcoming
    Meetings became one;
11. the approved localhost origin called the deployed Edge Function, which
    confirmed the meeting as video-unconfigured and rendered calendar actions
    without Join;
12. a second meeting exercised the full counter-proposal path: manufacturer
    proposed three different times and saw Awaiting response; buyer saw New
    time proposal with slot-level Accept; buyer accepted and Upcoming Meetings
    became two.

No email addresses, passwords, access tokens, provider credentials, or
service-role values were written to repository files.

The two QA matchmaking profiles were set to `is_active=false` after the run so
they no longer participate in other users' match generation. Their
authenticated accounts and lifecycle records were retained as auditable,
reversible proof; no destructive production cleanup was performed.

## Regression evidence

- migration transactional dry run against production: passed;
- migration production apply: passed;
- full production SQL/RLS/lifecycle suite: passed and rolled back;
- SQL additions cover own-notification isolation, read-not-resolution,
  exactly-three slots, revision exposure, and atomic rescheduling;
- React/Vitest: `85 passed`;
- Deno/Edge/security: `76 passed`;
- React lint: passed;
- React TypeScript: passed;
- React production build: passed (`1850` modules);
- portal inline JavaScript parse: passed;
- `git diff --check`: passed.

## Files

- `portal.html`
- `supabase/migrations/202607280007_matchmaking_ui_completion.sql`
- `supabase/tests/matchmaking_workspace.sql`
- `apps/portal-react/src/features/matchmaking/portal-matchmaking-workspace.test.ts`
- this report
- updated cPanel artifact, checksum, and upload guide

## Rollback

Frontend rollback is the cPanel backup described in the deliverable README.
It does not delete meeting or notification history.

The database change is forward-only. If a backend correction is needed,
disable use of the new frontend and apply a corrective migration. Do not drop
notification or meeting tables. Daily remains securely disabled until its
managed Edge secrets are configured.

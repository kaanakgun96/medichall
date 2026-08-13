# Secure Video Early-Join UX Hotfix

Date: 2026-08-13

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Root cause

`get_matchmaking_video_context` already calculates `can_join` with PostgreSQL
server time. It permits a confirmed, ready room from 15 minutes before
`confirmed_start` until one hour after `confirmed_end`. This enforcement was
working and is unchanged.

The `meeting-video` Edge Function collapsed every `can_join = false` result
into HTTP `409` with application code `join_window_closed`. The shared browser
HTTP helper deliberately retains only allow-listed codes, so it discarded
`join_window_closed`, converted the response to `HTTP_409`, and displayed its
generic stale/conflict copy: “This record already exists or was updated
elsewhere. Refresh and try again.” The Join button was rendered whenever the
provider room was ready, with no client-side join-window state.

## Corrected contract

An authenticated participant attempting to join before the window now receives
HTTP `425 Too Early`, code `MEETING_NOT_OPEN_YET`, safe explanatory copy, and a
non-sensitive `join_opens_at` instant. Unauthorized join, cancelled meeting,
and no-longer-joinable states use `MEETING_UNAUTHORIZED`, `MEETING_CANCELLED`,
and `MEETING_NO_LONGER_JOINABLE` respectively. Genuine `PT409`/`HTTP_409`
conflicts retain the stale-record message. Provider failures retain bounded
technical-failure copy. No raw PostgREST or Daily response is rendered.

The Edge Function still requires `context.can_join = true` from the existing
participant-scoped RPC before requesting a Daily token. A browser clock,
removed `disabled` attribute, or direct Edge invocation cannot bypass the
database check. Daily room configuration, room creation, token scope, expiry,
and provider credentials are unchanged.

## Frontend behavior

`matchmaking-domain.js` is the shared join-window calculation used by the
portal and standalone matchmaking page. It parses the canonical timestamptz
instant, subtracts 15 minutes, and formats the opening time in the meeting's
stored IANA timezone. It does not parse an unzoned local date.

Before the window, every rendered Join button is disabled and the video state
shows the scheduled opening date, time, and timezone. At the boundary, one
bounded local `setTimeout` updates all visible copies of the button and state
without a backend request. Long delays are capped at the browser timeout limit
and rescheduled. There is no second-by-second countdown or join polling.

Join requests use the existing single-flight coordinator keyed by meeting ID.
Two simultaneous calls share one request. No HTTP `409`, `425`, provider, or
business error is automatically retried. The only unchanged transport retry is
the existing single session-refresh attempt following HTTP `401`.

## Verification boundary

Focused tests cover 16 minutes before, 15 minutes plus one second before, the
exact 15-minute boundary, inside the window, Istanbul display when the browser
timezone differs, automatic local enable scheduling, explicit Edge responses,
unauthorized/cancelled/ended mappings, server authority, one-flight Join, and
the absence of a Join retry loop. Edge tests use mocked Supabase boundaries and
make zero Daily/provider calls.

No meeting, room, token, notification, email, or customer row is required for
this verification. No migration is required.

## Production deployment evidence

Only `meeting-video` was deployed to production project
`azdmuarzntzqdyirysux` on 2026-08-13. Supabase reports version 4, status
`ACTIVE`, and `verify_jwt = false`, preserving the function's existing
application-level JWT validation. The live boundary checks returned HTTP 204
for CORS `OPTIONS` and HTTP 401 for an unauthenticated join `POST`. The latter
stopped before meeting authorization and provider initialization.

The restricted production schema backup captured immediately before this
hotfix confirms that `get_matchmaking_video_context` uses PostgreSQL `now()`
and permits `can_join` only from `confirmed_start - interval '15 minutes'`
through `confirmed_end + interval '1 hour'` for an authenticated participant.
That function was not changed. No migration was applied.

Production verification created zero meetings, rooms, tokens, access-log rows,
notifications, emails, or customer mutations and made zero Daily/provider and
AI requests. No synthetic cleanup was necessary. cPanel was not modified.

## Manual cPanel patch

Upload the four files below in order to `public_html`, preserving their exact
filenames. All four HTML/shared-JavaScript references use cache identifier
`20260813video1`.

1. `matchmaking-domain.js`
2. `matchmaking-workspace.js`
3. `matchmaking.html`
4. `portal.html`

The production site already serves the previously released
`medichall-traffic.js` prerequisite. No CSS, image, backend credential, or
other cPanel asset belongs in this patch.

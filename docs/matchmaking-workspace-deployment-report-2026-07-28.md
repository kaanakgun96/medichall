# MedicHall Matchmaking Workspace deployment report

**Date:** 2026-07-28
**Branch:** `react-migration`
**Supabase project:** `azdmuarzntzqdyirysux`
**Frontend status:** cPanel artifact ready; manual upload still required

## Outcome

The prior single-date, ambiguous-`pending` meeting flow is now an explainable
two-sided workspace. It supports saved/dismissed matches, connection
acceptance, connection-scoped messaging, one-to-three proposal slots,
counter-proposal history, optimistic concurrency, explicit meeting states,
calendar actions, a participant timeline, private notes, post-meeting
outcomes, in-app reminders, and configuration-gated embedded video.

The canonical root `portal.html` remains production source. Tender,
lot-matching, structured-product, RFQ, authentication, and document
intelligence code paths were not replaced.

## Production database rollout

The legacy preview found two `pending` meeting rows. The schema migration
mapped them to `proposed` without inventing acceptance events. Both were past
their viable proposal windows and were subsequently moved to `expired` by the
new backend automation.

Applied atomically and recorded in `supabase_migrations.schema_migrations`:

1. `202607280002_matchmaking_workspace_schema`
2. `202607280003_matchmaking_workspace_workflows`
3. `202607280004_matchmaking_video_and_automation`
4. `202607280005_matchmaking_function_privilege_hardening`
5. `202607280006_matchmaking_idempotency_digest`

The two compatibility migrations were added after live regression caught:

- explicit `anon` function grants inherited from the project's default
  privileges; and
- Supabase's `pgcrypto.digest` location in the `extensions` schema.

Production verification after those fixes:

- all ten new workspace relations exist;
- `legacy_pending_rows = 0`;
- `anon` cannot execute `get_matchmaking_workspace`;
- `authenticated` can execute the participant workspace RPC;
- `authenticated` cannot claim a provider room directly;
- the automation job is active at `*/5 * * * *`; and
- the complete SQL suite executed successfully and rolled back its fixtures.

The SQL suite covers cross-tenant reads/mutations, private-note isolation,
multiple proposal rounds, one accepted slot, replay safety, stale acceptance,
completion, outcomes, cancellation, blocked joins, invalid transitions,
expiration, notification deduplication, and immutable audit events.

## Authorization and privacy

Every new table has RLS. Shared relationship/meeting data is visible only to
the two participant profiles; draft meetings are creator-only; private notes
are owner-only. Direct lifecycle-table mutation is revoked. Narrow
security-definer RPCs use fixed search paths, row locks, state versions, and
idempotency keys. Provider metadata mutations and automation are
service-role-only.

The browser contains neither a service-role secret nor a provider API key.
Daily join tokens are created only after authenticated participant
authorization, scoped to one private room, limited to at most one hour, sent
with no-store response headers, retained only in the iframe URL for the active
session, and cleared when the iframe closes. Room identifiers are random;
recording is not enabled; provider errors are reduced to safe codes; and
prepare/join/revoke requests are rate-limited and audited.

These are technical privacy controls, not a claim of legal compliance. Before
enabling real calls, the owner still needs an executed provider DPA, an updated
privacy notice, a documented retention/deletion policy, and an operational
process for data-subject requests and incident response.

## Video provider and configuration

Daily is selected behind `MeetingVideoProvider`. It provides private expiring
rooms, room-scoped expiring tokens, a prebuilt accessible call surface, screen
sharing, and recording-disabled behavior without adding a browser SDK.

Production has the `meeting-video` Edge Function deployed. Its gateway legacy
JWT switch is off; the function validates JWTs with `auth.getUser` and then
uses participant-scoped authorization. Production probes returned:

- `OPTIONS`: `204`;
- anonymous `POST`: `401` with `Invalid or expired session`.

The deployed bundle contains only `index.ts` and
`meeting-video-provider.ts`. No tender function was redeployed.

`MEETING_VIDEO_PROVIDER`, `DAILY_API_KEY`, and `DAILY_API_BASE_URL` are absent
from production Edge secrets. Real room creation is therefore securely
configuration-gated. Accepted meetings still become `confirmed` with
`video_status=unconfigured`; calendar, messaging, timeline, reminders, notes,
completion, and outcomes remain available.

To enable Daily without sharing a secret in chat:

1. In Daily, create a dedicated production API key.
2. If the Daily plan exposes key scopes, limit it to room and meeting-token
   create/read/delete operations.
3. Do not enable recording or recording storage. The application omits
   recording properties and hides recording controls in participant tokens.
4. Keep room expiration under application control (`nbf`, `exp`, and
   `eject_at_room_exp` are set by the provider adapter).
5. Webhooks are not used in this version; do not configure a webhook secret.
6. In Supabase Dashboard, open **Edge Functions → Secrets**, add the three
   names below, then run a short non-recorded two-participant test.

```text
MEETING_VIDEO_PROVIDER=daily
DAILY_API_KEY=<Daily production API key>
DAILY_API_BASE_URL=https://api.daily.co/v1
```

Equivalent CLI flow:

```bash
read -s DAILY_API_KEY_INPUT
supabase secrets set \
  --project-ref azdmuarzntzqdyirysux \
  MEETING_VIDEO_PROVIDER=daily \
  DAILY_API_KEY="$DAILY_API_KEY_INPUT" \
  DAILY_API_BASE_URL=https://api.daily.co/v1
unset DAILY_API_KEY_INPUT
```

The fixed security windows are: room opens 15 minutes early, room expires one
hour after the scheduled end, and participant tokens expire after at most one
hour and never after the room.

## Calendar, reminders, and follow-up

Meeting instants are stored as UTC `timestamptz`; proposal rows retain the
source IANA timezone; the portal renders in the viewer's IANA timezone.
Confirmed cards provide a token-free ICS file and Google/Outlook compose
links. No calendar OAuth/write-back is claimed.

The five-minute backend job expires stale proposals, delivers deduplicated
in-app 24-hour/15-minute/start reminders, creates a post-meeting prompt, and
cleans expired idempotency/rate-limit records. Cancellation and completion
suppress future non-follow-up reminders. Email is explicitly unconfigured
rather than falsely reported as sent.

## Validation

- Deno formatting: passed
- Deno lint: passed
- Deno typecheck: passed
- Deno/backend tests: `76 passed`
- Production SQL/RLS/lifecycle regression: passed and rolled back
- React TypeScript: passed
- React lint: passed
- React tests: `81 passed`
- React production build: passed (`1850` modules)
- Portal inline JavaScript parse: two scripts passed
- Browser credential scan: clean across `101` source/build files
- Video SDK dependency review: no manifest changed; REST adapter adds no SDK
- `git diff --check`: passed

The signed-in Supabase function tester verified production behavior. Local
browser visual loading could not bind a sandbox localhost port, so responsive
and accessibility behavior is covered by production markup/CSS review,
keyboard/focus tests, inline parsing, and portal regression assertions. Final
cPanel smoke testing remains part of the manual upload guide.

## cPanel handoff and rollback

Complete replacement:

`deliverables/medichall-matchmaking-workspace-2026-07-28/portal.html`

SHA-256:

`b3426cc47452cc515e422b4ae1b67d24e95d4c5d1787705abd9633f8eb56224f`

Destination: `public_html/portal.html`.

The directory README contains the non-developer upload and rollback steps.
The frontend has not been claimed as deployed. A frontend rollback restores
the backed-up portal and leaves the additive database objects in place,
avoiding destructive loss of meeting history.

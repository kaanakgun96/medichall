# Matchmaking frontend parity report

**Date:** 2026-07-29

**Branch:** `react-migration`

**Production entry points:** root `portal.html` and root `matchmaking.html`

## Root cause recorded before implementation

The divergence is caused by two independently implemented browser
applications:

- `portal.html` contains the current Matchmaking Workspace, its lifecycle
  renderer, notification center, meeting RPC bindings, video provider boundary,
  calendar helpers, and polling.
- `matchmaking.html` is a 599-line legacy prototype with its own markup, CSS,
  state arrays, direct REST queries, and page-specific render functions.

The standalone application was never wired to the later portal implementation.
It still calls `prompt()` for connection introductions and meeting creation,
collects one raw `YYYY-MM-DDTHH:MM` value, writes the old single-date meeting
shape directly, and renders a generic pending status. The production portal,
by contrast, uses participant-scoped workspace RPCs, exactly-three proposal
slots, role-aware status mapping, relationship details, notifications,
calendar output, and the authenticated video Edge Function.

This is not a mismatched React build. The root HTML files are separate,
hand-maintained production artifacts; `apps/portal-react` currently supplies
regression infrastructure but is not the cPanel production entry point.

## Chosen one-source architecture

The root `portal.html` remains the canonical production application. The
standalone `matchmaking.html` entry point will become a small same-origin
bootstrap that mounts that exact document at the existing URL and opens its
Matchmaking route. This avoids a second copy of the workspace, preserves
standalone query strings and record hashes, and makes future portal
Matchmaking changes appear at both URLs.

The shared authenticated header and scheduler will be completed in the
canonical portal so both entry points receive the same behavior. No database
or Edge Function fork is introduced.

## Implementation

### One executable workspace

`matchmaking.html` is now a 1.3 KB same-origin bootstrap. When no hash is
present it adds `#matchmaking`, fetches the root `portal.html` with
`cache: "no-store"` and same-origin credentials, and writes that canonical
document into the current page. The browser URL remains `matchmaking.html`;
query parameters and existing record hashes are not replaced.

The rendered direct page therefore executes the same:

- Matchmaking utility and render functions;
- authenticated `get_matchmaking_workspace` and relationship RPCs;
- connection and meeting lifecycle RPCs;
- global notification center RPCs;
- `meeting-video` Edge Function boundary;
- notification and workspace pollers;
- visibility refresh behavior;
- role and status mapping; and
- calendar/deep-link generation.

The source has no Supabase Realtime channel. The canonical portal uses
10-second notification polling, 30-second workspace polling, and visibility
refresh; both entry points now use those exact same update paths. No second
REST client or business-logic fork remains in `matchmaking.html`.

### Shared header

The unchanged MedicHall logo remains in the canonical portal header. The
authenticated header now provides:

- Messages, routed through the existing authenticated inbox hash;
- the global notification bell and red set-union badge;
- a Profile menu with Profile, Notification Center, and Log out; and
- a mobile layout that retains Messages, the bell, and Profile without
  horizontal overflow.

Notification records still keep read and action-required state independent.
Bell and profile-menu entry points open the same Notification Center, and
notification hashes open the same request, relationship, RFQ, or meeting
regardless of the current HTML filename.

### Shared meeting scheduler

The canonical meeting dialog now has:

1. native calendar date selection;
2. clickable half-hour time choices;
3. duration and IANA timezone selectors;
4. exactly three selected-time cards;
5. a Remove action for every card;
6. a disabled-until-complete Review button;
7. a dedicated review-and-send step; and
8. a persistent workspace success message after a successful request.

The submitted payload still goes through
`MatchmakingUtils.proposalSlots`, which validates three distinct future wall
times and converts them to UTC in the selected timezone. Draft, edit,
counter-proposal, and reschedule actions all reuse the same scheduler.

## Legacy code removed

The standalone file no longer contains:

- duplicated Matchmaking CSS, markup, state arrays, or render functions;
- `prompt()` or `window.prompt`;
- `Meeting start (YYYY-MM-DDTHH:MM)`;
- single raw datetime meeting creation;
- direct writes to `matchmaking_meeting_requests`;
- generic legacy pending rendering; or
- a separate Supabase publishable key/API client.

The two remaining `prompt()` calls in `portal.html` belong to certificate
naming and saved tender searches, not Matchmaking or meeting scheduling.
Post-meeting follow-up retains a `datetime-local` field because it records an
optional follow-up reminder, not a meeting proposal.

## Independent browser evidence

The deterministic browser run used the real root HTML files and a local
non-production fixture server. The fixture contains no credential or network
write and is committed at `scripts/qa-matchmaking-parity-server.mjs`.

The following checks passed for both entry points:

- authenticated shared header rendered;
- Matchmaking Workspace opened;
- accepted connection exposed Propose meeting;
- scheduler opened with no browser dialog;
- three clickable times produced `3 of 3 selected`;
- Review displayed `Ready to send`;
- the portal mock send exposed
  `Meeting request sent with three proposed times.`;
- Requests showed the requester as Awaiting response;
- the responder proposal showed New time proposal and three Accept controls;
- responder controls included Propose different times and Decline;
- Upcoming Meetings contained the confirmed meeting;
- Meeting Details opened with two participants;
- video-unconfigured text rendered and Join was absent;
- Download ICS was available;
- bell and Profile → Notification Center opened the same center; and
- direct meeting deep link preserved
  `matchmaking.html?source=qa#matchmaking-meeting=703` and opened Meeting
  Details.

Mobile checks used a 390 × 844 viewport:

- header logo, Messages, bell, badge, and Profile remained visible;
- both portal and standalone workspaces had no horizontal overflow; and
- the scheduler modal fit the viewport, scrolled vertically, and rendered a
  three-column time grid.

No console error/warning and no JavaScript alert/prompt/confirm dialog was
present.

Screenshots:

- `docs/evidence/matchmaking-parity-2026-07-29/portal-scheduler.jpg`
- `docs/evidence/matchmaking-parity-2026-07-29/matchmaking-scheduler.jpg`
- `docs/evidence/matchmaking-parity-2026-07-29/portal-requests.jpg`
- `docs/evidence/matchmaking-parity-2026-07-29/matchmaking-requests.jpg`
- `docs/evidence/matchmaking-parity-2026-07-29/desktop-header.jpg`
- `docs/evidence/matchmaking-parity-2026-07-29/mobile-header.jpg`

The portal and standalone scheduler images are byte-identical. The portal and
standalone Requests images are also byte-identical:

| Evidence pair | SHA-256 |
| --- | --- |
| Both schedulers | `4600aad6047e761fd9e316992072c95c529fd705087a2121e4c8953e33514df8` |
| Both Requests views | `25d5aee3c89b3816b2307500ab0a6730ef6c59f608d79f438d0b602c20a42194` |

## Regression results

- React/Vitest: `15` files, `87` tests passed.
- Deno/Edge/security: `76` tests passed.
- React ESLint: passed.
- React TypeScript: passed.
- React production build: passed (`1850` modules).
- `portal.html`: two inline scripts parsed.
- `matchmaking.html`: one inline script parsed.
- QA server JavaScript syntax: passed.
- `git diff --check`: passed.
- Browser source secret scan: no service-role or provider secret in either
  production HTML file.

The Deno suite includes the production OPTIONS/POST CORS regression, document
intelligence v3/v3.1, lot matching, product profiles, matching observability,
PDF processing, and meeting-video provider security. No tender, document,
lot, RFQ, messaging, company-profile, authentication, connection, or
notification backend file changed.

## Files changed

- `portal.html`
- `matchmaking.html`
- `apps/portal-react/src/features/matchmaking/portal-matchmaking-workspace.test.ts`
- `scripts/qa-matchmaking-parity-server.mjs`
- this report and six evidence images
- `deliverables/medichall-matchmaking-parity-2026-07-29/*`

## cPanel deployment

Upload **both** files to `public_html`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `portal.html` | 318691 | `1c8dbb5b8155cb3813ed6ac250e092a2cb16f7690ee971e5b55af9a24b7ab4d9` |
| `matchmaking.html` | 1292 | `08e6a7bfa0123e486a04cd481e37d10e944d1b5242057f04364f303f2a15cff3` |

No additional JavaScript or CSS asset is required. The exact upload copies,
checksums, and guide are in
`deliverables/medichall-matchmaking-parity-2026-07-29`.

## Rollback

Before upload, retain the current cPanel versions of both root files. To roll
back, restore the prior `portal.html` and `matchmaking.html` together and
purge any cPanel/CDN cache for those two paths. This frontend-only change
adds no migration, table, policy, RPC, Edge Function, or production data
mutation to reverse.

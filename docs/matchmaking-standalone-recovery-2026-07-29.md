# Standalone Matchmaking recovery report

**Date:** 2026-07-29

**Branch:** `react-migration`

## Root cause recorded before recovery

Commit `f690858d4afcfd8a79a5b51d8f4b11dea659d6ac` interpreted functional
parity as document-level visual parity. It replaced the dedicated
`matchmaking.html` application with a 42-line bootstrap that fetched and
rewrote the complete `portal.html` document. That made the standalone URL
execute the portal dashboard layout and also introduced unrelated visible
header and scheduler changes into `portal.html`.

Git history shows that the last commit which changed the successful dedicated
standalone design was:

`1a138ddfae041c8df27a3e29ab50c1d8b67df6d6`

Its `matchmaking.html` blob is
`90496a74197321ee3535b08017ef9784b61f2e59`. The same blob remained present
immediately before `f690858`, so it is the recovery source of truth.

The pre-parity `portal.html` blob is
`2686d838dbacea40b59de20ba41d66d132c2dd64`. The portal presentation will be
restored to that exact version before applying any strictly non-visual shared
domain integration.

## Recovery boundary

This is a presentation-layer correction only. No migration, RLS policy,
database function, Edge Function, notification lifecycle, meeting lifecycle,
or production data will be reverted.

The intended architecture is:

1. shared pure Matchmaking domain helpers;
2. the existing portal-specific renderer; and
3. the restored standalone-specific full-page renderer.

## Implemented recovery

- `portal.html` was restored from the parent of `f690858`. Relative to the
  pre-parity blob, its markup and CSS are unchanged. Its only change is a
  nonvisual import of `matchmaking-domain.js` and an alias from the existing
  `MatchmakingUtils` name to that shared helper.
- `matchmaking.html` is again an independent document with the successful
  standalone design language: navy application header, gradient hero,
  dedicated navigation, metric cards, two-sided partner cards, and its own
  modal system.
- `matchmaking-workspace.js` is the standalone presentation/controller. It
  calls the reconciled authenticated RPC and Edge Function surface; it does not
  revive the obsolete direct-table meeting or connection writes.
- `matchmaking-domain.js` is the single browser-side source for role-aware
  labels, meeting permissions, request/upcoming/past categorization,
  timezone-safe three-slot conversion, badge formatting, safe URLs, and
  calendar event generation.

The original MedicHall logo SVG and the successful standalone page structure
were retained. Portal-specific and standalone-specific renderers remain
separate.

## Standalone functionality

- Discover Matches keeps company identity, country, available logo/verified
  state, score, top fit drivers, risk signals, confidence context, save,
  dismiss, connection, relationship, meeting, and website actions.
- Requests combines pending connections and pending meeting proposals, with
  `Awaiting response` for the active proposer and `Action required` or
  `New time proposal` for the participant who must respond.
- The meeting scheduler uses a date picker, selectable time buttons, exactly
  three removable options, timezone and duration controls, a review step, send
  progress, and a success state. Draft, edit, counter-proposal, and reschedule
  modes use their existing reconciled RPCs.
- Upcoming and Past Meetings expose meeting details, proposal history,
  rescheduling/cancellation, calendar downloads and compose links, secure video
  preparation/join behavior, immutable event timelines, private notes, and
  post-meeting outcomes.
- The standalone header owns its notification bell and accessible notification
  dialog. It uses the global notification-center RPC, independently tracks read
  and action-required state, and deep-links meeting/relationship items locally
  while sending RFQ/inbox actions back to the portal.
- Workspace state polls every 30 seconds, notifications every 10 seconds, and
  relationship detail every 10 seconds while open. Visibility refreshes avoid
  stale tabs.

No migration, RLS policy, database function, Edge Function, backend test, or
production data changed.

## Deterministic browser evidence

The local QA server injects only deterministic mock responses into the real
production HTML and JavaScript. It does not contain credentials and cannot
write production data.

- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/portal-unchanged.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-desktop.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-scheduler.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-scheduler-success.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-notifications.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-requester.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-recipient.jpg`
- `docs/evidence/matchmaking-standalone-recovery-2026-07-29/standalone-mobile.jpg`

Browser checks found no console errors. The mobile evidence uses a real
390×844 viewport and activated the production `max-width:680px` breakpoint.

## Regression results

- React/Vitest: `15` files, `87` tests passed.
- Deno/Edge/security: `76` tests passed.
- React ESLint: passed.
- React TypeScript: passed.
- React production build: passed (`1850` modules).
- Standalone domain, application, and QA server JavaScript syntax: passed.
- `git diff --check`: passed.
- Browser files contain no service-role or Daily provider secret.

The Deno suite includes the production OPTIONS/POST CORS regression, document
intelligence v3/v3.1, lot matching, structured product profiles, matching
observability, PDF processing, and meeting-video provider security.

## cPanel bundle

`deliverables/medichall-matchmaking-standalone-recovery-2026-07-29` contains:

| File | SHA-256 |
| --- | --- |
| `portal.html` | `28a45e0eec00758bd9d9f1eb17d4331188787ae26648f54cafeeeec334e878b8` |
| `matchmaking.html` | `4515d5c15442afcd655b1b68eab2c725b766d760a76e88026e087fae85c7c496` |
| `matchmaking-domain.js` | `00dad9435dd2cc266e800bba04953d4afd5dda8963b26d7f7740fc00fbd91f97` |
| `matchmaking-workspace.js` | `5c1463f74e20772381fc4d336eff3b265a390d26cb0a711e0548c5ce80a1f7e8` |

All four files must be uploaded together to `public_html`. This task does not
deploy them automatically.

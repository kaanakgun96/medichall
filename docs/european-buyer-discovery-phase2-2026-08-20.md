# European Buyer Discovery — Phase 2 release evidence

Date: 2026-08-20

Branch: `react-migration`

Production frontend: root `portal.html`

Production Supabase project: `azdmuarzntzqdyirysux`

## Product and architecture result

The Phase 1 public-source engine remains the only discovery engine. Phase 2 promotes its shared `MedicHallExternalProspects.createWorkspace` surface to **European Buyer Discovery** and reuses that same component in the root portal, standalone workspace, and React migration route.

The manufacturer portal now leads with two primary business-development motions:

1. European Buyer Discovery — buyers outside the MedicHall member network.
2. Tender Intelligence — European procurement discovery and document intelligence.
3. MedicHall Matches — relationships with companies already on MedicHall.

The canonical production route is `portal.html#buyer-discovery`. The standalone equivalent is `matchmaking.html#buyer-discovery`; the React migration equivalent is `#/buyer-discovery`.

The public homepage is unchanged. Existing portal opportunity counts are unchanged because Phase 2 does not mix external-prospect counts into tender/member metrics or invent unavailable aggregate data.

## Truthful progress contract

The `external-prospect-discovery` Edge Function now persists bounded phase transitions and existing real counters after actual work completes:

1. `loading_profile`
2. `preparing_market_search`
3. `searching_procurement`
4. `checking_business_sources`
5. `verifying_websites`
6. `removing_duplicates`
7. `ranking_prospects`
8. `preparing_results`

The UI displays no estimated percentage. It renders only the stored stage plus the existing `sources_checked`, `candidates_found`, `candidates_deduplicated`, and `candidates_accepted` counters. No progress-tick analytics are emitted.

Polling uses one non-overlapping request approximately every 3.2 seconds, pauses in a hidden tab, resumes when visible, stops on terminal status or component destruction, and pauses automatically after 10 minutes. A restored `QUEUED` or `RUNNING` record disables the discovery CTA, so refresh/navigation does not create a second run. The existing database idempotency, 30-minute cooldown, daily cap, and monthly cap remain authoritative.

## Country and evidence truth

- France: official company/activity enrichment active.
- Norway: official company/activity enrichment active.
- Poland: partial; only an already-known explicit KRS identifier can be enriched.
- Germany, Italy, Netherlands, Belgium: registry requests disabled pending legal review.
- Spain: no supported official registry integration.
- Other European markets: procurement/public-web discovery may operate, while official registry enrichment is described as unavailable.

Registry unavailability is a neutral enrichment limitation, not a discovery failure. Cards distinguish **Direct product evidence** from **Indirect commercial evidence**, use customer-facing source labels, and never claim exact current product availability from a broad activity code.

Contact fields collected: **0**. No private email, phone, contact name, LinkedIn profile, outreach action, notification, or provider email is added.

## State and UX coverage

| Matrix | Result |
|---|---|
| A. Portal home Buyer Discovery CTA | PASS |
| B. Direct Buyer Discovery navigation | PASS |
| C. New user / zero prospects | PASS |
| D. Completed cached results | PASS |
| E. Active discovery | PASS |
| F. Repeated Discover click | PASS — disabled/guarded |
| G. Refresh during run | PASS — restored run, no duplicate start |
| H. Partial source coverage | PASS |
| I. Complete run | PASS |
| J. Failed run | PASS |
| K. Cooldown | PASS — friendly retained-results copy |
| L. Daily/monthly cap | PASS — friendly retained-results copy |
| M. France registry-enabled state | PASS |
| N. Germany no-registry state | PASS |
| O. Poland partial registry state | PASS |
| P. Prospect filters | PASS |
| Q. Save | PASS |
| R. Interesting | PASS |
| S. Dismiss | PASS |
| T. Member matchmaking accessible | PASS |
| U. Tender Intelligence accessible | PASS |
| V. Contact privacy | PASS |
| W. Mobile | PASS |
| X. Accessibility | PASS |
| Y. Polling stops | PASS |

## Verification evidence

- Static Buyer Discovery contract: PASS.
- Phase 2 Buyer Discovery UX contract: PASS.
- Deno discovery and registry tests: 21 passed.
- React Vitest suite: 108 passed.
- React TypeScript typecheck: PASS.
- React production build: PASS.
- JavaScript parse checks for the shared UI, standalone workspace, and root portal inline scripts: PASS.
- Responsive matrix: 320, 360, 390, 414, 768, 1024, 1280, and 1440 pixels; zero horizontal overflow.
- Visual QA: portal hierarchy, empty, active, complete, partial, mobile progress, and mobile result states at 1440×900 and 390×844; zero console warnings/errors.
- No database migration is required.

The visual fixtures are retained in `scripts/fixtures/buyer-discovery-dashboard-visual.html` and `scripts/fixtures/buyer-discovery-visual.html`.

## Backend deployment artifact

Artifact: `deliverables/medichall-european-buyer-discovery-phase2-backend-2026-08-20.zip`

SHA-256: `e563a781a75b4453a201e7aba3b66e103e78c555e3d280e1bc69ce3034aa9623`

Deploy only `external-prospect-discovery` from the verified branch. The archive includes its unchanged shared dependency context for auditability; it does not authorize deployment of another function. No migration is included.

Changed function source:

| Repository path | SHA-256 | Bytes |
|---|---:|---:|
| `supabase/functions/external-prospect-discovery/index.ts` | `6af5887a2b885b0c469404bf89d23303ef7e9c2db6d82a5e338d9a71577d5752` | 45,317 |

## cPanel patch artifact

Artifact: `deliverables/medichall-european-buyer-discovery-phase2-cpanel-2026-08-20.zip`

SHA-256: `6ec390983799c421151c071d47b2e5411a5d31099a0a32f0170b9fc3f650b082`

Cache/release identifier: `20260820buyer1`

The archive is flat and is intended for `public_html`. Back up every destination before upload. Upload shared assets first and HTML last.

| Order | Repository path | cPanel destination | SHA-256 | Bytes | Required |
|---:|---|---|---|---:|---|
| 1 | `external-prospects.css` | `public_html/external-prospects.css` | `d5f351e5544bdd6aef5102e772d858af9915b2ab3800cbf948c34ed29bf5571b` | 11,696 | Yes |
| 2 | `external-prospects.js` | `public_html/external-prospects.js` | `1c6d079b0d32564628c5be0d8d31b95ea48afb0ba31a19eafe2f2bb33fd1ecd2` | 28,342 | Yes |
| 3 | `matchmaking-workspace.js` | `public_html/matchmaking-workspace.js` | `f6548f55203713e9bb38b4d16141d2f197b83c0836d8c6e56c2f674bfd963b7e` | 72,712 | Yes |
| 4 | `medichall-navigation.js` | `public_html/medichall-navigation.js` | `047cd401de31ee4053186cd579de2d110e8e0203cfa23bcde29c2730c9b01d49` | 27,025 | Yes — React navigation parity |
| 5 | `matchmaking.html` | `public_html/matchmaking.html` | `9806ea689b53f429dfa032318ace3e99db1fe9f428c6431225238ca832ab3c33` | 21,739 | Yes |
| 6 | `portal.html` | `public_html/portal.html` | `ddae2265792732f26e57d6f6d3d95284ac209350c6783923517518ecb6ba6b1f` | 400,884 | Yes |

Do not upload the React source files or visual fixtures to cPanel. Production remains the root `portal.html` surface.

## Manual deployment and rollback order

1. Deploy only `external-prospect-discovery` to `azdmuarzntzqdyirysux`.
2. Verify ACTIVE state, OPTIONS 204, unauthenticated POST 401, authenticated boundary, and one bounded QA run before frontend upload.
3. Back up the six current `public_html` destinations with a timestamp.
4. Upload rows 1–4, then `matchmaking.html`, then `portal.html` last.
5. Purge the cPanel/CDN cache if configured. The Buyer Discovery CSS/JS and standalone workspace references use `20260820buyer1`.
6. Smoke-test `portal.html#buyer-discovery`, dashboard CTAs, `matchmaking.html#buyer-discovery`, an active run, saved results, Tender Intelligence, and MedicHall Matches at desktop and 390px.

Rollback: restore all six backed-up cPanel files together. If backend progress publication must also be rolled back, redeploy the previous verified `external-prospect-discovery` version; no database rollback is needed.

## Remaining limitations

- Registry depth remains country-specific and legally constrained as listed above.
- Poland cannot perform broad registry discovery; explicit KRS enrichment only.
- A browser request interrupted before the Edge runtime finishes may leave a run active until backend handling completes; the UI resumes bounded polling and never starts a duplicate while that record is active.
- The public homepage was intentionally not changed.

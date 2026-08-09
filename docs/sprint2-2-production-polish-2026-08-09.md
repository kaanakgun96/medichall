# Sprint 2.2 production polish report

Date: 2026-08-09
Branch: `react-migration`
Starting HEAD: `33b8722711c463a274cacc7321abeebf70e2521b`
Production Supabase: `azdmuarzntzqdyirysux`

## Outcome

Sprint 2.2 is release-candidate ready in the repository. This sprint changes
frontend behavior only. It does not add a database migration, deploy an Edge
Function, alter a production row, or change cPanel. The one final cPanel beta
package remains deferred until Sprints 3–6 are complete.

## Implemented scope

### Consistent and safe request behavior

- Added `medichall-ui.js` as the shared production UI safety layer on all seven
  root pages.
- HTTP failures retain only bounded status/code metadata; provider response
  messages are not copied into browser errors, diagnostics, toasts, empty
  states, import cards, matchmaking panels, or admin panels.
- Added redacted diagnostic reporting, single-flight request coordination,
  visibility-aware polling primitives, and a shared busy-button contract.
- Registration retains explicit, safe guidance for known Supabase Auth codes
  while unknown responses use generic actionable copy.
- Tender-import and document-analysis failure records no longer render stored
  backend error strings.
- Admin failure copy no longer exposes internal SQL setup instructions.

### Navigation and performance

- Removed invocation of the duplicate legacy account-chip initializer from
  Marketplace, Products, and Company Directory. The shared header/session
  implementation is now the only active public session initializer.
- Preserved the existing coalesced token refresh, authenticated portal
  in-flight guards, and background-tab polling pauses.
- Added reusable single-flight and visibility-aware scheduling for future UI
  pollers so new work cannot accidentally overlap requests.
- All root assets now use coherent cache version `20260809s22rc1`.

### Error, empty, and authentication paths

- Replaced preview-only login/registration alerts with routes to the production
  Partner Portal.
- Replaced the technical tender-feed migration instruction with safe retry
  guidance.
- Preserved actionable next steps for catalog, RFQ, matchmaking, notification,
  and tender-feed failures.
- Replaced homepage placeholder links with a valid support action and
  non-interactive location text.

### Responsive and accessibility behavior

- Dialogs receive an accessible name, modal semantics, focus target, and an
  `aria-hidden` state that follows backdrop visibility.
- Dialog accessibility state re-runs when class, style, or hidden state changes.
- The product filter control is desktop-hidden, mobile-visible, declares its
  controlled sidebar and expanded state, and moves focus into the opened
  filters.
- Existing keyboard focus, responsive-table, live-region, skip-target, and
  reduced-motion behavior remains active.

## Validation evidence

- New Sprint 2.2 regression validates all seven pages, cache coherence,
  redacted error behavior, background-aware/single-flight helpers, modal state,
  tender error copy, and absence of preview auth actions.
- Local browser smoke covered all seven root pages at 390 px: correct headings,
  zero horizontal overflow, a main content target, and no visible raw PGRST,
  row-level-security, SQL-editor, or `Error:` content.
- Product filters at 390 px start collapsed, open on activation, set
  `aria-expanded="true"`, move focus to the first filter, and remain at zero
  horizontal overflow.
- At the normal desktop viewport, the filter button is hidden and the filter
  sidebar remains visible.
- Repository Node checks passed, including 8/8 auth regressions, 7/7 Sprint 2.1
  regressions, the new Sprint 2.2 suite, HTML parsing, design-system checks,
  portal artifact validation, and migration sequencing.
- Deno passed 118/118 tests. All 13 deployed Edge Function entrypoints passed
  strict frozen typechecking.
- React passed 16/16 test files and 96/96 tests; TypeScript, ESLint, and the
  production Vite build passed with 1,849 modules transformed.
- Credential scan passed across 476 text files and `git diff --check` passed.
- Production database lint returned zero error-level findings, and the linked
  migration dry run reported that the remote database is up to date.

## Production safety and counts

No synthetic QA record was required because the sprint has no backend write
path or deployable database/function object. Production counts therefore remain
the read-only launch baseline counts documented in
`launch-readiness-baseline-2026-08-09.md`; before/after deltas are zero for all
tracked objects. No customer data was read by identifier, modified, or removed.

## Files in the Sprint 2.2 change set

- Root pages: `index.html`, `products.html`, `companies.html`, `tenders.html`,
  `matchmaking.html`, `portal.html`, `admin.html`
- Shared frontend: `medichall-ui.js`, `medichall-navigation.js`,
  `marketplace-products.js`, `marketplace-companies.js`,
  `matchmaking-workspace.js`
- Regression: `scripts/sprint2-2-production-polish.test.mjs` and cache-version
  updates in the existing auth and Sprint 2.1 regressions
- Evidence: this report and `launch-readiness-baseline-2026-08-09.md`

The pre-existing untracked duplicate deliverable directory is explicitly
excluded from this sprint.

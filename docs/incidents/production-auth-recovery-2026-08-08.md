# Production auth recovery and Sprint 2 controlled completion

Date: 2026-08-08  
Branch: `react-migration`  
Production Supabase project: redacted in this report  
Frontend deployment: not performed; canonical cPanel artifact prepared separately

## Incident findings

The exact live root pages and shared assets were preserved before changes. All
four temporary hotfix files still existed on the web host, but no production
root page linked or embedded them. The unsafe hotfix containing a global
`window.fetch` replacement therefore remained an orphaned file rather than an
active dependency. The canonical release does not contain or reference any of
the four hotfix files.

The active defects had four independent causes:

1. The portal, marketplace, matchmaking, and admin surfaces used incompatible
   session storage and refresh behavior. Admin additionally used a legacy
   session-only token and did not perform an explicit backend admin check.
2. The shared accessibility enhancer replaced the functional `authShell` ID
   with `main-content`. Successful authentication therefore reached Supabase,
   then frontend initialization failed when it tried to access the missing
   element. A separate skip-link anchor now preserves all functional IDs.
3. Dashboard opportunity loading was conditional on a matching profile, and
   RFQ metrics were updated through a timing race. Loading, success, zero, and
   error states are now explicit and independent.
4. The company-follow RPC returns records shaped as `{ company_id }`, while the
   frontend converted each whole record with `Number(record)`. Follow rows were
   stored correctly but did not reappear after reload. The result shape is now
   normalized explicitly.

At the 768px breakpoint, the notification panel also attempted to position
itself against a hidden desktop bell. It now uses an in-viewport tablet
fallback while retaining the anchored desktop and bottom-sheet mobile layouts.

## Canonical auth and navigation contract

- Access token: `mh_p_token`.
- Refresh token: `mh_p_refresh`.
- One shared session helper performs password login, user validation, a single
  locked refresh, one retry after HTTP 401, and scoped logout.
- Portal, Marketplace Products, Company Directory, Matchmaking, Admin, and the
  shared header use the same helper.
- No global fetch override, token URL parameter, browser service credential, or
  parallel refresh implementation exists.
- Canonical Messages route: `portal.html#inbox`.
- Admin authorization: authenticated user plus the existing `public.is_admin()`
  backend check. No grant, RLS policy, or admin allowlist was weakened.

## Production database deployment

Pre-deployment safeguards completed:

- restricted schema-only backup of `public` and `storage`;
- structural database and Edge Function inventories;
- verified SHA-256 manifest and credential scan;
- linked dry run proposing only
  `202608020001_enterprise_marketplace.sql`;
- exact migration plus SQL/RLS regression in one outer rollback transaction;
- unchanged pre-deployment lint baseline.

The single migration was applied successfully. The production migration ledger
is now 39 rows and a second dry run reports the database is up to date. The
`company_follows` table is empty after QA cleanup, RLS is enabled, anonymous
table and RPC access is denied, and authenticated mutation remains RPC-only.

Production lint has zero errors. It still reports the same three pre-existing
type-cast warnings in `recover_stale_tender_document_analysis_jobs`; the Sprint
2 migration introduced no new warning. The unrelated tender function was not
changed during this recovery.

## Isolated two-user production QA

Two uniquely marked synthetic users, one QA company, one QA product, and one
temporary QA-only admin membership were created. The company insert suppressed
the registration-notification trigger deliberately, so no administrator email
or provider charge was generated.

Verified in the real browser against production Supabase:

- favorite creation, reload persistence, duplicate suppression, and cross-user
  read/delete denial;
- company follow creation, reload persistence, duplicate suppression, and
  cross-user read/mutation denial;
- approved active mixed-role Company Directory behavior;
- product-to-company resolution, deterministic similar products, comparison,
  and global product/company search;
- RFQ recipient selection, exact conversation deep link, recipient reply, one
  buyer notification, and notification-to-conversation routing;
- portal login, main-page redirect, hard refresh, signed-out Messages return,
  signed-in Messages routing, and Matchmaking-to-Messages routing;
- zero-valued analytics rendered as `0` with a success state;
- invalid admin credentials, authenticated non-admin denial, authorized QA
  admin login and refresh, logout, and signed-out protection;
- signed-out and signed-in mobile menus, no duplicates, correct `aria-expanded`,
  and no horizontal overflow at 320, 360, 390, and 414px;
- notification panel containment at 390, 768, 1024, and 1440px.

Cleanup ran in a guarded transaction and removed only the synthetic records.
After cleanup, QA users, companies, products, RFQs, messages, notifications,
and storage objects all counted zero. Global production counts returned to the
pre-QA values: 6 users, 1 admin, 6 companies, 39 products, 1 pre-existing
favorite, 14 RFQs, 7 messages, 55 notifications, and 75 storage objects.

## Regression results

- Deno: 117 passed, 0 failed.
- Edge Function typecheck: 13 function entry points passed.
- React/Vitest: 96 passed in 16 files.
- React TypeScript, ESLint, and production build: passed.
- Root HTML inline JavaScript and duplicate-ID validation: passed for six pages.
- Focused auth/session/navigation regression: 8 passed.
- Marketplace, terminology, design-system, migration sequencing, readiness,
  portal artifact, credential, and whitespace checks: passed.
- Final signed-out browser smoke at 320px and 1440px: six root pages passed,
  one coherent cache version, zero horizontal overflow, no new console errors.

## Deployment boundary

The Sprint 2 backend migration is live. No cPanel file was uploaded, no PR was
opened, and `main` and `develop` were not modified. Production frontend rollout
requires the final self-contained cPanel package and its manifest. Keep the
preserved live snapshot until post-upload smoke testing is complete.

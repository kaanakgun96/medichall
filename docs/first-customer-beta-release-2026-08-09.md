# MedicHall first-customer beta release report

Date: 2026-08-09

Branch: `react-migration`

Production Supabase: `azdmuarzntzqdyirysux`

cPanel deployment: **not performed**

## 1. Baseline discovered

MedicHall uses seven root HTML pages, shared browser JS/CSS, authenticated Supabase RPC/REST contracts, private Edge Functions, Vault-backed cron, Resend email, Daily video, and Anthropic-backed tender intelligence. The current public cPanel frontend was captured before packaging: it uses coherent asset version `20260808s21rc1`; 17 required baseline files returned HTTP 200 and `medichall-ui.js` returned 404 because that shared safety layer is new. Production already contained the canonical marketplace, mixed Company Directory, matchmaking/meeting, tender intelligence, Universal Import, notification, and admin models; each sprint extended those models instead of rebuilding them.

## 2. Sprint 2.2 changes

All seven root pages received coherent `20260809s22rc1` dependencies, safe user-facing error translation, shared bounded diagnostics, accessibility-aware modal state, consistent loading/busy behavior, mobile filter focus handling, and navigation/session consolidation. Duplicate legacy account-chip initialization and preview-only authentication actions were removed. No database, function, cPanel, or production-row change occurred.

## 3. Sprint 3 changes

The partner portal now provides resumable, non-blocking role-aware onboarding for manufacturers, suppliers, distributors, organizational buyers, and buyer profiles. The activation checklist deep-links to canonical company, logo, certification, product, tender-preference, matchmaking, company-match, and tender-match surfaces. Existing users retain all data and are not forced through onboarding.

## 4. Sprint 4 changes

Company and tender opportunities now expose deterministic scores, supported reasons, explicit risks/gaps, provenance, and the decision states `MATCH`, `POSSIBLE MATCH`, `REVIEW REQUIRED`, and `NOT SUPPORTED`. Tender details use existing document evidence and lot matches. The tenant-scoped Ask MedicHall flow answers only about one authorized tender and fails closed on unknown citations.

## 5. Sprint 5 changes

The canonical in-app event model now projects eligible business events into a private, idempotent email outbox. Immediate notification preferences, weekly opportunity digests, and 7/3/1-day deadline alerts use real company data. Vault-backed cron leases bounded work, retries safely, and does not roll back the originating business action when delivery fails.

## 6. Sprint 6 changes

Admin opens on a bounded growth workspace with actual overview totals, precisely defined activation milestones, platform health, per-company engagement, and deterministic attention segments. Filters support 7, 30, 90, and all time. A best-effort self-scoped portal heartbeat supplies future last-active evidence and cannot block authentication.

## 7. Onboarding QA

Sprint 3 rollback-only production QA covered manufacturer, distributor, and buyer paths, exact role classification, completion values, first-value counts, dismiss/resume, anonymous denial, and cross-user isolation. The final external-company journey then exercised real production signup, company/profile completion, structured product, generated company matches, explanation review, connection acceptance, meeting confirmation and Daily joins, tender explanation, Ask MedicHall, saved opportunity, RFQ, human messages, notification, email, digest, and admin activation visibility.

## 8. Profile-completion model

The score is deterministic and returned only by `get_account_activation_state_v1()`. Company-style accounts receive weighted account/company information, logo, certification, product, target-market, product-keyword/CPV, and matchmaking evidence. Organizational buyers and buyer profiles omit irrelevant manufacturing/product/certification requirements. First company/tender match views are zero-weight activation outcomes rather than profile-strength inflation. Scores are clamped to 0–100 and documented in the Sprint 3 report.

## 9. Match explanation architecture

Match explanations are derived from structured profile/product/market evidence and store score version and provenance. Supported drivers are separated from risks and unknowns. The final production beta fixture generated three company matches; the intended counterpart was 100%, high confidence, with three supported reasons and no invented risk. Replaying match generation did not create duplicates.

## 10. Tender explanation architecture

Match Score v2 combines deterministic compatibility components with stored tender evidence, missing requirements, confidence, and lot-level records. Unknown data contributes no positive evidence and compliance is never inferred. The final journey used an existing public production tender without modifying it: the synthetic company's honest result was 41%, confidence 87%, `REVIEW REQUIRED`, with three supported reasons and one missing requirement.

## 11. Ask MedicHall architecture

`tender-ask` authenticates the bearer token, derives company ownership server-side, retrieves bounded tender/company evidence, assigns stable citation IDs, requires grounded citations, and renders uncertainty separately. Company/tender/question/context identity leases and caches work. A cross-company request is denied before retrieval or provider use.

## 12. AI usage and cost safeguards

The flow reuses document hashes, stored extraction/evidence, lot matches, product profiles, and answer cache. Defaults remain: temperature zero, at most 900 output tokens, 20 questions per day, and USD 0.05 estimated maximum per request. The final journey made exactly one provider request: 3,999 input tokens, 733 output tokens, 4,732 total, estimated USD 0.022992. Identical resubmission returned the cache and created no second provider/usage call. No provider credential or cost limit changed.

## 13. Email and event architecture

In-app notifications remain canonical. `user_notification_email_outbox` is private, force-RLS, service-role only, uniquely linked to its source notification, and stores stable provider idempotency, bounded attempts/leases, redacted failure state, and provider metadata. Projection errors are caught so registration, RFQ, message, connection, meeting, import, and opportunity writes remain successful even if email fails.

## 14. Weekly digest

The scheduler calculates the previous seven days from canonical tender matches, company matches, RFQs, and confirmed future meetings, then selects the strongest actual open opportunity by score/deadline. ISO-week dedupe advances the next due date once. In the final beta fixture, first scheduling created one digest and replay created zero; the payload contained one tender match, three company matches, one RFQ, one upcoming meeting, and a real strongest opportunity.

## 15. Notification preferences

Authenticated users control immediate RFQ/message alerts, tender alerts, matchmaking alerts, meeting reminders, weekly digest, and IANA timezone. Lease-time preference enforcement suppresses queued but unsent non-essential mail. Existing production users were safely backfilled; in-app notifications are preserved.

## 16. Admin activation funnel

The nine factual milestones are registered, profile completed (role-aware score at least 70), first product, matchmaking at least 60%, first company match viewed, first connection sent, first tender viewed, first RFQ sent/received, and meeting booked. They are a cohort milestone set rather than a forced sequence, so buyer behavior remains truthful.

## 17. Admin company engagement

The admin-only RPC returns registration, last active, profile completion, product/tender/company match, connection, RFQ, message, meeting, and import counts, plus deterministic attention reasons. Range is constrained and company output is capped at 500 (UI requests 200). Admin authorization is checked server-side; anonymous and non-admin access are denied.

## 18. Production migrations

The five forward-only migrations were each schema-backed up, dry-run in exact expected order, rollback-probed, applied once, regression-tested, linted, and recorded:

1. `202608090001_onboarding_activation.sql`
2. `202608090002_opportunity_intelligence.sql`
3. `202608090003_tender_ask_hardening.sql`
4. `202608090004_user_retention_notifications.sql`
5. `202608090005_admin_growth_dashboard.sql`

The final production ledger contains 45 canonical migrations and the linked dry run reports `Remote database is up to date`.

## 19. Edge Functions changed or deployed

- Sprint 2.2: none.
- Sprint 3: none.
- Sprint 4: only `tender-ask`, including its scoped hardening.
- Sprint 5: only `user-notifications`.
- Sprint 6: none.

No unrelated function was redeployed. Final production status checks: `meeting-video` OPTIONS 204 / unauthenticated POST 401; `tender-ask` OPTIONS 204 / unauthenticated POST 401. Daily room creation, two scoped participant tokens, same-room entry, and room revocation passed in the final journey.

## 20. Full regression results

Final release gate:

- Deno: 135 passed, 0 failed.
- repository static tests: 35 passed, 0 failed.
- React/Vitest: 96 passed across 16 files.
- React TypeScript, ESLint, and production Vite build: passed; 1,849 modules transformed.
- production rollback-only SQL/RLS: onboarding, opportunity intelligence, user retention notifications, and admin growth all passed.
- root-page HTML parse/duplicate IDs: passed for seven pages.
- portal artifact: 230 unique static IDs; passed.
- marketplace terminology, UI design system, migration sequencing, and readiness checks: passed.
- release and rollback SHA-256 verification: every file passed; ZIP integrity passed.
- credential scan: 540 text files, no credential literals.
- production database lint: zero error-level findings.
- final linked migration dry run: remote database up to date.

## 21. Security and RLS results

Anonymous mutation/access, non-admin analytics, direct heartbeat mutation, and cross-company tender access were denied. Private outbox, preferences, answer cache, AI usage, meeting/video metadata, and activation state remain tenant-scoped. No service-role, Resend, Daily, Anthropic, Vault, or cron secret is in browser/package files or responses. Credential values were not inspected or printed. The immutable meeting-event trigger is enabled after QA cleanup.

## 22. Performance findings

Public pages use one shared session initializer and coalesced token refresh. Polling pauses in background tabs; new single-flight and visibility-aware helpers prevent overlapping requests. Ask MedicHall and email delivery have database-backed idempotency. Match generation, digest creation, cron replay, meeting-video preparation, and identical Ask submissions were verified not to duplicate paid/provider work. Admin analytics is server-bounded; product/company queries are bounded; no infinite request loop or page-level horizontal overflow was observed at the tested desktop/mobile widths.

## 23. QA cleanup counts

The final beta fixture used the explicit marker `MHQA-BETA-20260809-FINAL`. Before cleanup it contained 2 auth users/identities/companies/profiles/meeting participants, 1 product, 3 company matches, 1 connection, 8 relationship messages, 1 meeting with 3 slots and 4 events, 1 opportunity/score/answer/AI-usage record, 1 RFQ with 2 RFQ messages, 17 portal notifications, 2 email-outbox rows, 4 reminders, 5 video-access rows, and 8 idempotency keys. Storage objects and tender imports were zero. Dependency-ordered guarded cleanup removed all fixture rows, two exact Auth identities, QA pg_net responses, and the Daily room/provider reference. The comprehensive after-count is zero for every listed QA object, including auth sessions/tokens, notifications, events, slots, video metadata, outbox/provider metadata, storage, and idempotency records. External provider delivery/audit logs remain only as provider operational history.

Post-cleanup production counts returned to: 6 auth users, 6 companies, 39 products, 14 RFQs, 7 RFQ messages, 23 relationship messages, 59 tender analysis jobs, 0 tender imports, 4 matchmaking profiles, 2 connections, 8 meetings, 55 notifications, 6 cron jobs, and 0 activity heartbeats. Explicit QA company/auth marker counts are zero. No real customer row was deleted or altered by cleanup.

## 24. Commit SHAs by sprint

| Sprint | Commit |
|---|---|
| 2.2 | `9d20bc756c48e7e68041970eedd594da8c78f8b2` |
| 3 | `96b8209ad1e3a24dd4befe46a1be3502931dd0e0` |
| 4 | `ded9d846e7af7988d1acf7fba4e92f38b8a74f9e` |
| 5 | `c0cc442e93e19a3c8b3ff7fc15a40b75a7801c25` |
| 6 | `bda49e74a49ba37d9b42ef4b33b1708fb45692f0` |

## 25. Final react-migration SHA

The final release-artifact commit SHA is reported after this report and package are committed and pushed; it cannot be embedded in the commit that creates itself. Local and remote equality is verified in the final handoff.

## 26. Main and develop unchanged

Program-start and final verification use immutable remote references. Expected unchanged values are `origin/main` `7aac9e8056a28b33836a6fd70e710aaf5d28f245` and `origin/develop` `4dcd764857f0996dfac5595c36ff4fd3500fbfea`. No checkout, commit, push, PR, or force-push targeted either branch.

## 27. Final cPanel beta release manifest

The canonical package is `deliverables/MEDICHALL-FIRST-CUSTOMER-BETA-RELEASE-2026-08-09.zip` (491,342 bytes; SHA-256 `32422241b3eea5f83e63dce7db0ff4c5a710bd97b3a0a4c7cc3dff5e5a34af2b`). It contains all seven root HTML pages and all eleven local dependencies, exact upload order, sizes, hashes, cache guidance, smoke checks, and no secret. `companies.html` is correctly identified as the mixed Company Directory; no `manufacturers.html` exists. cPanel was not modified.

## 28. Rollback package

The same ZIP contains `ROLLBACK_BASELINE`, `ROLLBACK_SHA256SUMS.txt`, and `ROLLBACK_MANIFEST.md`. These preserve the exact 17 HTTP-200 production files captured before release. Rollback restores those files and removes only the new `medichall-ui.js`; database migrations and Edge Functions remain because their contracts are forward-only and backward-compatible.

## 29. Remaining limitations

- The canonical frontend is not customer-visible until the owner manually uploads the final cPanel package.
- `Last active` will be unrecorded until users load the new portal heartbeat code.
- Browser-visible production smoke must be repeated after manual cPanel upload because this task did not authorize deployment.
- Payments, subscriptions, billing, and artificial monetization limits remain intentionally absent.

## 30. Recommended first-customer beta procedure

1. Verify both package checksum files locally.
2. Take a new cPanel backup, then upload `UPLOAD_TO_PUBLIC_HTML` in README order.
3. Purge cache and execute the private-window desktop/mobile smoke checklist.
4. Enroll a small external cohort across supported roles; do not describe the Company Directory as manufacturer-only.
5. Monitor activation milestones, inbox delivery, Edge Function errors, provider usage/cost, tender evidence quality, meetings, and RFQ responses daily during the first week.
6. Contact companies manually based on deterministic attention segments; do not automate outreach yet.
7. Use observed first-cohort behavior before designing any payment or subscription system.

**PAYMENTS / SUBSCRIPTIONS / BILLING IMPLEMENTED: NO**

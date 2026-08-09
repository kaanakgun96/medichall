# Sprint 6 — Admin Growth Dashboard

Date: 2026-08-09

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Outcome

Admin now opens on a founder-facing growth workspace backed by one bounded,
admin-authorized production RPC. It reports canonical platform totals, a
precisely defined activation cohort, platform health, per-company engagement,
and deterministic companies-needing-attention segments. It never contacts a
company automatically.

The authenticated portal records one private, user-owned last-active
heartbeat on entry, on return to a visible tab, and at most once every five
minutes while open. Heartbeat failure is best-effort and can never block
authentication or portal use.

No Edge Function, cron job, payment feature, or cPanel frontend was deployed
in this sprint.

## Analytics contract

`get_admin_growth_dashboard_v1(range, company_limit)`:

- requires both `auth.uid()` and `is_admin()`;
- permits only 7, 30, 90, or 0 (all time) day ranges;
- bounds company engagement to 500 rows server-side (the UI requests 200);
- returns all-time platform overview counts;
- evaluates companies registered in the selected cohort window against their
  currently achieved activation milestones;
- returns period-created platform-health records;
- returns deterministic attention reasons based only on current source data.

Activation milestone definitions:

| Milestone | Definition |
| --- | --- |
| Registered | Company created inside the selected cohort window. |
| Company profile completed | Current role-aware Sprint 3 activation score is at least 70%. |
| First product added | At least one canonical product belongs to the company. |
| Matchmaking completed | A matchmaking profile exists with at least 60% completeness. |
| First match viewed | A company match moved from its `new` state. |
| First connection sent | The company's matchmaking profile is the requester on a business connection. |
| First tender viewed | A tender opportunity moved from its `new` state. |
| First RFQ sent or received | An RFQ is owned by the company or was sent by its owner. |
| Meeting booked | A participating meeting reached `confirmed` or `completed`. |

These are factual milestones, not a forced prerequisite chain: for example, a
buyer can book a meeting without first creating a product or RFQ.

The attention segments are:

- new company with activation below 70%;
- no products;
- no recorded portal heartbeat in seven days (only after the account itself
  is more than seven days old);
- high-scoring tender match still in `new` state;
- received connection still pending;
- received RFQ with no offer.

## Privacy and authorization

`account_activity_heartbeats` has `FORCE ROW LEVEL SECURITY`. Authenticated
users can select only their own row and have no direct insert/update/delete
grant. `record_user_activity_v1` accepts no user or company identifier and
always writes `auth.uid()`.

The dashboard RPC is `SECURITY DEFINER`, has a fixed search path, and checks
the signed-in user against the existing admin registry before querying. It is
not executable by anonymous users. Direct source-table browser grants were not
expanded.

The SQL regression verified:

- anonymous heartbeat and dashboard execution denied;
- authenticated direct heartbeat mutation denied;
- authenticated self-heartbeat success and cross-user isolation;
- non-admin dashboard denial;
- admin dashboard success;
- 7, 30, 90, and all-time ranges;
- invalid-range denial;
- bounded company output;
- overview totals equal direct canonical production counts;
- stable nine-step funnel and eight-item health shapes;
- transaction rollback of every synthetic identity, admin, and heartbeat.

## Production deployment

Restricted pre-deployment backup:

- path: `/private/tmp/medichall-sprint6-predeployment-20260809.sql`;
- scope: schema-only `public` and `storage`;
- permissions: `0600`;
- size: 636,483 bytes;
- SHA-256:
  `e100eece833e7a1d66eec4f4d3f28f222c4a65ec651d038eda998b8c3c130bca`;
- row-data `COPY`/`INSERT` statements: 0.

The linked dry run proposed exactly:

`202608090005_admin_growth_dashboard.sql`

The migration was applied once. The exact SQL/RLS regression passed after
deployment and rolled back. No Edge Function was added or redeployed.

Direct production admin-RPC validation at 30 days returned:

- overview: 6 companies, 6 active companies, 6 users, 39 products, 14 RFQs,
  30 messages, 10 completed tender analyses, 0 tender imports, 4 matchmaking
  profiles, 2 connections, and 8 meetings;
- company engagement rows: 6;
- cohort registered: 2;
- platform tender matches: 5,196;
- company matches: 5;
- connections created: 2;
- meetings booked: 5;
- tender-analysis requests: 59, of which 10 completed;
- valid zero states: first tender viewed, first RFQ, high-confidence tender
  match, period RFQs, RFQ response rate, and imports.

## Production counts

| Object | Before | After | Expected change |
| --- | ---: | ---: | --- |
| Auth users | 6 | 6 | 0 |
| Companies | 6 | 6 | 0 |
| Products | 39 | 39 | 0 |
| RFQs | 14 | 14 | 0 |
| RFQ messages | 7 | 7 | 0 |
| Relationship messages | 23 | 23 | 0 |
| Tender analysis jobs | 59 | 59 | 0 |
| Tender imports | 0 | 0 | 0 |
| Matchmaking profiles | 4 | 4 | 0 |
| Connections | 2 | 2 | 0 |
| Meetings | 8 | 8 | 0 |
| Portal notifications | 55 | 55 | 0 |
| Activity heartbeat rows | relation absent | 0 | new empty metadata relation |
| Cron jobs | 6 | 6 | 0 |
| Migration ledger | 44 | 45 | +1 intended migration |

No customer, company, product, RFQ, message, tender, marketplace,
matchmaking, meeting, import, notification, or provider record changed.

## Validation

- Deno tests: 135 passed, 0 failed;
- repository static regressions: 35 passed, 0 failed;
- new Sprint 6 static tests: 4 passed, 0 failed;
- React tests: 96 passed across 16 files;
- React typecheck, ESLint, and production build: passed;
- exact rollback-only SQL regression before deployment: passed;
- exact rollback-only SQL/RLS regression after deployment: passed;
- portal artifact parse: passed with 230 unique static IDs;
- UI design-system audit: passed for seven root HTML pages and React;
- desktop dashboard visual QA at 1440 px: passed;
- responsive dashboard visual QA at 390 px: passed;
- migration sequencing: passed;
- readiness validation: passed;
- production database error-level lint: zero findings;
- `git diff --check`: passed.

## Operational note

The dashboard and heartbeat frontend changes are canonical repository source
but are not customer-visible until the final first-customer cPanel package is
uploaded manually. The backend analytics contract is live and ready.

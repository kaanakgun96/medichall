# Sprint 5 — Retention and Opportunity Notifications

Date: 2026-08-09

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Outcome

MedicHall now has one user-controlled notification pipeline for high-value
business events. The existing in-app notification center remains canonical.
Eligible events are projected into a private email outbox and delivered by one
Vault-backed cron function with stable provider idempotency keys, bounded
leases, retries, and redacted failure state.

The implementation covers:

- `NEW_TENDER_MATCH`;
- `HIGH_TENDER_MATCH`;
- `NEW_COMPANY_MATCH`;
- `CONNECTION_REQUEST`;
- `CONNECTION_ACCEPTED`;
- `NEW_RFQ`;
- `NEW_MESSAGE`;
- `MEETING_REQUEST`;
- `MEETING_CONFIRMED`;
- meeting reminders;
- `IMPORT_COMPLETE`;
- `TENDER_DEADLINE_APPROACHING` at 7, 3, and 1 day buckets;
- `WEEKLY_DIGEST`.

No payment, cPanel, `main`, or `develop` change is part of this sprint.

## Architecture

### Preferences

`user_notification_preferences` is user-owned and RLS-protected. Authenticated
RPCs expose only the current user's preferences:

- immediate RFQ and message alerts;
- tender alerts;
- matchmaking alerts;
- meeting reminders;
- weekly digest;
- IANA timezone.

Existing production users were backfilled with defaults and a first digest due
seven days after deployment. This avoids an immediate backlog digest. New
company, buyer, or matchmaking-profile activation ensures a preference row.

The production portal exposes the five requested switches inside the existing
notification center. Disabling an alert also suppresses an already queued but
unsent email at lease time. In-app notifications remain available.

### Durable delivery

`user_notification_email_outbox` is private, `FORCE ROW LEVEL SECURITY`, and
service-role only. It stores:

- one unique source notification;
- one stable provider idempotency key;
- event payload and type;
- pending, processing, retry, sent, failed, or suppressed state;
- bounded attempt and lease metadata;
- provider message ID;
- redacted error code and text.

The notification projection trigger catches its own errors. A provider,
configuration, or outbox failure therefore never rolls back the originating
RFQ, message, connection, meeting, import, or opportunity action.

`user-notifications` validates `x-cron-secret` in constant time, resolves the
recipient through Supabase Auth server-side, and sends through Resend. The API
key stays in the authorization header. The browser never receives a recipient
address, service-role key, provider ID, or Resend credential. Logs contain only
outbox ID, event type, attempt number, redacted provider-ID suffix, and safe
error codes.

### Scheduling and digest correctness

The new `medichall-user-notifications` job runs every 15 minutes and calls
`dispatch_user_retention_notifications()`. The stored command contains no
credential. The dispatcher reads only `medichall_project_url` and
`medichall_cron_secret` from Vault.

Deadline alerts are created only for open, saved/relevant tender matches at
exactly 7, 3, or 1 calendar days before deadline. The opportunity-and-bucket
dedupe key prevents repeats and no alert is created after the deadline.

Weekly digest values are queried from canonical production records for the
preceding seven days:

- new tender matches;
- new company matches;
- new RFQs;
- upcoming confirmed meetings;
- the strongest current, open opportunity by actual match score and deadline.

The digest scheduler advances a user's next due date once per ISO week. The
in-app and email layers each retain stable dedupe identity.

The legacy saved-search `tender-digest` remains a separate, explicitly enabled
daily saved-search service. Sprint 5 did not redeploy or modify it.

## Deployment gates

No plaintext Edge or Vault secret value was returned. Checks were limited to
secret-name presence, boolean target validation, and digest equality:

- `RESEND_API_KEY`: present;
- `COMPANY_ADMIN_NOTIFICATION_FROM`: present and used as the documented sender
  fallback;
- `CRON_SECRET`: present;
- `medichall_resend_api_key`: present in Vault;
- `medichall_cron_secret`: present in Vault;
- `medichall_project_url`: present and boolean-verified as the production URL;
- Edge and Vault cron secret digests: equal.

The previously verified `medichall.com` Resend domain and
`notifications@medichall.com` sender were retained. No credential or provider
cost setting changed.

Restricted pre-deployment backup:

- path: `/tmp/medichall-sprint5-predeployment-20260809.sql`;
- scope: schema-only `public` and `storage`;
- permissions: `0600`;
- size: 606,139 bytes;
- SHA-256:
  `7581f70953d2d17d5dc45d757d74821ae73c764408ce71128db1467c946c3668`;
- row-data `COPY`/`INSERT` statements: 0.

The linked dry run proposed exactly:

`202608090004_user_retention_notifications.sql`

That migration was applied once. The exact SQL regression then passed against
production and rolled back all fixtures. Only `user-notifications` was
deployed. Endpoint validation returned:

- `OPTIONS`: 204;
- unauthenticated `POST`: 401;
- Vault-backed cron invocation: HTTP 200 and handler reached.

The final linked dry run reports the remote database is up to date. Production
database error-level lint returns zero findings.

## Provider-backed QA

One explicitly tagged synthetic GoTrue identity used Resend's provider test
recipient. The first lease correctly returned `recipient_unavailable` because
the initial raw QA user omitted its GoTrue instance linkage; no Resend request
was made and the redacted retry path behaved correctly. Completing only that
QA identity allowed the same outbox row and unchanged idempotency key to be
retried.

Final provider result:

- handler jobs claimed: 1;
- provider sends: 1;
- retrying: 0;
- provider message IDs recorded: 1;
- Resend status lookup: HTTP 200;
- final provider state: `delivered`;
- repeated cron claimed: 0;
- repeated cron sent: 0;
- exactly one sent outbox row before cleanup: true.

The provider ID, recipient, and API key were not printed. The provider test
recipient is synthetic; no real customer was emailed during QA.

QA cleanup counts:

| Record | Before | After |
| --- | ---: | ---: |
| Auth users | 1 | 0 |
| Auth identities | 1 | 0 |
| Preferences | 1 | 0 |
| Portal notifications | 1 | 0 |
| Email outbox/provider metadata | 1 | 0 |
| Sent outbox rows | 1 | 0 |
| Companies | 0 | 0 |
| Matchmaking profiles | 0 | 0 |

Post-cleanup QA orphan count: 0.

## Production counts

| Object | Before | After | Expected change |
| --- | ---: | ---: | --- |
| Auth users | 6 | 6 | 0 |
| Companies | 6 | 6 | 0 |
| Portal notifications | 55 | 55 | 0 |
| Opportunity matches | 5,196 | 5,196 | 0 |
| Matchmaking matches | 5 | 5 | 0 |
| Tender imports | 0 | 0 | 0 |
| Notification preferences | 0 | 6 | +6 backfill metadata |
| User email outbox | 0 | 0 | QA cleaned |
| Cron jobs | 5 | 6 | +1 intended job |
| Migration ledger | 43 | 44 | +1 intended migration |

No real company, product, RFQ, message, tender, marketplace, matchmaking,
meeting, import, or customer record changed.

## Validation

- Deno shared tests: 121 passed, 0 failed;
- new notification helper tests: 8 passed, 0 failed;
- canonical Edge entrypoint typechecks: 15 passed;
- React tests: 96 passed across 16 files;
- React typecheck, lint, and production build: passed;
- Sprint 5 static regressions: 7 passed;
- exact production SQL regression: passed and rolled back;
- portal artifact parse: passed, 230 unique static IDs;
- desktop visual QA at 1440×1000: passed, no horizontal overflow;
- mobile visual QA at 390×844: passed, no horizontal overflow;
- migration sequencing: passed;
- readiness validation: passed;
- credential scan: 496 text files, no credential literals;
- `git diff --check`: passed;
- production database lint: zero errors.

## Remaining operational note

The production frontend was intentionally not uploaded to cPanel during this
sprint. The preference controls in `portal.html` become customer-visible only
in the final Sprint 6 cPanel release package. Backend event capture and secure
delivery are live now; preferences can already be managed through the
authenticated RPC contract.

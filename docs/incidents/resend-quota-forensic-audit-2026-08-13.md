# Resend quota forensic audit

Date: 2026-08-13

Production project: `azdmuarzntzqdyirysux`

Branch: `react-migration`

## Incident conclusion

The production database, scheduler and Resend metadata form one complete
causal chain:

1. Daily `medichall-ted-sync` refreshes opportunity matches for every indexed
   company after the 06:30 UTC tender sync.
2. Every newly inserted tender opportunity fires
   `notify_new_tender_opportunity` and creates one in-app `tender_match`
   notification.
3. `project_portal_notification_to_email` projects every one of those low
   priority notifications into a separate `NEW_TENDER_MATCH` outbox row.
4. `medichall-user-notifications` runs every 15 minutes and leases up to 40
   rows, sending each row individually through Resend.
5. Accepted requests are stored with provider IDs; quota failures are stored as
   `resend_http_429` and retried up to six times.

This is not duplicate insertion: all 1,227 current outbox rows have unique
notification links and idempotency keys. It is a fan-out design defect: one
new tender opportunity becomes one provider email even though the product
already has an idempotent weekly digest.

Severity: **BLOCKER** for production email delivery and **HIGH** for quota
retry amplification.

## Provider evidence

The read-only Resend `GET /emails` audit used six paginated metadata requests
per pass and sent no email. It returned 573 accepted messages in the last seven
days. There were no non-MedicHall subjects or senders.

| Istanbul date | Accepted | Delivered | Failed | Bounced |
| --- | ---: | ---: | ---: | ---: |
| 2026-08-13 | 202 | 201 | 1 | 0 |
| 2026-08-12 | 0 | 0 | 0 | 0 |
| 2026-08-11 | 166 | 166 | 0 | 0 |
| 2026-08-10 | 200 | 200 | 0 | 0 |
| 2026-08-09 | 5 | 4 | 0 | 1 |

Seven-day totals: 573 accepted, 571 delivered, one failed and one bounced.
Of the 573 accepted messages, 559 were `NEW_TENDER_MATCH` (97.56%), eight were
meeting emails, one was a message email and five were other MedicHall QA or
transactional messages. Five recipient addresses appeared. The highest-volume
masked recipients were `k***@yahoo.com` with 397 and
`e***@dispack.com.tr` with 166.

The provider IDs for 568 messages reconcile to current production outbox rows.
The remaining five are MedicHall operational history whose synthetic or direct
source rows are no longer present. Provider IDs are unique. No full recipient
or provider ID was printed or stored in this report.

## Production database evidence

Snapshot at 2026-08-13 08:31 UTC:

| User outbox state | Rows | Recorded claim attempts | Provider IDs |
| --- | ---: | ---: | ---: |
| sent | 568 | 568 | 568 |
| failed | 342 | 2,052 | 0 |
| retry | 127 | 127 | 0 |
| pending | 190 | 0 | 0 |
| processing | 0 | 0 | 0 |

The admin-registration outbox contains two historical sent rows and no active
work. The user outbox contains 1,214 `NEW_TENDER_MATCH` rows, 98.94% of its
1,227 logical messages. Those tender rows account for 2,674 of the initial
2,707 recorded claim/provider attempts; after the 08:30 UTC run the current
total rose to 2,747. All 2,179 unsuccessful current attempts are explicitly
recorded as Resend HTTP 429 responses.

Today generated 519 new user outbox rows at the post-TED-sync burst. At the
first sample, 230 were pending and 87 were retrying. The next scheduled run
moved exactly 40 more rows from pending to `resend_http_429` retry, leaving 190
pending and 127 retrying. This proves a current provider request rate of 40 per
15-minute worker run, or 160 per hour, while the backlog remains due. Current
outbox generation is zero per hour outside the daily sync burst; the 24-hour
generation count is 519.

The database chain reconciles 5,977 current tender opportunities to 1,206
linked tender notifications and 1,206 linked outbox rows. Of those linked
rows, 557 have provider acceptance IDs and 419 currently record quota errors.
The small difference from the 1,214 tender notifications is historical payload
shape, not duplicate outbox insertion.

## Schedulers and other email paths

| Job | Schedule | Finding |
| --- | --- | --- |
| `medichall-ted-sync` | `30 6 * * *` | Generates/refreshed opportunities; it is the upstream fan-out trigger. |
| `medichall-tender-digest` | `0 7 * * *` | Zero saved searches, zero users with news and zero sends today. |
| `medichall-company-admin-notification` | `*/2 * * * *` | No active outbox; two historical sent rows only. |
| `medichall-user-notifications` | `*/15 * * * *` | Leases up to 40 rows and currently makes 40 quota-rejected requests per run. |

There is one active registration for each job and no duplicate email
scheduler. The user worker invokes the weekly digest scheduler before claiming
delivery work. Weekly digest keys contain the ISO week and user ID, and
`next_digest_at` advances seven days, so repeated scheduler runs do not create
duplicate digests.

The separate saved-search digest groups all searches into one email per user
per run, but currently has zero saved searches. It does not contribute to the
incident. It does not set a provider idempotency header, which remains a
medium-priority dormant hardening issue.

RFQ request, message and offer triggers can call the Vault-backed Resend helper
directly. Production had zero RFQ requests, messages or offers in the last
seven days, and recent `pg_net` responses contain no direct Resend call. These
paths did not contribute to current quota use.

## Retry and delivery behavior

The deployed outbox allows six attempts. It uses stable database and provider
idempotency keys, marks successful requests sent and does not lease sent rows
again. No duplicate logical outbox rows or duplicate provider IDs exist.

Before remediation, a 429 without `Retry-After` uses 30/60/120/240/480-second
database delays. Because the worker runs every 15 minutes, due rows are
effectively retried every 15 minutes until attempt six. This is bounded, but it
amplified 342 logical failures into 2,052 quota-rejected provider requests.
Permanent Resend 4xx responses also follow the same six-attempt path.

`pg_net` timed out on the long-running user worker at every 15-minute run after
the backlog appeared. The Edge worker still completed row transitions. Stable
provider idempotency and sent-state checks prevented duplicate accepted
messages, but the dispatcher timeouts obscure worker outcomes in cron history.

## QA and shared-key findings

The previous approximately 2,808 QA outbox rows are not present. Two old
`c***@example.com` QA identities and the exact `Bosporus Medical QA` company do
remain, but they have zero current email outbox rows and zero opportunity
matches, so they did not consume this quota. They are a separate data-hygiene
finding and were not modified during this audit.

The only other active accessible MedicHall QA Supabase project has no
Resend-named secret. The audit environment has no Resend key in its process
environment. Provider metadata contains zero non-MedicHall messages in the
seven-day window. Shared-key consumption by another known project or
application is therefore not supported by the evidence.

## Database and CPU impact

`pg_stat_statements` recorded 2,205 notification retry calls at 2.887 ms mean,
586 completions at 2.137 ms mean and 421 claims at 52.330 ms mean. No active
email session and no idle transaction existed at the audit sample. Email
processing is unnecessary database and Edge/provider load, but it is not the
source of the earlier database CPU storm. No load test was run.

## Security findings

- The Resend key remains in Edge secrets and Vault only. It is not present in
  browser assets or repository credential scans.
- Both outboxes deny anonymous and authenticated access. Delivery, claim,
  completion and retry functions are service-role only.
- Email Edge Functions validate a Vault-backed cron secret before claiming
  work. Recipients are resolved server-side from Auth or fixed server-side
  configuration.
- User notification HTML escapes notification content and constrains action
  links to the MedicHall portal.
- The legacy direct RFQ email templates interpolate some business-message
  fields without HTML escaping. They cannot select an arbitrary recipient, but
  this is a separate medium-priority content-injection hardening item.

## Prepared remediation

Migration `202608130003_resend_quota_guard.sql` is the only proposed production
change. It:

1. keeps `tender_match` and `tender_match_high` in-app but stops projecting
   them as individual provider emails;
2. preserves transactional events, tender deadline alerts and the existing
   weekly digest;
3. marks only pending/retry tender-email backlog as `suppressed`, retaining
   sent and failed rows as incident evidence;
4. defers 429 responses for six hours when the provider supplies no longer
   delay; and
5. makes permanent 400/401/403/404/422 provider failures terminal immediately.

No Edge Function or frontend change is required. The linked dry run proposes
only this migration. Local mock/static tests pass, but the production
rollback-only rehearsal and deployment require explicit approval. No
production remediation has been applied by this task.

## Audit safety

Actual emails sent by the audit: **0**.

Provider test emails: **0**.

Provider metadata GET requests: **12** across two aggregate passes.

Database writes, preferences changed, notifications created and customer rows
changed by the audit: **0**.

cPanel patch: **not required**.

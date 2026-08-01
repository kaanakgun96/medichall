# Resend company-registration notification audit — 2026-08-01

## Scope and safety

This audit traced the production company-registration path without querying or
recording names, email addresses, request bodies, API keys, or other personal
data. Production project `azdmuarzntzqdyirysux` was inspected read-only. No
production migration, secret update, Edge Function deployment, email send, or
data mutation was performed.

The implementation was exercised only in isolated acceptance project
`gskvajrghfwcvvykrdni` after the second fresh-install baseline had passed.

## Root cause

The missing admin email was not a delivery failure. Company registration had no
server-side notification path:

1. `portal.html` inserts directly into `public.companies` and returns success.
2. Production had only the slug and updated-at triggers on `public.companies`.
3. No company-registration notification Edge Function was deployed.
4. No notification or Resend cron job existed for company registration.
5. The production Edge secret inventory contained neither `RESEND_API_KEY` nor
   a company admin notification recipient.

The real registration was present in the 2026-07-30 05:00 UTC hourly bucket,
with one auth user and one company created in that bucket. Because there was no
trigger or callable notification path, that registration did not attempt a
Resend API call and could not have produced a provider message ID or delivery
event.

## Production compatibility findings

| Audit point | Production finding |
| --- | --- |
| Company notification code | Absent |
| Company notification deployment | Absent |
| Company trigger | Absent; only slug and updated-at triggers existed |
| Notification Edge execution | Impossible for this registration |
| Resend API call | Not attempted by the registration flow |
| API success / provider ID | Not applicable; no call was made |
| Email delivery | Not applicable; no message existed |
| Admin recipient | A legacy database recipient was configured and was observed only in redacted form (`i***@medichall.co`) |
| Edge environment | `RESEND_API_KEY` and a company notification recipient were absent |
| Vault environment | No Resend-named Vault secret existed |
| Sender | Legacy sender function resolves to the `medichall.com` domain |
| Verified domain | Cannot be established from Supabase; the exact sender domain must be confirmed as verified in the Resend dashboard before deployment |
| Historical errors | The target window was older than the Free plan's one-day log retention, so no historical request or Edge log remained |

Production also contained a probable provider credential embedded in the
legacy `notify_email` database function definition. The value was never read
into this report, logs, source changes, terminal output, or browser output. It
must be rotated. The reconstructed repository baseline already replaces that
definition with a Vault lookup; the new migration enforces the same safe
definition in environments that drifted from the baseline.

## Implemented remediation

Migration `202608010001_company_admin_notification_outbox.sql` adds:

- a private, RLS-enabled outbox with one row per company-registration event;
- an `AFTER INSERT` company trigger using `ON CONFLICT DO NOTHING`;
- exception isolation so email infrastructure can never roll back company
  registration;
- a seven-day deterministic backfill, which includes the registration that
  prompted this audit when the migration is deployed within that window;
- service-role-only claim, complete, retry, and dispatch functions;
- leases, `FOR UPDATE SKIP LOCKED`, six attempts, bounded exponential backoff,
  stale-lease recovery, and a terminal failed state;
- a two-minute Vault-backed pg_cron dispatcher;
- replacement of the legacy credential-bearing `notify_email` definition with
  the baseline Vault-backed implementation.

The new `company-admin-notification` Edge Function:

- authenticates only with `x-cron-secret` and keeps platform JWT verification
  disabled intentionally;
- validates its Resend key and recipient before claiming work;
- sends through `POST /emails` with a stable `Idempotency-Key` of
  `company-registration/<outbox-id>`;
- records the Resend provider message ID only after a successful response;
- stores only bounded error codes such as `resend_http_503`, never provider
  bodies, addresses, keys, or company details;
- leaves registration independent of delivery and schedules failed deliveries
  for retry.

Resend documents that `Idempotency-Key` prevents duplicate sends for repeated
requests during its 24-hour retention window. MedicHall's complete retry budget
is scheduled inside that window.

## Automated coverage

`supabase/functions/_shared/company-admin-notification.test.ts` covers:

1. successful notification and provider message-ID persistence;
2. stable idempotency for duplicate processing;
3. redacted handling of a Resend failure;
4. missing API key;
5. missing admin recipient;
6. retry behavior and `Retry-After` handling.

`supabase/tests/company_admin_notification.sql` additionally covers:

- trigger enqueueing and duplicate suppression at the database layer;
- registration success when the outbox insert is deliberately forced to fail;
- RLS and API-role privilege isolation;
- claim, retry, second-attempt, and completion state transitions;
- provider message-ID persistence;
- Vault use and absence of a probable provider key in `notify_email`.

The migration and SQL test passed transactionally in isolated acceptance
project `gskvajrghfwcvvykrdni`. The QA Edge Function returned `204` for OPTIONS
and `401` for an unauthenticated POST. No real provider key, recipient, or email
send was used in QA. Final QA evidence showed 40 migration-ledger rows through
`202608010001`, the company trigger and cron job present, no anonymous claim
privilege, and one expected backfilled outbox row left pending because QA had no
provider configuration.

## Required production deployment sequence

No step below was performed automatically.

1. Rotate the legacy Resend API key whose value was embedded in the production
   database function. Revoke the old key after the new configuration is ready.
2. In Resend, verify that the exact domain used by
   `COMPANY_ADMIN_NOTIFICATION_FROM` is verified. The repository default is
   `medichall.com`; a verified subdomain may be used instead if the secret is
   set to an address on that exact subdomain.
3. Add production Edge secrets without placing values in the repository,
   browser files, shell history, or deployment logs:
   `RESEND_API_KEY`, `COMPANY_ADMIN_NOTIFICATION_RECIPIENT`, and optionally
   `COMPANY_ADMIN_NOTIFICATION_FROM`.
4. Confirm production `CRON_SECRET` matches the Vault secret
   `medichall_cron_secret`, and that Vault contains the correct
   `medichall_project_url`.
5. Store the rotated Resend key in Vault as `medichall_resend_api_key` so the
   existing RFQ, message, and offer notification triggers continue to work
   after the legacy function is scrubbed.
6. Deploy only `company-admin-notification` with platform JWT verification
   disabled; the function enforces `x-cron-secret` itself. Do not invoke it yet.
7. Apply `202608010001_company_admin_notification_outbox.sql` to production;
   this creates and starts the dispatcher only after the endpoint exists.
8. Confirm the backfilled registration advances from `pending` to `sent`, a
   provider message ID is recorded, and Resend reports the intended recipient
   as delivered. Do not print the recipient or message content in deployment
   evidence.
9. Exercise a duplicate dispatcher call and confirm the outbox remains `sent`
   with the same provider ID and only one Resend message.

## Deployment readiness

The code and migration are ready for deployment after the key rotation, secret
configuration, and exact sender-domain verification above. Production remains
unchanged at the end of this audit.

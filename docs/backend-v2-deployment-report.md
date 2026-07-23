# Backend v2 deployment report

Deployment date: 2026-07-23

Target identifiers, hosts, connection strings, authorization material, secret
values, and Vault contents are intentionally omitted.

## Scope

The controlled deployment installed:

- `202607230002_document_intelligence_v2.sql`;
- `202607230003_match_score_v2.sql`;
- the canonical `tender-attachment-discovery` function;
- the canonical `tender-document-engine` function;
- the reviewed Vault-backed definitions for the two existing cron jobs.

No React source, production HTML, authentication configuration, Storage
policy, `medichall-ai` function, `develop` branch, or `main` branch was changed.

## Safety gates

- The repository was on `react-migration` at the expected starting commit.
- Local and remote branch heads matched before work started.
- The linked target matched the verified MedicHall project.
- The pre-deployment migration history contained 15 aligned migrations.
- The final dry run proposed only the two migrations listed above.
- Both migrations plus the SQL, RLS, and RPC tests passed inside a transaction
  that ended in `ROLLBACK`.
- A fresh schema-only and structural backup was written to a timestamped
  subdirectory of the ignored `supabase/baseline/live/` directory. The
  directory and files are owner-only. It contains no customer rows or secret
  values.

The pre-deployment linked database lint found one existing error in
`register_uploaded_tender_documents(bigint,bigint,jsonb)`: the old body
referenced a column that does not exist. Migration `202607230002` repairs the
body without changing its public signature or integer return type. The
post-migration database lint returned zero issues.

## Cron and Vault

The two existing jobs were inspected before replacement. Their names,
schedules, and targets were correct, but their stored commands contained
hardcoded target and authentication material.

The deployment:

- rotated the Edge Function `CRON_SECRET`;
- created or updated `medichall_project_url`;
- created or updated `medichall_cron_secret`;
- verified the Vault cron secret and Edge Function secret originated from the
  same protected rotation value without displaying it;
- replaced, rather than duplicated, the two jobs;
- preserved `medichall-ted-sync` at `30 6 * * *`;
- preserved `medichall-tender-digest` at `0 7 * * *`;
- verified both stored commands reference Vault and contain neither the
  project URL nor the rotated secret as literals.

The scheduled targets do not provide a safe no-op or dry-run mode. They were
not invoked because doing so could start a production crawl or send a digest.

## Verification results

- Repository readiness: passed.
- Changed-source Deno formatting: passed.
- Six canonical Edge Function typechecks: passed.
- Deno tests: 20 passed, 0 failed.
- React typecheck: passed.
- React lint: passed.
- React tests: 44 passed, 0 failed.
- React production build: passed.
- Phase 0 SQL verification: passed and rolled back.
- Document intelligence v2 SQL verification: passed and rolled back.
- Match Score v2 regression, idempotency, and RLS verification: passed and
  rolled back.
- RPC compatibility verification: passed and rolled back.
- Linked database lint after deployment: zero issues.
- Remote migration history: 17 local/remote versions aligned.
- Five canonical Edge Functions: active.
- Changed function JWT configuration: preserved.
- Required Edge Function secret names: present.
- Vault entries and cron uniqueness/schedules/targets: verified.
- Internal Match Score v2 table: RLS enabled and inaccessible to an ordinary
  user in the RLS test.
- New Match Score v2 rows after deployment: zero; no broad recomputation ran.
- Core production row counts before/after: unchanged.
- Legacy opportunity score fingerprint before/after: unchanged.
- Legacy RPC definition hashes before/after: unchanged.
- One unauthenticated request to each changed function: rejected at the JWT
  boundary without creating a job.

Authenticated live invocations of discovery and extraction were deliberately
not run. They require a real partner context and can enqueue network crawling
or AI processing. Their structured results, bounds, evidence rules, retries,
and idempotency are covered by unit tests and rollback-based SQL tests.

## Rollback

1. Stop calling the new targeted Match Score v2 RPCs.
2. Redeploy the immediately preceding versions of the two changed canonical
   functions with their existing JWT settings.
3. Mark the v2 pipeline-version rows non-current and restore their preceding
   rows as repository-current.
4. Leave additive columns and comparison/audit rows in place.
5. If cron is the failure source, unschedule only the two named jobs and
   restore their last reviewed definitions through a protected operator
   session.

Rollback does not require deleting customer data, Storage objects, or
migration history.

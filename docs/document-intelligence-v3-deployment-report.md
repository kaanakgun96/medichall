# Document Intelligence v3 deployment report

Deployment date: 2026-07-23

Target identifiers, hosts, connection strings, authorization material, secret
values, and customer data are intentionally omitted.

## Approved scope

- Migration:
  `202607230004_document_intelligence_v3.sql` and the metadata-only
  `202607230005_document_intelligence_v3_runtime_compatibility.sql`
- Edge Function:
  canonical `tender-document-engine`
- JWT verification:
  preserved as enabled
- Branch:
  `react-migration`

Explicitly excluded:

- React and production HTML;
- `develop` and `main`;
- `medichall-ai` and every unrelated Edge Function;
- authentication, Storage, cron, Vault, and secrets;
- broad AI processing or all-company score recomputation.

## Pre-deployment gates

- The branch was `react-migration`, and local/remote heads matched at the
  expected backend v2 commit before work.
- The linked target matched the verified MedicHall project.
- The initial 17 migration versions were aligned.
- The first dry run proposed only `202607230004`.
- A fresh owner-only schema and aggregate structural baseline was stored under
  the ignored `supabase/baseline/live/` directory. It contains no customer
  rows or secret values.
- The migration plus v3, v2, Match Score v2, RPC compatibility, Phase 0, and
  RLS tests passed inside a transaction ending in `ROLLBACK`.
- Linked database lint returned zero errors.
- Repository readiness, Deno typecheck/tests, React compatibility gates, and
  the repository secret scan passed before deployment.

## Deployment result

`202607230004` applied successfully. It created only the reviewed additive
schema, service-only claim RPC, RLS policies, grants, and v3 pipeline-version
rows.

The first two server-side function bundle attempts returned an internal
Supabase error before a new version was activated. Read-only inventory
confirmed the prior engine remained active. The failure was isolated to the
large npm dependency graph of `pdfjs-dist`.

The parser was changed to the pinned modern-Deno ESM build of the same
`pdfjs-dist@4.10.38` version. Generated 120-, 250-, and 500-page PDF tests,
typecheck, and all Deno tests passed again. The canonical
`tender-document-engine` then deployed successfully as active version 16 with
JWT verification still enabled.

`202607230005` records only the final deployable parser, engine, bootstrap
manifest, and final manifest hashes. Its dry run proposed only that file; its
transactional preflight passed and rolled back before it was applied. No
schema, RLS, RPC, authentication, Storage, or production-row contract changed
in the compatibility migration.

## Post-deployment verification

- Repository readiness: passed with 19 unique migrations and all recorded
  hashes verified.
- Deno typecheck: passed.
- Deno tests: 31 passed, 0 failed.
- Synthetic PDFs: 120, 250, and 500 pages passed.
- React typecheck: passed.
- React lint: passed.
- React tests: 44 passed, 0 failed.
- React production build: passed.
- All SQL regression/RLS/idempotency tests: passed and rolled back.
- Remote migration history: 19 local/remote versions aligned.
- Linked database lint: zero errors.
- Inspection/chunk tables: present with RLS enabled.
- Atomic service-only claim RPC: present.
- Current v3 pipeline versions: exactly two.
- Canonical function: active at version 16 with JWT verification enabled.
- Unauthenticated function request: rejected with HTTP 401 without creating a
  job.
- Core production row counts: unchanged.
- Legacy opportunity-score fingerprint: unchanged.
- Existing queue/status and targeted matching RPC definition hashes:
  unchanged.
- New production inspection rows: zero.
- New production chunk rows: zero.
- No broad document processing or score recomputation ran.

An authenticated extraction was not started merely as a smoke test because it
requires a real partner context and would perform network and AI work. The
deployed JWT boundary, large-PDF pipeline, resume behavior, merge behavior,
and data contracts were verified without creating unsolicited production
jobs.

## Rollback

1. Redeploy the preceding canonical `tender-document-engine` bundle.
2. Stop v3 chunk claims.
3. Restore v2 pipeline versions as repository-current.
4. Retain additive v3 rows and columns for audit.
5. Do not delete production data, evidence, matches, Storage objects, or
   migration history.

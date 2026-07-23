# Matching Phase 0 repository-readiness report

Report date: 2026-07-23

Repository: `kaanakgun96/medichall`

Branch: `react-migration`

Reviewed base commit: `3beeed858710135a3b31ef87c6bbb1f6a72e4966`

## Outcome

**The repository-side Phase 0 deployment blockers are fixed. Nothing was
deployed.**

The repository is ready for an authorized staging baseline and deployment
preview. This does not mean that production can be changed without the live
verification gates listed below.

No Supabase project was linked. No migration, SQL statement, migration-history
repair, Edge Function, secret, cron job, storage setting, authentication
setting, production record, smoke-test job, or crawl was created or changed.
No Git remote or stable branch was modified.

## Blockers resolved

### Edge Function validation

The shared observability client now has a narrow query-builder boundary that
accepts the current Supabase client without weakening runtime behavior.
`tender-document-engine` uses an explicit generic Supabase client type and a
typed document record instead of relying on invalid inferred database types.

The three functions using `EdgeRuntime.waitUntil` reference a shared runtime
declaration. All five canonical Phase 0 functions pin
`@supabase/supabase-js` to `2.110.8`.

`supabase/functions/deno.json` enables strict checking and
`supabase/functions/deno.lock` locks the complete dependency graph. Frozen
Deno checking now succeeds for:

- `supabase/functions/ted-sync/index.ts`;
- `supabase/functions/ted-notice-resolver/index.ts`;
- `supabase/functions/tender-attachment-discovery/index.ts`;
- `supabase/functions/tender-archive-worker/index.ts`;
- `supabase/functions/tender-document-engine/index.ts`;
- `supabase/functions/_shared/matching-observability.ts`.

### Migration history

The active migration directory now contains 15 SQL files with 15 unique
numeric versions.

- The SQL from the former duplicate
  `202607100005_match_engine_v2_scoring.sql` is consolidated, byte-for-byte and
  in its previous execution order, into
  `202607100005_explainable_match_engine.sql`.
- The original scoring source is retained under
  `supabase/migration-archive` for audit context and is not executable by the
  Supabase CLI.
- `202607100006_tender_document_engine.sql` is the sole active migration with
  version `202607100006`.
- The former duplicate TED cron file is represented by a non-executable
  archive marker. Its original content remains recoverable from Git history.

This strategy avoids inventing a new historical version and avoids a
migration-history repair. Because existing live history was not available, a
live migration preview remains mandatory before any staging change.

### Cron and credential handling

Active migrations and setup SQL no longer contain:

- a project-specific Edge Function URL;
- a cron-secret substitution placeholder;
- a literal `x-cron-secret` value.

Cron is intentionally separate from schema migration.
`supabase/setup/CONFIGURE-CRON.sql` reads `medichall_project_url` and
`medichall_cron_secret` from Supabase Vault at runtime and stores no decrypted
credential in `cron.job`. The TED backfill helper uses the same Vault inputs.

Historical versions of the old cron files may have contained a credential.
Repository cleanup cannot make an exposed credential safe. An authorized
owner must rotate it before any deployment and provide the replacement only
through the Edge Function secret manager and Vault, never through Git, chat,
SQL literals, or terminal arguments.

### Canonical deployment scope

`supabase/observability/phase-zero-deployment.json` is the machine-readable
Phase 0 scope. It selects exactly the five root Edge Function entrypoints,
their JWT policy, the Phase 0 migration, and the hashed Deno runtime inputs.

The differing files under `supabase/functions/medichall-ai` are explicitly
excluded from Phase 0. They remain legacy references; they are not deployment
aliases and must not be substituted for a manifest entry.

`supabase/config.toml` now records the JWT policy for each canonical function:

| Function | `verify_jwt` |
|---|---:|
| `ted-sync` | `false` |
| `ted-notice-resolver` | `true` |
| `tender-attachment-discovery` | `true` |
| `tender-archive-worker` | `true` |
| `tender-document-engine` | `true` |

### Version lineage

Every changed source hash was regenerated in both:

- `supabase/observability/pipeline-versions.json`;
- `supabase/migrations/202607230001_matching_phase_zero_observability.sql`.

The manifest additionally hashes the Deno config and lockfile. These hashes
identify repository content only; they do not claim that anything is live.

## Automated readiness gate

Run:

```bash
node scripts/check-phase0-readiness.mjs
```

The gate fails when:

- the current branch is not `react-migration`;
- migration versions are duplicated or filenames are invalid;
- the canonical scoring block or its archive record is missing;
- the Phase 0 deployment scope changes unexpectedly;
- a root function has a floating Supabase import or wrong JWT policy;
- `EdgeRuntime` is used without the shared declaration;
- a recorded source/runtime hash is stale;
- active SQL contains a project-specific function URL, cron placeholder, or
  literal cron header value;
- documentation tells an operator to recover a secret from `cron.job`;
- tracked or unignored files contain common private-token patterns.

Latest result:

```text
Phase 0 repository readiness: PASSED
(15 unique migrations, 5 canonical functions, hashes verified)
```

## Verification results

All executed checks passed.

| Check | Result |
|---|---|
| Branch | `react-migration` |
| `git diff --check` | Passed |
| Consolidated scoring SQL vs original source | Exact match |
| Phase 0 readiness gate | Passed |
| Deno version | `2.9.3` |
| Frozen Deno check, shared module + five root functions | Passed |
| Frozen Deno observability tests | 8 passed, 0 failed |
| Node observability tests | 8 passed, 0 failed |
| `pnpm install --frozen-lockfile` in `apps/portal-react` | Passed; already up to date |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm test` | 12 files and 44 tests passed |
| `pnpm build` | Passed; 1,850 modules transformed |
| Current repository probable-secret gate | Passed |
| Production HTML modified | No |

No command is reported as successful unless it was actually executed.

## Phase 0 database safety review

The intended deployment migration remains:

`supabase/migrations/202607230001_matching_phase_zero_observability.sql`

Repository inspection confirms that it:

- does not drop or truncate a table or schema;
- does not delete or rewrite tender, company, product, match, benchmark, or
  authentication data;
- does not replace `refresh_company_opportunity_matches`,
  `refresh_explainable_tender_matches`, or `search_tenders`;
- does not change score weights, candidate rules, score interpretation, or
  existing score values;
- does not trigger a company-by-tender recomputation;
- does not modify authentication, storage, cron, or the production portal;
- adds diagnostics with admin-only authenticated reads and service-role
  writes;
- represents CAPTCHA, login, membership, paid access, terms acceptance, and
  forbidden access as restricted classifications;
- does not implement access-control circumvention.

The migration references existing document/discovery/archive tables. Their
presence and live shape must be verified against a structural baseline before
staging application.

## Checks intentionally not executed

These checks require an authorized isolated Supabase/PostgreSQL environment
and were not simulated or bypassed:

- authorized project listing and target verification;
- live structural baseline export;
- live migration-history comparison;
- clean full-chain migration application;
- `supabase/tests/matching_phase_zero_observability.sql`;
- live RLS and cross-company isolation checks;
- live cron/Vault behavior;
- storage policy verification;
- deployed Edge Function source/version comparison;
- controlled tender smoke tests.

Docker, `psql`, `pg_dump`, a database URL, project reference, and Supabase
access token were not available. Their absence is no longer a repository-code
blocker; it is an explicit staging gate.

## Required staging gates

Before any deployment, an authorized operator must:

1. Rotate the historically exposed cron credential.
2. Verify the exact target project using credentials supplied outside chat and
   outside the repository.
3. Capture the structural baseline described in
   `docs/supabase-live-baseline.md`.
4. Compare live RPC bodies, signatures, grants, RLS, cron metadata, storage
   policies, migration versions, and deployed Edge Function versions.
5. Preview migration history and cancel if the CLI proposes any historical
   migration instead of only the intended Phase 0 change.
6. Apply the full chain to an isolated staging database and run
   `supabase/tests/matching_phase_zero_observability.sql`.
7. Confirm the five root manifest entrypoints match the intended deployed
   predecessors.
8. Obtain a separate explicit approval before making a staging or production
   change.

No fake migration record, destructive repair, force push, database reset, or
production-data deletion is an acceptable shortcut.

## Staging verification after an approved deployment

After the migration and functions are applied to staging, verify:

- diagnostic tables, views, constraints, grants, and RLS;
- cross-company isolation with two ordinary staging users;
- pipeline/version lineage and trace parent relationships;
- sanitization of URLs, metadata, errors, and logs;
- unchanged scores and RPC outputs for representative existing cases;
- public, restricted, archive, and notice-only document classifications;
- benchmark two-annotator and adjudication constraints;
- Vault-backed cron execution without a literal credential in `cron.job`.

Use only owner-supplied staging tender IDs and URLs. Do not invent production
records or bypass CAPTCHA, login, membership, payment, terms, or other access
controls.

## Rollback

Prefer application-first rollback:

1. redeploy the exact predecessor function bundles captured in the baseline;
2. stop new Phase 0 trace writes;
3. preserve diagnostic records for incident analysis;
4. restore only an affected RPC or policy from the verified baseline if a
   compatibility issue is proven.

The Phase 0 database migration is additive. Leave its tables and columns in
place by default. A destructive schema rollback requires a new export and
explicit approval because it would destroy lineage.

## Final status

Repository status: **ready for authorized staging preview**.

Deployment status: **not deployed**.

Production approval: **not requested and not implied**.

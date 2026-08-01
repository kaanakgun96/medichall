# Production migration sequencing remediation — 2026-08-01

## Outcome and scope

This change prepares, but does not execute, a forward-only compatibility
release for production project `azdmuarzntzqdyirysux`. No migration, Edge
Function, e-mail, portal artifact, or customer row was changed while preparing
it.

Supabase applies migration files by timestamp and compares them with the
remote migration ledger. Its documented history repair command is appropriate
only when the schema change already exists; it is not an ignore mechanism for
an absent feature. See the official
[database migration guide](https://supabase.com/docs/guides/deployment/database-migrations).
Supabase branches provide isolated databases for validating future feature
sequences; see [branching](https://supabase.com/docs/guides/deployment/branching).

## Root cause and classification

The repository contained six local versions absent from the production ledger.
Standard `db push --include-all` correctly proposed all six in timestamp order,
even though they represent different conditions:

- Definition drift: `202607090001`, `202607100009`, and `202607290003`.
- Intentionally undeployed Module 1: `202607290001` and `202607290002`.
- Intended next release: `202608010001`.

The first two baseline versions are structurally present in production but
have verified function-definition drift. The metadata migration is unsafe as
written because it overwrites legitimate live pipeline verification fields.
The two Module 1 versions and every one of their material objects are absent.

## Repository sequencing strategy

1. Keep `202607090001` and `202607100009` in the canonical migration chain for
   deterministic empty-project installation.
2. Add `202608010002_production_compatibility_and_metadata.sql` after the
   published current latest migration. It fixes only verified function drift
   and writes repository hashes only into namespaced pipeline metadata.
3. Preserve the byte-identical `202607290003` source in
   `migration-archive/superseded-production-drift`. The new migration replaces
   its safe metadata intent without changing `content_sha256`,
   `live_verification_status`, or `live_verified_at`.
4. Preserve the byte-identical Module 1 migrations in
   `migration-archive/universal-tender-import`. They are not executable, are
   not marked applied, and must be reissued with new versions from the future
   production head.
5. Record the exact production ledger, immutable archive hashes, permitted
   drift repairs, and target-only end state in
   `production-migration-sequence.json`. The sequencing regression fails if an
   archived version re-enters the canonical chain or if the hypothetical final
   dry-run contains anything besides `202608010001`.

This keeps current production free of Module 1, gives fresh installs one
deterministic canonical chain, gives future Module 1 a clean forward-only
branch point, and retains every published SQL byte plus its hash for audit.

## Verified production drift repaired by `202608010002`

- Sets the intended `public, pg_temp` search path on the core identity, slug,
  constant, RFQ, message, and offer helpers without replacing their bodies.
- Replaces `notify_email` with the approved Vault-backed implementation and
  removes browser execution.
- Recreates `company_is_public(bigint)` transactionally with input metadata
  `p_company_id bigint`; its sole product policy dependency is recreated
  without `CASCADE`.
- Restores historical browser revokes for trigger helpers and slug generation,
  while preserving intended `is_admin` and company-visibility grants.
- Restores least-privilege authenticated reads and profile-upsert grants on the
  four original matchmaking tables for empty-install parity. It deliberately
  does not reproduce production's legacy anonymous table grants; RLS remains
  the row-authorization boundary. Service-role access is explicit.
- Recreates `medichall_public_stats()` from the exact repository contract with
  its return type, volatility, security-definer property, search path, and
  grants unchanged from the intended definition.
- Updates only repository-owned JSON metadata for four current pipeline rows.
  Operational content hashes, live verification statuses, and live verification
  timestamps are intentionally retained.

## Gated production runbook

Do not run this procedure until the committed branch is clean and local HEAD
matches `origin/react-migration`.

1. Take the repository-standard restricted schema backup and record aggregate
   customer/core counts.
2. Run all rollback-only Group A probes and capture catalog hashes, grants,
   `company_is_public` dependencies, the four pipeline operational fields, and
   the 34-row verified migration ledger.
3. Build a one-migration release root from the audited ledger plus the new
   compatibility migration:

   ```sh
   node scripts/prepare-production-compatibility-release.mjs \
     --output /private/tmp/medichall-compatibility-release-20260801
   supabase link \
     --workdir /private/tmp/medichall-compatibility-release-20260801 \
     --project-ref azdmuarzntzqdyirysux
   supabase db push \
     --workdir /private/tmp/medichall-compatibility-release-20260801 \
     --linked --dry-run
   ```

   Stop unless the isolated dry run proposes only
   `202608010002_production_compatibility_and_metadata.sql`. The prepared root
   contains all 34 verified remote versions so it does not falsify or omit the
   existing production ledger; it deliberately excludes every unverified
   pending version.
4. Apply only that compatibility migration from the same reviewed release
   root. Run the exact compatibility regression, production lint, function
   hash/grant checks, and before/after aggregate counts.
5. Only after every material effect of `202607090001` and `202607100009`
   matches, use the official `supabase migration repair --status applied`
   command for those two versions. Do not repair `202607290001`,
   `202607290002`, or `202607290003`.
6. From the canonical repository run:

   ```sh
   supabase db push --linked --include-all --dry-run
   ```

   Stop unless it proposes exactly
   `202608010001_company_admin_notification_outbox.sql` and nothing else.
7. The company-notification deployment may resume only after that exact gate.
   Its migration, single Edge Function deployment, cron validation, and
   exactly-once backfill remain a separate authorized task.

At each write gate, compare the aggregate counts and catalog fingerprints with
the preflight evidence. Any unexpected delta requires stopping before history
repair or notification deployment.

## Future Module 1 release

Create an isolated feature branch/project from the then-current production
head. Copy the archived intent into newly timestamped forward-only migrations,
review it against current schema, and run the full Universal Tender Import SQL,
Deno, browser, RLS, Storage, and fresh-install suites. Never restore the old
`202607290001` or `202607290002` versions to the canonical directory and never
mark them applied in a project where their objects are absent.

## Preparation validation results

No migration was committed to production or remote QA during these checks.

- Production rollback-only probe: passed with the migration's only `COMMIT`
  mechanically replaced by `ROLLBACK`. Its embedded assertions verified exact
  search paths, `company_is_public` argument metadata, the normalized public
  stats body hash, Vault-only mail source, function revokes, authenticated
  portal grants, and four metadata rows.
- Production before/after: ledger `34`; auth users `6`; companies `6`;
  products `39`; RFQs `14`; offers `0`; messages `7`; tenders `2,202`;
  opportunity matches `1,991`; matchmaking profiles `4`; connections `2`;
  meetings `8`; pipeline versions `17`; Storage objects `75`. The new metadata
  marker remained `0`, Module 1 and notification outbox remained absent, and
  the legacy function markers returned after rollback.
- Remote QA staging probe: the same final migration passed rollback-only on
  `gskvajrghfwcvvykrdni`. Its ledger `40`, two synthetic auth users, one
  synthetic company, one Storage object, and zero new compatibility markers
  were unchanged. A failed password-based reset stopped before mutation; a
  browser pause confirmation was canceled, so the preserved QA project stayed
  active and unmodified.
- Fresh install: a new isolated local Supabase database applied all `38/38`
  canonical migrations through `202608010002`. Module 1 table/bucket/RPCs were
  absent by contract. A clean `db reset` repeated the same result.
- SQL regressions: `12/12` canonical rollback-only suites passed. The archived
  Universal Tender Import suite was intentionally not run against the
  production chain because its objects must be absent.
- Reapply/idempotency: reapplying `202608010002` succeeded; the aggregate hash
  of `content_sha256`, `live_verification_status`, and `live_verified_at` for
  the four pipeline rows remained
  `dd544ae3ca3b7b735d79984b62f7401c3ee578983ba8108a9193be8322bb21c7`.
- Deno: `117` passed, `0` failed. The Daily provider test was made independent
  of wall-clock expiry; production code was unchanged.
- React/Vitest: `95` passed across `16` files. TypeScript and ESLint passed.
- All `13` canonical Edge Function entrypoints type-checked. Portal inline
  JavaScript parse, standalone matchmaking JavaScript parse, repository
  readiness, migration sequencing, credential scan, and `git diff --check`
  passed.
- Production database lint: zero errors; three pre-existing recovery-function
  assignment-cast warnings remain.

The canonical linked `--include-all --dry-run` now proposes exactly:

- `202607090001_core_platform_baseline.sql`
- `202607100009_core_runtime_compatibility.sql`
- `202608010001_company_admin_notification_outbox.sql`
- `202608010002_production_compatibility_and_metadata.sql`

The two Module 1 migrations and superseded metadata migration are no longer in
the executable set. The notification target-only gate is not yet satisfied;
the compatibility release and the two evidence-backed history repairs in the
runbook must happen in a separately authorized deployment task first.

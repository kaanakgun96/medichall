# Supabase live structural baseline

## Status in this task

The repository and migrations were inspected, but the live Supabase project
was not accessible from the task environment. The following were not present:

- Supabase CLI;
- a linked `supabase/.temp/project-ref`;
- an authorized access token;
- a database URL;
- a Deno runtime.

Successfully verified:

- the current repository branch and its relationship to `origin/develop`;
- repository SQL, Edge Function, React, and legacy portal definitions;
- the absence of live credentials from the task environment by variable name
  only;
- that the repository has conflicting definitions for the matching RPC and
  duplicate document Edge Function source trees.

Still unverified:

- live tables, views, materialized views, functions/RPC bodies, triggers,
  indexes, constraints, RLS, grants, cron jobs, extensions, storage buckets and
  policies;
- deployed Edge Function names, versions, JWT settings, and source;
- deployed cron URL/header configuration;
- whether manual setup SQL was applied;
- which candidate/scoring definition is active;
- whether uploaded documents are public or tenant-restricted in production.

No live export is committed and no live status is inferred from repository
files.

## Authorized owner-run capture

Use a dedicated, time-limited access token and a read-only database role where
possible. The structural schema dump may require an owner connection to see
every definition. Never paste credentials into a command, shell history,
issue, chat, or file.

Install and authenticate the official Supabase CLI, `psql`, `pg_dump`, `jq`,
and `shasum`. Set the values in the current shell or a secure secret manager:

```bash
export SUPABASE_PROJECT_REF='your-project-ref'
export SUPABASE_ACCESS_TOKEN='your-short-lived-access-token'
export SUPABASE_DB_URL='postgresql://read-only-user:password@host:5432/postgres?sslmode=require'
```

Run from the repository root:

```bash
bash scripts/export-supabase-baseline.sh
```

The script does not call login, print variables, list API keys, export
authentication users, export customer rows, or read cron command bodies.
Unset values when complete:

```bash
unset SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_DB_URL
```

Expected ignored output under `supabase/baseline/live/`:

- `database-schema.sql` — schema-only public/storage DDL without owners or
  grants;
- `database-structural-inventory.csv` — catalog inventory for relations,
  columns, functions, constraints, indexes, triggers, RLS policies, buckets,
  extensions, and cron metadata excluding commands;
- `edge-functions.json` — filtered deployment inventory;
- `capture-metadata.json` — UTC time, repository commit, hashed project
  reference, and scope;
- `SHA256SUMS` — integrity hashes.

The schema dump deliberately limits itself to `public` and `storage`. The
catalog report handles an optional `cron.job` safely and exports its scheduling
metadata without the command body. Do not add `auth.users` data or
`cron.job.command`.

## Sanitization and verification

Before sharing any output:

```bash
shasum -a 256 -c supabase/baseline/live/SHA256SUMS
rg -n -i 'service[_-]?role|authorization|bearer |password|secret|api[_-]?key|github_pat_|eyJ[A-Za-z0-9_-]{10,}\\.' supabase/baseline/live
```

The first command must report `OK` for every artifact. The second should be
reviewed manually. Function parameter names or policy text can contain words
such as `authorization` without containing a value; any actual credential,
header value, customer identifier, document content, or connection string must
be removed and the capture repeated. Do not commit the live directory.

Also verify:

```bash
git check-ignore -v supabase/baseline/live/capture-metadata.json
git status --short
```

The live path must be ignored and the capture must not appear in Git status.

## Repository comparison

Start comparison in a temporary, access-controlled directory:

```bash
rg -n -i 'create (table|view|materialized view|function)|create trigger|create policy' supabase/baseline/live/database-schema.sql
rg -n -i 'create (table|view|materialized view|function)|create trigger|create policy' supabase/migrations supabase/setup
```

That inventory comparison is only an orientation tool because migrations contain history
while the dump contains final state. For decisive comparisons:

1. extract the live `pg_get_functiondef` row for each RPC from the structural
   CSV;
2. extract each repository `create or replace function` definition;
3. normalize whitespace only—do not normalize operators, constants, weights,
   security-definer flags, `search_path`, grants, or policy expressions;
4. SHA-256 both normalized definitions;
5. record exact differences and callers in the canonical inventory;
6. update `pipeline_versions.live_verification_status` only after review.

Prioritize:

- `refresh_company_opportunity_matches`;
- `refresh_explainable_tender_matches`;
- `search_tenders`;
- queue/status and upload RPCs;
- helper scoring functions;
- all storage and tenant policies.

## Resolving conflicting RPC definitions

Do not choose the newest filename blindly. Resolve a conflict by:

1. treating `pg_get_functiondef` from the authorized live capture as the
   current production fact;
2. identifying which repository file reproduces it exactly;
3. running benchmark and regression cases against a staging clone;
4. selecting one canonical future migration without rewriting old migrations;
5. recording the predecessor hash, successor hash, reason, reviewer, and
   deployment time;
6. deploying only after portal and security checks pass.

`202607200002_english_normalization.sql` and
`supabase/setup/CPV-YAMA.sql` currently conflict for
`refresh_company_opportunity_matches`. The setup patch must not be assumed
active. No score weights should change during reconciliation.

## Edge Function source verification

The CLI inventory proves names and deployment metadata, not source equality.
For each live function, download its source into a temporary directory using
the installed CLI version’s documented `supabase functions download` command,
review it for embedded secrets before hashing, and compare it to the root and
nested repository candidates. Never commit a downloaded live bundle until it
has been security-reviewed and intentionally converted into a normal
migration/change.

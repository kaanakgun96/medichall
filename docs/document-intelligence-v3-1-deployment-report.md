# Document Intelligence v3.1 deployment report

## Intended release

- Branch: `react-migration`
- Backend migration:
  `202607230006_document_intelligence_v3_1_performance.sql`
- Edge Function: `tender-document-engine`
- JWT verification: enabled
- Frontend changes: none
- Production HTML changes: none
- Schema/RPC compatibility: additive; legacy signatures unchanged

## Repository verification

The implementation is verified with:

- Deno type checking of the canonical engine;
- all shared backend unit tests;
- the v3.1 SQL regression script;
- repository readiness/hash validation;
- secret scanning;
- migration dry-run against the linked project.

The repository contains unrelated legacy Deno files that are not formatted by
current `deno fmt` rules. v3.1 formatting verification is intentionally scoped
to files changed by this release so the backend-only sprint does not rewrite
unrelated functions.

## Deployment result

Repository implementation is complete, but the external backend deployment
was not performed in this execution environment:

- migration history: not re-read externally; CLI transport was sandbox-blocked;
- migration applied: no;
- SQL regression: repository test added; remote execution pending;
- function version/status: no v3.1 function deployment attempted;
- JWT rejection probe: pending deployment;
- post-deployment invariants: pending deployment;
- rollback required: no, because production was not changed.

Local credentials were present and the local Supabase link matched the
configured target reference without printing either value. The CLI could not
reach the Supabase Management API from the restricted desktop shell. The
deployment must remain gated: do not apply the migration or deploy the function
until `supabase migration list --linked` and
`supabase db push --linked --dry-run` succeed and propose only the v3.1
migration.

## Safety boundaries

The release must not deploy or modify:

- any React source;
- `portal.html` or other production HTML;
- authentication or Storage;
- RLS beyond the new v3.1 relations;
- existing queue/status RPC signatures;
- scoring RPC logic;
- cron, Vault, or secrets;
- unrelated Edge Functions;
- `develop` or `main`.

## Rollback

Redeploy the preceding v3 engine bundle and restore the v3.0 parsing/extraction
pipeline versions as repository-current. Keep the additive v3.1 tables,
columns, and historical rows for audit. Do not delete tender data and do not
repair or rewrite migration history.

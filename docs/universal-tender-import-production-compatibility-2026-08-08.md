# Universal Tender Import production compatibility matrix

Date: 2026-08-08

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

Production migration ledger before reissue: 39 versions
Frontend deployment: not performed

## Root cause

The portal correctly calls
`get_universal_tender_imports(p_company_id, p_import_id, p_limit)`, but the
complete Universal Tender Import database contract was intentionally archived
and never deployed after migration-history reconciliation. Production does not
have a signature drift: it has no `tender_imports` relation, import RPC, private
bucket, Storage policy, reference row, or terminal trigger. PostgREST therefore
returns PGRST202 for the first missing history RPC it is asked to resolve.

The production Edge Function inventory has the pre-Module-1 versions of
`tender-attachment-discovery`, `tender-archive-worker`, and
`tender-document-engine`. Their current repository implementations were all
last changed by the 2026-07-29 security-hardening commit. `tender-import` is not
deployed at all.

## Pre-deployment compatibility matrix

| Object | Expected repository contract | Production before reissue | Status |
|---|---|---|---|
| `public.tender_imports` | Company/requester-scoped orchestration table with RLS | Missing | MISSING |
| `tender_documents.storage_bucket` | Nullable private bucket reference | Missing; `storage_path` exists | MISSING |
| `uploaded_private` status | Processed access-status row | Missing | MISSING |
| `validated_private_upload` status | Processed access-status row | Missing | MISSING |
| `tender-imports` bucket | Private, 30 MB object maximum, supported MIME allowlist | Missing | MISSING |
| Import table grants | Authenticated SELECT only; mutation RPC-only; service processing | No table | MISSING |
| Import RLS | Owner/requester/admin read; service mutation | No table | MISSING |
| Storage insert policy | Authenticated owner/admin, exact company/import path | Missing | MISSING |
| Storage select policy | Owner/requester/admin exact-path reads | Missing | MISSING |
| Storage delete policy | Tenant-safe and refuses referenced active documents | Missing | MISSING |
| `create_universal_tender_import(bigint,text,text,text)` | Authenticated compatibility RPC | Missing | MISSING |
| `create_universal_tender_import(bigint,text,text,text,text,text)` | Authenticated idempotent RPC | Missing | MISSING |
| `register_universal_tender_documents(uuid,jsonb)` | Authenticated object-registration RPC | Missing | MISSING |
| `fail_universal_tender_import(uuid,text)` | Authenticated upload-failure RPC | Missing | MISSING |
| `get_universal_tender_imports(bigint,uuid,integer)` | Authenticated history/status RPC | Missing | MISSING |
| `reopen_universal_tender_file_import(uuid)` | Authenticated safe pre-registration retry | Missing | MISSING |
| `normalize_tender_import_source_url(text)` | Service-only normalized URL helper | Missing | MISSING |
| `notify_universal_tender_import_terminal(...)` | Service-only idempotent notification helper | Missing | MISSING |
| `mark_universal_tender_import_failed(...)` | Service-only terminal failure helper | Missing | MISSING |
| `list_stale_tender_import_orphans(interval)` | Service-only bounded orphan inventory | Missing | MISSING |
| `sync_universal_tender_import_analysis()` | Service-only analysis progress trigger function | Missing | MISSING |
| Analysis terminal trigger | Syncs existing Document Intelligence job terminal state | Missing | MISSING |
| Import recovery cron | Secure stale/orphan recovery, if enabled | No import job | MISSING |
| `tender-import` Edge Function | Authenticated coordinator, in-function JWT validation | Not deployed | MISSING |
| `tender-attachment-discovery` | Current SSRF-hardened source | Active v8; deployed 2026-07-23, before final hardening | DRIFT |
| `tender-archive-worker` | Private-bucket-aware bounded archive source | Active v7; deployed 2026-07-23, before final hardening | DRIFT |
| `tender-document-engine` | Private-bucket-aware current v3.1 source | Active v26; deployed 2026-07-27, before final hardening | DRIFT |
| Portal history request | `p_company_id`, `p_import_id`, `p_limit` | Frontend matches repository SQL exactly; backend absent | BLOCKED |

## Production baseline counts

Before deployment: 3,035 tenders, six companies, six auth users, one tender
document, 75 Storage objects, zero import records, and zero import-bucket
objects. The schema-only backup is restricted and hash-verified outside the
repository. No customer rows or file contents were exported.

## Forward-only resolution

`202608080001_universal_tender_import_reissue.sql` atomically ports the two
immutable archived contracts after production head `202608020001`. The archived
versions stay absent and unchanged. The outer archived transaction wrappers are
the only omitted lines; the base and final hardening execute inside one current
transaction so an intermediate grant or policy cannot become visible.

Deployment remains gated on target-only dry run, rollback SQL/RLS, fresh install,
rollback/reapply, production lint, function typecheck/security tests, and
isolated real-format QA. This report will be updated with deployed versions,
post-deployment counts, and acceptance evidence after those gates pass.

# Universal Tender Import — Module 1

## Scope

Module 1 adds company-private tender imports to the production `portal.html`
without replacing the existing tender architecture. It accepts PDF, DOCX, XLSX,
CSV, ZIP packages, and public HTTPS tender URLs. Modules 2–5 are not part of
this change.

The linked production catalog was checked on 2026-07-29 before implementation.
The required canonical tables, RLS-enabled job tables, RPC signatures,
notification helper, storage bucket, and active `tender-attachment-discovery`,
`tender-archive-worker`, and `tender-document-engine` functions were present.

## Architecture

The import layer is orchestration only:

1. `create_universal_tender_import` creates a private import envelope and a
   canonical draft row in `tenders`.
2. Browser uploads use the new non-public `tender-imports` bucket. The upload
   policy resolves both the company and import identifiers from the object path.
3. `register_universal_tender_documents` verifies the real Storage object, byte
   count, path ownership, extension, and MIME family before registering it in
   the existing `tender_documents` table.
4. `tender-import` validates the authenticated partner and file signatures, then
   queues the existing URL discovery, ZIP extraction, and Document Intelligence
   v3.1 workers. It does not parse documents or call AI itself.
5. Existing v3.1 jobs extract text, tables, lots, products, quantities, CPV,
   deadlines, buyer/authority, certificates, evidence, and confidence.
6. The existing analysis-job progress fields drive the import UI. The
   terminal-job trigger updates the import, reuses the portal notification
   center, and deep-links back to the import card.

All processing jobs remain persisted and asynchronous. A retry creates or reuses
the canonical child jobs through their existing idempotent queue contracts.

## Database changes

Migration: `supabase/migrations/202607290001_universal_tender_import.sql`

- Adds `tender_imports` as the company/requester-scoped orchestration record.
- Adds nullable `tender_documents.storage_bucket`; existing public URL rows
  continue to work unchanged.
- Adds the private `tender-imports` Storage bucket with a 30 MB object limit.
- Adds owner/admin RLS for imports and imported draft tenders.
- Narrows the existing tender-document read policy only for documents linked to
  private imports. Existing public procurement document behavior is preserved.
- Adds owner-scoped private Storage insert/select/delete policies. No update or
  anonymous policy is added.
- Adds create, register, fail, and read RPCs. Anonymous execution is revoked.
- Adds a terminal analysis trigger that updates progress and reuses
  `portal_add_notification`.

The canonical imported tender stays `draft`, so it is not exposed through the
public/open tender feed and is not matched to other companies.

## Edge Functions

### New: `tender-import`

- In-function JWT validation through `auth.getUser`.
- Company/import authorization through the owner-scoped read RPC.
- Server-side content-signature checks that do not trust browser MIME values.
- Bounded asynchronous orchestration of existing workers.
- Idempotent start claim and explicit retry.
- Origin allowlist and 204 CORS preflight behavior shared with the production
  document engine.
- No provider key, service-role key, or imported file content is returned to the
  browser.

### Existing functions extended

- `tender-document-engine` can read imported objects from private Storage with
  its existing service-role runtime. Public HTTPS retrieval remains unchanged.
- `tender-archive-worker` can read private ZIPs and writes imported extracted
  files back to the private bucket. Non-import archive behavior remains in the
  existing public procurement bucket.
- The document engine copies only evidence-backed core tender facts into the
  canonical draft imported tender. The normalized v3 extraction remains the
  source of truth.

## Frontend

The existing Opportunities panel now includes:

- file/public-URL source switch;
- accessible click, keyboard, and drag-and-drop upload;
- six simultaneous documents, 25 MB per direct document, 30 MB per ZIP, and 100
  MB per import;
- sequential upload progress and asynchronous processing progress;
- loading, empty, error, terminal, and retry states;
- private-import history;
- evidence-backed extraction detail for buyer, deadline, CPV, products,
  quantities, certificates, lots, confidence, and source locations;
- portal-notification deep links.

The production frontend remains the root `portal.html`. No React runtime or
parallel portal implementation is introduced.

## Tests

- `supabase/functions/_shared/tender-import-file-types.test.ts` covers supported
  formats, signatures, mismatches, and limits.
- `supabase/functions/tender-import/index.test.ts` covers CORS preflight, origin
  rejection, authorization-header preservation, real unauthenticated POST
  rejection, and safe boot errors.
- `supabase/tests/universal_tender_import.sql` covers schema, bucket privacy,
  RLS/grants, anonymous denial, owner creation/read, cross-tenant denial, and
  HTTPS enforcement.
- Existing attachment discovery, document extraction, v3/v3.1, PDF,
  observability, lot matching, document-engine CORS/security, product profile,
  meeting-video, and matchmaking-domain regression suites remain applicable.

## Security review

- Uploaded documents are not placed in the public `tender-documents` bucket.
- Private Storage paths bind `company_id/import_id`, and policies verify both
  against `auth.uid()`.
- Imported tender rows and document metadata are owner/admin scoped.
- Public URL retrieval continues to use the existing URL normalizer,
  private-network rejection, redirect bounds, robots handling, and crawl limits.
- File extension, Storage metadata, size, and server-read magic signature are
  checked before parsing.
- ZIP protections remain in the existing worker: compressed/extracted limits,
  entry limit, traversal rejection, nested ZIP rejection, and executable
  rejection.
- Evidence RLS remains scoped through the requesting company analysis job.
- Service-role and AI provider secrets remain Edge-only.
- The coordinator forwards the caller's scoped JWT to existing user-facing
  workers and never stores it.

## Performance review

- At most six directly uploaded documents enter one v3.1 analysis, matching the
  existing document-selection bound.
- Direct documents are capped at 25 MB, ZIPs at 30 MB, and the import at 100 MB.
- URL discovery retains its eight-page, depth-two, 180-link, and 45-second crawl
  bounds.
- ZIP extraction retains its 60-entry and 100 MB expanded-content bounds.
- The coordinator does not add AI calls. It queues the existing cached, chunked,
  resumable, parallel v3.1 analysis exactly once.
- Portal polling occurs only while an import is active and stops on terminal
  state.
- Import history is capped and ordered by an indexed company/creation key.

## Deployment order

1. Apply `202607290001_universal_tender_import.sql`.
2. Deploy the updated `tender-document-engine`.
3. Deploy the updated `tender-archive-worker`.
4. Deploy the new `tender-import` function with repository `config.toml`.
5. Run the SQL and Deno regressions.
6. Manually upload the reviewed root `portal.html` to `public_html/portal.html`.

Deploying functions before the migration is not supported because the private
storage columns and import table would not yet exist.

## Rollback plan

1. Restore the preceding `portal.html` artifact to remove the import entry
   point.
2. Redeploy the preceding `tender-document-engine` and `tender-archive-worker`;
   existing public tender behavior is unchanged by the additive schema.
3. Stop routing requests to `tender-import`.
4. Keep `tender_imports`, the private bucket, and imported objects in place for
   audit/recovery. They are isolated by RLS and do not enter the open feed.
5. If a schema rollback is mandatory after data export, remove only the import
   trigger/policies/functions, then `storage_bucket`, `tender_imports`, and the
   empty private bucket in verified dependency order. Do not delete imported
   customer objects without explicit retention approval.

## Known limitations

- Authenticated, CAPTCHA, paid, or JavaScript-only tender portals still require
  lawful manual document upload.
- Scanned PDFs retain the current Document Intelligence provider/OCR
  limitations.
- Module 1 exposes extracted facts and their evidence. The broader Tender
  Intelligence recommendation/revenue/risk card belongs to Module 2 and has not
  been started.

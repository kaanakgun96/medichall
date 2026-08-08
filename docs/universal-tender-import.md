# Universal Tender Import — Module 1

> **Production reissue status (2026-08-08):** The immutable original SQL remains
> preserved byte-for-byte under
> `supabase/migration-archive/universal-tender-import/`. Its final base and
> hardening contracts are ported atomically after the current production head
> as `supabase/migrations/202608080001_universal_tender_import_reissue.sql`.
> The historical `202607290001` and `202607290002` versions remain intentionally
> absent from the executable chain and must never be ledger-repaired.

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

Archived source migrations:

- `supabase/migration-archive/universal-tender-import/202607290001_universal_tender_import.sql`
- `supabase/migration-archive/universal-tender-import/202607290002_universal_tender_import_hardening.sql`

Executable forward-only migration:

- `supabase/migrations/202608080001_universal_tender_import_reissue.sql`

The executable file removes only the two archived files' outer transaction
wrappers and runs their unchanged contracts inside one transaction. This
prevents the base policy/grant state from becoming visible if final hardening
fails.

- Adds `tender_imports` as the company/requester-scoped orchestration record.
- Adds nullable `tender_documents.storage_bucket`; existing public URL rows
  continue to work unchanged.
- Adds the private `tender-imports` Storage bucket with a 30 MB object limit.
- Adds owner/admin RLS for imports and imported draft tenders.
- Narrows the existing tender-document read policy only for documents linked to
  private imports. Existing public procurement document behavior is preserved.
- Adds owner-scoped private Storage insert/select/delete policies. Owner cleanup
  cannot delete an active registered document; service administrators retain
  recovery access. No update or anonymous policy is added.
- Adds create, register, fail, and read RPCs. Anonymous execution is revoked.
- Adds a terminal analysis trigger that updates progress and reuses
  `portal_add_notification`.

The hardening migration:

- registers `uploaded_private` and `validated_private_upload` idempotently;
- replaces every tender-import Storage policy with fully qualified
  `storage.objects.bucket_id` and `storage.objects.name` references plus strict
  company/import/relative-path validation;
- revokes authenticated table mutation before granting SELECT only;
- adds company-scoped operation and source-fingerprint unique indexes;
- acquires an advisory transaction lock before the canonical draft is created,
  so concurrent replay returns one import/tender;
- lets an owner explicitly reopen only a failed, pre-registration file upload;
  failures with registered documents remain on the processing retry path;
- retains replay records for at least 30 days and indefinitely while the import
  record exists;
- adds service-only, age-bounded orphan discovery and terminal-failure
  notification functions.

The canonical imported tender stays `draft`, so it is not exposed through the
public/open tender feed and is not matched to other companies.

## Edge Functions

### New: `tender-import`

- In-function JWT validation through `auth.getUser`.
- Company/import authorization through the owner-scoped read RPC.
- Server-side content-signature checks that do not trust browser MIME values.
- Bounded asynchronous orchestration of existing workers.
- Idempotent start claim and explicit retry.
- Owner-authorized, exact-path cleanup that refuses referenced or cross-company
  objects.
- Administrator-only stale-orphan reconciliation with a mandatory 15-minute to
  90-day age threshold, dry-run by default, and hashed object identifiers in
  logs.
- Origin allowlist and 204 CORS preflight behavior shared with the production
  document engine.
- No provider key, service-role key, or imported file content is returned to the
  browser.

### Existing functions extended

- `tender-document-engine` can read imported objects from private Storage with
  its existing service-role runtime. Public retrieval now validates HTTPS/443,
  DNS, redirects, mixed answers, rebinding changes, response bytes, and body
  timeouts before analysis.
- `tender-archive-worker` can read private ZIPs and writes imported extracted
  files back to the private bucket. Non-import archive behavior remains in the
  existing public procurement bucket.
- `tender-attachment-discovery` resolves and validates every IPv4/IPv6 answer
  before each request and redirect. HTTP, credentials, non-443 ports, loopback,
  private, link-local, CGNAT, multicast, reserved, documentation, and
  IPv4-mapped private targets are rejected.
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
- order-independent file-content fingerprints and normalized URL replay;
- server re-computation of the uploaded content hash set before any document is
  promoted to the validated private status;
- WAI-ARIA tab/tabpanel behavior with Arrow, Home, and End navigation;
- determinate progressbar semantics and assertive error announcements;
- exact-path cleanup after an upload/registration failure.

The production frontend remains the root `portal.html`. No React runtime or
parallel portal implementation is introduced.

## Tests

- `supabase/functions/_shared/tender-import-file-types.test.ts` covers valid and
  malformed PDF/Office/CSV containers, relationships, macros, binary content,
  and formula neutralization.
- `supabase/functions/_shared/safe-zip.test.ts` covers central-directory bounds,
  incremental extraction, encryption, methods, nested archives, path
  conflicts, symbolic links, count/expanded-size/ratio limits, and truncation.
- `supabase/functions/_shared/safe-public-fetch.test.ts` covers DNS/IP
  classification, redirects, downgrade/private/mixed-answer denial, rebinding,
  size bounds, and request/body timeouts.
- `supabase/functions/tender-import/index.test.ts` covers CORS preflight, origin
  rejection, authorization-header preservation, real unauthenticated POST
  rejection, and safe boot errors.
- `supabase/tests/universal_tender_import.sql` covers schema, bucket privacy,
  exact RPC-only grants, access-status registration, owner Storage
  upload/read, delete-policy structure, cross-tenant and anonymous denial,
  service access, document registration, URL/file replay, and HTTPS
  enforcement. Hosted Storage rejects direct SQL deletion even for test
  fixtures, so deletion behavior is exercised through policy inspection and
  the Storage API cleanup unit tests rather than direct table mutation.
- `portal-universal-tender-import.test.ts` covers portal parsing, duplicate
  identifiers, ARIA contracts, idempotency/cleanup wiring, responsive
  containment, and browser-secret exclusion.
- Existing attachment discovery, document extraction, v3/v3.1, PDF,
  observability, lot matching, document-engine CORS/security, product profile,
  meeting-video, and matchmaking-domain regression suites remain applicable.

## Security review

- Uploaded documents are not placed in the public `tender-documents` bucket.
- Private Storage paths bind `company_id/import_id`, and policies verify both
  against `auth.uid()`.
- Imported tender rows and document metadata are owner/admin scoped.
- Public URL retrieval is HTTPS/443 only. DNS A/AAAA results are checked before
  and after each request; a changed or mixed private/public answer is rejected.
  The standard fetch API cannot pin a connection to a resolved address, so a
  residual validation-to-connect race remains a documented runtime limitation.
- PDF, Office, CSV, and ZIP inputs are checked from server-read bytes. Office
  validation requires real ZIP central/local records and expected XML and
  relationship targets.
- ZIP metadata is bounded before extraction. Encrypted, ZIP64, nested,
  traversal, absolute, duplicate/conflicting, symlink-like, unsupported-method,
  excessive-count, excessive-size, and excessive-ratio archives are rejected.
  Extraction is fed incrementally in bounded chunks.
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

1. Verify the linked dry run proposes only
   `202608080001_universal_tender_import_reissue.sql`; do not restore or repair
   the archived `202607290001`/`202607290002` versions.
2. Apply the forward-only reissue first in an isolated Module 1 staging
   project.
3. Run the exact SQL integration test and verify migration rollback/reapply in
   the target staging environment.
4. Deploy the updated `tender-attachment-discovery`.
5. Deploy the updated `tender-document-engine`.
6. Deploy the updated `tender-archive-worker`.
7. Deploy `tender-import` with repository `config.toml`.
8. Run the Deno, React/Vitest, SQL, RLS, browser, idempotency, orphan, and
   provider-backed QA suites.
9. Only after acceptance, manually upload the reviewed root `portal.html` to
   `public_html/portal.html`.

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
   trigger/policies/functions and the two unique indexes. The hardening columns
   cannot be removed while six-argument callers or imports depend on them.
6. Do not delete `uploaded_private` or `validated_private_upload` while a
   `tender_documents.access_status` foreign key references either code.
7. Remove `storage_bucket`, `tender_imports`, and the empty private bucket only
   in verified dependency order. Do not delete imported customer objects
   without explicit retention approval.

## Known limitations

- Authenticated, CAPTCHA, paid, or JavaScript-only tender portals still require
  lawful manual document upload.
- Scanned PDFs retain the current Document Intelligence provider/OCR
  limitations.
- DNS is checked immediately before and after standard `fetch`, but the Edge
  runtime does not expose a supported API to bind that fetch to the previously
  resolved IP. Changed answers are rejected; the remaining micro-window must be
  tracked as a platform limitation.
- Module 1 exposes extracted facts and their evidence. The broader Tender
  Intelligence recommendation/revenue/risk card belongs to Module 2 and has not
  been started.

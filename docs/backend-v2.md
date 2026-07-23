# MedicHall backend v2

## Scope

This phase upgrades the canonical root attachment-discovery and document-engine
Edge Functions, adds an opt-in Match Score v2 comparison path, and replaces
the two scheduled HTTP calls with the existing Vault-backed cron design.

The change is additive:

- the legacy HTML portal is not changed;
- React source is not changed;
- existing tables and RPC signatures remain available;
- `opportunity_matches.match_score` and its legacy components are not
  rewritten by the v2 migration;
- no all-company × all-tender recomputation runs during deployment;
- the legacy `supabase/functions/medichall-ai` tree is never a deployment
  input.

The controlled deployment scope is machine-readable in
`supabase/observability/backend-v2-deployment.json`.

## Migrations

### `202607230002_document_intelligence_v2.sql`

Adds source/resolved URL provenance and discovery confidence to
`tender_documents`; bounded crawl summaries to discovery jobs; normalized
result, reuse, and apply-state fields to analysis jobs; normalized evidence
metadata; and `tenders.document_extraction_v2`.

Existing rows are not backfilled with invented v2 values. Existing RLS
policies remain in force.

The migration also repairs the existing
`register_uploaded_tender_documents(bigint,bigint,jsonb)` body without
changing its signature or integer return shape. The prior live body referenced
the nonexistent `file_size` column and a rejected `user_upload` document type.
The replacement uses `file_size_bytes`, verifies the uploaded Storage object,
keeps the 20 MiB/eight-file bounds, records authorized-upload provenance, and
removes anonymous execute access. It does not change a Storage policy or
bucket.

### `202607230003_match_score_v2.sql`

Adds deterministic helper functions, a tenant-keyed comparison table, a
single-opportunity refresh, a batch refresh capped at 100, and a safe owner
read RPC. It does not replace
`refresh_company_opportunity_matches(bigint)` or
`refresh_explainable_tender_matches(bigint)`.

Internal input snapshots, hashes, and trace IDs are protected by RLS. An
ordinary owner receives only the safe result through
`get_opportunity_match_score_v2(bigint,bigint)`.

## Attachment discovery v2

The crawler:

- resolves relative links;
- normalizes and deduplicates URLs without removing access-signature
  parameters;
- prioritizes direct files, official-host links, official metadata, and
  procurement terms;
- identifies PDF, ZIP, DOC, DOCX, XLS, XLSX, CSV, and TXT by URL, MIME type,
  or content disposition;
- validates every redirect target and blocks credential-bearing, loopback,
  link-local, and private literal addresses;
- honors matching `robots.txt` disallow rules;
- stops on login, CAPTCHA, membership, payment, terms, forbidden, and
  rate-limit states instead of attempting to bypass them;
- records original and resolved URLs, status, content type, redirects,
  source, confidence, rejection reason, attempts, and elapsed time;
- upserts on the existing `(tender_id, file_url)` identity.

Hard bounds are eight pages, depth two, 180 examined links, five redirects,
four MiB per HTML page, two attempts for transient non-rate-limit failures,
12 seconds per request, and 45 seconds for the crawl.

## Document engine v2

The existing Anthropic integration now validates the
`medichall-tender-facts-v2` schema. It retains original and conservatively
normalized values for tender identity, authority, country, dates, CPV, lots,
products, descriptions, requirements, dimensions, material, sterility,
packaging, quantity, value, currency, certifications, delivery, and language.

Validation:

- represents unknown facts as null;
- normalizes common decimal and unit forms;
- keeps quantity, package count, and units per package separate;
- labels requirements mandatory, descriptive, or unknown;
- accepts evidence only from documents supplied to the request;
- caps evidence-free output at low confidence and marks it partial;
- stores factual tender-global data separately from the company-specific fit
  narrative;
- keeps a higher-confidence existing extraction instead of replacing it;
- reuses an identical completed input snapshot without another AI request.

Direct PDF, TXT, CSV, DOCX, XLS, and XLSX files are supported. DOCX and
spreadsheet conversion reuse the repository's existing libraries. The bounds
are six documents, 20 MiB per document, a detected maximum of 100 PDF pages,
200,000 text characters per converted document, two AI attempts, a 20-second
download timeout, and a 90-second provider timeout.

When extraction succeeds, only the requesting company's one legacy
explainable match and one v2 score are refreshed. The former unbounded
all-company refresh from the document-engine path is not used.

## Match Score v2

The version is `matching-score-v2.0.0`. The score is the weighted mean of
applicable components; a missing component is null and its weight is omitted.
Data completeness is the sum of applicable weights. Confidence is
completeness multiplied by a deterministic document-evidence factor.

| Component | Weight | Primary evidence |
|---|---:|---|
| Exact product | 24 | Company products/profile and extracted tender products |
| Normalized product text | 14 | Normalized product/title terms |
| CPV exact/hierarchy | 14 | 8-digit CPV and prefix hierarchy |
| Semantic similarity | 8 | Deterministic trigram plus token-set proxy |
| Technical specification | 10 | Product descriptions and extracted requirements |
| Country eligibility | 8 | Target countries and tender country |
| Certification compatibility | 8 | Company and tender certificates |
| Quantity/capacity | 5 | Comparable value and unit only |
| Packaging/unit | 3 | Product descriptions and extracted packaging |
| Supplier profile | 2 | Role/OEM/private-label plus explicit tender wording |
| Engagement | 4 | Saved/contacted/applied/dismissed workflow state |

The current company schema has no capacity unit. Quantity/capacity therefore
stays non-applicable in real scores rather than comparing incompatible
numbers. The deterministic quantity helper is covered for future compatible
inputs.

The semantic component is explicitly a deterministic lexical proxy. The
repository has no production embedding contract, so this phase does not claim
embedding similarity or add a second AI provider.

## Cron and Vault

`supabase/setup/CONFIGURE-CRON.sql` is the approved operator-run definition.
It keeps:

- `medichall-ted-sync` at `30 6 * * *`;
- `medichall-tender-digest` at `0 7 * * *`.

Both commands read `medichall_project_url` and `medichall_cron_secret` from
Vault at execution time. The cron secret must be the same rotated value as the
Edge Function `CRON_SECRET`. Values must be supplied through the secret
manager and a protected operator session, never a repository file, command
argument, chat message, or SQL literal.

## Verification

Repository checks:

```bash
node scripts/check-phase0-readiness.mjs
deno check --frozen --config supabase/functions/deno.json \
  supabase/functions/tender-attachment-discovery/index.ts \
  supabase/functions/tender-document-engine/index.ts
deno test --frozen --config supabase/functions/deno.json \
  supabase/functions/_shared/*.test.ts
```

React compatibility checks remain:

```bash
cd apps/portal-react
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database tests, run only after the migrations exist on an authorized target:

- `supabase/tests/document_intelligence_v2.sql`;
- `supabase/tests/match_score_v2.sql`;
- `supabase/tests/rpc_compatibility_v2.sql`;
- the existing Phase 0 SQL verification.

The Match Score test creates transaction-local fixtures and rolls them back.
It covers score ordering, CPV hierarchy, certification and quantity
mismatches, missing data, determinism, idempotency, legacy-score preservation,
safe owner output, and cross-tenant denial.

## Rollback

1. Stop calling the new targeted v2 RPCs.
2. Redeploy the immediately preceding canonical root discovery and
   document-engine versions with their existing JWT settings.
3. Restore the two prior pipeline-version rows as repository-current and mark
   their v2 successors non-current.
4. Keep the additive v2 columns, score comparison rows, and evidence for audit.
5. If cron itself is the failure source, unschedule only the two named jobs and
   restore their last reviewed definitions; do not expose the rotated secret.

No rollback requires deleting tenders, documents, matches, companies,
profiles, products, users, storage objects, or migration history.

## Known limitations

- Legacy binary DOC extraction remains unsupported; discovery records the
  file and the access state, but only DOCX is converted.
- Scanned PDFs still depend on provider-native document handling; no OCR
  subsystem is introduced.
- PDF page counting is a conservative structural check and may be unavailable
  for compressed object streams.
- Dynamic JavaScript-only, authenticated, CAPTCHA, member-only, paid, and
  terms-gated portals require lawful manual action.
- Quantity/capacity scoring remains null until the backend has comparable
  company capacity values and units.
- Match Score v2 remains a comparison surface until benchmark review approves
  promotion; it does not replace the production `match_score`.

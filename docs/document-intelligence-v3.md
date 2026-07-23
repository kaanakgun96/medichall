# Document Intelligence v3

## Scope and compatibility

Document Intelligence v3 replaces the whole-document PDF extraction path in
the canonical `tender-document-engine` Edge Function with an inspect, select,
slice, extract, and merge pipeline.

The migration is backend-only and additive:

- no React, HTML, portal, authentication, Storage, RLS, or existing matching
  contract is redesigned;
- `queue_tender_document_analysis(bigint,bigint)` and
  `get_tender_document_analysis_status(bigint,bigint)` retain their existing
  signatures and authorization behavior;
- `tenders.document_extraction_v2` and the existing product, evidence, status,
  confidence, completeness, notes, lot, parser-version, and
  extraction-version columns remain populated for current consumers;
- `tenders.document_extraction_v3` adds the canonical merged v3 result without
  removing the v2-compatible representation;
- only the requesting company's explainable match and Match Score v2 row are
  refreshed after an applied extraction;
- a higher-confidence existing extraction is retained.

The controlled deployment scope is recorded in
`supabase/observability/document-intelligence-v3.json`.

## Architecture

### 1. Document retrieval and inspection

The engine downloads at most `MAX_DOCUMENTS` supported public HTTPS
documents. Redirect targets are validated and downloads are byte- and
time-bounded. A byte limit may stop an unsafe or impractical download; page
count never does.

For each PDF, the engine computes SHA-256 and inspects a copy of its bytes
without contacting the AI provider. Inspection uses `pdfjs-dist` to collect:

- exact page count;
- bounded PDF metadata;
- bookmarks and resolved outline destinations;
- likely table-of-contents pages;
- largest-font section-title candidates;
- multilingual keyword signals and short bounded excerpts.

If PDF text/outline parsing fails but `pdf-lib` can read the file, the fallback
still records the exact page count, metadata, and deterministic page coverage.
The inspection is persisted in `tender_document_inspections` and reused by
source key, content hash, and inspection version.

`MAX_PDF_PAGES` is deliberately interpreted as the maximum number of pages
inspected in one pass. A PDF with more pages receives a partial inspection
with deterministic samples across the entire document; it is not rejected.
The default inspection ceiling is 2,000 pages, so 500- and 600-page PDFs are
fully inspectable without an architectural change.

### 2. Lightweight page discovery

Page discovery does not call Claude. It ranks document identity pages,
bookmarks, table-of-contents pages, keyword pages, neighboring context pages,
and the document end. When no keyword is found, deterministic stratified
coverage prevents the system from selecting only the beginning of a long
document.

The built-in vocabulary covers English, Turkish, German, Dutch, French,
Spanish, Italian, Portuguese, Polish, Romanian, and Czech procurement terms.
It includes technical specifications, requirements, items, lots, annexes,
quantities, product/medical terms, and standards such as CPV, EN, ISO, MDR,
and CE. Operators can add terms through `DOCUMENT_DISCOVERY_KEYWORDS` as a
JSON array or comma-separated list.

### 3. Smart chunk generation

Ranked ranges are divided into page slices of at most `MAX_CHUNK_SIZE`.
Adjacent slices overlap by `CHUNK_OVERLAP_PAGES`. Selection is globally
bounded by `MAX_TOTAL_AI_PAGES`, and work in one invocation is bounded by
`MAX_CHUNKS_PER_RUN`.

`pdf-lib` creates a new PDF containing only the selected source pages for each
chunk. If a slice exceeds `MAX_AI_CHUNK_BYTES`, it is recursively split while
retaining the original page mapping. The whole large PDF is never sent to the
AI provider.

### 4. Resumable chunk extraction

Every planned chunk has a stable input hash covering:

- source content SHA-256;
- sliced-chunk SHA-256 or converted text;
- original page numbers;
- model;
- extraction and prompt-schema versions;
- public processing configuration.

`tender_document_analysis_chunks` persists queued, processing, completed, and
failed states, attempts, leases, provider usage, tokens, cost, normalized
output, and errors. The service-only
`claim_tender_document_analysis_chunk_v3(bigint,bigint,integer,integer)` RPC
atomically claims queued/failed work or an expired lease.

Before an AI call, the engine searches for any completed chunk with the same
input hash and extraction version. A match is copied as a zero-cost reused
result. Completed chunks in a partial job therefore remain useful to a later
job, and bounded concurrency prevents request fan-out.

Each provider request contains one selected PDF slice or one bounded converted
text document. The prompt requires conservative JSON, no company-specific
fit narrative, explicit product evidence, and chunk-local PDF page numbers.
The engine validates the existing normalized v2 data contract and rebases
chunk-local evidence to original source pages before storage.

### 5. Deterministic merge

Completed normalized chunks are sorted deterministically and merged without
another AI call:

- the highest-confidence scalar value wins, with stable tie-breaking;
- CPV, language, delivery, certification, requirement, and evidence arrays
  are deduplicated;
- duplicate products are keyed by lot and normalized product name;
- duplicate evidence is keyed by document, original page, field, value, and
  quote;
- conflicting tender and product scalar values are retained in
  `ambiguities`, including confidence, chunk IDs, and originating pages;
- any ambiguity, failed/pending chunk, failed document, or evidence-free
  result forces partial status;
- no missing value is synthesized.

The canonical merge is stored on both the analysis job and
`tenders.document_extraction_v3`. Existing v2-compatible tender fields are
updated only when the new result is eligible under the existing
higher-confidence rule.

## Database migration

`202607230004_document_intelligence_v3.sql` adds:

- document hash, page count, inspection status/version, and last-inspected
  timestamp to `tender_documents`;
- `tender_document_inspections` for source metadata, outline, page signals,
  selected ranges, config, duration, reuse, and failure state;
- `tender_document_analysis_chunks` for plans, original pages, input hashes,
  leases, retries, resume state, normalized results, provider usage, tokens,
  estimated cost, reuse provenance, and failures;
- job-level page, chunk, reuse, resume, cost, statistics, plan-hash, and merge
  fields;
- `tenders.document_extraction_v3`;
- the service-only atomic chunk-claim RPC;
- repository-current `document-chunking-v3.0.0` and
  `tender-extraction-v3.0.0` pipeline versions.

`202607230005_document_intelligence_v3_runtime_compatibility.sql` changes only
pipeline-version metadata. The Supabase server-side bundler could not package
the npm dependency graph of `pdfjs-dist`; the deployable source therefore uses
the pinned modern-Deno ESM build of the same `pdfjs-dist@4.10.38` parser. The
follow-up migration records the final deployable source and manifest hashes.
It does not change schema, RPCs, RLS, data, or processing behavior. The
bootstrap manifest is retained separately for an immutable audit trail.

Both new tables have RLS enabled. Ordinary partners receive no direct table
access; authenticated administrators retain read access, and the service role
performs processing. Existing job/evidence RLS and public portal RPCs are not
replaced.

## Configuration

All values are read at invocation time and bounded to safe ranges.

| Variable | Default | Purpose |
|---|---:|---|
| `MAX_DOCUMENTS` | 6 | Maximum documents planned for one job |
| `MAX_DOCUMENT_BYTES` | 67,108,864 | Download byte ceiling per document |
| `MAX_PDF_PAGES` | 2,000 | PDF pages inspected per pass; never a rejection rule |
| `MAX_TOTAL_AI_PAGES` | 120 | Maximum selected page-slices across the job |
| `MAX_CHUNK_SIZE` | 24 | Maximum pages in a provider PDF chunk |
| `CHUNK_OVERLAP_PAGES` | 2 | Context overlap between consecutive chunks |
| `MAX_PARALLEL_CHUNKS` | 2 | Provider-call concurrency |
| `MAX_CHUNKS_PER_RUN` | 12 | New provider chunks attempted per invocation |
| `MAX_CHUNK_ATTEMPTS` | 3 | Attempts allowed for one persisted chunk |
| `KEYWORD_SCAN_LIMIT` | 2,000 | Maximum pages searched for lightweight signals |
| `INSPECTION_TIMEOUT` | 60,000 ms | Per-PDF inspection time budget |
| `DOWNLOAD_TIMEOUT` | 30,000 ms | Per-request download timeout |
| `PROVIDER_TIMEOUT` | 90,000 ms | Per-chunk provider timeout |
| `MAX_TEXT_CHARACTERS` | 200,000 | Converted non-PDF input bound |
| `MAX_CHUNK_OUTPUT_TOKENS` | 8,000 | Provider output-token bound per chunk |
| `MAX_AI_CHUNK_BYTES` | 25,165,824 | PDF slice byte bound |
| `DOCUMENT_DISCOVERY_KEYWORDS` | empty | Additional multilingual terms |
| `AI_INPUT_COST_PER_MILLION_TOKENS` | 3 | Observability cost estimate |
| `AI_OUTPUT_COST_PER_MILLION_TOKENS` | 15 | Observability cost estimate |

No secret values belong in repository files. Existing
`ANTHROPIC_API_KEY`, Supabase runtime keys, and optional model configuration
remain managed as Edge Function secrets.

## Observability

The job records total, selected, ignored, and AI-processed pages; total,
completed, failed, reused, and pending chunks; resume count; inspection reuse;
duration; token usage; estimated provider cost; failure messages; plan hash;
and merge statistics. Pipeline traces identify document retrieval, inspection,
chunk extraction, deterministic merge, and targeted match refresh.

All logged errors and metadata pass through existing credential and
identifier sanitization. Provider keys and Supabase secrets are never stored
in chunk or job rows.

## Tests

Automated coverage includes:

- real generated 120-, 250-, and 500-page PDFs;
- a scan-capped PDF that remains partial rather than rejected;
- multilingual technical sections and multiple annex locations;
- overlapping bounded range generation;
- original-page evidence rebasing;
- deterministic output regardless of chunk input order;
- duplicate evidence;
- conflicting tender and product values with ambiguity provenance;
- confidence preference;
- bounded parallel execution;
- token-cost calculation;
- atomic claim, duplicate-claim denial, expired-lease resume, completed-chunk
  idempotency, direct-table RLS, pipeline versions, and old RPC compatibility.

Repository verification:

```bash
node scripts/check-phase0-readiness.mjs
deno check --frozen --config supabase/functions/deno.json \
  supabase/functions/tender-document-engine/index.ts
deno test --frozen --config supabase/functions/deno.json \
  supabase/functions/_shared/*.test.ts
```

Database verification after the migration exists on an authorized target:

- `supabase/tests/document_intelligence_v3.sql`;
- `supabase/tests/document_intelligence_v2.sql`;
- `supabase/tests/match_score_v2.sql`;
- `supabase/tests/rpc_compatibility_v2.sql`;
- `supabase/tests/matching_phase_zero_observability.sql`.

All SQL fixtures and state transitions run inside transactions that end in
`ROLLBACK`.

## Deployment and rollback

Deploy only:

1. `202607230004_document_intelligence_v3.sql`;
2. `202607230005_document_intelligence_v3_runtime_compatibility.sql`;
3. the canonical `tender-document-engine` with `verify_jwt = true`.

Do not deploy `medichall-ai`, discovery, cron, Storage, authentication,
frontend assets, or any other Edge Function.

Rollback:

1. Redeploy the immediately preceding canonical
   `tender-document-engine` bundle with JWT verification unchanged.
2. Stop creating or claiming v3 chunks.
3. Mark the v3 parsing/extraction versions non-current and restore their v2
   predecessors as repository-current.
4. Keep the additive inspection, chunk, job, and tender fields for audit and
   future resumption.
5. Do not delete tenders, documents, evidence, matches, production data,
   Storage objects, or migration history.

## Known limitations

- Image-only/scanned PDFs do not gain OCR in this phase. They receive partial
  inspection and provider extraction only when selected PDF pages are
  readable by the provider.
- Encrypted PDFs that prohibit page copying cannot be chunked and are recorded
  as failures; they are not bypassed.
- A single source page larger than `MAX_AI_CHUNK_BYTES` cannot be split further
  and requires manual optimization.
- The keyword vocabulary is broad but not a classifier; operators should add
  domain- or country-specific vocabulary based on observed misses.
- Text extraction and section-title detection are lightweight heuristics.
  Layout tables may require a later table/OCR subsystem.
- AI page and chunk ceilings intentionally trade completeness for bounded
  cost. Pending work remains resumable, and partial status is explicit.

# Document Intelligence v3.1 performance architecture

## Scope

Document Intelligence v3.1 is a backend-only performance release for the
canonical `tender-document-engine`. It keeps the v3 extraction JSON contract,
the existing queue/status RPC signatures, authentication, storage, scoring,
RLS, and production portal behavior unchanged.

The release adds bounded parallel execution, adaptive priority planning,
whole-document and chunk reuse, early completion, cost guardrails, progress
events, benchmark timing, and quality/accounting metrics.

## Execution architecture

1. The existing authenticated queue flow creates or resumes an analysis job.
2. The engine downloads each allowed public attachment and computes its
   SHA-256 content hash.
3. A valid v3.1 whole-document cache hit is rebound to the current
   `tender_documents.id`. Inspection and AI calls are skipped.
4. A cache miss uses the existing v3 PDF inspection. Ranked ranges are then
   reprioritized:
   - lot, product, quantity, specification, requirement, CPV, and multilingual
     technical terms receive higher priority;
   - legal boilerplate, general conditions, and administrative sections
     receive lower priority.
5. Dense technical ranges use smaller chunks. Sparse ranges use larger chunks,
   bounded by the existing page and byte ceilings.
6. Chunks run in deterministic priority waves. Each wave contains at most
   `MAX_PARALLEL_CHUNKS` provider calls.
7. Failed chunks retry independently through the existing atomic claim/lease
   RPC. Successful results are merged in original page order, independent of
   provider response order.
8. After every completed wave, the engine checks whether products,
   requirements, CPV, evidence, confidence, conflict absence, and fact
   stability satisfy the early-completion policy.
9. Request, token, or per-document cost limits stop new calls. Completed
   results are merged and stored as a safe partial result.
10. Eligible per-document results are cached by content hash, cache version,
    extraction version, prompt schema, and model.

The legacy prompt schema remains `medichall-tender-facts-v3`; v3.1 changes
execution, not the extraction payload contract.

## Determinism and concurrency

- Default concurrency is four and is bounded to eight.
- A synchronous budget reservation occurs before each outbound provider call,
  so concurrent workers cannot exceed the request limit.
- Retries are scoped to one chunk.
- Merge order remains `startPage`, then stable chunk identity.
- Early completion and guardrails mark only unstarted chunks as `ignored`;
  completed facts remain auditable.
- A content-identical document with changed filename, URL metadata, or database
  identity reuses extraction while evidence is rebound to the current document.

## Cache behavior

`tender_document_extraction_cache` stores normalized extraction output and its
provenance/accounting metadata. A cache entry is reusable only when all of
these match:

- document SHA-256;
- `document-cache-v3.1.0`;
- `tender-extraction-v3.1.0`;
- `medichall-tender-facts-v3`;
- configured model;
- non-expired `expires_at`.

Cache hits make zero AI requests and persist zero token/cost usage on the new
job. Chunk-level input-hash reuse remains available as a second reuse layer.
Cached evidence is never copied with a stale document ID.

## Database additions

Migration
`202607230006_document_intelligence_v3_1_performance.sql` is additive except
for extending the existing chunk status constraint with `ignored`.

New relations:

- `tender_document_extraction_cache`;
- `tender_document_analysis_progress_events`;
- `document_intelligence_metrics_v3_1`, a security-invoker aggregate view.

New RPC:

- `get_tender_document_analysis_progress_v3(bigint, bigint)`.

The original RPCs are unchanged:

- `queue_tender_document_analysis(bigint, bigint)`;
- `get_tender_document_analysis_status(bigint, bigint)`;
- `claim_tender_document_analysis_chunk_v3(bigint, bigint, integer, integer)`.

Job accounting now includes requests, input/output/total tokens, provider,
AI/inspection/chunk-generation/merge/database/network durations, cache counts,
termination reason, progress, benchmark data, and quality counts.

Chunk accounting now includes provider duration, request count, cache state,
processing order, density, estimated input tokens, and ignored reason.

## Progress contract

The progress RPC returns the latest accessible job with its current stage,
percentage, ETA, termination reason, and ordered events. Access follows the
same owner/company/admin rules as analysis jobs.

Stages and percentages:

| Stage | Percent |
|---|---:|
| `downloading_attachments` | 5 |
| `inspecting_document` | 15 |
| `finding_technical_sections` | 28 |
| `reading_specifications` | 45 |
| `extracting_products` | 65 |
| `matching_supplier` | 82 |
| `calculating_score` | 90 |
| `generating_summary` | 96 |
| `complete` | 100 |

ETA is an elapsed-time projection. It is advisory, null at initial download,
and zero at completion.

## Configuration

All v3 values remain supported. v3.1 adds or changes these tuning values:

| Variable | Default | Bounds / meaning |
|---|---:|---|
| `MAX_PARALLEL_CHUNKS` | `4` | 1–8 concurrent workers |
| `MAX_AI_COST_PER_DOCUMENT` | `5` | USD estimate, 0.05–100 |
| `MAX_AI_REQUESTS` | `20` | Per analysis job, 1–100 |
| `MAX_TOTAL_TOKENS` | `250000` | Input + output, 1,000–5,000,000 |
| `EARLY_COMPLETION_THRESHOLD` | `88` | Confidence, 50–100 |
| `EARLY_COMPLETION_STABLE_WAVES` | `1` | Unchanged fact waves, 0–5 |
| `CACHE_TTL` | `2592000` | Seconds, 60–31,536,000 |
| `CHUNK_PRIORITY_ENABLED` | `true` | Smart section priority |
| `ADAPTIVE_CHUNKING_ENABLED` | `true` | Density-based chunk size |
| `MIN_CHUNK_SIZE` | `8` | Pages, never above max chunk size |
| `TARGET_CHUNK_TOKENS` | `12000` | Estimated input target |
| `BENCHMARK_MODE` | `false` | Persist detailed phase timings |

Provider prices continue to use the existing
`AI_INPUT_COST_PER_MILLION_TOKENS` and
`AI_OUTPUT_COST_PER_MILLION_TOKENS` configuration.

## Guardrail behavior

The engine checks a budget immediately before every AI request:

- `MAX_AI_REQUESTS`;
- `MAX_TOTAL_TOKENS`;
- `MAX_AI_COST_PER_DOCUMENT`.

Because final token usage and cost are known only after a provider response, a
single in-flight response can cross a token or cost threshold. No subsequent
request is started. Remaining chunks are marked `ignored`, the termination
reason is persisted, and all completed extraction is stored as partial.

`EARLY_COMPLETION` is the only termination reason that does not itself make an
otherwise complete merged result partial.

## Metrics

The daily metrics view exposes:

- analysis/completed/partial counts;
- average total and AI duration;
- average estimated AI cost;
- average chunks and pages processed/skipped;
- average confidence;
- document cache hits/misses and hit ratio;
- early-completion count and ratio;
- request/token totals;
- products, requirements, duplicate removals, conflicts, and ignored chunks.

Direct cache access remains admin-only. Progress events remain owner,
company-owner, or admin scoped.

## Benchmarks

The performance test suite covers 50, 120, 250, and 500-page planning. The
following deterministic simulation uses four workers, an eight-page nominal
chunk, a 50% cache-hit ratio, 60% early-work ratio, 1,000 ms per AI request,
and USD 0.08 per AI request:

| Pages | Selected | Planned chunks | Sequential | Parallel | Speedup | AI calls after cache | Cost after cache |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 50 | 7 | 5,000 ms | 2,000 ms | 2.5x | 2 | $0.16 |
| 120 | 120 | 15 | 9,000 ms | 3,000 ms | 3.0x | 4 | $0.32 |
| 250 | 160 | 20 | 12,000 ms | 3,000 ms | 4.0x | 6 | $0.48 |
| 500 | 160 | 20 | 12,000 ms | 3,000 ms | 4.0x | 6 | $0.48 |

These are deterministic capacity-model results, not production-provider
latency claims. Live jobs record their real phase durations, requests, tokens,
cost estimates, cache behavior, and early-completion result in the database.

## Tests

- `document-intelligence-v3-1.test.ts`: configuration, four document sizes,
  prioritization, adaptive sizing, guardrails, early completion, cache
  rebinding, progress, and modeled performance/cost gains.
- `document-intelligence-v3.test.ts`: existing inspection, chunking, merge,
  concurrency, and cost tests.
- `document_intelligence_v3_1.sql`: schema, compatibility RPCs, RLS, cache,
  progress, version lineage, and ignored-chunk fixtures.
- `document_intelligence_v3.sql`: existing claim/resume and RLS regression.

## Deployment and rollback

Deployment order:

1. verify the linked project and pre-deployment invariants;
2. apply only
   `202607230006_document_intelligence_v3_1_performance.sql`;
3. run the SQL regression suite;
4. deploy only the JWT-protected `tender-document-engine`;
5. verify function status, an unauthenticated 401 response, version hashes,
   RPC signatures, RLS, and schema invariants.

Rollback does not delete production data:

1. redeploy the preceding v3 function bundle;
2. restore v3.0 parsing/extraction as repository-current;
3. stop writing v3.1 cache/progress/accounting fields;
4. retain additive cache, progress, benchmark, and accounting rows for audit;
5. do not rewrite migration history.

## Known limitations and v3.2 candidates

- Token/cost guardrails cannot predict the exact usage of an in-flight call.
- ETA uses current-job elapsed time rather than a historical percentile model.
- Cache invalidation is version/model/TTL based; it does not yet support
  operator quarantine of one bad extraction.
- Early completion uses deterministic completeness and fact stability rather
  than a learned marginal-value model.

Recommended v3.2 work:

- provider-side prompt caching and batch APIs where contractually safe;
- historical p50/p90 ETA by document size and MIME type;
- cache quarantine/review controls and quality sampling;
- learned section value ranking from verified extraction outcomes;
- per-company/provider budget policies and alert thresholds;
- OpenTelemetry export for job/stage/chunk traces.

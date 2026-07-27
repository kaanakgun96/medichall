# Lot-level tender matching

The canonical company-product fields and readiness/backfill rules used by
this calculation are documented in
[`product-matching-readiness.md`](product-matching-readiness.md).

## Scope

Lot Match v1 adds a deterministic, evidence-backed comparison for every
normalized tender lot. It is backend-only and additive:

- production HTML and React layouts are unchanged;
- document discovery, retrieval, chunking, extraction, resume, cache, timeout,
  and provider behavior are unchanged;
- no PDF, chunk, or tender text is sent to an AI provider by lot matching;
- the legacy overall match and Match Score v2 remain available and are
  refreshed before lot matching;
- no existing table, RLS policy, RPC signature, or result is replaced.

The calculation version is `lot-match-v1`.

## Architecture diagnosis

The repository and production schema were inspected before implementation.

### Existing overall matching

After an applied Document Intelligence result,
`tender-document-engine/index.ts` calls:

1. `refresh_explainable_tender_match(bigint,bigint,uuid)`, which updates the
   requesting company's existing `opportunity_matches` row; and
2. `refresh_opportunity_match_score_v2(bigint,bigint,uuid)`, which upserts the
   requesting company's `opportunity_match_scores_v2` comparison row.

The new refresh runs after both calls. Errors are added to the existing
partial pipeline-stage result and do not remove the overall match.

### Company data

Production `products` contains the catalog identity fields `id`, `ref`,
`name`, `category`, `description`, `company_id`, and `is_active`, plus media
and timestamp fields. The current production table does not contain
structured material, dimensions, sterility, packaging, certification, or
capacity columns. `companies.certifications` is text and
`company_match_profiles.certifications` is a text array.

The mapper reads the confirmed base fields and safely recognizes optional
structured fields if they are added later. When a field does not exist, its
component is `unknown`; it is not treated as a contradiction.

### Tender extraction and evidence

The canonical existing inputs are:

- `tenders.extracted_products`;
- `tenders.ai_lots`;
- `tenders.document_extraction_v3`;
- `tenders.missing_information`;
- `tenders.document_confidence_score`; and
- `tender_document_evidence`.

Each evidence row can link to the tender, document, analysis job, product
name, lot number, field, value, quantity, page, sheet, cell, quote, and
confidence. Product-level v3 evidence carries the same document/page
provenance.

Production had no lot-level match relation or compatible JSON payload before
this migration.

## Data flow

```text
persisted Document Intelligence v3.1 output
  -> normalize explicit lots, product lot numbers, and evidence
  -> retain ambiguous products in an unassigned group
  -> load the requesting company's active catalog and certifications
  -> compare each lot with every company product deterministically
  -> select the best catalog candidate and apply blocker caps
  -> upsert one versioned result per company/tender/lot
  -> attach a compact aggregate summary to Match Score v2
  -> expose owner-scoped results through an authenticated RPC
```

The calculation does not read or write analysis jobs or chunks and contains
no network or AI-provider call.

## Normalization

`normalizeTenderLots`:

- keys explicit numbered lots and products as `lot:<normalized number>`;
- keeps same-name products in different lots separate;
- retains products without a lot as `unassigned` with
  `ambiguous_association=true`;
- retains unnumbered explicit lots separately as `explicit:<position>`;
- merges duplicate references only within the same lot and normalized product
  identity;
- deduplicates evidence by document, page, sheet, cell, field, quote, and
  extracted value, retaining the highest confidence;
- retains requirements, quantities, certifications, missing information, and
  an evidence-derived extraction confidence.

No value is synthesized to fill missing extraction or catalog data.

## Scoring

The score is the weighted mean of applicable components. `unknown` components
are omitted from the denominator, while evidence and company-data
completeness make uncertainty visible through the confidence score.

| Component | Weight | Deterministic evidence |
|---|---:|---|
| Product identity/category | 30 | Exact, containment, and token overlap |
| Technical specification | 15 | Explicit requirements against catalog text |
| Dimensions/size | 10 | Explicit normalized dimensional signatures |
| Material | 7 | Explicit material fields |
| Sterility | 10 | Explicit sterile/non-sterile signal |
| Single-use/reusable | 7 | Explicit use-type signal |
| Certification/regulatory | 10 | Required certificates against recorded certificates |
| Packaging | 4 | Explicit packaging text |
| Quantity/capacity | 2 | Only comparable value/unit pairs |
| Tender evidence completeness | 2 | Products with deduplicated evidence |
| Company data completeness | 3 | Catalog and certification field coverage |
| **Total** | **100** | |

Recommendation thresholds:

- 85–100: `strong_match`;
- 70–84: `good_match`;
- 50–69: `possible_match`;
- 30–49: `weak_match`;
- 0–29: `not_recommended`.

Confidence is 50% extraction confidence, 25% tender evidence coverage, and
25% company-data completeness. Unassigned/ambiguous lots are capped at 60;
evidence-free lots are capped at 45.

### Hard blockers

The score is capped at 29 when any of these explicit conditions applies:

- requested product category is absent;
- sterile/non-sterile contradiction;
- single-use/reusable contradiction;
- a mandatory certificate is absent from otherwise populated certification
  records;
- explicit dimensions do not include a required signature;
- powder-free versus powdered;
- latex-free versus explicit latex;
- non-adhesive versus explicit adhesive.

An explicit material contradiction is capped at 39. Missing company fields are
reported in `unknowns` and never converted into a blocker.

## Best candidate and aggregation

Every active company product is scored independently. The winner is ordered
by match score, then confidence, then product ID for stable tie-breaking.
Tender and company evidence references are returned with the selected product.

The aggregate records:

- highest-matching lot;
- counts for all five recommendations;
- average score of lots above `not_recommended`;
- blocked-lot count; and
- a compact aggregate score: 70% highest-lot score plus 30% relevant-lot
  average.

If no lot is commercially relevant, the highest score is retained rather than
averaging irrelevant lots.

## Persistence and authorization

Migration `202607270001_lot_level_tender_matching.sql` adds:

- `tender_lot_matches`;
- three compact summary columns on `opportunity_match_scores_v2`; and
- `get_tender_lot_matches_v1(bigint,bigint)`.

Migration `202607270002_lot_level_tender_matching_grants.sql` explicitly
removes Supabase platform-default service-role privileges and re-grants only
`SELECT`, `INSERT`, and `UPDATE` on the table plus sequence usage/read.

The unique identity is:

```text
(company_id, tender_id, lot_key, calculation_version)
```

An SHA-256 hash covers the version, normalized lot, and complete company
comparison input. An unchanged row is reused without an update. Removed lot
keys are marked `superseded`; no result is deleted. A failed lot is persisted
independently when possible and cannot discard completed siblings.

RLS is enabled, but ordinary authenticated users receive no direct table
privileges. The service role performs calculation writes. Authenticated owners
and administrators read through the security-definer RPC only. Anonymous
execution is revoked. The RPC repeats owner/admin/service authorization and
omits the private input hash, normalized calculation input, and trace ID.

Application read:

```sql
select public.get_tender_lot_matches_v1(
  p_company_id := :company_id,
  p_tender_id := :tender_id
);
```

An authenticated manual refresh is also available through the
`tender-lot-matching` Edge Function with `action=refresh`. `action=status`
returns the same authorized RPC payload. The function validates the bearer
session in-process and has no cron, internal-secret, or AI-provider path.

## Pipeline behavior

When Document Intelligence applies a result:

1. the existing explainable match refresh runs;
2. the existing Match Score v2 refresh runs;
3. lot matching reads the already-persisted extraction;
4. individual lot results are calculated and upserted;
5. counts, reuse, failure, and calculation version are attached to the
   `explanation_generation` pipeline-stage metadata.

An unexpected lot subsystem error marks that stage partial. The overall match
and extracted tender result remain available. A scorer exception affects only
its own lot.

## Tests

Deterministic TypeScript tests cover:

1. exact product and requirement match;
2. missing company specification;
3. explicit technical contradiction;
4. sterility blocker;
5. mandatory certification absence;
6. best catalog candidate;
7. evidence deduplication;
8. same name in different lots;
9. incomplete extraction confidence;
10. deterministic rerun;
11. per-lot failure isolation; and
12. zero document-AI/network calls.

`supabase/tests/lot_level_tender_matching.sql` covers schema, constraints,
unique-row idempotency, minimum grants, RLS presence, owner RPC output,
private-field omission, direct-table denial, and cross-tenant denial. The existing RPC
compatibility suite checks the new signature without removing any old one.

Repository verification:

```bash
deno fmt --check \
  supabase/functions/_shared/lot-matching-v1.ts \
  supabase/functions/_shared/lot-matching-v1.test.ts \
  supabase/functions/_shared/lot-matching-service.ts \
  supabase/functions/tender-document-engine/index.ts \
  supabase/functions/tender-lot-matching/index.ts
deno check --frozen --config supabase/functions/deno.json \
  supabase/functions/tender-document-engine/index.ts \
  supabase/functions/tender-lot-matching/index.ts
deno lint --config supabase/functions/deno.json \
  supabase/functions/_shared/lot-matching-v1.ts \
  supabase/functions/_shared/lot-matching-v1.test.ts \
  supabase/functions/_shared/lot-matching-service.ts \
  supabase/functions/tender-lot-matching/index.ts
deno test --frozen --config supabase/functions/deno.json \
  supabase/functions/_shared/*.test.ts
```

Database tests run after the migration exists on the authorized target and
always end in `ROLLBACK`.

## Production validation

The controlled validation uses tender `2952`, company `11`, and the persisted
Document Intelligence result from job `60` if they remain available.

Before calculation, record:

```sql
select
  (select count(*) from public.tender_document_analysis_jobs
    where tender_id = 2952) as analysis_jobs,
  (select count(*) from public.tender_document_analysis_chunks
    where job_id = 60) as job_60_chunks,
  (select ai_request_count from public.tender_document_analysis_jobs
    where id = 60) as job_60_ai_requests;
```

After invoking one refresh twice, inspect:

```sql
select
  company_id,
  tender_id,
  lot_number,
  lot_title,
  match_score,
  recommendation,
  confidence_score,
  best_company_product_id,
  best_company_product_name,
  blockers,
  unknowns,
  tender_evidence,
  calculation_version
from public.tender_lot_matches
where company_id = 11
  and tender_id = 2952
  and calculation_version = 'lot-match-v1'
  and status in ('completed', 'failed')
order by match_score desc nulls last, lot_key;
```

Compare the three job/chunk/request counters with their baseline, verify one
logical row per lot, call both safe read RPCs, and verify the existing
`opportunity_matches` and `opportunity_match_scores_v2` rows remain present.

### Controlled production result — 2026-07-27

The production-safe case used tender `2952`, company `11`, and the persisted
job `60` extraction:

- extraction input: 11 explicit lot objects, 14 products, and 19 evidence
  rows;
- normalized/persisted results: 12 (the additional row is the explicitly
  ambiguous unassigned product group);
- recommendations after the structured validation product was added:
  0 strong, 1 good, 0 possible, 0 weak, and 11 not recommended;
- highest relevant result: the explicitly unassigned “2-layer surgical drape
  with adjustable central adhesive opening”, score 77, `good_match`, compared
  with validation product `67`;
- highest-result blockers: none;
- highest-result unknown: production capacity;
- highest-result evidence pages: 1, 41, and 42;
- all 11 numbered/unrelated rows remained not recommended, with a maximum
  score of 24;
- failed results: 0;
- version: `lot-match-v1`.

The extraction did not reliably associate the positive surgical-drape
requirements with a numbered lot. The result therefore remains `unassigned`;
no lot number was guessed.

Repeating the exact repository calculation produced identical scores and all
12 input hashes. Before and after validation, the tender had six analysis
jobs, latest job 60, job 60 had four chunks and one recorded AI request.
Product readiness and lot matching therefore created no document job, chunk,
or provider request.

Both migrations are present in Supabase migration history. RLS is enabled;
authenticated direct table access and anonymous RPC execution are absent. The
authorized RPC returned 12 lots and the same aggregate summary.

## Deployment and rollback

Deploy only:

1. migration `202607270001_lot_level_tender_matching.sql`;
2. migration `202607270002_lot_level_tender_matching_grants.sql`;
3. `tender-document-engine`; and
4. `tender-lot-matching`.

Do not deploy frontend assets or any other function.

Rollback:

1. stop calling `tender-lot-matching`;
2. redeploy the immediately preceding `tender-document-engine` bundle;
3. keep `tender_lot_matches` and summary fields for audit while readers are
   removed;
4. only in a separately reviewed maintenance window, use the commented manual
   rollback in the migration if no reader depends on it.

Never delete extraction, document, job, chunk, evidence, match, company,
product, user, Storage, or migration-history data during rollback.

## Known limitations

- The product profile migration now supports structured dimensions,
  sterility, use type, material, packaging, certification, regulatory,
  capacity, and specification fields. Legacy products still remain unknown
  for any field that has not been explicitly entered or conservatively
  backfilled.
- Matching is intentionally lexical and rules-based; it does not infer
  medical compatibility from semantic similarity.
- Ambiguous unassigned evidence is preserved but is not guessed into a
  numbered lot.
- Lot matching does not replace or recalibrate the global tender score.

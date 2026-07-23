# MedicHall tender and matching-engine audit

Audit scope: repository `kaanakgun96/medichall`, branch `react-migration`,
starting at commit `735b8eaa44723c5d0d7507fe9bea153a4df23db0`.

This is a code and schema audit. It does not claim that repository migrations
exactly reproduce the live Supabase project. In fact, deployment drift is one
of the central findings. No production data, Edge Function logs, database
function definitions, or provider telemetry were available to calculate
current quality metrics.

## 1. Executive summary

Tender matching quality is poor for structural reasons, not one isolated model
or UI bug:

1. **The deterministic matcher does not use the company product catalog or
   extracted tender products.** It scores raw profile-keyword substrings,
   country text equality, and CPV equality.
2. **“Document match” is not a match.** It is a copy of the model's
   self-reported extraction confidence. The composite opportunity score rewards
   document confidence and completeness even when company relevance is low.
3. **The active deep-analysis button skips document discovery.** It calls the
   document engine directly. An openly downloadable attachment on a linked
   procurement page is therefore missed unless it was registered earlier by a
   separate/manual path.
4. **Company-specific AI output is stored as tender-global data.** Lot fit
   scores are generated with one company's profile and written to
   `tenders.ai_lots`, where another company can receive the same result.
5. **Refreshes update only part of each match row.** Base scores can change
   while composite/document/confidence/explanation fields remain stale.
6. **The ingestion window and source coverage are narrow.** The only automatic
   source is TED, with an exact CPV allowlist, a two-day default window, and a
   two-page default cap.
7. **The database installation is not reproducible from migrations.** Duplicate
   migration version prefixes and runtime-required manual SQL patches mean the
   repository cannot prove which scoring and document behavior is live.

The recommended first remediation is **Phase 0: export the live schema/function
definitions, add run-level observability, and build a human-labeled benchmark
before changing weights or prompts**. Otherwise an apparent scoring fix cannot
be measured and may target code that is not deployed.

## 2. Current architecture diagram

See [matching-engine-data-flow.md](matching-engine-data-flow.md) for the Mermaid
diagram and persisted boundaries.

The implemented architecture has four loosely coupled layers:

- `ted-sync` imports summarized TED notices and refreshes base matches.
- optional resolver/discovery/archive workers register tender documents;
- `tender-document-engine` asks Claude to extract facts and then runs the
  explainable refresh;
- legacy and React frontends read different score fields and ordering semantics.

There are two unrelated matching systems:

- `opportunity_matches`: company-to-tender and company-to-distributor;
- `matchmaking_matches`: two-sided manufacturer/distributor/buyer matchmaking.

This audit treats the first as the tender engine and documents the second only
to prevent score-field confusion.

## 3. End-to-end data flow

### 3.1 Implemented path

1. `pg_cron` calls `ted-sync` daily.
2. `ted-sync.handle` queries TED Search API v3 with CPV/date filters.
3. `firstText`, `toArray`, `toIso2`, and `safeIso` map notices.
4. Rows are upserted by `(source, source_notice_id)` into `public.tenders`.
5. Past-deadline rows are marked closed.
6. ECB values and English translations are best-effort enrichments.
7. Every company profile is passed to
   `refresh_company_opportunity_matches`.
8. That RPC scores every open, non-expired tender; results are upserted into
   `public.opportunity_matches`.
9. A partner can manually start `portal.html.deepAnalyze`.
10. The portal directly queues `tender-document-engine`.
11. The engine uses up to six already registered PDF/CSV/TXT files, or a TED
    notice fallback when a manual SQL patch permits an empty queue.
12. Claude returns products, lots, confidence, completeness, missing
    information, summary, and company-conditioned fit text.
13. Tender-global extraction fields and job-scoped evidence rows are stored.
14. `refresh_explainable_tender_matches` copies the base score and combines it
    with extraction confidence/completeness.
15. The legacy portal displays `match_score`; the React opportunity card
    displays `opportunity_score` but queries/orders/filters by `match_score`.

### 3.2 Data that never reaches the score

- `public.products` names, categories, descriptions, or regulatory attributes;
- extracted product names, quantities, dimensions, materials, sterility,
  packaging, technical requirements, or required certifications;
- AI lot `catalog_fit_score`;
- company type, OEM/private-label capability, company description, and product
  categories;
- saved, dismissed, contacted, or applied history as learning signals;
- semantic embeddings, synonyms, medical ontologies, or normalized units.

## 4. Tender-source inventory

| Source | Code path | Method | Duplicate/update behavior | Gaps |
|---|---|---|---|---|
| TED Search API v3 | `supabase/functions/ted-sync/index.ts`, `handle` | Daily or manual POST; exact CPV/date query; active scope | Unique `(source, source_notice_id)` and upsert; TED `onlyLatestVersions` | Only automatic source. Default 2-day/2-page window. No update-date query. Cancellation/status details are not mapped. |
| TED detail/Search API | `ted-notice-resolver.tedSearch`; document-engine fallback | On-demand | Does not create tenders | Resolver is no longer in the active deep-analysis click path. |
| Manual demo SQL | `supabase/seeds/match_engine_demo.sql` | SQL insert/upsert | Same unique key | Explicitly demo-only; not a production importer. |
| Manual document registration | `docs/REGISTER_TENDER_DOCUMENTS_EXAMPLE.sql` | SQL insert of attachments | Unique tender/file URL | Registers documents, not tenders. |
| Other procurement sources | schema permits arbitrary `tenders.source` | None found | n/a | No importer, scheduler, source adapter, or source-specific identifier logic exists. |

### Ingestion behavior

- **Scheduled job:** `202607100006_ted_cron.sql` schedules 06:30 UTC.
- **CPV scope:** `TED_CPV` or a hardcoded medical list. The code comments state
  TED matches exact codes; the list includes broad `33000000` plus selected
  descendants, but cannot cover all medical procurement classifications.
- **Country scope:** unrestricted unless `TED_COUNTRIES` is set.
- **Pagination:** 250 rows/page, default 2 pages, hard maximum 10.
- **Date range:** default two publication days, manual maximum 60.
- **Retries:** three query shapes, but no network retry/backoff per request.
- **Row failures:** mapping exceptions are counted in `skipped_rows`; tender
  identity and original exception context are not persisted.
- **Duplicate prevention:** database uniqueness handles repeated publication
  numbers for the TED source.
- **Update handling:** repeated notices overwrite mapped fields; enrichment
  columns not included in the upsert payload are preserved by PostgREST.
- **Expiry:** a daily update closes open rows with past non-null deadlines.
- **Cancellation:** no cancellation/status field from TED is requested or
  mapped; a cancelled notice with a future/null deadline can remain open.
- **Unknown deadline:** remains open indefinitely unless another process edits
  it.
- **Failure reporting:** normal response contains attempt/error arrays, but the
  function's outer catch returns HTTP 200 with `ok:false`. No durable sync-run
  table exists.

### Incorrect or incomplete tender fields

`firstText` selects English when available, otherwise the first object key or
array element. That is a lossy strategy for multi-lot/multi-buyer fields.
`deadline-receipt-tender-date-lot`, estimated values, countries, and CPVs may
contain multiple values, yet deadline/value/country are reduced to a single
text. `language_code` is always stored as `"en"` even when the chosen title or
description is another language. `product_keywords` is always stored as an
empty array.

## 5. Document-retrieval flow

### 5.1 Resolver

File: `supabase/functions/ted-notice-resolver/index.ts`

Functions: `tedSearch`, `collectUrls`, `scoreUrl`.

- Queries TED by publication/notice number with three query variants.
- Recursively extracts absolute HTTP(S) URLs from returned JSON.
- Ranks URLs using hostname/word/extension heuristics.
- Writes the top non-TED-detail URL to both
  `procurement_documents_url` and `source_url`.
- Records completed/partial/failed resolution state and a short note.

Limitations:

- no timeout, retry/backoff, or reachability check for the selected “best” URL;
- lexical ranking can select a buyer/site URL rather than a document portal;
- overwriting `source_url` loses the stable official notice destination;
- replacing `raw_payload` with resolver output can discard the original sync
  payload;
- only TED-format publication numbers are supported;
- resolver requires a company ID for authorization even though the resolved
  tender URL is global.

### 5.2 Static crawler

File: `supabase/functions/tender-attachment-discovery/index.ts`

Functions: `candidates`, `fetchText`, `inspect`, `run`.

Observed capabilities:

- follows relative links with `new URL(value, base)`;
- preserves query parameters and removes fragments;
- follows HTTP redirects;
- extracts static `<a href>`, XML `URI`, and raw HTTP(S) strings;
- follows up to eight pages and examines up to 180 unique links;
- follows same-host pages or cross-host links with procurement-related terms;
- identifies direct PDF, Word, Excel, CSV, TXT, and ZIP URLs by extension or
  content type;
- blocks common loopback/private IPv4 hostname forms.

Observed non-capabilities:

- no JavaScript execution or dynamically generated DOM;
- no cookies, session continuity, form submission, authentication, CAPTCHA,
  browser headers, or anti-bot handling;
- no retry/backoff, timeout, rate-limit response handling, or robots policy;
- no complete private-network/DNS-rebinding protection;
- no reason retained for each failed URL;
- caught page failures are discarded and the final job stores a generic
  “login, JavaScript, CAPTCHA or manual URLs” explanation;
- failed pages are still included in `pages_scanned` because they enter the
  visited set before fetch success.

### 5.3 Why the known accessible-link scenario fails

File/function: `portal.html`, `deepAnalyze`.

The current button explicitly takes a “fast path” and calls only
`tender-document-engine`. It does not call:

- `ted-notice-resolver`;
- `tender-attachment-discovery`;
- `tender-archive-worker`.

Therefore the existence of an accessible link on a source/detail page is
irrelevant to the active path. The link is never searched. The engine analyzes
already registered documents or the TED notice fallback.

### 5.4 ZIP/archive path

File: `supabase/functions/tender-archive-worker/index.ts`

Functions: `convert`, `processJob`.

- 30 MB compressed, 100 MB extracted, 60-entry limits;
- rejects unsafe paths and executable extensions;
- nested ZIPs are skipped;
- PDF/CSV/TXT pass through;
- XLS/XLSX becomes CSV for up to 20 sheets;
- DOCX becomes Mammoth raw text;
- outputs are hashed, uploaded, and registered as child documents.

This worker is not invoked by the active deep-analysis path. Direct DOCX/XLSX
documents are selected by the queue SQL but filtered out by the document
engine, because conversion exists only inside the ZIP worker. Direct legacy
DOC, HTML, and images have no parser.

## 6. Parsing flow

| Format | Parser/path | Limits | Information-loss risk |
|---|---|---|---|
| PDF | Sent as an Anthropic PDF document block | 20 MB/file; max 6 selected docs | No local validation/OCR fallback; model/provider page/context limits apply; scanned-PDF success is unmeasured. |
| CSV | UTF-8 `TextDecoder`, then first 200,000 characters | 20 MB download | Non-UTF-8 encodings garble; late rows/columns truncate; no dialect/schema validation. |
| TXT | Same as CSV | Same | Same encoding/truncation issues. |
| XLS/XLSX in ZIP | `xlsx` to per-sheet CSV | first 20 sheets; archive limits | Formatting, images, formulas, merged-cell semantics, hidden sheets, and workbook relationships can be lost. |
| Direct XLS/XLSX | Discovered/queued but rejected by engine MIME filter | n/a | Document can occupy one of six selected IDs and then not be analyzed. |
| DOCX in ZIP | Mammoth `extractRawText` to TXT | archive limits | Tables, page numbers, headers/footers, formatting, and cell provenance are lost. |
| Direct DOCX | Discovered/queued but rejected by engine MIME filter | n/a | Not converted. |
| DOC | Recognized by discovery/queue | n/a | Neither archive converter nor engine supports it. |
| ZIP | `fflate.unzipSync` | 30 MB compressed, 100 MB extracted, 60 files | Password-protected/corrupt archives fail; nested archives skipped. |
| HTML | Used only as a static link source | 4 MB/page | Procurement facts in HTML are not structured/extracted as documents. |
| Images | No parser | n/a | Image-only specifications are unavailable. |
| Scanned PDF | No explicit OCR pipeline | provider-dependent | No OCR status, confidence, fallback, or benchmark. |

Documents are merged into one Claude request, not independently analyzed and
then reconciled. `DOCUMENT MAP` preserves IDs, but conflicting attachments,
revisions, lots, and language variants can be conflated. Only six documents are
selected, prioritized by coarse `document_type`, with no revision date or
attachment completeness check.

## 7. AI extraction flow

### Provider and model

- Provider: Anthropic Messages API.
- Function: `supabase/functions/tender-document-engine/index.ts`.
- Model selection:
  `DOC_ENGINE_MODEL` → `ANTHROPIC_MODEL` → `claude-sonnet-4-6`.
- Model aliases are not immutable snapshots; the job stores `model_name` but no
  prompt version.
- Temperature: 0.
- Output budget: 16,000 tokens.
- Retry: one additional call when JSON parsing fails; if the first response was
  truncated, the retry asks for at most 12 lots and shorter quotes.

### Inputs and truncation

- maximum six database-selected documents;
- maximum 20 MB downloaded per document;
- PDF supplied as native document blocks;
- text/CSV truncated at 200,000 characters each;
- notice fallback flattened to 60,000 characters;
- raw-object traversal stops after depth six or approximately 50,000 joined
  characters;
- lots limited by prompt to 30, then 12 on truncation retry.

### Output schema requested

The prompt asks for:

- `analysis_status`;
- document confidence and completeness;
- summary and missing information;
- product name and conservative normalized name;
- lot, quantity/value and unit;
- packaging, sterility, material, dimensions;
- required certifications and technical requirements;
- source evidence with page/sheet/cell fields;
- lots with value and company-conditioned catalog fit;
- company-conditioned fit narrative.

### Important fields not structured

The output has no dedicated validated fields for:

- delivery country/place;
- submission deadline;
- manufacturer-only/distributor-only eligibility;
- bidder legal/financial eligibility;
- exclusion grounds;
- delivery schedule;
- regulatory jurisdiction;
- standard/version identifiers separate from free text;
- lot-product relationships beyond repeated strings;
- unit normalization or dimensional compatibility.

### Validation and hallucination controls

Prompt rules are conservative, but post-response validation is limited to:

- extracting a JSON object from text;
- numeric score clamping;
- truncating quote/value strings;
- filtering evidence whose `document_id` is not in selected database IDs.

There is no runtime JSON schema validator, required-field/type validator,
source-quote search, numeric consistency check, unit validator, certificate
normalizer, or rule requiring each stored product field to retain evidence.
The model self-reports both confidence and completeness. `analysis_status` is
trusted (`completed` exactly, anything else treated as partial).

### Fallback evidence defect

Fallback sources use synthetic document IDs `-1` and `0`, but evidence is
filtered against the positive `selected_document_ids`. Consequently all
fallback evidence is removed. Products can still be stored in
`tenders.extracted_products`, the job can complete, and
`analyzed_document_count` can report two fallback inputs while the evidence
count is zero.

### Company-conditioned extraction defect

The prompt includes company profile data for `lots.catalog_fit_score` and
`fit_narrative`. The output `ai_lots` is then written to the shared
`public.tenders` row. Document analysis is queued per company, but extraction
status/products/lots/confidence are tender-global. Different companies can
analyze the same tender concurrently and overwrite each other; one company's
lot-fit result can be shown for another company.

The `for (companyId of companyIds)` loop updates `fit_narrative` using
`job.company_id` each iteration, then refreshes all matched companies. This
repeats the initiating-company update rather than producing a per-company
explanation.

## 8. Company-profile inputs

### Deterministic tender scoring

| Collected field | Stored in | Actual influence |
|---|---|---|
| Product keywords | `company_match_profiles.product_keywords` | Primary substring component (50% or 60%). |
| Target countries | `target_countries` | Exact free-text country component (30% or 40%). Empty list is neutral 50. |
| CPV codes | `cpv_codes` | 20% when non-empty; exact array overlap in final migration. |
| Matching certifications | `company_match_profiles.certifications` | Tender score: none; stored tender certification score is always 0. |
| Company certifications | `companies.certifications` | No deterministic tender score; used by Claude context and legacy post-analysis badge comparison. |
| `public.products` | products table | Readiness count and UI/catalog only; not candidate generation or score. |
| Company name/description/type | `companies` | Not deterministic; name/description enter Claude fit context, type does not. |
| OEM/private label | match profile | Not deterministic tender score; enters Claude fit context. |
| Minimum match score | `min_match_score` | Stored only; no generation threshold. |
| Profile completeness | `profile_complete_score` | Stored only; active UI uses a separate five-check calculation. |
| Target partner types | `target_partner_types` | Not used by final distributor formula; not tender scoring. |
| Historical workflow status | `opportunity_matches.status` | Preserved on upsert; not a relevance feature. |

### Missing inputs

- product-level CPVs, synonyms, brands, model families, materials, dimensions,
  sterility, packaging, UDI/regulatory class, MDR conformity route, production
  capacity, lot size, and unit compatibility;
- normalized country identifiers and explicit excluded countries;
- certificate issuer, scope, standard version, validity, and expiration;
- bidder/manufacturer/distributor role eligibility;
- negative keywords and excluded categories;
- feedback labels explaining why a match was saved/dismissed.

An incomplete profile can still receive high scores because an empty country
list contributes 50 and no-CPV mode redistributes weight to keywords/country.
Confidence does not measure profile completeness.

## 9. Candidate-generation logic

Function:
`public.refresh_company_opportunity_matches` in the final migration.

### Tender candidates

Hard requirements:

- `tenders.status = 'open'`;
- deadline is null or future.

There is no hard filter for:

- keyword overlap;
- CPV overlap;
- target country;
- company/product category;
- certification;
- `min_match_score`;
- tender age/publication date;
- document availability;
- source quality.

Every open candidate is scored and upserted for every company profile. There is
no pagination/batch parameter or candidate limit. This is an
`O(companies × open tenders)` daily refresh.

False-positive risk is high because unrelated tenders are stored and generic
keywords can rank them above relevant but untranslated/synonym-only tenders.
False-negative risk occurs later because both portals load only the highest
rows (legacy limit 50; React paged/order by `match_score`) and because
ingestion itself has already excluded notices outside its CPV/date/page scope.

### Distributor candidates

All active candidates with `reviewed` or `verified` status are scored. Product
and country are the only total-score components. Certification/category fields
are calculated but excluded from the total.

### Refresh triggers

- daily `ted-sync`: base refresh for every profile;
- legacy `findMatches`: saves the profile, then base refresh;
- React Opportunities refresh: base refresh;
- document-engine completion: explainable refresh for every company already
  matched to the tender.

Profile save alone does not refresh. Product/certificate/company changes do not
have database triggers. A new company profile waits for manual refresh or the
next successful daily sync.

## 10. Complete scoring formula

See [matching-engine-scorecard.md](matching-engine-scorecard.md) for every
component, missing-data behavior, bounds, distributor formula, and four worked
examples.

The effective migration formula is:

```text
if company has CPVs:
  match_score = round(0.50 * keyword_score
                    + 0.30 * geography_score
                    + 0.20 * category_score)
else:
  match_score = round(0.60 * keyword_score
                    + 0.40 * geography_score)
```

Completed deep analysis later assigns:

```text
opportunity_score = round(0.45 * match_score
                        + 0.35 * document_confidence_score
                        + 0.20 * data_completeness_score)
```

Partial analysis uses 70%/20%/10%. Extracted facts are not inputs.

### Deployment ambiguity

`supabase/setup/CPV-YAMA.sql` replaces exact CPV comparison with hierarchical
digit-prefix comparison, but its replacement refresh function uses only
original-language title/description. The later English-normalization migration
uses English text but reverts to exact `array_overlap_score`. Whichever script
ran last controls production. The repository cannot identify it.

## 11. Match-explanation flow

### Deterministic evidence

Base `reasons` are generated in SQL:

- matched profile keywords;
- exact target country;
- any CPV overlap.

Base `risks` contains only an approaching-deadline message. These arrays are
derived from actual base score components, but they do not explain weights,
denominators, unmatched keywords, country mismatch, or how much each reason
contributed.

Explainable `evidence` is deterministic JSON with component labels/scores and
generic source strings. It is not document quotation evidence.

### Missing requirements

`tender_missing_information` identifies absent tender data (product
names/specifications, quantities, CPV, certificates, deadline, value). It does
not identify company eligibility failures.

The React component `MissingRequirements` presents
`opportunity_matches.missing_information`, falling back to tender missing
information, under the heading “Missing requirements.” That phrasing can imply
the company lacks requirements when the backend actually means the tender data
is absent.

### AI explanations

- `fit_narrative` and lot `fit_reason` are Claude-generated and independent of
  the deterministic formula.
- The generic legacy “Analyze with AI” path sends the base score/reasons and
  user/company context to `medichall-ai`; its prose is not stored as scoring
  evidence.
- AI explanations can contradict the base score because no consistency check
  compares mentioned fit/gaps to component values.

## 12. Refresh and staleness behavior

### Match-row upsert

The v2 base upsert preserves workflow status, but updates only:

- `match_score`;
- keyword/geography/certification/category components;
- reasons, risks, generator, and timestamps.

It does not update:

- profile/document/opportunity scores;
- confidence score/level;
- score basis;
- missing information;
- evidence;
- next best action;
- fit narrative.

Thus a profile or tender update can change the visible base score while leaving
the composite and explanations from an older analysis.

### Closed and expired rows

Only `status='new'` closed/expired matches are deleted. Saved/contacted/applied
history remains. The opportunity APIs do not filter tender status. Because RLS
allows authenticated users to read only open tenders, a preserved match can
join to a null tender:

- legacy portal renders a generic “Tender” row;
- React `mapOpportunityRow` throws when a tender opportunity lacks its nested
  tender, potentially failing the page request.

### Document changes

Document discovery, archive extraction, upload, or tender updates do not
automatically queue re-analysis. Analysis completion refreshes current matching
companies, but there is no document-set hash/prompt version/profile version in
the match row. Old document scores cannot be identified deterministically.

### Concurrency

The queue deduplicates only `(tender_id, company_id)` while tender extraction
state is global. Two companies can run jobs for one tender concurrently; both
set `tenders.document_analysis_status` and last writer wins for extracted
products/lots/confidence.

## 13. Frontend score presentation

### Legacy portal

Functions: `loadOpportunities`, `renderOppCard`, `paintDeepResult`,
`updateDashboard`.

- queries/orders by `match_score`;
- card rings and dashboard “high” counts display `match_score`;
- deep panel labels `match_score` as “Opportunity Score”;
- document confidence is separately labeled “AI confidence”;
- a certificate percentage is calculated client-side by substring matching
  extracted certificate names against `companies.certifications`; it is not the
  stored `certification_score`;
- AI lot fit and narrative are shown without stating that they were generated
  for the company that initiated the tender-global analysis.

### React portal

Files:

- `features/opportunities/api/opportunities-api.ts`;
- `utils/map-opportunity.ts`;
- `components/OpportunityScore.tsx`;
- `components/MatchBreakdown.tsx`;
- `components/MissingRequirements.tsx`.

Behavior:

- API pagination, minimum score, and ordering use `match_score`;
- the primary badge displays `opportunity_score`;
- when composite is null, it shows “Not calculated” and only mentions the
  legacy match in small text;
- profile/document/confidence fields are shown independently;
- “Document match” presents `document_match_score`, although the backend field
  is extraction confidence;
- keyword score is labeled “Product,” although no product table is used;
- missing tender data is labeled “Missing requirements.”

A user can therefore see a list ordered by one score with a different number
as the headline. Dashboard metrics continue to use base `matchScore`.

## 14. Critical findings

| ID | Type | Evidence | Observed behavior | Practical effect |
|---|---|---|---|---|
| C-01 | scoring | `supabase/migrations/202607100005_explainable_match_engine.sql`, SQL function `refresh_explainable_tender_matches`; `supabase/functions/tender-document-engine/index.ts`, `processJob` | `document_match_score` is document confidence, and composite score uses confidence/completeness—not extracted facts or company/document fit. | A well-parsed irrelevant tender can be promoted; exact product/specification evidence has no deterministic benefit. |
| C-02 | AI extraction / scoring | `supabase/functions/tender-document-engine/index.ts`, `buildClaudeContent` and `processJob`; fields `tenders.ai_lots`, `opportunity_matches.fit_narrative` | Company context generates fit fields, but `ai_lots` is stored on the shared tender. Per-company jobs write tender-global extraction state. | Cross-company contamination and last-writer-wins results; a company may see another company's lot fit. |
| C-03 | document retrieval | `portal.html`, `deepAnalyze`; Edge functions `ted-notice-resolver`, `tender-attachment-discovery`, and `tender-archive-worker` | Active click path skips resolver, crawler, and archive worker. | Publicly accessible linked documents are not discovered; notice-only analysis is used even when specifications are one link away. |
| C-04 | refresh/staleness / observability | `supabase/migrations/202607200002_english_normalization.sql`, SQL function `refresh_company_opportunity_matches`, `ON CONFLICT ... DO UPDATE` | Base refresh leaves composite/document/confidence/explanation fields untouched. | Score fields in the same row can represent different profile/tender/document versions. |
| C-05 | observability / parsing | `supabase/migrations/202607100005_*`, `202607100006_*`; `supabase/setup/MOTOR-KURULUM-TEK-SEFERDE.sql`; `DETAY-KURULUM.sql`; `DOKUMAN-YUKLEME.sql`, SQL function `register_uploaded_tender_documents` | Duplicate migration version prefixes exist; notice-only queue, `ai_lots`, `fit_narrative`, and upload RPC are manual patches. The upload RPC references `file_size` and `user_upload`, conflicting with migration `file_size_bytes` and the document-type constraint. | The repository cannot recreate or prove live behavior; fresh installs can fail the advertised document path. |

## 15. High-priority findings

| ID | Type | Evidence | Observed behavior | Practical effect |
|---|---|---|---|---|
| H-01 | tender discovery | `supabase/functions/ted-sync/index.ts`, `handle`, constants `DEFAULT_CPV`/`PAGE_LIMIT`, variables `lookbackDays`/`maxPages` | Only TED, exact CPV allowlist, default two-day and 500-row cap. | Relevant tenders outside codes/window/cap are never candidates. |
| H-02 | tender discovery / refresh/staleness | `supabase/functions/ted-sync/index.ts`, `handle` row mapping and past-deadline update; fields `tenders.status`, `deadline_at` | Cancellation and update status are not ingested; null deadlines never expire. | Stale/cancelled tenders can remain open and score highly. |
| H-03 | scoring | `supabase/migrations/202607100005_match_engine_v2_scoring.sql`, SQL functions `keyword_text_score` and `matched_keyword_list` | Raw substring coverage; no tokenization, synonyms, stemming, semantic similarity, or negative terms. | Generic/short words inflate unrelated matches; synonyms and morphology create false negatives. |
| H-04 | profile data / scoring | `supabase/migrations/202607200002_english_normalization.sql`, `refresh_company_opportunity_matches`; fields `certification_score`, `min_match_score` | Products and tender extracted facts are ignored; certifications always score 0; empty country gives 50; min score ignored. | Rich profiles do not improve precision and incomplete profiles look more certain than warranted. |
| H-05 | candidate generation | same final SQL function, `FROM public.tenders` and open/deadline predicate | Every open tender is stored for every profile; no relevance hard filter or batch limit. | Noise and quadratic work; top-50 ordering can hide relevant candidates. |
| H-06 | parsing | `202607100006_tender_document_engine.sql`, `queue_tender_document_analysis`; `tender-archive-worker/index.ts`, `convert`; `tender-document-engine/index.ts`, `SUPPORTED_MIME_TYPES` | Direct DOC/DOCX/XLS/XLSX and ZIP processing are disconnected from the active path; unsupported selected documents can consume the six-ID limit. | Key BOQs/specifications are silently excluded. |
| H-07 | AI extraction | `supabase/functions/tender-document-engine/index.ts`, `tryParse` and `processJob` evidence filtering | No schema or quote verification; fallback evidence IDs are discarded. | Unsupported extracted facts can be stored with no retained proof. |
| H-08 | scoring / frontend display | `apps/portal-react/src/features/opportunities/api/opportunities-api.ts`, `fetchOpportunityPage`; `components/OpportunityScore.tsx`; `components/MatchBreakdown.tsx` | Lists order/filter by base score but headline a potentially stale composite; document confidence is labeled match. | Users cannot reliably interpret rank or precision. |
| H-09 | scoring | `supabase/migrations/202607200002_english_normalization.sql` versus `supabase/setup/CPV-YAMA.sql`, both replacing `refresh_company_opportunity_matches` | Two mutually regressive replacement functions: English matching versus hierarchical CPV matching. | Live outcome depends on manual execution order; exact/family matches can be lost. |
| H-10 | parsing | `supabase/functions/tender-document-engine/index.ts`, `SUPPORTED_MIME_TYPES`/`buildClaudeContent`; no OCR/image worker in repository | No explicit OCR status, fallback, or quality check. | Scanned specifications can complete with missing/low-quality facts without a diagnosable OCR failure. |
| H-11 | observability / tender discovery | `supabase/migrations/202607100006_ted_cron.sql`, `cron.schedule`; `supabase/functions/ted-sync/index.ts`, outer `Deno.serve` catch | A credential literal is present in the cron SQL; fatal sync exceptions return HTTP 200; no run table. | Secret exposure risk and scheduler-level false success hide ingestion outages. |
| H-12 | refresh/staleness | `portal.html`, `saveMatchProfile`/`findMatches`; React `useCompanyProfileForm`; no database invalidation trigger | Profile edits do not automatically refresh; product/certificate/document changes have no invalidation mechanism. | Matches remain stale until a manual or successful daily refresh. |

## 16. Medium and low-priority findings

### Medium

| ID | Type | Evidence and effect |
|---|---|---|
| M-01 | tender discovery | `supabase/functions/ted-sync/index.ts`, `firstText` and row mapping: multilingual/multi-lot arrays collapse to one value, losing deadlines, buyers, values, and text. |
| M-02 | AI extraction | `ted-sync.handle` row field `language_code`; `tender-document-engine.processJob` fallback documents: language is hardcoded to English and model handling is implicit. |
| M-03 | document retrieval | `supabase/functions/ted-notice-resolver/index.ts`, `scoreUrl` and final tender update: URL is chosen lexically without reachability/content validation and overwrites official `source_url`. |
| M-04 | document retrieval | `tedSearch`, discovery `fetchText`/`inspect`, archive `processJob`, and document-engine `fetchAsBase64` use fetch without explicit timeout, retry/backoff, rate-limit handling, or per-host throttling. |
| M-05 | parsing | `tender-document-engine.buildClaudeContent` and `tender-archive-worker.convert`: CSV/TXT assume UTF-8 and truncate; XLS/DOCX lose layout/provenance; only 20 sheets and no nested ZIP. |
| M-06 | AI extraction | `tender-document-engine.processJob`; table `tender_document_analysis_jobs`: no immutable prompt/model version, input hash, provider request ID, token usage, or latency is stored. |
| M-07 | refresh/staleness | final `refresh_company_opportunity_matches` delete predicate; React `mapOpportunityRow`: saved/contacted expired matches remain, can join to null under tender RLS, and make React mapping fail. |
| M-08 | frontend display | SQL `tender_missing_information`; React `components/MissingRequirements.tsx`: “Missing requirements” often means missing tender data, not missing company capability. |
| M-09 | scoring | final `refresh_company_opportunity_matches` insert/conflict clauses; field `confidence_score`: starts at constant 70 and is omitted on conflict. Confidence is neither current nor calibrated. |
| M-10 | observability | `supabase/functions/{name}` versus `supabase/functions/medichall-ai/{name}`: duplicate function copies exist and the document-engine copies have materially different behavior. |
| M-11 | parsing | `tender-document-engine.processJob`, fallback synthetic documents and tender update: `analyzed_document_count` counts notice inputs, not successfully parsed procurement attachments. |
| M-12 | frontend display | `portal.html`, `certStatusList` and `paintDeepResult`: legacy certificate fit uses loose substring manipulation independent of the stored formula. |

### Low

| ID | Type | Evidence and effect |
|---|---|---|
| L-01 | scoring | SQL checks in `202607100003_match_engine_foundation.sql` and helper clamps constrain bounds, but rounding hides granularity and no calibration justifies integer precision. |
| L-02 | match explanations | Final `refresh_company_opportunity_matches` `reasons` construction states overlap but omits denominator, unmatched fields, weights, and negative evidence. |
| L-03 | observability | `tender-attachment-discovery.docType` uses a small multilingual keyword list; other languages become `other`, reducing queue priority. |
| L-04 | frontend display | `portal.html.renderOppCard`/`paintDeepResult` versus React `OpportunityScore`/`MatchBreakdown` use different labels for the score fields, complicating support and evaluation. |

## 17. Missing observability

The repository needs durable records for:

- ingestion run ID, start/end, query, pages requested/received, total reported,
  source latency/status, inserted/updated/unchanged/skipped/closed counts;
- per-notice mapping warnings and source version/update identifiers;
- document retrieval attempt per URL, parent page, status, redirect chain,
  MIME/size, duration, and normalized failure reason;
- parser outcome per file/sheet/page, encoding, truncation, OCR need/result, and
  extracted character/page count;
- AI prompt version, exact model snapshot, provider request ID, input document
  hashes, tokens, latency, retries, parse/schema errors, and cost;
- deterministic score run version and every raw component input/output;
- profile/tender/document version hashes attached to each match;
- reason/explanation provenance (`deterministic`, `AI`, `document quote`);
- explicit stale flags and invalidation reason;
- benchmark membership and human-review outcome.

Current job tables provide useful status/error basics for discovery, archive,
and document analysis, but they are not enough to reconstruct one opportunity
from source fetch through displayed score.

## 18. Proposed benchmark dataset

Do not seed fabricated production labels. Sample real, permission-appropriate
company/tender pairs and have at least two qualified reviewers label them.

### Row structure

```json
{
  "benchmark_version": "string",
  "case_id": "string",
  "tender_id": 0,
  "company_id": 0,
  "expected_relevance": "highly_relevant | potentially_relevant | irrelevant",
  "expected_score_min": 0,
  "expected_score_max": 100,
  "product_relevance": "exact | synonym | category_only | incompatible | unknown",
  "country_eligibility": "eligible | ineligible | unknown",
  "certification_eligibility": "eligible | missing | incompatible | unknown",
  "document_availability": "complete | partial | notice_only | inaccessible | scanned | archive",
  "human_explanation": "reviewer-authored rationale with cited source fields/pages",
  "actual_engine_score": null,
  "actual_base_score": null,
  "actual_document_score": null,
  "actual_confidence": null,
  "false_positive": null,
  "false_negative": null,
  "profile_snapshot_hash": "string",
  "tender_snapshot_hash": "string",
  "document_set_hash": "string",
  "engine_version": "string",
  "reviewer_ids": ["pseudonymous-reviewer-1"],
  "adjudication_status": "pending | agreed | adjudicated"
}
```

### Required case categories

Use stratified sampling so each category has enough cases to estimate error:

1. exact product match;
2. synonym/abbreviation match;
3. same category but wrong product;
4. exact CPV but wrong product;
5. wrong/missing CPV but exact product;
6. medical-service tender;
7. pharmaceutical tender;
8. construction/renovation tender;
9. unrelated hospital equipment;
10. expired tender;
11. cancelled/updated notice;
12. missing documents / notice-only;
13. scanned PDF;
14. multilingual tender;
15. ZIP attachment;
16. direct DOCX/XLSX attachment;
17. lot containing mixed relevant and irrelevant products;
18. required certificate missing;
19. wrong target country;
20. manufacturer-only requirement;
21. distributor-only requirement;
22. dimensions incompatible with the product;
23. generic “medical consumables” wording;
24. short/generic profile keyword substring collision;
25. family CPV versus descendant code;
26. null company countries/CPVs/certificates;
27. procurement page with an accessible second-hop document;
28. revised document set after an earlier analysis;
29. same tender analyzed by two different companies;
30. saved/contacted opportunity after expiry.

### Sampling and labeling

1. Sample across countries, languages, source age, CPV families, document
   states, and company profile completeness.
2. Include both retrieved and known-missed tenders; otherwise recall cannot be
   estimated.
3. Freeze source/profile/document snapshots before running the engine.
4. Have reviewers label relevance before seeing engine output.
5. Require cited document/profile evidence for `highly_relevant` and
   `irrelevant`.
6. Adjudicate disagreements and retain original labels.
7. Keep a fixed holdout set for regression and a rotating set for drift.

## 19. Proposed success metrics

No current values can be claimed from repository code alone.

| Metric | Calculation | Required denominator |
|---|---|---|
| Precision@5 | For each company, relevant (`highly` or policy-approved `potentially`) results in top 5 ÷ displayed results in top 5; macro-average companies | Labeled ranked candidates |
| Precision@10 | Same at top 10 | Labeled ranked candidates |
| Recall@20 | Relevant tenders found in top 20 ÷ all labeled relevant tenders available to that company | Benchmark must include missed/non-candidate tenders |
| False-positive rate | Irrelevant results above the product threshold ÷ all results above threshold | Agreed irrelevant labels |
| False-negative rate | Relevant results absent or below threshold ÷ all relevant pairs | Discovery plus scoring benchmark |
| Document retrieval success | Tenders with at least one expected public attachment downloaded/registered ÷ tenders with reviewer-confirmed public attachments | Ground-truth URL inventory |
| Document parse success | Supported downloaded documents yielding non-garbled, non-truncated usable text/pages ÷ supported downloaded documents | Per-document parser result |
| Structured extraction completeness | Correctly populated required fields ÷ applicable labeled fields, reported per field | Field-level human truth |
| Extraction precision | Correct extracted field values ÷ all extracted field values | Field-level truth and evidence |
| Stale-match rate | Displayed matches whose profile/tender/document/version hashes differ from the score input hashes ÷ displayed matches | Persisted version lineage |
| Evidence-backed explanations | Displayed explanation claims with deterministic input or verified source quote ÷ all displayed claims | Claim-level provenance |
| Candidate-generation recall | Relevant pairs entering scoring ÷ all relevant benchmark pairs | Full benchmark, before ranking |
| Score calibration | Observed relevance rate by score decile; Brier/ECE when labels are mapped to probabilities | Sufficient labeled pairs |
| Country eligibility violation rate | Top results with known ineligible country ÷ top results | Country ground truth |

Metrics must be sliced by language, country, document type/status, source, CPV
family, profile completeness, and tender age. Global averages can hide the
exact failure modes reported here.

## 20. Recommended remediation roadmap

### Phase 0 — observability and benchmark data

**Objective:** establish the deployed truth and measurable baseline.

**Required changes:**

- export live schema, migrations, function definitions, cron jobs, Edge
  Function versions/config, and relevant row counts;
- replace duplicate/manual migration history with a non-destructive baseline;
- add ingestion/retrieval/parser/AI/match run tables and version hashes;
- build and adjudicate the benchmark above;
- add deterministic tests that lock current formulas before redesign.

**Dependencies:** read-only production access, Supabase logs/function metadata,
domain reviewers.

**Risks:** exposing sensitive data in benchmark exports; mitigate with IDs,
access controls, and redaction.

**Acceptance criteria:** one trace ID can reconstruct source-to-card flow;
baseline metrics are reproducible; deployed SQL/Edge versions are known.

### Phase 1 — document retrieval reliability

**Objective:** retrieve known public procurement attachments reliably.

**Required changes:**

- restore a controlled resolver → crawler → archive path before analysis;
- persist per-URL attempts and actual failure reasons;
- add timeouts, bounded retries/backoff, MIME sniffing, redirect history, and
  per-host throttling;
- support browser-assisted/dynamic portals only through an explicitly secured
  worker;
- repair and migrate the manual-upload bridge;
- invoke ZIP/direct Office conversion consistently.

**Dependencies:** Phase 0 retrieval benchmark and security review.

**Risks:** SSRF, anti-bot violations, runaway crawl cost, sensitive documents.

**Acceptance criteria:** target retrieval success on reviewer-confirmed public
links; no private-network fetches; every failure has a normalized reason.

### Phase 2 — extraction quality

**Objective:** produce verifiable structured tender facts.

**Required changes:**

- add explicit OCR/image path and OCR-needed status;
- parse direct Office files, encoding-detect text, and preserve table/page/cell
  provenance;
- analyze documents individually, reconcile revisions/lots afterward;
- validate output with a strict runtime schema and source-quote checks;
- make extraction tender-global and company-independent;
- store company-specific fit in match-level tables only.

**Dependencies:** reliable documents and field-level benchmark labels.

**Risks:** cost/latency and false confidence from OCR or table parsing.

**Acceptance criteria:** field precision/completeness targets by document type;
zero stored material claims without verified provenance.

### Phase 3 — candidate generation

**Objective:** improve recall without scoring every company/tender pair.

**Required changes:**

- broaden and monitor source/CPV ingestion;
- normalize countries and CPVs;
- generate candidates from product/CPV/semantic signals with union-based
  recall, not one hard gate;
- explicitly handle unknown versus ineligible;
- batch and version candidate runs.

**Dependencies:** benchmark and normalized inputs.

**Risks:** overly strict filters create invisible false negatives.

**Acceptance criteria:** candidate recall target on benchmark; bounded candidate
volume and explainable inclusion reasons.

### Phase 4 — scoring redesign

**Objective:** rank actual product and eligibility fit.

**Required changes:**

- compare company products/capabilities to extracted tender products/lots;
- separate hard eligibility, relevance, evidence quality, and business value;
- use synonyms/ontology/semantic retrieval only with benchmark validation;
- treat document confidence as confidence, never relevance;
- calibrate score ranges and retain raw components;
- implement score-version and invalidation semantics.

**Dependencies:** Phases 0–3.

**Risks:** overfitting a small benchmark, opaque semantic components.

**Acceptance criteria:** target Precision@5/10 and Recall@20 improvements on
holdout; no known ineligible high matches; documented monotonic tests.

### Phase 5 — explanation quality

**Objective:** make every displayed claim traceable and consistent.

**Required changes:**

- derive deterministic reasons from the actual formula;
- attach verified document quotes for requirement claims;
- separate “tender data missing” from “company requirement missing”;
- generate AI narratives from frozen score evidence and reject contradictions;
- label deterministic versus AI content.

**Dependencies:** versioned score/evidence model.

**Risks:** verbose or misleading prose.

**Acceptance criteria:** evidence-backed explanation metric target; zero
contradictions in audited holdout; user-facing labels match backend semantics.

### Phase 6 — continuous evaluation

**Objective:** prevent regression and detect source/model drift.

**Required changes:**

- run benchmark and retrieval probes in CI/staging;
- monitor daily ingestion, source coverage, parser/AI failures, staleness, and
  score distribution;
- collect structured save/dismiss relevance feedback without treating raw
  clicks as truth;
- gate prompt/model/scoring rollouts with versioned comparisons.

**Dependencies:** all prior phases.

**Risks:** feedback bias and production-data leakage.

**Acceptance criteria:** release gates, drift alerts, weekly metric review, and
documented rollback for each engine version.

## Appendix A — inspected implementation inventory

### Edge Functions

- `supabase/functions/ted-sync/index.ts`
- `supabase/functions/ted-notice-resolver/index.ts`
- `supabase/functions/tender-attachment-discovery/index.ts`
- `supabase/functions/tender-archive-worker/index.ts`
- both root and nested copies of `tender-document-engine/index.ts`
- `supabase/functions/medichall-ai/index.ts`
- `supabase/functions/tender-digest/index.ts`
- `supabase/functions/public-assistant/index.ts` (confirmed unrelated to stored
  tender scores)

### SQL and setup

- match foundation, rules, v2, explainable, document, discovery, automation,
  TED cron, filter, CPV, English-normalization, and saved-search migrations;
- `CPV-YAMA.sql`, `MOTOR-KURULUM-TEK-SEFERDE.sql`,
  `DOKUMAN-YUKLEME.sql`, `DETAY-KURULUM.sql`, demo seed, and registration
  example;
- company/product setup and two-sided matchmaking migration.

### Frontend

- legacy opportunity/profile/search/deep-analysis functions in `portal.html`;
- React opportunity API, mapping, score/breakdown/reason/missing-requirement
  components;
- React tender API/card/formatting;
- React company-profile API/form mapping.

## Appendix B — RPC/function inventory

Scoring and matching:

- `calculate_keyword_overlap_score`
- `array_overlap_score`
- `keyword_text_score`
- `matched_keyword_list`
- `country_match_score`
- `cpv_overlap_score` (manual patch)
- all repository versions of `refresh_company_opportunity_matches`
- `refresh_explainable_tender_matches`
- `tender_missing_information`
- `set_opportunity_match_status`

Document flow:

- `queue_tender_document_discovery`
- `get_tender_document_discovery_status`
- `queue_tender_archive_jobs`
- `get_tender_archive_status`
- both queue definitions of `queue_tender_document_analysis`
- `get_tender_document_analysis_status`
- `save_tender_document_analysis`
- `register_uploaded_tender_documents` (manual setup)

Feed/search support:

- all migration versions of `search_tenders`
- `tender_filter_facets`
- `refresh_tender_eur_values`
- `cpv_catalog_with_counts`
- saved-search digest RPCs

Separate two-sided engine:

- `mm_normalize_array`
- `mm_overlap_score`
- `mm_role_fit`
- `mm_commercial_score`
- `refresh_matchmaking_matches`

## Appendix C — audit constraints

- No production database connection or row export was used.
- No Supabase dashboard, cron history, Edge logs, Anthropic logs, or live
  secrets/configuration were available.
- Repository comments claiming a function is “live” were not treated as proof.
- No real benchmark labels were fabricated.
- No scoring, ingestion, schema, Edge Function, or frontend behavior was
  changed by this audit.

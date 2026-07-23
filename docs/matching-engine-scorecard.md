# MedicHall matching-engine scorecard

This scorecard reverse-engineers the repository behavior. The final
migration-defined tender formula is in
`supabase/migrations/202607200002_english_normalization.sql`, function
`public.refresh_company_opportunity_matches`. A manually applied
`supabase/setup/CPV-YAMA.sql` can replace part of that behavior, so the live
database function definition must be exported before remediation.

## Tender opportunity scoring

| Component / field | Source | Observed formula or assignment | Weight in `match_score` | Missing-data behavior | Range / bound | Practical effect |
|---|---|---|---:|---|---:|---|
| `keyword_score` (shown as Product) | `company_match_profiles.product_keywords`; tender `product_keywords`; original and English title/description | `keyword_text_score`: percentage of distinct profile keywords found by raw case-insensitive substring in the text or by mutual substring against tender keywords | 50% when profile has CPVs; 60% otherwise | Empty profile keywords produce 0 | 0–100 via `least(100, ...)` | This is profile-keyword coverage, not product/catalog fit. Short or generic terms can match unrelated text; synonyms and token boundaries do not exist. |
| `geography_score` (Country) | profile `target_countries`; tender code/name | `country_match_score`: 100 for exact case-insensitive free-text equality, 0 for mismatch | 30% with CPVs; 40% without CPVs | Empty target list returns **50** | 0, 50, or 100 | An unspecified market adds 15 or 20 points. Country aliases are not normalized, creating both false positives and false negatives. |
| `category_score` (CPV/category) | profile and tender `cpv_codes` | Final migration calls `array_overlap_score`, the percentage of profile codes with exact normalized-text equality | 20% when profile has at least one CPV; omitted otherwise | Empty profile CPVs cause weight redistribution to keyword/country | 0–100 | Check digits and CPV family descendants do not match in the final migration. Manual `CPV-YAMA.sql` instead installs `cpv_overlap_score` with digit and family-prefix handling, but also removes English text from the keyword haystack. |
| `certification_score` | profile certification array; tender requirements | Final v2 refresh writes literal `0` for tenders | 0% | Always 0 | 0 | Certificates collected from the company and extracted from documents do not affect deterministic tender relevance. |
| `match_score` | the three components above | With CPV: `round(.50*keyword + .30*country + .20*cpv)`; without CPV: `round(.60*keyword + .40*country)` | 100% | See component defaults | DB check 0–100 | Base deterministic score used for candidate ordering, minimum-score filters, legacy cards, and dashboard “high” counts. |
| `profile_match_score` | `opportunity_matches.match_score` | Copied by `refresh_explainable_tender_matches` | n/a | Null/stale until explainable refresh | nullable 0–100 | Same score under a different name; it is not recomputed from the company product catalog. |
| `document_match_score` | tender `document_confidence_score` | Direct copy when document status is completed/partial | n/a | Null when no completed/partial analysis | nullable 0–100 | Misnamed: it measures AI-declared evidence strength, not company-to-document relevance. |
| `opportunity_score` | base match, document confidence, data completeness | Completed: `round(.45*match + .35*doc_confidence + .20*completeness)`; partial: `round(.70*match + .20*doc_confidence + .10*completeness)`; otherwise base match | displayed composite | Falls back to base only when the explainable RPC runs | nullable 0–100 | High extraction quality can raise a low-relevance match. Extracted products, dimensions, certificates, and AI lot fit are not inputs. |
| `confidence_score` | constants or tender extraction scores | Base rows start at 70. Completed: `.60*doc_confidence + .40*completeness`. Partial: `min(79, .55*doc_confidence + .25*completeness)`. No docs: clamp prior confidence to 20–55. | not in match | Base upsert does not update this field on conflict | nullable 0–100 | Represents extraction/completeness confidence after deep analysis, but can remain stale after later base refreshes. |
| `confidence_level` | document status/confidence/completeness | High only for completed with both scores ≥75; medium for completed/partial; low otherwise | not in match | Low with no analysis | low/medium/high | Evidence maturity, not relevance certainty. |
| `data_completeness_score` | Claude response | Model self-reported then clamped | 20% completed; 10% partial in opportunity score | Non-numeric becomes 0 | 0–100 | No deterministic required-field calculation validates this value. |
| `catalog_fit_score` in `ai_lots` | Claude prompt with one company profile | Model-generated per lot | **0%** | Model instructed to return 0 for empty/unrelated profile | clamped only by frontend display, not before DB storage | Company-specific AI fit is stored on the shared tender row and is not part of `opportunity_score`. |
| `min_match_score` | `company_match_profiles` | Stored and edited only | **0%** | Default 60 | DB check 0–100 | Does not filter candidate generation or storage. |
| `profile_complete_score` | `company_match_profiles` | Stored only | **0%** | Default 0 | DB check 0–100 | Does not affect score or confidence. |

## Distributor opportunity scoring

`public.refresh_company_opportunity_matches` also creates distributor
opportunities:

| Component | Formula | Weight | Notes |
|---|---|---:|---|
| keyword/product | Same substring scorer over candidate name, product keywords, and categories | 55% | Still not based on `public.products`. |
| geography | Same exact country scorer | 45% | Empty company targets contribute 22.5 points. |
| certification score field | Exact array overlap | 0% | Calculated and stored, but omitted from the final total. |
| category score field | Exact product-keyword array overlap | 0% | Calculated and stored, but omitted from the final total. |
| verification | Adds a reason for verified candidates | 0% | Candidate eligibility requires `reviewed` or `verified`, but verification does not change the numeric total. |

The separate `matchmaking_profiles` / `matchmaking_matches` subsystem in
`202607120001_two_sided_matchmaking.sql` uses a different five-component
formula (40% product, 20% geography, 15% role, 10% certification, 15%
commercial). It does not create tender opportunities and must not be confused
with `opportunity_matches`.

## Worked examples

All examples use the migration-defined formula, before document enrichment.

### Example 1 — exact product, country, and CPV

- Keyword coverage: 100
- Country: 100
- CPV: 100
- Profile has CPVs

`round(.50×100 + .30×100 + .20×100) = 100`

The stored `match_score` is 100.

### Example 2 — exact CPV and country, wrong product

- Keyword coverage: 0
- Country: 100
- CPV: 100
- Profile has CPVs

`round(.50×0 + .30×100 + .20×100) = 50`

An exact CPV plus market match creates a 50 despite zero product evidence.

### Example 3 — generic keyword match, wrong country, no profile CPV

- Keyword coverage: 100 because a generic profile phrase is a substring
- Country: 0
- No profile CPVs

`round(.60×100 + .40×0) = 60`

An ineligible-country tender can still cross a common “potential match”
threshold on text alone.

### Example 4 — low base relevance boosted by document quality

- Base `match_score`: 40
- Completed-analysis confidence: 95
- Data completeness: 95

`round(.45×40 + .35×95 + .20×95) = round(70.25) = 70`

The composite rises from 40 to 70 even though the document values measure
extraction quality rather than company fit.

## Bounds and update behavior

- SQL checks and helper clamps keep the stored numeric score columns inside
  0–100 when the functions are used.
- `round` can produce halves internally but integer casts and checks prevent
  out-of-range persisted scores.
- The v2 base upsert updates `match_score` and component fields, but does not
  update `profile_match_score`, `document_match_score`, `opportunity_score`,
  `confidence_score`, `confidence_level`, `score_basis`, evidence, missing
  information, or next action.
- Therefore bounds are enforced, but cross-field consistency and freshness are
  not.

## Explanation provenance

| Presented content | Provenance | Coupled to numeric score? |
|---|---|---|
| `reasons` | Deterministic SQL from keyword/country/CPV components | Yes, but only coarse threshold/presence statements |
| `risks` | Deterministic SQL; currently near-deadline only for tenders | Not a penalty |
| `evidence` on `opportunity_matches` | Deterministic JSON labels populated by explainable refresh | Lists component scores, but does not contain source quotations |
| `missing_information` | Deterministic tender completeness helper or AI tender-level missing list | No; describes absent tender data, not unmet company requirements |
| `fit_narrative` | Claude, company-specific | No |
| lot `fit_reason` / `catalog_fit_score` | Claude, company-specific | No |
| generic “Analyze with AI” response | `medichall-ai`, generated on demand | No; not persisted as the score |

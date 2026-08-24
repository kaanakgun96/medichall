# Buyer Discovery Relevance Quality V2.1

Date: 2026-08-24

Branch: `react-migration`

Production status while preparing this release: `external-prospect-discovery` v10 ACTIVE
Deployment performed by this task: none

## Compatibility and root-cause audit

V2 was technically precise but too restrictive in production. It rejected the
generic false positives, but relevant companies did not enter the verification
pool for five independent reasons:

1. TED result-notice searches used `scope: ACTIVE`. Concluded historical award
   notices, which are the useful supplier-history evidence, were excluded.
2. The production taxonomy label is plural (`Sterile Surgical Gowns`), while
   the family detector matched only singular `gown`. Gown aliases, procedure
   pack/component terms and buyer archetypes were therefore not activated.
3. A notice was discarded before classification unless its CPV matched the
   selected broad CPV/prefix. Product-relevant text under another notice-level
   CPV never reached verification.
4. Product and CPV retrieval were not independent source partitions. V10 chose
   descriptive retrieval and dropped CPV fallback whenever a term query was
   available.
5. Registry-only candidates do not contain official company domains. With TED
   contributing zero candidates, there was nothing eligible for bounded
   website verification, so both production runs recorded zero website checks.

The production V10 run diagnostics recorded six TED requests, zero TED
candidates, 20 French registry candidates, 10 Norwegian registry candidates,
30 final candidates, zero website checks and zero accepted candidates for each
product. V10 did not record notice-return counts. A read-only reproduction
against the official TED API returned zero ACTIVE result notices for the exact
V10 gown phrase and zero for the three C-Arm phrases. A separate `procedure
pack` ACTIVE query returned one notice, but V10 did not generate that gown term
because of the plural-family defect; the notice also carried CPV `33000000`, so
the old CPV pre-filter would have discarded it.

## V2.1 retrieval architecture

Candidate discovery and candidate verification are now explicit, separate
stages.

- Product-term TED partition: four bounded requests (three balanced country
  batches plus one Europe-wide fallback for missing winner-country metadata).
- Related-CPV TED partition: two bounded balanced country batches.
- Every supported market is covered by both a product-term and a CPV
  partition; there are still no more than six TED requests per run and no more
  than 25 notices per request.
- Reviewed direct terms are capped at 12 and reviewed adjacent terms at 8.
  Uncontrolled generic single terms such as `medical`, `surgical` or `imaging`
  are not generated.
- Product-term, CPV and registry candidates have independent pool budgets.
  Entity duplicates collapse inside each TED partition before caps are applied.
- CPV is only a discovery reason. Title/lot evidence still independently
  classifies as DIRECT, ADJACENT or GENERIC. CPV-only candidates remain GENERIC
  and fail the unchanged V2 gate.
- TED uses structured winner fields. A single structured tenderer may be used
  only when it is unambiguously marked selected and no winner is present.
  Procuring authorities are explicitly excluded.
- Official winner/tenderer website and touchpoint URL fields can supply a
  domain for bounded verification. No domain guessing and no contact fields are
  used.
- Historical public award retrieval uses TED `scope: ALL`; the result form and
  per-query limits remain enforced.

The run diagnostics now persist query partitions, notices returned,
product-relevant notices, supplier entities, official domains, source-cap
rejections, strict-verification rejections, precision proxy, and a complete
country pipeline (including zeroes) for all 32 markets plus UNKNOWN.

## Bounded official TED audit

The reproducible audit command is:

```sh
deno run --allow-net=api.ted.europa.eu scripts/buyer-discovery-recall-v2-1-audit.ts
```

It uses only the official unauthenticated TED Search API. It does not call a
paid provider, AI model, registry, company website, Supabase, email or
notification service.

Audit timestamp: `2026-08-24T11:52:23.908Z`

| Metric | Sterile Surgical Gown | C-Arm Cover |
| --- | ---: | ---: |
| TED requests | 6 | 6 |
| Notices returned | 103 | 74 |
| Product-relevant notices | 33 | 6 |
| Structured supplier rows extracted | 524 | 338 |
| Rows with official domain metadata | 38 | 36 |
| Raw candidates produced | 342 | 156 |
| Duplicate rows collapsed before source caps | 230 | 99 |
| Product-term candidates selected | 29 | 5 |
| CPV candidates selected | 40 | 40 |
| Unique candidates excluded by source caps | 43 | 12 |
| Candidates after global deduplication | 40 | 32 |
| Accepted by unchanged V2 verification | 20 | 5 |
| Rejected by unchanged V2 verification | 20 | 27 |
| Precision proxy | 0.5000 | 0.1563 |

The precision proxy is accepted divided by verified candidates, not a claim of
ground-truth commercial conversion. It exists to expose retrieval/verification
behavior. The lower C-Arm proxy demonstrates that broad recall did not turn
generic CPV candidates into matches: 27 remained rejected.

## Europe-wide local TED diagnostics

The table reports candidates after source partitioning/global deduplication and
accepted candidates. Countries not observed still had explicit query coverage.
Registry adapters were not invoked by this local TED-only audit; the production
V10 baseline was FR 20, NO 10 and zero elsewhere.

| Country | Gown verified / accepted | C-Arm verified / accepted |
| --- | ---: | ---: |
| AT | 0 / 0 | 0 / 0 |
| BE | 3 / 3 | 4 / 0 |
| BG | 0 / 0 | 0 / 0 |
| CH | 0 / 0 | 0 / 0 |
| CY | 0 / 0 | 0 / 0 |
| CZ | 0 / 0 | 0 / 0 |
| DE | 0 / 0 | 0 / 0 |
| DK | 0 / 0 | 0 / 0 |
| EE | 0 / 0 | 10 / 0 |
| ES | 16 / 11 | 1 / 0 |
| FI | 0 / 0 | 0 / 0 |
| FR | 0 / 0 | 1 / 0 |
| GB | 0 / 0 | 0 / 0 |
| GR | 0 / 0 | 0 / 0 |
| HR | 0 / 0 | 0 / 0 |
| HU | 0 / 0 | 1 / 0 |
| IE | 1 / 1 | 5 / 0 |
| IS | 0 / 0 | 0 / 0 |
| IT | 17 / 3 | 0 / 0 |
| LT | 0 / 0 | 2 / 0 |
| LU | 0 / 0 | 0 / 0 |
| LV | 0 / 0 | 0 / 0 |
| MT | 1 / 1 | 1 / 1 |
| NL | 1 / 1 | 2 / 0 |
| NO | 0 / 0 | 4 / 4 |
| PL | 0 / 0 | 0 / 0 |
| PT | 0 / 0 | 0 / 0 |
| RO | 1 / 0 | 1 / 0 |
| SE | 0 / 0 | 0 / 0 |
| SI | 0 / 0 | 0 / 0 |
| SK | 0 / 0 | 0 / 0 |
| TR | 0 / 0 | 0 / 0 |

## Quality and security validation

- The 16-pattern golden scoring benchmark remains evidence-driven; golden
  company names are not present in production logic.
- A separate discovery benchmark proves structured direct and adjacent gown
  winners enter the pool, a CPV-discovered C-Arm supplier can verify from lot
  text, a CPV-only generic imaging supplier is rejected, buyers are excluded,
  and an unambiguous selected-tenderer fallback retains its role provenance.
- The synthetic Synektik-style surgical technology mismatch remains rejected
  with the generic ceiling.
- DIRECT/ADJACENT/GENERIC classification, procedure-pack/component fit,
  manufacturer-as-potential-buyer, buyer archetypes, light diversity and the
  quality-over-quantity ordering are unchanged.
- Authentication, tenant isolation, RLS, rate limits, idempotency, SSRF/robots
  controls and contact redaction are unchanged.
- No Google, Bing or DuckDuckGo scraping is present.
- AI/provider calls: 0. Paid search/data calls: 0. Contact fields collected: 0.
  Emails, notifications and messages: 0.

## Deployment requirement and limitations

No database migration is required. No frontend or cPanel artifact changed.
After explicit approval, deploy only `external-prospect-discovery` from the
verified `react-migration` commit, then run the bounded authenticated production
QA for the two requested products and clean only the resulting synthetic QA
records.

Remaining limitation: TED and the enabled official registries do not provide a
reliable official website for every legal entity. Website verification is now
reachable when structured public domain metadata exists, but Europe-wide
company discovery outside TED and the approved FR/NO/explicit-PL registry paths
would require an approved search/index provider. No such provider was added.

## Plain answers

Was V2 technically precise but too restrictive in production?

Yes. It successfully rejected generic false positives, but candidate recall
collapsed because relevant companies were not entering the verification pool.

Does V2.1 preserve the strict relevance gate?

Yes. Candidate retrieval is broadened in a controlled way, while acceptance
still requires direct or independently supported adjacent product-family
evidence.

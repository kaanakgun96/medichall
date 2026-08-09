# Sprint 4 — Explainable opportunity intelligence

Date: 2026-08-09

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Outcome

Sprint 4 adds a tenant-scoped, evidence-grounded decision-support layer to the
existing opportunity and matchmaking data. It does not create a competing
tender, company, product, document, lot, or match model.

Tender opportunities now return one of four explicit states:

- `MATCH`: score at least 80, stored document evidence available, and
  confidence at least 65.
- `POSSIBLE MATCH`: score at least 60, but the evidence or confidence needed
  for `MATCH` is incomplete.
- `REVIEW REQUIRED`: score between 35 and 59, with material gaps to review.
- `NOT SUPPORTED`: the current structured company and tender data does not
  support the opportunity as a fit.

Unknown fields contribute no positive evidence. The portal shows every
available Match Score v2 component, its deterministic source description,
risks, missing requirements, lot-level comparisons, confidence, and scoring
provenance. Partner-match cards likewise separate supported drivers from risk
and unknown components.

## Scoped Ask MedicHall flow

`tender-ask` accepts one authenticated question about one tender opportunity
owned by the caller's company. It retrieves only that company's active product
catalog, the selected tender, its stored document evidence, persisted lot
matches, and Match Score v2 data.

- The browser never receives the provider credential or service-role key.
- The Edge Function verifies the bearer token and company ownership before
  retrieving evidence or reserving AI usage.
- Sources are bounded, ranked, and labeled with stable simple IDs.
- Answers must cite supplied source IDs; missing or invented citations fail
  closed.
- Uncertainty is a required, separately rendered field.
- The provider is limited to 900 output tokens, temperature zero, a default
  daily limit of 20, and a default per-request maximum estimated cost of
  USD 0.05. Existing environment overrides, if configured, remain bounded.
- A unique company/tender/question/context key plus an advisory-lock lease
  prevents concurrent duplicate provider calls.
- Completed answers are returned from cache without a new usage reservation or
  provider call.
- Failed identical contexts receive a five-minute cooldown before they can be
  retried.
- Usage records capture feature, company, tender, optional import, provider,
  model, request key, tokens, and estimated cost. The hardening path records
  token/cost metadata even when the provider response later fails grounding
  validation.

## Production migrations and deployment

Two forward-only migrations were applied in exact linked dry-run order:

1. `202608090002_opportunity_intelligence.sql`
2. `202608090003_tender_ask_hardening.sql`

The second migration was required after provider QA exposed immediate retry of
a failed grounded-answer validation and misleading zero accounting for
unavailable failure usage. Both migrations passed full rollback-only probes
before apply. The exact opportunity-intelligence SQL regression passed after
each applicable deployment and rolled all fixtures back.

Only `tender-ask` was deployed and later redeployed with its hardening. No
unrelated Edge Function, cPanel file, frontend artifact, migration, provider
credential, or cost limit was deployed or changed.

Restricted schema-only backups:

- Before `202608090002`: 584,800 bytes, SHA-256
  `f6ffc88fba8d531e2cab1b0ee8532075b4a2192f9147927299d5d742ef20a037`.
- Before `202608090003`: 604,841 bytes, SHA-256
  `32009641b8e21a5b3ed7f59c9918d6d29776a3a4dcd69ab5a45e20e862318db9`.

Both backups are outside the repository and contain no `COPY` or `INSERT`
row-data statements.

Final production checks:

- Linked migration dry run: remote database up to date.
- Production database lint: zero errors.
- Endpoint: OPTIONS 204; unauthenticated POST 401 with a redacted body.
- Production function inventory: 14 deployed functions; `tender-ask` ACTIVE.
- `ANTHROPIC_API_KEY`: present by secret name; value not inspected.
- Explicit cost/daily-limit secret overrides: absent, so the bounded code
  defaults above are active.

## Provider-backed QA and remediation evidence

One explicit isolated tenant, company, product, evidenced tender, opportunity,
score, document, and lot match were created with the `SPRINT4-QA` identifiers.
Its admin-notification outbox row was removed inside the fixture-creation
transaction, and no Storage object or tender import was created.

The first provider response reached Anthropic but failed closed with
`UNKNOWN_PROVIDER_CITATION`. An immediate identical submission under the
pre-hardening implementation attempted again and failed with the same code.
No answer was shown to a user. This exposed two issues that were fixed before
acceptance:

1. Database evidence IDs were replaced with simple sequential source IDs, and
   valid multiple IDs in one bracket are parsed individually while any unknown
   ID still fails closed.
2. Failed identical contexts now receive a five-minute cooldown, and provider
   usage is persisted before answer-grounding validation.

The corrected provider-backed case then completed once:

- New accepted provider request: 1.
- Input tokens: 1,099.
- Output tokens: 271.
- Total accepted-run tokens: 1,370.
- Estimated accepted-run cost: USD 0.007362.
- Grounded citations: 6.
- Explicit uncertainty: present.
- Identical resubmission: cached, same answer and semantically identical
  citations, usage count unchanged.
- Cross-company request: 404 before evidence retrieval or provider use.

For complete operational transparency, the Sprint 4 session made three
provider requests in total: two pre-hardening responses rejected by grounding
validation and the one accepted response. The old failure path discarded the
first two responses' token metadata, so their exact tokens and cost cannot be
reconstructed. Using the accepted input size and the 900-output-token cap gives
a conservative session estimate of no more than approximately 5,368 tokens and
USD 0.040956. Future failed responses are fully accounted by the deployed
hardening.

## QA cleanup and production integrity

Before cleanup, the explicit fixture contained:

| Object | Count |
| --- | ---: |
| Auth user / identity | 1 / 1 |
| Auth sessions / refresh tokens | 4 / 4 |
| Company / company match profile / product | 1 / 1 / 1 |
| Tender / opportunity / v2 score | 1 / 1 / 1 |
| Tender document / evidence records | 1 / 2 |
| Lot match | 1 |
| Tender answer cache rows | 2 |
| AI usage rows | 3 |
| Imports / analysis jobs / chunks / notifications / outbox / Storage objects | 0 / 0 / 0 / 0 / 0 / 0 |

All explicit QA rows were removed transactionally or in verified dependency
order. The legacy product foreign key nulls `company_id` instead of cascading;
the after-check detected that one QA product, and it was then deleted with an
exact ref-and-name guard. Final explicit QA count is zero.

Core production counts returned to their pre-QA baseline: auth users 6,
companies 6, buyer profiles 2, products 39, RFQ requests 14, RFQ offers 0, RFQ
messages 7, tenders 3,035, opportunity matches 5,196, v2 opportunity scores 4,
lot matches 21, tender evidence 19, matchmaking profiles 4, matchmaking matches
5, AI usage rows 40, and Storage objects 75. The migration ledger alone moved
from 41 to 43 for the two intended migrations. Answer-cache, explicit QA, and
checked orphan counts are all zero. Pre-existing data whose name happens to
contain `QA` was not included in the cleanup scope and was not touched.

## Validation

- Deno: 127 passed, 0 failed.
- Canonical Edge Function typechecks: 14 passed.
- React/Vitest: 96 passed across 16 files.
- React TypeScript, ESLint, and production build: passed.
- Repository Node regressions: 24 passed.
- Portal inline-JavaScript parse and standalone matchmaking parse: passed.
- Marketplace, enterprise terminology, design system, readiness, migration
  sequencing, credential scan, and `git diff --check`: passed.
- Desktop visual QA at 1,440 px: explicit MATCH, four components, Unknown
  capacity, two citation cards, and no horizontal overflow.
- Mobile visual QA at 390 px: one-column component layout, full-width Q&A input
  and action, two citation cards, and no horizontal overflow.

The visual pass also found and fixed a shared-CSS cascade collision that made
the dark opportunity score card white while retaining white text. The scoped
`.deep-panel .op-card` rule now preserves the intended accessible contrast
without changing other shared cards.

The canonical frontend remains intentionally undeployed to cPanel until the
single coherent first-customer beta package is generated after Sprint 6.

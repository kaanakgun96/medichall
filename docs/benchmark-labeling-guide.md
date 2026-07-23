# Tender relevance labeling guide

## What you are deciding

Ali, for each case answer:

> Could this company realistically supply what this tender asks for?

Read the company summary and product list first. Then read the tender title,
description, lots, and available documents. Ignore MedicHall’s score until you
have saved your own answer.

There are only three labels.

### Highly relevant

Choose `highly_relevant` when the requested product is clearly something the
company supplies and you see no known deal-breaker.

Example: the company sells sterile examination gloves; the tender asks for
sterile examination gloves in supported sizes; the country is served and no
missing mandatory certificate is visible.

### Potentially relevant

Choose `potentially_relevant` when the product fit is plausible but an
important fact is missing, unclear, or may need confirmation.

Example: the company sells ultrasound gel; the tender says “medical
consumables” and one lot may contain gel, but the lot document is behind a
login. This is worth checking, but not yet a strong match.

Another example: the product matches, but the tender asks for a certificate
that is not listed in the company profile. The company may have it, so mark the
certificate as `unknown` unless you know it does not.

### Irrelevant

Choose `irrelevant` when the tender asks for a different product/service or
there is a clear blocking requirement.

Example: the company sells wound dressings; the tender is hospital building
construction. A hospital buyer or a medical CPV does not make the product
relevant.

Example: the company only distributes products, but the tender explicitly
accepts manufacturers only and no distributor route is allowed.

## Simple review order

1. **Product:** Is the requested item the same product, a real synonym, or only
   a broad category?
2. **Technical fit:** Do dimensions, material, sterility, dosage, format, or
   other specifications fit?
3. **Country:** Can the company sell or deliver in the tender country?
4. **Certificates:** Are mandatory certificates present, missing, or unknown?
5. **Commercial role:** Does the tender require a manufacturer, authorized
   distributor, local entity, minimum turnover, or another condition?
6. **Documents:** Is the evidence complete, partial, missing, scanned, archived,
   or restricted?
7. Choose the label and explain the most important evidence in one or two
   sentences.

Product fit comes first. Never label a case highly relevant only because its
CPV code or country matches.

## Field choices

### Product relevance

- `exact`: the requested product and company product are clearly the same;
- `synonym`: different wording, same product (for example “adhesive bandage”
  and “sticking plaster”);
- `category_only`: both are in a broad group, but the exact product is not
  proven;
- `incompatible`: different product or a known incompatible specification;
- `unknown`: there is not enough text or documentation.

### Country, certificate, and commercial eligibility

- `eligible`: evidence says the company meets it;
- `ineligible`: evidence clearly says it does not;
- `unknown`: the information is missing or unclear;
- `not_applicable`: the tender has no such requirement.

Do not turn “not listed” into “ineligible.” Use `unknown` unless a reliable
source proves the mismatch.

### Technical-specification compatibility

- `compatible`: the known specifications fit;
- `partial`: some fit but important details remain;
- `incompatible`: at least one mandatory specification clearly fails;
- `unknown`: specifications are missing or unreadable;
- `not_applicable`: no meaningful technical specification applies.

### Expected score range

This is your expectation, not a formula:

- 80–100: strong, actionable fit;
- 50–79: plausible but needs checks;
- 0–49: weak or irrelevant.

Use a wider range when documents are missing. The relevance label matters more
than guessing an exact number.

## Document availability

Select the most accurate status:

- `complete`: the important notice and specification are readable;
- `partial`: some useful documents exist, others are missing;
- `notice_only`: only the notice/summary is available;
- `missing`: no useful document is available;
- `captcha_restricted`, `login_restricted`, `membership_restricted`, or
  `paid_restricted`: the exact restriction was observed;
- `scanned`: a readable text version is unavailable and OCR is needed;
- `archive`: important material is in ZIP/Office/archive form;
- `unknown`: you cannot determine the state.

A restriction does not mean irrelevant. Label from available evidence and use
`potentially_relevant` plus `unknown` fields when the product may fit.

Never try to solve a CAPTCHA, use someone else’s login, pay, accept terms, or
bypass a portal for this exercise.

## Examples that often fool a score

| Situation | How to label |
|---|---|
| Exact CPV, wrong product | Usually `irrelevant`; CPV can be broad |
| Exact product words, wrong country | Product may be exact, but final relevance is usually `irrelevant` if country is a hard blocker |
| Exact product, imperfect CPV | Can be `highly_relevant`; explain why product evidence is stronger |
| Same category, different product | `irrelevant` or `potentially_relevant` only if a mixed lot might contain the product |
| “Medical consumables” with no list | `potentially_relevant`, product `unknown` or `category_only` |
| Pharmaceutical tender for a device company | Usually `irrelevant` |
| Hospital construction/service contract | `irrelevant` for a product supplier unless its product is a named lot |
| Mixed tender with one fitting lot | Judge the fitting lot; mention the lot number and use `highly` or `potentially` based on its evidence |
| Manufacturer-only condition for distributor | `irrelevant` if the restriction is clear |
| Missing certificate in profile | Certificate `unknown`, not automatically `ineligible` |
| Mandatory incompatible size/material | `irrelevant`, technical `incompatible` |
| Expired but otherwise exact tender | Record the product fit; final operational relevance is `irrelevant` and explain expiry |

## Building the first 30–50 cases

The sample must be balanced, not just easy or high-scoring:

- 6–8 clear exact-product matches;
- 4–5 genuine synonym matches;
- 4–5 broad-category or CPV traps;
- 4–5 obvious unrelated tenders;
- 4–6 eligibility conflicts (country, certificate, manufacturer/distributor);
- 6–10 difficult document cases spread across missing, CAPTCHA, login,
  membership, scanned, multilingual, ZIP, and mixed lots.

Across those groups include pharmaceutical, service, construction, unrelated
hospital equipment, expired, incompatible dimensions, and generic
medical-consumable wording. A case may cover several categories.

Use the header-only fixture at
`supabase/tests/fixtures/benchmark-cases-template.csv`. Never put names,
emails, private documents, credentials, or invented production labels in the
fixture.

## Independent review and adjudication

Two people label each case separately. Do not discuss the answer or view the
engine score first. Each person must write a short explanation.

After both reviews:

1. compare labels and key evidence;
2. discuss disagreements using tender/company facts, not the existing score;
3. an authorized admin chooses the final label and explanation;
4. record whether the engine produced a false positive or false negative;
5. preserve both original annotations.

A false positive means the engine treated an irrelevant case as actionable. A
false negative means it missed or seriously underrated a highly relevant
case. Do not mark either flag only because the exact numeric score differs from
your preferred range.

# Product matching readiness

Status: backend deployed and production-validated on 2026-07-27;
`portal.html` is ready for the repository's separate manual cPanel publish
workflow.

This increment makes manufacturer product records usable by the existing
deterministic `lot-match-v1` calculation. It does not alter Document
Intelligence, extracted tender data, AI providers, lot-match weights, RLS,
authentication, or the public product catalogue.

## Existing system diagnosis

The production audit on 2026-07-27 found 37 product rows. `products` was the
only product-detail source and contained:

- identity: `id`, globally unique `ref`, `name`, `category`;
- presentation: `description`, `image_url`, `brochure_url`;
- lifecycle/ownership: `is_active`, `is_featured`, `company_id`,
  `created_at`, `updated_at`.

RLS was enabled. Existing policies allowed administrators to manage all
products and authenticated company owners to manage only products belonging
to their company. Those policies and the existing `updated_at` trigger remain
unchanged.

No product specification, product category, product certification, or
production-capability relation existed. `company_catalogs` and
`company_certificates` held uploaded-file metadata, not product facts.
`cpv_catalog` held tender taxonomy data, not manufacturer product
specifications. Company-level certification text existed on `companies` and
the company match profile; it must not be copied into a product-specific
certification field.

The only product create/edit experience was the manufacturer section of
`portal.html`. It read and wrote `products` directly through authenticated
PostgREST calls. Products were created manually; image and brochure uploads
were stored separately and their HTTPS URLs were written to the product row.
No product import or structured backfill flow was found.

## Field-gap matrix

| Matching field | Previous source | Structured before | Change |
| --- | --- | --- | --- |
| Product identity | `products.ref`, `name`, `category` | Yes, category was broad | Keep identity; add canonical `normalized_category` and optional `product_subtype` |
| Material | Occasionally in `description` | No | Add bounded `material` |
| Dimensions | Occasionally in `description` | No | Add bounded `dimensions` |
| Sterility | Occasionally in name/description | No and sometimes contradictory | Add enum `sterile`, `non_sterile`, `unknown` |
| Use type | Occasionally in description | No | Add enum `single_use`, `reusable`, `unknown` |
| Packaging | Occasionally in description | No | Add `packaging_description` and `units_per_package` |
| Product certifications | No dedicated source | No | Add bounded `product_certifications`; keep company certificates separate |
| MDR/regulatory class | Absent | No | Add optional `regulatory_class` |
| Sterilization method | Occasionally in description | No | Add controlled method when explicitly sterile |
| Production capacity | Absent | No | Add complete value/unit/period tuple |
| Technical specifications | Description only | No | Add bounded `technical_specifications` array |
| Field provenance | Absent | No | Add per-field `explicit`, `derived`, or `unknown` map |

An audited legacy row named “Non-Sterile Gowns” had a description containing
“Sterile”. This is treated as ambiguous and is not backfilled.

## Canonical product model

Migration
`supabase/migrations/202607270003_product_matching_profile.sql` adds only the
following nullable or defaulted columns to `products`:

- `normalized_category`, `product_subtype`;
- `material`, `dimensions`;
- `sterility_status` and `use_type`, both defaulting to `unknown`;
- `packaging_description`, `units_per_package`;
- `product_certifications`, defaulting to an empty text array;
- `regulatory_class`, `sterilization_method`;
- `production_capacity`, `capacity_unit`, `capacity_period`;
- `technical_specifications`, defaulting to an empty text array;
- `matching_profile_sources`, defaulting to an empty JSON object.

Checks bound text/array lengths, enums, positive numeric ranges, allowed
capacity units/periods, and provenance keys/values. Capacity is valid only
when value, unit, and period are all present or all absent. A sterilization
method is valid only for an explicitly sterile product.

Old inserts that provide only `ref`, `name`, `category`, and optional legacy
fields continue to work.

## Deterministic normalization

`product-profile-v1` is shared by the product API, backfill report, and
`lot-match-v1` adapter. It makes no network or AI request.

- Unicode is normalized; common English and Turkish spelling is compared
  case-insensitively, including Turkish dotted/dotless `i`.
- Explicit non-sterile phrases are evaluated before positive sterile phrases.
  Contradictory positive and negative evidence produces `unknown` with an
  ambiguity flag.
- “single use”, “single-use”, “disposable”, “tek kullanımlık”, and
  “kullan-at” map to `single_use`; reusable English/Turkish phrases map to
  `reusable`. Conflicts remain `unknown`.
- EO/EtO/ethylene oxide, gamma, steam/autoclave, e-beam, and plasma wording is
  normalized only when explicitly present.
- Known materials are canonicalized conservatively; unrecognized explicit
  material text is retained rather than guessed.
- Two- and three-dimensional metric expressions normalize to millimetres.
- CE, ISO, EN, and EU MDR names normalize deterministically without merging
  company and product scopes.
- Supported medical product wording maps to stable category slugs. Otherwise
  the explicit category is slug-normalized.
- Package quantities and capacity units/periods normalize only from strong
  patterns. Unknown values remain unknown.

Structured fields take precedence in `lot-match-v1`. Description parsing is
used only when a field has no structured provenance. An explicitly entered
unknown value therefore remains unknown; it is not replaced by a guess.
Unknown values are not contradictions, while explicit non-compliance remains
a blocker under the unchanged `lot-match-v1` weights.

## Readiness calculation

`product-readiness-v1` is deterministic and totals 100 points:

| Readiness field | Points | Critical |
| --- | ---: | :---: |
| Product identity | 8 | Yes |
| Useful normalized category | 14 | Yes |
| Dimensions or technical specifications | 14 | Yes |
| Sterility | 12 | Yes |
| Use type | 10 | Yes |
| Product certification or regulatory class | 14 | Yes |
| Material | 8 | No |
| Packaging description or quantity | 8 | No |
| Complete production capacity tuple | 7 | No |
| Product subtype | 3 | No |
| Sterilization method when sterile | 2 | No |

The returned object contains `score`, `present_fields`, `missing_fields`,
`critical_missing_fields`, and `calculation_version`. It is calculated on
read and after every save, so there is no stale stored score.

## Secure product API and portal form

The `product-profile` Edge Function accepts authenticated `POST` actions:

- `list`: owner-scoped products with calculated readiness;
- `save`: validated create or company-scoped update;
- `backfill_preview`: a read-only report and content hash;
- `backfill_apply`: an explicit list of at most 100 product IDs from the
  current preview hash.

The function validates the caller with Supabase Auth, checks company ownership
or the existing administrator role, and performs queries with the caller JWT.
It never creates a service-role client. Existing product RLS therefore remains
the final tenant boundary. Product IDs are always combined with `company_id`
on update. URLs must use HTTPS, strings and arrays are bounded, enums and
numeric tuples are validated, and the server constructs provenance JSON
instead of accepting arbitrary client JSON.

The existing product modal in `portal.html` is extended, not redesigned. It
groups identity, technical facts, sterility/use, packaging, certifications,
and capacity; provides explicit unknown states; shows server validation
errors and save progress; and displays the readiness score and most important
missing fields. Login, registration, uploads, visibility, deletion, and other
portal pages are unchanged.

## Conservative backfill

`backfill_preview` is mandatory before an apply call. Its report includes:

- products inspected;
- products with safe derivations;
- per-field safe derivation counts;
- per-field ambiguous-skip counts;
- products still missing critical data after the proposed derivations;
- per-product before/after readiness and proposed values.

Only an unambiguous value derived from existing name/category/description text
is proposed, and it is marked `derived`. Existing explicit structured values
are never overwritten. Ambiguous fields remain unknown. Applying a preview is
not part of the deployment itself and requires an unchanged preview hash plus
an explicit product ID allow-list.

## Tests and verification

- `supabase/functions/_shared/product-profile-v1.test.ts` covers EN/TR
  normalization, ambiguity, dimensions, certifications, readiness,
  conservative backfill, safe input, backwards compatibility, structured
  match improvement, irrelevant-product behavior, and the no-AI/no-network
  invariant.
- `supabase/functions/_shared/lot-matching-v1.test.ts` preserves the existing
  deterministic scorer regression suite.
- `supabase/tests/product_matching_profile.sql` checks structure, defaults,
  constraints, RLS retention, owner updates, and cross-tenant rejection in a
  rolled-back transaction.

Run:

```sh
deno fmt --check supabase/functions
deno lint supabase/functions/_shared/product-profile-v1.ts \
  supabase/functions/_shared/product-profile-service.ts \
  supabase/functions/product-profile/index.ts
deno check supabase/functions/product-profile/index.ts \
  supabase/functions/tender-lot-matching/index.ts
deno test --allow-env \
  supabase/functions/_shared/product-profile-v1.test.ts \
  supabase/functions/_shared/lot-matching-v1.test.ts
```

After the migration exists on an authorized target, run
`supabase/tests/product_matching_profile.sql` as one transaction. The test
ends with `rollback`.

## Staged deployment and validation

1. Confirm the branch is `react-migration`, the intended project is linked,
   migration histories align, and a linked dry run proposes only
   `202607270003_product_matching_profile.sql`.
2. Run the migration and SQL security test; run database lint.
3. Deploy only `product-profile` and the changed `tender-lot-matching`
   function.
4. Run `backfill_preview` for an authorized company. Do not apply it merely
   because a value was proposed.
5. Save one explicitly sourced validation product, then recalculate tender
   `2952` twice. Compare the same product/lot and confirm the second run is
   idempotent.
6. Verify analysis-job, chunk, and provider-request counts are unchanged.
7. Publish only the scoped `portal.html` update after backend verification.

## Production deployment and validation — 2026-07-27

The additive migration was executed after the complete SQL security test
passed inside a rolled-back transaction. Migration history contains version
`202607270003`, all 16 new columns are present, RLS remains enabled, the
existing owner policy remains present, and the original 37 product rows were
unchanged by the migration. Only `product-profile` and the changed
`tender-lot-matching` function were deployed. Both functions perform their
own authenticated-user check; a signed-out `product-profile` request returned
HTTP 401.

The mandatory backfill preview inspected all 37 pre-existing products. No
backfill was applied. It proposed 86 safe values across 37 products:

- 37 normalized categories;
- 24 sterility states;
- 25 use-type states;
- one ambiguous sterility state skipped;
- all 37 products would still require critical matching data after those
  conservative derivations.

The controlled validation fixture belongs to authorized test company 11 and
is product 67, reference `VALIDATION-T2952-L29`. Its name and description
explicitly identify it as a validation fixture and state that the populated
facts come only from tender 2952 requirements, not from an independently
verified commercial claim. Explicit values cover surgical-drape identity,
two-layer non-woven/PE material, dimensions, sterile/single-use status,
individual packaging, one unit per package, EN 13795-1, and bounded technical
specifications. Unsupported sterilization method, regulatory class, and
production capacity remain unknown. Readiness is 91 under
`product-readiness-v1`.

Fresh before/after counters were identical: six tender-analysis jobs, latest
job 60, four chunks for that job, and one recorded AI request. Product
readiness and lot recalculation therefore created no extraction job, chunk,
or provider request.

Before the fixture, the highest lot score was 16 against product 50. With the
fixture, the highest normalized tender product group was
“2-layer surgical drape with adjustable central adhesive opening”, score 77,
`good_match`, confidence 60. Matched requirements were product identity,
dimensions, sterility, single-use status, and product-specific
certification. It had no blocker; production capacity remained the sole
unknown. Evidence came from persisted tender pages 1, 41, and 42, with the
structured technical facts on page 41.

The extraction did not associate those page-41 technical facts with a
numbered lot. The matching row therefore correctly remains `unassigned`
rather than guessing a lot number. All 11 numbered/unrelated rows remained
`not_recommended`; their maximum score was 24. Repeating the exact calculation
produced identical scores and all 12 input hashes, so the deployed service's
hash guard can reuse all 12 persisted rows without mutation.

For this controlled run, the exact repository `lot-match-v1` calculation was
executed against a read-only snapshot of the live tender/company inputs and
the resulting versioned rows were persisted through the authorized database
operator. A positive Edge Function invocation was not impersonated because
no partner session was available; owner-scoped API behavior remains covered
by the rolled-back RLS test. The existing product 50 remained valid.

The static production frontend is manually published through cPanel and the
environment supplied no cPanel/SFTP deployment channel. Consequently, the
scoped `portal.html` update is committed and ready to publish but was not
copied to the live web root. No unrelated production page was changed.

## Rollback

Application rollback is non-destructive:

1. restore the previous `portal.html`;
2. restore the previous `tender-lot-matching` function;
3. remove or restore the `product-profile` function deployment.

The additive columns may remain unused without affecting legacy product
reads/writes. If a later approved database rollback is required, first stop
all callers, export the structured values, then drop only the constraints,
columns, and two validation helpers introduced by
`202607270003_product_matching_profile.sql`. Do not delete products, company
data, tender extraction data, lot matches, migration history, or alter the
pre-existing RLS policies.

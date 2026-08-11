# Medical Product Taxonomy v1 — implementation and production evidence

Date: 2026-08-11

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Baseline audit and problem

Matchmaking retained product intent in legacy free-text arrays. Products used a
commercial `name` and one of four broad legacy `category` values. Existing match
scoring could therefore miss equivalent medical/commercial language such as
“Ultrasound Probe Cover” and “Ultrasound Transducer Sheath.” Tender matching
already used CPV, keywords, geography, evidence and lot extraction; taxonomy was
added as an independent signal and did not replace those mechanisms.

The pre-deployment production baseline was 39 products (38 active), 6 companies,
6 users, 5 matchmaking profiles, 6 matchmaking matches, 5,597 opportunity
matches, 3,209 tenders and 22 lot matches. The catalog had 38 deterministic
high-confidence mappings, 6 deterministic legacy-interest mappings, and 2
unresolved historical phrases requiring review. Commercial names and legacy
free-text values were not overwritten.

## Architecture

Migration `202608110001_medical_product_taxonomy.sql` adds an additive,
database-backed hierarchy and approved aliases:

- `medical_product_taxonomy`: canonical family/category nodes.
- `medical_product_aliases`: normalized, versionable, language-ready aliases.
- `product_taxonomy_mappings`: canonical categories beside unchanged product
  names/categories.
- `matchmaking_taxonomy_interests`: owner-scoped offered/interested selections,
  including family scope and preserved custom text.
- `tender_taxonomy_mappings`: evidence-bound lot/term mappings.
- `medical_product_taxonomy_review_queue`: controlled review of unmapped/custom
  terms and constrained semantic suggestions.

Search, deterministic resolution, mapping, match refresh/explanation, tender
compatibility, and admin-management RPCs sit behind RLS and existing admin
authorization. Canonical nodes are publicly readable; tenant mutations remain
owner-scoped. The internal compatibility RPC is service-role only.

The shared frontend selector provides typeahead, expandable hierarchy, selected
chips, removal, custom fallback, high/medium/low-confidence treatment, keyboard
navigation and accessible live feedback. Product and company catalogs fetch all
visible mappings in one bulk query, avoiding per-card requests.

## Taxonomy v1

The live seed has 42 active nodes: 12 families and 30 categories.

Families: Equipment Covers; Surgical Drapes & Packs; Surgical Gowns & Apparel;
Sterilization Products; Infection Prevention & Hygiene; Wound Care; Drainage &
Fluid Management; Respiratory & Anesthesia; Diagnostic Products; Patient Care;
Surgical Instruments & Accessories; Other Medical Consumables.

Catalog-derived categories include Ultrasound Probe Covers, C-Arm Covers,
Camera Covers, Microscope Drapes, Endoscope Covers, Mayo Stand Covers, procedure
pack categories, sterile/non-sterile gowns, sterilization indicators/test
packs/packaging/accessories, washer-control products, chest drainage, fluid
collection, electrosurgical accessories, medical adhesives, disinfectants,
dressings, anesthesia/ventilation equipment, imaging equipment and patient
support products.

Twenty-nine approved aliases include the required ultrasound and C-Arm variants
and tender expressions. Examples resolve as follows:

- Ultrasound Probe Cover / Ultrasound Transducer Cover / Ultrasound Transducer
  Sheath / Probe Sheath / Ultrasound Sheath → Ultrasound Probe Covers.
- C-Arm Cover / C Arm Drape / C-Arm Protective Cover / Sterile C-Arm Equipment
  Drape → C-Arm Covers.
- Camera Cover / Sterile Camera Drape / Camera Sleeve → Camera Covers.

## Resolution, scoring and explanations

Priority is canonical node, hierarchy, approved alias, existing product mapping,
deterministic normalized-name similarity, optional constrained semantic
suggestion, then raw custom text. Deterministic resolution uses high confidence
at `>=0.95`, user-confirmed medium confidence at `>=0.65`, and otherwise keeps
the term unmapped/custom.

Taxonomy pair scores are exact category 100, parent/child family 75, sibling 25,
distant same-family 10, unrelated 0. Existing overall dimensions and weights are
preserved: product 40%, geography 20%, partner type 15%, commercial 15%, and
certification 10%. Explanation v3 exposes concise canonical category/family
evidence, source aliases and broad-family meaning; it does not expose model
reasoning or treat unknown data as positive evidence.

The optional semantic module accepts only structured results constrained to
existing candidate taxonomy IDs. High confidence may be recommended, medium
requires user choice, low remains custom, and unknown IDs are rejected. It has
no provider transport and is disabled during ordinary page loads. Provider
requests and cost for implementation/production QA were exactly 0.

## Products, matchmaking, tenders and admin

Existing active products were backfilled exactly once (38 mappings) without
changing any commercial name. New product forms keep the commercial name
separate from the canonical category and queue unresolved custom terms.

Portal and standalone matchmaking forms use the same selector for offered and
interested products while retaining the legacy text arrays. Whole-family
selection produces a valid but lower-strength signal. Match cards show product
taxonomy evidence beside existing market, role, certification and commercial
evidence.

Tender terms/lots map independently only when an exact canonical name or
approved alias is present. The SQL scenario mapped three supported lots and
left an unrelated fourth lot unmapped. Existing CPV, keyword, geography,
evidence, opportunity, Ask MedicHall and lot-match behavior remains in place.
The related `tender-document-engine` source refreshes taxonomy mappings after
existing explainable scoring and before lot matching, but that function revision
has not been deployed because the production safety gate requires explicit
approval for this live function.

Admin can browse/search nodes, create/edit/deactivate nodes, manage aliases,
review terms or semantic suggestions, approve/reject mappings, and inspect usage
counts. Canonical growth never occurs automatically.

## Production deployment and QA evidence

- Restricted schema-only backup:
  `/private/tmp/medichall-taxonomy-predeployment-20260811.sql`, 661,762 bytes,
  SHA-256 `f15cc484fdf42c78eee882f4b25a351674ffa80ce210b308d0cd22434975146b`.
- Linked dry run proposed only
  `202608110001_medical_product_taxonomy.sql`.
- Migration applied successfully; the follow-up dry run reported production up
  to date.
- Exact SQL/RLS regression passed in a rollback-only production transaction.
  It temporarily exercised 2 QA users, 2 QA companies, 2 QA products, 2
  profiles, exact/broad/unrelated interests, and a four-lot tender. Three
  supported lots mapped; the unrelated lot did not. Zero sent email and zero AI
  usage were asserted before rollback.
- Post-rollback QA marker counts are 0 across auth users, companies, products,
  profiles, matches, opportunities, notifications, both email outboxes,
  tenders/lots, all taxonomy mappings/review, import/job tables and storage.
- Foreign-key orphan counts are 0 for product mappings, interests, tender
  mappings and aliases.
- Production database lint at error level returned no findings.
- The existing production function boundary remains healthy: OPTIONS 204 and
  unauthenticated POST 401, with no secret-bearing response.
- Email provider sends: 0. AI/provider calls: 0. Tokens: 0. Cost: USD 0.00.

## Before/after production counts

All existing core counts were unchanged: products 39 (active 38), companies 6,
users 6, profiles 5, matches 6, opportunities 5,597, tenders 3,209, lot matches
22, notifications 597, user email-outbox rows 542, admin email-outbox rows 2 and
AI-usage rows 46. The redacted digest of `(product id, commercial name, legacy
category)` remained `fca790289f08653c001e31ce6a378fcf`.

New production counts are 42 taxonomy nodes, 29 aliases, 38 product mappings, 6
legacy interest mappings, 0 tender mappings pending future analyses, and 2
review-queue items. No real customer row was deleted.

## Responsive/accessibility evidence

The selector was exercised at 320, 360, 390, 414, 768, 1,024 and 1,440 px with
no horizontal overflow. Results remain inside the viewport, chips wrap, the
hierarchy is readable, focus is visible, Arrow Up/Down/Home/End/Escape work, and
loading/empty/error/live states are labelled. Products and the mixed Company
Directory continued to load at mobile and desktop sizes without console errors.

## Manual frontend release

No cPanel change was made. The minimal patch is
`deliverables/medichall-medical-taxonomy-2026-08-11.zip` (197,081 bytes;
SHA-256 `5aa46d6168c4ace7db787cf51b4079befea36cae7f806983d45e75ae8e4db2f0`),
cache identifier `20260811tax1`. Its README contains exact upload order,
destinations, sizes, hashes, backup, rollback and smoke checks. It must remain
withheld until the Edge Function deployment gate is explicitly approved and
completed.

## Verification matrix

- Deno: 139 passed, 0 failed across 21 test files; changed files also passed
  `deno check` and `deno lint`.
- React/Vitest: 103 passed, 0 failed across 17 files.
- TypeScript, ESLint and Vite production build: passed.
- Static marketplace, design-system, Ask MedicHall, auth, security, Sprints
  2.1–6, portal-artifact, migration-sequencing and readiness suites: passed.
- Portal artifact: 231 unique static IDs; migration sequencing: 46 canonical,
  3 immutable archived and 0 pending after reconciliation.
- Credential scan: 611 text files; no credential literals.
- `git diff --check`: passed.
- cPanel ZIP integrity and all 12 source-to-package byte comparisons: passed.

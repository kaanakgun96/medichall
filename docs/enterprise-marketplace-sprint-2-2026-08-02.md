# MedicHall Sprint 2 — enterprise marketplace

Date: 2026-08-02
Branch: `react-migration`
Production project: `azdmuarzntzqdyirysux`
Production frontend: root static HTML, with `portal.html` remaining the authenticated production portal
Deployment status: not deployed

## Current-state audit

The public marketplace source of truth is the root static application. The
React portal has authenticated dashboard, company-profile, tender and
opportunity features, but it has no public product-marketplace route. Sprint 2
therefore enhances the root pages without replacing the portal, RFQ, messaging,
tender, matchmaking, meeting, notification or Document Intelligence contracts.

Before Sprint 2:

- product cards exposed image, name, category, reference, a limited company
  identity, favorite, and the legacy product drawer;
- company cards exposed logo, name, free-text type, location, listed
  certifications, premium/verification badges and a profile link;
- product details mixed a small drawer with category-level fallback copy and
  did not expose the structured product matching profile;
- favorites already used `public.favorites`, unique `(user_id, product_id)`,
  authenticated owner-only RLS and cross-device database persistence;
- RFQs already wrote `rfq_requests`, supported authenticated or guest requests,
  category multi-send, recipient-company IDs and exact portal conversation
  links;
- public company catalogs and certificate documents were already protected by
  RLS that permits reads only for approved, active companies;
- one product image and one product brochure URL are available per product;
  multiple product-gallery images, product datasheet size metadata and a public
  structured OEM/private-label field do not exist;
- `companies.type` is free text and the directory can contain manufacturers,
  suppliers, distributors, buyers and other approved companies. It is not a
  manufacturer-only data contract;
- company following did not exist;
- public marketplace JavaScript repeated product/favorite queries and generic
  manufacturer terminology in several paths;
- the shared header search was a non-functional field and did not provide
  grouped results or keyboard navigation;
- the React application has no separate public marketplace implementation to
  keep in parity.

## Architecture and source-of-truth decisions

1. Root `products.html` and `companies.html` remain the public catalog and
   showroom sources of truth. `portal.html` remains the authenticated portal.
2. `marketplace-domain.js` is a pure deterministic domain layer. It normalizes
   database rows, distinguishes explicit/derived/unknown provenance, composes
   filters, scores profile completeness, ranks similar products and produces
   explainable requirement recommendations without network or credential
   access.
3. `marketplace-products.js` owns the bounded product request and the
   authenticated favorite request. The previous catalog and favorite startup
   calls are disabled to avoid duplicate queries while their compatibility
   functions remain available for existing modal/RFQ contracts.
4. Recommendations retrieve from the already bounded catalog and score
   deterministically. No paid AI request, provider credential, token spend or
   new cost commitment is introduced. Labels are capped by evidence quality and
   show matches, gaps, blockers and unknowns.
5. Comparison is session-scoped and may be safely represented in a URL by
   public product references. It never queries private data.
6. Company roles are displayed as stored. Case-only duplicates are consolidated
   in the filter control without rewriting database values.
7. Public downloads use only existing RLS-authorized HTTP(S) assets. Unsafe URL
   schemes are rejected. The current schema has no byte-size column, so the UI
   reports `Size unavailable` rather than guessing. No generated PDF was needed.
8. The portal accepts only same-origin return URLs for the public marketplace
   roots and `/m/<slug>`, preventing an open redirect while preserving the page
   after sign-in.

## Database and authorization

Migration `202608020001_enterprise_marketplace.sql` adds:

- private `public.company_follows` rows with unique `(user_id, company_id)`;
- owner-only SELECT RLS;
- idempotent SECURITY DEFINER `follow_company(bigint)` and
  `unfollow_company(bigint)` RPCs;
- SECURITY INVOKER `get_my_followed_company_ids()`;
- anonymous table and RPC denial;
- direct authenticated table mutation denial, so mutations use the scoped RPCs;
- explicit anonymous favorite-mutation denial while preserving authenticated
  owner operations.

The RPC accepts only `auth.uid()` and a company satisfying the existing
`company_is_public` contract. No public follower list or follower count is
exposed. `supabase/tests/enterprise_marketplace.sql` verifies privileges,
duplicate suppression, cross-user isolation, owner reads and idempotent
unfollow inside a rollback-only transaction.

The linked dry run proposed exactly:

```text
202608020001_enterprise_marketplace.sql
```

It was not applied. Production database lint returned zero errors.

## Implemented marketplace behavior

### Products

- keyword, category, company, country, certification, sterility, use-type,
  material and profile-detail filters;
- URL-persisted filter/sort/page/detail/compare/favorite-view state;
- active chips, reset, empty states, skeleton loading and 12-item progressive
  loading from a 250-row bounded query;
- compact evidence-only cards with company identity, known signals, profile
  detail, favorite, compare, detail, RFQ and showroom actions;
- large detail dialog with structured specifications, provenance labels,
  honest missing states, public brochure download, company link and up to four
  explainable similar products;
- comparison of up to four products with difference highlighting, neutral
  unknowns, a shareable public-reference URL, session persistence, RFQ actions
  and a horizontally scrollable mobile table with frozen row labels;
- dedicated searchable/filterable favorites view, count, optimistic update and
  rollback, duplicate-safe writes and signed-out return preservation;
- requirement assistant with deterministic candidates, fit labels, matches,
  gaps, blockers and unknowns. It explicitly disclaims regulatory and
  procurement advice.

No OEM/private-label catalog filter or card badge is shown because no public
structured field exists. OEM intent can still be requested in the RFQ form.

### RFQ conversion

The existing RFQ contract is preserved. The product flow now collects quantity,
unit, destination, requested date, incoterm, target price, certifications,
packaging, OEM/private-label intent and notes; previews the exact number of
deduplicated recipient companies; requires a review step; returns a clear
success state; and links an authenticated user to
`portal.html#rfq-chat=<id>`. No unsupported attachment control was added because
the current RFQ contract has no authorized attachment pipeline.

### Companies and showrooms

- mixed-scope Company Directory terminology throughout navigation, metadata,
  filters, empty states, admin labels and marketplace assistance;
- directory filters for company type, country, public product category, listed
  certification and verified state, plus followed-only and sorting;
- company cards with exact role, location, approved-profile indicator,
  separately labelled verified state, description, categories, listed
  certifications, product count, showroom, product and follow actions;
- showrooms with company identity, overview, location, exact role, listed
  certifications, public products, catalogs, public certificate documents,
  contact/RFQ and follow actions;
- honest trust signals for marketplace approval, verification, profile
  completeness and missing public OEM/private-label data;
- signed-out follow redirects to login without losing the showroom; signed-in
  follow state is private and user scoped.

A company-specific public matchmaking identity is not authorized by the
current public schema, so Sprint 2 does not guess a connect target. Existing
matchmaking remains available through the shared navigation.

### Global search

The shared header now searches public products, public companies and product
categories with a 220 ms debounce, request cancellation, loading/no-result/error
states, grouped results, deep links, arrow-key navigation and Escape handling.
It queries only columns already granted to anonymous users. Public tender search
was not added because the existing global header has no equivalent authorized
public tender-search contract; the established Tenders destination remains.

## Accessibility and responsive validation

Rendered checks were completed at 320, 360, 390, 414, 768, 1024 and 1440 px
for product and company surfaces. Results:

- no page-level horizontal overflow at any required width;
- mobile filters open and remain keyboard operable;
- four-product comparison scrolls inside its labelled region without widening
  the page;
- detail dialog uses a focus trap, Escape close, labelled controls and hidden
  inactive state;
- RFQ dialog has a correct accessible name and review live state;
- search supports keyboard focus transfer to grouped results;
- favorite, compare and follow controls expose `aria-pressed`;
- filters, primary marketplace actions and follow targets have enlarged mobile
  hit areas;
- shared skip link, visible focus, reduced-motion behavior, live regions and
  breakpoint rules remain active.

## Performance

The React bundle is unchanged by the static marketplace work:

- JS: 316.00 kB / 92.23 kB gzip;
- CSS: 59.05 kB / 11.77 kB gzip.

Root asset changes:

| Asset | Before bytes | After bytes | Delta |
|---|---:|---:|---:|
| `medichall-design-system.css` | 24,430 | 25,533 | +1,103 |
| `medichall-navigation.js` | 16,718 | 21,942 | +5,224 |
| `marketplace-enterprise.css` | 0 | 14,551 | +14,551 |
| `marketplace-domain.js` | 0 | 15,531 | +15,531 |
| `marketplace-products.js` | 0 | 41,206 | +41,206 |
| `marketplace-companies.js` | 0 | 14,957 | +14,957 |

The product page performs one bounded product request, plus authenticated user
and favorite requests only when a token exists. The directory performs one
bounded company request and one bounded product-facet request, plus follow-state
requests only for an authenticated user. Showrooms use bounded company,
product, catalog and certificate reads without per-card N+1 calls. Images are
lazy loaded. Recommendation cost is zero provider calls and no token spend.

## Security review

- existing favorite uniqueness and owner RLS are retained;
- follow uniqueness, owner RLS and scoped RPCs are added;
- anonymous follow/favorite mutation is denied;
- comparison and recommendations use public product fields only;
- public document links remain RLS gated and are restricted to HTTP(S);
- no private Storage path or signing credential is exposed;
- RFQ company IDs are deduplicated and the existing authorization/notification
  path is preserved;
- same-origin login return validation prevents open redirects;
- browser assets contain no service-role, Resend, Daily or AI-provider key;
- credential scan passed across 374 repository text files.

## Regression evidence

Passed:

- 117 Deno tests;
- 96 React/Vitest tests in 16 files;
- React TypeScript typecheck;
- React ESLint;
- React production build;
- root-page inline JavaScript parse and duplicate-ID checks for six pages;
- focused marketplace domain, terminology and security checks;
- UI design-system check;
- portal artifact parse/duplicate-ID check;
- migration sequencing check;
- linked migration dry run (one migration only);
- linked production database lint (zero errors);
- credential scan;
- `git diff --check`;
- rendered responsive and interaction checks described above.

Not available locally:

- `supabase db reset` and the SQL/RLS regression could not run because Docker
  Desktop was not running. Run the rollback-only SQL regression immediately
  after deploying the migration to an authorized target.

Repository-wide `deno fmt --check supabase/functions` reports 11 pre-existing
unformatted files, and repository-wide `deno lint supabase/functions` reports
52 pre-existing issues in unchanged legacy functions/tests. Sprint 2 adds no
Deno source and the complete Deno test suite passes.

No authenticated production mutation was used for browser QA. Favorite/follow
and RFQ submission are therefore covered by deterministic/RLS tests and by
rendered signed-out/pre-submit flows; production end-to-end confirmation remains
a post-deployment smoke test.

## Exact cPanel upload manifest

All destinations are under `public_html`. Shared assets must be uploaded first,
and `portal.html` last. Every item is required for a coherent Sprint 2 release.

| Order | Repository path | cPanel destination | SHA-256 | Bytes | Status |
|---:|---|---|---|---:|---|
| 1 | `medichall-design-system.css` | `public_html/medichall-design-system.css` | `17b02f01ce401b63a79b4c5d21410fd3b89b96d041923d46ef4f77dd1c3c522f` | 25,533 | Required |
| 2 | `marketplace-enterprise.css` | `public_html/marketplace-enterprise.css` | `41b9c919d97ff6cfba0fbe59ac8d8e0710d48ad2f6228c8373ba8ca431ebe709` | 14,551 | Required |
| 3 | `marketplace-domain.js` | `public_html/marketplace-domain.js` | `c796059b822acc321986fbdabc7adafbd19d900be53d2f8c80ed5a130794dde8` | 15,531 | Required |
| 4 | `marketplace-products.js` | `public_html/marketplace-products.js` | `fc95a164a9130280c715fdaf319cecbbfadb66584af7772d23fb36479791bfcd` | 41,206 | Required |
| 5 | `marketplace-companies.js` | `public_html/marketplace-companies.js` | `23727484e67c63c82d5a6b4a415c6c0b5034d3959caab1d48073d3850286b6ad` | 14,957 | Required |
| 6 | `medichall-navigation.js` | `public_html/medichall-navigation.js` | `13915e7f97796410e087aa4824155e921de9b513518513b8b14769af483ada9d` | 21,942 | Required |
| 7 | `index.html` | `public_html/index.html` | `dac4400706b5990e9820613917815722f815417e68898b1267e67c32e1739288` | 104,952 | Required |
| 8 | `products.html` | `public_html/products.html` | `3b6cf60b6bfbc2f69575c3da296e5170943134d157f06821575ba41a03557ee8` | 65,669 | Required |
| 9 | `companies.html` | `public_html/companies.html` | `c72bd07ffdfdc96701e732f2938ac5a22f50ebbe7dcb06cc977cb07adca29fa8` | 59,168 | Required |
| 10 | `matchmaking.html` | `public_html/matchmaking.html` | `da42efb7bdb9560f4ddea5611aa2e08768076cab51a6c1e6ddd6b81a83118799` | 20,790 | Required (shared-asset cache key) |
| 11 | `admin.html` | `public_html/admin.html` | `b0e49f89f5c5cbfdff1d00e9b003698248f194f5632ecee34cf4efeefd644f22` | 56,213 | Required (terminology and shared-asset cache key) |
| 12 | `portal.html` | `public_html/portal.html` | `bed3ab34214032d4dcc35529ac945fcf77a46c1cc59dfcc23b56a11a43295408` | 329,918 | Required; upload last |

There is no separate `manufacturers.html`. The exact mixed directory filename is
`companies.html`. The release must not rename it. The version query
`?v=20260802s2rc1` is already embedded in the six root HTML pages; upload the
unmodified filenames above.

## Deployment gate, backup and rollback

Before cPanel upload:

1. deploy only `202608020001_enterprise_marketplace.sql` through the normal
   reviewed database process;
2. execute `supabase/tests/enterprise_marketplace.sql` as a rollback-only
   regression;
3. verify anonymous mutation denial and a two-user follow/unfollow test;
4. in cPanel, create a timestamped backup directory outside the web root or
   download the 12 current files listed above; for the four new marketplace
   assets, record that no previous file existed;
5. verify backup hashes before overwriting anything.

Upload in manifest order. After upload, verify each deployed size/hash where
cPanel supports it. Purge only the affected CDN/cache paths if a CDN is present,
then use a hard refresh. Do not remove the embedded version query.

Rollback:

1. restore the six previous HTML files first, with `portal.html` restored last;
2. restore the previous `medichall-navigation.js` and
   `medichall-design-system.css`;
3. the four new marketplace assets may remain inert, or be deleted only after
   confirming no restored page references them;
4. leave `company_follows` in place during a frontend rollback. Dropping it is
   destructive to real follow state and requires separate explicit approval;
5. purge only affected cache paths and repeat the smoke tests.

## Post-upload smoke test

1. Confirm Marketplace, Products, Companies, Tenders and Matchmaking navigation
   on desktop and mobile.
2. Search for a known product and company from the shared header; test arrow
   keys, Enter and Escape.
3. Filter products by category, company, country and structured evidence;
   refresh and confirm URL persistence.
4. Open a product detail link, verify honest unknowns, brochure handling and
   similar-product explanations.
5. Compare four products at desktop and mobile widths; remove one and copy a
   comparison link.
6. As buyer A, favorite/unfavorite a product and verify persistence after
   reload; as buyer B, verify buyer A's favorite is invisible.
7. Open a company showroom, catalog and authorized certificate document.
8. As buyer A, follow/unfollow a company and use Followed only; as buyer B,
   verify buyer A's follows are invisible.
9. Signed out, click favorite/follow, sign in and verify return to the original
   product/showroom.
10. Prepare an RFQ, verify the recipient preview and review step, submit once,
    confirm one intended company notification, then open the exact RFQ chat.
11. Enter a natural-language requirement and verify matches, gaps, blockers,
    unknowns and the regulatory/procurement disclaimer.
12. Recheck portal dashboard, RFQ/messaging, matchmaking/meetings/Daily,
    tenders, Universal Tender Import, Document Intelligence, lot matching and
    notifications for regression.
13. Confirm browser source contains only the public Supabase publishable key and
    no service-role, Resend, Daily or AI-provider secret.

## Remaining limitations

- database migration and cPanel deployment are intentionally pending;
- product gallery is limited to the one current product image field;
- file byte sizes are unavailable in the current public data contract;
- there is no public structured OEM/private-label field, so no discovery filter
  or claim is fabricated;
- there is no authorized company-specific public matchmaking-profile join;
- public RFQ attachments are not supported by the existing contract;
- no PDF is generated when an existing authorized catalog/brochure is present;
- deterministic recommendations intentionally make no paid AI call;
- authenticated favorite/follow and submitted-RFQ browser smoke tests remain
  post-deployment gates because this sprint did not mutate production QA data.

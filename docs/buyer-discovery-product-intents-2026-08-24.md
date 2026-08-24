# Buyer Discovery product-intent release

Date: 2026-08-24
Branch: `react-migration`
Production deployment: not performed

## Outcome

The canonical European Buyer Discovery workspace now starts from one of three explicit intent sources:

1. `PROFILE_PRODUCT` — confirmed taxonomy mappings from the company's active MedicHall products.
2. `AD_HOC_PRODUCT` — a bounded manual product phrase resolved through the existing deterministic Medical Product Taxonomy RPC.
3. `WEBSITE_DETECTED_PRODUCT` — company-confirmed taxonomy suggestions from a bounded scan of its stored public HTTPS domain.

All three sources call the existing `external-prospect-discovery` Edge Function and retain its TED, public-site, registry-adapter, deterministic scoring, deduplication, progress, privacy, and tenant-isolation model. No second prospect engine, paid classifier, contact enrichment, email, notification, message, or automatic product mutation was added.

## Product behavior

- A manufacturer with zero catalogue products is not blocked. If a stored HTTPS website is available, the workspace starts on **Scan my website**; otherwise **Search by product** remains available.
- Profile products with approved primary taxonomy mappings remain multi-selectable. Products without a confirmed taxonomy mapping are shown as unavailable for that mode rather than silently classified.
- Manual input accepts a product or medical-category phrase of 3–160 characters. URL, crawler, generic-search, code, and query-injection forms are rejected. Exact names and approved aliases resolve through `resolve_medical_product_term_v1`; the user must explicitly confirm the returned category before discovery.
- Unmapped text produces no discovery intent and no invented taxonomy category.
- Website suggestions expose the public label, canonical taxonomy category, confidence, and bounded source-page references. HIGH and MEDIUM may be preselected; LOW is never preselected. The user remains in control.
- **Add to my profile** opens the existing draft-protected product modal (or the equivalent portal route from standalone/React), prefilled only when no protected new-product draft already exists. Matching taxonomy IDs are labelled **Already in your profile**.
- Europe-wide is represented by an empty country list. A selected-country list is bounded, normalized, included in the intent hash, and does not update the company's saved target markets.
- The latest ten runs are returned; the UI displays eight recent searches and can reopen an intent-specific result set.

## Persistence and authorization

Forward-only migration:

`202608240001_buyer_discovery_product_intents.sql`

It:

- adds bounded, non-null `intent_source` and normalized `intent_context` to discovery runs;
- makes company/external-company matches intent-specific while reusing the global external-company entity;
- adds bounded evidence, activity, and taxonomy snapshots for intent-specific explanations;
- creates the forced-RLS, service-write-only `company_website_product_scans` cache;
- adds owner/admin-authorized product-context, discovery-start, website-scan-start, and workspace RPCs;
- grants the callable RPCs to authenticated/service roles while denying anonymous execution and all browser-role raw mutations;
- stores no raw product query, raw website page, contact field, recipient, provider secret, or customer message.

Normalized taxonomy IDs plus sorted target countries form the discovery hash. Source mode and raw spelling do not, so an exact name, approved alias, profile product, and website suggestion reuse the same 24-hour cached run when they resolve to the same taxonomy/country intent. Company-level discovery limits remain a 30-minute cooldown, three runs/day, and twenty runs/month. Website scans use a 14-day result cache, 24-hour rescan cooldown, two starts/day, and ten/month.

## Website scan boundary

The function reads the website only from the authorized company's database row. It does not accept a caller-supplied URL. The shared safe-public-fetch boundary enforces HTTPS, public DNS before and after requests, private/special IP rejection, redirect validation, DNS-rebinding defense, response and timeout limits, and bounded response streaming. The product operation additionally rejects any redirect leaving the normalized stored company domain and respects `robots.txt` for the home and each queued path.

The scan is capped at:

- 12 pages;
- depth 1;
- 2 redirects per request;
- 512,000 bytes per HTML page;
- 80 extracted signals per page;
- 8 taxonomy suggestions;
- 25 seconds total runtime;
- homepage, sitemap, fixed high-value public product/category paths, and same-origin product links only.

Scripts, forms, footer boilerplate, contact labels, excluded legal/career/news paths, query strings, and contact coordinates are not persisted. No browser session, JavaScript execution, form submission, authentication bypass, CAPTCHA bypass, image copy, full description copy, or entire-site crawl occurs.

## Frontend parity and accessibility

The shared `external-prospects.js` component drives the root portal, standalone matchmaking page, and maintained React route. All surfaces use release ID `20260824intent1` for the changed shared CSS/JS.

Verified behavior includes labelled form controls, native checkboxes/radios/selects, `aria-pressed` mode buttons, polite status regions, keyboard-operable controls, visible focus, and reduced-motion treatment. Browser checks at 320, 360, 390, 414, 768, and 1440 pixels found no horizontal overflow. Zero-product manual and website modes, complete results, filters, and prospect actions remained visible. Browser console errors: 0.

## Validation evidence

- Buyer Discovery product-intent static contract: PASS.
- Existing Phase 2 UX/static contracts: PASS.
- Deno website-extraction, safe-fetch, robots/attachment, scoring/registry, and Edge boundary tests: 44/44 PASS.
- React tests: 108/108 PASS.
- React typecheck: PASS.
- Edge Function Deno check: PASS.
- Product draft recovery: 18/18 PASS.
- Matchmaking retry contract: 4/4 PASS.
- Production auth recovery: 8/8 PASS.
- Traffic Analytics: 8/8 PASS.
- Final beta security: 3/3 PASS.
- Contact Privacy, TED canonical lots, and tender-access static regressions: PASS.
- PostgreSQL parse validation for the migration and rollback-only SQL regression: PASS.
- Migration sequence: PASS — 58 canonical migrations, three immutable archived migrations, and only `202608240001` planned next.
- Responsive browser validation: PASS at all six required widths; console errors 0.
- `git diff --check`: required again immediately before commit.

The rollback-only SQL regression is present at `supabase/tests/buyer_discovery_product_intents.sql`. It covers zero-product discovery, normalized cross-source cache reuse, idempotency, anonymous/raw-table denial, cross-company denial, contact-field constraints, and workspace restoration. It could not be executed against a local database in this environment because no Docker/Postgres runtime is installed. The linked dry run was also intentionally non-mutating but could not authenticate with the rotated database password available to this session. The deployment gate must run the dry run and rollback-only regression before applying anything.

## Backend deployment plan — approval required

1. Confirm `react-migration` and the approved release commit.
2. Take the repository-required restricted production schema backup.
3. Run `supabase db push --linked --dry-run`; stop unless it proposes exactly `202608240001_buyer_discovery_product_intents.sql`.
4. Apply only that migration to project `azdmuarzntzqdyirysux`.
5. Execute `supabase/tests/buyer_discovery_product_intents.sql` in its rollback-only transaction and verify it leaves zero QA rows.
6. Deploy only `external-prospect-discovery` with the repository's current application-level JWT configuration.
7. Verify ACTIVE status, OPTIONS 204, unauthenticated POST 401, and authenticated company scoping.
8. Run one bounded authenticated QA for exact, alias, unknown, website suggestion, reuse, and cross-company denial without paid AI, email, notification, contact collection, or real-customer mutation; clean only synthetic records.
9. Stop and report before any cPanel upload.

## Minimal cPanel package

Package: `deliverables/medichall-buyer-discovery-product-intents-cpanel-2026-08-24.zip`
Package SHA-256: `01e9aaa0e42dfc2528fd92ed9cd30e2028f18cf2f1087a6a282b16056dd395aa`
Package size: 122,128 bytes

Upload only after the backend deployment passes, in this order:

| Order | Repository file | cPanel destination | Bytes | SHA-256 | Required |
| ---: | --- | --- | ---: | --- | --- |
| 1 | `external-prospects.css` | `public_html/external-prospects.css` | 16,878 | `342827f18e1036e60aba8eb7d3f484e79fc187db814a4b61d3fb484d02f27744` | Yes |
| 2 | `external-prospects.js` | `public_html/external-prospects.js` | 45,346 | `17ac136f9ee973f156a0ac42466a30cb8073803f18dc9bd5acf9beb16ccaa441` | Yes |
| 3 | `matchmaking.html` | `public_html/matchmaking.html` | 21,741 | `525fb5e46edf0ba2243d2114b068cf77487f31445ed6df525b31c3f92d58ca72` | Yes |
| 4 | `portal.html` | `public_html/portal.html` | 402,386 | `88c674f54ef170743395b392914a361ce87fe55bbf6b33c63156eaa074d19448` | Yes |

Back up these four live files before replacement. Upload shared assets first and HTML last. Purge the cPanel/CDN cache if configured, then hard-refresh and confirm both pages request `external-prospects.css?v=20260824intent1` and `external-prospects.js?v=20260824intent1`. Rollback consists only of restoring the four backups and purging the same cache. No navigation, design-system, traffic, SEO, authentication, product-data, or other root page is part of this patch.

## Remaining deployment limitations

- This commit does not deploy the migration, Edge Function, or cPanel package.
- Database behavior must pass the exact linked dry run and rollback-only SQL regression with the authorized production credential at deployment time.
- Website extraction is deliberately HTML/structured-data based; JavaScript-only catalogues may return no clear products and fall back to manual product entry.
- Registry depth remains market-dependent and is reported as such; the release does not enable unsupported registry adapters.

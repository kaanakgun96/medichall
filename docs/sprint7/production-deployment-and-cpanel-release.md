# Sprint 7 production deployment and cPanel release

Date: 2026-08-13
Production Supabase project: `azdmuarzntzqdyirysux`
cPanel state: **not uploaded by Codex**

## Backend deployment evidence

- Restricted pre-deployment backup: `supabase/.temp/medichall-sprint7-predeployment-20260813.sql`; schema-only `public` and `storage`; 762,322 bytes; mode `0600`; zero row statements; SHA-256 `bdc76314cd62357fb2d0e9a6216ca8fc339f0579a3f2ad6ef9e7fd2cc227b343`. This ignored local evidence file is not part of the commit or cPanel package.
- Pre-deployment core counts: 6 companies, 39 products, 14 RFQs, 10 meetings; latest migration `202608130004`.
- Linked dry run proposed exactly `202608130005_sprint7_acquisition_analytics.sql`.
- Only migration `202608130005` was applied. The final linked dry run was empty.
- The rollback-only `sprint7_acquisition_analytics.sql` production regression passed.
- Only `traffic-analytics` was deployed; production reports version 2, `ACTIVE`, `verify_jwt=false`, which preserves the collector's application-level origin, payload and authentication classification boundary.
- Live boundary test: `OPTIONS` 204; unsupported origin 403; unknown/sensitive conversion field 400; accepted page-view and conversion responses identify their kind without configuration details.
- Idempotency: the first synthetic conversion returned 201, an identical retry returned 200/deduplicated, and exactly one row existed before cleanup.
- Attribution: the conversion inherited the session's normalized first-touch LinkedIn/source campaign fields.
- Cleanup removed exactly 1 conversion, 1 page view, 1 session and 1 visitor. All fixed QA identifiers and all checked conversion/page/session orphans were zero afterward.
- Post-deployment core counts remained 6 companies, 39 products, 14 RFQs and 10 meetings; latest migration `202608130005`.
- Production database lint returned zero errors. No provider, AI, notification or email request was made.

## Exact cPanel upload manifest

All destinations are directly under `public_html`. Upload every file; there are no optional files in this minimal coherent release. Shared assets and scripts precede dependent HTML. `robots.txt` and `sitemap.xml` are last so crawlers do not discover landing URLs before their pages exist.

| Order | Repository path | cPanel destination | Purpose | Bytes | SHA-256 | Required |
|---:|---|---|---|---:|---|---|
| 1 | `medichall-logo.svg` | `public_html/medichall-logo.svg` | Real MedicHall Organization/logo entity asset | 723 | `b89ed5ed99b2f126c3661c20519782cd0719ec9c29b4ab8f8f75d7ffc7495fc1` | Yes |
| 2 | `medichall-growth.css` | `public_html/medichall-growth.css` | Shared responsive landing-page visual system | 5,142 | `e2579ffaef0a7a8a113e5a64a75060f31405205f8604bc90ce938252ec37ba54` | Yes |
| 3 | `medichall-traffic.js` | `public_html/medichall-traffic.js` | Privacy-minimized page and allowlisted conversion tracking | 10,604 | `e62053728c0fc343ffae280e739ced065fabb6bd69d86e28d112e5154aeb6b53` | Yes |
| 4 | `marketplace-companies.js` | `public_html/marketplace-companies.js` | Public showroom metadata/schema and connection conversion signal | 19,515 | `d2254fdc28bc6084261189a76f2f91cb1dfb49fa747effc41fe6dd767ec37e3f` | Yes |
| 5 | `marketplace-products.js` | `public_html/marketplace-products.js` | Product RFQ conversion signal; product behavior otherwise preserved | 45,079 | `82d0c6a71fc03232bfba54cf18c8f4f00df1437369821c84d11abc5164939c2a` | Yes |
| 6 | `matchmaking-workspace.js` | `public_html/matchmaking-workspace.js` | Aggregate match/connection/meeting conversion signals | 70,994 | `0ffa893876eae57cbaafec8463794557c33c09dd1c23a5b094637fdea4b23966` | Yes |
| 7 | `medical-device-tenders.html` | `public_html/medical-device-tenders.html` | Medical-device tender search-intent landing page | 8,973 | `258fa997f4dfd4a9cdad5b406c4b77aa2b54cbcef9bf4dfa96071b615082ae26` | Yes |
| 8 | `ai-tender-intelligence.html` | `public_html/ai-tender-intelligence.html` | AI Tender Intelligence search-intent landing page | 8,785 | `1c4c325f54d5b01a45c77f735f3dc6dc40b0a9259a23b7b9eb673081d004b131` | Yes |
| 9 | `find-medical-device-distributors.html` | `public_html/find-medical-device-distributors.html` | Distributor discovery search-intent landing page | 8,200 | `e3ac984f0c6293245dfed257fa6aaaac5c578b98212fc26e0b84a90d2405e6b9` | Yes |
| 10 | `medical-device-b2b-marketplace.html` | `public_html/medical-device-b2b-marketplace.html` | Medical marketplace/RFQ search-intent landing page | 8,461 | `3f7662b03a0996f3fd6bb5d40220a30bbf774ce87bd10a09af5a3bac6666b9b9` | Yes |
| 11 | `ai-medical-device-matchmaking.html` | `public_html/ai-medical-device-matchmaking.html` | AI medical matchmaking search-intent landing page | 8,516 | `7008ecd76e7f964f1a2fbf2a9b76e15b106d688383bfa98024b205e9f763f9f0` | Yes |
| 12 | `index.html` | `public_html/index.html` | Homepage positioning, citable About content and internal links | 94,968 | `1c367c50745b6e9acdf610e3d41ead37fece7e1016eedad671c79da7994b99d8` | Yes |
| 13 | `products.html` | `public_html/products.html` | Public product catalog metadata and initial contextual content | 59,421 | `ae1645dd53c4568329e1e985116f138510545c277c4faafa516f9bf5edd99d27` | Yes |
| 14 | `companies.html` | `public_html/companies.html` | Mixed company directory for manufacturers, distributors, suppliers, buyers and other roles | 53,238 | `1bb4e08867b059d6abe469fc1f09a7c7dbed1e128ed3d19c39ddde86b22c4823` | Yes |
| 15 | `tenders.html` | `public_html/tenders.html` | Public tender discovery metadata and official-source positioning | 14,948 | `9cb46f4bf36caec0771bd796db8b050ce6b4be2e6ca570a866bd9aa25ffa406a` | Yes |
| 16 | `matchmaking.html` | `public_html/matchmaking.html` | Private/noindex matchmaking workspace with aggregate conversion tracking | 21,558 | `1e4426840176c25eb0815ad0bc9d6ad8127eb3847a32f6b50be4987f39c9a547` | Yes |
| 17 | `portal.html` | `public_html/portal.html` | Production partner portal with aggregate activation/RFQ conversion tracking | 376,756 | `e8df205c590c3937c97f5bb7d0c16bc3c6565e86f9646d77b74d38a447116a12` | Yes |
| 18 | `admin.html` | `public_html/admin.html` | Existing Admin Growth panel extended with aggregate acquisition funnel/source quality | 89,193 | `86830d565f851643883fda2bab072c81f14e529b2a469dcb1af4e5899fbe04ab` | Yes |
| 19 | `robots.txt` | `public_html/robots.txt` | Public/private crawl policy, AI-search/training distinction, sitemap reference | 263 | `f70ce35e4e582ecc666abb01d48e4c97d2c8d116f833674cd2f7fbd28168ab90` | Yes |
| 20 | `sitemap.xml` | `public_html/sitemap.xml` | Canonical public URL discovery | 1,411 | `f5187d132b1036ef6ddf6a72d0f94a0efa4ef2f750b1cf505f09575b913dfd6b` | Yes |

Unchanged and deliberately excluded: `medichall-design-system.css`, `medichall-navigation.js`, `medichall-session.js`, `medichall-ui.js`, tender/business logic not listed above, Supabase files, documentation and all unrelated deliverables.

## Backup and upload

1. In the cPanel account home, create a timestamped backup directory outside `public_html`, for example `medichall-backup-before-sprint7-20260813`.
2. Copy each existing destination in the manifest into that directory, preserving filenames. Record which of the five landing pages, `medichall-growth.css` and `medichall-logo.svg` did not exist before upload.
3. Download the backup directory or create a cPanel archive before changing production.
4. Upload the contents of `UPLOAD_TO_PUBLIC_HTML` directly into `public_html` in the numbered order above. Do not upload the wrapper directory itself.
5. Confirm each production file's byte size and SHA-256 where cPanel permits it.
6. Purge only affected cPanel/CDN cache entries. The new shared release identifier is `20260813growth1`; do not rename files or manually edit query strings.

## Rollback

1. Stop the smoke test at the first auth, RFQ, tender, matchmaking, layout or console regression.
2. Restore every previously existing file from the timestamped backup in reverse upload order.
3. Delete only files explicitly recorded as absent before this release; do not delete shared assets that predated Sprint 7.
4. Purge affected caches and verify the homepage, login, products, companies, tenders, matchmaking and portal.
5. Backend rollback is separate. Do not remove migration `202608130005` while the Sprint 7 frontend is live. If backend rollback is genuinely required, stop acquisition traffic and prepare a reviewed forward-only compatibility migration; do not edit migration history.

## Post-upload smoke checklist

- `robots.txt` and `sitemap.xml` return 200 with the exact release content.
- Homepage, products, companies, tenders and all five landing URLs return 200 and the declared clean canonical.
- `/portal`, `/admin` and `/matchmaking` remain `noindex,nofollow`.
- Header says **Companies**, and the directory still includes manufacturer, distributor, supplier, buyer and other role behavior.
- Products can open/close sequential detail panels, scroll to the bottom, save, compare, open company profiles and create an RFQ.
- Company showroom metadata/canonical changes on `/m/<slug>` without exposing private fields.
- Tender discovery retains official-source links; private intelligence remains behind authentication.
- Login/session recovery, portal navigation, matchmaking connection flow, meeting scheduling and secure video remain functional.
- Admin Growth loads Traffic Analytics plus Acquisition funnel/source quality; an empty conversion period is an explicit zero state.
- At 390 and 1440 px there is no horizontal overflow; keyboard focus, skip link, one visible level-one heading and native FAQ controls work.
- Browser console has no new error and Network shows one tracker load, no retry loop and no duplicate conversion request for one successful action.
- Search Console/Bing submission, LinkedIn publishing, PR outreach and Google Ads remain manual founder actions.

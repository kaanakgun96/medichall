# MEDICHALL FIRST-CUSTOMER BETA RELEASE

Prepared from `react-migration` after Sprints 2.2–6. This is a manual cPanel frontend release. It does not deploy database migrations or Edge Functions.

## Important

- Destination: `/public_html/`
- Upload the **contents** of `UPLOAD_TO_PUBLIC_HTML`, not the enclosing folder.
- Enable overwrite for matching filenames.
- Do not rename `companies.html`. It is the mixed **Company Directory** for manufacturers, distributors, buyers, suppliers, and other supported company roles.
- There is no `manufacturers.html` in the canonical repository or this release.
- All HTML pages consistently reference asset version `20260809s22rc1`.
- Keep `ROLLBACK_BASELINE` off the public web root. It is the exact pre-release production baseline captured from `https://medichall.com/` on 2026-08-09.
- `medichall-ui.js` returned HTTP 404 in the preserved baseline and is therefore new in this release. The rollback procedure removes it after the old pages are restored.

## Page classification

| Repository file | Actual product purpose | Required |
|---|---|---:|
| `index.html` | Public MedicHall landing page and marketplace discovery entry | Yes |
| `products.html` | Public product catalog across approved companies; product cards link to the owning eligible company regardless of company role | Yes |
| `companies.html` | Mixed Company Directory with role/type, country, certification, and category behavior | Yes |
| `tenders.html` | Public medical tender discovery and authenticated tender-intelligence entry | Yes |
| `matchmaking.html` | Standalone partner matchmaking and meeting-workspace entry | Yes |
| `portal.html` | Production partner authentication and canonical authenticated workspace | Yes |
| `admin.html` | Admin-only platform operations and growth dashboard | Yes |
| `manufacturers.html` | Does not exist | No |

Shared navigation labels the mixed directory **Companies**, matching its actual contents. Product discovery does not impose a manufacturer-only company constraint.

## Exact upload order

First make a cPanel backup of every current file with a matching name. Then upload in this order:

| Order | Repository path | cPanel destination | Bytes | SHA-256 | Required |
|---:|---|---|---:|---|---:|
| 1 | `medichall-design-system.css` | `/public_html/medichall-design-system.css` | 28,219 | `4cc3c8413d3e1faf7a83f25f6f70926d5641b7be2783a17af6d071e6753864ff` | Yes (included unchanged dependency) |
| 2 | `marketplace-enterprise.css` | `/public_html/marketplace-enterprise.css` | 14,551 | `41b9c919d97ff6cfba0fbe59ac8d8e0710d48ad2f6228c8373ba8ca431ebe709` | Yes (included unchanged dependency) |
| 3 | `medichall-session.js` | `/public_html/medichall-session.js` | 7,531 | `1e60bdce3d2caff5953e6b72516786b350a395a719f05bfa80c5aa1a97806620` | Yes (included unchanged dependency) |
| 4 | `medichall-ui.js` | `/public_html/medichall-ui.js` | 5,964 | `75b56abcc26343e0d81732012640a21434dfb18f4643b8f8ada099b9a30d6da9` | Yes (new) |
| 5 | `medichall-navigation.js` | `/public_html/medichall-navigation.js` | 26,958 | `36fc9aaacc23dbce8641dc336b0ddfe20d4d6ea65b30da9b74b077d8d5f820b8` | Yes |
| 6 | `marketplace-domain.js` | `/public_html/marketplace-domain.js` | 15,531 | `c796059b822acc321986fbdabc7adafbd19d900be53d2f8c80ed5a130794dde8` | Yes (included unchanged dependency) |
| 7 | `marketplace-products.js` | `/public_html/marketplace-products.js` | 41,778 | `ac1f14ff15f675909c37175553bbee3865016498714561c7813b4c9973d88c12` | Yes |
| 8 | `marketplace-companies.js` | `/public_html/marketplace-companies.js` | 15,249 | `23898cc92beb29734d1010044aa2c5b410b6f9f7273859b4a99952a08451fac8` | Yes |
| 9 | `matchmaking-domain.js` | `/public_html/matchmaking-domain.js` | 11,229 | `28d60beaa59ebbc9cbc9ec8fb76113c5059bf3952db434424a53acee9dc47501` | Yes (included unchanged dependency) |
| 10 | `matchmaking-workspace.js` | `/public_html/matchmaking-workspace.js` | 66,074 | `256a7c3f1e85515baa1431c4ada8987a672a0e5b647aa0be4bc7edb485316549` | Yes |
| 11 | `tenders.js` | `/public_html/tenders.js` | 17,166 | `e46efc80a0ba14c2fc64c940c064abaa407a0d75ea647439feb69afa4cc28255` | Yes (included unchanged dependency) |
| 12 | `index.html` | `/public_html/index.html` | 105,042 | `e4cf994b044da796acf9edd30120abdbd1a45786ad102da68515a81060525451` | Yes |
| 13 | `products.html` | `/public_html/products.html` | 65,785 | `70e621e8f06cc359cba2d48e7426517d019aa416b89184a697ca76c1357a02bc` | Yes |
| 14 | `companies.html` | `/public_html/companies.html` | 59,409 | `37b69163f6d76c4b485aec34e2f0d93caff75f58bfd1ec075e7eefdec2195d04` | Yes |
| 15 | `tenders.html` | `/public_html/tenders.html` | 13,461 | `bfc7782b787faca5e8205eb75ddee38db8ae4373c14d992e98d1416d42b27f3c` | Yes |
| 16 | `matchmaking.html` | `/public_html/matchmaking.html` | 21,355 | `8523975fe509d21083a26fa9e65493ea7f698b1a3f71b58fb280c64aa7b29f1f` | Yes |
| 17 | `portal.html` | `/public_html/portal.html` | 365,903 | `9e434dece99e7d05eb33e225f6cee326c9d2ad9157e0a83b3c6ca1eaba090c3c` | Yes |
| 18 | `admin.html` | `/public_html/admin.html` | 69,407 | `03de379e14f4d2cd204ad75db50c800bc77bb385cb11bdfc93f8ae464756a16d` | Yes |

The six unchanged shared dependencies are deliberately included so this remains one coherent, self-contained package. Uploading all 18 files is the supported procedure.

## Verification before upload

From a terminal opened inside this release directory:

```sh
shasum -a 256 -c SHA256SUMS.txt
shasum -a 256 -c ROLLBACK_SHA256SUMS.txt
```

Every line must return `OK`.

## Cache guidance

1. Complete the full upload before opening production.
2. Purge any cPanel/CDN cache if one is configured.
3. Open a private/incognito window and hard-refresh once.
4. Confirm DevTools Network shows `20260809s22rc1` for local CSS/JS requests and no local asset returns 404.
5. Do not manually edit the query-string versions: the package is internally coherent.

## Post-upload smoke test

- `index.html`: loads without horizontal overflow; Products, Companies, Tenders, and Matchmaking navigation works.
- `products.html`: filter panel is a normal desktop sidebar, the mobile Filters control works, cards render, and product/company links open correctly.
- `companies.html`: heading is Company Directory; manufacturer, distributor, buyer, supplier, and other present roles are not relabeled.
- `tenders.html`: discovery loads and the authenticated tender action reaches the partner portal.
- `matchmaking.html`: match cards, explanations, connections, messages, meeting lifecycle, and Join Meeting UI load for an authorized test account.
- `portal.html`: login redirects into the authenticated dashboard; reload preserves the session; logout returns to login.
- Portal: onboarding/checklist, profile strength, opportunity explanations, Ask MedicHall, RFQ/messages, notifications, and preferences render without raw provider/database errors.
- `admin.html`: non-admin access is denied; an admin sees Growth overview and 7/30/90/all filters.
- Browser console: no critical errors, request loop, or missing local asset.
- Responsive: test 360 px and 1440 px; no page-level horizontal overflow.
- Security: unauthenticated users cannot open private partner/admin data.

## Rollback

If a release-blocking frontend issue is found:

1. Stop further manual edits and keep the uploaded release ZIP.
2. Upload the **contents** of `ROLLBACK_BASELINE` to `/public_html/`, overwriting the matching files.
3. Delete only `/public_html/medichall-ui.js`. It did not exist in the captured baseline.
4. Purge any cPanel/CDN cache and hard-refresh an incognito window.
5. Re-run login/session, Products, Company Directory, Tenders, Matchmaking, Portal, and Admin smoke checks.
6. Compare restored files against `ROLLBACK_SHA256SUMS.txt`.

This rollback changes only the cPanel frontend. It does not roll back forward-only database migrations or already deployed Edge Functions; those remain backward-compatible with the preserved frontend baseline.

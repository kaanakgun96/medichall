# MedicHall Sprint 2.1 — manual cPanel release

Source branch: `react-migration`

Source commit: `b12e493cecec414a9dea8616f451beb9cb8ae4b4`

Production frontend destination: cPanel `public_html`

The backend migration and tender-related Edge Functions are already live. The
files in `cpanel-upload/` are the manual frontend release. Codex did not upload
them to cPanel.

## Upload manifest

Upload in the order shown. Shared assets come first; HTML follows;
`portal.html` is last. The seven optional files are unchanged from the previous
canonical frontend but are included so the package is self-contained. Uploading
all 17 files is the safest procedure.

| Order | Repository/source path | cPanel destination | Bytes | SHA-256 | Status |
|---:|---|---|---:|---|---|
| 1 | `medichall-session.js` | `public_html/medichall-session.js` | 7,531 | `1e60bdce3d2caff5953e6b72516786b350a395a719f05bfa80c5aa1a97806620` | Optional, unchanged dependency |
| 2 | `medichall-design-system.css` | `public_html/medichall-design-system.css` | 28,219 | `4cc3c8413d3e1faf7a83f25f6f70926d5641b7be2783a17af6d071e6753864ff` | Required |
| 3 | `marketplace-enterprise.css` | `public_html/marketplace-enterprise.css` | 14,551 | `41b9c919d97ff6cfba0fbe59ac8d8e0710d48ad2f6228c8373ba8ca431ebe709` | Optional, unchanged dependency |
| 4 | `marketplace-domain.js` | `public_html/marketplace-domain.js` | 15,531 | `c796059b822acc321986fbdabc7adafbd19d900be53d2f8c80ed5a130794dde8` | Optional, unchanged dependency |
| 5 | `marketplace-companies.js` | `public_html/marketplace-companies.js` | 15,162 | `bbd9574eede03a6b9a7445d5f95e271d1deeb3c021d34dcfe550d1a1d8930e20` | Optional, unchanged dependency |
| 6 | `marketplace-products.js` | `public_html/marketplace-products.js` | 41,271 | `64e8c1e18a1afab921db4a3bdec27879c7d111c3981232ef1ddac3f8b594801f` | Optional, unchanged dependency |
| 7 | `matchmaking-domain.js` | `public_html/matchmaking-domain.js` | 11,229 | `28d60beaa59ebbc9cbc9ec8fb76113c5059bf3952db434424a53acee9dc47501` | Optional, unchanged dependency |
| 8 | `matchmaking-workspace.js` | `public_html/matchmaking-workspace.js` | 65,383 | `98aa1b460da0e45806fb379e5a98208a7d16bbb2760345670d685610cc8e5381` | Optional, unchanged dependency |
| 9 | `tenders.js` | `public_html/tenders.js` | 17,166 | `e46efc80a0ba14c2fc64c940c064abaa407a0d75ea647439feb69afa4cc28255` | Required, new |
| 10 | `medichall-navigation.js` | `public_html/medichall-navigation.js` | 26,553 | `1852641f55e850c3e40fab6b9a7949def3d160719b4d200d7a64e54e5c69c75b` | Required |
| 11 | `index.html` | `public_html/index.html` | 105,072 | `e101a81c7c3b8b4f02490aee415f6741c74510df221c358bc0af1f67e9ae694f` | Required |
| 12 | `companies.html` | `public_html/companies.html` | 59,235 | `147777d07426d358c8dc676a568df930f31e5d3621b78a67003c245b2af65a63` | Required; mixed Company Directory |
| 13 | `products.html` | `public_html/products.html` | 65,744 | `1efd4e39c70b4adfeb02ca406465c8a9a2135a70b034cdca2e829b68acb2bd87` | Required |
| 14 | `tenders.html` | `public_html/tenders.html` | 13,404 | `99c5a35018148170a7a4d5346ce6bb1a871ebb72bbd7635165cd8d79798c1c8e` | Required, new |
| 15 | `matchmaking.html` | `public_html/matchmaking.html` | 20,935 | `d6dd88806e2a8d903406bfa08e37c4402ff12562f647458eaf4d8bf12541666b` | Required |
| 16 | `admin.html` | `public_html/admin.html` | 58,448 | `bd3ee92c88dcba96453efccb9e14933fc6aaa46a468870c992365f3d9c0a368b` | Required |
| 17 | `portal.html` | `public_html/portal.html` | 334,358 | `0c418fdcd5de2f544d93b949749246b038d49e8ab7fd5c20ef188ce06532c4aa` | Required; upload last |

`companies.html` remains the mixed **Company Directory**. It is not renamed or
treated as manufacturer-only; existing buyer, distributor, supplier, and other
company-role behavior remains intact. No separate `manufacturers.html` exists.

## Backup and upload

1. In cPanel File Manager, create a timestamped backup outside `public_html`.
2. Copy the 15 existing target files into that backup before overwriting them.
3. Record whether `tenders.html` or `tenders.js` already exists. These are new
   in the canonical release and normally should not exist.
4. Upload the files from `cpanel-upload/` in manifest order. Enable overwrite
   only for the exact listed paths.
5. Compare cPanel file sizes with this manifest. If cPanel exposes checksums,
   compare SHA-256 as well.
6. Do not alter unrelated files, directories, redirects, or cPanel settings.

## Cache busting

Every changed root page references shared assets with the release query string
`v=20260808s21rc1`. After upload, purge only affected CDN/cache paths if a CDN
is enabled, then use a private window or hard refresh. Do not rename the files.

## Post-upload smoke tests

- Open `/`, `/products.html`, `/companies.html`, `/tenders.html`,
  `/matchmaking.html`, `/portal.html`, and `/admin.html`.
- Confirm the global labels are Marketplace, Products, Companies, Tenders, and
  Matchmaking; Tenders must open `/tenders.html`, never `/#tenders`.
- Confirm `companies.html` shows the Company Directory and retains all eligible
  company types.
- At 320, 360, 390, 414, 768, 900, 1024, 1100, 1280, and 1440 pixels, confirm
  no header overlap, clipping, or page-level horizontal scrolling.
- Signed out: search/filter public tenders; private match data must not appear.
- Signed in: confirm login redirects into the portal, Messages opens, account
  state persists, and Tenders can return to the authenticated workspace.
- In Portal → Universal Tender Import, confirm history loads without PGRST202,
  Files and Public URL tabs render, and no raw backend error is shown.
- Confirm Products, favorites, comparison, company following, RFQ, messaging,
  Matchmaking, meetings, and admin/analytics entry points still load.
- Confirm no browser console error references a missing local release asset.

## Rollback

The `rollback-f843cf7/` directory contains the exact prior committed versions
of the 15 overwritten files from commit
`f843cf7e8519209f6b9d801865e098fd6a278f51`.

1. Upload all 15 rollback files to their same `public_html` destinations.
2. Delete only the two Sprint 2.1 additions, `public_html/tenders.html` and
   `public_html/tenders.js`, after confirming the timestamped backup exists.
3. Purge the same limited caches and repeat the smoke tests.
4. Keep the forward-only production database migration and functions in place;
   the prior frontend does not call the import contract. Do not attempt to
   reverse the production migration as part of a frontend rollback.

`REMOVE_ON_ROLLBACK.txt` repeats the only two removal targets. The rollback
files and their hashes are listed in `SHA256SUMS.txt`.

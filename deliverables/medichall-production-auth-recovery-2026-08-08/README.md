# MedicHall production auth recovery — cPanel release

Release date: 2026-08-08  
Source branch: `react-migration`  
Source commit: `c071274cf4dbf43a7ba49109cda643530b4b0a16`  
Cache version: `20260808s2auth3`

This is the complete canonical frontend upload set for the production auth,
admin, Messages, analytics, marketplace, mobile-navigation, and notification
recovery. Upload all 15 files. Every destination is directly inside
`public_html`; do not create an additional package subdirectory.

The archive deliberately excludes the four temporary hotfix files. The root
pages do not reference them, and they must not be substituted for any file in
this package.

## Exact upload manifest

| Order | Repository/package file | cPanel destination | Purpose | Size (bytes) | SHA-256 | Required |
|---:|---|---|---|---:|---|---|
| 1 | `medichall-design-system.css` | `public_html/medichall-design-system.css` | Shared responsive design, mobile menu, notifications, accessibility | 27,936 | `b5aa09b81c3b7f72409ad7708f1927b849f6401695ef8cd3c75b643ddc977975` | Yes |
| 2 | `medichall-session.js` | `public_html/medichall-session.js` | Canonical login, refresh, retry, and logout session helper | 7,531 | `1e60bdce3d2caff5953e6b72516786b350a395a719f05bfa80c5aa1a97806620` | Yes |
| 3 | `medichall-navigation.js` | `public_html/medichall-navigation.js` | Shared navigation, mobile auth state, Messages route, notifications | 26,525 | `416ef356bd0af444c2c519798d3d1d809e6bd39187e205e59f12669c94ba5da0` | Yes |
| 4 | `marketplace-enterprise.css` | `public_html/marketplace-enterprise.css` | Product catalog and Company Directory layouts | 14,551 | `41b9c919d97ff6cfba0fbe59ac8d8e0710d48ad2f6228c8373ba8ca431ebe709` | Yes |
| 5 | `marketplace-domain.js` | `public_html/marketplace-domain.js` | Shared marketplace normalization, filtering, recommendation, comparison | 15,531 | `c796059b822acc321986fbdabc7adafbd19d900be53d2f8c80ed5a130794dde8` | Yes |
| 6 | `marketplace-products.js` | `public_html/marketplace-products.js` | Product discovery, favorites, comparison, RFQ flow | 41,271 | `64e8c1e18a1afab921db4a3bdec27879c7d111c3981232ef1ddac3f8b594801f` | Yes |
| 7 | `marketplace-companies.js` | `public_html/marketplace-companies.js` | Mixed-role Company Directory, company detail, follow flow | 15,162 | `bbd9574eede03a6b9a7445d5f95e271d1deeb3c021d34dcfe550d1a1d8930e20` | Yes |
| 8 | `matchmaking-domain.js` | `public_html/matchmaking-domain.js` | Shared matchmaking scoring and lifecycle domain logic | 11,229 | `28d60beaa59ebbc9cbc9ec8fb76113c5059bf3952db434424a53acee9dc47501` | Yes |
| 9 | `matchmaking-workspace.js` | `public_html/matchmaking-workspace.js` | Standalone Matchmaking Workspace behavior | 65,383 | `98aa1b460da0e45806fb379e5a98208a7d16bbb2760345670d685610cc8e5381` | Yes |
| 10 | `admin.html` | `public_html/admin.html` | Protected administrative console | 58,451 | `940eee5a096d3192072e0382ab20c17c647155326401b5f79ca6d699ab69ba66` | Yes |
| 11 | `portal.html` | `public_html/portal.html` | Authenticated partner portal, Messages, analytics, embedded matchmaking | 334,362 | `e3b194110c01f4aab84a5dd92486e87b92b0b74e402bfca0e9ee1814bc3bec21` | Yes |
| 12 | `matchmaking.html` | `public_html/matchmaking.html` | Standalone Matchmaking Workspace | 20,940 | `808892c8e6517f4541f616320801410e8ec974db01687f7f210c02807911aa51` | Yes |
| 13 | `companies.html` | `public_html/companies.html` | Company Directory for manufacturers, buyers, distributors, suppliers, and other eligible company roles | 59,241 | `72fa841a2da5cb561811b0650f17222384371c78adcdc129bf78ba64941d1e9d` | Yes |
| 14 | `products.html` | `public_html/products.html` | Product catalog across eligible approved companies | 65,750 | `ea155a3790ade49ccde9bcaf21b17dad94353921101483bc2f7dd491f8c644b3` | Yes |
| 15 | `index.html` | `public_html/index.html` | Public marketplace home and global discovery | 105,063 | `0a435892c5a9aad4e8576f5f0fbd5e8fe8599d788e5df79b35b220138191e795` | Yes |

There is no separate `manufacturers.html` in this release. `companies.html` is
the mixed-role Company Directory and must keep that exact filename.

## Backup and upload

1. In cPanel File Manager, open `public_html` and make a dated backup copy of
   every destination listed above before replacing anything.
2. Keep the previously preserved full production baseline archive until the
   smoke test is complete.
3. Extract this ZIP locally. Do not upload the ZIP as a nested directory.
4. Upload files in manifest order, choosing overwrite for each exact target.
5. Confirm the cPanel file sizes and, where the interface permits, SHA-256
   values against this manifest and `SHA256SUMS.txt`.
6. Purge the cPanel/server cache and any CDN cache. The HTML uses the coherent
   `20260808s2auth3` query version, but an explicit purge prevents an old HTML
   document from requesting mixed asset versions.
7. Test in a private browser window first, then hard-refresh the normal browser.

## Post-upload smoke test

- Open `/`, `/products.html`, `/companies.html`, `/matchmaking.html`,
  `/portal.html`, and `/admin.html`; confirm there are no 404 or JavaScript
  errors and the desktop navigation labels match each page.
- At 320, 360, 390, and 414px, open and close the mobile menu; confirm there are
  no duplicated actions or horizontal overflow.
- Log in through `portal.html`; confirm it redirects to the portal main view,
  remains signed in after hard refresh, and the MedicHall logo does not act as
  the only way to enter the portal.
- Open Messages from the shared navigation and from Matchmaking; confirm both
  route to `portal.html#inbox` and a signed-out user returns to the requested
  destination after login.
- On Products, confirm filters, product cards, details, favorites, comparison,
  company links, and RFQ recipient selection work.
- On Company Directory, confirm mixed company roles appear, company details
  load, and Follow persists after refresh.
- Confirm notification badge/cards open the correct portal destination and the
  panel stays inside the viewport on phone, tablet, and desktop.
- For Admin, verify invalid credentials, authenticated non-admin denial,
  authorized admin access, refresh persistence, and logout protection remain
  distinct.
- Confirm analytics show `0` for valid zero-valued metrics instead of an error
  or indefinite loading state.
- Sign out, hard-refresh every root page, and confirm no authenticated data is
  visible.

## Rollback

If any smoke test fails, restore all 15 backed-up production files as one set,
purge server/CDN caches again, and repeat the signed-out and login smoke tests.
Do not roll back the already validated Sprint 2 database migration merely to
restore these frontend files. Preserve browser console/network evidence and
the failed release hashes for diagnosis.

# MedicHall medical taxonomy cPanel patch

This is a minimal manual patch for `public_html`. It contains only the root
frontend files required by Medical Product Taxonomy v1. It does not contain
Supabase migrations, Edge Functions, credentials, customer data, temporary
files, or unrelated pages. Cache identifier: `20260811tax1`.

Do not upload this patch until the release status is cleared. The database
migration is live, but the related `tender-document-engine` revision still
requires explicit production-deployment approval.

## Upload manifest

Upload in this order. Every file is required and its destination is the file
with the same name directly under `/public_html/`.

| Order | Repository / ZIP path | cPanel destination | Bytes | SHA-256 |
|---:|---|---|---:|---|
| 1 | `cpanel-upload/medichall-taxonomy.css` | `/public_html/medichall-taxonomy.css` | 5,765 | `11fd241fee974524ea7fafeba4f93949482327f043d2117801ec3e8399d59f41` |
| 2 | `cpanel-upload/medichall-taxonomy.js` | `/public_html/medichall-taxonomy.js` | 13,736 | `273eab73dcf5544e1df3626b4a166324a1393c743e0265be03a83fe32d331a61` |
| 3 | `cpanel-upload/medichall-taxonomy-admin.js` | `/public_html/medichall-taxonomy-admin.js` | 13,343 | `7676045d00bb49efac50600801d5dc2d8af5441b0afafa668ed927df6ec84b2f` |
| 4 | `cpanel-upload/marketplace-domain.js` | `/public_html/marketplace-domain.js` | 16,559 | `7638d5525bb15b01097c9a3d96ef0c0682fc650b3791d13f215063b2a4bd2fd5` |
| 5 | `cpanel-upload/marketplace-products.js` | `/public_html/marketplace-products.js` | 44,018 | `3f4023cbe964de987229a9f433fdb4c2d8c895d2b7d3f53b3a1b7594cc6dda27` |
| 6 | `cpanel-upload/marketplace-companies.js` | `/public_html/marketplace-companies.js` | 16,671 | `d1222aafe95fdc0a47e54509df2ed97c180709e04d610b8d28a04c63a25ce6a8` |
| 7 | `cpanel-upload/matchmaking-workspace.js` | `/public_html/matchmaking-workspace.js` | 68,147 | `d156d6a08ae77376c27740f5a44e91ed810d2846e85046bb394555dabe28e228` |
| 8 | `cpanel-upload/products.html` | `/public_html/products.html` | 56,683 | `ef2f9dbb631a24db7e5e6be6bc431242b6b8f50fdf53b103cc82f9c418a712fe` |
| 9 | `cpanel-upload/companies.html` | `/public_html/companies.html` | 50,309 | `9593bf56f54a57895bbf4a3b28eac52258c637f01c6f8e0a040fb89bea3ea507` |
| 10 | `cpanel-upload/matchmaking.html` | `/public_html/matchmaking.html` | 21,473 | `5de610d096a80f77a50a8f1d1bf1934879a2f8a6c9200476e76d2664b8b90e43` |
| 11 | `cpanel-upload/portal.html` | `/public_html/portal.html` | 373,228 | `986c47479f7aa279f6d44707684a2da9c48336e73a7e7e5c0f3180ad9e34bbd5` |
| 12 | `cpanel-upload/admin.html` | `/public_html/admin.html` | 70,255 | `57335e149bfd1b188152f4714a5f41a023a10e5d162ff0969a85d2fb18ffcc77` |

`index.html`, `tenders.html`, shared session/navigation/design-system files, and
all other root pages are unchanged and must not be replaced for this patch.

## Backup and rollback

1. Before uploading, create a timestamped cPanel backup directory outside the
   public web root and copy the existing 12 destination files into it. A missing
   destination for one of the three new taxonomy assets is expected; record it
   as absent.
2. Upload assets 1–7 first, then pages 8–12. Allow overwrite only for the exact
   destinations in the manifest.
3. Verify the uploaded byte sizes and SHA-256 values in cPanel or SSH.
4. To roll back, restore the nine previously existing files from the timestamped
   backup and remove only the three newly added taxonomy assets if they did not
   exist before the release.
5. Database rollback is not part of this cPanel procedure. The additive schema
   may safely remain unused while the previous frontend is restored.

## Cache and smoke test

After upload, purge any cPanel/CDN cache for the 12 paths and hard-refresh the
browser. Confirm network requests use `?v=20260811tax1` where present.

- At 390 px and 1440 px, verify Products and Company Directory load without
  horizontal overflow and retain mixed manufacturer/buyer/distributor behavior.
- Log in and confirm portal routing, session persistence, Messages, RFQs,
  notifications, meetings, and existing Tender Intelligence still load.
- Create/edit a product and confirm the searchable taxonomy selector preserves
  the commercial name and legacy category while saving a canonical category.
- In matchmaking profile setup, select multiple categories, remove a chip, use
  an entire family, and verify keyboard navigation and the custom-term fallback.
- Confirm match explanations show taxonomy evidence and broad-family wording.
- In Admin, confirm Taxonomy is visible only to an authorized admin and normal
  users cannot mutate canonical nodes or aliases.
- Confirm Products and Company Directory each perform one bulk taxonomy mapping
  fetch rather than per-card requests.
- Confirm the browser console has no uncaught errors and no secret-bearing
  responses.

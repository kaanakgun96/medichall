# MedicHall product-detail scroll hotfix

Minimal manual cPanel patch for the `products.html` product-detail dialog.
Cache identifier: `20260811scroll1`.

This package contains only three required frontend files. It contains no
backend, Supabase, taxonomy, matchmaking, RFQ, authentication, notification,
credential, product-data, or unrelated-page changes.

## Upload manifest

Upload in this exact order. Each destination is directly under `public_html`.

| Order | Required file | cPanel destination | Bytes | SHA-256 |
|---:|---|---|---:|---|
| 1 | `cpanel-upload/marketplace-enterprise.css` | `/public_html/marketplace-enterprise.css` | 15,369 | `24a131150fb1daa7e10f461cde6645920444701775bd7f11f03e1d15006186ff` |
| 2 | `cpanel-upload/marketplace-products.js` | `/public_html/marketplace-products.js` | 44,887 | `40d03183cfa7a4bc5d1a6a63fe188218679b320484d65985bed1d32dce6b50bd` |
| 3 | `cpanel-upload/products.html` | `/public_html/products.html` | 56,710 | `a2c01a29d40ac50332b9f5b0144f78b5e8a5a319403af3bafe95e82c21f01552` |

No other root page or shared asset is required.

## Backup and rollback

1. Before upload, copy the current three destination files into a timestamped
   backup directory outside `public_html`.
2. Upload the CSS, then JavaScript, then HTML. Overwrite only the three exact
   destinations above.
3. Verify each uploaded file's byte size and SHA-256.
4. Purge any CDN/cPanel cache for the three paths and hard-refresh the browser.
5. To roll back, restore the same three files from the timestamped backup and
   purge those cache paths again.

## Post-upload smoke test

- Open a product at 390px and 1440px and confirm the detail content scrolls to
  Similar products while the page behind it stays fixed.
- Confirm the close button remains visible at the bottom of the scroll range.
- Confirm there is no horizontal or double scrollbar.
- Confirm Escape closes the dialog and returns focus to View details.
- Confirm Request quotation opens, and Save, Add to compare, company profile,
  image, Downloads, and Similar products remain present.
- Open and close multiple products sequentially and check for console errors.

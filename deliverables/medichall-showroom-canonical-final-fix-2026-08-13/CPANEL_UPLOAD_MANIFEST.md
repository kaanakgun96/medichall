# cPanel upload manifest — showroom canonical final fix

- Destination root: `public_html`
- ZIP: `medichall-showroom-canonical-final-fix-2026-08-13.zip`
- ZIP size: `20,342` bytes
- ZIP SHA-256: `045c1904606071b5e92d7f9ecb66b2512ad3feff351f22ba3e759083c4adb561`
- Cache identifier: `20260813seo2`

The ZIP contains only these two required files at its archive root:

| Order | Repository path | cPanel destination | Bytes | SHA-256 | Required |
|---:|---|---|---:|---|---|
| 1 | `marketplace-companies.js` | `public_html/marketplace-companies.js` | 19,572 | `99f6fc33d8921f644800aacab855e372bc378c458e28ce2b006fa5522e177b15` | Yes |
| 2 | `companies.html` | `public_html/companies.html` | 53,310 | `b17042d9250a9a0637e682ca4150e4e7bfa3acbea57c71c73118c6107cb73920` | Yes |

## Backup and upload

1. Create a timestamped directory outside `public_html`.
2. Back up the current `public_html/marketplace-companies.js` and `public_html/companies.html`.
3. Upload `marketplace-companies.js` first.
4. Upload `companies.html` second so browsers request `marketplace-companies.js?v=20260813seo2` only after the new controller is present.
5. Verify production byte sizes and SHA-256 values where cPanel permits.
6. Purge only `/marketplace-companies.js`, `/companies`, `/companies.html` and `/m/*` cache entries.

## Rollback

Restore `companies.html` first and `marketplace-companies.js` second from the timestamped backup, purge the same bounded cache entries, then recheck the directory and four showroom URLs. No backend rollback is involved.

## Post-upload smoke test

- Confirm `/companies` stays the mixed Company Directory and canonicalizes to `https://medichall.com/companies`.
- Confirm `/m/4a-medical`, `/m/dispack-medical`, `/m/grup-a-medical` and `/m/medibant-medikal` return HTTP 200 and show the correct company.
- As soon as each company name is visible, confirm its self-canonical, company title/description, Open Graph values and public `Organization` JSON-LD are already present.
- Wait for products/catalogues to settle and confirm no later script resets those values.
- Confirm the intended company logo or `/og-cover.png` loads, no showroom is `noindex`, and no private fields appear in metadata/schema.
- Confirm the browser loads `marketplace-companies.js?v=20260813seo2` and reports no new console error.

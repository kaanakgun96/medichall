# cPanel upload manifest — Sprint 7 SEO hotfix

Upload destination: `public_html`

- ZIP: `medichall-sprint7-seo-hotfix-2026-08-13.zip`
- ZIP size: `787,523` bytes
- ZIP SHA-256: `5a5385be7d7431d30ae219cefac81e79111585d25adba83b750945c83c3bb457`
- Bounded cache identifier: `20260813seo1`

The ZIP contains only the two required production files at its archive root.

| Order | Repository path | cPanel destination | Purpose | Bytes | SHA-256 | Required |
|---:|---|---|---|---:|---|---|
| 1 | `og-cover.png` | `public_html/og-cover.png` | Missing 1200×630 MedicHall social card used by public SEO metadata | 772,914 | `08accb95d667cbe3d64468ec79da42b6386b0989aa369c9dc612240de873ef23` | Yes |
| 2 | `companies.html` | `public_html/companies.html` | Bounded cache refresh for the existing showroom metadata controller | 53,238 | `3e08a4027eabfc116cdb3142e731473795494f74cf60503d9d2529490f20e465` | Yes |

## Backup

1. Create a timestamped backup directory outside `public_html`, such as `medichall-backup-before-seo-hotfix-20260813`.
2. Copy the current `public_html/companies.html` into it and record its size/hash if cPanel provides them.
3. Check whether `public_html/og-cover.png` exists. Production previously returned 404, so record it as absent unless the state has changed; if it now exists, back it up too.
4. Download or archive the backup directory before overwriting anything.

## Upload

1. Upload the ZIP to a temporary cPanel directory, inspect that it contains exactly the two manifest files, and extract it.
2. Copy `og-cover.png` into `public_html` first.
3. Copy `companies.html` into `public_html` second.
4. Verify the production sizes and SHA-256 values above where cPanel permits it.
5. Purge only the affected `/og-cover.png`, `/companies`, `/companies.html` and `/m/*` cache entries. Do not globally rename or bump other assets.

## Rollback

1. Restore the backed-up `companies.html`.
2. Restore the prior `og-cover.png`, or delete only the newly uploaded image if the backup record proves that path was absent.
3. Purge only the affected cache entries.
4. Recheck the Company Directory, all four showroom URLs and the existing marketplace/auth smoke tests.

## Post-upload smoke test

- Confirm `https://medichall.com/og-cover.png` returns HTTP 200, `image/png`, 1200×630.
- Confirm homepage, Products, Companies, Tenders and all five Sprint 7 landing pages still reference the working social card.
- In a fresh/private browser context, confirm the Network panel loads `marketplace-companies.js?v=20260813seo1` once.
- Confirm `/m/4a-medical`, `/m/dispack-medical`, `/m/grup-a-medical` and `/m/medibant-medikal` each return HTTP 200 and, after normal runtime initialization, use a self-canonical URL, company-specific title/description/OG values and public `Organization` JSON-LD.
- Confirm `/companies` remains the mixed Company Directory, self-canonical, and still includes manufacturers, distributors, suppliers, buyers and other roles.
- Confirm no showroom is `noindex`; `portal`, `admin` and `matchmaking` remain `noindex,nofollow`.
- Check 390 px and 1440 px for horizontal overflow on the homepage, Company Directory and all four showrooms.
- Confirm Products and Tenders load, signed-out Matchmaking shows its login boundary, and product detail content still scrolls to the bottom.
- Confirm there is no new console error and no provider, AI, email or analytics request caused by this patch.

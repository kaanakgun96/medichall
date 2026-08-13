# MedicHall Sprint 7 cPanel release

This package contains only the 20 production web-root artifacts required for Sprint 7. It contains no backend source, migration, credential, local output or unrelated deliverable. Codex did not upload it to cPanel.

## Upload

Back up every existing destination to a timestamped directory outside `public_html`, and record which new landing/assets were absent. Upload the **contents** of `UPLOAD_TO_PUBLIC_HTML` directly into `public_html`; do not upload the wrapper directory.

Upload order:

1. `medichall-logo.svg`
2. `medichall-growth.css`
3. `medichall-traffic.js`
4. `marketplace-companies.js`
5. `marketplace-products.js`
6. `matchmaking-workspace.js`
7. `medical-device-tenders.html`
8. `ai-tender-intelligence.html`
9. `find-medical-device-distributors.html`
10. `medical-device-b2b-marketplace.html`
11. `ai-medical-device-matchmaking.html`
12. `index.html`
13. `products.html`
14. `companies.html`
15. `tenders.html`
16. `matchmaking.html`
17. `portal.html`
18. `admin.html`
19. `robots.txt`
20. `sitemap.xml`

All files are required. Verify them against `SHA256SUMS.txt`. Purge only affected cache entries; release identifier `20260813growth1` is already embedded where required.

## Smoke test

- Confirm homepage, products, mixed company directory, tenders and all five new landing URLs return 200 with clean canonicals.
- Confirm portal, admin and matchmaking remain `noindex,nofollow`.
- Confirm `robots.txt` and `sitemap.xml` return 200.
- Test login/session recovery, product detail/RFQ, company showroom, tender official-source link, matchmaking connection, meeting scheduling, secure video and Admin Growth.
- Test 390 px and 1440 px for overflow, keyboard focus and console errors.

## Rollback

At the first material regression, restore existing files from the backup in reverse order, remove only files recorded as newly introduced, purge affected caches and repeat the core smoke test. Do not alter Supabase migration history; any backend rollback requires a separately reviewed forward-only migration.

# MedicHall Sprint 2 cPanel package

This directory contains complete replacement files for a manual cPanel upload.
Nothing in this package has been deployed automatically.

Prerequisite: deploy and validate only
`supabase/migrations/202608020001_enterprise_marketplace.sql` through the normal
reviewed database process before publishing the frontend.

Upload to `public_html` in this order:

1. `medichall-design-system.css`
2. `marketplace-enterprise.css`
3. `marketplace-domain.js`
4. `marketplace-products.js`
5. `marketplace-companies.js`
6. `medichall-navigation.js`
7. `index.html`
8. `products.html`
9. `companies.html`
10. `matchmaking.html`
11. `admin.html`
12. `portal.html` (last)

Use the filenames exactly as supplied. `companies.html` is the mixed Company
Directory; there is no `manufacturers.html`. Verify every artifact against
`SHA256SUMS.txt`. Full backup, rollback and smoke-test instructions are in
`docs/enterprise-marketplace-sprint-2-2026-08-02.md`.

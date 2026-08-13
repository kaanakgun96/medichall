# MedicHall Sprint 7 SEO acceptance hotfix

This is the minimal two-file cPanel patch for the approved Sprint 7 SEO acceptance defects. Codex did not upload it to cPanel and made no backend or production-data change.

The upload ZIP is `deliverables/medichall-sprint7-seo-hotfix-2026-08-13.zip`. Its archive root contains only `og-cover.png` and `companies.html`; upload both directly to `public_html` in the order in `CPANEL_UPLOAD_MANIFEST.md`.

`marketplace-companies.js` is deliberately excluded. The production copy already contains the verified showroom metadata controller; the patched `companies.html` changes only that controller's cache identifier from `20260811tax1` to the bounded hotfix identifier `20260813seo1`.

The current repository contains no cPanel rewrite file, route template, static per-company page or server-rendering path capable of safely emitting slug-specific initial HTML for `/m/<slug>`. After the patch, every approved showroom receives correct company-specific metadata and `Organization` JSON-LD when the existing public showroom runtime initializes. The initial static response remains the generic Company Directory shell. A separately reviewed static pre-render or route-aware server solution is the future improvement; it is intentionally outside this hotfix.

The unchanged known SEO follow-ups are dynamic catalog initial-HTML thinness (MEDIUM) and 18 internal `.html` links that redirect to clean URLs (LOW).

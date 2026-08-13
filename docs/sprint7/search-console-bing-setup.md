# Google Search Console and Bing Webmaster readiness

No external account was accessed or created during Sprint 7.

## Implemented by code

- canonical public URLs;
- public/private indexation policy;
- production `robots.txt` with sitemap reference;
- canonical XML sitemap without fabricated priority/change frequency;
- structured metadata and public landing pages;
- correct 404 behavior already present in production.

Sitemap URL: `https://medichall.com/sitemap.xml`

## Google Search Console — founder action

1. Open https://search.google.com/search-console/ in the Google account that should own MedicHall search data.
2. Add a Domain property for `medichall.com` (recommended) and copy the TXT verification value.
3. Add that TXT value at the DNS provider. Do not paste it into the repository.
4. Complete verification in Search Console.
5. Open Sitemaps and submit `https://medichall.com/sitemap.xml`.
6. Use URL Inspection for `/`, `/products`, `/companies`, `/tenders` and each Sprint 7 landing page.
7. Confirm the inspected canonical equals the declared clean canonical.
8. Request indexing only after the cPanel package is uploaded and the public smoke tests pass.
9. Review Pages, Core Web Vitals, HTTPS and manual-action/security reports weekly during the Open Beta launch.

HTML-file verification is a fallback. Keep any verification filename outside shared application code and include it in the cPanel backup/manifest. Meta-tag verification is acceptable on the homepage but DNS avoids coupling ownership to a deploy artifact.

## Bing Webmaster Tools — founder action

1. Open https://www.bing.com/webmasters/ with the account that should own the property.
2. Import the verified Search Console property where appropriate, or add `https://medichall.com` manually.
3. Prefer DNS verification; keep the value outside the repository.
4. Submit `https://medichall.com/sitemap.xml`.
5. Inspect representative canonical URLs and review crawl/index coverage.

## Verification checklist after upload

- `curl -I https://medichall.com/robots.txt` returns 200 and `text/plain`.
- `curl -I https://medichall.com/sitemap.xml` returns 200 and XML.
- every sitemap URL returns 200 with no multi-hop redirect;
- no portal/admin/login/private query URL appears in the sitemap;
- view-source contains the canonical and meaningful content before API data;
- product/tender query states point to the collection canonical;
- `/portal`, `/admin` and `/matchmaking` retain `noindex,nofollow`;
- official tender-source links remain visible.

References:

- https://support.google.com/webmasters/answer/10351509
- https://support.google.com/webmasters/answer/9012289
- https://www.bing.com/webmasters/help/Sitemaps-3b5cf6ed
- https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b

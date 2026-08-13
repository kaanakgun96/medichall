# Sprint 7 founder action checklist

## Before cPanel upload

- [ ] Review all five public landing pages for business wording.
- [ ] Confirm the selected AI-crawler policy: allow search discovery via OAI-SearchBot; disallow GPTBot training.
- [ ] Approve the public company showroom sitemap entries.
- [ ] Take a complete cPanel backup of every destination listed in the release manifest.
- [ ] Confirm the backend migration and `traffic-analytics` deployment status in the final report.

## Immediately after cPanel upload

- [ ] Purge cPanel/CDN cache only for changed files; hard refresh once.
- [ ] Run the supplied public smoke checklist at 390 px and desktop.
- [ ] Confirm auth, RFQ, matchmaking, tender and product detail regressions remain green.
- [ ] Confirm `robots.txt` and `sitemap.xml` return 200.
- [ ] Confirm every sitemap URL returns the intended canonical.

## Search services

- [ ] Verify the `medichall.com` Domain property in Google Search Console using DNS TXT.
- [ ] Submit `https://medichall.com/sitemap.xml`.
- [ ] Inspect the homepage, three catalogs and five landing pages.
- [ ] Add/import MedicHall in Bing Webmaster Tools and submit the same sitemap.
- [ ] Do not claim indexing is complete until the service reports it.

## Trust and content ownership

- [ ] Reconcile the production-only `/blog/` source into version control before editing it.
- [ ] Correct the blog navigation label from “Manufacturers” to “Companies” after reconciliation.
- [ ] Publish a factual About/team page with only real names, roles and credentials.
- [ ] Verify Privacy and Terms links are consistently available.
- [ ] Add real organization social URLs to schema only after ownership is confirmed.

## Acquisition activation

- [ ] Review and approve the LinkedIn sequence; publish manually.
- [ ] Review PR targets and send personal, non-automated pitches only when the story fits.
- [ ] Do not buy placement or publish paid ads during this Sprint 7 handoff.
- [ ] Allow at least two weeks of organic and referral data before judging a channel.
- [ ] Evaluate future Google Ads only after conversion events are visible and a maximum test budget is approved.

## Weekly Open Beta review

- [ ] Search Console coverage, queries and Core Web Vitals.
- [ ] Bing crawl/index coverage.
- [ ] traffic source → sign-up → activation → useful action.
- [ ] tender/source attribution integrity.
- [ ] broken links and expired public tender handling.
- [ ] real partner feedback; no fabricated testimonials or usage claims.

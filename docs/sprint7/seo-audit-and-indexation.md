# MedicHall Sprint 7 SEO audit and indexation architecture

Audit date: 2026-08-13
Production audited: `https://medichall.com`
Branch baseline: `react-migration` at `c4975cb15d3db3ff81807de454310cd6d80966e2`

## Executive assessment before Sprint 7 changes

The public site was crawlable and the homepage already communicated the core product well, but search discovery was concentrated on one URL. Google returned the homepage for a site query while the principal public catalogs lacked canonical, Open Graph, Twitter and structured-data signals. The sitemap omitted the tender catalog and all public company showrooms. The live robots file allowed everything but did not reference the sitemap or state an AI-crawler policy.

Private product areas remained correctly protected by authentication and the portal, admin and matchmaking workspace carried `noindex,nofollow`. Robots directives were not treated as authorization.

## Before-change production evidence

| Surface | HTTP/rendering | Metadata before Sprint 7 | Indexation decision |
|---|---|---|---|
| `/` | 200, rich initial HTML | canonical, OG/Twitter, Organization + WebSite JSON-LD | Index |
| `/products` | one redirect from `.html`, then 200 | description only; no canonical, OG/Twitter or JSON-LD | Index listing only |
| `/companies` | one redirect from `.html`, then 200 | description only; no canonical, OG/Twitter or JSON-LD | Index directory |
| `/m/<slug>` | 200, dynamic public showroom | dynamic title only; generic/no canonical, OG or JSON-LD | Index only approved, useful public profiles |
| `/tenders` | one redirect from `.html`, then 200 | explicit index/follow; no canonical, OG/Twitter or JSON-LD | Index public discovery |
| product query state | 200 modal state | parameter URL; listing canonical absent | Keep canonical on `/products`; no separate product URL yet |
| tender query state | 200 application state | parameter URL; public list architecture | Keep canonical on `/tenders`; design clean entity routes before indexing |
| `/matchmaking` | 200 | `noindex,nofollow` | Do not index private workspace |
| `/portal`, `/admin` | 200 shell/auth boundary | `noindex,nofollow` | Do not index |
| `/blog/` | 200, production-only source | canonical + basic OG; no OG image/Twitter | Index; source must be reconciled into repository before editing |
| sourcing guide | 200, strong initial article HTML | canonical, article OG image, Article + FAQ JSON-LD | Index |
| unknown route | 404 | correct server response | Keep |

The production-only blog navigation labels the mixed company directory “Manufacturers”. The repository has no `blog/` source, so Sprint 7 does not overwrite that cPanel-only content. Reconcile the exact blog source before changing its navigation.

## Severity classification

### BLOCKER

- The repository had no deployable `robots.txt`; production had no sitemap reference or private/AI policy.
- The sitemap omitted `/tenders`, public showrooms and every acquisition landing page.
- Products, companies and tenders lacked canonical/social/structured metadata.

### HIGH

- No distinct search-intent pages existed for medical tenders, Tender Intelligence, distributor discovery, medical B2B marketplace or medical matchmaking.
- Query parameters carried public detail state without a proven clean canonical entity route.
- Public company showroom metadata did not change with the selected company.
- No source-attributed acquisition events connected traffic to activation or useful actions.

### MEDIUM

- Catalog content is populated by JavaScript; initial HTML was much thinner than the homepage.
- Homepage Google Fonts preconnects were duplicated.
- Production blog source is absent from the repository and its navigation says “Manufacturers” for a mixed directory.
- Core Web Vitals has no reliable field baseline yet; the tracker only went live on 2026-08-13.

### LOW

- Public header/footer links use a mixture of `.html` and clean URLs. Production redirects work, but internal links should converge gradually on clean canonical URLs.
- Several pages repeat embedded CSS. Consolidation is a later performance task, not a reason to risk the stable application in Sprint 7.

## Implemented indexation policy

Index:

- `/`
- `/products`
- `/companies`
- `/tenders`
- the five Sprint 7 search-intent pages
- approved public company showrooms listed in the sitemap
- `/blog/` and its useful sourcing guide

Do not index:

- portal, login/account, messages, RFQs and private operational states
- admin
- private matchmaking workspace
- private tender intelligence, evidence, imported documents and Ask MedicHall conversations
- duplicate query/hash states
- individual product/tender states until a stable, server-compatible canonical entity route exists

## URL architecture

Production Apache currently resolves clean root paths and clean `/m/<slug>` showrooms. Sprint 7 preserves all old links. Canonicals use clean public URLs. Product and tender query states canonicalize to their collection page rather than pretending that a modal/query state is a stable indexable entity.

Phase 2, only after cPanel rewrite proof:

1. Define immutable product and tender public identifiers.
2. Render meaningful public facts in initial HTML or a crawler-reliable server response.
3. Add one-way redirects from legacy query states.
4. Add `Product` schema only to substantive public product entities.
5. Add tender entity pages only when official-source attribution and expiry handling are complete.

## Structured data

Implemented only where the visible content supports it:

- Organization + WebSite on homepage, using the real MedicHall mark/wordmark asset.
- CollectionPage + BreadcrumbList for public catalogs.
- WebPage + BreadcrumbList + FAQPage for landing pages with matching visible FAQs.
- Dynamic Organization for a selected public company showroom, using public company fields only.

Not implemented: fake ratings, reviews, prices, customer counts, social profiles or arbitrary Product schema.

## Robots and AI-crawler policy

Public search crawling is allowed. Portal/admin/application bundle paths are excluded to reduce irrelevant crawling; authentication remains the actual boundary. The policy permits `OAI-SearchBot`, which controls inclusion in ChatGPT search surfaces, while disallowing `GPTBot`, which controls potential training use. These controls are independent according to OpenAI’s crawler documentation. This is a product policy, not legal advice, and should be reviewed by the founder periodically.

## Performance and Core Web Vitals

Observed risks:

- Google Fonts are render-path dependencies; `font-display=swap` is present.
- Catalog data and images arrive after JavaScript/API work, making catalog LCP sensitive to network conditions.
- Product imagery is company supplied; lazy loading and fixed aspect-ratio containers reduce CLS, but oversized remote files remain possible.
- Root pages contain substantial embedded CSS and repeated shared libraries.
- No unnecessary analytics third party was added; the first-party tracker is best effort, payload bounded and non-blocking.

Sprint 7 removes duplicate homepage font preconnects, keeps fixed media geometry and adds lightweight static landing pages. It does not sacrifice product behavior for a synthetic score. Field LCP/INP/CLS must be assessed in Search Console after sufficient traffic. Google’s current “good” targets are LCP within 2.5 s, INP below 200 ms and CLS below 0.1.

## Accessibility

The new public pages use one H1, breadcrumb navigation, header/main/footer landmarks, visible text labels, native details/summary FAQs, keyboard-operable links and reduced-motion support. Responsive validation targets: 320, 360, 390, 414, 768, 1024 and 1440 px.

## Trust / E-E-A-T

Present: company location, public contact email, Open Beta positioning, official tender-source links, company-supplied evidence labels, privacy/terms links where present, and explicit human-verification boundaries.

Founder gaps:

- publish a factual About/team page without invented credentials;
- ensure current Privacy and Terms pages are linked from every public surface;
- reconcile the production-only blog into version control;
- add real LinkedIn/company social URLs to Organization `sameAs` only after confirming ownership;
- maintain tender source/methodology documentation.

## Analytics baseline

Read-only production snapshot at `2026-08-13T11:34:24Z`:

- reliable from: `2026-08-13T07:41:30.408Z`
- page views: 7
- unique visitors: 2
- sessions: 2
- authenticated views: 0
- acquisition source: direct only
- pages: homepage 4, company showroom 2, product detail 1

Earlier traffic cannot be reconstructed.

## Primary references

- Google crawling/indexing: https://developers.google.com/search/docs/crawling-indexing
- Google sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google robots specification: https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
- Google Core Web Vitals: https://developers.google.com/search/docs/appearance/core-web-vitals
- OpenAI crawler controls: https://developers.openai.com/api/docs/bots
- Bing Webmaster Help: https://www.bing.com/webmasters/help

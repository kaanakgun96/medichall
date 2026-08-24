# Buyer Discovery V2.2 — Public Web Candidate Discovery

## Product contract

Public Web Discovery is a server-side recall source inside MedicHall Buyer
Discovery. It finds potential official company domains. A search result is not
evidence and contributes no relevance score. A prospect can qualify only after
MedicHall independently fetches the official company page and applies the
existing DIRECT / ADJACENT / GENERIC evidence and product-family gates.

Customers remain inside MedicHall. Customer-facing evidence links point to the
official company page, TED notice, or official registry—not to a search result.

## Provider boundary

The Edge Function consumes the `PublicWebDiscoveryProvider` contract. The first
implementation uses Brave Web Search through its official API endpoint. No
consumer search HTML, browser automation, CAPTCHA handling, or fallback SERP
scraping is used.

Required Edge Function configuration:

- `PUBLIC_WEB_DISCOVERY_ENABLED=true`
- `PUBLIC_WEB_PROVIDER=brave`
- `BRAVE_SEARCH_API_KEY` (Supabase Edge Function secret; never client-side)

Optional bounded controls:

- `PUBLIC_WEB_MAX_QUERIES_PER_RUN` (default and hard maximum: `6`)
- `PUBLIC_WEB_MAX_COST_USD_PER_RUN` (default and hard maximum: `0.03`)

The kill switch is `PUBLIC_WEB_DISCOVERY_ENABLED=false`. If the provider is
disabled, unavailable, rate-limited, or misconfigured, TED and registry
discovery continue and the existing partial/limited-source semantics are used.

## Query and request policy

- Only a taxonomy-resolved or approved reviewed product family reaches this
  layer.
- Queries are generated server-side from reviewed aliases and fixed commercial
  templates; customer identity, company name, and email are never included.
- At most six queries and six organic results per query are requested.
- At most 36 raw results and 20 normalized company domains enter verification.
- Calls run with concurrency two, a 6.5-second request timeout, no retry, and a
  circuit breaker for 429/quota and repeated 5xx responses.
- Search snippets are neither scoring evidence nor persisted cache content.

The existing website-verification selection remains six companies/run. Public
Web therefore adds at most six external Search API calls without increasing the
website crawler budget. In the theoretical all-cache-miss/all-source case, the
full pipeline ceiling changes from 28 external requests (six TED, ten registry,
and up to twelve robots/page website requests) to 34. Actual requests are lower
when registry/public-web caches hit or candidates have no official domain.

## Cache and retention

Migration `202608240002_buyer_discovery_public_web.sql` adds the forced-RLS,
service-role-only `external_public_web_request_cache`. Cache keys cover provider,
product-family intent, country, language, and query variant. The table stores
only redacted company name, canonical domain, official page URL, and conservatively
inferred country code.

- successful candidates: 14 days
- zero results: 7 days
- provider unavailability: 15 minutes

The cache stores no raw query, snippet, raw provider response, page content,
personal contact, or credential. Public Web diagnostics remain service-side.
Traffic Analytics receives only existing aggregate Buyer Discovery events.

## Cost model (2026-08-24)

The implementation uses the current Brave Search price of $5 per 1,000 Search
requests ($0.005/request). At the hard six-request ceiling, the worst-case cost
is $0.03 per uncached run before any provider credit.

| Monthly runs | Worst case (0% cache hits) | Example cached case (70% query hits) |
| ---: | ---: | ---: |
| 100 | $3.00 | about $0.90 |
| 1,000 | $30.00 | about $9.00 |
| 10,000 | $300.00 | about $90.00 |

The cached case is an explicit planning assumption, not a production forecast.
Actual cost depends on intent repetition, countries, cache age, outages, and the
provider's current commercial terms. Confirm pricing in the provider dashboard
before production enablement.

## Deployment order (not performed by this change)

1. Store `BRAVE_SEARCH_API_KEY` as a Supabase Edge Function secret without
   pasting it into chat or committing it.
2. Configure the enable/provider flags and bounded controls.
3. Dry-run and apply only migration
   `202608240002_buyer_discovery_public_web.sql`.
4. Run `supabase/tests/buyer_discovery_public_web.sql` rollback-only.
5. Deploy only `external-prospect-discovery`.
6. Run one bounded authenticated Camera Cover QA and clean its run/match data.

No cPanel artifact is required because V2.2 changes no frontend file.

# Traffic Analytics inside Admin Growth

Date: 2026-08-13

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Source-of-truth audit

The existing Admin Growth workspace remains the canonical business analytics
surface. `get_admin_growth_dashboard_v1` still supplies companies, users,
products, RFQs, messages, tender activity, matchmaking, meetings, the
activation funnel, company engagement, and attention segments. None of its
tables, grants, calculations, UI labels, or response fields were replaced.

Before this change, production contained only
`account_activity_heartbeats`, `record_user_activity_v1`, and
`get_admin_growth_dashboard_v1` in the analytics/activity namespace. The
heartbeat is an authenticated user's latest portal activity, not website
traffic. Production had no page-view, visitor, session, UTM, referrer,
country, device, or browser analytics object. Repository search likewise found
no first-party or third-party traffic tracker.

All seven live root HTML artifacts were downloaded from cPanel and matched
the corresponding repository files byte-for-byte before implementation.

## Architecture

`medichall-traffic.js` is the single canonical browser tracker for the public
homepage, products, companies, tenders, matchmaking, the legacy portal, and
the React portal. It records one asynchronous page view on initial load and
one page view for a meaningful normalized internal destination. Product-detail
and portal panel changes use the same tracker. Duplicate initialization,
repeated hashes, resize, visibility changes, and same-route state changes do
not create page views.

The tracker sends one bounded POST to `traffic-analytics` and never retries.
It does not wrap `fetch`, block rendering, change auth storage, refresh a
session, or make a provider call. Failure is deliberately silent and cannot
affect login or product behavior. Global Privacy Control and browser Do Not
Track are respected by not initializing an identifier or sending an event.

The Edge Function:

- allows only MedicHall and explicit localhost development origins;
- accepts exactly eight constrained keys;
- rejects malformed UUIDs, non-canonical routes, raw URLs, sensitive or
  unknown fields, unbounded UTM values, and invalid referrer domains;
- filters obvious crawler, bot, health-check, and uptime-monitor user agents;
- derives coarse device/browser classes from the request user-agent;
- reads country only from Cloudflare's infrastructure-owned `cf-ipcountry`
  header and otherwise records unknown;
- verifies a supplied customer JWT only to classify the view as authenticated
  and never persists the user ID;
- calls a service-only idempotent database RPC;
- emits only safe result flags and redacted error metadata.

## Visitor and session model

The browser stores:

- `mh_traffic_visitor_v1`: a random UUID in first-party local storage;
- `mh_traffic_session_v1`: a random UUID, last-activity timestamp, and bounded
  first-touch attribution in first-party local storage.

No fingerprint, advertising identifier, IP address, name, email, user ID,
company ID, or cross-site identifier is used. Storage failure falls back to an
ephemeral in-memory identifier. A session expires after 30 minutes of
inactivity. The database rejects reuse of an expired session, reuse by another
visitor, and more than 200 page views in one session. The event UUID is unique
and serialized with a transaction advisory lock, making a retry a true no-op.

## Normalized data contract

Routes are an allow-list such as `homepage`, `products`, `product_detail`,
`companies`, `company_showroom`, `tenders`, `matchmaking`, `login`, `signup`,
and purpose-specific portal/React destinations. Product IDs, company IDs,
tender identifiers, searches, query strings, hashes with identifiers, auth
tokens, uploaded URLs, and content fields are not accepted.

The acquisition source is one of Direct, Google, LinkedIn, Bing, Other Search,
Other Referral, or Internal MedicHall. Only a normalized referrer hostname is
retained; paths and query parameters are discarded. UTM source and medium are
limited to 64 characters and campaign to 100 characters using a constrained
character set. Attribution is first-touch per 30-minute session.

Country is an optional two-letter code. Absence of a trustworthy header remains
unknown and is never guessed. Device is Desktop, Mobile, Tablet, or Other;
browser is Chrome, Safari, Edge, Firefox, or Other. These are coarse aggregate
labels, not fingerprint inputs.

## Database and performance

Migration `202608130002_traffic_analytics.sql` adds:

- `traffic_analytics_visitors` — minimal first/last seen and aggregate counters;
- `traffic_analytics_sessions` — 30-minute session and first-touch metadata;
- `traffic_analytics_page_views` — normalized page-view facts;
- `record_traffic_page_view_v1` — service-only validated idempotent ingress;
- `get_admin_traffic_analytics_v1` — admin-only aggregate dashboard RPC;
- `prune_traffic_analytics_v1` — daily 400-day bounded retention;
- `traffic-analytics-retention-v1` — daily 03:17 UTC pg_cron job.

All three tables have forced RLS and no anonymous or authenticated direct
privileges. Raw event history is not exposed in Admin. The dashboard RPC
requires both an authenticated JWT and the existing `is_admin()` registry.

Indexes cover event time, route/time, visitor/time, session/time, country/time,
source/time, session start/last-seen, and visitor session lookup. In a
rollback-only production validation, live, top-page, and source plans used
`traffic_analytics_page_views_occurred_idx`; measured execution was
0.058–0.090 ms for the bounded two-visitor fixture. Event ingress has a 1.5
second statement timeout and the dashboard has a 3 second timeout. The Admin
polls once every 45 seconds only while Traffic Analytics is visible and the tab
is foregrounded. There is no Realtime subscription.

Expected request load is one Edge request and one database RPC per genuine page
view. An authenticated page view also performs one server-side token
verification. One open Admin Traffic tab adds at most 0.022 aggregate requests
per second. At the current low-traffic baseline, this is materially below the
normal application workload.

## Admin experience

The existing Growth overview now has two internal tabs:

- Business metrics — the unchanged Growth dashboard;
- Traffic analytics — active 5/30 minute windows, summary cards, trend, top
  pages, countries, sources, external referrer domains, campaigns, and coarse
  device/browser tables.

Filters are Today, 7 days, 30 days, 90 days, and All time. Live is explicitly
described as a recent page-view window, not an exact open connection count.
Zero, loading, empty, and safe error states are explicit. Desktop 1440 px and
mobile 390 px render checks passed with no horizontal overflow; mobile and
desktop direct Admin loading produced no console error.

## Privacy and European consent consideration

This design avoids advertising cookies, third-party analytics scripts, raw IP
storage, fingerprinting, cross-site tracking, and individual browsing-history
UI. It is nevertheless analytics: the persistent first-party local-storage
visitor UUID is not strictly necessary to provide the requested webpage and
may require prior consent under the ePrivacy rules applied in some European
jurisdictions. This is a product/privacy-law decision, not a claim of legal
compliance.

Before or with the cPanel release, the Privacy Policy should describe the
identifier names, first-party analytics purpose, categories collected,
400-day retention, service providers/hosting boundary, DNT/GPC behavior,
international transfer position where applicable, data-subject choices, and
contact route. MedicHall should obtain jurisdiction-specific advice on whether
to gate the tracker behind its consent mechanism. If a consent gate is adopted,
it should prevent loading `medichall-traffic.js` until analytics consent rather
than attempting to delete auth or application storage.

## Historical-data boundary

No historical website traffic is fabricated or backfilled. Backend QA events
do not constitute customer traffic and are removed. Reliable customer traffic
begins with the first accepted event after the cPanel patch is manually
uploaded. Until that upload happens, the exact production customer-traffic
start timestamp is correctly reported as **not started**.

## Deployment state

The migration and only the `traffic-analytics` Edge Function are intended for
production deployment. The root frontend and Admin UI remain a manual cPanel
patch. Provider requests, AI spend, notification fan-out, and emails are zero.

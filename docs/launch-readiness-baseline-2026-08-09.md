# MedicHall launch-readiness baseline

Captured: 2026-08-09
Branch: `react-migration`
Production Supabase: `azdmuarzntzqdyirysux`
Repository HEAD: `33b8722711c463a274cacc7321abeebf70e2521b`

## Scope and safety

This is a read-only baseline for the Sprint 2.2–6 launch-readiness program. No
production row, database object, Edge Function, secret, cPanel file, branch, or
customer record was changed while collecting it.

The pre-existing untracked directory
`deliverables/medichall-sprint2-1-2026-08-08 2/` is not part of this program and
must remain excluded from commits.

## Repository and deployment state

- Local `react-migration` and `origin/react-migration` both resolve to
  `33b8722711c463a274cacc7321abeebf70e2521b` after a fresh fetch.
- `main` and `develop` were not checked out or modified.
- Production and repository migration ledgers are aligned at 40 migrations,
  from `202607090001` through `202608080001`.
- Production database lint at error level returns zero findings.
- The public cPanel release is byte-for-byte aligned with the repository for
  all seven root HTML files and all ten shared JS/CSS assets. Requests for the
  `.html` paths redirect to canonical extensionless routes; the redirected
  response bodies match the repository hashes.

### Root production pages

| Page | Actual function |
|---|---|
| `index.html` | Public marketplace and product overview |
| `products.html` | Product catalog across eligible approved companies |
| `companies.html` | Mixed-role Company Directory: manufacturers, distributors, buyers, suppliers, and other eligible company types |
| `tenders.html` | Public medical-tender discovery |
| `matchmaking.html` | Standalone authenticated Matchmaking Workspace |
| `portal.html` | Authenticated buyer/company workspace and production frontend |
| `admin.html` | Protected platform-management console |

### Shared cPanel assets aligned with production

`medichall-design-system.css`, `medichall-navigation.js`,
`medichall-session.js`, `marketplace-enterprise.css`,
`marketplace-domain.js`, `marketplace-products.js`,
`marketplace-companies.js`, `matchmaking-domain.js`,
`matchmaking-workspace.js`, and `tenders.js`.

## Current-state architecture map

```text
Public cPanel HTML
  -> shared navigation/session/design system
  -> Supabase anon REST/RPC for approved public marketplace and tenders

Partner Portal / Matchmaking
  -> canonical legacy session helper (access + refresh token)
  -> authenticated PostgREST/RPC under RLS
  -> Edge Functions for AI, imports, product normalization, and Daily video

Supabase Postgres
  -> tenant-owned company, buyer, product, RFQ, tender/import, and matching data
  -> security-definer workflow RPCs with explicit grants
  -> RLS for browser-accessible private tables
  -> pg_cron + Vault-backed dispatchers

Providers
  -> TED for tender discovery
  -> Anthropic for bounded document intelligence
  -> Daily for private scoped meeting rooms/tokens
  -> Resend for transactional email
```

### Authentication and session contract

- `medichall-session.js` is the canonical browser session layer.
- Access and refresh tokens use the legacy-compatible `mh_p_token` and
  `mh_p_refresh` keys.
- A single in-flight refresh is shared by concurrent 401 responses.
- Invalid refresh credentials clear only MedicHall session keys.
- Admin login additionally calls the `is_admin` RPC before rendering private
  admin data.
- No service-role credential is present in browser source.

### Marketplace and RFQ

- Approved companies and active products are public; company role is not
  inferred from filename or page name.
- Favorites and company follows are user-scoped.
- RFQs, offers, and messages retain participant/owner policies and notification
  triggers.
- Product profiles contain structured matching fields and deterministic
  readiness data.

### Matchmaking and meetings

- `matchmaking_profiles`, generated `matchmaking_matches`,
  `business_connections`, meeting proposals/participants/events/reminders,
  relationship messages, private notes, outcomes, notifications, and video
  access logs are live.
- Workspace and relationship data are returned through participant-scoped RPCs.
- Meeting lifecycle includes three-slot proposals, counter proposals,
  confirmation, rescheduling, immutable events, calendar exports, Daily video,
  notes, and post-meeting outcomes.
- The `medichall-matchmaking-automation` cron runs every five minutes.

### Tender intelligence and universal import

- Public tender discovery remains separate from company-private matching and
  analysis.
- PDF, DOCX, XLSX, CSV, ZIP, and public HTTPS import paths share the proven
  asynchronous document pipeline.
- Evidence, extracted facts, job/chunk progress, caching, retry/idempotency,
  lot matching, and company isolation are already present and must not be
  rebuilt.
- Document engine recovery is scheduled every minute.
- TED sync and the existing tender digest use Vault-backed cron configuration.

### Notifications and email

- The portal notification center is backed by `matchmaking_notifications` and
  the `get_portal_notification_center` / `mark_portal_notifications_read` RPCs.
- Matchmaking connection, meeting, reminder, message, and RFQ triggers reuse the
  same notification data model.
- Company-registration admin email uses an idempotent outbox, Vault-backed
  dispatcher, Resend Edge Function, retry state, and provider-message metadata.
- `medichall-company-admin-notification` is scheduled every minute.
- The legacy saved-search digest is daily and is distinct from the future
  cross-product weekly opportunity digest.

### Admin and analytics

- Current admin supports products, RFQs, companies, banners, and partners.
- Partner dashboard metrics are client-composed from opportunity and RFQ data.
- A launch-grade activation funnel and company-engagement dashboard do not yet
  exist; these are Sprint 6 work, not baseline defects.

## Production object counts

Counts were obtained with service-role `HEAD` requests; no row bodies or
customer fields were downloaded or printed.

| Object | Count |
|---|---:|
| Companies | 6 |
| Partners | 4 |
| Buyer profiles | 2 |
| Products | 39 |
| RFQs | 14 |
| RFQ messages | 7 |
| Tenders | 3,035 |
| Universal tender imports | 0 |
| Document-analysis jobs | 59 |
| Opportunity matches | 5,196 |
| Matchmaking profiles | 4 |
| Matchmaking matches | 5 |
| Business connections | 2 |
| Meeting requests | 8 |
| Portal/matchmaking notifications | 55 |
| Company-admin notification events | 2 |
| AI-usage records | 40 |
| Favorites | 1 |
| Company follows | 0 |

## Deployed Edge Functions

All are `ACTIVE`: `medichall-ai`, `ted-sync`,
`tender-attachment-discovery`, `tender-document-engine`,
`ted-notice-resolver`, `tender-archive-worker`, `public-assistant`,
`tender-digest`, `tender-lot-matching`, `product-profile`, `meeting-video`,
`company-admin-notification`, and `tender-import`.

## Production smoke evidence

- Public routes for Marketplace, Products, Company Directory, Tenders,
  Matchmaking, Partner Portal, and Admin all render their expected primary
  heading.
- Sixty-three route/viewport checks across 320, 360, 390, 414, 768, 900, 1024,
  1280, and 1440 pixels found no page-level horizontal overflow.
- No raw PGRST/PostgreSQL/Edge Function error was visible in the tested states.
- Browser console produced no warnings or errors during the public smoke.
- Auth/session regression: 8/8 passed.
- Sprint 2.1 tender/header regression: 7/7 passed.
- Deno: 118/118 passed.
- React/Vitest: 16 files, 96/96 tests passed.
- React TypeScript, ESLint, and production build passed; 1,849 modules were
  transformed.
- Seven-root-page HTML parse and duplicate-ID validation passed.
- Credential scan passed across 472 text files.
- `git diff --check` passed.

Authenticated write journeys were intentionally not performed during this
read-only baseline. Each later sprint must use isolated synthetic QA markers,
validate its own production behavior where appropriate, and remove only its QA
records.

## Sprint 2.2 audit findings

The following issues are accepted Sprint 2.2 scope:

1. Product and homepage legacy login modals still call a stale “design preview”
   alert instead of the production Partner Portal.
2. Marketplace product failures, standalone matchmaking failures, portal
   helpers, and admin helpers can surface provider or database error text.
3. Public pages run an older account-chip initializer alongside the shared
   header session initializer, causing duplicate auth/company/message requests
   and polling.
4. Admin fallback text instructs users to run a SQL setup script and can expose
   raw database error content.
5. Several modal and drawer implementations predate the shared accessibility
   behavior; focus restoration, `hidden` state, and background-scroll handling
   are inconsistent.
6. Portal workspace/notification polling already has visibility and in-flight
   guards; new polling must use the same single-flight, background-aware rule
   rather than introducing a second timer pattern.
7. Some empty states explain that data is absent but do not consistently offer
   the next business action.
8. Homepage placeholder links (`#`) are stale and should become non-interactive
   text or valid destinations.

These findings do not indicate production backend drift. They are polish,
performance, error-experience, and accessibility work for Sprint 2.2.

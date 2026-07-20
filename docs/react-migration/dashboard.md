# Dashboard React migration

## Scope and source audit

This increment migrates the manufacturer Dashboard from `portal.html` into the
existing React + TypeScript + Vite application at `apps/portal-react`. The
stable `develop` implementation at commit `0014d8f` was inspected before the
`react-migration` branch was created. `portal.html`, the Supabase schema, RLS,
RPCs, Storage, authentication, and Edge Functions are unchanged.

The legacy dashboard consists of:

- the manufacturer welcome heading;
- four metric cards: Total matches, High matches, Open tenders, and RFQ inbox;
- the first three ordered company opportunities in compact-card form;
- an empty opportunity prompt that links to matching-profile setup;
- a five-check Match readiness meter and actionable checklist.

There is no separate Recent Tenders widget in the production dashboard. The
React migration does not invent one. Tender matches remain part of Top
opportunities, exactly as in the HTML portal.

## Legacy JavaScript behavior preserved

The dashboard audit covered these functions and dependencies in `portal.html`:

- `enterApp()` resolves the authenticated user company, launches the products,
  RFQ, match-profile, and opportunity loads, personalizes the welcome heading,
  and schedules dashboard refreshes after 1.5 and 4 seconds;
- `api()` and `db()` attach the existing publishable key and legacy bearer
  token, parse JSON, and treat HTTP 401 as an expired session;
- `loadProducts()` queries all company products ordered by `ref`;
- `loadRfq()` queries all company RFQs ordered newest first;
- `loadMatchProfile()` reads the company matching profile, places its country
  and keyword arrays in the form, and starts `loadOpportunities()` when a
  profile exists;
- `loadOpportunities()` loads at most 50 non-dismissed company matches ordered
  by `match_score desc, generated_at desc`, then calls `updateDashboard()`;
- `renderOppCard(match, true)` supplies the compact top-opportunity title,
  country/buyer/deadline/value or distributor metadata, and match score;
- `updateDashboard()` counts the four metrics and selects the first three
  already ordered opportunities;
- `updateReadiness()` applies five equal checks and rounds the completed share;
- `showPanel()` is the legacy click-navigation helper. React replaces those
  mouse-only cards with semantic links while preserving their destinations;
- `friendlyError()` informed the new explicit request/configuration/migration
  error states and retry path.

The React page waits for its parallel reads and then paints one consistent
snapshot rather than relying on the legacy 1.5/4-second timers. Successful
values and business rules are unchanged; failures are now visible in the page
instead of only appearing as a toast or leaving stale placeholders.

## Backend endpoints and queries

The dashboard invokes no RPC and requires no new backend endpoint.

Authentication and company eligibility reuse the existing session bridge:

1. `GET /auth/v1/user`
2. `GET /rest/v1/companies`
   - `select=id,name,description,certifications`
   - `owner_id=eq.<authenticated-user-id>`
   - `limit=1`

After a company is resolved, `useDashboard` requests these existing resources
in parallel:

1. `GET /rest/v1/opportunity_matches`
   - company-scoped through `company_id=eq.<company-id>`;
   - excludes `status=dismissed`;
   - orders `match_score.desc,generated_at.desc`;
   - limits the snapshot to 50 rows, matching `portal.html`;
   - joins the current `tenders` and `distributor_candidates` relationships.
2. `GET /rest/v1/rfq_requests?select=*`
   - company-scoped and ordered `created_at.desc`.
3. `GET /rest/v1/products?select=*`
   - company-scoped and ordered by `ref`.
4. `GET /rest/v1/company_match_profiles?select=*`
   - company-scoped; the first row supplies `product_keywords` and
     `target_countries`.

All calls use the browser-safe publishable/anon key plus the current
`mh_p_token`; an expired access token is retried once through the existing
`mh_p_refresh` bridge. Supabase RLS remains the authorization boundary.

### Tables, relationships, and fields consumed

| Contract | Fields used by Dashboard |
| --- | --- |
| `companies` | `id`, `owner_id`, `name`, `description`, `certifications` |
| `products` | returned row count for the product-readiness check |
| `rfq_requests` | returned row count for the RFQ metric |
| `company_match_profiles` | `product_keywords`, `target_countries` |
| `opportunity_matches` | `id`, `company_id`, `opportunity_type`, `status`, `match_score`, `generated_at`, tender/distributor foreign relationships |
| `tenders` | `id`, `title`, `title_en`, `buyer_name`, country fields, `deadline_at`, `estimated_value`, `currency`, source fields |
| `distributor_candidates` | `id`, `name`, website/source fields, country fields, `company_type`, `verification_status` |

The Dashboard does **not** invoke `refresh_company_opportunity_matches` or
`set_opportunity_match_status`. Those existing RPCs remain used by My
Opportunities and the production matching workflow. Dashboard only displays
the current backend result set.

## Exact business rules

- **Total matches:** length of the returned, non-dismissed, ordered 50-row
  snapshot. It is intentionally not a new database-wide count.
- **High matches:** rows whose backend `match_score` is `>= 80`.
- **Open tenders:** rows whose backend `opportunity_type` is `tender`. The name
  is preserved from production; React does not re-evaluate tender deadlines.
- **RFQ inbox:** length of the returned company `rfq_requests` rows.
- **Top opportunities:** first three rows in backend order.
- **Match readiness:** five equal checks, producing 0/20/40/60/80/100 percent:
  1. company description exists and has more than 30 characters;
  2. company certifications is truthy;
  3. at least one product row exists;
  4. matching-profile product keywords contain non-whitespace content;
  5. matching-profile target countries contain non-whitespace content.

No score, metric, status, deadline decision, or statistic is synthesized.

## React implementation

The `features/dashboard` slice contains:

- `components/DashboardPage.tsx` — auth/eligibility and page-state orchestration;
- `components/DashboardHeader.tsx` — personalized manufacturer heading;
- `components/DashboardSummaryCards.tsx` — linked metric cards;
- `components/RecentOpportunities.tsx` — the compact top-three list;
- `components/DashboardStats.tsx` — readiness progress and checklist;
- `components/DashboardEmptyState.tsx` — no-match guidance;
- `components/DashboardLoading.tsx` — skeleton layout;
- `components/DashboardError.tsx` — configuration, migration, and request errors with retry;
- `hooks/useDashboard.ts` — abortable loading/retry state;
- `api/dashboard-api.ts` — existing REST queries and response mapping;
- `utils/format-dashboard.ts` — metric, readiness, title, and metadata rules;
- `types.ts` — dashboard contracts and view models.

`#/dashboard` is added to the dependency-free hash router and shared portal
navigation. The unknown/empty-hash fallback remains All Tenders, preserving
anonymous access behavior. Summary cards and checklist items are links, focus
styles remain visible, headings and landmarks are semantic, readiness exposes
a native progressbar contract, and no backend text uses unsafe HTML rendering.

## Page states

- **Checking/loading:** skeleton summary and dashboard panels while auth or
  data reads are pending.
- **Signed out:** link to the unchanged `/portal.html` login flow.
- **No company:** link to legacy manufacturer onboarding.
- **Empty opportunities:** zero-valued backend-derived metrics, readiness, and
  a matching-profile setup action remain visible.
- **Configuration error:** identifies missing public Vite configuration or an
  unsafe browser key.
- **Migration compatibility error:** identifies absent production Partner
  Portal/Match Engine contracts without proposing schema changes.
- **Request error:** displays the backend/network message and a retry button.

## Testing and verification

Dashboard tests cover:

- total/high/tender/RFQ metric rules, including the exact `>= 80` boundary;
- preservation of backend opportunity order and top-three selection;
- all five readiness checks and the description-length boundary;
- match-profile array mapping without invented values;
- summary-card link rendering and readiness progressbar semantics;
- the new Dashboard route while preserving All Tenders as the fallback.

Run from `apps/portal-react`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Staging procedure

1. Check out `react-migration`; never stage this increment from `develop`.
2. Copy `.env.example` to `.env.local` and keep only the existing public
   Supabase URL, publishable key, and legacy portal URL.
3. Run the four verification commands above.
4. Serve `apps/portal-react/dist` from a non-production staging path on the
   same origin as `portal.html`, so legacy localStorage session keys are shared.
5. Sign in through `portal.html`, then test `#/dashboard` with companies that
   have: no matches, more than three matches, scores around 80, no products,
   no matching profile, RFQs, and an expired access token.
6. Compare the four metrics, top three ordering, and five readiness checks with
   `portal.html#dashboard` for the same company.

## Known limitations and remaining legacy scope

- Login, registration, manufacturer onboarding, profile editing, product
  management, RFQ inbox/actions, matching-profile editing, manual Find matches,
  AI tools, catalogs, certificates, and document analysis remain in
  `portal.html`.
- Product setup has no supported legacy hash deep link, so its readiness item
  opens the current Partner Portal root; the HTML portal remains untouched.
- The Total matches label still means the first 50 non-dismissed ordered rows,
  because that is the production Dashboard contract.
- Dashboard is a read-only snapshot. Refreshing/generating matches remains in
  the existing My Opportunities/legacy workflows.

## Rollback

No production HTML or backend migration is involved. To roll back:

1. stop serving the React staging artifact containing `#/dashboard`, or restore
   the previously verified `apps/portal-react/dist` artifact;
2. remove the Dashboard navigation entry in a follow-up commit if needed;
3. direct partners to `/portal.html#dashboard`.

The production HTML Dashboard remains operational throughout and requires no
data or schema rollback.

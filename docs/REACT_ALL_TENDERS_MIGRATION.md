# React migration: All Tenders

**Branch:** `develop`

**Audited base commit:** `b7ff662728de9934e7e64cdee3c169769af2adcc`

**Migration surface:** `apps/portal-react/`

**Production HTML changed:** no

## 1. Pre-change branch review

The full tracked `develop` tree was reviewed before implementation:

- Six static production pages: `index.html`, `portal.html`,
  `matchmaking.html`, `products.html`, `companies.html`, and `admin.html`.
- The current Partner Portal auth/session behavior, direct PostgREST calls,
  tender filters, result-card rendering, CPV catalog picker, saved searches,
  load-more pagination, deep-analysis flow, and error fallbacks.
- All Supabase migrations, setup SQL, seed SQL, Edge Functions, Deno import
  maps, and project configuration.
- All architecture, installation, handover, Sprint A/B/C, CPV, English
  normalization, translation hotfix, match-engine, and tender-automation
  documentation.
- The Git history and remote state. Local `develop` and `origin/develop` both
  pointed to the audited base commit before files were changed.

The production architecture is intentionally static and manually deployed.
For that reason, the React application is a new, self-contained directory. No
root HTML page, redirect, Supabase migration, or Edge Function is replaced.

## 2. Scope of this migration

Only the **All Tenders** feed from the Opportunities tab is migrated. The new
app includes:

- Debounced tender text search.
- Country, deadline, notice-type, EUR-value, and unknown-value filters.
- Manual CPV family/code entry and an official-catalog CPV selector with live
  open-tender counts.
- Saved-search creation, application, daily-email toggle, and deletion.
- Twenty-row load-more pagination with the RPC's `total_count` value.
- Initial loading skeletons, pagination loading, configuration errors,
  database-migration errors, request errors, CPV-catalog errors, empty results,
  and signed-out saved-search states.
- Reusable tender result cards that preserve original titles and values,
  explicitly label machine-translated English titles, mark ECB conversion with
  `≈`, display up to four CPV codes, and link only to HTTP(S) source URLs.

Not migrated yet: login/registration, dashboards, company profiles, products,
RFQs, matched opportunities, AI assistant, deep tender analysis, document
uploads, buyer tools, admin, public catalog pages, or matchmaking.

## 3. Existing Supabase compatibility

No database change is introduced. The React app calls the same project and
contracts as `portal.html`.

### Tender search

`search_tenders` is called with the legacy parameter names and behavior:

| React value | Existing RPC parameter | Compatibility detail |
|---|---|---|
| Search text | `p_query` | Trimmed; empty becomes `null`. The v4 RPC searches original and English-normalized text. |
| Country | `p_countries` | Sent as a one-item array, matching the existing UI. |
| CPV input/selection | `p_cpv` | Comma/semicolon-separated families remain prefixes; duplicates are removed. |
| Notice type | `p_notice_types` | Sent as a one-item array. |
| Deadline | `p_deadline_within_days` | Preserves 7/30/90-day choices. |
| EUR range | `p_value_min_eur`, `p_value_max_eur` | Non-negative values or `null`. |
| Unknown values | `p_include_unknown_value` | Defaults to `true`; tenders without a stated/convertible value are not silently dropped. |
| Pagination | `p_limit`, `p_offset` | Page size remains 20; later pages append to current results. |

`p_created_after` is intentionally omitted. It is a v4 digest-only optional
parameter and defaults to `null`, exactly as it does for the current portal.

### Facets and CPV

- `tender_filter_facets({})` supplies countries, notice types, currencies, and
  the ECB conversion date.
- If the facets RPC is unavailable, the UI preserves the legacy fallback that
  reads up to 1,000 open-tender country rows. It clearly reports that advanced
  facets need the Sprint A migration.
- `cpv_catalog_with_counts({ p_max_depth: 5 })` supplies the existing official
  CPV catalog and live open-tender family counts.
- Manual CPV entry remains available if the catalog RPC is not installed.

### Saved searches

The app uses the existing `saved_searches` table through PostgREST:

- `GET saved_searches?select=*&order=created_at.asc`
- `POST saved_searches`
- `PATCH saved_searches?id=eq.<id>` for `email_alerts`
- `DELETE saved_searches?id=eq.<id>`

Existing RLS continues to enforce `user_id = auth.uid()`, and the database's
20-search cap remains authoritative. No service-role access is used.

## 4. Session migration behavior

The current portal stores the partner access and refresh tokens in
same-origin `localStorage` as `mh_p_token` and `mh_p_refresh`. The React app:

1. Reuses the access token for authenticated PostgREST calls.
2. Uses the existing `/auth/v1/token?grant_type=refresh_token` flow after a
   401 response.
3. Updates the same two legacy keys after a successful refresh.
4. Clears an invalid session and leaves the tender feed usable anonymously.
5. Directs signed-out users back to `/portal.html` for login rather than
   prematurely migrating authentication.

Deploy the new page on the same origin if saved-search session sharing is
required. A different origin cannot read the legacy portal's `localStorage`.

## 5. Public configuration and secret safety

Create local configuration from the checked-in example:

```bash
cd apps/portal-react
cp .env.example .env.local
```

Only these browser-safe variables exist:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_LEGACY_PORTAL_URL`

The project URL and publishable key already exist in the production static
HTML and are designed for browser use. Authorization is enforced by RLS, not
by hiding the publishable key.

Never place any of the following in this app or any `VITE_*` value:

- `SUPABASE_SERVICE_ROLE_KEY`
- `sb_secret_*` keys
- `CRON_SECRET`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`

The runtime configuration guard rejects `sb_secret_*` values and legacy JWTs
whose role claim is `service_role` before a request is sent.

## 6. Local setup and verification

Requirements: Node.js 22.12+ and pnpm 11.

```bash
cd apps/portal-react
cp .env.example .env.local
pnpm install
pnpm dev
```

Run the complete local verification suite:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The tests cover RPC parameter compatibility, default unknown-value behavior,
CPV parsing/toggling, filter counting, the saved-search eligibility rule,
saved-search column mapping, legacy first-country/first-notice application,
original-plus-approximate-EUR formatting, and unsafe source-URL rejection.

The implementation was also checked against the existing live Supabase
project with read-only requests:

- `tender_filter_facets` returned countries, notice types, and an ECB date.
- `search_tenders` returned the complete v4 card field set and `total_count`.
- `cpv_catalog_with_counts` returned depth-limited catalog rows with selectable
  product families.

Authenticated saved-search writes were not performed during implementation,
because doing so would create or alter a real user's records. Their payloads
and legacy behavior are covered by unit tests and the existing RLS contract.

## 7. Non-breaking deployment sequence

The existing production files should remain the default until the migration
is accepted.

1. Run the four verification commands above.
2. Build `apps/portal-react`; output is written only to
   `apps/portal-react/dist/` and is ignored by Git.
3. Upload that `dist/` directory to a separate same-origin staging path, such
   as `/portal-react/`. `vite.config.ts` uses `base: "./"`, so assets resolve
   under a subdirectory.
4. Verify tender search and CPV anonymously.
5. Sign in through the current `/portal.html`, then open the staging path in
   the same origin and verify saved-search load/create/toggle/delete behavior.
6. Keep `portal.html` as the production entry point. Adding a production link
   or replacing a portal route is a later, explicit migration decision.

No deployment or route change is part of this commit.

## 8. Rollback

Because the migration is isolated and introduces no schema changes, rollback
is straightforward:

- Stop serving the staged React `dist/` directory.
- Leave all root HTML and Supabase resources in place.
- If source rollback is required, revert the commit that added
  `apps/portal-react/`, this document, and the README pointer.

There is no data migration to reverse and no production HTML file to restore.

## 9. Next migration step

Migrate one portal feature at a time into `apps/portal-react/src/features/`.
Before each step, record its current PostgREST/RPC/session contract, keep the
legacy route live, add compatibility tests, stage it separately, and change a
production route only after explicit acceptance.

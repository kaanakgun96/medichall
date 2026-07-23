# Company and matching profile React migration

## Scope and source audit

This increment migrates the authenticated manufacturer **Company profile** and
**matching profile** forms into the existing React + TypeScript + Vite
application at `apps/portal-react`. It adds the hash route
`#/company-profile`. The production HTML portal, login, registration,
manufacturer onboarding, Supabase schema, RLS, RPCs, Storage, Edge Functions,
and production routing remain unchanged.

The stable `develop` branch at `c6e1eeb` was inspected without checking it out
or modifying it. The audit covered:

- `portal.html` markup for `panel-profile`, `matchProfileCard`, the status
  banner, and the Dashboard readiness card;
- `api`, `db`, `getUser`, `enterApp`, `renderStatus`, `companyFormHTML`,
  `readCompanyForm`, `saveCompany`, `loadProducts`, `loadMatchProfile`,
  `saveMatchProfile`, `updateReadiness`, `csvToArr`, `arrToCsv`,
  `cpvSelectedSet`, `cpvWriteSelection`, `toggleCpvPicker`, `cpvToggleCode`,
  `renderCpvTree`, and `friendlyError`;
- the initial `companies` schema and ownership policies in
  `supabase-portal-v2.sql`, plus the existing storage, slug, premium, and
  visibility additions;
- `202607100003_match_engine_foundation.sql` for
  `company_match_profiles`, timestamps, constraints, and RLS;
- the latest `refresh_company_opportunity_matches` definition in
  `202607200002_english_normalization.sql`;
- `202607200001_cpv_catalog.sql` for `cpv_catalog_with_counts`;
- the current React session bridge, Supabase HTTP client, owned-company
  resolution, Dashboard readiness calculation, All Tenders CPV selector,
  routing, tests, and migration documents.

## Migrated functionality

Authenticated owners can now view and edit:

### Company details

- `name`
- `type`
- `description`
- `website`
- `country`
- `city`
- `contact_email`
- `phone`
- `certifications`
- `video_url`

Company approval, verification, and public-profile status are displayed but
are not editable. The React page never sends `owner_id`, `is_approved`,
`is_verified`, `is_active`, `slug`, plan fields, or any other administrative
column.

`country` already exists on the production `companies` table and is used by
the public company experience. The current HTML company form does not expose
it even though it is part of the loaded company row; the requested React scope
surfaces that existing field without adding or changing a database contract.

### Matching profile

- `target_countries`
- `product_keywords`
- `certifications`
- `cpv_codes`
- `min_match_score`
- `oem_available`
- `private_label_available`
- read-only `updated_at` and `last_indexed_at`

When no matching row exists, the form keeps the legacy defaults: arrays are
empty, minimum score is `60`, booleans are false, and matching certifications
start from the company’s comma-separated certification text.

The page tracks normalized dirty state independently for the two forms,
prevents repeated concurrent saves, disables a form while its request is in
flight, avoids requests when nothing changed, keeps entered values after a
recoverable failure, displays field and request errors without unsafe HTML,
and confirms successful saves through an accessible live status. A
`beforeunload` warning protects unsaved changes when leaving or reloading the
page.

## Exact backend contract

No database object is added or changed.

### Authentication and ownership

1. `GET /auth/v1/user`
2. `GET /rest/v1/companies`
   - `select=*`
   - `owner_id=eq.<authenticated-user-id>`
   - `limit=1`

The query matches `enterApp()` in `portal.html`. Only the company owned by the
current user is accepted. Existing `companies` RLS remains authoritative:
owners can select and update their row, and administrators retain their
existing policy.

The React client reuses `mh_p_token` and `mh_p_refresh`. A 401 uses the
existing refresh-token flow once. An invalid or expired session is cleared and
the page returns to the signed-out state. Login, registration, and onboarding
remain at `/portal.html`.

### Initial profile data

After ownership is resolved, these existing requests run in parallel:

1. `GET /rest/v1/company_match_profiles`
   - `select=*`
   - `company_id=eq.<owned-company-id>`
   - `limit=1`
2. `GET /rest/v1/products`
   - `select=id`
   - `company_id=eq.<owned-company-id>`

The product rows are used only for the established readiness check. Product
names, categories, files, and product editing remain in the legacy Products
flow.

### Company save

`PATCH /rest/v1/companies?id=eq.<owned-company-id>` sends only:

`name`, `type`, `description`, `website`, `country`, `city`,
`contact_email`, `phone`, `certifications`, and `video_url`.

The page then reloads that row, matching the legacy `saveCompany()` behavior
and preserving backend-generated or administrative fields.

### Matching-profile save

`POST /rest/v1/company_match_profiles?on_conflict=company_id` uses:

`Prefer: resolution=merge-duplicates,return=representation`

The payload contains:

`company_id`, `target_countries`, `product_keywords`, `certifications`,
`cpv_codes`, `min_match_score`, `oem_available`,
`private_label_available`, and `updated_at`.

This is the same merge-duplicate upsert contract as `saveMatchProfile()`.
The owner-only `company_match_profiles` RLS policy checks that `company_id`
belongs to `auth.uid()`.

The form intentionally omits `target_partner_types`,
`profile_complete_score`, `last_indexed_at`, and timestamp fields other than
the legacy `updated_at` value. Existing data in omitted columns is not
reinterpreted by the React client.

### RPCs

The page calls one read-only RPC:

| RPC | Parameters | Purpose |
| --- | --- | --- |
| `cpv_catalog_with_counts` | `{ p_max_depth: 5 }` | Official CPV 2008 labels and live open-tender counts |

Profile saving itself invokes no RPC.
`refresh_company_opportunity_matches({ p_company_id })` is intentionally not
called by this page. It remains available through My Opportunities and the
existing scheduled/legacy matching flows. Saving preferences and regenerating
matches stay separate operations, as they are in production.

## Validation and normalization

The React implementation preserves the active legacy rules:

- company name is required;
- at least one comma-separated product keyword is required;
- empty company text values become `null`;
- company values are trimmed before `PATCH`;
- matching arrays use the legacy comma-only split, trim, and empty-item
  removal behavior;
- minimum match score defaults to `60` when blank and is clamped to `0–100`;
- no new website, email, phone, country, certification, or description
  validation is invented.

The numeric input reports malformed data locally. Out-of-range numeric values
are accepted and clamped on save, matching `saveMatchProfile()`.

## CPV behavior

The Company Profile feature extends the existing React `CpvSelector` instead
of copying the All Tenders dialog. Both routes continue using
`cpv_catalog_with_counts`.

For the matching profile:

- manual text remains editable and is persisted as the legacy comma-separated
  `text[]`;
- selected values are derived exactly like `cpvSelectedSet`: split on commas,
  remove non-digits, take the first eight digits, remove empty values;
- catalog selection/removal rewrites the selected set in sorted,
  comma-separated form;
- family labels, search, nested rows, live counts, keyboard controls, Escape,
  loading, unavailable-catalog, and empty-search states come from the shared
  existing selector;
- manual entry remains available if the catalog RPC is unavailable;
- the legacy implementation has no maximum-selection rule, so React adds none.

## Profile readiness

The page preserves the production Dashboard formula: five equally weighted
checks producing `0`, `20`, `40`, `60`, `80`, or `100` percent.

1. Trimmed company description is longer than 30 characters.
2. Company certification text is non-empty.
3. The company owns at least one product row.
4. Matching product-keyword text is non-empty.
5. Matching target-country text is non-empty.

The `company_match_profiles.profile_complete_score` column defaults to zero
but is not written by `saveMatchProfile`, the current refresh RPC, or any
production trigger in the repository. It therefore conflicts with the
actively displayed HTML readiness formula and can be stale. The React page
uses the exact active five-check rule and documents why the unused column is
not presented as authoritative.

Dashboard readiness links for company details, certifications, keywords, and
countries now open `#/company-profile`. Product setup still opens the legacy
portal because product editing is not part of this migration.

## Component architecture

The `features/company-profile` slice contains:

- `api/company-profile-api.ts` — owner lookup, initial reads, company PATCH,
  and matching-profile upsert;
- `hooks/useCompanyProfile.ts` — session, ownership, loading, retry, signed-out,
  no-company, and error orchestration;
- `hooks/useCompanyProfileForm.ts` — dirty state, validation, duplicate-save
  locks, save feedback, failure preservation, and unload protection;
- `components/CompanyProfilePage.tsx` — page-state orchestration;
- `components/CompanyProfileHeader.tsx` — safe company identity and backend
  context;
- `components/CompanyDetailsForm.tsx` — existing company fields;
- `components/MatchingProfileForm.tsx` — existing match preferences and
  timestamps;
- `components/MatchingCpvSelector.tsx` — legacy-compatible adapter around the
  existing React CPV selector;
- `components/ProfileReadiness.tsx` — five-check progress and actions;
- `components/ProfileSaveBar.tsx` — dirty/saving/success/error feedback;
- `components/CompanyProfileLoading.tsx` and
  `CompanyProfileError.tsx` — explicit skeleton and retry states;
- `utils/` — backend mapping, payload mapping, validation, readiness, error,
  eligibility, CPV, and reducer rules;
- `types.ts` — backend, form, payload, readiness, and error contracts.

## Tests

Tests cover:

- backend-to-form mapping;
- company and matching form-to-backend payloads;
- null, empty, and malformed optional data;
- required-field validation and match-score behavior;
- normalized dirty-state detection;
- successful-save baseline reset;
- failed-save preservation of entered data;
- the five readiness checks and 30-character boundary;
- valid and malformed last-updated formatting;
- legacy CPV normalization, selection, and removal;
- signed-out, checking, no-company, and eligible logic;
- React escaping of backend-provided company text;
- accessible save-success feedback;
- `#/company-profile` route parsing;
- updated Dashboard readiness destinations;
- all previously existing tests.

Run from `apps/portal-react`:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Page states

- checking session and initial profile skeleton;
- signed out with a link to the current login flow;
- valid session with no company and a link to legacy manufacturer onboarding;
- eligible owner with complete or incomplete/null profile records;
- missing configuration;
- missing existing migration contract;
- initial request error with retry;
- company-save validation/request/success states;
- matching-save validation/request/success states;
- unavailable or empty CPV catalog;
- unsaved company or matching changes.

## Known limitations and intentionally legacy functionality

- Login, registration, logout, account-type choice, and manufacturer
  onboarding remain in `portal.html`.
- Company logo, product-catalog uploads, certificate-document uploads,
  Storage writes, product editing, and per-product categories remain in the
  legacy Company Profile/Products flows. This avoids expanding a form-field
  migration into Storage and asset-management work.
- The company portal is the manufacturer experience. There is no editable
  manufacturer/distributor boolean in `companies`; `type` is the existing
  free-text company-type field.
- `target_partner_types` exists in `company_match_profiles` but is not exposed
  by the legacy profile form, so React does not invent an editor for it.
- `product_categories` belongs to products, distributor candidates, and the
  separate matchmaking product—not the legacy company/matching form.
- Saving a matching profile does not run a match refresh. Use My Opportunities
  or the existing production workflow.
- Company rows do not have a consistently installed `updated_at` contract in
  the checked-in legacy schema. The page displays matching `updated_at` and
  `last_indexed_at`; absent timestamps are labelled “Not available.”

## Staging procedure

1. Check out `react-migration`; never stage or merge this increment through
   `develop`.
2. Copy `.env.example` to `.env.local`. Use only the existing public Supabase
   URL, publishable key, and legacy portal URL.
3. Run all five verification commands above.
4. Serve `apps/portal-react/dist` from a separate, non-production,
   same-origin path so the legacy localStorage session is shared.
5. Sign in through `/portal.html`, then verify `#/company-profile` with:
   - a signed-out browser;
   - a user with no company;
   - a company with no matching row;
   - null/empty company fields;
   - an existing matching profile and CPV selections;
   - score values around `0`, `60`, and `100`;
   - zero and non-zero products;
   - an expired access token;
   - a recoverable failed save.
6. Compare saved rows and readiness against `portal.html` for the same
   disposable staging account.
7. Recheck `#/dashboard`, `#/all-tenders`, and `#/my-opportunities`.
8. Keep `/portal.html` as the production entry point. Do not deploy or change
   production routing as part of this migration.

## Rollback

No schema or production-route rollback is required:

1. stop serving the staged React artifact containing
   `#/company-profile`, or restore the previous verified `dist` artifact;
2. revert the Company Profile migration commit if source rollback is needed;
3. direct partners to `/portal.html#profile` and the existing Opportunities
   matching-profile card.

Normal company or matching-profile edits made during authorized staging tests
are existing production data operations. If a disposable record must be
restored, edit it through the unchanged legacy portal or the same existing
owner-scoped PostgREST contract.

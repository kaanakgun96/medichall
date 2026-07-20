# React migration: My Opportunities

**Branch:** `develop`

**Audited base commit:** `8f38dad8e8cb414472410918a30293df8a27a7b4`

**Migration surface:** `apps/portal-react/`

**Production HTML, schema, RLS, RPC, and Edge Function changes:** none

## 1. Pre-change review

The current `develop` branch was reviewed before implementation. The review
covered:

- the complete tracked repository tree and recent branch history;
- every existing file in `apps/portal-react`, including the All Tenders RPC
  mapping, saved searches, session bridge, shared components, tests, build
  configuration, and migration documentation;
- the My matches markup and JavaScript in `portal.html`, including
  `loadMatchProfile`, `findMatches`, `loadOpportunities`, `renderOppCard`,
  `renderOppList`, dashboard cards, status changes, and deep-analysis links;
- match-engine, explainable-match, document-engine, CPV, filter, and English
  normalization migrations and one-time setup SQL;
- related Edge Function refresh calls and the architecture, handover, match
  engine, explainable-match, and document-engine documentation.

The checked-in public OpenAPI endpoint returned HTTP 401 during a final
read-only schema probe. No authenticated account or production record was used
for implementation testing. Compatibility therefore follows the repository's
current SQL contracts and the exact caller already running in `portal.html`.

## 2. Migrated scope

The existing Vite app now has dependency-free hash routes:

- `#/all-tenders`
- `#/my-opportunities`

My Opportunities includes:

- legacy-session authentication and owned-company resolution;
- company-specific tender and distributor matches;
- backend-returned opportunity, profile, document, confidence, and component
  scores without client-side score invention;
- original tender titles and explicitly labelled English machine translations;
- matched reasons, missing requirements, risks, verification state, next best
  action, country, buyer/type, CPV, deadline, value, notice type, and source;
- safe HTTP(S)-only source links;
- the legacy search/type/country/minimum-score filter behavior;
- 20-row load-more pagination;
- save/viewed, contacted, and dismissed workflow actions through the existing
  RPC;
- the existing manual match-refresh RPC;
- loading, empty, filtered-empty, signed-out, no-company, configuration,
  migration, initial-request, action-request, and pagination-request states.

The shared header exposes keyboard-accessible navigation between both migrated
surfaces. The layout uses semantic landmarks/headings, visible focus states,
descriptive labels, responsive layouts, and React text rendering only. No
`dangerouslySetInnerHTML` or equivalent unsafe HTML path is used.

## 3. Exact existing backend contract

No database object was added or modified.

### Authentication and company lookup

1. `GET /auth/v1/user` reads the authenticated user from the legacy access
   token.
2. `GET /rest/v1/companies?select=id,name&owner_id=eq.<user-id>&limit=1`
   resolves the partner company, matching `portal.html`.
3. Existing company and opportunity RLS remains authoritative.

The React application does not use an admin or service-role client.

### Opportunity list

The app reads `opportunity_matches` through PostgREST with:

- `company_id=eq.<owned-company-id>`
- `status=neq.dismissed`
- `order=match_score.desc,generated_at.desc`
- optional `opportunity_type=eq.tender|distributor`
- optional `match_score=gte.60|80`
- `limit=21` and an offset; 20 rows are displayed and the extra row indicates
  whether Load more should remain available.

Search and country filtering remain client-side, as in the legacy My matches
view. They cover the pages loaded so far. Text search includes original and
English-normalized tender titles, buyer, country, source, matched reasons, and
distributor name/type/product terms. An exact country query remains an exact
country filter, preserving the legacy special case.

The selected `opportunity_matches` fields are:

| Field | UI use |
|---|---|
| `id`, `company_id`, `opportunity_type`, `status` | identity, ownership context, card type, workflow state |
| `match_score` | existing/legacy deterministic score and minimum-score filter |
| `opportunity_score` | Opportunity Score; shown as not calculated when null |
| `profile_match_score` | separate Profile Match; shown as not calculated when null |
| `document_match_score` | shown only with analyzed document evidence |
| `confidence_score`, `confidence_level`, `score_basis` | confidence and basis labels |
| `keyword_score`, `geography_score`, `category_score`, `certification_score` | returned Product/Country/CPV/Certificates breakdown |
| `reasons`, `risks` | matched reasons and risk indicators |
| `missing_information`, `evidence`, `next_best_action` | explainable-match details |
| `generated_at` | preserved in the mapped contract |

### Joined tender fields

The `tenders` relationship selects exactly:

`id`, `title`, `title_en`, `buyer_name`, `country_code`, `country_name`,
`cpv_codes`, `publication_date`, `deadline_at`, `estimated_value`,
`estimated_value_eur`, `currency`, `eur_rate_as_of`, `notice_type`, `source`,
`source_notice_id`, `source_url`, `document_analysis_status`,
`document_confidence_score`, `data_completeness_score`,
`analyzed_document_count`, and `missing_information`.

Original value and currency remain primary. Existing EUR conversions are
shown with `≈`; the React application performs no exchange-rate calculation.

### Joined distributor fields

The `distributor_candidates` relationship selects exactly:

`id`, `name`, `website`, `country_code`, `country_name`, `company_type`,
`product_categories`, `product_keywords`, `certifications`, `channels`,
`source`, `source_url`, and `verification_status`.

Existing RLS limits partner reads to active reviewed/verified distributor
candidates.

### Existing RPCs

| RPC | Parameters used | Behavior preserved |
|---|---|---|
| `refresh_company_opportunity_matches` | `{ p_company_id }` | Same deterministic/upsert refresh called by `portal.html`; saved/contacted states remain backend-preserved. |
| `set_opportunity_match_status` | `{ p_match_id, p_status }` | Uses the security-definer ownership check; React sends only `viewed`, `saved`, `contacted`, or `dismissed`. |
| `refresh_explainable_tender_matches` | not called by this list page | Existing document engines call it after analysis; React only reads its persisted explainable fields. |

The All Tenders calls (`search_tenders`, `tender_filter_facets`,
`cpv_catalog_with_counts`) and saved-search table behavior are unchanged.

## 4. Score and evidence rules

The UI intentionally does not calculate or infer scores:

- `opportunity_score = null` displays **Not calculated**, with the separate
  legacy `match_score` labelled for context.
- `profile_match_score = null` displays **Not calculated**.
- Document Match displays a numeric `document_match_score` only when
  `document_analysis_status` is `completed` or `partial`,
  `analyzed_document_count > 0`, and the score is non-null.
- With no analyzed document evidence, Document Match displays **Pending** even
  if another stale/non-null score happens to be present.
- `queued`, `processing`, and `failed` retain distinct backend-driven labels.
- Distributor opportunities label Document Match as not applicable.
- Missing requirements prefer `opportunity_matches.missing_information`; when
  it is empty, the joined tender's existing `missing_information` is shown.

These rules preserve the product promise that unavailable evidence is never
presented as a completed analysis.

## 5. Session and security behavior

The app continues using same-origin `localStorage` keys `mh_p_token` and
`mh_p_refresh` through the existing session bridge:

1. Access tokens authenticate PostgREST and auth-user requests.
2. A 401 triggers the existing refresh-token request once.
3. Successful refreshes update the same keys.
4. Invalid sessions are cleared.
5. Signed-out users are directed to `VITE_LEGACY_PORTAL_URL`, which defaults
   to `/portal.html`.
6. All Tenders remains anonymous.

Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
`VITE_LEGACY_PORTAL_URL` are accepted as browser configuration. Never add
service-role keys, `sb_secret_*`, AI-provider keys, cron secrets, email secrets,
or any other private value to `VITE_*` variables.

## 6. Tests and verification

Tests cover:

- exact opportunity/tender data mapping;
- null score formatting without invented values;
- document Pending behavior without analyzed evidence;
- scored document behavior with evidence;
- signed-out, checking, no-company, and eligible logic;
- empty versus filtered-empty result logic;
- unsafe source-URL rejection;
- server-rendered Opportunity Score null-state output;
- all pre-existing All Tenders and saved-search behavior.

Run from `apps/portal-react`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## 7. Non-breaking staging procedure

1. Confirm the checkout is on `develop` and the working tree contains no
   unrelated edits.
2. Run all four verification commands.
3. Copy `.env.example` to `.env.local` and use only the existing public project
   URL/publishable key.
4. Build `apps/portal-react`; output remains isolated in its ignored `dist/`.
5. Upload `dist/` to a separate same-origin staging path such as
   `/portal-react/`. Relative Vite asset paths support this subdirectory.
6. Verify `#/all-tenders` while signed out.
7. Sign in through `/portal.html`, then open
   `/portal-react/#/my-opportunities` on the same origin.
8. Verify owned-company resolution, filters, title translation labels, pending
   document state, safe source links, load more, refresh, save/contacted, and a
   disposable dismiss test only if an appropriate test match exists.
9. Verify `/portal.html` independently, including login, matching-profile edit,
   Find matches, deep analysis, and document upload.
10. Keep `/portal.html` as the production entry point. Do not deploy or change
    production routing as part of this source migration.

## 8. Rollback

No data or production route migration exists, so rollback is isolated:

- stop serving or remove the staged `/portal-react/` build;
- leave `portal.html` and every root HTML file in place;
- leave all Supabase migrations, tables, RLS policies, RPCs, Storage objects,
  and Edge Functions unchanged;
- revert the My Opportunities source commit if repository rollback is needed.

Previously persisted workflow changes made by an authenticated tester through
`set_opportunity_match_status` are normal existing data and are not undone by
removing the React build. Reset them through the existing portal/RPC if a test
record was intentionally changed.

## 9. Functionality that remains in the legacy portal

The following is intentionally not migrated in this step:

- login, registration, logout UI, role selection, and onboarding;
- company profile and matching-profile editing, including the matching CPV
  catalog picker and profile readiness dashboard;
- AI opportunity analysis, deep tender analysis, lot/product evidence views,
  English analysis translation, and risk-review prompts;
- document discovery, queueing, BYOD upload, registration, and re-analysis;
- the main dashboard, products, catalogs, certificates, RFQ inbox, buyer
  portal, AI assistant, and unread-message flows;
- admin, public company/product pages, and the separate matchmaking page.

Each remains reachable and fully functional through `/portal.html` or its
existing production page. This commit does not remove, redirect, or edit any
of those files.

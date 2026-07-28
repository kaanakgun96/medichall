# MedicHall Portal Backend Compatibility Report

**Date:** 2026-07-28
**Repository:** `kaanakgun96/medichall`
**Branch:** `react-migration`
**Source HEAD:** `c474ca230f93ea16bb91abb6c2e51e6af77ed80b`
**Production Supabase project:** `azdmuarzntzqdyirysux`

## Result

The existing portal backend is reconciled and compatible with the checked-in
HTML callers. No portal-referenced table, RPC, or Edge Function exists only in
source: every required object is deployed and visible through the production
API.

One authorization drift was found and fixed before Matchmaking Workspace work:
six mutating RPCs that are authenticated-only in repository migrations still
had explicit production `EXECUTE` grants for `anon`. Migration
`202607280001_portal_backend_compatibility.sql` is applied in production and
recorded in `supabase_migrations.schema_migrations`.

No Matchmaking Workspace feature implementation was started as part of this
reconciliation.

## Scope and verification method

The inventory was derived from the production frontend entry point
`portal.html` and the existing two-sided matchmaking page
`matchmaking.html`.

Production verification used:

- read-only PostgreSQL catalog queries through the Supabase Management API;
- the production PostgREST OpenAPI catalog;
- zero-row PostgREST requests for every table and embedded relationship used
  by the current HTML;
- production Edge Function deployment metadata;
- HTTP `OPTIONS` and unauthenticated `POST` checks for every Edge Function
  called by `portal.html`;
- authenticated-role SQL probes executed inside explicit `BEGIN` / `ROLLBACK`
  transactions; and
- before/after aggregate counts to confirm that compatibility probes persisted
  no application data.

## Production objects

### Tables and RLS policies

All 18 referenced tables exist, are PostgREST-visible, have RLS enabled, and
returned HTTP 200 for zero-row contract checks.

| Table | Portal use | Production policies | Result |
|---|---|---|---|
| `companies` | Partner profile read/create/update; relationship lookups | `admin all companies`; `owner insert own company`; `owner read own company`; `owner update own company`; `public read companies` | Pass |
| `buyer_profiles` | Buyer profile read/create/update | `admin read buyer profiles`; `buyer manage own profile` | Pass |
| `company_certificates` | Certificate CRUD | `admin all certificates`; `owner manage certificates`; `public read certificates` | Pass |
| `company_catalogs` | Catalog CRUD | `admin all catalogs`; `owner manage catalogs`; `public read catalogs` | Pass |
| `products` | Product update/delete and favorite relationship | `admin all products`; `owner manage own products`; `public read products` | Pass |
| `rfq_requests` | Buyer/manufacturer RFQ inbox | `admin delete rfq`; `admin read rfq`; `buyer read own rfq`; `owner read own rfq`; `public insert rfq` | Pass |
| `rfq_offers` | Offer read/upsert | `admin all offers`; `buyer read offers`; `manufacturer manage own offers` | Pass |
| `favorites` | Buyer favorite read/delete | `user manages own favorites` | Pass |
| `rfq_messages` | Participant message read/create/update | `participants read messages`; `participants send messages`; `participants update messages` | Pass |
| `company_match_profiles` | Opportunity matching profile read/upsert | `admin manage match profiles`; `owner manage own match profile` | Pass |
| `opportunity_matches` | Owned opportunity read and embedded relationships | `admin manage opportunity matches`; `owner read own opportunity matches` | Pass |
| `distributor_candidates` | Embedded opportunity relationship | `admin manage distributors`; `members read active distributors` | Pass |
| `tenders` | Feed fallback and embedded opportunity relationship | `admin manage tenders`; `members read open tenders` | Pass |
| `saved_searches` | Authenticated CRUD | `saved_searches_own` | Pass |
| `matchmaking_profiles` | Match profile read/upsert | `authenticated view active matchmaking profiles`; `users create own matchmaking profile`; `users update own matchmaking profile` | Pass |
| `matchmaking_matches` | Owned generated match read | `users view own generated matches` | Pass |
| `business_connections` | Participant connection read | `participants view business connections` | Pass |
| `matchmaking_meeting_requests` | Participant meeting read | `participants view meeting requests` | Pass |

The exact relationship selectors used by the portal also returned HTTP 200:

- `favorites -> products`;
- `opportunity_matches -> tenders, distributor_candidates`;
- `matchmaking_matches -> target matchmaking_profiles`;
- `business_connections -> requester/recipient matchmaking_profiles`; and
- `matchmaking_meeting_requests -> requester/recipient matchmaking_profiles`.

The four matchmaking tables, their foreign keys, score/status constraints, and
the partial unique active-connection index match
`202607120001_two_sided_matchmaking.sql`.

### RPC compatibility

Every RPC referenced by the current portal exists with the expected signature
and is visible in the production PostgREST schema.

| RPC | Intended caller | Verification | Result |
|---|---|---|---|
| `search_tenders` | Anonymous/authenticated | Anonymous HTTP 200; rollback role probe | Pass |
| `tender_filter_facets` | Anonymous/authenticated | Anonymous HTTP 200; rollback role probe | Pass |
| `cpv_catalog_with_counts` | Anonymous/authenticated | Anonymous HTTP 200; rollback role probe | Pass |
| `refresh_company_opportunity_matches` | Authenticated/service role | Authenticated rollback probe | Pass |
| `set_opportunity_match_status` | Authenticated/service role | Authenticated rollback probe | Pass |
| `get_tender_lot_matches_v1` | Authenticated/service role | Authenticated rollback probe | Pass |
| `register_uploaded_tender_documents` | Authenticated/service role | Authenticated rollback probe | Pass |
| `get_tender_document_analysis_progress_v3` | Authenticated/service role | Authenticated rollback probe | Pass |
| `refresh_matchmaking_matches` | Authenticated/service role | Authenticated rollback probe | Pass |
| `request_business_connection` | Authenticated/service role | Authenticated rollback probe | Pass |
| `respond_business_connection` | Authenticated/service role | Authenticated rollback probe | Pass |
| `request_matchmaking_meeting` | Authenticated/service role | Authenticated rollback probe | Pass |

The authenticated matchmaking probe exercised the current lifecycle in one
rolled-back transaction:

1. refresh matches;
2. update the caller's own matchmaking profile through RLS;
3. request a business connection;
4. accept it as the recipient;
5. request a meeting; and
6. read the connection and meeting as a participant.

Every step passed. Production counts remained unchanged after rollback.

### Edge Functions

All three Edge Functions referenced by `portal.html` are deployed and active.
Live `verify_jwt` settings match `supabase/config.toml`.

| Edge Function | Production version | Auth contract | HTTP checks | Result |
|---|---:|---|---|---|
| `product-profile` | 1 | `verify_jwt=false`; validates the user JWT in-function | `OPTIONS 200`; unauthenticated `POST 401` | Pass |
| `medichall-ai` | 6 | Platform JWT verification enabled | `OPTIONS 200`; unauthenticated `POST 401` | Pass |
| `tender-document-engine` | 24 | `verify_jwt=false` for preflight; validates partner JWT in-function | `OPTIONS 204`; unauthenticated `POST 401` | Pass |

## Repository regression validation

The current incident-prescribed tender and portal checks are green:

- Deno format and lint checks passed for the canonical
  `tender-document-engine` files;
- Deno type checks passed;
- 72 Deno Edge/shared tests passed;
- React portal type checking and linting passed;
- 73 React portal tests passed; and
- the React production build completed successfully.

The older `scripts/check-phase0-readiness.mjs` gate still fails on this baseline
HEAD because it expects the pre-CORS-hotfix document-engine source hashes,
direct Supabase import layout, and platform JWT setting. Those assertions
predate the deployed `tender-document-engine` v24 contract documented in
`docs/incidents/tender-document-engine-cors-503.md`. This reconciliation did
not rewrite historical Document Intelligence manifests; the live endpoint and
the current incident test suite were verified instead.

## Reconciliation applied

Production previously granted `EXECUTE` to `anon` on:

- `refresh_company_opportunity_matches(bigint)`;
- `set_opportunity_match_status(bigint,text)`;
- `refresh_matchmaking_matches(uuid)`;
- `request_business_connection(uuid,text)`;
- `respond_business_connection(bigint,text)`; and
- `request_matchmaking_meeting(uuid,timestamptz,timestamptz,text,text)`.

This contradicted the repository's authenticated-only contract. The functions'
internal ownership checks prevented anonymous state changes, but anonymous
callers could still enter the security-definer functions.

Migration `202607280001_portal_backend_compatibility.sql` now:

- asserts that all six required RPC signatures exist;
- revokes execution from `PUBLIC` and `anon`;
- preserves execution for `authenticated` and `service_role`; and
- reloads the PostgREST schema cache.

Post-deployment checks confirm:

- `anon_execute = false` for all six functions;
- `authenticated_execute = true`;
- `service_role_execute = true`; and
- anonymous HTTP calls are rejected with HTTP 401 / SQLSTATE `42501`.

## Compatibility decision

The current backend is ready for Matchmaking Workspace implementation. New
work can build on the existing tables and four callable matchmaking RPCs
without first repairing a missing production object.

This report does not claim that the existing meeting model implements the new
workspace lifecycle. Multiple proposals, counter-proposals, calendar events,
video sessions, timeline events, and follow-up records remain new-feature
schema/workflow work.

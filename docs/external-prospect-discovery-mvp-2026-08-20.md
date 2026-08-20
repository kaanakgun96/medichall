# External Prospect Discovery MVP

Date: 2026-08-20
Branch: `react-migration`
Production project: `azdmuarzntzqdyirysux`
Release state: local implementation only; production approval required

## Product contract

External Prospects is a separate Matchmaking workspace for public European
business entities that are not MedicHall members. It does not replace either
MedicHall member matches or Tender Opportunities. It performs discovery only:
there is no email, messaging, invite, outreach, auto-registration, or contact
harvesting.

The three product layers remain:

1. MedicHall Companies — registered member matchmaking.
2. External Prospects — public-source companies not yet on MedicHall.
3. Tender Opportunities — public procurement opportunities and evidence.

## Existing architecture reused

- `companies`, `products`, `matchmaking_profiles`, and
  `company_match_profiles` provide manufacturer intent.
- `medical_product_taxonomy`, `product_taxonomy_mappings`, and existing CPV
  fields provide the semantic bridge. The existing taxonomy score is not
  changed.
- The current hardened `company_owner_authorized_v1` and `is_admin` boundaries
  protect tenant and Admin RPCs.
- `safe-public-fetch.ts` supplies HTTPS-only, DNS-rebinding-resistant,
  redirect-bounded public fetches.
- `isPathAllowedByRobots` supplies website robots decisions.
- the existing TED Search API integration pattern supplies procurement award
  data.
- first-party Traffic Analytics receives only fixed aggregate event names.
- both current production Matchmaking surfaces use the same
  `external-prospects.js` and `external-prospects.css` implementation.

Before implementation, the production read-only tender/matchmaking regression
matrix passed 10/10 checks, including normal-company tender search/detail,
canonical lots, lot matches, workspace, and private-company RPC access.

## Data flow

Manufacturer profile and active products
→ approved taxonomy mappings and bounded CPV/canonical-name intent
→ tenant-owned manual run gate
→ official TED and country-specific public-registry adapters
→ optional bounded official-website verification respecting robots
→ entity normalization
→ MedicHall-member and external-entity deduplication
→ deterministic evidence eligibility and 0–100 score
→ global evidence plus tenant-private match/workflow state
→ shared Matchmaking workspace and aggregate-only Admin metrics.

No discovery work runs during an ordinary page load. The browser retrieves only
cached workspace rows until a manufacturer explicitly selects **Discover
prospects**.

## Data model

Global public-business layer:

- `external_companies`
- `external_company_evidence`
- `external_company_taxonomy`
- `external_company_activities`

Tenant-private layer:

- `external_prospect_discovery_runs`
- `company_external_prospect_matches`
- `external_prospect_feedback`

The global entity stores public legal-company and provenance data. It contains
no personal contact field. Scores, reasons, saved/dismissed state, and private
notes remain company scoped.

External entities are looked up by official registry identifier and country,
normalized website domain, then Unicode-safe normalized name and country.
Unique indexes prevent duplicate active domains, name/country fallbacks, and
registry identifiers. A company registration trigger promotes a matching
external entity to `ON_MEDICHALL` and future external workspaces prefer the
MedicHall member without deleting historical evidence, feedback, or notes.

## Evidence and activity-code model

Supported provenance types:

- `COMPANY_WEBSITE`
- `PRODUCT_CATALOGUE`
- `TED_AWARD`
- `ASSOCIATION_DIRECTORY`
- `EXHIBITOR_DIRECTORY`
- `PUBLIC_REGISTRY`
- `OTHER_PUBLIC_SOURCE`

Each evidence row retains the public source URL/domain, bounded title/snippet,
taxonomy/CPV signals, confidence, source dates, verification state, and a
stable source hash. Full webpage copies are not retained. Snippets reject email
coordinates at the database boundary and server-side sanitization removes
email/phone-like content before persistence.

Evidence is explicitly classified as:

- `DIRECT_PRODUCT_EVIDENCE`
- `INDIRECT_COMMERCIAL_EVIDENCE`
- `WEAK_CONTEXT`

An official activity code is always indirect. It can establish commercial
relevance but can never prove ownership, distribution, or present availability
of an exact product.

### Initial official registry adapters

| Country | Provider | Public endpoint | Classification | Internal normalization |
| --- | --- | --- | --- | --- |
| France | Recherche d'entreprises | `recherche-entreprises.api.gouv.fr` | NAF/APE | NACE Rev. 2 where safely mappable |
| Norway | Brønnøysundregistrene Enhetsregisteret | `data.brreg.no` | SN2007 | NACE Rev. 2 |

Adapters preserve the national code, national classification, jurisdiction,
provider, legal registry identifier, activity description, and any safe NACE
mapping. Additional countries require a separate provider/licensing review and
adapter; the design does not assume a single European registry.

### Hidden distributor rule

A company without an exact website-product phrase may qualify only when it has
multiple independent indirect signals, for example an official medical
wholesale activity plus a related TED award. The explanation says that there
is strong evidence of activity in related categories and explicitly avoids the
claim that the company sells the exact product.

High-confidence eligibility requires either one strong direct signal or at
least two independent indirect source/provider signals. Generic healthcare
text or generic keyword overlap alone is rejected.

## Deterministic score

| Component | Maximum |
| --- | ---: |
| Product/taxonomy fit | 40 |
| Geography fit | 15 |
| Company-type fit | 15 |
| Procurement/TED signal | 15 |
| Evidence quality | 10 |
| Recency | 5 |
| Total | 100 |

Exact taxonomy is stronger than parent/child, sibling, or family mapping.
Repeated relevant awards receive more procurement weight than one award.
Evidence older than 24–36 months remains visible but receives lower/no recency
weight. A score is stored only with its complete component sum, reason summary,
structured reasons, provenance, and freshness state.

## Public-source strategy and limits

MVP enabled sources:

- official TED Search API award notices;
- the France and Norway official registry adapters when those countries are in
  target markets;
- official websites supplied by TED winners, after safe-URL and robots checks.

Hard per-run limits:

- 4 deduplicated discovery queries;
- 25 TED rows per query;
- 30 final company candidates;
- 6 concurrent website checks;
- 10 registry requests maximum (each adapter currently emits at most 2);
- 12-second public-request timeout;
- 512 KB website body and 1 MB structured-response body limits.

The current implementation uses no paid search or AI provider. Paid provider
requests, AI classifications, and estimated cost are database-constrained to
zero. The manual gate enforces UUID idempotency, 24-hour intent reuse,
30-minute cooldown, 3 runs/day, and 20 runs/month per company.

## Job and failure behavior

Run states are `QUEUED`, `RUNNING`, `PARTIAL`, `COMPLETED`, and `FAILED` with
bounded diagnostics. TED, registry, or website failures are converted to
partial results when other evidence succeeds. Raw provider errors are not
returned. Logs contain a run UUID and redacted error code only.

The MVP completes one bounded manual job in the Edge request and does not use
high-frequency polling. A durable background worker and scheduled refresh are
Phase 2 items if more/larger providers are approved.

## RLS and access matrix

| Actor | Global raw tables | Tenant runs/matches/notes | Workspace RPC | Admin metrics |
| --- | --- | --- | --- | --- |
| Anonymous | denied | denied | denied | denied |
| Company A | denied | company A through security-definer RPC only | company A | denied |
| Company B | denied | company B through security-definer RPC only | company B | denied |
| Admin | aggregate-safe access through current Admin boundary | authorized | authorized | aggregate only |
| Service role | migration/Edge writes | migration/Edge writes | callable | callable |

All seven new tables have RLS enabled and forced. Browser roles receive no raw
mutation grants. Private notes are returned only through the owner/admin RPC;
Admin observability returns counts/source mix only and no names, URLs, notes,
or contact coordinates.

## UX

The shared workspace provides:

- explicit External prospect / Not yet on MedicHall / freshness badges;
- country, target-market, company-type, minimum-score, evidence, freshness,
  workflow, and text filters;
- relevance, recency, procurement, country, and name sorting;
- complete score breakdown and direct/indirect evidence labels;
- public website and provenance links with `noopener noreferrer`;
- save, interesting, dismiss, and private-note actions;
- manual discovery, cached-result, partial/failure, and real job-stage states;
- no private contact coordinate or outreach control.

The private-note action is `NOTE_ONLY` and does not silently change saved or
dismissed workflow state.

## Admin and first-party analytics

Admin adds an aggregate External Prospect Discovery view with entity, match,
new-discovery, evidence, stale-evidence, registry-activity, source-mix,
workflow, run, failure, and zero-cost metrics. It exposes no prospect detail.

Fixed analytics events:

- `external_prospect_discovery_started`
- `external_prospect_discovery_completed`
- `external_prospect_viewed`
- `external_prospect_saved`
- `external_prospect_dismissed`
- `external_prospect_website_clicked`

No prospect name, URL, evidence, query, or note is included in analytics.

## Validation evidence

- Production regression gate: 10/10 current normal-company tender and
  matchmaking queries passed, read-only.
- Linked migration dry run: only
  `202608200003_external_prospect_discovery.sql` proposed.
- Fresh local installation: full ordered migration chain applied through
  `202608200003` successfully.
- Rollback-only SQL/RLS matrix: passed for anonymous, company A, company B,
  and Admin, including idempotency, rate limits, tenant notes, promotion, and
  zero-cost/contact constraints.
- Local DB lint: no new migration warnings; two unrelated pre-existing
  function warnings remain documented outside this workstream.
- Deno unit/boundary suite: scoring, source failure, registry normalization,
  hidden distributor, privacy redaction, deduplication, origin/auth boundaries,
  and analytics allowlist.
- React/Vitest and Node static contracts: shared surface integration and no
  outreach/contact regression.
- TypeScript, ESLint, Deno check/lint/fmt, credential scan, and diff checks are
  release gates.
- Responsive browser QA: 1440×1000 and 390×844; zero horizontal overflow,
  evidence expansion and filters usable, zero console warnings/errors.

Free official-source acceptance evidence was fetched in memory only:

- one TED query returned five current award notices with real legal awardee
  companies and relevant CPV evidence;
- one French official-registry query returned five active legal companies with
  activity code `46.46Z`;
- official requests: 2; paid requests: 0; estimated cost: $0;
- no result was written to production or retained as a QA record.

## Independent deployment order

Nothing in this MVP has been deployed automatically.

1. Take the repository-standard restricted production database backup.
2. Run linked migration dry run and require exactly
   `202608200003_external_prospect_discovery.sql`.
3. Apply only that migration.
4. Run `supabase/tests/external_prospect_discovery.sql` in a rollback-only
   production-compatible transaction where permitted.
5. Deploy only Edge Function `external-prospect-discovery` using the current
   application-level JWT configuration in `supabase/config.toml`.
6. Redeploy only the existing `traffic-analytics` Edge Function from this
   release so its allowlist accepts the six new aggregate event names. This is
   an allowlist-only extension; it does not change its persistence or privacy
   model.
7. Verify OPTIONS 204, origin rejection, unauthenticated POST rejection, a
   manufacturer-authenticated zero-paid-provider bounded discovery, and one
   accepted event per new analytics name without notifications or email.
8. Upload the independent cPanel frontend patch in this order:
   `external-prospects.css`, `external-prospects.js`, `medichall-traffic.js`,
   `matchmaking-workspace.js`, `matchmaking.html`, `admin.html`, `portal.html`.
9. Smoke-test Portal and standalone Matchmaking at desktop and 390px, then
   Admin aggregate metrics.

## Rollback

- Before migration apply: no database action is required.
- After migration but before user data: deploy a separately reviewed
  forward-only rollback migration that revokes/drops the four RPCs, seven
  tables in dependency order, triggers/functions/indexes, and removes only the
  six new analytics event values. Do not edit migration history.
- Edge rollback: redeploy the immediately previous versions of
  `external-prospect-discovery` and `traffic-analytics`, or remove the new
  discovery route only after frontend rollback.
- cPanel rollback: restore the seven backed-up public files with their original
  hashes, in reverse upload order. The backend can remain dormant because
  discovery never runs on page load.
- If real prospect rows exist, export them before any schema rollback; do not
  drop data without separate approval.

## Compliance assumptions and limitations

- Company registry and procurement records are public business evidence, not
  natural-person profiles. Provider terms, database rights, retention, and
  correction/removal procedures still require country-by-country legal review.
- Initial registry coverage is France and Norway only. Germany, Italy, and
  other countries currently rely on TED/public websites until separately
  approved adapters exist.
- Official registry activities are indirect and broad; they do not prove an
  exact product relationship.
- TED winner fields vary by notice/language and may omit country, identifier,
  or website. Missing values are never fabricated.
- No catalogue/directory provider beyond official TED/registry/website sources
  is enabled in this MVP.
- AI classification, scheduled refresh, durable background workers, invites,
  contact-page discovery, outbound communication, and CRM functionality are
  intentionally deferred.

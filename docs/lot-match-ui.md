# Lot-level tender match UI

## Canonical frontend and integration point

The production partner portal is the self-contained root `portal.html`.
`apps/portal-react` remains an incremental migration and is not the live
partner-portal entry point yet.

The lot-match UI is integrated into the existing opportunity-card detail
panel in two ways:

1. **View lot analysis** opens the read-only lot results without starting
   document analysis.
2. A completed, user-initiated **Deep analysis** appends the same lot section
   below the existing tender analysis.

The structured product form and all legacy opportunity, document, translation,
upload, AI-assistant, and source-link behavior remain present.

## Authenticated data flow

The UI reuses the current legacy session:

- bearer token: `mh_p_token`;
- current user: Supabase `/auth/v1/user`;
- authorized company: the existing `companies.owner_id = auth.uid()` lookup;
- current company ID: `COMPANY.id`.

It calls only:

```text
POST /rest/v1/rpc/get_tender_lot_matches_v1
{
  "p_company_id": COMPANY.id,
  "p_tender_id": selectedTender.id
}
```

The request uses the existing public Supabase URL, publishable/anon key, and
the signed-in user's bearer token. It contains no service-role key, database
credential, fixed company ID, fixed tender ID, or other private secret.

The RPC performs its own company-owner/admin authorization and returns:

- `company_id`, `tender_id`, and `calculation_version`;
- `lots[].lot_key`, `lot_number`, `lot_title`, and `status`;
- backend `match_score`, `recommendation`, and `confidence_score`;
- best company product ID and name;
- score components;
- matched requirements, blockers, gaps, and unknowns;
- tender and company evidence;
- calculation error and timestamp metadata.

The browser validates the returned company/tender scope. It does not query the
private match table directly.

## Display and business rules

All scores and component values are displayed exactly as returned. The
frontend does not recreate or adjust the deterministic backend calculation.

Relevant results are exactly:

- `strong_match`;
- `good_match`; and
- `possible_match`.

`weak_match` and `not_recommended` remain visible but do not affect the
highest relevant result. The summary deliberately does not show an average,
so numerous irrelevant lots cannot visually dilute or inflate the strongest
commercially relevant result.

The five user labels are:

- Strong match
- Good match
- Possible match
- Weak match
- Not recommended

When extraction does not establish a lot number, the UI says:

> Extracted product group — no reliable lot number found

It never invents a lot number or assigns ambiguous evidence to a numbered lot.

Matched requirements, blockers, gaps, and unknown/verification items are
rendered as separate groups. Evidence is deduplicated by document, location,
field, quote, and extracted value, retaining the strongest returned confidence
for a duplicate. The UI shows page, sheet/cell when present, field, extracted
value, quote, and confidence. Evidence text is escaped, initially shortened,
and expandable; no raw JSON, storage path, or private calculation input is
shown.

Product readiness comes from the existing `product-profile` response
(`matching_readiness`). Incomplete matched products show their backend
readiness and critical missing fields with an **Edit matched product** action
that opens the existing structured product form. The browser does not
recalculate readiness.

## States

The section has explicit states for:

- loading skeletons;
- signed-out/session-required access;
- missing public configuration;
- missing RPC migration;
- extraction currently processing;
- no persisted document analysis;
- completed extraction with no lot-match rows;
- company with no active products;
- incomplete matched product profile;
- partially failed lot analysis while preserving completed siblings;
- product-readiness request failure while preserving lot results;
- request/backend errors; and
- retry/refresh.

Opening or refreshing the section performs read requests only. It never calls
Document Intelligence, the AI provider, `tender-document-engine`, or
`tender-lot-matching` refresh actions, and it never creates/restarts jobs or
chunks.

## Accessibility and responsive behavior

- The section and result cards use semantic headings and articles.
- All disclosures are keyboard-operable buttons with `aria-expanded` and
  `aria-controls`.
- Existing visible focus styles apply.
- Loading and state messages use status/live semantics.
- Evidence and long names wrap without exposing horizontal-only layouts.
- Summary and result grids collapse to one column on small screens.
- Lot UI styles use no fixed positive minimum card/table widths.

## Tests and verification

The Vitest suite reads the exact marked production functions from
`portal.html`, so the tested mapping and rendering logic is the code shipped
to cPanel. Coverage includes:

- all five recommendation labels;
- unassigned and numbered display labels;
- relevant counts and highest-relevant selection;
- absence of a misleading average;
- separate matched/blocker/gap/unknown groups;
- evidence deduplication, escaping, truncation, and disclosure accessibility;
- failed/partial results;
- signed-out, configuration, processing, no-analysis, and empty eligibility;
- readiness and no-product states;
- the exact owner-scoped RPC;
- absence of service-role/private runtime IDs and document/AI calls;
- responsive width safeguards; and
- structured-product-form regression fields.

Run from `apps/portal-react`:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Production-safe validation fixture

When an authorized partner session for the controlled fixture is available,
the read-only UI request for tender `2952` and its owning company should show:

- 12 persisted results;
- highest relevant result: score 77, Good match;
- the unassigned extracted group for the two-layer surgical drape;
- the matched surgical-drape validation product;
- no blocker on that highest result;
- production capacity as unknown;
- evidence from pages 1, 41, and 42.

Validation must only read the existing RPC result. Do not refresh matching,
start analysis, upload documents, create chunks, or call an AI provider merely
to test this UI.

## cPanel replacement (non-developer guide)

This repository is **Case A**: the production portal is one self-contained
HTML file. The upload artifact is a complete replacement `portal.html`; the
owner must not copy snippets or edit code in cPanel.

1. Sign in to cPanel and open **File Manager**.
2. Open `public_html`.
3. Select the current `portal.html` and download it as a backup.
4. Rename the server copy to
   `portal.html.backup-before-lot-match-ui-2026-07-27`.
5. Upload the provided complete `portal.html` artifact into `public_html`.
6. Confirm the uploaded filename is exactly `portal.html`.
7. Open `/portal.html`, sign in, open **Opportunities**, and select
   **View lot analysis** on a tender.
8. If verification fails, delete only the newly uploaded `portal.html` and
   rename the backup to `portal.html`.

No database, Supabase, Edge Function, cron, Vault, secret, or production data
change is part of this frontend upload.

## Rollback

Frontend rollback is file-only:

1. restore the backed-up `public_html/portal.html`;
2. clear any cPanel/CDN file cache if one is enabled; and
3. verify login, Opportunities, products, and the legacy Deep analysis flow.

Do not roll back database migrations, delete match rows, or redeploy backend
functions to remove this UI. The backend contract remains independently
compatible.

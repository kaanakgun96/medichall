# Sprint 3 — Onboarding, profile activation, and first value

Date: 2026-08-09

Branch: `react-migration`

Production project: `azdmuarzntzqdyirysux`

## Audit outcome

MedicHall already had the canonical records needed for onboarding: `companies`,
`buyer_profiles`, structured `products`, `company_match_profiles`,
`matchmaking_profiles`, `matchmaking_matches`, and `opportunity_matches`. Sprint 3
does not create a competing company, buyer, product, preference, or match model.
It adds only a user-owned resume/dismiss record and derives completion from those
existing records.

The former portal readiness meter was client-only, manufacturer-oriented, and
based on five fields that happened to be loaded in the browser. It could not
resume across devices, did not support distributors or organizational buyers,
and did not prove first value from real matches.

## Account and role behavior

- Manufacturer and supplier-style companies receive company, logo,
  certification, product, tender-preference, and matchmaking tasks.
- Distributors use the same canonical company surface, with a distributor role
  and copy. No manufacturer-only record is created.
- A buyer that has a `buyer_profiles` record receives buyer profile, product
  interest, market, and matchmaking tasks.
- A company whose real type identifies it as a buyer, hospital, or procurement
  organization receives an organizational-buyer checklist. It is never asked
  to manufacture a product, add manufacturing certification, or configure
  tender-selling preferences.
- Existing users enter their current dashboard. The guide is non-blocking and
  can be hidden or resumed; completed records are detected automatically.

## Deterministic profile-strength formula

All scores are returned by `get_account_activation_state_v1()` and clamped to
0–100. The portal does not calculate a second score.

### Manufacturer, distributor, supplier, or general company

| Evidence | Weight |
| --- | ---: |
| Authenticated account | 10 |
| Company information: name, type, country, description of at least 40 characters | 20 (5 each) |
| Company logo | 10 |
| Certification text or uploaded certificate | 10 |
| At least one structured product | 20 |
| Target markets | 8 |
| Product keywords or CPV categories | 7 |
| Matchmaking profile | 7; rises to 15 at 60% completeness |

### Organizational buyer company

| Evidence | Weight |
| --- | ---: |
| Authenticated account | 15 |
| Company information | 20 |
| Company logo | 10 |
| Matchmaking profile | 10; rises to 25 at 60% completeness |
| Product interests or categories | 15 |
| Supplier or served markets | 15 |

### Buyer profile

| Evidence | Weight |
| --- | ---: |
| Authenticated account | 15 |
| Full name | 20 |
| Country | 15 |
| Matchmaking profile | 10; rises to 25 at 60% completeness |
| Product interests or categories | 15 |
| Supplier or served markets | 10 |

First-company-match and first-tender-match tasks carry zero score. They are
activation outcomes, not profile evidence, and complete only after the real
match status leaves `new`. Counts shown in the guide come directly from current
match rows; no synthetic counts or promises are displayed.

## Security and compatibility

- Both RPCs derive tenant scope only from `auth.uid()` and accept no company or
  user identifier.
- Anonymous table and function access is revoked.
- Row-level security restricts progress records to their owner.
- `account_onboarding_progress` stores only display progress; business facts
  remain canonical and auto-update the checklist after relevant mutations.
- Failure of the optional activation RPC is reported through redacted internal
  diagnostics and never blocks the existing portal.

## Validation contract

`supabase/tests/onboarding_activation.sql` creates isolated manufacturer,
distributor, and buyer fixtures inside one transaction. It verifies role
classification, exact scores, actual first-value counts, dismiss/resume state,
anonymous denial, and cross-user isolation, then rolls everything back.

`scripts/sprint3-onboarding-activation.test.mjs` protects the portal/RPC contract
and ensures the SQL regression remains rollback-only.

## Production deployment and QA

- Restricted pre-deployment schema-only backup: `public` and `storage`,
  565,138 bytes, SHA-256
  `23ec15c33b55d80becdfa4810abc0f58eae2bf2db3b5d28827a0b16bfc40365e`.
  It is held outside the repository and contains no `COPY` or `INSERT` row-data
  statements.
- Linked dry run proposed exactly
  `202608090001_onboarding_activation.sql`.
- The complete migration ran successfully once with its final `COMMIT`
  mechanically changed to `ROLLBACK`, then the canonical migration was applied.
- The exact SQL regression ran against production and rolled back its three
  synthetic users, two companies, one buyer profile, three matchmaking
  profiles, one product, one tender, two matches, and progress state.
- Manufacturer: derived role `manufacturer`, deterministic strength 100,
  one real fixture company match, one real fixture tender match, and no forced
  onboarding restart.
- Distributor: derived role `distributor`, incomplete profile remained below
  the 70% ready threshold, and another user's progress was not visible.
- Buyer: derived role `buyer`, deterministic strength 100, and no product,
  logo, certification, or tender-selling task was returned.
- Post-QA orphan counts: synthetic auth users `0`, synthetic companies `0`,
  progress rows `0`.
- Aggregate customer counts were unchanged by QA: auth users `6`, companies
  `6`, buyer profiles `2`, products `39`, matchmaking profiles `4`,
  matchmaking matches `5`, and opportunity matches `5,196`.
- Post-deployment linked dry run reported the remote database up to date.
- Production database lint returned zero errors.
- Anonymous table/RPC access was denied; authenticated RPC execution remained
  available. The production ledger advanced from 40 to 41 only for the intended
  migration.

The canonical frontend remains intentionally undeployed to cPanel until the
single coherent first-customer beta package is generated after Sprint 6.

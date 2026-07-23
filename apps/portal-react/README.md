# MedicHall React portal migration

This Vite application is an isolated migration surface for the existing
MedicHall Partner Portal. It currently contains **Dashboard**, **All Tenders**,
**Saved Searches**, **My Opportunities**, and **Company Profile**, with
hash-based internal navigation between them.

The static production application in the repository root remains unchanged.
Building this directory does not overwrite `portal.html` or any other live
HTML file.

## Requirements

- Node.js 22.12 or newer
- pnpm 11
- The existing Supabase migrations through
  `202607200003_saved_searches.sql`
- An authenticated manufacturer/company session for Dashboard, My Opportunities,
  and Company Profile

## Local setup

```bash
cd apps/portal-react
cp .env.example .env.local
pnpm install
pnpm dev
```

`.env.example` contains only the existing public Supabase project URL and
publishable browser key. Never add `SUPABASE_SERVICE_ROLE_KEY`, an
`sb_secret_*` key, cron secrets, or AI-provider secrets to a `VITE_*` variable.
Every `VITE_*` value is bundled into browser JavaScript.

The local dev server prints the URL to open. The production build uses
relative asset paths, so `dist/` may be served from a staging subdirectory.

## Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Authentication compatibility

The tender feed and CPV catalog use the existing anon-accessible RPCs. Saved
searches, Dashboard, My Opportunities, and Company Profile reuse the current
Partner Portal session keys, `mh_p_token` and `mh_p_refresh`, from same-origin
`localStorage`.

- All Tenders remains available anonymously.
- Dashboard reads the owned company, its first 50 ordered non-dismissed matches,
  RFQs, products, and matching profile through the existing RLS policies.
- My Opportunities reads the current user, resolves their owned `companies`
  row, and relies on existing RLS to return only that company's matches.
- Company Profile resolves the same owned company and edits only the current
  `companies` and `company_match_profiles` fields already supported by the
  production portal and RLS policies.
- Signed-out visitors are sent to `/portal.html`; login and registration are
  intentionally not migrated.
- Host staging on the same origin as `portal.html`, or the legacy session
  cannot be shared through `localStorage`.

## Source layout

```text
src/
├── app/                         application entry and shared styles
├── features/
│   ├── tenders/                 RPC mapping, hooks, filters, CPV, cards, states
│   ├── saved-searches/          RLS-backed saved-search CRUD and dialogs
│   ├── opportunities/           partner auth, match mapping, scores, cards, states
│   ├── dashboard/               legacy metrics, readiness, top matches, states
│   └── company-profile/         company and matching forms, CPV, readiness, states
└── shared/
    ├── api/                     typed Supabase HTTP client
    ├── auth/                    legacy session/refresh bridge
    ├── components/              reusable UI primitives and portal navigation
    ├── config/                  public runtime configuration guard
    ├── hooks/                   shared React hooks
    ├── routing/                 dependency-free internal hash routes
    └── utils/                   shared safe external-URL validation
```

For the full migration and deployment checklist, see
[`../../docs/REACT_ALL_TENDERS_MIGRATION.md`](../../docs/REACT_ALL_TENDERS_MIGRATION.md)
and
[`../../docs/REACT_MY_OPPORTUNITIES_MIGRATION.md`](../../docs/REACT_MY_OPPORTUNITIES_MIGRATION.md).
The Dashboard-specific audit, backend contract, staging, and rollback notes are
in [`../../docs/react-migration/dashboard.md`](../../docs/react-migration/dashboard.md).
The Company Profile form contract, legacy audit, validation, CPV behavior,
staging, and rollback notes are in
[`../../docs/react-migration/company-profile.md`](../../docs/react-migration/company-profile.md).

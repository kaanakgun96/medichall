# MedicHall React portal migration

This Vite application is an isolated migration surface for the existing
MedicHall Partner Portal. It currently contains **All Tenders** and
**My Opportunities**, with hash-based internal navigation between them.

The static production application in the repository root remains unchanged.
Building this directory does not overwrite `portal.html` or any other live
HTML file.

## Requirements

- Node.js 22.12 or newer
- pnpm 11
- The existing Supabase migrations through
  `202607200003_saved_searches.sql`
- An authenticated manufacturer/company session for My Opportunities

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
searches and My Opportunities reuse the current Partner Portal session keys,
`mh_p_token` and `mh_p_refresh`, from same-origin `localStorage`.

- All Tenders remains available anonymously.
- My Opportunities reads the current user, resolves their owned `companies`
  row, and relies on existing RLS to return only that company's matches.
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
│   └── opportunities/           partner auth, match mapping, scores, cards, states
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

# MedicHall React portal migration

This Vite application is an isolated migration surface for the existing
MedicHall Partner Portal. It currently contains only **All Tenders**.

The static production application in the repository root remains unchanged.
Building this directory does not overwrite `portal.html` or any other live
HTML file.

## Requirements

- Node.js 22.12 or newer
- pnpm 11
- The existing Supabase migrations through
  `202607200003_saved_searches.sql`

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
searches use the current Partner Portal session keys, `mh_p_token` and
`mh_p_refresh`, from same-origin `localStorage`. When those keys are absent,
the tender feed remains available and the page directs the user to the current
Partner Portal to sign in.

## Source layout

```text
src/
├── app/                         application entry and shared styles
├── features/
│   ├── tenders/                 RPC mapping, hooks, filters, CPV, cards, states
│   └── saved-searches/          RLS-backed saved-search CRUD and dialogs
└── shared/
    ├── api/                     typed Supabase HTTP client
    ├── auth/                    legacy session/refresh bridge
    ├── components/              reusable UI primitives
    ├── config/                  public runtime configuration guard
    └── hooks/                   shared React hooks
```

For the full migration and deployment checklist, see
[`../../docs/REACT_ALL_TENDERS_MIGRATION.md`](../../docs/REACT_ALL_TENDERS_MIGRATION.md).

# Supabase structural baseline

The executable MedicHall baseline is the ordered SQL history in
`supabase/migrations/`. A new project must never execute a root `supabase-*.sql`
file, anything in `supabase/setup/`, a dashboard snippet, a production dump, or
an operator-authored repair.

For a local Supabase stack:

```bash
supabase db reset
```

For an authorized, newly created empty remote project:

```bash
supabase link --project-ref <empty-project-ref>
supabase db push --include-all
```

The remote command is the documented substitute when Docker is unavailable.
Use a temporary work directory for staging links so the repository's production
link is never changed. Run `scripts/run-remote-sql-tests.ts` only against a
non-production project after the migration command completes.

The repository intentionally does not contain a live Supabase export. The
optional `scripts/export-supabase-baseline.sh` capture is comparison evidence,
not executable setup. It creates a sanitized, structural-only snapshot under
`supabase/baseline/live/`.

That output directory is ignored by Git. It may still contain sensitive
implementation details, so review it before sharing. The script never requests
or exports customer rows, API keys, authentication tokens, Edge Function
secrets, or cron command bodies.

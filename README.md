# MedicHall

MedicHall's current production frontend remains the static HTML application in
the repository root. Its Supabase database migrations and Edge Functions live
under `supabase/`.

The incremental React migration is isolated under
[`apps/portal-react`](apps/portal-react/README.md). The migrated surfaces are
**All Tenders**, **Saved Searches**, **My Opportunities**, **Dashboard**, and
**Company Profile**. The React application does not replace or modify
`portal.html`.

Migration documentation:

- [`docs/production-migration-sequencing-2026-08-01.md`](docs/production-migration-sequencing-2026-08-01.md)
- [`docs/database-baseline-reconstruction-2026-07-29.md`](docs/database-baseline-reconstruction-2026-07-29.md)
- [`docs/REACT_ALL_TENDERS_MIGRATION.md`](docs/REACT_ALL_TENDERS_MIGRATION.md)
- [`docs/REACT_MY_OPPORTUNITIES_MIGRATION.md`](docs/REACT_MY_OPPORTUNITIES_MIGRATION.md)
- [`docs/react-migration/dashboard.md`](docs/react-migration/dashboard.md)
- [`docs/react-migration/company-profile.md`](docs/react-migration/company-profile.md)
- [`docs/product-matching-readiness.md`](docs/product-matching-readiness.md)

Database setup is migration-only. Start an empty local project with
`supabase db reset`, or use the documented `supabase db push --include-all`
procedure for an empty isolated remote project when Docker is unavailable.
Historical root/setup SQL files are forensic references and must not be used as
installation steps.

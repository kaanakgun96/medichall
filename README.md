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

- [`docs/REACT_ALL_TENDERS_MIGRATION.md`](docs/REACT_ALL_TENDERS_MIGRATION.md)
- [`docs/REACT_MY_OPPORTUNITIES_MIGRATION.md`](docs/REACT_MY_OPPORTUNITIES_MIGRATION.md)
- [`docs/react-migration/dashboard.md`](docs/react-migration/dashboard.md)
- [`docs/react-migration/company-profile.md`](docs/react-migration/company-profile.md)

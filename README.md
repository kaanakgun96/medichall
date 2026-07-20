# medichall
# MedicHall

MedicHall's current production frontend remains the static HTML application in
the repository root. Its Supabase database migrations and Edge Functions live
under `supabase/`.

The incremental React migration is isolated under
[`apps/portal-react`](apps/portal-react/README.md). The first migrated surface
is **All Tenders** and the second is **My Opportunities**. Neither replaces or
modifies `portal.html`.

See [`docs/REACT_ALL_TENDERS_MIGRATION.md`](docs/REACT_ALL_TENDERS_MIGRATION.md)
for the branch audit, RPC compatibility map, setup, verification, deployment,
and rollback instructions. See
[`docs/REACT_MY_OPPORTUNITIES_MIGRATION.md`](docs/REACT_MY_OPPORTUNITIES_MIGRATION.md)
for the authenticated match contract, explainable-score behavior, staging,
and feature-level rollback plan.

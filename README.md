# medichall
# MedicHall

MedicHall's current production frontend remains the static HTML application in
the repository root. Its Supabase database migrations and Edge Functions live
under `supabase/`.

The incremental React migration is isolated under
[`apps/portal-react`](apps/portal-react/README.md). The first migrated surface
is **All Tenders**; it does not replace or modify `portal.html`.

See [`docs/REACT_ALL_TENDERS_MIGRATION.md`](docs/REACT_ALL_TENDERS_MIGRATION.md)
for the branch audit, RPC compatibility map, setup, verification, deployment,
and rollback instructions.

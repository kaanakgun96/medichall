# External registry coverage — database package

Production project (deployment approval required): `azdmuarzntzqdyirysux`

This package contains exactly one forward-only migration, its rollback-only SQL/RLS regression, and the migration sequencing gate updated for that one pending migration:

1. `supabase/migrations/202608200004_external_registry_coverage.sql`
2. `supabase/tests/external_registry_coverage.sql`
3. `supabase/observability/production-migration-sequence.json`
4. `scripts/check-migration-sequencing.mjs`

Before deployment, a linked production dry run must propose only migration `202608200004`. Stop if any other migration is proposed. Take the repository-required restricted backup, apply only this migration, and run the SQL test without removing its final `rollback`.

This task did not deploy the migration.

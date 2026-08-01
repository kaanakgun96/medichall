# Migration archive

Files in this directory are retained only to explain migration-history
reconciliation. The Supabase CLI does not execute them.

- `202607100005_match_engine_v2_scoring.sql` is preserved as the original
  source of the scoring block now consolidated into the canonical
  `supabase/migrations/202607100005_explainable_match_engine.sql`.
- `202607100006_ted_cron.sql` is a non-executable marker for the former
  duplicate-version cron migration. Cron is environment configuration and is
  now installed separately through `supabase/setup/CONFIGURE-CRON.sql`.
- `universal-tender-import/` preserves the byte-identical, intentionally
  undeployed Module 1 migrations. They must be reissued with new forward
  versions after the production head before any future controlled deployment.
- `superseded-production-drift/` preserves the unsafe metadata reconciliation
  that would have overwritten legitimate live verification state. Its safe,
  repository-metadata-only replacement is
  `202608010002_production_compatibility_and_metadata.sql`.

Do not move archived files back into `supabase/migrations`. Each numeric
migration version must remain unique, and previously absent versions must not
be inserted behind the current production head.

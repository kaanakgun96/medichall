# Migration archive

Files in this directory are retained only to explain migration-history
reconciliation. The Supabase CLI does not execute them.

- `202607100005_match_engine_v2_scoring.sql` is preserved as the original
  source of the scoring block now consolidated into the canonical
  `supabase/migrations/202607100005_explainable_match_engine.sql`.
- `202607100006_ted_cron.sql` is a non-executable marker for the former
  duplicate-version cron migration. Cron is environment configuration and is
  now installed separately through `supabase/setup/CONFIGURE-CRON.sql`.

Do not move either file back into `supabase/migrations`. Each numeric migration
version must remain unique.

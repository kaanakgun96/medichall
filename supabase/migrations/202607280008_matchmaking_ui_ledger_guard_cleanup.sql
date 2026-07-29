-- Remove the narrowly scoped compatibility guard installed immediately before
-- the historical 202607280007 migration.  The Supabase CLI has now recorded
-- that migration normally, so no persistent migration-ledger behavior remains.

begin;

drop trigger if exists ignore_legacy_ui_self_registration
on supabase_migrations.schema_migrations;

drop function if exists
  supabase_migrations.ignore_legacy_ui_self_registration();

commit;

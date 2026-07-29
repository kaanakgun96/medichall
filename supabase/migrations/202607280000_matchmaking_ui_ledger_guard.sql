-- Compatibility guard for the historical Matchmaking UI completion migration.
--
-- 202607280007 was originally executed through the SQL editor and therefore
-- contains a one-row self-registration statement.  During a normal CLI
-- migration run that statement races the CLI's own ledger registration and
-- makes an empty-project install fail with a duplicate primary key.  Preserve
-- the deployed migration file and ignore only its exact legacy marker row.
-- The following migration removes this guard immediately after 202607280007.

begin;

create or replace function supabase_migrations.ignore_legacy_ui_self_registration()
returns trigger
language plpgsql
security definer
set search_path = supabase_migrations, pg_temp
as $function$
begin
  if new.version = '202607280007'
     and new.name = 'matchmaking_ui_completion'
     and cardinality(new.statements) = 1
     and new.statements[1] =
       'matchmaking UI completion and global notification center' then
    return null;
  end if;

  return new;
end;
$function$;

drop trigger if exists ignore_legacy_ui_self_registration
on supabase_migrations.schema_migrations;

create trigger ignore_legacy_ui_self_registration
before insert on supabase_migrations.schema_migrations
for each row
execute function supabase_migrations.ignore_legacy_ui_self_registration();

commit;

\set QUIET 1
\pset footer off

begin;

create temporary table phase_zero_cron_inventory (
  job_id bigint,
  job_name text,
  schedule text,
  database_name text,
  username text,
  active boolean
) on commit drop;

do $$
begin
  if to_regclass('cron.job') is not null then
    execute $query$
      insert into phase_zero_cron_inventory (
        job_id,
        job_name,
        schedule,
        database_name,
        username,
        active
      )
      select
        jobid,
        jobname,
        schedule,
        database,
        username,
        active
      from cron.job
    $query$;
  end if;
end;
$$;

with inventory as (
  select
    'extension'::text as object_type,
    e.extname::text as schema_name,
    e.extversion::text as object_name,
    null::text as detail
  from pg_extension e

  union all

  select
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'partitioned_table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      when 'S' then 'sequence'
      else 'relation'
    end,
    n.nspname,
    c.relname,
    null
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage', 'cron')
    and c.relkind in ('r', 'p', 'v', 'm', 'S')

  union all

  select
    'column',
    cols.table_schema,
    cols.table_name || '.' || cols.column_name,
    concat_ws(
      ';',
      'type=' || cols.data_type,
      'nullable=' || cols.is_nullable,
      'default=' || coalesce(cols.column_default, '')
    )
  from information_schema.columns cols
  where cols.table_schema in ('public', 'storage', 'cron')

  union all

  select
    'constraint',
    n.nspname,
    c.relname || '.' || con.conname,
    pg_get_constraintdef(con.oid, true)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage', 'cron')

  union all

  select
    'index',
    schemaname,
    tablename || '.' || indexname,
    indexdef
  from pg_indexes
  where schemaname in ('public', 'storage', 'cron')

  union all

  select
    'policy',
    schemaname,
    tablename || '.' || policyname,
    concat_ws(
      ';',
      'command=' || cmd,
      'roles=' || array_to_string(roles, ','),
      'using=' || coalesce(qual, ''),
      'check=' || coalesce(with_check, '')
    )
  from pg_policies
  where schemaname in ('public', 'storage')

  union all

  select
    'routine',
    n.nspname,
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'

  union all

  select
    'trigger',
    n.nspname,
    c.relname || '.' || t.tgname,
    pg_get_triggerdef(t.oid, true)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage')
    and not t.tgisinternal

  union all

  select
    'storage_bucket',
    'storage',
    b.id,
    concat_ws(
      ';',
      'public=' || b.public,
      'file_size_limit=' || coalesce(b.file_size_limit::text, ''),
      'allowed_mime_types=' || coalesce(array_to_string(b.allowed_mime_types, ','), '')
    )
  from storage.buckets b

  union all

  select
    'cron_job_metadata',
    'cron',
    coalesce(job_name, job_id::text),
    concat_ws(
      ';',
      'schedule=' || schedule,
      'database=' || database_name,
      'username=' || username,
      'active=' || active
    )
  from phase_zero_cron_inventory
)
select object_type, schema_name, object_name, detail
from inventory
order by object_type, schema_name, object_name;

rollback;

-- Harness supplies exact old/new planner payloads in a transaction-local setting.
-- Copy the ACTUAL catalog constraint to a temporary progress sink: no customer
-- rows, auth identities, triggers, sequences or external providers are touched.
begin;
create temporary table qa_partition_summary_progress (
  partition_summary jsonb not null default '{}'::jsonb
) on commit drop;
do $test$
declare
  definition text;
  fixtures jsonb := current_setting('medichall.qa.partition_summary_fixtures')::jsonb;
  fixture jsonb;
  result jsonb;
begin
  select pg_get_constraintdef(oid) into strict definition
  from pg_constraint
  where conrelid='public.external_prospect_discovery_runs'::regclass
    and conname='external_prospect_discovery_runs_partition_summary_check';
  execute 'alter table qa_partition_summary_progress add constraint actual_production_check ' || definition;
  insert into qa_partition_summary_progress default values;
  if (select partition_summary <> '{}'::jsonb from qa_partition_summary_progress) then
    raise exception 'Empty default regressed';
  end if;
  for fixture in select value from jsonb_array_elements(fixtures->'valid') loop
    update qa_partition_summary_progress set partition_summary=fixture->'payload';
    select partition_summary into result from qa_partition_summary_progress;
    if result is distinct from fixture->'payload' then raise exception 'Progress persistence mismatch'; end if;
    if fixture->>'name'='v2_gown' and octet_length(result::text)>=6000 then
      raise exception 'Compact summary lacks size margin';
    end if;
  end loop;
  for fixture in select value from jsonb_array_elements(fixtures->'invalid') loop
    begin
      update qa_partition_summary_progress set partition_summary=fixture->'payload';
      raise exception 'Invalid metadata unexpectedly accepted: %', fixture->>'name';
    exception when check_violation then null;
    end;
  end loop;
  begin
    update qa_partition_summary_progress set partition_summary=null;
    raise exception 'SQL null unexpectedly accepted';
  exception when not_null_violation then null;
  end;
end
$test$;
rollback;

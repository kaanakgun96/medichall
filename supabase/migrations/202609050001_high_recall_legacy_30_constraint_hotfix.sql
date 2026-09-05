-- Remove only the historical, differently named 30-result counter bound.
-- The applied V2 migration and its validated 0..100 safety bound stay intact.
begin;

do $hotfix$
declare
  v_table oid := 'public.external_prospect_discovery_runs'::regclass;
  v_column smallint;
  v_legacy text;
  v_other_before jsonb;
  v_other_after jsonb;
  v_expected constant text :=
    'CHECK (((previously_discovered_buyers >= 0) AND (previously_discovered_buyers <= 100)))';
begin
  select attnum into strict v_column from pg_attribute
  where attrelid = v_table and attname = 'previously_discovered_buyers'
    and not attisdropped;

  if not exists (
    select 1 from pg_constraint
    where conrelid = v_table
      and conname = 'external_prospect_discovery_runs_previously_discovered_buyers_v'
      and contype = 'c' and convalidated
      and conkey = array[v_column]
      and pg_get_constraintdef(oid) = v_expected
  ) then
    raise exception 'Required validated V2 0..100 counter bound is missing or changed';
  end if;

  select pg_get_constraintdef(oid) into v_legacy from pg_constraint
  where conrelid = v_table
    and conname = 'external_prospect_discovery__previously_discovered_buyers_check';
  if v_legacy is not null and v_legacy <>
    'CHECK (((previously_discovered_buyers >= 0) AND (previously_discovered_buyers <= 30)))' then
    raise exception 'Legacy counter constraint differs from the approved hotfix target';
  end if;

  select jsonb_object_agg(conname, pg_get_constraintdef(oid)) into v_other_before
  from pg_constraint where conrelid = v_table
    and conname <> 'external_prospect_discovery__previously_discovered_buyers_check';

  -- IF EXISTS also permits fresh-install chains where V2 already removed the
  -- legacy bound; the pre/post assertions still require the exact V2 bound.
  alter table public.external_prospect_discovery_runs
    drop constraint if exists external_prospect_discovery__previously_discovered_buyers_check;

  if (select count(*) from pg_constraint
      where conrelid = v_table and contype = 'c'
        and v_column = any(conkey)) <> 1 then
    raise exception 'Unexpected duplicate or missing previously-discovered counter bound';
  end if;
  if exists (select 1 from pg_constraint
      where conrelid = v_table and contype = 'c' and v_column = any(conkey)
        and (not convalidated or pg_get_constraintdef(oid) <> v_expected)) then
    raise exception 'Previously-discovered counter must retain exactly the V2 0..100 bound';
  end if;

  select jsonb_object_agg(conname, pg_get_constraintdef(oid)) into v_other_after
  from pg_constraint where conrelid = v_table;
  if v_other_before is distinct from v_other_after then
    raise exception 'An unrelated run constraint changed during the hotfix';
  end if;
end
$hotfix$;

commit;

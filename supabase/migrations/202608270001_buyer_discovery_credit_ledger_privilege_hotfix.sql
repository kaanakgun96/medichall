-- Restore the intended append-only Buyer Discovery credit boundary after
-- production's schema-wide default privileges granted service_role broad DML.
-- PostgreSQL default privileges cannot be scoped by table-name pattern, so this
-- migration deliberately hardens only the three named credit tables and does
-- not alter defaults for unrelated future public tables.

begin;

do $migration_gate$
begin
  if to_regclass('public.buyer_discovery_credit_feature_state') is null
     or to_regclass('public.buyer_discovery_credit_accounts') is null
     or to_regclass('public.buyer_discovery_credit_ledger') is null
     or to_regprocedure(
       'public.apply_buyer_discovery_credit_entry_v1(bigint,text,integer,uuid,text,uuid,jsonb,uuid)'
     ) is null
     or to_regprocedure(
       'public.get_company_buyer_discovery_credits_v1(bigint,integer)'
     ) is null
     or to_regprocedure(
       'public.grant_company_buyer_discovery_credits_v1(bigint,integer,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.adjust_company_buyer_discovery_credits_v1(bigint,integer,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.start_customer_buyer_discovery_fresh_v1(bigint,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.accept_buyer_discovery_execution_v2(uuid)'
     ) is null
     or to_regprocedure(
       'public.settle_buyer_discovery_customer_credit_v1()'
     ) is null then
    raise exception 'Buyer Discovery customer credit boundary is incomplete';
  end if;
end
$migration_gate$;

-- Revoke first because Supabase production default privileges may have already
-- granted ALL to service_role when each table was created. All writes below are
-- performed by the existing postgres-owned SECURITY DEFINER RPCs/triggers.
revoke all privileges on table
  public.buyer_discovery_credit_feature_state,
  public.buyer_discovery_credit_accounts,
  public.buyer_discovery_credit_ledger
from public, anon, authenticated, service_role;

-- Company users retain tenant-scoped reads through the existing forced-RLS
-- policies. Feature state remains exposed only through the bounded read RPC.
grant select on table
  public.buyer_discovery_credit_accounts,
  public.buyer_discovery_credit_ledger
to authenticated;

-- The Edge Function reads the balance projection directly for response
-- metadata. It does not require direct INSERT/UPDATE/DELETE/TRUNCATE access.
grant select on table
  public.buyer_discovery_credit_feature_state,
  public.buyer_discovery_credit_accounts,
  public.buyer_discovery_credit_ledger
to service_role;

comment on table public.buyer_discovery_credit_ledger is
  'Append-only Buyer Discovery credit audit ledger. Direct application/service mutation is denied; corrections are new SECURITY DEFINER-controlled entries.';

notify pgrst, 'reload schema';

commit;

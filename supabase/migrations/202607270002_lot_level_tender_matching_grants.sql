-- Tighten Supabase platform default grants for lot-match persistence.
-- The service writes by insert/upsert/update and never deletes result rows.

begin;

revoke all on table public.tender_lot_matches from service_role;
grant select, insert, update on table public.tender_lot_matches
to service_role;

revoke all on sequence public.tender_lot_matches_id_seq from service_role;
grant usage, select on sequence public.tender_lot_matches_id_seq
to service_role;

commit;

-- Rollback:
-- The preceding migration's service-role grants are already sufficient for
-- normal operation. Do not restore DELETE or TRUNCATE privileges.

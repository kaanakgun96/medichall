-- MedicHall portal backend compatibility reconciliation.
--
-- Production catalog verification on 2026-07-28 confirmed that every
-- portal-referenced table and RPC exists. The mutating RPCs below had drifted
-- from the repository authorization contract by retaining an explicit EXECUTE
-- grant for anon. Their bodies still enforce auth.uid()-based ownership, but
-- the API surface should reject anonymous callers before entering the
-- security-definer function.

begin;

do $$
declare
  required_signature text;
  required_signatures constant text[] := array[
    'public.refresh_company_opportunity_matches(bigint)',
    'public.set_opportunity_match_status(bigint,text)',
    'public.refresh_matchmaking_matches(uuid)',
    'public.request_business_connection(uuid,text)',
    'public.respond_business_connection(bigint,text)',
    'public.request_matchmaking_meeting(uuid,timestamptz,timestamptz,text,text)'
  ];
begin
  foreach required_signature in array required_signatures
  loop
    if to_regprocedure(required_signature) is null then
      raise exception 'Required portal RPC is missing: %', required_signature;
    end if;
  end loop;
end;
$$;

revoke all on function public.refresh_company_opportunity_matches(bigint)
from public, anon;
grant execute on function public.refresh_company_opportunity_matches(bigint)
to authenticated, service_role;

revoke all on function public.set_opportunity_match_status(bigint, text)
from public, anon;
grant execute on function public.set_opportunity_match_status(bigint, text)
to authenticated, service_role;

revoke all on function public.refresh_matchmaking_matches(uuid)
from public, anon;
grant execute on function public.refresh_matchmaking_matches(uuid)
to authenticated, service_role;

revoke all on function public.request_business_connection(uuid, text)
from public, anon;
grant execute on function public.request_business_connection(uuid, text)
to authenticated, service_role;

revoke all on function public.respond_business_connection(bigint, text)
from public, anon;
grant execute on function public.respond_business_connection(bigint, text)
to authenticated, service_role;

revoke all on function public.request_matchmaking_meeting(
  uuid,
  timestamptz,
  timestamptz,
  text,
  text
)
from public, anon;
grant execute on function public.request_matchmaking_meeting(
  uuid,
  timestamptz,
  timestamptz,
  text,
  text
)
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

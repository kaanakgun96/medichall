-- Buyer Discovery: keep customer commercial limits while allowing an
-- authoritative platform admin to run bounded internal QA. Provider budgets,
-- the 14-day normal cache, the 50/day Admin QA Fresh ceiling, tenant checks,
-- idempotency and credit semantics remain unchanged.

begin;

create or replace function public.enforce_buyer_discovery_customer_limits_v1(
  p_company_id bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  v_daily integer;
  v_monthly integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Admin authority is exclusively the existing server-side admins table via
  -- is_admin(). This bypasses customer commercial throttles, not global safety.
  if public.is_admin() then
    return;
  end if;

  if exists (
    select 1
    from public.external_prospect_discovery_runs
    where company_id = p_company_id
      and created_at >= clock_timestamp() - interval '30 minutes'
  ) then
    raise exception 'Discovery cooldown is active' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_daily
  from public.external_prospect_discovery_runs
  where company_id = p_company_id
    and created_at >= date_trunc('day', clock_timestamp());

  select count(*)::integer into v_monthly
  from public.external_prospect_discovery_runs
  where company_id = p_company_id
    and created_at >= date_trunc('month', clock_timestamp());

  if v_daily >= 3 then
    raise exception 'Daily discovery limit reached' using errcode = 'P0001';
  end if;
  if v_monthly >= 20 then
    raise exception 'Monthly discovery limit reached' using errcode = 'P0001';
  end if;
end
$function$;

revoke all on function public.enforce_buyer_discovery_customer_limits_v1(bigint)
from public, anon, authenticated;

do $migration$
declare
  v_definition text;
  v_original text;
  v_replacement text := E'  perform public.enforce_buyer_discovery_customer_limits_v1(p_company_id);';
begin
  select pg_get_functiondef(
    'public.start_external_prospect_discovery_v2(bigint,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_original := E'  if exists (\n'
    || E'    select 1 from public.external_prospect_discovery_runs\n'
    || E'    where company_id = p_company_id and created_at >= clock_timestamp() - interval ''30 minutes''\n'
    || E'  ) then\n'
    || E'    raise exception ''Discovery cooldown is active'' using errcode = ''P0001'';\n'
    || E'  end if;\n'
    || E'  select count(*)::integer into v_daily from public.external_prospect_discovery_runs\n'
    || E'  where company_id = p_company_id and created_at >= date_trunc(''day'', clock_timestamp());\n'
    || E'  select count(*)::integer into v_monthly from public.external_prospect_discovery_runs\n'
    || E'  where company_id = p_company_id and created_at >= date_trunc(''month'', clock_timestamp());\n'
    || E'  if v_daily >= 3 then raise exception ''Daily discovery limit reached'' using errcode = ''P0001''; end if;\n'
    || E'  if v_monthly >= 20 then raise exception ''Monthly discovery limit reached'' using errcode = ''P0001''; end if;';

  if position(v_replacement in v_definition) = 0 then
    if position(v_original in v_definition) = 0 then
      raise exception 'Unexpected start_external_prospect_discovery_v2 definition';
    end if;
    execute replace(v_definition, v_original, v_replacement);
  end if;

  select pg_get_functiondef(
    'public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_original := E'  if exists (\n'
    || E'    select 1 from public.external_prospect_discovery_runs\n'
    || E'    where company_id = p_company_id\n'
    || E'      and created_at >= clock_timestamp() - interval ''30 minutes''\n'
    || E'  ) then raise exception ''Discovery cooldown is active'' using errcode = ''P0001''; end if;\n'
    || E'  select count(*)::integer into v_daily from public.external_prospect_discovery_runs\n'
    || E'  where company_id=p_company_id and created_at>=date_trunc(''day'',clock_timestamp());\n'
    || E'  select count(*)::integer into v_monthly from public.external_prospect_discovery_runs\n'
    || E'  where company_id=p_company_id and created_at>=date_trunc(''month'',clock_timestamp());\n'
    || E'  if v_daily >= 3 then raise exception ''Daily discovery limit reached'' using errcode=''P0001''; end if;\n'
    || E'  if v_monthly >= 20 then raise exception ''Monthly discovery limit reached'' using errcode=''P0001''; end if;';

  if position(v_replacement in v_definition) = 0 then
    if position(v_original in v_definition) = 0 then
      raise exception 'Unexpected start_smart_external_prospect_discovery_v1 definition';
    end if;
    execute replace(v_definition, v_original, v_replacement);
  end if;
end
$migration$;

comment on function public.enforce_buyer_discovery_customer_limits_v1(bigint) is
  'Customer-only 30-minute, daily-3 and monthly-20 Buyer Discovery limits. Verified admins bypass these commercial limits; global provider and Admin QA Fresh safety limits remain enforced.';
comment on function public.start_external_prospect_discovery_v2(bigint,uuid,jsonb) is
  'Company-scoped idempotent discovery gate. Customer commercial limits are enforced centrally; verified admins retain bounded QA access.';
comment on function public.start_smart_external_prospect_discovery_v1(bigint,uuid,jsonb) is
  'Starts confirmed Smart Resolver temporary-intent discovery with normal caching and centralized customer-only commercial limits.';

commit;

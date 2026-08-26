-- Customer Fresh Discovery credits: append-only company ledger, atomic debit,
-- explicit pre-provider reversal and feature-gated customer entitlement.
-- No payment gateway, subscription inference, contacts, messages or email.

begin;

do $migration_gate$
begin
  if to_regclass('public.buyer_discovery_search_spaces') is null
     or to_regclass('public.buyer_discovery_run_partitions') is null
     or to_regprocedure('public.start_external_prospect_discovery_v3(bigint,uuid,jsonb,text)') is null
     or to_regprocedure('public.accept_buyer_discovery_execution_v1(uuid)') is null
     or to_regprocedure('public.company_owner_authorized_v1(bigint)') is null then
    raise exception 'Buyer Discovery vNext must be installed before customer credits';
  end if;
end
$migration_gate$;

create table public.buyer_discovery_credit_feature_state (
  singleton boolean primary key default true check (singleton),
  customer_fresh_enabled boolean not null default false,
  initial_credit_grant integer not null default 0 check (
    initial_credit_grant between 0 and 1000
  ),
  customer_daily_limit integer not null default 10 check (
    customer_daily_limit between 1 and 50
  ),
  customer_monthly_limit integer not null default 100 check (
    customer_monthly_limit between 1 and 500
  ),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.buyer_discovery_credit_feature_state(singleton)
values (true);

create table public.buyer_discovery_credit_accounts (
  company_id bigint primary key references public.companies(id) on delete cascade,
  balance integer not null default 0 check (balance between 0 and 1000000),
  lifetime_granted integer not null default 0 check (
    lifetime_granted between 0 and 1000000
  ),
  lifetime_consumed integer not null default 0 check (
    lifetime_consumed between 0 and 1000000
  ),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.buyer_discovery_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'GRANT', 'PURCHASE', 'FRESH_DISCOVERY_DEBIT', 'REFUND',
    'ADMIN_ADJUSTMENT', 'PROMOTIONAL_CREDIT', 'REVERSAL'
  )),
  amount integer not null check (amount <> 0 and amount between -100000 and 100000),
  balance_after integer not null check (balance_after between 0 and 1000000),
  fresh_run_id uuid references public.external_prospect_discovery_runs(id) on delete set null,
  idempotency_key uuid not null,
  reason text not null check (
    length(reason) between 3 and 240
    and reason !~* '(email|phone|whatsapp|contact|linkedin|api[_ -]?key|secret)'
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 2048
    and metadata::text !~* '(email|phone|whatsapp|contact|linkedin|api[_ -]?key|secret)'
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, idempotency_key)
);

create unique index buyer_discovery_credit_ledger_run_debit_uidx
on public.buyer_discovery_credit_ledger(fresh_run_id, transaction_type)
where fresh_run_id is not null
  and transaction_type in ('FRESH_DISCOVERY_DEBIT', 'REVERSAL', 'REFUND');

create index buyer_discovery_credit_ledger_company_created_idx
on public.buyer_discovery_credit_ledger(company_id, created_at desc);

alter table public.buyer_discovery_credit_feature_state enable row level security;
alter table public.buyer_discovery_credit_feature_state force row level security;
alter table public.buyer_discovery_credit_accounts enable row level security;
alter table public.buyer_discovery_credit_accounts force row level security;
alter table public.buyer_discovery_credit_ledger enable row level security;
alter table public.buyer_discovery_credit_ledger force row level security;

create policy "company owners read buyer discovery credit accounts"
on public.buyer_discovery_credit_accounts for select to authenticated
using (public.company_owner_authorized_v1(company_id));

create policy "company owners read buyer discovery credit ledger"
on public.buyer_discovery_credit_ledger for select to authenticated
using (public.company_owner_authorized_v1(company_id));

alter table public.external_prospect_discovery_runs
  drop constraint if exists external_prospect_discovery_runs_fresh_request_state_check,
  drop constraint if exists external_prospect_discovery_runs_credit_disposition_check;

alter table public.external_prospect_discovery_runs
  add constraint external_prospect_discovery_runs_fresh_request_state_check
    check (fresh_request_state in (
      'NOT_FRESH', 'REQUESTED', 'ACCEPTED', 'PROVIDER_STARTED',
      'COMPLETED', 'PARTIAL', 'TERMINAL', 'FAILED_PRE_PROVIDER',
      'FAILED_POST_PROVIDER', 'FAILED_AFTER_PROVIDER'
    )),
  add constraint external_prospect_discovery_runs_credit_disposition_check
    check (credit_disposition in (
      'NOT_APPLICABLE', 'WAIVED_ADMIN_QA', 'FUTURE_ATOMIC_DEBIT',
      'DEBIT_PENDING', 'DEBIT_RESERVED', 'DEBIT_CONSUMED',
      'REVERSED_PRE_PROVIDER', 'NO_CHARGE_PRE_PROVIDER'
    ));

create or replace function public.apply_buyer_discovery_credit_entry_v1(
  p_company_id bigint,
  p_transaction_type text,
  p_amount integer,
  p_idempotency_key uuid,
  p_reason text,
  p_fresh_run_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_type text := upper(trim(coalesce(p_transaction_type, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_existing public.buyer_discovery_credit_ledger%rowtype;
  v_account public.buyer_discovery_credit_accounts%rowtype;
  v_balance integer;
begin
  if p_company_id is null or p_idempotency_key is null
     or v_type not in (
       'GRANT', 'PURCHASE', 'FRESH_DISCOVERY_DEBIT', 'REFUND',
       'ADMIN_ADJUSTMENT', 'PROMOTIONAL_CREDIT', 'REVERSAL'
     )
     or p_amount = 0 or p_amount not between -100000 and 100000
     or length(v_reason) not between 3 and 240
     or v_reason ~* '(email|phone|whatsapp|contact|linkedin|api[_ -]?key|secret)'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 2048
     or coalesce(p_metadata, '{}'::jsonb)::text ~*
        '(email|phone|whatsapp|contact|linkedin|api[_ -]?key|secret)' then
    raise exception 'Valid bounded credit entry is required' using errcode = '22023';
  end if;
  if (v_type = 'FRESH_DISCOVERY_DEBIT' and (p_amount <> -1 or p_fresh_run_id is null))
     or (v_type in ('REVERSAL', 'REFUND') and (p_amount < 1 or p_fresh_run_id is null))
     or (v_type in ('GRANT', 'PURCHASE', 'PROMOTIONAL_CREDIT') and p_amount < 1) then
    raise exception 'Credit entry direction is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('buyer-discovery-credit:' || p_company_id::text, 926)
  );
  select * into v_existing
  from public.buyer_discovery_credit_ledger
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.transaction_type <> v_type
       or v_existing.amount <> p_amount
       or v_existing.fresh_run_id is distinct from p_fresh_run_id then
      raise exception 'Credit idempotency key already has different semantics'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'entry_id', v_existing.id, 'balance', v_existing.balance_after,
      'reused', true, 'transaction_type', v_existing.transaction_type
    );
  end if;

  insert into public.buyer_discovery_credit_accounts(company_id)
  values (p_company_id) on conflict (company_id) do nothing;
  select * into v_account from public.buyer_discovery_credit_accounts
  where company_id = p_company_id for update;
  v_balance := v_account.balance + p_amount;
  if v_balance < 0 then
    raise exception 'INSUFFICIENT_FRESH_DISCOVERY_CREDITS' using errcode = 'P0001';
  end if;

  update public.buyer_discovery_credit_accounts
  set balance = v_balance,
      lifetime_granted = lifetime_granted + case
        when p_amount > 0 and v_type in (
          'GRANT', 'PURCHASE', 'PROMOTIONAL_CREDIT', 'ADMIN_ADJUSTMENT'
        ) then p_amount else 0 end,
      lifetime_consumed = lifetime_consumed + case
        when p_amount < 0 then -p_amount else 0 end,
      version = version + 1,
      updated_at = clock_timestamp()
  where company_id = p_company_id;
  insert into public.buyer_discovery_credit_ledger(
    company_id, transaction_type, amount, balance_after, fresh_run_id,
    idempotency_key, reason, metadata, created_by
  ) values (
    p_company_id, v_type, p_amount, v_balance, p_fresh_run_id,
    p_idempotency_key, v_reason, coalesce(p_metadata, '{}'::jsonb), p_created_by
  ) returning * into v_existing;
  return jsonb_build_object(
    'entry_id', v_existing.id, 'balance', v_balance,
    'reused', false, 'transaction_type', v_type
  );
end
$function$;

create or replace function public.get_company_buyer_discovery_credits_v1(
  p_company_id bigint,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_feature public.buyer_discovery_credit_feature_state%rowtype;
  v_balance integer := 0;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'Credit history limit must be between 1 and 100'
      using errcode = '22023';
  end if;
  select * into v_feature from public.buyer_discovery_credit_feature_state
  where singleton;
  select coalesce(account.balance, 0) into v_balance
  from (select p_company_id as company_id) requested
  left join public.buyer_discovery_credit_accounts account
    on account.company_id = requested.company_id;
  return jsonb_build_object(
    'company_id', p_company_id,
    'customer_fresh_enabled', coalesce(v_feature.customer_fresh_enabled, false),
    'credit_cost', 1,
    'balance', v_balance,
    'can_run_fresh', coalesce(v_feature.customer_fresh_enabled, false) and v_balance >= 1,
    'daily_safety_limit', coalesce(v_feature.customer_daily_limit, 10),
    'monthly_safety_limit', coalesce(v_feature.customer_monthly_limit, 100),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', entry.id, 'transaction_type', entry.transaction_type,
        'amount', entry.amount, 'balance_after', entry.balance_after,
        'fresh_run_id', entry.fresh_run_id, 'reason', entry.reason,
        'created_at', entry.created_at
      ) order by entry.created_at desc)
      from (
        select * from public.buyer_discovery_credit_ledger
        where company_id = p_company_id
        order by created_at desc limit p_limit
      ) entry
    ), '[]'::jsonb)
  );
end
$function$;

create or replace function public.set_buyer_discovery_customer_fresh_v1(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  update public.buyer_discovery_credit_feature_state
  set customer_fresh_enabled = coalesce(p_enabled, false),
      updated_by = auth.uid(), updated_at = clock_timestamp()
  where singleton;
  return jsonb_build_object('customer_fresh_enabled', coalesce(p_enabled, false));
end
$function$;

create or replace function public.configure_buyer_discovery_credit_policy_v1(
  p_customer_fresh_enabled boolean,
  p_initial_credit_grant integer,
  p_customer_daily_limit integer,
  p_customer_monthly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  if p_initial_credit_grant not between 0 and 1000
     or p_customer_daily_limit not between 1 and 50
     or p_customer_monthly_limit not between 1 and 500
     or p_customer_monthly_limit < p_customer_daily_limit then
    raise exception 'Buyer Discovery credit policy is invalid' using errcode = '22023';
  end if;
  update public.buyer_discovery_credit_feature_state
  set customer_fresh_enabled = coalesce(p_customer_fresh_enabled, false),
      initial_credit_grant = p_initial_credit_grant,
      customer_daily_limit = p_customer_daily_limit,
      customer_monthly_limit = p_customer_monthly_limit,
      updated_by = auth.uid(), updated_at = clock_timestamp()
  where singleton;
  return jsonb_build_object(
    'customer_fresh_enabled', coalesce(p_customer_fresh_enabled, false),
    'initial_credit_grant', p_initial_credit_grant,
    'customer_daily_limit', p_customer_daily_limit,
    'customer_monthly_limit', p_customer_monthly_limit
  );
end
$function$;

create or replace function public.grant_company_buyer_discovery_credits_v1(
  p_company_id bigint,
  p_amount integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Company is unavailable' using errcode = '22023';
  end if;
  return public.apply_buyer_discovery_credit_entry_v1(
    p_company_id, 'GRANT', p_amount, p_idempotency_key, p_reason,
    null, jsonb_build_object('source', 'ADMIN_GRANT'), auth.uid()
  );
end
$function$;

create or replace function public.adjust_company_buyer_discovery_credits_v1(
  p_company_id bigint,
  p_amount integer,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Company is unavailable' using errcode = '22023';
  end if;
  return public.apply_buyer_discovery_credit_entry_v1(
    p_company_id, 'ADMIN_ADJUSTMENT', p_amount, p_idempotency_key, p_reason,
    null, jsonb_build_object('source', 'ADMIN_ADJUSTMENT'), auth.uid()
  );
end
$function$;

create or replace function public.get_buyer_discovery_credit_metrics_v1(
  p_company_id bigint default null,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  v_since timestamptz;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Platform admin access required' using errcode = '42501';
  end if;
  if p_days not between 1 and 366 then
    raise exception 'Metrics range must be between 1 and 366 days'
      using errcode = '22023';
  end if;
  v_since := current_timestamp - make_interval(days => p_days);
  return jsonb_build_object(
    'range_days', p_days,
    'company_id', p_company_id,
    'credit_debits', (
      select coalesce(sum(-entry.amount), 0)::integer
      from public.buyer_discovery_credit_ledger entry
      where entry.transaction_type = 'FRESH_DISCOVERY_DEBIT'
        and entry.created_at >= v_since
        and (p_company_id is null or entry.company_id = p_company_id)
    ),
    'fresh_runs', (
      select count(*)::integer from public.external_prospect_discovery_runs run
      where run.run_mode = 'FRESH_DISCOVERY' and run.created_at >= v_since
        and (p_company_id is null or run.company_id = p_company_id)
    ),
    'successful_fresh_runs', (
      select count(*)::integer from public.external_prospect_discovery_runs run
      where run.run_mode = 'FRESH_DISCOVERY' and run.status in ('COMPLETED', 'PARTIAL')
        and run.created_at >= v_since
        and (p_company_id is null or run.company_id = p_company_id)
    ),
    'pre_provider_reversals', (
      select count(*)::integer from public.buyer_discovery_credit_ledger entry
      where entry.transaction_type in ('REVERSAL', 'REFUND')
        and entry.created_at >= v_since
        and (p_company_id is null or entry.company_id = p_company_id)
    ),
    'zero_new_runs', (
      select count(*)::integer from public.external_prospect_discovery_runs run
      where run.run_mode = 'FRESH_DISCOVERY' and run.status in ('COMPLETED', 'PARTIAL')
        and run.credit_disposition = 'DEBIT_CONSUMED'
        and run.new_verified_buyers = 0 and run.created_at >= v_since
        and (p_company_id is null or run.company_id = p_company_id)
    ),
    'new_buyers_per_credit', (
      select coalesce(round(
        sum(run.new_verified_buyers)::numeric /
        nullif(count(*) filter (where run.credit_disposition = 'DEBIT_CONSUMED'), 0),
        3
      ), 0)
      from public.external_prospect_discovery_runs run
      where run.run_mode = 'FRESH_DISCOVERY' and run.created_at >= v_since
        and (p_company_id is null or run.company_id = p_company_id)
    ),
    'provider_cost_usd', (
      select coalesce(round(sum(run.estimated_cost_usd), 6), 0)
      from public.external_prospect_discovery_runs run
      where run.run_mode = 'FRESH_DISCOVERY' and run.created_at >= v_since
        and (p_company_id is null or run.company_id = p_company_id)
    ),
    'remaining_balance', (
      select coalesce(sum(account.balance), 0)::bigint
      from public.buyer_discovery_credit_accounts account
      where p_company_id is null or account.company_id = p_company_id
    )
  );
end
$function$;

create or replace function public.start_customer_buyer_discovery_fresh_v1(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_base_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_feature public.buyer_discovery_credit_feature_state%rowtype;
  v_base public.external_prospect_discovery_runs%rowtype;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_run public.external_prospect_discovery_runs%rowtype;
  v_space public.buyer_discovery_search_spaces%rowtype;
  v_balance integer := 0;
  v_daily integer;
  v_monthly integer;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_base_run_id is null then
    raise exception 'Fresh Discovery request is incomplete' using errcode = '22023';
  end if;
  select * into v_feature from public.buyer_discovery_credit_feature_state
  where singleton;
  if not coalesce(v_feature.customer_fresh_enabled, false) then
    raise exception 'CUSTOMER_FRESH_DISCOVERY_DISABLED' using errcode = '42501';
  end if;
  select * into v_base from public.external_prospect_discovery_runs
  where id = p_base_run_id and company_id = p_company_id
    and status in ('COMPLETED', 'PARTIAL')
    and search_space_id is not null;
  if v_base.id is null then
    raise exception 'A completed company-owned discovery is required'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('buyer-discovery-vnext:' || p_company_id::text, 925)
  );
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.run_mode <> 'FRESH_DISCOVERY'
       or v_existing.intent_hash <> v_base.intent_hash then
      raise exception 'Fresh idempotency key already has different semantics'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'idempotency_key', 'run_mode', 'FRESH_DISCOVERY',
      'search_space_id', v_existing.search_space_id,
      'search_generation', v_existing.search_generation,
      'fresh_request_state', v_existing.fresh_request_state,
      'credit_disposition', v_existing.credit_disposition
    );
  end if;

  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and intent_hash = v_base.intent_hash
    and run_mode = 'FRESH_DISCOVERY' and status in ('QUEUED', 'RUNNING')
  order by created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'active_fresh_run', 'run_mode', 'FRESH_DISCOVERY',
      'search_space_id', v_existing.search_space_id,
      'search_generation', v_existing.search_generation,
      'fresh_request_state', v_existing.fresh_request_state,
      'credit_disposition', v_existing.credit_disposition
    );
  end if;

  select coalesce((
    select balance from public.buyer_discovery_credit_accounts
    where company_id = p_company_id
  ), 0) into v_balance;
  if v_balance < 1 then
    raise exception 'INSUFFICIENT_FRESH_DISCOVERY_CREDITS' using errcode = 'P0001';
  end if;
  select count(*)::integer into v_daily
  from public.external_prospect_discovery_runs
  where company_id = p_company_id and run_mode = 'FRESH_DISCOVERY'
    and fresh_request_state in ('ACCEPTED', 'PROVIDER_STARTED', 'COMPLETED', 'PARTIAL',
      'FAILED_POST_PROVIDER', 'FAILED_AFTER_PROVIDER')
    and created_at >= date_trunc('day', clock_timestamp());
  select count(*)::integer into v_monthly
  from public.external_prospect_discovery_runs
  where company_id = p_company_id and run_mode = 'FRESH_DISCOVERY'
    and fresh_request_state in ('ACCEPTED', 'PROVIDER_STARTED', 'COMPLETED', 'PARTIAL',
      'FAILED_POST_PROVIDER', 'FAILED_AFTER_PROVIDER')
    and created_at >= date_trunc('month', clock_timestamp());
  if v_daily >= v_feature.customer_daily_limit then
    raise exception 'CUSTOMER_FRESH_DAILY_SAFETY_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if v_monthly >= v_feature.customer_monthly_limit then
    raise exception 'CUSTOMER_FRESH_MONTHLY_SAFETY_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  select * into v_space from public.buyer_discovery_search_spaces
  where id = v_base.search_space_id and company_id = p_company_id for update;
  if v_space.id is null then
    raise exception 'Buyer Discovery search space is unavailable' using errcode = '22023';
  end if;
  insert into public.external_prospect_discovery_runs(
    company_id, requested_by, idempotency_key, intent_hash, intent_source,
    intent_context, resolution_event_id, search_space_id, run_mode,
    search_generation, product_profile, fresh_request_state, credit_disposition
  ) values (
    p_company_id, auth.uid(), p_idempotency_key, v_base.intent_hash,
    v_base.intent_source, v_base.intent_context, v_base.resolution_event_id,
    v_space.id, 'FRESH_DISCOVERY', v_space.generation_count + 1,
    v_space.product_profile, 'REQUESTED', 'DEBIT_PENDING'
  ) returning * into v_run;
  return jsonb_build_object(
    'run_id', v_run.id, 'status', v_run.status, 'stage', v_run.stage,
    'intent_hash', v_run.intent_hash, 'intent_context', v_run.intent_context,
    'reused', false, 'reason', 'customer_fresh_requested',
    'run_mode', 'FRESH_DISCOVERY', 'search_space_id', v_run.search_space_id,
    'search_generation', v_run.search_generation,
    'fresh_request_state', v_run.fresh_request_state,
    'credit_disposition', v_run.credit_disposition,
    'credit_balance', v_balance
  );
end
$function$;

create or replace function public.accept_buyer_discovery_execution_v2(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_run public.external_prospect_discovery_runs%rowtype;
  v_partition_count integer;
  v_credit jsonb;
  v_generation integer;
begin
  select * into v_run from public.external_prospect_discovery_runs
  where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Discovery run is unavailable' using errcode = '22023';
  end if;
  if v_run.status not in ('QUEUED', 'RUNNING') then
    raise exception 'Discovery run is not executable' using errcode = '22023';
  end if;
  if v_run.fresh_request_state in ('ACCEPTED', 'PROVIDER_STARTED')
     or v_run.provider_execution_started_at is not null then
    select coalesce(balance, 0) into v_generation
    from public.buyer_discovery_credit_accounts where company_id = v_run.company_id;
    return jsonb_build_object(
      'run_id', v_run.id, 'accepted', true, 'reused', true,
      'run_mode', v_run.run_mode, 'credit_balance', coalesce(v_generation, 0),
      'credit_disposition', v_run.credit_disposition
    );
  end if;
  select count(*)::integer into v_partition_count
  from public.buyer_discovery_run_partitions
  where run_id = v_run.id and status = 'PLANNED';
  if v_partition_count < 1 then
    raise exception 'NO_FRESH_SEARCH_SPACE' using errcode = '22023';
  end if;

  if v_run.run_mode = 'FRESH_DISCOVERY' then
    v_credit := public.apply_buyer_discovery_credit_entry_v1(
      v_run.company_id, 'FRESH_DISCOVERY_DEBIT', -1, v_run.idempotency_key,
      'Fresh Buyer Discovery execution', v_run.id,
      jsonb_build_object('intent_hash', v_run.intent_hash), v_run.requested_by
    );
    update public.buyer_discovery_search_spaces
    set generation_count = generation_count + 1,
        fresh_run_count = fresh_run_count + 1,
        last_discovery_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_run.search_space_id
    returning generation_count into v_generation;
    update public.external_prospect_discovery_runs
    set fresh_request_state = 'ACCEPTED', credit_disposition = 'DEBIT_RESERVED',
        search_generation = v_generation
    where id = v_run.id;
  elsif v_run.run_mode = 'ADMIN_QA_FRESH' then
    v_credit := jsonb_build_object('balance', null, 'reused', false);
    update public.external_prospect_discovery_runs
    set fresh_request_state = 'ACCEPTED', credit_disposition = 'WAIVED_ADMIN_QA'
    where id = v_run.id;
  else
    v_credit := jsonb_build_object('balance', null, 'reused', false);
  end if;
  return jsonb_build_object(
    'run_id', v_run.id, 'accepted', true, 'reused', false,
    'run_mode', v_run.run_mode, 'partition_count', v_partition_count,
    'credit_balance', v_credit->'balance',
    'credit_disposition', case when v_run.run_mode = 'FRESH_DISCOVERY'
      then 'DEBIT_RESERVED' when v_run.run_mode = 'ADMIN_QA_FRESH'
      then 'WAIVED_ADMIN_QA' else 'NOT_APPLICABLE' end
  );
end
$function$;

create or replace function public.mark_buyer_discovery_provider_started_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
declare
  v_run public.external_prospect_discovery_runs%rowtype;
begin
  select * into v_run from public.external_prospect_discovery_runs
  where id = p_run_id for update;
  if v_run.id is null or v_run.status not in ('QUEUED', 'RUNNING') then
    raise exception 'Discovery run is not executable' using errcode = '22023';
  end if;
  if v_run.run_mode = 'FRESH_DISCOVERY'
     and v_run.credit_disposition <> 'DEBIT_RESERVED' then
    raise exception 'Fresh Discovery credit debit is not reserved' using errcode = '22023';
  end if;
  if v_run.provider_execution_started_at is null then
    update public.external_prospect_discovery_runs
    set provider_execution_started_at = clock_timestamp(),
        fresh_request_state = case when run_mode = 'NORMAL_DISCOVERY'
          then 'NOT_FRESH' else 'PROVIDER_STARTED' end
    where id = v_run.id;
  end if;
  return jsonb_build_object(
    'run_id', v_run.id, 'provider_started', true,
    'reused', v_run.provider_execution_started_at is not null,
    'run_mode', v_run.run_mode
  );
end
$function$;

create or replace function public.accept_buyer_discovery_execution_v1(
  p_run_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
set statement_timeout = '2500ms'
as $function$
  select public.accept_buyer_discovery_execution_v2(p_run_id)
$function$;

create or replace function public.settle_buyer_discovery_customer_credit_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_reversal jsonb;
begin
  if new.run_mode <> 'FRESH_DISCOVERY' then
    return new;
  end if;
  if new.fresh_request_state = 'FAILED_PRE_PROVIDER'
     and old.provider_execution_started_at is not null then
    new.fresh_request_state := 'FAILED_POST_PROVIDER';
  end if;
  if new.fresh_request_state = 'FAILED_PRE_PROVIDER' then
    if exists (
      select 1 from public.buyer_discovery_credit_ledger
      where fresh_run_id = new.id and transaction_type = 'FRESH_DISCOVERY_DEBIT'
    ) then
      if not exists (
        select 1 from public.buyer_discovery_credit_ledger
        where fresh_run_id = new.id and transaction_type in ('REVERSAL', 'REFUND')
      ) then
        v_reversal := public.apply_buyer_discovery_credit_entry_v1(
          new.company_id, 'REVERSAL', 1,
          extensions.uuid_generate_v5(
            '00000000-0000-0000-0000-000000000000'::uuid,
            'buyer-discovery-pre-provider-reversal:' || new.id::text
          ),
          'Fresh Discovery pre-provider reversal', new.id,
          jsonb_build_object('reason', coalesce(new.error_code, 'PRE_PROVIDER_FAILURE')),
          new.requested_by
        );
      end if;
      new.credit_disposition := 'REVERSED_PRE_PROVIDER';
    else
      new.credit_disposition := 'NO_CHARGE_PRE_PROVIDER';
    end if;
  elsif new.fresh_request_state in (
    'COMPLETED', 'PARTIAL', 'FAILED_POST_PROVIDER', 'FAILED_AFTER_PROVIDER'
  ) and exists (
    select 1 from public.buyer_discovery_credit_ledger
    where fresh_run_id = new.id and transaction_type = 'FRESH_DISCOVERY_DEBIT'
  ) then
    new.credit_disposition := 'DEBIT_CONSUMED';
  end if;
  return new;
end
$function$;

drop trigger if exists settle_buyer_discovery_customer_credit
on public.external_prospect_discovery_runs;
create trigger settle_buyer_discovery_customer_credit
before update of status, fresh_request_state, provider_execution_started_at
on public.external_prospect_discovery_runs
for each row execute function public.settle_buyer_discovery_customer_credit_v1();

revoke all on table public.buyer_discovery_credit_feature_state,
  public.buyer_discovery_credit_accounts,
  public.buyer_discovery_credit_ledger from public, anon, authenticated;
grant select on table public.buyer_discovery_credit_accounts,
  public.buyer_discovery_credit_ledger to authenticated;
grant select on table public.buyer_discovery_credit_feature_state,
  public.buyer_discovery_credit_accounts,
  public.buyer_discovery_credit_ledger to service_role;

revoke all on function public.apply_buyer_discovery_credit_entry_v1(
  bigint,text,integer,uuid,text,uuid,jsonb,uuid
), public.get_company_buyer_discovery_credits_v1(bigint,integer),
  public.set_buyer_discovery_customer_fresh_v1(boolean),
  public.configure_buyer_discovery_credit_policy_v1(boolean,integer,integer,integer),
  public.grant_company_buyer_discovery_credits_v1(bigint,integer,text,uuid),
  public.adjust_company_buyer_discovery_credits_v1(bigint,integer,text,uuid),
  public.get_buyer_discovery_credit_metrics_v1(bigint,integer),
  public.start_customer_buyer_discovery_fresh_v1(bigint,uuid,uuid),
  public.accept_buyer_discovery_execution_v2(uuid),
  public.mark_buyer_discovery_provider_started_v1(uuid),
  public.settle_buyer_discovery_customer_credit_v1()
from public, anon, authenticated;

grant execute on function public.get_company_buyer_discovery_credits_v1(bigint,integer),
  public.set_buyer_discovery_customer_fresh_v1(boolean),
  public.configure_buyer_discovery_credit_policy_v1(boolean,integer,integer,integer),
  public.grant_company_buyer_discovery_credits_v1(bigint,integer,text,uuid),
  public.adjust_company_buyer_discovery_credits_v1(bigint,integer,text,uuid),
  public.get_buyer_discovery_credit_metrics_v1(bigint,integer),
  public.start_customer_buyer_discovery_fresh_v1(bigint,uuid,uuid)
to authenticated, service_role;
grant execute on function public.accept_buyer_discovery_execution_v2(uuid),
  public.mark_buyer_discovery_provider_started_v1(uuid)
to service_role;

comment on table public.buyer_discovery_credit_accounts is
  'Company-scoped transactionally consistent Buyer Discovery credit projection. The append-only ledger remains authoritative.';
comment on table public.buyer_discovery_credit_ledger is
  'Append-only Buyer Discovery credit audit ledger. Direct client mutation is denied; corrections are new entries.';
comment on function public.start_customer_buyer_discovery_fresh_v1(bigint,uuid,uuid) is
  'Feature-gated customer Fresh request using a completed company-owned intent. No debit occurs until an executable search plan is accepted.';
comment on function public.accept_buyer_discovery_execution_v2(uuid) is
  'Service-only atomic execution boundary: validates planned partitions and debits exactly one customer credit, or waives Admin QA.';

notify pgrst, 'reload schema';

commit;

-- Forward-only rollback: disable customer_fresh_enabled. Existing immutable
-- ledger/account evidence remains available for audit and any owed reversals.

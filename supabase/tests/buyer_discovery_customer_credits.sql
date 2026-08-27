begin;

do $contract$
declare
  definition text;
begin
  if to_regclass('public.buyer_discovery_credit_accounts') is null
     or to_regclass('public.buyer_discovery_credit_ledger') is null
     or to_regclass('public.buyer_discovery_credit_feature_state') is null
     or to_regprocedure('public.start_customer_buyer_discovery_fresh_v1(bigint,uuid,uuid)') is null
     or to_regprocedure('public.accept_buyer_discovery_execution_v2(uuid)') is null
     or to_regprocedure('public.mark_buyer_discovery_provider_started_v1(uuid)') is null
     or to_regprocedure('public.get_buyer_discovery_credit_metrics_v1(bigint,integer)') is null then
    raise exception 'customer Fresh credit contract is incomplete';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.buyer_discovery_credit_accounts'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.buyer_discovery_credit_ledger'::regclass) then
    raise exception 'credit RLS must remain enabled and forced';
  end if;
  if has_table_privilege('anon', 'public.buyer_discovery_credit_accounts', 'SELECT')
     or has_table_privilege('anon', 'public.buyer_discovery_credit_ledger', 'SELECT')
     or has_table_privilege('authenticated', 'public.buyer_discovery_credit_ledger', 'INSERT')
     or has_table_privilege('authenticated', 'public.buyer_discovery_credit_ledger', 'UPDATE')
     or has_table_privilege('authenticated', 'public.buyer_discovery_credit_ledger', 'DELETE')
     or has_table_privilege('authenticated', 'public.buyer_discovery_credit_ledger', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.buyer_discovery_credit_ledger', 'INSERT')
     or has_table_privilege('service_role', 'public.buyer_discovery_credit_ledger', 'UPDATE')
     or has_table_privilege('service_role', 'public.buyer_discovery_credit_ledger', 'DELETE')
     or has_table_privilege('service_role', 'public.buyer_discovery_credit_ledger', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.buyer_discovery_credit_ledger', 'REFERENCES')
     or has_table_privilege('service_role', 'public.buyer_discovery_credit_ledger', 'TRIGGER')
     or exists (
       select 1 from information_schema.table_privileges
       where table_schema = 'public'
         and table_name in (
           'buyer_discovery_credit_feature_state',
           'buyer_discovery_credit_accounts',
           'buyer_discovery_credit_ledger'
         )
         and grantee = 'PUBLIC'
     ) then
    raise exception 'append-only ledger privilege contract regressed';
  end if;
  if has_function_privilege('authenticated',
       'public.accept_buyer_discovery_execution_v2(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.mark_buyer_discovery_provider_started_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.accept_buyer_discovery_execution_v2(uuid)', 'EXECUTE') then
    raise exception 'service-only execution boundary regressed';
  end if;
  select pg_get_functiondef(
    'public.accept_buyer_discovery_execution_v1(uuid)'::regprocedure
  ) into definition;
  if definition !~ 'accept_buyer_discovery_execution_v2' then
    raise exception 'legacy acceptance boundary can bypass customer debit';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'buyer_discovery_credit_accounts', 'buyer_discovery_credit_ledger',
        'buyer_discovery_credit_feature_state'
      ) and column_name ~* '(email|phone|contact|whatsapp|linkedin)'
  ) then
    raise exception 'contact data entered the credit model';
  end if;
end
$contract$;

create temporary table buyer_credit_fixtures(
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  base_run_id uuid,
  search_space_id uuid,
  fresh_run_id uuid
) on commit drop;

insert into buyer_credit_fixtures(ordinal, user_id) values
  (1, gen_random_uuid()), (2, gen_random_uuid()), (3, gen_random_uuid());

insert into auth.users(
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
select user_id, 'authenticated', 'authenticated',
  'buyer-credit-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), false, false
from buyer_credit_fixtures;

with inserted as (
  insert into public.companies(
    owner_id, name, type, website, country, is_approved, is_active
  )
  select user_id, 'Buyer Credit Tenant ' || ordinal,
    'Medical device manufacturer',
    'https://buyer-credit-' || ordinal || '.example.invalid',
    'Türkiye', false, true
  from buyer_credit_fixtures where ordinal < 3
  returning id, owner_id
)
update buyer_credit_fixtures fixture set company_id = inserted.id
from inserted where inserted.owner_id = fixture.user_id;

insert into public.admins(user_id)
select user_id from buyer_credit_fixtures where ordinal = 3;

with spaces as (
  insert into public.buyer_discovery_search_spaces(company_id, intent_hash, generation_count)
  select company_id, repeat(ordinal::text, 64), 1
  from buyer_credit_fixtures where ordinal < 3
  returning id, company_id, intent_hash
)
update buyer_credit_fixtures fixture set search_space_id = spaces.id
from spaces where spaces.company_id = fixture.company_id;

with runs as (
  insert into public.external_prospect_discovery_runs(
    company_id, requested_by, idempotency_key, intent_hash, intent_source,
    intent_context, search_space_id, run_mode, search_generation,
    status, stage, fresh_request_state, credit_disposition, completed_at
  )
  select company_id, user_id, gen_random_uuid(), repeat(ordinal::text, 64),
    'PROFILE_PRODUCT', jsonb_build_object(
      'intent_source', 'PROFILE_PRODUCT', 'normalized_product_label', 'QA Device',
      'target_countries', jsonb_build_array('FR'), 'taxonomy', '[]'::jsonb
    ), search_space_id, 'NORMAL_DISCOVERY', 1, 'COMPLETED', 'completed',
    'NOT_FRESH', 'NOT_APPLICABLE', clock_timestamp()
  from buyer_credit_fixtures where ordinal < 3
  returning id, company_id
)
update buyer_credit_fixtures fixture set base_run_id = runs.id
from runs where runs.company_id = fixture.company_id;

update public.buyer_discovery_credit_feature_state
set customer_fresh_enabled = true;
grant all on buyer_credit_fixtures to authenticated, service_role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from buyer_credit_fixtures where ordinal = 1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $owner_zero_and_isolation$
declare
  v_company bigint := (select company_id from buyer_credit_fixtures where ordinal = 1);
  v_other bigint := (select company_id from buyer_credit_fixtures where ordinal = 2);
  v_credits jsonb;
begin
  v_credits := public.get_company_buyer_discovery_credits_v1(v_company, 20);
  if (v_credits->>'balance')::integer <> 0
     or not (v_credits->>'customer_fresh_enabled')::boolean
     or (v_credits->>'can_run_fresh')::boolean then
    raise exception 'zero-credit entitlement response is unsafe';
  end if;
  begin
    perform public.get_company_buyer_discovery_credits_v1(v_other, 20);
    raise exception 'cross-company credit read succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.start_customer_buyer_discovery_fresh_v1(
      v_company, gen_random_uuid(),
      (select base_run_id from buyer_credit_fixtures where ordinal = 1)
    );
    raise exception 'zero-credit customer started Fresh Discovery';
  exception when raise_exception then
    if sqlerrm <> 'INSUFFICIENT_FRESH_DISCOVERY_CREDITS' then raise; end if;
  end;
  begin
    insert into public.buyer_discovery_credit_ledger(
      company_id, transaction_type, amount, balance_after, idempotency_key, reason
    ) values (v_company, 'GRANT', 1, 1, gen_random_uuid(), 'Client bypass');
    raise exception 'authenticated client mutated append-only ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.grant_company_buyer_discovery_credits_v1(
      v_company, 1, 'Unauthorized customer grant', gen_random_uuid()
    );
    raise exception 'ordinary customer granted credits';
  exception when insufficient_privilege then null;
  end;
end
$owner_zero_and_isolation$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from buyer_credit_fixtures where ordinal = 3),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $admin_grant$
declare
  v_company bigint := (select company_id from buyer_credit_fixtures where ordinal = 1);
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
  v_metrics jsonb;
begin
  v_first := public.grant_company_buyer_discovery_credits_v1(
    v_company, 2, 'Initial QA entitlement', v_key
  );
  v_retry := public.grant_company_buyer_discovery_credits_v1(
    v_company, 2, 'Initial QA entitlement', v_key
  );
  v_metrics := public.get_buyer_discovery_credit_metrics_v1(v_company, 30);
  if (v_first->>'balance')::integer <> 2
     or (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or (v_metrics->>'remaining_balance')::integer <> 2
     or (v_metrics->>'credit_debits')::integer <> 0
     or (select count(*) from public.buyer_discovery_credit_ledger
         where company_id = v_company) <> 1 then
    raise exception 'admin grant idempotency failed';
  end if;
end
$admin_grant$;
reset role;

set local role service_role;
do $direct_ledger_mutation_denied$
declare
  v_company bigint := (select company_id from buyer_credit_fixtures where ordinal = 1);
  v_entry uuid;
  v_original_amount integer;
  v_original_balance integer;
  v_original_reason text;
begin
  select id, amount, balance_after, reason
  into v_entry, v_original_amount, v_original_balance, v_original_reason
  from public.buyer_discovery_credit_ledger
  where company_id = v_company
  order by created_at, id
  limit 1;

  begin
    insert into public.buyer_discovery_credit_ledger(
      company_id, transaction_type, amount, balance_after,
      idempotency_key, reason
    ) values (
      v_company, 'GRANT', 1, 3, gen_random_uuid(), 'Direct service insert'
    );
    raise exception 'service_role directly inserted ledger history';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.buyer_discovery_credit_ledger
    set reason = 'Direct service update' where id = v_entry;
    raise exception 'service_role updated historical ledger entry';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.buyer_discovery_credit_ledger where id = v_entry;
    raise exception 'service_role deleted historical ledger entry';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate table public.buyer_discovery_credit_ledger;
    raise exception 'service_role truncated historical ledger entries';
  exception when insufficient_privilege then null;
  end;

  if not exists (
    select 1 from public.buyer_discovery_credit_ledger
    where id = v_entry and amount = v_original_amount
      and balance_after = v_original_balance and reason = v_original_reason
  ) then
    raise exception 'historical ledger entry changed during denied DML probes';
  end if;
end
$direct_ledger_mutation_denied$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from buyer_credit_fixtures where ordinal = 1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $customer_request$
declare
  v_key uuid := gen_random_uuid();
  v_first jsonb;
  v_retry jsonb;
begin
  v_first := public.start_customer_buyer_discovery_fresh_v1(
    (select company_id from buyer_credit_fixtures where ordinal = 1), v_key,
    (select base_run_id from buyer_credit_fixtures where ordinal = 1)
  );
  v_retry := public.start_customer_buyer_discovery_fresh_v1(
    (select company_id from buyer_credit_fixtures where ordinal = 1), v_key,
    (select base_run_id from buyer_credit_fixtures where ordinal = 1)
  );
  if (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or v_first->>'run_id' <> v_retry->>'run_id'
     or v_first->>'credit_disposition' <> 'DEBIT_PENDING'
     or (select balance from public.buyer_discovery_credit_accounts
         where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)) <> 2 then
    raise exception 'request/idempotency/no-preplanning-debit contract failed';
  end if;
  update buyer_credit_fixtures set fresh_run_id = (v_first->>'run_id')::uuid
  where ordinal = 1;
  begin
    perform public.accept_buyer_discovery_execution_v2((v_first->>'run_id')::uuid);
    raise exception 'authenticated role accepted provider execution';
  exception when insufficient_privilege then null;
  end;
end
$customer_request$;
reset role;

set local role service_role;
do $no_fresh_search_space_no_charge$
declare
  v_run uuid := (select fresh_run_id from buyer_credit_fixtures where ordinal = 1);
begin
  begin
    perform public.accept_buyer_discovery_execution_v2(v_run);
    raise exception 'run without an executable partition was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'NO_FRESH_SEARCH_SPACE' then raise; end if;
  end;
  if exists (
    select 1 from public.buyer_discovery_credit_ledger
    where fresh_run_id = v_run and transaction_type = 'FRESH_DISCOVERY_DEBIT'
  ) or (select balance from public.buyer_discovery_credit_accounts
        where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)) <> 2 then
    raise exception 'no-fresh-search-space path consumed a credit';
  end if;
end
$no_fresh_search_space_no_charge$;
reset role;

insert into public.buyer_discovery_partitions(
  search_space_id, partition_key, provider_kind, partition_type,
  terminology, language_code, country_codes, market_region,
  buyer_archetype, retrieval_kind, priority
) values (
  (select search_space_id from buyer_credit_fixtures where ordinal = 1),
  'web|credit-qa|fr|distributor', 'PUBLIC_WEB', 'COMMERCIAL_WEB',
  '["qa medical device"]'::jsonb, 'fr', array['FR'], 'WESTERN_EUROPE',
  'DISTRIBUTOR', 'DIRECT_TERMS', 100
);
insert into public.buyer_discovery_run_partitions(run_id, partition_id, ordinal, novelty)
select (select fresh_run_id from buyer_credit_fixtures where ordinal = 1),
  partition.id, 0, 'NEW_PARTITION'
from public.buyer_discovery_partitions partition
where partition.search_space_id = (select search_space_id from buyer_credit_fixtures where ordinal = 1)
  and partition.partition_key = 'web|credit-qa|fr|distributor';

set local role service_role;
do $atomic_accept_and_consume$
declare
  v_run uuid := (select fresh_run_id from buyer_credit_fixtures where ordinal = 1);
  v_first jsonb;
  v_retry jsonb;
begin
  v_first := public.accept_buyer_discovery_execution_v2(v_run);
  v_retry := public.accept_buyer_discovery_execution_v1(v_run);
  if (v_first->>'credit_balance')::integer <> 1
     or (v_first->>'reused')::boolean
     or not (v_retry->>'reused')::boolean
     or (select count(*) from public.buyer_discovery_credit_ledger
         where fresh_run_id = v_run and transaction_type = 'FRESH_DISCOVERY_DEBIT') <> 1 then
    raise exception 'atomic one-credit debit/retry contract failed';
  end if;
  perform public.mark_buyer_discovery_provider_started_v1(v_run);
  update public.external_prospect_discovery_runs
  set status = 'COMPLETED', stage = 'completed', candidates_accepted = 0,
      fresh_request_state = 'COMPLETED', completed_at = clock_timestamp()
  where id = v_run;
  if (select credit_disposition from public.external_prospect_discovery_runs
      where id = v_run) <> 'DEBIT_CONSUMED'
     or (select balance from public.buyer_discovery_credit_accounts
         where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)) <> 1 then
    raise exception 'zero-new completed work did not consume exactly one credit';
  end if;
end
$atomic_accept_and_consume$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id from buyer_credit_fixtures where ordinal = 1),
  'role', 'authenticated')::text, true);
set local role authenticated;
do $preprovider_request$
declare
  v_result jsonb;
begin
  v_result := public.start_customer_buyer_discovery_fresh_v1(
    (select company_id from buyer_credit_fixtures where ordinal = 1), gen_random_uuid(),
    (select base_run_id from buyer_credit_fixtures where ordinal = 1)
  );
  update buyer_credit_fixtures set fresh_run_id = (v_result->>'run_id')::uuid
  where ordinal = 1;
end
$preprovider_request$;
reset role;

insert into public.buyer_discovery_partitions(
  search_space_id, partition_key, provider_kind, partition_type,
  terminology, language_code, country_codes, market_region,
  buyer_archetype, retrieval_kind, priority
) values (
  (select search_space_id from buyer_credit_fixtures where ordinal = 1),
  'web|credit-qa|de|wholesaler', 'PUBLIC_WEB', 'COMMERCIAL_WEB',
  '["qa medical device"]'::jsonb, 'de', array['DE'], 'CENTRAL_EUROPE',
  'WHOLESALER', 'DIRECT_TERMS', 90
);
insert into public.buyer_discovery_run_partitions(run_id, partition_id, ordinal, novelty)
select (select fresh_run_id from buyer_credit_fixtures where ordinal = 1),
  partition.id, 0, 'NEW_PARTITION'
from public.buyer_discovery_partitions partition
where partition.search_space_id = (select search_space_id from buyer_credit_fixtures where ordinal = 1)
  and partition.partition_key = 'web|credit-qa|de|wholesaler';

set local role service_role;
do $preprovider_reversal$
declare
  v_run uuid := (select fresh_run_id from buyer_credit_fixtures where ordinal = 1);
  v_debit uuid;
  v_debit_amount integer;
  v_debit_balance integer;
begin
  perform public.accept_buyer_discovery_execution_v2(v_run);
  select id, amount, balance_after into v_debit, v_debit_amount, v_debit_balance
  from public.buyer_discovery_credit_ledger
  where fresh_run_id = v_run and transaction_type = 'FRESH_DISCOVERY_DEBIT';
  update public.external_prospect_discovery_runs
  set status = 'FAILED', stage = 'failed', error_code = 'QA_PRE_PROVIDER_FAILURE',
      fresh_request_state = 'FAILED_PRE_PROVIDER', completed_at = clock_timestamp()
  where id = v_run;
  update public.external_prospect_discovery_runs set stage = 'failed' where id = v_run;
  if (select credit_disposition from public.external_prospect_discovery_runs
      where id = v_run) <> 'REVERSED_PRE_PROVIDER'
     or (select count(*) from public.buyer_discovery_credit_ledger
         where fresh_run_id = v_run and transaction_type = 'REVERSAL') <> 1
     or (select count(*) from public.buyer_discovery_credit_ledger
         where fresh_run_id = v_run) <> 2
     or not exists (
       select 1 from public.buyer_discovery_credit_ledger
       where id = v_debit and amount = v_debit_amount
         and balance_after = v_debit_balance
         and transaction_type = 'FRESH_DISCOVERY_DEBIT'
     )
     or (select balance from public.buyer_discovery_credit_accounts
         where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)) <> 1 then
    raise exception 'pre-provider reversal/retry idempotency failed';
  end if;
end
$preprovider_reversal$;
reset role;

create temporary table buyer_credit_race_runs(
  ordinal integer primary key,
  run_id uuid not null,
  partition_id bigint
) on commit drop;
grant all on buyer_credit_race_runs to service_role;

insert into public.external_prospect_discovery_runs(
  company_id, requested_by, idempotency_key, intent_hash, intent_source,
  intent_context, search_space_id, run_mode, search_generation,
  fresh_request_state, credit_disposition
)
select fixture.company_id, fixture.user_id, gen_random_uuid(), repeat('1', 64),
  'PROFILE_PRODUCT', jsonb_build_object(
    'intent_source', 'PROFILE_PRODUCT', 'normalized_product_label', 'QA Device',
    'target_countries', jsonb_build_array('FR'), 'taxonomy', '[]'::jsonb
  ), fixture.search_space_id, 'FRESH_DISCOVERY', 4,
  'REQUESTED', 'DEBIT_PENDING'
from buyer_credit_fixtures fixture where fixture.ordinal = 1
returning id;

insert into buyer_credit_race_runs(ordinal, run_id)
select row_number() over ()::integer, id
from public.external_prospect_discovery_runs
where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)
  and run_mode = 'FRESH_DISCOVERY' and fresh_request_state = 'REQUESTED'
  and id <> (select fresh_run_id from buyer_credit_fixtures where ordinal = 1)
order by created_at desc limit 1;

insert into public.external_prospect_discovery_runs(
  company_id, requested_by, idempotency_key, intent_hash, intent_source,
  intent_context, search_space_id, run_mode, search_generation,
  fresh_request_state, credit_disposition
)
select fixture.company_id, fixture.user_id, gen_random_uuid(), repeat('1', 64),
  'PROFILE_PRODUCT', jsonb_build_object(
    'intent_source', 'PROFILE_PRODUCT', 'normalized_product_label', 'QA Device',
    'target_countries', jsonb_build_array('FR'), 'taxonomy', '[]'::jsonb
  ), fixture.search_space_id, 'FRESH_DISCOVERY', 5,
  'REQUESTED', 'DEBIT_PENDING'
from buyer_credit_fixtures fixture where fixture.ordinal = 1
returning id;

insert into buyer_credit_race_runs(ordinal, run_id)
select 2, id from public.external_prospect_discovery_runs
where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)
  and run_mode = 'FRESH_DISCOVERY' and fresh_request_state = 'REQUESTED'
  and id not in (select run_id from buyer_credit_race_runs)
order by created_at desc limit 1;

with inserted as (
  insert into public.buyer_discovery_partitions(
    search_space_id, partition_key, provider_kind, partition_type,
    terminology, language_code, country_codes, market_region,
    buyer_archetype, retrieval_kind, priority
  )
  select (select search_space_id from buyer_credit_fixtures where ordinal = 1),
    'web|credit-race-' || race.ordinal || '|fr|distributor',
    'PUBLIC_WEB', 'COMMERCIAL_WEB', '["qa medical device"]'::jsonb,
    'fr', array['FR'], 'WESTERN_EUROPE', 'DISTRIBUTOR', 'DIRECT_TERMS', 80
  from buyer_credit_race_runs race
  returning id, partition_key
)
update buyer_credit_race_runs race set partition_id = inserted.id
from inserted
where inserted.partition_key = 'web|credit-race-' || race.ordinal || '|fr|distributor';

insert into public.buyer_discovery_run_partitions(run_id, partition_id, ordinal, novelty)
select run_id, partition_id, 0, 'NEW_PARTITION' from buyer_credit_race_runs;

set local role service_role;
do $serialized_concurrency_safety$
declare
  v_first uuid := (select run_id from buyer_credit_race_runs where ordinal = 1);
  v_second uuid := (select run_id from buyer_credit_race_runs where ordinal = 2);
begin
  perform public.accept_buyer_discovery_execution_v2(v_first);
  begin
    perform public.accept_buyer_discovery_execution_v2(v_second);
    raise exception 'two requests consumed a one-credit balance';
  exception when raise_exception then
    if sqlerrm <> 'INSUFFICIENT_FRESH_DISCOVERY_CREDITS' then raise; end if;
  end;
  if (select balance from public.buyer_discovery_credit_accounts
      where company_id = (select company_id from buyer_credit_fixtures where ordinal = 1)) <> 0
     or (select count(*) from public.buyer_discovery_credit_ledger
         where fresh_run_id in (v_first, v_second)
           and transaction_type = 'FRESH_DISCOVERY_DEBIT') <> 1 then
    raise exception 'serialized one-credit concurrency invariant failed';
  end if;
  update public.external_prospect_discovery_runs
  set status = 'FAILED', stage = 'failed', error_code = 'QA_PRE_PROVIDER_FAILURE',
      fresh_request_state = 'FAILED_PRE_PROVIDER', completed_at = clock_timestamp()
  where id = v_first;
  update public.external_prospect_discovery_runs
  set status = 'FAILED', stage = 'failed', error_code = 'QA_NO_CREDIT',
      fresh_request_state = 'FAILED_PRE_PROVIDER', completed_at = clock_timestamp()
  where id = v_second;
end
$serialized_concurrency_safety$;
reset role;

do $final_accounting$
declare
  v_company bigint := (select company_id from buyer_credit_fixtures where ordinal = 1);
begin
  if (select sum(amount) from public.buyer_discovery_credit_ledger
      where company_id = v_company) <> (select balance
      from public.buyer_discovery_credit_accounts where company_id = v_company) then
    raise exception 'ledger and projected balance diverged';
  end if;
  if (select count(*) from public.buyer_discovery_credit_ledger
      where company_id = v_company and transaction_type = 'FRESH_DISCOVERY_DEBIT') <> 3
     or (select count(*) from public.buyer_discovery_credit_ledger
      where company_id = v_company and transaction_type = 'REVERSAL') <> 2 then
    raise exception 'unexpected debit/reversal count';
  end if;
end
$final_accounting$;

rollback;

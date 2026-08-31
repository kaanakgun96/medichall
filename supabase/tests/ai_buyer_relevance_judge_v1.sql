-- Rollback-only SQL/RLS regression for AI Buyer Relevance Judge V1.
begin;

create temporary table ai_buyer_judge_flag_baseline as
select
  (select smart_resolver_enabled
   from public.smart_product_resolver_feature_state where singleton)
    as smart_resolver_enabled,
  (select customer_fresh_enabled
   from public.buyer_discovery_credit_feature_state where singleton)
    as customer_fresh_enabled;

do $structure$
begin
  if to_regclass('public.ai_buyer_relevance_judge_feature_state') is null
     or to_regclass('public.buyer_relevance_judgments') is null
     or to_regprocedure(
       'public.reserve_ai_buyer_relevance_judgment_v1(bigint,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer)'
     ) is null
     or to_regprocedure(
       'public.complete_ai_buyer_relevance_judgment_v1(uuid,jsonb,text,text,integer,text,text,integer,integer,integer,numeric,integer)'
     ) is null
     or to_regprocedure(
       'public.fail_ai_buyer_relevance_judgment_v1(uuid,text)'
     ) is null then
    raise exception 'AI Buyer Relevance Judge database contract is incomplete';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
      where oid='public.ai_buyer_relevance_judge_feature_state'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class
      where oid='public.buyer_relevance_judgments'::regclass) then
    raise exception 'AI Buyer Relevance Judge RLS must be enabled and forced';
  end if;
  if (select ai_buyer_judge_enabled
      from public.ai_buyer_relevance_judge_feature_state where singleton) then
    raise exception 'AI Buyer Relevance Judge must default disabled';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='buyer_relevance_judgments'
      and column_name ~* '(email|phone|contact|message|whatsapp|linkedin|prompt)'
  ) then
    raise exception 'Private/contact/prompt fields entered judge persistence';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema='public'
        and table_name='company_external_prospect_matches'
        and column_name in (
          'buyer_fit_score','buyer_fit_grade','ai_buyer_judge_status',
          'ai_buyer_recommended_grade','ai_buyer_reason_codes',
          'ai_buyer_short_explanation'
        )) <> 6 then
    raise exception 'Buyer Fit persistence columns are incomplete';
  end if;
  if has_table_privilege('anon','public.buyer_relevance_judgments',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated','public.buyer_relevance_judgments',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role','public.buyer_relevance_judgments',
       'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('service_role',
       'public.buyer_relevance_judgments','SELECT') then
    raise exception 'AI Buyer Relevance Judge table privileges are unsafe';
  end if;
  if has_function_privilege('anon',
       'public.reserve_ai_buyer_relevance_judgment_v1(bigint,uuid,uuid,text,text,text,text,text,text,text,text,text,text,integer)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.complete_ai_buyer_relevance_judgment_v1(uuid,jsonb,text,text,integer,text,text,integer,integer,integer,numeric,integer)',
       'EXECUTE')
     or not has_function_privilege('service_role',
       'public.fail_ai_buyer_relevance_judgment_v1(uuid,text)','EXECUTE') then
    raise exception 'AI Buyer Relevance Judge service boundary regressed';
  end if;
end
$structure$;

create temporary table ai_buyer_judge_tenants(
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  run_id uuid
) on commit drop;
grant select on ai_buyer_judge_tenants to authenticated,service_role;
insert into ai_buyer_judge_tenants(ordinal,user_id,run_id)
values (1,gen_random_uuid(),gen_random_uuid()),
       (2,gen_random_uuid(),gen_random_uuid());

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
select user_id,'authenticated','authenticated',
  'ai-buyer-judge-'||ordinal||'@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now(),false,false from ai_buyer_judge_tenants;

with inserted as (
  insert into public.companies(
    owner_id,name,type,website,country,is_approved,is_active
  )
  select user_id,'AI Buyer Judge Tenant '||ordinal,
    'Medical device manufacturer',
    'https://ai-buyer-judge-'||ordinal||'.example.invalid',
    'Türkiye',false,true
  from ai_buyer_judge_tenants returning id,owner_id
)
update ai_buyer_judge_tenants fixture set company_id=inserted.id
from inserted where inserted.owner_id=fixture.user_id;

insert into public.external_prospect_discovery_runs(
  id,company_id,requested_by,status,idempotency_key,intent_hash,stage,
  intent_source,intent_context
)
select run_id,company_id,user_id,'RUNNING',gen_random_uuid(),
  repeat(ordinal::text,64),'ranking_prospects','PROFILE_PRODUCT',
  jsonb_build_object(
    'intent_source','PROFILE_PRODUCT','normalized_product_label','Camera Cover',
    'taxonomy','[]'::jsonb,'target_countries','[]'::jsonb
  )
from ai_buyer_judge_tenants;

select set_config('request.jwt.claims',
  jsonb_build_object('role','service_role')::text,true);
set local role service_role;
do $disabled_gate$
declare
  v_fixture record;
  v_reserved jsonb;
begin
  select * into v_fixture from ai_buyer_judge_tenants where ordinal=1;
  v_reserved := public.reserve_ai_buyer_relevance_judgment_v1(
    v_fixture.company_id,v_fixture.user_id,v_fixture.run_id,
    repeat('a',64),'QA Distributor','qa-distributor.example',repeat('b',64),
    'Camera Cover',repeat('c',64),'AI_BUYER_RELEVANCE_JUDGE_V1',
    'AI_BUYER_RELEVANCE_JUDGE_V1_0','claude-haiku-4-5',
    'DIRECT_BUYER',82
  );
  if v_reserved->>'decision' <> 'DISABLED'
     or exists (select 1 from public.buyer_relevance_judgments
       where company_id=v_fixture.company_id) then
    raise exception 'Disabled AI Buyer Judge created a reservation';
  end if;
end
$disabled_gate$;
reset role;

-- Explicit rollout action for regression only; transaction rollback restores OFF.
update public.ai_buyer_relevance_judge_feature_state
set ai_buyer_judge_enabled=true where singleton;

select set_config('request.jwt.claims',
  jsonb_build_object('role','service_role')::text,true);
set local role service_role;
do $cache_and_isolation$
declare
  v_fixture record;
  v_other record;
  v_reserved jsonb;
  v_completed jsonb;
  v_cached jsonb;
  v_changed jsonb;
  v_result jsonb := jsonb_build_object(
    'candidate_id',repeat('a',24),'product_fit','HIGH',
    'buyer_role','DISTRIBUTOR','buyer_role_confidence','HIGH',
    'commercial_fit','HIGH','sales_actionability','HIGH',
    'contradiction','NONE','recommended_grade','DIRECT_BUYER',
    'buyer_fit_score',88,
    'reason_codes',jsonb_build_array('MEDICAL_DISTRIBUTOR_PRODUCT_MATCH'),
    'short_explanation','Verified product evidence and distributor role support a strong buyer fit.'
  );
begin
  select * into v_fixture from ai_buyer_judge_tenants where ordinal=1;
  select * into v_other from ai_buyer_judge_tenants where ordinal=2;
  v_reserved := public.reserve_ai_buyer_relevance_judgment_v1(
    v_fixture.company_id,v_fixture.user_id,v_fixture.run_id,
    repeat('a',64),'QA Distributor','qa-distributor.example',repeat('b',64),
    'Camera Cover',repeat('c',64),'AI_BUYER_RELEVANCE_JUDGE_V1',
    'AI_BUYER_RELEVANCE_JUDGE_V1_0','claude-haiku-4-5',
    'DIRECT_BUYER',82
  );
  if v_reserved->>'decision' <> 'PROCEED' then
    raise exception 'First AI Buyer Judge reservation did not proceed: %',v_reserved;
  end if;
  v_completed := public.complete_ai_buyer_relevance_judgment_v1(
    (v_reserved->>'cache_id')::uuid,v_result,'DIRECT_BUYER','DIRECT_BUYER',86,
    'claude-haiku-4-5','qa-provider-id',240,70,310,0.000590,180
  );
  if v_completed->>'status' <> 'COMPLETED' then
    raise exception 'AI Buyer Judge completion failed';
  end if;
  v_cached := public.reserve_ai_buyer_relevance_judgment_v1(
    v_fixture.company_id,v_fixture.user_id,v_fixture.run_id,
    repeat('a',64),'QA Distributor','qa-distributor.example',repeat('b',64),
    'Camera Cover',repeat('c',64),'AI_BUYER_RELEVANCE_JUDGE_V1',
    'AI_BUYER_RELEVANCE_JUDGE_V1_0','claude-haiku-4-5',
    'DIRECT_BUYER',82
  );
  if v_cached->>'decision' <> 'CACHED'
     or v_cached->>'cache_id' <> v_reserved->>'cache_id'
     or (select count(*) from public.buyer_relevance_judgments
       where company_id=v_fixture.company_id) <> 1 then
    raise exception 'AI Buyer Judge cache reuse failed';
  end if;
  v_changed := public.reserve_ai_buyer_relevance_judgment_v1(
    v_fixture.company_id,v_fixture.user_id,v_fixture.run_id,
    repeat('a',64),'QA Distributor','qa-distributor.example',repeat('b',64),
    'Camera Cover',repeat('d',64),'AI_BUYER_RELEVANCE_JUDGE_V1',
    'AI_BUYER_RELEVANCE_JUDGE_V1_0','claude-haiku-4-5',
    'DIRECT_BUYER',82
  );
  if v_changed->>'decision' <> 'PROCEED'
     or v_changed->>'cache_id' = v_reserved->>'cache_id' then
    raise exception 'Evidence fingerprint did not invalidate AI cache';
  end if;
  perform public.fail_ai_buyer_relevance_judgment_v1(
    (v_changed->>'cache_id')::uuid,'AI_BUYER_JUDGE_FAILED_FALLBACK'
  );
  begin
    perform public.reserve_ai_buyer_relevance_judgment_v1(
      v_other.company_id,v_fixture.user_id,v_other.run_id,
      repeat('e',64),'Cross Tenant','cross.example',repeat('b',64),
      'Camera Cover',repeat('f',64),'AI_BUYER_RELEVANCE_JUDGE_V1',
      'AI_BUYER_RELEVANCE_JUDGE_V1_0','claude-haiku-4-5',
      'DIRECT_BUYER',80
    );
    raise exception 'Cross-company AI Buyer Judge reservation succeeded';
  exception when insufficient_privilege then null;
  end;
end
$cache_and_isolation$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select user_id from ai_buyer_judge_tenants where ordinal=1),
  'role','authenticated')::text,true);
set local role authenticated;
do $tenant_boundary$
begin
  begin
    perform count(*) from public.buyer_relevance_judgments;
    raise exception 'Authenticated direct AI Buyer Judge read succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.buyer_relevance_judgments(
      company_id,candidate_key,candidate_name,product_intent_key,product_label,
      evidence_fingerprint,judge_version,implementation_version,model_name,
      deterministic_grade,deterministic_score
    ) values (
      (select company_id from ai_buyer_judge_tenants where ordinal=1),
      repeat('1',64),'Forbidden',repeat('2',64),'Camera Cover',repeat('3',64),
      'AI_BUYER_RELEVANCE_JUDGE_V1','AI_BUYER_RELEVANCE_JUDGE_V1_0',
      'claude-haiku-4-5','DIRECT_BUYER',80
    );
    raise exception 'Authenticated direct AI Buyer Judge mutation succeeded';
  exception when insufficient_privilege then null;
  end;
end
$tenant_boundary$;
reset role;

do $final_invariants$
begin
  if (select customer_fresh_enabled
      from public.buyer_discovery_credit_feature_state where singleton)
       is distinct from
     (select customer_fresh_enabled from ai_buyer_judge_flag_baseline) then
    raise exception 'AI Buyer Judge QA changed Customer Fresh';
  end if;
  if (select smart_resolver_enabled
      from public.smart_product_resolver_feature_state where singleton)
       is distinct from
     (select smart_resolver_enabled from ai_buyer_judge_flag_baseline) then
    raise exception 'AI Buyer Judge QA changed Smart Resolver';
  end if;
  if exists (
    select 1 from public.buyer_discovery_credit_ledger
    where fresh_run_id in (select run_id from ai_buyer_judge_tenants)
  ) then
    raise exception 'AI Buyer Judge consumed a Fresh credit';
  end if;
end
$final_invariants$;

rollback;

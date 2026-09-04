begin;

do $contract$
declare
  v_constraint text;
begin
  if to_regclass('public.universal_high_recall_buyer_discovery_feature_state') is null
     or to_regclass('public.buyer_discovery_run_ranked_prospects') is null
     or to_regprocedure(
       'public.get_buyer_discovery_ranked_prospects_v2(bigint,uuid,integer,integer,bigint)'
     ) is null
     or to_regprocedure(
       'public.set_universal_high_recall_buyer_discovery_v2(boolean)'
     ) is null then
    raise exception 'Universal High-Recall V2 persistence contract is incomplete';
  end if;

  if (select high_recall_enabled
      from public.universal_high_recall_buyer_discovery_feature_state
      where singleton) then
    raise exception 'Universal High-Recall V2 must be disabled by default';
  end if;
  if (select architecture_version <> 'UNIVERSAL_HIGH_RECALL_V2'
      from public.universal_high_recall_buyer_discovery_feature_state
      where singleton) then
    raise exception 'Universal High-Recall architecture version regressed';
  end if;
  if (select high_recall_public_web_maximum <> 25
      from public.universal_high_recall_buyer_discovery_feature_state
      where singleton) then
    raise exception 'High-Recall Public Web ceiling regressed';
  end if;
  if (select implementation_version <> 'AI_BUYER_RELEVANCE_JUDGE_V2_0'
      from public.ai_buyer_relevance_judge_feature_state where singleton) then
    raise exception 'AI Buyer Judge implementation cache version was not advanced';
  end if;
  if exists (
    select 1 from public.buyer_relevance_judgments
    where implementation_version <> 'AI_BUYER_RELEVANCE_JUDGE_V2_0'
      and status in ('COMPLETED','FAILED')
      and expires_at > clock_timestamp()
  ) then
    raise exception 'Older AI Buyer Judge cache remains reusable';
  end if;

  if not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.universal_high_recall_buyer_discovery_feature_state'::regclass)
     or not (select relrowsecurity and relforcerowsecurity from pg_class
          where oid = 'public.buyer_discovery_run_ranked_prospects'::regclass) then
    raise exception 'High-Recall feature/snapshot RLS must be enabled and forced';
  end if;

  if has_table_privilege('anon',
       'public.universal_high_recall_buyer_discovery_feature_state','SELECT')
     or has_table_privilege('authenticated',
       'public.universal_high_recall_buyer_discovery_feature_state','SELECT')
     or has_table_privilege('anon',
       'public.buyer_discovery_run_ranked_prospects','SELECT')
     or has_table_privilege('authenticated',
       'public.buyer_discovery_run_ranked_prospects','SELECT') then
    raise exception 'High-Recall state/snapshots leaked through direct table grants';
  end if;
  if not has_table_privilege('service_role',
       'public.universal_high_recall_buyer_discovery_feature_state','SELECT')
     or not has_table_privilege('service_role',
       'public.buyer_discovery_run_ranked_prospects','SELECT')
     or has_table_privilege('service_role',
       'public.universal_high_recall_buyer_discovery_feature_state','UPDATE')
     or has_table_privilege('service_role',
       'public.buyer_discovery_run_ranked_prospects','INSERT')
     or has_table_privilege('service_role',
       'public.buyer_discovery_run_ranked_prospects','UPDATE')
     or has_table_privilege('service_role',
       'public.buyer_discovery_run_ranked_prospects','DELETE') then
    raise exception 'Service-role direct access must be read-only';
  end if;
  if has_function_privilege(
       'anon',
       'public.get_buyer_discovery_ranked_prospects_v2(bigint,uuid,integer,integer,bigint)',
       'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.get_buyer_discovery_ranked_prospects_v2(bigint,uuid,integer,integer,bigint)',
       'EXECUTE'
     ) then
    raise exception 'Paginated read grants regressed';
  end if;
  if has_function_privilege(
       'anon',
       'public.sync_buyer_discovery_run_ranked_prospect_v2()',
       'EXECUTE'
     ) then
    raise exception 'Internal snapshot trigger function is directly executable';
  end if;

  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint
  where conrelid = 'public.external_prospect_discovery_runs'::regclass
    and conname = 'external_prospect_discovery_runs_candidates_accepted_v2_check';
  if v_constraint is null or v_constraint !~ '100' then
    raise exception 'Run persistence capacity does not support 100 prospects';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'universal_high_recall_buyer_discovery_feature_state',
        'buyer_discovery_run_ranked_prospects'
      )
      and column_name ~* '(email|phone|contact|whatsapp|linkedin|secret|api_key)'
  ) then
    raise exception 'Private contact or secret collection entered V2 persistence';
  end if;
end
$contract$;

create temporary table high_recall_v2_fixture (
  ordinal integer primary key,
  user_id uuid not null,
  company_id bigint,
  run_id uuid
) on commit drop;

insert into high_recall_v2_fixture(ordinal,user_id)
values (1,gen_random_uuid()),(2,gen_random_uuid());

insert into auth.users(
  id,aud,role,email,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_sso_user,is_anonymous
)
select user_id,'authenticated','authenticated',
  'high-recall-v2-' || ordinal || '@example.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  now(),now(),false,false
from high_recall_v2_fixture;

with inserted as (
  insert into public.companies(
    owner_id,name,type,website,country,is_approved,is_active
  )
  select user_id,'High Recall V2 Tenant ' || ordinal,
    'Medical device manufacturer',
    'https://high-recall-v2-tenant-' || ordinal || '.example.invalid',
    'Türkiye',false,true
  from high_recall_v2_fixture
  returning id,owner_id
)
update high_recall_v2_fixture fixture
set company_id = inserted.id
from inserted where inserted.owner_id = fixture.user_id;

insert into public.admins(user_id)
select user_id from high_recall_v2_fixture where ordinal = 1;

insert into public.external_prospect_discovery_runs(
  company_id,requested_by,status,idempotency_key,intent_hash,stage,
  intent_source,intent_context,queries_generated,sources_checked,
  candidates_found,candidates_deduplicated,candidates_accepted,
  candidates_rejected,provider_requests,estimated_cost_usd,
  new_verified_buyers,updated_verified_buyers,
  previously_discovered_buyers,started_at,completed_at
)
select company_id,user_id,'COMPLETED',gen_random_uuid(),repeat('9',64),'complete',
  'AD_HOC_PRODUCT',jsonb_build_object(
    'intent_source','AD_HOC_PRODUCT','normalized_product_label','Fixture product',
    'taxonomy','[]'::jsonb,'target_countries',jsonb_build_array('FR')
  ),32,300,300,200,100,200,32,0.250000,100,100,100,
  clock_timestamp(),clock_timestamp()
from high_recall_v2_fixture
returning id,company_id;

update high_recall_v2_fixture fixture
set run_id = run.id
from public.external_prospect_discovery_runs run
where run.company_id = fixture.company_id and run.intent_hash = repeat('9',64);

-- The widened values are storage ceilings. One step beyond remains rejected.
do $bounded_capacity$
declare
  v_run uuid := (select run_id from high_recall_v2_fixture where ordinal=1);
begin
  begin
    update public.external_prospect_discovery_runs
    set candidates_accepted = 101 where id = v_run;
    raise exception 'Run accepted-count ceiling exceeded 100';
  exception when check_violation then null;
  end;
end
$bounded_capacity$;

do $cache_variant_capacity$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.external_public_web_request_cache'::regclass
      and conname = 'external_public_web_request_cache_query_variant_v2_check'
      and pg_get_constraintdef(oid) ~ '24'
  ) then
    raise exception 'High-Recall cache cannot persist all 25 query variants';
  end if;
end
$cache_variant_capacity$;

with generated as (
  select generate_series(1,101) as ordinal
), inserted as (
  insert into public.external_companies(
    company_name,country_code,country_name,company_type,website_url,
    business_description,last_verified_at
  )
  select 'High Recall Prospect ' || ordinal,'FR','France','Distributor',
    'https://high-recall-prospect-' || ordinal || '.example.invalid',
    'Medical-device distributor fixture',clock_timestamp()
  from generated
  returning id,company_name
)
select count(*) from inserted;

insert into public.company_external_prospect_matches(
  company_id,external_company_id,discovery_run_id,first_discovery_run_id,
  last_discovery_run_id,discovery_state,evidence_fingerprint,intent_hash,
  relevance_score,product_taxonomy_score,geography_score,company_type_score,
  procurement_signal_score,evidence_quality_score,recency_score,target_market,
  reason_summary,reasons,evidence_snapshot,activity_snapshot,taxonomy_snapshot,
  buyer_fit_score,buyer_fit_grade,prospect_tier,
  sales_actionability_score,sales_actionability_grade,evidence_level,
  evidence_facets,evidence_confidence_score,evidence_confidence_grade,
  final_rank_score,ranking_version,displayable
)
select fixture.company_id,external_company.id,fixture.run_id,fixture.run_id,
  fixture.run_id,'NEW',lpad(to_hex(external_company.id),64,'0'),repeat('9',64),
  75,30,10,10,10,10,5,true,
  'Verified fixture commercial prospect','[]'::jsonb,'[]'::jsonb,
  '[]'::jsonb,'[]'::jsonb,
  75,'HIGH',case
    when ordinal <= 20 then 'STRONG_COMMERCIAL_PROSPECT'
    when ordinal <= 60 then 'LIKELY_COMMERCIAL_PROSPECT'
    else 'POTENTIAL_COMMERCIAL_PROSPECT' end,
  75,'HIGH',4,
  '{"company":true,"category":true,"product":true,"commercial":true}'::jsonb,
  80,'HIGH',101-ordinal,'UNIVERSAL_HIGH_RECALL_V2',true
from high_recall_v2_fixture fixture
join lateral (
  select company.id,company.company_name,
    substring(company.company_name from '[0-9]+$')::integer as ordinal
  from public.external_companies company
  where company.company_name like 'High Recall Prospect %'
  order by substring(company.company_name from '[0-9]+$')::integer
  limit 100
) external_company on true
where fixture.ordinal=1;

do $snapshot_capacity$
declare
  v_company bigint := (select company_id from high_recall_v2_fixture where ordinal=1);
  v_run uuid := (select run_id from high_recall_v2_fixture where ordinal=1);
  v_external bigint := (
    select id from public.external_companies
    where company_name='High Recall Prospect 101'
  );
begin
  if (select count(*) from public.buyer_discovery_run_ranked_prospects
      where run_id=v_run) <> 100 then
    raise exception 'Run snapshot did not retain exactly 100 ranked prospects';
  end if;
  begin
    insert into public.company_external_prospect_matches(
      company_id,external_company_id,discovery_run_id,first_discovery_run_id,
      last_discovery_run_id,discovery_state,evidence_fingerprint,intent_hash,
      relevance_score,product_taxonomy_score,geography_score,company_type_score,
      procurement_signal_score,evidence_quality_score,recency_score,target_market,
      reason_summary,reasons,evidence_snapshot,activity_snapshot,taxonomy_snapshot,
      buyer_fit_score,buyer_fit_grade,prospect_tier,
      sales_actionability_score,sales_actionability_grade,evidence_level,
      evidence_facets,evidence_confidence_score,evidence_confidence_grade,
      final_rank_score,ranking_version,displayable
    ) values (
      v_company,v_external,v_run,v_run,v_run,'NEW',repeat('8',64),repeat('9',64),
      75,30,10,10,10,10,5,true,'Ceiling fixture','[]','[]','[]','[]',
      75,'HIGH','POTENTIAL_COMMERCIAL_PROSPECT',60,'MEDIUM',2,
      '{"company":true,"category":true,"product":false,"commercial":true}',
      60,'MEDIUM',0,'UNIVERSAL_HIGH_RECALL_V2',true
    );
    raise exception 'Per-run ranked prospect ceiling exceeded 100';
  exception when check_violation then null;
  end;
end
$snapshot_capacity$;

grant all on high_recall_v2_fixture to authenticated,service_role;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',(select user_id from high_recall_v2_fixture where ordinal=1),
  'role','authenticated')::text,true);
set local role authenticated;

do $pagination_and_tenant$
declare
  v_company bigint := (select company_id from high_recall_v2_fixture where ordinal=1);
  v_other_company bigint := (select company_id from high_recall_v2_fixture where ordinal=2);
  v_run uuid := (select run_id from high_recall_v2_fixture where ordinal=1);
  v_other_run uuid := (select run_id from high_recall_v2_fixture where ordinal=2);
  v_page_1 jsonb;
  v_page_2 jsonb;
  v_max_page jsonb;
  v_cursor jsonb;
begin
  v_page_1 := public.get_buyer_discovery_ranked_prospects_v2(
    v_company,v_run,25,null,null
  );
  if jsonb_array_length(v_page_1->'items') <> 25
     or not (v_page_1#>>'{page,has_more}')::boolean
     or (v_page_1->>'total_displayable')::integer <> 100 then
    raise exception 'First 25-result page is incomplete';
  end if;
  v_cursor := v_page_1#>'{page,next_cursor}';
  v_page_2 := public.get_buyer_discovery_ranked_prospects_v2(
    v_company,v_run,25,
    (v_cursor->>'final_rank_score')::integer,
    (v_cursor->>'match_id')::bigint
  );
  if jsonb_array_length(v_page_2->'items') <> 25
     or exists (
       select 1
       from jsonb_array_elements(v_page_1->'items') left_item
       join jsonb_array_elements(v_page_2->'items') right_item
         on left_item->>'match_id'=right_item->>'match_id'
     ) then
    raise exception 'Keyset pagination duplicated or lost the second page';
  end if;
  v_max_page := public.get_buyer_discovery_ranked_prospects_v2(
    v_company,v_run,100,null,null
  );
  if jsonb_array_length(v_max_page->'items') <> 50
     or (v_max_page#>>'{page,page_size}')::integer <> 50 then
    raise exception 'Paginated read exceeded or failed its 50-result page cap';
  end if;
  if (v_page_1#>>'{items,0,final_rank_score}')::integer <> 100
     or (v_page_2#>>'{items,0,final_rank_score}')::integer <> 75 then
    raise exception 'Final-rank ordering is unstable';
  end if;
  begin
    perform public.get_buyer_discovery_ranked_prospects_v2(
      v_other_company,v_run,25,null,null
    );
    raise exception 'Cross-company page read succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_buyer_discovery_ranked_prospects_v2(
      v_company,v_other_run,25,null,null
    );
    raise exception 'Cross-company run read succeeded';
  exception when insufficient_privilege then null;
  end;
  if not (public.set_universal_high_recall_buyer_discovery_v2(true)
          ->>'high_recall_enabled')::boolean then
    raise exception 'Verified admin could not use the controlled rollout boundary';
  end if;
end
$pagination_and_tenant$;

reset role;

-- No function invocation may leak this transaction's temporary state.
rollback;

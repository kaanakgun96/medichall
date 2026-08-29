import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read=path=>fs.readFileSync(path,"utf8");
const uiSource=read("external-prospects.js");
const cssSource=read("external-prospects.css");
const edgeSource=read("supabase/functions/external-prospect-discovery/index.ts");
const discoveryHandler=edgeSource.slice(edgeSource.indexOf('if (operation !== "discover")'));
const migrationSource=read("supabase/migrations/202608260001_buyer_discovery_customer_credits.sql");
const privilegeHotfixSource=read("supabase/migrations/202608270001_buyer_discovery_credit_ledger_privilege_hotfix.sql");
const sqlTestSource=read("supabase/tests/buyer_discovery_customer_credits.sql");
const portalSource=read("portal.html");
const standaloneSource=read("matchmaking.html");

new Function(uiSource);

const functionBody=(name,next)=>{
  const start=migrationSource.indexOf(`create or replace function public.${name}`);
  const end=next?migrationSource.indexOf(`create or replace function public.${next}`,start+1):migrationSource.length;
  assert.ok(start>=0&&end>start,`${name} definition missing`);
  return migrationSource.slice(start,end);
};

test("credit ledger is append-only, tenant-scoped and feature-gated",()=>{
  for(const table of ["buyer_discovery_credit_accounts","buyer_discovery_credit_ledger","buyer_discovery_credit_feature_state"]){
    assert.match(migrationSource,new RegExp(`create table public\\.${table}`));
  }
  assert.match(migrationSource,/customer_fresh_enabled boolean not null default false/);
  assert.match(migrationSource,/force row level security/g);
  assert.match(migrationSource,/company owners read buyer discovery credit accounts/);
  assert.match(migrationSource,/company owners read buyer discovery credit ledger/);
  assert.match(migrationSource,/grant select on table public\.buyer_discovery_credit_feature_state,[\s\S]*?to service_role/);
  assert.doesNotMatch(migrationSource,/grant all on table public\.buyer_discovery_credit/);
  assert.match(migrationSource,/unique \(company_id, idempotency_key\)/);
  assert.match(migrationSource,/buyer_discovery_credit_ledger_run_debit_uidx/);
  assert.match(migrationSource,/FRESH_DISCOVERY_DEBIT/);
  assert.match(migrationSource,/ADMIN_ADJUSTMENT/);
  assert.match(privilegeHotfixSource,/revoke all privileges on table[\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(privilegeHotfixSource,/grant select on table[\s\S]*?to service_role/);
  assert.doesNotMatch(privilegeHotfixSource,/alter default privileges/i);
  assert.match(sqlTestSource,/direct_ledger_mutation_denied/);
  assert.match(sqlTestSource,/service_role truncated historical ledger entries/);
  assert.doesNotMatch(migrationSource,/stripe_customer|paypal_order|payment_intent|checkout_session/i);
});

test("customer request defers debit and service acceptance performs it atomically",()=>{
  const start=functionBody("start_customer_buyer_discovery_fresh_v1","accept_buyer_discovery_execution_v2");
  const accept=functionBody("accept_buyer_discovery_execution_v2","mark_buyer_discovery_provider_started_v1");
  const apply=functionBody("apply_buyer_discovery_credit_entry_v1","get_company_buyer_discovery_credits_v1");
  assert.match(start,/customer_fresh_enabled/);
  assert.match(start,/status in \('COMPLETED', 'PARTIAL'\)/);
  assert.match(start,/DEBIT_PENDING/);
  assert.doesNotMatch(start,/FRESH_DISCOVERY_DEBIT/);
  assert.match(accept,/status = 'PLANNED'/);
  assert.match(accept,/FRESH_DISCOVERY_DEBIT', -1/);
  assert.match(accept,/fresh_run_count = fresh_run_count \+ 1/);
  assert.match(apply,/pg_advisory_xact_lock/);
  assert.match(apply,/for update/);
  assert.match(apply,/INSUFFICIENT_FRESH_DISCOVERY_CREDITS/);
  assert.match(apply,/Credit idempotency key already has different semantics/);
  assert.match(migrationSource,/accept_buyer_discovery_execution_v1[\s\S]*?accept_buyer_discovery_execution_v2/);
});

test("pre-provider failures reverse once while post-provider and zero-new work consume",()=>{
  const settlement=functionBody("settle_buyer_discovery_customer_credit_v1");
  assert.match(settlement,/FAILED_PRE_PROVIDER/);
  assert.match(settlement,/provider_execution_started_at is not null/);
  assert.match(settlement,/transaction_type in \('REVERSAL', 'REFUND'\)/);
  assert.match(settlement,/REVERSED_PRE_PROVIDER/);
  assert.match(settlement,/FAILED_POST_PROVIDER/);
  assert.match(settlement,/DEBIT_CONSUMED/);
  assert.doesNotMatch(settlement,/candidates_accepted\s*>/);
  assert.match(sqlTestSource,/zero-new completed work did not consume exactly one credit/);
  assert.match(sqlTestSource,/pre-provider reversal\/retry idempotency failed/);
});

test("admin grants are audited and Admin QA stays waived",()=>{
  assert.match(migrationSource,/grant_company_buyer_discovery_credits_v1/);
  assert.match(migrationSource,/adjust_company_buyer_discovery_credits_v1/);
  assert.match(migrationSource,/if auth\.uid\(\) is null or not public\.is_admin\(\)/g);
  assert.match(migrationSource,/created_by uuid references auth\.users/);
  assert.match(migrationSource,/run_mode = 'ADMIN_QA_FRESH'[\s\S]*?WAIVED_ADMIN_QA/);
  assert.match(migrationSource,/CUSTOMER_FRESH_DAILY_SAFETY_LIMIT_REACHED/);
  assert.match(migrationSource,/CUSTOMER_FRESH_MONTHLY_SAFETY_LIMIT_REACHED/);
  assert.match(migrationSource,/configure_buyer_discovery_credit_policy_v1/);
  assert.match(migrationSource,/initial_credit_grant/);
  assert.match(migrationSource,/get_buyer_discovery_credit_metrics_v1/);
  for(const metric of ["credit_debits","fresh_runs","successful_fresh_runs","pre_provider_reversals","zero_new_runs","new_buyers_per_credit","provider_cost_usd","remaining_balance"]){
    assert.match(migrationSource,new RegExp(`'${metric}'`));
  }
});

test("Edge uses one canonical engine with an explicit debit and provider-start boundary",()=>{
  assert.match(edgeSource,/start_customer_buyer_discovery_fresh_v1/);
  assert.match(edgeSource,/p_base_run_id: baseRunId/);
  assert.match(edgeSource,/accept_buyer_discovery_execution_v2/);
  assert.match(edgeSource,/mark_buyer_discovery_provider_started_v1/);
  assert.match(edgeSource,/NO_FRESH_SEARCH_SPACE/);
  assert.match(edgeSource,/credit_refunded/);
  assert.match(edgeSource,/credit_charged/);
  assert.match(edgeSource,/FAILED_POST_PROVIDER/);
  assert.doesNotMatch(discoveryHandler,/sendEmail|createNotification|openai|api\.anthropic\.com|callSmartProductResolver/i);
});

function completedWorkspace(){
  return {
    product_context:{products:[{product_id:1,product_name:"Camera Cover",taxonomy_id:101,canonical_name:"Camera Cover",slug:"camera-cover"}],website_available:false},
    website_scans:[],search_spaces:[],
    runs:[{id:"00000000-0000-4000-8000-000000000001",status:"COMPLETED",stage:"completed",run_mode:"NORMAL_DISCOVERY",intent_hash:"saved-intent",intent_source:"PROFILE_PRODUCT",created_at:"2026-08-26T08:00:00Z",completed_at:"2026-08-26T08:01:00Z",intent_context:{normalized_product_label:"Camera Cover",taxonomy:[{taxonomy_id:101,canonical_name:"Camera Cover"}],target_countries:["FR"],intent_source:"PROFILE_PRODUCT"},sources_checked:8,candidates_found:3,candidates_deduplicated:1,candidates_accepted:2}],
    prospects:[]
  };
}

function createHarness({credits,edgeSteps=[],isAdmin=false}={}){
  const rootListeners=new Map(),documentListeners=new Map(),timers=new Map();
  const root={innerHTML:"",addEventListener:(type,listener)=>rootListeners.set(type,listener),removeEventListener:type=>rootListeners.delete(type),contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
  const document={hidden:false,activeElement:null,addEventListener:(type,listener)=>documentListeners.set(type,listener),removeEventListener:type=>documentListeners.delete(type),createElement:()=>({className:"",textContent:""})};
  let nextTimer=0,edgeCalls=0;
  const edgeBodies=[];
  const context={console,crypto:{randomUUID:()=>"10000000-0000-4000-8000-000000000001"},document,URL,setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),sessionStorage:{setItem(){}}};
  vm.runInNewContext(uiSource,context,{filename:"external-prospects.js"});
  const workspace=completedWorkspace();
  const component=context.MedicHallExternalProspects.createWorkspace({
    root,companyId:7,profile:{role:"manufacturer",target_countries:["FR"]},targetCountries:["FR"],
    rpc:async name=>name==="is_admin"?isAdmin:name==="get_company_buyer_discovery_credits_v1"?structuredClone(credits):structuredClone(workspace),
    edge:async(_name,body)=>{edgeCalls+=1;edgeBodies.push(structuredClone(body));const next=edgeSteps.shift();return typeof next==="function"?next():next;},
    toast:()=>{},track:()=>{}
  });
  const click=action=>rootListeners.get("click")({target:{dataset:{action},matches(selector){return selector==="[data-fresh-backdrop]"&&action==="backdrop";},closest(){return this;}}});
  return {component,root,click,edgeBodies,edgeCalls:()=>edgeCalls};
}

const flush=async()=>{for(let index=0;index<10;index+=1)await Promise.resolve();};

test("customer sees balance, exact CTA and informed confirmation",async()=>{
  const credits={customer_fresh_enabled:true,credit_cost:1,balance:2,can_run_fresh:true,history:[]};
  const harness=createHarness({credits,edgeSteps:[()=>{credits.balance=1;return Promise.resolve({run:{run_id:"fresh-1",status:"COMPLETED"},new_verified_buyers:0,updated_verified_buyers:0,previously_discovered_buyers:2,cumulative_verified_buyers:2,credit_balance:1,credit_disposition:"DEBIT_CONSUMED"});}]});
  await harness.component.load();
  assert.match(harness.root.innerHTML,/Find More Buyers · 1 Credit/);
  assert.match(harness.root.innerHTML,/2 credits available/);
  assert.match(harness.root.innerHTML,/Normal searches[^<]*14 days and use 0 credits/);
  harness.click("request-fresh");
  assert.match(harness.root.innerHTML,/role="dialog" aria-modal="true"/);
  assert.match(harness.root.innerHTML,/additional terminology, markets, languages and buyer sources/);
  assert.match(harness.root.innerHTML,/This does not guarantee a new buyer/);
  assert.match(harness.root.innerHTML,/Pre-provider failure or no available search space uses no credit/);
  assert.match(harness.root.innerHTML,/After accepted search/);
  harness.click("confirm-fresh");harness.click("confirm-fresh");
  assert.equal(harness.edgeCalls(),1);
  assert.equal(harness.edgeBodies[0].run_mode,"FRESH_DISCOVERY");
  assert.equal(harness.edgeBodies[0].base_run_id,"00000000-0000-4000-8000-000000000001");
  await flush();
  assert.match(harness.root.innerHTML,/No additional verified buyers were found/);
  assert.match(harness.root.innerHTML,/Remaining balance: 1 credit/);
});

test("zero credits are safely disabled without hiding existing results",async()=>{
  const harness=createHarness({credits:{customer_fresh_enabled:true,credit_cost:1,balance:0,can_run_fresh:false,history:[]}});
  await harness.component.load();
  assert.match(harness.root.innerHTML,/Find More Buyers · 1 Credit/);
  assert.match(harness.root.innerHTML,/No credits available/);
  assert.match(harness.root.innerHTML,/Credits unavailable — contact MedicHall/);
  assert.match(harness.root.innerHTML,/disabled aria-disabled="true"/);
  harness.click("request-fresh");
  assert.doesNotMatch(harness.root.innerHTML,/role="dialog"/);
  assert.equal(harness.edgeCalls(),0);
});

test("pre-provider refund and no-search-space errors remain explicit",async()=>{
  for(const failure of [
    {edgeDetails:{code:"DISCOVERY_PROVIDER_START_FAILED",credit_refunded:true}},
    {edgeDetails:{code:"NO_FRESH_SEARCH_SPACE",credit_refunded:false}}
  ]){
    const harness=createHarness({credits:{customer_fresh_enabled:true,credit_cost:1,balance:1,can_run_fresh:true,history:[]},edgeSteps:[()=>Promise.reject(failure)]});
    await harness.component.load();harness.click("request-fresh");harness.click("confirm-fresh");await flush();
    assert.match(harness.root.innerHTML,failure.edgeDetails.credit_refunded?/credit was returned/:/No additional unused search space was available/);
    assert.equal(harness.edgeCalls(),1);
  }
});

test("feature flag prevents half-live customer UI while admin flow remains separate",async()=>{
  const disabled=createHarness({credits:{customer_fresh_enabled:false,credit_cost:1,balance:5,can_run_fresh:false,history:[]}});
  await disabled.component.load();
  assert.doesNotMatch(disabled.root.innerHTML,/Find More Buyers · 1 Credit/);
  const admin=createHarness({isAdmin:true,credits:{customer_fresh_enabled:true,credit_cost:1,balance:5,can_run_fresh:true,history:[]}});
  await admin.component.load();
  assert.match(admin.root.innerHTML,/Admin QA — no customer credit used/);
  assert.doesNotMatch(admin.root.innerHTML,/5 credits available/);
});

test("responsive/accessibility and cache-release contracts are present",()=>{
  assert.match(cssSource,/\.mhxp-customer-fresh/);
  assert.match(cssSource,/@media\(max-width:700px\)[^{]*\{\.mhxp-admin-fresh,\.mhxp-customer-fresh/);
  assert.match(cssSource,/safe-area-inset-bottom/);
  assert.match(cssSource,/max-height:calc\(100dvh - 40px\)/);
  assert.match(cssSource,/body\.mhxp-dialog-open\{overflow:hidden\}/);
  assert.match(cssSource,/:focus-visible/);
  assert.match(cssSource,/prefers-reduced-motion/);
  assert.match(uiSource,/event\.key==="Escape"/);
  assert.match(uiSource,/event\.key!=="Tab"/);
  assert.match(uiSource,/aria-live="polite"/);
  for(const page of [portalSource,standaloneSource]){
    assert.match(page,/external-prospects\.css\?v=20260829state1/);
    assert.match(page,/external-prospects\.js\?v=20260829state1/);
  }
});

console.log("Buyer Discovery customer Fresh credits contract: PASSED");

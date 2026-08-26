import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const uiSource=fs.readFileSync("external-prospects.js","utf8");
const workspaceSource=fs.readFileSync("matchmaking-workspace.js","utf8");
const portalSource=fs.readFileSync("portal.html","utf8");
const sessionSource=fs.readFileSync("medichall-session.js","utf8");
const edgeSource=fs.readFileSync("supabase/functions/external-prospect-discovery/index.ts","utf8");
const relevanceSource=fs.readFileSync("supabase/functions/_shared/external-prospect-discovery.ts","utf8");

function completedWorkspace(){
  return {
    product_context:{products:[{taxonomy_id:101,canonical_name:"Ultrasound Probe Covers",slug:"ultrasound-probe-covers"}],website_available:false},
    website_scans:[],
    runs:[{
      id:"00000000-0000-4000-8000-000000000001",status:"COMPLETED",stage:"completed",
      intent_hash:"saved-intent",intent_source:"PROFILE_PRODUCT",created_at:"2026-08-24T15:37:36Z",
      started_at:"2026-08-24T15:37:36Z",completed_at:"2026-08-24T15:37:52Z",
      intent_context:{normalized_product_label:"Ultrasound Probe Covers",target_countries:[],intent_source:"PROFILE_PRODUCT"},
      sources_checked:9,candidates_found:50,candidates_deduplicated:2,candidates_accepted:3
    }],
    prospects:[{
      match_id:1,intent_hash:"saved-intent",company_name:"Saved Buyer",country_code:"FR",country_name:"France",
      company_type:"DISTRIBUTOR",relevance_score:82,product_taxonomy_score:35,geography_score:8,
      company_type_score:12,procurement_signal_score:12,evidence_quality_score:9,recency_score:4,
      workflow_status:"SAVED",reasons:[],evidence:[],activities:[],taxonomy:[]
    }]
  };
}

function createHarness({workspace=completedWorkspace(),edgeSteps=[],isAdmin=false,credits={customer_fresh_enabled:false,credit_cost:1,balance:0,can_run_fresh:false,history:[]}}={}){
  const rootListeners=new Map(),documentListeners=new Map(),timers=new Map();
  const rpcNames=[],edgeBodies=[];
  let timerId=0,rpcCalls=0,edgeCalls=0;
  const root={
    innerHTML:"",
    addEventListener:(type,listener)=>rootListeners.set(type,listener),
    removeEventListener:(type)=>rootListeners.delete(type),
    contains:()=>true,
    querySelector:()=>null,
    querySelectorAll:()=>[]
  };
  const document={
    hidden:false,
    addEventListener:(type,listener)=>documentListeners.set(type,listener),
    removeEventListener:(type)=>documentListeners.delete(type),
    createElement:()=>({className:"",textContent:""})
  };
  const context={
    console,crypto:{randomUUID:()=>"10000000-0000-4000-8000-000000000001"},document,URL,
    setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    sessionStorage:{setItem(){}},
  };
  vm.runInNewContext(uiSource,context,{filename:"external-prospects.js"});
  const component=context.MedicHallExternalProspects.createWorkspace({
    root,companyId:7,profile:{role:"manufacturer",target_countries:[]},
    rpc:async(name)=>{rpcCalls+=1;rpcNames.push(name);return name==="is_admin"?isAdmin:name==="get_company_buyer_discovery_credits_v1"?structuredClone(credits):structuredClone(workspace);},
    edge:async(_name,body)=>{edgeCalls+=1;edgeBodies.push(structuredClone(body));const next=edgeSteps.shift();return typeof next==="function"?next():next;},
    toast:()=>{},track:()=>{}
  });
  const click=(action,dataset={})=>rootListeners.get("click")({target:{dataset:{...dataset,action},matches(){return false;},closest(){return this;}}});
  const visibility=hidden=>{document.hidden=hidden;documentListeners.get("visibilitychange")?.();};
  return {component,root,document,timers,click,visibility,rpcNames,edgeBodies,rpcCalls:()=>rpcCalls,edgeCalls:()=>edgeCalls};
}

const flush=async()=>{for(let index=0;index<8;index+=1)await Promise.resolve();};

test("A: procurement stays six-request bounded while vNext progress records the combined plan",()=>{
  assert.match(relevanceSource,/maximumTedRequests:\s*6/);
  assert.match(edgeSource,/ted_requests_planned:\s*tedSearchPlan\.length/);
  assert.match(edgeSource,/tedSearchPlan\.length \+ searchPlan\.publicWebQueries\.length/);
});

test("B, K and L: idle and completed workspaces remain terminal and unchanged for three simulated minutes",async()=>{
  const harness=createHarness();
  await harness.component.load();
  const initial=harness.root.innerHTML;
  assert.match(initial,/European buyer search complete/);
  assert.match(initial,/Saved Buyer/);
  assert.equal(harness.timers.size,0);
  harness.visibility(true);harness.visibility(false);
  assert.equal(harness.timers.size,0);
  assert.equal(harness.rpcCalls(),3);
  assert.deepEqual(harness.rpcNames,["is_admin","get_external_prospect_workspace_v3","get_company_buyer_discovery_credits_v1"]);
  assert.equal(harness.root.innerHTML,initial);
});

test("C, D, E, F and G: one attempt, stable cooldown failure, saved results, and explicit single retry",async()=>{
  let rejectFirst;
  const first=new Promise((_,reject)=>{rejectFirst=reject;});
  const harness=createHarness({edgeSteps:[()=>first,()=>Promise.resolve({cached:true,run:{run_id:"00000000-0000-4000-8000-000000000001",status:"COMPLETED"}})]});
  await harness.component.load();
  harness.click("discover");
  harness.click("discover");
  assert.equal(harness.edgeCalls(),1,"a second click while in flight must not start another request");
  rejectFirst({
    status:429,code:"HTTP_429",userMessage:"Unexpected tender analysis error. Please try again.",
    edgeDetails:{status:429,code:"HTTP_429",backendMessage:"Discovery cooldown is active"}
  });
  await flush();
  assert.match(harness.root.innerHTML,/safety cooldown/);
  assert.match(harness.root.innerHTML,/Retry search/);
  assert.match(harness.root.innerHTML,/Saved Buyer/);
  assert.equal(harness.timers.size,0,"a terminal failure must stop polling");
  assert.equal(harness.edgeCalls(),1,"failure must never auto-retry");
  harness.click("retry");
  await flush();
  assert.equal(harness.edgeCalls(),2,"one explicit retry must create exactly one attempt");
  assert.match(harness.root.innerHTML,/Showing your latest verified results/);
  assert.match(harness.root.innerHTML,/Saved Buyer/);
});

test("H: token refresh is request-scoped and cannot remount or reload Buyer Discovery",()=>{
  assert.doesNotMatch(sessionSource,/onAuthStateChange|TOKEN_REFRESHED|INITIAL_SESSION|SIGNED_IN/);
  assert.doesNotMatch(uiSource,/location\.reload|document\.location|history\.(?:pushState|replaceState)/);
});

test("I: same-intent cached completion is rendered as stable saved state",async()=>{
  const harness=createHarness({edgeSteps:[Promise.resolve({cached:true,run:{run_id:"00000000-0000-4000-8000-000000000001",status:"COMPLETED"}})]});
  await harness.component.load();
  harness.click("discover");
  await flush();
  assert.equal(harness.edgeCalls(),1);
  assert.match(harness.root.innerHTML,/Showing your latest verified results/);
  assert.equal(harness.timers.size,0);
});

test("N: customer cannot see or invoke Fresh while the backend feature flag is disabled",async()=>{
  const harness=createHarness({isAdmin:false});
  await harness.component.load();
  assert.doesNotMatch(harness.root.innerHTML,/Run Fresh Discovery|Find More Buyers · 1 Credit/);
  harness.click("confirm-fresh");
  await flush();
  assert.equal(harness.edgeCalls(),0);
  assert.match(uiSource,/CUSTOMER_FRESH_CONTRACT=Object\.freeze/);
  assert.match(uiSource,/enabled:true,visible:true,label:"Find More Buyers · 1 Credit",creditCost:1/);
});

test("O: trusted admin confirmation creates exactly one ADMIN_QA_FRESH request",async()=>{
  let resolveFresh;
  const fresh=new Promise(resolve=>{resolveFresh=resolve;});
  const harness=createHarness({isAdmin:true,edgeSteps:[()=>fresh]});
  await harness.component.load();
  assert.match(harness.root.innerHTML,/Run Fresh Discovery/);
  harness.click("request-fresh");
  assert.match(harness.root.innerHTML,/role="dialog"/);
  assert.match(harness.root.innerHTML,/Previously discovered buyers will remain available/);
  harness.click("confirm-fresh");
  harness.click("confirm-fresh");
  assert.equal(harness.edgeCalls(),1);
  assert.equal(harness.edgeBodies[0].run_mode,"ADMIN_QA_FRESH");
  assert.equal(harness.edgeBodies[0].operation,"discover");
  resolveFresh({run:{run_id:"00000000-0000-4000-8000-000000000001",status:"COMPLETED"},new_verified_buyers:2,updated_verified_buyers:1,previously_discovered_buyers:3,cumulative_verified_buyers:6});
  await flush();
  assert.match(harness.root.innerHTML,/Fresh search completed/);
  assert.match(harness.root.innerHTML,/2 new verified buyers, 1 buyer with updated evidence, and 3 previously discovered buyers/);
});

test("P: Fresh failure preserves cards, never auto-retries, and provides manual retry",async()=>{
  const harness=createHarness({isAdmin:true,edgeSteps:[()=>Promise.reject({backendMessage:"Temporary discovery failure"})]});
  await harness.component.load();
  harness.click("request-fresh");harness.click("confirm-fresh");
  await flush();
  assert.equal(harness.edgeCalls(),1);
  assert.match(harness.root.innerHTML,/Fresh discovery was not completed/);
  assert.match(harness.root.innerHTML,/Retry fresh discovery/);
  assert.match(harness.root.innerHTML,/Saved Buyer/);
  assert.equal(harness.timers.size,0);
});

test("Q: zero-new and daily-limit Fresh results are explicit and bounded",async()=>{
  const zero=createHarness({isAdmin:true,edgeSteps:[Promise.resolve({run:{run_id:"00000000-0000-4000-8000-000000000001",status:"COMPLETED"},new_verified_buyers:0,updated_verified_buyers:1,previously_discovered_buyers:2,cumulative_verified_buyers:3})]});
  await zero.component.load();zero.click("request-fresh");zero.click("confirm-fresh");await flush();
  assert.match(zero.root.innerHTML,/No additional verified buyers were found in this search/);
  const limited=createHarness({isAdmin:true,edgeSteps:[()=>Promise.reject({backendMessage:"Daily Admin QA Fresh Discovery limit reached"})]});
  await limited.component.load();limited.click("request-fresh");limited.click("confirm-fresh");await flush();
  assert.match(limited.root.innerHTML,/Admin fresh discovery limit reached for today/);
  assert.match(limited.root.innerHTML,/Daily limit reached/);
  limited.click("request-fresh");limited.click("confirm-fresh");await flush();
  assert.equal(limited.edgeCalls(),1);
});

test("R: backend discovery-state semantics render without duplicate company cards",async()=>{
  const workspace=completedWorkspace();
  workspace.prospects=[
    {...workspace.prospects[0],match_id:1,external_company_id:"buyer-1",company_name:"New Buyer",discovery_state:"NEW"},
    {...workspace.prospects[0],match_id:2,external_company_id:"buyer-2",company_name:"Updated Buyer",discovery_state:"UPDATED"},
    {...workspace.prospects[0],match_id:3,external_company_id:"buyer-3",company_name:"Known Buyer",discovery_state:"PREVIOUSLY_DISCOVERED"},
    {...workspace.prospects[0],match_id:4,external_company_id:"buyer-3",company_name:"Known Buyer duplicate",discovery_state:"PREVIOUSLY_DISCOVERED"},
  ];
  const harness=createHarness({workspace,isAdmin:true});
  await harness.component.load();
  assert.match(harness.root.innerHTML,/New buyer/);
  assert.match(harness.root.innerHTML,/Updated evidence/);
  assert.match(harness.root.innerHTML,/Previously discovered/);
  assert.doesNotMatch(harness.root.innerHTML,/Known Buyer duplicate/);
});

test("S: representative VNext product intents render through the same stable frontend contract",async()=>{
  for(const product of ["Syringe","General Procedure Pack","Camera Cover"]){
    const workspace=completedWorkspace();
    workspace.product_context.products[0].canonical_name=product;
    workspace.runs[0].intent_context.normalized_product_label=product;
    const harness=createHarness({workspace,isAdmin:true});
    await harness.component.load();
    assert.match(harness.root.innerHTML,new RegExp(product));
    assert.match(harness.root.innerHTML,/Discover European buyers/);
    assert.match(harness.root.innerHTML,/Run Fresh Discovery/);
    assert.equal(harness.timers.size,0);
  }
});

test("J: visibility changes replace rather than duplicate an active poll timer",async()=>{
  const running=completedWorkspace();
  const now=new Date().toISOString();
  running.runs[0]={...running.runs[0],status:"RUNNING",stage:"searching_procurement",created_at:now,started_at:now,completed_at:null};
  const harness=createHarness({workspace:running});
  await harness.component.load();
  assert.equal(harness.timers.size,1);
  harness.visibility(true);harness.visibility(false);harness.visibility(false);
  assert.equal(harness.timers.size,1);
});

test("C and M: background matchmaking refresh preserves the mounted root and no Buyer Discovery path reloads",()=>{
  assert.match(workspaceSource,/preserveBuyerDiscovery=silent&&state\.view==="buyer_discovery"&&externalProspectWorkspace/);
  assert.match(workspaceSource,/if\(!preserveBuyerDiscovery\)renderWorkspace\(\)/);
  assert.match(workspaceSource,/setInterval\(\(\)=>\{if\(!document\.hidden\)loadWorkspace\(true\);\},30000\)/);
  assert.doesNotMatch(workspaceSource,/location\.reload/);
  assert.doesNotMatch(uiSource,/setInterval/);
  assert.match(portalSource,/external-prospects\.js\?v=20260826credits3/);
});

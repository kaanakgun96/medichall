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

function createHarness({workspace=completedWorkspace(),edgeSteps=[]}={}){
  const rootListeners=new Map(),documentListeners=new Map(),timers=new Map();
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
    rpc:async()=>{rpcCalls+=1;return structuredClone(workspace);},
    edge:async()=>{edgeCalls+=1;const next=edgeSteps.shift();return typeof next==="function"?next():next;},
    toast:()=>{},track:()=>{}
  });
  const click=action=>rootListeners.get("click")({target:{dataset:{action},closest(){return this;}}});
  const visibility=hidden=>{document.hidden=hidden;documentListeners.get("visibilitychange")?.();};
  return {component,root,document,timers,click,visibility,rpcCalls:()=>rpcCalls,edgeCalls:()=>edgeCalls};
}

const flush=async()=>{for(let index=0;index<8;index+=1)await Promise.resolve();};

test("A: V2.1 keeps the exact six-request cap while legacy progress stays bounded",()=>{
  assert.match(relevanceSource,/maximumTedRequests:\s*6/);
  assert.match(edgeSource,/ted_requests_planned:\s*tedSearchPlan\.length/);
  assert.match(edgeSource,/queries_generated:\s*legacyQueryProgressCount\(tedSearchPlan\.length\)/);
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
  assert.equal(harness.rpcCalls(),1);
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
  assert.match(harness.root.innerHTML,/Existing results restored/);
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
  assert.match(harness.root.innerHTML,/Existing results restored/);
  assert.equal(harness.timers.size,0);
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
  assert.match(portalSource,/external-prospects\.js\?v=20260825unknown1/);
});

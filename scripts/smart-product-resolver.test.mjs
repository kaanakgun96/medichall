import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read=path=>fs.readFileSync(path,"utf8");
const ui=read("external-prospects.js");
const css=read("external-prospects.css");
const edge=read("supabase/functions/external-prospect-discovery/index.ts");
const resolver=read("supabase/functions/_shared/smart-product-resolver.ts");
const terminology=read("supabase/functions/_shared/unknown-product-resolution.ts");
const migration=read("supabase/migrations/202608270002_smart_product_resolver_v1.sql");
const compatibility=read("supabase/migrations/202608270003_smart_product_resolver_deterministic_compatibility.sql");
const sql=read("supabase/tests/smart_product_resolver.sql");
const portal=read("portal.html");
const standalone=read("matchmaking.html");

new Function(ui);

test("layered resolver uses deterministic first, one service-side AI fallback, cache and hard bounds",()=>{
  assert.match(edge,/resolveProductIntentDeterministically/);
  assert.match(edge,/deterministicUnderstandsProduct/);
  assert.match(edge,/reserve_smart_product_resolution_v1/);
  assert.match(edge,/decision === "CACHED"/);
  assert.match(edge,/decision === "PROCEED"/);
  assert.match(edge,/callSmartProductResolver/);
  assert.match(edge,/reserve_medichall_ai_request/);
  assert.match(resolver,/maximumOutputTokens: 450/);
  assert.match(resolver,/timeoutMs: 8_000/);
  assert.match(resolver,/maximumEstimatedCostUsd: 0\.005/);
  assert.match(resolver,/tool_choice:[\s\S]*?return_product_resolution/);
  assert.doesNotMatch(edge,/body\.(?:provider|model|api_key)/i);
});

test("AI only understands product intent and cannot become buyer evidence",()=>{
  assert.match(resolver,/Never identify or qualify buyer companies/);
  assert.match(resolver,/validated_active_taxonomy/);
  assert.match(terminology,/SMART_RESOLVER_CANDIDATE/);
  assert.doesNotMatch(resolver,/DIRECT buyer|ADJACENT buyer|relevanceScore|rankProspects/);
  assert.match(resolver,/untrusted_product_phrase:[\s\S]*?selected_language:[\s\S]*?active_taxonomy_candidates:/);
});

test("persistence is versioned, tenant scoped, service controlled and rollout-safe",()=>{
  assert.match(migration,/smart_resolver_enabled boolean not null default false/);
  assert.match(migration,/unique \(company_id, normalized_phrase, resolver_version\)/);
  assert.match(migration,/force row level security/g);
  assert.match(migration,/auth\.role\(\) <> 'service_role'/);
  assert.match(migration,/resolver_type in \('DETERMINISTIC', 'AI', 'CACHED_AI'\)/);
  assert.match(migration,/grant select on table public\.smart_product_resolver_feature_state,[\s\S]*?to service_role/);
  assert.doesNotMatch(migration,/grant all on table public\.smart_product_resolution_cache/);
  assert.match(sql,/Cross-company resolver reservation succeeded/);
  assert.match(sql,/Resolver event idempotency failed/);
  assert.match(sql,/Smart result auto-published a global alias/);
  assert.match(sql,/customer Fresh must remain disabled/i);
});

test("deterministic resolver event writer remains compatible with required Smart Resolver metadata",()=>{
  assert.match(compatibility,/create or replace function public\.record_product_resolution_event_v1/);
  assert.match(compatibility,/normalized_phrase,[\s\S]*?input_normalized_phrase/);
  assert.match(compatibility,/'DETERMINISTIC', 'DETERMINISTIC_V2'/);
  assert.match(compatibility,/revoke all on function public\.record_product_resolution_event_v1/);
  assert.match(sql,/Deterministic resolver event is incompatible with Smart Resolver metadata/);
});

test("UI exposes exact, smart, ambiguous, temporary, nonmedical and failure states accessibly",()=>{
  for(const text of [
    "Product matched","Likely medical product","Which product do you mean?",
    "Medical product recognized","This doesn’t appear to be a medical product",
    "We couldn’t resolve this product right now","Understanding your product…"
  ])assert.match(ui,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(ui,/aria-live="polite"/);
  assert.match(ui,/role="alert"/);
  assert.match(ui,/if\(state\.resolvingProduct\)result=[\s\S]*?else if\(resolution\?\.resolution==="unmapped"\)/);
  assert.match(ui,/clarify-product/);
  assert.match(ui,/role="group" aria-label="Product interpretations"/);
  assert.doesNotMatch(ui,/<button[^>]+role="listitem"[^>]+clarify-product/);
  assert.match(ui,/confirm_product_resolution/);
  assert.match(css,/\.mhxp-clarification-list/);
  assert.match(css,/@media\(max-width:430px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(portal,/external-prospects\.(?:css|js)\?v=20260827smart1/g);
  assert.match(standalone,/external-prospects\.(?:css|js)\?v=20260827smart1/g);
});

function harness(resolution,confirmation={ok:true,resolution:"temporary_intent",resolved_concept:"Surgical glove",product_family:"Medical gloves",commercial_terms_en:["Surgical glove"],use_unmapped:true}){
  const listeners=new Map();
  const root={innerHTML:"",contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener(){}};
  const document={hidden:false,activeElement:null,documentElement:{lang:"en"},body:{classList:{toggle(){}}},addEventListener(){},removeEventListener(){},createElement:()=>({}),};
  const context={console,URL,navigator:{language:"en-GB"},document,crypto:{randomUUID:()=>"10000000-0000-4000-8000-000000000001"},setTimeout:()=>1,clearTimeout(){},sessionStorage:{setItem(){}}};
  const calls=[];
  vm.runInNewContext(ui,context,{filename:"external-prospects.js"});
  const component=context.MedicHallExternalProspects.createWorkspace({
    root,companyId:7,profile:{role:"manufacturer"},targetCountries:[],toast(){},track(){},
    rpc:async name=>name==="is_admin"?false:name==="get_company_buyer_discovery_credits_v1"?{customer_fresh_enabled:false,balance:0}:{product_context:{products:[],website_available:false},website_scans:[],runs:[],prospects:[]},
    edge:async(_name,body)=>{calls.push(body);return body.operation==="confirm_product_resolution"?confirmation:resolution;}
  });
  return {component,root,listeners,calls};
}

const flush=async()=>{for(let i=0;i<12;i+=1)await Promise.resolve();};

test("manual search sends one bounded resolver request and renders ambiguity without auto-search",async()=>{
  const h=harness({
    resolution:"ambiguous",resolution_event_id:"20000000-0000-4000-8000-000000000002",
    clarification_options:[
      {label:"Surgical gloves",product_family:"Medical gloves"},
      {label:"Examination gloves",product_family:"Medical gloves"}
    ]
  });
  await h.component.load();
  h.listeners.get("input")({target:{id:"mhxpProductQuery",value:"glove"}});
  h.listeners.get("submit")({target:{matches:()=>true},preventDefault(){}});
  await flush();
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].operation,"resolve_product_intent");
  assert.equal(h.calls[0].product_query,"glove");
  assert.match(h.root.innerHTML,/Which product do you mean\?/);
  assert.doesNotMatch(h.calls.map(item=>item.operation).join(","),/discover/);
});

test("technical failure keeps results unchanged and provides explicit retry",async()=>{
  const h=harness({resolution:"technical_failure",search_anyway_allowed:false});
  await h.component.load();
  h.listeners.get("input")({target:{id:"mhxpProductQuery",value:"abdominal mesh"}});
  h.listeners.get("submit")({target:{matches:()=>true},preventDefault(){}});
  await flush();
  assert.match(h.root.innerHTML,/We couldn’t resolve this product right now/);
  assert.match(h.root.innerHTML,/data-action="retry-product-resolution"/);
  assert.equal(h.calls.length,1);
});

test("clarification choices preserve native button semantics and Enter cannot double-submit",async()=>{
  const h=harness({
    resolution:"ambiguous",resolution_event_id:"20000000-0000-4000-8000-000000000002",
    clarification_options:[
      {label:"Surgical gloves",canonical_concept:"Surgical glove",product_family:"Medical gloves"},
      {label:"Examination gloves",canonical_concept:"Examination glove",product_family:"Medical gloves"}
    ]
  });
  await h.component.load();
  h.listeners.get("input")({target:{id:"mhxpProductQuery",value:"glove"}});
  h.listeners.get("submit")({target:{matches:()=>true},preventDefault(){}});
  await flush();
  const target={dataset:{option:"0"},closest:selector=>selector.includes("clarify-product")?target:null};
  const event={target,key:"Enter",preventDefault(){}};
  h.listeners.get("keydown")(event);
  h.listeners.get("keydown")(event);
  await flush();
  assert.equal(h.calls.filter(item=>item.operation==="confirm_product_resolution").length,1);
  assert.match(h.root.innerHTML,/Medical product recognized/);
  assert.doesNotMatch(h.root.innerHTML,/role="listitem"/);
});

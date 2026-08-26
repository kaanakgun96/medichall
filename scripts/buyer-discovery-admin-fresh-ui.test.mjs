import assert from "node:assert/strict";
import fs from "node:fs";

const read=(path)=>fs.readFileSync(path,"utf8");
const ui=read("external-prospects.js");
const css=read("external-prospects.css");
const portal=read("portal.html");
const standalone=read("matchmaking.html");
const vnextMigration=read("supabase/migrations/202608250004_buyer_discovery_vnext_search_space.sql");

new Function(ui);

assert.match(ui,/get_external_prospect_workspace_v3/);
assert.match(ui,/options\.rpc\("is_admin",\{\}\)/);
assert.match(ui,/run_mode:runMode/);
assert.match(ui,/ADMIN_QA_FRESH/);
assert.match(vnextMigration,/if not public\.is_admin\(\) then[\s\S]*?Platform admin access required for Admin QA Fresh Discovery/);
assert.match(vnextMigration,/v_admin_daily >= 50/);

assert.match(ui,/Run Fresh Discovery/);
assert.match(ui,/role="dialog" aria-modal="true"/);
assert.match(ui,/aria-labelledby="mhxp-fresh-title"/);
assert.match(ui,/aria-describedby="mhxp-fresh-description"/);
assert.match(ui,/event\.key==="Escape"/);
assert.match(ui,/event\.key!=="Tab"/);
assert.match(ui,/aria-live="polite" aria-atomic="true"/);
assert.doesNotMatch(ui,/\balert\s*\(/);

for(const label of ["New buyer","Updated evidence","Previously discovered"]){
  assert.match(ui,new RegExp(label));
}
assert.match(ui,/No additional verified buyers were found in this search/);
assert.match(ui,/Admin fresh discovery limit reached for today/);
assert.match(ui,/Existing results remain available/);
assert.doesNotMatch(ui,/setInterval|autoRetry|retryAutomatically/);

assert.match(ui,/CUSTOMER_FRESH_CONTRACT=Object\.freeze/);
assert.match(ui,/enabled:true,visible:true,label:"Find More Buyers · 1 Credit",creditCost:1/);
for(const state of ["REQUESTED","ACCEPTED","FAILED_PRE_PROVIDER","COMPLETED"]){
  assert.match(ui,new RegExp(`"${state}"`));
}
assert.doesNotMatch(ui,/localStorage[^\n]*(?:admin|role)|URLSearchParams[^\n]*(?:admin|role)|[?&]admin=/i);

for(const page of [portal,standalone]){
  assert.match(page,/external-prospects\.js\?v=20260826credits3/);
  assert.match(page,/external-prospects\.css\?v=20260826credits3/);
}
for(const width of ["1024px","700px","430px"]){
  assert.match(css,new RegExp(width.replace(".","\\.")));
}
assert.match(css,/\.mhxp-dialog-backdrop\{position:fixed/);
assert.match(css,/max-height:calc\(100dvh - 40px\)/);
assert.match(css,/overscroll-behavior:contain/);
assert.match(css,/safe-area-inset-bottom/);
assert.match(css,/:focus-visible/);
assert.match(css,/prefers-reduced-motion/);

console.log("Buyer Discovery admin Fresh UI/security contract: PASSED");

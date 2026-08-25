import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const portal = read("portal.html");
const standalone = read("matchmaking.html");
const workspace = read("matchmaking-workspace.js");
const ui = read("external-prospects.js");
const css = read("external-prospects.css");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const reactApp = read("apps/portal-react/src/app/App.tsx");
const reactPage = read("apps/portal-react/src/features/buyer-discovery/components/BuyerDiscoveryPage.tsx");
const reactRoutes = read("apps/portal-react/src/shared/routing/portal-routes.ts");

new Function(ui);
new Function(workspace);
for (const [index, script] of [...portal.matchAll(
  /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
)].map((match) => match[1]).filter((script) => script.trim()).entries()) {
  assert.doesNotThrow(() => new Function(script), `portal inline script ${index + 1}`);
}

assert.match(portal, /data-panel="buyer-discovery"/);
assert.match(portal, /id="panel-buyer-discovery"/);
assert.match(portal, /#buyer-discovery/);
assert.match(portal, /Discover European buyers/);
assert.match(portal, /Tender Intelligence/);
assert.match(portal, /MedicHall Matches/);
assert.doesNotMatch(portal, /mmViewButton\("external_prospects"/);
assert.match(workspace, /tab\("buyer_discovery","European Buyer Discovery"/);
assert.match(workspace, /hash==="#buyer-discovery"/);

for (const page of [portal, standalone]) {
  assert.match(page, /external-prospects\.js\?v=20260825unknown1/);
  assert.match(page, /external-prospects\.css\?v=20260825unknown1/);
}
assert.equal((ui.match(/function createWorkspace/g) || []).length, 1);
assert.match(reactPage, /MedicHallExternalProspects\.createWorkspace/);
assert.match(reactRoutes, /"buyer-discovery"/);
assert.match(reactApp, /BuyerDiscoveryPage/);

for (const stage of [
  "loading_profile", "preparing_market_search", "searching_procurement",
  "checking_business_sources", "verifying_websites", "removing_duplicates",
  "ranking_prospects", "preparing_results",
]) {
  assert.match(ui, new RegExp(`"${stage}"`));
  assert.match(edge, new RegExp(`stage: "${stage}"`));
}
assert.match(edge, /sources_checked: Math\.min/);
assert.match(edge, /candidates_found: Math\.min/);
assert.match(edge, /candidates_deduplicated: Math\.min/);
assert.match(edge, /candidates_accepted: Math\.min/);
assert.match(ui, /Only completed backend work is shown/);
assert.doesNotMatch(ui, /progressPercent|fakeProgress|setInterval/);
assert.match(ui, /document\.hidden/);
assert.match(ui, /pollInFlight/);
assert.match(ui, /POLL_MAX_MS=10\*60\*1000/);
assert.match(ui, /Automatic refresh has paused after 10 minutes/);
assert.match(ui, /A search is already running/);
assert.match(ui, /Starting the same search again would not create a second request/);

for (const country of ["France", "Norway", "Poland", "Germany", "Italy", "Netherlands", "Belgium", "Spain"]) {
  assert.match(ui, new RegExp(country));
}
assert.match(ui, /explicit KRS identifier/);
assert.match(ui, /disabled pending legal review/);
assert.match(ui, /No supported official registry integration/);
assert.match(ui, /Registry coverage affects enrichment only/);

for (const state of [
  "Search completed with limited source coverage", "This search could not be completed",
  "Discover European buyers", "Search by product", "No candidates met the evidence threshold",
  "safety cooldown", "safe search limit", "Existing results restored",
]) assert.match(ui, new RegExp(state));

assert.match(ui, /Direct product evidence/);
assert.match(ui, /Indirect commercial evidence/);
assert.match(ui, /never proves the company currently sells your exact product/);
assert.doesNotMatch(ui, /contact_email|contact_name|linkedin_url|Email prospect|Start outreach/i);
assert.match(ui, /No private contact details are collected/);
assert.match(ui, /No outreach is sent/);

for (const width of ["1024px", "700px", "430px"]) assert.match(css, new RegExp(width));
assert.match(css, /grid-template-columns:1fr/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);

console.log("European Buyer Discovery UX contract: PASSED");

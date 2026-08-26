import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path,"utf8");
const ui=read("external-prospects.js"),css=read("external-prospects.css"),portal=read("portal.html");
const standalone=read("matchmaking.html");
const react=read("apps/portal-react/src/features/buyer-discovery/components/BuyerDiscoveryPage.tsx");
const edge=read("supabase/functions/external-prospect-discovery/index.ts");
const website=read("supabase/functions/_shared/website-product-discovery.ts");
const migration=read("supabase/migrations/202608240001_buyer_discovery_product_intents.sql");
const sql=read("supabase/tests/buyer_discovery_product_intents.sql");

new Function(ui);
for(const [index,script] of [...portal.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(Boolean).entries()){
  assert.doesNotThrow(()=>new Function(script),`portal inline script ${index+1}`);
}

for(const label of ["Use my products","Search by product","Scan my website","No catalogue required","Europe-wide","Selected countries"]){
  assert.match(ui,new RegExp(label));
}
for(const source of ["PROFILE_PRODUCT","AD_HOC_PRODUCT","WEBSITE_DETECTED_PRODUCT"]){
  assert.match(ui,new RegExp(source));assert.match(migration,new RegExp(source));
}
assert.match(ui,/Confirm a category or choose bounded Search anyway/);
assert.doesNotMatch(ui,/Add an active product and at least one European target market/);
assert.match(ui,/get_external_prospect_workspace_v3/);
assert.match(ui,/resolve_product_intent/);
assert.match(ui,/scan_company_products/);
assert.match(ui,/mh_buyer_discovery_product_draft_v1/);
assert.match(portal,/openBuyerDiscoveryProductDraft/);
assert.match(portal,/prefill:suggestion/);
assert.match(portal,/PRODUCT_DRAFT_GUARD\.load/);
assert.match(standalone,/external-prospects\.js\?v=20260826credits3/);
assert.match(portal,/external-prospects\.js\?v=20260826credits3/);
assert.match(ui,/options\.productProfileUrl\|\|"portal\.html#products"/);
assert.match(react,/productProfileUrl: `\$\{legacyPortalUrl\}#products`/);

assert.match(edge,/start_external_prospect_discovery_v3/);
assert.match(edge,/scanCompanyWebsiteProducts/);
assert.match(edge,/get_buyer_discovery_product_context_v1/);
assert.match(edge,/safeFetchWithRedirects/);
assert.match(edge,/isPathAllowedByRobots/);
assert.match(edge,/WEBSITE_CROSS_DOMAIN_REDIRECT/);
assert.match(edge,/normalizeDomain\(result\.resolvedUrl\) !== expectedDomain/);
assert.match(edge,/contact_fields_collected: 0/);
assert.match(edge,/provider_requests: 0/);
assert.doesNotMatch(edge,/ANTHROPIC|OPENAI|RESEND_API_KEY|sendEmail|notification_outbox/i);
assert.match(website,/maximumPages: 12/);
assert.match(website,/maximumDepth: 1/);
assert.match(website,/maximumResponseBytes: 512_000/);
assert.match(website,/maximumSuggestions: 8/);
assert.match(website,/schema_product/);
assert.match(website,/PRODUCT_PATH/);
assert.match(website,/CONTACT_TEXT/);
assert.doesNotMatch(website,/page\.evaluate|puppeteer|playwright|cheerio/);

for(const object of ["intent_source","intent_context","company_website_product_scans","evidence_snapshot","activity_snapshot","taxonomy_snapshot"]){
  assert.match(migration,new RegExp(object));
}
assert.match(migration,/interval '24 hours'/);
assert.match(migration,/if v_daily >= 3/);
assert.match(migration,/if v_monthly >= 20/);
assert.match(migration,/if v_daily >= 2/);
assert.match(migration,/if v_monthly >= 10/);
assert.match(migration,/jsonb_array_length\(suggestions\) <= 8/);
assert.match(migration,/pages_checked between 0 and 12/);
assert.match(migration,/drop constraint company_external_prospect_mat_company_id_external_company_i_key/);
assert.match(migration,/force row level security/);
assert.match(migration,/from public, anon, authenticated/);
assert.doesNotMatch(migration,/grant (?:select|insert|update|delete|all)[^;]+to (?:anon|authenticated)/is);
assert.match(sql,/Zero-product workspace/);
assert.match(sql,/Cross-company discovery start succeeded/);
assert.match(sql,/Unsupported raw intent field was accepted/);
assert.match(sql,/Website scan cache accepted a contact field/);

for(const width of ["768px","700px","430px"]){assert.match(css,new RegExp(width));}
assert.match(css,/:focus-visible/);
assert.match(css,/prefers-reduced-motion/);
assert.match(ui,/aria-pressed/);
assert.match(ui,/aria-live="polite"/);
assert.match(ui,/data-country-select/);
assert.doesNotMatch(ui,/contact_email|contact_name|linkedin_url|Phone prospect|Email prospect/i);

console.log("Buyer Discovery product-intent/website-scan contract: PASSED");

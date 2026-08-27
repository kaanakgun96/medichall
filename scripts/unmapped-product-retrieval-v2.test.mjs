import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const terminology = read("supabase/functions/_shared/unmapped-product-terminology.ts");
const resolution = read("supabase/functions/_shared/unknown-product-resolution.ts");
const relevance = read("supabase/functions/_shared/buyer-discovery-relevance-v2.ts");
const publicWeb = read("supabase/functions/_shared/public-web-discovery.ts");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");

for (const source of [
  "APPROVED_ALIAS",
  "TED_TERMINOLOGY",
  "VERIFIED_PRODUCT_TERMINOLOGY",
  "DETERMINISTIC_VARIANT",
]) assert.match(terminology, new RegExp(source));

for (const language of ["it", "fr", "de", "es", "nl", "pt", "pl"]) {
  assert.match(publicWeb, new RegExp(`country: "${language.toUpperCase()}"|language: "${language}"`));
}

assert.match(terminology, /UNMAPPED_RETRIEVAL_V2/);
assert.match(resolution, /buildUnmappedProductRetrievalPlan/);
assert.match(edge, /unmapped_retrieval_plan/);
assert.match(edge, /unmapped_retrieval_term_outcomes/);
assert.match(edge, /searchPlan\.budget\.maximumPublicWebQueries/);
assert.match(edge, /searchPlan\.budget\.maximumPublicWebCostUsd/);
assert.match(edge, /unmappedIntent\s*\? \[\]/);
assert.match(relevance, /evidence\.sourceType !== "PUBLIC_REGISTRY"/);
assert.match(publicWeb, /temporaryIntent\?\.retrievalTerms/);
assert.match(publicWeb, /seenTerms/);

const discoveryHandler = edge.slice(edge.indexOf('if (operation !== "discover")'));
const combined = [terminology, resolution, relevance, publicWeb, discoveryHandler].join("\n");
assert.doesNotMatch(combined, /callSmartProductResolver|api\.anthropic\.com|OPENAI_API_KEY/);
assert.doesNotMatch(combined, /contact_email|contact_name|linkedin_url|whatsapp/i);
assert.doesNotMatch(combined, /sendEmail|notification_outbox/i);
assert.doesNotMatch(edge, /retrievalTerms\s*:\s*(?:body|payload|input)/);

console.log("Unmapped Product Retrieval Recall V2 static/security contract: PASSED");

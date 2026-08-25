import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const ui = read("external-prospects.js");
const css = read("external-prospects.css");
const portal = read("portal.html");
const standalone = read("matchmaking.html");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const migration = read("supabase/migrations/202608250002_unknown_product_resolution.sql");
const resolution = read("supabase/functions/_shared/unknown-product-resolution.ts");
const relevance = read("supabase/functions/_shared/buyer-discovery-relevance-v2.ts");
const website = read("supabase/functions/_shared/website-product-discovery.ts");
const sql = read("supabase/tests/unknown_product_resolution.sql");

new Function(ui);
for (const [index, script] of [...portal.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean).entries()) {
  assert.doesNotThrow(() => new Function(script), `portal inline script ${index + 1}`);
}

for (const phrase of [
  "Search this product anyway",
  "Try a different product name",
  "Possible product categories",
  "Searching as entered product",
  "Buyer Discovery for:",
  "Resolve this product",
]) assert.match(ui, new RegExp(phrase));
assert.doesNotMatch(ui, /MedicHall could not confidently classify this product/);
assert.match(ui, /UNMAPPED_PRODUCT/);
assert.match(ui, /resolution_event_id/);
assert.match(ui, /normalized_product_phrase/);
assert.match(ui, /role="list"/);
assert.match(css, /mhxp-suggestion-list/);
assert.match(css, /max-width:430px/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
assert.match(portal, /external-prospects\.js\?v=20260825unknown1/);
assert.match(standalone, /external-prospects\.js\?v=20260825unknown1/);

for (const object of [
  "product_resolution_events",
  "taxonomy_alias_candidates",
  "UNMAPPED_PRODUCT",
  "record_product_resolution_event_v1",
  "record_product_resolution_outcome_v1",
]) assert.match(migration, new RegExp(object));
assert.match(migration, /PENDING_REVIEW/);
assert.match(migration, /count\(distinct event\.company_id\)/);
assert.match(migration, /v_confirmation_count < 2/);
assert.doesNotMatch(migration, /insert into public\.medical_product_aliases/i);
assert.match(migration, /if v_daily >= 3/);
assert.match(migration, /if v_monthly >= 20/);
assert.match(migration, /interval '30 minutes'/);
assert.match(migration, /force row level security/);
assert.match(sql, /Alias candidate was auto-approved/);
assert.match(sql, /rollback;/);

assert.match(edge, /buildTemporaryProductFamilyProfile/);
assert.match(edge, /unmappedIntent\s*\? \[\]/);
assert.match(edge, /Math\.min\(4, publicWebMaximumQueries\)/);
assert.match(edge, /Math\.min\(\.02, publicWebMaximumCost\)/);
assert.match(edge, /record_product_resolution_outcome_v1/);
assert.match(resolution, /validateUnmappedMedicalProductPhrase/);
assert.match(resolution, /signal_sources/);
assert.match(relevance, /temporaryPhraseMatches/);
assert.match(website, /maximumPages: 12/);

const combined = [edge, resolution, relevance, ui].join("\n");
assert.doesNotMatch(combined, /ANTHROPIC_API_KEY|OPENAI_API_KEY|RESEND_API_KEY|sendEmail|notification_outbox/i);
assert.doesNotMatch(combined, /contact_email|contact_name|linkedin_url|whatsapp/i);

console.log("Unknown Product Resolution static/security/UI contract: PASSED");

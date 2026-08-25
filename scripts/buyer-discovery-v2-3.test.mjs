import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/202608250001_buyer_discovery_v2_3_alias_expansion.sql",
);
const sqlRegression = read("supabase/tests/buyer_discovery_v2_3.sql");
const relevance = read(
  "supabase/functions/_shared/buyer-discovery-relevance-v2.ts",
);
const ranking = read(
  "supabase/functions/_shared/external-prospect-discovery.ts",
);
const publicWeb = read("supabase/functions/_shared/public-web-discovery.ts");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const documentation = read("docs/buyer-discovery-v2-3.md");

assert.match(migration, /^-- Buyer Discovery V2\.3/m);
assert.match(migration, /begin;[\s\S]*commit;/);
for (const alias of [
  "Camera Drape",
  "Sterile Camera Sleeve",
  "Endoscopic Camera Cover",
  "Copri telecamera",
  "Housse caméra",
  "Funda de cámara",
  "Sterile Kameraabdeckung",
  "Camera hoes",
  "Image Intensifier Drape",
  "Operating Microscope Cover",
  "Sterile Medical Equipment Covers",
]) assert.match(migration, new RegExp(alias, "i"));

assert.doesNotMatch(
  migration,
  /\('camera-covers',\s*'(?:camera|video|endoscopy|imaging)',/i,
);
assert.match(migration, /on conflict \(normalized_alias, language_code\)/);
assert.match(migration, /verification_status = 'approved'/);
assert.match(sqlRegression, /resolve_medical_product_term_v1/);
assert.match(sqlRegression, /generic term was incorrectly approved/i);
assert.match(sqlRegression, /rollback;/);

assert.match(relevance, /REVIEWED_EQUIPMENT_COVER_ALIASES/);
assert.match(
  relevance,
  /flags\.equipmentCoverKind\.replace\("_", "-"\).*?-cover-family/s,
);
assert.match(ranking, /PUBLIC_PROCUREMENT/);
assert.match(ranking, /COMMERCIAL_ADJACENCY/);
assert.match(ranking, /COMBINED_SUPPORT/);
assert.match(ranking, /Math\.min\(42, relevanceScore\)/);
assert.match(ranking, /sourceType === "PUBLIC_REGISTRY"/);
assert.match(ranking, /chooseTrustedCompanyIdentity/);
assert.match(ranking, /companyIdentityKeys/);

assert.match(publicWeb, /maximumQueries: 6/);
assert.match(publicWeb, /maximumCostUsdPerRun: 0\.03/);
assert.match(publicWeb, /public-web-v2\.3/);
assert.match(publicWeb, /"EXACT" \| "SYNONYM" \| "LOCALIZED" \| "ADJACENT"/);
assert.match(edge, /public_web_query_strategies/);
assert.match(edge, /extractOfficialWebsiteIdentity/);
assert.match(edge, /qualification_path: score\.qualificationPath/);
assert.doesNotMatch(
  [migration, relevance, ranking, publicWeb, edge].join("\n"),
  /ANTHROPIC_API_KEY|OPENAI_API_KEY|RESEND_API_KEY|sendEmail|notification_outbox/i,
);
assert.doesNotMatch(
  [migration, relevance, ranking, publicWeb, edge].join("\n"),
  /contact_email|contact_name|linkedin_url|whatsapp/i,
);

assert.match(documentation, /No frontend or cPanel artifact changes are required/);
assert.match(documentation, /Brave queries per uncached run \| 6 max \| 6 max/);
assert.match(documentation, /AI\/LLM requests \| 0 \| 0/);

console.log("Buyer Discovery V2.3 static/security contract: PASSED");

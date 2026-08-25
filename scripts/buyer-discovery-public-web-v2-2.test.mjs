import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const provider = read("supabase/functions/_shared/public-web-discovery.ts");
const providerTest = read("supabase/functions/_shared/public-web-discovery.test.ts");
const migration = read("supabase/migrations/202608240002_buyer_discovery_public_web.sql");
const sqlTest = read("supabase/tests/buyer_discovery_public_web.sql");
const documentation = read("docs/buyer-discovery-public-web-v2-2.md");
const frontends = [
  read("external-prospects.js"),
  read("portal.html"),
  read("matchmaking.html"),
  read("medichall-traffic.js"),
].join("\n");

assert.match(provider, /interface PublicWebDiscoveryProvider/);
assert.match(provider, /createBraveSearchProvider/);
assert.match(provider, /https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search/);
assert.match(provider, /X-Subscription-Token/);
assert.match(provider, /maximumQueries: 10/);
assert.match(provider, /maximumResultsPerQuery: 6/);
assert.match(provider, /maximumRawResults: 60/);
assert.match(provider, /maximumCandidates: 40/);
assert.match(provider, /maximumConcurrency: 2/);
assert.match(provider, /requestTimeoutMs: 6_500/);
assert.match(provider, /successfulCacheDays: 14/);
assert.match(provider, /braveRequestCostUsd: 0\.005/);
assert.match(provider, /maximumCostUsdPerRun: 0\.05/);
assert.match(provider, /PROVIDER_RATE_LIMIT_OR_QUOTA/);
assert.match(provider, /PROVIDER_CIRCUIT_OPEN/);
assert.match(provider, /PROVIDER_TIMEOUT/);
assert.match(provider, /FILTERED_NON_COMPANY_RESULT/);
assert.match(provider, /PUBLIC_WEB/);
assert.doesNotMatch(provider, /OpenAI|Anthropic|RESEND|sendEmail|notification/i);
assert.doesNotMatch(provider, /Genimpex|Effebi|BioCommerciale|PRIM S\.A\.|m3m Advance|Inside Medical|CG Medical|EDM Medical/i);
assert.doesNotMatch(provider, /console\.(?:log|error|warn)/);

assert.match(edge, /PUBLIC_WEB_DISCOVERY_ENABLED/);
assert.match(edge, /PUBLIC_WEB_PROVIDER/);
assert.match(edge, /BRAVE_SEARCH_API_KEY/);
assert.match(edge, /PUBLIC_WEB_MAX_QUERIES_PER_RUN/);
assert.match(edge, /PUBLIC_WEB_MAX_COST_USD_PER_RUN/);
assert.match(edge, /public_web_provider_cost_estimate_usd/);
assert.match(edge, /public_web_candidates_verified/);
assert.match(edge, /public_web_candidates_accepted/);
assert.match(edge, /direct_contact_fields_stored: 0/);
assert.match(edge, /ai_classifications: 0/);
assert.match(edge, /emails_sent: 0/);
assert.match(edge, /notifications_created: 0/);
assert.doesNotMatch(edge, /console\.(?:log|error|warn)\([^\n]*BRAVE_SEARCH_API_KEY/);

assert.match(migration, /create table public\.external_public_web_request_cache/);
assert.match(migration, /force row level security/);
assert.match(migration, /grant all on table public\.external_public_web_request_cache to service_role/);
assert.match(migration, /provider_requests between 0 and 6/);
assert.match(migration, /jsonb_array_length\(normalized_candidates\) <= 20/);
assert.match(migration, /snippet\|description\|raw_query\|query\|email/);
assert.doesNotMatch(
  migration,
  /grant (?:select|insert|update|delete|all)[^;]+to (?:anon|authenticated)/is,
);
assert.match(sqlTest, /Browser role has raw public-web cache access/);
assert.match(sqlTest, /Public-web cache accepted a contact field/);
assert.match(sqlTest, /Provider request bound is missing/);

assert.doesNotMatch(frontends, /BRAVE_SEARCH_API_KEY|X-Subscription-Token|api\.search\.brave\.com/i);
assert.doesNotMatch(frontends, /Found on Brave|Brave result|Search engine result/i);
assert.doesNotMatch(frontends, /raw search quer|raw provider response/i);

for (const required of [
  "provider timeout",
  "429/quota",
  "malformed",
  "zero-result",
  "provider disabled",
  "cache hit",
  "cache expiry",
  "directory, marketplace, social",
  "search hit alone never scores",
  "generic imaging page",
]) assert.match(providerTest.toLowerCase(), new RegExp(required));

assert.match(documentation, /Public Web Discovery is a server-side recall source/);
assert.match(documentation, /No cPanel artifact is required/);
assert.match(documentation, /BRAVE_SEARCH_API_KEY/);
assert.match(documentation, /\$300\.00/);

console.log("Buyer Discovery V2.2 public-web static/security contract: PASSED");

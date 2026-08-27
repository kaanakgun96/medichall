import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/202608250004_buyer_discovery_vnext_search_space.sql",
);
const sqlRegression = read("supabase/tests/buyer_discovery_vnext.sql");
const planner = read(
  "supabase/functions/_shared/buyer-discovery-search-space.ts",
);
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const discoveryHandler = edge.slice(edge.indexOf('if (operation !== "discover")'));
const publicWeb = read("supabase/functions/_shared/public-web-discovery.ts");

assert.match(migration, /buyer_discovery_search_spaces/);
assert.match(migration, /buyer_discovery_partitions/);
assert.match(migration, /buyer_discovery_seen_companies/);
assert.match(migration, /buyer_discovery_run_partitions/);
assert.match(migration, /direct_verified_yield/);
assert.match(migration, /public\.is_bounded_medical_product_phrase_v1/);
assert.doesNotMatch(migration, /public\.is_bounded_medical_product_phrase_v2/);
assert.match(migration, /cached_intent_14_days/);
assert.match(migration, /Customer Fresh Discovery is feature-gated/);
assert.match(migration, /Daily Admin QA Fresh Discovery limit reached/);
assert.match(migration, /v_admin_daily >= 50/);
assert.match(migration, /public\.is_admin\(\)/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /FUTURE_ATOMIC_DEBIT/);
assert.match(migration, /FAILED_PRE_PROVIDER/);
assert.match(migration, /credit debit[\s\S]*attaches here, in this transaction/i);
assert.match(migration, /accept_buyer_discovery_execution_v1/);
assert.match(migration, /No fresh search partition is ready for execution/);
assert.match(migration, /jsonb_array_length\(normalized_candidates\) <= 40/);
assert.doesNotMatch(
  migration,
  /create table[^;]*(?:payment|invoice|checkout)/is,
);

assert.match(
  planner,
  /ProductMarketProfile = "BROAD" \| "STANDARD" \| "NICHE"/,
);
assert.match(planner, /WESTERN_EUROPE/);
assert.match(planner, /CENTRAL_EASTERN_EUROPE/);
assert.match(planner, /PUBLIC_PROCUREMENT_SUPPLIER/);
assert.match(planner, /unusedPartitionsRemaining/);
assert.match(planner, /partitionStaleDays: 14/);
assert.match(publicWeb, /maximumQueries: 10/);
assert.match(publicWeb, /maximumRawResults: 60/);
assert.match(publicWeb, /maximumCostUsdPerRun: 0\.05/);

assert.match(edge, /start_external_prospect_discovery_v3/);
assert.match(edge, /accept_buyer_discovery_execution_v2/);
assert.match(edge, /buildDiscoverySearchPlan/);
assert.match(edge, /buyer_discovery_seen_companies/);
assert.match(edge, /new_verified_buyers/);
assert.match(edge, /previously_discovered_buyers/);
assert.match(edge, /queryPlan: searchPlan\.publicWebQueries/);
assert.doesNotMatch(edge, /body\.(?:queries|provider_queries|search_plan)/);
assert.doesNotMatch(discoveryHandler, /callSmartProductResolver|api\.anthropic\.com|openai/i);
assert.doesNotMatch(discoveryHandler, /send_email|send_message|create_notification/i);

assert.match(sqlRegression, /^begin;$/m);
assert.match(sqlRegression, /^rollback;$/m);
assert.match(sqlRegression, /row_security_active/);
assert.match(sqlRegression, /anon mutation must remain denied/i);

console.log("Buyer Discovery vNext static architecture regression: PASS");

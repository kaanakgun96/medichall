import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/202608200003_external_prospect_discovery.sql");
const sqlTest = read("supabase/tests/external_prospect_discovery.sql");
const registryMigration = read("supabase/migrations/202608200004_external_registry_coverage.sql");
const registrySqlTest = read("supabase/tests/external_registry_coverage.sql");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const discoveryHandler = edge.slice(edge.indexOf('if (operation !== "discover")'));
const shared = read("supabase/functions/_shared/external-prospect-discovery.ts");
const relevance = read("supabase/functions/_shared/buyer-discovery-relevance-v2.ts");
const registries = read("supabase/functions/_shared/external-registry-adapters.ts");
const portal = read("portal.html");
const admin = read("admin.html");
const standalone = read("matchmaking.html");
const workspace = read("matchmaking-workspace.js");
const externalUi = read("external-prospects.js");
const analytics = read("medichall-traffic.js");
const config = read("supabase/config.toml");

new Function(externalUi);
for (const [index, script] of [...admin.matchAll(
  /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
)].map((match) => match[1]).filter((script) => script.trim()).entries()) {
  try {
    new Function(script);
  } catch (error) {
    throw new Error(`admin inline script ${index + 1}: ${error.message}`);
  }
}

for (const table of [
  "external_companies", "external_company_evidence", "external_company_taxonomy",
  "external_company_activities", "external_prospect_discovery_runs",
  "company_external_prospect_matches", "external_prospect_feedback",
]) assert.match(migration, new RegExp(`create table public\\.${table}`));

for (const rpc of [
  "start_external_prospect_discovery_v1", "get_external_prospect_workspace_v1",
  "set_external_prospect_feedback_v1", "get_admin_external_prospect_metrics_v1",
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`));
  assert.match(sqlTest, new RegExp(`public\\.${rpc}`));
}

assert.match(migration, /force row level security/g);
assert.match(migration, /company_owner_authorized_v1\(company_id\)/);
assert.match(migration, /from public, anon, authenticated/);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]+to (?:anon|authenticated)/is);
assert.match(migration, /interval '24 hours'/);
assert.match(migration, /interval '30 minutes'/);
assert.match(migration, /if v_daily >= 3/);
assert.match(migration, /if v_monthly >= 20/);
assert.match(migration, /provider_requests integer not null default 0 check \(provider_requests = 0\)/);
assert.match(migration, /estimated_cost_usd numeric\(10,6\) not null default 0 check \(estimated_cost_usd = 0\)/);
assert.match(migration, /is_direct_product_evidence boolean not null default false check \(not is_direct_product_evidence\)/);
assert.match(migration, /evidence_kind text not null/);
assert.match(migration, /target_market boolean not null/);
assert.match(migration, /'NOTE_ONLY'/);
assert.doesNotMatch(migration, /grant usage, select on all sequences/i);

assert.match(registryMigration, /add column mapping_confidence text not null/);
assert.match(registryMigration, /create table public\.external_registry_request_cache/);
assert.match(registryMigration, /force row level security/);
assert.match(registryMigration, /grant all on table public\.external_registry_request_cache to service_role/);
assert.doesNotMatch(
  registryMigration,
  /grant (?:select|insert|update|delete|all)[^;]+to (?:anon|authenticated)/is,
);
assert.match(registryMigration, /registry_activity_countries/);
assert.match(registryMigration, /registry_adapter_usage/);
assert.match(registryMigration, /registry_cache_hits/);
assert.match(registrySqlTest, /Browser role has raw registry cache access/);
assert.match(registrySqlTest, /Registry cache accepted a contact field/);
assert.doesNotMatch(
  registryMigration.slice(
    registryMigration.indexOf("create table public.external_registry_request_cache"),
    registryMigration.indexOf("create index external_registry_request_cache_expiry_idx"),
  ),
  /\b(?:contact_email|phone|contact_name|linkedin_url)\s+(?:text|jsonb)/i,
);

const externalSchema = migration.slice(
  migration.indexOf("create table public.external_companies"),
  migration.indexOf("create table public.external_prospect_discovery_runs"),
);
assert.doesNotMatch(externalSchema, /\b(?:contact_email|contact_name|phone|linkedin_url)\b/i);
assert.match(migration, /evidence_snippet[^;]+!~\*/s);
assert.match(shared, /DIRECT_PRODUCT_EVIDENCE/);
assert.match(shared, /INDIRECT_COMMERCIAL_EVIDENCE/);
assert.match(shared, /qualifiedDirect\.length >= 1/);
assert.match(shared, /qualifiedIndependentAdjacentSourceCount >= 2/);
assert.match(shared, /commercialIdentityVerified/);
assert.match(shared, /candidate\.nameSource !== "PAGE_METADATA"/);
assert.match(shared, /exact current product availability is not claimed/);
assert.match(shared, /Math\.min\(42, relevanceScore\)/);
assert.match(shared, /boundedTedSearchPlan/);
assert.match(shared, /maximumTedProductRequests: 4/);
assert.match(shared, /maximumTedCpvRequests: 2/);
assert.match(shared, /maximumProductTedCandidates: 100/);
assert.match(shared, /maximumCpvTedCandidates: 40/);
assert.match(shared, /DIRECT_PRODUCT_TERM_TED/);
assert.match(shared, /RELATED_CPV_TED/);
assert.match(shared, /partitionTedCandidates/);
assert.match(shared, /rankProspects/);
assert.match(relevance, /DIRECT_PRODUCT_FIT/);
assert.match(relevance, /ADJACENT_COMMERCIAL_FIT/);
assert.match(relevance, /PRODUCT_FAMILY_MISMATCH/);
assert.match(relevance, /PROCEDURE_PACK_MANUFACTURER/);
assert.match(relevance, /KIT_ASSEMBLER/);
assert.match(relevance, /OEM_PRIVATE_LABEL/);
assert.doesNotMatch(relevance, /Polysistem|Mediberg|Betatex|Synektik|PRIM S\.A\./);
assert.match(shared, /productTaxonomyScore/);
assert.match(shared, /geographyScore/);
assert.match(shared, /companyTypeScore/);
assert.match(shared, /procurementSignalScore/);
assert.match(shared, /evidenceQualityScore/);
assert.match(shared, /recencyScore/);

assert.match(registries, /FR_RECHERCHE_ENTREPRISES/);
assert.match(registries, /NO_BRREG_ENHETSREGISTERET/);
for (const provider of [
  "DE_UNTERNEHMENSREGISTER", "IT_REGISTRO_IMPRESE",
  "ES_REGISTRO_MERCANTIL_DIRCE", "NL_KVK_HVDS",
  "BE_CBE_OPEN_DATA", "PL_KRS_OPEN_API",
]) assert.match(registries, new RegExp(provider));
assert.match(registries, /DISABLED_PENDING_LEGAL_REVIEW/);
assert.match(registries, /UNAVAILABLE/);
assert.match(registries, /maximumRequestsPerRun: 0/);
assert.match(registries, /explicitKrsIdentifier/);
assert.match(registries, /recherche-entreprises\.api\.gouv\.fr/);
assert.match(registries, /data\.brreg\.no/);
assert.match(registries, /api-krs\.ms\.gov\.pl/);
assert.match(edge, /api\.ted\.europa\.eu\/v3\/notices\/search/);
assert.match(edge, /safeFetchWithRedirects/);
assert.match(edge, /isPathAllowedByRobots/);
assert.match(edge, /maximumTedResultsPerQuery/);
assert.match(edge, /scope: "ALL"/);
assert.match(edge, /winner-touchpoint-internet-address/);
assert.match(edge, /organisation-name-tenderer/);
assert.match(edge, /PROCURING_AUTHORITY_EXCLUDED/);
assert.match(edge, /ted_product_relevant_notices/);
assert.match(edge, /website_candidates_with_domains/);
assert.match(edge, /analyzeOfficialWebsitePage/);
assert.match(edge, /public_web_commercial_identity_rejected/);
assert.doesNotMatch(edge, /source: "PAGE_METADATA"/);
assert.match(edge, /provider_requests: 0/);
assert.match(edge, /emails_sent: 0/);
assert.match(edge, /external_registry_request_cache/);
assert.match(edge, /registry_cache_hits/);
assert.match(edge, /mapping_confidence: activity\.mappingConfidence/);
assert.doesNotMatch(discoveryHandler, /callSmartProductResolver|api\.anthropic\.com|OPENAI|RESEND_API_KEY|sendEmail|notification_outbox/i);
assert.doesNotMatch(edge, /organisation-email|winner-touchpoint-email/i);
assert.doesNotMatch(edge, /google\.|bing\.|duckduckgo/i);
assert.doesNotMatch(registries, /APOLLO|api\.apollo|contact_email|contact_name|linkedin_url/i);
assert.match(config, /\[functions\.external-prospect-discovery\]\nverify_jwt = false/);

const evidenceUpsert = edge.match(
  /admin\.from\("external_company_evidence"\)\.upsert\(\{([\s\S]*?)\}, \{ onConflict: "external_company_id,source_hash" \}/,
)?.[1] || "";
assert.doesNotMatch(evidenceUpsert, /relevance_class|matched_terms|commercial_reason/);
assert.match(edge, /evidence_snapshot:[\s\S]*?relevance_class:/);
assert.match(edge, /evidence_snapshot:[\s\S]*?candidate_discovery_reason:/);
assert.match(edge, /evidence_snapshot:[\s\S]*?procurement_role:/);
assert.match(edge, /evidence_snapshot:[\s\S]*?matched_terms:/);
assert.match(edge, /evidence_snapshot:[\s\S]*?commercial_reason:/);

for (const page of [portal, standalone]) {
  assert.match(page, /external-prospects\.css\?v=20260829state1/);
  assert.match(page, /external-prospects\.js\?v=20260829state1/);
}
assert.match(portal, /European Buyer Discovery/);
assert.match(portal, /#buyer-discovery/);
assert.match(workspace, /buyer_discovery/);
assert.match(externalUi, /Discover European buyers/);
assert.match(externalUi, /Evidence-backed/);
assert.match(externalUi, /Not yet a MedicHall member/);
assert.match(externalUi, /adjacent commercial signal/);
assert.match(externalUi, /generic context signal/);
assert.match(externalUi, /Indirect commercial evidence/);
assert.match(externalUi, /Target markets/);
assert.match(externalUi, /Procurement/);
assert.match(externalUi, /feedback\(id,"NOTE_ONLY",note\)/);
assert.doesNotMatch(externalUi, /Send email|Start outreach|Email prospect|contact_email|contact_name|phone|linkedin_url/i);

for (const event of [
  "external_prospect_discovery_started", "external_prospect_discovery_completed",
  "external_prospect_viewed", "external_prospect_saved",
  "external_prospect_dismissed", "external_prospect_website_clicked",
]) {
  assert.match(analytics, new RegExp(`"${event}"`));
  assert.match(migration, new RegExp(`'${event}'`));
}

console.log("External Prospect Discovery static contract: PASSED");

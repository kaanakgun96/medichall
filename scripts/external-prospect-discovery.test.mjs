import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/202608200003_external_prospect_discovery.sql");
const sqlTest = read("supabase/tests/external_prospect_discovery.sql");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const shared = read("supabase/functions/_shared/external-prospect-discovery.ts");
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

const externalSchema = migration.slice(
  migration.indexOf("create table public.external_companies"),
  migration.indexOf("create table public.external_prospect_discovery_runs"),
);
assert.doesNotMatch(externalSchema, /\b(?:contact_email|contact_name|phone|linkedin_url)\b/i);
assert.match(migration, /evidence_snippet[^;]+!~\*/s);
assert.match(shared, /DIRECT_PRODUCT_EVIDENCE/);
assert.match(shared, /INDIRECT_COMMERCIAL_EVIDENCE/);
assert.match(shared, /direct\.length >= 1 \|\| indirectSources\.size >= 2/);
assert.match(shared, /exact current product availability is not claimed/);
assert.match(shared, /productTaxonomyScore/);
assert.match(shared, /geographyScore/);
assert.match(shared, /companyTypeScore/);
assert.match(shared, /procurementSignalScore/);
assert.match(shared, /evidenceQualityScore/);
assert.match(shared, /recencyScore/);

assert.match(registries, /FR_RECHERCHE_ENTREPRISES/);
assert.match(registries, /NO_BRREG_ENHETSREGISTERET/);
assert.match(registries, /recherche-entreprises\.api\.gouv\.fr/);
assert.match(registries, /data\.brreg\.no/);
assert.match(edge, /api\.ted\.europa\.eu\/v3\/notices\/search/);
assert.match(edge, /safeFetchWithRedirects/);
assert.match(edge, /isPathAllowedByRobots/);
assert.match(edge, /maximumTedResultsPerQuery/);
assert.match(edge, /provider_requests: 0/);
assert.match(edge, /emails_sent: 0/);
assert.doesNotMatch(edge, /ANTHROPIC|OPENAI|RESEND_API_KEY|sendEmail|notification_outbox/i);
assert.match(config, /\[functions\.external-prospect-discovery\]\nverify_jwt = false/);

for (const page of [portal, standalone]) {
  assert.match(page, /external-prospects\.css\?v=20260820external1/);
  assert.match(page, /external-prospects\.js\?v=20260820external1/);
}
assert.match(portal, /External Prospects/);
assert.match(workspace, /external_prospects/);
assert.match(externalUi, /Discover prospects/);
assert.match(externalUi, /Not yet on MedicHall/);
assert.match(externalUi, /INDIRECT COMMERCIAL EVIDENCE/);
assert.match(externalUi, /Target markets/);
assert.match(externalUi, /Procurement signal/);
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

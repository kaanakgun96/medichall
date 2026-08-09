import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const portal = read("portal.html");
const migration = read("supabase/migrations/202608090001_onboarding_activation.sql");
const sqlRegression = read("supabase/tests/onboarding_activation.sql");

test("activation state is authenticated, user-scoped, and derived from canonical records", () => {
  assert.match(migration, /create table if not exists public\.account_onboarding_progress/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /create or replace function public\.get_account_activation_state_v1\(\)/);
  assert.doesNotMatch(migration, /get_account_activation_state_v1\([^)]*company/i);
  assert.match(migration, /revoke all on function public\.get_account_activation_state_v1\(\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_account_activation_state_v1\(\) to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]+to anon/i);
});

test("weighted profile scores are deterministic and role-relevant", () => {
  for (const evidence of [
    "company_information_score",
    "has_certifications",
    "product_count",
    "preference_score",
    "matchmaking_score",
  ]) assert.match(migration, new RegExp(evidence));
  assert.match(migration, /profile_score := greatest\(0, least\(100, profile_score\)\)/);
  assert.match(migration, /when lower\(coalesce\(company_row\.type, ''\)\) like '%distributor%' then 'distributor'/);
  assert.match(migration, /account_role = 'buyer'/);
  assert.match(migration, /'company_matches', partner_match_count/);
  assert.match(migration, /'tender_matches', tender_match_count/);
  assert.match(migration, /'distributor_matches', distributor_match_count/);
});

test("portal provides resumable guidance for manufacturer, distributor, and buyer accounts", () => {
  assert.match(portal, /pickRole\('distributor'\)/);
  assert.match(portal, /chooseRole\('distributor'\)/);
  assert.match(portal, /id="activationGuide"/);
  assert.match(portal, /id="bActivationGuide"/);
  assert.match(portal, /rpc\/get_account_activation_state_v1/);
  assert.match(portal, /rpc\/set_account_onboarding_progress_v1/);
  assert.match(portal, /Continue whenever you are ready/);
  assert.match(portal, /function dismissActivationGuide\(\)/);
  assert.match(portal, /function resumeActivationGuide\(\)/);
  assert.match(portal, /function scheduleActivationRefresh\(\)/);
  assert.match(portal, /recordFirstMmMatchView\(\)/);
  assert.match(portal, /recordFirstTenderMatchView\(\)/);
  assert.doesNotMatch(portal, /We found \d+ (?:company|tender|distributor) match/);
});

test("production SQL regression covers all three roles and rolls back", () => {
  assert.match(sqlRegression, /^-- Run after 202608090001_onboarding_activation\.sql\./);
  assert.match(sqlRegression, /Onboarding Manufacturer QA/);
  assert.match(sqlRegression, /Onboarding Distributor QA/);
  assert.match(sqlRegression, /Onboarding Buyer QA/);
  assert.match(sqlRegression, /onboarding progress leaked across users/);
  assert.match(sqlRegression, /buyer activation includes irrelevant company tasks/);
  assert.match(sqlRegression, /anonymous onboarding RPC execution is not denied/);
  assert.match(sqlRegression, /rollback;\s*$/);
});

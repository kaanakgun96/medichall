import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const portal = read("portal.html");
const standalone = read("matchmaking-workspace.js");
const migration = read("supabase/migrations/202608090002_opportunity_intelligence.sql");
const hardening = read("supabase/migrations/202608090003_tender_ask_hardening.sql");
const edge = read("supabase/functions/tender-ask/index.ts");
const regression = read("supabase/tests/opportunity_intelligence.sql");

test("tender intelligence is tenant scoped and uses explicit decision states", () => {
  assert.match(migration, /company\.owner_id = auth\.uid\(\)/);
  for (const status of ["match", "possible_match", "review_required", "not_supported"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /unknown_is_not_positive_evidence/);
  assert.match(regression, /Cross-company opportunity intelligence leaked/);
});

test("scoped Q&A leases and caches before the provider call", () => {
  const reserve = edge.indexOf('"reserve_tender_question_v1"');
  const provider = edge.indexOf('fetch("https:\/\/api.anthropic.com\/v1\/messages"');
  assert.ok(reserve >= 0 && provider > reserve, "reservation must precede provider fetch");
  assert.match(migration, /unique \(company_id, tender_id, question_hash, context_hash\)/);
  assert.match(regression, /Live lease allowed a duplicate provider request/);
  assert.match(regression, /Immediate failed-question retry was not deduplicated/);
  assert.match(hardening, /interval '5 minutes'/);
  assert.match(edge, /RETRY_COOLDOWN/);
  assert.match(edge, /E\$\{index \+ 1\}/);
  assert.doesNotMatch(edge, /console\.(?:log|error)\([^\n]*(?:anthropicKey|serviceRoleKey|authHeader|question)/);
});

test("portal shows uncertainty, citations, cache state, and unknown evidence honestly", () => {
  for (const label of ["MATCH", "POSSIBLE MATCH", "REVIEW REQUIRED", "NOT SUPPORTED"]) {
    assert.match(portal, new RegExp(label));
  }
  assert.match(portal, /Unknown fields contribute no positive evidence/);
  assert.match(portal, /What still needs verification/);
  assert.match(portal, /Cached answer · no new AI request/);
  assert.match(portal, /Ask MedicHall about this tender/);
  assert.match(standalone, /No supported positive drivers yet/);
});

test("cost and usage context are persisted without exposing credentials", () => {
  for (const field of ["feature", "company_id", "tender_id", "tender_import_id", "estimated_cost_usd"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(edge, /MAX_TENDER_ASK_COST_USD/);
  assert.match(edge, /MAX_OUTPUT_TOKENS = 900/);
  assert.doesNotMatch(portal, /ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

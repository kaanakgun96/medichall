import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/202608200002_ted_canonical_lots_access_hotfix.sql"),
  "utf8",
);
const regression = fs.readFileSync(
  path.join(root, "supabase/tests/ted_canonical_lots_access_hotfix.sql"),
  "utf8",
);
const currentPortal = fs.readFileSync(path.join(root, "portal.html"), "utf8");

const policyNames = [
  "owner manage own match profile",
  "owner read own opportunity matches",
  "owners read own tender imports",
  "owners read own imported tenders",
];

for (const policyName of policyNames) {
  assert.match(migration, new RegExp(`create policy "${policyName}"`));
}

assert.equal(
  (migration.match(/company_owner_authorized_v1\(/g) || []).length,
  6,
  "the preflight plus every ownership expression must use the existing owner helper",
);
assert.doesNotMatch(migration, /grant\s+select[\s\S]*public\.companies/i);
assert.doesNotMatch(migration, /grant[\s\S]*public\.tender_canonical_lots/i);
assert.doesNotMatch(migration, /alter\s+default\s+privileges/i);
assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/i);

assert.match(regression, /^--[\s\S]*\nbegin;/);
assert.match(regression, /rollback;\s*$/);
assert.match(regression, /My Matches tender relationship is unavailable/);
assert.match(regression, /All Tenders search cannot return the fixture/);
assert.match(regression, /Cross-company My Matches isolation failed/);
assert.match(regression, /Admin tender access regressed/);
assert.match(regression, /Company privacy was weakened by the tender hotfix/);
assert.match(regression, /Canonical lot table received a broad browser grant/);

const requestSignatures = [
  "opportunity_matches?select=*,tenders(*),distributor_candidates(*)",
  'db("rpc/search_tenders"',
];
for (const signature of requestSignatures) {
  assert.ok(currentPortal.includes(signature), `current portal lost ${signature}`);
}

const currentMyMatches = currentPortal.match(
  /"opportunity_matches\?select=\*,tenders\(\*\),distributor_candidates\(\*\)"\s*\+[\s\S]{0,260}/,
)?.[0];
assert.ok(currentMyMatches, "My Matches must retain its established relationship request");
assert.match(currentMyMatches, /&company_id=eq\." \+ COMPANY\.id/);
assert.match(currentMyMatches, /&status=neq\.dismissed/);

console.log("TED canonical-lot access hotfix static regression: PASS");

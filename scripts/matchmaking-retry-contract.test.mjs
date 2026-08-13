import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = read(
  "supabase/migrations/202608130001_matchmaking_retry_storm_remediation.sql",
);
const regression = read("supabase/tests/matchmaking_workspace.sql");
const focusedSql = read("supabase/tests/matchmaking_retry_contract.sql");
const standalone = read("matchmaking-workspace.js");
const portal = read("portal.html");
const session = read("medichall-session.js");

const affectedSignatures = [
  "claim_matchmaking_video_room(bigint)",
  "complete_matchmaking_video_room(bigint,text,text,text,text,timestamp with time zone)",
  "fail_matchmaking_video_room(bigint,text)",
  "mm_begin_idempotent_operation(uuid,text,uuid,jsonb)",
  "request_business_connection_v2(uuid,text,uuid)",
  "respond_business_connection_v2(bigint,text,integer,uuid)",
  "respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)",
  "revise_matchmaking_meeting_proposal(bigint,integer,text,text,text,text,jsonb,uuid)",
  "submit_matchmaking_meeting_outcome(bigint,text,text,text,timestamp with time zone,uuid)",
  "update_matchmaking_meeting_draft(bigint,integer,text,text,text,text,jsonb,uuid)",
];

test("forward migration pins exactly ten audited routines and twenty branches", () => {
  for (const signature of affectedSignatures) {
    assert.match(migration, new RegExp(`public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.equal([...migration.matchAll(/'body_md5', '[a-f0-9]{32}'/g)].length, 10);
  const occurrences = [...migration.matchAll(/'occurrences', (\d+)/g)]
    .reduce((total, match) => total + Number(match[1]), 0);
  assert.equal(occurrences, 20);
  assert.match(migration, /total_replacements <> 20/);
  assert.match(migration, /'errcode = ''40001''',\s*'errcode = ''PT409'''/s);
  assert.match(migration, /Security metadata changed unexpectedly/);
  assert.match(migration, /An unaudited public 40001 branch remains/);
});

test("SQL lifecycle regression requires PT409 and rejected-key rollback", () => {
  assert.doesNotMatch(regression, /serialization_failure/);
  assert.ok((regression.match(/sqlstate 'PT409'/g) ?? []).length >= 5);
  assert.match(regression, /A stale proposal was accepted/);
  assert.match(regression, /An already-processed meeting was accepted again/);
  assert.match(regression, /Rejected meeting conflict left an idempotency artifact/);
  assert.match(regression, /Idempotent acceptance did not replay its first result/);
});

test("focused SQL contract is rollback-only and preserves RPC privileges", () => {
  assert.match(focusedSql, /^begin;/m);
  assert.match(focusedSql, /^rollback;/m);
  assert.match(focusedSql, /retryable_count <> 0/);
  assert.match(focusedSql, /conflict_routine_count <> 10 or conflict_branch_count <> 20/);
  assert.match(focusedSql, /has_function_privilege\(\s*'anon'/s);
  assert.match(focusedSql, /not has_function_privilege\(\s*'authenticated'/s);
});

test("meeting action clients have no unbounded business-conflict retry", () => {
  assert.equal((standalone.match(/rpc\("respond_matchmaking_meeting"/g) ?? []).length, 2);
  assert.equal((portal.match(/mmRpc\("respond_matchmaking_meeting"/g) ?? []).length, 2);
  assert.doesNotMatch(standalone, /while\s*\([^)]*respond_matchmaking_meeting/);
  assert.doesNotMatch(portal, /while\s*\([^)]*respond_matchmaking_meeting/);
  assert.match(session, /response\.status === 401 && control\.retry !== false/);
  assert.doesNotMatch(session, /response\.status === 409/);
});

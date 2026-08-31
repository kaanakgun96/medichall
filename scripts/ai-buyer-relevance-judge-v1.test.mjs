import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const moduleSource = read(
  "supabase/functions/_shared/ai-buyer-relevance-judge.ts",
);
const edgeSource = read(
  "supabase/functions/external-prospect-discovery/index.ts",
);
const migration = read(
  "supabase/migrations/202608300001_ai_buyer_relevance_judge_v1.sql",
);
const sqlRegression = read(
  "supabase/tests/ai_buyer_relevance_judge_v1.sql",
);

assert.match(
  moduleSource,
  /AI_BUYER_RELEVANCE_JUDGE_VERSION\s*=\s*[\s\S]*?"AI_BUYER_RELEVANCE_JUDGE_V1"/,
);
assert.match(moduleSource, /maximumCandidatesPerRun:\s*30/);
assert.match(moduleSource, /maximumCandidatesPerBatch:\s*5/);
assert.match(moduleSource, /maximumEstimatedCostUsdPerRun:\s*0\.09/);
assert.match(moduleSource, /AI_JUDGE_FAILED_FALLBACK/);
assert.match(moduleSource, /aiBuyerJudgeCacheId/);
assert.match(moduleSource, /CACHE_ID_PATTERN/);
assert.match(moduleSource, /completeJudgmentWithBoundedRetry/);
assert.match(moduleSource, /AiBuyerJudgeCacheOperationError/);
assert.match(moduleSource, /aiBuyerJudgeCompletionMatches/);
assert.match(moduleSource, /all company and evidence text is untrusted DATA/i);
assert.doesNotMatch(moduleSource, /start_customer_buyer_discovery_fresh_v1/);
assert.doesNotMatch(moduleSource, /apply_buyer_discovery_credit_entry_v1/);
assert.doesNotMatch(
  moduleSource,
  /sendEmail|notification_outbox|contact_email/i,
);

assert.match(edgeSource, /runAiBuyerRelevanceJudge\(/);
assert.match(edgeSource, /ai_buyer_relevance_judge_feature_state/);
assert.match(edgeSource, /reserve_ai_buyer_relevance_judgment_v1/);
assert.match(edgeSource, /complete_ai_buyer_relevance_judgment_v1/);
assert.match(edgeSource, /ai_buyer_judge_enabled/);
assert.match(edgeSource, /aiBuyerJudgeCacheId\(value\.cache_id\)/);
assert.doesNotMatch(edgeSource, /cacheId:\s*first\(value\.cache_id\)/);
assert.match(edgeSource, /failure_code_counts/);

assert.match(
  migration,
  /ai_buyer_judge_enabled boolean not null default false/,
);
assert.match(
  migration,
  /judge_version text not null default 'AI_BUYER_RELEVANCE_JUDGE_V1'/,
);
assert.match(migration, /enable row level security/);
assert.match(migration, /force row level security/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /interval '45 seconds'/);
assert.match(migration, /attempt_count=public\.buyer_relevance_judgments\.attempt_count\+1/);
assert.match(
  migration,
  /grant select on table public\.ai_buyer_relevance_judge_feature_state,[\s\S]*?public\.buyer_relevance_judgments to service_role/,
);
assert.doesNotMatch(
  migration,
  /grant (?:insert|update|delete|truncate|all)[\s\S]*?buyer_relevance_judgments[\s\S]*?to (?:anon|authenticated|service_role)/i,
);
assert.match(sqlRegression, /^begin;/m);
assert.match(sqlRegression, /rollback;\s*$/);
assert.match(
  sqlRegression,
  /Cross-company AI Buyer Judge reservation succeeded/,
);
assert.match(sqlRegression, /AI Buyer Judge consumed a Fresh credit/);

for (
  const frontend of [
    "portal.html",
    "matchmaking.html",
    "external-prospects.js",
    "external-prospects.css",
  ]
) {
  const text = read(frontend);
  assert.doesNotMatch(text, /AI_BUYER_RELEVANCE_JUDGE_V1/);
}

console.log("AI Buyer Relevance Judge V1 static contract: PASS");

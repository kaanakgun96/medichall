import assert from "node:assert/strict";

const edgeSource = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const migrationSource = await Deno.readTextFile(
  new URL(
    "../../migrations/202608310001_adaptive_medical_commercial_retrieval_v1.sql",
    import.meta.url,
  ),
);

Deno.test("adaptive retrieval is independently gated, cached and fail-open to the legacy planner", () => {
  assert.match(edgeSource, /adaptive_medical_retrieval_feature_state/);
  assert.match(edgeSource, /reserve_adaptive_medical_retrieval_v1/);
  assert.match(edgeSource, /complete_adaptive_medical_retrieval_v1/);
  assert.match(edgeSource, /fail_adaptive_medical_retrieval_v1/);
  assert.match(edgeSource, /ADAPTIVE_RETRIEVAL_FALLBACK/);
  assert.match(
    edgeSource,
    /adaptiveIntelligence: adaptiveRetrievalRuntime\.intelligence/,
  );
  assert.match(
    edgeSource,
    /ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_IMPLEMENTATION_VERSION,\s+model,/,
  );
  assert.match(edgeSource, /providerRequests = 1/);
  assert.doesNotMatch(edgeSource, /adaptive_medical.*customer_fresh_enabled/is);
});

Deno.test("feature state defaults OFF and global cache contains no tenant/private columns", () => {
  assert.match(
    migrationSource,
    /adaptive_medical_commercial_retrieval_enabled boolean not null default false/,
  );
  assert.match(migrationSource, /force row level security/);
  assert.match(migrationSource, /grant select on table[\s\S]*to service_role/);
  assert.match(
    migrationSource,
    /grant execute on function[\s\S]*to service_role/,
  );
  const cacheDefinition = migrationSource.match(
    /create table public\.adaptive_medical_retrieval_cache \(([\s\S]*?)\n\);/,
  )?.[1] || "";
  assert(cacheDefinition);
  assert.doesNotMatch(
    cacheDefinition,
    /^\s+(company_id|tenant_id|user_id|email|phone|contact|message|prompt|url)\s/im,
  );
});

Deno.test("adaptive diagnostics remain retrieval-only and downstream evidence/Judge code remains intact", () => {
  assert.match(edgeSource, /generated_term_counts/);
  assert.match(edgeSource, /partition_stages_planned/);
  assert.match(edgeSource, /stage_stop_reason/);
  assert.match(edgeSource, /direct_commercial_prospects_accepted/);
  assert.match(edgeSource, /end_buyer_procurement_signals/);
  assert.match(edgeSource, /runAiBuyerRelevanceJudge/);
  assert.match(edgeSource, /classifyEvidenceForProduct/);
  assert.match(edgeSource, /credit_disposition/);
  assert.doesNotMatch(
    edgeSource,
    /adaptiveRetrievalRuntime\.intelligence\?.*(?:evidence|buyer|company)/,
  );
});

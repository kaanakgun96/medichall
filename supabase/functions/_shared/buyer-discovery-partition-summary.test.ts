import assert from "node:assert/strict";
import fixture from "./fixtures/partition-summary-gown.json" with {
  type: "json",
};
import {
  buildProductFamilyProfile,
  withAdaptiveCommercialIntelligence,
} from "./buyer-discovery-relevance-v2.ts";
import { buildDiscoverySearchPlan } from "./buyer-discovery-search-space.ts";
import type { AdaptiveMedicalRetrievalIntelligence } from "./adaptive-medical-commercial-retrieval.ts";
import { buildDiscoveryPartitionSummary } from "./buyer-discovery-partition-summary.ts";

const intelligence = fixture
  .intelligence as AdaptiveMedicalRetrievalIntelligence;
const plan = buildDiscoverySearchPlan({
  runMode: "NORMAL_DISCOVERY",
  productFamily: withAdaptiveCommercialIntelligence(
    buildProductFamilyProfile([fixture.profile]),
    intelligence,
  ),
  targetCountries: fixture.targetCountries,
  cpvCodes: fixture.cpvCodes,
  adaptiveIntelligence: intelligence,
  highRecallEnabled: true,
});
const prohibited =
  /email|phone|whatsapp|contact_name|linkedin_url|provider_api_key/i;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

Deno.test("exact Surgical Gown pre-fix summary exceeds the real DB size bound; V2 projection fits", () => {
  const legacy = buildDiscoveryPartitionSummary({
    ...plan,
    highRecall: undefined,
  });
  const old = { ...legacy, universal_high_recall: plan.highRecall };
  assert.equal(bytes(old), 38392);
  assert(bytes(old) > 32768);
  assert(!prohibited.test(JSON.stringify(old)));
  assert.equal(plan.highRecall!.waves.length, 3);
  assert.equal(plan.selectedPartitions.length, 23);
  const before = structuredClone(plan);
  const summary = buildDiscoveryPartitionSummary(plan);
  assert(bytes(summary) < 6000);
  assert.equal(summary.selected_partition_count, 23);
  assert.equal(summary.universal_high_recall?.planned_web_queries, 17);
  assert.equal(summary.universal_high_recall?.planned_ted_partitions, 6);
  assert(!prohibited.test(JSON.stringify(summary)));
  assert(
    !/"(selectedPartitions|publicWebQueries|tedPartitions|query|terminology)":/
      .test(JSON.stringify(summary)),
  );
  assert.deepEqual(
    plan,
    before,
    "summary projection must not alter execution, credits or retrieval budgets",
  );
});

Deno.test("legacy flag-off output remains byte-for-byte identical, with or without adaptive", () => {
  for (const adaptive of [plan.adaptive, undefined]) {
    const legacy = { ...plan, highRecall: undefined, adaptive };
    const expected = {
      version: legacy.version,
      run_mode: legacy.runMode,
      selected_partition_keys: legacy.selectedPartitions.map((p) =>
        p.partitionKey
      ),
      languages: [...new Set(legacy.selectedPartitions.map((p) => p.language))],
      regions: [
        ...new Set(legacy.selectedPartitions.map((p) => p.marketRegion)),
      ],
      buyer_archetypes: [
        ...new Set(legacy.selectedPartitions.map((p) => p.buyerArchetype)),
      ],
      unused_partitions_remaining: legacy.unusedPartitionsRemaining,
      stale_partitions_revisited: legacy.stalePartitionsRevisited,
      saturation: legacy.saturation,
      provider_budget: legacy.budget,
      universal_high_recall: null,
      adaptive: legacy.adaptive || null,
    };
    assert.equal(
      JSON.stringify(buildDiscoveryPartitionSummary(legacy)),
      JSON.stringify(expected),
    );
  }
});

Deno.test("arbitrary broad/standard/niche plans and subsequent progress retain bounded summaries", () => {
  for (
    const canonicalName of [
      "Syringe",
      "Sterile Surgical Gown",
      "Camera Cover",
      "Biopsy Needle",
    ]
  ) {
    for (const runMode of ["NORMAL_DISCOVERY", "ADMIN_QA_FRESH"] as const) {
      const p = buildDiscoverySearchPlan({
        runMode,
        productFamily: buildProductFamilyProfile([{
          canonicalName,
          slug: canonicalName.toLowerCase().replaceAll(" ", "-"),
        }]),
        targetCountries: [],
        cpvCodes: ["33140000"],
        highRecallEnabled: true,
      });
      const summary = buildDiscoveryPartitionSummary(p);
      assert(bytes(summary) < 6000);
      assert(!prohibited.test(JSON.stringify(summary)));
      const progress = {
        stage: "preparing_market_search",
        partition_summary: summary,
      };
      const subsequent = { ...progress, stage: "searching_procurement" };
      assert.deepEqual(subsequent.partition_summary, summary);
    }
  }
});

Deno.test("oversized/adversarial plan yields fixed-size telemetry without raw strings or injected fields", () => {
  const huge = structuredClone(plan);
  huge.selectedPartitions = Array.from({ length: 10000 }, (_, i) => ({
    ...plan.selectedPartitions[0],
    partitionKey: `web|${"x".repeat(248)}${i}`,
    language: `language${i}`,
    marketRegion: `region${i}`,
    terminology: ["email: not-a-contact fixture", "x".repeat(50000)],
  }));
  huge.highRecall!.waves = Array.from(
    { length: 100 },
    () => ({
      ...plan.highRecall!.waves[0],
      selectedPartitions: huge.selectedPartitions,
    }),
  );
  huge.adaptive!.negativeContexts = [
    "email phone whatsapp contact_name linkedin_url provider_api_key",
    "x".repeat(100000),
  ];
  huge.adaptive!.generatedTermCounts.provider_api_key = 123;
  huge.budget.maximumPublicWebCostUsd = Number.POSITIVE_INFINITY;
  const summary = buildDiscoveryPartitionSummary(huge);
  assert(bytes(summary) < 6000);
  assert(summary.selected_partition_keys.length <= 6);
  assert(summary.languages.length <= 12);
  assert.equal(summary.universal_high_recall?.waves.length, 3);
  assert.equal(summary.selected_partition_count, 10000);
  assert(!prohibited.test(JSON.stringify(summary)));
  assert(
    !/"(selectedPartitions|publicWebQueries|tedPartitions|query|terminology)":/
      .test(JSON.stringify(summary)),
  );
});

Deno.test("maximum retained samples have a single-digit KB serialization bound", () => {
  const worst = structuredClone(plan);
  worst.selectedPartitions = Array.from({ length: 100 }, (_, i) => ({
    ...plan.selectedPartitions[0],
    partitionKey: String(i).padStart(256, "x"),
    language: String(i).padStart(48, "l"),
    marketRegion: String(i).padStart(48, "r"),
    buyerArchetype: String(i).padStart(
      48,
      "a",
    ) as typeof plan.selectedPartitions[number]["buyerArchetype"],
  }));
  const summary = buildDiscoveryPartitionSummary(worst);
  // PostgreSQL adds spaces after JSON punctuation; even a conservative doubled
  // punctuation allowance fits 8 KB, below the unchanged 32 KB CHECK.
  const serialized = JSON.stringify(summary);
  const punctuation = (serialized.match(/[:,]/g) || []).length;
  assert(bytes(summary) + punctuation * 2 < 8192);
});

Deno.test("Edge preparing progress uses the canonical projection; no second full-plan persistence", async () => {
  const source = await Deno.readTextFile(
    new URL("../external-prospect-discovery/index.ts", import.meta.url),
  );
  assert.equal((source.match(/partition_summary:/g) || []).length, 1);
  assert(
    source.includes(
      "partition_summary: buildDiscoveryPartitionSummary(searchPlan)",
    ),
  );
  const module = await Deno.readTextFile(
    new URL("./buyer-discovery-partition-summary.ts", import.meta.url),
  );
  assert(!/\.rpc\(|\.from\(|fetch\(|Deno\.env/.test(module));
});

import assert from "node:assert/strict";

const assertEquals: typeof assert.deepEqual = assert.deepEqual;
const assertNotEquals: typeof assert.notEqual = assert.notEqual;
import {
  adaptiveDiscoveryBudget,
  assertValidPartitionPriorities,
  buildDiscoverySearchPlan,
  buildPartitionPersistenceRows,
  classifyDiscoveryResultState,
  classifyProductMarketProfile,
  discoverySaturation,
  freshDiscoveryMessage,
  orderDiscoveryStates,
} from "./buyer-discovery-search-space.ts";
import {
  buildProductFamilyProfile,
  type ProductFamilyProfile,
} from "./buyer-discovery-relevance-v2.ts";
import { buildTemporaryProductFamilyProfile } from "./unknown-product-resolution.ts";

function knownProfile(input: {
  canonicalName: string;
  slug: string;
  aliases?: string[];
  localizedAliases?: Array<{ term: string; language: string }>;
}): ProductFamilyProfile {
  return buildProductFamilyProfile([input]);
}

const syringe = knownProfile({
  canonicalName: "Syringe",
  slug: "syringes",
  aliases: ["Sterile syringe", "Disposable syringe", "Hypodermic syringe"],
  localizedAliases: [
    { term: "Siringa sterile", language: "it" },
    { term: "Seringue stérile", language: "fr" },
    { term: "Sterile Spritze", language: "de" },
    { term: "Jeringa estéril", language: "es" },
  ],
});
const gown = knownProfile({
  canonicalName: "Sterile Surgical Gown",
  slug: "sterile-surgical-gowns",
  aliases: ["Surgical gown", "Sterile gown"],
  localizedAliases: [
    { term: "Camice chirurgico", language: "it" },
    { term: "Bata quirúrgica", language: "es" },
  ],
});
const cameraCover = knownProfile({
  canonicalName: "Camera Cover",
  slug: "camera-covers",
  aliases: ["Sterile Camera Sleeve", "Camera Drape"],
  localizedAliases: [
    { term: "Copri telecamera", language: "it" },
    { term: "Housse caméra", language: "fr" },
    { term: "Kameraabdeckung", language: "de" },
  ],
});
const arterialVenous = buildTemporaryProductFamilyProfile({
  phrase: "arterial venous set",
  intentHash: "a".repeat(64),
});
const productionGloveTemporaryIntent = buildTemporaryProductFamilyProfile({
  phrase: "glove",
  intentHash: "b".repeat(64),
  smartResolution: {
    resolvedConcept: "Latex or nitrile examination glove for clinical use",
    productFamily: "Medical Examination Gloves",
    commercialTermsEn: [
      "Latex or nitrile examination glove for clinical use",
    ],
  },
});

Deno.test("A/B/L/M: known and unmapped products receive deterministic adaptive profiles", () => {
  assertEquals(classifyProductMarketProfile(syringe), "BROAD");
  assertEquals(classifyProductMarketProfile(gown), "STANDARD");
  assertEquals(classifyProductMarketProfile(cameraCover), "NICHE");
  assertEquals(classifyProductMarketProfile(arterialVenous), "NICHE");
  assertEquals(
    adaptiveDiscoveryBudget("BROAD", "NORMAL_DISCOVERY")
      .maximumPublicWebQueries,
    8,
  );
  assertEquals(
    adaptiveDiscoveryBudget("BROAD", "ADMIN_QA_FRESH").maximumPublicWebQueries,
    10,
  );
  assertEquals(
    adaptiveDiscoveryBudget("NICHE", "NORMAL_DISCOVERY")
      .maximumPublicWebQueries,
    4,
  );
  assertEquals(
    adaptiveDiscoveryBudget("NICHE", "ADMIN_QA_FRESH").maximumPublicWebQueries,
    6,
  );
});

Deno.test("D/E/K: Fresh Discovery selects unused terminology, language, market and archetype partitions", () => {
  const initial = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: syringe,
    targetCountries: [],
    cpvCodes: ["33141310"],
  });
  const history1 = initial.selectedPartitions.map((partition) => ({
    partitionKey: partition.partitionKey,
    lastExploredAt: "2026-08-25T00:00:00.000Z",
    executions: 1,
    newBuyerYield: 2,
  }));
  const fresh1 = buildDiscoverySearchPlan({
    runMode: "ADMIN_QA_FRESH",
    productFamily: syringe,
    targetCountries: [],
    cpvCodes: ["33141310"],
    history: history1,
    now: new Date("2026-08-25T12:00:00.000Z"),
  });
  const initialKeys = new Set(
    initial.selectedPartitions.map((item) => item.partitionKey),
  );
  assert(fresh1.selectedPartitions.length > 0);
  assert(
    fresh1.selectedPartitions.every((item) =>
      !initialKeys.has(item.partitionKey)
    ),
  );
  assert(fresh1.publicWebQueries.some((item) => item.language !== "en"));
  assert(
    new Set(fresh1.selectedPartitions.map((item) => item.marketRegion)).size >
      1,
  );
  assert(
    new Set(fresh1.selectedPartitions.map((item) => item.buyerArchetype)).size >
      1,
  );

  const history2 = [
    ...history1,
    ...fresh1.selectedPartitions.map((partition) => ({
      partitionKey: partition.partitionKey,
      lastExploredAt: "2026-08-25T12:00:00.000Z",
      executions: 1,
      newBuyerYield: 1,
    })),
  ];
  const fresh2 = buildDiscoverySearchPlan({
    runMode: "ADMIN_QA_FRESH",
    productFamily: syringe,
    targetCountries: [],
    cpvCodes: ["33141310"],
    history: history2,
    now: new Date("2026-08-25T13:00:00.000Z"),
  });
  const previousKeys = new Set(history2.map((item) => item.partitionKey));
  assert(
    fresh2.selectedPartitions.every((item) =>
      !previousKeys.has(item.partitionKey)
    ),
  );
});

Deno.test("H/I/N/O: request plans are bounded, deterministic and retry-stable", () => {
  const input = {
    runMode: "ADMIN_QA_FRESH" as const,
    productFamily: syringe,
    targetCountries: [] as string[],
    cpvCodes: ["33141310"],
  };
  const left = buildDiscoverySearchPlan(input);
  const right = buildDiscoverySearchPlan(input);
  assertEquals(
    left.selectedPartitions.map((item) => item.partitionKey),
    right.selectedPartitions.map((item) => item.partitionKey),
  );
  assert(left.publicWebQueries.length <= 10);
  assert(left.tedPartitions.length <= 4);
  assert(left.budget.maximumPublicWebCostUsd <= 0.05);
  assertEquals(left.budget.approximateWorstCaseProviderCostUsd, 0.05);
  const semanticQueries = left.publicWebQueries.map((item) =>
    item.query.toLowerCase().replace(/\bsyringes\b/g, "syringe")
  );
  assertEquals(new Set(semanticQueries).size, semanticQueries.length);
});

Deno.test("F/G/J: seen-company states distinguish new, materially updated and unchanged evidence", () => {
  assertEquals(
    classifyDiscoveryResultState({
      currentEvidenceFingerprint: "1".repeat(64),
    }),
    "NEW",
  );
  assertEquals(
    classifyDiscoveryResultState({
      priorEvidenceFingerprint: "1".repeat(64),
      currentEvidenceFingerprint: "2".repeat(64),
    }),
    "UPDATED",
  );
  assertEquals(
    classifyDiscoveryResultState({
      priorEvidenceFingerprint: "1".repeat(64),
      currentEvidenceFingerprint: "1".repeat(64),
    }),
    "PREVIOUSLY_DISCOVERED",
  );
  assertEquals(
    orderDiscoveryStates([
      { id: 1, discoveryState: "PREVIOUSLY_DISCOVERED" as const },
      { id: 2, discoveryState: "NEW" as const },
      { id: 3, discoveryState: "UPDATED" as const },
    ]).map((item) => item.id),
    [2, 3, 1],
  );
  assert(
    freshDiscoveryMessage({
      newBuyers: 0,
      updatedBuyers: 0,
      previousBuyers: 18,
      cumulativeBuyers: 18,
    }).startsWith("No additional verified buyers"),
  );
});

Deno.test("P/Z/AA/AB: profile expansion changes retrieval only and preserves canonical product families", () => {
  assertEquals(cameraCover.key, "camera-cover-family");
  assert(cameraCover.directTerms.includes("sterile camera sleeve"));
  assertEquals(gown.key, "surgical-gown-family");
  assert(arterialVenous.temporaryIntent?.retrievalTerms.length);
  const camera = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: cameraCover,
    targetCountries: [],
    cpvCodes: ["33140000"],
  });
  assert(camera.publicWebQueries.some((item) => item.language !== "en"));
  assert(camera.selectedPartitions.every((item) => item.priority >= 0));
  assertNotEquals(camera.productProfile, "BROAD");
});

Deno.test("temporary Smart Resolver intent produces finite persistence priorities", () => {
  assertEquals(productionGloveTemporaryIntent.procedurePack, undefined);
  const plan = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: productionGloveTemporaryIntent,
    targetCountries: [],
    cpvCodes: [],
  });
  assertEquals(plan.productProfile, "STANDARD");
  assertEquals(plan.publicWebQueries.length, 6);
  assertEquals(plan.tedPartitions.length, 4);
  assertEquals(plan.selectedPartitions.length, 10);
  assert(
    plan.selectedPartitions.every((partition) =>
      Number.isFinite(partition.priority) &&
      Number.isInteger(partition.priority) &&
      partition.priority >= 0 && partition.priority <= 200
    ),
  );

  const rows = buildPartitionPersistenceRows(
    "11111111-1111-4111-8111-111111111111",
    plan.selectedPartitions,
  );
  assertEquals(rows.length, 10);
  assert(
    rows.every((row) => Number.isFinite(row.priority)),
    "persistence payload priorities must remain finite",
  );
  assert.doesNotMatch(JSON.stringify(rows), /"priority":null/);
});

Deno.test("invalid partition priorities fail before persistence", () => {
  const plan = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: cameraCover,
    targetCountries: [],
    cpvCodes: ["33140000"],
  });
  for (const priority of [Number.NaN, Infinity, null, -1, 201, 1.5]) {
    const invalid = [{
      ...plan.selectedPartitions[0],
      priority: priority as number,
    }];
    assert.throws(
      () => assertValidPartitionPriorities(invalid),
      /DISCOVERY_PARTITION_PRIORITY_INVALID/,
    );
    assert.throws(
      () => buildPartitionPersistenceRows("search-space", invalid),
      /DISCOVERY_PARTITION_PRIORITY_INVALID/,
    );
  }
});

Deno.test("Camera Cover and UNMAPPED product planner priorities remain finite", () => {
  assertEquals(cameraCover.procedurePack, false);
  const camera = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: cameraCover,
    targetCountries: [],
    cpvCodes: ["33140000"],
  });
  assertEquals(camera.publicWebQueries.length, 4);
  assertEquals(camera.tedPartitions.length, 4);
  assert(
    camera.selectedPartitions.every((item) => Number.isFinite(item.priority)),
  );

  assertEquals(arterialVenous.procedurePack, undefined);
  const unmapped = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: arterialVenous,
    targetCountries: [],
    cpvCodes: [],
  });
  assert(unmapped.selectedPartitions.length > 0);
  assert(
    unmapped.selectedPartitions.every((item) => Number.isFinite(item.priority)),
  );
});

Deno.test("search saturation is reported without claiming market exhaustion", () => {
  const plan = buildDiscoverySearchPlan({
    runMode: "ADMIN_QA_FRESH",
    productFamily: gown,
    targetCountries: [],
    cpvCodes: ["33140000"],
    recentFreshYields: [4, 0, 0],
  });
  assertEquals(plan.saturation, "ZERO_RECENT_YIELD");
  assertEquals(discoverySaturation([4, 0]), "NONE");
  assertEquals(discoverySaturation([4, 0, 0]), "ZERO_RECENT_YIELD");
  assertEquals(discoverySaturation([8, 4, 2]), "DECLINING_YIELD");
});

Deno.test("General Procedure Packs initial plan spans reviewed terms and commercial archetypes", () => {
  const profile = buildProductFamilyProfile([{
    canonicalName: "General Procedure Packs",
    slug: "general-procedure-packs",
    aliases: [],
  }]);
  const plan = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: [],
    cpvCodes: ["33140000"],
  });
  assertEquals(profile.procedurePack, true);
  assert(
    plan.selectedPartitions.every((item) => Number.isFinite(item.priority)),
  );
  const terms = new Set(
    plan.selectedPartitions.flatMap((item) => item.terminology),
  );
  const archetypes = new Set(
    plan.selectedPartitions.map((item) => item.buyerArchetype),
  );
  assert(
    terms.size > 1 &&
      [...terms].some((term) => term !== "General Procedure Packs"),
    "initial retrieval must not depend only on the canonical plural phrase",
  );
  assert(
    archetypes.has("PROCEDURE_PACK_MANUFACTURER") &&
      archetypes.has("KIT_ASSEMBLER") &&
      archetypes.has("HOSPITAL_SUPPLIER"),
    "procedure-pack commercial archetypes must be represented",
  );
});

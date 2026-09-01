import assert from "node:assert/strict";
import {
  ADAPTIVE_MEDICAL_RETRIEVAL_LIMITS,
  type AdaptiveMedicalRetrievalIntelligence,
  validateAdaptiveRetrievalIntelligence,
} from "./adaptive-medical-commercial-retrieval.ts";
import {
  buildAdaptiveSearchUniverse,
  buildDiscoverySearchPlan,
  type SearchPartitionHistory,
} from "./buyer-discovery-search-space.ts";
import { buildTemporaryProductFamilyProfile } from "./unknown-product-resolution.ts";

function intelligence(input: {
  canonical: string;
  family: string;
  commercial: string[];
  clinical: string[];
  procurement: string[];
  channels: string[];
  adjacent?: string[];
  negative?: string[];
  localized?: Array<{ term: string; language: string }>;
}): AdaptiveMedicalRetrievalIntelligence {
  return validateAdaptiveRetrievalIntelligence({
    canonical_product: input.canonical,
    product_family: input.family,
    commercial_synonyms: input.commercial,
    clinical_contexts: input.clinical,
    procurement_terms: input.procurement,
    channel_archetypes: input.channels,
    adjacent_commercial_terms: input.adjacent || [],
    negative_contexts: input.negative || [],
    localized_terms: input.localized || [],
    search_confidence: "HIGH",
  });
}

function temporaryProfile(
  phrase: string,
  resolvedConcept: string,
  productFamily: string,
  commercialTerms: string[],
) {
  return buildTemporaryProductFamilyProfile({
    phrase,
    intentHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")
      .slice(0, 64),
    smartResolution: {
      resolvedConcept,
      productFamily,
      commercialTermsEn: commercialTerms,
    },
  });
}

const imagingInjector = intelligence({
  canonical: "contrast media injector",
  family: "diagnostic imaging injector",
  commercial: [
    "contrast injector",
    "contrast media injector",
    "imaging contrast injector",
    "contrast delivery injector",
  ],
  clinical: [
    "computed tomography contrast administration",
    "radiology contrast injection",
  ],
  procurement: ["contrast injection system", "radiology contrast injector"],
  channels: [
    "radiology equipment distributor",
    "diagnostic imaging importer",
    "hospital tender supplier",
  ],
  adjacent: ["radiology contrast delivery equipment"],
  negative: ["fuel injector", "industrial chemical injector"],
  localized: [
    { term: "injecteur de produit de contraste", language: "fr" },
    { term: "Kontrastmittelinjektor", language: "de" },
  ],
});

Deno.test("CT injector benchmark creates richer bounded commercial-channel partitions without runtime fixture rules", () => {
  const profile = temporaryProfile(
    "CT injector",
    "contrast media injector",
    "diagnostic imaging injector",
    ["contrast injector"],
  );
  const legacy = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: [],
  });
  const adaptive = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: [],
    adaptiveIntelligence: imagingInjector,
  });
  assert.equal(legacy.version, "BUYER_DISCOVERY_VNEXT_1");
  assert.equal(adaptive.version, "ADAPTIVE_MEDICAL_RETRIEVAL_V1");
  assert.equal(adaptive.adaptive?.activeStage, 1);
  assert(adaptive.publicWebQueries.length > 0);
  assert(adaptive.publicWebQueries.every((query) => query.country === "GB"));
  assert(
    adaptive.publicWebQueries.some((query) =>
      /radiology|imaging/.test(query.query)
    ),
  );
  assert(
    adaptive.selectedPartitions.every((partition) =>
      partition.adaptiveStage === 1
    ),
  );
  assert(
    adaptive.publicWebQueries.every((query) =>
      query.query.includes('-"fuel injector"')
    ),
  );
  assert(
    adaptive.selectedPartitions.length <=
      ADAPTIVE_MEDICAL_RETRIEVAL_LIMITS.maximumGeneratedPartitions,
  );
  assert(
    adaptive.publicWebQueries.length <= adaptive.budget.maximumPublicWebQueries,
  );
  assert(adaptive.tedPartitions.length <= adaptive.budget.maximumTedRequests);
});

Deno.test("adaptive universe is capped at 48 total and 12 per stage with strict priority", () => {
  const profile = temporaryProfile(
    "CT injector",
    "contrast media injector",
    "diagnostic imaging injector",
    ["contrast injector"],
  );
  const universe = buildAdaptiveSearchUniverse({
    productFamily: profile,
    targetCountries: [],
    cpvCodes: ["33115000"],
    adaptiveIntelligence: imagingInjector,
  });
  assert(universe.length <= 48);
  for (const stage of [1, 2, 3, 4] as const) {
    assert(
      universe.filter((partition) => partition.adaptiveStage === stage)
        .length <= 12,
    );
  }
  const exact = universe.filter((partition) =>
    partition.adaptiveQueryType === "EXACT_PRODUCT"
  );
  const adjacent = universe.filter((partition) =>
    partition.adaptiveQueryType === "ADJACENT_COMMERCIAL"
  );
  assert(exact.length > 0 && adjacent.length > 0);
  assert(
    Math.min(...exact.map((item) => item.priority)) >
      Math.max(...adjacent.map((item) => item.priority)),
  );
});

Deno.test("zero-result history escalates one stage at a time and direct yield stops Fresh expansion", () => {
  const profile = temporaryProfile(
    "CT injector",
    "contrast media injector",
    "diagnostic imaging injector",
    ["contrast injector"],
  );
  const stage1 = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: ["33115000"],
    adaptiveIntelligence: imagingInjector,
  });
  const stage1History: SearchPartitionHistory[] = stage1.selectedPartitions.map(
    (partition) => ({
      partitionKey: partition.partitionKey,
      lastExploredAt: "2026-08-31T08:00:00.000Z",
      executions: 1,
      newBuyerYield: 0,
      directVerifiedYield: 0,
    }),
  );
  const stage2 = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: ["33115000"],
    adaptiveIntelligence: imagingInjector,
    history: stage1History,
  });
  assert.equal(stage2.adaptive?.activeStage, 2);
  assert.equal(stage2.adaptive?.stageStopReason, "ZERO_RESULT_ESCALATION");
  assert(
    stage2.selectedPartitions.every((partition) =>
      partition.adaptiveStage === 2
    ),
  );

  const stage2History = stage2.selectedPartitions.map((partition) => ({
    partitionKey: partition.partitionKey,
    lastExploredAt: "2026-08-31T09:00:00.000Z",
    executions: 1,
    newBuyerYield: 0,
    directVerifiedYield: 0,
  }));
  const stage3 = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: ["33115000"],
    adaptiveIntelligence: imagingInjector,
    history: [...stage1History, ...stage2History],
  });
  assert.equal(stage3.adaptive?.activeStage, 3);
  assert(
    stage3.selectedPartitions.some((partition) =>
      partition.providerKind === "TED"
    ),
  );
  assert(
    stage3.selectedPartitions.some((partition) =>
      partition.adaptiveQueryType === "PROCUREMENT_PRODUCT"
    ),
  );

  const productive = stage1History.map((item, index) => ({
    ...item,
    directVerifiedYield: index < 3 ? 1 : 0,
  }));
  const stoppedFresh = buildDiscoverySearchPlan({
    runMode: "ADMIN_QA_FRESH",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: [],
    adaptiveIntelligence: imagingInjector,
    history: productive,
  });
  assert.equal(
    stoppedFresh.adaptive?.stageStopReason,
    "SUFFICIENT_DIRECT_HISTORY",
  );
  assert.equal(stoppedFresh.selectedPartitions.length, 0);
});

const generalizationFixtures = [
  intelligence({
    canonical: "surgical stapler",
    family: "surgical stapling device",
    commercial: ["surgical stapler", "endoscopic surgical stapler"],
    clinical: ["minimally invasive surgery stapling"],
    procurement: ["surgical stapling system"],
    channels: ["surgical instrument distributor", "laparoscopy importer"],
  }),
  intelligence({
    canonical: "biopsy needle",
    family: "diagnostic biopsy needle",
    commercial: ["biopsy needle", "core biopsy needle"],
    clinical: ["tissue sampling biopsy"],
    procurement: ["biopsy needle procurement"],
    channels: ["diagnostic consumables distributor", "medical device importer"],
  }),
  intelligence({
    canonical: "laparoscopy trocar",
    family: "laparoscopic access trocar",
    commercial: ["laparoscopy trocar", "laparoscopic trocar"],
    clinical: ["minimally invasive access"],
    procurement: ["laparoscopic access device"],
    channels: ["laparoscopy distributor", "surgical device importer"],
  }),
  intelligence({
    canonical: "patient warming blanket",
    family: "perioperative patient warming blanket",
    commercial: ["patient warming blanket", "perioperative warming blanket"],
    clinical: ["perioperative temperature management"],
    procurement: ["patient warming blanket procurement"],
    channels: ["operating room supplier", "medical consumables distributor"],
  }),
  intelligence({
    canonical: "general procedure pack",
    family: "sterile medical procedure pack",
    commercial: ["general procedure pack", "sterile procedure pack"],
    clinical: ["clinical procedure preparation"],
    procurement: ["sterile procedure pack procurement"],
    channels: ["procedure pack assembler", "hospital tender supplier"],
  }),
  intelligence({
    canonical: "nebulizer chamber",
    family: "respiratory nebulizer chamber",
    commercial: ["nebulizer chamber", "respiratory nebulizer chamber"],
    clinical: ["aerosol respiratory therapy"],
    procurement: ["nebulizer therapy chamber"],
    channels: ["respiratory equipment distributor", "medical device importer"],
  }),
];

Deno.test("stapler, biopsy, trocar, warming blanket, procedure pack and blind product generalize", () => {
  for (const fixture of generalizationFixtures) {
    const profile = temporaryProfile(
      fixture.canonical_product,
      fixture.canonical_product,
      fixture.product_family,
      fixture.commercial_synonyms,
    );
    const plan = buildDiscoverySearchPlan({
      runMode: "NORMAL_DISCOVERY",
      productFamily: profile,
      targetCountries: ["DE"],
      cpvCodes: [],
      adaptiveIntelligence: fixture,
    });
    assert.equal(plan.version, "ADAPTIVE_MEDICAL_RETRIEVAL_V1");
    assert(plan.publicWebQueries.length > 0);
    assert(plan.publicWebQueries.every((query) => query.country === "DE"));
    assert(
      plan.publicWebQueries.some((query) =>
        /distribut|import|supplier|assembler/.test(query.query)
      ),
    );
  }
});

Deno.test("multilingual terms are market-bound and adaptive identity prevents stale partition reuse", () => {
  const profile = temporaryProfile(
    "CT injector",
    "contrast media injector",
    "diagnostic imaging injector",
    ["contrast injector"],
  );
  const france = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["FR"],
    cpvCodes: [],
    adaptiveIntelligence: imagingInjector,
  });
  assert(france.publicWebQueries.some((query) => query.language === "fr"));
  assert(france.publicWebQueries.every((query) => query.country === "FR"));
  assert(
    france.selectedPartitions.every((partition) =>
      partition.partitionKey.includes("adaptive") &&
      partition.partitionKey.includes("1")
    ),
  );
});

Deno.test("feature-off path preserves legacy planner contract for known and temporary intents", () => {
  for (
    const profile of [
      temporaryProfile(
        "Camera Cover",
        "Camera Cover",
        "sterile equipment cover",
        ["sterile camera sleeve"],
      ),
      temporaryProfile(
        "General Procedure Pack",
        "General Procedure Pack",
        "procedure pack",
        ["general procedure pack"],
      ),
      temporaryProfile("glove", "medical examination glove", "medical gloves", [
        "examination glove",
      ]),
      temporaryProfile(
        "abdominal mesh",
        "abdominal surgical mesh",
        "surgical mesh",
        ["abdominal mesh"],
      ),
    ]
  ) {
    const first = buildDiscoverySearchPlan({
      runMode: "NORMAL_DISCOVERY",
      productFamily: profile,
      targetCountries: ["GB"],
      cpvCodes: [],
    });
    const second = buildDiscoverySearchPlan({
      runMode: "NORMAL_DISCOVERY",
      productFamily: profile,
      targetCountries: ["GB"],
      cpvCodes: [],
      adaptiveIntelligence: null,
    });
    assert.equal(first.version, "BUYER_DISCOVERY_VNEXT_1");
    assert.deepEqual(
      first.selectedPartitions.map((partition) => partition.partitionKey),
      second.selectedPartitions.map((partition) => partition.partitionKey),
    );
  }
});

Deno.test("production retrieval sources contain no CT-injector fixture vocabulary", async () => {
  const sourcePaths = [
    new URL("./adaptive-medical-commercial-retrieval.ts", import.meta.url),
    new URL("./buyer-discovery-search-space.ts", import.meta.url),
  ];
  for (const path of sourcePaths) {
    const source = await Deno.readTextFile(path);
    assert.doesNotMatch(
      source,
      /CT injector|contrast media injector|radiology equipment distributor/i,
    );
  }
});

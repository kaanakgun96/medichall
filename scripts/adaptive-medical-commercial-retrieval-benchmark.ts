import {
  type AdaptiveMedicalRetrievalIntelligence,
  validateAdaptiveRetrievalIntelligence,
} from "../supabase/functions/_shared/adaptive-medical-commercial-retrieval.ts";
import {
  buildDiscoverySearchPlan,
  type SearchPartitionHistory,
} from "../supabase/functions/_shared/buyer-discovery-search-space.ts";
import { buildTemporaryProductFamilyProfile } from "../supabase/functions/_shared/unknown-product-resolution.ts";

type Fixture = {
  input: string;
  canonical: string;
  family: string;
  commercial: string[];
  clinical: string[];
  procurement: string[];
  channels: string[];
  adjacent: string[];
  negative: string[];
};

const fixtures: Fixture[] = [
  {
    input: "CT injector",
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
  },
  {
    input: "surgical stapler",
    canonical: "surgical stapler",
    family: "surgical stapling device",
    commercial: ["surgical stapler", "endoscopic surgical stapler"],
    clinical: ["minimally invasive surgery stapling"],
    procurement: ["surgical stapling system"],
    channels: ["surgical instrument distributor", "laparoscopy importer"],
    adjacent: ["minimally invasive surgical device"],
    negative: ["office stapler"],
  },
  {
    input: "biopsy needle",
    canonical: "biopsy needle",
    family: "diagnostic biopsy needle",
    commercial: ["biopsy needle", "core biopsy needle"],
    clinical: ["tissue sampling biopsy"],
    procurement: ["biopsy needle procurement"],
    channels: ["diagnostic consumables distributor", "medical device importer"],
    adjacent: ["tissue sampling device"],
    negative: ["sewing needle"],
  },
  {
    input: "trocar",
    canonical: "laparoscopy trocar",
    family: "laparoscopic access trocar",
    commercial: ["laparoscopy trocar", "laparoscopic trocar"],
    clinical: ["minimally invasive access"],
    procurement: ["laparoscopic access device"],
    channels: ["laparoscopy distributor", "surgical device importer"],
    adjacent: ["laparoscopic access system"],
    negative: ["veterinary trocar"],
  },
  {
    input: "nebulizer chamber",
    canonical: "nebulizer chamber",
    family: "respiratory nebulizer chamber",
    commercial: ["nebulizer chamber", "respiratory nebulizer chamber"],
    clinical: ["aerosol respiratory therapy"],
    procurement: ["nebulizer therapy chamber"],
    channels: ["respiratory equipment distributor", "medical device importer"],
    adjacent: ["respiratory aerosol delivery accessory"],
    negative: ["industrial spray chamber"],
  },
];

function structured(fixture: Fixture): AdaptiveMedicalRetrievalIntelligence {
  return validateAdaptiveRetrievalIntelligence({
    canonical_product: fixture.canonical,
    product_family: fixture.family,
    commercial_synonyms: fixture.commercial,
    clinical_contexts: fixture.clinical,
    procurement_terms: fixture.procurement,
    channel_archetypes: fixture.channels,
    adjacent_commercial_terms: fixture.adjacent,
    negative_contexts: fixture.negative,
    localized_terms: [],
    search_confidence: "HIGH",
  });
}

function zeroHistory(plan: ReturnType<typeof buildDiscoverySearchPlan>) {
  return plan.selectedPartitions.map((partition): SearchPartitionHistory => ({
    partitionKey: partition.partitionKey,
    lastExploredAt: "2026-09-01T00:00:00.000Z",
    executions: 1,
    newBuyerYield: 0,
    directVerifiedYield: 0,
  }));
}

const report = fixtures.map((fixture) => {
  const profile = buildTemporaryProductFamilyProfile({
    phrase: fixture.input,
    intentHash: "a".repeat(64),
    smartResolution: {
      resolvedConcept: fixture.canonical,
      productFamily: fixture.family,
      commercialTermsEn: fixture.commercial.slice(0, 1),
    },
  });
  const intelligence = structured(fixture);
  const legacy = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: profile,
    targetCountries: ["GB"],
    cpvCodes: [],
  });
  const stages = [];
  let history: SearchPartitionHistory[] = [];
  for (let expected = 1; expected <= 4; expected += 1) {
    const plan = buildDiscoverySearchPlan({
      runMode: "NORMAL_DISCOVERY",
      productFamily: profile,
      targetCountries: ["GB"],
      cpvCodes: [],
      adaptiveIntelligence: intelligence,
      history,
    });
    stages.push({
      stage: plan.adaptive?.activeStage,
      publicWeb: plan.publicWebQueries.length,
      ted: plan.tedPartitions.length,
      partitionTypes: [
        ...new Set(
          plan.selectedPartitions.map((item) => item.adaptiveQueryType),
        ),
      ],
    });
    history = [...history, ...zeroHistory(plan)];
  }
  return {
    product: fixture.input,
    providerBacked: false,
    legacy: {
      publicWeb: legacy.publicWebQueries.length,
      ted: legacy.tedPartitions.length,
      terms: [
        ...new Set(
          legacy.selectedPartitions.flatMap((item) => item.terminology),
        ),
      ],
    },
    adaptive: {
      canonical: fixture.canonical,
      family: fixture.family,
      commercial: fixture.commercial,
      clinical: fixture.clinical,
      procurement: fixture.procurement,
      channels: fixture.channels,
      negative: fixture.negative,
      stages,
    },
  };
});

console.log(JSON.stringify(
  {
    kind: "OFFLINE_PLANNER_BENCHMARK",
    publicWebRequestCeiling: 10,
    tedRequestCeiling: 6,
    retrievalIntelligenceCostCeilingUsd: 0.005,
    fixtures: report,
  },
  null,
  2,
));

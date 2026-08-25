import {
  buildDiscoverySearchPlan,
  type DiscoverySearchPlan,
} from "../supabase/functions/_shared/buyer-discovery-search-space.ts";
import {
  buildProductFamilyProfile,
  type ProductFamilyProfile,
} from "../supabase/functions/_shared/buyer-discovery-relevance-v2.ts";
import { buildTemporaryProductFamilyProfile } from "../supabase/functions/_shared/unknown-product-resolution.ts";

const products: Array<{
  name: string;
  profile: ProductFamilyProfile;
  cpv: string[];
}> = [
  {
    name: "Syringe",
    profile: buildProductFamilyProfile([{
      canonicalName: "Syringe",
      slug: "syringes",
      aliases: ["Sterile syringe", "Disposable syringe", "Hypodermic syringe"],
      localizedAliases: [
        { term: "Siringa sterile", language: "it" },
        { term: "Seringue stérile", language: "fr" },
        { term: "Sterile Spritze", language: "de" },
        { term: "Jeringa estéril", language: "es" },
      ],
    }]),
    cpv: ["33141310"],
  },
  {
    name: "Sterile Surgical Gown",
    profile: buildProductFamilyProfile([{
      canonicalName: "Sterile Surgical Gown",
      slug: "sterile-surgical-gowns",
      aliases: ["Surgical gown", "Sterile gown"],
      localizedAliases: [
        { term: "Camice chirurgico", language: "it" },
        { term: "Bata quirúrgica", language: "es" },
      ],
    }]),
    cpv: ["33140000"],
  },
  {
    name: "Camera Cover",
    profile: buildProductFamilyProfile([{
      canonicalName: "Camera Cover",
      slug: "camera-covers",
      aliases: ["Sterile Camera Sleeve", "Camera Drape"],
      localizedAliases: [
        { term: "Copri telecamera", language: "it" },
        { term: "Housse caméra", language: "fr" },
        { term: "Kameraabdeckung", language: "de" },
      ],
    }]),
    cpv: ["33140000"],
  },
  {
    name: "Arterial Venous Set",
    profile: buildTemporaryProductFamilyProfile({
      phrase: "arterial venous set",
      intentHash: "a".repeat(64),
    }),
    cpv: [],
  },
];

function summary(plan: DiscoverySearchPlan) {
  return {
    product_profile: plan.productProfile,
    public_web_queries: plan.publicWebQueries.length,
    ted_partitions: plan.tedPartitions.length,
    maximum_brave_cost_usd: plan.budget.maximumPublicWebCostUsd,
    languages: [
      ...new Set(plan.selectedPartitions.map((item) => item.language)),
    ],
    regions: [
      ...new Set(plan.selectedPartitions.map((item) => item.marketRegion)),
    ],
    archetypes: [
      ...new Set(plan.selectedPartitions.map((item) => item.buyerArchetype)),
    ],
    partition_keys: plan.selectedPartitions.map((item) => item.partitionKey),
    unused_partitions_remaining: plan.unusedPartitionsRemaining,
  };
}

const output = products.map((product) => {
  const initial = buildDiscoverySearchPlan({
    runMode: "NORMAL_DISCOVERY",
    productFamily: product.profile,
    targetCountries: [],
    cpvCodes: product.cpv,
  });
  const history1 = initial.selectedPartitions.map((partition) => ({
    partitionKey: partition.partitionKey,
    lastExploredAt: "2026-08-25T08:00:00.000Z",
    executions: 1,
    newBuyerYield: 1,
  }));
  const fresh1 = buildDiscoverySearchPlan({
    runMode: "ADMIN_QA_FRESH",
    productFamily: product.profile,
    targetCountries: [],
    cpvCodes: product.cpv,
    history: history1,
    now: new Date("2026-08-25T09:00:00.000Z"),
  });
  const history2 = [
    ...history1,
    ...fresh1.selectedPartitions.map((partition) => ({
      partitionKey: partition.partitionKey,
      lastExploredAt: "2026-08-25T09:00:00.000Z",
      executions: 1,
      newBuyerYield: 1,
    })),
  ];
  const fresh2 = buildDiscoverySearchPlan({
    runMode: "ADMIN_QA_FRESH",
    productFamily: product.profile,
    targetCountries: [],
    cpvCodes: product.cpv,
    history: history2,
    now: new Date("2026-08-25T10:00:00.000Z"),
  });
  return {
    product: product.name,
    initial: summary(initial),
    fresh_1: summary(fresh1),
    fresh_2: summary(fresh2),
    provider_execution: "NOT_RUN_LOCAL_PLANNER_BENCHMARK",
    raw_candidates: null,
    verified_unique_buyers: null,
  };
});

console.log(JSON.stringify(output, null, 2));

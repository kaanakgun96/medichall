import type { DiscoverySearchPlan } from "./buyer-discovery-search-space.ts";

// The DB checks PostgreSQL jsonb::text (not compact JSON.stringify) <= 32768.
// V2 emits only fixed fields, bounded counters and small sanitized samples.
// Full execution state remains in memory and buyer_discovery_{run_,}partitions.
export const PARTITION_SUMMARY_LIMITS = Object.freeze({
  partitionSamples: 6,
  partitionKeyCharacters: 256,
  categorySamples: 12,
  categoryCharacters: 48,
  waves: 3,
});
const prohibited =
  /email|phone|whatsapp|contact_name|linkedin_url|provider_api_key/i;
const count = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(1_000_000, Math.max(0, Math.trunc(value)))
    : 0;
const decimal = (value: number): number =>
  Number.isFinite(value)
    ? Math.round(Math.min(1_000_000, Math.max(0, value)) * 1e6) / 1e6
    : 0;

function samples(
  values: string[],
  maximum: number,
  characters: number,
): string[] {
  return [...new Set(values)].filter((value) =>
    typeof value === "string" && value.length > 0 &&
    value.length <= characters &&
    /^[a-z0-9_|+.-]+$/i.test(value) && !prohibited.test(value)
  ).slice(0, maximum);
}

/** A telemetry projection only: never mutate a plan or change execution limits. */
export function buildDiscoveryPartitionSummary(plan: DiscoverySearchPlan) {
  const keys = plan.selectedPartitions.map((item) => item.partitionKey);
  const languages = [
    ...new Set(plan.selectedPartitions.map((item) => item.language)),
  ];
  const regions = [
    ...new Set(plan.selectedPartitions.map((item) => item.marketRegion)),
  ];
  const archetypes = [
    ...new Set(plan.selectedPartitions.map((item) => item.buyerArchetype)),
  ];
  if (!plan.highRecall) {
    // Preserve the exact existing flag-off contract, including optional adaptive data.
    return {
      version: plan.version,
      run_mode: plan.runMode,
      selected_partition_keys: keys,
      languages,
      regions,
      buyer_archetypes: archetypes,
      unused_partitions_remaining: plan.unusedPartitionsRemaining,
      stale_partitions_revisited: plan.stalePartitionsRevisited,
      saturation: plan.saturation,
      provider_budget: plan.budget,
      universal_high_recall: null,
      adaptive: plan.adaptive || null,
    };
  }
  const high = plan.highRecall;
  const policy = high.policy;
  const budget = plan.budget;
  const adaptive = plan.adaptive;
  const keySamples = samples(
    keys,
    PARTITION_SUMMARY_LIMITS.partitionSamples,
    PARTITION_SUMMARY_LIMITS.partitionKeyCharacters,
  );
  const categories = (values: string[]) =>
    samples(
      values,
      PARTITION_SUMMARY_LIMITS.categorySamples,
      PARTITION_SUMMARY_LIMITS.categoryCharacters,
    );
  return {
    version: "UNIVERSAL_HIGH_RECALL_V2",
    summary_version: "COMPACT_V1",
    run_mode:
      ["NORMAL_DISCOVERY", "FRESH_DISCOVERY", "ADMIN_QA_FRESH"].includes(
          plan.runMode,
        )
        ? plan.runMode
        : "NORMAL_DISCOVERY",
    product_profile:
      ["BROAD", "STANDARD", "NICHE"].includes(plan.productProfile)
        ? plan.productProfile
        : "NICHE",
    selected_partition_keys: keySamples,
    selected_partition_count: count(keys.length),
    selected_partition_keys_omitted: count(keys.length - keySamples.length),
    languages: categories(languages),
    language_count: count(languages.length),
    regions: categories(regions),
    region_count: count(regions.length),
    buyer_archetypes: categories(archetypes),
    archetype_count: count(archetypes.length),
    country_count: count(
      new Set(plan.selectedPartitions.flatMap((p) => p.countryCodes)).size,
    ),
    unused_partitions_remaining: count(plan.unusedPartitionsRemaining),
    stale_partitions_revisited: count(plan.stalePartitionsRevisited),
    saturation:
      ["NONE", "DECLINING_YIELD", "ZERO_RECENT_YIELD"].includes(plan.saturation)
        ? plan.saturation
        : "NONE",
    provider_budget: {
      maximumPublicWebQueries: count(budget.maximumPublicWebQueries),
      maximumPublicWebCostUsd: decimal(budget.maximumPublicWebCostUsd),
      maximumTedRequests: count(budget.maximumTedRequests),
      maximumWebsiteVerificationRequests: count(
        budget.maximumWebsiteVerificationRequests,
      ),
      maximumRawPublicWebObservations: count(
        budget.maximumRawPublicWebObservations,
      ),
      maximumCandidatePool: count(budget.maximumCandidatePool),
      maximumDisplayedBuyers: count(budget.maximumDisplayedBuyers),
      approximateWorstCaseProviderCostUsd: decimal(
        budget.approximateWorstCaseProviderCostUsd,
      ),
    },
    universal_high_recall: {
      version: "UNIVERSAL_HIGH_RECALL_WAVE_PLAN_V2",
      wave_count: count(high.waves.length),
      selectedPartitionCount: count(high.selectedPartitionCount),
      unusedPartitionCount: count(high.unusedPartitionCount),
      planned_web_queries: count(plan.publicWebQueries.length),
      planned_ted_partitions: count(plan.tedPartitions.length),
      terminology_count: count(
        new Set(plan.selectedPartitions.flatMap((p) => p.terminology)).size,
      ),
      policy: {
        europeWide: policy.europeWide === true,
        targetDisplayableProspects: count(policy.targetDisplayableProspects),
        targetRawCandidates: count(policy.targetRawCandidates),
        targetWebCandidateDomains: count(policy.targetWebCandidateDomains),
        recommendedPublicWebCeiling: count(policy.recommendedPublicWebCeiling),
        hardTedCeiling: count(policy.hardTedCeiling),
        shallowWebsiteDomainCeiling: count(policy.shallowWebsiteDomainCeiling),
        deepWebsiteDomainCeiling: count(policy.deepWebsiteDomainCeiling),
        coverageFloor: {
          minimumCountries: count(policy.coverageFloor.minimumCountries),
          minimumRegions: count(policy.coverageFloor.minimumRegions),
          minimumLanguages: count(policy.coverageFloor.minimumLanguages),
          minimumArchetypes: count(policy.coverageFloor.minimumArchetypes),
        },
      },
      waves: high.waves.slice(0, PARTITION_SUMMARY_LIMITS.waves).map((
        wave,
      ) => ({
        wave: count(wave.wave),
        partition_count: count(wave.selectedPartitions.length),
        web_count: count(wave.publicWebQueries.length),
        ted_count: count(wave.tedPartitions.length),
        publicWebCheckpoint: count(wave.publicWebCheckpoint),
        country_count: count(wave.plannedCoverage.countries.length),
        region_count: count(wave.plannedCoverage.regions.length),
        language_count: count(wave.plannedCoverage.languages.length),
        archetype_count: count(wave.plannedCoverage.archetypes.length),
      })),
    },
    adaptive: adaptive
      ? {
        enabled: true,
        activeStage: Math.min(4, Math.max(1, count(adaptive.activeStage))),
        stageStopReason: [
            "COLD_STAGE_1",
            "SUFFICIENT_DIRECT_HISTORY",
            "ZERO_RESULT_ESCALATION",
            "MAX_STAGE",
          ].includes(adaptive.stageStopReason)
          ? adaptive.stageStopReason
          : "COLD_STAGE_1",
        sufficientDirectProspects: count(adaptive.sufficientDirectProspects),
        generatedTermCounts: Object.fromEntries([
          "commercial_synonyms",
          "clinical_contexts",
          "procurement_terms",
          "channel_archetypes",
          "adjacent_commercial_terms",
          "localized_terms",
        ].map((key) => [key, count(adaptive.generatedTermCounts[key])])),
        negative_context_count: count(adaptive.negativeContexts.length),
      }
      : null,
  };
}

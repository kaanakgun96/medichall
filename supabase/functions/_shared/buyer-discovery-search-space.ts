import {
  type BuyerArchetype,
  type ProductFamilyProfile,
  type ProductRetrievalTerm,
  reviewedEquipmentCoverTerms,
} from "./buyer-discovery-relevance-v2.ts";
import { type PublicWebSearchQuery } from "./public-web-discovery.ts";
import {
  ADAPTIVE_MEDICAL_RETRIEVAL_LIMITS,
  type AdaptiveMedicalRetrievalIntelligence,
} from "./adaptive-medical-commercial-retrieval.ts";

export type DiscoveryRunMode =
  | "NORMAL_DISCOVERY"
  | "FRESH_DISCOVERY"
  | "ADMIN_QA_FRESH";

export type ProductMarketProfile = "BROAD" | "STANDARD" | "NICHE";
export type DiscoveryProviderKind = "PUBLIC_WEB" | "TED";
export type DiscoveryResultState =
  | "NEW"
  | "UPDATED"
  | "PREVIOUSLY_DISCOVERED";

export type SearchSpacePartition = {
  partitionKey: string;
  providerKind: DiscoveryProviderKind;
  partitionType:
    | "COMMERCIAL_WEB"
    | "TED_PRODUCT_TERMS"
    | "TED_RELATED_CPV";
  terminology: string[];
  language: string;
  countryCodes: string[];
  marketRegion: string;
  buyerArchetype: BuyerArchetype | "PUBLIC_PROCUREMENT_SUPPLIER";
  retrievalKind: "DIRECT_TERMS" | "ADJACENT_TERMS" | "RELATED_CPV";
  priority: number;
  adaptiveStage?: 1 | 2 | 3 | 4;
  adaptiveQueryType?:
    | "EXACT_PRODUCT"
    | "COMMERCIAL_SYNONYM"
    | "PRODUCT_FAMILY"
    | "CLINICAL_CONTEXT"
    | "CHANNEL_PRODUCT"
    | "PROCUREMENT_PRODUCT"
    | "TENDER_SUPPLIER"
    | "ADJACENT_COMMERCIAL";
  commercialIntent?: "HIGH" | "MEDIUM";
  retrievalConfidence?: "HIGH" | "MEDIUM";
  expectedBuyerChannelValue?: number;
  publicWebQuery?: PublicWebSearchQuery;
};

export type SearchPartitionHistory = {
  partitionKey: string;
  lastExploredAt: string;
  executions: number;
  newBuyerYield: number;
  directVerifiedYield?: number;
};

export type AdaptiveDiscoveryBudget = {
  maximumPublicWebQueries: number;
  maximumPublicWebCostUsd: number;
  maximumTedRequests: number;
  maximumWebsiteVerificationRequests: number;
  maximumRawPublicWebObservations: number;
  maximumCandidatePool: number;
  maximumDisplayedBuyers: number;
  approximateWorstCaseProviderCostUsd: number;
};

export type HighRecallCoverageFloor = {
  minimumCountries: number;
  minimumRegions: number;
  minimumLanguages: number;
  minimumArchetypes: number;
};

export type HighRecallCoverageSnapshot = {
  countries: string[];
  regions: string[];
  languages: string[];
  archetypes: string[];
};

export type HighRecallProductPolicy = {
  productProfile: ProductMarketProfile;
  europeWide: boolean;
  targetDisplayableProspects: number;
  targetRawCandidates: number;
  targetWebCandidateDomains: number;
  recommendedPublicWebCeiling: 15 | 20 | 25;
  hardTedCeiling: 6;
  shallowWebsiteDomainCeiling: number;
  deepWebsiteDomainCeiling: number;
  coverageFloor: HighRecallCoverageFloor;
};

export type HighRecallWave = {
  wave: 1 | 2 | 3;
  purpose:
    | "EXACT_AND_CHANNEL"
    | "LOCALIZED_AND_FAMILY"
    | "CLINICAL_PROCUREMENT_AND_ADJACENT";
  publicWebCheckpoint: 6 | 8 | 10 | 15 | 20 | 25;
  publicWebQueryIncrement: number;
  cumulativePublicWebQueries: number;
  tedRequestIncrement: number;
  cumulativeTedRequests: number;
  selectedPartitions: SearchSpacePartition[];
  publicWebQueries: PublicWebSearchQuery[];
  tedPartitions: SearchSpacePartition[];
  plannedCoverage: HighRecallCoverageSnapshot;
};

export type HighRecallWavePlan = {
  version: "UNIVERSAL_HIGH_RECALL_WAVE_PLAN_V2";
  policy: HighRecallProductPolicy;
  waves: HighRecallWave[];
  selectedPartitionCount: number;
  unusedPartitionCount: number;
};

export type HighRecallWaveYield = {
  publicWebQueries: number;
  newDisplayableProspects: number;
  newCountries: number;
  newRegions: number;
  newArchetypes: number;
};

export type HighRecallEarlyStopReason =
  | "CONTINUE"
  | "TARGET_AND_COVERAGE_REACHED"
  | "HARD_EXECUTION_CEILING"
  | "SEARCH_SPACE_EXHAUSTED"
  | "MARGINAL_YIELD_SATURATED"
  | "ALL_PROVIDERS_UNAVAILABLE";

export type HighRecallEarlyStopDecision = {
  shouldStop: boolean;
  reason: HighRecallEarlyStopReason;
  targetReached: boolean;
  coverageReached: boolean;
  nextPublicWebCheckpoint: 6 | 8 | 10 | 15 | 20 | 25 | null;
};

export type DiscoverySearchPlan = {
  version:
    | "BUYER_DISCOVERY_VNEXT_1"
    | "ADAPTIVE_MEDICAL_RETRIEVAL_V1"
    | "UNIVERSAL_HIGH_RECALL_V2";
  runMode: DiscoveryRunMode;
  productProfile: ProductMarketProfile;
  budget: AdaptiveDiscoveryBudget;
  selectedPartitions: SearchSpacePartition[];
  publicWebQueries: PublicWebSearchQuery[];
  tedPartitions: SearchSpacePartition[];
  unusedPartitionsRemaining: number;
  stalePartitionsRevisited: number;
  saturation: "NONE" | "DECLINING_YIELD" | "ZERO_RECENT_YIELD";
  adaptive?: {
    enabled: true;
    activeStage: 1 | 2 | 3 | 4;
    stageStopReason:
      | "COLD_STAGE_1"
      | "SUFFICIENT_DIRECT_HISTORY"
      | "ZERO_RESULT_ESCALATION"
      | "MAX_STAGE";
    sufficientDirectProspects: number;
    generatedTermCounts: Record<string, number>;
    negativeContexts: string[];
  };
  highRecall?: HighRecallWavePlan;
};

export type PartitionPersistenceRow = {
  search_space_id: string;
  partition_key: string;
  provider_kind: DiscoveryProviderKind;
  partition_type: SearchSpacePartition["partitionType"];
  terminology: string[];
  language_code: string;
  country_codes: string[];
  market_region: string;
  buyer_archetype: SearchSpacePartition["buyerArchetype"];
  retrieval_kind: SearchSpacePartition["retrievalKind"];
  priority: number;
};

export const BUYER_DISCOVERY_VNEXT_LIMITS = Object.freeze({
  maximumGeneratedPartitions: 480,
  maximumTrackedTerms: 24,
  maximumTrackedCountries: 32,
  partitionStaleDays: 14,
  adminFreshRunsPerDay: 50,
  braveRequestCostUsd: 0.005,
  maximumPublicWebQueries: 10,
  maximumTedRequests: 6,
  maximumWebsiteVerificationRequests: 6,
  maximumRawPublicWebObservations: 60,
  // These are in-memory/persistence capacity bounds, not provider budgets.
  // Active provider requests remain bounded below and are increased only by
  // the separately gated Universal High-Recall coordinator.
  maximumCandidatePool: 300,
  maximumDisplayedBuyers: 100,
  adaptiveSufficientDirectProspects: 3,
});

type Market = {
  region: string;
  country: string;
  language: string;
  uiLanguage: string;
  medicalContext: string;
};

const MARKETS: readonly Market[] = Object.freeze([
  {
    region: "WESTERN_EUROPE",
    country: "GB",
    language: "en",
    uiLanguage: "en-GB",
    medicalContext: "medical",
  },
  {
    region: "WESTERN_EUROPE",
    country: "FR",
    language: "fr",
    uiLanguage: "fr-FR",
    medicalContext: "médical",
  },
  {
    region: "DACH",
    country: "DE",
    language: "de",
    uiLanguage: "de-DE",
    medicalContext: "medizin",
  },
  {
    region: "SOUTHERN_EUROPE",
    country: "IT",
    language: "it",
    uiLanguage: "it-IT",
    medicalContext: "medicale",
  },
  {
    region: "SOUTHERN_EUROPE",
    country: "ES",
    language: "es",
    uiLanguage: "es-ES",
    medicalContext: "médico",
  },
  {
    region: "SOUTHERN_EUROPE",
    country: "PT",
    language: "pt",
    uiLanguage: "pt-PT",
    medicalContext: "médico",
  },
  {
    region: "BENELUX",
    country: "NL",
    language: "nl",
    uiLanguage: "nl-NL",
    medicalContext: "medisch",
  },
  {
    region: "CENTRAL_EASTERN_EUROPE",
    country: "PL",
    language: "pl",
    uiLanguage: "pl-PL",
    medicalContext: "medyczny",
  },
  {
    region: "NORDICS",
    country: "SE",
    language: "en",
    uiLanguage: "en-GB",
    medicalContext: "medical",
  },
]);

const REGION_COUNTRIES: Readonly<Record<string, readonly string[]>> = Object
  .freeze({
    WESTERN_EUROPE: ["GB", "IE", "FR"],
    DACH: ["DE", "AT", "CH"],
    SOUTHERN_EUROPE: ["IT", "ES", "PT", "GR"],
    BENELUX: ["NL", "BE", "LU"],
    NORDICS: ["SE", "NO", "DK", "FI", "IS"],
    CENTRAL_EASTERN_EUROPE: [
      "PL",
      "CZ",
      "SK",
      "HU",
      "RO",
      "BG",
      "HR",
      "SI",
      "EE",
      "LV",
      "LT",
    ],
  });

const COUNTRY_LANGUAGE: Readonly<Record<string, string>> = Object.freeze({
  AT: "de",
  BE: "fr",
  CH: "de",
  IE: "en",
});
const LANGUAGE_MARKET_CONTEXT: Readonly<Record<string, string>> = Object.freeze(
  {
    de: "medizin",
    en: "medical",
    es: "médico",
    fr: "médical",
    it: "medicale",
    nl: "medisch",
    pl: "medyczny",
    pt: "médico",
  },
);

const ARCHETYPE_TERMS: Readonly<
  Record<
    string,
    Partial<Record<BuyerArchetype | "PUBLIC_PROCUREMENT_SUPPLIER", string>>
  >
> = Object.freeze({
  en: {
    DISTRIBUTOR: "distributor",
    IMPORTER: "importer",
    TENDER_SUPPLIER: "tender supplier",
    KIT_ASSEMBLER: "medical kit assembler",
    PROCEDURE_PACK_MANUFACTURER: "procedure pack manufacturer",
    HOSPITAL_SUPPLIER: "hospital supplier",
    OEM_PRIVATE_LABEL: "OEM private label",
    MANUFACTURER: "medical manufacturer",
    PUBLIC_PROCUREMENT_SUPPLIER: "public procurement supplier",
  },
  it: {
    DISTRIBUTOR: "distributore",
    IMPORTER: "importatore",
    TENDER_SUPPLIER: "fornitore gare",
    PUBLIC_PROCUREMENT_SUPPLIER: "fornitore appalti pubblici",
  },
  fr: {
    DISTRIBUTOR: "distributeur",
    IMPORTER: "importateur",
    TENDER_SUPPLIER: "fournisseur marchés",
    PUBLIC_PROCUREMENT_SUPPLIER: "fournisseur marchés publics",
  },
  de: {
    DISTRIBUTOR: "Medizinproduktehändler",
    IMPORTER: "Importeur",
    TENDER_SUPPLIER: "Ausschreibung Lieferant",
    PUBLIC_PROCUREMENT_SUPPLIER: "öffentliche Beschaffung Lieferant",
  },
  es: {
    DISTRIBUTOR: "distribuidor",
    IMPORTER: "importador",
    TENDER_SUPPLIER: "proveedor licitaciones",
    PUBLIC_PROCUREMENT_SUPPLIER: "proveedor contratación pública",
  },
  nl: {
    DISTRIBUTOR: "distributeur",
    IMPORTER: "importeur",
    TENDER_SUPPLIER: "aanbestedingsleverancier",
    PUBLIC_PROCUREMENT_SUPPLIER: "leverancier overheidsopdrachten",
  },
  pt: {
    DISTRIBUTOR: "distribuidor",
    IMPORTER: "importador",
    TENDER_SUPPLIER: "fornecedor concursos",
    PUBLIC_PROCUREMENT_SUPPLIER: "fornecedor contratação pública",
  },
  pl: {
    DISTRIBUTOR: "dystrybutor",
    IMPORTER: "importer",
    TENDER_SUPPLIER: "dostawca przetargowy",
    PUBLIC_PROCUREMENT_SUPPLIER: "dostawca zamówień publicznych",
  },
});

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function semanticTerm(value: string): string {
  return normalized(value).split(" ").map((token) =>
    token.length > 5 && token.endsWith("s") && !/(?:ss|us|is)$/.test(token)
      ? token.slice(0, -1)
      : token
  ).join(" ");
}

function boundedTerm(value: string): string {
  return String(value || "").replace(/["\\]/g, " ").replace(/\s+/g, " ")
    .trim().slice(0, 80);
}

function keyPart(value: string): string {
  return normalized(value).replace(/\s+/g, "-").slice(0, 72) || "none";
}

function partitionKey(parts: string[]): string {
  return parts.map(keyPart).join("|").slice(0, 240);
}

function termLanguage(
  term: string,
  profile: ProductFamilyProfile,
): string {
  const supported = new Set(["en", "it", "fr", "de", "es", "nl", "pt", "pl"]);
  const reviewed = profile.reviewedRetrievalTerms?.find((item) =>
    semanticTerm(item.term) === semanticTerm(term)
  );
  if (reviewed?.language) {
    return supported.has(reviewed.language) ? reviewed.language : "unknown";
  }
  const temporary = profile.temporaryIntent?.retrievalTerms.find((item) =>
    semanticTerm(item.term) === semanticTerm(term)
  );
  if (temporary) {
    return supported.has(temporary.language) ? temporary.language : "unknown";
  }
  if (profile.equipmentCoverKind) {
    for (const language of ["it", "fr", "de", "es", "nl"]) {
      if (
        reviewedEquipmentCoverTerms(profile.equipmentCoverKind, language).some(
          (item) => semanticTerm(item) === semanticTerm(term),
        )
      ) return language;
    }
  }
  return detectDeterministicTermLanguage(term);
}

export function detectDeterministicTermLanguage(term: string): string {
  const value = ` ${normalized(term)} `;
  const signals: Array<[string, RegExp]> = [
    [
      "pl",
      /\b(?:chirurgiczny|chirurgiczne|dostawca|medyczny)\b/,
    ],
    [
      "de",
      /\b(?:medizinproduktehandler|ausschreibung|lieferant|steriler|medizinisch)\b/,
    ],
    [
      "it",
      /\b(?:chirurgico|chirurgici|distributore|importatore|medicale)\b/,
    ],
    ["pt", /\b(?:cirurgica|cirurgicas|fornecedor|contratacao)\b/],
    [
      "es",
      /\b(?:quirurgica|quirurgicas|distribuidor|importador|licitaciones|medico)\b/,
    ],
    [
      "fr",
      /\b(?:chirurgicale|distributeur|importateur|fournisseur|medical)\b/,
    ],
    [
      "nl",
      /\b(?:steriele|distributeur|importeur|leverancier|medisch)\b/,
    ],
    [
      "en",
      /\b(?:sterile|surgical|medical|supplier|distributor|importer|wholesaler|reseller|disposable|operating|hospital|clinical|diagnostic)\b/,
    ],
  ];
  return signals.find(([, pattern]) => pattern.test(value))?.[0] || "unknown";
}

function trustedTerms(profile: ProductFamilyProfile): ProductRetrievalTerm[] {
  if (profile.temporaryIntent?.retrievalTerms.length) {
    return profile.temporaryIntent.retrievalTerms.slice(
      0,
      BUYER_DISCOVERY_VNEXT_LIMITS.maximumTrackedTerms,
    );
  }
  const reviewed = profile.reviewedRetrievalTerms || [];
  const values = [
    profile.label,
    ...profile.directTerms,
    ...profile.adjacentTerms,
  ];
  const seen = new Set<string>();
  const baseline = values.flatMap((term, index) => {
    const clean = boundedTerm(term);
    const signature = semanticTerm(clean);
    if (!signature || seen.has(signature)) return [];
    seen.add(signature);
    const language = termLanguage(clean, profile);
    return [{
      term: clean,
      normalizedTerm: signature,
      language,
      // English commercial terminology is routinely published across Europe;
      // leave it market-neutral so geographic coverage is not constrained to
      // English-speaking countries. Reviewed localized terms stay scoped.
      countries: language === "en"
        ? []
        : MARKETS.filter((market) => market.language === language).map(
          (market) => market.country,
        ),
      confidence: index < Math.max(2, profile.directTerms.length + 1)
        ? "HIGH" as const
        : "MEDIUM" as const,
      source: index === 0
        ? "APPROVED_ALIAS" as const
        : "DETERMINISTIC_VARIANT" as const,
      reason: index === 0
        ? "Canonical or approved product terminology"
        : "Existing reviewed product-family terminology",
      familySignature: profile.temporaryIntent?.familySignature || profile.key,
    }];
  });
  return [...reviewed, ...baseline].filter((term, index, all) =>
    all.findIndex((candidate) =>
      candidate.language === term.language &&
      semanticTerm(candidate.term) === semanticTerm(term.term)
    ) === index
  ).slice(0, BUYER_DISCOVERY_VNEXT_LIMITS.maximumTrackedTerms);
}

export function classifyProductMarketProfile(
  profile: ProductFamilyProfile,
): ProductMarketProfile {
  const labelTokens = normalized(profile.label).split(" ").filter(Boolean);
  const temporaryDepth = profile.temporaryIntent?.retrievalTerms.length || 0;
  if (
    profile.equipmentCoverKind || temporaryDepth >= 4 ||
    (labelTokens.length >= 4 && profile.directTerms.length >= 3)
  ) return "NICHE";
  if (labelTokens.length <= 1 && profile.adjacentTerms.length <= 4) {
    return "BROAD";
  }
  return "STANDARD";
}

export function adaptiveDiscoveryBudget(
  productProfile: ProductMarketProfile,
  runMode: DiscoveryRunMode,
): AdaptiveDiscoveryBudget {
  const fresh = runMode !== "NORMAL_DISCOVERY";
  const maximumPublicWebQueries = productProfile === "BROAD"
    ? fresh ? 10 : 8
    : productProfile === "STANDARD"
    ? fresh ? 8 : 6
    : fresh
    ? 6
    : 4;
  const maximumTedRequests = productProfile === "NICHE" && fresh ? 6 : 4;
  const maximumPublicWebCostUsd = Number(
    (maximumPublicWebQueries * BUYER_DISCOVERY_VNEXT_LIMITS.braveRequestCostUsd)
      .toFixed(3),
  );
  return {
    maximumPublicWebQueries,
    maximumPublicWebCostUsd,
    maximumTedRequests,
    maximumWebsiteVerificationRequests:
      BUYER_DISCOVERY_VNEXT_LIMITS.maximumWebsiteVerificationRequests,
    maximumRawPublicWebObservations:
      BUYER_DISCOVERY_VNEXT_LIMITS.maximumRawPublicWebObservations,
    maximumCandidatePool: BUYER_DISCOVERY_VNEXT_LIMITS.maximumCandidatePool,
    maximumDisplayedBuyers: BUYER_DISCOVERY_VNEXT_LIMITS.maximumDisplayedBuyers,
    approximateWorstCaseProviderCostUsd: maximumPublicWebCostUsd,
  };
}

function archetypesFor(
  productProfile: ProductMarketProfile,
  profile: ProductFamilyProfile,
): Array<BuyerArchetype | "PUBLIC_PROCUREMENT_SUPPLIER"> {
  const values: Array<BuyerArchetype | "PUBLIC_PROCUREMENT_SUPPLIER"> = [
    "DISTRIBUTOR",
    "IMPORTER",
    "TENDER_SUPPLIER",
    "PUBLIC_PROCUREMENT_SUPPLIER",
  ];
  if (productProfile === "BROAD") {
    values.push("OEM_PRIVATE_LABEL", "MANUFACTURER");
  }
  if (profile.componentFitLabel) {
    values.push(
      "HOSPITAL_SUPPLIER",
      "PROCEDURE_PACK_MANUFACTURER",
      "KIT_ASSEMBLER",
    );
  }
  if (profile.procedurePack) {
    values.push(
      "PROCEDURE_PACK_MANUFACTURER",
      "KIT_ASSEMBLER",
      "HOSPITAL_SUPPLIER",
      "OEM_PRIVATE_LABEL",
      "MANUFACTURER",
    );
  }
  if (productProfile === "NICHE") values.push("OEM_PRIVATE_LABEL");
  return [...new Set(values)];
}

function marketsFor(targetCountries: string[]): Market[] {
  const wanted = new Set(targetCountries.map((item) => item.toUpperCase()));
  if (!wanted.size) return [...MARKETS];
  const selected = MARKETS.filter((market) => wanted.has(market.country));
  for (const country of wanted) {
    if (selected.some((market) => market.country === country)) continue;
    const region = Object.entries(REGION_COUNTRIES).find(([, countries]) =>
      countries.includes(country)
    )?.[0] || "OTHER_EUROPE";
    const language = COUNTRY_LANGUAGE[country] || "en";
    selected.push({
      region,
      country,
      language,
      uiLanguage: `${language}-${country}`,
      medicalContext: LANGUAGE_MARKET_CONTEXT[language] || "medical",
    });
  }
  return selected.slice(
    0,
    BUYER_DISCOVERY_VNEXT_LIMITS.maximumTrackedCountries,
  );
}

function adaptiveArchetype(
  value: string,
): BuyerArchetype | "PUBLIC_PROCUREMENT_SUPPLIER" {
  const term = normalized(value);
  if (/(?:oem|private label|sourcing partner)/.test(term)) {
    return "OEM_PRIVATE_LABEL";
  }
  if (/(?:assembler|kit pack|procedure pack)/.test(term)) {
    return "KIT_ASSEMBLER";
  }
  if (/(?:import)/.test(term)) return "IMPORTER";
  if (/(?:tender|contract|procurement)/.test(term)) return "TENDER_SUPPLIER";
  if (/(?:hospital supplier|hospital supply)/.test(term)) {
    return "HOSPITAL_SUPPLIER";
  }
  return "DISTRIBUTOR";
}

export function buildAdaptiveSearchUniverse(input: {
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  cpvCodes: string[];
  adaptiveIntelligence: AdaptiveMedicalRetrievalIntelligence;
}): SearchSpacePartition[] {
  const intelligence = input.adaptiveIntelligence;
  const markets = marketsFor(input.targetCountries);
  const familySignature =
    input.productFamily.temporaryIntent?.familySignature ||
    input.productFamily.key;
  const stages: Record<1 | 2 | 3 | 4, SearchSpacePartition[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
  };
  const seen = new Set<string>();
  const channels = intelligence.channel_archetypes.slice(
    0,
    ADAPTIVE_MEDICAL_RETRIEVAL_LIMITS.maximumChannelArchetypes,
  );
  const channelValues = channels.length ? channels : ["medical distributor"];
  const localized = intelligence.localized_terms.filter((term) =>
    term.language !== "unknown" &&
    markets.some((market) =>
      market.language === term.language &&
      (!term.countries.length || term.countries.includes(market.country))
    )
  );
  const negativeFilter = intelligence.negative_contexts.slice(0, 2).map((
    term,
  ) => `-"${boundedTerm(term)}"`).join(" ");

  const addWeb = (options: {
    stage: 1 | 2 | 3 | 4;
    term: string;
    language: string;
    queryType: NonNullable<SearchSpacePartition["adaptiveQueryType"]>;
    confidence: "HIGH" | "MEDIUM";
    channel: string;
    priority: number;
    countries?: string[];
  }) => {
    if (options.language === "unknown") return;
    const matchingMarkets = markets.filter((market) =>
      (options.language === "en" || market.language === options.language) &&
      (!options.countries?.length || options.countries.includes(market.country))
    );
    if (!matchingMarkets.length) return;
    for (const market of matchingMarkets) {
      const archetype = adaptiveArchetype(options.channel);
      const semanticKey = [
        "web",
        options.stage,
        semanticTerm(options.term),
        market.country,
        normalized(options.channel),
      ].join("|");
      if (seen.has(semanticKey)) continue;
      seen.add(semanticKey);
      const key = partitionKey([
        "adaptive",
        "web",
        String(options.stage),
        familySignature,
        options.term,
        market.country,
        options.channel,
      ]);
      stages[options.stage].push({
        partitionKey: key,
        providerKind: "PUBLIC_WEB",
        partitionType: "COMMERCIAL_WEB",
        terminology: [options.term],
        language: options.language,
        countryCodes: [market.country],
        marketRegion: market.region,
        buyerArchetype: archetype,
        retrievalKind: options.stage <= 2 ? "DIRECT_TERMS" : "ADJACENT_TERMS",
        priority: Math.min(200, Math.max(0, options.priority)),
        adaptiveStage: options.stage,
        adaptiveQueryType: options.queryType,
        commercialIntent: options.stage <= 2 ? "HIGH" : "MEDIUM",
        retrievalConfidence: options.confidence,
        expectedBuyerChannelValue: Math.max(1, 100 - options.stage * 15),
        publicWebQuery: {
          variant: 0,
          strategy: options.language === "en"
            ? options.queryType === "EXACT_PRODUCT"
              ? "EXACT"
              : options.stage === 4
              ? "ADJACENT"
              : "SYNONYM"
            : "LOCALIZED",
          query: `"${boundedTerm(options.term)}" ${
            boundedTerm(options.channel)
          } (products OR catalog OR distribution) ${negativeFilter}`
            .slice(0, 240),
          country: market.country,
          language: options.language,
          uiLanguage: market.uiLanguage,
          retrievalTerm: options.term,
          retrievalTermConfidence: options.confidence,
          retrievalTermSource: "SMART_RESOLVER_CANDIDATE",
          familySignature,
          partitionKey: key,
          marketRegion: market.region,
          buyerArchetype: archetype,
        },
      });
    }
  };

  const addTed = (options: {
    stage: 1 | 2 | 3;
    term: string;
    language: string;
    queryType:
      | "EXACT_PRODUCT"
      | "COMMERCIAL_SYNONYM"
      | "PROCUREMENT_PRODUCT"
      | "TENDER_SUPPLIER";
    confidence: "HIGH" | "MEDIUM";
    priority: number;
    countries?: string[];
  }) => {
    if (options.language === "unknown") return;
    for (const market of markets) {
      if (options.language !== "en" && options.language !== market.language) {
        continue;
      }
      if (
        options.countries?.length && !options.countries.includes(market.country)
      ) {
        continue;
      }
      const semanticKey = [
        "ted",
        options.stage,
        semanticTerm(options.term),
        market.region,
      ].join("|");
      if (seen.has(semanticKey)) continue;
      seen.add(semanticKey);
      const key = partitionKey([
        "adaptive",
        "ted",
        String(options.stage),
        familySignature,
        options.term,
        market.region,
      ]);
      stages[options.stage].push({
        partitionKey: key,
        providerKind: "TED",
        partitionType: "TED_PRODUCT_TERMS",
        terminology: [options.term],
        language: options.language,
        countryCodes: input.targetCountries.length
          ? [market.country]
          : options.countries?.length
          ? [...options.countries]
          : [...(REGION_COUNTRIES[market.region] || [market.country])],
        marketRegion: market.region,
        buyerArchetype: "PUBLIC_PROCUREMENT_SUPPLIER",
        retrievalKind: options.stage === 1 ? "DIRECT_TERMS" : "ADJACENT_TERMS",
        priority: Math.min(200, Math.max(0, options.priority)),
        adaptiveStage: options.stage,
        adaptiveQueryType: options.queryType,
        commercialIntent: options.stage <= 2 ? "HIGH" : "MEDIUM",
        retrievalConfidence: options.confidence,
        expectedBuyerChannelValue: options.stage === 1 ? 85 : 65,
      });
    }
  };

  const directTerms = [
    {
      term: intelligence.canonical_product,
      language: "en",
      countries: [] as string[],
    },
    ...intelligence.commercial_synonyms.map((term) => ({
      term,
      language: "en",
      countries: [] as string[],
    })),
    ...localized,
  ].filter((entry, index, values) =>
    values.findIndex((candidate) =>
      semanticTerm(candidate.term) === semanticTerm(entry.term) &&
      candidate.language === entry.language
    ) === index
  );
  directTerms.forEach((entry, index) => {
    const { term, language, countries } = entry;
    const channel = channelValues[index % channelValues.length];
    addWeb({
      stage: 1,
      term,
      language,
      queryType: index === 0 ? "EXACT_PRODUCT" : "COMMERCIAL_SYNONYM",
      confidence: intelligence.search_confidence,
      channel,
      priority: 150 - index,
      countries,
    });
    addTed({
      stage: 1,
      term,
      language,
      queryType: index === 0 ? "EXACT_PRODUCT" : "COMMERCIAL_SYNONYM",
      confidence: intelligence.search_confidence,
      priority: 130 - index,
      countries,
    });
  });

  channelValues.forEach((channel, index) =>
    addWeb({
      stage: 2,
      term: intelligence.product_family,
      language: "en",
      queryType: "CHANNEL_PRODUCT",
      confidence: intelligence.search_confidence,
      channel,
      priority: 120 - index,
    })
  );

  intelligence.clinical_contexts.forEach((term, index) =>
    addWeb({
      stage: 3,
      term,
      language: "en",
      queryType: "CLINICAL_CONTEXT",
      confidence: "MEDIUM",
      channel: channelValues[index % channelValues.length],
      priority: 90 - index,
    })
  );
  intelligence.procurement_terms.forEach((term, index) => {
    addWeb({
      stage: 3,
      term,
      language: "en",
      queryType: "PROCUREMENT_PRODUCT",
      confidence: "MEDIUM",
      channel: channelValues.find((item) =>
        /(?:tender|contract|supplier)/i.test(item)
      ) || "tender supplier",
      priority: 100 - index,
    });
    addTed({
      stage: 3,
      term,
      language: "en",
      queryType: "TENDER_SUPPLIER",
      confidence: "MEDIUM",
      priority: 105 - index,
    });
  });
  if (input.cpvCodes.length) {
    for (const market of markets) {
      const key = partitionKey([
        "adaptive",
        "ted",
        "3",
        familySignature,
        input.cpvCodes.join("-"),
        market.region,
      ]);
      stages[3].push({
        partitionKey: key,
        providerKind: "TED",
        partitionType: "TED_RELATED_CPV",
        terminology: input.cpvCodes.slice(0, 3),
        language: market.language,
        countryCodes: input.targetCountries.length
          ? [market.country]
          : [...(REGION_COUNTRIES[market.region] || [market.country])],
        marketRegion: market.region,
        buyerArchetype: "PUBLIC_PROCUREMENT_SUPPLIER",
        retrievalKind: "RELATED_CPV",
        priority: 72,
        adaptiveStage: 3,
        adaptiveQueryType: "PROCUREMENT_PRODUCT",
        commercialIntent: "MEDIUM",
        retrievalConfidence: "MEDIUM",
        expectedBuyerChannelValue: 55,
      });
    }
  }
  intelligence.adjacent_commercial_terms.forEach((term, index) =>
    addWeb({
      stage: 4,
      term,
      language: "en",
      queryType: "ADJACENT_COMMERCIAL",
      confidence: "MEDIUM",
      channel: channelValues[index % channelValues.length],
      priority: 60 - index,
    })
  );

  const perStage = Math.floor(
    ADAPTIVE_MEDICAL_RETRIEVAL_LIMITS.maximumGeneratedPartitions / 4,
  );
  return ([1, 2, 3, 4] as const).flatMap((stage) =>
    chooseDiverse(stages[stage], perStage)
  ).slice(0, ADAPTIVE_MEDICAL_RETRIEVAL_LIMITS.maximumGeneratedPartitions);
}

function buildUniverse(input: {
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  cpvCodes: string[];
  adaptiveIntelligence?: AdaptiveMedicalRetrievalIntelligence | null;
}): SearchSpacePartition[] {
  if (input.adaptiveIntelligence) {
    return buildAdaptiveSearchUniverse({
      ...input,
      adaptiveIntelligence: input.adaptiveIntelligence,
    });
  }
  const terms = trustedTerms(input.productFamily);
  const markets = marketsFor(input.targetCountries);
  const productProfile = classifyProductMarketProfile(input.productFamily);
  const archetypes = archetypesFor(productProfile, input.productFamily);
  const isProcedurePack = Boolean(input.productFamily.procedurePack);
  const web: SearchSpacePartition[] = [];
  const seenWeb = new Set<string>();
  for (const term of terms) {
    if (term.language === "unknown") continue;
    const termMarkets = markets.filter((market) =>
      (term.language === "en" || market.language === term.language) &&
      (!term.countries.length || term.countries.includes(market.country))
    );
    for (const market of termMarkets) {
      for (const archetype of archetypes) {
        const archetypeTerm = ARCHETYPE_TERMS[market.language]?.[archetype] ||
          ARCHETYPE_TERMS.en[archetype] || "medical supplier";
        const semanticKey = [
          semanticTerm(term.term),
          market.country,
          market.language,
          normalized(archetypeTerm),
        ].join("|");
        if (seenWeb.has(semanticKey)) continue;
        seenWeb.add(semanticKey);
        const key = partitionKey([
          "web",
          term.familySignature,
          term.term,
          market.country,
          market.language,
          archetype,
        ]);
        const directIndex = input.productFamily.directTerms.findIndex((item) =>
          semanticTerm(item) === semanticTerm(term.term)
        );
        const priority = 40 + Number(term.confidence === "HIGH") * 20 +
          Number(directIndex >= 0 || term.term === input.productFamily.label) *
            15 +
          Number(term.language === market.language) * 8 +
          Number(archetype === "DISTRIBUTOR" || archetype === "IMPORTER") * 6 +
          Number(
              isProcedurePack &&
                [
                  "PROCEDURE_PACK_MANUFACTURER",
                  "KIT_ASSEMBLER",
                  "HOSPITAL_SUPPLIER",
                  "OEM_PRIVATE_LABEL",
                ].includes(archetype),
            ) * 10 -
          Math.max(0, directIndex);
        web.push({
          partitionKey: key,
          providerKind: "PUBLIC_WEB",
          partitionType: "COMMERCIAL_WEB",
          terminology: [term.term],
          language: term.language,
          countryCodes: [market.country],
          marketRegion: market.region,
          buyerArchetype: archetype,
          retrievalKind:
            directIndex >= 0 || term.term === input.productFamily.label
              ? "DIRECT_TERMS"
              : "ADJACENT_TERMS",
          priority,
          publicWebQuery: {
            variant: 0,
            strategy: term.language === "en"
              ? directIndex >= 0 ? "EXACT" : "SYNONYM"
              : "LOCALIZED",
            query: `"${
              boundedTerm(term.term)
            }" ${market.medicalContext} ${archetypeTerm} (products OR catalog OR distribution)`
              .slice(0, 240),
            country: market.country,
            language: term.language,
            uiLanguage: market.uiLanguage,
            retrievalTerm: term.term,
            retrievalTermConfidence: term.confidence,
            retrievalTermSource: term.source,
            familySignature: term.familySignature,
            partitionKey: key,
            marketRegion: market.region,
            buyerArchetype: archetype,
          },
        });
      }
    }
  }
  const ted: SearchSpacePartition[] = [];
  for (const term of terms) {
    if (term.language === "unknown") continue;
    for (const market of markets) {
      if (term.language !== "en" && term.language !== market.language) continue;
      if (term.countries.length && !term.countries.includes(market.country)) {
        continue;
      }
      const key = partitionKey([
        "ted",
        "product",
        term.familySignature,
        term.term,
        market.region,
      ]);
      if (ted.some((item) => item.partitionKey === key)) continue;
      ted.push({
        partitionKey: key,
        providerKind: "TED",
        partitionType: "TED_PRODUCT_TERMS",
        terminology: [term.term],
        language: term.language,
        countryCodes: input.targetCountries.length
          ? [market.country]
          : term.countries.length
          ? [...term.countries]
          : [...(REGION_COUNTRIES[market.region] || [market.country])],
        marketRegion: market.region,
        buyerArchetype: "PUBLIC_PROCUREMENT_SUPPLIER",
        retrievalKind: "DIRECT_TERMS",
        priority: 55 + Number(term.confidence === "HIGH") * 20 +
          Number(term.language === market.language) * 8,
      });
    }
  }
  if (input.cpvCodes.length) {
    for (const market of markets) {
      const key = partitionKey([
        "ted",
        "cpv",
        input.cpvCodes.join("-"),
        market.region,
      ]);
      if (ted.some((item) => item.partitionKey === key)) continue;
      ted.push({
        partitionKey: key,
        providerKind: "TED",
        partitionType: "TED_RELATED_CPV",
        terminology: input.cpvCodes.slice(0, 3),
        language: market.language,
        countryCodes: input.targetCountries.length
          ? [market.country]
          : [...(REGION_COUNTRIES[market.region] || [market.country])],
        marketRegion: market.region,
        buyerArchetype: "PUBLIC_PROCUREMENT_SUPPLIER",
        retrievalKind: "RELATED_CPV",
        priority: 42,
      });
    }
  }
  return [...web, ...ted].sort((left, right) =>
    right.priority - left.priority ||
    left.partitionKey.localeCompare(right.partitionKey)
  ).slice(0, BUYER_DISCOVERY_VNEXT_LIMITS.maximumGeneratedPartitions);
}

function chooseDiverse(
  candidates: SearchSpacePartition[],
  maximum: number,
): SearchSpacePartition[] {
  const selected: SearchSpacePartition[] = [];
  const dimensions = {
    providers: new Set<DiscoveryProviderKind>(),
    languages: new Set<string>(),
    regions: new Set<string>(),
    archetypes: new Set<string>(),
    terms: new Set<string>(),
  };
  const remaining = [...candidates];
  while (remaining.length && selected.length < maximum) {
    remaining.sort((left, right) => {
      const diversity = (item: SearchSpacePartition) =>
        Number(!dimensions.providers.has(item.providerKind)) * 20 +
        Number(!dimensions.languages.has(item.language)) * 22 +
        Number(!dimensions.regions.has(item.marketRegion)) * 10 +
        Number(!dimensions.archetypes.has(item.buyerArchetype)) * 16 +
        Number(!dimensions.terms.has(semanticTerm(item.terminology[0] || ""))) *
          8;
      return right.priority + diversity(right) - left.priority -
          diversity(left) ||
        left.partitionKey.localeCompare(right.partitionKey);
    });
    const next = remaining.shift()!;
    selected.push(next);
    dimensions.providers.add(next.providerKind);
    dimensions.languages.add(next.language);
    dimensions.regions.add(next.marketRegion);
    dimensions.archetypes.add(next.buyerArchetype);
    dimensions.terms.add(semanticTerm(next.terminology[0] || ""));
  }
  return selected;
}

function coverageFor(
  partitions: readonly SearchSpacePartition[],
): HighRecallCoverageSnapshot {
  return {
    countries: [...new Set(partitions.flatMap((item) => item.countryCodes))]
      .sort(),
    regions: [...new Set(partitions.map((item) => item.marketRegion))].sort(),
    languages: [...new Set(partitions.map((item) => item.language))].sort(),
    archetypes: [...new Set(partitions.map((item) => item.buyerArchetype))]
      .sort(),
  };
}

export function highRecallProductPolicy(input: {
  productProfile: ProductMarketProfile;
  targetCountries: string[];
}): HighRecallProductPolicy {
  const europeWide = input.targetCountries.length === 0;
  const base = input.productProfile === "BROAD"
    ? {
      displayable: 50,
      raw: 120,
      webDomains: 60,
      web: 25 as const,
      shallow: 50,
      deep: 12,
      floor: [8, 6, 5, 4] as const,
    }
    : input.productProfile === "STANDARD"
    ? {
      displayable: 35,
      raw: 90,
      webDomains: 50,
      web: 20 as const,
      shallow: 35,
      deep: 10,
      floor: [6, 5, 4, 4] as const,
    }
    : {
      displayable: 20,
      raw: 60,
      webDomains: 35,
      web: 15 as const,
      shallow: 20,
      deep: 8,
      floor: [4, 4, 3, 3] as const,
    };
  const targetMarketCount = Math.max(1, input.targetCountries.length);
  return {
    productProfile: input.productProfile,
    europeWide,
    targetDisplayableProspects: europeWide
      ? base.displayable
      : Math.min(base.displayable, Math.max(12, targetMarketCount * 8)),
    targetRawCandidates: europeWide
      ? base.raw
      : Math.min(base.raw, Math.max(30, targetMarketCount * 16)),
    targetWebCandidateDomains: europeWide
      ? base.webDomains
      : Math.min(base.webDomains, Math.max(18, targetMarketCount * 10)),
    recommendedPublicWebCeiling: base.web,
    hardTedCeiling: 6,
    shallowWebsiteDomainCeiling: base.shallow,
    deepWebsiteDomainCeiling: base.deep,
    coverageFloor: {
      minimumCountries: europeWide
        ? base.floor[0]
        : Math.min(targetMarketCount, base.floor[0]),
      minimumRegions: europeWide ? base.floor[1] : 1,
      minimumLanguages: europeWide
        ? base.floor[2]
        : Math.min(targetMarketCount, base.floor[2]),
      minimumArchetypes: base.floor[3],
    },
  };
}

function waveNumberFor(partition: SearchSpacePartition): 1 | 2 | 3 {
  if (partition.adaptiveStage) {
    return partition.adaptiveStage === 1
      ? 1
      : partition.adaptiveStage === 2
      ? 2
      : 3;
  }
  const direct = partition.retrievalKind === "DIRECT_TERMS";
  const primaryChannel = [
    "DISTRIBUTOR",
    "IMPORTER",
    "TENDER_SUPPLIER",
  ].includes(partition.buyerArchetype);
  if (direct && partition.language === "en" && primaryChannel) return 1;
  if (
    partition.language !== "en" ||
    (direct && partition.providerKind === "PUBLIC_WEB")
  ) return 2;
  return 3;
}

/**
 * Plans three incremental, server-generated waves. This is intentionally pure:
 * callers can persist the plan, execute each bounded increment, checkpoint its
 * yield and stop without ever accepting arbitrary client-supplied queries.
 */
export function buildHighRecallWavePlan(input: {
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  cpvCodes: string[];
  history?: SearchPartitionHistory[];
  runMode?: DiscoveryRunMode;
  adaptiveIntelligence?: AdaptiveMedicalRetrievalIntelligence | null;
}): HighRecallWavePlan {
  const productProfile = classifyProductMarketProfile(input.productFamily);
  const policy = highRecallProductPolicy({
    productProfile,
    targetCountries: input.targetCountries,
  });
  const history = new Map(
    (input.history || []).map((item) => [item.partitionKey, item]),
  );
  const universe = buildUniverse(input);
  const fresh = input.runMode && input.runMode !== "NORMAL_DISCOVERY";
  const eligibleUniverse = fresh
    ? universe.filter((item) => !history.has(item.partitionKey))
    : universe;
  const checkpoints = productProfile === "BROAD"
    ? [10, 15, 25] as const
    : productProfile === "STANDARD"
    ? [8, 15, 20] as const
    : [6, 10, 15] as const;
  const purposes = [
    "EXACT_AND_CHANNEL",
    "LOCALIZED_AND_FAMILY",
    "CLINICAL_PROCUREMENT_AND_ADJACENT",
  ] as const;
  const selectedKeys = new Set<string>();
  const cumulative: SearchSpacePartition[] = [];
  let priorWebCheckpoint = 0;
  let priorTedCheckpoint = 0;
  let globalVariant = 0;
  const waves: HighRecallWave[] = ([1, 2, 3] as const).map((wave, index) => {
    const webCheckpoint = checkpoints[index];
    const tedCheckpoint = Math.min(policy.hardTedCeiling, (index + 1) * 2);
    const available = eligibleUniverse.filter((item) =>
      !selectedKeys.has(item.partitionKey) && waveNumberFor(item) === wave
    );
    const selectedWeb = chooseDiverse(
      available.filter((item) => item.providerKind === "PUBLIC_WEB"),
      Math.max(0, webCheckpoint - priorWebCheckpoint),
    );
    const selectedTed = chooseDiverse(
      available.filter((item) => item.providerKind === "TED"),
      Math.max(0, tedCheckpoint - priorTedCheckpoint),
    );
    const selectedPartitions = [...selectedWeb, ...selectedTed];
    for (const item of selectedPartitions) selectedKeys.add(item.partitionKey);
    cumulative.push(...selectedPartitions);
    const publicWebQueries = selectedWeb.map((item) => ({
      ...item.publicWebQuery!,
      variant: globalVariant++,
    }));
    const result: HighRecallWave = {
      wave,
      purpose: purposes[index],
      publicWebCheckpoint: webCheckpoint,
      publicWebQueryIncrement: publicWebQueries.length,
      cumulativePublicWebQueries: priorWebCheckpoint + publicWebQueries.length,
      tedRequestIncrement: selectedTed.length,
      cumulativeTedRequests: priorTedCheckpoint + selectedTed.length,
      selectedPartitions,
      publicWebQueries,
      tedPartitions: selectedTed,
      plannedCoverage: coverageFor(cumulative),
    };
    priorWebCheckpoint = result.cumulativePublicWebQueries;
    priorTedCheckpoint = result.cumulativeTedRequests;
    return result;
  });
  return {
    version: "UNIVERSAL_HIGH_RECALL_WAVE_PLAN_V2",
    policy,
    waves,
    selectedPartitionCount: selectedKeys.size,
    unusedPartitionCount: Math.max(
      0,
      eligibleUniverse.length - selectedKeys.size,
    ),
  };
}

function coverageReached(
  coverage: HighRecallCoverageSnapshot,
  floor: HighRecallCoverageFloor,
): boolean {
  return coverage.countries.length >= floor.minimumCountries &&
    coverage.regions.length >= floor.minimumRegions &&
    coverage.languages.length >= floor.minimumLanguages &&
    coverage.archetypes.length >= floor.minimumArchetypes;
}

export function evaluateHighRecallEarlyStop(input: {
  plan: HighRecallWavePlan;
  displayableProspects: number;
  coverage: HighRecallCoverageSnapshot;
  completedPublicWebQueries: number;
  completedTedRequests: number;
  waveYields?: HighRecallWaveYield[];
  searchSpaceExhausted?: boolean;
  publicWebUnavailable?: boolean;
  tedUnavailable?: boolean;
}): HighRecallEarlyStopDecision {
  const targetReached = input.displayableProspects >=
    input.plan.policy.targetDisplayableProspects;
  const hasCoverage = coverageReached(
    input.coverage,
    input.plan.policy.coverageFloor,
  );
  const next =
    input.plan.waves.find((wave) =>
      wave.publicWebCheckpoint > input.completedPublicWebQueries
    )?.publicWebCheckpoint || null;
  const finish = (
    reason: HighRecallEarlyStopReason,
  ): HighRecallEarlyStopDecision => ({
    shouldStop: reason !== "CONTINUE",
    reason,
    targetReached,
    coverageReached: hasCoverage,
    nextPublicWebCheckpoint: reason === "CONTINUE" ? next : null,
  });
  if (targetReached && hasCoverage) {
    return finish("TARGET_AND_COVERAGE_REACHED");
  }
  if (input.publicWebUnavailable && input.tedUnavailable) {
    return finish("ALL_PROVIDERS_UNAVAILABLE");
  }
  if (
    input.completedPublicWebQueries >=
      input.plan.policy.recommendedPublicWebCeiling &&
    input.completedTedRequests >= input.plan.policy.hardTedCeiling
  ) return finish("HARD_EXECUTION_CEILING");
  if (input.searchSpaceExhausted || next === null) {
    return finish("SEARCH_SPACE_EXHAUSTED");
  }
  const recent = (input.waveYields || []).slice(-2);
  if (
    recent.length === 2 &&
    recent.every((item) =>
      item.newDisplayableProspects === 0 && item.newCountries === 0 &&
      item.newRegions === 0 && item.newArchetypes === 0
    )
  ) return finish("MARGINAL_YIELD_SATURATED");
  return finish("CONTINUE");
}

export function buildDiscoverySearchPlan(input: {
  runMode: DiscoveryRunMode;
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  cpvCodes: string[];
  history?: SearchPartitionHistory[];
  recentFreshYields?: number[];
  now?: Date;
  adaptiveIntelligence?: AdaptiveMedicalRetrievalIntelligence | null;
  highRecallEnabled?: boolean;
}): DiscoverySearchPlan {
  const productProfile = classifyProductMarketProfile(input.productFamily);
  const budget = adaptiveDiscoveryBudget(productProfile, input.runMode);
  const universe = buildUniverse(input);
  const history = new Map(
    (input.history || []).map((item) => [item.partitionKey, item]),
  );
  const now = input.now || new Date();
  const fresh = input.runMode !== "NORMAL_DISCOVERY";
  const unused = universe.filter((item) => !history.has(item.partitionKey));
  const stale = universe.filter((item) => {
    const prior = history.get(item.partitionKey);
    return prior && now.getTime() - new Date(prior.lastExploredAt).getTime() >=
        BUYER_DISCOVERY_VNEXT_LIMITS.partitionStaleDays * 86_400_000;
  }).sort((left, right) => {
    const leftHistory = history.get(left.partitionKey)!;
    const rightHistory = history.get(right.partitionKey)!;
    return leftHistory.newBuyerYield - rightHistory.newBuyerYield ||
      leftHistory.lastExploredAt.localeCompare(rightHistory.lastExploredAt);
  });
  let activeStage: 1 | 2 | 3 | 4 = 1;
  let stageStopReason: NonNullable<
    DiscoverySearchPlan["adaptive"]
  >["stageStopReason"] = "COLD_STAGE_1";
  if (input.adaptiveIntelligence) {
    const exploredAdaptive = universe.filter((item) =>
      item.adaptiveStage && history.has(item.partitionKey)
    );
    const directYield = exploredAdaptive.reduce((sum, item) =>
      sum + Math.max(
        0,
        history.get(item.partitionKey)?.directVerifiedYield || 0,
      ), 0);
    if (
      directYield >=
        BUYER_DISCOVERY_VNEXT_LIMITS.adaptiveSufficientDirectProspects
    ) {
      activeStage = Math.max(
        1,
        ...exploredAdaptive.map((item) => item.adaptiveStage || 1),
      ) as 1 | 2 | 3 | 4;
      stageStopReason = "SUFFICIENT_DIRECT_HISTORY";
    } else if (exploredAdaptive.length) {
      const highestExploredStage = Math.max(
        ...exploredAdaptive.map((item) => item.adaptiveStage || 1),
      );
      activeStage = Math.min(4, highestExploredStage + 1) as 1 | 2 | 3 | 4;
      stageStopReason = activeStage === 4
        ? "MAX_STAGE"
        : "ZERO_RESULT_ESCALATION";
    }
  }
  const stageUniverse = input.adaptiveIntelligence
    ? universe.filter((item) => item.adaptiveStage === activeStage)
    : universe;
  const stageUnused = stageUniverse.filter((item) =>
    !history.has(item.partitionKey)
  );
  const stageStale = stale.filter((item) => item.adaptiveStage === activeStage);
  const source = input.adaptiveIntelligence
    ? stageStopReason === "SUFFICIENT_DIRECT_HISTORY" && fresh
      ? []
      : fresh
      ? [...stageUnused, ...stageStale]
      : stageUniverse
    : fresh
    ? [...unused, ...stale]
    : universe;
  const highRecall = input.highRecallEnabled
    ? buildHighRecallWavePlan({
      productFamily: input.productFamily,
      targetCountries: input.targetCountries,
      cpvCodes: input.cpvCodes,
      history: input.history,
      runMode: input.runMode,
      adaptiveIntelligence: input.adaptiveIntelligence,
    })
    : undefined;
  const highRecallPartitions = highRecall?.waves.flatMap((wave) =>
    wave.selectedPartitions
  );
  const web = highRecall
    ? highRecall.waves.flatMap((wave) => wave.publicWebQueries).map((query) =>
      highRecallPartitions!.find((partition) =>
        partition.partitionKey === query.partitionKey
      )!
    ).filter(Boolean)
    : chooseDiverse(
      source.filter((item) => item.providerKind === "PUBLIC_WEB"),
      budget.maximumPublicWebQueries,
    );
  const ted = highRecall
    ? highRecall.waves.flatMap((wave) => wave.tedPartitions)
    : chooseDiverse(
      source.filter((item) => item.providerKind === "TED"),
      budget.maximumTedRequests,
    );
  const selectedPartitions = [...web, ...ted];
  assertValidPartitionPriorities(selectedPartitions);
  const saturation = discoverySaturation(input.recentFreshYields || []);
  const selectedUnusedCount =
    selectedPartitions.filter((item) => !history.has(item.partitionKey)).length;
  return {
    version: highRecall
      ? "UNIVERSAL_HIGH_RECALL_V2"
      : input.adaptiveIntelligence
      ? "ADAPTIVE_MEDICAL_RETRIEVAL_V1"
      : "BUYER_DISCOVERY_VNEXT_1",
    runMode: input.runMode,
    productProfile,
    budget,
    selectedPartitions,
    publicWebQueries: highRecall
      ? highRecall.waves.flatMap((wave) => wave.publicWebQueries)
      : web.map((item, index) => ({
        ...item.publicWebQuery!,
        variant: index,
      })),
    tedPartitions: ted,
    unusedPartitionsRemaining: Math.max(
      0,
      unused.length - selectedUnusedCount,
    ),
    stalePartitionsRevisited:
      selectedPartitions.filter((item) => history.has(item.partitionKey))
        .length,
    saturation,
    adaptive: input.adaptiveIntelligence
      ? {
        enabled: true,
        activeStage,
        stageStopReason,
        sufficientDirectProspects:
          BUYER_DISCOVERY_VNEXT_LIMITS.adaptiveSufficientDirectProspects,
        generatedTermCounts: {
          commercial_synonyms:
            input.adaptiveIntelligence.commercial_synonyms.length,
          clinical_contexts:
            input.adaptiveIntelligence.clinical_contexts.length,
          procurement_terms:
            input.adaptiveIntelligence.procurement_terms.length,
          channel_archetypes:
            input.adaptiveIntelligence.channel_archetypes.length,
          adjacent_commercial_terms:
            input.adaptiveIntelligence.adjacent_commercial_terms.length,
          localized_terms: input.adaptiveIntelligence.localized_terms.length,
        },
        negativeContexts: input.adaptiveIntelligence.negative_contexts,
      }
      : undefined,
    highRecall,
  };
}

export function assertValidPartitionPriorities(
  partitions: Array<Pick<SearchSpacePartition, "priority">>,
): void {
  if (
    partitions.some((partition) =>
      typeof partition.priority !== "number" ||
      !Number.isFinite(partition.priority) ||
      !Number.isInteger(partition.priority) ||
      partition.priority < 0 || partition.priority > 200
    )
  ) {
    throw new Error("DISCOVERY_PARTITION_PRIORITY_INVALID");
  }
}

export function buildPartitionPersistenceRows(
  searchSpaceId: string,
  partitions: SearchSpacePartition[],
): PartitionPersistenceRow[] {
  assertValidPartitionPriorities(partitions);
  return partitions.map((partition) => ({
    search_space_id: searchSpaceId,
    partition_key: partition.partitionKey,
    provider_kind: partition.providerKind,
    partition_type: partition.partitionType,
    terminology: partition.terminology,
    language_code: partition.language,
    country_codes: partition.countryCodes,
    market_region: partition.marketRegion,
    buyer_archetype: partition.buyerArchetype,
    retrieval_kind: partition.retrievalKind,
    priority: partition.priority,
  }));
}

export function discoverySaturation(
  recentFreshYields: number[],
): "NONE" | "DECLINING_YIELD" | "ZERO_RECENT_YIELD" {
  const yields = recentFreshYields.slice(-3);
  return yields.length >= 2 && yields.slice(-2).every((value) => value === 0)
    ? "ZERO_RECENT_YIELD"
    : yields.length >= 3 && yields[0] > yields[1] && yields[1] > yields[2]
    ? "DECLINING_YIELD"
    : "NONE";
}

export function classifyDiscoveryResultState(input: {
  priorEvidenceFingerprint?: string | null;
  currentEvidenceFingerprint: string;
}): DiscoveryResultState {
  if (!input.priorEvidenceFingerprint) return "NEW";
  return input.priorEvidenceFingerprint === input.currentEvidenceFingerprint
    ? "PREVIOUSLY_DISCOVERED"
    : "UPDATED";
}

export function orderDiscoveryStates<
  T extends { discoveryState: DiscoveryResultState },
>(
  values: T[],
): T[] {
  const priority: Record<DiscoveryResultState, number> = {
    NEW: 0,
    UPDATED: 1,
    PREVIOUSLY_DISCOVERED: 2,
  };
  return [...values].sort((left, right) =>
    priority[left.discoveryState] - priority[right.discoveryState]
  );
}

export function freshDiscoveryMessage(input: {
  newBuyers: number;
  updatedBuyers: number;
  previousBuyers: number;
  cumulativeBuyers: number;
}): string {
  if (input.newBuyers === 0 && input.updatedBuyers === 0) {
    return `No additional verified buyers found in this search. ${input.previousBuyers} previous buyers remain available.`;
  }
  return `${input.newBuyers} new verified buyers found; ${input.updatedBuyers} previously discovered companies have new evidence; ${input.previousBuyers} previous buyers remain available. Total verified buyers discovered: ${input.cumulativeBuyers}.`;
}

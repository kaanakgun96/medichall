import {
  type BuyerArchetype,
  type ProductFamilyProfile,
  type ProductRetrievalTerm,
  reviewedEquipmentCoverTerms,
} from "./buyer-discovery-relevance-v2.ts";
import type { PublicWebSearchQuery } from "./public-web-discovery.ts";

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
  publicWebQuery?: PublicWebSearchQuery;
};

export type SearchPartitionHistory = {
  partitionKey: string;
  lastExploredAt: string;
  executions: number;
  newBuyerYield: number;
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

export type DiscoverySearchPlan = {
  version: "BUYER_DISCOVERY_VNEXT_1";
  runMode: DiscoveryRunMode;
  productProfile: ProductMarketProfile;
  budget: AdaptiveDiscoveryBudget;
  selectedPartitions: SearchSpacePartition[];
  publicWebQueries: PublicWebSearchQuery[];
  tedPartitions: SearchSpacePartition[];
  unusedPartitionsRemaining: number;
  stalePartitionsRevisited: number;
  saturation: "NONE" | "DECLINING_YIELD" | "ZERO_RECENT_YIELD";
};

export const BUYER_DISCOVERY_VNEXT_LIMITS = Object.freeze({
  maximumGeneratedPartitions: 240,
  maximumTrackedTerms: 24,
  maximumTrackedCountries: 32,
  partitionStaleDays: 14,
  adminFreshRunsPerDay: 50,
  braveRequestCostUsd: 0.005,
  maximumPublicWebQueries: 10,
  maximumTedRequests: 6,
  maximumWebsiteVerificationRequests: 6,
  maximumRawPublicWebObservations: 60,
  maximumCandidatePool: 180,
  maximumDisplayedBuyers: 30,
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
  const temporary = profile.temporaryIntent?.retrievalTerms.find((item) =>
    semanticTerm(item.term) === semanticTerm(term)
  );
  if (temporary) return temporary.language;
  if (profile.equipmentCoverKind) {
    for (const language of ["it", "fr", "de", "es", "nl"]) {
      if (
        reviewedEquipmentCoverTerms(profile.equipmentCoverKind, language).some(
          (item) => semanticTerm(item) === semanticTerm(term),
        )
      ) return language;
    }
  }
  return "en";
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
      countries: MARKETS.filter((market) => market.language === language).map(
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
    values.push("PROCEDURE_PACK_MANUFACTURER", "KIT_ASSEMBLER");
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
    selected.push({
      region,
      country,
      language: "en",
      uiLanguage: "en-GB",
      medicalContext: "medical",
    });
  }
  return selected.slice(
    0,
    BUYER_DISCOVERY_VNEXT_LIMITS.maximumTrackedCountries,
  );
}

function buildUniverse(input: {
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  cpvCodes: string[];
}): SearchSpacePartition[] {
  const terms = trustedTerms(input.productFamily);
  const markets = marketsFor(input.targetCountries);
  const productProfile = classifyProductMarketProfile(input.productFamily);
  const archetypes = archetypesFor(productProfile, input.productFamily);
  const web: SearchSpacePartition[] = [];
  const seenWeb = new Set<string>();
  for (const term of terms) {
    const termMarkets = markets.filter((market) =>
      term.language === "en" || market.language === term.language
    );
    for (
      const market of termMarkets.length ? termMarkets : markets.slice(0, 1)
    ) {
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
          Number(archetype === "DISTRIBUTOR" || archetype === "IMPORTER") * 6 -
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
            }" ${market.medicalContext} ${archetypeTerm}`
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
    for (const market of markets) {
      if (term.language !== "en" && term.language !== market.language) continue;
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
    languages: new Set<string>(),
    regions: new Set<string>(),
    archetypes: new Set<string>(),
    terms: new Set<string>(),
  };
  const remaining = [...candidates];
  while (remaining.length && selected.length < maximum) {
    remaining.sort((left, right) => {
      const diversity = (item: SearchSpacePartition) =>
        Number(!dimensions.languages.has(item.language)) * 12 +
        Number(!dimensions.regions.has(item.marketRegion)) * 10 +
        Number(!dimensions.archetypes.has(item.buyerArchetype)) * 6 +
        Number(!dimensions.terms.has(semanticTerm(item.terminology[0] || ""))) *
          8;
      return right.priority + diversity(right) - left.priority -
          diversity(left) ||
        left.partitionKey.localeCompare(right.partitionKey);
    });
    const next = remaining.shift()!;
    selected.push(next);
    dimensions.languages.add(next.language);
    dimensions.regions.add(next.marketRegion);
    dimensions.archetypes.add(next.buyerArchetype);
    dimensions.terms.add(semanticTerm(next.terminology[0] || ""));
  }
  return selected;
}

export function buildDiscoverySearchPlan(input: {
  runMode: DiscoveryRunMode;
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  cpvCodes: string[];
  history?: SearchPartitionHistory[];
  recentFreshYields?: number[];
  now?: Date;
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
  const source = fresh ? [...unused, ...stale] : universe;
  const web = chooseDiverse(
    source.filter((item) => item.providerKind === "PUBLIC_WEB"),
    budget.maximumPublicWebQueries,
  );
  const ted = chooseDiverse(
    source.filter((item) => item.providerKind === "TED"),
    budget.maximumTedRequests,
  );
  const selectedPartitions = [...web, ...ted];
  const saturation = discoverySaturation(input.recentFreshYields || []);
  const selectedUnusedCount =
    selectedPartitions.filter((item) => !history.has(item.partitionKey)).length;
  return {
    version: "BUYER_DISCOVERY_VNEXT_1",
    runMode: input.runMode,
    productProfile,
    budget,
    selectedPartitions,
    publicWebQueries: web.map((item, index) => ({
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
  };
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

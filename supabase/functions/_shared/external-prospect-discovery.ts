import {
  archetypeLabel,
  type BuyerArchetypeSignal,
  type CandidateCompatibility,
  diversityRerank,
  evaluateCandidateCompatibility,
  type ProductEvidenceClass,
  type ProductFamilyProfile,
} from "./buyer-discovery-relevance-v2.ts";

export const DISCOVERY_LIMITS = Object.freeze({
  maximumQueries: 4,
  maximumTedRequests: 6,
  maximumTedResultsPerQuery: 25,
  maximumCandidatePool: 180,
  maximumCandidates: 30,
  maximumWebsiteChecks: 6,
  maximumRegistryChecks: 10,
  requestTimeoutMs: 12_000,
});

export type EvidenceSourceType =
  | "COMPANY_WEBSITE"
  | "PRODUCT_CATALOGUE"
  | "TED_AWARD"
  | "ASSOCIATION_DIRECTORY"
  | "EXHIBITOR_DIRECTORY"
  | "PUBLIC_REGISTRY"
  | "OTHER_PUBLIC_SOURCE";

export type EvidenceKind =
  | "DIRECT_PRODUCT_EVIDENCE"
  | "INDIRECT_COMMERCIAL_EVIDENCE"
  | "WEAK_CONTEXT";

export type ActivitySignal = {
  providerCode: string;
  countryCode: string;
  registryIdentifier: string | null;
  nationalCode: string;
  nationalClassification: string;
  description: string;
  normalizedNaceCode: string | null;
  naceRevision: "NACE_REV_2" | "NACE_REV_2_1" | "NATIONAL_ONLY";
  mappingConfidence: "HIGH" | "MEDIUM" | "LOW" | "UNMAPPED";
  normalizedClass:
    | "PHARMACEUTICAL_WHOLESALE"
    | "MEDICAL_EQUIPMENT_WHOLESALE"
    | "MEDICAL_DEVICE_DISTRIBUTION"
    | "HEALTHCARE_SUPPLIES"
    | "HOSPITAL_EQUIPMENT_SUPPLY"
    | "MEDICAL_IMPORT_EXPORT"
    | "OTHER_RELEVANT"
    | "NON_MATCH";
  strength: "STRONG_INDIRECT" | "WEAK_INDIRECT" | "NON_MATCH";
  effectiveFrom: string | null;
};

type ActivityCodeMapping = Pick<
  ActivitySignal,
  | "normalizedNaceCode"
  | "naceRevision"
  | "mappingConfidence"
  | "normalizedClass"
  | "strength"
>;

const NATIONAL_ACTIVITY_CODE_MAPPINGS: Record<string, ActivityCodeMapping> = {
  // France / Norway existing production mappings.
  "NAF_APE:4646Z": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "PHARMACEUTICAL_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "SN2007:4646": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "PHARMACEUTICAL_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "SN2025:46460": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2_1",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  // National classifications reviewed against their official classifications.
  "WZ_2008:46462": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "ATECO_2025:464639": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2_1",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "CNAE_2009:4646": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "PHARMACEUTICAL_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "SBI_2008:46461": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "PHARMACEUTICAL_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "SBI_2008:46462": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "NACE_BEL_2008:46460": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "PHARMACEUTICAL_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "NACE_BEL_2025:46460": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2_1",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "PKD_2007:4646Z": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
  "PKD_2025:4646Z": {
    normalizedNaceCode: "46.46",
    naceRevision: "NACE_REV_2_1",
    mappingConfidence: "HIGH",
    normalizedClass: "MEDICAL_EQUIPMENT_WHOLESALE",
    strength: "STRONG_INDIRECT",
  },
};

function structuredField(value: unknown, maximum: number): string {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim()
    .slice(0, maximum);
}

function activityCodeKey(classification: string, code: string): string {
  const system = classification.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const compactCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${system}:${compactCode}`;
}

export function nationalActivityCodeMapping(
  classification: string,
  code: string,
): ActivityCodeMapping | null {
  return NATIONAL_ACTIVITY_CODE_MAPPINGS[
    activityCodeKey(classification, code)
  ] || null;
}

export type ProspectEvidence = {
  sourceType: EvidenceSourceType;
  sourceUrl: string;
  sourceDomain: string;
  title: string;
  snippet: string;
  evidenceKind: EvidenceKind;
  confidence: number;
  evidenceDate: string | null;
  noticeId?: string | null;
  procurementBuyer?: string | null;
  lotContext?: string | null;
  cpvCodes?: string[];
  taxonomyIds?: number[];
  registryProviderCode?: string;
  relevanceClass?: ProductEvidenceClass;
  matchedTerms?: string[];
  commercialReason?: string;
};

export type ProspectCandidate = {
  name: string;
  countryCode: string | null;
  countryName: string | null;
  cityRegion: string | null;
  companyType:
    | "Distributor"
    | "Wholesaler"
    | "Importer"
    | "Hospital supplier"
    | "Reseller"
    | "Manufacturer"
    | "Mixed"
    | "Unknown";
  websiteUrl: string | null;
  registryIdentifier: string | null;
  description: string | null;
  evidence: ProspectEvidence[];
  activities: ActivitySignal[];
  taxonomyIds: number[];
  taxonomyRelation: "exact" | "parent_child" | "sibling" | "family" | "none";
  targetCountry: boolean;
  preferredCompanyType: boolean;
  relatedAwardCount: number;
  lastEvidenceAt: string | null;
  buyerArchetypes?: BuyerArchetypeSignal[];
};

export type ProspectScore = {
  eligible: boolean;
  relevanceScore: number;
  productTaxonomyScore: number;
  geographyScore: number;
  companyTypeScore: number;
  procurementSignalScore: number;
  evidenceQualityScore: number;
  recencyScore: number;
  directEvidenceCount: number;
  adjacentEvidenceCount: number;
  genericEvidenceCount: number;
  independentIndirectSourceCount: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  commercialFitClassification:
    | "DIRECT_PRODUCT_FIT"
    | "ADJACENT_COMMERCIAL_FIT"
    | "GENERIC_ONLY"
    | "PRODUCT_FAMILY_MISMATCH";
  commercialReason: string;
  buyerArchetypes: BuyerArchetypeSignal[];
  genericOnlyCeilingApplied: boolean;
  reasonSummary: string;
  reasons: Array<{
    kind: EvidenceKind;
    text: string;
    code?: string;
    evidenceClass?: ProductEvidenceClass;
    buyerArchetype?: string;
    confidence?: "HIGH" | "MEDIUM" | "LOW";
  }>;
};

export type RankedProspect = {
  candidate: ProspectCandidate;
  score: ProspectScore;
};

export type ProspectRankingDiagnostics = {
  candidatesByCountry: Record<string, number>;
  acceptedByCountry: Record<string, number>;
  candidatesBySource: Record<string, number>;
  evidenceByClass: Record<ProductEvidenceClass, number>;
  buyerArchetypes: Record<string, number>;
  genericOnlyRejected: number;
  productFamilyMismatchRejected: number;
  diversityTieBreaksApplied: number;
};

const EMAIL_PATTERN = /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /\+?\d[\d ()/.\-]{6,}\d/g;

export function sanitizeEvidenceText(value: unknown, maximum = 1600): string {
  return String(value ?? "")
    .replace(EMAIL_PATTERN, "[private contact]")
    .replace(PHONE_PATTERN, "[private contact]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function normalizeCompanyName(value: unknown): string {
  return String(value ?? "").normalize("NFC").toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeHttpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.href.slice(0, 1000);
  } catch (_) {
    return null;
  }
}

export function normalizeDomain(value: unknown): string | null {
  const url = normalizeHttpsUrl(value);
  if (!url) return null;
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

export function normalizeCpv(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

export function boundedDiscoveryQueries(input: {
  cpvCodes: string[];
  targetCountries: string[];
  taxonomyNames: string[];
}): string[] {
  const cpv = [...new Set(input.cpvCodes.map(normalizeCpv).filter(Boolean))]
    .slice(0, 3) as string[];
  const terms = [
    ...new Set(
      input.taxonomyNames.map((item) => sanitizeEvidenceText(item, 80)).filter(
        Boolean,
      ),
    ),
  ].slice(0, 2);
  // Country is deliberately scored after retrieval. Winner-country values are
  // not uniformly populated and filtering here would hide valid awardees.
  const queries = cpv.map((code) => `(classification-cpv IN (${code}))`);
  for (const term of terms) {
    if (queries.length >= DISCOVERY_LIMITS.maximumQueries) break;
    const safeTerm = term.replace(/["\\]/g, " ").trim();
    queries.push(
      `(notice-title ~ "${safeTerm}" OR description-lot ~ "${safeTerm}")`,
    );
  }
  return queries.slice(0, DISCOVERY_LIMITS.maximumQueries);
}

export const EUROPE_DISCOVERY_COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  "TR",
] as const;

const ISO3_BY_ISO2: Record<string, string> = {
  AT: "AUT",
  BE: "BEL",
  BG: "BGR",
  CH: "CHE",
  CY: "CYP",
  CZ: "CZE",
  DE: "DEU",
  DK: "DNK",
  EE: "EST",
  ES: "ESP",
  FI: "FIN",
  FR: "FRA",
  GB: "GBR",
  GR: "GRC",
  HR: "HRV",
  HU: "HUN",
  IE: "IRL",
  IS: "ISL",
  IT: "ITA",
  LT: "LTU",
  LU: "LUX",
  LV: "LVA",
  MT: "MLT",
  NL: "NLD",
  NO: "NOR",
  PL: "POL",
  PT: "PRT",
  RO: "ROU",
  SE: "SWE",
  SI: "SVN",
  SK: "SVK",
  TR: "TUR",
};

export type TedSearchPlanEntry = {
  query: string;
  countries: string[];
};

export function boundedTedSearchPlan(input: {
  queries: string[];
  targetCountries: string[];
}): TedSearchPlanEntry[] {
  const productQueries = input.queries.slice(
    0,
    DISCOVERY_LIMITS.maximumQueries,
  );
  if (!productQueries.length) return [];
  // A broad medical CPV is a useful fallback and a scoring signal, but it must
  // not swamp a product-specific search with generic suppliers. When a
  // canonical or reviewed family-term query exists, retrieve with those terms
  // and retain CPV values on the returned evidence for downstream scoring.
  const descriptiveQueries = productQueries.filter((query) =>
    query.includes("notice-title") || query.includes("description-lot")
  );
  const retrievalQueries = descriptiveQueries.length
    ? descriptiveQueries
    : productQueries;
  const selected = input.targetCountries.length
    ? [...new Set(input.targetCountries.map((item) => item.toUpperCase()))]
      .filter((item) => ISO3_BY_ISO2[item])
    : [...EUROPE_DISCOVERY_COUNTRIES];
  const batchCount = Math.min(
    DISCOVERY_LIMITS.maximumTedRequests,
    Math.max(1, selected.length),
  );
  const batches = Array.from({ length: batchCount }, () => [] as string[]);
  selected.forEach((country, index) =>
    batches[index % batchCount].push(country)
  );
  const productClause = retrievalQueries.length === 1
    ? retrievalQueries[0]
    : retrievalQueries.map((query) => `(${query})`).join(" OR ");
  return batches.filter((batch) => batch.length).map((batch) => ({
    query: `(${productClause}) AND (winner-country IN (${
      batch.map((country) => ISO3_BY_ISO2[country]).join(" ")
    }))`,
    countries: batch,
  }));
}

export function normalizeActivitySignal(input: {
  providerCode: string;
  countryCode: string;
  registryIdentifier?: string | null;
  nationalCode: string;
  nationalClassification: string;
  description: string;
  naceCode?: string | null;
  naceRevision?: "NACE_REV_2" | "NACE_REV_2_1" | "NATIONAL_ONLY";
  mappingConfidence?: "HIGH" | "MEDIUM" | "LOW" | "UNMAPPED";
  effectiveFrom?: string | null;
}): ActivitySignal {
  const reviewedMapping = nationalActivityCodeMapping(
    input.nationalClassification,
    input.nationalCode,
  );
  const code = String(input.naceCode || input.nationalCode).toUpperCase()
    .replace(/[^0-9.]/g, "").replace(/^(\d{2})(\d{2})$/, "$1.$2");
  const description = sanitizeEvidenceText(input.description, 500);
  const searchable = `${code} ${description}`.toLowerCase();
  let normalizedClass: ActivitySignal["normalizedClass"] =
    reviewedMapping?.normalizedClass || "NON_MATCH";
  let strength: ActivitySignal["strength"] = reviewedMapping?.strength ||
    "NON_MATCH";
  if (reviewedMapping) {
    // Exact national-code correspondences win over translated/free-text words.
  } else if (
    /46\.46|pharmaceutical.+wholesale|wholesale.+pharmaceutical/.test(
      searchable,
    )
  ) {
    normalizedClass = "PHARMACEUTICAL_WHOLESALE";
    strength = "STRONG_INDIRECT";
  } else if (
    /medical device.+distribut|distribut.+medical device/.test(searchable)
  ) {
    normalizedClass = "MEDICAL_DEVICE_DISTRIBUTION";
    strength = "STRONG_INDIRECT";
  } else if (
    /medical|surgical|hospital|healthcare/.test(searchable) &&
    /wholesale|distribut|supplier|equipment/.test(searchable)
  ) {
    normalizedClass = "MEDICAL_EQUIPMENT_WHOLESALE";
    strength = "STRONG_INDIRECT";
  } else if (/medical|healthcare|hospital/.test(searchable)) {
    normalizedClass = "HEALTHCARE_SUPPLIES";
    strength = "WEAK_INDIRECT";
  } else if (/import|export|wholesale|distribut/.test(searchable)) {
    normalizedClass = "OTHER_RELEVANT";
    strength = "WEAK_INDIRECT";
  }
  return {
    providerCode: String(input.providerCode).toUpperCase().replace(
      /[^A-Z0-9_]/g,
      "_",
    ).slice(0, 80),
    countryCode: String(input.countryCode).toUpperCase().slice(0, 2),
    registryIdentifier: input.registryIdentifier
      ? structuredField(input.registryIdentifier, 240)
      : null,
    nationalCode: structuredField(input.nationalCode, 40),
    nationalClassification: sanitizeEvidenceText(
      input.nationalClassification,
      80,
    ),
    description,
    normalizedNaceCode: reviewedMapping?.normalizedNaceCode ||
      (/^\d{2}(?:\.\d{1,2})?$/.test(code) ? code : null),
    naceRevision: reviewedMapping?.naceRevision || input.naceRevision ||
      "NATIONAL_ONLY",
    mappingConfidence: reviewedMapping?.mappingConfidence ||
      input.mappingConfidence ||
      (/^\d{2}(?:\.\d{1,2})?$/.test(code) ? "MEDIUM" : "UNMAPPED"),
    normalizedClass,
    strength,
    effectiveFrom: input.effectiveFrom || null,
  };
}

function ageInDays(value: string | null, now: Date): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    ? Math.max(0, (now.getTime() - timestamp) / 86_400_000)
    : null;
}

export function scoreProspect(
  candidate: ProspectCandidate,
  now = new Date(),
  productFamily?: ProductFamilyProfile,
): ProspectScore {
  const compatibility: CandidateCompatibility = productFamily
    ? evaluateCandidateCompatibility(candidate, productFamily)
    : {
      candidate,
      directEvidence: candidate.evidence.filter((item) =>
        item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE" &&
        item.confidence >= 0.7
      ).map((item) => ({ ...item, relevanceClass: "DIRECT" })),
      adjacentEvidence: candidate.evidence.filter((item) =>
        item.evidenceKind === "INDIRECT_COMMERCIAL_EVIDENCE" &&
        item.confidence >= 0.65 && item.sourceType !== "PUBLIC_REGISTRY"
      ).map((item) => ({ ...item, relevanceClass: "ADJACENT" })),
      genericEvidence: candidate.evidence.filter((item) =>
        item.evidenceKind === "WEAK_CONTEXT" ||
        item.sourceType === "PUBLIC_REGISTRY"
      ).map((item) => ({ ...item, relevanceClass: "GENERIC" })),
      directConceptCount:
        candidate.evidence.filter((item) =>
          item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE" &&
          item.confidence >= 0.7
        ).length,
      adjacentConceptCount:
        candidate.evidence.filter((item) =>
          item.evidenceKind === "INDIRECT_COMMERCIAL_EVIDENCE" &&
          item.confidence >= 0.65 && item.sourceType !== "PUBLIC_REGISTRY"
        ).length,
      independentDirectSourceCount: new Set(
        candidate.evidence.filter((item) =>
          item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE"
        ).map((item) => `${item.sourceType}:${item.sourceDomain}`),
      ).size,
      independentAdjacentSourceCount: new Set(
        candidate.evidence.filter((item) =>
          item.evidenceKind === "INDIRECT_COMMERCIAL_EVIDENCE" &&
          item.sourceType !== "PUBLIC_REGISTRY"
        ).map((item) => `${item.sourceType}:${item.sourceDomain}`),
      ).size,
      archetypes: candidate.buyerArchetypes || [],
      commercialReason:
        candidate.evidence.some((item) =>
            item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE"
          )
          ? "Direct product-family buyer"
          : "Adjacent commercial fit",
      classification:
        candidate.evidence.some((item) =>
            item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE"
          )
          ? "DIRECT_PRODUCT_FIT"
          : candidate.evidence.some((item) =>
              item.evidenceKind === "INDIRECT_COMMERCIAL_EVIDENCE" &&
              item.sourceType !== "PUBLIC_REGISTRY"
            )
          ? "ADJACENT_COMMERCIAL_FIT"
          : "GENERIC_ONLY",
      mismatch: false,
    };
  const scoredCandidate = compatibility.candidate;
  const direct = compatibility.directEvidence.filter((item) =>
    item.confidence >= 0.7
  );
  const adjacent = compatibility.adjacentEvidence.filter((item) =>
    item.confidence >= 0.65
  );
  const strongActivities = candidate.activities.filter((item) =>
    item.strength === "STRONG_INDIRECT"
  );
  const indirectSources = new Set(
    adjacent.map((item) => `${item.sourceType}:${item.sourceDomain}`),
  );
  const strongAdjacentArchetype = compatibility.archetypes.some((item) =>
    item.strength === "HIGH" && item.archetype !== "UNKNOWN"
  );
  const eligible = direct.length >= 1 ||
    compatibility.independentAdjacentSourceCount >= 2 ||
    (compatibility.adjacentConceptCount >= 2 && strongAdjacentArchetype) ||
    (adjacent.some((item) => item.confidence >= 0.85) &&
      strongAdjacentArchetype);

  let productTaxonomyScore = 0;
  if (direct.length) {
    productTaxonomyScore = scoredCandidate.taxonomyRelation === "exact"
      ? 40
      : scoredCandidate.taxonomyRelation === "parent_child"
      ? 36
      : 34;
  } else if (compatibility.adjacentConceptCount >= 3) {
    productTaxonomyScore = 32;
  } else if (compatibility.adjacentConceptCount >= 2) {
    productTaxonomyScore = 28;
  } else if (adjacent.length) productTaxonomyScore = 22;

  const geographyScore = scoredCandidate.targetCountry
    ? 10
    : scoredCandidate.countryCode
    ? 4
    : 0;
  const archetypeStrength = compatibility.archetypes.reduce(
    (highest, item) =>
      Math.max(
        highest,
        item.strength === "HIGH" ? 15 : item.strength === "MEDIUM" ? 11 : 2,
      ),
    0,
  );
  const companyTypeScore = eligible
    ? Math.min(
      15,
      archetypeStrength || (scoredCandidate.preferredCompanyType ? 8 : 4),
    )
    : scoredCandidate.companyType === "Unknown"
    ? 0
    : 2;
  const relevantProcurementCount = new Set(
    [
      ...direct,
      ...adjacent,
    ].filter((item) => item.sourceType === "TED_AWARD").map((item) =>
      item.noticeId || item.sourceUrl
    ),
  ).size;
  const procurementSignalScore = relevantProcurementCount >= 2
    ? 15
    : relevantProcurementCount === 1
    ? 10
    : 0;
  const independentCount = new Set(
    [...direct, ...adjacent].map((item) =>
      `${item.sourceType}:${item.sourceDomain}`
    ),
  ).size;
  const evidenceQualityScore = direct.length && independentCount >= 2
    ? 10
    : direct.length
    ? 8
    : compatibility.independentAdjacentSourceCount >= 2
    ? 9
    : compatibility.adjacentConceptCount >= 2
    ? 7
    : adjacent.length
    ? 5
    : strongActivities.length
    ? 2
    : 0;
  const age = ageInDays(scoredCandidate.lastEvidenceAt, now);
  const recencyScore = age == null
    ? 0
    : age <= 90
    ? 5
    : age <= 365
    ? 3
    : age <= 730
    ? 1
    : 0;
  let relevanceScore = productTaxonomyScore + geographyScore +
    companyTypeScore + procurementSignalScore + evidenceQualityScore +
    recencyScore;
  const genericOnlyCeilingApplied =
    compatibility.classification === "GENERIC_ONLY" ||
    compatibility.classification === "PRODUCT_FAMILY_MISMATCH";
  if (genericOnlyCeilingApplied) relevanceScore = Math.min(42, relevanceScore);

  const reasons: ProspectScore["reasons"] = [];
  if (direct.length) {
    reasons.push({
      kind: "DIRECT_PRODUCT_EVIDENCE",
      code: "DIRECT_PRODUCT_FIT",
      evidenceClass: "DIRECT",
      text: "Direct public evidence supports the selected product family.",
    });
  } else if (adjacent.length) {
    reasons.push({
      kind: "INDIRECT_COMMERCIAL_EVIDENCE",
      code: "ADJACENT_COMMERCIAL_FIT",
      evidenceClass: "ADJACENT",
      text:
        `${compatibility.commercialReason}. This is commercial-fit evidence; exact current product availability is not claimed.`,
    });
  }
  const bestArchetype = compatibility.archetypes.find((item) =>
    item.archetype !== "UNKNOWN"
  );
  if (bestArchetype) {
    reasons.push({
      kind: "INDIRECT_COMMERCIAL_EVIDENCE",
      code: "BUYER_ARCHETYPE",
      evidenceClass: direct.length ? "DIRECT" : "ADJACENT",
      buyerArchetype: bestArchetype.archetype,
      text: `${
        archetypeLabel(bestArchetype.archetype)
      }: ${bestArchetype.reason}.`,
    });
  }
  if (relevantProcurementCount) {
    reasons.push({
      kind: direct.some((item) => item.sourceType === "TED_AWARD")
        ? "DIRECT_PRODUCT_EVIDENCE"
        : "INDIRECT_COMMERCIAL_EVIDENCE",
      code: "RELEVANT_PROCUREMENT",
      evidenceClass: direct.some((item) => item.sourceType === "TED_AWARD")
        ? "DIRECT"
        : "ADJACENT",
      text:
        `${relevantProcurementCount} product-relevant public procurement award signal${
          relevantProcurementCount === 1 ? "" : "s"
        } support commercial capability.`,
    });
  }
  if (strongActivities.length) {
    reasons.push({
      kind: "WEAK_CONTEXT",
      code: "REGISTRY_SUPPORT",
      evidenceClass: "GENERIC",
      text:
        "Official registry activity supports company type only; it is not product evidence.",
    });
  }
  if (genericOnlyCeilingApplied) {
    reasons.push({
      kind: "WEAK_CONTEXT",
      code: compatibility.classification,
      evidenceClass: "GENERIC",
      text: compatibility.mismatch
        ? "Available evidence points to a different product family."
        : "Generic healthcare relevance cannot establish product-family fit.",
    });
  }
  if (scoredCandidate.targetCountry) {
    reasons.push({
      kind: "WEAK_CONTEXT",
      code: "TARGET_GEOGRAPHY",
      evidenceClass: "GENERIC",
      text: "Located in a selected target geography.",
    });
  }
  const confidence: ProspectScore["confidence"] =
    eligible && relevanceScore >= 75
      ? "HIGH"
      : eligible && relevanceScore >= 55
      ? "MEDIUM"
      : "LOW";
  reasons.unshift({
    kind: direct.length
      ? "DIRECT_PRODUCT_EVIDENCE"
      : adjacent.length
      ? "INDIRECT_COMMERCIAL_EVIDENCE"
      : "WEAK_CONTEXT",
    code: "COMMERCIAL_FIT",
    evidenceClass: direct.length
      ? "DIRECT"
      : adjacent.length
      ? "ADJACENT"
      : "GENERIC",
    buyerArchetype: bestArchetype?.archetype,
    confidence,
    text: compatibility.commercialReason,
  });
  return {
    eligible,
    relevanceScore,
    productTaxonomyScore,
    geographyScore,
    companyTypeScore,
    procurementSignalScore,
    evidenceQualityScore,
    recencyScore,
    directEvidenceCount: direct.length,
    adjacentEvidenceCount: adjacent.length,
    genericEvidenceCount: compatibility.genericEvidence.length,
    independentIndirectSourceCount: indirectSources.size,
    confidence,
    commercialFitClassification: compatibility.classification,
    commercialReason: compatibility.commercialReason,
    buyerArchetypes: compatibility.archetypes,
    genericOnlyCeilingApplied,
    reasonSummary: reasons.map((item) => item.text).join(" ").slice(0, 1200) ||
      "Evidence is insufficient for a supported prospect recommendation.",
    reasons,
  };
}

export function deduplicateCandidates(
  candidates: ProspectCandidate[],
  registered: Array<
    { id: number; name: string; website: string | null; country: string | null }
  > = [],
): {
  candidates: ProspectCandidate[];
  registeredDuplicates: number;
  externalDuplicates: number;
} {
  const registeredDomains = new Set(
    registered.map((item) => normalizeDomain(item.website)).filter(Boolean),
  );
  const registeredNames = new Set(
    registered.map((item) =>
      `${normalizeCompanyName(item.name)}:${
        String(item.country || "").toUpperCase()
      }`
    ),
  );
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const seenRegistries = new Set<string>();
  const output: ProspectCandidate[] = [];
  let registeredDuplicates = 0;
  let externalDuplicates = 0;
  for (const candidate of candidates) {
    const domain = normalizeDomain(candidate.websiteUrl);
    const nameKey = `${normalizeCompanyName(candidate.name)}:${
      String(candidate.countryCode || candidate.countryName || "").toUpperCase()
    }`;
    if (
      (domain && registeredDomains.has(domain)) || registeredNames.has(nameKey)
    ) {
      registeredDuplicates += 1;
      continue;
    }
    const registryKey = candidate.registryIdentifier && candidate.countryCode
      ? `${candidate.countryCode}:${candidate.registryIdentifier}`
      : null;
    if (
      (domain && seenDomains.has(domain)) || seenNames.has(nameKey) ||
      (registryKey && seenRegistries.has(registryKey))
    ) {
      externalDuplicates += 1;
      continue;
    }
    if (domain) seenDomains.add(domain);
    seenNames.add(nameKey);
    if (registryKey) seenRegistries.add(registryKey);
    output.push(candidate);
    if (output.length >= DISCOVERY_LIMITS.maximumCandidatePool) break;
  }
  return { candidates: output, registeredDuplicates, externalDuplicates };
}

function increment(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] || 0) + 1;
}

export function rankProspects(
  candidates: ProspectCandidate[],
  productFamily: ProductFamilyProfile,
  options: { europeWide?: boolean; now?: Date } = {},
): {
  accepted: RankedProspect[];
  rejected: RankedProspect[];
  diagnostics: ProspectRankingDiagnostics;
} {
  const diagnostics: ProspectRankingDiagnostics = {
    candidatesByCountry: {},
    acceptedByCountry: {},
    candidatesBySource: {},
    evidenceByClass: { DIRECT: 0, ADJACENT: 0, GENERIC: 0 },
    buyerArchetypes: {},
    genericOnlyRejected: 0,
    productFamilyMismatchRejected: 0,
    diversityTieBreaksApplied: 0,
  };
  const ranked = candidates.map((candidate) => {
    const compatibility = evaluateCandidateCompatibility(
      candidate,
      productFamily,
    );
    const enriched = {
      ...compatibility.candidate,
      buyerArchetypes: compatibility.archetypes,
      taxonomyIds: compatibility.directEvidence.length ||
          compatibility.adjacentEvidence.length
        ? candidate.taxonomyIds
        : [],
      taxonomyRelation: compatibility.directEvidence.length
        ? candidate.taxonomyRelation === "none"
          ? "exact" as const
          : candidate.taxonomyRelation
        : compatibility.adjacentEvidence.length
        ? "family" as const
        : "none" as const,
    };
    increment(
      diagnostics.candidatesByCountry,
      enriched.countryCode || "UNKNOWN",
    );
    for (
      const source of new Set(enriched.evidence.map((item) => item.sourceType))
    ) {
      increment(diagnostics.candidatesBySource, source);
    }
    for (const evidence of enriched.evidence) {
      diagnostics.evidenceByClass[evidence.relevanceClass || "GENERIC"] += 1;
    }
    for (const archetype of compatibility.archetypes) {
      increment(diagnostics.buyerArchetypes, archetype.archetype);
    }
    const score = scoreProspect(
      enriched,
      options.now || new Date(),
      productFamily,
    );
    if (score.commercialFitClassification === "GENERIC_ONLY") {
      diagnostics.genericOnlyRejected += 1;
    } else if (
      score.commercialFitClassification === "PRODUCT_FAMILY_MISMATCH"
    ) {
      diagnostics.productFamilyMismatchRejected += 1;
    }
    return { candidate: enriched, score };
  }).sort((left, right) =>
    right.score.relevanceScore - left.score.relevanceScore ||
    left.candidate.name.localeCompare(right.candidate.name)
  );
  const eligible = ranked.filter((item) =>
    item.score.eligible && item.score.relevanceScore >= 55
  );
  const rejected = ranked.filter((item) =>
    !item.score.eligible || item.score.relevanceScore < 55
  );
  const accepted = options.europeWide
    ? diversityRerank(eligible.map((item) => ({
      value: item,
      score: item.score.relevanceScore,
      countryCode: item.candidate.countryCode,
    }))).map((item) => item.value)
    : eligible;
  if (options.europeWide) {
    accepted.forEach((item, index) => {
      const previousIndex = eligible.findIndex((candidate) =>
        candidate.candidate.name === item.candidate.name &&
        candidate.candidate.countryCode === item.candidate.countryCode
      );
      if (previousIndex !== index) diagnostics.diversityTieBreaksApplied += 1;
    });
  }
  const limited = accepted.slice(0, DISCOVERY_LIMITS.maximumCandidates);
  for (const item of limited) {
    increment(
      diagnostics.acceptedByCountry,
      item.candidate.countryCode || "UNKNOWN",
    );
  }
  return { accepted: limited, rejected, diagnostics };
}

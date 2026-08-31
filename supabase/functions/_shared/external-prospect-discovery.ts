import {
  archetypeLabel,
  type BuyerArchetypeSignal,
  type BuyerRoleConfidence,
  type CandidateCompatibility,
  type CommercialBuyerGrade,
  diversityRerank,
  evaluateCandidateCompatibility,
  type ProductEvidenceClass,
  type ProductFamilyProfile,
} from "./buyer-discovery-relevance-v2.ts";

export const DISCOVERY_LIMITS = Object.freeze({
  maximumTedRequests: 6,
  maximumTedProductRequests: 4,
  maximumTedCpvRequests: 2,
  maximumTedResultsPerQuery: 25,
  maximumTedDirectTerms: 12,
  maximumTedAdjacentTerms: 8,
  maximumCandidatePool: 180,
  maximumProductTedCandidates: 100,
  maximumCpvTedCandidates: 40,
  maximumRegistryCandidates: 40,
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

export type CandidateDiscoveryReason =
  | "DIRECT_PRODUCT_TERM_TED"
  | "ADJACENT_PRODUCT_TERM_TED"
  | "RELATED_CPV_TED"
  | "OFFICIAL_REGISTRY_ACTIVITY";

export type CandidateSourcePartition =
  | "PRODUCT_TED"
  | "CPV_TED"
  | "REGISTRY"
  | "PUBLIC_WEB";

export type CompanyIdentitySource =
  | "OFFICIAL_REGISTRY"
  | "TED_ECONOMIC_OPERATOR"
  | "SCHEMA_ORG"
  | "OFFICIAL_WEBSITE"
  | "PAGE_METADATA"
  | "DOMAIN_FALLBACK";

export type CompanyIdentityConfidence = "HIGH" | "MEDIUM" | "LOW";

export type OrganizationType =
  | "COMMERCIAL_COMPANY"
  | "HEALTHCARE_PROVIDER"
  | "EDITORIAL_PUBLISHER"
  | "EDUCATION_RESEARCH"
  | "UNKNOWN";

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
  discoveryReason?: CandidateDiscoveryReason;
  procurementRole?: "WINNER" | "TENDERER_FALLBACK";
  relevanceClass?: ProductEvidenceClass;
  matchedTerms?: string[];
  commercialReason?: string;
};

export type ProspectCandidate = {
  name: string;
  nameSource?: CompanyIdentitySource;
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
  // Candidate-source provenance is transient retrieval metadata. PUBLIC_WEB
  // never becomes scoring evidence; only the independently fetched official
  // page may add COMPANY_WEBSITE evidence.
  discoverySources?: CandidateSourcePartition[];
  websiteVerificationUrls?: string[];
  // Transient organization-level validation. Product/page relevance and
  // company identity are deliberately separate gates.
  organizationType?: OrganizationType;
  identityConfidence?: CompanyIdentityConfidence;
  commercialIdentityVerified?: boolean;
  editorialContent?: boolean;
};

export type ProspectScore = {
  eligible: boolean;
  relevanceScore: number;
  productTaxonomyScore: number;
  geographyScore: number;
  companyTypeScore: number;
  buyerRoleScore: number;
  buyerRoleConfidence: BuyerRoleConfidence;
  procurementSignalScore: number;
  evidenceQualityScore: number;
  recencyScore: number;
  directEvidenceCount: number;
  adjacentEvidenceCount: number;
  genericEvidenceCount: number;
  independentIndirectSourceCount: number;
  qualificationPath:
    | "OFFICIAL_WEBSITE"
    | "PUBLIC_PROCUREMENT"
    | "COMMERCIAL_ADJACENCY"
    | "COMBINED_SUPPORT"
    | "INSUFFICIENT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  // Preserve the existing persisted/UI product-fit contract. Buyer-grade is a
  // separate final acceptance dimension so this release requires no schema or
  // frontend change.
  commercialFitClassification: CandidateCompatibility["productClassification"];
  commercialBuyerGrade: CommercialBuyerGrade;
  commercialReason: string;
  buyerArchetypes: BuyerArchetypeSignal[];
  genericOnlyCeilingApplied: boolean;
  // Optional second-stage Buyer Fit fields. Deterministic ranking remains
  // authoritative; these are populated only by the separately feature-gated
  // AI Buyer Relevance Judge and are safe for older callers to ignore.
  buyerFitScore?: number;
  buyerFitGrade?: "HIGH" | "MEDIUM" | "LOW";
  aiBuyerJudgeStatus?: string;
  aiBuyerRecommendedGrade?: CommercialBuyerGrade | null;
  aiBuyerReasonCodes?: string[];
  aiBuyerShortExplanation?: string | null;
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
  directBuyers: number;
  adjacentBuyers: number;
  productRelevantNotBuyer: number;
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

const LEGAL_SUFFIX_PATTERN = new RegExp(
  "(?:^|\\s)(?:s r l|srl|s p a|spa|s a s|sas|s a|sa|gmbh|b v|bv|ltd|limited|inc|llc|a g|ag|n v|nv|plc|oy|ab|as|kft|zrt|sp z o o)$",
);
const GENERIC_IDENTITY_NAMES = new Set([
  "home",
  "homepage",
  "products",
  "product catalogue",
  "medical products",
  "camera covers",
  "company",
  "group",
  "healthcare",
  "medical",
  "contact",
  "about us",
]);
const IDENTITY_SOURCE_PRIORITY: Record<CompanyIdentitySource, number> = {
  OFFICIAL_REGISTRY: 6,
  TED_ECONOMIC_OPERATOR: 5,
  SCHEMA_ORG: 4,
  OFFICIAL_WEBSITE: 3,
  PAGE_METADATA: 2,
  DOMAIN_FALLBACK: 1,
};

export function normalizeLegalCompanyName(value: unknown): string {
  let normalized = normalizeCompanyName(value);
  while (LEGAL_SUFFIX_PATTERN.test(normalized)) {
    normalized = normalized.replace(LEGAL_SUFFIX_PATTERN, "").trim();
  }
  return normalized;
}

function validCompanyIdentity(value: unknown): string | null {
  const name = sanitizeEvidenceText(value, 180).replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
  const normalized = normalizeCompanyName(name);
  if (
    name.length < 2 || normalized.length < 2 ||
    GENERIC_IDENTITY_NAMES.has(normalized) ||
    /^(?:https?:\/\/|www\.)/i.test(name) ||
    name.split(/\s+/).length > 16
  ) return null;
  return name;
}

export function chooseTrustedCompanyIdentity(input: {
  currentName: string;
  currentSource?: CompanyIdentitySource;
  proposedName: unknown;
  proposedSource: CompanyIdentitySource;
}): { name: string; source: CompanyIdentitySource } {
  const current = validCompanyIdentity(input.currentName) ||
    sanitizeEvidenceText(input.currentName, 180) || "Unknown company";
  // PAGE_METADATA is retained as a legacy enum for stored/cache compatibility,
  // but page, product, category, and article titles are never organization
  // identities.
  const proposed = input.proposedSource === "PAGE_METADATA"
    ? null
    : validCompanyIdentity(input.proposedName);
  const currentSource = input.currentSource || "DOMAIN_FALLBACK";
  if (
    proposed &&
    (currentSource === "PAGE_METADATA" ||
      IDENTITY_SOURCE_PRIORITY[input.proposedSource] >
        IDENTITY_SOURCE_PRIORITY[currentSource])
  ) {
    return { name: proposed, source: input.proposedSource };
  }
  return { name: current, source: currentSource };
}

function registrableDomainLabel(value: unknown): string | null {
  const domain = normalizeDomain(value);
  if (!domain) return null;
  const labels = domain.split(".");
  const label = labels.length >= 3 && labels.at(-1)?.length === 2 &&
      (labels.at(-2)?.length || 0) <= 3
    ? labels.at(-3)
    : labels.at(-2);
  const normalized = normalizeCompanyName(label);
  return normalized.length >= 4 && !GENERIC_IDENTITY_NAMES.has(normalized)
    ? normalized
    : null;
}

export function companyIdentityKeys(
  candidate: Pick<
    ProspectCandidate,
    | "name"
    | "nameSource"
    | "countryCode"
    | "countryName"
    | "websiteUrl"
    | "registryIdentifier"
  >,
): string[] {
  const country = String(candidate.countryCode || candidate.countryName || "")
    .toUpperCase();
  const normalized = normalizeCompanyName(candidate.name);
  const legal = normalizeLegalCompanyName(candidate.name);
  const domain = normalizeDomain(candidate.websiteUrl);
  const domainLabel = registrableDomainLabel(candidate.websiteUrl);
  const hasLegalSuffix = legal && legal !== normalized;
  const trustedName = candidate.nameSource &&
    candidate.nameSource !== "DOMAIN_FALLBACK" &&
    candidate.nameSource !== "PAGE_METADATA";
  return [
    ...new Set([
      candidate.registryIdentifier && candidate.countryCode
        ? `registry:${candidate.countryCode}:${candidate.registryIdentifier}`
        : "",
      domain ? `domain:${domain}` : "",
      normalized && candidate.nameSource !== "PAGE_METADATA"
        ? `name:${country}:${normalized}`
        : "",
      legal && legal.length >= 4 && candidate.nameSource !== "PAGE_METADATA" &&
        (hasLegalSuffix || trustedName)
        ? `brand:${country}:${legal}`
        : "",
      domainLabel && country ? `brand:${country}:${domainLabel}` : "",
    ].filter(Boolean)),
  ];
}

export function mergeProspectCandidate(
  target: ProspectCandidate,
  incoming: ProspectCandidate,
): ProspectCandidate {
  const identity = chooseTrustedCompanyIdentity({
    currentName: target.name,
    currentSource: target.nameSource,
    proposedName: incoming.name,
    proposedSource: incoming.nameSource || "DOMAIN_FALLBACK",
  });
  target.name = identity.name;
  target.nameSource = identity.source;
  target.countryCode ||= incoming.countryCode;
  target.countryName ||= incoming.countryName;
  target.cityRegion ||= incoming.cityRegion;
  target.websiteUrl ||= incoming.websiteUrl;
  target.registryIdentifier ||= incoming.registryIdentifier;
  target.description ||= incoming.description;
  if (target.companyType === "Unknown" && incoming.companyType !== "Unknown") {
    target.companyType = incoming.companyType;
  }
  target.evidence.push(...incoming.evidence);
  const activityKeys = new Set(
    target.activities.map((item) =>
      `${item.providerCode}:${
        item.registryIdentifier || ""
      }:${item.nationalCode}`
    ),
  );
  for (const activity of incoming.activities) {
    const key = `${activity.providerCode}:${
      activity.registryIdentifier || ""
    }:${activity.nationalCode}`;
    if (!activityKeys.has(key)) {
      target.activities.push(activity);
      activityKeys.add(key);
    }
  }
  target.taxonomyIds = [
    ...new Set([...target.taxonomyIds, ...incoming.taxonomyIds]),
  ];
  const relationPriority = {
    none: 0,
    family: 1,
    sibling: 2,
    parent_child: 3,
    exact: 4,
  };
  if (
    relationPriority[incoming.taxonomyRelation] >
      relationPriority[target.taxonomyRelation]
  ) target.taxonomyRelation = incoming.taxonomyRelation;
  target.targetCountry ||= incoming.targetCountry;
  target.preferredCompanyType ||= incoming.preferredCompanyType;
  target.relatedAwardCount += incoming.relatedAwardCount;
  target.lastEvidenceAt = [target.lastEvidenceAt, incoming.lastEvidenceAt]
    .filter(Boolean).sort().reverse()[0] || null;
  target.discoverySources = [
    ...new Set([
      ...(target.discoverySources || []),
      ...(incoming.discoverySources || []),
    ]),
  ];
  const incomingWebsiteFirst = incoming.discoverySources?.includes(
    "PUBLIC_WEB",
  );
  target.websiteVerificationUrls = [
    ...new Set(
      incomingWebsiteFirst
        ? [
          ...(incoming.websiteVerificationUrls || []),
          ...(target.websiteVerificationUrls || []),
        ]
        : [
          ...(target.websiteVerificationUrls || []),
          ...(incoming.websiteVerificationUrls || []),
        ],
    ),
  ];
  const confidencePriority: Record<CompanyIdentityConfidence, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  };
  if (
    incoming.identityConfidence &&
    (!target.identityConfidence ||
      confidencePriority[incoming.identityConfidence] >
        confidencePriority[target.identityConfidence])
  ) target.identityConfidence = incoming.identityConfidence;
  target.commercialIdentityVerified = Boolean(
    target.commercialIdentityVerified || incoming.commercialIdentityVerified,
  );
  if (
    incoming.organizationType &&
    (target.organizationType == null || target.organizationType === "UNKNOWN" ||
      incoming.commercialIdentityVerified)
  ) target.organizationType = incoming.organizationType;
  target.editorialContent = Boolean(
    target.editorialContent || incoming.editorialContent,
  );
  return target;
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
  retrievalKind: "PRODUCT_TERMS" | "RELATED_CPV";
  terms: string[];
  unfilteredCountryFallback: boolean;
};

export function boundedTedSearchPlan(input: {
  directTerms: string[];
  adjacentTerms: string[];
  cpvCodes: string[];
  targetCountries: string[];
}): TedSearchPlanEntry[] {
  const normalizeTerm = (value: unknown) =>
    sanitizeEvidenceText(value, 80).replace(/["\\]/g, " ").replace(
      /\s+/g,
      " ",
    ).trim();
  const directTerms = [
    ...new Set(
      input.directTerms.map(normalizeTerm).filter(
        Boolean,
      ),
    ),
  ].slice(0, DISCOVERY_LIMITS.maximumTedDirectTerms);
  const adjacentTerms = [
    ...new Set(
      input.adjacentTerms.map(normalizeTerm)
        .filter(Boolean),
    ),
  ].filter((term) => !directTerms.includes(term)).slice(
    0,
    DISCOVERY_LIMITS.maximumTedAdjacentTerms,
  );
  const productTerms = [...directTerms, ...adjacentTerms];
  const cpvCodes = [
    ...new Set(input.cpvCodes.map(normalizeCpv).filter(Boolean)),
  ]
    .slice(0, 3) as string[];
  if (!productTerms.length && !cpvCodes.length) return [];
  const selected = input.targetCountries.length
    ? [...new Set(input.targetCountries.map((item) => item.toUpperCase()))]
      .filter((item) => ISO3_BY_ISO2[item])
    : [...EUROPE_DISCOVERY_COUNTRIES];
  const batches = (count: number): string[][] => {
    const output = Array.from({ length: count }, () => [] as string[]);
    selected.forEach((country, index) => output[index % count].push(country));
    return output.filter((batch) => batch.length);
  };
  const countryClause = (countries: string[]) =>
    countries.length
      ? ` AND (winner-country IN (${
        countries.map((country) => ISO3_BY_ISO2[country]).join(" ")
      }))`
      : "";
  const plan: TedSearchPlanEntry[] = [];
  if (productTerms.length) {
    const productClause = productTerms.map((term) =>
      `(notice-title ~ "${term}" OR description-lot ~ "${term}")`
    ).join(" OR ");
    // Europe-wide discovery reserves one product request for award notices
    // whose structured winner-country is absent. Country-targeted discovery
    // never broadens beyond the requested markets.
    const useUnfilteredFallback = input.targetCountries.length === 0 &&
      selected.length > 1;
    const countryRequestCount = Math.min(
      useUnfilteredFallback
        ? DISCOVERY_LIMITS.maximumTedProductRequests - 1
        : DISCOVERY_LIMITS.maximumTedProductRequests,
      Math.max(1, selected.length),
    );
    for (const batch of batches(countryRequestCount)) {
      plan.push({
        query: `(${productClause})${countryClause(batch)}`,
        countries: batch,
        retrievalKind: "PRODUCT_TERMS",
        terms: productTerms,
        unfilteredCountryFallback: false,
      });
    }
    if (useUnfilteredFallback) {
      plan.push({
        query: `(${productClause})`,
        countries: [],
        retrievalKind: "PRODUCT_TERMS",
        terms: productTerms,
        unfilteredCountryFallback: true,
      });
    }
  }
  if (cpvCodes.length) {
    const cpvClause = `(classification-cpv IN (${cpvCodes.join(" ")}))`;
    const requestCount = productTerms.length
      ? DISCOVERY_LIMITS.maximumTedCpvRequests
      : DISCOVERY_LIMITS.maximumTedRequests;
    for (const batch of batches(Math.min(requestCount, selected.length))) {
      plan.push({
        query: `${cpvClause}${countryClause(batch)}`,
        countries: batch,
        retrievalKind: "RELATED_CPV",
        terms: cpvCodes,
        unfilteredCountryFallback: false,
      });
    }
  }
  return plan.slice(0, DISCOVERY_LIMITS.maximumTedRequests);
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
      buyerRoleConfidence:
        candidate.buyerArchetypes?.some((item) =>
            item.archetype !== "UNKNOWN" && item.archetype !== "MANUFACTURER" &&
            item.strength === "HIGH"
          )
          ? "HIGH"
          : candidate.buyerArchetypes?.some((item) =>
              item.archetype !== "UNKNOWN" &&
              item.archetype !== "MANUFACTURER" && item.strength === "MEDIUM"
            )
          ? "MEDIUM"
          : candidate.buyerArchetypes?.some((item) =>
              item.archetype === "MANUFACTURER"
            )
          ? "LOW"
          : "NONE",
      buyerRoleScore:
        candidate.buyerArchetypes?.some((item) =>
            item.archetype !== "UNKNOWN" && item.archetype !== "MANUFACTURER" &&
            item.strength === "HIGH"
          )
          ? 15
          : candidate.buyerArchetypes?.some((item) =>
              item.archetype !== "UNKNOWN" &&
              item.archetype !== "MANUFACTURER" && item.strength === "MEDIUM"
            )
          ? 11
          : candidate.buyerArchetypes?.some((item) =>
              item.archetype === "MANUFACTURER"
            )
          ? 2
          : 0,
      credibleBuyerRole:
        candidate.buyerArchetypes?.some((item) =>
          item.archetype !== "UNKNOWN" && item.archetype !== "MANUFACTURER" &&
          item.strength !== "LOW"
        ) || false,
      commercialReason:
        candidate.evidence.some((item) =>
            item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE"
          )
          ? "Direct product-family buyer"
          : "Adjacent commercial fit",
      productClassification:
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
      classification:
        candidate.evidence.some((item) =>
            item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE"
          )
          ? candidate.buyerArchetypes?.some((item) =>
              item.archetype !== "UNKNOWN" &&
              item.archetype !== "MANUFACTURER" && item.strength !== "LOW"
            )
            ? "DIRECT_BUYER"
            : "PRODUCT_RELEVANT_NOT_BUYER"
          : candidate.evidence.some((item) =>
              item.evidenceKind === "INDIRECT_COMMERCIAL_EVIDENCE" &&
              item.sourceType !== "PUBLIC_REGISTRY"
            ) &&
              candidate.buyerArchetypes?.some((item) =>
                item.archetype !== "UNKNOWN" &&
                item.archetype !== "MANUFACTURER" && item.strength !== "LOW"
              )
          ? "ADJACENT_BUYER"
          : "GENERIC_SUPPORT",
      negativeProductContext: false,
      mismatch: false,
    };
  const scoredCandidate = compatibility.candidate;
  const direct = compatibility.directEvidence.filter((item) =>
    item.confidence >= 0.7
  );
  const adjacent = compatibility.adjacentEvidence.filter((item) =>
    item.confidence >= 0.65
  );
  const needsPublicWebOrganizationGate = candidate.discoverySources?.includes(
    "PUBLIC_WEB",
  ) === true;
  const websiteOrganizationVerified = !needsPublicWebOrganizationGate ||
    candidate.commercialIdentityVerified === true;
  const qualifiedDirect = direct.filter((item) =>
    item.sourceType !== "COMPANY_WEBSITE" &&
      item.sourceType !== "PRODUCT_CATALOGUE" || websiteOrganizationVerified
  );
  const qualifiedAdjacent = adjacent.filter((item) =>
    item.sourceType !== "COMPANY_WEBSITE" &&
      item.sourceType !== "PRODUCT_CATALOGUE" || websiteOrganizationVerified
  );
  const strongActivities = candidate.activities.filter((item) =>
    item.strength === "STRONG_INDIRECT"
  );
  const indirectSources = new Set(
    qualifiedAdjacent.map((item) => `${item.sourceType}:${item.sourceDomain}`),
  );
  const strongAdjacentArchetype = compatibility.archetypes.some((item) =>
    item.strength === "HIGH" && item.archetype !== "UNKNOWN"
  );
  const supportedAdjacentArchetype = compatibility.archetypes.some((item) =>
    item.strength !== "LOW" && item.archetype !== "UNKNOWN"
  );
  const directWebsite = qualifiedDirect.some((item) =>
    item.sourceType === "COMPANY_WEBSITE" ||
    item.sourceType === "PRODUCT_CATALOGUE"
  );
  const directProcurement = qualifiedDirect.some((item) =>
    item.sourceType === "TED_AWARD"
  );
  const adjacentProcurement = qualifiedAdjacent.some((item) =>
    item.sourceType === "TED_AWARD" && item.confidence >= 0.8
  );
  const qualifiedAdjacentConceptCount = new Set(
    qualifiedAdjacent.flatMap((item) =>
      (item.matchedTerms?.length ? item.matchedTerms : [item.title]).map(
        normalizeCompanyName,
      )
    ).filter(Boolean),
  ).size;
  const qualifiedIndependentAdjacentSourceCount = new Set(
    qualifiedAdjacent.map((item) => `${item.sourceType}:${item.sourceDomain}`),
  ).size;
  const commercialAdjacencyQualifies = compatibility.credibleBuyerRole &&
    (qualifiedIndependentAdjacentSourceCount >= 2 ||
      (qualifiedAdjacentConceptCount >= 2 && strongAdjacentArchetype) ||
      (qualifiedAdjacent.some((item) => item.confidence >= 0.85) &&
        strongAdjacentArchetype));
  const combinedSupportQualifies = adjacentProcurement &&
    strongActivities.length >= 1 && supportedAdjacentArchetype;
  const directBuyerQualifies = qualifiedDirect.length >= 1 &&
    compatibility.credibleBuyerRole;
  const eligible = directBuyerQualifies ||
    commercialAdjacencyQualifies ||
    combinedSupportQualifies;
  const qualificationPath: ProspectScore["qualificationPath"] =
    directBuyerQualifies && directWebsite
      ? "OFFICIAL_WEBSITE"
      : directBuyerQualifies && directProcurement
      ? "PUBLIC_PROCUREMENT"
      : commercialAdjacencyQualifies
      ? "COMMERCIAL_ADJACENCY"
      : combinedSupportQualifies
      ? "COMBINED_SUPPORT"
      : "INSUFFICIENT";
  const finalBuyerGrade: CommercialBuyerGrade = qualifiedDirect.length
    ? compatibility.credibleBuyerRole
      ? "DIRECT_BUYER"
      : "PRODUCT_RELEVANT_NOT_BUYER"
    : qualifiedAdjacent.length && compatibility.credibleBuyerRole
    ? "ADJACENT_BUYER"
    : compatibility.mismatch || compatibility.negativeProductContext ||
        scoredCandidate.editorialContent
    ? "REJECTED"
    : "GENERIC_SUPPORT";

  let productTaxonomyScore = 0;
  if (qualifiedDirect.length) {
    productTaxonomyScore = scoredCandidate.taxonomyRelation === "exact"
      ? 40
      : scoredCandidate.taxonomyRelation === "parent_child"
      ? 36
      : 34;
  } else if (qualifiedAdjacentConceptCount >= 3) {
    productTaxonomyScore = 32;
  } else if (qualifiedAdjacentConceptCount >= 2) {
    productTaxonomyScore = 28;
  } else if (qualifiedAdjacent.length) productTaxonomyScore = 22;

  const geographyScore = scoredCandidate.targetCountry
    ? 10
    : scoredCandidate.countryCode
    ? 4
    : 0;
  // The persisted company_type_score remains the schema-compatible score
  // component, but now represents independently evidenced buyer-role strength.
  const companyTypeScore = compatibility.buyerRoleScore;
  const relevantProcurementCount = new Set(
    [
      ...qualifiedDirect,
      ...qualifiedAdjacent,
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
    [...qualifiedDirect, ...qualifiedAdjacent].map((item) =>
      `${item.sourceType}:${item.sourceDomain}`
    ),
  ).size;
  const evidenceQualityScore = qualifiedDirect.length && independentCount >= 2
    ? 10
    : qualifiedDirect.length
    ? 8
    : qualifiedIndependentAdjacentSourceCount >= 2
    ? 9
    : qualifiedAdjacentConceptCount >= 2
    ? 7
    : qualifiedAdjacent.length
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
  const genericOnlyCeilingApplied = finalBuyerGrade === "GENERIC_SUPPORT" ||
    finalBuyerGrade === "REJECTED";
  if (genericOnlyCeilingApplied) relevanceScore = Math.min(42, relevanceScore);
  if (finalBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER") {
    relevanceScore = Math.min(54, relevanceScore);
  }

  const reasons: ProspectScore["reasons"] = [];
  if (qualifiedDirect.length) {
    const directTed = qualifiedDirect.filter((item) =>
      item.sourceType === "TED_AWARD"
    );
    const directOfficialWebsite = qualifiedDirect.filter((item) =>
      item.sourceType === "COMPANY_WEBSITE" ||
      item.sourceType === "PRODUCT_CATALOGUE"
    );
    reasons.push({
      kind: "DIRECT_PRODUCT_EVIDENCE",
      code: "DIRECT_PRODUCT_FIT",
      evidenceClass: "DIRECT",
      text: directTed.length
        ? "Product-specific public procurement evidence identifies this company as a supplier or selected economic operator."
        : directOfficialWebsite.length
        ? "The selected product is supported by the company's official website or catalogue."
        : "Direct structured public evidence supports the selected product family.",
    });
    if (directTed.length && !directOfficialWebsite.length) {
      reasons.push({
        kind: "WEAK_CONTEXT",
        code: "WEBSITE_PRODUCT_NOT_VERIFIED",
        evidenceClass: "GENERIC",
        text:
          "The exact product is not currently verified on the official website; procurement evidence is the qualifying source.",
      });
    }
  } else if (qualifiedAdjacent.length) {
    reasons.push({
      kind: "INDIRECT_COMMERCIAL_EVIDENCE",
      code: "ADJACENT_COMMERCIAL_FIT",
      evidenceClass: "ADJACENT",
      text:
        `${compatibility.commercialReason}. This is commercial-fit evidence; exact current product availability is not claimed.`,
    });
  }
  const bestArchetype =
    compatibility.archetypes.find((item) =>
      item.archetype !== "UNKNOWN" && item.archetype !== "MANUFACTURER" &&
      item.strength !== "LOW"
    ) || compatibility.archetypes.find((item) => item.archetype !== "UNKNOWN");
  if (bestArchetype) {
    reasons.push({
      kind: "INDIRECT_COMMERCIAL_EVIDENCE",
      code: "BUYER_ARCHETYPE",
      evidenceClass: qualifiedDirect.length ? "DIRECT" : "ADJACENT",
      buyerArchetype: bestArchetype.archetype,
      text: `${
        archetypeLabel(bestArchetype.archetype)
      }: ${bestArchetype.reason}.`,
    });
  }
  if (
    finalBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER" ||
    finalBuyerGrade === "GENERIC_SUPPORT" || finalBuyerGrade === "REJECTED"
  ) {
    reasons.push({
      kind: "WEAK_CONTEXT",
      code: "BUYER_ROLE_NOT_PROVEN",
      evidenceClass: qualifiedDirect.length ? "DIRECT" : "GENERIC",
      buyerArchetype: bestArchetype?.archetype,
      text: finalBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER"
        ? "Product relevance is verified, but independent purchasing, sourcing, procurement, import, distribution, resale, OEM, or assembly intent is not."
        : "No credible product-specific commercial buyer role is established.",
    });
  }
  if (relevantProcurementCount) {
    reasons.push({
      kind: qualifiedDirect.some((item) => item.sourceType === "TED_AWARD")
        ? "DIRECT_PRODUCT_EVIDENCE"
        : "INDIRECT_COMMERCIAL_EVIDENCE",
      code: "RELEVANT_PROCUREMENT",
      evidenceClass: qualifiedDirect.some((item) =>
          item.sourceType === "TED_AWARD"
        )
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
      code: compatibility.productClassification,
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
  const finalCommercialReason = finalBuyerGrade === "DIRECT_BUYER"
    ? "Direct buyer: product-specific evidence and credible commercial buyer-role evidence"
    : finalBuyerGrade === "ADJACENT_BUYER"
    ? "Adjacent buyer: credible buyer role with verified product-family adjacency"
    : finalBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER"
    ? "Product relevance is verified, but purchasing or sourcing intent is not"
    : compatibility.commercialReason;
  reasons.unshift({
    kind: qualifiedDirect.length
      ? "DIRECT_PRODUCT_EVIDENCE"
      : qualifiedAdjacent.length
      ? "INDIRECT_COMMERCIAL_EVIDENCE"
      : "WEAK_CONTEXT",
    code: "COMMERCIAL_FIT",
    evidenceClass: qualifiedDirect.length
      ? "DIRECT"
      : qualifiedAdjacent.length
      ? "ADJACENT"
      : "GENERIC",
    buyerArchetype: bestArchetype?.archetype,
    confidence,
    text: finalCommercialReason,
  });
  return {
    eligible,
    relevanceScore,
    productTaxonomyScore,
    geographyScore,
    companyTypeScore,
    buyerRoleScore: compatibility.buyerRoleScore,
    buyerRoleConfidence: compatibility.buyerRoleConfidence,
    procurementSignalScore,
    evidenceQualityScore,
    recencyScore,
    directEvidenceCount: qualifiedDirect.length,
    adjacentEvidenceCount: qualifiedAdjacent.length,
    genericEvidenceCount: compatibility.genericEvidence.length,
    independentIndirectSourceCount: indirectSources.size,
    qualificationPath,
    confidence,
    commercialFitClassification: compatibility.productClassification,
    commercialBuyerGrade: finalBuyerGrade,
    commercialReason: finalCommercialReason,
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
  const registeredKeys = new Set(
    registered.flatMap((item) =>
      companyIdentityKeys({
        name: item.name,
        nameSource: "OFFICIAL_REGISTRY",
        websiteUrl: item.website,
        countryCode: item.country,
        countryName: null,
        registryIdentifier: null,
      })
    ),
  );
  const seen = new Map<string, ProspectCandidate>();
  const output: ProspectCandidate[] = [];
  let registeredDuplicates = 0;
  let externalDuplicates = 0;
  for (const candidate of candidates) {
    const keys = companyIdentityKeys(candidate);
    if (keys.some((key) => registeredKeys.has(key))) {
      registeredDuplicates += 1;
      continue;
    }
    const previous = keys.map((key) => seen.get(key)).find(Boolean);
    if (previous) {
      externalDuplicates += 1;
      mergeProspectCandidate(previous, candidate);
      for (const key of companyIdentityKeys(previous)) seen.set(key, previous);
      continue;
    }
    output.push(candidate);
    for (const key of keys) seen.set(key, candidate);
    if (output.length >= DISCOVERY_LIMITS.maximumCandidatePool) break;
  }
  return { candidates: output, registeredDuplicates, externalDuplicates };
}

export function partitionTedCandidates(
  candidates: ProspectCandidate[],
): {
  productTermCandidates: ProspectCandidate[];
  cpvCandidates: ProspectCandidate[];
  rejectedBySourceCaps: number;
  duplicatesCollapsedBeforeCaps: number;
} {
  const productTermCandidates: ProspectCandidate[] = [];
  const cpvCandidates: ProspectCandidate[] = [];
  for (const candidate of candidates) {
    const cpvDiscovered = candidate.evidence.some((item) =>
      item.discoveryReason === "RELATED_CPV_TED"
    );
    const target = cpvDiscovered ? cpvCandidates : productTermCandidates;
    target.push(candidate);
  }
  const collapse = (values: ProspectCandidate[]) => {
    const byEntity = new Map<string, ProspectCandidate>();
    for (const candidate of values) {
      const registryKey = candidate.registryIdentifier && candidate.countryCode
        ? `${candidate.countryCode}:${candidate.registryIdentifier}`
        : "";
      const domain = normalizeDomain(candidate.websiteUrl) || "";
      const nameKey = `${normalizeCompanyName(candidate.name)}:${
        candidate.countryCode || ""
      }`;
      const key = registryKey || domain || nameKey;
      const previous = byEntity.get(key);
      if (!previous) {
        byEntity.set(key, candidate);
        continue;
      }
      previous.evidence.push(...candidate.evidence);
      previous.relatedAwardCount += candidate.relatedAwardCount;
      previous.websiteUrl ||= candidate.websiteUrl;
      previous.registryIdentifier ||= candidate.registryIdentifier;
      previous.lastEvidenceAt = [
        previous.lastEvidenceAt,
        candidate.lastEvidenceAt,
      ].filter(Boolean).sort().reverse()[0] || null;
    }
    return [...byEntity.values()];
  };
  const uniqueProduct = collapse(productTermCandidates);
  const uniqueCpv = collapse(cpvCandidates);
  const selectedProduct = uniqueProduct.slice(
    0,
    DISCOVERY_LIMITS.maximumProductTedCandidates,
  );
  const selectedCpv = uniqueCpv.slice(
    0,
    DISCOVERY_LIMITS.maximumCpvTedCandidates,
  );
  return {
    productTermCandidates: selectedProduct,
    cpvCandidates: selectedCpv,
    rejectedBySourceCaps: Math.max(
      0,
      uniqueProduct.length - selectedProduct.length,
    ) + Math.max(0, uniqueCpv.length - selectedCpv.length),
    duplicatesCollapsedBeforeCaps: candidates.length - uniqueProduct.length -
      uniqueCpv.length,
  };
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
    directBuyers: 0,
    adjacentBuyers: 0,
    productRelevantNotBuyer: 0,
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
    if (score.commercialBuyerGrade === "DIRECT_BUYER") {
      diagnostics.directBuyers += 1;
    } else if (score.commercialBuyerGrade === "ADJACENT_BUYER") {
      diagnostics.adjacentBuyers += 1;
    } else if (
      score.commercialBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER"
    ) {
      diagnostics.productRelevantNotBuyer += 1;
    } else if (score.commercialBuyerGrade === "GENERIC_SUPPORT") {
      diagnostics.genericOnlyRejected += 1;
    } else if (score.commercialBuyerGrade === "REJECTED") {
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

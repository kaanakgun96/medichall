export const DISCOVERY_LIMITS = Object.freeze({
  maximumQueries: 4,
  maximumTedResultsPerQuery: 25,
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
  independentIndirectSourceCount: number;
  reasonSummary: string;
  reasons: Array<{ kind: EvidenceKind; text: string }>;
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
): ProspectScore {
  const direct = candidate.evidence.filter((item) =>
    item.evidenceKind === "DIRECT_PRODUCT_EVIDENCE" && item.confidence >= 0.7
  );
  const indirect = candidate.evidence.filter((item) =>
    item.evidenceKind === "INDIRECT_COMMERCIAL_EVIDENCE" &&
    item.confidence >= 0.65
  );
  const strongActivities = candidate.activities.filter((item) =>
    item.strength === "STRONG_INDIRECT"
  );
  const indirectSources = new Set([
    ...indirect.map((item) => `${item.sourceType}:${item.sourceDomain}`),
    ...strongActivities.map((item) => `PUBLIC_REGISTRY:${item.providerCode}`),
  ]);
  const eligible = direct.length >= 1 || indirectSources.size >= 2;

  let productTaxonomyScore = 0;
  if (direct.length) {
    productTaxonomyScore = candidate.taxonomyRelation === "exact"
      ? 40
      : candidate.taxonomyRelation === "parent_child"
      ? 34
      : candidate.taxonomyRelation === "sibling"
      ? 28
      : 22;
  } else if (
    indirectSources.size >= 3 && candidate.taxonomyRelation !== "none"
  ) {
    productTaxonomyScore = 30;
  } else if (
    indirectSources.size >= 2 && candidate.taxonomyRelation !== "none"
  ) {
    productTaxonomyScore = 24;
  } else if (candidate.taxonomyRelation !== "none") productTaxonomyScore = 12;

  const geographyScore = candidate.targetCountry
    ? 15
    : candidate.countryCode
    ? 5
    : 0;
  const companyTypeScore = candidate.preferredCompanyType
    ? 15
    : candidate.companyType === "Unknown" && strongActivities.length
    ? 10
    : candidate.companyType === "Unknown"
    ? 0
    : 6;
  const procurementSignalScore = candidate.relatedAwardCount >= 2
    ? 15
    : candidate.relatedAwardCount === 1
    ? 10
    : 0;
  const independentCount = new Set(
    candidate.evidence.map((item) => `${item.sourceType}:${item.sourceDomain}`),
  ).size;
  const evidenceQualityScore = direct.length && independentCount >= 2
    ? 10
    : direct.length
    ? 8
    : indirectSources.size >= 3
    ? 9
    : indirectSources.size >= 2
    ? 7
    : 2;
  const age = ageInDays(candidate.lastEvidenceAt, now);
  const recencyScore = age == null
    ? 0
    : age <= 90
    ? 5
    : age <= 365
    ? 3
    : age <= 730
    ? 1
    : 0;
  const relevanceScore = productTaxonomyScore + geographyScore +
    companyTypeScore + procurementSignalScore + evidenceQualityScore +
    recencyScore;

  const reasons: ProspectScore["reasons"] = [];
  if (direct.length) {
    reasons.push({
      kind: "DIRECT_PRODUCT_EVIDENCE",
      text: candidate.taxonomyRelation === "exact"
        ? "Direct public evidence supports the selected product taxonomy."
        : "Direct public evidence supports a related product category.",
    });
  } else if (indirectSources.size >= 2) {
    reasons.push({
      kind: "INDIRECT_COMMERCIAL_EVIDENCE",
      text:
        "Multiple independent public signals show activity in related product categories; exact current product availability is not claimed.",
    });
  }
  if (strongActivities.length) {
    reasons.push({
      kind: "INDIRECT_COMMERCIAL_EVIDENCE",
      text:
        "Official registry activity indicates relevant wholesale, distribution, or healthcare-supply operations.",
    });
  }
  if (candidate.relatedAwardCount) {
    reasons.push({
      kind: direct.some((item) => item.sourceType === "TED_AWARD")
        ? "DIRECT_PRODUCT_EVIDENCE"
        : "INDIRECT_COMMERCIAL_EVIDENCE",
      text:
        `${candidate.relatedAwardCount} relevant public procurement award signal${
          candidate.relatedAwardCount === 1 ? "" : "s"
        } support commercial capability.`,
    });
  }
  if (candidate.targetCountry) {
    reasons.push({
      kind: "WEAK_CONTEXT",
      text: "Located in a selected target geography.",
    });
  }
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
    independentIndirectSourceCount: indirectSources.size,
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
    if (output.length >= DISCOVERY_LIMITS.maximumCandidates) break;
  }
  return { candidates: output, registeredDuplicates, externalDuplicates };
}

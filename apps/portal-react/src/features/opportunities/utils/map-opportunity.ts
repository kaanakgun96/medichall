import type {
  ConfidenceLevel,
  Opportunity,
  OpportunityDistributor,
  OpportunityEvidence,
  OpportunityKind,
  OpportunityStatus,
  OpportunityTender,
} from "../types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredNumber(value: unknown, field: string): number {
  const number = nullableNumber(value);
  if (number === null) throw new Error(`Opportunity response is missing ${field}.`);
  return number;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function opportunityKind(value: unknown): OpportunityKind {
  if (value === "tender" || value === "distributor") return value;
  throw new Error("Opportunity response has an unsupported opportunity_type.");
}

function opportunityStatus(value: unknown): OpportunityStatus {
  if (
    value === "new" ||
    value === "viewed" ||
    value === "saved" ||
    value === "contacted" ||
    value === "dismissed" ||
    value === "applied"
  ) return value;
  throw new Error("Opportunity response has an unsupported status.");
}

function confidenceLevel(value: unknown): ConfidenceLevel | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function evidenceList(value: unknown): OpportunityEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const label = nullableString(record?.label);
    if (!record || !label) return [];
    return [{
      label,
      score: nullableNumber(record.score),
      source: nullableString(record.source),
    }];
  });
}

function mapTender(value: unknown): OpportunityTender | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    id: requiredNumber(row.id, "tenders.id"),
    title: nullableString(row.title),
    titleEn: nullableString(row.title_en),
    buyerName: nullableString(row.buyer_name),
    countryCode: nullableString(row.country_code),
    countryName: nullableString(row.country_name),
    cpvCodes: stringArray(row.cpv_codes),
    publicationDate: nullableString(row.publication_date),
    deadlineAt: nullableString(row.deadline_at),
    estimatedValue: nullableNumber(row.estimated_value),
    estimatedValueEur: nullableNumber(row.estimated_value_eur),
    currency: nullableString(row.currency),
    eurRateAsOf: nullableString(row.eur_rate_as_of),
    noticeType: nullableString(row.notice_type),
    source: nullableString(row.source),
    sourceNoticeId: nullableString(row.source_notice_id),
    sourceUrl: nullableString(row.source_url),
    documentAnalysisStatus: nullableString(row.document_analysis_status),
    documentConfidenceScore: nullableNumber(row.document_confidence_score),
    dataCompletenessScore: nullableNumber(row.data_completeness_score),
    analyzedDocumentCount: nullableNumber(row.analyzed_document_count) ?? 0,
    missingInformation: stringArray(row.missing_information),
  };
}

function mapDistributor(value: unknown): OpportunityDistributor | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    id: requiredNumber(row.id, "distributor_candidates.id"),
    name: nullableString(row.name),
    website: nullableString(row.website),
    countryCode: nullableString(row.country_code),
    countryName: nullableString(row.country_name),
    companyType: nullableString(row.company_type),
    productCategories: stringArray(row.product_categories),
    productKeywords: stringArray(row.product_keywords),
    certifications: stringArray(row.certifications),
    channels: stringArray(row.channels),
    source: nullableString(row.source),
    sourceUrl: nullableString(row.source_url),
    verificationStatus: nullableString(row.verification_status),
  };
}

export function mapOpportunityRow(value: unknown): Opportunity {
  const row = asRecord(value);
  if (!row) throw new Error("Opportunity response is not an object.");

  const kind = opportunityKind(row.opportunity_type);
  const tender = mapTender(row.tenders);
  const distributor = mapDistributor(row.distributor_candidates);
  if (kind === "tender" && !tender) throw new Error("Tender opportunity is missing its tender record.");
  if (kind === "distributor" && !distributor) {
    throw new Error("Distributor opportunity is missing its distributor record.");
  }

  return {
    id: requiredNumber(row.id, "id"),
    companyId: requiredNumber(row.company_id, "company_id"),
    kind,
    status: opportunityStatus(row.status),
    matchScore: requiredNumber(row.match_score, "match_score"),
    opportunityScore: nullableNumber(row.opportunity_score),
    profileMatchScore: nullableNumber(row.profile_match_score),
    documentMatchScore: nullableNumber(row.document_match_score),
    confidenceScore: nullableNumber(row.confidence_score),
    confidenceLevel: confidenceLevel(row.confidence_level),
    keywordScore: nullableNumber(row.keyword_score),
    geographyScore: nullableNumber(row.geography_score),
    certificationScore: nullableNumber(row.certification_score),
    categoryScore: nullableNumber(row.category_score),
    scoreBasis: nullableString(row.score_basis),
    reasons: stringArray(row.reasons),
    risks: stringArray(row.risks),
    missingInformation: stringArray(row.missing_information),
    evidence: evidenceList(row.evidence),
    nextBestAction: nullableString(row.next_best_action),
    generatedAt: nullableString(row.generated_at),
    tender,
    distributor,
  };
}

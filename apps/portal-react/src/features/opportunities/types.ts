export type OpportunityKind = "tender" | "distributor";
export type OpportunityStatus = "new" | "viewed" | "saved" | "contacted" | "dismissed" | "applied";
export type ConfidenceLevel = "low" | "medium" | "high";

export type PartnerCompany = {
  id: number;
  name: string | null;
};

export type OpportunityEvidence = {
  label: string;
  score: number | null;
  source: string | null;
};

export type OpportunityTender = {
  id: number;
  title: string | null;
  titleEn: string | null;
  buyerName: string | null;
  countryCode: string | null;
  countryName: string | null;
  cpvCodes: string[];
  publicationDate: string | null;
  deadlineAt: string | null;
  estimatedValue: number | null;
  estimatedValueEur: number | null;
  currency: string | null;
  eurRateAsOf: string | null;
  noticeType: string | null;
  source: string | null;
  sourceNoticeId: string | null;
  sourceUrl: string | null;
  documentAnalysisStatus: string | null;
  documentConfidenceScore: number | null;
  dataCompletenessScore: number | null;
  analyzedDocumentCount: number;
  missingInformation: string[];
};

export type OpportunityDistributor = {
  id: number;
  name: string | null;
  website: string | null;
  countryCode: string | null;
  countryName: string | null;
  companyType: string | null;
  productCategories: string[];
  productKeywords: string[];
  certifications: string[];
  channels: string[];
  source: string | null;
  sourceUrl: string | null;
  verificationStatus: string | null;
};

export type Opportunity = {
  id: number;
  companyId: number;
  kind: OpportunityKind;
  status: OpportunityStatus;
  matchScore: number;
  opportunityScore: number | null;
  profileMatchScore: number | null;
  documentMatchScore: number | null;
  confidenceScore: number | null;
  confidenceLevel: ConfidenceLevel | null;
  keywordScore: number | null;
  geographyScore: number | null;
  certificationScore: number | null;
  categoryScore: number | null;
  scoreBasis: string | null;
  reasons: string[];
  risks: string[];
  missingInformation: string[];
  evidence: OpportunityEvidence[];
  nextBestAction: string | null;
  generatedAt: string | null;
  tender: OpportunityTender | null;
  distributor: OpportunityDistributor | null;
};

export type OpportunityFiltersValue = {
  query: string;
  kind: "" | OpportunityKind;
  country: string;
  minimumScore: number;
};

export const DEFAULT_OPPORTUNITY_FILTERS: OpportunityFiltersValue = {
  query: "",
  kind: "",
  country: "",
  minimumScore: 0,
};

export type OpportunityError = {
  kind: "migration" | "configuration" | "request";
  message: string;
};

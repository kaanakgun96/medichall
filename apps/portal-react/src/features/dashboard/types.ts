import type { Opportunity, PartnerCompany } from "../opportunities/types";

export type DashboardMatchProfile = {
  targetCountries: string[];
  productKeywords: string[];
};

export type DashboardData = {
  opportunities: Opportunity[];
  rfqCount: number;
  productCount: number;
  matchProfile: DashboardMatchProfile | null;
};

export type DashboardMetric = {
  id: "total" | "high" | "tenders" | "rfq";
  label: string;
  value: number;
  detail: string;
  href: string;
};

export type DashboardReadinessItem = {
  id: "description" | "certifications" | "products" | "keywords" | "countries";
  complete: boolean;
  label: string;
  href: string;
};

export type DashboardReadiness = {
  percentage: number;
  completedCount: number;
  items: DashboardReadinessItem[];
};

export type DashboardViewModel = {
  company: PartnerCompany;
  metrics: DashboardMetric[];
  recentOpportunities: Opportunity[];
  readiness: DashboardReadiness;
};

export type DashboardError = {
  kind: "migration" | "configuration" | "request";
  message: string;
};

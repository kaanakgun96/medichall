import type { Opportunity, PartnerCompany } from "../../opportunities/types";
import type {
  DashboardData,
  DashboardMetric,
  DashboardReadiness,
  DashboardViewModel,
} from "../types";

const hasProfileValues = (values: string[] | undefined): boolean =>
  Boolean(values?.join(", ").trim());

export function dashboardMetrics(
  opportunities: Opportunity[],
  rfqCount: number,
  legacyPortalUrl = "/portal.html",
): DashboardMetric[] {
  const legacyBase = legacyPortalUrl.split("#")[0];
  return [
    {
      id: "total",
      label: "Total matches",
      value: opportunities.length,
      detail: "Tenders + distributors",
      href: "#/my-opportunities",
    },
    {
      id: "high",
      label: "High matches",
      value: opportunities.filter((opportunity) => opportunity.matchScore >= 80).length,
      detail: "Score of 80% or higher",
      href: "#/my-opportunities",
    },
    {
      id: "tenders",
      label: "Open tenders",
      value: opportunities.filter((opportunity) => opportunity.kind === "tender").length,
      detail: "Relevant procurement notices",
      href: "#/my-opportunities",
    },
    {
      id: "rfq",
      label: "RFQ inbox",
      value: rfqCount,
      detail: "Quotation requests",
      href: `${legacyBase}#inbox`,
    },
  ];
}

export function dashboardReadiness(
  company: PartnerCompany,
  data: Pick<DashboardData, "productCount" | "matchProfile">,
  legacyPortalUrl: string,
): DashboardReadiness {
  const legacyBase = legacyPortalUrl.split("#")[0];
  const items = [
    {
      id: "description" as const,
      complete: Boolean(company.description && company.description.length > 30),
      label: "Add a company description",
      href: `${legacyBase}#profile`,
    },
    {
      id: "certifications" as const,
      complete: Boolean(company.certifications),
      label: "List your certifications",
      href: `${legacyBase}#profile`,
    },
    {
      id: "products" as const,
      complete: data.productCount > 0,
      label: "Add at least one product",
      href: legacyBase,
    },
    {
      id: "keywords" as const,
      complete: hasProfileValues(data.matchProfile?.productKeywords),
      label: "Set product keywords for matching",
      href: `${legacyBase}#opportunities`,
    },
    {
      id: "countries" as const,
      complete: hasProfileValues(data.matchProfile?.targetCountries),
      label: "Choose target countries",
      href: `${legacyBase}#opportunities`,
    },
  ];
  const completedCount = items.filter((item) => item.complete).length;

  return {
    percentage: Math.round((100 * completedCount) / items.length),
    completedCount,
    items,
  };
}

export function buildDashboardViewModel(
  company: PartnerCompany,
  data: DashboardData,
  legacyPortalUrl: string,
): DashboardViewModel {
  return {
    company,
    metrics: dashboardMetrics(data.opportunities, data.rfqCount, legacyPortalUrl),
    recentOpportunities: data.opportunities.slice(0, 3),
    readiness: dashboardReadiness(company, data, legacyPortalUrl),
  };
}

export function dashboardOpportunityTitle(opportunity: Opportunity): string {
  return opportunity.tender?.title
    ?? opportunity.distributor?.name
    ?? (opportunity.kind === "tender" ? "Tender" : "Distributor");
}

export function dashboardOpportunityMeta(opportunity: Opportunity): string[] {
  const tender = opportunity.tender;
  const distributor = opportunity.distributor;
  const values: string[] = [];

  if (tender) {
    if (tender.countryName) values.push(tender.countryName);
    if (tender.buyerName) values.push(tender.buyerName);
    if (tender.deadlineAt) {
      const deadline = new Date(tender.deadlineAt);
      if (!Number.isNaN(deadline.getTime())) {
        values.push(`Deadline: ${deadline.toLocaleDateString()}`);
      }
    }
    if (tender.estimatedValue) {
      values.push(
        `~${Number(tender.estimatedValue).toLocaleString()} ${tender.currency || ""}`.trim(),
      );
    }
  } else if (distributor) {
    if (distributor.countryName) values.push(distributor.countryName);
    if (distributor.companyType) values.push(distributor.companyType);
    if (distributor.verificationStatus) {
      values.push(distributor.verificationStatus === "verified" ? "Verified" : "Reviewed");
    }
  }

  return values;
}

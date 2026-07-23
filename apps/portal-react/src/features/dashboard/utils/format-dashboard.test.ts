import { describe, expect, it } from "vitest";
import { mapDashboardMatchProfile } from "../api/dashboard-api";
import { mapOpportunityRow } from "../../opportunities/utils/map-opportunity";
import type { PartnerCompany } from "../../opportunities/types";
import {
  buildDashboardViewModel,
  dashboardMetrics,
  dashboardReadiness,
} from "./format-dashboard";

function opportunity(id: number, kind: "tender" | "distributor", matchScore: number) {
  return mapOpportunityRow({
    id,
    company_id: 7,
    opportunity_type: kind,
    status: "new",
    match_score: matchScore,
    generated_at: `2026-07-${20 - id}T12:00:00Z`,
    tenders: kind === "tender"
      ? { id: 100 + id, title: `Tender ${id}`, country_name: "Germany" }
      : null,
    distributor_candidates: kind === "distributor"
      ? { id: 200 + id, name: `Distributor ${id}`, country_name: "France" }
      : null,
  });
}

const company: PartnerCompany = {
  id: 7,
  name: "MedicHall Partner",
  description: "A manufacturer description longer than thirty characters.",
  certifications: "CE MDR, ISO 13485",
};

describe("legacy-compatible dashboard metrics", () => {
  it("counts the loaded match set with the exact legacy high-score and tender rules", () => {
    const metrics = dashboardMetrics([
      opportunity(1, "tender", 80),
      opportunity(2, "distributor", 79),
      opportunity(3, "tender", 100),
    ], 4);

    expect(Object.fromEntries(metrics.map((metric) => [metric.id, metric.value]))).toEqual({
      total: 3,
      high: 2,
      tenders: 2,
      rfq: 4,
    });
  });

  it("keeps the backend order and takes only the first three top opportunities", () => {
    const opportunities = [
      opportunity(1, "tender", 99),
      opportunity(2, "tender", 91),
      opportunity(3, "distributor", 87),
      opportunity(4, "tender", 82),
    ];
    const viewModel = buildDashboardViewModel(company, {
      opportunities,
      rfqCount: 0,
      productCount: 0,
      matchProfile: null,
    }, "/portal.html");

    expect(viewModel.recentOpportunities.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});

describe("legacy-compatible match readiness", () => {
  it("uses five equally weighted checks and the original completion thresholds", () => {
    const readiness = dashboardReadiness({
      ...company,
      certifications: "",
    }, {
      productCount: 1,
      matchProfile: {
        productKeywords: ["probe covers"],
        targetCountries: [" "],
      },
    }, "/portal.html");

    expect(readiness.percentage).toBe(60);
    expect(readiness.completedCount).toBe(3);
    expect(Object.fromEntries(readiness.items.map((item) => [item.id, item.complete]))).toEqual({
      description: true,
      certifications: false,
      products: true,
      keywords: true,
      countries: false,
    });
    expect(readiness.items.find((item) => item.id === "description")?.href)
      .toBe("#/company-profile");
    expect(readiness.items.find((item) => item.id === "products")?.href)
      .toBe("/portal.html");
  });

  it("requires a company description longer than 30 characters", () => {
    const readiness = dashboardReadiness({
      ...company,
      description: "x".repeat(30),
    }, {
      productCount: 0,
      matchProfile: null,
    }, "/portal.html");

    expect(readiness.items.find((item) => item.id === "description")?.complete).toBe(false);
  });
});

describe("dashboard API mapping", () => {
  it("maps only backend match-profile arrays without inventing defaults", () => {
    expect(mapDashboardMatchProfile({
      target_countries: ["DE", "FR"],
      product_keywords: ["drape", 42],
    })).toEqual({
      targetCountries: ["DE", "FR"],
      productKeywords: ["drape"],
    });
    expect(mapDashboardMatchProfile(null)).toBeNull();
  });
});

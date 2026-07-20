import { describe, expect, it } from "vitest";
import { determineOpportunityEligibility, opportunityResultsState } from "./opportunity-eligibility";
import {
  documentMatchPresentation,
  formatScore,
  safeOpportunitySourceUrl,
} from "./format-opportunity";
import { mapOpportunityRow } from "./map-opportunity";
import { filterOpportunities } from "./opportunity-filters";
import { DEFAULT_OPPORTUNITY_FILTERS } from "../types";

function rawTenderOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    company_id: 7,
    opportunity_type: "tender",
    status: "new",
    match_score: 82,
    opportunity_score: 79,
    profile_match_score: 84,
    document_match_score: 73,
    confidence_score: 76,
    confidence_level: "medium",
    keyword_score: 90,
    geography_score: 100,
    certification_score: 25,
    category_score: 67,
    score_basis: "structured_and_documents",
    reasons: ["Keywords: ultrasound, probe cover", "Target country: Germany"],
    risks: ["Deadline is within 7 days"],
    missing_information: ["Required certificates"],
    evidence: [{ label: "Target country", score: 100, source: "structured tender data" }],
    next_best_action: "Review missing tender information",
    generated_at: "2026-07-20T12:00:00Z",
    tenders: {
      id: 101,
      title: "Lieferung von Ultraschallzubehör",
      title_en: "Supply of ultrasound accessories",
      buyer_name: "University Hospital",
      country_code: "DE",
      country_name: "Germany",
      cpv_codes: ["33112200"],
      publication_date: "2026-07-18",
      deadline_at: "2026-08-18T10:00:00Z",
      estimated_value: 125000,
      estimated_value_eur: 125000,
      currency: "EUR",
      eur_rate_as_of: "2026-07-18",
      notice_type: "Contract notice",
      source: "TED",
      source_notice_id: "123456-2026",
      source_url: "https://ted.europa.eu/example",
      document_analysis_status: "completed",
      document_confidence_score: 73,
      data_completeness_score: 80,
      analyzed_document_count: 2,
      missing_information: ["Product quantities"],
    },
    distributor_candidates: null,
    ...overrides,
  };
}

describe("opportunity data mapping", () => {
  it("maps the existing explainable match and joined tender fields without synthesizing scores", () => {
    const opportunity = mapOpportunityRow(rawTenderOpportunity());

    expect(opportunity).toMatchObject({
      id: 41,
      companyId: 7,
      kind: "tender",
      matchScore: 82,
      opportunityScore: 79,
      profileMatchScore: 84,
      documentMatchScore: 73,
      confidenceLevel: "medium",
      reasons: ["Keywords: ultrasound, probe cover", "Target country: Germany"],
      missingInformation: ["Required certificates"],
      tender: {
        title: "Lieferung von Ultraschallzubehör",
        titleEn: "Supply of ultrasound accessories",
        cpvCodes: ["33112200"],
      },
    });
  });

  it("keeps unavailable backend scores explicitly uncalculated", () => {
    const opportunity = mapOpportunityRow(rawTenderOpportunity({
      opportunity_score: null,
      profile_match_score: null,
      document_match_score: null,
    }));

    expect(opportunity.opportunityScore).toBeNull();
    expect(opportunity.profileMatchScore).toBeNull();
    expect(formatScore(opportunity.opportunityScore)).toBe("Not calculated");
  });
});

describe("document match status", () => {
  it("labels document matching as pending when no analyzed document evidence exists", () => {
    const raw = rawTenderOpportunity();
    raw.tenders.analyzed_document_count = 0;
    const opportunity = mapOpportunityRow(raw);

    expect(documentMatchPresentation(opportunity)).toMatchObject({
      state: "pending",
      label: "Pending",
      score: null,
    });
  });

  it("shows the backend document score only after document evidence exists", () => {
    const opportunity = mapOpportunityRow(rawTenderOpportunity());
    expect(documentMatchPresentation(opportunity)).toMatchObject({
      state: "scored",
      label: "73%",
      score: 73,
    });
  });
});

describe("opportunity eligibility and empty states", () => {
  it("requires the legacy session and an owned company", () => {
    expect(determineOpportunityEligibility(false, undefined)).toBe("signed-out");
    expect(determineOpportunityEligibility(true, undefined)).toBe("checking");
    expect(determineOpportunityEligibility(true, null)).toBe("no-company");
    expect(determineOpportunityEligibility(true, 7)).toBe("eligible");
  });

  it("distinguishes an empty company list from an empty filter result", () => {
    expect(opportunityResultsState("success", 0, 0, false)).toBe("empty");
    expect(opportunityResultsState("success", 5, 0, true)).toBe("filtered-empty");
    expect(opportunityResultsState("success", 5, 2, true)).toBe("results");
  });
});

describe("legacy-compatible opportunity filtering", () => {
  it("searches the English-normalized title and matched reasons", () => {
    const opportunity = mapOpportunityRow(rawTenderOpportunity());
    expect(filterOpportunities([opportunity], {
      ...DEFAULT_OPPORTUNITY_FILTERS,
      query: "ultrasound accessories",
    })).toHaveLength(1);
    expect(filterOpportunities([opportunity], {
      ...DEFAULT_OPPORTUNITY_FILTERS,
      query: "target country",
    })).toHaveLength(1);
  });

  it("treats an exact country query as a country filter", () => {
    const opportunity = mapOpportunityRow(rawTenderOpportunity());
    expect(filterOpportunities([opportunity], {
      ...DEFAULT_OPPORTUNITY_FILTERS,
      query: "germany",
    })).toEqual([opportunity]);
  });
});

describe("opportunity source links", () => {
  it("rejects unsafe source URL schemes", () => {
    const opportunity = mapOpportunityRow(rawTenderOpportunity({
      tenders: { ...rawTenderOpportunity().tenders, source_url: "javascript:alert(1)" },
    }));
    expect(safeOpportunitySourceUrl(opportunity)).toBeNull();

    const safe = mapOpportunityRow(rawTenderOpportunity());
    expect(safeOpportunitySourceUrl(safe)).toBe("https://ted.europa.eu/example");
  });
});

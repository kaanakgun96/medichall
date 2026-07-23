import { describe, expect, it } from "vitest";
import type {
  CompanyDetailsFormValue,
  MatchingProfileFormValue,
} from "../types";
import {
  determineCompanyProfileEligibility,
} from "./company-profile-eligibility";
import {
  hasValidationErrors,
  validateCompanyDetails,
  validateMatchingProfile,
} from "./company-profile-validation";
import { formatProfileTimestamp, profileReadiness } from "./profile-readiness";

const company: CompanyDetailsFormValue = {
  name: "MedicHall Devices",
  type: "Manufacturer",
  description: "A manufacturer description longer than thirty characters.",
  website: "",
  country: "Türkiye",
  city: "İzmir",
  contactEmail: "",
  phone: "",
  certifications: "CE MDR",
  videoUrl: "",
};

const matching: MatchingProfileFormValue = {
  targetCountries: "Germany, France",
  productKeywords: "probe covers",
  certifications: "CE MDR",
  cpvCodes: "33140000",
  minimumMatchScore: "60",
  oemAvailable: true,
  privateLabelAvailable: false,
};

describe("company profile validation", () => {
  it("preserves the legacy required company-name and product-keyword rules", () => {
    const companyErrors = validateCompanyDetails({ ...company, name: " " });
    const matchingErrors = validateMatchingProfile({ ...matching, productKeywords: ", ," });

    expect(companyErrors.name).toBe("Company name is required.");
    expect(matchingErrors.productKeywords).toBe("Add at least one product keyword.");
    expect(hasValidationErrors(companyErrors)).toBe(true);
    expect(hasValidationErrors({})).toBe(false);
  });

  it("accepts legacy out-of-range scores for clamping but rejects non-numeric values", () => {
    expect(validateMatchingProfile({ ...matching, minimumMatchScore: "140" })).toEqual({});
    expect(validateMatchingProfile({ ...matching, minimumMatchScore: "invalid" }))
      .toHaveProperty("minimumMatchScore");
  });
});

describe("legacy-compatible profile readiness", () => {
  it("uses the exact five equally weighted portal checks", () => {
    const readiness = profileReadiness(
      { ...company, certifications: "" },
      { ...matching, targetCountries: " " },
      1,
      "/portal.html",
    );

    expect(readiness.percentage).toBe(60);
    expect(readiness.completedCount).toBe(3);
    expect(Object.fromEntries(readiness.items.map((item) => [item.id, item.complete]))).toEqual({
      description: true,
      certifications: false,
      products: true,
      keywords: true,
      countries: false,
    });
    expect(
      readiness.items
        .filter((item) => item.id !== "products")
        .every((item) => item.href === "#/company-profile"),
    ).toBe(true);
  });

  it("requires more than 30 normalized description characters", () => {
    const readiness = profileReadiness(
      { ...company, description: `  ${"x".repeat(30)}  ` },
      matching,
      0,
      "/portal.html",
    );
    expect(readiness.items.find((item) => item.id === "description")?.complete).toBe(false);
  });

  it("formats valid last-updated data and rejects malformed timestamps", () => {
    expect(formatProfileTimestamp(null)).toBe("Not available");
    expect(formatProfileTimestamp("not-a-date")).toBe("Not available");
    expect(formatProfileTimestamp("2026-07-23T09:00:00Z")).not.toBe("Not available");
  });
});

describe("company profile eligibility", () => {
  it("covers signed-out, checking, no-company, and eligible states", () => {
    expect(determineCompanyProfileEligibility(false, null)).toBe("signed-out");
    expect(determineCompanyProfileEligibility(true, undefined)).toBe("checking");
    expect(determineCompanyProfileEligibility(true, null)).toBe("no-company");
    expect(determineCompanyProfileEligibility(true, 17)).toBe("eligible");
  });
});

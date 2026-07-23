import { describe, expect, it } from "vitest";
import type { CompanyProfileRecord } from "../types";
import {
  companyFormToUpdate,
  companyRecordToForm,
  legacyCsvToArray,
  mapCompanyProfileRow,
  mapMatchingProfileRow,
  matchingCpvSelection,
  matchingFormToUpdate,
  matchingRecordToForm,
  toggleMatchingCpvCode,
} from "./map-company-profile";

const company: CompanyProfileRecord = {
  id: 17,
  name: "MedicHall Devices",
  type: "Medical device manufacturer",
  description: null,
  website: null,
  country: "Türkiye",
  city: "İzmir",
  contactEmail: null,
  phone: null,
  certifications: "CE MDR, ISO 13485",
  videoUrl: null,
  isApproved: true,
  isVerified: false,
  slug: "medichall-devices",
  createdAt: "2026-07-10T10:00:00Z",
  updatedAt: null,
};

describe("company profile backend mapping", () => {
  it("maps the existing companies row and safely handles null or malformed optional values", () => {
    expect(mapCompanyProfileRow({
      id: "17",
      name: "MedicHall Devices",
      type: 42,
      country: null,
      is_approved: true,
      is_verified: "yes",
      certifications: ["not", "text"],
    })).toMatchObject({
      id: 17,
      name: "MedicHall Devices",
      type: null,
      country: null,
      isApproved: true,
      isVerified: false,
      certifications: null,
    });
    expect(mapCompanyProfileRow({ name: "Missing ID" })).toBeNull();
  });

  it("maps only valid backend arrays and preserves matching metadata", () => {
    expect(mapMatchingProfileRow({
      company_id: 17,
      target_countries: ["Germany", 7, "France"],
      product_keywords: null,
      certifications: ["CE MDR"],
      cpv_codes: ["33140000"],
      min_match_score: 120,
      oem_available: true,
      private_label_available: false,
      profile_complete_score: "40",
      updated_at: "2026-07-20T10:00:00Z",
    })).toEqual({
      companyId: 17,
      targetCountries: ["Germany", "France"],
      productKeywords: [],
      certifications: ["CE MDR"],
      cpvCodes: ["33140000"],
      minimumMatchScore: 100,
      oemAvailable: true,
      privateLabelAvailable: false,
      profileCompleteScore: 40,
      lastIndexedAt: null,
      createdAt: null,
      updatedAt: "2026-07-20T10:00:00Z",
    });
  });
});

describe("profile form and payload compatibility", () => {
  it("initializes empty company values distinctly from loading and preserves all editable fields", () => {
    expect(companyRecordToForm(company)).toEqual({
      name: "MedicHall Devices",
      type: "Medical device manufacturer",
      description: "",
      website: "",
      country: "Türkiye",
      city: "İzmir",
      contactEmail: "",
      phone: "",
      certifications: "CE MDR, ISO 13485",
      videoUrl: "",
    });
  });

  it("defaults a missing matching profile from the legacy company certification text", () => {
    expect(matchingRecordToForm(null, company)).toMatchObject({
      targetCountries: "",
      productKeywords: "",
      certifications: "CE MDR, ISO 13485",
      cpvCodes: "",
      minimumMatchScore: "60",
      oemAvailable: false,
      privateLabelAvailable: false,
    });
  });

  it("maps form values to the exact company PATCH and matching-profile upsert shapes", () => {
    expect(companyFormToUpdate({
      ...companyRecordToForm(company),
      name: "  MedicHall Devices  ",
      website: " ",
      description: "  Sterile device manufacturer.  ",
    })).toMatchObject({
      name: "MedicHall Devices",
      website: null,
      description: "Sterile device manufacturer.",
      contact_email: null,
      video_url: null,
    });

    expect(matchingFormToUpdate(17, {
      targetCountries: " Germany, France, ",
      productKeywords: "probe cover, drape",
      certifications: "CE MDR, ISO 13485",
      cpvCodes: "33140000, 33169000",
      minimumMatchScore: "160",
      oemAvailable: true,
      privateLabelAvailable: false,
    }, "2026-07-23T09:00:00Z")).toEqual({
      company_id: 17,
      target_countries: ["Germany", "France"],
      product_keywords: ["probe cover", "drape"],
      certifications: ["CE MDR", "ISO 13485"],
      cpv_codes: ["33140000", "33169000"],
      min_match_score: 100,
      oem_available: true,
      private_label_available: false,
      updated_at: "2026-07-23T09:00:00Z",
    });
  });

  it("preserves the legacy comma-only CSV and CPV catalog selection behavior", () => {
    expect(legacyCsvToArray("Germany; France, Italy")).toEqual(["Germany; France", "Italy"]);
    expect(matchingCpvSelection("3314-0000, CPV 33169000, 3314-0000")).toEqual([
      "33140000",
      "33169000",
    ]);
    expect(toggleMatchingCpvCode("33169000, 33140000", "33169000")).toBe("33140000");
    expect(toggleMatchingCpvCode("33169000", "33140000")).toBe("33140000, 33169000");
  });
});

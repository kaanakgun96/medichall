import { describe, expect, it } from "vitest";
import type { CompanyProfileData } from "../types";
import {
  companyFormIsDirty,
  createProfileFormState,
  matchingFormIsDirty,
  profileFormReducer,
} from "./profile-form-state";

const data: CompanyProfileData = {
  company: {
    id: 17,
    name: "MedicHall Devices",
    type: "Manufacturer",
    description: "A manufacturer description longer than thirty characters.",
    website: null,
    country: "Türkiye",
    city: "İzmir",
    contactEmail: null,
    phone: null,
    certifications: "CE MDR",
    videoUrl: null,
    isApproved: true,
    isVerified: false,
    slug: "medichall-devices",
    createdAt: "2026-07-10T10:00:00Z",
    updatedAt: null,
  },
  matchingProfile: {
    companyId: 17,
    targetCountries: ["Germany"],
    productKeywords: ["probe cover"],
    certifications: ["CE MDR"],
    cpvCodes: ["33140000"],
    minimumMatchScore: 60,
    oemAvailable: false,
    privateLabelAvailable: false,
    profileCompleteScore: 0,
    lastIndexedAt: null,
    createdAt: "2026-07-10T10:00:00Z",
    updatedAt: "2026-07-20T10:00:00Z",
  },
  productCount: 2,
};

describe("company profile form state", () => {
  it("tracks normalized dirty state and clears it after a successful save", () => {
    let state = createProfileFormState(data);
    expect(companyFormIsDirty(state)).toBe(false);

    state = profileFormReducer(state, {
      type: "company-change",
      field: "name",
      value: "MedicHall Devices Europe",
    });
    expect(companyFormIsDirty(state)).toBe(true);

    state = profileFormReducer(state, {
      type: "company-save-success",
      form: state.company,
    });
    expect(companyFormIsDirty(state)).toBe(false);
    expect(state.companySave).toEqual({
      status: "success",
      message: "Company profile saved.",
    });
  });

  it("preserves entered matching data after a recoverable save failure", () => {
    let state = createProfileFormState(data);
    state = profileFormReducer(state, {
      type: "matching-change",
      field: "productKeywords",
      value: "probe cover, sterile drape",
    });
    state = profileFormReducer(state, { type: "matching-save-start" });
    state = profileFormReducer(state, {
      type: "matching-save-error",
      message: "Network error",
    });

    expect(state.matching.productKeywords).toBe("probe cover, sterile drape");
    expect(matchingFormIsDirty(state)).toBe(true);
    expect(state.matchingSave).toEqual({
      status: "error",
      message: "Network error",
    });
  });

  it("does not mark whitespace-only normalization changes as dirty", () => {
    let state = createProfileFormState(data);
    state = profileFormReducer(state, {
      type: "company-change",
      field: "name",
      value: "  MedicHall Devices  ",
    });
    expect(companyFormIsDirty(state)).toBe(false);
  });
});

import type {
  CompanyDetailsErrors,
  CompanyDetailsFormValue,
  MatchingProfileErrors,
  MatchingProfileFormValue,
} from "../types";
import { legacyCsvToArray } from "./map-company-profile";

export function validateCompanyDetails(
  form: CompanyDetailsFormValue,
): CompanyDetailsErrors {
  const errors: CompanyDetailsErrors = {};
  if (!form.name.trim()) errors.name = "Company name is required.";
  return errors;
}

export function validateMatchingProfile(
  form: MatchingProfileFormValue,
): MatchingProfileErrors {
  const errors: MatchingProfileErrors = {};
  if (legacyCsvToArray(form.productKeywords).length === 0) {
    errors.productKeywords = "Add at least one product keyword.";
  }

  if (form.minimumMatchScore.trim()) {
    const score = Number(form.minimumMatchScore);
    if (!Number.isFinite(score)) {
      errors.minimumMatchScore = "Enter a number from 0 to 100.";
    }
  }
  return errors;
}

export function hasValidationErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

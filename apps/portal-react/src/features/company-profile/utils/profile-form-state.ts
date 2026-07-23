import type {
  CompanyDetailsErrors,
  CompanyDetailsField,
  CompanyDetailsFormValue,
  CompanyProfileData,
  MatchingProfileErrors,
  MatchingProfileField,
  MatchingProfileFormValue,
  SaveFeedback,
} from "../types";
import {
  companyRecordToForm,
  matchingRecordToForm,
  sameCompanyForm,
  sameMatchingForm,
} from "./map-company-profile";

const IDLE_FEEDBACK: SaveFeedback = { status: "idle", message: null };

export type ProfileFormState = {
  company: CompanyDetailsFormValue;
  initialCompany: CompanyDetailsFormValue;
  matching: MatchingProfileFormValue;
  initialMatching: MatchingProfileFormValue;
  companyErrors: CompanyDetailsErrors;
  matchingErrors: MatchingProfileErrors;
  companySave: SaveFeedback;
  matchingSave: SaveFeedback;
};

export type ProfileFormAction =
  | {
      type: "reset";
      data: CompanyProfileData;
    }
  | {
      type: "company-change";
      field: CompanyDetailsField;
      value: string;
    }
  | {
      type: "matching-change";
      field: MatchingProfileField;
      value: string | boolean;
    }
  | {
      type: "company-validation";
      errors: CompanyDetailsErrors;
    }
  | {
      type: "matching-validation";
      errors: MatchingProfileErrors;
    }
  | {
      type: "company-save-start";
    }
  | {
      type: "matching-save-start";
    }
  | {
      type: "company-save-success";
      form: CompanyDetailsFormValue;
    }
  | {
      type: "matching-save-success";
      form: MatchingProfileFormValue;
    }
  | {
      type: "company-save-error";
      message: string;
    }
  | {
      type: "matching-save-error";
      message: string;
    };

export function createProfileFormState(data: CompanyProfileData): ProfileFormState {
  const company = companyRecordToForm(data.company);
  const matching = matchingRecordToForm(data.matchingProfile, data.company);
  return {
    company,
    initialCompany: company,
    matching,
    initialMatching: matching,
    companyErrors: {},
    matchingErrors: {},
    companySave: IDLE_FEEDBACK,
    matchingSave: IDLE_FEEDBACK,
  };
}

export function profileFormReducer(
  state: ProfileFormState,
  action: ProfileFormAction,
): ProfileFormState {
  switch (action.type) {
    case "reset":
      return createProfileFormState(action.data);
    case "company-change":
      return {
        ...state,
        company: { ...state.company, [action.field]: action.value },
        companyErrors: { ...state.companyErrors, [action.field]: undefined },
        companySave: IDLE_FEEDBACK,
      };
    case "matching-change":
      return {
        ...state,
        matching: { ...state.matching, [action.field]: action.value },
        matchingErrors: { ...state.matchingErrors, [action.field]: undefined },
        matchingSave: IDLE_FEEDBACK,
      };
    case "company-validation":
      return { ...state, companyErrors: action.errors };
    case "matching-validation":
      return { ...state, matchingErrors: action.errors };
    case "company-save-start":
      return {
        ...state,
        companyErrors: {},
        companySave: { status: "saving", message: "Saving company details…" },
      };
    case "matching-save-start":
      return {
        ...state,
        matchingErrors: {},
        matchingSave: { status: "saving", message: "Saving matching profile…" },
      };
    case "company-save-success":
      return {
        ...state,
        company: action.form,
        initialCompany: action.form,
        companySave: { status: "success", message: "Company profile saved." },
      };
    case "matching-save-success":
      return {
        ...state,
        matching: action.form,
        initialMatching: action.form,
        matchingSave: { status: "success", message: "Matching profile saved." },
      };
    case "company-save-error":
      return {
        ...state,
        companySave: { status: "error", message: action.message },
      };
    case "matching-save-error":
      return {
        ...state,
        matchingSave: { status: "error", message: action.message },
      };
  }
}

export function companyFormIsDirty(state: ProfileFormState): boolean {
  return !sameCompanyForm(state.company, state.initialCompany);
}

export function matchingFormIsDirty(state: ProfileFormState): boolean {
  return !sameMatchingForm(state.matching, state.initialMatching);
}

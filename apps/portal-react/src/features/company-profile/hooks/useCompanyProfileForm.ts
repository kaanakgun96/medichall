import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  updateCompanyProfile,
  upsertMatchingProfile,
} from "../api/company-profile-api";
import type {
  CompanyDetailsField,
  CompanyProfileData,
  MatchingProfileField,
} from "../types";
import {
  companyFormToUpdate,
  companyRecordToForm,
  matchingFormToUpdate,
  matchingRecordToForm,
} from "../utils/map-company-profile";
import {
  companyFormIsDirty,
  createProfileFormState,
  matchingFormIsDirty,
  profileFormReducer,
} from "../utils/profile-form-state";
import {
  hasValidationErrors,
  validateCompanyDetails,
  validateMatchingProfile,
} from "../utils/company-profile-validation";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The profile could not be saved.";
}

export function useCompanyProfileForm(data: CompanyProfileData) {
  const [state, dispatch] = useReducer(profileFormReducer, data, createProfileFormState);
  const [matchingProfile, setMatchingProfile] = useState(data.matchingProfile);
  const companySaveLock = useRef(false);
  const matchingSaveLock = useRef(false);

  useEffect(() => {
    dispatch({ type: "reset", data });
    setMatchingProfile(data.matchingProfile);
  }, [data]);

  const companyDirty = companyFormIsDirty(state);
  const matchingDirty = matchingFormIsDirty(state);

  useEffect(() => {
    if (!companyDirty && !matchingDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [companyDirty, matchingDirty]);

  const changeCompany = useCallback((field: CompanyDetailsField, value: string) => {
    dispatch({ type: "company-change", field, value });
  }, []);

  const changeMatching = useCallback((
    field: MatchingProfileField,
    value: string | boolean,
  ) => {
    dispatch({ type: "matching-change", field, value });
  }, []);

  const saveCompany = useCallback(async () => {
    if (companySaveLock.current || !companyFormIsDirty(state)) return;
    const errors = validateCompanyDetails(state.company);
    dispatch({ type: "company-validation", errors });
    if (hasValidationErrors(errors)) return;

    companySaveLock.current = true;
    dispatch({ type: "company-save-start" });
    try {
      const company = await updateCompanyProfile(
        data.company.id,
        companyFormToUpdate(state.company),
      );
      dispatch({
        type: "company-save-success",
        form: companyRecordToForm(company),
      });
    } catch (saveError) {
      dispatch({ type: "company-save-error", message: errorMessage(saveError) });
    } finally {
      companySaveLock.current = false;
    }
  }, [data.company.id, state]);

  const saveMatching = useCallback(async () => {
    if (matchingSaveLock.current || !matchingFormIsDirty(state)) return;
    const errors = validateMatchingProfile(state.matching);
    dispatch({ type: "matching-validation", errors });
    if (hasValidationErrors(errors)) return;

    matchingSaveLock.current = true;
    dispatch({ type: "matching-save-start" });
    try {
      const profile = await upsertMatchingProfile(
        matchingFormToUpdate(
          data.company.id,
          state.matching,
          new Date().toISOString(),
        ),
      );
      dispatch({
        type: "matching-save-success",
        form: matchingRecordToForm(profile, data.company),
      });
      setMatchingProfile(profile);
    } catch (saveError) {
      dispatch({ type: "matching-save-error", message: errorMessage(saveError) });
    } finally {
      matchingSaveLock.current = false;
    }
  }, [data.company, state]);

  return useMemo(() => ({
    state,
    companyDirty,
    matchingDirty,
    matchingProfile,
    changeCompany,
    changeMatching,
    saveCompany,
    saveMatching,
  }), [
    changeCompany,
    changeMatching,
    companyDirty,
    matchingDirty,
    matchingProfile,
    saveCompany,
    saveMatching,
    state,
  ]);
}

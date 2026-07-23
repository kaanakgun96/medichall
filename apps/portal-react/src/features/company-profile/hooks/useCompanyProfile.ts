import { useCallback, useEffect, useMemo, useState } from "react";
import { SupabaseApiError } from "../../../shared/api/supabase-http";
import { hasLegacySession } from "../../../shared/auth/legacy-session";
import {
  fetchCompanyProfileData,
  fetchOwnedCompanyProfile,
  fetchProfileUser,
} from "../api/company-profile-api";
import type { CompanyProfileData, ProfileError } from "../types";
import {
  determineCompanyProfileEligibility,
  type CompanyProfileEligibility,
} from "../utils/company-profile-eligibility";
import { toCompanyProfileError } from "../utils/company-profile-errors";

export function useCompanyProfile() {
  const initialSession = hasLegacySession();
  const [sessionPresent, setSessionPresent] = useState(initialSession);
  const [companyId, setCompanyId] = useState<number | null | undefined>(
    initialSession ? undefined : null,
  );
  const [data, setData] = useState<CompanyProfileData | null>(null);
  const [error, setError] = useState<ProfileError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hasLegacySession()) {
      setSessionPresent(false);
      setCompanyId(null);
      setData(null);
      setError(null);
      return;
    }

    setSessionPresent(true);
    setCompanyId(undefined);
    setData(null);
    setError(null);

    try {
      const user = await fetchProfileUser(signal);
      const company = await fetchOwnedCompanyProfile(user.id, signal);
      if (!company) {
        setCompanyId(null);
        return;
      }
      setCompanyId(company.id);
      setData(await fetchCompanyProfileData(company, signal));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      if (
        (loadError instanceof SupabaseApiError && loadError.status === 401)
        || !hasLegacySession()
      ) {
        setSessionPresent(false);
        setCompanyId(null);
        setData(null);
        setError(null);
        return;
      }
      setCompanyId(null);
      setData(null);
      setError(toCompanyProfileError(loadError));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(() => {
    const reload = () => setReloadKey((key) => key + 1);
    window.addEventListener("storage", reload);
    window.addEventListener("medichall:session-changed", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("medichall:session-changed", reload);
    };
  }, []);

  const eligibility: CompanyProfileEligibility = useMemo(
    () => determineCompanyProfileEligibility(sessionPresent, companyId),
    [companyId, sessionPresent],
  );

  return {
    data,
    eligibility,
    error,
    retry: () => setReloadKey((key) => key + 1),
  };
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { SupabaseApiError } from "../../../shared/api/supabase-http";
import { hasLegacySession } from "../../../shared/auth/legacy-session";
import { fetchCurrentUser, fetchOwnedCompany } from "../api/opportunities-api";
import type { OpportunityError, PartnerCompany } from "../types";
import { determineOpportunityEligibility } from "../utils/opportunity-eligibility";
import { toOpportunityError } from "../utils/opportunity-errors";

export function usePartnerCompany() {
  const initialSession = hasLegacySession();
  const [sessionPresent, setSessionPresent] = useState(initialSession);
  const [company, setCompany] = useState<PartnerCompany | null>(null);
  const [companyId, setCompanyId] = useState<number | null | undefined>(
    initialSession ? undefined : null,
  );
  const [error, setError] = useState<OpportunityError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hasLegacySession()) {
      setSessionPresent(false);
      setCompany(null);
      setCompanyId(null);
      setError(null);
      return;
    }

    setSessionPresent(true);
    setCompany(null);
    setCompanyId(undefined);
    setError(null);
    try {
      const user = await fetchCurrentUser(signal);
      const ownedCompany = await fetchOwnedCompany(user.id, signal);
      setCompany(ownedCompany);
      setCompanyId(ownedCompany?.id ?? null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      if (
        (loadError instanceof SupabaseApiError && loadError.status === 401) ||
        !hasLegacySession()
      ) {
        setSessionPresent(false);
        setCompany(null);
        setCompanyId(null);
        setError(null);
        return;
      }
      setCompanyId(null);
      setError(toOpportunityError(loadError));
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

  const eligibility = useMemo(
    () => determineOpportunityEligibility(sessionPresent, companyId),
    [companyId, sessionPresent],
  );

  return {
    company,
    eligibility,
    error,
    retry: () => setReloadKey((key) => key + 1),
  };
}

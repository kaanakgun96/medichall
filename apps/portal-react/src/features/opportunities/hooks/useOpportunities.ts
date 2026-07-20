import { useCallback, useEffect, useState } from "react";
import {
  fetchOpportunityPage,
  refreshCompanyOpportunityMatches,
  setOpportunityMatchStatus,
} from "../api/opportunities-api";
import type {
  Opportunity,
  OpportunityError,
  OpportunityFiltersValue,
  OpportunityStatus,
} from "../types";
import { toOpportunityError } from "../utils/opportunity-errors";

export function useOpportunities(companyId: number, filters: OpportunityFiltersValue) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<OpportunityError | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mutatingId, setMutatingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { kind, minimumScore } = filters;

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    setActionError(null);
    setOpportunities([]);

    void fetchOpportunityPage(companyId, { kind, minimumScore }, 0, controller.signal)
      .then((page) => {
        setOpportunities(page.opportunities);
        setHasMore(page.hasMore);
        setStatus("success");
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setOpportunities([]);
        setHasMore(false);
        setError(toOpportunityError(loadError));
        setStatus("error");
      });

    return () => controller.abort();
  }, [companyId, kind, minimumScore, reloadKey]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    setActionError(null);
    try {
      const page = await fetchOpportunityPage(
        companyId,
        { kind, minimumScore },
        opportunities.length,
      );
      setOpportunities((current) => [...current, ...page.opportunities]);
      setHasMore(page.hasMore);
    } catch (loadError) {
      setActionError(toOpportunityError(loadError).message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [companyId, hasMore, isLoadingMore, kind, minimumScore, opportunities.length]);

  const refreshMatches = useCallback(async () => {
    setIsRefreshing(true);
    setActionError(null);
    try {
      await refreshCompanyOpportunityMatches(companyId);
      setReloadKey((key) => key + 1);
    } catch (refreshError) {
      setActionError(toOpportunityError(refreshError).message);
    } finally {
      setIsRefreshing(false);
    }
  }, [companyId]);

  const updateStatus = useCallback(async (
    opportunity: Opportunity,
    nextStatus: OpportunityStatus,
  ) => {
    setMutatingId(opportunity.id);
    setActionError(null);
    try {
      await setOpportunityMatchStatus(opportunity.id, nextStatus);
      setOpportunities((current) => nextStatus === "dismissed"
        ? current.filter((item) => item.id !== opportunity.id)
        : current.map((item) => item.id === opportunity.id
          ? { ...item, status: nextStatus }
          : item));
    } catch (updateError) {
      setActionError(toOpportunityError(updateError).message);
    } finally {
      setMutatingId(null);
    }
  }, []);

  return {
    opportunities,
    status,
    error,
    hasMore,
    isLoadingMore,
    isRefreshing,
    mutatingId,
    actionError,
    loadMore,
    refreshMatches,
    updateStatus,
    retry: () => setReloadKey((key) => key + 1),
  };
}

import { useCallback, useEffect, useState } from "react";
import { SupabaseApiError } from "../../../shared/api/supabase-http";
import { useDebouncedValue } from "../../../shared/hooks/useDebouncedValue";
import { searchTenders } from "../api/tenders-api";
import type { Tender, TenderFilters } from "../types";

type SearchError = {
  kind: "migration" | "configuration" | "request";
  message: string;
};

function toSearchError(error: unknown): SearchError {
  const message = error instanceof Error ? error.message : "The tender feed could not be loaded.";
  const missingRpc =
    message.includes("search_tenders") ||
    (error instanceof SupabaseApiError && (error.code === "PGRST202" || error.status === 404));

  if (missingRpc) {
    return {
      kind: "migration",
      message:
        "The search_tenders RPC is unavailable. Install the existing tender-filter, English-normalization, and saved-search migrations before using this page.",
    };
  }
  if (error instanceof Error && error.name === "SupabaseConfigurationError") {
    return { kind: "configuration", message };
  }
  return { kind: "request", message };
}

export function useTenderSearch(filters: TenderFilters) {
  const debouncedFilters = useDebouncedValue(filters, 350);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<SearchError | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    setLoadMoreError(null);

    void searchTenders(debouncedFilters, 0, controller.signal)
      .then((rows) => {
        setTenders(rows);
        setTotalCount(rows.length ? Number(rows[0].total_count || 0) : 0);
        setStatus("success");
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setTenders([]);
        setTotalCount(0);
        setError(toSearchError(requestError));
        setStatus("error");
      });

    return () => controller.abort();
  }, [debouncedFilters, reloadKey]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || tenders.length >= totalCount) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const rows = await searchTenders(debouncedFilters, tenders.length);
      setTenders((current) => [...current, ...rows]);
      if (rows.length) setTotalCount(Number(rows[0].total_count || totalCount));
    } catch (requestError) {
      setLoadMoreError(toSearchError(requestError).message);
    } finally {
      setIsLoadingMore(false);
    }
  }, [debouncedFilters, isLoadingMore, tenders.length, totalCount]);

  return {
    tenders,
    totalCount,
    status,
    error,
    isLoadingMore,
    loadMoreError,
    hasMore: tenders.length < totalCount,
    isDebouncing: filters !== debouncedFilters,
    loadMore,
    retry: () => setReloadKey((key) => key + 1),
  };
}

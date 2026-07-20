import { useCallback, useEffect, useState } from "react";
import { hasLegacySession } from "../../../shared/auth/legacy-session";
import {
  createSavedSearch,
  deleteSavedSearch,
  fetchSavedSearches,
  setSavedSearchAlert,
} from "../api/saved-searches-api";
import type { SavedSearch, SavedSearchInsert } from "../types";

export function useSavedSearches() {
  const [signedIn, setSignedIn] = useState(hasLegacySession);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [status, setStatus] = useState<"signed-out" | "loading" | "success" | "error">(
    signedIn ? "loading" : "signed-out",
  );
  const [error, setError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hasLegacySession()) {
      setSignedIn(false);
      setSearches([]);
      setStatus("signed-out");
      return;
    }

    setSignedIn(true);
    setStatus("loading");
    setError(null);
    try {
      const rows = await fetchSavedSearches(signal);
      setSearches(rows);
      setStatus("success");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Saved searches could not be loaded.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => void load();
    window.addEventListener("storage", refresh);
    window.addEventListener("medichall:session-changed", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("storage", refresh);
      window.removeEventListener("medichall:session-changed", refresh);
    };
  }, [load]);

  const create = useCallback(async (search: SavedSearchInsert) => {
    await createSavedSearch(search);
    await load();
  }, [load]);

  const toggleAlert = useCallback(async (search: SavedSearch) => {
    setMutatingId(search.id);
    try {
      await setSavedSearchAlert(search.id, !search.email_alerts);
      setSearches((current) =>
        current.map((item) => item.id === search.id ? { ...item, email_alerts: !item.email_alerts } : item),
      );
    } finally {
      setMutatingId(null);
    }
  }, []);

  const remove = useCallback(async (search: SavedSearch) => {
    setMutatingId(search.id);
    try {
      await deleteSavedSearch(search.id);
      setSearches((current) => current.filter((item) => item.id !== search.id));
    } finally {
      setMutatingId(null);
    }
  }, []);

  return {
    signedIn,
    searches,
    status,
    error,
    mutatingId,
    create,
    toggleAlert,
    remove,
    retry: () => load(),
  };
}

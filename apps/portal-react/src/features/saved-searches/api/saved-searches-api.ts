import { supabaseRequest } from "../../../shared/api/supabase-http";
import type { SavedSearch, SavedSearchInsert } from "../types";

export function fetchSavedSearches(signal?: AbortSignal): Promise<SavedSearch[]> {
  return supabaseRequest<SavedSearch[]>(
    "/rest/v1/saved_searches?select=*&order=created_at.asc",
    { signal },
  );
}

export function createSavedSearch(search: SavedSearchInsert): Promise<void> {
  return supabaseRequest<void>("/rest/v1/saved_searches", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(search),
  });
}

export function setSavedSearchAlert(id: number, emailAlerts: boolean): Promise<void> {
  return supabaseRequest<void>(`/rest/v1/saved_searches?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ email_alerts: emailAlerts }),
  });
}

export function deleteSavedSearch(id: number): Promise<void> {
  return supabaseRequest<void>(`/rest/v1/saved_searches?id=eq.${id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

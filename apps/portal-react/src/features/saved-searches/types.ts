import type { TenderFilters } from "../tenders/types";
import { parseCpvInput } from "../tenders/utils/tender-filters";

export type SavedSearch = {
  id: number;
  user_id: string;
  name: string;
  query: string | null;
  countries: string[] | null;
  cpv: string[] | null;
  notice_types: string[] | null;
  deadline_days: number | null;
  value_min_eur: number | null;
  value_max_eur: number | null;
  include_unknown_value: boolean;
  email_alerts: boolean;
  last_digest_at: string;
  created_at: string;
  updated_at: string;
};

export type SavedSearchInsert = Omit<
  SavedSearch,
  "id" | "user_id" | "email_alerts" | "last_digest_at" | "created_at" | "updated_at"
>;

export function filtersToSavedSearch(name: string, filters: TenderFilters): SavedSearchInsert {
  const cpv = parseCpvInput(filters.cpv);
  return {
    name: name.trim().slice(0, 80),
    query: filters.query.trim() || null,
    countries: filters.country ? [filters.country] : null,
    cpv: cpv.length ? cpv : null,
    notice_types: filters.noticeType ? [filters.noticeType] : null,
    deadline_days: filters.deadlineWithinDays,
    value_min_eur: filters.valueMinEur,
    value_max_eur: filters.valueMaxEur,
    include_unknown_value: filters.includeUnknownValue,
  };
}

export function savedSearchToFilters(search: SavedSearch): TenderFilters {
  return {
    query: search.query || "",
    country: search.countries?.[0] || "",
    cpv: (search.cpv || []).join(", "),
    noticeType: search.notice_types?.[0] || "",
    deadlineWithinDays: search.deadline_days,
    valueMinEur: search.value_min_eur,
    valueMaxEur: search.value_max_eur,
    includeUnknownValue: search.include_unknown_value !== false,
  };
}

export function suggestedSavedSearchName(filters: TenderFilters): string {
  if (filters.cpv.trim()) return `CPV ${filters.cpv.trim()}`.slice(0, 80);
  return (filters.query.trim() || filters.country || "My search").slice(0, 80);
}

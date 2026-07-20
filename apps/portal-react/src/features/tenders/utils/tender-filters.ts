import type { TenderFilters } from "../types";

export const PAGE_SIZE = 20;

export const DEFAULT_TENDER_FILTERS: TenderFilters = {
  query: "",
  country: "",
  cpv: "",
  noticeType: "",
  deadlineWithinDays: null,
  valueMinEur: null,
  valueMaxEur: null,
  includeUnknownValue: true,
};

export function parseCpvInput(value: string): string[] {
  return [...new Set(value.split(/[,;]/).map((item) => item.trim()).filter(Boolean))];
}

export function filtersToSearchRpc(
  filters: TenderFilters,
  offset: number,
): Record<string, unknown> {
  const cpv = parseCpvInput(filters.cpv);

  return {
    p_query: filters.query.trim() || null,
    p_countries: filters.country ? [filters.country] : null,
    p_cpv: cpv.length ? cpv : null,
    p_notice_types: filters.noticeType ? [filters.noticeType] : null,
    p_deadline_within_days: filters.deadlineWithinDays,
    p_value_min_eur: filters.valueMinEur,
    p_value_max_eur: filters.valueMaxEur,
    p_include_unknown_value: filters.includeUnknownValue,
    p_limit: PAGE_SIZE,
    p_offset: Math.max(0, offset),
  };
}

export function activeAdvancedFilterCount(filters: TenderFilters): number {
  let count = 0;
  if (filters.country) count += 1;
  if (filters.cpv.trim()) count += 1;
  if (filters.noticeType) count += 1;
  if (filters.deadlineWithinDays !== null) count += 1;
  if (filters.valueMinEur !== null || filters.valueMaxEur !== null) count += 1;
  if (!filters.includeUnknownValue) count += 1;
  return count;
}

export function hasSaveableFilter(filters: TenderFilters): boolean {
  return Boolean(
    filters.query.trim() ||
      filters.country ||
      filters.cpv.trim() ||
      filters.noticeType ||
      filters.deadlineWithinDays !== null ||
      filters.valueMinEur !== null ||
      filters.valueMaxEur !== null,
  );
}

export function withCpvCode(currentValue: string, code: string): string {
  const selected = new Set(parseCpvInput(currentValue));
  if (selected.has(code)) selected.delete(code);
  else selected.add(code);
  return [...selected].sort().join(", ");
}

import { postRpc, supabaseRequest } from "../../../shared/api/supabase-http";
import type { CpvCatalogItem, Tender, TenderFacets, TenderFilters } from "../types";
import { filtersToSearchRpc } from "../utils/tender-filters";

export function searchTenders(
  filters: TenderFilters,
  offset: number,
  signal?: AbortSignal,
): Promise<Tender[]> {
  return postRpc<Tender[]>("search_tenders", filtersToSearchRpc(filters, offset), signal);
}

export function fetchTenderFacets(signal?: AbortSignal): Promise<TenderFacets> {
  return postRpc<TenderFacets>("tender_filter_facets", {}, signal);
}

export async function fetchFallbackCountries(signal?: AbortSignal): Promise<string[]> {
  const rows = await supabaseRequest<Array<{ country_name: string | null }>>(
    "/rest/v1/tenders?select=country_name&status=eq.open&order=publication_date.desc&limit=1000",
    { signal },
  );
  return [...new Set(rows.map((row) => row.country_name).filter((name): name is string => Boolean(name)))].sort();
}

export function fetchCpvCatalog(signal?: AbortSignal): Promise<CpvCatalogItem[]> {
  return postRpc<CpvCatalogItem[]>("cpv_catalog_with_counts", { p_max_depth: 5 }, signal);
}

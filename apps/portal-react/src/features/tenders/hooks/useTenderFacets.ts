import { useEffect, useState } from "react";
import { fetchFallbackCountries, fetchTenderFacets } from "../api/tenders-api";
import type { TenderFacets } from "../types";

const EMPTY_FACETS: TenderFacets = {
  countries: [],
  notice_types: [],
  currencies: [],
  fx_as_of: null,
};

export function useTenderFacets() {
  const [facets, setFacets] = useState<TenderFacets>(EMPTY_FACETS);
  const [status, setStatus] = useState<"loading" | "success" | "fallback" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();

    void fetchTenderFacets(controller.signal)
      .then((response) => {
        setFacets({
          countries: response.countries || [],
          notice_types: response.notice_types || [],
          currencies: response.currencies || [],
          fx_as_of: response.fx_as_of || null,
        });
        setStatus("success");
      })
      .catch(async (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        try {
          const countries = await fetchFallbackCountries(controller.signal);
          setFacets({ ...EMPTY_FACETS, countries });
          setStatus("fallback");
        } catch (fallbackError) {
          if (fallbackError instanceof DOMException && fallbackError.name === "AbortError") return;
          setStatus("error");
        }
      });

    return () => controller.abort();
  }, []);

  return { facets, status };
}

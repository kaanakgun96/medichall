import type { Opportunity, OpportunityFiltersValue } from "../types";
import { DEFAULT_OPPORTUNITY_FILTERS } from "../types";

function opportunityCountry(opportunity: Opportunity): string {
  return opportunity.tender?.countryName ?? opportunity.distributor?.countryName ?? "";
}

export function opportunityCountries(opportunities: Opportunity[]): string[] {
  return [...new Set(opportunities.map(opportunityCountry).filter(Boolean))].sort();
}

export function hasActiveOpportunityFilters(filters: OpportunityFiltersValue): boolean {
  return Boolean(
    filters.query.trim() ||
    filters.kind ||
    filters.country ||
    filters.minimumScore !== DEFAULT_OPPORTUNITY_FILTERS.minimumScore
  );
}

export function filterOpportunities(
  opportunities: Opportunity[],
  filters: OpportunityFiltersValue,
): Opportunity[] {
  const query = filters.query.trim().toLowerCase();
  const countries = opportunityCountries(opportunities);
  const queryAsCountry = query
    ? countries.find((country) => country.toLowerCase() === query)
    : undefined;

  return opportunities.filter((opportunity) => {
    if (filters.kind && opportunity.kind !== filters.kind) return false;
    if (opportunity.matchScore < filters.minimumScore) return false;

    const country = opportunityCountry(opportunity);
    if (filters.country && country !== filters.country) return false;
    if (queryAsCountry) return country === queryAsCountry;
    if (!query) return true;

    const tender = opportunity.tender;
    const distributor = opportunity.distributor;
    return [
      tender?.title,
      tender?.titleEn,
      tender?.buyerName,
      tender?.countryName,
      tender?.source,
      distributor?.name,
      distributor?.countryName,
      distributor?.companyType,
      ...opportunity.reasons,
      ...(distributor?.productKeywords ?? []),
      ...(distributor?.productCategories ?? []),
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
}

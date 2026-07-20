import { RotateCcw, Search } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import type { OpportunityFiltersValue } from "../types";

type OpportunityFiltersProps = {
  filters: OpportunityFiltersValue;
  countries: string[];
  onChange: (filters: OpportunityFiltersValue) => void;
  onReset: () => void;
};

export function OpportunityFilters({
  filters,
  countries,
  onChange,
  onReset,
}: OpportunityFiltersProps) {
  return (
    <section className="opportunity-filters" aria-label="Opportunity filters">
      <label className="search-field" htmlFor="opportunity-search">
        <Search size={19} aria-hidden="true" />
        <input
          id="opportunity-search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Search matches, reasons, countries, or buyers…"
        />
      </label>
      <label>
        <span>Type</span>
        <select
          value={filters.kind}
          onChange={(event) => onChange({
            ...filters,
            kind: event.target.value as OpportunityFiltersValue["kind"],
            country: "",
          })}
        >
          <option value="">All types</option>
          <option value="tender">Tenders</option>
          <option value="distributor">Distributors</option>
        </select>
      </label>
      <label>
        <span>Country</span>
        <select
          value={filters.country}
          onChange={(event) => onChange({ ...filters, country: event.target.value })}
        >
          <option value="">All countries</option>
          {countries.map((country) => <option key={country}>{country}</option>)}
        </select>
      </label>
      <label>
        <span>Minimum legacy match</span>
        <select
          value={filters.minimumScore}
          onChange={(event) => onChange({
            ...filters,
            minimumScore: Number(event.target.value),
            country: "",
          })}
        >
          <option value="0">All scores</option>
          <option value="60">60% and above</option>
          <option value="80">80% and above</option>
        </select>
      </label>
      <Button tone="quiet" size="small" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" /> Reset filters
      </Button>
    </section>
  );
}

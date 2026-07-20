import { BellPlus, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../shared/components/Button";
import type { TenderFacets, TenderFilters as TenderFiltersValue } from "../types";
import { activeAdvancedFilterCount } from "../utils/tender-filters";
import { CpvSelector } from "./CpvSelector";

type TenderFiltersProps = {
  filters: TenderFiltersValue;
  facets: TenderFacets;
  facetsStatus: "loading" | "success" | "fallback" | "error";
  onChange: (filters: TenderFiltersValue) => void;
  onReset: () => void;
  onSave: () => void;
  canSave: boolean;
};

function nonNegativeNumber(value: string): number | null {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function TenderFilters({
  filters,
  facets,
  facetsStatus,
  onChange,
  onReset,
  onSave,
  canSave,
}: TenderFiltersProps) {
  const [expanded, setExpanded] = useState(true);
  const activeCount = activeAdvancedFilterCount(filters);
  const update = <Key extends keyof TenderFiltersValue>(key: Key, value: TenderFiltersValue[Key]) =>
    onChange({ ...filters, [key]: value });

  return (
    <section className="filter-shell" aria-label="Tender filters">
      <div className="filter-shell__topline">
        <label className="search-field" htmlFor="tender-search">
          <Search size={19} aria-hidden="true" />
          <input
            id="tender-search"
            value={filters.query}
            onChange={(event) => update("query", event.target.value)}
            placeholder="Search all tenders — country, product, buyer…"
          />
        </label>
        <Button
          className={expanded ? "is-active" : ""}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="advanced-tender-filters"
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          Filters
          {activeCount ? <span className="filter-count">{activeCount}</span> : null}
        </Button>
      </div>

      {expanded ? (
        <div className="advanced-filters" id="advanced-tender-filters">
          <div className="advanced-filters__grid">
            <label>
              <span>Country</span>
              <select
                value={filters.country}
                onChange={(event) => update("country", event.target.value)}
                disabled={facetsStatus === "loading"}
              >
                <option value="">All countries</option>
                {facets.countries.map((country) => <option key={country}>{country}</option>)}
              </select>
            </label>

            <label>
              <span>Deadline within</span>
              <select
                value={filters.deadlineWithinDays ?? ""}
                onChange={(event) => update("deadlineWithinDays", event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Any deadline</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </label>

            <label>
              <span>Notice type</span>
              <select
                value={filters.noticeType}
                onChange={(event) => update("noticeType", event.target.value)}
                disabled={facetsStatus === "loading" || facets.notice_types.length === 0}
              >
                <option value="">All notice types</option>
                {facets.notice_types.map((noticeType) => <option key={noticeType}>{noticeType}</option>)}
              </select>
            </label>

            <label className="filter-field--wide">
              <span>CPV code / family</span>
              <CpvSelector value={filters.cpv} onChange={(value) => update("cpv", value)} />
            </label>

            <fieldset className="value-filter">
              <legend>Estimated value (EUR)</legend>
              <div className="value-filter__row">
                <label>
                  <span className="sr-only">Minimum estimated value in EUR</span>
                  <input
                    type="number"
                    min="0"
                    value={filters.valueMinEur ?? ""}
                    onChange={(event) => update("valueMinEur", nonNegativeNumber(event.target.value))}
                    placeholder="Minimum"
                  />
                </label>
                <span aria-hidden="true">—</span>
                <label>
                  <span className="sr-only">Maximum estimated value in EUR</span>
                  <input
                    type="number"
                    min="0"
                    value={filters.valueMaxEur ?? ""}
                    onChange={(event) => update("valueMaxEur", nonNegativeNumber(event.target.value))}
                    placeholder="Maximum"
                  />
                </label>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={filters.includeUnknownValue}
                  onChange={(event) => update("includeUnknownValue", event.target.checked)}
                />
                <span>Include tenders with no stated value</span>
              </label>
            </fieldset>
          </div>

          <div className="advanced-filters__footer">
            <p>
              {facets.fx_as_of
                ? `Non-EUR values use official ECB reference rates (${facets.fx_as_of}). Original values are always shown.`
                : facetsStatus === "fallback"
                  ? "Country options are using the legacy feed fallback; advanced facets require the tender-filter migration."
                  : "Original tender values are always shown; EUR conversions are marked as approximate."}
            </p>
            <div>
              <Button tone="quiet" size="small" onClick={onReset}>
                <RotateCcw size={15} aria-hidden="true" /> Reset
              </Button>
              <Button tone="primary" size="small" onClick={onSave} disabled={!canSave}>
                <BellPlus size={15} aria-hidden="true" /> Save search
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

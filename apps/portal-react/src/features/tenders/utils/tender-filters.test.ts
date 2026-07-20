import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENDER_FILTERS,
  activeAdvancedFilterCount,
  filtersToSearchRpc,
  hasSaveableFilter,
  parseCpvInput,
  withCpvCode,
} from "./tender-filters";

describe("tender filter RPC compatibility", () => {
  it("maps the existing All Tenders filters to the search_tenders RPC", () => {
    expect(
      filtersToSearchRpc(
        {
          query: " ultrasound ",
          country: "Germany",
          cpv: "3319, 33140000; 3319",
          noticeType: "Contract notice",
          deadlineWithinDays: 30,
          valueMinEur: 10_000,
          valueMaxEur: 500_000,
          includeUnknownValue: false,
        },
        20,
      ),
    ).toEqual({
      p_query: "ultrasound",
      p_countries: ["Germany"],
      p_cpv: ["3319", "33140000"],
      p_notice_types: ["Contract notice"],
      p_deadline_within_days: 30,
      p_value_min_eur: 10_000,
      p_value_max_eur: 500_000,
      p_include_unknown_value: false,
      p_limit: 20,
      p_offset: 20,
    });
  });

  it("keeps the legacy default that unknown tender values are included", () => {
    expect(filtersToSearchRpc(DEFAULT_TENDER_FILTERS, -10)).toMatchObject({
      p_include_unknown_value: true,
      p_offset: 0,
    });
  });

  it("normalizes CPV separators without changing family prefixes", () => {
    expect(parseCpvInput("3319; 33190000,3319")).toEqual(["3319", "33190000"]);
    expect(withCpvCode("3319", "33140000")).toBe("33140000, 3319");
    expect(withCpvCode("33140000, 3319", "3319")).toBe("33140000");
  });

  it("counts advanced filters but excludes the visible search box", () => {
    expect(activeAdvancedFilterCount({ ...DEFAULT_TENDER_FILTERS, query: "gloves" })).toBe(0);
    expect(
      activeAdvancedFilterCount({
        ...DEFAULT_TENDER_FILTERS,
        country: "France",
        includeUnknownValue: false,
      }),
    ).toBe(2);
  });

  it("matches the saved-search rule that requires a meaningful filter", () => {
    expect(hasSaveableFilter(DEFAULT_TENDER_FILTERS)).toBe(false);
    expect(hasSaveableFilter({ ...DEFAULT_TENDER_FILTERS, includeUnknownValue: false })).toBe(false);
    expect(hasSaveableFilter({ ...DEFAULT_TENDER_FILTERS, cpv: "3319" })).toBe(true);
  });
});

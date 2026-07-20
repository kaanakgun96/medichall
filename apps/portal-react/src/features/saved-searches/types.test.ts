import { describe, expect, it } from "vitest";
import { DEFAULT_TENDER_FILTERS } from "../tenders/utils/tender-filters";
import { filtersToSavedSearch, savedSearchToFilters } from "./types";

describe("saved-search compatibility", () => {
  it("stores the same columns used by the existing saved_searches table", () => {
    expect(
      filtersToSavedSearch(" German imaging ", {
        ...DEFAULT_TENDER_FILTERS,
        country: "Germany",
        cpv: "3311, 33110000",
      }),
    ).toEqual({
      name: "German imaging",
      query: null,
      countries: ["Germany"],
      cpv: ["3311", "33110000"],
      notice_types: null,
      deadline_days: null,
      value_min_eur: null,
      value_max_eur: null,
      include_unknown_value: true,
    });
  });

  it("applies the first country and notice type like the legacy portal", () => {
    const filters = savedSearchToFilters({
      id: 1,
      user_id: "user",
      name: "Search",
      query: "gloves",
      countries: ["France", "Germany"],
      cpv: ["3314"],
      notice_types: ["Contract notice", "Prior information notice"],
      deadline_days: 30,
      value_min_eur: null,
      value_max_eur: null,
      include_unknown_value: true,
      email_alerts: true,
      last_digest_at: "2026-07-20T00:00:00Z",
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
    });
    expect(filters.country).toBe("France");
    expect(filters.noticeType).toBe("Contract notice");
    expect(filters.cpv).toBe("3314");
  });
});

import { describe, expect, it } from "vitest";
import type { Tender } from "../types";
import { formatTenderValue, safeExternalUrl } from "./format-tender";

const tender = {
  id: 1,
  title: "Tender",
  title_en: null,
  buyer_name: null,
  country_name: null,
  publication_date: null,
  deadline_at: null,
  estimated_value: 12_000_000,
  currency: "SEK",
  estimated_value_eur: 1_050_000,
  eur_rate_as_of: null,
  cpv_codes: [],
  notice_type: null,
  source_url: null,
  total_count: 1,
} satisfies Tender;

describe("tender card formatting", () => {
  it("keeps the original value and marks the ECB conversion as approximate", () => {
    expect(formatTenderValue(tender)).toBe("12,000,000 SEK (≈ 1,050,000 EUR)");
  });

  it("does not expose unsafe source URL schemes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("https://ted.europa.eu/example")).toBe("https://ted.europa.eu/example");
  });
});

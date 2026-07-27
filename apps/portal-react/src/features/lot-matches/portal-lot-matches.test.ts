import { describe, expect, it } from "vitest";
import portal from "../../../../../portal.html?raw";

type LotRecord = Record<string, unknown>;

type LotMatchUi = {
  lotNormalizeEvidence: (value: unknown) => Array<Record<string, unknown>>;
  lotNormalizeRecord: (value: unknown) => LotRecord;
  lotNormalizePayload: (value: unknown) => {
    company_id: number | null;
    tender_id: number | null;
    lots: LotRecord[];
  };
  lotRecommendationMeta: (value: string) => { label: string; css: string };
  lotDisplayLabel: (value: LotRecord) => string;
  lotSummarize: (value: LotRecord[]) => {
    total: number;
    relevant: number;
    failed: number;
    highest_relevant: LotRecord | null;
    counts: Record<string, number>;
  };
  lotRecordHtml: (
    value: LotRecord,
    index: number,
    matchId: number,
    products: LotRecord[],
  ) => string;
  lotResultsHtml: (
    payload: { tender_id: number; lots: LotRecord[] },
    products: LotRecord[],
    productLoadFailed: boolean,
    matchId: number,
  ) => string;
  lotEligibility: (
    token: string | null,
    company: LotRecord | null,
    configured: boolean,
  ) => string;
  lotEmptyStateKind: (tender: LotRecord) => string;
};

function between(start: string, end: string) {
  const startIndex = portal.indexOf(start);
  const endIndex = portal.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Missing portal test markers: ${start} / ${end}`);
  }
  return portal.slice(startIndex + start.length, endIndex);
}

const pureSource = between(
  "/* LOT_MATCH_UI_PURE_START */",
  "/* LOT_MATCH_UI_PURE_END */",
);
const runtimeSource = between(
  "/* LOT_MATCH_UI_RUNTIME_START */",
  "/* LOT_MATCH_UI_RUNTIME_END */",
);
const lotCss = between(
  "/* lot-level tender matching */",
  "/* mini catalog manager */",
);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const createUi = new Function(
  "esc",
  "PRODUCT_READINESS_LABELS",
  `${pureSource}
  return {
    lotNormalizeEvidence,
    lotNormalizeRecord,
    lotNormalizePayload,
    lotRecommendationMeta,
    lotDisplayLabel,
    lotSummarize,
    lotRecordHtml,
    lotResultsHtml,
    lotEligibility,
    lotEmptyStateKind
  };`,
) as (
  esc: typeof escapeHtml,
  labels: Record<string, string>,
) => LotMatchUi;

const ui = createUi(escapeHtml, {
  production_capacity: "production capacity",
  material: "material",
});

function completed(overrides: LotRecord = {}): LotRecord {
  return ui.lotNormalizeRecord({
    status: "completed",
    lot_key: "lot:1",
    lot_number: "1",
    lot_title: "Sterile surgical drape",
    match_score: 77,
    recommendation: "good_match",
    confidence_score: 60,
    best_company_product_id: 67,
    best_company_product_name: "Validation surgical drape",
    score_components: {
      product_identity: {
        score: 25,
        max_score: 30,
        status: "matched",
        reason: "Product identity overlaps.",
      },
    },
    matched_requirements: [{ code: "identity", message: "Product identity" }],
    blockers: [],
    gaps: [],
    unknowns: [{ code: "capacity", message: "Capacity is unknown" }],
    tender_evidence: [],
    company_evidence: [],
    ...overrides,
  });
}

describe("production portal lot-match UI", () => {
  it.each([
    ["strong_match", "Strong match"],
    ["good_match", "Good match"],
    ["possible_match", "Possible match"],
    ["weak_match", "Weak match"],
    ["not_recommended", "Not recommended"],
  ])("formats %s with the required label", (recommendation, label) => {
    expect(ui.lotRecommendationMeta(recommendation).label).toBe(label);
  });

  it("labels an unassigned extraction without inventing a lot number", () => {
    expect(ui.lotDisplayLabel(completed({ lot_number: null }))).toBe(
      "Extracted product group — no reliable lot number found",
    );
  });

  it("keeps a reliable lot number in the display label", () => {
    expect(ui.lotDisplayLabel(completed({ lot_number: "29" }))).toBe("Lot 29");
  });

  it("counts only strong, good, and possible recommendations as relevant", () => {
    const summary = ui.lotSummarize([
      completed({ recommendation: "strong_match" }),
      completed({ recommendation: "good_match" }),
      completed({ recommendation: "possible_match" }),
      completed({ recommendation: "weak_match" }),
      completed({ recommendation: "not_recommended" }),
    ]);
    expect(summary.relevant).toBe(3);
    expect(summary.counts.weak_match).toBe(1);
    expect(summary.counts.not_recommended).toBe(1);
  });

  it("selects the highest relevant result without irrelevant-score distortion", () => {
    const good = completed({
      lot_key: "unassigned",
      match_score: 77,
      recommendation: "good_match",
    });
    const irrelevant = completed({
      lot_key: "lot:other",
      match_score: 99,
      recommendation: "not_recommended",
    });
    const summary = ui.lotSummarize([irrelevant, good]);
    expect(summary.highest_relevant?.lot_key).toBe("unassigned");
  });

  it("does not render a misleading average score", () => {
    const html = ui.lotResultsHtml(
      { tender_id: 2952, lots: [completed()] },
      [],
      false,
      4,
    );
    expect(html.toLowerCase()).not.toContain("average");
  });

  it("renders matched requirements, blockers, gaps, and unknowns separately", () => {
    const html = ui.lotRecordHtml(
      completed({
        blockers: [{ message: "Certificate absent" }],
        gaps: [{ message: "Packaging differs" }],
      }),
      0,
      4,
      [],
    );
    expect(html).toContain("Matched requirements");
    expect(html).toContain("Blockers");
    expect(html).toContain("Gaps");
    expect(html).toContain("Unknown or needs verification");
  });

  it("deduplicates evidence and retains the strongest confidence", () => {
    const evidence = ui.lotNormalizeEvidence([
      {
        document_id: 1,
        page_number: 41,
        field_name: "material",
        source_quote: "Two-layer material",
        extracted_value: "non-woven + PE",
        confidence_score: 60,
      },
      {
        document_id: 1,
        page_number: 41,
        field_name: "material",
        source_quote: "Two-layer material",
        extracted_value: "non-woven + PE",
        confidence_score: 92,
      },
    ]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].confidence_score).toBe(92);
  });

  it("escapes untrusted evidence and never renders executable markup", () => {
    const row = completed({
      tender_evidence: [
        {
          page_number: 41,
          field_name: "<img src=x onerror=alert(1)>",
          source_quote: "<script>alert(1)</script>",
          extracted_value: "<b>unsafe</b>",
          confidence_score: 90,
        },
      ],
    });
    const html = ui.lotRecordHtml(row, 0, 4, []);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });

  it("truncates the evidence preview and exposes accessible disclosure controls", () => {
    const quote = "Evidence ".repeat(40);
    const html = ui.lotRecordHtml(
      completed({
        tender_evidence: [{ page_number: 1, source_quote: quote }],
      }),
      0,
      4,
      [],
    );
    expect(html).toContain("…");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="lot-evidence-4-0"');
  });

  it("preserves a failed lot as a scoped partial-result card", () => {
    const failed = ui.lotNormalizeRecord({
      status: "failed",
      lot_key: "lot:2",
      lot_number: "2",
      lot_title: "Failed group",
      calculation_error: "Calculation unavailable",
    });
    expect(ui.lotRecordHtml(failed, 0, 4, [])).toContain(
      "Analysis unavailable",
    );
  });

  it("distinguishes signed-out, configuration, and eligible states", () => {
    expect(ui.lotEligibility(null, null, true)).toBe("signed_out");
    expect(ui.lotEligibility("token", { id: 11 }, false)).toBe(
      "configuration",
    );
    expect(ui.lotEligibility("token", { id: 11 }, true)).toBe("ready");
  });

  it("distinguishes processing, no-analysis, and completed-empty states", () => {
    expect(
      ui.lotEmptyStateKind({ document_analysis_status: "processing" }),
    ).toBe("extraction_processing");
    expect(ui.lotEmptyStateKind({ document_analysis_status: "pending" })).toBe(
      "no_analysis",
    );
    expect(
      ui.lotEmptyStateKind({ document_analysis_status: "completed" }),
    ).toBe("empty");
  });

  it("shows backend product readiness and an edit action for incomplete data", () => {
    const html = ui.lotRecordHtml(completed(), 0, 4, [
      {
        id: 67,
        matching_readiness: {
          score: 91,
          critical_missing_fields: ["production_capacity"],
        },
      },
    ]);
    expect(html).toContain("Product profile readiness: 91%");
    expect(html).toContain("production capacity");
    expect(html).toContain("Edit matched product");
  });

  it("shows the no-products state without changing backend scores", () => {
    const html = ui.lotResultsHtml(
      { tender_id: 2952, lots: [completed()] },
      [],
      false,
      4,
    );
    expect(html).toContain("No active company products");
    expect(html).toContain("77%");
  });

  it("uses only the owner-scoped read RPC and does not start document or AI work", () => {
    expect(runtimeSource).toContain("rpc/get_tender_lot_matches_v1");
    expect(runtimeSource).toContain("p_company_id:COMPANY.id");
    expect(runtimeSource).toContain("lotWithTimeout");
    expect(runtimeSource).toContain("Lot-match request timed out. Please retry.");
    expect(runtimeSource).not.toContain("tender-document-engine");
    expect(runtimeSource).not.toContain("medichall-ai");
    expect(runtimeSource).not.toContain("deepAnalyze(");
  });

  it("contains no service-role credential or private runtime identifier", () => {
    expect(runtimeSource.toLowerCase()).not.toContain("service_role");
    expect(runtimeSource).not.toMatch(/SUPABASE_SERVICE/i);
    expect(runtimeSource).not.toMatch(/company_id\s*:\s*11/);
    expect(runtimeSource).not.toMatch(/tender_id\s*:\s*2952/);
  });

  it("has responsive lot cards without unsafe fixed minimum widths", () => {
    expect(lotCss).toContain("@media(max-width:760px)");
    expect(lotCss).toContain("grid-template-columns:1fr");
    expect(lotCss).not.toMatch(/min-width:\s*[1-9]\d*px/);
  });

  it("preserves the structured product profile form regression surface", () => {
    [
      'id="p-normalized-cat"',
      'id="p-material"',
      'id="p-dimensions"',
      'id="p-sterility"',
      'id="p-use-type"',
      'id="p-capacity"',
      'id="p-certifications"',
    ].forEach((field) => expect(portal).toContain(field));
    expect(portal).toContain("matching_readiness");
  });
});

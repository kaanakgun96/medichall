import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageScanOrder,
  estimateAiCost,
  generatePdfChunkPlans,
  mapWithConcurrency,
  mergeChunkAnalyses,
  procurementKeywords,
  rankRelevantPageRanges,
  readDocumentIntelligenceConfig,
  rebaseRawEvidencePages,
  scoreProcurementPage,
} from "./document-intelligence-v3.ts";
import { normalizeDocumentAnalysis } from "./document-extraction-v2.ts";

function environment(values: Record<string, string>) {
  return (name: string) => values[name];
}

function analysis(input: {
  title?: string;
  confidence?: number;
  quantity?: number;
  page?: number;
  quote?: string;
}) {
  return normalizeDocumentAnalysis({
    analysis_status: "completed",
    document_confidence_score: input.confidence ?? 80,
    data_completeness_score: 70,
    summary: "Explicit medical supply requirement.",
    tender: {
      title_original: input.title ?? "Supply of sterile syringes",
      cpv_codes: ["33141310"],
    },
    products: [{
      product_name: "Sterile syringe",
      normalized_product_name: "sterile syringe",
      quantity_value: input.quantity ?? 1_000,
      quantity_unit: "pieces",
      quantity_scope: "contract",
      required_certifications: ["CE"],
      technical_requirements: ["sterile"],
      confidence_score: input.confidence ?? 80,
      evidence: [{
        document_id: 9,
        page_number: input.page ?? 4,
        source_quote: input.quote ?? "1,000 sterile syringes",
        field_name: "quantity",
        extracted_value: String(input.quantity ?? 1_000),
        requirement_status: "mandatory",
        confidence_score: input.confidence ?? 80,
      }],
    }],
  }, new Set([9]));
}

test("treats MAX_PDF_PAGES as an inspection scan ceiling, not rejection", () => {
  const config = readDocumentIntelligenceConfig(environment({
    MAX_PDF_PAGES: "100",
    MAX_TOTAL_AI_PAGES: "60",
    MAX_CHUNK_SIZE: "8",
    CHUNK_OVERLAP_PAGES: "99",
  }));
  assert.equal(config.maxPdfPages, 100);
  assert.equal(config.chunkOverlapPages, 7);
  for (const pageCount of [120, 250, 500, 650]) {
    const order = buildPageScanOrder(pageCount, config.maxPdfPages);
    assert.equal(order.length, 100);
    assert.equal(order[0], 1);
    assert.ok(order.includes(pageCount));
    assert.ok(order.every((page) => page >= 1 && page <= pageCount));
  }
});

test("creates bounded overlapping chunks for long relevant ranges", () => {
  const plans = generatePdfChunkPlans([{
    startPage: 40,
    endPage: 120,
    score: 80,
    reasons: ["technical specification"],
  }], {
    maxTotalAiPages: 50,
    maxChunkSize: 20,
    chunkOverlapPages: 3,
  });
  assert.deepEqual(
    plans.map((plan) => [plan.startPage, plan.endPage]),
    [[40, 59], [57, 76], [74, 83]],
  );
  assert.equal(
    plans.reduce((total, plan) => total + plan.pageNumbers.length, 0),
    50,
  );
  assert.equal(plans[0].pageNumbers.at(-1), plans[1].pageNumbers[2]);
});

test("discovers multilingual technical sections and annex context", () => {
  const keywords = procurementKeywords([]);
  const turkish = scoreProcurementPage(
    "Ek 4 Teknik Şartname: ürün miktar 2500 adet, steril cerrahi malzeme",
    keywords,
  );
  const german = scoreProcurementPage(
    "Anhang B Technische Spezifikation Anforderungen Menge steril",
    keywords,
  );
  assert.ok(turkish.score >= 20);
  assert.ok(german.score >= 20);

  const ranges = rankRelevantPageRanges({
    pageCount: 500,
    outline: [
      { title: "Technische Spezifikation", depth: 1, pageNumber: 225 },
      { title: "Annex – Product table", depth: 1, pageNumber: 480 },
    ],
    tableOfContentsPages: [2],
    pageSignals: [
      {
        pageNumber: 225,
        keywordScore: german.score,
        matchedKeywords: german.matchedKeywords,
        sectionTitle: "Technische Spezifikation",
        excerpt: "",
      },
      {
        pageNumber: 480,
        keywordScore: turkish.score,
        matchedKeywords: turkish.matchedKeywords,
        sectionTitle: "Ek 4 Teknik Şartname",
        excerpt: "",
      },
    ],
  });
  assert.ok(
    ranges.some((range) => range.startPage <= 225 && range.endPage >= 225),
  );
  assert.ok(
    ranges.some((range) => range.startPage <= 480 && range.endPage >= 480),
  );
});

test("rebases chunk-local evidence to original PDF pages", () => {
  const rebased = rebaseRawEvidencePages(
    {
      products: [{
        evidence: [
          { page_number: 1 },
          { page_number: 4 },
          { page_number: 9 },
        ],
      }],
    },
    201,
    4,
  );
  const evidence = (rebased.products as any[])[0].evidence;
  assert.deepEqual(
    evidence.map((item: any) => item.page_number),
    [201, 204, null],
  );
});

test("deterministically deduplicates evidence and preserves conflicts", () => {
  const first = analysis({
    title: "Supply of syringes",
    confidence: 70,
    quantity: 1_000,
    page: 4,
  });
  const duplicate = analysis({
    title: "Supply of syringes",
    confidence: 90,
    quantity: 1_000,
    page: 4,
  });
  const conflict = analysis({
    title: "Framework for syringes",
    confidence: 80,
    quantity: 2_000,
    page: 48,
    quote: "2,000 sterile syringes",
  });
  const input = [
    { chunkId: "a", startPage: 1, endPage: 20, analysis: first },
    { chunkId: "b", startPage: 1, endPage: 20, analysis: duplicate },
    { chunkId: "c", startPage: 40, endPage: 60, analysis: conflict },
  ];
  const merged = mergeChunkAnalyses(input);
  const repeated = mergeChunkAnalyses([...input].reverse());
  assert.deepEqual(repeated, merged);
  assert.equal(merged.tender.title_original, "Supply of syringes");
  assert.equal(merged.products[0].quantity_value, 1_000);
  assert.equal(merged.products[0].evidence.length, 2);
  assert.ok(
    merged.ambiguities.some((item) => item.field === "tender.title_original"),
  );
  assert.ok(
    merged.ambiguities.some((item) => item.field.endsWith(".quantity_value")),
  );
  assert.ok(merged.merge_statistics.duplicate_facts_removed > 0);
  assert.equal(merged.analysis_status, "partial");
});

test("bounds parallel chunk execution and keeps output order stable", async () => {
  let running = 0;
  let maximum = 0;
  const output = await mapWithConcurrency(
    Array.from({ length: 12 }, (_, index) => index),
    3,
    async (value) => {
      running++;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, value % 3));
      running--;
      return value * 2;
    },
  );
  assert.equal(maximum, 3);
  assert.deepEqual(output, Array.from({ length: 12 }, (_, index) => index * 2));
});

test("estimates provider cost from configured token prices", () => {
  assert.equal(
    estimateAiCost({
      input_tokens: 1_000_000,
      output_tokens: 100_000,
    }, {
      inputCostPerMillionTokens: 3,
      outputCostPerMillionTokens: 15,
    }),
    4.5,
  );
});

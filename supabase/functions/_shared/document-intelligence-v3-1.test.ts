import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDocumentAnalysis } from "./document-extraction-v2.ts";
import {
  createExecutionBudgetState,
  evaluateEarlyCompletion,
  executionGuardrailReason,
  planPrioritizedAdaptiveChunks,
  progressEstimate,
  readDocumentIntelligenceV31Config,
  rebindAnalysisDocumentId,
  recordExecutionUsage,
  reserveAiRequest,
  syntheticBenchmark,
} from "./document-intelligence-v3-1.ts";

function environment(values: Record<string, string>) {
  return (name: string) => values[name];
}

function completeAnalysis(documentId = 9) {
  return normalizeDocumentAnalysis({
    analysis_status: "completed",
    document_confidence_score: 94,
    data_completeness_score: 90,
    summary: "Technical product requirements are explicit.",
    tender: {
      title_original: "Sterile syringe procurement",
      cpv_codes: ["33141310"],
    },
    products: [{
      product_name: "Sterile syringe",
      normalized_product_name: "sterile syringe",
      quantity_value: 10_000,
      quantity_unit: "pieces",
      technical_requirements: ["Sterile, single use"],
      requirements: [{
        name: "Sterility",
        value: "Required",
        status: "mandatory",
      }],
      confidence_score: 94,
      evidence: [{
        document_id: documentId,
        page_number: 12,
        source_quote: "10,000 sterile single-use syringes",
        field_name: "quantity",
        extracted_value: "10000",
        requirement_status: "mandatory",
        confidence_score: 96,
      }],
    }],
  }, new Set([documentId]));
}

function benchmarkInspection(pageCount: number) {
  return {
    rankedRanges: [{
      startPage: 1,
      endPage: pageCount,
      score: 90,
      reasons: ["technical specification product quantity lot table"],
    }],
    pageSignals: Array.from(
      { length: pageCount },
      (_, index) => ({
        pageNumber: index + 1,
        keywordScore: 50,
        matchedKeywords: ["technical", "quantity"],
        sectionTitle: "Technical specifications",
        excerpt: "Product quantity and mandatory requirement",
        textLength: index % 3 === 0 ? 24_000 : 8_000,
      }),
    ),
  };
}

test("v3.1 configuration defaults to four workers and bounds guardrails", () => {
  const defaults = readDocumentIntelligenceV31Config(environment({}));
  assert.equal(defaults.maxParallelChunks, 4);
  assert.equal(defaults.chunkPriorityEnabled, true);
  assert.equal(defaults.adaptiveChunkingEnabled, true);
  assert.equal(defaults.benchmarkMode, false);

  const configured = readDocumentIntelligenceV31Config(environment({
    MAX_PARALLEL_CHUNKS: "99",
    MAX_AI_REQUESTS: "3",
    MAX_TOTAL_TOKENS: "4000",
    MAX_AI_COST_PER_DOCUMENT: "0.25",
    CACHE_TTL: "120",
    BENCHMARK_MODE: "true",
  }));
  assert.equal(configured.maxParallelChunks, 8);
  assert.equal(configured.maxAiRequests, 3);
  assert.equal(configured.maxTotalTokens, 4_000);
  assert.equal(configured.maxAiCostPerDocument, 0.25);
  assert.equal(configured.cacheTtlSeconds, 120);
  assert.equal(configured.benchmarkMode, true);
});

test("performance plans remain bounded for 50, 120, 250, and 500 pages", () => {
  const config = readDocumentIntelligenceV31Config(environment({
    MAX_TOTAL_AI_PAGES: "160",
    MAX_CHUNK_SIZE: "24",
    MIN_CHUNK_SIZE: "4",
    CHUNK_OVERLAP_PAGES: "2",
    TARGET_CHUNK_TOKENS: "12000",
  }));
  for (const pageCount of [50, 120, 250, 500]) {
    const startedAt = performance.now();
    const plans = planPrioritizedAdaptiveChunks(
      benchmarkInspection(pageCount),
      config,
    );
    const runtime = performance.now() - startedAt;
    const selected = new Set(plans.flatMap((plan) => plan.pageNumbers));
    assert.ok(selected.size <= Math.min(pageCount, config.maxTotalAiPages));
    assert.ok(
      plans.every((plan) =>
        plan.pageNumbers.length >= config.minChunkSize ||
        plan.endPage === pageCount
      ),
    );
    assert.ok(runtime < 500, `${pageCount}-page planning took ${runtime}ms`);
  }
});

test("technical and lot sections run before administrative boilerplate", () => {
  const config = readDocumentIntelligenceV31Config(environment({
    MAX_TOTAL_AI_PAGES: "40",
    MAX_CHUNK_SIZE: "10",
    MIN_CHUNK_SIZE: "4",
  }));
  const plans = planPrioritizedAdaptiveChunks({
    rankedRanges: [
      {
        startPage: 1,
        endPage: 10,
        score: 70,
        reasons: ["administrative general conditions and legal terms"],
      },
      {
        startPage: 80,
        endPage: 90,
        score: 70,
        reasons: ["lot table product quantities technical requirements"],
      },
    ],
    pageSignals: [
      {
        pageNumber: 1,
        keywordScore: 10,
        matchedKeywords: ["administrative"],
        sectionTitle: "General conditions",
        excerpt: "Legal and administrative provisions",
        textLength: 4_000,
      },
      {
        pageNumber: 80,
        keywordScore: 60,
        matchedKeywords: ["technical", "quantity", "lot"],
        sectionTitle: "Technical product list",
        excerpt: "Lot 1 product quantity requirements",
        textLength: 24_000,
      },
    ],
  }, config);
  assert.equal(plans[0].startPage, 80);
  assert.ok(plans[0].priorityScore > plans.at(-1)!.priorityScore);
});

test("adaptive chunking uses smaller chunks for dense technical pages", () => {
  const config = readDocumentIntelligenceV31Config(environment({
    MAX_TOTAL_AI_PAGES: "80",
    MAX_CHUNK_SIZE: "24",
    MIN_CHUNK_SIZE: "4",
    TARGET_CHUNK_TOKENS: "12000",
    CHUNK_OVERLAP_PAGES: "0",
  }));
  const plan = (textLength: number) =>
    planPrioritizedAdaptiveChunks({
      rankedRanges: [{
        startPage: 1,
        endPage: 40,
        score: 80,
        reasons: ["technical specification"],
      }],
      pageSignals: [{
        pageNumber: 1,
        keywordScore: 60,
        matchedKeywords: ["technical"],
        sectionTitle: "Technical requirements",
        excerpt: "Product specification",
        textLength,
      }],
    }, config)[0].pageNumbers.length;
  assert.ok(plan(40_000) < plan(4_000));
});

test("request, token, and per-document cost guardrails stop safely", () => {
  const config = {
    maxAiRequests: 2,
    maxTotalTokens: 1_000,
    maxAiCostPerDocument: 0.2,
  };
  const budget = createExecutionBudgetState();
  assert.equal(reserveAiRequest(budget, "doc-a", config), null);
  recordExecutionUsage(budget, "doc-a", {
    input_tokens: 600,
    output_tokens: 100,
    estimated_cost_usd: 0.12,
  });
  assert.equal(reserveAiRequest(budget, "doc-a", config), null);
  recordExecutionUsage(budget, "doc-a", {
    input_tokens: 200,
    output_tokens: 100,
    estimated_cost_usd: 0.09,
  });
  assert.equal(
    executionGuardrailReason(budget, "doc-a", config),
    "MAX_AI_REQUESTS",
  );
});

test("early completion requires stable complete facts", () => {
  const analysis = completeAnalysis();
  const config = {
    earlyCompletionThreshold: 88,
    earlyCompletionStableWaves: 1,
  };
  const first = evaluateEarlyCompletion(analysis, {
    previousFactFingerprint: null,
    stableWaves: 0,
  }, config);
  assert.equal(first.complete, false);
  const second = evaluateEarlyCompletion(analysis, first.state, config);
  assert.equal(second.complete, true);
  assert.equal(second.reason, "EARLY_COMPLETION");
});

test("cached evidence is rebound to the current document identity", () => {
  const rebound = rebindAnalysisDocumentId(completeAnalysis(9), 42);
  assert.deepEqual(
    rebound.products.flatMap((product) =>
      product.evidence.map((evidence) => evidence.document_id)
    ),
    [42],
  );
});

test("progress estimates are monotonic and complete has no remaining time", () => {
  const stages = [
    "downloading_attachments",
    "inspecting_document",
    "finding_technical_sections",
    "reading_specifications",
    "extracting_products",
    "matching_supplier",
    "calculating_score",
    "generating_summary",
    "complete",
  ] as const;
  const progress = stages.map((stage) => progressEstimate(stage, 10_000));
  assert.deepEqual(
    progress.map((item) => item.percent),
    [...progress.map((item) => item.percent)].sort((a, b) => a - b),
  );
  assert.equal(progress.at(-1)!.percent, 100);
  assert.equal(progress.at(-1)!.estimatedRemainingSeconds, 0);
});

test("synthetic benchmarks quantify parallel, cache, cost, and early gains", () => {
  for (const pageCount of [50, 120, 250, 500]) {
    const result = syntheticBenchmark(
      pageCount,
      Math.min(pageCount, 160),
      Math.ceil(Math.min(pageCount, 160) / 8),
      4,
      0.5,
      0.6,
    );
    assert.ok(result.parallel_speedup >= 2);
    assert.ok(
      result.ai_requests_with_cache < result.ai_requests_without_cache,
    );
    assert.ok(
      result.estimated_cost_with_cache_usd <
        result.estimated_cost_without_cache_usd,
    );
    assert.equal(result.ignored_pages, Math.max(0, pageCount - 160));
  }
});

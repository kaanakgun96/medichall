import type { NormalizedDocumentAnalysis } from "./document-extraction-v2.ts";
import {
  type DocumentIntelligenceConfig,
  type PdfChunkPlan,
  type PdfInspection,
  type RankedPageRange,
  readDocumentIntelligenceConfig,
} from "./document-intelligence-v3.ts";

export const DOCUMENT_CHUNKING_VERSION_V31 = "document-chunking-v3.1.0";
export const DOCUMENT_EXTRACTION_VERSION_V31 = "tender-extraction-v3.1.0";
export const DOCUMENT_PROMPT_SCHEMA_VERSION_V31 = "medichall-tender-facts-v3";
export const DOCUMENT_CACHE_VERSION_V31 = "document-cache-v3.1.0";

export const PROGRESS_STAGES = [
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

export type DocumentProgressStage = (typeof PROGRESS_STAGES)[number];

export type DocumentIntelligenceV31Config = DocumentIntelligenceConfig & {
  invocationTimeBudgetMs: number;
  maxAiCostPerDocument: number;
  maxAiRequests: number;
  maxTotalTokens: number;
  earlyCompletionThreshold: number;
  earlyCompletionStableWaves: number;
  cacheTtlSeconds: number;
  chunkPriorityEnabled: boolean;
  adaptiveChunkingEnabled: boolean;
  minChunkSize: number;
  targetChunkTokens: number;
  benchmarkMode: boolean;
};

export type PrioritizedChunkPlan = PdfChunkPlan & {
  processingOrder: number;
  densityScore: number;
  estimatedInputTokens: number;
};

export type ExecutionBudgetState = {
  aiRequests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  costByDocument: Record<string, number>;
};

export type ExecutionUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
};

export type QualityMetrics = {
  productsExtracted: number;
  requirementsExtracted: number;
  evidenceCount: number;
  confidenceScore: number;
  conflictsDetected: number;
  factFingerprint: string;
};

export type EarlyCompletionState = {
  previousFactFingerprint: string | null;
  stableWaves: number;
};

export type EarlyCompletionDecision = {
  complete: boolean;
  reason: "EARLY_COMPLETION" | null;
  state: EarlyCompletionState;
  metrics: QualityMetrics;
};

export type SyntheticBenchmarkResult = {
  page_count: number;
  selected_pages: number;
  ignored_pages: number;
  chunks_planned: number;
  sequential_duration_ms: number;
  parallel_duration_ms: number;
  parallel_speedup: number;
  ai_requests_without_cache: number;
  ai_requests_with_cache: number;
  estimated_cost_without_cache_usd: number;
  estimated_cost_with_cache_usd: number;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value == null || !value.trim()) return fallback;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  return fallback;
}

export function readDocumentIntelligenceV31Config(
  getEnvironment: (name: string) => string | undefined = (name) =>
    Deno.env.get(name),
): DocumentIntelligenceV31Config {
  const base = readDocumentIntelligenceConfig(getEnvironment);
  const minChunkSize = boundedInteger(
    getEnvironment("MIN_CHUNK_SIZE"),
    8,
    2,
    Math.max(2, base.maxChunkSize),
  );
  return {
    ...base,
    // Measured on production 2026-07-24: the edge worker is killed at
    // ~150s wall clock (function_logs shutdown reason "WallClockTime",
    // cpu_time_used 521ms, memory 38MB), so wall clock — not CPU or
    // memory — is the binding limit. Every invocation must finish its
    // own work and hand off within this budget.
    invocationTimeBudgetMs: boundedInteger(
      getEnvironment("INVOCATION_TIME_BUDGET_MS"),
      110_000,
      30_000,
      140_000,
    ),
    // Conservative default of 2 until the resource ceiling under
    // parallel provider calls is measured; raise via env once verified.
    maxParallelChunks: boundedInteger(
      getEnvironment("MAX_PARALLEL_CHUNKS"),
      2,
      1,
      8,
    ),
    maxAiCostPerDocument: boundedNumber(
      getEnvironment("MAX_AI_COST_PER_DOCUMENT"),
      5,
      0.05,
      100,
    ),
    maxAiRequests: boundedInteger(
      getEnvironment("MAX_AI_REQUESTS"),
      20,
      1,
      100,
    ),
    maxTotalTokens: boundedInteger(
      getEnvironment("MAX_TOTAL_TOKENS"),
      250_000,
      1_000,
      5_000_000,
    ),
    earlyCompletionThreshold: boundedInteger(
      getEnvironment("EARLY_COMPLETION_THRESHOLD"),
      88,
      50,
      100,
    ),
    earlyCompletionStableWaves: boundedInteger(
      getEnvironment("EARLY_COMPLETION_STABLE_WAVES"),
      1,
      0,
      5,
    ),
    cacheTtlSeconds: boundedInteger(
      getEnvironment("CACHE_TTL"),
      30 * 24 * 60 * 60,
      60,
      365 * 24 * 60 * 60,
    ),
    chunkPriorityEnabled: booleanValue(
      getEnvironment("CHUNK_PRIORITY_ENABLED"),
      true,
    ),
    adaptiveChunkingEnabled: booleanValue(
      getEnvironment("ADAPTIVE_CHUNKING_ENABLED"),
      true,
    ),
    minChunkSize: Math.min(minChunkSize, base.maxChunkSize),
    targetChunkTokens: boundedInteger(
      getEnvironment("TARGET_CHUNK_TOKENS"),
      12_000,
      1_000,
      100_000,
    ),
    benchmarkMode: booleanValue(getEnvironment("BENCHMARK_MODE"), false),
  };
}

export function publicV31ConfigSnapshot(
  config: DocumentIntelligenceV31Config,
): Record<string, unknown> {
  return {
    invocation_time_budget_ms: config.invocationTimeBudgetMs,
    max_parallel_chunks: config.maxParallelChunks,
    max_ai_cost_per_document: config.maxAiCostPerDocument,
    max_ai_requests: config.maxAiRequests,
    max_total_tokens: config.maxTotalTokens,
    early_completion_threshold: config.earlyCompletionThreshold,
    early_completion_stable_waves: config.earlyCompletionStableWaves,
    cache_ttl_seconds: config.cacheTtlSeconds,
    chunk_priority_enabled: config.chunkPriorityEnabled,
    adaptive_chunking_enabled: config.adaptiveChunkingEnabled,
    min_chunk_size: config.minChunkSize,
    max_chunk_size: config.maxChunkSize,
    target_chunk_tokens: config.targetChunkTokens,
    benchmark_mode: config.benchmarkMode,
  };
}

const HIGH_VALUE_PATTERN =
  /(technical|specification|requirement|product|item|lot|annex|appendix|quantity|steril|surgical|cpv|iso|mdr|ce|teknik|şartname|anforderung|spezifikation|cahier|exigence|specifica|requisit|allegat|załącznik|cerinț|požadav)/i;
const LOT_TABLE_PATTERN =
  /(lot|item|product|quantity|boq|bill of quantities|price schedule|kalem|miktar|menge|quantité|cantidad|quantità|ilość|cantitate|množství)/i;
const LOW_VALUE_PATTERN =
  /(legal|general conditions|administrative|eligibility|declaration|form|contract terms|penalt|insurance|jurisdiction|privacy|terms and conditions)/i;

function rangeSignals(
  range: RankedPageRange,
  inspection: Pick<PdfInspection, "pageSignals">,
) {
  return inspection.pageSignals.filter((signal) =>
    signal.pageNumber >= range.startPage &&
    signal.pageNumber <= range.endPage
  );
}

function rangePriority(
  range: RankedPageRange,
  inspection: Pick<PdfInspection, "pageSignals">,
  enabled: boolean,
): { score: number; densityScore: number; estimatedTokensPerPage: number } {
  const signals = rangeSignals(range, inspection);
  const text = [
    ...range.reasons,
    ...signals.flatMap((signal) => [
      signal.sectionTitle || "",
      signal.excerpt,
      ...signal.matchedKeywords,
    ]),
  ].join(" ");
  const averageCharacters = signals.length
    ? signals.reduce(
      (total, signal) =>
        total +
        Number(signal.textLength || signal.excerpt.length),
      0,
    ) / signals.length
    : 1_600;
  const estimatedTokensPerPage = Math.max(
    100,
    Math.round(averageCharacters / 4),
  );
  const densityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        estimatedTokensPerPage / 20 +
          (signals.length
            ? signals.reduce(
              (total, signal) => total + signal.keywordScore,
              0,
            ) / signals.length
            : range.score / 2),
      ),
    ),
  );
  if (!enabled) {
    return {
      score: range.score,
      densityScore,
      estimatedTokensPerPage,
    };
  }
  let score = range.score;
  if (HIGH_VALUE_PATTERN.test(text)) score += 30;
  if (LOT_TABLE_PATTERN.test(text)) score += 25;
  if (LOW_VALUE_PATTERN.test(text)) score -= 35;
  return {
    score: Math.max(0, Math.min(200, score)),
    densityScore,
    estimatedTokensPerPage,
  };
}

function adaptiveSize(
  priority: ReturnType<typeof rangePriority>,
  config: Pick<
    DocumentIntelligenceV31Config,
    | "adaptiveChunkingEnabled"
    | "minChunkSize"
    | "maxChunkSize"
    | "targetChunkTokens"
  >,
): number {
  if (!config.adaptiveChunkingEnabled) return config.maxChunkSize;
  const tokenSized = Math.floor(
    config.targetChunkTokens / priority.estimatedTokensPerPage,
  );
  const densityAdjusted = priority.densityScore >= 70
    ? Math.floor(tokenSized * 0.6)
    : priority.densityScore >= 45
    ? Math.floor(tokenSized * 0.8)
    : tokenSized;
  return Math.max(
    config.minChunkSize,
    Math.min(config.maxChunkSize, densityAdjusted),
  );
}

export function planPrioritizedAdaptiveChunks(
  inspection: Pick<PdfInspection, "rankedRanges" | "pageSignals">,
  config: Pick<
    DocumentIntelligenceV31Config,
    | "maxTotalAiPages"
    | "maxChunkSize"
    | "minChunkSize"
    | "chunkOverlapPages"
    | "targetChunkTokens"
    | "chunkPriorityEnabled"
    | "adaptiveChunkingEnabled"
  >,
): PrioritizedChunkPlan[] {
  const prioritizedRanges = inspection.rankedRanges.map((range) => ({
    range,
    priority: rangePriority(range, inspection, config.chunkPriorityEnabled),
  })).sort((left, right) =>
    right.priority.score - left.priority.score ||
    left.range.startPage - right.range.startPage
  );
  const plans: Array<Omit<PrioritizedChunkPlan, "chunkIndex">> = [];
  const seenPages = new Set<number>();
  let selectedPages = 0;
  for (const entry of prioritizedRanges) {
    if (selectedPages >= config.maxTotalAiPages) break;
    const size = adaptiveSize(entry.priority, config);
    const overlap = Math.min(config.chunkOverlapPages, Math.max(0, size - 1));
    const step = Math.max(1, size - overlap);
    for (
      let start = entry.range.startPage;
      start <= entry.range.endPage &&
      selectedPages < config.maxTotalAiPages;
      start += step
    ) {
      const candidatePages = Array.from(
        {
          length: Math.min(
            size,
            entry.range.endPage - start + 1,
          ),
        },
        (_, index) => start + index,
      );
      const newPageCount = candidatePages.filter((page) =>
        !seenPages.has(page)
      ).length;
      if (!newPageCount) break;
      const remaining = config.maxTotalAiPages - selectedPages;
      let accepted = candidatePages;
      if (newPageCount > remaining) {
        const acceptedNewPages = new Set(
          candidatePages.filter((page) => !seenPages.has(page)).slice(
            0,
            remaining,
          ),
        );
        accepted = candidatePages.filter((page) =>
          seenPages.has(page) || acceptedNewPages.has(page)
        );
      }
      if (!accepted.length) break;
      accepted.forEach((page) => seenPages.add(page));
      // Recalculate using the global set because overlapping context must not
      // consume the unique-page budget twice.
      selectedPages = seenPages.size;
      plans.push({
        startPage: accepted[0],
        endPage: accepted.at(-1)!,
        pageNumbers: accepted,
        priorityScore: entry.priority.score,
        reasons: [
          ...new Set([
            ...entry.range.reasons,
            entry.priority.score >= 80
              ? "priority:high_value_technical_content"
              : "priority:standard",
            config.adaptiveChunkingEnabled
              ? `adaptive_chunk_size:${accepted.length}`
              : "static_chunk_size",
          ]),
        ],
        processingOrder: 0,
        densityScore: entry.priority.densityScore,
        estimatedInputTokens: Math.max(
          1,
          Math.round(
            accepted.length * entry.priority.estimatedTokensPerPage,
          ),
        ),
      });
      if (accepted.at(-1)! >= entry.range.endPage) break;
    }
  }
  const pageOrdered = [...plans].sort((left, right) =>
    left.startPage - right.startPage ||
    left.endPage - right.endPage
  );
  const pageIndex = new Map(
    pageOrdered.map((plan, index) => [
      `${plan.startPage}:${plan.endPage}`,
      index,
    ]),
  );
  return plans
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      right.densityScore - left.densityScore ||
      left.startPage - right.startPage
    )
    .map((plan, processingOrder) => ({
      ...plan,
      chunkIndex: pageIndex.get(`${plan.startPage}:${plan.endPage}`) ?? 0,
      processingOrder,
    }));
}

export function createExecutionBudgetState(): ExecutionBudgetState {
  return {
    aiRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    costByDocument: {},
  };
}

export function executionGuardrailReason(
  state: ExecutionBudgetState,
  documentKey: string,
  config: Pick<
    DocumentIntelligenceV31Config,
    "maxAiRequests" | "maxTotalTokens" | "maxAiCostPerDocument"
  >,
): "MAX_AI_REQUESTS" | "MAX_TOTAL_TOKENS" | "MAX_AI_COST_PER_DOCUMENT" | null {
  if (state.aiRequests >= config.maxAiRequests) return "MAX_AI_REQUESTS";
  if (state.inputTokens + state.outputTokens >= config.maxTotalTokens) {
    return "MAX_TOTAL_TOKENS";
  }
  if (
    Number(state.costByDocument[documentKey] || 0) >=
      config.maxAiCostPerDocument
  ) {
    return "MAX_AI_COST_PER_DOCUMENT";
  }
  return null;
}

export function reserveAiRequest(
  state: ExecutionBudgetState,
  documentKey: string,
  config: Pick<
    DocumentIntelligenceV31Config,
    "maxAiRequests" | "maxTotalTokens" | "maxAiCostPerDocument"
  >,
): "MAX_AI_REQUESTS" | "MAX_TOTAL_TOKENS" | "MAX_AI_COST_PER_DOCUMENT" | null {
  const reason = executionGuardrailReason(state, documentKey, config);
  if (!reason) state.aiRequests++;
  return reason;
}

export function recordExecutionUsage(
  state: ExecutionBudgetState,
  documentKey: string,
  usage: ExecutionUsage,
): void {
  const input = Math.max(
    0,
    Number(usage.input_tokens || 0) +
      Number(usage.cache_creation_input_tokens || 0) +
      Number(usage.cache_read_input_tokens || 0),
  );
  const output = Math.max(0, Number(usage.output_tokens || 0));
  const cost = Math.max(0, Number(usage.estimated_cost_usd || 0));
  state.inputTokens += input;
  state.outputTokens += output;
  state.estimatedCostUsd = Number(
    (state.estimatedCostUsd + cost).toFixed(6),
  );
  state.costByDocument[documentKey] = Number(
    (Number(state.costByDocument[documentKey] || 0) + cost).toFixed(6),
  );
}

function normalizedFacts(value: NormalizedDocumentAnalysis): string[] {
  return [
    ...value.tender.cpv_codes.map((item) => `cpv:${item}`),
    ...value.products.flatMap((product) => [
      `product:${
        (
          product.normalized_product_name || product.product_name
        ).toLocaleLowerCase()
      }`,
      ...product.technical_requirements.map((item) =>
        `requirement:${item.toLocaleLowerCase()}`
      ),
      ...product.requirements.map((item) =>
        `requirement:${item.name.toLocaleLowerCase()}:${
          item.normalized_value || item.value || ""
        }`
      ),
      ...product.evidence.map((item) =>
        `evidence:${item.document_id}:${
          item.page_number || ""
        }:${item.field_name}:${item.normalized_value || item.extracted_value}`
      ),
    ]),
  ].sort();
}

function hashFacts(values: readonly string[]): string {
  // FNV-1a is sufficient for a deterministic in-memory stability signal. It
  // is not used as a security or persisted content-addressing hash.
  let hash = 0x811c9dc5;
  for (const character of values.join("|")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function extractionQualityMetrics(
  analysis: NormalizedDocumentAnalysis & {
    ambiguities?: unknown[];
  },
): QualityMetrics {
  const requirements = analysis.products.reduce(
    (total, product) =>
      total +
      product.requirements.length +
      product.technical_requirements.length,
    0,
  );
  return {
    productsExtracted: analysis.products.length,
    requirementsExtracted: requirements,
    evidenceCount: analysis.evidence_count,
    confidenceScore: analysis.document_confidence_score,
    conflictsDetected: Array.isArray(analysis.ambiguities)
      ? analysis.ambiguities.length
      : 0,
    factFingerprint: hashFacts(normalizedFacts(analysis)),
  };
}

export function evaluateEarlyCompletion(
  analysis: NormalizedDocumentAnalysis & {
    ambiguities?: unknown[];
  },
  previous: EarlyCompletionState,
  config: Pick<
    DocumentIntelligenceV31Config,
    "earlyCompletionThreshold" | "earlyCompletionStableWaves"
  >,
): EarlyCompletionDecision {
  const metrics = extractionQualityMetrics(analysis);
  const stableWaves = previous.previousFactFingerprint ===
      metrics.factFingerprint
    ? previous.stableWaves + 1
    : 0;
  const state = {
    previousFactFingerprint: metrics.factFingerprint,
    stableWaves,
  };
  const requirementsComplete = metrics.requirementsExtracted > 0;
  const evidenceComplete = metrics.evidenceCount >=
    Math.max(1, metrics.productsExtracted);
  const identityComplete = analysis.tender.cpv_codes.length > 0;
  const confidenceComplete =
    metrics.confidenceScore >= config.earlyCompletionThreshold;
  const stable = stableWaves >= config.earlyCompletionStableWaves;
  const complete = metrics.productsExtracted > 0 &&
    requirementsComplete &&
    evidenceComplete &&
    identityComplete &&
    confidenceComplete &&
    metrics.conflictsDetected === 0 &&
    stable;
  return {
    complete,
    reason: complete ? "EARLY_COMPLETION" : null,
    state,
    metrics,
  };
}

export function rebindAnalysisDocumentId(
  analysis: NormalizedDocumentAnalysis,
  documentId: number,
): NormalizedDocumentAnalysis {
  return {
    ...structuredClone(analysis),
    products: analysis.products.map((product) => ({
      ...structuredClone(product),
      evidence: product.evidence.map((evidence) => ({
        ...evidence,
        document_id: documentId,
      })),
    })),
  };
}

export function progressEstimate(
  stage: DocumentProgressStage,
  elapsedMs: number,
): { percent: number; estimatedRemainingSeconds: number | null } {
  const percentByStage: Record<DocumentProgressStage, number> = {
    downloading_attachments: 5,
    inspecting_document: 15,
    finding_technical_sections: 28,
    reading_specifications: 45,
    extracting_products: 65,
    matching_supplier: 82,
    calculating_score: 90,
    generating_summary: 96,
    complete: 100,
  };
  const percent = percentByStage[stage];
  return {
    percent,
    estimatedRemainingSeconds: percent > 5 && percent < 100
      ? Math.max(
        1,
        Math.round((elapsedMs / percent) * (100 - percent) / 1_000),
      )
      : percent === 100
      ? 0
      : null,
  };
}

export function syntheticBenchmark(
  pageCount: number,
  selectedPages: number,
  chunks: number,
  concurrency: number,
  cacheHitRatio = 0,
  earlyCompletionRatio = 1,
  millisecondsPerChunk = 1_000,
  estimatedCostPerChunk = 0.08,
): SyntheticBenchmarkResult {
  const requiredChunks = Math.max(
    0,
    Math.ceil(chunks * Math.max(0, Math.min(1, earlyCompletionRatio))),
  );
  const cacheHits = Math.min(
    requiredChunks,
    Math.round(requiredChunks * Math.max(0, Math.min(1, cacheHitRatio))),
  );
  const aiRequests = requiredChunks - cacheHits;
  const sequentialDuration = requiredChunks * millisecondsPerChunk;
  const parallelDuration = Math.ceil(
    requiredChunks / Math.max(1, concurrency),
  ) * millisecondsPerChunk;
  return {
    page_count: pageCount,
    selected_pages: selectedPages,
    ignored_pages: Math.max(0, pageCount - selectedPages),
    chunks_planned: chunks,
    sequential_duration_ms: sequentialDuration,
    parallel_duration_ms: parallelDuration,
    parallel_speedup: parallelDuration
      ? Number((sequentialDuration / parallelDuration).toFixed(2))
      : 1,
    ai_requests_without_cache: requiredChunks,
    ai_requests_with_cache: aiRequests,
    estimated_cost_without_cache_usd: Number(
      (requiredChunks * estimatedCostPerChunk).toFixed(6),
    ),
    estimated_cost_with_cache_usd: Number(
      (aiRequests * estimatedCostPerChunk).toFixed(6),
    ),
  };
}

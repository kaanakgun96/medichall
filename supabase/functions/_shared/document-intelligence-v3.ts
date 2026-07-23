import type {
  ExtractionEvidence,
  NormalizedDocumentAnalysis,
  NormalizedProduct,
} from "./document-extraction-v2.ts";

export const DOCUMENT_INSPECTION_VERSION = "document-inspection-v3.0.0";
export const DOCUMENT_CHUNKING_VERSION = "document-chunking-v3.0.0";
export const DOCUMENT_EXTRACTION_VERSION_V3 = "tender-extraction-v3.0.0";
export const DOCUMENT_PROMPT_SCHEMA_VERSION_V3 = "medichall-tender-facts-v3";

export type DocumentIntelligenceConfig = {
  maxDocuments: number;
  maxDocumentBytes: number;
  maxPdfPages: number;
  maxTotalAiPages: number;
  maxChunkSize: number;
  chunkOverlapPages: number;
  maxParallelChunks: number;
  maxChunksPerRun: number;
  maxChunkAttempts: number;
  keywordScanLimit: number;
  inspectionTimeoutMs: number;
  downloadTimeoutMs: number;
  providerTimeoutMs: number;
  maxTextCharacters: number;
  maxChunkOutputTokens: number;
  maxAiChunkBytes: number;
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  extraKeywords: string[];
};

export type ProcurementKeyword = {
  term: string;
  language: string;
  weight: number;
};

export type PdfOutlineEntry = {
  title: string;
  depth: number;
  pageNumber: number | null;
};

export type PdfPageSignal = {
  pageNumber: number;
  keywordScore: number;
  matchedKeywords: string[];
  sectionTitle: string | null;
  excerpt: string;
  textLength?: number;
};

export type RankedPageRange = {
  startPage: number;
  endPage: number;
  score: number;
  reasons: string[];
};

export type PdfInspection = {
  pageCount: number;
  scannedPageCount: number;
  scanLimit: number;
  inspectionPartial: boolean;
  metadata: Record<string, string | number | boolean | null>;
  outline: PdfOutlineEntry[];
  tableOfContentsPages: number[];
  pageSignals: PdfPageSignal[];
  rankedRanges: RankedPageRange[];
  durationMs: number;
};

export type PdfChunkPlan = {
  chunkIndex: number;
  startPage: number;
  endPage: number;
  pageNumbers: number[];
  priorityScore: number;
  reasons: string[];
  processingOrder?: number;
  densityScore?: number;
  estimatedInputTokens?: number;
};

export type ChunkMergeInput = {
  chunkId: number | string;
  startPage: number;
  endPage: number;
  analysis: NormalizedDocumentAnalysis;
};

export type ExtractionAmbiguity = {
  field: string;
  values: Array<{
    value: string;
    confidenceScore: number;
    chunkIds: string[];
    pages: number[];
  }>;
};

export type MergedDocumentAnalysisV3 = NormalizedDocumentAnalysis & {
  schema_version: typeof DOCUMENT_PROMPT_SCHEMA_VERSION_V3;
  ambiguities: ExtractionAmbiguity[];
  merge_statistics: {
    chunk_count: number;
    product_count: number;
    evidence_count: number;
    ambiguity_count: number;
    duplicate_facts_removed: number;
  };
};

const DEFAULT_LIMITS = {
  maxDocuments: 6,
  maxDocumentBytes: 64 * 1024 * 1024,
  maxPdfPages: 2_000,
  maxTotalAiPages: 120,
  maxChunkSize: 24,
  chunkOverlapPages: 2,
  maxParallelChunks: 2,
  maxChunksPerRun: 12,
  maxChunkAttempts: 3,
  keywordScanLimit: 2_000,
  inspectionTimeoutMs: 60_000,
  downloadTimeoutMs: 30_000,
  providerTimeoutMs: 90_000,
  maxTextCharacters: 200_000,
  maxChunkOutputTokens: 8_000,
  maxAiChunkBytes: 24 * 1024 * 1024,
  inputCostPerMillionTokens: 3,
  outputCostPerMillionTokens: 15,
} as const;

const LIMIT_BOUNDS = {
  maxDocuments: [1, 12],
  maxDocumentBytes: [1 * 1024 * 1024, 256 * 1024 * 1024],
  maxPdfPages: [100, 10_000],
  maxTotalAiPages: [8, 600],
  maxChunkSize: [4, 60],
  chunkOverlapPages: [0, 10],
  maxParallelChunks: [1, 6],
  maxChunksPerRun: [1, 40],
  maxChunkAttempts: [1, 6],
  keywordScanLimit: [100, 10_000],
  inspectionTimeoutMs: [5_000, 180_000],
  downloadTimeoutMs: [5_000, 120_000],
  providerTimeoutMs: [15_000, 180_000],
  maxTextCharacters: [10_000, 1_000_000],
  maxChunkOutputTokens: [1_000, 16_000],
  maxAiChunkBytes: [1 * 1024 * 1024, 30 * 1024 * 1024],
} as const;

export const DEFAULT_PROCUREMENT_KEYWORDS: readonly ProcurementKeyword[] = [
  { term: "technical specification", language: "en", weight: 8 },
  { term: "technical specifications", language: "en", weight: 8 },
  { term: "technical characteristics", language: "en", weight: 7 },
  { term: "requirements", language: "en", weight: 5 },
  { term: "product", language: "en", weight: 3 },
  { term: "item", language: "en", weight: 3 },
  { term: "lot", language: "en", weight: 4 },
  { term: "annex", language: "en", weight: 5 },
  { term: "appendix", language: "en", weight: 5 },
  { term: "quantity", language: "en", weight: 5 },
  { term: "sterile", language: "en", weight: 6 },
  { term: "probe", language: "en", weight: 4 },
  { term: "cover", language: "en", weight: 3 },
  { term: "surgical", language: "en", weight: 5 },
  { term: "teknik şartname", language: "tr", weight: 8 },
  { term: "teknik özellikler", language: "tr", weight: 7 },
  { term: "gereksinimler", language: "tr", weight: 5 },
  { term: "ürün", language: "tr", weight: 3 },
  { term: "kalem", language: "tr", weight: 3 },
  { term: "ek", language: "tr", weight: 4 },
  { term: "miktar", language: "tr", weight: 5 },
  { term: "steril", language: "tr", weight: 6 },
  { term: "cerrahi", language: "tr", weight: 5 },
  { term: "technische spezifikation", language: "de", weight: 8 },
  { term: "leistungsbeschreibung", language: "de", weight: 8 },
  { term: "anforderungen", language: "de", weight: 5 },
  { term: "produkt", language: "de", weight: 3 },
  { term: "position", language: "de", weight: 3 },
  { term: "los", language: "de", weight: 4 },
  { term: "anhang", language: "de", weight: 5 },
  { term: "menge", language: "de", weight: 5 },
  { term: "steril", language: "de", weight: 6 },
  { term: "technische specificaties", language: "nl", weight: 8 },
  { term: "eisen", language: "nl", weight: 5 },
  { term: "product", language: "nl", weight: 3 },
  { term: "perceel", language: "nl", weight: 4 },
  { term: "bijlage", language: "nl", weight: 5 },
  { term: "hoeveelheid", language: "nl", weight: 5 },
  { term: "spécifications techniques", language: "fr", weight: 8 },
  { term: "cahier des charges", language: "fr", weight: 8 },
  { term: "exigences", language: "fr", weight: 5 },
  { term: "produit", language: "fr", weight: 3 },
  { term: "article", language: "fr", weight: 3 },
  { term: "lot", language: "fr", weight: 4 },
  { term: "annexe", language: "fr", weight: 5 },
  { term: "quantité", language: "fr", weight: 5 },
  { term: "stérile", language: "fr", weight: 6 },
  { term: "especificaciones técnicas", language: "es", weight: 8 },
  { term: "requisitos", language: "es", weight: 5 },
  { term: "producto", language: "es", weight: 3 },
  { term: "partida", language: "es", weight: 4 },
  { term: "lote", language: "es", weight: 4 },
  { term: "anexo", language: "es", weight: 5 },
  { term: "cantidad", language: "es", weight: 5 },
  { term: "estéril", language: "es", weight: 6 },
  { term: "specifiche tecniche", language: "it", weight: 8 },
  { term: "capitolato tecnico", language: "it", weight: 8 },
  { term: "requisiti", language: "it", weight: 5 },
  { term: "prodotto", language: "it", weight: 3 },
  { term: "voce", language: "it", weight: 3 },
  { term: "lotto", language: "it", weight: 4 },
  { term: "allegato", language: "it", weight: 5 },
  { term: "quantità", language: "it", weight: 5 },
  { term: "specificações técnicas", language: "pt", weight: 8 },
  { term: "requisitos", language: "pt", weight: 5 },
  { term: "produto", language: "pt", weight: 3 },
  { term: "lote", language: "pt", weight: 4 },
  { term: "anexo", language: "pt", weight: 5 },
  { term: "quantidade", language: "pt", weight: 5 },
  { term: "specyfikacja techniczna", language: "pl", weight: 8 },
  { term: "wymagania", language: "pl", weight: 5 },
  { term: "produkt", language: "pl", weight: 3 },
  { term: "pozycja", language: "pl", weight: 3 },
  { term: "część", language: "pl", weight: 4 },
  { term: "załącznik", language: "pl", weight: 5 },
  { term: "ilość", language: "pl", weight: 5 },
  { term: "specificații tehnice", language: "ro", weight: 8 },
  { term: "cerințe", language: "ro", weight: 5 },
  { term: "produs", language: "ro", weight: 3 },
  { term: "lot", language: "ro", weight: 4 },
  { term: "anexă", language: "ro", weight: 5 },
  { term: "cantitate", language: "ro", weight: 5 },
  { term: "technická specifikace", language: "cs", weight: 8 },
  { term: "požadavky", language: "cs", weight: 5 },
  { term: "výrobek", language: "cs", weight: 3 },
  { term: "položka", language: "cs", weight: 3 },
  { term: "příloha", language: "cs", weight: 5 },
  { term: "množství", language: "cs", weight: 5 },
] as const;

const TABLE_OF_CONTENTS_TERMS = [
  "table of contents",
  "contents",
  "içindekiler",
  "inhalt",
  "inhaltsverzeichnis",
  "sommaire",
  "table des matières",
  "índice",
  "indice",
  "spis treści",
  "cuprins",
  "obsah",
];

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function boundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum = 0,
  maximum = 10_000,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function parseExtraKeywords(value: string | undefined): string[] {
  if (!value) return [];
  let entries: unknown = value.split(",");
  try {
    entries = JSON.parse(value);
  } catch {
    // Comma-separated values remain supported for operator convenience.
  }
  if (!Array.isArray(entries)) return [];
  return [
    ...new Set(
      entries.map((entry) => String(entry).trim()).filter(
        (entry) => entry.length >= 2 && entry.length <= 120,
      ),
    ),
  ].slice(0, 200);
}

export function readDocumentIntelligenceConfig(
  getEnvironment: (name: string) => string | undefined = (name) =>
    Deno.env.get(name),
): DocumentIntelligenceConfig {
  const readLimit = (
    name: string,
    key: keyof typeof LIMIT_BOUNDS,
  ): number => {
    const [minimum, maximum] = LIMIT_BOUNDS[key];
    return boundedInteger(
      getEnvironment(name),
      DEFAULT_LIMITS[key],
      minimum,
      maximum,
    );
  };
  const maxChunkSize = readLimit("MAX_CHUNK_SIZE", "maxChunkSize");
  const configuredOverlap = readLimit(
    "CHUNK_OVERLAP_PAGES",
    "chunkOverlapPages",
  );
  return {
    maxDocuments: readLimit("MAX_DOCUMENTS", "maxDocuments"),
    maxDocumentBytes: readLimit(
      "MAX_DOCUMENT_BYTES",
      "maxDocumentBytes",
    ),
    // This is an inspection scan ceiling, never a page-count rejection rule.
    maxPdfPages: readLimit("MAX_PDF_PAGES", "maxPdfPages"),
    maxTotalAiPages: readLimit(
      "MAX_TOTAL_AI_PAGES",
      "maxTotalAiPages",
    ),
    maxChunkSize,
    chunkOverlapPages: Math.min(
      configuredOverlap,
      Math.max(0, maxChunkSize - 1),
    ),
    maxParallelChunks: readLimit(
      "MAX_PARALLEL_CHUNKS",
      "maxParallelChunks",
    ),
    maxChunksPerRun: readLimit(
      "MAX_CHUNKS_PER_RUN",
      "maxChunksPerRun",
    ),
    maxChunkAttempts: readLimit(
      "MAX_CHUNK_ATTEMPTS",
      "maxChunkAttempts",
    ),
    keywordScanLimit: readLimit(
      "KEYWORD_SCAN_LIMIT",
      "keywordScanLimit",
    ),
    inspectionTimeoutMs: readLimit(
      "INSPECTION_TIMEOUT",
      "inspectionTimeoutMs",
    ),
    downloadTimeoutMs: readLimit(
      "DOWNLOAD_TIMEOUT",
      "downloadTimeoutMs",
    ),
    providerTimeoutMs: readLimit(
      "PROVIDER_TIMEOUT",
      "providerTimeoutMs",
    ),
    maxTextCharacters: readLimit(
      "MAX_TEXT_CHARACTERS",
      "maxTextCharacters",
    ),
    maxChunkOutputTokens: readLimit(
      "MAX_CHUNK_OUTPUT_TOKENS",
      "maxChunkOutputTokens",
    ),
    maxAiChunkBytes: readLimit(
      "MAX_AI_CHUNK_BYTES",
      "maxAiChunkBytes",
    ),
    inputCostPerMillionTokens: boundedNumber(
      getEnvironment("AI_INPUT_COST_PER_MILLION_TOKENS"),
      DEFAULT_LIMITS.inputCostPerMillionTokens,
    ),
    outputCostPerMillionTokens: boundedNumber(
      getEnvironment("AI_OUTPUT_COST_PER_MILLION_TOKENS"),
      DEFAULT_LIMITS.outputCostPerMillionTokens,
    ),
    extraKeywords: parseExtraKeywords(
      getEnvironment("DOCUMENT_DISCOVERY_KEYWORDS"),
    ),
  };
}

export function publicConfigSnapshot(
  config: DocumentIntelligenceConfig,
): Record<string, unknown> {
  return {
    max_documents: config.maxDocuments,
    max_document_bytes: config.maxDocumentBytes,
    max_pdf_pages_scanned_per_pass: config.maxPdfPages,
    max_total_ai_pages: config.maxTotalAiPages,
    max_chunk_size: config.maxChunkSize,
    chunk_overlap_pages: config.chunkOverlapPages,
    max_parallel_chunks: config.maxParallelChunks,
    max_chunks_per_run: config.maxChunksPerRun,
    max_chunk_attempts: config.maxChunkAttempts,
    keyword_scan_limit: config.keywordScanLimit,
    inspection_timeout_ms: config.inspectionTimeoutMs,
    download_timeout_ms: config.downloadTimeoutMs,
    provider_timeout_ms: config.providerTimeoutMs,
    max_text_characters: config.maxTextCharacters,
    max_chunk_output_tokens: config.maxChunkOutputTokens,
    max_ai_chunk_bytes: config.maxAiChunkBytes,
    extra_keyword_count: config.extraKeywords.length,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (count < 10) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count++;
    offset = index + Math.max(1, needle.length);
  }
  return count;
}

export function procurementKeywords(
  extraKeywords: readonly string[] = [],
): ProcurementKeyword[] {
  const output = new Map<string, ProcurementKeyword>();
  for (const keyword of DEFAULT_PROCUREMENT_KEYWORDS) {
    const key = normalizeSearchText(keyword.term);
    const existing = output.get(key);
    if (!existing || existing.weight < keyword.weight) {
      output.set(key, keyword);
    }
  }
  for (const term of extraKeywords) {
    const key = normalizeSearchText(term);
    if (!key) continue;
    output.set(key, { term, language: "configured", weight: 6 });
  }
  return [...output.values()].sort((left, right) =>
    right.weight - left.weight ||
    left.term.localeCompare(right.term)
  );
}

export function scoreProcurementPage(
  text: string,
  keywords: readonly ProcurementKeyword[],
): { score: number; matchedKeywords: string[] } {
  const normalized = normalizeSearchText(text);
  const matches: Array<{ term: string; score: number }> = [];
  for (const keyword of keywords) {
    const term = normalizeSearchText(keyword.term);
    const occurrences = countOccurrences(normalized, term);
    if (occurrences) {
      matches.push({
        term: keyword.term,
        score: keyword.weight * Math.min(3, occurrences),
      });
    }
  }
  const standardMatches = normalized.match(
    /\b(?:cpv|iso|mdr|ce)\b|\ben\s*\d{2,5}(?:[-:]\d+)?\b/g,
  ) || [];
  if (standardMatches.length) {
    matches.push({
      term: "CPV/EN/ISO/MDR/CE",
      score: Math.min(18, standardMatches.length * 3),
    });
  }
  return {
    score: Math.min(
      100,
      matches.reduce((total, match) => total + match.score, 0),
    ),
    matchedKeywords: [...new Set(matches.map((match) => match.term))].slice(
      0,
      30,
    ),
  };
}

export function isTableOfContentsText(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return TABLE_OF_CONTENTS_TERMS.some((term) =>
    normalized.includes(normalizeSearchText(term))
  );
}

export function buildPageScanOrder(
  pageCount: number,
  requestedLimit: number,
): number[] {
  const total = Math.max(0, Math.trunc(pageCount));
  const limit = Math.min(total, Math.max(0, Math.trunc(requestedLimit)));
  if (!limit) return [];
  if (limit >= total) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const selected: number[] = [];
  const seen = new Set<number>();
  const add = (page: number) => {
    const bounded = Math.max(1, Math.min(total, Math.round(page)));
    if (!seen.has(bounded) && selected.length < limit) {
      seen.add(bounded);
      selected.push(bounded);
    }
  };
  [1, total, 2, total - 1, 3, total - 2].forEach(add);

  // Van der Corput ordering keeps early timeout results spread through even
  // very large documents instead of inspecting only the first pages.
  for (let index = 1; selected.length < limit; index++) {
    let value = index;
    let denominator = 1;
    let fraction = 0;
    while (value > 0) {
      denominator *= 2;
      fraction += (value % 2) / denominator;
      value = Math.floor(value / 2);
    }
    add(1 + fraction * (total - 1));
  }
  return selected;
}

function addPageScore(
  scores: Map<number, { score: number; reasons: Set<string> }>,
  page: number,
  pageCount: number,
  score: number,
  reason: string,
) {
  if (page < 1 || page > pageCount) return;
  const existing = scores.get(page) || { score: 0, reasons: new Set<string>() };
  existing.score = Math.max(existing.score, score);
  existing.reasons.add(reason);
  scores.set(page, existing);
}

export function rankRelevantPageRanges(
  input: Pick<
    PdfInspection,
    "pageCount" | "outline" | "tableOfContentsPages" | "pageSignals"
  >,
  contextRadius = 2,
): RankedPageRange[] {
  const scores = new Map<number, { score: number; reasons: Set<string> }>();
  const pageCount = input.pageCount;
  for (let page = 1; page <= Math.min(3, pageCount); page++) {
    addPageScore(scores, page, pageCount, 30 - page, "document_identity");
  }
  addPageScore(scores, pageCount, pageCount, 8, "document_end");

  for (const outline of input.outline) {
    if (!outline.pageNumber) continue;
    addPageScore(
      scores,
      outline.pageNumber,
      pageCount,
      24,
      `outline:${outline.title.slice(0, 80)}`,
    );
  }
  for (const page of input.tableOfContentsPages) {
    addPageScore(scores, page, pageCount, 32, "table_of_contents");
  }
  for (const signal of input.pageSignals) {
    if (signal.keywordScore <= 0) continue;
    for (let offset = -contextRadius; offset <= contextRadius; offset++) {
      const contextualScore = Math.max(
        1,
        signal.keywordScore - Math.abs(offset) * 8,
      );
      addPageScore(
        scores,
        signal.pageNumber + offset,
        pageCount,
        contextualScore,
        offset === 0
          ? `keyword:${signal.matchedKeywords.slice(0, 5).join(",")}`
          : `context:${signal.pageNumber}`,
      );
    }
  }

  if (
    !input.pageSignals.some((signal) => signal.keywordScore > 0) &&
    pageCount > 3
  ) {
    const sampleCount = Math.min(20, Math.max(4, Math.ceil(pageCount / 50)));
    for (const page of buildPageScanOrder(pageCount, sampleCount)) {
      addPageScore(scores, page, pageCount, 5, "deterministic_coverage");
    }
  }

  const orderedPages = [...scores.entries()].sort(
    ([leftPage], [rightPage]) => leftPage - rightPage,
  );
  const ranges: RankedPageRange[] = [];
  for (const [page, value] of orderedPages) {
    const previous = ranges.at(-1);
    if (previous && page === previous.endPage + 1) {
      previous.endPage = page;
      previous.score = Math.max(previous.score, value.score);
      previous.reasons = [
        ...new Set([
          ...previous.reasons,
          ...value.reasons,
        ]),
      ].slice(0, 20);
      continue;
    }
    ranges.push({
      startPage: page,
      endPage: page,
      score: value.score,
      reasons: [...value.reasons].slice(0, 20),
    });
  }
  return ranges.sort((left, right) =>
    right.score - left.score ||
    left.startPage - right.startPage
  );
}

export function generatePdfChunkPlans(
  ranges: readonly RankedPageRange[],
  config: Pick<
    DocumentIntelligenceConfig,
    "maxTotalAiPages" | "maxChunkSize" | "chunkOverlapPages"
  >,
): PdfChunkPlan[] {
  const plans: Omit<PdfChunkPlan, "chunkIndex">[] = [];
  const seen = new Set<string>();
  let aiPages = 0;
  const step = Math.max(1, config.maxChunkSize - config.chunkOverlapPages);
  for (
    const range of [...ranges].sort((left, right) =>
      right.score - left.score ||
      left.startPage - right.startPage
    )
  ) {
    let start = range.startPage;
    while (start <= range.endPage && aiPages < config.maxTotalAiPages) {
      const remainingBudget = config.maxTotalAiPages - aiPages;
      const end = Math.min(
        range.endPage,
        start + config.maxChunkSize - 1,
        start + remainingBudget - 1,
      );
      if (end < start) break;
      const key = `${start}:${end}`;
      if (!seen.has(key)) {
        seen.add(key);
        const pageNumbers = Array.from(
          { length: end - start + 1 },
          (_, index) => start + index,
        );
        plans.push({
          startPage: start,
          endPage: end,
          pageNumbers,
          priorityScore: range.score,
          reasons: range.reasons,
        });
        aiPages += pageNumbers.length;
      }
      if (end >= range.endPage) break;
      start += step;
    }
    if (aiPages >= config.maxTotalAiPages) break;
  }
  return plans
    .sort((left, right) =>
      left.startPage - right.startPage ||
      left.endPage - right.endPage
    )
    .map((plan, chunkIndex) => ({ ...plan, chunkIndex }));
}

export function rebaseRawEvidencePages(
  raw: Record<string, unknown>,
  startPage: number,
  chunkPageCount: number,
): Record<string, unknown> {
  const clone = structuredClone(raw);
  const products = Array.isArray(clone.products) ? clone.products : [];
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    const evidence = Array.isArray(
        (product as Record<string, unknown>).evidence,
      )
      ? (product as Record<string, unknown>).evidence as unknown[]
      : [];
    for (const item of evidence) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const localPage = Number(row.page_number);
      row.page_number = Number.isInteger(localPage) &&
          localPage >= 1 &&
          localPage <= chunkPageCount
        ? startPage + localPage - 1
        : null;
    }
  }
  return clone;
}

function normalizedKey(value: unknown): string {
  return normalizeSearchText(String(value ?? ""))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function evidenceKey(evidence: ExtractionEvidence): string {
  return [
    evidence.document_id,
    evidence.page_number ?? "",
    evidence.sheet_name ?? "",
    evidence.cell_range ?? "",
    normalizedKey(evidence.field_name),
    normalizedKey(evidence.extracted_value),
    normalizedKey(evidence.source_quote),
  ].join("|");
}

function mergeEvidence(
  groups: readonly ExtractionEvidence[][],
): ExtractionEvidence[] {
  const output = new Map<string, ExtractionEvidence>();
  for (const evidence of groups.flat()) {
    const key = evidenceKey(evidence);
    const existing = output.get(key);
    if (!existing || evidence.confidence_score > existing.confidence_score) {
      output.set(key, evidence);
    }
  }
  return [...output.values()].sort((left, right) =>
    left.document_id - right.document_id ||
    (left.page_number ?? Number.MAX_SAFE_INTEGER) -
      (right.page_number ?? Number.MAX_SAFE_INTEGER) ||
    left.field_name.localeCompare(right.field_name)
  );
}

function productKey(product: NormalizedProduct): string {
  return [
    normalizedKey(product.lot_number),
    normalizedKey(
      product.normalized_product_name || product.product_name,
    ),
  ].join("|");
}

function uniqueStrings(values: readonly string[], limit = 100): string[] {
  const output = new Map<string, string>();
  for (const value of values) {
    const key = normalizedKey(value);
    if (key && !output.has(key)) output.set(key, value);
  }
  return [...output.values()].slice(0, limit);
}

function valueText(value: unknown): string | null {
  if (value == null || value === "") return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function collectAmbiguity(
  ambiguities: ExtractionAmbiguity[],
  field: string,
  values: Array<{
    value: unknown;
    confidenceScore: number;
    chunkId: string;
    pages: number[];
  }>,
) {
  const grouped = new Map<string, {
    value: string;
    confidenceScore: number;
    chunkIds: Set<string>;
    pages: Set<number>;
  }>();
  for (const candidate of values) {
    const text = valueText(candidate.value);
    if (!text) continue;
    const key = normalizedKey(text);
    const entry = grouped.get(key) || {
      value: text,
      confidenceScore: candidate.confidenceScore,
      chunkIds: new Set<string>(),
      pages: new Set<number>(),
    };
    entry.confidenceScore = Math.max(
      entry.confidenceScore,
      candidate.confidenceScore,
    );
    entry.chunkIds.add(candidate.chunkId);
    candidate.pages.forEach((page) => entry.pages.add(page));
    grouped.set(key, entry);
  }
  if (grouped.size <= 1) return;
  ambiguities.push({
    field,
    values: [...grouped.values()]
      .sort((left, right) =>
        right.confidenceScore - left.confidenceScore ||
        left.value.localeCompare(right.value)
      )
      .map((entry) => ({
        value: entry.value,
        confidenceScore: entry.confidenceScore,
        chunkIds: [...entry.chunkIds].sort(),
        pages: [...entry.pages].sort((left, right) => left - right),
      })),
  });
}

function bestValue<T>(
  candidates: Array<{ value: T; confidence: number; chunkId: string }>,
): T | null {
  const usable = candidates.filter((candidate) =>
    candidate.value != null && candidate.value !== ""
  );
  if (!usable.length) return null;
  return usable.sort((left, right) =>
    right.confidence - left.confidence ||
    normalizedKey(left.value).localeCompare(normalizedKey(right.value)) ||
    left.chunkId.localeCompare(right.chunkId)
  )[0].value;
}

function mergeProducts(
  chunks: readonly ChunkMergeInput[],
  ambiguities: ExtractionAmbiguity[],
): NormalizedProduct[] {
  const grouped = new Map<
    string,
    Array<{
      product: NormalizedProduct;
      confidence: number;
      chunkId: string;
    }>
  >();
  for (const chunk of chunks) {
    for (const product of chunk.analysis.products) {
      const key = productKey(product);
      const rows = grouped.get(key) || [];
      rows.push({
        product,
        confidence: product.confidence_score,
        chunkId: String(chunk.chunkId),
      });
      grouped.set(key, rows);
    }
  }
  const output: NormalizedProduct[] = [];
  for (const [key, rows] of grouped) {
    rows.sort((left, right) =>
      right.confidence - left.confidence ||
      left.chunkId.localeCompare(right.chunkId)
    );
    const primary = rows[0].product;
    const scalarFields: Array<keyof NormalizedProduct> = [
      "quantity_value",
      "quantity_unit",
      "quantity_scope",
      "packaging",
      "package_quantity",
      "package_unit",
      "units_per_package",
      "sterility",
      "material",
      "dimensions",
    ];
    for (const field of scalarFields) {
      collectAmbiguity(
        ambiguities,
        `products.${key}.${String(field)}`,
        rows.map((row) => ({
          value: row.product[field],
          confidenceScore: row.confidence,
          chunkId: row.chunkId,
          pages: row.product.evidence.flatMap((item) =>
            item.page_number ? [item.page_number] : []
          ),
        })),
      );
    }
    const requirements = new Map<
      string,
      NormalizedProduct["requirements"][0]
    >();
    for (const row of rows) {
      for (const requirement of row.product.requirements) {
        const requirementKey = normalizedKey(requirement.name);
        if (!requirements.has(requirementKey)) {
          requirements.set(requirementKey, requirement);
        }
      }
    }
    output.push({
      ...primary,
      required_certifications: uniqueStrings(
        rows.flatMap((row) => row.product.required_certifications),
      ),
      technical_requirements: uniqueStrings(
        rows.flatMap((row) => row.product.technical_requirements),
      ),
      requirements: [...requirements.values()].slice(0, 100),
      evidence: mergeEvidence(rows.map((row) => row.product.evidence)),
      confidence_score: Math.max(...rows.map((row) => row.confidence)),
    });
  }
  return output.sort((left, right) =>
    String(left.lot_number || "").localeCompare(
      String(right.lot_number || ""),
    ) ||
    left.product_name.localeCompare(right.product_name)
  ).slice(0, 100);
}

export function mergeChunkAnalyses(
  chunks: readonly ChunkMergeInput[],
): MergedDocumentAnalysisV3 {
  if (!chunks.length) {
    throw new Error("At least one completed chunk is required for merging");
  }
  const ordered = [...chunks].sort((left, right) =>
    left.startPage - right.startPage ||
    String(left.chunkId).localeCompare(String(right.chunkId))
  );
  const ambiguities: ExtractionAmbiguity[] = [];
  const tenderFields = [
    "title_original",
    "title_normalized_en",
    "authority_original",
    "authority_normalized_en",
    "country_code",
    "country_name_original",
    "publication_date",
    "deadline_at",
    "estimated_value",
    "currency",
  ] as const;
  const tender: NormalizedDocumentAnalysis["tender"] = {
    ...ordered[0].analysis.tender,
  };
  for (const field of tenderFields) {
    const candidates = ordered.map((chunk) => ({
      value: chunk.analysis.tender[field],
      confidence: chunk.analysis.document_confidence_score,
      confidenceScore: chunk.analysis.document_confidence_score,
      chunkId: String(chunk.chunkId),
      pages: [chunk.startPage, chunk.endPage],
    }));
    tender[field] = bestValue(candidates) as never;
    collectAmbiguity(ambiguities, `tender.${field}`, candidates);
  }
  tender.cpv_codes = uniqueStrings(
    ordered.flatMap((chunk) => chunk.analysis.tender.cpv_codes),
  );
  tender.delivery_requirements = uniqueStrings(
    ordered.flatMap((chunk) => chunk.analysis.tender.delivery_requirements),
  );
  tender.submission_languages = uniqueStrings(
    ordered.flatMap((chunk) => chunk.analysis.tender.submission_languages),
    20,
  );
  tender.document_languages = uniqueStrings(
    ordered.flatMap((chunk) => chunk.analysis.tender.document_languages),
    20,
  );

  const products = mergeProducts(ordered, ambiguities);
  const lotMap = new Map<string, NormalizedDocumentAnalysis["lots"][number]>();
  for (const chunk of ordered) {
    for (const lot of chunk.analysis.lots) {
      const key = `${normalizedKey(lot.lot_number)}|${
        normalizedKey(lot.lot_title)
      }`;
      if (!lotMap.has(key)) lotMap.set(key, lot);
    }
  }
  const evidenceCount = products.reduce(
    (total, product) => total + product.evidence.length,
    0,
  );
  const sourceFactCount = ordered.reduce(
    (total, chunk) =>
      total +
      chunk.analysis.products.length +
      chunk.analysis.products.reduce(
        (evidenceTotal, product) => evidenceTotal + product.evidence.length,
        0,
      ),
    0,
  );
  const mergedFactCount = products.length + evidenceCount;
  const confidenceWeight = ordered.reduce(
    (total, chunk) => total + Math.max(1, chunk.analysis.evidence_count),
    0,
  );
  const confidence = Math.round(
    ordered.reduce(
      (total, chunk) =>
        total +
        chunk.analysis.document_confidence_score *
          Math.max(1, chunk.analysis.evidence_count),
      0,
    ) / confidenceWeight,
  );
  const summaries = ordered
    .filter((chunk) => chunk.analysis.summary)
    .sort((left, right) =>
      right.analysis.document_confidence_score -
        left.analysis.document_confidence_score ||
      left.startPage - right.startPage
    );
  return {
    schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
    analysis_status:
      ordered.every((chunk) =>
          chunk.analysis.analysis_status === "completed"
        ) &&
        products.length > 0 && evidenceCount > 0 && ambiguities.length === 0
        ? "completed"
        : "partial",
    document_confidence_score: confidence,
    data_completeness_score: Math.max(
      ...ordered.map((chunk) => chunk.analysis.data_completeness_score),
    ),
    summary: summaries[0]?.analysis.summary || "",
    missing_information: uniqueStrings(
      ordered.flatMap((chunk) => chunk.analysis.missing_information),
    ),
    tender,
    products,
    lots: [...lotMap.values()].slice(0, 30),
    fit_narrative: null,
    evidence_count: evidenceCount,
    ambiguities: ambiguities.sort((left, right) =>
      left.field.localeCompare(right.field)
    ),
    merge_statistics: {
      chunk_count: ordered.length,
      product_count: products.length,
      evidence_count: evidenceCount,
      ambiguity_count: ambiguities.length,
      duplicate_facts_removed: Math.max(0, sourceFactCount - mergedFactCount),
    },
  };
}

export function estimateAiCost(
  usage: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  },
  config: Pick<
    DocumentIntelligenceConfig,
    "inputCostPerMillionTokens" | "outputCostPerMillionTokens"
  >,
): number {
  const inputTokens = Math.max(
    0,
    Number(usage.input_tokens || 0) +
      Number(usage.cache_creation_input_tokens || 0) +
      Number(usage.cache_read_input_tokens || 0),
  );
  const outputTokens = Math.max(0, Number(usage.output_tokens || 0));
  return Number(
    (
      inputTokens / 1_000_000 * config.inputCostPerMillionTokens +
      outputTokens / 1_000_000 * config.outputCostPerMillionTokens
    ).toFixed(6),
  );
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.trunc(concurrency)),
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

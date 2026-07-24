/// <reference path="../_shared/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import mammoth from "npm:mammoth@1.9.0";
import * as XLSX from "npm:xlsx@0.18.5";
import { normalizePublicUrl } from "../_shared/attachment-discovery.ts";
import {
  type NormalizedDocumentAnalysis,
  normalizeDocumentAnalysis,
  shouldApplyExtraction,
} from "../_shared/document-extraction-v2.ts";
import {
  DOCUMENT_INSPECTION_VERSION,
  estimateAiCost,
  mergeChunkAnalyses,
  type PdfInspection,
  rebaseRawEvidencePages,
} from "../_shared/document-intelligence-v3.ts";
import {
  createExecutionBudgetState,
  DOCUMENT_CACHE_VERSION_V31,
  DOCUMENT_CHUNKING_VERSION_V31 as DOCUMENT_CHUNKING_VERSION,
  DOCUMENT_EXTRACTION_VERSION_V31 as DOCUMENT_EXTRACTION_VERSION_V3,
  DOCUMENT_PROMPT_SCHEMA_VERSION_V31 as DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
  type DocumentIntelligenceV31Config,
  type DocumentProgressStage,
  evaluateEarlyCompletion,
  type ExecutionBudgetState,
  executionGuardrailReason,
  extractionQualityMetrics,
  planPrioritizedAdaptiveChunks,
  progressEstimate,
  publicV31ConfigSnapshot,
  readDocumentIntelligenceV31Config,
  rebindAnalysisDocumentId,
  recordExecutionUsage,
  reserveAiRequest,
} from "../_shared/document-intelligence-v3-1.ts";
import {
  inspectPdfBytes,
  materializePdfChunkPlans,
  sha256Bytes,
} from "../_shared/pdf-processing-v3.ts";
import {
  finishPipelineRun,
  finishPipelineStage,
  PIPELINE_VERSIONS,
  type PipelineRunHandle,
  recordDocumentAccessAttempt,
  sanitizeMessage,
  stableVersionHash,
  startPipelineRun,
  startPipelineStage,
} from "../_shared/matching-observability.ts";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const MAX_REDIRECTS = 5;
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

type AdminClient = ReturnType<typeof createClient<any>>;

type QueuePayload = {
  action?: "queue" | "status";
  tender_id?: number;
  company_id?: number;
};

type TenderDocumentRecord = {
  id: number;
  title?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  mime_type?: string | null;
  document_type?: string | null;
  language_code?: string | null;
  source_confidence?: string | null;
  __inline_text?: string;
};

type DownloadedDocument = {
  bytes: Uint8Array;
  mimeType: string;
  resolvedUrl: string;
  redirectCount: number;
};

type ChunkWork = {
  chunkId: number;
  inspectionId: number | null;
  documentId: number | null;
  sourceDocumentKey: string;
  contentSha256: string;
  chunkIndex: number;
  startPage: number;
  endPage: number;
  pageNumbers: number[];
  bytes: Uint8Array | null;
  text: string | null;
  mimeType: string;
  title: string;
  inputHash: string;
  priorityScore: number;
  processingOrder: number;
  densityScore: number;
  estimatedInputTokens: number;
};

type ChunkExecutionResult = {
  status: "completed" | "failed" | "skipped" | "guardrail";
  analysis: NormalizedDocumentAnalysis | null;
  guardrailReason: string | null;
  aiRequests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  providerDurationMs: number;
};

type BenchmarkTimings = {
  inspectionMs: number;
  chunkGenerationMs: number;
  aiMs: number;
  mergeMs: number;
  databaseMs: number;
  networkMs: number;
};

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://medichall.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isSafeHttpsUrl(value: string): boolean {
  return normalizePublicUrl(value)?.protocol === "https:";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const batchSize = 0x8000;
  for (let index = 0; index < bytes.length; index += batchSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + batchSize));
  }
  return btoa(binary);
}

function extractClaudeText(data: any): string {
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text || ""))
    .join("\n")
    .trim();
}

function parseClaudeJson(data: any): Record<string, unknown> | null {
  let raw = extractClaudeText(data)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

class AiGuardrailError extends Error {
  constructor(readonly reason: string) {
    super(`AI execution stopped by ${reason}`);
    this.name = "AiGuardrailError";
  }
}

async function downloadDocument(
  url: string,
  config: DocumentIntelligenceV31Config,
): Promise<DownloadedDocument> {
  let current = normalizePublicUrl(url);
  if (!current || current.protocol !== "https:") {
    throw new Error("Document URL is not a permitted public HTTPS URL");
  }
  let response: Response;
  let redirectCount = 0;
  let acceptedRetries = 0;
  while (true) {
    response = await fetch(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(config.downloadTimeoutMs),
      headers: { "User-Agent": "MedicHall-Tender-Document-Engine/3.0" },
    });
    if (response.status === 202) {
      // TED renders notice PDFs asynchronously: the endpoint returns
      // 202 with an empty body until the PDF is generated. Poll briefly
      // and otherwise fail as retriable so a later invocation retries.
      await response.body?.cancel();
      if (acceptedRetries < 3) {
        acceptedRetries++;
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        continue;
      }
      const error = new Error(
        "The document host is still generating this file (HTTP 202)",
      );
      Object.assign(error, {
        retriableDownload: true,
        documentAccessClassification: {
          httpStatus: 202,
          contentType: response.headers.get("content-type"),
          contentLength: 0,
          url: response.url || current.href,
          isDirectFile: true,
          redirectCount,
          error,
        },
      });
      throw error;
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) break;
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error("Document download exceeded the redirect limit");
    }
    const next = normalizePublicUrl(location, current.href);
    if (!next || next.protocol !== "https:") {
      throw new Error(
        "Document redirect target is not a permitted public HTTPS URL",
      );
    }
    current = next;
    redirectCount++;
  }
  if (!response.ok) {
    const error = new Error(`Could not download document (${response.status})`);
    Object.assign(error, {
      documentAccessClassification: {
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: Number(response.headers.get("content-length") || 0),
        url: response.url || current.href,
        isDirectFile: true,
        redirectCount,
        error,
      },
    });
    throw error;
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > config.maxDocumentBytes) {
    const error = new Error("Document exceeds the configured byte limit");
    Object.assign(error, {
      documentAccessClassification: {
        contentType: response.headers.get("content-type"),
        contentLength: declaredLength,
        url: response.url || current.href,
        isDirectFile: true,
        fileTooLarge: true,
        redirectCount,
        error,
      },
    });
    throw error;
  }
  if (!response.body) throw new Error("Document response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > config.maxDocumentBytes) {
      await reader.cancel();
      const error = new Error("Document exceeds the configured byte limit");
      Object.assign(error, {
        documentAccessClassification: {
          contentType: response.headers.get("content-type"),
          contentLength: totalBytes,
          url: response.url || current.href,
          isDirectFile: true,
          fileTooLarge: true,
          redirectCount,
          error,
        },
      });
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    mimeType: response.headers.get("content-type")?.split(";")[0].trim()
      .toLowerCase() || "application/pdf",
    resolvedUrl: response.url || current.href,
    redirectCount,
  };
}

async function documentText(
  bytes: Uint8Array,
  mimeType: string,
  maximumCharacters: number,
): Promise<string> {
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    return new TextDecoder().decode(bytes).slice(0, maximumCharacters);
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({
      arrayBuffer: Uint8Array.from(bytes).buffer,
    });
    return String(result.value || "").slice(0, maximumCharacters);
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const output: string[] = [];
    let remaining = maximumCharacters;
    for (const sheetName of workbook.SheetNames.slice(0, 20)) {
      if (remaining <= 0) break;
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], {
        blankrows: false,
      });
      if (!csv.trim()) continue;
      const block = `<sheet name="${
        sheetName.replaceAll('"', "")
      }">\n${csv}\n</sheet>`;
      output.push(block.slice(0, remaining));
      remaining -= block.length;
    }
    return output.join("\n").slice(0, maximumCharacters);
  }
  throw new Error(`Unsupported document MIME type: ${mimeType}`);
}

function collectStructuredText(
  value: unknown,
  output: string[],
  depth = 0,
): void {
  if (
    value == null || depth > 6 ||
    output.reduce((length, item) => length + item.length, 0) > 50_000
  ) return;
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredText(item, output, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (
      const [key, item] of Object.entries(value as Record<string, unknown>)
    ) {
      output.push(`${key}:`);
      collectStructuredText(item, output, depth + 1);
    }
  }
}

async function fallbackDocuments(
  adminClient: AdminClient,
  tenderId: number,
): Promise<TenderDocumentRecord[]> {
  const { data: tender, error } = await adminClient
    .from("tenders")
    .select(
      "source_url,source_notice_id,title,description,buyer_name,country_name,cpv_codes,deadline_at,estimated_value,currency,raw_payload",
    )
    .eq("id", tenderId)
    .single();
  if (error || !tender) throw new Error("Tender notice data is unavailable");
  const blocks: string[] = [];
  if (tender.title) blocks.push(`TITLE: ${tender.title}`);
  if (tender.buyer_name) blocks.push(`BUYER: ${tender.buyer_name}`);
  if (tender.country_name) blocks.push(`COUNTRY: ${tender.country_name}`);
  if (tender.deadline_at) blocks.push(`DEADLINE: ${tender.deadline_at}`);
  if (tender.estimated_value) {
    blocks.push(
      `ESTIMATED VALUE: ${tender.estimated_value} ${tender.currency || ""}`,
    );
  }
  if (Array.isArray(tender.cpv_codes) && tender.cpv_codes.length) {
    blocks.push(`CPV: ${tender.cpv_codes.join(", ")}`);
  }
  if (tender.description) blocks.push(`DESCRIPTION: ${tender.description}`);
  const publicationNumber = String(tender.source_notice_id || "").trim();
  if (/^\d{1,10}-\d{4}$/.test(publicationNumber)) {
    try {
      const response = await fetch(
        "https://api.ted.europa.eu/v3/notices/search",
        {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `publication-number IN (${publicationNumber})`,
            fields: [
              "notice-title",
              "description-proc",
              "description-lot",
              "title-lot",
              "buyer-name",
              "buyer-country",
              "classification-cpv",
              "deadline-receipt-tender-date-lot",
              "estimated-value-proc",
              "estimated-value-cur-proc",
              "estimated-value-lot",
              "place-of-performance",
            ],
            page: 1,
            limit: 1,
            checkQuerySyntax: false,
          }),
        },
      );
      if (response.ok) {
        const payload = await response.json();
        const notice = (payload.notices ?? payload.results ?? [])[0];
        if (notice) {
          const values: string[] = [];
          collectStructuredText(notice, values);
          if (values.length) {
            blocks.push(`[OFFICIAL TED NOTICE DATA]\n${values.join(" ")}`);
          }
        }
      }
    } catch {
      // The public TED enrichment is best-effort.
    }
  }
  if (tender.raw_payload && typeof tender.raw_payload === "object") {
    const values: string[] = [];
    collectStructuredText(tender.raw_payload, values);
    if (values.length) blocks.push(`[FEED DATA]\n${values.join(" ")}`);
  }
  const text = blocks.join("\n\n").replace(/\s+/g, " ").trim().slice(0, 60_000);
  if (text.length < 200) {
    throw new Error(
      "No documents registered and no notice data is available for this tender",
    );
  }
  const result: TenderDocumentRecord[] = [];
  if (/^\d{1,10}-\d{4}$/.test(publicationNumber)) {
    result.push({
      id: -1,
      title: "Official TED notice PDF",
      file_name: `ted-notice-${publicationNumber}.pdf`,
      file_url: `https://ted.europa.eu/en/notice/${publicationNumber}/pdf`,
      mime_type: "application/pdf",
      document_type: "notice",
      language_code: "en",
    });
  }
  result.push({
    id: 0,
    title: "Official TED notice (fallback)",
    file_name: "ted-notice.txt",
    file_url: String(tender.source_url || "https://ted.europa.eu"),
    mime_type: "text/plain",
    document_type: "notice",
    language_code: "en",
    __inline_text: text,
  });
  return result;
}

function sourceDocumentKey(document: TenderDocumentRecord): string {
  return Number(document.id) > 0
    ? `document:${document.id}`
    : `fallback:${document.id}:${document.file_name || "notice"}`;
}

function promptForChunk(
  documentId: number,
  title: string,
  startPage: number,
  endPage: number,
): string {
  return `
You are MedicHall's medical tender fact extraction engine. Extract only facts
explicitly supported by this one document chunk.

STRICT RULES:
- Never infer, guess, estimate, or fill missing facts from industry knowledge.
- A broad category or CPV code is not proof of a product.
- Keep original product wording, quantities, units, requirements, and lots.
- Every extracted product field must have a short exact evidence quote.
- For PDF evidence, page_number is CHUNK-LOCAL: 1 is original page
  ${startPage}, and ${endPage - startPage + 1} is original page ${endPage}.
- Use document_id ${documentId} for every evidence item.
- Mark partial for ambiguity, missing annexes, unreadable tables, or weak proof.
- Confidence measures evidence strength. Return compact valid JSON only.
- fit_narrative must be null; company matching is a separate backend stage.
- Include no more than 30 explicit lots and note any omission.

DOCUMENT: ${title}
ORIGINAL SOURCE PAGES: ${startPage}-${endPage}

Return this exact JSON shape:
{
  "analysis_status":"partial",
  "document_confidence_score":0,
  "data_completeness_score":0,
  "summary":"",
  "missing_information":[],
  "tender":{
    "title_original":null,"title_normalized_en":null,
    "authority_original":null,"authority_normalized_en":null,
    "country_code":null,"country_name_original":null,
    "publication_date":null,"deadline_at":null,"cpv_codes":[],
    "estimated_value":null,"currency":null,"delivery_requirements":[],
    "submission_languages":[],"document_languages":[]
  },
  "products":[{
    "product_name":"","normalized_product_name":null,
    "product_description_original":null,
    "product_description_normalized_en":null,"lot_number":null,
    "quantity_value":null,"quantity_unit":null,"quantity_scope":"unknown",
    "packaging":null,
    "packaging_details":{"package_quantity":null,"package_unit":null,
      "units_per_package":null},
    "sterility":null,"material":null,"dimensions":null,
    "required_certifications":[],"technical_requirements":[],
    "requirements":[{"name":"","value":null,"normalized_value":null,
      "status":"unknown"}],
    "confidence_score":0,
    "evidence":[{
      "document_id":${documentId},"page_number":null,"sheet_name":null,
      "cell_range":null,"source_quote":"","field_name":"product_name",
      "extracted_value":"","normalized_value":null,
      "requirement_status":"unknown",
      "source_language":null,"confidence_score":0
    }]
  }],
  "lots":[{"lot_number":null,"lot_title":null,
    "estimated_quantity":null,"quantity_unit":null,
    "estimated_value":null,"currency":null}],
  "fit_narrative":null
}`.trim();
}

async function callClaudeForChunk(
  anthropicKey: string,
  model: string,
  work: ChunkWork,
  config: DocumentIntelligenceV31Config,
  budget: ExecutionBudgetState,
  deadlineMs: number,
): Promise<{
  raw: Record<string, unknown>;
  requestId: string | null;
  usage: Record<string, number>;
  attempts: number;
  estimatedCostUsd: number;
  durationMs: number;
}> {
  const content: any[] = [];
  if (work.bytes) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: bytesToBase64(work.bytes),
      },
      title: work.title,
      context:
        `MedicHall tender document chunk. Original source pages ${work.startPage}-${work.endPage}.`,
      citations: { enabled: true },
    });
  } else {
    content.push({
      type: "text",
      text: `<document id="${work.documentId ?? 0}" filename="${
        work.title.replaceAll('"', "")
      }">\n${work.text || ""}\n</document>`,
    });
  }
  content.push({
    type: "text",
    text: promptForChunk(
      work.documentId ?? 0,
      work.title,
      work.startPage,
      work.endPage,
    ),
  });
  let lastResponse: any = null;
  const aggregateUsage: Record<string, number> = {};
  let aggregateCost = 0;
  const startedAt = performance.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    // The provider call must finish inside the invocation time budget;
    // an in-flight call at worker kill time leaves an orphaned lease.
    const providerTimeoutMs = Math.min(
      config.providerTimeoutMs,
      deadlineMs - Date.now() - 8_000,
    );
    if (providerTimeoutMs < 15_000) {
      throw new Error(
        "TIME_BUDGET_EXCEEDED: not enough invocation time left for an AI request",
      );
    }
    const guardrail = reserveAiRequest(
      budget,
      work.sourceDocumentKey,
      config,
    );
    if (guardrail) throw new AiGuardrailError(guardrail);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(providerTimeoutMs),
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: config.maxChunkOutputTokens,
        temperature: 0,
        system:
          "Extract procurement facts conservatively. Never fabricate data. Return one compact JSON object only." +
          (attempt === 2
            ? " The prior response was invalid; shorten evidence quotes and ensure complete valid JSON."
            : ""),
        messages: [{ role: "user", content }],
      }),
    });
    lastResponse = await response.json();
    const responseUsage = (lastResponse?.usage || {}) as Record<string, number>;
    const responseCost = estimateAiCost(responseUsage, config);
    for (
      const key of [
        "input_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "output_tokens",
      ]
    ) {
      aggregateUsage[key] = Number(aggregateUsage[key] || 0) +
        Number(responseUsage[key] || 0);
    }
    aggregateCost = Number((aggregateCost + responseCost).toFixed(6));
    recordExecutionUsage(budget, work.sourceDocumentKey, {
      ...responseUsage,
      estimated_cost_usd: responseCost,
    });
    if (!response.ok) {
      throw new Error(
        lastResponse?.error?.message ||
          `Anthropic request failed (${response.status})`,
      );
    }
    const parsed = parseClaudeJson(lastResponse);
    if (parsed) {
      return {
        raw: parsed,
        requestId: lastResponse?.id || null,
        usage: aggregateUsage,
        attempts: attempt,
        estimatedCostUsd: aggregateCost,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    }
  }
  throw new Error(
    lastResponse?.stop_reason === "max_tokens"
      ? "AI chunk response was truncated twice"
      : "AI provider returned invalid JSON twice",
  );
}

function inspectionFromRow(row: any): PdfInspection {
  return {
    pageCount: Number(row.page_count),
    scannedPageCount: Number(row.scanned_page_count || 0),
    scanLimit: Number(row.config_snapshot?.max_pdf_pages_scanned_per_pass || 0),
    inspectionPartial: row.status === "partial",
    metadata: row.inspection_metadata || {},
    outline: Array.isArray(row.document_outline) ? row.document_outline : [],
    tableOfContentsPages: Array.isArray(row.table_of_contents_pages)
      ? row.table_of_contents_pages.map(Number)
      : [],
    pageSignals: Array.isArray(row.page_signals) ? row.page_signals : [],
    rankedRanges: Array.isArray(row.ranked_page_ranges)
      ? row.ranked_page_ranges
      : [],
    durationMs: Number(row.processing_duration_ms || 0),
  };
}

async function findOrCreateInspection(
  adminClient: AdminClient,
  tenderId: number,
  document: TenderDocumentRecord,
  sourceKey: string,
  contentHash: string,
  bytes: Uint8Array,
  config: DocumentIntelligenceV31Config,
): Promise<{ id: number; inspection: PdfInspection; reused: boolean }> {
  const { data: existing } = await adminClient
    .from("tender_document_inspections")
    .select("*")
    .eq("source_document_key", sourceKey)
    .eq("content_sha256", contentHash)
    .eq("inspection_version", DOCUMENT_INSPECTION_VERSION)
    .in("status", ["completed", "partial"])
    .maybeSingle();
  if (existing?.id) {
    return {
      id: Number(existing.id),
      inspection: inspectionFromRow(existing),
      reused: true,
    };
  }
  let inspection: PdfInspection;
  try {
    inspection = await inspectPdfBytes(bytes, config);
  } catch (error) {
    await adminClient.from("tender_document_inspections").upsert({
      tender_id: tenderId,
      document_id: Number(document.id) > 0 ? Number(document.id) : null,
      source_document_key: sourceKey,
      content_sha256: contentHash,
      inspection_version: DOCUMENT_INSPECTION_VERSION,
      status: "failed",
      scanned_page_count: 0,
      config_snapshot: publicV31ConfigSnapshot(config),
      processing_duration_ms: 0,
      error_message: sanitizeMessage(error),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "source_document_key,content_sha256,inspection_version",
    });
    throw error;
  }
  const { data: created, error } = await adminClient
    .from("tender_document_inspections")
    .upsert({
      tender_id: tenderId,
      document_id: Number(document.id) > 0 ? Number(document.id) : null,
      source_document_key: sourceKey,
      content_sha256: contentHash,
      inspection_version: DOCUMENT_INSPECTION_VERSION,
      status: inspection.inspectionPartial ? "partial" : "completed",
      page_count: inspection.pageCount,
      scanned_page_count: inspection.scannedPageCount,
      inspection_metadata: inspection.metadata,
      document_outline: inspection.outline,
      table_of_contents_pages: inspection.tableOfContentsPages,
      page_signals: inspection.pageSignals,
      ranked_page_ranges: inspection.rankedRanges,
      config_snapshot: publicV31ConfigSnapshot(config),
      processing_duration_ms: inspection.durationMs,
      error_message: null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "source_document_key,content_sha256,inspection_version",
    })
    .select("id")
    .single();
  if (error || !created?.id) {
    throw new Error(error?.message || "Could not persist PDF inspection");
  }
  return { id: Number(created.id), inspection, reused: false };
}

async function upsertChunk(
  adminClient: AdminClient,
  row: Record<string, unknown>,
): Promise<any> {
  const { data, error } = await adminClient
    .from("tender_document_analysis_chunks")
    .upsert(row, {
      onConflict: "job_id,source_document_key,input_hash",
    })
    .select("*")
    .single();
  if (error || !data?.id) {
    throw new Error(error?.message || "Could not persist document chunk");
  }
  return data;
}

async function reuseChunkIfAvailable(
  adminClient: AdminClient,
  jobId: number,
  chunk: any,
): Promise<boolean> {
  if (chunk.status === "completed") return true;
  const { data: reusable } = await adminClient
    .from("tender_document_analysis_chunks")
    .select("id,normalized_result,confidence_score,provider_usage")
    .eq("input_hash", chunk.input_hash)
    .eq("extraction_version", DOCUMENT_EXTRACTION_VERSION_V3)
    .eq("status", "completed")
    .neq("id", chunk.id)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!reusable?.id) return false;
  const rebound = rebindAnalysisDocumentId(
    reusable.normalized_result as NormalizedDocumentAnalysis,
    Number(chunk.document_id || 0),
  );
  const { error } = await adminClient
    .from("tender_document_analysis_chunks")
    .update({
      status: "completed",
      normalized_result: rebound,
      confidence_score: reusable.confidence_score,
      provider_usage: {
        reused: true,
        original_provider_usage: reusable.provider_usage || {},
      },
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      reused_from_chunk_id: reusable.id,
      cache_hit: true,
      cache_key: chunk.input_hash,
      ai_request_count: 0,
      provider_duration_ms: 0,
      lease_expires_at: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", chunk.id)
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);
  return true;
}

async function executeChunk(
  adminClient: AdminClient,
  anthropicKey: string,
  model: string,
  jobId: number,
  work: ChunkWork,
  config: DocumentIntelligenceV31Config,
  budget: ExecutionBudgetState,
  deadlineMs: number,
): Promise<ChunkExecutionResult> {
  const { data: claimed, error: claimError } = await adminClient.rpc(
    "claim_tender_document_analysis_chunk_v3",
    {
      p_job_id: jobId,
      p_chunk_id: work.chunkId,
      p_lease_seconds: Math.max(
        30,
        Math.min(1_800, Math.ceil(config.providerTimeoutMs / 1_000) + 60),
      ),
      p_max_attempts: config.maxChunkAttempts,
    },
  );
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.id) {
    return {
      status: "skipped",
      analysis: null,
      guardrailReason: null,
      aiRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      providerDurationMs: 0,
    };
  }
  try {
    const provider = await callClaudeForChunk(
      anthropicKey,
      model,
      work,
      config,
      budget,
      deadlineMs,
    );
    const rebased = work.bytes
      ? rebaseRawEvidencePages(
        provider.raw,
        work.startPage,
        work.pageNumbers.length,
      )
      : provider.raw;
    const analysis = normalizeDocumentAnalysis(
      rebased,
      new Set([work.documentId ?? 0]),
    );
    const usage = provider.usage || {};
    const cost = provider.estimatedCostUsd;
    const { error } = await adminClient
      .from("tender_document_analysis_chunks")
      .update({
        status: "completed",
        model_name: model,
        normalized_result: analysis,
        confidence_score: analysis.document_confidence_score,
        provider_request_id: provider.requestId,
        provider_usage: { ...usage, provider_attempts: provider.attempts },
        input_tokens: Number(usage.input_tokens || 0),
        output_tokens: Number(usage.output_tokens || 0),
        estimated_cost_usd: cost,
        provider_name: "Anthropic",
        provider_duration_ms: provider.durationMs,
        ai_request_count: provider.attempts,
        error_code: null,
        error_message: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", work.chunkId)
      .eq("job_id", jobId);
    if (error) throw new Error(error.message);
    return {
      status: "completed",
      analysis,
      guardrailReason: null,
      aiRequests: provider.attempts,
      inputTokens: Number(usage.input_tokens || 0) +
        Number(usage.cache_creation_input_tokens || 0) +
        Number(usage.cache_read_input_tokens || 0),
      outputTokens: Number(usage.output_tokens || 0),
      estimatedCostUsd: cost,
      providerDurationMs: provider.durationMs,
    };
  } catch (error) {
    const guardrailReason = error instanceof AiGuardrailError
      ? error.reason
      : null;
    await adminClient
      .from("tender_document_analysis_chunks")
      .update({
        status: guardrailReason ? "ignored" : "failed",
        ignored_reason: guardrailReason,
        error_code: guardrailReason ||
          "DOCUMENT_CHUNK_EXTRACTION_FAILED",
        error_message: sanitizeMessage(error),
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", work.chunkId)
      .eq("job_id", jobId);
    return {
      status: guardrailReason ? "guardrail" : "failed",
      analysis: null,
      guardrailReason,
      aiRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      providerDurationMs: 0,
    };
  }
}

async function executeChunkWithRetry(
  adminClient: AdminClient,
  anthropicKey: string,
  model: string,
  jobId: number,
  work: ChunkWork,
  config: DocumentIntelligenceV31Config,
  budget: ExecutionBudgetState,
  deadlineMs: number,
): Promise<ChunkExecutionResult> {
  let result: ChunkExecutionResult | null = null;
  for (let attempt = 0; attempt < config.maxChunkAttempts; attempt++) {
    if (deadlineMs - Date.now() < 30_000) {
      // Leave the chunk claimable for the next invocation instead of
      // starting work that cannot finish inside the time budget.
      return result ?? {
        status: "skipped",
        analysis: null,
        guardrailReason: null,
        aiRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        providerDurationMs: 0,
      };
    }
    result = await executeChunk(
      adminClient,
      anthropicKey,
      model,
      jobId,
      work,
      config,
      budget,
      deadlineMs,
    );
    if (result.status !== "failed") return result;
  }
  return result!;
}

async function updateProgress(
  adminClient: AdminClient,
  job: { id: number; tender_id: number; company_id?: number | null },
  stage: DocumentProgressStage,
  startedMs: number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const estimate = progressEstimate(stage, Date.now() - startedMs);
  const now = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("tender_document_analysis_jobs")
    .update({
      progress_stage: stage,
      progress_percent: estimate.percent,
      estimated_remaining_seconds: estimate.estimatedRemainingSeconds,
      updated_at: now,
    })
    .eq("id", job.id);
  if (updateError) throw new Error(updateError.message);
  const { error: eventError } = await adminClient
    .from("tender_document_analysis_progress_events")
    .insert({
      job_id: job.id,
      tender_id: job.tender_id,
      company_id: Number(job.company_id) || null,
      stage,
      progress_percent: estimate.percent,
      estimated_remaining_seconds: estimate.estimatedRemainingSeconds,
      metadata,
      created_at: now,
    });
  if (eventError) throw new Error(eventError.message);
}

async function findCachedDocumentExtraction(
  adminClient: AdminClient,
  contentSha256: string,
  model: string,
): Promise<any | null> {
  const { data, error } = await adminClient
    .from("tender_document_extraction_cache")
    .select("*")
    .eq("content_sha256", contentSha256)
    .eq("cache_version", DOCUMENT_CACHE_VERSION_V31)
    .eq("extraction_version", DOCUMENT_EXTRACTION_VERSION_V3)
    .eq("prompt_schema_version", DOCUMENT_PROMPT_SCHEMA_VERSION_V3)
    .eq("model_name", model)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  const { error: hitError } = await adminClient
    .from("tender_document_extraction_cache")
    .update({
      hit_count: Number(data.hit_count || 0) + 1,
      last_hit_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id);
  if (hitError) throw new Error(hitError.message);
  return data;
}

async function persistDocumentCaches(
  adminClient: AdminClient,
  jobId: number,
  chunks: readonly any[],
  model: string,
  cacheTtlSeconds: number,
  pageCountByDocument: ReadonlyMap<string, number>,
): Promise<number> {
  const byDocument = new Map<string, any[]>();
  for (const chunk of chunks) {
    if (
      chunk.status !== "completed" ||
      !chunk.normalized_result ||
      chunk.cache_hit
    ) continue;
    const key = String(chunk.source_document_key);
    byDocument.set(key, [...(byDocument.get(key) || []), chunk]);
  }
  let persisted = 0;
  for (const documentChunks of byDocument.values()) {
    const merged = mergeChunkAnalyses(documentChunks.map((chunk) => ({
      chunkId: chunk.id,
      startPage: Number(chunk.page_start || 1),
      endPage: Number(chunk.page_end || chunk.page_start || 1),
      analysis: chunk.normalized_result as NormalizedDocumentAnalysis,
    })));
    const quality = extractionQualityMetrics(merged);
    const first = documentChunks[0];
    const expiresAt = new Date(
      Date.now() + cacheTtlSeconds * 1_000,
    ).toISOString();
    const { error } = await adminClient
      .from("tender_document_extraction_cache")
      .upsert({
        content_sha256: first.content_sha256,
        cache_version: DOCUMENT_CACHE_VERSION_V31,
        extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
        prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
        model_name: model,
        normalized_result: merged,
        page_count: Math.max(
          1,
          Number(pageCountByDocument.get(String(first.source_document_key))) ||
            0,
          ...documentChunks.map((chunk) => Number(chunk.page_end || 1)),
        ),
        confidence_score: quality.confidenceScore,
        products_extracted: quality.productsExtracted,
        requirements_extracted: quality.requirementsExtracted,
        evidence_count: quality.evidenceCount,
        source_job_id: jobId,
        source_document_id: Number(first.document_id) || null,
        provider_name: "Anthropic",
        ai_request_count: documentChunks.reduce(
          (total, chunk) => total + Number(chunk.ai_request_count || 0),
          0,
        ),
        input_tokens: documentChunks.reduce(
          (total, chunk) => total + Number(chunk.input_tokens || 0),
          0,
        ),
        output_tokens: documentChunks.reduce(
          (total, chunk) => total + Number(chunk.output_tokens || 0),
          0,
        ),
        estimated_cost_usd: Number(
          documentChunks.reduce(
            (total, chunk) => total + Number(chunk.estimated_cost_usd || 0),
            0,
          ).toFixed(6),
        ),
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, {
        onConflict:
          "content_sha256,cache_version,extraction_version,prompt_schema_version,model_name",
      });
    if (error) throw new Error(error.message);
    persisted++;
  }
  return persisted;
}

async function persistEvidence(
  adminClient: AdminClient,
  job: any,
  analysis: NormalizedDocumentAnalysis,
): Promise<number> {
  const { error: deleteError } = await adminClient
    .from("tender_document_evidence")
    .delete()
    .eq("job_id", job.id);
  if (deleteError) throw new Error(deleteError.message);
  const rows: Record<string, unknown>[] = [];
  for (const product of analysis.products) {
    for (const evidence of product.evidence) {
      if (Number(evidence.document_id) <= 0) continue;
      rows.push({
        tender_id: job.tender_id,
        document_id: evidence.document_id,
        job_id: job.id,
        evidence_type: "product_field",
        product_name: product.product_name,
        field_name: evidence.field_name,
        extracted_value: evidence.extracted_value,
        normalized_value: evidence.normalized_value,
        requirement_status: evidence.requirement_status,
        source_language: evidence.source_language,
        extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
        quantity_value: evidence.field_name === "quantity"
          ? product.quantity_value
          : null,
        quantity_unit: evidence.field_name === "quantity"
          ? product.quantity_unit
          : null,
        lot_number: product.lot_number,
        page_number: evidence.page_number,
        sheet_name: evidence.sheet_name,
        cell_range: evidence.cell_range,
        source_quote: evidence.source_quote,
        confidence_score: evidence.confidence_score,
      });
    }
  }
  if (rows.length) {
    const { error } = await adminClient
      .from("tender_document_evidence")
      .insert(rows);
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

async function refreshRequestingCompanyMatch(
  adminClient: AdminClient,
  job: any,
  pipelineRun: PipelineRunHandle,
): Promise<string[]> {
  const companyId = Number(job.company_id);
  if (!Number.isInteger(companyId)) return [];
  const stage = await startPipelineStage(adminClient, {
    traceId: pipelineRun.traceId,
    stageName: "explanation_generation",
    pipelineVersion: PIPELINE_VERSIONS.explanation,
    tenderId: Number(job.tender_id),
    companyId,
    source: "targeted_match_refresh",
  });
  const explanation = await adminClient.rpc(
    "refresh_explainable_tender_match",
    {
      p_company_id: companyId,
      p_tender_id: Number(job.tender_id),
      p_trace_id: pipelineRun.traceId,
    },
  );
  const scoring = await adminClient.rpc("refresh_opportunity_match_score_v2", {
    p_company_id: companyId,
    p_tender_id: Number(job.tender_id),
    p_trace_id: pipelineRun.traceId,
  });
  const errors = [explanation.error, scoring.error]
    .filter(Boolean)
    .map((error) => sanitizeMessage(error?.message));
  await finishPipelineStage(
    adminClient,
    stage,
    errors.length ? "partial" : "completed",
    {
      error: errors[0],
      metadata: {
        company_scope: "requesting_company_only",
        explanation_refreshed: !explanation.error,
        score_v2_refreshed: !scoring.error,
      },
    },
  );
  return errors;
}

async function processJob(
  adminClient: AdminClient,
  anthropicKey: string,
  jobId: number,
  pipelineRun: PipelineRunHandle,
  invocationStartedMs: number,
): Promise<void> {
  const config = readDocumentIntelligenceV31Config();
  const invocationDeadlineMs = invocationStartedMs +
    config.invocationTimeBudgetMs;
  const configSnapshot = publicV31ConfigSnapshot(config);
  const budgetState = createExecutionBudgetState();
  const timings: BenchmarkTimings = {
    inspectionMs: 0,
    chunkGenerationMs: 0,
    aiMs: 0,
    mergeMs: 0,
    databaseMs: 0,
    networkMs: 0,
  };
  const processStartedMs = Date.now();
  const { data: job, error: jobError } = await adminClient
    .from("tender_document_analysis_jobs")
    .select(
      "id,tender_id,company_id,selected_document_ids,status,attempt_count,resume_count",
    )
    .eq("id", jobId)
    .single();
  if (jobError || !job) throw new Error("Analysis job not found");
  // Atomic claim: only one worker may run a job. A 'processing' job is
  // reclaimable once its updated_at is older than the worker's maximum
  // possible lifetime (the ~150s WallClockTime kill measured on prod).
  const { data: claimedJob, error: claimJobError } = await adminClient.rpc(
    "claim_tender_document_analysis_job_v3",
    { p_job_id: jobId, p_stale_seconds: 150 },
  );
  if (claimJobError) throw new Error(claimJobError.message);
  if (!claimedJob?.id) {
    console.log(
      `Analysis job ${jobId} is already owned by a live worker; skipping.`,
    );
    return;
  }
  // Chunk leases orphaned by a killed worker must become claimable,
  // otherwise a resumed job silently skips them forever.
  await adminClient
    .from("tender_document_analysis_chunks")
    .update({
      status: "queued",
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("status", "processing")
    .lt("lease_expires_at", new Date().toISOString());
  const { data: priorUsage, error: priorUsageError } = await adminClient
    .from("tender_document_analysis_chunks")
    .select(
      "source_document_key,ai_request_count,input_tokens,output_tokens,estimated_cost_usd",
    )
    .eq("job_id", jobId);
  if (priorUsageError) throw new Error(priorUsageError.message);
  for (const usage of priorUsage || []) {
    budgetState.aiRequests += Number(usage.ai_request_count || 0);
    budgetState.inputTokens += Number(usage.input_tokens || 0);
    budgetState.outputTokens += Number(usage.output_tokens || 0);
    const cost = Number(usage.estimated_cost_usd || 0);
    budgetState.estimatedCostUsd = Number(
      (budgetState.estimatedCostUsd + cost).toFixed(6),
    );
    const sourceKey = String(usage.source_document_key || "");
    budgetState.costByDocument[sourceKey] = Number(
      (Number(budgetState.costByDocument[sourceKey] || 0) + cost).toFixed(6),
    );
  }
  const { data: existingTender } = await adminClient
    .from("tenders")
    .select(
      "document_analysis_status,document_confidence_score,last_document_analysis_at,ai_extraction_version",
    )
    .eq("id", job.tender_id)
    .single();
  const model = Deno.env.get("DOC_ENGINE_MODEL") ||
    Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
  await adminClient.from("tender_document_analysis_jobs").update({
    status: "processing",
    updated_at: new Date().toISOString(),
    model_name: model,
    trace_id: pipelineRun.traceId,
    extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
    prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
    provider_name: "Anthropic",
    benchmark_mode: config.benchmarkMode,
    progress_stage: "downloading_attachments",
    progress_percent: 5,
    estimated_remaining_seconds: null,
    early_completion_reason: null,
    termination_reason: null,
    error_code: null,
    error_message: null,
  }).eq("id", jobId);
  await adminClient.from("tenders").update({
    document_analysis_status: "processing",
    document_parser_version: DOCUMENT_CHUNKING_VERSION,
    document_analysis_trace_id: pipelineRun.traceId,
    updated_at: new Date().toISOString(),
  }).eq("id", job.tender_id).in("document_analysis_status", [
    "not_started",
    "queued",
    "processing",
    "failed",
  ]);
  await updateProgress(
    adminClient,
    job,
    "downloading_attachments",
    processStartedMs,
    { document_limit: config.maxDocuments },
  );

  const selectedIds = (job.selected_document_ids || [])
    .map(Number)
    .filter(Number.isInteger)
    .slice(0, config.maxDocuments);
  let documents: TenderDocumentRecord[] = [];
  if (selectedIds.length) {
    const { data, error } = await adminClient.from("tender_documents")
      .select(
        "id,title,file_name,file_url,mime_type,document_type,language_code,source_confidence",
      )
      .in("id", selectedIds)
      .eq("tender_id", job.tender_id)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    documents = ((data || []) as TenderDocumentRecord[]).filter((document) =>
      SUPPORTED_MIME_TYPES.has(
        String(document.mime_type || "").toLowerCase(),
      ) &&
      isSafeHttpsUrl(String(document.file_url || ""))
    );
  }
  const noticeOnly = documents.length === 0;
  if (noticeOnly) {
    documents = await fallbackDocuments(adminClient, Number(job.tender_id));
  }
  documents = documents.slice(0, config.maxDocuments);
  const inputSnapshotHash = await stableVersionHash({
    documents: documents.map((document) => ({
      source_key: sourceDocumentKey(document),
      mime_type: document.mime_type,
      inline_text_hash_source: document.__inline_text || null,
    })),
    config: configSnapshot,
    inspection_version: DOCUMENT_INSPECTION_VERSION,
    chunking_version: DOCUMENT_CHUNKING_VERSION,
    extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
  });
  await adminClient.from("tender_document_analysis_jobs").update({
    input_snapshot_hash: inputSnapshotHash,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  const retrievalStage = await startPipelineStage(adminClient, {
    traceId: pipelineRun.traceId,
    stageName: "document_retrieval",
    pipelineVersion: PIPELINE_VERSIONS.documentRetrievalV2,
    tenderId: Number(job.tender_id),
    companyId: Number(job.company_id) || null,
    source: noticeOnly
      ? "official_ted_fallback"
      : "registered_tender_documents",
    metadata: { document_count: documents.length, notice_only: noticeOnly },
  });
  const inspectionStage = await startPipelineStage(adminClient, {
    traceId: pipelineRun.traceId,
    stageName: "document_inspection",
    pipelineVersion: DOCUMENT_CHUNKING_VERSION,
    tenderId: Number(job.tender_id),
    companyId: Number(job.company_id) || null,
    source: "document-intelligence-v3",
    metadata: configSnapshot,
  });
  await updateProgress(
    adminClient,
    job,
    "inspecting_document",
    processStartedMs,
  );
  const work: ChunkWork[] = [];
  let totalPages = 0;
  let selectedPages = 0;
  let inspectionsReused = 0;
  let documentsFailed = 0;
  let chunksReused = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let documentsCached = 0;
  const pageCountByDocument = new Map<string, number>();
  let remainingAiPages = config.maxTotalAiPages;
  let remainingChunkExecutions = config.maxChunksPerRun;
  const documentErrors: string[] = [];
  const currentChunkIds: number[] = [];
  let timeBudgetExhausted = false;
  let documentPhaseComplete = true;
  let fallbackPdfHandled = false;
  let retriableDocumentFailure = false;

  for (
    let documentIndex = 0;
    documentIndex < documents.length;
    documentIndex++
  ) {
    if (invocationDeadlineMs - Date.now() < 35_000) {
      timeBudgetExhausted = true;
      documentPhaseComplete = false;
      break;
    }
    const document = documents[documentIndex];
    if (noticeOnly && document.__inline_text && fallbackPdfHandled) {
      // The inline notice text duplicates the official notice PDF that
      // was just processed. Extracting it costs one giant AI call whose
      // output regularly exceeds the worker wall clock (measured
      // "Signal timed out." on every stuck production job), so it is
      // only used when the notice PDF itself is unavailable.
      continue;
    }
    const sourceKey = sourceDocumentKey(document);
    const documentId = Number(document.id) > 0 ? Number(document.id) : null;
    const configuredMime = String(document.mime_type || "").toLowerCase();
    try {
      const downloadStartedAt = performance.now();
      const downloaded = document.__inline_text
        ? {
          bytes: new TextEncoder().encode(document.__inline_text),
          mimeType: "text/plain",
          resolvedUrl: String(document.file_url || ""),
          redirectCount: 0,
        }
        : await downloadDocument(String(document.file_url || ""), config);
      timings.networkMs += Math.max(
        0,
        Math.round(performance.now() - downloadStartedAt),
      );
      const mimeType = SUPPORTED_MIME_TYPES.has(configuredMime)
        ? configuredMime
        : downloaded.mimeType;
      const contentHash = await sha256Bytes(downloaded.bytes);
      await recordDocumentAccessAttempt(adminClient, {
        traceId: pipelineRun.traceId,
        stageId: retrievalStage.stageId,
        tenderId: Number(job.tender_id),
        companyId: Number(job.company_id) || null,
        documentId,
        url: String(document.file_url || ""),
        sourceType: noticeOnly
          ? "official_ted_fallback"
          : "registered_tender_document",
        sourceConfidence: noticeOnly
          ? "official_verified"
          : document.source_confidence || "unknown",
        classification: document.__inline_text ? { parsed: true } : {
          downloaded: true,
          contentType: mimeType,
          contentLength: downloaded.bytes.byteLength,
          redirectCount: downloaded.redirectCount,
          url: downloaded.resolvedUrl,
          isDirectFile: true,
        },
        metadata: { mime_type: mimeType },
      });
      const cached = await findCachedDocumentExtraction(
        adminClient,
        contentHash,
        model,
      );
      if (cached?.normalized_result) {
        cacheHits++;
        documentsCached++;
        const cachedPageCount = Math.max(1, Number(cached.page_count || 1));
        const cachedAnalysis = rebindAnalysisDocumentId(
          cached.normalized_result as NormalizedDocumentAnalysis,
          documentId || 0,
        );
        const cacheInputHash = await stableVersionHash({
          content_sha256: contentHash,
          cache_version: DOCUMENT_CACHE_VERSION_V31,
          extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
          prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
          model,
        });
        const cacheRow = await upsertChunk(adminClient, {
          job_id: jobId,
          inspection_id: null,
          tender_id: job.tender_id,
          document_id: documentId,
          source_document_key: sourceKey,
          content_sha256: contentHash,
          chunk_index: 0,
          page_start: 1,
          page_end: cachedPageCount,
          page_numbers: [],
          priority_score: 999,
          selection_reasons: ["document_hash_cache_hit"],
          input_hash: cacheInputHash,
          model_name: model,
          extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
          prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
          status: "completed",
          normalized_result: cachedAnalysis,
          confidence_score: cachedAnalysis.document_confidence_score,
          provider_name: cached.provider_name || "Anthropic",
          provider_usage: {
            document_cache_hit: true,
            source_cache_id: cached.id,
          },
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
          cache_key: cacheInputHash,
          cache_hit: true,
          processing_order: 0,
          ai_request_count: 0,
          provider_duration_ms: 0,
          reused_from_chunk_id: null,
          ignored_reason: null,
          error_code: null,
          error_message: null,
          lease_expires_at: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        currentChunkIds.push(Number(cacheRow.id));
        totalPages += cachedPageCount;
        selectedPages += cachedPageCount;
        remainingAiPages = Math.max(
          0,
          remainingAiPages - cachedPageCount,
        );
        if (documentId) {
          await adminClient.from("tender_documents").update({
            content_sha256: contentHash,
            page_count: cachedPageCount,
            inspection_status: "completed",
            inspection_version: DOCUMENT_INSPECTION_VERSION,
            last_inspected_at: new Date().toISOString(),
            access_status: "parsed",
            access_checked_at: new Date().toISOString(),
            retrieval_version: PIPELINE_VERSIONS.documentRetrievalV2,
            parser_version: DOCUMENT_CHUNKING_VERSION,
            pipeline_trace_id: pipelineRun.traceId,
            updated_at: new Date().toISOString(),
          }).eq("id", documentId);
        }
        if (noticeOnly && Number(document.id) === -1) {
          fallbackPdfHandled = true;
        }
        continue;
      }
      cacheMisses++;
      if (mimeType === "application/pdf") {
        const inspectionStartedAt = performance.now();
        const inspectionRecord = await findOrCreateInspection(
          adminClient,
          Number(job.tender_id),
          document,
          sourceKey,
          contentHash,
          downloaded.bytes,
          config,
        );
        timings.inspectionMs += Math.max(
          0,
          Math.round(performance.now() - inspectionStartedAt),
        );
        if (inspectionRecord.reused) inspectionsReused++;
        const inspection = inspectionRecord.inspection;
        pageCountByDocument.set(sourceKey, inspection.pageCount);
        totalPages += inspection.pageCount;
        if (documentId) {
          await adminClient.from("tender_documents").update({
            content_sha256: contentHash,
            page_count: inspection.pageCount,
            inspection_status: inspection.inspectionPartial
              ? "partial"
              : "completed",
            inspection_version: DOCUMENT_INSPECTION_VERSION,
            last_inspected_at: new Date().toISOString(),
            access_status: "parsed",
            access_checked_at: new Date().toISOString(),
            retrieval_version: PIPELINE_VERSIONS.documentRetrievalV2,
            parser_version: DOCUMENT_CHUNKING_VERSION,
            pipeline_trace_id: pipelineRun.traceId,
            updated_at: new Date().toISOString(),
          }).eq("id", documentId);
        }
        const documentsRemaining = Math.max(
          1,
          documents.length - documentIndex,
        );
        const budget = Math.max(
          1,
          Math.floor(remainingAiPages / documentsRemaining),
        );
        await updateProgress(
          adminClient,
          job,
          "finding_technical_sections",
          processStartedMs,
          { document_index: documentIndex + 1 },
        );
        const generationStartedAt = performance.now();
        const plans = planPrioritizedAdaptiveChunks(inspection, {
          ...config,
          maxTotalAiPages: Math.min(config.maxTotalAiPages, budget),
        });
        const chunks = await materializePdfChunkPlans(
          downloaded.bytes,
          plans,
          config.maxAiChunkBytes,
        );
        timings.chunkGenerationMs += Math.max(
          0,
          Math.round(performance.now() - generationStartedAt),
        );
        for (const chunk of chunks) {
          const chunkBytesHash = await sha256Bytes(chunk.bytes);
          const inputHash = await stableVersionHash({
            content_sha256: contentHash,
            chunk_bytes_sha256: chunkBytesHash,
            page_numbers: chunk.plan.pageNumbers,
            model,
            extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
            prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
            max_chunk_output_tokens: config.maxChunkOutputTokens,
          });
          const row = await upsertChunk(adminClient, {
            job_id: jobId,
            inspection_id: inspectionRecord.id,
            tender_id: job.tender_id,
            document_id: documentId,
            source_document_key: sourceKey,
            content_sha256: contentHash,
            chunk_index: chunk.plan.chunkIndex,
            page_start: chunk.plan.startPage,
            page_end: chunk.plan.endPage,
            page_numbers: chunk.plan.pageNumbers,
            priority_score: chunk.plan.priorityScore,
            selection_reasons: chunk.plan.reasons,
            processing_order: chunk.plan.processingOrder ??
              chunk.plan.chunkIndex,
            density_score: chunk.plan.densityScore ?? 0,
            estimated_input_tokens: chunk.plan.estimatedInputTokens ?? 0,
            input_hash: inputHash,
            model_name: model,
            extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
            prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
          });
          currentChunkIds.push(Number(row.id));
          const reused = await reuseChunkIfAvailable(
            adminClient,
            jobId,
            row,
          );
          if (reused && row.status !== "completed") chunksReused++;
          if (
            !reused && remainingChunkExecutions > 0 &&
            row.status !== "processing"
          ) {
            work.push({
              chunkId: Number(row.id),
              inspectionId: inspectionRecord.id,
              documentId,
              sourceDocumentKey: sourceKey,
              contentSha256: contentHash,
              chunkIndex: chunk.plan.chunkIndex,
              startPage: chunk.plan.startPage,
              endPage: chunk.plan.endPage,
              pageNumbers: chunk.plan.pageNumbers,
              bytes: chunk.bytes,
              text: null,
              mimeType,
              title: document.file_name || document.title ||
                `Document ${document.id}`,
              inputHash,
              priorityScore: chunk.plan.priorityScore,
              processingOrder: chunk.plan.processingOrder ??
                chunk.plan.chunkIndex,
              densityScore: chunk.plan.densityScore ?? 0,
              estimatedInputTokens: chunk.plan.estimatedInputTokens ?? 0,
            });
            remainingChunkExecutions--;
          }
        }
        const plannedPages = new Set(
          chunks.flatMap((chunk) => chunk.plan.pageNumbers),
        ).size;
        selectedPages += plannedPages;
        remainingAiPages = Math.max(0, remainingAiPages - plannedPages);
      } else {
        const text = document.__inline_text ||
          await documentText(
            downloaded.bytes,
            mimeType,
            config.maxTextCharacters,
          );
        if (documentId) {
          await adminClient.from("tender_documents").update({
            content_sha256: contentHash,
            page_count: 1,
            inspection_status: "completed",
            inspection_version: DOCUMENT_INSPECTION_VERSION,
            last_inspected_at: new Date().toISOString(),
            access_status: "parsed",
            access_checked_at: new Date().toISOString(),
            retrieval_version: PIPELINE_VERSIONS.documentRetrievalV2,
            parser_version: DOCUMENT_CHUNKING_VERSION,
            pipeline_trace_id: pipelineRun.traceId,
            updated_at: new Date().toISOString(),
          }).eq("id", documentId);
        }
        totalPages += 1;
        pageCountByDocument.set(sourceKey, 1);
        selectedPages += 1;
        remainingAiPages = Math.max(0, remainingAiPages - 1);
        const inputHash = await stableVersionHash({
          content_sha256: contentHash,
          text,
          model,
          extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
          prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
          max_chunk_output_tokens: config.maxChunkOutputTokens,
        });
        const row = await upsertChunk(adminClient, {
          job_id: jobId,
          inspection_id: null,
          tender_id: job.tender_id,
          document_id: documentId,
          source_document_key: sourceKey,
          content_sha256: contentHash,
          chunk_index: 0,
          page_start: null,
          page_end: null,
          page_numbers: [],
          priority_score: 1,
          selection_reasons: ["structured_text_document"],
          processing_order: work.length,
          density_score: 0,
          estimated_input_tokens: Math.max(1, Math.round(text.length / 4)),
          input_hash: inputHash,
          model_name: model,
          extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
          prompt_schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION_V3,
        });
        currentChunkIds.push(Number(row.id));
        const reused = await reuseChunkIfAvailable(adminClient, jobId, row);
        if (reused && row.status !== "completed") chunksReused++;
        if (!reused && remainingChunkExecutions > 0) {
          work.push({
            chunkId: Number(row.id),
            inspectionId: null,
            documentId,
            sourceDocumentKey: sourceKey,
            contentSha256: contentHash,
            chunkIndex: 0,
            startPage: 1,
            endPage: 1,
            pageNumbers: [],
            bytes: null,
            text,
            mimeType,
            title: document.file_name || document.title ||
              `Document ${document.id}`,
            inputHash,
            priorityScore: 1,
            processingOrder: work.length,
            densityScore: 0,
            estimatedInputTokens: Math.max(1, Math.round(text.length / 4)),
          });
          remainingChunkExecutions--;
        }
      }
      if (noticeOnly && Number(document.id) === -1) {
        fallbackPdfHandled = true;
      }
    } catch (error) {
      documentsFailed++;
      documentErrors.push(sanitizeMessage(error));
      if ((error as { retriableDownload?: boolean }).retriableDownload) {
        retriableDocumentFailure = true;
      }
      const classification = (error as {
        documentAccessClassification?: Record<string, unknown>;
      }).documentAccessClassification;
      if (classification) {
        await recordDocumentAccessAttempt(adminClient, {
          traceId: pipelineRun.traceId,
          stageId: retrievalStage.stageId,
          tenderId: Number(job.tender_id),
          companyId: Number(job.company_id) || null,
          documentId,
          url: String(document.file_url || ""),
          sourceType: noticeOnly
            ? "official_ted_fallback"
            : "registered_tender_document",
          sourceConfidence: document.source_confidence || "unknown",
          classification: { ...classification, error },
        });
      }
      if (documentId) {
        await adminClient.from("tender_documents").update({
          inspection_status: "failed",
          inspection_version: DOCUMENT_INSPECTION_VERSION,
          last_inspected_at: new Date().toISOString(),
          parser_version: DOCUMENT_CHUNKING_VERSION,
          pipeline_trace_id: pipelineRun.traceId,
          updated_at: new Date().toISOString(),
        }).eq("id", documentId);
      }
    }
  }

  await finishPipelineStage(
    adminClient,
    retrievalStage,
    documentsFailed === documents.length
      ? "failed"
      : documentsFailed
      ? "partial"
      : "completed",
    {
      error: documentErrors[0],
      metadata: {
        document_count: documents.length,
        documents_failed: documentsFailed,
      },
    },
  );
  await finishPipelineStage(
    adminClient,
    inspectionStage,
    documentsFailed === documents.length
      ? "failed"
      : documentsFailed
      ? "partial"
      : "completed",
    {
      error: documentErrors[0],
      metadata: {
        total_pages: totalPages,
        selected_pages: selectedPages,
        ignored_pages: Math.max(0, totalPages - selectedPages),
        inspections_reused: inspectionsReused,
        page_count_rejection: false,
      },
    },
  );
  if (documentPhaseComplete && currentChunkIds.length) {
    // Pending chunks from an earlier attempt that are no longer part of
    // the current plan (the TED fallback text is not byte-stable across
    // attempts, so its input hash changes) would otherwise stay queued
    // forever and permanently block a completed result.
    const { error: supersedeError } = await adminClient
      .from("tender_document_analysis_chunks")
      .update({
        status: "ignored",
        ignored_reason: "SUPERSEDED_BY_NEW_PLAN",
        error_code: "SUPERSEDED_BY_NEW_PLAN",
        error_message:
          "The chunk plan changed on resume; a newer chunk set replaced this chunk.",
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", jobId)
      .in("status", ["queued", "failed", "processing"])
      .not("id", "in", `(${currentChunkIds.join(",")})`);
    if (supersedeError) throw new Error(supersedeError.message);
  }
  if (!work.length && documentPhaseComplete) {
    const { count } = await adminClient
      .from("tender_document_analysis_chunks")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "completed");
    if (!count) throw new Error(documentErrors[0] || "No analyzable chunks");
  }

  const extractionStage = await startPipelineStage(adminClient, {
    traceId: pipelineRun.traceId,
    stageName: "chunk_ai_extraction",
    pipelineVersion: DOCUMENT_EXTRACTION_VERSION_V3,
    tenderId: Number(job.tender_id),
    companyId: Number(job.company_id) || null,
    source: "Anthropic Messages API",
    metadata: {
      chunks_scheduled: work.length,
      max_parallel_chunks: config.maxParallelChunks,
    },
  });
  await updateProgress(
    adminClient,
    job,
    "reading_specifications",
    processStartedMs,
    { chunks_scheduled: work.length },
  );
  const orderedWork = [...work].sort((left, right) =>
    left.processingOrder - right.processingOrder ||
    right.priorityScore - left.priorityScore ||
    left.startPage - right.startPage
  );
  const results: ChunkExecutionResult[] = [];
  let earlyState = {
    previousFactFingerprint: null as string | null,
    stableWaves: 0,
  };
  let terminationReason: string | null = null;
  for (
    let cursor = 0;
    cursor < orderedWork.length;
    cursor += config.maxParallelChunks
  ) {
    if (invocationDeadlineMs - Date.now() < 30_000) {
      // Stop scheduling waves and hand the rest to the next invocation
      // instead of being killed mid-flight at the worker wall clock.
      timeBudgetExhausted = true;
      break;
    }
    const pendingGuardrail = executionGuardrailReason(
      budgetState,
      orderedWork[cursor].sourceDocumentKey,
      config,
    );
    if (pendingGuardrail) {
      terminationReason = pendingGuardrail;
      break;
    }
    await updateProgress(
      adminClient,
      job,
      "extracting_products",
      processStartedMs,
      {
        chunks_completed_this_run: results.filter((result) =>
          result.status === "completed"
        ).length,
        chunks_scheduled: orderedWork.length,
      },
    );
    const wave = orderedWork.slice(
      cursor,
      cursor + config.maxParallelChunks,
    );
    const aiStartedAt = performance.now();
    const waveResults = await Promise.all(
      wave.map((chunk) =>
        executeChunkWithRetry(
          adminClient,
          anthropicKey,
          model,
          jobId,
          chunk,
          config,
          budgetState,
          invocationDeadlineMs,
        )
      ),
    );
    timings.aiMs += Math.max(0, Math.round(performance.now() - aiStartedAt));
    results.push(...waveResults);
    const waveGuardrail = waveResults.find((result) =>
      result.status === "guardrail"
    )?.guardrailReason;
    if (waveGuardrail) {
      terminationReason = waveGuardrail;
      break;
    }
    const { data: earlyRows, error: earlyError } = await adminClient
      .from("tender_document_analysis_chunks")
      .select(
        "id,page_start,page_end,status,normalized_result",
      )
      .eq("job_id", jobId)
      .eq("extraction_version", DOCUMENT_EXTRACTION_VERSION_V3)
      .eq("status", "completed")
      .order("id");
    if (earlyError) throw new Error(earlyError.message);
    if ((earlyRows || []).length && cursor + wave.length < orderedWork.length) {
      const earlyMerged = mergeChunkAnalyses((earlyRows || []).map(
        (chunk: any) => ({
          chunkId: chunk.id,
          startPage: Number(chunk.page_start || 1),
          endPage: Number(chunk.page_end || chunk.page_start || 1),
          analysis: chunk.normalized_result as NormalizedDocumentAnalysis,
        }),
      ));
      const decision = evaluateEarlyCompletion(
        earlyMerged,
        earlyState,
        config,
      );
      earlyState = decision.state;
      if (decision.complete) {
        terminationReason = decision.reason;
        break;
      }
    }
  }
  if (terminationReason) {
    const executedIds = new Set(
      orderedWork.slice(0, results.length).map((chunk) => chunk.chunkId),
    );
    const ignoredIds = orderedWork
      .filter((chunk) => !executedIds.has(chunk.chunkId))
      .map((chunk) => chunk.chunkId);
    if (ignoredIds.length) {
      const { error } = await adminClient
        .from("tender_document_analysis_chunks")
        .update({
          status: "ignored",
          ignored_reason: terminationReason,
          error_code: terminationReason,
          error_message:
            `Chunk skipped after safe termination: ${terminationReason}`,
          lease_expires_at: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", jobId)
        .in("id", ignoredIds)
        .eq("status", "queued");
      if (error) throw new Error(error.message);
    }
  }
  await finishPipelineStage(
    adminClient,
    extractionStage,
    results.some((result) => result.status === "failed")
      ? "partial"
      : "completed",
    {
      metadata: {
        completed:
          results.filter((result) => result.status === "completed").length,
        failed: results.filter((result) => result.status === "failed").length,
        skipped: results.filter((result) => result.status === "skipped").length,
        termination_reason: terminationReason,
        ai_requests: budgetState.aiRequests,
      },
    },
  );

  const { data: chunkRows, error: chunksError } = await adminClient
    .from("tender_document_analysis_chunks")
    .select(
      "id,input_hash,page_start,page_end,page_numbers,status,normalized_result,reused_from_chunk_id,input_tokens,output_tokens,estimated_cost_usd,source_document_key,content_sha256,document_id,cache_hit,ai_request_count,provider_duration_ms,attempt_count,ignored_reason",
    )
    .eq("job_id", jobId)
    .eq("extraction_version", DOCUMENT_EXTRACTION_VERSION_V3)
    .order("id");
  if (chunksError) throw new Error(chunksError.message);
  const completed = (chunkRows || []).filter((chunk: any) =>
    chunk.status === "completed" && chunk.normalized_result
  );
  const retriablePending = (chunkRows || []).filter((chunk: any) =>
    ["queued", "failed"].includes(chunk.status) &&
    Number(chunk.attempt_count || 0) < config.maxChunkAttempts
  );
  const jobAttemptCount = Number(claimedJob.attempt_count || 1);
  if (
    (retriablePending.length || !documentPhaseComplete ||
      retriableDocumentFailure) && jobAttemptCount < 4
  ) {
    // Time-boxed hand-off: persist progress, requeue the job, and ask
    // for a fresh invocation. The pg_cron sweeper re-dispatches the job
    // if this worker dies before the hand-off lands.
    const continuationReason = timeBudgetExhausted
      ? "TIME_BUDGET_CONTINUATION"
      : "PENDING_CHUNKS_CONTINUATION";
    await updateProgress(
      adminClient,
      job,
      "extracting_products",
      processStartedMs,
      {
        continuation: true,
        continuation_reason: continuationReason,
        pending_chunks: retriablePending.length,
        chunks_completed_so_far: completed.length,
      },
    );
    await adminClient.from("tender_document_analysis_jobs").update({
      status: "queued",
      termination_reason: continuationReason,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    await finishPipelineRun(adminClient, pipelineRun, "partial", {
      metadata: {
        continuation: true,
        continuation_reason: continuationReason,
        pending_chunks: retriablePending.length,
        chunks_completed_so_far: completed.length,
      },
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    if (supabaseUrl && cronSecret) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/tender-document-engine`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
          },
          body: JSON.stringify({ action: "resume", job_id: jobId }),
        });
      } catch (error) {
        console.error(
          "Self-continuation dispatch failed; cron sweeper will retry",
          sanitizeMessage(error),
        );
      }
    }
    return;
  }
  if (!completed.length) {
    throw new Error("No document chunk completed successfully");
  }
  const mergeStage = await startPipelineStage(adminClient, {
    traceId: pipelineRun.traceId,
    stageName: "deterministic_chunk_merge",
    pipelineVersion: DOCUMENT_EXTRACTION_VERSION_V3,
    tenderId: Number(job.tender_id),
    companyId: Number(job.company_id) || null,
    source: "document-intelligence-v3",
  });
  const mergeStartedAt = performance.now();
  const merged = mergeChunkAnalyses(completed.map((chunk: any) => ({
    chunkId: chunk.id,
    startPage: Number(chunk.page_start || 1),
    endPage: Number(chunk.page_end || chunk.page_start || 1),
    analysis: chunk.normalized_result as NormalizedDocumentAnalysis,
  })));
  timings.mergeMs += Math.max(
    0,
    Math.round(performance.now() - mergeStartedAt),
  );
  const incomplete =
    (chunkRows || []).some((chunk: any) =>
      ["queued", "processing", "failed"].includes(chunk.status) ||
      (
        chunk.status === "ignored" &&
        chunk.ignored_reason !== "SUPERSEDED_BY_NEW_PLAN" &&
        terminationReason !== "EARLY_COMPLETION"
      )
    ) ||
    documentsFailed > 0 ||
    Boolean(terminationReason && terminationReason !== "EARLY_COMPLETION");
  const analysis = {
    ...merged,
    analysis_status: incomplete ? "partial" : merged.analysis_status,
    missing_information: incomplete
      ? [
        ...new Set([
          ...merged.missing_information,
          terminationReason
            ? `Analysis stopped safely: ${terminationReason}`
            : "One or more document chunks are pending or failed",
        ]),
      ]
      : merged.missing_information,
  } as typeof merged;
  await finishPipelineStage(adminClient, mergeStage, "completed", {
    metadata: {
      ...analysis.merge_statistics,
      analysis_status: analysis.analysis_status,
      deterministic: true,
    },
  });

  const chunksCompleted = completed.length;
  const chunksFailed =
    (chunkRows || []).filter((chunk: any) => chunk.status === "failed").length;
  const currentReused =
    (chunkRows || []).filter((chunk: any) => chunk.reused_from_chunk_id).length;
  const aiPagesProcessed = completed.reduce(
    (sum: number, chunk: any) =>
      sum +
      (chunk.cache_hit || chunk.reused_from_chunk_id
        ? 0
        : (Array.isArray(chunk.page_numbers) && chunk.page_numbers.length
          ? chunk.page_numbers.length
          : 1)),
    0,
  );
  const chunkEstimatedCost = Number(
    completed.reduce(
      (sum: number, chunk: any) => sum + Number(chunk.estimated_cost_usd || 0),
      0,
    ).toFixed(6),
  );
  const estimatedCost = Math.max(
    chunkEstimatedCost,
    budgetState.estimatedCostUsd,
  );
  const chunkAiRequestCount = completed.reduce(
    (sum: number, chunk: any) => sum + Number(chunk.ai_request_count || 0),
    0,
  );
  const aiRequestCount = Math.max(
    chunkAiRequestCount,
    budgetState.aiRequests,
  );
  const chunkInputTokens = completed.reduce(
    (sum: number, chunk: any) => sum + Number(chunk.input_tokens || 0),
    0,
  );
  const totalInputTokens = Math.max(
    chunkInputTokens,
    budgetState.inputTokens,
  );
  const chunkOutputTokens = completed.reduce(
    (sum: number, chunk: any) => sum + Number(chunk.output_tokens || 0),
    0,
  );
  const totalOutputTokens = Math.max(
    chunkOutputTokens,
    budgetState.outputTokens,
  );
  const providerDurationMs = completed.reduce(
    (sum: number, chunk: any) => sum + Number(chunk.provider_duration_ms || 0),
    0,
  );
  const chunksIgnored =
    (chunkRows || []).filter((chunk: any) => chunk.status === "ignored").length;
  const quality = extractionQualityMetrics(analysis);
  const cacheStartedAt = performance.now();
  const cacheEligible = chunksFailed === 0 &&
    documentsFailed === 0 &&
    (!terminationReason || terminationReason === "EARLY_COMPLETION");
  const cachesPersisted = cacheEligible
    ? await persistDocumentCaches(
      adminClient,
      jobId,
      chunkRows || [],
      model,
      config.cacheTtlSeconds,
      pageCountByDocument,
    )
    : 0;
  timings.databaseMs += Math.max(
    0,
    Math.round(performance.now() - cacheStartedAt),
  );
  const planHash = await stableVersionHash({
    chunk_inputs: (chunkRows || []).map((chunk: any) => chunk.input_hash),
    input_snapshot_hash: inputSnapshotHash,
  });
  const applyResult = shouldApplyExtraction({
    confidenceScore: Number(existingTender?.document_confidence_score || 0),
    extractionVersion: existingTender?.ai_extraction_version || null,
    analyzedAt: existingTender?.last_document_analysis_at || null,
  }, {
    confidenceScore: analysis.document_confidence_score,
    extractionVersion: DOCUMENT_EXTRACTION_VERSION_V3,
  });
  // The job status reflects pipeline completion: every planned chunk
  // was processed and evidence-backed products were extracted. The
  // model's own chunk-local completeness verdict stays available in
  // normalized_result.analysis_status and the confidence scores —
  // gating the job on it made 'completed' unreachable, because the
  // chunk prompt template pre-fills "partial" and any hedged chunk
  // demoted the whole job.
  const finalStatus = !incomplete &&
      analysis.products.length > 0 &&
      quality.evidenceCount > 0
    ? "completed"
    : "partial";
  const totalDurationMs = Math.max(0, Date.now() - processStartedMs);
  const benchmarkResult = {
    total_runtime_ms: totalDurationMs,
    inspection_ms: timings.inspectionMs,
    chunk_generation_ms: timings.chunkGenerationMs,
    ai_ms: providerDurationMs || timings.aiMs,
    merge_ms: timings.mergeMs,
    database_ms: timings.databaseMs,
    network_ms: timings.networkMs,
    configured_parallelism: config.maxParallelChunks,
    chunks_scheduled: work.length,
    chunks_completed: chunksCompleted,
    cache_hits: cacheHits,
    early_completion: terminationReason === "EARLY_COMPLETION",
  };
  await updateProgress(
    adminClient,
    job,
    "matching_supplier",
    processStartedMs,
    { products_extracted: quality.productsExtracted },
  );
  const finalDatabaseStartedAt = performance.now();
  await adminClient.from("tender_document_analysis_jobs").update({
    status: finalStatus,
    normalized_result: analysis,
    v3_merge_result: analysis,
    result_applied: applyResult,
    superseded_by_confidence: !applyResult,
    total_pages: totalPages,
    selected_pages: selectedPages,
    ignored_pages: Math.max(0, totalPages - selectedPages),
    ai_pages_processed: aiPagesProcessed,
    chunks_total: (chunkRows || []).length,
    chunks_completed: chunksCompleted,
    chunks_failed: chunksFailed,
    chunks_ignored: chunksIgnored,
    chunks_reused: Math.max(chunksReused, currentReused),
    estimated_ai_cost_usd: estimatedCost,
    ai_request_count: aiRequestCount,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_tokens: totalInputTokens + totalOutputTokens,
    provider_name: "Anthropic",
    ai_duration_ms: providerDurationMs || timings.aiMs,
    inspection_duration_ms: timings.inspectionMs,
    chunk_generation_duration_ms: timings.chunkGenerationMs,
    merge_duration_ms: timings.mergeMs,
    database_duration_ms: timings.databaseMs,
    network_duration_ms: timings.networkMs,
    early_completion_reason: terminationReason === "EARLY_COMPLETION"
      ? terminationReason
      : null,
    termination_reason: terminationReason,
    benchmark_mode: config.benchmarkMode,
    benchmark_result: config.benchmarkMode ? benchmarkResult : {
      total_runtime_ms: totalDurationMs,
      configured_parallelism: config.maxParallelChunks,
    },
    cache_hit_count: cacheHits,
    cache_miss_count: cacheMisses,
    documents_cached: documentsCached,
    duplicate_facts_removed: analysis.merge_statistics.duplicate_facts_removed,
    conflicts_detected: quality.conflictsDetected,
    products_extracted: quality.productsExtracted,
    requirements_extracted: quality.requirementsExtracted,
    processing_statistics: {
      config: configSnapshot,
      documents_total: documents.length,
      documents_failed: documentsFailed,
      inspections_reused: inspectionsReused,
      chunks_executed_this_run: work.length,
      chunks_pending: Math.max(
        0,
        (chunkRows || []).length -
          chunksCompleted -
          chunksFailed -
          chunksIgnored,
      ),
      ambiguities: analysis.ambiguities.length,
      cache_entries_written: cachesPersisted,
      termination_reason: terminationReason,
      budget: {
        ai_requests: aiRequestCount,
        total_tokens: totalInputTokens + totalOutputTokens,
        estimated_cost_usd: estimatedCost,
      },
      quality,
    },
    v3_plan_hash: planHash,
    duration_ms: totalDurationMs,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
  timings.databaseMs += Math.max(
    0,
    Math.round(performance.now() - finalDatabaseStartedAt),
  );

  let evidenceCount = 0;
  if (applyResult) {
    evidenceCount = await persistEvidence(adminClient, job, analysis);
    const { error } = await adminClient.from("tenders").update({
      document_analysis_status: finalStatus,
      document_confidence_score: analysis.document_confidence_score,
      data_completeness_score: analysis.data_completeness_score,
      analyzed_document_count: documents.length - documentsFailed,
      extracted_products: analysis.products,
      missing_information: analysis.missing_information,
      document_analysis_notes: analysis.summary,
      ai_lots: analysis.lots.slice(0, 30),
      document_extraction_v2: { ...analysis, fit_narrative: null },
      document_extraction_v3: { ...analysis, fit_narrative: null },
      document_evidence_count: evidenceCount,
      document_parser_version: DOCUMENT_CHUNKING_VERSION,
      ai_extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
      document_analysis_trace_id: pipelineRun.traceId,
      last_document_analysis_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.tender_id);
    if (error) throw new Error(error.message);
  }
  await updateProgress(
    adminClient,
    job,
    "calculating_score",
    processStartedMs,
    { result_applied: applyResult },
  );
  const matchErrors = applyResult
    ? await refreshRequestingCompanyMatch(adminClient, job, pipelineRun)
    : [];
  await updateProgress(
    adminClient,
    job,
    "generating_summary",
    processStartedMs,
    { match_refresh_error_count: matchErrors.length },
  );
  await finishPipelineRun(
    adminClient,
    pipelineRun,
    matchErrors.length ? "partial" : "completed",
    {
      metadata: {
        analysis_status: finalStatus,
        result_applied: applyResult,
        total_pages: totalPages,
        selected_pages: selectedPages,
        ai_pages_processed: aiPagesProcessed,
        chunks_completed: chunksCompleted,
        chunks_failed: chunksFailed,
        chunks_reused: Math.max(chunksReused, currentReused),
        estimated_ai_cost_usd: estimatedCost,
        evidence_count: evidenceCount,
        match_refresh_error_count: matchErrors.length,
      },
    },
  );
  await updateProgress(
    adminClient,
    job,
    "complete",
    processStartedMs,
    {
      status: finalStatus,
      termination_reason: terminationReason,
    },
  );
}

function launchJob(
  adminClient: AdminClient,
  anthropicKey: string,
  jobId: number,
  tenderId: number,
  pipelineRun: PipelineRunHandle,
  invocationStartedMs: number,
): void {
  EdgeRuntime.waitUntil(
    processJob(
      adminClient,
      anthropicKey,
      jobId,
      pipelineRun,
      invocationStartedMs,
    ).catch(async (error) => {
      console.error("Tender document analysis failed", sanitizeMessage(error));
      await finishPipelineRun(adminClient, pipelineRun, "failed", { error });
      await adminClient.from("tender_document_analysis_jobs").update({
        status: "failed",
        error_code: "DOCUMENT_INTELLIGENCE_V31_FAILED",
        error_message: sanitizeMessage(error),
        termination_reason: null,
        duration_ms: Math.max(0, Date.now() - pipelineRun.startedMs),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      await adminClient.from("tenders").update({
        document_analysis_status: "failed",
        document_analysis_notes: sanitizeMessage(error),
        document_parser_version: DOCUMENT_CHUNKING_VERSION,
        ai_extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
        document_analysis_trace_id: pipelineRun.traceId,
        updated_at: new Date().toISOString(),
      }).eq("id", tenderId).in("document_analysis_status", [
        "not_started",
        "queued",
        "processing",
        "failed",
      ]);
    }),
  );
}

Deno.serve(async (req: Request) => {
  const invocationStartedMs = Date.now();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return json(req, { error: "Origin not allowed" }, 403);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !anthropicKey) {
    return json(
      req,
      { error: "Claude document engine is not configured." },
      500,
    );
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Internal path: pg_cron sweeper and self-continuation hand-offs
  // authenticate with the shared cron secret instead of a user session.
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const givenCronSecret = req.headers.get("x-cron-secret") || "";
  if (givenCronSecret) {
    if (!cronSecret || givenCronSecret !== cronSecret) {
      return json(req, { error: "Invalid cron secret." }, 401);
    }
    let internalPayload: { action?: string; job_id?: number } = {};
    try {
      internalPayload = await req.json();
    } catch {
      // An empty body means a plain resume sweep.
    }
    if (internalPayload.action !== "resume") {
      return json(req, { error: "Unsupported internal action." }, 400);
    }
    const { data: recovery, error: recoveryError } = await adminClient.rpc(
      "recover_stale_tender_document_analysis_jobs",
      {},
    );
    if (recoveryError) {
      console.error("Stale job recovery failed", recoveryError.message);
    }
    let resumeJobId = Number(internalPayload.job_id) || 0;
    if (!resumeJobId) {
      const { data: queuedJobs, error: queuedError } = await adminClient
        .from("tender_document_analysis_jobs")
        .select("id")
        .eq("status", "queued")
        .lt("updated_at", new Date(Date.now() - 30_000).toISOString())
        .order("updated_at", { ascending: true })
        .limit(1);
      if (queuedError) return json(req, { error: queuedError.message }, 500);
      resumeJobId = Number(queuedJobs?.[0]?.id) || 0;
    }
    if (!resumeJobId) {
      return json(req, { ok: true, resumed: null, recovery: recovery ?? null });
    }
    const { data: resumeJob, error: resumeJobError } = await adminClient
      .from("tender_document_analysis_jobs")
      .select("id,tender_id,status")
      .eq("id", resumeJobId)
      .maybeSingle();
    if (resumeJobError) {
      return json(req, { error: resumeJobError.message }, 500);
    }
    if (!resumeJob?.id || !["queued", "processing"].includes(resumeJob.status)) {
      return json(req, { ok: true, resumed: null, recovery: recovery ?? null });
    }
    const pipelineRun = await startPipelineRun(adminClient, {
      component: "ai_extraction",
      pipelineVersion: DOCUMENT_EXTRACTION_VERSION_V3,
      source: "tender-document-engine",
      metadata: {
        analysis_job_id: Number(resumeJob.id),
        engine_generation: "3.1",
        invocation: "internal_resume",
      },
    });
    launchJob(
      adminClient,
      anthropicKey,
      Number(resumeJob.id),
      Number(resumeJob.tender_id),
      pipelineRun,
      invocationStartedMs,
    );
    return json(req, {
      ok: true,
      resumed: Number(resumeJob.id),
      recovery: recovery ?? null,
    }, 202);
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(req, { error: "Authentication required." }, 401);
  }
  const token = authHeader.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return json(req, { error: "Invalid or expired session." }, 401);
  }
  let payload: QueuePayload;
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }
  const tenderId = Number(payload.tender_id);
  const companyId = Number(payload.company_id);
  if (!Number.isInteger(tenderId) || !Number.isInteger(companyId)) {
    return json(req, {
      error: "Valid tender_id and company_id are required.",
    }, 400);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (payload.action === "status") {
    const { data, error } = await userClient.rpc(
      "get_tender_document_analysis_status",
      { p_tender_id: tenderId, p_company_id: companyId },
    );
    if (error) return json(req, { error: error.message }, 400);
    return json(req, { job: Array.isArray(data) ? data[0] ?? null : data });
  }
  // Recover stale jobs before queueing so a job orphaned by a killed
  // worker is requeued (or finalized) instead of blocking this tender.
  const { error: recoveryError } = await adminClient.rpc(
    "recover_stale_tender_document_analysis_jobs",
    {},
  );
  if (recoveryError) {
    console.error("Stale job recovery failed", recoveryError.message);
  }
  const { data: queued, error: queueError } = await userClient.rpc(
    "queue_tender_document_analysis",
    { p_tender_id: tenderId, p_company_id: companyId },
  );
  if (queueError) return json(req, { error: queueError.message }, 400);
  const job = Array.isArray(queued) ? queued[0] : queued;
  if (!job?.id) {
    return json(req, { error: "Could not create analysis job." }, 500);
  }
  const pipelineRun = await startPipelineRun(adminClient, {
    component: "ai_extraction",
    pipelineVersion: DOCUMENT_EXTRACTION_VERSION_V3,
    source: "tender-document-engine",
    metadata: { analysis_job_id: Number(job.id), engine_generation: "3.1" },
  });
  launchJob(
    adminClient,
    anthropicKey,
    Number(job.id),
    tenderId,
    pipelineRun,
    invocationStartedMs,
  );
  return json(req, {
    ok: true,
    job_id: job.id,
    status: job.status,
    engine: "claude",
    trace_id: pipelineRun.traceId,
    extraction_version: DOCUMENT_EXTRACTION_VERSION_V3,
    message: "Tender document analysis has been queued.",
  }, 202);
});

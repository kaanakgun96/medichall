export const PIPELINE_VERSIONS = {
  tenderIngestion: "ted-sync-v1.5+phase0.1",
  documentDiscovery: "document-discovery-v1+phase0.1",
  documentRetrieval: "document-retrieval-v1+phase0.1",
  documentParsing: "document-parsing-v1+phase0.1",
  aiExtraction: "tender-extraction-prompt-v1+phase0.1",
  documentDiscoveryV2: "document-discovery-v2.0.0",
  documentRetrievalV2: "document-retrieval-v2.0.0",
  documentParsingV2: "document-parsing-v2.0.0",
  aiExtractionV2: "tender-extraction-v2.0.0",
  documentParsingV3: "document-chunking-v3.0.0",
  aiExtractionV3: "tender-extraction-v3.0.0",
  scoringV2: "matching-score-v2.0.0",
  candidateGeneration: "candidate-generation-202607200002",
  scoring: "matching-score-202607200002",
  explanation: "explainable-match-202607100005",
} as const;

export const BENCHMARK_LABELS = [
  "highly_relevant",
  "potentially_relevant",
  "irrelevant",
] as const;

export type BenchmarkLabel = (typeof BENCHMARK_LABELS)[number];

export const DOCUMENT_ACCESS_STATUSES = [
  "no_document_link_found",
  "public_direct_download",
  "public_detail_page",
  "redirect_required",
  "session_required",
  "login_required",
  "membership_required",
  "paid_access_required",
  "captcha_required",
  "terms_acceptance_required",
  "dynamic_javascript_required",
  "access_forbidden",
  "rate_limited",
  "expired_link",
  "broken_link",
  "unsupported_file_type",
  "file_too_large",
  "download_timeout",
  "archive_processing_required",
  "manual_review_required",
  "downloaded",
  "parsed",
  "parsing_failed",
] as const;

export type DocumentAccessStatus = (typeof DOCUMENT_ACCESS_STATUSES)[number];

export type AccessClass =
  | "public"
  | "publicly_accessible_but_unsupported"
  | "restricted"
  | "manual"
  | "technical_failure"
  | "processed";

export const ERROR_CATEGORIES = [
  "network",
  "timeout",
  "redirect",
  "authentication",
  "authorization",
  "captcha",
  "membership",
  "payment",
  "terms_acceptance",
  "dynamic_page",
  "malformed_url",
  "unavailable_resource",
  "unsupported_format",
  "archive_error",
  "parser_error",
  "ocr_needed",
  "ai_provider",
  "ai_response_validation",
  "database",
  "scoring",
  "stale_data",
  "configuration",
  "unknown",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export type DocumentAccessInput = {
  httpStatus?: number | null;
  contentType?: string | null;
  contentLength?: number | null;
  redirectCount?: number | null;
  bodySample?: string | null;
  url?: string | null;
  error?: unknown;
  isDirectFile?: boolean;
  downloaded?: boolean;
  parsed?: boolean;
  parsingFailed?: boolean;
  noLinkFound?: boolean;
  archiveRequired?: boolean;
  unsupportedFileType?: boolean;
  fileTooLarge?: boolean;
};

type TraceMutationResult = PromiseLike<{
  error?: { message?: string } | null;
}>;

type TraceTable = {
  insert: (value: unknown) => TraceMutationResult;
  update: (value: unknown) => {
    eq: (column: string, value: unknown) => TraceMutationResult;
  };
};

type TraceClient = {
  from: (table: string) => unknown;
};

function traceTable(client: TraceClient, table: string): TraceTable {
  return client.from(table) as TraceTable;
}

export type PipelineRunHandle = {
  traceId: string;
  startedAt: string;
  startedMs: number;
  component: string;
  pipelineVersion: string;
  persisted: boolean;
};

export type PipelineStageHandle = {
  stageId: string;
  traceId: string;
  startedAt: string;
  startedMs: number;
  stageName: string;
  pipelineVersion: string;
  persisted: boolean;
};

const SECRET_KEY_PATTERN =
  /(authorization|cookie|password|passwd|secret|token|api[_-]?key|apikey|service[_-]?role|jwt)/i;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{8,}\b/gi;
const TOKEN_PATTERN = /\b(?:github_pat_|ghp_|sk-)[a-z0-9_-]{12,}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function textFromUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sanitizePortalUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function portalDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function sanitizeMessage(value: unknown, maxLength = 1000): string {
  return textFromUnknown(value)
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(TOKEN_PATTERN, "[REDACTED_TOKEN]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(
      /([?&](?:token|key|secret|signature|sig|auth|code)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, maxLength);
}

export function sanitizeMetadata(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (
    value == null || typeof value === "boolean" || typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") return sanitizeMessage(value, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (
      const [key, item] of Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
    ) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeMetadata(item, depth + 1);
    }
    return output;
  }
  return sanitizeMessage(value, 500);
}

export function classifyError(value: unknown): ErrorCategory {
  const message = textFromUnknown(value).toLowerCase();
  if (/captcha|recaptcha|hcaptcha|turnstile/.test(message)) return "captcha";
  if (/membership|member only|subscription/.test(message)) return "membership";
  if (/payment|paid access|paywall|purchase required/.test(message)) {
    return "payment";
  }
  if (/terms (?:must|need to) be accepted|accept .*terms/.test(message)) {
    return "terms_acceptance";
  }
  if (
    /login|sign in|authentication|required session|unauthenticated|401/.test(
      message,
    )
  ) {
    return "authentication";
  }
  if (/forbidden|not authorized|access denied|permission|403/.test(message)) {
    return "authorization";
  }
  if (/timeout|timed out|aborterror/.test(message)) return "timeout";
  if (/redirect|too many redirects/.test(message)) return "redirect";
  if (/javascript required|enable javascript|dynamic page/.test(message)) {
    return "dynamic_page";
  }
  if (/invalid url|malformed url|unsupported protocol/.test(message)) {
    return "malformed_url";
  }
  if (/archive|zip|unzip|compressed|decompress/.test(message)) {
    return "archive_error";
  }
  if (/ocr|scanned image/.test(message)) return "ocr_needed";
  if (/parse|parser|encoding|invalid document/.test(message)) {
    return "parser_error";
  }
  if (/unsupported (?:file|format|mime)|file type/.test(message)) {
    return "unsupported_format";
  }
  if (
    /invalid json|schema validation|ai response|structured output/.test(message)
  ) {
    return "ai_response_validation";
  }
  if (/anthropic|openai|claude|ai provider|model request/.test(message)) {
    return "ai_provider";
  }
  if (
    /database|postgres|postgrest|supabase|relation |constraint |rpc /.test(
      message,
    )
  ) {
    return "database";
  }
  if (/score|scoring|match refresh/.test(message)) return "scoring";
  if (/stale|version mismatch|out of date/.test(message)) return "stale_data";
  if (
    /missing .*config|not configured|environment variable|secret is missing/
      .test(message)
  ) {
    return "configuration";
  }
  if (/fetch failed|network|dns|connection|socket|econn/.test(message)) {
    return "network";
  }
  if (/not found|gone|unavailable|404|410/.test(message)) {
    return "unavailable_resource";
  }
  return "unknown";
}

export function accessClassForStatus(
  status: DocumentAccessStatus,
): AccessClass {
  if (["downloaded", "parsed"].includes(status)) return "processed";
  if (
    [
      "session_required",
      "login_required",
      "membership_required",
      "paid_access_required",
      "captcha_required",
      "terms_acceptance_required",
      "access_forbidden",
    ].includes(status)
  ) return "restricted";
  if (status === "manual_review_required") return "manual";
  if (
    [
      "dynamic_javascript_required",
      "unsupported_file_type",
      "file_too_large",
      "archive_processing_required",
    ].includes(status)
  ) return "publicly_accessible_but_unsupported";
  if (
    ["public_direct_download", "public_detail_page", "redirect_required"]
      .includes(status)
  ) {
    return "public";
  }
  return "technical_failure";
}

export function classifyDocumentAccess(
  input: DocumentAccessInput,
): DocumentAccessStatus {
  if (input.parsed) return "parsed";
  if (input.parsingFailed) return "parsing_failed";
  if (input.downloaded) return "downloaded";
  if (input.noLinkFound) return "no_document_link_found";
  if (input.fileTooLarge) return "file_too_large";
  if (input.unsupportedFileType) return "unsupported_file_type";
  if (input.archiveRequired) return "archive_processing_required";

  const status = Number(input.httpStatus || 0);
  const sample = [
    input.bodySample || "",
    textFromUnknown(input.error),
    input.url || "",
  ].join(" ").toLowerCase();

  if (
    /captcha|recaptcha|hcaptcha|turnstile|verify you are human/.test(sample)
  ) {
    return "captcha_required";
  }
  if (
    /membership|members only|member login|subscription required/.test(sample)
  ) {
    return "membership_required";
  }
  if (
    /paywall|payment required|paid access|purchase access/.test(sample) ||
    status === 402
  ) {
    return "paid_access_required";
  }
  if (
    /accept (?:the )?terms|terms (?:and conditions )?must be accepted/.test(
      sample,
    )
  ) {
    return "terms_acceptance_required";
  }
  if (
    /login required|sign in to|log in to|authentication required/.test(sample)
  ) {
    return "login_required";
  }
  if (/session (?:has )?expired|session required/.test(sample)) {
    return "session_required";
  }
  if (
    /enable javascript|javascript is required|requires javascript/.test(sample)
  ) {
    return "dynamic_javascript_required";
  }
  if (/timeout|timed out|aborterror/.test(sample)) return "download_timeout";
  if (status === 401) return "login_required";
  if (status === 403) return "access_forbidden";
  if (status === 429) return "rate_limited";
  if (status === 410 || /expired link|link expired/.test(sample)) {
    return "expired_link";
  }
  if (status === 404) return "broken_link";
  if (status >= 300 && status < 400) return "redirect_required";
  if (status >= 500 || input.error) return "broken_link";
  if (status >= 200 && status < 300) {
    return input.isDirectFile ? "public_direct_download" : "public_detail_page";
  }
  return input.isDirectFile
    ? "public_direct_download"
    : "manual_review_required";
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map(
        (key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`,
      ).join(",")
    }}`;
  }
  return JSON.stringify(String(value));
}

export async function stableVersionHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isBenchmarkLabel(value: unknown): value is BenchmarkLabel {
  return typeof value === "string" &&
    (BENCHMARK_LABELS as readonly string[]).includes(value);
}

export function canAdjudicateBenchmark(
  annotations: Array<{ annotatorId: string; label: unknown }>,
): boolean {
  const valid = annotations.filter(
    (annotation) =>
      annotation.annotatorId && isBenchmarkLabel(annotation.label),
  );
  return new Set(valid.map((annotation) => annotation.annotatorId)).size >= 2;
}

export function hasStaleVersion(
  recordedVersion: string | null | undefined,
  currentVersion: string,
): boolean {
  return !recordedVersion || recordedVersion !== currentVersion;
}

export function isValidTraceRelationship(
  traceId: string,
  parentTraceId: string | null | undefined,
  knownTraceIds: ReadonlySet<string>,
): boolean {
  return !parentTraceId ||
    (parentTraceId !== traceId && knownTraceIds.has(parentTraceId));
}

async function safeInsert(
  client: TraceClient,
  table: string,
  value: unknown,
): Promise<boolean> {
  try {
    const { error } = await traceTable(client, table).insert(value);
    if (error) {
      console.warn(
        "Observability insert skipped",
        sanitizeMessage(error.message),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("Observability insert skipped", sanitizeMessage(error));
    return false;
  }
}

async function safeUpdate(
  client: TraceClient,
  table: string,
  idColumn: string,
  id: string,
  value: unknown,
): Promise<boolean> {
  try {
    const { error } = await traceTable(client, table).update(value).eq(
      idColumn,
      id,
    );
    if (error) {
      console.warn(
        "Observability update skipped",
        sanitizeMessage(error.message),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("Observability update skipped", sanitizeMessage(error));
    return false;
  }
}

export async function startPipelineRun(
  client: TraceClient,
  input: {
    component: string;
    pipelineVersion: string;
    source?: string | null;
    parentTraceId?: string | null;
    attemptNumber?: number;
    metadata?: unknown;
    traceId?: string;
  },
): Promise<PipelineRunHandle> {
  const traceId = input.traceId || crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const persisted = await safeInsert(client, "pipeline_runs", {
    trace_id: traceId,
    parent_trace_id: input.parentTraceId || null,
    pipeline_component: input.component,
    source: input.source || null,
    status: "running",
    started_at: startedAt,
    pipeline_version: input.pipelineVersion,
    attempt_number: Math.max(1, input.attemptNumber || 1),
    metadata: sanitizeMetadata(input.metadata || {}),
  });
  return {
    traceId,
    startedAt,
    startedMs: Date.now(),
    component: input.component,
    pipelineVersion: input.pipelineVersion,
    persisted,
  };
}

export async function finishPipelineRun(
  client: TraceClient,
  run: PipelineRunHandle,
  status: "completed" | "partial" | "failed",
  input: { error?: unknown; metadata?: unknown } = {},
): Promise<void> {
  if (!run.persisted) return;
  const endedAt = new Date().toISOString();
  await safeUpdate(client, "pipeline_runs", "trace_id", run.traceId, {
    status,
    ended_at: endedAt,
    duration_ms: Math.max(0, Date.now() - run.startedMs),
    error_category: input.error ? classifyError(input.error) : null,
    error_message: input.error ? sanitizeMessage(input.error) : null,
    metadata: sanitizeMetadata(input.metadata || {}),
  });
}

export async function startPipelineStage(
  client: TraceClient,
  input: {
    traceId: string;
    stageName: string;
    pipelineVersion: string;
    parentStageId?: string | null;
    tenderId?: number | null;
    companyId?: number | null;
    documentId?: number | null;
    source?: string | null;
    attemptNumber?: number;
    metadata?: unknown;
  },
): Promise<PipelineStageHandle> {
  const stageId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const persisted = await safeInsert(client, "pipeline_run_stages", {
    id: stageId,
    trace_id: input.traceId,
    parent_stage_id: input.parentStageId || null,
    tender_id: input.tenderId || null,
    company_id: input.companyId || null,
    document_id: input.documentId || null,
    source: input.source || null,
    stage_name: input.stageName,
    status: "running",
    started_at: startedAt,
    pipeline_version: input.pipelineVersion,
    attempt_number: Math.max(1, input.attemptNumber || 1),
    metadata: sanitizeMetadata(input.metadata || {}),
  });
  return {
    stageId,
    traceId: input.traceId,
    startedAt,
    startedMs: Date.now(),
    stageName: input.stageName,
    pipelineVersion: input.pipelineVersion,
    persisted,
  };
}

export async function finishPipelineStage(
  client: TraceClient,
  stage: PipelineStageHandle,
  status:
    | "completed"
    | "partial"
    | "failed"
    | "restricted"
    | "manual_review"
    | "skipped",
  input: { error?: unknown; metadata?: unknown } = {},
): Promise<void> {
  if (!stage.persisted) return;
  await safeUpdate(client, "pipeline_run_stages", "id", stage.stageId, {
    status,
    ended_at: new Date().toISOString(),
    duration_ms: Math.max(0, Date.now() - stage.startedMs),
    error_category: input.error ? classifyError(input.error) : null,
    error_message: input.error ? sanitizeMessage(input.error) : null,
    metadata: sanitizeMetadata(input.metadata || {}),
  });
}

export async function recordDocumentAccessAttempt(
  client: TraceClient,
  input: {
    traceId: string;
    stageId?: string | null;
    tenderId: number;
    companyId?: number | null;
    documentId?: number | null;
    url?: string | null;
    sourceType: string;
    sourceConfidence: string;
    classification: DocumentAccessInput;
    attemptNumber?: number;
    startedAt?: string;
    durationMs?: number | null;
    metadata?: unknown;
  },
): Promise<DocumentAccessStatus> {
  const status = classifyDocumentAccess(input.classification);
  const rawUrl = input.url || input.classification.url || null;
  await safeInsert(client, "document_access_attempts", {
    trace_id: input.traceId,
    stage_id: input.stageId || null,
    tender_id: input.tenderId,
    company_id: input.companyId || null,
    document_id: input.documentId || null,
    portal_url: sanitizePortalUrl(rawUrl),
    portal_domain: portalDomain(rawUrl),
    status,
    access_class: accessClassForStatus(status),
    source_type: input.sourceType,
    source_confidence: input.sourceConfidence,
    http_status: input.classification.httpStatus || null,
    content_type: input.classification.contentType || null,
    content_length_bytes: input.classification.contentLength || null,
    redirect_count: Math.max(0, input.classification.redirectCount || 0),
    attempt_number: Math.max(1, input.attemptNumber || 1),
    error_category: input.classification.error
      ? classifyError(input.classification.error)
      : null,
    error_message: input.classification.error
      ? sanitizeMessage(input.classification.error)
      : null,
    started_at: input.startedAt || new Date().toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: input.durationMs ?? null,
    metadata: sanitizeMetadata(input.metadata || {}),
  });
  return status;
}

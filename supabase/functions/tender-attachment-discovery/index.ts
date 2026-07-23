/// <reference path="../_shared/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  type AttachmentCandidate,
  attachmentFileInfo,
  canonicalAttachmentUrl,
  documentTypeForAttachment,
  extractAttachmentCandidates,
  isHtmlLikeContentType,
  isPathAllowedByRobots,
  normalizePublicUrl,
} from "../_shared/attachment-discovery.ts";
import {
  accessClassForStatus,
  type DocumentAccessInput,
  type DocumentAccessStatus,
  finishPipelineRun,
  finishPipelineStage,
  PIPELINE_VERSIONS,
  recordDocumentAccessAttempt,
  sanitizeMessage,
  startPipelineRun,
  startPipelineStage,
} from "../_shared/matching-observability.ts";

const ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const MAX_PAGES = 8;
const MAX_DEPTH = 2;
const MAX_LINKS = 180;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const MAX_REQUEST_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 12_000;
const CRAWL_TIMEOUT_MS = 45_000;
const USER_AGENT = "MedicHall-Tender-Attachment-Discovery/2.0";

type FetchResult = {
  response: Response;
  sourceUrl: string;
  resolvedUrl: string;
  redirectCount: number;
  attemptCount: number;
};

type PageResult = FetchResult & {
  body: string;
  contentLength: number;
};

type DiscoveredDocumentRow = {
  file_url: string;
  source_url: string;
  resolved_url: string;
  title: string | null;
  file_name: string | null;
  mime_type: string | null;
  document_type: string;
  source_page_url: string;
  discovery_source: string;
  discovery_score: number;
  discovery_confidence: "high" | "medium" | "low";
  last_http_status: number;
  redirect_count: number;
  is_active: boolean;
  updated_at: string;
};

type InspectionResult =
  | {
    kind: "document";
    access: DocumentAccessInput;
    row: DiscoveredDocumentRow;
    attemptCount: number;
  }
  | {
    kind: "page";
    access: DocumentAccessInput;
    candidate: AttachmentCandidate;
    resolvedUrl: string;
    attemptCount: number;
  }
  | {
    kind: "failure";
    access: DocumentAccessInput;
    candidate: AttachmentCandidate;
    attemptCount: number;
  };

function responseHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin)
      ? origin
      : "https://medichall.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(req),
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status >= 500;
}

async function fetchWithRedirects(
  sourceUrl: string,
  init: RequestInit,
): Promise<FetchResult> {
  let current = normalizePublicUrl(sourceUrl);
  if (!current) throw new Error("Invalid or prohibited public URL");
  let redirectCount = 0;
  let attemptCount = 0;

  while (true) {
    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
      attemptCount++;
      try {
        response = await fetch(current.href, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (
          !isRetryableStatus(response.status) ||
          attempt === MAX_REQUEST_ATTEMPTS
        ) {
          break;
        }
      } catch (error) {
        lastError = error;
        if (attempt === MAX_REQUEST_ATTEMPTS) throw error;
      }
      await wait(150 * attempt);
    }
    if (!response) throw lastError || new Error("Public request failed");

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          response,
          sourceUrl,
          resolvedUrl: current.href,
          redirectCount,
          attemptCount,
        };
      }
      if (redirectCount >= MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      const next = normalizePublicUrl(location, current.href);
      if (!next) {
        throw new Error("Redirect target is not a permitted public URL");
      }
      current = next;
      redirectCount++;
      continue;
    }

    return {
      response,
      sourceUrl,
      resolvedUrl: response.url || current.href,
      redirectCount,
      attemptCount,
    };
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<{ bytes: Uint8Array; length: number }> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw new Error("Page exceeds size limit");
  if (!response.body) return { bytes: new Uint8Array(), length: 0 };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error("Page exceeds size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, length };
}

async function fetchPage(sourceUrl: string): Promise<PageResult> {
  const result = await fetchWithRedirects(sourceUrl, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept":
        "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.6",
    },
  });
  const { response } = result;
  const { bytes, length } = await readBoundedBody(response, MAX_HTML_BYTES);
  const body = new TextDecoder().decode(bytes);
  if (!response.ok) {
    const error = new Error(`Page request failed (${response.status})`);
    Object.assign(error, {
      access: {
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: length,
        redirectCount: result.redirectCount,
        bodySample: body.slice(0, 4_000),
        url: result.resolvedUrl,
        error,
        isDirectFile: false,
      },
      attemptCount: result.attemptCount,
    });
    throw error;
  }
  return { ...result, body, contentLength: length };
}

async function fetchRobotsText(sourceUrl: string): Promise<string | null> {
  const source = normalizePublicUrl(sourceUrl);
  if (!source) return null;
  const robotsUrl = new URL("/robots.txt", source.origin);
  try {
    const result = await fetchWithRedirects(robotsUrl.href, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/plain,*/*;q=0.2",
      },
    });
    if (!result.response.ok) return null;
    const { bytes } = await readBoundedBody(
      result.response,
      MAX_ROBOTS_BYTES,
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function inspectCandidate(
  candidate: AttachmentCandidate,
): Promise<InspectionResult> {
  try {
    let result = await fetchWithRedirects(candidate.sourceUrl, {
      method: "HEAD",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
      },
    });
    if ([400, 405, 501].includes(result.response.status)) {
      result = await fetchWithRedirects(candidate.sourceUrl, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "*/*",
          "Range": "bytes=0-2047",
        },
      });
    }

    const { response } = result;
    const contentType = response.headers.get("content-type");
    const contentLength = Number(response.headers.get("content-length") || 0);
    const access: DocumentAccessInput = {
      httpStatus: response.status,
      contentType,
      contentLength,
      redirectCount: result.redirectCount,
      url: result.resolvedUrl,
      isDirectFile: true,
    };
    if (!response.ok && response.status !== 206) {
      return {
        kind: "failure",
        candidate,
        access,
        attemptCount: result.attemptCount,
      };
    }

    const fileInfo = attachmentFileInfo(
      result.resolvedUrl,
      contentType,
      response.headers.get("content-disposition"),
    );
    if (fileInfo.mimeType) {
      return {
        kind: "document",
        access,
        attemptCount: result.attemptCount,
        row: {
          file_url: result.resolvedUrl,
          source_url: candidate.sourceUrl,
          resolved_url: result.resolvedUrl,
          title: candidate.title || fileInfo.fileName,
          file_name: fileInfo.fileName,
          mime_type: fileInfo.mimeType,
          document_type: documentTypeForAttachment(
            candidate.title,
            result.resolvedUrl,
          ),
          source_page_url: candidate.pageUrl,
          discovery_source: candidate.source,
          discovery_score: candidate.priorityScore,
          discovery_confidence: candidate.confidence,
          last_http_status: response.status,
          redirect_count: result.redirectCount,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
      };
    }

    if (isHtmlLikeContentType(contentType)) {
      return {
        kind: "page",
        candidate,
        resolvedUrl: result.resolvedUrl,
        access: { ...access, isDirectFile: false },
        attemptCount: result.attemptCount,
      };
    }
    return {
      kind: "failure",
      candidate,
      access: { ...access, unsupportedFileType: true },
      attemptCount: result.attemptCount,
    };
  } catch (error) {
    return {
      kind: "failure",
      candidate,
      access: {
        error,
        url: candidate.sourceUrl,
        isDirectFile: true,
      },
      attemptCount: Number(
        (error as { attemptCount?: number })?.attemptCount || 1,
      ),
    };
  }
}

async function run(admin: any, jobId: number): Promise<void> {
  const { data: job, error } = await admin
    .from("tender_document_discovery_jobs")
    .select("id,tender_id,company_id,source_url")
    .eq("id", jobId)
    .single();
  if (error || !job) throw new Error("Discovery job not found");

  const pipelineRun = await startPipelineRun(admin, {
    component: "document_discovery",
    pipelineVersion: PIPELINE_VERSIONS.documentDiscoveryV2,
    source: "contracting_authority_portal",
    metadata: {
      discovery_job_id: jobId,
      limits: {
        pages: MAX_PAGES,
        depth: MAX_DEPTH,
        links: MAX_LINKS,
        redirects: MAX_REDIRECTS,
        timeout_ms: CRAWL_TIMEOUT_MS,
      },
    },
  });
  const discoveryStage = await startPipelineStage(admin, {
    traceId: pipelineRun.traceId,
    stageName: "document_link_discovery",
    pipelineVersion: PIPELINE_VERSIONS.documentDiscoveryV2,
    tenderId: Number(job.tender_id),
    companyId: Number(job.company_id) || null,
    source: "contracting_authority_portal",
  });
  const startedAt = Date.now();

  await admin.from("tender_document_discovery_jobs").update({
    status: "processing",
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    trace_id: pipelineRun.traceId,
    pipeline_version: PIPELINE_VERSIONS.documentDiscoveryV2,
  }).eq("id", jobId);

  try {
    const root = normalizePublicUrl(job.source_url);
    if (!root) throw new Error("Tender source URL is invalid or prohibited");

    const initialCandidate: AttachmentCandidate = {
      sourceUrl: root.href,
      pageUrl: root.href,
      title: "Tender source",
      source: "official_metadata",
      depth: 0,
      priorityScore: 45,
      confidence: "medium",
    };
    const queue = [initialCandidate];
    const visitedPages = new Set<string>();
    const examinedLinks = new Set<string>();
    const documents = new Map<string, DiscoveredDocumentRow>();
    const robotsCache = new Map<string, Promise<string | null>>();
    const accessStatuses: DocumentAccessStatus[] = [];
    let examined = 0;
    let restrictedCount = 0;
    let failureCount = 0;
    let maximumDepth = 0;

    if (attachmentFileInfo(root.href).mimeType) {
      const directResult = await inspectCandidate(initialCandidate);
      const directStatus = await recordDocumentAccessAttempt(admin, {
        traceId: pipelineRun.traceId,
        stageId: discoveryStage.stageId,
        tenderId: Number(job.tender_id),
        companyId: Number(job.company_id) || null,
        url: root.href,
        sourceType: "official_direct_source",
        sourceConfidence: "official_unverified",
        classification: directResult.access,
        attemptNumber: directResult.attemptCount,
        metadata: {
          crawl_depth: 0,
          priority_score: initialCandidate.priorityScore,
        },
      });
      accessStatuses.push(directStatus);
      examined++;
      examinedLinks.add(canonicalAttachmentUrl(root.href) || root.href);
      if (directResult.kind === "document") {
        const resolvedKey = canonicalAttachmentUrl(
          directResult.row.resolved_url,
        );
        if (resolvedKey) {
          documents.set(resolvedKey, {
            ...directResult.row,
            access_status: directStatus,
            access_checked_at: new Date().toISOString(),
            access_source: "official_direct_source",
            source_confidence: "official_unverified",
            retrieval_version: PIPELINE_VERSIONS.documentRetrievalV2,
            pipeline_trace_id: pipelineRun.traceId,
          } as DiscoveredDocumentRow);
        }
        queue.length = 0;
      }
    }

    while (
      queue.length &&
      visitedPages.size < MAX_PAGES &&
      Date.now() - startedAt < CRAWL_TIMEOUT_MS
    ) {
      queue.sort((left, right) => right.priorityScore - left.priorityScore);
      const pageCandidate = queue.shift()!;
      const pageKey = canonicalAttachmentUrl(pageCandidate.sourceUrl);
      if (!pageKey || visitedPages.has(pageKey)) continue;
      if (pageCandidate.depth > MAX_DEPTH) continue;
      const pageUrl = normalizePublicUrl(pageCandidate.sourceUrl);
      if (!pageUrl) continue;
      const pageRobots = robotsCache.get(pageUrl.origin) ||
        fetchRobotsText(pageUrl.href);
      robotsCache.set(pageUrl.origin, pageRobots);
      const pageRobotsText = await pageRobots;
      if (
        pageRobotsText &&
        !isPathAllowedByRobots(pageRobotsText, pageUrl.pathname)
      ) {
        await recordDocumentAccessAttempt(admin, {
          traceId: pipelineRun.traceId,
          stageId: discoveryStage.stageId,
          tenderId: Number(job.tender_id),
          companyId: Number(job.company_id) || null,
          url: pageUrl.href,
          sourceType: "contracting_authority_public_page",
          sourceConfidence: "official_unverified",
          classification: {},
          metadata: {
            rejection_reason: "robots_disallowed",
            crawl_depth: pageCandidate.depth,
          },
        });
        failureCount++;
        continue;
      }
      visitedPages.add(pageKey);
      maximumDepth = Math.max(maximumDepth, pageCandidate.depth);

      const pageStarted = Date.now();
      let page: PageResult;
      try {
        page = await fetchPage(pageCandidate.sourceUrl);
        const pageStatus = await recordDocumentAccessAttempt(admin, {
          traceId: pipelineRun.traceId,
          stageId: discoveryStage.stageId,
          tenderId: Number(job.tender_id),
          companyId: Number(job.company_id) || null,
          url: page.resolvedUrl,
          sourceType: "contracting_authority_public_page",
          sourceConfidence: "official_unverified",
          classification: {
            httpStatus: page.response.status,
            contentType: page.response.headers.get("content-type"),
            contentLength: page.contentLength,
            redirectCount: page.redirectCount,
            bodySample: page.body.slice(0, 4_000),
            url: page.resolvedUrl,
            isDirectFile: false,
          },
          attemptNumber: page.attemptCount,
          durationMs: Date.now() - pageStarted,
          metadata: {
            crawl_depth: pageCandidate.depth,
            redirect_count: page.redirectCount,
          },
        });
        accessStatuses.push(pageStatus);
        if (
          accessClassForStatus(pageStatus) === "restricted" ||
          pageStatus === "dynamic_javascript_required"
        ) {
          restrictedCount++;
          continue;
        }
      } catch (pageError) {
        const classification = (
          (pageError as { access?: DocumentAccessInput }).access ||
          {
            error: pageError,
            url: pageCandidate.sourceUrl,
            isDirectFile: false,
          }
        ) satisfies DocumentAccessInput;
        const pageStatus = await recordDocumentAccessAttempt(admin, {
          traceId: pipelineRun.traceId,
          stageId: discoveryStage.stageId,
          tenderId: Number(job.tender_id),
          companyId: Number(job.company_id) || null,
          url: pageCandidate.sourceUrl,
          sourceType: "contracting_authority_public_page",
          sourceConfidence: "official_unverified",
          classification,
          attemptNumber: Number(
            (pageError as { attemptCount?: number })?.attemptCount || 1,
          ),
          durationMs: Date.now() - pageStarted,
          metadata: { crawl_depth: pageCandidate.depth },
        });
        accessStatuses.push(pageStatus);
        if (accessClassForStatus(pageStatus) === "restricted") {
          restrictedCount++;
        } else {
          failureCount++;
        }
        continue;
      }

      const candidates = extractAttachmentCandidates(
        page.body,
        page.resolvedUrl,
        root.href,
        pageCandidate.depth + 1,
        MAX_LINKS - examined,
      );
      for (const candidate of candidates) {
        if (
          examined >= MAX_LINKS ||
          Date.now() - startedAt >= CRAWL_TIMEOUT_MS
        ) {
          break;
        }
        const candidateKey = canonicalAttachmentUrl(candidate.sourceUrl);
        if (!candidateKey || examinedLinks.has(candidateKey)) continue;
        examinedLinks.add(candidateKey);
        examined++;

        const candidateUrl = normalizePublicUrl(candidate.sourceUrl);
        if (!candidateUrl) continue;
        const candidateRobots = robotsCache.get(candidateUrl.origin) ||
          fetchRobotsText(candidateUrl.href);
        robotsCache.set(candidateUrl.origin, candidateRobots);
        const candidateRobotsText = await candidateRobots;
        if (
          candidateRobotsText &&
          !isPathAllowedByRobots(
            candidateRobotsText,
            candidateUrl.pathname,
          )
        ) {
          await recordDocumentAccessAttempt(admin, {
            traceId: pipelineRun.traceId,
            stageId: discoveryStage.stageId,
            tenderId: Number(job.tender_id),
            companyId: Number(job.company_id) || null,
            url: candidateUrl.href,
            sourceType: `contracting_authority_${candidate.source}`,
            sourceConfidence: "official_unverified",
            classification: {},
            metadata: {
              rejection_reason: "robots_disallowed",
              crawl_depth: candidate.depth,
              priority_score: candidate.priorityScore,
            },
          });
          failureCount++;
          continue;
        }

        const linkStarted = Date.now();
        const result = await inspectCandidate(candidate);
        const linkStatus = await recordDocumentAccessAttempt(admin, {
          traceId: pipelineRun.traceId,
          stageId: discoveryStage.stageId,
          tenderId: Number(job.tender_id),
          companyId: Number(job.company_id) || null,
          url: candidate.sourceUrl,
          sourceType: `contracting_authority_${candidate.source}`,
          sourceConfidence: "official_unverified",
          classification: result.access,
          attemptNumber: result.attemptCount,
          durationMs: Date.now() - linkStarted,
          metadata: {
            crawl_depth: candidate.depth,
            priority_score: candidate.priorityScore,
            confidence: candidate.confidence,
            redirect_count: result.access.redirectCount || 0,
          },
        });
        accessStatuses.push(linkStatus);

        if (accessClassForStatus(linkStatus) === "restricted") {
          restrictedCount++;
          continue;
        }
        if (result.kind === "failure") {
          failureCount++;
          continue;
        }
        if (result.kind === "document") {
          const resolvedKey = canonicalAttachmentUrl(result.row.resolved_url);
          if (!resolvedKey) continue;
          const existing = documents.get(resolvedKey);
          if (
            !existing ||
            result.row.discovery_score > existing.discovery_score
          ) {
            documents.set(resolvedKey, {
              ...result.row,
              access_status: linkStatus,
              access_checked_at: new Date().toISOString(),
              access_source: `contracting_authority_${candidate.source}`,
              source_confidence: "official_unverified",
              retrieval_version: PIPELINE_VERSIONS.documentRetrievalV2,
              pipeline_trace_id: pipelineRun.traceId,
            } as DiscoveredDocumentRow);
          }
          continue;
        }

        if (candidate.depth <= MAX_DEPTH) {
          const resolved = normalizePublicUrl(result.resolvedUrl);
          if (!resolved) continue;
          const sameHost = resolved.hostname === root.hostname;
          const useful = candidate.priorityScore >= 45;
          const resolvedKey = canonicalAttachmentUrl(resolved.href);
          if (
            resolvedKey &&
            !visitedPages.has(resolvedKey) &&
            (sameHost || useful)
          ) {
            queue.push({ ...candidate, sourceUrl: resolved.href });
          }
        }
      }
    }

    const rows = [...documents.values()].map((row) => ({
      ...row,
      tender_id: job.tender_id,
    }));
    if (rows.length) {
      const { error: upsertError } = await admin
        .from("tender_documents")
        .upsert(rows, { onConflict: "tender_id,file_url" });
      if (upsertError) throw new Error(upsertError.message);
    } else if (!restrictedCount) {
      await recordDocumentAccessAttempt(admin, {
        traceId: pipelineRun.traceId,
        stageId: discoveryStage.stageId,
        tenderId: Number(job.tender_id),
        companyId: Number(job.company_id) || null,
        url: root.href,
        sourceType: "contracting_authority_public_page",
        sourceConfidence: "official_unverified",
        classification: { noLinkFound: true },
        metadata: {
          pages_scanned: visitedPages.size,
          links_examined: examined,
          failure_count: failureCount,
        },
      });
    }

    const timedOut = Date.now() - startedAt >= CRAWL_TIMEOUT_MS;
    const finalStatus = rows.length
      ? (restrictedCount || failureCount || timedOut ? "partial" : "completed")
      : restrictedCount
      ? "failed"
      : "partial";
    const errorMessage = rows.length
      ? null
      : restrictedCount
      ? "Document access is restricted and requires lawful manual action."
      : timedOut
      ? "Discovery reached its bounded crawl timeout without a supported document."
      : "No supported public document links were found.";
    const summary = {
      pages_scanned: visitedPages.size,
      links_examined: examined,
      documents_found: rows.length,
      restricted_count: restrictedCount,
      failure_count: failureCount,
      maximum_depth: maximumDepth,
      timed_out: timedOut,
      highest_discovery_score: rows.length
        ? Math.max(...rows.map((row) => row.discovery_score))
        : null,
    };

    await admin.from("tender_document_discovery_jobs").update({
      status: finalStatus,
      pages_scanned: visitedPages.size,
      links_examined: examined,
      documents_found: rows.length,
      restricted_count: restrictedCount,
      failure_count: failureCount,
      maximum_depth: maximumDepth,
      duration_ms: Math.max(0, Date.now() - startedAt),
      result_summary: summary,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    await admin.from("tenders").update({
      document_discovery_version: PIPELINE_VERSIONS.documentDiscoveryV2,
      document_discovery_trace_id: pipelineRun.traceId,
      updated_at: new Date().toISOString(),
    }).eq("id", job.tender_id);

    const stageStatus = rows.length
      ? (finalStatus === "completed" ? "completed" : "partial")
      : restrictedCount
      ? "restricted"
      : "partial";
    await finishPipelineStage(admin, discoveryStage, stageStatus, {
      error: errorMessage || undefined,
      metadata: summary,
    });
    await finishPipelineRun(
      admin,
      pipelineRun,
      rows.length
        ? (finalStatus === "completed" ? "completed" : "partial")
        : "partial",
      { error: errorMessage || undefined, metadata: summary },
    );
  } catch (runError) {
    await finishPipelineStage(admin, discoveryStage, "failed", {
      error: runError,
    });
    await finishPipelineRun(admin, pipelineRun, "failed", { error: runError });
    throw runError;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(req) });
  }
  if (req.method !== "POST") {
    return reply(req, { error: "Method not allowed" }, 405);
  }
  const origin = req.headers.get("origin");
  if (origin && !ORIGINS.has(origin)) {
    return reply(req, { error: "Origin not allowed" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return reply(req, { error: "Discovery engine is not configured" }, 500);
  }

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return reply(req, { error: "Authentication required" }, 401);
  }
  const token = authorization.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(
    token,
  );
  if (authError || !user) {
    return reply(req, { error: "Invalid or expired session" }, 401);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return reply(req, { error: "Invalid JSON" }, 400);
  }
  const tenderId = Number(body.tender_id);
  const companyId = Number(body.company_id);
  if (!Number.isInteger(tenderId) || !Number.isInteger(companyId)) {
    return reply(
      req,
      { error: "Valid tender_id and company_id are required" },
      400,
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (body.action === "status") {
    const { data, error } = await userClient.rpc(
      "get_tender_document_discovery_status",
      { p_tender_id: tenderId, p_company_id: companyId },
    );
    if (error) return reply(req, { error: error.message }, 400);
    return reply(req, { job: Array.isArray(data) ? data[0] ?? null : data });
  }

  const { data, error } = await userClient.rpc(
    "queue_tender_document_discovery",
    { p_tender_id: tenderId, p_company_id: companyId },
  );
  if (error) return reply(req, { error: error.message }, 400);
  const job = Array.isArray(data) ? data[0] : data;
  if (!job?.id) {
    return reply(req, { error: "Could not create discovery job" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  EdgeRuntime.waitUntil(
    run(admin, Number(job.id)).catch(async (runError) => {
      await admin.from("tender_document_discovery_jobs").update({
        status: "failed",
        error_message: sanitizeMessage(runError),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }),
  );
  return reply(req, { ok: true, job_id: job.id, status: job.status }, 202);
});

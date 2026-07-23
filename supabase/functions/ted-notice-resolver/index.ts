import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PIPELINE_VERSIONS,
  finishPipelineRun,
  finishPipelineStage,
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

function cors(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://medichall.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}
function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}
function collectUrls(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.match(/https?:\/\/[^\s"'<>\\]+/gi) || []) {
      try {
        const url = new URL(match.replace(/[),.;]+$/, ""));
        output.add(url.href);
      } catch {}
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectUrls(item, output);
    }
  }
  return output;
}
function scoreUrl(urlValue: string): number {
  const u = urlValue.toLowerCase();
  let score = 0;
  if (!u.includes("ted.europa.eu")) score += 30;
  if (/document|procurement|tender|appalto|bandi|gara|vergabe|march|licit/.test(u)) score += 35;
  if (/\.xml($|\?)/.test(u)) score += 10;
  if (/\.pdf|\.zip|\.doc|\.xls/.test(u)) score += 15;
  if (/login|signin|account/.test(u)) score -= 20;
  return score;
}
async function tedSearch(publicationNumber: string) {
  const endpoint = "https://api.ted.europa.eu/v3/notices/search";
  const attempts = [
    {
      query: `publication-number = "${publicationNumber}"`,
      fields: ["publication-number", "notice-title", "buyer-name", "BT-15", "links"],
      limit: 5,
      page: 1,
    },
    {
      query: `notice-id = "${publicationNumber}"`,
      fields: ["publication-number", "notice-title", "buyer-name", "BT-15", "links"],
      limit: 5,
      page: 1,
    },
    {
      query: `publication-number = ${publicationNumber}`,
      limit: 5,
      page: 1,
    },
  ];

  let lastError = "";
  for (const body of attempts) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) {
      try { return JSON.parse(text); } catch { return { raw: text }; }
    }
    lastError = `${response.status}: ${text.slice(0, 500)}`;
  }
  throw new Error(`TED Search API failed: ${lastError}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(req, { error: "Resolver is not configured" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return reply(req, { error: "Authentication required" }, 401);
  }
  const token = authHeader.slice(7).trim();
  const authClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return reply(req, { error: "Invalid session" }, 401);

  const payload = await req.json().catch(() => ({}));
  const tenderId = Number(payload.tender_id);
  const companyId = Number(payload.company_id);
  if (!Number.isInteger(tenderId) || !Number.isInteger(companyId)) {
    return reply(req, { error: "Valid tender_id and company_id are required" }, 400);
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: company } = await userClient
    .from("companies").select("id").eq("id", companyId).eq("owner_id", user.id).maybeSingle();
  if (!company) return reply(req, { error: "Access denied" }, 403);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: tender, error } = await admin
    .from("tenders")
    .select("id,source_notice_id,source_url,procurement_documents_url")
    .eq("id", tenderId).single();
  if (error || !tender) return reply(req, { error: "Tender not found" }, 404);

  const noticeNumber = String(tender.source_notice_id || "").trim();
  if (!noticeNumber) return reply(req, { error: "TED publication number is missing" }, 400);
  const pipelineRun = await startPipelineRun(admin, {
    component: "document_discovery",
    pipelineVersion: PIPELINE_VERSIONS.documentDiscovery,
    source: "TED Search API v3",
    metadata: { resolver: "ted-notice-resolver" },
  });
  const discoveryStage = await startPipelineStage(admin, {
    traceId: pipelineRun.traceId,
    stageName: "document_link_discovery",
    pipelineVersion: PIPELINE_VERSIONS.documentDiscovery,
    tenderId,
    companyId,
    source: "TED Search API v3",
  });

  await admin.from("tenders").update({
    ted_resolution_status: "processing",
    ted_resolution_notes: null,
    document_discovery_version: PIPELINE_VERSIONS.documentDiscovery,
    document_discovery_trace_id: pipelineRun.traceId,
    updated_at: new Date().toISOString(),
  }).eq("id", tenderId);

  try {
    const result = await tedSearch(noticeNumber);
    const urls = [...collectUrls(result)];
    const ranked = urls
      .map((value) => ({ value, score: scoreUrl(value) }))
      .sort((a, b) => b.score - a.score);

    const best = ranked.find((item) =>
      !item.value.includes("ted.europa.eu/en/notice/-/detail/")
    )?.value || null;

    if (!best) {
      await recordDocumentAccessAttempt(admin, {
        traceId: pipelineRun.traceId,
        stageId: discoveryStage.stageId,
        tenderId,
        companyId,
        sourceType: "official_ted_metadata",
        sourceConfidence: "official_verified",
        classification: { noLinkFound: true },
        metadata: { urls_examined: urls.length },
      });
      await admin.from("tenders").update({
        ted_resolution_status: "partial",
        ted_resolved_at: new Date().toISOString(),
        ted_resolution_notes: `TED result found, but no external BT-15/procurement URL was detected. URLs examined: ${urls.length}`,
        updated_at: new Date().toISOString(),
      }).eq("id", tenderId);
      await finishPipelineStage(admin, discoveryStage, "partial", {
        metadata: { urls_examined: urls.length, resolved: false },
      });
      await finishPipelineRun(admin, pipelineRun, "partial", {
        metadata: { urls_examined: urls.length, resolved: false },
      });

      return reply(req, {
        ok: true,
        resolved: false,
        urls_examined: urls.length,
        candidates: ranked.slice(0, 10),
        trace_id: pipelineRun.traceId,
      });
    }

    await recordDocumentAccessAttempt(admin, {
      traceId: pipelineRun.traceId,
      stageId: discoveryStage.stageId,
      tenderId,
      companyId,
      url: best,
      sourceType: "official_ted_metadata",
      sourceConfidence: "official_unverified",
      classification: { url: best, isDirectFile: false },
      metadata: { access_not_yet_verified: true },
    });
    await admin.from("tenders").update({
      procurement_documents_url: best,
      source_url: best,
      ted_resolution_status: "completed",
      ted_resolved_at: new Date().toISOString(),
      ted_resolution_notes: `Resolved automatically from TED notice ${noticeNumber}`,
      raw_payload: result,
      updated_at: new Date().toISOString(),
    }).eq("id", tenderId);
    await finishPipelineStage(admin, discoveryStage, "completed", {
      metadata: { urls_examined: urls.length, resolved: true },
    });
    await finishPipelineRun(admin, pipelineRun, "completed", {
      metadata: { urls_examined: urls.length, resolved: true },
    });

    return reply(req, {
      ok: true,
      resolved: true,
      source_url: best,
      candidates: ranked.slice(0, 10),
      trace_id: pipelineRun.traceId,
    });
  } catch (e) {
    await finishPipelineStage(admin, discoveryStage, "failed", { error: e });
    await finishPipelineRun(admin, pipelineRun, "failed", { error: e });
    await admin.from("tenders").update({
      ted_resolution_status: "failed",
      ted_resolved_at: new Date().toISOString(),
      ted_resolution_notes: sanitizeMessage(e),
      updated_at: new Date().toISOString(),
    }).eq("id", tenderId);
    return reply(req, {
      error: "TED notice resolution failed",
      detail: sanitizeMessage(e),
      trace_id: pipelineRun.traceId,
    }, 502);
  }
});

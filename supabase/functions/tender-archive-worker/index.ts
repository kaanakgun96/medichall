import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";
import * as XLSX from "npm:xlsx@0.18.5";
import mammoth from "npm:mammoth@1.9.0";
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
const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 60;

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
function safeName(value: string) {
  return value.replaceAll("\\", "/").split("/").pop()!
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 160);
}
function invalidPath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  return normalized.startsWith("/") || normalized.includes("../") || normalized.includes("..\\");
}
function extension(name: string) {
  return (name.split(".").pop() || "").toLowerCase();
}
function mimeFor(ext: string) {
  return ({
    pdf: "application/pdf", csv: "text/csv", txt: "text/plain",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  } as Record<string,string>)[ext] || null;
}
function classify(name: string) {
  const x = name.toLowerCase();
  if (/technical|specification|capitolato|cahier|leistungsverzeichnis/.test(x)) return "technical_specification";
  if (/boq|quantity|quantities|computo/.test(x)) return "boq";
  if (/price|pricing|prezzo|preis|financial/.test(x)) return "price_schedule";
  if (/lot|lotti/.test(x)) return "lot_document";
  if (/administrative|disciplinare|declaration|dgue/.test(x)) return "administrative";
  return "other";
}
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function convert(bytes: Uint8Array, name: string) {
  const ext = extension(name);
  if (ext === "pdf" || ext === "csv" || ext === "txt") {
    return [{ bytes, name, mime: mimeFor(ext)! }];
  }
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const outputs: Array<{bytes:Uint8Array,name:string,mime:string}> = [];
    for (const sheetName of workbook.SheetNames.slice(0, 20)) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
      if (!csv.trim()) continue;
      outputs.push({
        bytes: new TextEncoder().encode(`# Source workbook: ${name}\n# Sheet: ${sheetName}\n${csv}`),
        name: `${name.replace(/\.(xlsx?|xls)$/i, "")}__${safeName(sheetName)}.csv`,
        mime: "text/csv",
      });
    }
    return outputs;
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({
      arrayBuffer: Uint8Array.from(bytes).buffer,
    });
    const text = `Source DOCX: ${name}\n\n${result.value || ""}`;
    return text.trim()
      ? [{ bytes: new TextEncoder().encode(text), name: name.replace(/\.docx$/i, ".txt"), mime: "text/plain" }]
      : [];
  }
  return [];
}
async function processJob(admin: any, jobId: number) {
  const { data: job, error } = await admin.from("tender_archive_jobs")
    .select("id,tender_id,archive_document_id,company_id").eq("id", jobId).single();
  if (error || !job) throw new Error("Archive job not found");

  const { data: archive, error: archiveError } = await admin.from("tender_documents")
    .select("id,file_url,file_name,title,source_confidence").eq("id", job.archive_document_id).single();
  if (archiveError || !archive) throw new Error("Archive document not found");
  const pipelineRun = await startPipelineRun(admin, {
    component: "document_parsing",
    pipelineVersion: PIPELINE_VERSIONS.documentParsing,
    source: "registered_tender_archive",
    metadata: { archive_job_id: jobId },
  });
  let downloadStage: Awaited<ReturnType<typeof startPipelineStage>> | null = null;
  let archiveStage: Awaited<ReturnType<typeof startPipelineStage>> | null = null;
  let parsingStage: Awaited<ReturnType<typeof startPipelineStage>> | null = null;

  try {
    await admin.from("tender_archive_jobs").update({
      status: "processing", started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      trace_id: pipelineRun.traceId,
      retrieval_version: PIPELINE_VERSIONS.documentRetrieval,
      parser_version: PIPELINE_VERSIONS.documentParsing,
    }).eq("id", jobId);
    await admin.from("tender_documents").update({
      archive_processing_status: "processing",
      pipeline_trace_id: pipelineRun.traceId,
      retrieval_version: PIPELINE_VERSIONS.documentRetrieval,
      parser_version: PIPELINE_VERSIONS.documentParsing,
      updated_at: new Date().toISOString(),
    }).eq("id", archive.id);

    downloadStage = await startPipelineStage(admin, {
      traceId: pipelineRun.traceId,
      stageName: "document_download",
      pipelineVersion: PIPELINE_VERSIONS.documentRetrieval,
      tenderId: Number(job.tender_id),
      companyId: Number(job.company_id) || null,
      documentId: Number(archive.id),
      source: "registered_tender_archive",
    });
    const downloadStarted = Date.now();
    let response: Response;
    try {
      response = await fetch(archive.file_url, {
        headers: { "User-Agent": "MedicHall-Tender-Archive-Worker/1.0" },
        redirect: "follow",
      });
    } catch (error) {
      const accessStatus = await recordDocumentAccessAttempt(admin, {
        traceId: pipelineRun.traceId,
        stageId: downloadStage.stageId,
        tenderId: Number(job.tender_id),
        companyId: Number(job.company_id) || null,
        documentId: Number(archive.id),
        url: archive.file_url,
        sourceType: "registered_tender_archive",
        sourceConfidence: archive.source_confidence || "unknown",
        classification: { error, url: archive.file_url, isDirectFile: true },
        durationMs: Date.now() - downloadStarted,
      });
      await admin.from("tender_documents").update({
        access_status: accessStatus,
        access_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", archive.id);
      throw error;
    }
    if (!response.ok) {
      const accessStatus = await recordDocumentAccessAttempt(admin, {
        traceId: pipelineRun.traceId,
        stageId: downloadStage.stageId,
        tenderId: Number(job.tender_id),
        companyId: Number(job.company_id) || null,
        documentId: Number(archive.id),
        url: archive.file_url,
        sourceType: "registered_tender_archive",
        sourceConfidence: archive.source_confidence || "unknown",
        classification: {
          httpStatus: response.status,
          contentType: response.headers.get("content-type"),
          url: response.url || archive.file_url,
          isDirectFile: true,
        },
        durationMs: Date.now() - downloadStarted,
      });
      await admin.from("tender_documents").update({
        access_status: accessStatus,
        access_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", archive.id);
      throw new Error(`Archive download failed (${response.status})`);
    }
    const compressed = new Uint8Array(await response.arrayBuffer());
    const fileTooLarge = compressed.byteLength > MAX_ARCHIVE_BYTES;
    const downloadStatus = await recordDocumentAccessAttempt(admin, {
      traceId: pipelineRun.traceId,
      stageId: downloadStage.stageId,
      tenderId: Number(job.tender_id),
      companyId: Number(job.company_id) || null,
      documentId: Number(archive.id),
      url: response.url || archive.file_url,
      sourceType: "registered_tender_archive",
      sourceConfidence: archive.source_confidence || "unknown",
      classification: fileTooLarge
        ? { fileTooLarge: true, contentLength: compressed.byteLength }
        : { downloaded: true, contentLength: compressed.byteLength },
      durationMs: Date.now() - downloadStarted,
    });
    await admin.from("tender_documents").update({
      access_status: downloadStatus,
      access_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", archive.id);
    if (fileTooLarge) throw new Error("ZIP exceeds 30 MB compressed limit");
    await finishPipelineStage(admin, downloadStage, "completed", {
      metadata: { compressed_bytes: compressed.byteLength },
    });
    downloadStage = null;

    archiveStage = await startPipelineStage(admin, {
      traceId: pipelineRun.traceId,
      stageName: "archive_extraction",
      pipelineVersion: PIPELINE_VERSIONS.documentParsing,
      tenderId: Number(job.tender_id),
      companyId: Number(job.company_id) || null,
      documentId: Number(archive.id),
      source: "registered_tender_archive",
    });
    const extracted = unzipSync(compressed);
    const entries = Object.entries(extracted);
    await finishPipelineStage(admin, archiveStage, "completed", {
      metadata: { archive_entry_count: entries.length },
    });
    archiveStage = null;

    parsingStage = await startPipelineStage(admin, {
      traceId: pipelineRun.traceId,
      stageName: "parsing",
      pipelineVersion: PIPELINE_VERSIONS.documentParsing,
      tenderId: Number(job.tender_id),
      companyId: Number(job.company_id) || null,
      documentId: Number(archive.id),
      source: "registered_tender_archive",
    });
    let total = 0, examined = 0, created = 0;
    const skipped: string[] = [];
    for (const [archivePath, bytes] of entries) {
    if (examined >= MAX_FILES) { skipped.push(`${archivePath}: file limit`); continue; }
    examined++;
    if (invalidPath(archivePath) || archivePath.endsWith("/")) {
      skipped.push(`${archivePath}: unsafe/path or directory`); continue;
    }
    total += bytes.byteLength;
    if (total > MAX_EXTRACTED_BYTES) throw new Error("Extracted content exceeds 100 MB limit");

    const name = safeName(archivePath);
    const ext = extension(name);
    if (ext === "zip" || ["exe","dll","js","bat","cmd","com","msi","scr"].includes(ext)) {
      skipped.push(`${archivePath}: unsupported or executable`); continue;
    }

    let outputs;
    try { outputs = await convert(bytes, name); }
    catch (e) { skipped.push(`${archivePath}: conversion failed`); continue; }
    if (!outputs.length) { skipped.push(`${archivePath}: unsupported format`); continue; }

    for (const output of outputs) {
      const hash = await sha256(output.bytes);
      const storagePath = `${job.tender_id}/${archive.id}/${hash.slice(0, 12)}-${safeName(output.name)}`;
      const { error: uploadError } = await admin.storage
        .from("tender-documents")
        .upload(storagePath, output.bytes, {
          contentType: output.mime, upsert: true, cacheControl: "3600",
        });
      if (uploadError) { skipped.push(`${archivePath}: storage upload failed`); continue; }

      const { data: publicUrlData } = admin.storage.from("tender-documents").getPublicUrl(storagePath);
      const publicUrl = publicUrlData.publicUrl;

      const { error: insertError } = await admin.from("tender_documents").upsert({
        tender_id: job.tender_id,
        parent_document_id: archive.id,
        title: output.name,
        file_name: output.name,
        file_url: publicUrl,
        mime_type: output.mime,
        document_type: classify(output.name),
        source_page_url: archive.file_url,
        is_active: true,
        storage_path: storagePath,
        sha256: hash,
        archive_processing_status: "not_applicable",
        extracted_from_archive: true,
        original_archive_path: archivePath,
        access_status: "parsed",
        access_checked_at: new Date().toISOString(),
        access_source: "authorized_archive_extraction",
        source_confidence: archive.source_confidence || "unknown",
        retrieval_version: PIPELINE_VERSIONS.documentRetrieval,
        parser_version: PIPELINE_VERSIONS.documentParsing,
        pipeline_trace_id: pipelineRun.traceId,
        upload_provenance: {
          method: "archive_extraction",
          parent_document_id: archive.id,
          archive_job_id: jobId,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "tender_id,file_url" });
      if (insertError) { skipped.push(`${archivePath}: database insert failed`); continue; }
      created++;
    }
    }

    const status = created ? (skipped.length ? "partial" : "completed") : "failed";
    await admin.from("tender_archive_jobs").update({
      status, files_examined: examined, files_created: created,
      compressed_bytes: compressed.byteLength, extracted_bytes: total,
      skipped_files: skipped, error_message: created ? null : "No supported files were extracted",
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    await admin.from("tender_documents").update({
      archive_processing_status: status, updated_at: new Date().toISOString(),
    }).eq("id", archive.id);
    await finishPipelineStage(
      admin,
      parsingStage,
      status === "completed" ? "completed" : status === "partial" ? "partial" : "failed",
      {
        error: created ? undefined : "No supported files were extracted",
        metadata: {
          files_examined: examined,
          files_created: created,
          skipped_file_count: skipped.length,
          extracted_bytes: total,
        },
      },
    );
    parsingStage = null;
    await finishPipelineRun(
      admin,
      pipelineRun,
      status === "completed" ? "completed" : status === "partial" ? "partial" : "failed",
      {
        error: created ? undefined : "No supported files were extracted",
        metadata: { files_examined: examined, files_created: created },
      },
    );
  } catch (error) {
    if (downloadStage) await finishPipelineStage(admin, downloadStage, "failed", { error });
    if (archiveStage) await finishPipelineStage(admin, archiveStage, "failed", { error });
    if (parsingStage) await finishPipelineStage(admin, parsingStage, "failed", { error });
    await finishPipelineRun(admin, pipelineRun, "failed", { error });
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(req, { error: "Archive worker is not configured" }, 500);

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return reply(req, { error: "Authentication required" }, 401);
  const token = authHeader.slice(7).trim();
  const authClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return reply(req, { error: "Invalid session" }, 401);

  const payload = await req.json().catch(() => ({}));
  const tenderId = Number(payload.tender_id), companyId = Number(payload.company_id);
  if (!Number.isInteger(tenderId) || !Number.isInteger(companyId)) {
    return reply(req, { error: "Valid tender_id and company_id are required" }, 400);
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  if (payload.action === "status") {
    const { data, error } = await userClient.rpc("get_tender_archive_status", {
      p_tender_id: tenderId, p_company_id: companyId,
    });
    if (error) return reply(req, { error: error.message }, 400);
    return reply(req, { status: Array.isArray(data) ? data[0] : data });
  }

  const { data: jobs, error } = await userClient.rpc("queue_tender_archive_jobs", {
    p_tender_id: tenderId, p_company_id: companyId,
  });
  if (error) return reply(req, { error: error.message }, 400);

  const queued = Array.isArray(jobs) ? jobs : (jobs ? [jobs] : []);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  for (const job of queued) {
    EdgeRuntime.waitUntil(processJob(admin, Number(job.id)).catch(async (e) => {
      await admin.from("tender_archive_jobs").update({
        status: "failed", error_message: sanitizeMessage(e),
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }));
  }
  return reply(req, { ok: true, jobs: queued.map((j:any) => j.id), count: queued.length }, 202);
});

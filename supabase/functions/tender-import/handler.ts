/// <reference path="../_shared/edge-runtime.d.ts" />
// deno-lint-ignore-file no-explicit-any no-import-prefix

import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  assertTenderImportFile,
  tenderImportContentSha256,
  tenderImportFileSetFingerprint,
} from "../_shared/tender-import-file-types.ts";
import { sanitizeMessage } from "../_shared/matching-observability.ts";
import {
  partitionTenderImportCleanupPaths,
  redactedTenderImportObjectId,
  validatedTenderImportCleanupPaths,
} from "../_shared/tender-import-cleanup.ts";
import { json } from "../tender-document-engine/cors.ts";

const DISCOVERY_TIMEOUT_MS = 55_000;
const ARCHIVE_TIMEOUT_MS = 75_000;
const POLL_INTERVAL_MS = 1_500;
const SUPPORTED_ANALYSIS_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

type ImportPayload = {
  action?:
    | "start"
    | "retry"
    | "status"
    | "cleanup"
    | "reconcile_orphans";
  import_id?: string;
  company_id?: number;
  storage_paths?: string[];
  dry_run?: boolean;
  older_than_minutes?: number;
};

type ImportRecord = {
  id: string;
  tender_id: number;
  company_id: number;
  source_kind: "files" | "url";
  source_url?: string | null;
  status: string;
  stage: string;
  attempt_count: number;
  source_fingerprint?: string;
  updated_at: string;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

async function updateImport(
  admin: any,
  importId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from("tender_imports").update({
    ...values,
    updated_at: new Date().toISOString(),
  }).eq("id", importId)
    .not("status", "in", "(completed,partial,failed,cancelled)");
  if (error) throw new Error(error.message);
}

function failureCategory(error: unknown): string {
  const message = sanitizeMessage(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) {
    return "timeout";
  }
  if (message.includes("zip") || message.includes("archive")) {
    return "archive_validation";
  }
  if (
    message.includes("document") ||
    message.includes("pdf") ||
    message.includes("docx") ||
    message.includes("xlsx") ||
    message.includes("csv")
  ) {
    return "file_validation";
  }
  if (
    message.includes("network") ||
    message.includes("dns") ||
    message.includes("url") ||
    message.includes("http")
  ) {
    return "network";
  }
  return "processing";
}

async function markImportFailed(
  admin: any,
  importId: string,
  error: unknown,
): Promise<void> {
  const safeReason = sanitizeMessage(error) ||
    "The tender import could not be completed.";
  const { error: failureError } = await admin.rpc(
    "mark_universal_tender_import_failed",
    {
      p_import_id: importId,
      p_stage: "import_failed",
      p_failure_category: failureCategory(error),
      p_safe_reason: safeReason,
      p_retry_eligible: true,
    },
  );
  if (failureError) throw new Error(failureError.message);
}

async function invokeExistingWorker(
  supabaseUrl: string,
  anonKey: string,
  token: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(
    `${supabaseUrl}/functions/v1/${functionName}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "apikey": anonKey,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-client-info": "medichall-universal-tender-import/1.0",
      },
      body: JSON.stringify(body),
    },
  );
  const raw = await response.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const backendMessage = typeof data?.error === "string"
      ? data.error
      : `HTTP ${response.status}`;
    throw new Error(`${functionName} rejected the request: ${backendMessage}`);
  }
  return data;
}

async function validatePrivateUploads(
  admin: any,
  tenderId: number,
  expectedFingerprint: string,
): Promise<number> {
  const { data: documents, error } = await admin
    .from("tender_documents")
    .select("id,file_name,mime_type,storage_bucket,storage_path")
    .eq("tender_id", tenderId)
    .eq("is_active", true)
    .eq("storage_bucket", "tender-imports");
  if (error) throw new Error(error.message);
  if (!documents?.length) {
    throw new Error("No uploaded tender documents were registered");
  }

  let totalBytes = 0;
  const contentHashes: string[] = [];
  const validatedDocuments: Array<{ id: number; mimeType: string }> = [];
  for (const document of documents) {
    const fileName = String(document.file_name || "");
    const storagePath = String(document.storage_path || "");
    if (!storagePath) {
      throw new Error(`Storage path is missing for ${fileName}`);
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from("tender-imports")
      .download(storagePath);
    if (downloadError || !blob) {
      throw new Error(`Could not verify uploaded document ${fileName}`);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const detected = assertTenderImportFile(bytes, fileName);
    totalBytes += bytes.byteLength;
    if (totalBytes > 100 * 1024 * 1024) {
      throw new Error("The import exceeds the 100 MB total limit");
    }
    contentHashes.push(await tenderImportContentSha256(bytes));
    validatedDocuments.push({
      id: Number(document.id),
      mimeType: detected.mimeType,
    });
  }
  const actualFingerprint = await tenderImportFileSetFingerprint(
    contentHashes,
  );
  if (actualFingerprint !== expectedFingerprint) {
    throw new Error(
      "Uploaded document contents do not match the import fingerprint",
    );
  }
  for (const document of validatedDocuments) {
    const { error: updateError } = await admin
      .from("tender_documents")
      .update({
        mime_type: document.mimeType,
        access_status: "validated_private_upload",
        access_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);
    if (updateError) throw new Error(updateError.message);
  }
  return documents.length;
}

async function waitForDiscovery(
  admin: any,
  tenderId: number,
  companyId: number,
): Promise<any> {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from("tender_document_discovery_jobs")
      .select("id,status,documents_found,error_message")
      .eq("tender_id", tenderId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data && ["completed", "partial", "failed"].includes(data.status)) {
      return data;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error("Public tender URL discovery timed out and can be retried");
}

async function waitForArchives(
  admin: any,
  tenderId: number,
  companyId: number,
): Promise<any[]> {
  const deadline = Date.now() + ARCHIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from("tender_archive_jobs")
      .select("id,status,files_created,error_message")
      .eq("tender_id", tenderId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (
      data?.length &&
      !data.some((job: any) => ["queued", "processing"].includes(job.status))
    ) {
      return data;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error("Tender archive extraction timed out and can be retried");
}

async function orchestrateImport(
  admin: any,
  supabaseUrl: string,
  anonKey: string,
  token: string,
  tenderImport: ImportRecord,
): Promise<void> {
  const importId = tenderImport.id;
  const tenderId = Number(tenderImport.tender_id);
  const companyId = Number(tenderImport.company_id);
  try {
    if (tenderImport.source_kind === "files") {
      await updateImport(admin, importId, {
        status: "discovering",
        stage: "validating_uploads",
        progress_percent: 8,
        started_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
      });
      const fileCount = await validatePrivateUploads(
        admin,
        tenderId,
        String(tenderImport.source_fingerprint || ""),
      );
      await updateImport(admin, importId, {
        file_count: fileCount,
        stage: "uploads_validated",
        progress_percent: 15,
      });
    } else {
      const { count, error: documentCountError } = await admin
        .from("tender_documents")
        .select("id", { count: "exact", head: true })
        .eq("tender_id", tenderId)
        .eq("is_active", true);
      if (documentCountError) throw new Error(documentCountError.message);
      if (!count) {
        await updateImport(admin, importId, {
          status: "discovering",
          stage: "discovering_public_documents",
          progress_percent: 12,
          started_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
        });
        await invokeExistingWorker(
          supabaseUrl,
          anonKey,
          token,
          "tender-attachment-discovery",
          { tender_id: tenderId, company_id: companyId },
        );
        const discovery = await waitForDiscovery(admin, tenderId, companyId);
        if (Number(discovery.documents_found || 0) < 1) {
          throw new Error(
            discovery.error_message ||
              "No supported public tender documents were found",
          );
        }
      }
    }

    const { count: archiveCount, error: archiveCountError } = await admin
      .from("tender_documents")
      .select("id", { count: "exact", head: true })
      .eq("tender_id", tenderId)
      .eq("is_active", true)
      .or(
        "mime_type.in.(application/zip,application/x-zip-compressed),file_name.ilike.%.zip",
      );
    if (archiveCountError) throw new Error(archiveCountError.message);

    if (archiveCount) {
      await updateImport(admin, importId, {
        status: "extracting_archive",
        stage: "extracting_archive",
        progress_percent: 30,
      });
      await invokeExistingWorker(
        supabaseUrl,
        anonKey,
        token,
        "tender-archive-worker",
        { tender_id: tenderId, company_id: companyId },
      );
      const archiveJobs = await waitForArchives(admin, tenderId, companyId);
      const filesCreated = archiveJobs.reduce(
        (sum, job) => sum + Number(job.files_created || 0),
        0,
      );
      if (
        filesCreated < 1 &&
        archiveJobs.every((job) => job.status === "failed")
      ) {
        throw new Error(
          archiveJobs.find((job) => job.error_message)?.error_message ||
            "No supported documents were extracted from the ZIP package",
        );
      }
    }

    const { count: supportedCount, error: supportedCountError } = await admin
      .from("tender_documents")
      .select("id", { count: "exact", head: true })
      .eq("tender_id", tenderId)
      .eq("is_active", true)
      .in("mime_type", SUPPORTED_ANALYSIS_MIME_TYPES);
    if (supportedCountError) throw new Error(supportedCountError.message);
    if (!supportedCount) {
      throw new Error("No supported tender documents are ready for analysis");
    }

    await updateImport(admin, importId, {
      status: "analyzing",
      stage: "queueing_document_intelligence",
      progress_percent: 60,
    });
    await invokeExistingWorker(
      supabaseUrl,
      anonKey,
      token,
      "tender-document-engine",
      { tender_id: tenderId, company_id: companyId },
    );
    await updateImport(admin, importId, {
      status: "analyzing",
      stage: "downloading_attachments",
      progress_percent: 65,
    });
  } catch (error) {
    try {
      await markImportFailed(admin, importId, error);
    } catch (failureError) {
      console.error(JSON.stringify({
        event: "tender_import_terminal_state_failure",
        import_id: importId,
        original_error: sanitizeMessage(error),
        state_error: sanitizeMessage(failureError),
      }));
    }
  }
}

export async function handleTenderImportRequest(
  req: Request,
): Promise<Response> {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json(req, {
      error: "Authentication required.",
      code: "AUTHENTICATION_REQUIRED",
    }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(req, {
      error: "Tender import is not configured.",
      code: "IMPORT_NOT_CONFIGURED",
    }, 500);
  }

  const token = authorization.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(
    token,
  );
  if (authError || !user) {
    return json(req, {
      error: "Invalid or expired session.",
      code: "INVALID_SESSION",
    }, 401);
  }

  const payload = await req.json().catch(() => null) as ImportPayload | null;
  const importId = payload?.import_id;
  const companyId = Number(payload?.company_id);
  const action = payload?.action || "start";

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "reconcile_orphans") {
    const olderThanMinutes = Number(payload?.older_than_minutes);
    if (
      !Number.isInteger(olderThanMinutes) ||
      olderThanMinutes < 15 ||
      olderThanMinutes > 129_600
    ) {
      return json(req, {
        error: "Orphan age must be between 15 and 129600 minutes.",
        code: "INVALID_ORPHAN_AGE",
      }, 400);
    }
    const { data: isAdmin, error: adminCheckError } = await userClient.rpc(
      "is_admin",
    );
    if (adminCheckError || isAdmin !== true) {
      return json(req, {
        error: "Administrator access is required.",
        code: "ADMIN_REQUIRED",
      }, 403);
    }
    const { data: candidates, error: candidateError } = await admin.rpc(
      "list_stale_tender_import_orphans",
      { p_older_than: `${olderThanMinutes} minutes` },
    );
    if (candidateError) {
      return json(req, { error: candidateError.message }, 400);
    }
    const rows = Array.isArray(candidates) ? candidates : [];
    const dryRun = payload?.dry_run !== false;
    let removed = 0;
    let failed = 0;
    let refused = 0;
    for (const candidate of rows) {
      const objectName = String(candidate.object_name || "");
      if (!objectName) continue;
      let outcome = "dry_run_candidate";
      if (!dryRun) {
        let removable = true;
        if (candidate.stale_import && validUuid(candidate.import_id)) {
          const { error: markError } = await admin.rpc(
            "mark_universal_tender_import_failed",
            {
              p_import_id: candidate.import_id,
              p_stage: "stale_upload",
              p_failure_category: "stale_upload",
              p_safe_reason:
                "The upload was interrupted before registration completed.",
              p_retry_eligible: true,
            },
          );
          if (markError) {
            failed++;
            removable = false;
            outcome = "import_state_failure";
          }
        }
        if (removable) {
          const { count: activeReferences, error: referenceError } = await admin
            .from("tender_documents")
            .select("id", { count: "exact", head: true })
            .eq("storage_bucket", "tender-imports")
            .eq("storage_path", objectName)
            .eq("is_active", true);
          if (referenceError) {
            failed++;
            removable = false;
            outcome = "reference_check_failure";
          } else if (activeReferences) {
            refused++;
            removable = false;
            outcome = "active_reference_refusal";
          }
        }
        if (removable) {
          const { error: removeError } = await admin.storage
            .from("tender-imports")
            .remove([objectName]);
          if (removeError) {
            failed++;
            outcome = "storage_removal_failure";
          } else {
            removed++;
            outcome = "removed";
          }
        }
      }
      console.log(JSON.stringify({
        event: "tender_import_orphan_reconciliation",
        dry_run: dryRun,
        outcome,
        object_id: await redactedTenderImportObjectId(objectName),
      }));
    }
    return json(req, {
      ok: failed === 0,
      dry_run: dryRun,
      candidate_count: rows.length,
      removed_count: removed,
      failed_count: failed,
      refused_count: refused,
    }, failed ? 207 : 200);
  }

  if (
    !validUuid(importId) ||
    !Number.isInteger(companyId) ||
    !["start", "retry", "status", "cleanup"].includes(action)
  ) {
    return json(req, {
      error: "Valid import_id, company_id, and action are required.",
      code: "INVALID_IMPORT_REQUEST",
    }, 400);
  }

  const { data, error } = await userClient.rpc(
    "get_universal_tender_imports",
    {
      p_company_id: companyId,
      p_import_id: importId,
      p_limit: 1,
    },
  );
  const rows = Array.isArray(data) ? data : [];
  const tenderImport = rows[0] as ImportRecord | undefined;
  if (error || !tenderImport || tenderImport.id !== importId) {
    return json(req, {
      error: "Tender import was not found or is not accessible.",
      code: "IMPORT_NOT_FOUND",
    }, 404);
  }
  if (action === "status") {
    return json(req, { import: tenderImport });
  }
  if (action === "cleanup") {
    let paths: string[];
    try {
      paths = validatedTenderImportCleanupPaths(
        companyId,
        importId,
        payload?.storage_paths,
      );
    } catch {
      return json(req, {
        error: "Cleanup paths are invalid.",
        code: "INVALID_CLEANUP_PATHS",
      }, 400);
    }
    const { data: referenced, error: referenceError } = await admin
      .from("tender_documents")
      .select("storage_path")
      .eq("storage_bucket", "tender-imports")
      .eq("is_active", true)
      .in("storage_path", paths);
    if (referenceError) {
      return json(req, { error: referenceError.message }, 400);
    }
    const referencedPaths = new Set<string>(
      (referenced || []).map((row: any) => String(row.storage_path)),
    );
    const { removable, refused } = partitionTenderImportCleanupPaths(
      paths,
      referencedPaths,
    );
    const { error: removeError } = removable.length
      ? await admin.storage.from("tender-imports").remove(removable)
      : { error: null };
    if (removeError) {
      return json(req, {
        error: "Uploaded object cleanup failed.",
        code: "CLEANUP_FAILED",
        removed_count: 0,
        refused_count: refused.length,
      }, 500);
    }
    return json(req, {
      ok: true,
      removed_count: removable.length,
      refused_count: refused.length,
    });
  }
  if (action === "start" && tenderImport.status === "completed") {
    return json(req, { ok: true, import: tenderImport });
  }
  if (tenderImport.source_kind === "files") {
    const { data: protectedImport, error: protectedImportError } = await admin
      .from("tender_imports")
      .select("source_fingerprint")
      .eq("id", importId)
      .eq("company_id", companyId)
      .single();
    if (protectedImportError || !protectedImport?.source_fingerprint) {
      return json(req, {
        error: "Tender import fingerprint is unavailable.",
        code: "IMPORT_FINGERPRINT_UNAVAILABLE",
      }, 409);
    }
    tenderImport.source_fingerprint = String(
      protectedImport.source_fingerprint,
    );
  }
  if (Number(tenderImport.attempt_count || 0) >= 20) {
    return json(req, {
      error: "This import has reached its retry limit.",
      code: "RETRY_LIMIT_REACHED",
    }, 409);
  }

  if (
    action !== "retry" &&
    ["discovering", "extracting_archive", "analyzing"].includes(
      tenderImport.status,
    )
  ) {
    return json(req, {
      ok: true,
      import: tenderImport,
      message: "Tender import is already processing.",
    }, 202);
  }
  if (
    action === "retry" &&
    ["discovering", "extracting_archive", "analyzing"].includes(
      tenderImport.status,
    ) &&
    Date.parse(tenderImport.updated_at) > Date.now() - 3 * 60_000
  ) {
    return json(req, {
      ok: true,
      import: tenderImport,
      message: "Tender import is still processing.",
    }, 202);
  }

  const claimableStatuses = action === "retry"
    ? [
      "failed",
      "partial",
      "queued",
      "discovering",
      "extracting_archive",
      "analyzing",
    ]
    : ["queued"];
  const { data: claimed, error: claimError } = await admin
    .from("tender_imports")
    .update({
      status: "discovering",
      stage: "orchestration_started",
      progress_percent: 6,
      attempt_count: Number(tenderImport.attempt_count || 0) + 1,
      error_message: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("updated_at", tenderImport.updated_at)
    .in("status", claimableStatuses)
    .select("id")
    .maybeSingle();
  if (claimError) {
    return json(req, { error: claimError.message }, 400);
  }
  if (!claimed?.id) {
    return json(req, {
      ok: true,
      import: tenderImport,
      message: "Tender import is already processing.",
    }, 202);
  }

  EdgeRuntime.waitUntil(orchestrateImport(
    admin,
    supabaseUrl,
    anonKey,
    token,
    {
      ...tenderImport,
      status: "discovering",
      attempt_count: Number(tenderImport.attempt_count || 0) +
        1,
    },
  ));
  return json(req, {
    ok: true,
    import_id: importId,
    tender_id: tenderImport.tender_id,
    status: "discovering",
    message: "Tender import processing has started.",
  }, 202);
}

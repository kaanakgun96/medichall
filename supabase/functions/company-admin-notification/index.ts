import { createClient } from "npm:@supabase/supabase-js@2.110.8";

import {
  type CompanyNotificationJob,
  type CompanyNotificationRepository,
  processCompanyAdminNotifications,
  readCompanyNotificationConfiguration,
} from "../_shared/company-admin-notification.ts";

const JSON_HEADERS = {
  "Access-Control-Allow-Headers": "content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function safeLog(
  level: "info" | "error",
  event: Record<string, unknown>,
): void {
  const write = level === "info" ? console.info : console.error;
  write(JSON.stringify(event));
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const size = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < size; index++) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (request.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !constantTimeEqual(cronSecret, suppliedSecret)) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const configuration = readCompanyNotificationConfiguration((name) =>
    Deno.env.get(name)
  );
  if (!configuration.ok) {
    safeLog("error", {
      event: "company_admin_notification_configuration_error",
      error_code: configuration.code,
    });
    return json(503, {
      ok: false,
      error: "notification_configuration_error",
      error_code: configuration.code,
    });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // The scheduled call does not require a body. Invalid input uses defaults.
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";
  if (!supabaseUrl || !serviceRoleKey) {
    safeLog("error", {
      event: "company_admin_notification_runtime_error",
      error_code: "missing_supabase_runtime_configuration",
    });
    return json(503, { ok: false, error: "runtime_configuration_error" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const repository: CompanyNotificationRepository = {
    async claim(limit) {
      const { data, error } = await admin.rpc(
        "claim_company_admin_notifications",
        { p_limit: limit, p_lease_seconds: 120 },
      );
      if (error) throw new Error("claim_company_admin_notifications_failed");
      return (data ?? []) as CompanyNotificationJob[];
    },
    async markSent(outboxId, providerMessageId) {
      const { data, error } = await admin.rpc(
        "complete_company_admin_notification",
        {
          p_outbox_id: outboxId,
          p_provider_message_id: providerMessageId,
        },
      );
      if (error || data !== true) {
        throw new Error("complete_company_admin_notification_failed");
      }
    },
    async markRetry(outboxId, errorCode, redactedError, retryAfterSeconds) {
      const { data, error } = await admin.rpc(
        "retry_company_admin_notification",
        {
          p_outbox_id: outboxId,
          p_error_code: errorCode,
          p_error_redacted: redactedError,
          p_retry_after_seconds: retryAfterSeconds ?? null,
        },
      );
      if (error || (data !== "retry" && data !== "failed")) {
        throw new Error("retry_company_admin_notification_failed");
      }
    },
  };

  try {
    const result = await processCompanyAdminNotifications(
      configuration.value,
      repository,
      {
        limit: asPositiveInteger(body.limit, 20),
        logger: {
          info: (event) => safeLog("info", event),
          error: (event) => safeLog("error", event),
        },
      },
    );
    return json(200, { ok: result.retrying === 0, ...result });
  } catch {
    safeLog("error", {
      event: "company_admin_notification_runtime_error",
      error_code: "outbox_operation_failed",
    });
    return json(500, { ok: false, error: "outbox_operation_failed" });
  }
});

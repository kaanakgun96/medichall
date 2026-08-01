export const COMPANY_NOTIFICATION_ENV = Object.freeze({
  resendApiKey: "RESEND_API_KEY",
  recipient: "COMPANY_ADMIN_NOTIFICATION_RECIPIENT",
  sender: "COMPANY_ADMIN_NOTIFICATION_FROM",
  defaultSender: "MedicHall <notifications@medichall.com>",
});

export type CompanyNotificationConfiguration = {
  resendApiKey: string;
  recipient: string;
  sender: string;
};

export type CompanyNotificationConfigurationResult =
  | { ok: true; value: CompanyNotificationConfiguration }
  | {
    ok: false;
    code:
      | "missing_resend_api_key"
      | "missing_admin_recipient"
      | "invalid_admin_recipient"
      | "invalid_sender";
  };

export type CompanyNotificationJob = {
  outbox_id: number | string;
  company_id: number | string;
  company_name: string;
  company_type: string | null;
  company_country: string | null;
  company_created_at: string;
  attempt_count: number;
  idempotency_key: string;
};

export type CompanyNotificationRepository = {
  claim(limit: number): Promise<CompanyNotificationJob[]>;
  markSent(outboxId: number | string, providerMessageId: string): Promise<void>;
  markRetry(
    outboxId: number | string,
    errorCode: string,
    redactedError: string,
    retryAfterSeconds?: number,
  ): Promise<void>;
};

export type CompanyNotificationLogger = {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
};

export type ProcessCompanyNotificationResult = {
  claimed: number;
  sent: number;
  retrying: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class CompanyNotificationDeliveryError extends Error {
  constructor(
    readonly safeCode: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(safeCode);
    this.name = "CompanyNotificationDeliveryError";
  }
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function senderAddress(value: string): string {
  const match = value.match(/<([^>]+)>\s*$/);
  return (match?.[1] ?? value).trim();
}

export function readCompanyNotificationConfiguration(
  getEnv: (name: string) => string | undefined,
): CompanyNotificationConfigurationResult {
  const resendApiKey = getEnv(COMPANY_NOTIFICATION_ENV.resendApiKey)?.trim() ??
    "";
  if (!resendApiKey) {
    return { ok: false, code: "missing_resend_api_key" };
  }

  const recipient = getEnv(COMPANY_NOTIFICATION_ENV.recipient)?.trim() ?? "";
  if (!recipient) {
    return { ok: false, code: "missing_admin_recipient" };
  }
  if (!looksLikeEmail(recipient)) {
    return { ok: false, code: "invalid_admin_recipient" };
  }

  const sender = getEnv(COMPANY_NOTIFICATION_ENV.sender)?.trim() ||
    COMPANY_NOTIFICATION_ENV.defaultSender;
  if (!looksLikeEmail(senderAddress(sender))) {
    return { ok: false, code: "invalid_sender" };
  }

  return {
    ok: true,
    value: { resendApiKey, recipient, sender },
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character] ?? character);
}

function companySummary(job: CompanyNotificationJob): string {
  return [job.company_type, job.company_country]
    .map((value) => value?.trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
}

export function buildCompanyNotificationPayload(
  job: CompanyNotificationJob,
  configuration: CompanyNotificationConfiguration,
): Record<string, unknown> {
  const companyName = escapeHtml(job.company_name);
  const summary = companySummary(job);
  const registeredAt = new Date(job.company_created_at);
  const registeredAtText = Number.isFinite(registeredAt.getTime())
    ? registeredAt.toISOString()
    : "Unavailable";

  return {
    from: configuration.sender,
    to: [configuration.recipient],
    subject: "New company registered on MedicHall",
    html:
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#12313f">
      <h2>New company registration</h2>
      <p><strong>${companyName}</strong> registered on MedicHall.</p>
      ${summary ? `<p>${summary}</p>` : ""}
      <p>Registered at: ${escapeHtml(registeredAtText)}</p>
      <p><a href="https://medichall.com/portal.html">Open the MedicHall portal</a></p>
    </div>`,
    tags: [
      { name: "event", value: "company_registered" },
      { name: "outbox_id", value: String(job.outbox_id) },
    ],
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(21_600, Math.ceil(seconds));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const delta = Math.ceil((timestamp - Date.now()) / 1000);
  return delta > 0 ? Math.min(21_600, delta) : undefined;
}

export async function sendCompanyNotification(
  job: CompanyNotificationJob,
  configuration: CompanyNotificationConfiguration,
  request: FetchLike = fetch,
): Promise<string> {
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${configuration.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": job.idempotency_key,
    },
    body: JSON.stringify(buildCompanyNotificationPayload(job, configuration)),
  });

  if (!response.ok) {
    throw new CompanyNotificationDeliveryError(
      `resend_http_${response.status}`,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new CompanyNotificationDeliveryError("resend_invalid_response");
  }
  const providerMessageId = responseBody && typeof responseBody === "object"
    ? (responseBody as Record<string, unknown>).id
    : undefined;
  if (typeof providerMessageId !== "string" || !providerMessageId.trim()) {
    throw new CompanyNotificationDeliveryError("resend_missing_message_id");
  }
  return providerMessageId.trim();
}

function deliveryFailure(error: unknown): CompanyNotificationDeliveryError {
  if (error instanceof CompanyNotificationDeliveryError) return error;
  return new CompanyNotificationDeliveryError("resend_transport_error");
}

export async function processCompanyAdminNotifications(
  configuration: CompanyNotificationConfiguration,
  repository: CompanyNotificationRepository,
  options: {
    limit?: number;
    request?: FetchLike;
    logger?: CompanyNotificationLogger;
  } = {},
): Promise<ProcessCompanyNotificationResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const jobs = await repository.claim(limit);
  const logger = options.logger ?? {
    info: (event) => console.info(JSON.stringify(event)),
    error: (event) => console.error(JSON.stringify(event)),
  };
  let sent = 0;
  let retrying = 0;

  for (const job of jobs) {
    try {
      const providerMessageId = await sendCompanyNotification(
        job,
        configuration,
        options.request,
      );
      await repository.markSent(job.outbox_id, providerMessageId);
      sent++;
      logger.info({
        event: "company_admin_notification_sent",
        outbox_id: String(job.outbox_id),
        attempt: job.attempt_count,
        provider_message_id: providerMessageId,
      });
    } catch (error) {
      const failure = deliveryFailure(error);
      await repository.markRetry(
        job.outbox_id,
        failure.safeCode,
        failure.safeCode,
        failure.retryAfterSeconds,
      );
      retrying++;
      logger.error({
        event: "company_admin_notification_retry_scheduled",
        outbox_id: String(job.outbox_id),
        attempt: job.attempt_count,
        error_code: failure.safeCode,
      });
    }
  }

  return { claimed: jobs.length, sent, retrying };
}

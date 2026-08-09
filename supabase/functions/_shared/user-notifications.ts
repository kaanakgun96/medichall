export const USER_NOTIFICATION_ENV = Object.freeze({
  resendApiKey: "RESEND_API_KEY",
  sender: "USER_NOTIFICATION_FROM",
  fallbackSender: "COMPANY_ADMIN_NOTIFICATION_FROM",
  defaultSender: "MedicHall <notifications@medichall.com>",
});

export type UserNotificationConfiguration = {
  resendApiKey: string;
  sender: string;
};

export type UserNotificationConfigurationResult =
  | { ok: true; value: UserNotificationConfiguration }
  | { ok: false; code: "missing_resend_api_key" | "invalid_sender" };

export type UserNotificationJob = {
  outbox_id: number | string;
  recipient_user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  idempotency_key: string;
};

export type UserNotificationRepository = {
  claim(limit: number): Promise<UserNotificationJob[]>;
  resolveRecipient(userId: string): Promise<string | null>;
  markSent(outboxId: number | string, providerMessageId: string): Promise<void>;
  markRetry(
    outboxId: number | string,
    errorCode: string,
    redactedError: string,
    retryAfterSeconds?: number,
  ): Promise<void>;
};

export type UserNotificationLogger = {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
};

export type ProcessUserNotificationsResult = {
  claimed: number;
  sent: number;
  retrying: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class UserNotificationDeliveryError extends Error {
  constructor(
    readonly safeCode: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(safeCode);
    this.name = "UserNotificationDeliveryError";
  }
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function senderAddress(value: string): string {
  const match = value.match(/<([^>]+)>\s*$/);
  return (match?.[1] ?? value).trim();
}

export function readUserNotificationConfiguration(
  getEnv: (name: string) => string | undefined,
): UserNotificationConfigurationResult {
  const resendApiKey = getEnv(USER_NOTIFICATION_ENV.resendApiKey)?.trim() ?? "";
  if (!resendApiKey) return { ok: false, code: "missing_resend_api_key" };

  const sender = getEnv(USER_NOTIFICATION_ENV.sender)?.trim() ||
    getEnv(USER_NOTIFICATION_ENV.fallbackSender)?.trim() ||
    USER_NOTIFICATION_ENV.defaultSender;
  if (!looksLikeEmail(senderAddress(sender))) {
    return { ok: false, code: "invalid_sender" };
  }
  return { ok: true, value: { resendApiKey, sender } };
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeActionUrl(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.startsWith("#")) return `https://medichall.com/portal.html${text}`;
  if (/^\/portal\.html(?:#.*)?$/.test(text)) {
    return `https://medichall.com${text}`;
  }
  return "https://medichall.com/portal.html";
}

function eventLabel(eventType: string): string {
  return ({
    NEW_TENDER_MATCH: "New tender match",
    HIGH_TENDER_MATCH: "High-potential tender match",
    NEW_COMPANY_MATCH: "New company match",
    CONNECTION_REQUEST: "New connection request",
    CONNECTION_ACCEPTED: "Connection accepted",
    NEW_RFQ: "New quotation request",
    NEW_MESSAGE: "New message",
    MEETING_REQUEST: "Meeting request",
    MEETING_CONFIRMED: "Meeting confirmed",
    MEETING_REMINDER: "Meeting reminder",
    IMPORT_COMPLETE: "Tender import complete",
    TENDER_DEADLINE_APPROACHING: "Tender deadline approaching",
    WEEKLY_DIGEST: "Your MedicHall week",
  } as Record<string, string>)[eventType] ?? "MedicHall update";
}

function digestHtml(payload: Record<string, unknown>): string {
  const event = record(payload.event);
  const strongest = record(event.strongest_opportunity);
  const counts = [
    ["Tender matches", finiteNumber(event.new_tender_matches)],
    ["Company matches", finiteNumber(event.new_company_matches)],
    ["New RFQs", finiteNumber(event.new_rfqs)],
    ["Upcoming meetings", finiteNumber(event.upcoming_meetings)],
  ];
  const strongestTitle = typeof strongest.title === "string"
    ? strongest.title.trim()
    : "";
  const deadline = typeof strongest.deadline_at === "string"
    ? new Date(strongest.deadline_at)
    : null;
  const deadlineText = deadline && Number.isFinite(deadline.getTime())
    ? deadline.toLocaleDateString("en-GB", { timeZone: "UTC" })
    : "Not provided";
  const highlight = strongestTitle
    ? `<div style="margin:22px 0;padding:18px;border-radius:12px;background:#eef8fa">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#397487">Strongest current opportunity</div>
        <h3 style="margin:7px 0;color:#12313f">${escapeHtml(strongestTitle)}</h3>
        <p style="margin:0;color:#4d6b78">Match ${escapeHtml(finiteNumber(strongest.match_score))}% · Deadline ${escapeHtml(deadlineText)}</p>
      </div>`
    : `<p style="color:#5a7684">No active tender opportunity is ready to highlight yet.</p>`;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${counts.map(([label, count]) => `<div style="padding:13px;border:1px solid #dbe8ed;border-radius:10px"><strong style="font-size:22px">${escapeHtml(count)}</strong><div style="color:#5a7684;font-size:13px">${escapeHtml(label)}</div></div>`).join("")}
    </div>${highlight}`;
}

export function buildUserNotificationPayload(
  job: UserNotificationJob,
  recipient: string,
  configuration: UserNotificationConfiguration,
): Record<string, unknown> {
  if (!looksLikeEmail(recipient)) {
    throw new UserNotificationDeliveryError("recipient_unavailable");
  }
  const title = typeof job.payload.title === "string" && job.payload.title.trim()
    ? job.payload.title.trim()
    : eventLabel(job.event_type);
  const body = typeof job.payload.body === "string" ? job.payload.body.trim() : "";
  const actionUrl = safeActionUrl(job.payload.action_url);
  const content = job.event_type === "WEEKLY_DIGEST"
    ? digestHtml(job.payload)
    : `<p style="font-size:16px;line-height:1.55;color:#385460">${escapeHtml(body)}</p>`;

  return {
    from: configuration.sender,
    to: [recipient],
    subject: `MedicHall: ${eventLabel(job.event_type)}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#12313f">
      <div style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#0e7490">MEDICHALL</div>
      <h2 style="margin:10px 0 12px">${escapeHtml(title)}</h2>
      ${content}
      <p style="margin-top:24px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#0b6279;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px">Open in MedicHall</a></p>
      <p style="margin-top:28px;color:#78909b;font-size:12px">Manage these emails in Portal → Notifications → Email preferences.</p>
    </div>`,
    tags: [
      { name: "event", value: job.event_type.toLowerCase().slice(0, 256) },
      { name: "outbox_id", value: String(job.outbox_id).slice(0, 256) },
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

export async function sendUserNotification(
  job: UserNotificationJob,
  recipient: string,
  configuration: UserNotificationConfiguration,
  request: FetchLike = fetch,
): Promise<string> {
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${configuration.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": job.idempotency_key,
    },
    body: JSON.stringify(buildUserNotificationPayload(
      job,
      recipient,
      configuration,
    )),
  });
  if (!response.ok) {
    throw new UserNotificationDeliveryError(
      `resend_http_${response.status}`,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new UserNotificationDeliveryError("resend_invalid_response");
  }
  const providerMessageId = responseBody && typeof responseBody === "object"
    ? (responseBody as Record<string, unknown>).id
    : undefined;
  if (typeof providerMessageId !== "string" || !providerMessageId.trim()) {
    throw new UserNotificationDeliveryError("resend_missing_message_id");
  }
  return providerMessageId.trim();
}

function deliveryFailure(error: unknown): UserNotificationDeliveryError {
  return error instanceof UserNotificationDeliveryError
    ? error
    : new UserNotificationDeliveryError("resend_transport_error");
}

function redactedProviderId(providerMessageId: string): string {
  const suffix = providerMessageId.slice(-6);
  return suffix ? `…${suffix}` : "recorded";
}

export async function processUserNotifications(
  configuration: UserNotificationConfiguration,
  repository: UserNotificationRepository,
  options: {
    limit?: number;
    request?: FetchLike;
    logger?: UserNotificationLogger;
  } = {},
): Promise<ProcessUserNotificationsResult> {
  const jobs = await repository.claim(Math.max(1, Math.min(options.limit ?? 40, 100)));
  const logger = options.logger ?? {
    info: (event) => console.info(JSON.stringify(event)),
    error: (event) => console.error(JSON.stringify(event)),
  };
  let sent = 0;
  let retrying = 0;

  for (const job of jobs) {
    try {
      const recipient = await repository.resolveRecipient(job.recipient_user_id);
      if (!recipient) throw new UserNotificationDeliveryError("recipient_unavailable");
      const providerMessageId = await sendUserNotification(
        job,
        recipient,
        configuration,
        options.request,
      );
      await repository.markSent(job.outbox_id, providerMessageId);
      sent++;
      logger.info({
        event: "user_notification_sent",
        outbox_id: String(job.outbox_id),
        event_type: job.event_type,
        attempt: job.attempt_count,
        provider_message_id_redacted: redactedProviderId(providerMessageId),
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
        event: "user_notification_retry_scheduled",
        outbox_id: String(job.outbox_id),
        event_type: job.event_type,
        attempt: job.attempt_count,
        error_code: failure.safeCode,
      });
    }
  }
  return { claimed: jobs.length, sent, retrying };
}

export type SavedSearchDigestWindow = {
  searchId: number | string;
  lastDigestAt: string;
};

export type SavedSearchDigestIdentity = {
  recipientUserId: string;
  recipient: string;
  windows: SavedSearchDigestWindow[];
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class SavedSearchDigestDeliveryError extends Error {
  constructor(
    readonly safeCode: string,
    readonly terminal: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(safeCode);
    this.name = "SavedSearchDigestDeliveryError";
  }
}

function canonicalWindows(windows: SavedSearchDigestWindow[]) {
  return windows.map((window) => ({
    search_id: String(window.searchId),
    last_digest_at: new Date(window.lastDigestAt).toISOString(),
  })).sort((left, right) =>
    left.search_id.localeCompare(right.search_id) ||
    left.last_digest_at.localeCompare(right.last_digest_at)
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function savedSearchDigestIdempotencyKey(
  identity: SavedSearchDigestIdentity,
  serializedPayload: string,
): Promise<string> {
  const canonical = JSON.stringify({
    version: 1,
    recipient_user_id: identity.recipientUserId.trim(),
    recipient: identity.recipient.trim().toLowerCase(),
    windows: canonicalWindows(identity.windows),
    payload_sha256: await sha256(serializedPayload),
  });
  return `saved-search-digest/${await sha256(canonical)}`;
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

function isPermanentProviderStatus(status: number): boolean {
  return [400, 401, 403, 404, 409, 422].includes(status);
}

export async function sendSavedSearchDigest(
  configuration: { resendApiKey: string },
  identity: SavedSearchDigestIdentity,
  payload: Record<string, unknown>,
  options: {
    request?: FetchLike;
    delay?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<{ providerMessageId: string; idempotencyKey: string }> {
  const request = options.request ?? fetch;
  const delay = options.delay ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const serializedPayload = JSON.stringify(payload);
  const idempotencyKey = await savedSearchDigestIdempotencyKey(
    identity,
    serializedPayload,
  );

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response;
    try {
      response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${configuration.resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: serializedPayload,
      });
    } catch {
      if (attempt === 1) {
        await delay(250);
        continue;
      }
      throw new SavedSearchDigestDeliveryError(
        "resend_transport_error",
        false,
        21_600,
      );
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new SavedSearchDigestDeliveryError(
          "resend_invalid_response",
          true,
        );
      }
      const providerMessageId = body && typeof body === "object"
        ? (body as Record<string, unknown>).id
        : undefined;
      if (typeof providerMessageId !== "string" || !providerMessageId.trim()) {
        throw new SavedSearchDigestDeliveryError(
          "resend_missing_message_id",
          true,
        );
      }
      return {
        providerMessageId: providerMessageId.trim(),
        idempotencyKey,
      };
    }

    if (response.status === 429) {
      throw new SavedSearchDigestDeliveryError(
        "resend_http_429",
        false,
        parseRetryAfter(response.headers.get("retry-after")) ?? 21_600,
      );
    }
    if (response.status >= 500 && attempt === 1) {
      await delay(250);
      continue;
    }
    throw new SavedSearchDigestDeliveryError(
      `resend_http_${response.status}`,
      isPermanentProviderStatus(response.status),
      response.status >= 500 ? 21_600 : undefined,
    );
  }

  throw new SavedSearchDigestDeliveryError(
    "resend_transport_error",
    false,
    21_600,
  );
}

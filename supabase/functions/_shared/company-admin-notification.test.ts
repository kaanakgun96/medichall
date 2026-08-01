import {
  type CompanyNotificationConfiguration,
  type CompanyNotificationJob,
  type CompanyNotificationRepository,
  processCompanyAdminNotifications,
  readCompanyNotificationConfiguration,
  sendCompanyNotification,
} from "./company-admin-notification.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

const configuration: CompanyNotificationConfiguration = {
  resendApiKey: "test-resend-secret",
  recipient: "admin@example.invalid",
  sender: "MedicHall <notifications@medichall.com>",
};

const job: CompanyNotificationJob = {
  outbox_id: 81,
  company_id: 42,
  company_name: "QA Medical <script>",
  company_type: "manufacturer",
  company_country: "Türkiye",
  company_created_at: "2026-07-30T05:15:00.000Z",
  attempt_count: 1,
  idempotency_key: "company-registration/81",
};

function createRepository(jobs: CompanyNotificationJob[]) {
  const sent: Array<{ outboxId: number | string; providerId: string }> = [];
  const retries: Array<{
    outboxId: number | string;
    code: string;
    redacted: string;
    retryAfter?: number;
  }> = [];
  const repository: CompanyNotificationRepository = {
    claim: () => Promise.resolve(jobs),
    markSent: (outboxId, providerId) => {
      sent.push({ outboxId, providerId });
      return Promise.resolve();
    },
    markRetry: (outboxId, code, redacted, retryAfter) => {
      retries.push({ outboxId, code, redacted, retryAfter });
      return Promise.resolve();
    },
  };
  return { repository, sent, retries };
}

const quietLogger = {
  info: (_event: Record<string, unknown>) => {},
  error: (_event: Record<string, unknown>) => {},
};

Deno.test("successful notification stores the Resend provider message ID", async () => {
  const fixture = createRepository([job]);
  const requests: Array<{ headers: Headers; body: string }> = [];
  const result = await processCompanyAdminNotifications(
    configuration,
    fixture.repository,
    {
      request: (_input, init = {}) => {
        requests.push({
          headers: new Headers(init.headers),
          body: String(init.body ?? ""),
        });
        return Promise.resolve(Response.json({ id: "provider-message-123" }));
      },
      logger: quietLogger,
    },
  );

  assertEquals(result, { claimed: 1, sent: 1, retrying: 0 }, "send counts");
  assertEquals(
    fixture.sent,
    [{ outboxId: 81, providerId: "provider-message-123" }],
    "provider ID should be recorded",
  );
  assertEquals(requests.length, 1, "one provider request should be made");
  assertEquals(
    requests[0].headers.get("authorization"),
    "Bearer test-resend-secret",
    "provider credential should be sent in the authorization header",
  );
  assert(
    !requests[0].body.includes("test-resend-secret"),
    "provider credential must not appear in the message body",
  );
  assert(
    requests[0].body.includes("QA Medical &lt;script&gt;"),
    "company content should be HTML escaped",
  );
});

Deno.test("duplicate registration delivery uses one stable idempotency key", async () => {
  const keys: string[] = [];
  const request = (_input: string | URL | Request, init: RequestInit = {}) => {
    keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
    return Promise.resolve(Response.json({ id: "provider-message-stable" }));
  };

  await sendCompanyNotification(job, configuration, request);
  await sendCompanyNotification(job, configuration, request);

  assertEquals(
    keys,
    ["company-registration/81", "company-registration/81"],
    "repeated processing must use the same provider idempotency key",
  );
});

Deno.test("Resend failure records only a redacted retry error", async () => {
  const fixture = createRepository([job]);
  const result = await processCompanyAdminNotifications(
    configuration,
    fixture.repository,
    {
      request: () =>
        Promise.resolve(
          new Response(
            "provider diagnostic containing recipient@example.invalid",
            { status: 503 },
          ),
        ),
      logger: quietLogger,
    },
  );

  assertEquals(result, { claimed: 1, sent: 0, retrying: 1 }, "retry counts");
  assertEquals(fixture.retries.length, 1, "one retry should be scheduled");
  assertEquals(fixture.retries[0].code, "resend_http_503", "safe error code");
  assertEquals(
    fixture.retries[0].redacted,
    "resend_http_503",
    "provider body must not be persisted",
  );
});

Deno.test("missing Resend API key prevents notification processing", () => {
  const result = readCompanyNotificationConfiguration((name) =>
    name === "COMPANY_ADMIN_NOTIFICATION_RECIPIENT"
      ? "admin@example.invalid"
      : undefined
  );
  assertEquals(
    result,
    { ok: false, code: "missing_resend_api_key" },
    "missing-key failure should be explicit and redacted",
  );
});

Deno.test("missing admin recipient prevents notification processing", () => {
  const result = readCompanyNotificationConfiguration((name) =>
    name === "RESEND_API_KEY" ? "test-resend-secret" : undefined
  );
  assertEquals(
    result,
    { ok: false, code: "missing_admin_recipient" },
    "missing-recipient failure should be explicit and redacted",
  );
});

Deno.test("retry behavior honors provider retry-after without changing idempotency", async () => {
  const retryJob = { ...job, attempt_count: 2 };
  const fixture = createRepository([retryJob]);
  let idempotencyKey = "";
  await processCompanyAdminNotifications(configuration, fixture.repository, {
    request: (_input, init = {}) => {
      idempotencyKey = new Headers(init.headers).get("idempotency-key") ?? "";
      return Promise.resolve(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "180" },
        }),
      );
    },
    logger: quietLogger,
  });

  assertEquals(fixture.retries.length, 1, "one retry should be scheduled");
  assertEquals(fixture.retries[0].code, "resend_http_429", "retry code");
  assertEquals(fixture.retries[0].retryAfter, 180, "provider retry delay");
  assertEquals(
    idempotencyKey,
    "company-registration/81",
    "retries must retain the provider idempotency key",
  );
});

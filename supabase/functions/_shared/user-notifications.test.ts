import {
  type UserNotificationConfiguration,
  type UserNotificationJob,
  type UserNotificationRepository,
  buildUserNotificationPayload,
  processUserNotifications,
  readUserNotificationConfiguration,
  sendUserNotification,
} from "./user-notifications.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const configuration: UserNotificationConfiguration = {
  resendApiKey: "test-resend-secret",
  sender: "MedicHall <notifications@medichall.com>",
};

const job: UserNotificationJob = {
  outbox_id: 91,
  recipient_user_id: "50000000-0000-4000-8000-000000000001",
  event_type: "HIGH_TENDER_MATCH",
  payload: {
    title: "High match <unsafe>",
    body: "Sterile drape tender matched at 92%.",
    action_url: "#opportunity=42",
    event: { match_score: 92 },
  },
  attempt_count: 1,
  idempotency_key: "user-notification/91",
};

function fixture(
  jobs: UserNotificationJob[],
  recipient: string | null = "qa@example.invalid",
) {
  const sent: Array<{ outboxId: number | string; providerId: string }> = [];
  const retries: Array<{ code: string; redacted: string; retryAfter?: number }> = [];
  const repository: UserNotificationRepository = {
    claim: () => Promise.resolve(jobs),
    resolveRecipient: () => Promise.resolve(recipient),
    markSent: (outboxId, providerId) => {
      sent.push({ outboxId, providerId });
      return Promise.resolve();
    },
    markRetry: (_outboxId, code, redacted, retryAfter) => {
      retries.push({ code, redacted, retryAfter });
      return Promise.resolve();
    },
  };
  return { repository, sent, retries };
}

const quietLogger = {
  info: (_event: Record<string, unknown>) => {},
  error: (_event: Record<string, unknown>) => {},
};

Deno.test("successful user notification records the provider message ID", async () => {
  const test = fixture([job]);
  const requests: Array<{ headers: Headers; body: string }> = [];
  const result = await processUserNotifications(configuration, test.repository, {
    request: (_input, init = {}) => {
      requests.push({
        headers: new Headers(init.headers),
        body: String(init.body ?? ""),
      });
      return Promise.resolve(Response.json({ id: "provider-user-message-123" }));
    },
    logger: quietLogger,
  });
  assertEquals(result, { claimed: 1, sent: 1, retrying: 0 }, "delivery result");
  assertEquals(test.sent, [{ outboxId: 91, providerId: "provider-user-message-123" }], "stored provider ID");
  assertEquals(requests.length, 1, "one provider call");
  assertEquals(requests[0].headers.get("idempotency-key"), "user-notification/91", "stable provider idempotency");
  assert(!requests[0].body.includes("test-resend-secret"), "API key must not enter body");
  assert(requests[0].body.includes("High match &lt;unsafe&gt;"), "HTML must be escaped");
});

Deno.test("duplicate processing keeps one provider idempotency key", async () => {
  const keys: string[] = [];
  const request = (_input: string | URL | Request, init: RequestInit = {}) => {
    keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
    return Promise.resolve(Response.json({ id: "provider-stable" }));
  };
  await sendUserNotification(job, "qa@example.invalid", configuration, request);
  await sendUserNotification(job, "qa@example.invalid", configuration, request);
  assertEquals(keys, ["user-notification/91", "user-notification/91"], "same key on retries");
});

Deno.test("Resend failure is redacted and retryable", async () => {
  const test = fixture([job]);
  const result = await processUserNotifications(configuration, test.repository, {
    request: () => Promise.resolve(new Response("recipient@example.invalid secret diagnostic", {
      status: 503,
      headers: { "retry-after": "180" },
    })),
    logger: quietLogger,
  });
  assertEquals(result, { claimed: 1, sent: 0, retrying: 1 }, "retry result");
  assertEquals(test.retries, [{ code: "resend_http_503", redacted: "resend_http_503", retryAfter: 180 }], "redacted provider failure");
});

Deno.test("missing API key fails configuration without exposing values", () => {
  assertEquals(
    readUserNotificationConfiguration(() => undefined),
    { ok: false, code: "missing_resend_api_key" },
    "missing key",
  );
});

Deno.test("configured fallback sender is accepted", () => {
  const result = readUserNotificationConfiguration((name) => ({
    RESEND_API_KEY: "test-secret",
    COMPANY_ADMIN_NOTIFICATION_FROM: "MedicHall <notifications@medichall.com>",
  } as Record<string, string>)[name]);
  assert(result.ok, "fallback sender should be valid");
});

Deno.test("missing recipient schedules a redacted retry", async () => {
  const test = fixture([job], null);
  await processUserNotifications(configuration, test.repository, { logger: quietLogger });
  assertEquals(test.retries, [{ code: "recipient_unavailable", redacted: "recipient_unavailable", retryAfter: undefined }], "missing recipient retry");
});

Deno.test("weekly digest renders actual counts and strongest opportunity", () => {
  const digest = buildUserNotificationPayload({
    ...job,
    event_type: "WEEKLY_DIGEST",
    payload: {
      title: "Your MedicHall week",
      action_url: "#dashboard",
      event: {
        new_tender_matches: 3,
        new_company_matches: 2,
        new_rfqs: 1,
        upcoming_meetings: 4,
        strongest_opportunity: {
          title: "Sterile drape framework",
          match_score: 94,
          deadline_at: "2026-08-20T12:00:00.000Z",
        },
      },
    },
  }, "qa@example.invalid", configuration);
  const html = String(digest.html);
  for (const expected of ["Tender matches", ">3<", "Company matches", ">2<", "New RFQs", ">1<", "Upcoming meetings", ">4<", "Sterile drape framework", "94%"]) {
    assert(html.includes(expected), `digest should contain ${expected}`);
  }
});

Deno.test("unsafe external action links are replaced by the portal", () => {
  const payload = buildUserNotificationPayload({
    ...job,
    payload: { ...job.payload, action_url: "https://evil.example/path" },
  }, "qa@example.invalid", configuration);
  assert(!String(payload.html).includes("evil.example"), "external action URL must be rejected");
  assert(String(payload.html).includes("https://medichall.com/portal.html"), "portal fallback should be used");
});

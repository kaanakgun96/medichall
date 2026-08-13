import {
  SavedSearchDigestDeliveryError,
  savedSearchDigestIdempotencyKey,
  type SavedSearchDigestIdentity,
  sendSavedSearchDigest,
} from "./saved-search-digest.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const identity: SavedSearchDigestIdentity = {
  recipientUserId: "50000000-0000-4000-8000-000000000001",
  recipient: "qa@example.invalid",
  windows: [
    { searchId: 11, lastDigestAt: "2026-08-12T07:00:00.000Z" },
    { searchId: 12, lastDigestAt: "2026-08-12T07:00:00.000Z" },
  ],
};
const payload = JSON.stringify({
  from: "MedicHall <notifications@medichall.com>",
  to: ["qa@example.invalid"],
  subject: "MedicHall digest: 2 new tenders for your saved searches",
  html: "<p>Two matched tenders</p>",
});

Deno.test("same logical saved-search digest produces one bounded provider key", async () => {
  const first = await savedSearchDigestIdempotencyKey(identity, payload);
  const second = await savedSearchDigestIdempotencyKey({
    ...identity,
    windows: [...identity.windows].reverse(),
  }, payload);
  assertEquals(first, second, "window ordering must not change identity");
  assert(first.startsWith("saved-search-digest/"), "key prefix");
  assert(first.length <= 256, "provider key length");
  assert(!first.includes(identity.recipient), "recipient must remain hashed");
  assert(
    !first.includes(identity.recipientUserId),
    "user ID must remain hashed",
  );
});

Deno.test("retry after transport uncertainty reuses identical key and payload", async () => {
  const requests: Array<{ key: string; body: string }> = [];
  const accepted = new Map<string, { body: string; providerId: string }>();
  let logicalDeliveries = 0;
  let attempt = 0;
  const result = await sendSavedSearchDigest(
    { resendApiKey: "test-secret" },
    identity,
    JSON.parse(payload),
    {
      request: (_input, init = {}) => {
        const request = {
          key: new Headers(init.headers).get("idempotency-key") ?? "",
          body: String(init.body ?? ""),
        };
        requests.push(request);
        attempt++;
        const existing = accepted.get(request.key);
        if (existing) {
          assertEquals(
            existing.body,
            request.body,
            "provider replay payload",
          );
          return Promise.resolve(Response.json({ id: existing.providerId }));
        }
        logicalDeliveries++;
        accepted.set(request.key, {
          body: request.body,
          providerId: "provider-digest-1",
        });
        return Promise.reject(new TypeError("timeout after acceptance"));
      },
      delay: () => Promise.resolve(),
    },
  );
  assertEquals(requests.length, 2, "one bounded replay");
  assertEquals(requests[0], requests[1], "retry must reuse key and payload");
  assertEquals(logicalDeliveries, 1, "provider must accept one logical email");
  assertEquals(result.providerMessageId, "provider-digest-1", "provider ID");
});

Deno.test("a new digest window creates a different provider key", async () => {
  const original = await savedSearchDigestIdempotencyKey(identity, payload);
  const nextWindow = await savedSearchDigestIdempotencyKey({
    ...identity,
    windows: identity.windows.map((window) => ({
      ...window,
      lastDigestAt: "2026-08-13T07:00:00.000Z",
    })),
  }, payload);
  assert(original !== nextWindow, "new digest window must differ");
});

Deno.test("different saved search or recipient creates a different key", async () => {
  const original = await savedSearchDigestIdempotencyKey(identity, payload);
  const differentSearch = await savedSearchDigestIdempotencyKey({
    ...identity,
    windows: [{ searchId: 99, lastDigestAt: "2026-08-12T07:00:00.000Z" }],
  }, payload);
  const differentRecipient = await savedSearchDigestIdempotencyKey({
    ...identity,
    recipient: "other@example.invalid",
  }, payload);
  assert(original !== differentSearch, "saved search identity must differ");
  assert(original !== differentRecipient, "recipient identity must differ");
});

Deno.test("429 is deferred for six hours without an immediate replay", async () => {
  let calls = 0;
  try {
    await sendSavedSearchDigest(
      { resendApiKey: "test-secret" },
      identity,
      JSON.parse(payload),
      {
        request: () => {
          calls++;
          return Promise.resolve(new Response("quota", { status: 429 }));
        },
        delay: () => Promise.resolve(),
      },
    );
    throw new Error("Expected 429 failure");
  } catch (error) {
    assert(error instanceof SavedSearchDigestDeliveryError, "typed failure");
    assertEquals(error.safeCode, "resend_http_429", "safe code");
    assertEquals(error.retryAfterSeconds, 21_600, "six-hour deferral");
    assertEquals(error.terminal, false, "quota remains retryable");
  }
  assertEquals(calls, 1, "429 must not loop immediately");
});

Deno.test("permanent provider failure is terminal for the worker invocation", async () => {
  let calls = 0;
  try {
    await sendSavedSearchDigest(
      { resendApiKey: "test-secret" },
      identity,
      JSON.parse(payload),
      {
        request: () => {
          calls++;
          return Promise.resolve(new Response("invalid", { status: 422 }));
        },
      },
    );
    throw new Error("Expected permanent failure");
  } catch (error) {
    assert(error instanceof SavedSearchDigestDeliveryError, "typed failure");
    assertEquals(error.safeCode, "resend_http_422", "safe code");
    assertEquals(error.terminal, true, "422 must be terminal");
  }
  assertEquals(calls, 1, "permanent failure must not replay");
});

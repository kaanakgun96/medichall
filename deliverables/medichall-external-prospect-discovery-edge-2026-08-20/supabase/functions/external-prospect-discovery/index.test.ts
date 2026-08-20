import {
  handleExternalProspectDiscoveryRequest,
  structuredTexts,
} from "./index.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

Deno.test("structured procurement identifiers are not mistaken for contact coordinates", () => {
  assertEquals(structuredTexts(["33124100", "2026-08-20"]), [
    "33124100",
    "2026-08-20",
  ]);
  assertEquals(structuredTexts({ ron: ["RO 16320869"] }), ["RO 16320869"]);
});

Deno.test("external prospect discovery OPTIONS is 204 and origin constrained", async () => {
  const response = await handleExternalProspectDiscoveryRequest(
    new Request("https://edge.test", {
      method: "OPTIONS",
      headers: { origin: "https://medichall.com" },
    }),
  );
  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
});

Deno.test("external prospect discovery rejects unauthenticated POST before source access", async () => {
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const originalService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  Deno.env.set("SUPABASE_URL", "https://external-prospect-test.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "public-test-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "private-test-key");
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("Unauthenticated request reached a network boundary");
  };
  try {
    const response = await handleExternalProspectDiscoveryRequest(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          origin: "https://medichall.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          company_id: 1,
          idempotency_key: "92000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: "Authentication required." });
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl == null) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", originalUrl);
    if (originalAnon == null) Deno.env.delete("SUPABASE_ANON_KEY");
    else Deno.env.set("SUPABASE_ANON_KEY", originalAnon);
    if (originalService == null) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalService);
  }
});

Deno.test("external prospect discovery rejects non-MedicHall origins", async () => {
  const response = await handleExternalProspectDiscoveryRequest(
    new Request("https://edge.test", {
      method: "POST",
      headers: { origin: "https://attacker.invalid" },
      body: "{}",
    }),
  );
  assertEquals(response.status, 403);
  const body = JSON.stringify(await response.json());
  if (/service|secret|recipient|key/i.test(body)) {
    throw new Error("Security-sensitive configuration leaked in response");
  }
});

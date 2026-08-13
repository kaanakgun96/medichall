import { handleTrafficAnalyticsRequest } from "./index.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

const payload = {
  event_id: "82000000-0000-4000-8000-000000000001",
  visitor_id: "82000000-0000-4000-8000-000000000002",
  session_id: "82000000-0000-4000-8000-000000000003",
  route_id: "homepage",
  referrer_domain: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
};

Deno.test("collector preflight is 204 and origin constrained", async () => {
  const response = await handleTrafficAnalyticsRequest(
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

Deno.test("anonymous page view reaches the service-only RPC exactly once", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const originalService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let rpcCalls = 0;
  Deno.env.set("SUPABASE_URL", "https://analytics-test.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/record_traffic_page_view_v1")) {
      rpcCalls += 1;
      const sent = JSON.parse(String(init?.body || "{}"));
      assertEquals(sent.p_is_authenticated, false);
      assertEquals(sent.p_country_code, "TR");
      return Promise.resolve(
        new Response(
          JSON.stringify({ recorded: true, deduplicated: false }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await handleTrafficAnalyticsRequest(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          origin: "https://medichall.com",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15",
          "cf-ipcountry": "TR",
        },
        body: JSON.stringify(payload),
      }),
    );
    assertEquals(response.status, 201);
    assertEquals(rpcCalls, 1);
    assertEquals(await response.json(), {
      accepted: true,
      kind: "page_view",
      recorded: true,
      deduplicated: false,
    });
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

Deno.test("allowlisted conversion reaches only the conversion RPC", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const originalService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let conversionCalls = 0;
  Deno.env.set("SUPABASE_URL", "https://analytics-test.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/record_traffic_conversion_v1")) {
      conversionCalls += 1;
      const sent = JSON.parse(String(init?.body || "{}"));
      assertEquals(sent.p_event_type, "rfq_created");
      assertEquals(Object.hasOwn(sent, "p_route_id"), false);
      return Promise.resolve(
        new Response(
          JSON.stringify({ recorded: true, deduplicated: false }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const response = await handleTrafficAnalyticsRequest(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          origin: "https://medichall.com",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 Firefox/128.0",
        },
        body: JSON.stringify({
          event_id: "82000000-0000-4000-8000-000000000021",
          visitor_id: "82000000-0000-4000-8000-000000000022",
          session_id: "82000000-0000-4000-8000-000000000023",
          event_type: "rfq_created",
        }),
      }),
    );
    assertEquals(response.status, 201);
    assertEquals(conversionCalls, 1);
    assertEquals(await response.json(), {
      accepted: true,
      kind: "conversion",
      recorded: true,
      deduplicated: false,
    });
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

Deno.test("bot and malformed sensitive payloads never reach persistence", async () => {
  const bot = await handleTrafficAnalyticsRequest(
    new Request("https://edge.test", {
      method: "POST",
      headers: {
        origin: "https://medichall.com",
        "user-agent": "Googlebot/2.1",
      },
      body: JSON.stringify(payload),
    }),
  );
  assertEquals(bot.status, 202);
  assertEquals(await bot.json(), { accepted: false, filtered: true });

  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const originalService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://analytics-test.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  try {
    const malformed = await handleTrafficAnalyticsRequest(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          origin: "https://medichall.com",
          "user-agent": "Mozilla/5.0 Firefox/128.0",
        },
        body: JSON.stringify({
          ...payload,
          raw_url: "https://medichall.com/private?token=no",
        }),
      }),
    );
    assertEquals(malformed.status, 400);
  } finally {
    if (originalUrl == null) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", originalUrl);
    if (originalAnon == null) Deno.env.delete("SUPABASE_ANON_KEY");
    else Deno.env.set("SUPABASE_ANON_KEY", originalAnon);
    if (originalService == null) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalService);
  }
});

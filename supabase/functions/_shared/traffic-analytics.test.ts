import {
  acquisitionSource,
  classifyUserAgent,
  isObviousBot,
  normalizeReferrerDomain,
  parseTrafficConversionPayload,
  parseTrafficPayload,
  trustedCountryCode,
} from "./traffic-analytics.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

function assertThrows(
  action: () => unknown,
  expectedMessage: string,
): void {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected error containing: ${expectedMessage}`);
}

const valid = {
  event_id: "81000000-0000-4000-8000-000000000001",
  visitor_id: "81000000-0000-4000-8000-000000000002",
  session_id: "81000000-0000-4000-8000-000000000003",
  route_id: "products",
  referrer_domain: "WWW.LinkedIn.com",
  utm_source: " LinkedIn ",
  utm_medium: "Social",
  utm_campaign: "Open Beta",
};

Deno.test("anonymous payload accepts only bounded normalized traffic fields", () => {
  assertEquals(parseTrafficPayload(valid), {
    ...valid,
    referrer_domain: "linkedin.com",
    utm_source: "linkedin",
    utm_medium: "social",
    utm_campaign: "open beta",
  });
  assertThrows(
    () => parseTrafficPayload({ ...valid, route_id: "/products?token=secret" }),
    "Invalid normalized route",
  );
  assertThrows(
    () => parseTrafficPayload({ ...valid, visitor_id: "not-a-uuid" }),
    "Invalid analytics identifier",
  );
  assertThrows(
    () => parseTrafficPayload({ ...valid, access_token: "never-store" }),
    "Unsupported analytics field",
  );
  assertThrows(
    () =>
      parseTrafficPayload({
        ...valid,
        raw_url: "https://example.test/private?q=secret",
      }),
    "Unsupported analytics field",
  );
});

Deno.test("referrer and UTM normalization never retains a URL path or query", () => {
  assertEquals(normalizeReferrerDomain("www.google.com"), "google.com");
  assertThrows(
    () => normalizeReferrerDomain("https://google.com/search?q=private"),
    "Invalid referrer domain",
  );
  assertThrows(
    () => parseTrafficPayload({ ...valid, utm_campaign: "x".repeat(101) }),
    "Invalid campaign attribution",
  );
  assertEquals(acquisitionSource("linkedin.com", null), "linkedin");
  assertEquals(acquisitionSource(null, "google"), "google");
  assertEquals(acquisitionSource("medichall.com", null), "internal");
  assertEquals(acquisitionSource(null, null), "direct");
});

Deno.test("conversion payload accepts only fixed event names and identifiers", () => {
  const conversion = {
    event_id: "82000000-0000-4000-8000-000000000011",
    visitor_id: "82000000-0000-4000-8000-000000000012",
    session_id: "82000000-0000-4000-8000-000000000013",
    event_type: "connection_requested",
  };
  assertEquals(parseTrafficConversionPayload(conversion), conversion);
  assertThrows(
    () =>
      parseTrafficConversionPayload({
        ...conversion,
        event_type: "message_sent",
      }),
    "Invalid conversion event",
  );
  assertThrows(
    () => parseTrafficConversionPayload({ ...conversion, company_id: 42 }),
    "Unsupported analytics field",
  );
  assertEquals(
    parseTrafficConversionPayload({
      ...conversion,
      event_type: "external_prospect_discovery_started",
    }).event_type,
    "external_prospect_discovery_started",
  );
});

Deno.test("country is optional and only the trusted proxy header is read", () => {
  assertEquals(trustedCountryCode(new Headers()), null);
  assertEquals(trustedCountryCode(new Headers({ "cf-ipcountry": "tr" })), "TR");
  assertEquals(
    trustedCountryCode(new Headers({ "x-country-code": "DE" })),
    null,
  );
  assertEquals(trustedCountryCode(new Headers({ "cf-ipcountry": "XX" })), null);
});

Deno.test("user agent parsing is coarse and obvious bots are excluded", () => {
  assertEquals(
    classifyUserAgent("Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1"),
    { device: "mobile", browser: "safari" },
  );
  assertEquals(
    classifyUserAgent(
      "Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36",
    ),
    { device: "desktop", browser: "chrome" },
  );
  assertEquals(
    classifyUserAgent("Mozilla/5.0 (iPad) Version/18.0 Mobile Safari/604.1"),
    { device: "tablet", browser: "safari" },
  );
  assertEquals(isObviousBot("Googlebot/2.1"), true);
  assertEquals(isObviousBot("Mozilla/5.0 Firefox/128.0"), false);
});

import {
  discoveryCompletionStatus,
  handleExternalProspectDiscoveryRequest,
  legacyQueryProgressCount,
  mergeSignals,
  structuredTexts,
} from "./index.ts";
import { normalizeActivitySignal } from "../_shared/external-prospect-discovery.ts";

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

Deno.test("registry outage degrades the run to PARTIAL without failing discovery", () => {
  assertEquals(
    discoveryCompletionStatus({
      tedUnavailable: false,
      registryUnavailableProviders: 1,
      websiteUnavailable: 0,
    }),
    "PARTIAL",
  );
  assertEquals(
    discoveryCompletionStatus({
      tedUnavailable: false,
      registryUnavailableProviders: 0,
      websiteUnavailable: 0,
    }),
    "COMPLETED",
  );
});

Deno.test("six-request V2.1 retrieval fits the legacy production progress constraint", () => {
  assertEquals(legacyQueryProgressCount(6), 4);
  assertEquals(legacyQueryProgressCount(4), 4);
  assertEquals(legacyQueryProgressCount(-1), 0);
});

Deno.test("registry identifier merges an alternate legal name into its TED candidate", () => {
  const activity = normalizeActivitySignal({
    providerCode: "PL_KRS_OPEN_API",
    countryCode: "PL",
    registryIdentifier: "KRS:0000011286",
    nationalCode: "46.46.Z",
    nationalClassification: "PKD 2007",
    description: "Wholesale of pharmaceutical and medical goods",
  });
  const merged = mergeSignals(
    [{
      name: "QA Medical Trading",
      countryCode: "PL",
      countryName: "Poland",
      cityRegion: null,
      companyType: "Distributor",
      websiteUrl: null,
      registryIdentifier: "KRS:0000011286",
      description: "Related procurement award",
      evidence: [{
        sourceType: "TED_AWARD",
        sourceUrl: "https://ted.europa.eu/en/notice/-/detail/qa",
        sourceDomain: "ted.europa.eu",
        title: "QA award",
        snippet: "Diagnostic equipment accessories",
        evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
        confidence: 0.8,
        evidenceDate: "2026-08-01",
      }],
      activities: [],
      taxonomyIds: [1],
      taxonomyRelation: "parent_child",
      targetCountry: false,
      preferredCompanyType: false,
      relatedAwardCount: 1,
      lastEvidenceAt: "2026-08-01",
    }],
    [{
      name: "QA MEDICAL TRADING SPOLKA AKCYJNA",
      legalName: "QA MEDICAL TRADING SPOLKA AKCYJNA",
      countryCode: "PL",
      countryName: "Poland",
      cityRegion: "Warszawa",
      registeredAddress: "Warszawa",
      registryIdentifier: "KRS:0000011286",
      entityStatus: "ACTIVE",
      sourceUrl: "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000011286",
      sourceTitle: "Polish National Court Register activity",
      sourceReference: "KRS:0000011286",
      verifiedAt: "2026-08-20T00:00:00Z",
      providerConfidence: 0.88,
      activity,
    }],
    ["PL"],
    ["distributor"],
  );
  assertEquals(merged.length, 1);
  assertEquals(merged[0].evidence.length, 2);
  assertEquals(merged[0].activities.length, 1);
});

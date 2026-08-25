import {
  buildPublicWebSearchPlan,
  createBraveSearchProvider,
  normalizePublicWebResult,
  PUBLIC_WEB_DISCOVERY_LIMITS,
  type PublicWebCacheEntry,
  publicWebCandidatesToProspects,
  type PublicWebDiscoveryCache,
  type PublicWebDiscoveryProvider,
  publicWebRequestKey,
  runPublicWebDiscovery,
} from "./public-web-discovery.ts";
import {
  type ProspectEvidence,
  rankProspects,
} from "./external-prospect-discovery.ts";
import { buildProductFamilyProfile } from "./buyer-discovery-relevance-v2.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const camera = buildProductFamilyProfile([{
  taxonomyId: 336,
  canonicalName: "Camera Covers",
  slug: "camera-covers",
  aliases: ["Camera Cover", "Sterile Camera Drape", "Camera Sleeve"],
}]);

const cArm = buildProductFamilyProfile([{
  taxonomyId: 335,
  canonicalName: "C-Arm Covers",
  slug: "c-arm-covers",
  aliases: ["C-Arm Cover", "C Arm Drape"],
}]);

const microscope = buildProductFamilyProfile([{
  taxonomyId: 337,
  canonicalName: "Microscope Drapes",
  slug: "microscope-drapes",
  aliases: ["Microscope Cover", "Microscope Drape"],
}]);

class MemoryCache implements PublicWebDiscoveryCache {
  entries = new Map<string, PublicWebCacheEntry>();
  reads = 0;
  writes = 0;
  read(
    providerCode: string,
    requestKeyHash: string,
    now: Date,
  ): Promise<PublicWebCacheEntry | null> {
    this.reads += 1;
    const entry = this.entries.get(`${providerCode}:${requestKeyHash}`) || null;
    return Promise.resolve(
      entry && new Date(entry.expiresAt) > now ? entry : null,
    );
  }
  write(entry: PublicWebCacheEntry): Promise<void> {
    this.writes += 1;
    this.entries.set(`${entry.providerCode}:${entry.requestKeyHash}`, entry);
    return Promise.resolve();
  }
}

function fixtureProvider(
  batchesFactory: PublicWebDiscoveryProvider["searchCompanies"],
): PublicWebDiscoveryProvider {
  return { code: "FIXTURE_PUBLIC_WEB", searchCompanies: batchesFactory };
}

Deno.test("multilingual camera-cover queries are reviewed, bounded, and market-targeted", () => {
  const plan = buildPublicWebSearchPlan({
    productFamily: camera,
    targetCountries: [],
  });
  assert(
    plan.length === 10,
    "Europe-wide vNext public-web plan must remain at ten",
  );
  const markets = new Map(plan.map((item) => [item.country, item.language]));
  for (
    const [country, language] of [
      ["IT", "it"],
      ["ES", "es"],
      ["FR", "fr"],
      ["DE", "de"],
      ["NL", "nl"],
    ]
  ) {
    assert(
      markets.get(country) === language,
      `${country} must use its reviewed language parameter`,
    );
  }
  assert(
    plan.some((item) => item.query.includes("copri telecamera")) &&
      plan.some((item) => item.query.includes("housse caméra")) &&
      plan.some((item) => item.query.includes("funda de cámara")) &&
      plan.some((item) => item.query.includes("Kameraabdeckung")) &&
      plan.some((item) => item.query.includes("camerahoes")),
    "reviewed localized camera-cover aliases must be used",
  );
  assert(
    plan.every((item) => !/customer|@|medichall/i.test(item.query)),
    "queries must contain product/market context only",
  );
});

Deno.test("C-Arm and Microscope families generate their own reviewed terms", () => {
  const cArmPlan = buildPublicWebSearchPlan({
    productFamily: cArm,
    targetCountries: ["FR"],
    maximumQueries: 2,
  });
  const microscopePlan = buildPublicWebSearchPlan({
    productFamily: microscope,
    targetCountries: ["DE"],
    maximumQueries: 2,
  });
  assert(
    cArmPlan.some((item) => /arceau|amplificateur/i.test(item.query)),
    "C-Arm localized family terms are missing",
  );
  assert(
    microscopePlan.some((item) => /Mikroskop/i.test(item.query)),
    "Microscope localized family terms are missing",
  );
});

Deno.test("Brave success uses only the official API contract and normalizes domains", async () => {
  let observedUrl = "";
  let observedToken = "";
  const provider = createBraveSearchProvider({
    apiKey: "fixture-secret-not-a-real-key",
    fetchImpl: (request, init) => {
      observedUrl = String(request);
      observedToken = new Headers(init?.headers).get("X-Subscription-Token") ||
        "";
      return Promise.resolve(response({
        web: {
          results: [{
            title: "Camera Covers | QA Medical S.R.L.",
            url:
              "https://www.qa-medical.it/products/camera-covers?utm_source=fixture",
            description: "not retained",
          }, {
            title: "Duplicate",
            url: "https://qa-medical.it/another-page",
          }],
        },
      }));
    },
  });
  const query = buildPublicWebSearchPlan({
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 1,
  });
  const result = await provider.searchCompanies({
    queries: query,
    maxResults: 6,
    timeoutMs: 100,
  });
  assert(result.requestsMade === 1, "one bounded provider request expected");
  assert(
    result.batches[0].candidates.length === 1,
    "domain duplicates must collapse",
  );
  assert(
    result.batches[0].candidates[0].pageUrl ===
      "https://www.qa-medical.it/products/camera-covers",
    "tracking parameters must be removed",
  );
  const url = new URL(observedUrl);
  assert(url.hostname === "api.search.brave.com", "official endpoint required");
  assert(url.searchParams.get("country") === "IT", "country targeting missing");
  assert(
    url.searchParams.get("search_lang") === "it",
    "language targeting missing",
  );
  assert(url.searchParams.get("count") === "6", "result cap missing");
  assert(
    url.searchParams.get("safesearch") === "strict",
    "strict safe search missing",
  );
  assert(
    observedToken === "fixture-secret-not-a-real-key",
    "server header missing",
  );
  assert(
    !observedUrl.includes(observedToken),
    "secret must never enter URL/query",
  );
});

Deno.test("directory, marketplace, social, PDF, and non-HTTPS results are rejected", () => {
  for (
    const url of [
      "https://linkedin.com/company/qa",
      "https://medicalexpo.com/qa",
      "https://amazon.com/qa",
      "https://qa-medical.it/catalogue.pdf",
      "http://qa-medical.it/products",
    ]
  ) {
    assert(
      normalizePublicWebResult({ title: "QA Medical", url }) === null,
      `${url} must not become an official-domain candidate`,
    );
  }
});

Deno.test("provider timeout fails closed without retry", async () => {
  const provider = createBraveSearchProvider({
    apiKey: "fixture",
    fetchImpl: (_request, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")));
      }),
  });
  const result = await provider.searchCompanies({
    queries: buildPublicWebSearchPlan({
      productFamily: camera,
      targetCountries: ["FR"],
      maximumQueries: 1,
    }),
    maxResults: 6,
    timeoutMs: 5,
  });
  assert(result.requestsMade === 1, "timeout must not retry");
  assert(
    result.batches[0].errorCode === "PROVIDER_TIMEOUT",
    "timeout must be redacted and classified",
  );
});

Deno.test("429/quota and repeated 5xx open the bounded circuit", async () => {
  const queries = buildPublicWebSearchPlan({
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 6,
  });
  const rateLimited = createBraveSearchProvider({
    apiKey: "fixture",
    fetchImpl: () => Promise.resolve(response({}, 429)),
  });
  const quota = await rateLimited.searchCompanies({
    queries,
    maxResults: 6,
    timeoutMs: 100,
  });
  assert(quota.circuitOpen, "429/quota must open the circuit");
  assert(quota.requestsMade <= 2, "429 must stop later query batches");
  assert(
    quota.batches.every((item) =>
      item.errorCode === "PROVIDER_RATE_LIMIT_OR_QUOTA"
    ),
    "quota response must use one redacted error code",
  );

  const serverFailure = createBraveSearchProvider({
    apiKey: "fixture",
    fetchImpl: () => Promise.resolve(response({}, 503)),
  });
  const failed = await serverFailure.searchCompanies({
    queries,
    maxResults: 6,
    timeoutMs: 100,
  });
  assert(failed.circuitOpen, "repeated 5xx must open the circuit");
  assert(failed.requestsMade <= 2, "5xx circuit must stop later batches");
});

Deno.test("malformed and zero-result payloads are distinct safe outcomes", async () => {
  let call = 0;
  const provider = createBraveSearchProvider({
    apiKey: "fixture",
    fetchImpl: () =>
      Promise.resolve(
        call++ === 0
          ? response("not-json")
          : response({ web: { results: [] } }),
      ),
  });
  const result = await provider.searchCompanies({
    queries: buildPublicWebSearchPlan({
      productFamily: camera,
      targetCountries: ["FR"],
      maximumQueries: 2,
    }),
    maxResults: 6,
    timeoutMs: 100,
  });
  assert(
    result.batches.some((item) =>
      item.errorCode === "PROVIDER_MALFORMED_RESPONSE"
    ),
    "malformed payload must be rejected",
  );
  assert(
    result.batches.some((item) => item.status === "ZERO_RESULTS"),
    "valid zero results must remain a cacheable non-error",
  );
});

Deno.test("provider disabled and missing configuration make zero requests", async () => {
  const cache = new MemoryCache();
  const disabled = await runPublicWebDiscovery({
    enabled: false,
    provider: null,
    cache,
    productFamily: camera,
    targetCountries: [],
  });
  const missing = await runPublicWebDiscovery({
    enabled: true,
    provider: null,
    cache,
    productFamily: camera,
    targetCountries: [],
  });
  assert(
    disabled.status === "DISABLED" && disabled.providerRequests === 0,
    "kill switch must perform no work",
  );
  assert(
    missing.status === "CONFIGURATION_UNAVAILABLE" && missing.unavailable &&
      missing.providerRequests === 0,
    "missing secret must degrade safely",
  );
});

Deno.test("unexpected provider failure degrades without breaking discovery", async () => {
  const failed = await runPublicWebDiscovery({
    enabled: true,
    provider: fixtureProvider(() => {
      throw new Error("fixture provider outage");
    }),
    cache: new MemoryCache(),
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 1,
  });
  assert(
    failed.status === "LIMITED" && failed.unavailable,
    "unexpected provider failure must become limited-source output",
  );
  assert(
    failed.rejectionReasons.PROVIDER_EXECUTION_FAILED === 1,
    "only a redacted provider failure code may be retained",
  );
});

Deno.test("cache hit avoids provider calls and cache expiry refreshes once", async () => {
  const cache = new MemoryCache();
  let calls = 0;
  const provider = fixtureProvider((input) => {
    calls += 1;
    return Promise.resolve({
      requestsMade: input.queries.length,
      circuitOpen: false,
      batches: input.queries.map((query) => ({
        query,
        status: "ACTIVE" as const,
        statusCode: 200,
        latencyMs: 3,
        resultsReceived: 1,
        rejectedCount: 0,
        errorCode: null,
        candidates: [{
          name: "QA Medical SRL",
          pageUrl: "https://qa-medical.it/camera-covers",
          canonicalDomain: "qa-medical.it",
          countryCode: "IT",
        }],
      })),
    });
  });
  const first = await runPublicWebDiscovery({
    enabled: true,
    provider,
    cache,
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 1,
    now: new Date("2026-08-24T00:00:00Z"),
  });
  const second = await runPublicWebDiscovery({
    enabled: true,
    provider,
    cache,
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 1,
    now: new Date("2026-08-25T00:00:00Z"),
  });
  assert(first.providerRequests === 1, "first run must call provider once");
  assert(
    second.providerRequests === 0 && second.cacheHits === 1,
    "identical cached intent must not call provider",
  );
  assert(calls === 1, "provider must be called once before cache expiry");

  for (const entry of cache.entries.values()) {
    entry.expiresAt = "2026-08-25T00:00:00Z";
  }
  const expired = await runPublicWebDiscovery({
    enabled: true,
    provider,
    cache,
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 1,
    now: new Date("2026-08-26T00:00:00Z"),
  });
  assert(
    expired.providerRequests === 1 && Number(calls) === 2,
    "expired cache must refresh exactly once",
  );
});

Deno.test("request keys change by product/market but remain stable for retries", async () => {
  const query = buildPublicWebSearchPlan({
    productFamily: camera,
    targetCountries: ["IT"],
    maximumQueries: 1,
  })[0];
  const one = await publicWebRequestKey("FIXTURE", camera.key, query);
  const retry = await publicWebRequestKey("FIXTURE", camera.key, query);
  const reordered = await publicWebRequestKey("FIXTURE", camera.key, {
    ...query,
    variant: query.variant + 7,
  });
  const reclassified = await publicWebRequestKey("FIXTURE", camera.key, {
    ...query,
    strategy: "SYNONYM",
  });
  const different = await publicWebRequestKey("FIXTURE", cArm.key, {
    ...query,
    query: query.query.replace("camera", "c-arm"),
  });
  assert(one === retry, "identical retry key must be stable");
  assert(
    one === reordered,
    "query ordinal must not create a duplicate provider request",
  );
  assert(
    one === reclassified,
    "internal strategy metadata must not create a duplicate provider request",
  );
  assert(one !== different, "legitimate product change must change cache key");
});

Deno.test("search hit alone never scores; verified official page can become DIRECT", () => {
  const prospects = publicWebCandidatesToProspects({
    candidates: [{
      name: "QA Medical SRL",
      pageUrl: "https://qa-medical.it/camera-covers",
      canonicalDomain: "qa-medical.it",
      countryCode: "IT",
    }],
    taxonomyIds: [336],
    targetCountries: ["IT"],
    partnerTypes: ["distributor"],
  });
  const unsupported = rankProspects(prospects, camera);
  assert(
    unsupported.accepted.length === 0,
    "candidate generation without verification must not qualify",
  );
  const websiteEvidence: ProspectEvidence = {
    sourceType: "COMPANY_WEBSITE",
    sourceUrl: "https://qa-medical.it/camera-covers",
    sourceDomain: "qa-medical.it",
    title: "QA Medical official product page",
    snippet: "Sterile Camera Cover and Camera Sleeve",
    evidenceKind: "WEAK_CONTEXT",
    confidence: 0.9,
    evidenceDate: "2026-08-24",
    taxonomyIds: [336],
  };
  prospects[0].evidence.push(websiteEvidence);
  prospects[0].organizationType = "COMMERCIAL_COMPANY";
  prospects[0].identityConfidence = "MEDIUM";
  prospects[0].commercialIdentityVerified = true;
  prospects[0].taxonomyRelation = "exact";
  prospects[0].lastEvidenceAt = "2026-08-24";
  const verified = rankProspects(prospects, camera, {
    now: new Date("2026-08-24T00:00:00Z"),
  });
  assert(
    verified.accepted.length === 1,
    "official exact product page must qualify through the V2.1 gate",
  );
  assert(
    verified.accepted[0].score.directEvidenceCount === 1,
    "verified website must become DIRECT evidence",
  );
});

Deno.test("verified C-Arm and Microscope official pages remain DIRECT", () => {
  for (
    const [profile, label, url] of [
      [
        cArm,
        "Sterile C-Arm Cover and C-Arm Drape",
        "https://covers.example/c-arm",
      ],
      [
        microscope,
        "Microscope Cover and Microscope Drape",
        "https://covers.example/microscope",
      ],
    ] as const
  ) {
    const candidate = publicWebCandidatesToProspects({
      candidates: [{
        name: "QA Covers GmbH",
        pageUrl: url,
        canonicalDomain: "covers.example",
        countryCode: "DE",
      }],
      taxonomyIds: [1],
      targetCountries: ["DE"],
      partnerTypes: [],
    })[0];
    candidate.evidence.push({
      sourceType: "COMPANY_WEBSITE",
      sourceUrl: url,
      sourceDomain: "covers.example",
      title: "Official product page",
      snippet: label,
      evidenceKind: "WEAK_CONTEXT",
      confidence: 0.9,
      evidenceDate: "2026-08-24",
      taxonomyIds: [1],
    });
    candidate.organizationType = "COMMERCIAL_COMPANY";
    candidate.identityConfidence = "MEDIUM";
    candidate.commercialIdentityVerified = true;
    candidate.taxonomyRelation = "exact";
    candidate.lastEvidenceAt = "2026-08-24";
    const ranked = rankProspects([candidate], profile, {
      now: new Date("2026-08-24T00:00:00Z"),
    });
    assert(
      ranked.accepted.length === 1 &&
        ranked.accepted[0].score.directEvidenceCount === 1,
      `${profile.label} official evidence must remain DIRECT`,
    );
  }
});

Deno.test("verified procedure-pack company can become ADJACENT without an exact claim", () => {
  const candidate = publicWebCandidatesToProspects({
    candidates: [{
      name: "QA Procedure Packs Ltd",
      pageUrl: "https://qa-procedure-packs.example/products",
      canonicalDomain: "qa-procedure-packs.example",
      countryCode: "GB",
    }],
    taxonomyIds: [336],
    targetCountries: ["GB"],
    partnerTypes: [],
  })[0];
  candidate.evidence.push({
    sourceType: "COMPANY_WEBSITE",
    sourceUrl: "https://qa-procedure-packs.example/products",
    sourceDomain: "qa-procedure-packs.example",
    title: "Official procedure pack portfolio",
    snippet:
      "Custom procedure pack, surgical pack and surgical kit manufacturing",
    evidenceKind: "WEAK_CONTEXT",
    confidence: 0.9,
    evidenceDate: "2026-08-24",
    taxonomyIds: [336],
  });
  candidate.organizationType = "COMMERCIAL_COMPANY";
  candidate.identityConfidence = "MEDIUM";
  candidate.commercialIdentityVerified = true;
  candidate.lastEvidenceAt = "2026-08-24";
  const ranked = rankProspects([candidate], camera, {
    now: new Date("2026-08-24T00:00:00Z"),
  });
  assert(
    ranked.accepted.length === 1,
    "multiple procedure-pack concepts plus buyer archetype must qualify",
  );
  assert(
    ranked.accepted[0].score.commercialFitClassification ===
        "ADJACENT_COMMERCIAL_FIT" &&
      ranked.accepted[0].score.reasonSummary.includes(
        "exact current product availability is not claimed",
      ),
    "adjacent fit must never become an unsupported exact-product claim",
  );
});

Deno.test("generic imaging page and snippet-shaped metadata remain rejected", () => {
  const prospects = publicWebCandidatesToProspects({
    candidates: [{
      name: "Generic Imaging BV",
      pageUrl: "https://generic-imaging.nl/",
      canonicalDomain: "generic-imaging.nl",
      countryCode: "NL",
    }],
    taxonomyIds: [336],
    targetCountries: ["NL"],
    partnerTypes: [],
  });
  prospects[0].evidence.push({
    sourceType: "COMPANY_WEBSITE",
    sourceUrl: "https://generic-imaging.nl/",
    sourceDomain: "generic-imaging.nl",
    title: "Medical imaging systems",
    snippet: "Capital imaging equipment and radiology technology",
    evidenceKind: "WEAK_CONTEXT",
    confidence: 0.4,
    evidenceDate: "2026-08-24",
    taxonomyIds: [],
  });
  const ranked = rankProspects(prospects, camera);
  assert(
    ranked.accepted.length === 0,
    "generic imaging must not pass the product-family gate",
  );
  assert(
    ranked.diagnostics.productFamilyMismatchRejected === 1,
    "mismatch rejection must remain observable",
  );
});

Deno.test("cost and result budgets remain hard bounded", async () => {
  let observedQueries = 0;
  const provider = fixtureProvider((input) => {
    observedQueries = input.queries.length;
    return Promise.resolve({
      batches: [],
      requestsMade: input.queries.length,
      circuitOpen: false,
    });
  });
  const result = await runPublicWebDiscovery({
    enabled: true,
    provider,
    cache: new MemoryCache(),
    productFamily: camera,
    targetCountries: [],
    maximumQueries: 99,
    maximumCostUsd: 99,
  });
  assert(
    observedQueries <= PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
    "query budget must remain capped at ten",
  );
  assert(
    result.providerCostEstimateUsd <= 0.05,
    "provider cost estimate must remain at or below $0.05/run",
  );
});

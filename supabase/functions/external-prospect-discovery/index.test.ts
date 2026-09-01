import {
  discoveryCompletionStatus,
  handleExternalProspectDiscoveryRequest,
  legacyQueryProgressCount,
  mergeSignals,
  rankWebsiteVerificationCandidates,
  structuredFirst,
  structuredTexts,
  verifyWebsites,
  websiteEvidenceUrlScore,
} from "./index.ts";
import {
  normalizeActivitySignal,
  type ProspectCandidate,
  rankProspects,
} from "../_shared/external-prospect-discovery.ts";
import { buildProductFamilyProfile } from "../_shared/buyer-discovery-relevance-v2.ts";

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
  assertEquals(
    structuredFirst("68f41e37-55ab-4823-8e11-812345c70a2a"),
    "68f41e37-55ab-4823-8e11-812345c70a2a",
  );
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
      publicWebUnavailable: true,
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

Deno.test("PUBLIC_WEB merges by official domain with TED without adding search evidence", () => {
  const merged = mergeSignals(
    [{
      name: "QA Equipment Supplier SRL",
      countryCode: "IT",
      countryName: "Italy",
      cityRegion: null,
      companyType: "Distributor",
      websiteUrl: "https://qa-equipment.it/",
      registryIdentifier: null,
      description: "Camera cover award",
      evidence: [{
        sourceType: "TED_AWARD",
        sourceUrl: "https://ted.europa.eu/en/notice/-/detail/qa-web",
        sourceDomain: "ted.europa.eu",
        title: "Camera cover award",
        snippet: "Sterile camera covers",
        evidenceKind: "DIRECT_PRODUCT_EVIDENCE",
        confidence: 0.9,
        evidenceDate: "2026-08-01",
        discoveryReason: "DIRECT_PRODUCT_TERM_TED",
      }],
      activities: [],
      taxonomyIds: [336],
      taxonomyRelation: "exact",
      targetCountry: false,
      preferredCompanyType: false,
      relatedAwardCount: 1,
      lastEvidenceAt: "2026-08-01",
      discoverySources: ["PRODUCT_TED"],
      websiteVerificationUrls: ["https://qa-equipment.it/"],
    }],
    [],
    ["IT"],
    ["distributor"],
    [{
      name: "QA Equipment S.R.L.",
      countryCode: "IT",
      countryName: null,
      cityRegion: null,
      companyType: "Unknown",
      websiteUrl: "https://www.qa-equipment.it/products/camera-cover",
      registryIdentifier: null,
      description: null,
      evidence: [],
      activities: [],
      taxonomyIds: [336],
      taxonomyRelation: "none",
      targetCountry: true,
      preferredCompanyType: false,
      relatedAwardCount: 0,
      lastEvidenceAt: null,
      discoverySources: ["PUBLIC_WEB"],
      websiteVerificationUrls: [
        "https://www.qa-equipment.it/products/camera-cover",
      ],
    }],
  );
  assertEquals(merged.length, 1);
  assertEquals(merged[0].evidence.length, 1);
  assertEquals(
    merged[0].discoverySources?.sort(),
    ["PRODUCT_TED", "PUBLIC_WEB"],
  );
  assertEquals(
    merged[0].websiteVerificationUrls?.[0],
    "https://www.qa-equipment.it/products/camera-cover",
  );
});

Deno.test("PUBLIC_WEB exact returned page enters the canonical safe website verifier", async () => {
  const visited: string[] = [];
  const candidate: ProspectCandidate = {
    name: "QA Medical SRL",
    countryCode: "IT",
    countryName: "Italy",
    cityRegion: null,
    companyType: "Unknown",
    websiteUrl: "https://qa-medical.it/products/camera-covers",
    registryIdentifier: null,
    description: null,
    evidence: [],
    activities: [],
    taxonomyIds: [336],
    taxonomyRelation: "none",
    targetCountry: true,
    preferredCompanyType: false,
    relatedAwardCount: 0,
    lastEvidenceAt: null,
    discoverySources: ["PUBLIC_WEB"],
    websiteVerificationUrls: [
      "https://qa-medical.it/products/camera-covers",
    ],
  };
  const profile = buildProductFamilyProfile([{
    taxonomyId: 336,
    canonicalName: "Camera Covers",
    slug: "camera-covers",
    aliases: ["Camera Cover", "Camera Sleeve"],
  }]);
  const result = await verifyWebsites([candidate], profile, {
    now: new Date("2026-08-24T00:00:00Z"),
    resolver: () => Promise.resolve(["93.184.216.34"]),
    fetcher: (request) => {
      const url = String(request);
      visited.push(url);
      return Promise.resolve(
        url.endsWith("/robots.txt")
          ? new Response("User-agent: *\nAllow: /", { status: 200 })
          : new Response(
            "<html><title>Camera Covers</title><body>Official sterile Camera Cover and Camera Sleeve product portfolio. Medical device distributor.</body></html>",
            { status: 200, headers: { "Content-Type": "text/html" } },
          ),
      );
    },
  });
  assertEquals(
    visited.includes("https://qa-medical.it/products/camera-covers"),
    true,
  );
  assertEquals(result.publicWebChecked, 1);
  assertEquals(result.publicWebVerified, 1);
  assertEquals(
    candidate.evidence.some((item) =>
      item.sourceType === "COMPANY_WEBSITE" &&
      item.relevanceClass === "DIRECT"
    ),
    true,
  );
});

Deno.test("official product/company domains outrank directories and marketplaces before the fixed six-slot verifier", async () => {
  const candidate = (
    domain: string,
    score: number,
    domainClass: NonNullable<
      ProspectCandidate["websiteCandidateSignals"]
    >["domainClass"] = "LIKELY_OFFICIAL",
  ): ProspectCandidate => ({
    name: domain,
    countryCode: "GB",
    countryName: "United Kingdom",
    cityRegion: null,
    companyType: "Unknown",
    websiteUrl: `https://${domain}/products/sterile-surgical-gowns`,
    registryIdentifier: null,
    description: null,
    evidence: [],
    activities: [],
    taxonomyIds: [990002],
    taxonomyRelation: "none",
    targetCountry: true,
    preferredCompanyType: false,
    relatedAwardCount: 0,
    lastEvidenceAt: null,
    discoverySources: ["PUBLIC_WEB"],
    websiteVerificationUrls: [
      `https://${domain}/products/sterile-surgical-gowns`,
    ],
    websiteCandidateSignals: {
      verificationScore: score,
      domainClass,
      medicalContext: score >= 50,
      commercialRoleContext: score >= 50,
      productPageContext: score >= 50,
    },
  });
  const official = candidate("official-medical.co.uk", 96);
  const values = [
    candidate("wlw.de", 1, "DIRECTORY"),
    candidate("ebay.co.uk", 1, "MARKETPLACE"),
    candidate("generic-1.co.uk", 10),
    candidate("generic-2.co.uk", 11),
    candidate("generic-3.co.uk", 12),
    candidate("generic-4.co.uk", 13),
    candidate("generic-5.co.uk", 14),
    official,
  ];
  assertEquals(rankWebsiteVerificationCandidates(values)[0], official);
  assertEquals(
    websiteEvidenceUrlScore(
      "https://official-medical.co.uk/products/sterile-surgical-gowns",
    ) >
      websiteEvidenceUrlScore(
        "https://official-medical.co.uk/news/sterile-surgical-gowns",
      ),
    true,
  );
  const visited: string[] = [];
  const profile = buildProductFamilyProfile([{
    taxonomyId: 990002,
    canonicalName: "Sterile Surgical Gowns",
    slug: "sterile-surgical-gowns",
    aliases: ["Sterile Surgical Gown", "Surgical Gown"],
  }]);
  const result = await verifyWebsites(values, profile, {
    resolver: () => Promise.resolve(["93.184.216.34"]),
    fetcher: (request) => {
      const url = String(request);
      visited.push(url);
      return Promise.resolve(
        url.endsWith("/robots.txt")
          ? new Response("User-agent: *\nAllow: /")
          : new Response(
            `<script type="application/ld+json">{"@type":"Organization","name":"QA Medical Distribution"}</script><p>Medical device distributor product catalogue: sterile surgical gown.</p>`,
            { headers: { "Content-Type": "text/html" } },
          ),
      );
    },
  });
  assertEquals(result.verificationSlots, 6);
  assertEquals(result.verificationAttempted, 6);
  assertEquals(result.directoryDomainsSkipped, 1);
  assertEquals(result.marketplaceDomainsSkipped, 1);
  assertEquals(
    visited.some((url) => url.includes("official-medical.co.uk")),
    true,
  );
  assertEquals(visited.some((url) => url.includes("wlw.de")), false);
  assertEquals(visited.some((url) => url.includes("ebay.co.uk")), false);
});

Deno.test("same official domain combines product-page and commercial-role evidence without weakening GENERIC_ONLY", async () => {
  const profile = buildProductFamilyProfile([{
    taxonomyId: 990002,
    canonicalName: "Sterile Surgical Gowns",
    slug: "sterile-surgical-gowns",
    aliases: ["Sterile Surgical Gown", "Surgical Gown"],
  }]);
  const buildCandidate = (domain: string): ProspectCandidate => ({
    name: domain,
    countryCode: "GB",
    countryName: "United Kingdom",
    cityRegion: null,
    companyType: "Unknown",
    websiteUrl: `https://${domain}/products/sterile-surgical-gowns`,
    registryIdentifier: null,
    description: null,
    evidence: [],
    activities: [],
    taxonomyIds: [990002],
    taxonomyRelation: "none",
    targetCountry: true,
    preferredCompanyType: false,
    relatedAwardCount: 0,
    lastEvidenceAt: null,
    discoverySources: ["PUBLIC_WEB"],
    websiteVerificationUrls: [
      `https://${domain}/products/sterile-surgical-gowns`,
      `https://${domain}/about/distribution`,
    ],
    websiteCandidateSignals: {
      verificationScore: 90,
      domainClass: "LIKELY_OFFICIAL",
      medicalContext: true,
      commercialRoleContext: true,
      productPageContext: true,
    },
  });
  const distributor = buildCandidate("qa-gown-distributor.example");
  const verification = await verifyWebsites([distributor], profile, {
    resolver: () => Promise.resolve(["93.184.216.34"]),
    fetcher: (request) => {
      const url = String(request);
      if (url.endsWith("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /"));
      }
      if (url.endsWith("/about/distribution")) {
        return Promise.resolve(
          new Response(
            `<script type="application/ld+json">{"@type":"Organization","name":"QA Gown Distribution Ltd"}</script><p>Medical device distributor, importer and hospital supplier.</p>`,
            { headers: { "Content-Type": "text/html" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          `<h1>Sterile Surgical Gowns</h1><p>Disposable sterile surgical gown product range for operating rooms.</p>`,
          { headers: { "Content-Type": "text/html" } },
        ),
      );
    },
  });
  assertEquals(verification.publicWebVerified, 1);
  assertEquals(verification.productPagesFound >= 1, true);
  assertEquals(verification.commercialRolePagesFound >= 1, true);
  assertEquals(verification.combinedDomainEvidenceCount, 1);
  assertEquals(rankProspects([distributor], profile).accepted.length, 1);

  for (
    const channel of ["Importer", "Wholesaler", "Hospital supplier"] as const
  ) {
    const commercialChannel = structuredClone(distributor);
    commercialChannel.name = `QA ${channel}`;
    commercialChannel.companyType = channel;
    assertEquals(
      rankProspects([commercialChannel], profile).accepted.length,
      1,
    );
  }
  const manufacturerOnly = structuredClone(distributor);
  manufacturerOnly.name = "QA Gown Manufacturer";
  manufacturerOnly.companyType = "Manufacturer";
  manufacturerOnly.websiteUrl =
    "https://qa-gown-manufacturer.example/products/sterile-surgical-gowns";
  manufacturerOnly.websiteVerificationUrls = [manufacturerOnly.websiteUrl];
  manufacturerOnly.evidence = manufacturerOnly.evidence.map((item) => ({
    ...item,
    title: "QA Gown Manufacturing Ltd official website",
    sourceUrl:
      "https://qa-gown-manufacturer.example/products/sterile-surgical-gowns",
    sourceDomain: "qa-gown-manufacturer.example",
  }));
  assertEquals(rankProspects([manufacturerOnly], profile).accepted.length, 0);
  assertEquals(
    rankProspects([manufacturerOnly], profile).rejected[0]?.score
      .salesProspectClassification,
    "PRODUCT_RELEVANT_NOT_BUYER",
  );
  const hospital = structuredClone(distributor);
  hospital.name = "QA Public Hospital";
  hospital.companyType = "Unknown";
  hospital.organizationType = "HEALTHCARE_PROVIDER";
  hospital.websiteUrl =
    "https://qa-public-hospital.example/products/sterile-surgical-gowns";
  hospital.websiteVerificationUrls = [hospital.websiteUrl];
  hospital.evidence = hospital.evidence.map((item) => ({
    ...item,
    title: "QA Public Hospital product page",
    sourceUrl:
      "https://qa-public-hospital.example/products/sterile-surgical-gowns",
    sourceDomain: "qa-public-hospital.example",
  }));
  assertEquals(rankProspects([hospital], profile).accepted.length, 0);
  assertEquals(
    rankProspects([hospital], profile).rejected[0]?.score
      .salesProspectClassification,
    "END_BUYER_PROCUREMENT_SIGNAL",
  );

  const generic = buildCandidate("qa-generic-medical.example");
  generic.websiteVerificationUrls = [generic.websiteUrl!];
  const genericResult = await verifyWebsites([generic], profile, {
    resolver: () => Promise.resolve(["93.184.216.34"]),
    fetcher: (request) =>
      Promise.resolve(
        String(request).endsWith("/robots.txt")
          ? new Response("User-agent: *\nAllow: /")
          : new Response(
            `<script type="application/ld+json">{"@type":"Organization","name":"QA Generic Medical Ltd"}</script><p>Medical device distributor and healthcare supplier.</p>`,
            { headers: { "Content-Type": "text/html" } },
          ),
      ),
  });
  assertEquals(genericResult.generic, 1);
  assertEquals(rankProspects([generic], profile).accepted.length, 0);
  const fashion = buildCandidate("qa-fashion-gowns.example");
  fashion.companyType = "Reseller";
  fashion.commercialIdentityVerified = true;
  fashion.organizationType = "COMMERCIAL_COMPANY";
  fashion.evidence = [{
    sourceType: "COMPANY_WEBSITE",
    sourceUrl: "https://qa-fashion-gowns.example/products/fashion-gown",
    sourceDomain: "qa-fashion-gowns.example",
    title: "Fashion gown retailer",
    snippet: "Consumer fashion and graduation gown retail store",
    evidenceKind: "WEAK_CONTEXT",
    relevanceClass: "GENERIC",
    confidence: 0.8,
    evidenceDate: "2026-09-01",
    taxonomyIds: [],
  }];
  assertEquals(rankProspects([fashion], profile).accepted.length, 0);
});

Deno.test("vNext combined retrieval fits the expanded production progress constraint", () => {
  assertEquals(legacyQueryProgressCount(6), 6);
  assertEquals(legacyQueryProgressCount(4), 4);
  assertEquals(legacyQueryProgressCount(20), 16);
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
    [{
      name: "QA Medical Trading",
      countryCode: "PL",
      countryName: "Poland",
      cityRegion: null,
      companyType: "Unknown",
      websiteUrl: "https://qa-medical-trading.pl/camera-covers",
      registryIdentifier: null,
      description: null,
      evidence: [],
      activities: [],
      taxonomyIds: [1],
      taxonomyRelation: "none",
      targetCountry: true,
      preferredCompanyType: false,
      relatedAwardCount: 0,
      lastEvidenceAt: null,
      discoverySources: ["PUBLIC_WEB"],
      websiteVerificationUrls: [
        "https://qa-medical-trading.pl/camera-covers",
      ],
    }],
  );
  assertEquals(merged.length, 1);
  assertEquals(merged[0].evidence.length, 2);
  assertEquals(merged[0].activities.length, 1);
  assertEquals(merged[0].discoverySources?.includes("PUBLIC_WEB"), true);
});

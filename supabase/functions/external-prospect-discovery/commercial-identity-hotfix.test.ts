import {
  chooseTrustedCompanyIdentity,
  mergeProspectCandidate,
  type ProspectCandidate,
  type ProspectEvidence,
  rankProspects,
} from "../_shared/external-prospect-discovery.ts";
import { buildProductFamilyProfile } from "../_shared/buyer-discovery-relevance-v2.ts";
import { buildTemporaryProductFamilyProfile } from "../_shared/unknown-product-resolution.ts";
import {
  normalizePublicWebResult,
  publicWebCandidatesToProspects,
} from "../_shared/public-web-discovery.ts";
import {
  analyzeOfficialWebsitePage,
  extractOfficialWebsiteIdentity,
  verifyWebsites,
} from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function profile(label: string) {
  return buildProductFamilyProfile([{
    taxonomyId: 990001,
    canonicalName: label,
    slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    aliases: [label],
  }]);
}

function publicCandidate(
  label: string,
  domain = "qa-commercial.example",
): ProspectCandidate {
  return publicWebCandidatesToProspects({
    candidates: [{
      name: label,
      identitySource: "PAGE_METADATA",
      pageUrl: `https://${domain}/products/${
        label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      }`,
      canonicalDomain: domain,
      countryCode: "GB",
    }],
    taxonomyIds: [990001],
    targetCountries: ["GB"],
    partnerTypes: [],
  })[0];
}

function tedEvidence(label: string): ProspectEvidence {
  return {
    sourceType: "TED_AWARD",
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/qa-commercial",
    sourceDomain: "ted.europa.eu",
    title: `${label} procurement award`,
    snippet: `Award for supply of ${label}`,
    evidenceKind: "DIRECT_PRODUCT_EVIDENCE",
    relevanceClass: "DIRECT",
    confidence: 0.92,
    evidenceDate: "2026-08-25",
    noticeId: "qa-commercial",
    matchedTerms: [label],
    taxonomyIds: [990001],
  };
}

Deno.test("A-E: page, product, category, and article titles never become company identity", () => {
  const rejected = [
    "Foley Catheter: Ce que vous devez savoir",
    "Bone Cement Mixing and Dispensing Systems",
    "Laparoscopic Trocars",
    "ECG Electrodes",
    "Anesthesia Breathing Circuits",
  ];
  for (const title of rejected) {
    const html =
      `<html><head><title>${title}</title><meta property="og:title" content="${title}"><script type="application/ld+json">{"@type":"Product","name":"${title}"}</script></head><body><h1>${title}</h1></body></html>`;
    assert(
      extractOfficialWebsiteIdentity(html, "qa-products.example") === null,
      `${title} must not become company identity`,
    );
  }
  const normalized = normalizePublicWebResult({
    title: "Foley Catheter: What You Need to Know | QA Health",
    url: "https://qa-health.co.uk/health/foley-catheter",
  });
  assert(
    normalized?.name === "qa-health.co.uk" &&
      normalized.identitySource === "DOMAIN_FALLBACK",
    "search result title must be discarded as identity",
  );
});

Deno.test("F-I: registry/TED/schema/site metadata hierarchy and domain fallback are deterministic", () => {
  const schema = extractOfficialWebsiteIdentity(
    `<script type="application/ld+json">{"@type":"Organization","legalName":"QA Medical Europe S.R.L."}</script><title>Camera Covers</title>`,
    "qa-medical.example",
  );
  const site = extractOfficialWebsiteIdentity(
    `<meta property="og:site_name" content="QA MedTech"><title>Product catalogue</title>`,
    "qa-medtech.example",
  );
  assert(
    schema?.source === "SCHEMA_ORG" &&
      schema.name === "QA Medical Europe S.R.L.",
    "schema Organization legal name must be HIGH-confidence identity",
  );
  assert(
    site?.source === "OFFICIAL_WEBSITE" && site.name === "QA MedTech",
    "clearly site-level metadata must be MEDIUM-confidence identity",
  );
  assert(
    analyzeOfficialWebsitePage(
          `<script type="application/ld+json">{"@type":"Organization","name":"QA Medical Europe S.R.L."}</script>Medical device manufacturer`,
          "qa-medical.example",
        ).identityConfidence === "HIGH" &&
      analyzeOfficialWebsitePage(
          `<meta property="og:site_name" content="QA MedTech">Medical device distributor`,
          "qa-medtech.example",
        ).identityConfidence === "MEDIUM",
    "identity confidence must follow the source hierarchy",
  );
  assert(
    analyzeOfficialWebsitePage(
      `<meta property="og:site_name" content="QA Dispositivi"><p>Distributore e fornitore di dispositivi medici.</p>`,
      "qa-dispositivi.example",
    ).commercialIdentityVerified,
    "reviewed European commercial organization wording must remain usable",
  );
  assert(
    chooseTrustedCompanyIdentity({
      currentName: "Verified TED Supplier Ltd",
      currentSource: "TED_ECONOMIC_OPERATOR",
      proposedName: "QA Site Brand",
      proposedSource: "SCHEMA_ORG",
    }).name === "Verified TED Supplier Ltd",
    "schema identity must not replace TED economic-operator identity",
  );
  assert(
    chooseTrustedCompanyIdentity({
      currentName: "Official Registry Legal SA",
      currentSource: "OFFICIAL_REGISTRY",
      proposedName: "Verified TED Supplier Ltd",
      proposedSource: "TED_ECONOMIC_OPERATOR",
    }).name === "Official Registry Legal SA",
    "TED identity must not replace registry legal identity",
  );
  const cached = publicCandidate("Old Product Page Title");
  assert(
    cached.name === "qa-commercial.example" &&
      cached.nameSource === "DOMAIN_FALLBACK",
    "legacy PAGE_METADATA cache entries must sanitize to domain fallback",
  );
});

Deno.test("H-I: bounded homepage identity works and weak commercial identity stays a clean domain", async () => {
  const ecg = profile("ECG Electrode");
  const homepageIdentity = publicCandidate(
    "ECG Electrodes",
    "qa-homepage-identity.example",
  );
  const domainFallback = publicCandidate(
    "ECG Electrodes",
    "qa-domain-fallback.example",
  );
  for (const candidate of [homepageIdentity, domainFallback]) {
    const domain = new URL(candidate.websiteUrl!).hostname;
    const result = await verifyWebsites([candidate], ecg, {
      now: new Date("2026-08-25T00:00:00Z"),
      resolver: () => Promise.resolve(["93.184.216.34"]),
      fetcher: (request) => {
        const url = String(request);
        if (url.endsWith("/robots.txt")) {
          return Promise.resolve(new Response("User-agent: *\nAllow: /"));
        }
        if (url === `https://${domain}/`) {
          return Promise.resolve(
            new Response(
              domain.includes("homepage-identity")
                ? `<meta property="og:site_name" content="QA Medical Distribution Europe"><p>Medical device distributor and wholesaler.</p>`
                : `<p>Medical device distributor and wholesaler product catalogue.</p>`,
              { headers: { "Content-Type": "text/html" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            `<title>ECG Electrodes</title><h1>ECG Electrode</h1><p>Official ECG Electrode product details.</p>`,
            { headers: { "Content-Type": "text/html" } },
          ),
        );
      },
    });
    assert(
      result.organizationRequests === 1 && result.publicWebVerified === 1,
      "one bounded homepage check must establish the commercial organization",
    );
  }
  assert(
    homepageIdentity.name === "QA Medical Distribution Europe" &&
      homepageIdentity.nameSource === "OFFICIAL_WEBSITE" &&
      homepageIdentity.identityConfidence === "MEDIUM",
    "consistent homepage site identity must be used",
  );
  assert(
    domainFallback.name === "qa-domain-fallback.example" &&
      domainFallback.nameSource === "DOMAIN_FALLBACK" &&
      domainFallback.identityConfidence === "LOW",
    "commercial host with weak identity must display its clean domain",
  );
});

Deno.test("J-L: editorial hospital content is rejected, exact procurement survives, and manufacturers remain valid", async () => {
  const foley = profile("Foley Catheter");
  const editorial = publicCandidate("Foley Catheter: What You Need to Know");
  const visited: string[] = [];
  const verification = await verifyWebsites([editorial], foley, {
    now: new Date("2026-08-25T00:00:00Z"),
    resolver: () => Promise.resolve(["93.184.216.34"]),
    fetcher: (request) => {
      const url = String(request);
      visited.push(url);
      if (url.endsWith("/robots.txt")) {
        return Promise.resolve(new Response("User-agent: *\nAllow: /"));
      }
      if (url === "https://qa-commercial.example/") {
        return Promise.resolve(
          new Response(
            `<script type="application/ld+json">{"@type":"Hospital","name":"QA Cleveland Clinic"}</script><p>Hospital patient care and appointments.</p>`,
            { headers: { "Content-Type": "text/html" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          `<title>Foley Catheter: What You Need to Know</title><h1>Foley Catheter</h1><script type="application/ld+json">{"@type":"MedicalWebPage","name":"Foley Catheter: What You Need to Know","publisher":{"@type":"Organization","name":"QA Cleveland Clinic"}}</script><p>Patient education guide about Foley Catheter care and information about medical device suppliers.</p>`,
          { headers: { "Content-Type": "text/html" } },
        ),
      );
    },
  });
  assert(
    verification.identityRejected === 1 &&
      verification.editorialRejected === 1 &&
      rankProspects([editorial], foley).accepted.length === 0,
    "hospital patient education alone must not qualify",
  );
  assert(
    verification.organizationRequests === 1 && visited.length === 3,
    "organization verification must be bounded to robots, result page, and one homepage",
  );

  const hospitalProcurement = publicCandidate("Foley Catheter");
  hospitalProcurement.evidence.push(tedEvidence("Foley Catheter"));
  hospitalProcurement.taxonomyRelation = "exact";
  hospitalProcurement.lastEvidenceAt = "2026-08-25";
  hospitalProcurement.organizationType = "HEALTHCARE_PROVIDER";
  hospitalProcurement.editorialContent = true;
  assert(
    rankProspects([hospitalProcurement], foley, {
      now: new Date("2026-08-25T00:00:00Z"),
    }).rejected[0]?.score.salesProspectClassification ===
      "END_BUYER_PROCUREMENT_SIGNAL",
    "exact TED procurement must preserve a hospital as an end-buyer signal, not a direct sales prospect",
  );

  const manufacturer = publicCandidate("Foley Catheter");
  const manufacturerVerification = await verifyWebsites(
    [manufacturer],
    foley,
    {
      now: new Date("2026-08-25T00:00:00Z"),
      resolver: () => Promise.resolve(["93.184.216.34"]),
      fetcher: (request) =>
        Promise.resolve(
          String(request).endsWith("/robots.txt")
            ? new Response("User-agent: *\nAllow: /")
            : new Response(
              `<script type="application/ld+json">{"@type":"Corporation","name":"QA Device Manufacturing Ltd"}</script><h1>Foley Catheter</h1><p>Medical device manufacturer, OEM supplier and distributor of Foley Catheter systems.</p>`,
              { headers: { "Content-Type": "text/html" } },
            ),
        ),
    },
  );
  assert(
    manufacturerVerification.publicWebVerified === 1 &&
      manufacturer.name === "QA Device Manufacturing Ltd" &&
      rankProspects([manufacturer], foley).accepted.length === 1,
    "commercial manufacturers must remain eligible",
  );
});

Deno.test("M-R: direct product evidence and commercial identity are separate gates; registry-only and titles remain insufficient", () => {
  const foley = profile("Foley Catheter");
  const unverified = publicCandidate("Foley Catheter");
  unverified.evidence.push({
    ...tedEvidence("Foley Catheter"),
    sourceType: "COMPANY_WEBSITE",
    sourceUrl: "https://qa-commercial.example/foley-catheter",
    sourceDomain: "qa-commercial.example",
    noticeId: null,
  });
  unverified.taxonomyRelation = "exact";
  assert(
    rankProspects([unverified], foley).accepted.length === 0,
    "raw page relevance without verified commercial identity must fail closed",
  );
  unverified.commercialIdentityVerified = true;
  unverified.organizationType = "COMMERCIAL_COMPANY";
  unverified.companyType = "Distributor";
  assert(
    rankProspects([unverified], foley).accepted.length === 1,
    "the same product evidence may qualify only after commercial identity and channel-role verification",
  );

  const registry = publicCandidate("Foley Catheter");
  registry.discoverySources = ["REGISTRY"];
  registry.evidence = [{
    ...tedEvidence("Medical device wholesale"),
    sourceType: "PUBLIC_REGISTRY",
    sourceUrl: "https://registry.example/company/qa",
    sourceDomain: "registry.example",
    evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
    relevanceClass: "GENERIC",
    noticeId: null,
  }];
  assert(
    rankProspects([registry], foley).accepted.length === 0,
    "registry-only activity must remain non-product evidence",
  );
});

Deno.test("S-Z: six unknown-product fixtures resolve commercial identity without page-title leakage or duplicate entities", async () => {
  const labels = [
    "Arterial Venous Set",
    "ECG Electrode",
    "Foley Catheter",
    "Laparoscopy Trocar",
    "Bone Cement Mixing System",
    "Anesthesia Breathing Circuit",
  ];
  for (const [index, label] of labels.entries()) {
    const domain = `qa-commercial-${index}.example`;
    const candidate = publicCandidate(label, domain);
    const unknownProfile = buildTemporaryProductFamilyProfile({
      phrase: label,
      intentHash: (index + 1).toString(16).padStart(64, "0"),
    });
    const result = await verifyWebsites([candidate], unknownProfile, {
      now: new Date("2026-08-25T00:00:00Z"),
      resolver: () => Promise.resolve(["93.184.216.34"]),
      fetcher: (request) =>
        Promise.resolve(
          String(request).endsWith("/robots.txt")
            ? new Response("User-agent: *\nAllow: /")
            : new Response(
              `<title>${label}</title><h1>${label}</h1><script type="application/ld+json">{"@type":"Product","name":"${label}","manufacturer":{"@type":"Organization","name":"QA Commercial ${index} Ltd"}}</script><p>Medical device manufacturer and distributor. Product catalogue: ${label}.</p>`,
              { headers: { "Content-Type": "text/html" } },
            ),
        ),
    });
    assert(result.publicWebVerified === 1, `${label} must verify commercially`);
    assert(
      candidate.name === `QA Commercial ${index} Ltd` &&
        candidate.name !== label && candidate.nameSource === "SCHEMA_ORG",
      `${label} page title must not leak into company identity`,
    );
    assert(
      rankProspects([candidate], unknownProfile).accepted.length === 1,
      `${label} must preserve bounded unknown-product discovery`,
    );
    const duplicate = { ...candidate, evidence: [...candidate.evidence] };
    mergeProspectCandidate(candidate, duplicate);
    assert(
      candidate.name === `QA Commercial ${index} Ltd`,
      `${label} merge must preserve the trusted identity`,
    );
  }
});

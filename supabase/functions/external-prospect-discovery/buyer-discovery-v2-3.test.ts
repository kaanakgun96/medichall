import {
  boundedTedSearchPlan,
  deduplicateCandidates,
  normalizeActivitySignal,
  normalizeLegalCompanyName,
  type ProspectCandidate,
  type ProspectEvidence,
  rankProspects,
  sanitizeEvidenceText,
} from "../_shared/external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  classifyEvidenceForProduct,
  reviewedEquipmentCoverTerms,
} from "../_shared/buyer-discovery-relevance-v2.ts";
import {
  buildPublicWebSearchPlan,
  publicWebCandidatesToProspects,
  publicWebRequestKey,
} from "../_shared/public-web-discovery.ts";
import {
  extractOfficialWebsiteIdentity,
  extractTedCandidatesFromNotice,
  mergeSignals,
} from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const camera = buildProductFamilyProfile([{
  taxonomyId: 336,
  canonicalName: "Camera Covers",
  slug: "camera-covers",
  aliases: reviewedEquipmentCoverTerms("camera"),
}]);
const cArm = buildProductFamilyProfile([{
  taxonomyId: 335,
  canonicalName: "C-Arm Covers",
  slug: "c-arm-covers",
  aliases: reviewedEquipmentCoverTerms("c_arm"),
}]);
const microscope = buildProductFamilyProfile([{
  taxonomyId: 337,
  canonicalName: "Microscope Drapes",
  slug: "microscope-drapes",
  aliases: reviewedEquipmentCoverTerms("microscope"),
}]);
const gown = buildProductFamilyProfile([{
  taxonomyId: 400,
  canonicalName: "Sterile Surgical Gowns",
  slug: "sterile-surgical-gowns",
  aliases: ["Sterile Surgical Gown"],
}]);

function evidence(
  snippet: string,
  sourceType: ProspectEvidence["sourceType"] = "COMPANY_WEBSITE",
  overrides: Partial<ProspectEvidence> = {},
): ProspectEvidence {
  return {
    sourceType,
    sourceUrl: sourceType === "TED_AWARD"
      ? "https://ted.europa.eu/en/notice/-/detail/qa-v2-3"
      : sourceType === "PUBLIC_REGISTRY"
      ? "https://registry.example/qa-v2-3"
      : "https://qa-medical.example/products",
    sourceDomain: sourceType === "TED_AWARD"
      ? "ted.europa.eu"
      : sourceType === "PUBLIC_REGISTRY"
      ? "registry.example"
      : "qa-medical.example",
    title: "Synthetic public business evidence",
    snippet,
    evidenceKind: "WEAK_CONTEXT",
    confidence: sourceType === "TED_AWARD" ? 0.9 : 0.85,
    evidenceDate: "2026-08-24",
    taxonomyIds: [336],
    ...overrides,
  };
}

function candidate(
  evidenceRows: ProspectEvidence[],
  overrides: Partial<ProspectCandidate> = {},
): ProspectCandidate {
  return {
    name: "QA Medical S.R.L.",
    nameSource: "TED_ECONOMIC_OPERATOR",
    countryCode: "IT",
    countryName: "Italy",
    cityRegion: null,
    companyType: "Distributor",
    websiteUrl: null,
    registryIdentifier: null,
    description: "Synthetic V2.3 fixture",
    evidence: evidenceRows,
    activities: [],
    taxonomyIds: [336],
    taxonomyRelation: "exact",
    targetCountry: true,
    preferredCompanyType: true,
    relatedAwardCount:
      evidenceRows.filter((item) => item.sourceType === "TED_AWARD").length,
    lastEvidenceAt: "2026-08-24",
    discoverySources: ["PRODUCT_TED"],
    websiteVerificationUrls: [],
    ...overrides,
  };
}

function classification(term: string, profile = camera): string {
  return classifyEvidenceForProduct(evidence(term), profile).relevanceClass ||
    "GENERIC";
}

Deno.test("V2.3 A-I: reviewed Camera Cover aliases are DIRECT while generic camera words are not", () => {
  const aliases = [
    "Camera Cover",
    "Camera Drape",
    "Sterile Camera Sleeve",
    "Endoscopic Camera Cover",
    "Copri telecamera",
    "Housse caméra",
    "Funda de cámara",
    "Sterile Kameraabdeckung",
    "Camera hoes",
  ];
  for (const alias of aliases) {
    assert(classification(alias) === "DIRECT", `${alias} must be DIRECT`);
  }
  for (const generic of ["camera", "video", "endoscopy", "medical imaging"]) {
    assert(
      classification(generic) === "GENERIC",
      `${generic} must not become product evidence`,
    );
  }
});

Deno.test("V2.3 J-L: aliases share one intent/cache and sibling cover products stay ADJACENT", async () => {
  assert(camera.key === "camera-cover-family", "Camera intent key changed");
  assert(
    buildProductFamilyProfile([{
      canonicalName: "Camera Covers",
      slug: "camera-covers",
      aliases: ["Sterile Camera Sleeve", "Copri telecamera"],
    }]).key === camera.key,
    "approved aliases must retain the canonical Camera Cover intent key",
  );
  assert(
    classification("Sterile C-Arm Cover") === "ADJACENT" &&
      classification("Surgical Microscope Drape") === "ADJACENT",
    "sibling equipment covers must be adjacent to Camera Cover",
  );
  assert(
    classification("Sterile C-Arm Cover", cArm) === "DIRECT" &&
      classification("Surgical Microscope Drape", microscope) === "DIRECT",
    "C-Arm and Microscope exact intent distinctions must be preserved",
  );
  const query = buildPublicWebSearchPlan({
    productFamily: camera,
    targetCountries: ["IT"],
  })[0];
  const one = await publicWebRequestKey("BRAVE_SEARCH_API", camera.key, query);
  const retry = await publicWebRequestKey(
    "BRAVE_SEARCH_API",
    camera.key,
    query,
  );
  assert(one === retry, "identical normalized intent retries must reuse cache");
});

Deno.test("V2.3 M-Q: procurement can qualify without a website; registry, broad CPV, and imaging cannot", () => {
  const productSearch = boundedTedSearchPlan({
    directTerms: camera.directTerms,
    adjacentTerms: camera.adjacentTerms,
    cpvCodes: ["33140000"],
    targetCountries: ["IT"],
  }).find((item) => item.retrievalKind === "PRODUCT_TERMS")!;
  const exactTed = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "qa-v2-3-direct",
      "publication-date": "2026-08-24",
      "notice-title": { eng: "Sterile camera cover award" },
      "description-lot": { eng: "Supply of sterile camera sleeves" },
      "classification-cpv": ["33140000"],
      "winner-name": { eng: ["QA Procurement Supplier S.R.L."] },
      "winner-country": ["ITA"],
      "buyer-name": { eng: ["QA Hospital Authority"] },
    },
    search: productSearch,
    targetTaxonomyIds: [336],
    targetCpvCodes: ["33140000"],
    productFamily: camera,
  }).candidates[0];
  const exactScore = rankProspects([exactTed], camera, {
    now: new Date("2026-08-25T00:00:00Z"),
  });
  assert(exactTed.websiteUrl === null, "fixture must have no website");
  assert(
    exactScore.accepted[0]?.score.qualificationPath === "PUBLIC_PROCUREMENT",
    "exact procurement must independently qualify",
  );

  const adjacentTed = candidate([
    evidence(
      "Custom procedure pack manufacturer supplying sterile equipment drapes and surgical kits",
      "TED_AWARD",
      { noticeId: "qa-adjacent" },
    ),
  ], { companyType: "Manufacturer", taxonomyRelation: "family" });
  const adjacentScore = rankProspects([adjacentTed], camera, {
    now: new Date("2026-08-25T00:00:00Z"),
  });
  assert(
    adjacentScore.accepted[0]?.score.qualificationPath ===
      "COMMERCIAL_ADJACENCY",
    "strong procedure-pack component fit must qualify as adjacent",
  );

  const registryOnly = candidate([
    evidence("Medical device wholesaler", "PUBLIC_REGISTRY"),
  ], {
    taxonomyIds: [],
    taxonomyRelation: "none",
    discoverySources: ["REGISTRY"],
  });
  const cpvOnly = candidate([
    evidence("General hospital equipment award", "TED_AWARD", {
      cpvCodes: ["33140000"],
      discoveryReason: "RELATED_CPV_TED",
    }),
  ], {
    taxonomyIds: [],
    taxonomyRelation: "none",
    discoverySources: ["CPV_TED"],
  });
  const imaging = candidate([
    evidence("C-arm imaging system and radiology capital equipment"),
  ], { taxonomyIds: [], taxonomyRelation: "none" });
  for (
    const [label, value] of [
      ["registry-only", registryOnly],
      ["broad CPV", cpvOnly],
      ["generic imaging", imaging],
    ] as const
  ) {
    assert(
      rankProspects([value], camera).accepted.length === 0,
      `${label} must remain rejected`,
    );
  }
});

Deno.test("V2.3 R-S/W-X: a Public Web snippet is not evidence; verified website and gown behavior remain intact", () => {
  const snippetOnly = publicWebCandidatesToProspects({
    candidates: [{
      name: "QA Search Result",
      identitySource: "PAGE_METADATA",
      pageUrl: "https://qa-search.example/camera-covers",
      canonicalDomain: "qa-search.example",
      countryCode: "IT",
    }],
    taxonomyIds: [336],
    targetCountries: ["IT"],
    partnerTypes: [],
  })[0];
  assert(
    rankProspects([snippetOnly], camera).accepted.length === 0,
    "search-provider metadata alone must never qualify",
  );
  const websiteDirect = candidate([
    evidence("Official sterile camera cover and camera sleeve catalogue"),
  ], { websiteUrl: "https://qa-medical.example/" });
  assert(
    rankProspects([websiteDirect], camera).accepted[0]?.score
      .qualificationPath ===
      "OFFICIAL_WEBSITE",
    "official website direct evidence must qualify",
  );
  const gownDirect = candidate([
    evidence("Sterile surgical gowns", "TED_AWARD"),
  ], { taxonomyIds: [400], taxonomyRelation: "exact" });
  const gownAdjacent = candidate([
    evidence("Custom procedure packs and surgical kits", "TED_AWARD"),
  ], {
    taxonomyIds: [400],
    taxonomyRelation: "family",
    companyType: "Manufacturer",
  });
  const gownGeneric = candidate([
    evidence("Robotic surgical technology and oncology imaging"),
  ], { taxonomyIds: [], taxonomyRelation: "none" });
  const gownRanking = rankProspects(
    [gownDirect, gownAdjacent, gownGeneric],
    gown,
  );
  assert(
    gownRanking.accepted.length === 2 && gownRanking.rejected.length === 1,
    "Gown direct, procedure-pack adjacent, and generic rejection must not regress",
  );
});

Deno.test("V2.3 source combinations do not require every source", () => {
  const registryActivity = normalizeActivitySignal({
    providerCode: "QA_REGISTRY",
    countryCode: "IT",
    nationalCode: "46.46",
    nationalClassification: "NACE",
    description: "Medical equipment wholesale",
  });
  const registry = evidence("Medical equipment wholesale", "PUBLIC_REGISTRY");
  const directTed = evidence("Sterile camera covers", "TED_AWARD", {
    noticeId: "qa-combination",
  });
  const directWebsite = evidence("Camera Covers listed in official catalogue");
  const adjacentTed = evidence(
    "Procedure pack manufacturer using sterile equipment covers",
    "TED_AWARD",
    { noticeId: "qa-combined-adjacent" },
  );
  const fixtures = [
    candidate([directTed]),
    candidate([directWebsite], { websiteUrl: "https://qa-medical.example/" }),
    candidate([directTed, registry], { activities: [registryActivity] }),
    candidate([directWebsite, registry], {
      activities: [registryActivity],
      websiteUrl: "https://qa-medical.example/",
    }),
    candidate([directTed, directWebsite], {
      websiteUrl: "https://qa-medical.example/",
    }),
    candidate([adjacentTed, registry], {
      activities: [registryActivity],
      taxonomyRelation: "family",
      companyType: "Manufacturer",
    }),
  ];
  for (const value of fixtures) {
    assert(
      rankProspects([value], camera).accepted.length === 1,
      "each supported independent source path must qualify without all sources",
    );
  }
  const combinedSupport = candidate([
    evidence("Supply of surgical equipment drapes", "TED_AWARD", {
      noticeId: "qa-combined-support",
    }),
    registry,
  ], {
    activities: [registryActivity],
    taxonomyRelation: "family",
    companyType: "Distributor",
  });
  assert(
    rankProspects([combinedSupport], camera).accepted[0]?.score
      .qualificationPath === "COMBINED_SUPPORT",
    "adjacent procurement plus supported archetype and strong registry context must expose the combined path",
  );
});

Deno.test("V2.3 T-V: trusted legal identity wins, domain fallback stays honest, and entities deduplicate", () => {
  assert(
    normalizeLegalCompanyName("Atlas Medical") === "atlas medical",
    "short legal-suffix tokens must not be stripped from ordinary names",
  );
  const schemaIdentity = extractOfficialWebsiteIdentity(
    `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","legalName":"QA Medical Europe S.R.L."}</script><title>Camera Covers</title></head></html>`,
    "qa-medical.it",
  );
  assert(
    schemaIdentity?.name === "QA Medical Europe S.R.L." &&
      schemaIdentity.source === "SCHEMA_ORG",
    "schema.org legalName must be preferred",
  );
  assert(
    extractOfficialWebsiteIdentity(
      "<html><title>Camera Covers</title></html>",
      "qa-medical.it",
    ) === null,
    "unreliable product title must retain the domain fallback",
  );
  const merged = mergeSignals(
    [
      candidate([evidence("Sterile camera covers", "TED_AWARD")], {
        name: "QA Medical S.R.L.",
        nameSource: "TED_ECONOMIC_OPERATOR",
        websiteUrl: null,
      }),
    ],
    [],
    ["IT"],
    [],
    [
      candidate([], {
        name: "qa-medical.it",
        nameSource: "DOMAIN_FALLBACK",
        websiteUrl: "https://qa-medical.it/camera-covers",
        discoverySources: ["PUBLIC_WEB"],
        websiteVerificationUrls: ["https://qa-medical.it/camera-covers"],
      }),
    ],
  );
  assert(
    merged.length === 1 && merged[0].name === "QA Medical S.R.L.",
    "TED legal name and domain-form Public Web entity must merge",
  );
  const deduped = deduplicateCandidates([
    merged[0],
    candidate([], {
      name: "QA Medical S.R.L",
      nameSource: "OFFICIAL_REGISTRY",
      websiteUrl: "https://www.qa-medical.it/",
    }),
  ]);
  assert(
    deduped.candidates.length === 1 && deduped.externalDuplicates === 1,
    "legal-suffix and domain variants must deduplicate",
  );
});

Deno.test("V2.3 Y-AA/AB: privacy, bounded requests, migration guards, and no generic aliases remain explicit", async () => {
  const plan = buildPublicWebSearchPlan({
    productFamily: camera,
    targetCountries: [],
  });
  const ted = boundedTedSearchPlan({
    directTerms: camera.directTerms,
    adjacentTerms: camera.adjacentTerms,
    cpvCodes: ["33100000", "33140000", "33190000"],
    targetCountries: [],
  });
  assert(
    plan.length <= 10 && ted.length <= 6,
    "vNext adaptive provider caps must remain bounded",
  );
  const tedProductTerms = new Set(
    ted.filter((item) => item.retrievalKind === "PRODUCT_TERMS")
      .flatMap((item) => item.terms),
  );
  for (
    const reviewed of [
      "copri telecamera",
      "housse camera",
      "funda de camara",
      "kameraabdeckung",
      "camerahoes",
    ]
  ) {
    assert(
      tedProductTerms.has(reviewed),
      `bounded TED subset must retain localized term: ${reviewed}`,
    );
  }
  assert(
    plan.some((item) => item.strategy === "ADJACENT") &&
      plan.some((item) => item.strategy === "LOCALIZED"),
    "bounded plan must diversify localized and adjacent discovery intent",
  );
  const adjacentQuery = plan.find((item) => item.strategy === "ADJACENT");
  assert(
    adjacentQuery?.query.includes(" OR "),
    "adjacent strategy must contain a reviewed family term, not only a label",
  );
  const sanitized = sanitizeEvidenceText(
    "name@example.org +39 02 1234 5678 Camera Cover",
  );
  assert(
    !sanitized.includes("@") && !sanitized.includes("1234 5678"),
    "contact coordinates must remain redacted",
  );
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/202608250001_buyer_discovery_v2_3_alias_expansion.sql",
      import.meta.url,
    ),
  );
  assert(
    migration.includes("Sterile Camera Sleeve") &&
      migration.includes("Copri telecamera") &&
      migration.includes("Sterile Medical Equipment Covers"),
    "forward migration must contain the reviewed persistent aliases",
  );
  assert(
    !/\('camera-covers',\s*'(?:camera|video|endoscopy|imaging)',/i.test(
      migration,
    ),
    "generic terms must never be inserted as product aliases",
  );
});

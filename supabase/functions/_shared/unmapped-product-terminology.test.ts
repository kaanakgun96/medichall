import assert from "node:assert/strict";
import {
  boundedTedSearchPlan,
  type ProspectCandidate,
  type ProspectEvidence,
  rankProspects,
} from "./external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  classifyEvidenceForProduct,
} from "./buyer-discovery-relevance-v2.ts";
import {
  buildPublicWebSearchPlan,
  PUBLIC_WEB_DISCOVERY_LIMITS,
  publicWebRequestKey,
} from "./public-web-discovery.ts";
import {
  buildTemporaryProductFamilyProfile,
  productPhraseSignature,
  resolveProductIntentDeterministically,
} from "./unknown-product-resolution.ts";

function profile(phrase: string, fill = "a") {
  return buildTemporaryProductFamilyProfile({
    phrase,
    intentHash: fill.repeat(64),
  });
}

function evidence(
  sourceType: ProspectEvidence["sourceType"],
  text: string,
): ProspectEvidence {
  return {
    sourceType,
    sourceUrl: sourceType === "TED_AWARD"
      ? "https://ted.europa.eu/en/notice/-/detail/qa-retrieval-v2"
      : sourceType === "PUBLIC_REGISTRY"
      ? "https://registry.example/qa-retrieval-v2"
      : "https://qa-renal.example/products/bloodline",
    sourceDomain: sourceType === "TED_AWARD"
      ? "ted.europa.eu"
      : sourceType === "PUBLIC_REGISTRY"
      ? "registry.example"
      : "qa-renal.example",
    title: text,
    snippet: text,
    evidenceKind: "WEAK_CONTEXT",
    confidence: 0.9,
    evidenceDate: "2026-08-25",
    taxonomyIds: [],
  };
}

function commercialCandidate(
  name: string,
  country: string,
  domain: string,
  productText: string,
): ProspectCandidate {
  return {
    name,
    nameSource: "SCHEMA_ORG",
    countryCode: country,
    countryName: country,
    cityRegion: null,
    companyType: "Distributor",
    websiteUrl: `https://${domain}/products`,
    registryIdentifier: null,
    description: "QA-owned fixture company",
    evidence: [{
      ...evidence("COMPANY_WEBSITE", productText),
      sourceUrl: `https://${domain}/products`,
      sourceDomain: domain,
    }],
    activities: [],
    taxonomyIds: [],
    taxonomyRelation: "none",
    targetCountry: true,
    preferredCompanyType: true,
    relatedAwardCount: 0,
    lastEvidenceAt: "2026-08-25",
    discoverySources: ["PUBLIC_WEB"],
    organizationType: "COMMERCIAL_COMPANY",
    identityConfidence: "HIGH",
    commercialIdentityVerified: true,
    editorialContent: false,
  };
}

Deno.test("Arterial Venous Set receives reviewed English and multilingual retrieval terms without a taxonomy mapping", () => {
  const temporary = profile("Arterial Venous Set");
  const plan = temporary.temporaryIntent;
  assert(plan);
  assert.equal(plan.familySignature, "hemodialysis-bloodline");
  const byLanguage = Object.groupBy(
    plan.retrievalTerms,
    (term) => term.language,
  );
  for (const language of ["en", "it", "fr", "de", "es", "pl"]) {
    assert(byLanguage[language]?.length, `${language} term is missing`);
  }
  assert.equal(byLanguage.nl, undefined, "unsupported Dutch term was invented");
  assert.equal(
    byLanguage.pt,
    undefined,
    "unsupported Portuguese term was invented",
  );
  for (const term of plan.retrievalTerms) {
    assert.match(term.confidence, /^(?:HIGH|MEDIUM)$/);
    assert.match(
      term.source,
      /^(?:APPROVED_ALIAS|TED_TERMINOLOGY|VERIFIED_PRODUCT_TERMINOLOGY|DETERMINISTIC_VARIANT)$/,
    );
    assert.equal(term.familySignature, "hemodialysis-bloodline");
  }
  assert(
    plan.retrievalTerms.some((term) =>
      term.term === "arterial venous bloodline set" &&
      term.confidence === "HIGH"
    ),
  );
  assert(
    plan.retrievalTerms.some((term) =>
      term.term === "kit de líneas de sangre para hemodiálisis" &&
      term.source === "TED_TERMINOLOGY"
    ),
  );
});

Deno.test("unmapped Public Web planning is ranked, country-aware, deduplicated, and capped at four requests / USD 0.02", () => {
  const temporary = profile("Arterial Venous Set");
  const europe = buildPublicWebSearchPlan({
    productFamily: temporary,
    targetCountries: [],
    maximumQueries: 4,
  });
  assert.equal(europe.length, 4);
  assert.equal(europe[0].strategy, "EXACT");
  assert.equal(europe[0].retrievalTerm, "arterial venous set");
  assert(europe.some((query) => query.strategy === "LOCALIZED"));
  assert.equal(
    new Set(europe.map((query) => query.retrievalTerm)).size,
    europe.length,
  );
  assert.equal(
    europe.length * PUBLIC_WEB_DISCOVERY_LIMITS.braveRequestCostUsd,
    0.02,
  );

  const france = buildPublicWebSearchPlan({
    productFamily: temporary,
    targetCountries: ["FR"],
    maximumQueries: 4,
  });
  assert(france.every((query) => query.country === "FR"));
  assert(
    france.some((query) =>
      query.language === "fr" && /hémodialyse/i.test(query.query)
    ),
  );
  assert(
    france.every((query) => !["it", "de", "es", "pl"].includes(query.language)),
    "country-specific plans must not spend requests on unrelated markets",
  );
});

Deno.test("identical safe variants reuse the same provider cache keys", async () => {
  const first = profile("Arterial Venous Set", "b");
  const second = profile("Arterial-Venous Sets", "b");
  assert.equal(
    productPhraseSignature(first.label),
    productPhraseSignature(second.label),
  );
  const firstPlan = buildPublicWebSearchPlan({
    productFamily: first,
    targetCountries: ["DE"],
    maximumQueries: 4,
  });
  const secondPlan = buildPublicWebSearchPlan({
    productFamily: second,
    targetCountries: ["DE"],
    maximumQueries: 4,
  });
  assert.deepEqual(firstPlan, secondPlan);
  assert.deepEqual(
    await Promise.all(
      firstPlan.map((query) => publicWebRequestKey("BRAVE", first.key, query)),
    ),
    await Promise.all(
      secondPlan.map((query) =>
        publicWebRequestKey("BRAVE", second.key, query)
      ),
    ),
  );
});

Deno.test("TED uses the reviewed unmapped terms without fabricated CPV or extra requests", () => {
  const temporary = profile("Arterial Venous Set");
  const terms =
    temporary.temporaryIntent?.retrievalTerms.map((term) => term.term) || [];
  const plan = boundedTedSearchPlan({
    directTerms: terms,
    adjacentTerms: [],
    cpvCodes: [],
    targetCountries: [],
  });
  assert(plan.length <= 4);
  assert(plan.every((query) => query.retrievalKind === "PRODUCT_TERMS"));
  assert(plan.every((query) => !query.query.includes("classification-cpv")));
  assert(
    plan.some((query) => query.query.includes("hemodialysis blood tubing set")),
  );
  assert(
    plan.some((query) => query.query.includes("Blutschlauchsysteme")),
  );
});

Deno.test("retrieval terms do not become evidence and product-family drift remains rejected", () => {
  const temporary = profile("Arterial Venous Set");
  for (
    const [text, expected] of [
      ["Hemodialysis blood tubing sets for chronic renal therapy", "DIRECT"],
      ["Hämodialyse A/V Blutschlauchsysteme", "DIRECT"],
      ["Generic dialysis equipment and clinical education", "GENERIC"],
      ["IV administration sets and infusion tubing", "GENERIC"],
      ["Arterial vascular catheters and venous cannulas", "GENERIC"],
    ] as const
  ) {
    assert.equal(
      classifyEvidenceForProduct(
        evidence("COMPANY_WEBSITE", text),
        temporary,
      ).relevanceClass,
      expected,
      text,
    );
  }
  assert.equal(
    classifyEvidenceForProduct(
      evidence(
        "PUBLIC_REGISTRY",
        "Hemodialysis blood tubing set wholesaler",
      ),
      temporary,
    ).relevanceClass,
    "GENERIC",
    "registry terminology must remain company-activity context only",
  );
});

Deno.test("compositional family rules generalize across unseen alternate wording without generic fuzzy terms", () => {
  const expectedFamilies: Record<string, string> = {
    "Dialysis Bloodline": "hemodialysis-bloodline",
    "AV Bloodline Set": "hemodialysis-bloodline",
    "ECG Lead Wire": "ecg-lead-wire",
    "Suction Connecting Tube": "surgical-suction-tubing",
    "Patient Heating Blanket": "patient-warming-blanket",
    "Surgical Camera Sheath": "surgical-camera-cover",
    "Urinary Collection Bag": "urinary-drainage-bag",
    "IV Extension Tubing": "iv-extension-tubing",
    "Arthroscopic Irrigation Tubing": "arthroscopy-irrigation-tubing",
    "Bone Cement Mixer": "bone-cement-mixing",
    "Surgical Suction Set": "surgical-suction-tubing",
    "ECG Electrode": "ecg-electrode",
    "Urinary Drainage Bag": "urinary-drainage-bag",
    "Patient Warming Blanket": "patient-warming-blanket",
    "Laparoscopy Trocar": "laparoscopy-trocar",
  };
  for (const [phrase, expectedFamily] of Object.entries(expectedFamilies)) {
    const temporary = profile(phrase, "c");
    assert.equal(
      temporary.temporaryIntent?.familySignature,
      expectedFamily,
      phrase,
    );
    assert(
      temporary.temporaryIntent?.retrievalTerms.length >= 2,
      `${phrase} did not expand`,
    );
    assert(
      temporary.directTerms.every((term) =>
        !["set", "cover", "tube", "tubing", "medical", "equipment"]
          .includes(term)
      ),
      `${phrase} generated a generic standalone term`,
    );
  }
});

Deno.test("local discovery fixtures qualify verified equivalent terminology and reject generic healthcare noise", () => {
  const fixtures = [
    ["Arterial Venous Set", "Hemodialysis blood tubing set"],
    ["Dialysis Bloodline", "AV bloodline set"],
    ["AV Bloodline Set", "Hemodialysis bloodline"],
    ["ECG Lead Wire", "EKG lead cable"],
    ["Suction Connecting Tube", "Surgical suction tubing set"],
    ["Patient Heating Blanket", "Patient warming blanket"],
    ["Surgical Camera Sheath", "Sterile camera sleeve"],
    ["Urinary Collection Bag", "Urinary drainage bag"],
    ["IV Extension Tubing", "Intravenous extension line"],
    ["Arthroscopic Irrigation Tubing", "Arthroscopy irrigation tubing set"],
    ["Bone Cement Mixer", "Bone cement mixing system"],
    ["Surgical Suction Set", "Suction connecting tube"],
    ["ECG Electrode", "EKG electrode"],
    ["Urinary Drainage Bag", "Urine collection bag"],
    ["Patient Warming Blanket", "Patient heating blanket"],
    ["Laparoscopy Trocar", "Laparoscopic trocar"],
  ] as const;
  for (const [index, [phrase, verifiedEquivalent]] of fixtures.entries()) {
    const temporary = profile(phrase, "d");
    const acceptedFixture = commercialCandidate(
      `QA Verified Medical ${index} Ltd`,
      index % 2 ? "FR" : "DE",
      `qa-verified-medical-${index}.example`,
      `${verifiedEquivalent}. Medical device manufacturer and distributor.`,
    );
    const genericFixture = commercialCandidate(
      `QA Generic Healthcare ${index} Ltd`,
      "GB",
      `qa-generic-healthcare-${index}.example`,
      "Generic healthcare services, hospital education and medical equipment.",
    );
    const ranking = rankProspects(
      [acceptedFixture, genericFixture],
      temporary,
      { now: new Date("2026-08-25T12:00:00Z") },
    );
    assert.equal(ranking.accepted.length, 1, phrase);
    assert.equal(ranking.rejected.length, 1, phrase);
    assert.equal(ranking.accepted[0].candidate.name, acceptedFixture.name);
    assert.equal(ranking.accepted[0].score.directEvidenceCount, 1);
    assert.equal(ranking.accepted[0].score.adjacentEvidenceCount, 0);
    assert.equal(ranking.diagnostics.genericOnlyRejected, 1);
  }
});

Deno.test("known taxonomy products still resolve before unmapped expansion", () => {
  const catalog = [
    {
      id: 1,
      canonicalName: "Camera Cover",
      slug: "camera-cover",
      nodeType: "category",
      aliases: ["Sterile Camera Sleeve"],
    },
    {
      id: 2,
      canonicalName: "C-Arm Cover",
      slug: "c-arm-cover",
      nodeType: "category",
      aliases: [],
    },
    {
      id: 3,
      canonicalName: "Microscope Cover",
      slug: "microscope-cover",
      nodeType: "category",
      aliases: [],
    },
    {
      id: 4,
      canonicalName: "Sterile Surgical Gown",
      slug: "sterile-surgical-gown",
      nodeType: "category",
      aliases: [],
    },
  ];
  for (
    const phrase of [
      "Camera Cover",
      "Sterile Camera Sleeve",
      "C-Arm Cover",
      "Microscope Cover",
      "Sterile Surgical Gown",
    ]
  ) {
    assert.equal(
      resolveProductIntentDeterministically(phrase, catalog).resolution,
      "high_confidence",
      phrase,
    );
  }
  assert.equal(
    buildProductFamilyProfile([{
      taxonomyId: 1,
      canonicalName: "Camera Cover",
      slug: "camera-cover",
      aliases: ["Sterile Camera Sleeve"],
    }]).temporaryIntent,
    undefined,
  );
});

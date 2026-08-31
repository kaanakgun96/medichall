import {
  type ProspectCandidate,
  type ProspectEvidence,
  rankProspects,
} from "./external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  type ProductFamilyProfile,
} from "./buyer-discovery-relevance-v2.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function candidate(input: {
  name: string;
  companyType?: ProspectCandidate["companyType"];
  sourceType?: ProspectEvidence["sourceType"];
  sourceUrl?: string;
  title: string;
  snippet: string;
  lotContext?: string;
  contractingAuthority?: boolean;
}): ProspectCandidate {
  const sourceType = input.sourceType || "COMPANY_WEBSITE";
  const sourceUrl = input.sourceUrl ||
    `https://${
      input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    }.example/products`;
  return {
    name: input.name,
    countryCode: "GB",
    countryName: "United Kingdom",
    cityRegion: null,
    companyType: input.companyType || "Unknown",
    websiteUrl: sourceType === "TED_AWARD" ? null : sourceUrl,
    registryIdentifier: null,
    description: input.snippet,
    evidence: [{
      sourceType,
      sourceUrl,
      sourceDomain: new URL(sourceUrl).hostname,
      title: input.title,
      snippet: input.snippet,
      lotContext: input.lotContext || input.snippet,
      evidenceKind: "WEAK_CONTEXT",
      confidence: 0.92,
      evidenceDate: "2026-08-29",
      noticeId: sourceType === "TED_AWARD" ? `qa-${input.name}` : null,
      procurementRole: sourceType === "TED_AWARD" &&
          !input.contractingAuthority
        ? "WINNER"
        : undefined,
      taxonomyIds: [991],
    }],
    activities: [],
    taxonomyIds: [991],
    taxonomyRelation: "exact",
    targetCountry: true,
    preferredCompanyType: false,
    relatedAwardCount: sourceType === "TED_AWARD" ? 1 : 0,
    lastEvidenceAt: "2026-08-29",
    organizationType: "COMMERCIAL_COMPANY",
    identityConfidence: "HIGH",
    commercialIdentityVerified: true,
  };
}

function grade(value: ProspectCandidate, profile: ProductFamilyProfile) {
  const ranked = rankProspects([value], profile, {
    now: new Date("2026-08-29T12:00:00Z"),
  });
  return (ranked.accepted[0] || ranked.rejected[0]).score;
}

const glove = buildProductFamilyProfile([{
  taxonomyId: 991,
  canonicalName: "Latex or nitrile examination glove for clinical use",
  slug: "temporary-medical-examination-glove",
  aliases: [
    "medical examination glove",
    "examination glove",
    "surgical glove",
    "nitrile glove",
    "latex glove",
    "glove",
  ],
}]);

const mesh = buildProductFamilyProfile([{
  taxonomyId: 992,
  canonicalName:
    "Polypropylene or composite mesh for abdominal wall hernia repair",
  slug: "temporary-abdominal-hernia-mesh",
  aliases: ["surgical mesh", "hernia mesh", "medical mesh", "mesh"],
}]);

Deno.test("product relevance and buyer role are independent final gates", () => {
  const manufacturer = grade(
    candidate({
      name: "QA Product Manufacturer",
      companyType: "Manufacturer",
      title: "Official surgical mesh catalogue",
      snippet: "Polypropylene surgical mesh for abdominal hernia repair.",
    }),
    mesh,
  );
  assert(
    manufacturer.commercialFitClassification === "DIRECT_PRODUCT_FIT" &&
      manufacturer.commercialBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER" &&
      !manufacturer.eligible && manufacturer.relevanceScore <= 54,
    "exact manufacturer product evidence must not prove buyer intent",
  );

  const distributor = grade(
    candidate({
      name: "QA Medical Distributor",
      companyType: "Distributor",
      title: "Official surgical mesh catalogue",
      snippet:
        "Medical distributor and importer of polypropylene surgical mesh for hernia repair.",
    }),
    mesh,
  );
  assert(
    distributor.commercialBuyerGrade === "DIRECT_BUYER" &&
      distributor.buyerRoleConfidence === "MEDIUM" && distributor.eligible,
    "product-specific distributor evidence must qualify",
  );

  const sourcingManufacturer = grade(
    candidate({
      name: "QA Private Label Manufacturer",
      companyType: "Manufacturer",
      title: "Private-label surgical mesh sourcing",
      snippet:
        "Manufacturer seeking OEM and private-label sourcing for surgical hernia mesh.",
    }),
    mesh,
  );
  assert(
    sourcingManufacturer.commercialBuyerGrade === "DIRECT_BUYER" &&
      sourcingManufacturer.eligible,
    "manufacturer with independent OEM/sourcing evidence may qualify",
  );
});

Deno.test("procurement organization remains a demand signal, not a direct sales prospect", () => {
  const procurement = grade(
    candidate({
      name: "NHS Supply Chain",
      sourceUrl:
        "https://www.supplychain.nhs.uk/product-information/contract-launch-brief/surgical-mesh/",
      title: "Surgical mesh contract launch",
      snippet:
        "Healthcare procurement and supply-chain contract for surgical mesh used in hernia repair.",
    }),
    mesh,
  );
  assert(
    procurement.commercialBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER" &&
      procurement.salesProspectClassification ===
        "END_BUYER_PROCUREMENT_SIGNAL" &&
      procurement.buyerRoleConfidence === "HIGH" && !procurement.eligible,
    "a product-specific procurement organization must remain a demand signal without becoming a direct sales account",
  );
});

Deno.test("hospital end buyer is a demand signal without direct onboarding evidence", () => {
  const hospital = grade(
    candidate({
      name: "QA University Hospital",
      title: "Hospital surgical mesh procurement",
      snippet:
        "Public hospital procurement programme purchasing surgical mesh for clinical use.",
    }),
    mesh,
  );
  assert(
    hospital.salesProspectClassification ===
        "END_BUYER_PROCUREMENT_SIGNAL" &&
      hospital.commercialBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER" &&
      !hospital.eligible,
    "a hospital purchaser is demand intelligence, not automatically a direct commercial account",
  );
});

Deno.test("TED contracting authority and awarded economic operator remain distinct", () => {
  const authority = grade(
    candidate({
      name: "QA Regional Hospital Authority",
      sourceType: "TED_AWARD",
      contractingAuthority: true,
      title: "Contracting authority glove procurement",
      snippet:
        "Public hospital group purchasing nitrile examination gloves for clinical use.",
    }),
    glove,
  );
  const supplier = grade(
    candidate({
      name: "QA Awarded Medical Supplier",
      sourceType: "TED_AWARD",
      title: "Awarded economic operator for examination gloves",
      snippet:
        "Contract supplier awarded the nitrile examination glove lot for hospital delivery.",
    }),
    glove,
  );
  assert(
    authority.salesProspectClassification ===
        "END_BUYER_PROCUREMENT_SIGNAL" && !authority.eligible,
    "the contracting authority must remain a demand signal",
  );
  assert(
    supplier.salesProspectClassification === "DIRECT_COMMERCIAL_PROSPECT" &&
      supplier.commercialBuyerGrade === "DIRECT_BUYER" && supplier.eligible,
    "the awarded supplier/economic operator may be a direct commercial prospect",
  );
});

Deno.test("explicit manufacturer onboarding can make a procurement body directly actionable", () => {
  const procurement = grade(
    candidate({
      name: "QA Healthcare Procurement Channel",
      title: "Surgical mesh supplier onboarding",
      snippet:
        "Healthcare procurement body with supplier registration and direct manufacturer onboarding for surgical mesh.",
    }),
    mesh,
  );
  assert(
    procurement.commercialBuyerGrade === "DIRECT_BUYER" &&
      procurement.salesProspectClassification ===
        "DIRECT_COMMERCIAL_PROSPECT" &&
      procurement.eligible,
    "specific direct manufacturer-onboarding evidence may establish a sales prospect",
  );
});

Deno.test("specific TED lot context overrides a broad glove title", () => {
  const falsePositive = grade(
    candidate({
      name: "QA Civil Defence Supplier",
      sourceType: "TED_AWARD",
      sourceUrl: "https://ted.europa.eu/qa/non-medical-gloves",
      title: "Framework agreement for medical equipment and gloves",
      snippet:
        "Awarded lot for flame-retardant combat gloves for civil defence.",
      lotContext: "Flame-retardant combat gloves for civil defence",
    }),
    glove,
  );
  assert(
    falsePositive.commercialBuyerGrade === "REJECTED" &&
      !falsePositive.eligible && falsePositive.directEvidenceCount === 0,
    "specific non-medical lot text must override a broad glove title",
  );

  const medicalAward = grade(
    candidate({
      name: "QA Clinical Supplier",
      sourceType: "TED_AWARD",
      sourceUrl: "https://ted.europa.eu/qa/medical-gloves",
      title: "Framework agreement for gloves",
      snippet:
        "Awarded lot for nitrile medical examination gloves for clinical use.",
      lotContext: "Nitrile medical examination gloves",
    }),
    glove,
  );
  assert(
    medicalAward.commercialBuyerGrade === "DIRECT_BUYER" &&
      medicalAward.eligible,
    "specific clinical glove award must remain a direct buyer",
  );
});

Deno.test("retained 15-company glove sample removes four non-medical false positives", () => {
  const retained = [
    [
      "Granqvist Sportartiklar Aktiebolag",
      "Flame-retardant combat and sports gloves for civil defence",
      false,
    ],
    [
      "Abena AB",
      "Disposable nitrile medical examination gloves for hospital operations",
      true,
    ],
    [
      "AST Medical AB",
      "Sterile surgical gloves and medical examination gloves",
      true,
    ],
    [
      "Bossers & Cnossen BV",
      "White-glove ICT logistics and camera equipment logistics",
      false,
    ],
    [
      "DELUXE MEDICRAFTS",
      "Medical examination gloves and sterile surgical gloves",
      true,
    ],
    [
      "MB JAMedica",
      "Surgical gloves and medical examination gloves for hospitals",
      true,
    ],
    [
      "MERCATOR MEDICAL",
      "Nitrile diagnostic and surgical medical gloves",
      true,
    ],
    [
      "Mercator Medical S.A.",
      "Medical examination and surgical nitrile gloves",
      true,
    ],
    [
      "Molnlycke Health Care AB",
      "Sterile surgical gloves for operating rooms",
      true,
    ],
    [
      "Onemed",
      "Disposable medical examination gloves and hospital supplies",
      true,
    ],
    [
      "Onemed Sverige AB",
      "Protective medical examination gloves for clinical use",
      true,
    ],
    [
      "SANROTEX TRADING SRL",
      "Medical examination gloves and sterile surgical gloves",
      true,
    ],
    ["Skamex SA", "Diagnostic nitrile and surgical medical gloves", true],
    [
      "Lyreco Advantage Sweden AB",
      "Cleaning products and industrial disposable work gloves",
      false,
    ],
    [
      "Martin Magnusson and Co AB",
      "Combat gloves and flame-retardant work gloves",
      false,
    ],
  ] as const;
  const results = retained.map(([name, snippet, medical]) => ({
    name,
    medical,
    score: grade(
      candidate({
        name,
        sourceType: "TED_AWARD",
        sourceUrl: `https://ted.europa.eu/qa/${
          name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        }`,
        title: "Awarded glove lot",
        snippet,
        lotContext: snippet,
      }),
      glove,
    ),
  }));
  assert(
    results.filter((item) => item.medical).every((item) =>
      item.score.commercialBuyerGrade === "DIRECT_BUYER" && item.score.eligible
    ),
    "all 11 product-specific medical glove suppliers must be preserved",
  );
  assert(
    results.filter((item) => !item.medical).every((item) =>
      item.score.commercialBuyerGrade === "REJECTED" && !item.score.eligible
    ),
    "all four retained non-medical glove false positives must be removed",
  );
});

Deno.test("retained mesh results separate buyer role from product relevance", () => {
  const retained = [
    candidate({
      name: "BioCer",
      companyType: "Manufacturer",
      sourceUrl: "https://biocer-gmbh.de/en/surgical-mesh/",
      title: "Surgical mesh",
      snippet: "Manufacturer of surgical mesh for abdominal hernia repair.",
    }),
    candidate({
      name: "Medical Sutures",
      sourceUrl: "https://medicalsutures.co.uk/products/wound-closure/",
      title: "Surgical mesh",
      snippet:
        "Official product portfolio for surgical hernia mesh and wound closure.",
    }),
    candidate({
      name: "NHS Supply Chain",
      sourceUrl:
        "https://www.supplychain.nhs.uk/product-information/contract-launch-brief/surgical-mesh/",
      title: "Surgical mesh contract launch",
      snippet:
        "Healthcare procurement and supply-chain contract for surgical mesh.",
    }),
  ];
  const results = retained.map((item) => ({
    name: item.name,
    score: grade(item, mesh),
  }));
  assert(
    results.find((item) => item.name === "NHS Supply Chain")?.score
          .salesProspectClassification === "END_BUYER_PROCUREMENT_SIGNAL" &&
      results.find((item) => item.name === "NHS Supply Chain")?.score
          .commercialBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER" &&
      !results.find((item) => item.name === "NHS Supply Chain")?.score
        .eligible,
    "NHS Supply Chain must remain a demand signal without ranking as a direct sales prospect",
  );
  for (const name of ["BioCer", "Medical Sutures"]) {
    const score = results.find((item) => item.name === name)?.score;
    assert(
      score?.commercialBuyerGrade === "PRODUCT_RELEVANT_NOT_BUYER" &&
        !score.eligible,
      `${name} must retain product relevance without unsupported buyer intent`,
    );
  }
});

Deno.test("known, procedure-pack, and temporary intents retain the buyer gate", () => {
  const camera = buildProductFamilyProfile([{
    taxonomyId: 993,
    canonicalName: "Camera Cover",
    slug: "camera-cover",
    aliases: ["sterile camera sleeve"],
  }]);
  const procedurePack = buildProductFamilyProfile([{
    taxonomyId: 994,
    canonicalName: "General Procedure Packs",
    slug: "general-procedure-packs",
    aliases: [],
  }]);
  const temporary: ProductFamilyProfile = {
    ...buildProductFamilyProfile([{
      canonicalName: "Arterial Venous Set",
      slug: "temporary-arterial-venous-set",
    }]),
    temporaryIntent: {
      normalizedPhrase: "arterial venous bloodline set",
      phraseSignature: "arterial-venous-bloodline-set",
      requiredTokens: ["arterial", "venous", "bloodline"],
      familySignature: "dialysis-bloodline",
      retrievalTerms: [],
    },
  };
  for (
    const [profile, phrase] of [
      [
        camera,
        "Medical distributor of sterile camera covers for operating rooms",
      ],
      [
        procedurePack,
        "Medical distributor of general procedure packs and procedure trays",
      ],
      [
        temporary,
        "Hospital supplier of arterial venous bloodline sets for hemodialysis",
      ],
    ] as const
  ) {
    const score = grade(
      candidate({
        name: `QA ${profile.label} Distributor`,
        companyType: "Distributor",
        title: `Official ${profile.label} catalogue`,
        snippet: phrase,
      }),
      profile,
    );
    assert(
      score.commercialBuyerGrade === "DIRECT_BUYER" && score.eligible,
      `${profile.label} must retain a valid product-plus-buyer path`,
    );
  }
});

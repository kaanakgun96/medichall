import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTenderLotMatches,
  type CompanyProductCandidate,
  LOT_MATCH_CALCULATION_VERSION,
  type LotMatchCompanyInput,
  normalizeTenderLots,
  scoreNormalizedLot,
} from "./lot-matching-v1.ts";

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    document_confidence_score: 92,
    missing_information: [],
    lots: [{
      lot_number: "1",
      lot_title: "Sterile nitrile examination gloves",
      estimated_quantity: 10_000,
      quantity_unit: "pieces",
    }],
    products: [{
      product_name: "Sterile nitrile examination gloves",
      normalized_product_name: "sterile nitrile examination gloves",
      lot_number: "1",
      quantity_value: 10_000,
      quantity_unit: "pieces",
      packaging: "Box of 100",
      sterility: "sterile",
      material: "nitrile",
      dimensions: "24 cm x 12 cm",
      required_certifications: ["CE"],
      technical_requirements: ["single use", "powder free"],
      confidence_score: 92,
      evidence: [{
        document_id: 41,
        page_number: 8,
        field_name: "product",
        source_quote: "Lot 1 sterile nitrile examination gloves",
        extracted_value: "Sterile nitrile examination gloves",
        confidence_score: 94,
      }],
    }],
    ...overrides,
  };
}

function product(
  overrides: Partial<CompanyProductCandidate> = {},
): CompanyProductCandidate {
  return {
    id: 101,
    ref: "MH-GLOVE-STERILE",
    name: "Sterile nitrile examination gloves",
    category: "Examination gloves",
    normalized_category: "medical_gloves",
    product_subtype: "examination gloves",
    description:
      "Powder free, single use sterile nitrile examination gloves supplied in a box of 100.",
    material: "nitrile",
    dimensions: "240 mm × 120 mm",
    sterility: true,
    single_use: true,
    reusable: false,
    packaging: "Box of 100",
    units_per_package: 100,
    certifications: ["CE"],
    regulatory_class: "Class I",
    sterilization_method: "EO",
    production_capacity: 25_000,
    capacity_unit: "pieces",
    capacity_period: "month",
    extra_specifications: ["powder free", "single use"],
    ...overrides,
  };
}

function company(
  products: CompanyProductCandidate[] = [product()],
  certifications: string[] = ["ISO 13485"],
): LotMatchCompanyInput {
  return {
    company_id: 11,
    company_name: "MedicHall Test Manufacturer",
    company_certifications: certifications,
    products,
  };
}

function score(
  extractionOverrides: Record<string, unknown> = {},
  companyInput = company(),
) {
  const lots = normalizeTenderLots(extraction(extractionOverrides));
  assert.equal(lots.length, 1);
  return scoreNormalizedLot(lots[0], companyInput);
}

test("scores an exact rich medical-device lot match strongly", () => {
  const result = score();
  assert.ok(result.match_score >= 85);
  assert.equal(result.recommendation, "strong_match");
  assert.equal(result.best_company_product_id, 101);
  assert.equal(result.score_components.sterility.status, "matched");
  assert.equal(result.score_components.dimensions.status, "matched");
  assert.equal(result.calculation_version, LOT_MATCH_CALCULATION_VERSION);
});

test("missing company specifications remain unknown rather than contradictory", () => {
  const result = score(
    {},
    company([
      product({
        description: null,
        material: null,
        dimensions: null,
        extra_specifications: [],
      }),
    ]),
  );
  assert.equal(
    result.score_components.technical_specification.status,
    "unknown",
  );
  assert.ok(
    result.unknowns.some((item) =>
      item.code === "company_technical_specifications_missing"
    ),
  );
  assert.ok(
    !result.blockers.some((item) => item.code === "material_contradiction"),
  );
});

test("explicit technical contradictions become hard blockers", () => {
  const result = score(
    {},
    company([
      product({
        description:
          "Powdered single use sterile nitrile examination gloves in a box of 100.",
        extra_specifications: ["powdered"],
      }),
    ]),
  );
  assert.ok(
    result.blockers.some((item) =>
      item.code === "technical_powder_contradiction"
    ),
  );
  assert.ok(result.match_score <= 29);
  assert.equal(result.recommendation, "not_recommended");
});

test("sterility contradiction is a hard blocker", () => {
  const result = score({}, company([product({ sterility: false })]));
  assert.ok(
    result.blockers.some((item) => item.code === "sterility_contradiction"),
  );
  assert.ok(result.match_score <= 29);
});

test("explicitly absent mandatory certification is a blocker", () => {
  const result = score(
    {},
    company([
      product({ certifications: ["ISO 13485"] }),
    ], []),
  );
  assert.ok(
    result.blockers.some((item) =>
      item.code === "mandatory_certification_absent"
    ),
  );
  assert.ok(result.match_score <= 29);
});

test("selects the highest-scoring company catalog candidate", () => {
  const unrelated = product({
    id: 202,
    name: "Reusable stainless surgical tray",
    category: "Surgical trays",
    description: "Reusable non-sterile stainless tray.",
    material: "stainless steel",
    sterility: false,
    single_use: false,
    reusable: true,
    packaging: null,
    certifications: [],
  });
  const result = score({}, company([unrelated, product()]));
  assert.equal(result.best_company_product_id, 101);
  assert.equal(result.best_company_product_name, product().name);
});

test("deduplicates identical evidence references and keeps best confidence", () => {
  const duplicate = {
    document_id: 41,
    page_number: 8,
    field_name: "product",
    source_quote: "Lot 1 sterile nitrile examination gloves",
    extracted_value: "Sterile nitrile examination gloves",
    confidence_score: 99,
  };
  const sourceProduct = {
    ...(extraction().products as Record<string, unknown>[])[0],
    evidence: [
      ...((extraction().products as Record<string, unknown>[])[0]
        .evidence as unknown[]),
      duplicate,
    ],
  };
  const lot = normalizeTenderLots(extraction({ products: [sourceProduct] }))[0];
  assert.equal(lot.evidence.length, 1);
  assert.equal(lot.evidence[0].confidence_score, 99);
});

test("preserves the same product name in different numbered lots", () => {
  const baseProduct = (extraction().products as Record<string, unknown>[])[0];
  const lots = normalizeTenderLots(extraction({
    lots: [
      { lot_number: "1", lot_title: "Gloves small" },
      { lot_number: "2", lot_title: "Gloves large" },
    ],
    products: [
      { ...baseProduct, lot_number: "1", dimensions: "20 cm x 10 cm" },
      { ...baseProduct, lot_number: "2", dimensions: "26 cm x 13 cm" },
    ],
  }));
  assert.deepEqual(lots.map((lot) => lot.lot_key), ["lot:1", "lot:2"]);
  assert.equal(lots[0].tender_products.length, 1);
  assert.equal(lots[1].tender_products.length, 1);
});

test("caps confidence when extraction evidence is incomplete", () => {
  const complete = score();
  const incompleteProduct = {
    ...(extraction().products as Record<string, unknown>[])[0],
    confidence_score: 30,
    evidence: [],
  };
  const incomplete = score({
    document_confidence_score: 30,
    missing_information: ["document evidence"],
    products: [incompleteProduct],
  });
  assert.ok(incomplete.confidence_score < complete.confidence_score);
  assert.ok(incomplete.confidence_score <= 45);
});

test("produces byte-equivalent logical results for unchanged inputs", () => {
  const lots = normalizeTenderLots(extraction());
  const first = calculateTenderLotMatches(lots, company());
  const second = calculateTenderLotMatches(lots, company());
  assert.deepEqual(first, second);
});

test("isolates a single lot calculation failure", () => {
  const sourceProduct = (extraction().products as Record<string, unknown>[])[0];
  const lots = normalizeTenderLots(extraction({
    lots: [
      { lot_number: "1", lot_title: "First" },
      { lot_number: "2", lot_title: "Second" },
    ],
    products: [
      { ...sourceProduct, lot_number: "1" },
      { ...sourceProduct, lot_number: "2" },
    ],
  }));
  const results = calculateTenderLotMatches(
    lots,
    company(),
    (lot, companyInput) => {
      if (lot.lot_key === "lot:1") throw new Error("isolated failure");
      return scoreNormalizedLot(lot, companyInput);
    },
  );
  assert.equal(results[0].status, "failed");
  assert.equal(results[1].status, "completed");
});

test("normalization and scoring never call document AI or the network", () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("network access is forbidden in deterministic matching");
  }) as typeof fetch;
  try {
    const lots = normalizeTenderLots(extraction());
    calculateTenderLotMatches(lots, company());
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

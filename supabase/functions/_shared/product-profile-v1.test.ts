import assert from "node:assert/strict";
import test from "node:test";
import { mapCompanyProduct } from "./lot-matching-service.ts";
import {
  calculateTenderLotMatches,
  type LotMatchCompanyInput,
  normalizeTenderLots,
} from "./lot-matching-v1.ts";
import {
  calculateProductReadiness,
  canonicalizeProductProfile,
  deriveProductProfile,
  normalizeCertifications,
  normalizeDimensions,
  normalizeSterility,
  normalizeUseType,
  PRODUCT_READINESS_VERSION,
} from "./product-profile-v1.ts";
import {
  buildBackfillReport,
  validateProductWrite,
} from "./product-profile-service.ts";

test("normalizes explicit EO sterile wording without an AI call", () => {
  const result = normalizeSterility("EO sterile medical drape");
  assert.equal(result.value, "sterile");
  assert.equal(result.sterilization_method, "EO");
  assert.equal(result.ambiguous, false);
});

test("normalizes explicit English and Turkish non-sterile wording", () => {
  assert.equal(normalizeSterility("non-sterile gown").value, "non_sterile");
  assert.equal(
    normalizeSterility("steril olmayan ürün").value,
    "non_sterile",
  );
});

test("distinguishes single-use and reusable Turkish wording", () => {
  assert.equal(normalizeUseType("tek kullanımlık").value, "single_use");
  assert.equal(
    normalizeUseType("tekrar kullanılabilir").value,
    "reusable",
  );
});

test("leaves weak and contradictory wording unknown", () => {
  assert.equal(
    normalizeSterility("Sterilization assurance product").value,
    "unknown",
  );
  const conflict = normalizeSterility(
    "Non-sterile gown. Description says sterile product.",
  );
  assert.equal(conflict.value, "unknown");
  assert.equal(conflict.ambiguous, true);
});

test("normalizes metric dimensions to deterministic millimetres", () => {
  assert.deepEqual(
    normalizeDimensions("75 cm × 60 cm; 0.9 m x 750 mm"),
    ["750 mm x 600 mm", "900 mm x 750 mm"],
  );
});

test("normalizes certification spelling while preserving distinct standards", () => {
  assert.deepEqual(
    normalizeCertifications([
      "CE marked; ISO13485",
      "EN 13795-1 and EU MDR 2017/745",
    ]),
    ["CE", "ISO 13485", "EN 13795-1", "EU MDR 2017/745"],
  );
});

test("keeps company and product-specific certifications separate", () => {
  const product = mapCompanyProduct({
    id: 7,
    name: "Sterile surgical drape",
    category: "Medical Devices",
    product_certifications: ["EN 13795-1"],
    matching_profile_sources: {
      product_certifications: "explicit",
    },
  });
  assert.ok(product);
  assert.deepEqual(product.certifications, ["EN 13795-1"]);
  const company: LotMatchCompanyInput = {
    company_id: 11,
    company_name: "Test company",
    company_certifications: ["ISO 13485"],
    products: [product],
  };
  assert.deepEqual(company.company_certifications, ["ISO 13485"]);
  assert.deepEqual(company.products[0].certifications, ["EN 13795-1"]);
});

test("calculates weighted deterministic product readiness", () => {
  const result = calculateProductReadiness({
    name: "Sterile epidural surgical drape",
    normalized_category: "epidural_surgical_drapes",
    product_subtype: "epidural drape",
    material: "non-woven + PE",
    dimensions: "750 mm x 600 mm",
    sterility_status: "sterile",
    use_type: "single_use",
    packaging_description: "Individual package",
    units_per_package: 1,
    product_certifications: ["EN 13795-1"],
    regulatory_class: "Class Is",
    sterilization_method: "EO",
    production_capacity: 10000,
    capacity_unit: "pieces",
    capacity_period: "month",
    technical_specifications: ["2 layers"],
  });
  assert.equal(result.score, 100);
  assert.deepEqual(result.critical_missing_fields, []);
  assert.equal(result.calculation_version, PRODUCT_READINESS_VERSION);
});

test("backfill derives only unambiguous values and reports conflicts", () => {
  const report = buildBackfillReport([
    {
      id: 1,
      ref: "DRAPE-1",
      name: "Sterile surgical drape 75 cm x 60 cm",
      category: "Medical Devices",
      description: "Single-use non-woven and PE drape.",
    },
    {
      id: 2,
      ref: "GOWN-1",
      name: "Non-Sterile Gown",
      category: "Medical Devices",
      description: "Sterile, single-use surgical product.",
    },
  ]);
  assert.equal(report.products_inspected, 2);
  assert.equal(report.fields_safely_derived.normalized_category, 2);
  assert.equal(report.fields_safely_derived.dimensions, 1);
  assert.equal(report.ambiguous_fields_skipped.sterility_status, 1);
  const conflict = report.changes.find((change) => change.product_id === 2);
  assert.ok(conflict?.ambiguous_fields.includes("sterility_status"));
  assert.equal(
    conflict?.proposed_values.sterility_status,
    undefined,
  );
});

test("existing basic product rows remain valid and incomplete", () => {
  const profile = canonicalizeProductProfile({
    name: "Legacy catalog product",
    category: "Medical Devices",
    description: "Legacy description",
  });
  const readiness = calculateProductReadiness({
    name: "Legacy catalog product",
    category: "Medical Devices",
    ...profile,
  });
  assert.equal(profile.sterility_status, "unknown");
  assert.equal(profile.use_type, "unknown");
  assert.ok(readiness.score < 50);
  assert.ok(readiness.critical_missing_fields.length > 0);
});

test("safe product writes reject unsupported and incomplete values", () => {
  assert.throws(
    () =>
      validateProductWrite({
        ref: "A",
        name: "Product",
        category: "Medical Devices",
        image_url: "javascript:alert(1)",
        profile: {},
      }, 11),
    /HTTPS URL/,
  );
  assert.throws(
    () =>
      validateProductWrite({
        ref: "A",
        name: "Product",
        category: "Medical Devices",
        profile: {
          production_capacity: 1000,
          capacity_unit: "pieces",
        },
      }, 11),
    /must be supplied together/,
  );
});

test("structured product fields materially improve matching while irrelevant products stay low", () => {
  const lots = normalizeTenderLots({
    document_confidence_score: 90,
    products: [{
      product_name: "Sterile epidural surgical drape",
      normalized_product_name: "sterile epidural surgical drape",
      lot_number: "29",
      dimensions: "75 cm x 60 cm",
      material: "non-woven + PE",
      sterility: "Sterile, single-use",
      required_certifications: ["EN 13795-1"],
      technical_requirements: ["2 layers", "adhesive opening"],
      packaging: "Individual packaging",
      confidence_score: 90,
      evidence: [{
        document_id: 1,
        page_number: 41,
        field_name: "product_name",
        source_quote: "Sterile epidural surgical drape",
        confidence_score: 90,
      }],
    }],
  });
  const structured = mapCompanyProduct({
    id: 10,
    ref: "DRAPE-29",
    name: "Sterile epidural surgical drape",
    category: "Medical Devices",
    normalized_category: "epidural_surgical_drapes",
    product_subtype: "epidural drape",
    description: "Two-layer drape with adhesive opening.",
    material: "non-woven + PE",
    dimensions: "750 mm x 600 mm",
    sterility_status: "sterile",
    use_type: "single_use",
    packaging_description: "Individual packaging",
    product_certifications: ["EN 13795-1"],
    technical_specifications: ["2 layers", "adhesive opening"],
    matching_profile_sources: {
      normalized_category: "explicit",
      material: "explicit",
      dimensions: "explicit",
      sterility_status: "explicit",
      use_type: "explicit",
      packaging_description: "explicit",
      product_certifications: "explicit",
      technical_specifications: "explicit",
    },
  });
  const irrelevant = mapCompanyProduct({
    id: 11,
    ref: "PROBE",
    name: "Ultrasound probe cover",
    category: "Medical Devices",
    normalized_category: "ultrasound_probe_covers",
    sterility_status: "unknown",
    use_type: "unknown",
    matching_profile_sources: {
      normalized_category: "explicit",
      sterility_status: "unknown",
      use_type: "unknown",
    },
  });
  assert.ok(structured && irrelevant);
  const structuredScore = calculateTenderLotMatches(lots, {
    company_id: 11,
    company_name: "Test",
    company_certifications: [],
    products: [structured],
  })[0];
  const irrelevantScore = calculateTenderLotMatches(lots, {
    company_id: 11,
    company_name: "Test",
    company_certifications: [],
    products: [irrelevant],
  })[0];
  assert.equal(structuredScore.status, "completed");
  assert.equal(irrelevantScore.status, "completed");
  if (
    structuredScore.status !== "completed" ||
    irrelevantScore.status !== "completed"
  ) throw new Error("Expected completed lot scores.");
  assert.ok(structuredScore.match_score >= 70);
  assert.ok(structuredScore.match_score >= irrelevantScore.match_score + 40);
  assert.ok(irrelevantScore.match_score <= 29);
});

test("normalization and readiness never call tender document AI or the network", () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("network forbidden");
  }) as typeof fetch;
  try {
    deriveProductProfile({
      name: "EO sterile single-use surgical drape 75 cm x 60 cm",
      category: "Medical Devices",
      description: "Non-woven + PE",
    });
    calculateProductReadiness({
      name: "Surgical drape",
      normalized_category: "surgical_drapes",
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

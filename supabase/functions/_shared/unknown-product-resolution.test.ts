import assert from "node:assert/strict";
import {
  buildTemporaryProductFamilyProfile,
  normalizeUnknownProductPhrase,
  productPhraseSignature,
  resolveProductIntentDeterministically,
  unmappedWebsiteProductSuggestions,
  validateUnmappedMedicalProductPhrase,
} from "./unknown-product-resolution.ts";
import { classifyEvidenceForProduct } from "./buyer-discovery-relevance-v2.ts";
import type { ProspectEvidence } from "./external-prospect-discovery.ts";

const catalog = [
  {
    id: 10,
    parentId: 1,
    canonicalName: "Camera Covers",
    slug: "camera-covers",
    nodeType: "category",
    description: "Sterile protective covers and sleeves for surgical cameras.",
    parentName: "Equipment Covers",
    aliases: ["Sterile Camera Sleeve", "Copri Telecamera"],
  },
  {
    id: 20,
    parentId: 2,
    canonicalName: "Fluid Collection Pouches",
    slug: "fluid-collection-pouches",
    nodeType: "category",
    description: "Sterile pouches for surgical fluid collection.",
    parentName: "Drainage and Fluid Management",
    aliases: ["Fluid Collection Pouch"],
  },
  {
    id: 30,
    parentId: 3,
    canonicalName: "Surgical Suction Tubing Sets",
    slug: "surgical-suction-tubing-sets",
    nodeType: "category",
    description: "Surgical suction sets and tubing consumables.",
    parentName: "Surgical Instruments and Accessories",
    aliases: [],
  },
  {
    id: 31,
    parentId: 3,
    canonicalName: "Surgical Suction Irrigation Sets",
    slug: "surgical-suction-irrigation-sets",
    nodeType: "category",
    description: "Combined surgical suction and irrigation sets.",
    parentName: "Surgical Instruments and Accessories",
    aliases: [],
  },
];

const oneHighSuggestionCatalog = [{
  id: 40,
  parentId: 4,
  canonicalName: "Patient Warming Blanket Sterile Devices",
  slug: "patient-warming-blanket-devices",
  nodeType: "category",
  description: "Patient warming blanket sterile devices",
  parentName: "Patient Warming Blanket Sterile Systems",
  aliases: [],
}];

function evidence(
  sourceType: ProspectEvidence["sourceType"],
  text: string,
): ProspectEvidence {
  return {
    sourceType,
    sourceUrl: sourceType === "TED_AWARD"
      ? "https://ted.europa.eu/en/notice/-/detail/qa-unknown"
      : sourceType === "PUBLIC_REGISTRY"
      ? "https://registry.example/qa-unknown"
      : "https://manufacturer.example/products/bloodline",
    sourceDomain: sourceType === "TED_AWARD"
      ? "ted.europa.eu"
      : sourceType === "PUBLIC_REGISTRY"
      ? "registry.example"
      : "manufacturer.example",
    title: text,
    snippet: text,
    evidenceKind: "WEAK_CONTEXT",
    confidence: .9,
    evidenceDate: "2026-08-25",
    taxonomyIds: [],
  };
}

Deno.test("A-D/U/V: exact taxonomy, approved aliases, plural and punctuation normalize deterministically", () => {
  for (
    const query of [
      "Camera Cover",
      "Sterile Camera Sleeve",
      "camera-covers",
      "Camera / Covers",
    ]
  ) {
    const result = resolveProductIntentDeterministically(query, catalog);
    assert.equal(result.resolution, "high_confidence");
    assert.equal(result.recommended?.canonical_taxonomy_id, 10);
  }
  assert.equal(
    resolveProductIntentDeterministically("Fluid Collection Pouch", catalog)
      .recommended?.canonical_taxonomy_id,
    20,
  );
});

Deno.test("E: one strongly supported unknown phrase yields one HIGH confirmable suggestion", () => {
  const result = resolveProductIntentDeterministically(
    "Patient Warming Blanket Sterile",
    oneHighSuggestionCatalog,
  );
  assert.equal(result.resolution, "medium_confidence");
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].confidence_label, "HIGH");
});

Deno.test("F: multiple independent matches yield at most three MEDIUM suggestions", () => {
  const result = resolveProductIntentDeterministically(
    "Surgical Suction Set",
    catalog,
  );
  assert.equal(result.resolution, "medium_confidence");
  assert(result.suggestions.length >= 1 && result.suggestions.length <= 3);
  assert(
    result.suggestions.every((item) => item.confidence_label === "MEDIUM"),
  );
  assert(result.suggestions.every((item) => item.signal_sources.length >= 2));
});

Deno.test("G-I/T: Arterial Venous Set has no fabricated mapping but can use bounded medical discovery", () => {
  const variants = [
    "Arterial Venous Set",
    "Arterial/Venous Set",
    "Arterial-Venous Sets",
  ];
  for (const variant of variants) {
    const result = resolveProductIntentDeterministically(variant, catalog);
    assert.equal(result.resolution, "unmapped");
    assert.equal(result.search_anyway_allowed, true);
    assert.equal(result.recommended, null);
  }
  assert.equal(
    productPhraseSignature(variants[0]),
    productPhraseSignature(variants[2]),
  );
  assert.throws(() => validateUnmappedMedicalProductPhrase("search Europe"));
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase("https://example.com/products")
  );
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase("industrial pump set")
  );
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase("find arterial venous set buyers")
  );
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase("arterial venous set competitors")
  );
});

Deno.test("J-N: verified website/TED phrase can be DIRECT; registry and broad generic text cannot", () => {
  const profile = buildTemporaryProductFamilyProfile({
    phrase: "Arterial Venous Set",
    intentHash: "a".repeat(64),
  });
  assert.equal(
    classifyEvidenceForProduct(
      evidence("COMPANY_WEBSITE", "Arterial and Venous Bloodline Sets"),
      profile,
    ).relevanceClass,
    "DIRECT",
  );
  assert.equal(
    classifyEvidenceForProduct(
      evidence("TED_AWARD", "Supply of arterial and venous bloodline sets"),
      profile,
    ).relevanceClass,
    "DIRECT",
  );
  assert.equal(
    classifyEvidenceForProduct(
      evidence("PUBLIC_REGISTRY", "Medical device wholesaler"),
      profile,
    ).relevanceClass,
    "GENERIC",
  );
  assert.equal(
    classifyEvidenceForProduct(
      evidence("TED_AWARD", "General hospital equipment CPV 33100000"),
      profile,
    ).relevanceClass,
    "GENERIC",
  );
});

Deno.test("S: website-detected unknown medical product phrases are surfaced but never auto-selected", () => {
  const suggestions = unmappedWebsiteProductSuggestions([{
    label: "Patient Warming Blanket",
    pageUrl: "https://manufacturer.example/products/warming-blanket",
    kind: "schema_product",
    strength: 1,
  }, {
    label: "Our company",
    pageUrl: "https://manufacturer.example/",
    kind: "heading",
    strength: .9,
  }], []);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].resolution, "UNMAPPED");
  assert.equal(suggestions[0].auto_selected, false);
  assert.equal(suggestions[0].taxonomy_id, null);
});

Deno.test("Z: temporary cache signatures normalize only safe variants", () => {
  assert.equal(
    normalizeUnknownProductPhrase("Haemodialysis Bloodlines"),
    "hemodialysis bloodline",
  );
  assert.equal(
    productPhraseSignature("Arterial/Venous Sets"),
    productPhraseSignature("venous arterial set"),
  );
  assert.notEqual(
    productPhraseSignature("Arterial Venous Set"),
    productPhraseSignature("Irrigation Pump Set"),
  );
});

Deno.test("T and realistic unknown-product benchmark phrases never fall into a classification dead end", () => {
  for (
    const query of [
      "Dialysis Bloodline",
      "Arterial Venous Bloodline",
      "Patient Warming Blanket",
      "Surgical Suction Set",
      "ECG Cable Cover",
      "Irrigation Pump Set",
      "Laparoscopy Camera Sleeve",
      "Fluid Collection Pouch",
    ]
  ) {
    const result = resolveProductIntentDeterministically(query, catalog);
    assert(
      result.recommended !== null || result.search_anyway_allowed,
      `${query} must be confirmable or safely searchable`,
    );
  }
});

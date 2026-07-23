import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_EXTRACTION_VERSION,
  estimatePdfPageCount,
  normalizeDecimal,
  normalizeDocumentAnalysis,
  normalizeUnit,
  shouldApplyExtraction,
} from "./document-extraction-v2.ts";

test("normalizes multilingual decimal formats and common units", () => {
  assert.equal(normalizeDecimal("1.234,50"), 1234.5);
  assert.equal(normalizeDecimal("1,234.50"), 1234.5);
  assert.equal(normalizeDecimal("2500"), 2500);
  assert.equal(normalizeDecimal("about 10"), null);
  assert.equal(normalizeUnit("Adet"), "piece");
  assert.equal(normalizeUnit("boîtes"), "box");
});

test("keeps total quantity separate from package quantity", () => {
  const output = normalizeDocumentAnalysis({
    analysis_status: "completed",
    document_confidence_score: 90,
    data_completeness_score: 80,
    products: [{
      product_name: "Sterile syringe",
      quantity_value: "12.000",
      quantity_unit: "pcs",
      quantity_scope: "contract",
      packaging: "100 pieces per box",
      packaging_details: {
        package_quantity: 120,
        package_unit: "box",
        units_per_package: 100,
      },
      evidence: [{
        document_id: 5,
        source_quote: "12,000 sterile syringes, 100 pieces per box",
        field_name: "quantity",
        extracted_value: "12,000 pieces",
        requirement_status: "mandatory",
        confidence_score: 95,
      }],
    }],
  }, new Set([5]));

  assert.equal(output.products[0].quantity_value, 12000);
  assert.equal(output.products[0].quantity_unit, "piece");
  assert.equal(output.products[0].package_quantity, 120);
  assert.equal(output.products[0].units_per_package, 100);
  assert.equal(output.products[0].evidence[0].requirement_status, "mandatory");
});

test("rejects unsupported evidence references and marks evidence-free output partial", () => {
  const output = normalizeDocumentAnalysis({
    analysis_status: "completed",
    document_confidence_score: 98,
    data_completeness_score: 96,
    products: [{
      product_name: "Catheter",
      confidence_score: 90,
      evidence: [{
        document_id: 999,
        source_quote: "Catheter",
        field_name: "product_name",
        extracted_value: "Catheter",
      }],
    }],
  }, new Set([5]));

  assert.equal(output.analysis_status, "partial");
  assert.equal(output.evidence_count, 0);
  assert.equal(output.document_confidence_score, 35);
  assert.ok(output.missing_information.includes("Document source references"));
});

test("uses null for unknown tender facts and normalizes supported facts", () => {
  const output = normalizeDocumentAnalysis({
    tender: {
      title_original: "Achat de dispositifs",
      title_normalized_en: "Purchase of devices",
      country_code: "fr",
      cpv_codes: ["33140000-3", "invalid"],
      estimated_value: "25.500,00",
      currency: "eur",
      deadline_at: "2026-09-10T12:00:00+02:00",
    },
    products: [],
  }, new Set());

  assert.equal(output.tender.country_code, "FR");
  assert.deepEqual(output.tender.cpv_codes, ["33140000"]);
  assert.equal(output.tender.estimated_value, 25500);
  assert.equal(output.tender.currency, "EUR");
  assert.equal(output.tender.authority_original, null);
});

test("does not overwrite a higher-confidence extraction and is deterministic on ties", () => {
  assert.equal(
    shouldApplyExtraction({
      confidenceScore: 90,
      extractionVersion: "older",
      analyzedAt: "2026-07-23T00:00:00Z",
    }, {
      confidenceScore: 80,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
    }),
    false,
  );
  assert.equal(
    shouldApplyExtraction({
      confidenceScore: 80,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
      analyzedAt: "2026-07-23T00:00:00Z",
    }, {
      confidenceScore: 80,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
    }),
    false,
  );
  assert.equal(
    shouldApplyExtraction({
      confidenceScore: 0,
      analyzedAt: null,
    }, {
      confidenceScore: 0,
      extractionVersion: DOCUMENT_EXTRACTION_VERSION,
    }),
    true,
  );
});

test("detects an explicit PDF page count for bounded processing", () => {
  const bytes = new TextEncoder().encode(
    "%PDF-1.7 /Type /Page /Type /Pages /Type /Page",
  );
  assert.equal(estimatePdfPageCount(bytes), 2);
});

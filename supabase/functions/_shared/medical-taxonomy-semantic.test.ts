import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMedicalTaxonomySemanticPrompt,
  parseMedicalTaxonomySemanticSuggestion,
  type MedicalTaxonomyCandidate,
} from "./medical-taxonomy-semantic.ts";

const candidates: MedicalTaxonomyCandidate[] = [
  { id: 13, canonical_name: "Ultrasound Probe Covers", parent_name: "Equipment Covers", node_type: "category" },
  { id: 14, canonical_name: "C-Arm Covers", parent_name: "Equipment Covers", node_type: "category" },
];

test("semantic prompt permits only supplied canonical nodes", () => {
  const prompt = JSON.parse(buildMedicalTaxonomySemanticPrompt(
    "sterile ultrasound transducer sleeve",
    candidates,
  ));
  assert.equal(prompt.candidates.length, 2);
  assert.equal(prompt.rules[0], "Never create or rename a taxonomy node.");
});

test("high-confidence existing-node suggestion is recommendable", () => {
  const suggestion = parseMedicalTaxonomySemanticSuggestion(JSON.stringify({
    canonical_taxonomy_id: 13,
    canonical_name: "Ultrasound Probe Covers",
    confidence: .94,
    reasoning: "The phrase describes a sterile sheath used over an ultrasound transducer.",
    source_text: "ignored provider echo",
  }), "sterile ultrasound transducer sleeve", candidates);
  assert.equal(suggestion.confidence_band, "high");
  assert.equal(suggestion.decision, "recommend");
  assert.equal(suggestion.source_text, "sterile ultrasound transducer sleeve");
});

test("medium confidence requires user choice", () => {
  const suggestion = parseMedicalTaxonomySemanticSuggestion(JSON.stringify({
    canonical_taxonomy_id: 14,
    canonical_name: "C-Arm Covers",
    confidence: .72,
    reasoning: "The term may describe a fluoroscopy equipment drape.",
  }), "imaging machine drape", candidates);
  assert.equal(suggestion.confidence_band, "medium");
  assert.equal(suggestion.decision, "ask_user");
});

test("low confidence remains custom and unknown nodes are rejected", () => {
  const low = parseMedicalTaxonomySemanticSuggestion(JSON.stringify({
    canonical_taxonomy_id: 13,
    canonical_name: "Ultrasound Probe Covers",
    confidence: .2,
    reasoning: "Insufficient product context.",
  }), "medical thing", candidates);
  assert.equal(low.canonical_taxonomy_id, null);
  assert.equal(low.decision, "keep_custom");
  assert.throws(
    () => parseMedicalTaxonomySemanticSuggestion(JSON.stringify({
      canonical_taxonomy_id: 999,
      canonical_name: "Invented Category",
      confidence: .99,
      reasoning: "Invalid.",
    }), "invented product", candidates),
    /UNKNOWN_TAXONOMY_PROVIDER_NODE/,
  );
});

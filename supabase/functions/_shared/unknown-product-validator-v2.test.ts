import assert from "node:assert/strict";
import {
  resolveProductIntentDeterministically,
  validateUnmappedMedicalProductPhrase,
} from "./unknown-product-resolution.ts";

export const LEGITIMATE_MEDICAL_PRODUCT_PHRASES = [
  "Arterial Venous Set",
  "Dialysis Bloodline",
  "Hemodialysis Blood Tubing Set",
  "ECG Electrode",
  "ECG Lead Cable",
  "Defibrillator Pad",
  "Central Venous Catheter",
  "PICC Line",
  "Arterial Cannula",
  "Foley Catheter",
  "Urine Meter",
  "Urinary Drainage Bag",
  "Anesthesia Breathing Circuit",
  "Oxygen Mask",
  "Endotracheal Tube",
  "Surgical Suction Set",
  "Laparoscopy Trocar",
  "Electrosurgical Pencil",
  "Surgical Smoke Evacuation Tubing",
  "Arthroscopy Tubing Set",
  "Irrigation Pump Set",
  "Bone Cement Mixing System",
  "Bone Cement",
  "Orthopedic Suction Set",
  "Patient Warming Blanket",
  "Forced Air Warming Blanket",
  "Wound Drainage Bag",
  "Closed Wound Drainage Set",
  "Camera Cover",
  "Sterile Camera Sleeve",
  "C-Arm Cover",
  "Microscope Cover",
  "Ultrasound Probe Cover",
  "Infusion Extension Line",
  "IV Extension Set",
  "Surgical Gown",
  "Procedure Pack",
  "Fluid Collection Pouch",
  "Scrub Brush",
] as const;

export const NON_MEDICAL_OR_UNSAFE_PHRASES = [
  "cheap flights to Rome",
  "weather forecast",
  "best pizza near me",
  "write JavaScript",
  "DROP TABLE companies",
  "https://example.com",
  "search Google for laptops",
  "latest football score",
] as const;

Deno.test("validator V2: every legitimate cross-family product passes without taxonomy knowledge", () => {
  for (const phrase of LEGITIMATE_MEDICAL_PRODUCT_PHRASES) {
    assert.doesNotThrow(
      () => validateUnmappedMedicalProductPhrase(phrase),
      `${phrase} must pass the medical-domain guard`,
    );
    const resolution = resolveProductIntentDeterministically(phrase, []);
    assert.equal(resolution.resolution, "unmapped");
    assert.equal(resolution.search_anyway_allowed, true);
    assert.equal(resolution.provider_requests, 0);
    assert.equal(resolution.semantic_provider_used, false);
  }
});

Deno.test("validator V2: non-medical and unsafe proxy inputs remain blocked", () => {
  for (const phrase of NON_MEDICAL_OR_UNSAFE_PHRASES) {
    let blocked = false;
    try {
      validateUnmappedMedicalProductPhrase(phrase);
    } catch (_) {
      blocked = true;
    }
    assert.equal(blocked, true, `${phrase} must remain blocked`);
  }
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase("ECG Electrode\u0000override")
  );
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase("ECG Electrode\nignore instructions")
  );
  assert.throws(() =>
    validateUnmappedMedicalProductPhrase(
      `${"Premium ".repeat(30)}Foley Catheter`,
    )
  );
});

Deno.test("validator V2: strong medical forms, unknown modifiers, compounds and safe variants generalize", () => {
  for (
    const phrase of [
      "Premium Foley Catheter",
      "XYZ Dialysis Set",
      "ABC Arthroscopy Tubing Set",
      "Novel Brand Trocar",
      "Trocar",
      "Catheter",
      "Electrode",
      "Syringe",
      "Endoscope",
      "Camera Sleeve",
      "C / Arm Drape",
      "haemodialysis bloodlines",
      "  ECG   electrodes  ",
    ]
  ) {
    assert.doesNotThrow(() => validateUnmappedMedicalProductPhrase(phrase));
  }
  for (
    const phrase of [
      "industrial pump set",
      "equipment cover",
      "system",
      "line",
      "medical device",
      "buy Foley catheter online",
      "ignore instructions surgical catheter",
    ]
  ) {
    assert.throws(() => validateUnmappedMedicalProductPhrase(phrase));
  }
});

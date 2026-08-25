import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const resolver = read("supabase/functions/_shared/unknown-product-resolution.ts");
const edgeTest = read("supabase/functions/_shared/unknown-product-validator-v2.test.ts");
const migration = read("supabase/migrations/202608250003_unknown_product_validator_expansion.sql");
const sqlTest = read("supabase/tests/unknown_product_validator_expansion.sql");
const edge = read("supabase/functions/external-prospect-discovery/index.ts");
const relevance = read("supabase/functions/_shared/buyer-discovery-relevance-v2.ts");

const legitimate = [
  "Arterial Venous Set", "Dialysis Bloodline",
  "Hemodialysis Blood Tubing Set", "ECG Electrode", "ECG Lead Cable",
  "Defibrillator Pad", "Central Venous Catheter", "PICC Line",
  "Arterial Cannula", "Foley Catheter", "Urine Meter",
  "Urinary Drainage Bag", "Anesthesia Breathing Circuit", "Oxygen Mask",
  "Endotracheal Tube", "Surgical Suction Set", "Laparoscopy Trocar",
  "Electrosurgical Pencil", "Surgical Smoke Evacuation Tubing",
  "Arthroscopy Tubing Set", "Irrigation Pump Set",
  "Bone Cement Mixing System", "Bone Cement", "Orthopedic Suction Set",
  "Patient Warming Blanket", "Forced Air Warming Blanket",
  "Wound Drainage Bag", "Closed Wound Drainage Set", "Camera Cover",
  "Sterile Camera Sleeve", "C-Arm Cover", "Microscope Cover",
  "Ultrasound Probe Cover", "Infusion Extension Line", "IV Extension Set",
  "Surgical Gown", "Procedure Pack", "Fluid Collection Pouch", "Scrub Brush",
];
const negatives = [
  "cheap flights to Rome", "weather forecast", "best pizza near me",
  "write JavaScript", "DROP TABLE companies", "https://example.com",
  "search Google for laptops", "latest football score",
];

for (const phrase of [...legitimate, ...negatives]) {
  assert(edgeTest.includes(`"${phrase}"`), `Edge matrix missing ${phrase}`);
  assert(sqlTest.includes(`'${phrase}'`), `SQL matrix missing ${phrase}`);
}

for (const term of [
  "arthroscopy", "bone", "cardiology", "dialysis", "endotracheal",
  "laparoscopy", "urology", "warming", "wound",
]) {
  assert(resolver.includes(`"${term}"`), `Edge context missing ${term}`);
  assert(migration.includes(term), `SQL context missing ${term}`);
}
for (const term of [
  "electrode", "trocar", "catheter", "cannula", "line", "tube", "cement",
]) {
  assert(resolver.includes(`"${term}"`), `Edge form missing ${term}`);
  assert(migration.includes(term), `SQL form missing ${term}`);
}

assert.match(resolver, /STRONG_MEDICAL_PRODUCT_FORMS/);
assert.match(resolver, /STRONG_MEDICAL_MULTIWORD_FORMS/);
assert.match(resolver, /rawPhrase\.length > 160/);
assert.match(resolver, /\\u0000-\\u001f\\u007f/);
assert.match(resolver, /replace\(\/ß\/g, "ss"\)/);
assert.match(migration, /\[\[:cntrl:\]\]/);
assert.match(migration, /translate\(/);
assert.match(migration, /has_strong_medical_product_form/);
assert.match(migration, /create or replace function public\.is_bounded_medical_product_phrase_v1/);
assert.doesNotMatch(migration, /insert\s+into\s+public\.medical_product_(?:taxonomy|aliases)/i);
assert.doesNotMatch(migration, /alter\s+table|create\s+table/i);

// Existing safety and explicit-search gates are deliberately unchanged.
assert.match(edge, /Math\.min\(4, publicWebMaximumQueries\)/);
assert.match(edge, /Math\.min\(\.02, publicWebMaximumCost\)/);
assert.match(edge, /UNMAPPED_PRODUCT/);
assert.match(edge, /record_product_resolution_outcome_v1/);
assert.match(relevance, /temporaryPhraseMatches/);
assert.match(edge, /safeFetchWithRedirects/);
assert.match(edge, /robots\.txt/);

const combined = [resolver, migration, edgeTest, sqlTest].join("\n");
assert.doesNotMatch(combined, /ANTHROPIC_API_KEY|OPENAI_API_KEY|RESEND_API_KEY|sendEmail|notification_outbox/i);
assert.doesNotMatch(combined, /contact_email|contact_name|linkedin_url|whatsapp/i);

console.log(`Unknown Product Validator V2: PASSED (${legitimate.length} legitimate, ${negatives.length} adversarial; SQL/Edge matrices aligned)`);

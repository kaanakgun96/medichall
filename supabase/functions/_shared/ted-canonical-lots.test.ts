import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalLotCoverageSummary,
  fetchTedCanonicalNotice,
  parseTedCanonicalNotice,
  reconcileAnalysisToCanonicalLots,
  reconcileChunkToCanonicalLots,
  resolveCanonicalLotReference,
} from "./ted-canonical-lots.ts";

function notice(count = 3, overrides: Record<string, unknown> = {}) {
  const identifiers = Array.from(
    { length: count },
    (_, index) => `LOT-${String(index + 1).padStart(4, "0")}`,
  );
  return {
    "publication-number": "499462-2026",
    "publication-date": "2026-07-20+02:00",
    "identifier-lot": identifiers,
    "internal-identifier-lot": ["2", "18", "159"].slice(0, count),
    "title-lot": {
      fra: [
        "Aiguille de prélèvement",
        "Capteur de pression",
        "Cathéter anesthésie péridurale",
      ].slice(0, count),
    },
    "description-lot": {
      fra: [
        "Aiguille de prélèvement",
        "Capteur de pression",
        "Cathéter anesthésie péridurale",
      ].slice(0, count),
    },
    "main-classification-lot": Array(count).fill("33141000"),
    "deadline-receipt-tender-date-lot": Array(count).fill(
      "2026-09-04+02:00",
    ),
    links: {
      xml: { MUL: "https://ted.europa.eu/en/notice/499462-2026/xml" },
    },
    ...overrides,
  };
}

test("parses a single-lot TED notice as one authoritative canonical lot", () => {
  const parsed = parseTedCanonicalNotice(notice(1));
  assert.equal(parsed.official_lot_count, 1);
  assert.equal(parsed.lots[0].official_lot_identifier, "LOT-0001");
  assert.equal(parsed.lots[0].internal_lot_identifier, "2");
  assert.equal(parsed.lots[0].source_type, "TED_STRUCTURED");
});

test("parses all 32 official identifiers for reference notice 499462-2026", () => {
  const identifiers = Array.from(
    { length: 32 },
    (_, index) => `LOT-${String(index + 1).padStart(4, "0")}`,
  );
  const internal = [
    "2",
    "18",
    "19",
    "27",
    "41",
    "47",
    "51",
    "52",
    "57",
    "62",
    "68",
    "70",
    "78",
    "79",
    "82",
    "87",
    "89",
    "90",
    "96",
    "109",
    "110",
    "111",
    "122",
    "131",
    "148",
    "152",
    "153",
    "156",
    "157",
    "159",
    "160",
    "161",
  ];
  const titles = identifiers.map((identifier) =>
    `Official title ${identifier}`
  );
  const parsed = parseTedCanonicalNotice(notice(3, {
    "identifier-lot": identifiers,
    "internal-identifier-lot": internal,
    "title-lot": { fra: titles },
    "description-lot": { fra: titles },
    "main-classification-lot": Array(32).fill("33141000"),
    "deadline-receipt-tender-date-lot": Array(32).fill("2026-09-04+02:00"),
  }));
  assert.equal(parsed.official_lot_count, 32);
  assert.equal(parsed.lots[29].official_lot_identifier, "LOT-0030");
  assert.equal(parsed.lots[29].internal_lot_identifier, "159");
  assert.equal(parsed.lots[31].official_lot_identifier, "LOT-0032");
});

test("maps overloaded numeric TED internal identifiers to official identifiers", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const mapping = resolveCanonicalLotReference("159", null, parsed.lots);
  assert.deepEqual(mapping.canonical_lot_identifiers, ["LOT-0003"]);
  assert.deepEqual(mapping.mapping_methods, ["internal_identifier_alias"]);
});

test("rejects numeric artifacts that are absent from the official alias list", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const mapping = resolveCanonicalLotReference("160", null, parsed.lots);
  assert.equal(mapping.category, "UNMAPPED");
  assert.deepEqual(mapping.canonical_lot_identifiers, []);
  assert.deepEqual(mapping.rejected_references, ["160"]);
});

test("maps exact canonical names and official lot identifiers deterministically", () => {
  const parsed = parseTedCanonicalNotice(notice());
  assert.deepEqual(
    resolveCanonicalLotReference("LOT 2", null, parsed.lots)
      .canonical_lot_identifiers,
    ["LOT-0002"],
  );
  assert.deepEqual(
    resolveCanonicalLotReference(null, "Capteur de pression", parsed.lots)
      .canonical_lot_identifiers,
    ["LOT-0002"],
  );
});

test("classifies a one-lot chunk inside a multi-lot notice", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const mapping = reconcileChunkToCanonicalLots({
    lots: [{ lot_number: "18", lot_title: "Capteur de pression" }],
    products: [{ product_name: "Pressure sensor", lot_number: "18" }],
  }, parsed.lots);
  assert.equal(mapping.category, "ONE_CANONICAL_LOT");
  assert.deepEqual(mapping.canonical_lot_identifiers, ["LOT-0002"]);
});

test("classifies a multi-lot chunk without inventing a new identity", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const mapping = reconcileChunkToCanonicalLots({
    lots: [{ lot_number: "LOT-0001, LOT-0003" }],
  }, parsed.lots);
  assert.equal(mapping.category, "MULTIPLE_CANONICAL_LOTS");
  assert.deepEqual(mapping.canonical_lot_identifiers, [
    "LOT-0001",
    "LOT-0003",
  ]);
});

test("classifies a chunk with no lot reference as notice-level", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const mapping = reconcileChunkToCanonicalLots({
    products: [{
      product_name: "General submission deadline",
      lot_number: null,
    }],
  }, parsed.lots);
  assert.equal(mapping.category, "NOTICE_LEVEL");
});

test("an invalid AI lot ID cannot become a canonical lot", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const reconciled = reconcileAnalysisToCanonicalLots({
    lots: [{ lot_number: "LOT-9999", lot_title: "Invented" }],
    products: [{ product_name: "Invented product", lot_number: "LOT-9999" }],
  }, parsed.lots);
  assert.equal((reconciled.lots as unknown[]).length, 3);
  assert.deepEqual(reconciled.rejected_phantom_lot_references, ["LOT-9999"]);
  assert.equal(
    (reconciled.products as Array<Record<string, unknown>>)[0].lot_number,
    null,
  );
});

test("reconciliation is stable under identical retry", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const input = {
    lots: [{ lot_number: "159", lot_title: "Cathéter anesthésie péridurale" }],
    products: [{ product_name: "Catheter", lot_number: "159" }],
  };
  assert.deepEqual(
    reconcileAnalysisToCanonicalLots(input, parsed.lots),
    reconcileAnalysisToCanonicalLots(input, parsed.lots),
  );
});

test("an amendment preserves stable official identities while changing titles", () => {
  const original = parseTedCanonicalNotice(notice());
  const amended = parseTedCanonicalNotice(notice(3, {
    "title-lot": {
      fra: [
        "Aiguille de prélèvement — amended",
        "Capteur de pression",
        "Cathéter anesthésie péridurale",
      ],
    },
  }));
  assert.deepEqual(
    original.lots.map((lot) => lot.official_lot_identifier),
    amended.lots.map((lot) => lot.official_lot_identifier),
  );
  assert.notEqual(original.lots[0].lot_title, amended.lots[0].lot_title);
});

test("coverage summary distinguishes chunk coverage from notice lot count", () => {
  const parsed = parseTedCanonicalNotice(notice());
  const mapping = reconcileChunkToCanonicalLots({
    lots: [{ lot_number: "LOT-0001" }],
  }, parsed.lots);
  assert.equal(
    canonicalLotCoverageSummary([mapping], 32),
    "Document analysis contains evidence for LOT-0001. The official TED notice contains 32 canonical lots.",
  );
});

test("official TED fetch uses an exact publication query and accepts one notice", async () => {
  let requestQuery = "";
  const result = await fetchTedCanonicalNotice(
    "499462-2026",
    (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >;
      requestQuery = String(requestBody.query || "");
      return Promise.resolve(
        new Response(JSON.stringify({ notices: [notice()] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  );
  assert.equal(requestQuery, 'publication-number = "499462-2026"');
  assert.equal(result.official_lot_count, 3);
});

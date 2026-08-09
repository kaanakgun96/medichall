import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateTenderQuestionCost,
  normalizeTenderQuestion,
  parseGroundedTenderAnswer,
  rankTenderQuestionSources,
  stableTenderQuestionJson,
  tenderQuestionErrorCode,
  tenderQuestionSha256,
  type TenderQuestionSource,
} from "./tender-question.ts";

const sources: TenderQuestionSource[] = [
  { id: "TENDER", kind: "tender", label: "Tender", text: "Deadline 30 September in France" },
  { id: "E12", kind: "evidence", label: "Page 14 quantity", text: "Lot 7 probe covers quantity 35000 units" },
  { id: "E13", kind: "evidence", label: "Page 15 certification", text: "CE and MDR documentation required" },
  { id: "P4", kind: "company_product", label: "Company product", text: "Sterile ultrasound probe cover" },
];

test("normalizes questions and produces stable hashes", async () => {
  assert.equal(normalizeTenderQuestion("  WHICH   Lots?  "), "which lots?");
  assert.equal(stableTenderQuestionJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  const first = await tenderQuestionSha256("stable");
  const second = await tenderQuestionSha256("stable");
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("retrieval prioritizes relevant evidence and company context", () => {
  const ranked = rankTenderQuestionSources("How many probe covers are requested?", sources);
  assert.equal(ranked[0].id, "E12");
  assert.ok(ranked.some((source) => source.id === "P4"));
});

test("grounded answers reject missing or invented citations", () => {
  assert.throws(
    () => parseGroundedTenderAnswer('{"answer":"35,000","citation_ids":[],"uncertainty":""}', sources),
    Error,
    "UNGROUNDED_PROVIDER_ANSWER",
  );
  assert.throws(
    () => parseGroundedTenderAnswer('{"answer":"35,000 [E999]","citation_ids":["E12"],"uncertainty":""}', sources),
    Error,
    "UNKNOWN_PROVIDER_CITATION",
  );
});

test("grounded answers retain only supplied citations", () => {
  const result = parseGroundedTenderAnswer(
    '{"answer":"Lot 7 requests 35,000 units [E12].","citation_ids":["E12","E999"],"uncertainty":"Packaging is not stated."}',
    sources,
  );
  assert.deepEqual(result.citationIds, ["E12"]);
  assert.equal(result.citations[0].meta, undefined);
  assert.equal(result.uncertainty, "Packaging is not stated.");
});

test("combined brackets remain grounded to individually supplied IDs", () => {
  const result = parseGroundedTenderAnswer(
    '{"answer":"Quantity and certification are evidenced [E12, E13].","citation_ids":["E12","E13"],"uncertainty":"Capacity is not stated."}',
    sources,
  );
  assert.deepEqual(result.citationIds, ["E12", "E13"]);
  assert.throws(
    () => parseGroundedTenderAnswer(
      '{"answer":"Unsupported reference [E12, E99].","citation_ids":["E12"],"uncertainty":"Unknown."}',
      sources,
    ),
    Error,
    "UNKNOWN_PROVIDER_CITATION",
  );
});

test("cost estimation and errors remain bounded and redacted", async () => {
  assert.equal(estimateTenderQuestionCost(1_000, 500, 3, 15), 0.0105);
  assert.equal(tenderQuestionErrorCode(new Error("INVALID_PROVIDER_JSON")), "INVALID_PROVIDER_JSON");
  assert.equal(tenderQuestionErrorCode(new Error("provider secret payload")), "TENDER_ASK_FAILED");
  await assert.rejects(() => tenderQuestionSha256(Symbol("invalid") as unknown as string));
});

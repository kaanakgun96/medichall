import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_ACCESS_STATUSES,
  accessClassForStatus,
  canAdjudicateBenchmark,
  classifyDocumentAccess,
  classifyError,
  hasStaleVersion,
  isBenchmarkLabel,
  isValidTraceRelationship,
  sanitizeMessage,
  sanitizeMetadata,
  sanitizePortalUrl,
  stableVersionHash,
} from "./matching-observability.ts";

test("maps CAPTCHA, login, and membership restrictions explicitly", () => {
  assert.equal(
    classifyDocumentAccess({ httpStatus: 403, bodySample: "Complete the CAPTCHA" }),
    "captcha_required",
  );
  assert.equal(
    classifyDocumentAccess({ httpStatus: 200, bodySample: "Sign in to download" }),
    "login_required",
  );
  assert.equal(
    classifyDocumentAccess({ httpStatus: 200, bodySample: "Members only" }),
    "membership_required",
  );
  assert.equal(accessClassForStatus("captcha_required"), "restricted");
  assert.equal(
    classifyDocumentAccess({ httpStatus: 402, bodySample: "Payment required" }),
    "paid_access_required",
  );
  assert.equal(
    classifyDocumentAccess({ bodySample: "Session expired" }),
    "session_required",
  );
  assert.equal(
    classifyDocumentAccess({ bodySample: "Accept the terms to continue" }),
    "terms_acceptance_required",
  );
});

test("distinguishes public, technical, restricted, and processed document states", () => {
  assert.equal(
    classifyDocumentAccess({ httpStatus: 200, isDirectFile: true }),
    "public_direct_download",
  );
  assert.equal(classifyDocumentAccess({ httpStatus: 404 }), "broken_link");
  assert.equal(classifyDocumentAccess({ downloaded: true }), "downloaded");
  assert.equal(classifyDocumentAccess({ parsed: true }), "parsed");
  assert.equal(accessClassForStatus("unsupported_file_type"), "publicly_accessible_but_unsupported");
  assert.equal(accessClassForStatus("broken_link"), "technical_failure");
  assert.equal(DOCUMENT_ACCESS_STATUSES.length, 23);
  for (const status of DOCUMENT_ACCESS_STATUSES) {
    assert.match(
      accessClassForStatus(status),
      /^(public|publicly_accessible_but_unsupported|restricted|manual|technical_failure|processed)$/,
    );
  }
});

test("maps deterministic error categories", () => {
  assert.equal(classifyError("request timed out"), "timeout");
  assert.equal(classifyError("Anthropic request failed"), "ai_provider");
  assert.equal(classifyError("Claude returned invalid JSON"), "ai_response_validation");
  assert.equal(classifyError("membership required"), "membership");
  assert.equal(classifyError("database constraint violation"), "database");
});

test("redacts secrets and personal identifiers from logs", () => {
  const fakeToken = ["github", "pat", "secretvalue12345"].join("_");
  const message = sanitizeMessage(
    `Authorization: Bearer abc.def.ghi user ali@example.com ${fakeToken}`,
  );
  assert.doesNotMatch(message, /abc\.def\.ghi/);
  assert.doesNotMatch(message, /ali@example\.com/);
  assert.equal(message.includes(fakeToken), false);

  const metadata = sanitizeMetadata({
    authorization: "Bearer private",
    nested: { apiKey: "private-key", safe: "ok" },
  }) as Record<string, unknown>;
  assert.equal(metadata.authorization, "[REDACTED]");
  assert.deepEqual(metadata.nested, { apiKey: "[REDACTED]", safe: "ok" });
  assert.equal(
    sanitizePortalUrl("https://user:password@example.com/file?token=private#section"),
    "https://example.com/file",
  );
  assert.equal(sanitizePortalUrl("javascript:alert(1)"), null);
});

test("produces stable hashes independent of object key order", async () => {
  const first = await stableVersionHash({ b: 2, a: { d: 4, c: 3 } });
  const second = await stableVersionHash({ a: { c: 3, d: 4 }, b: 2 });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("validates parent and child trace relationships", () => {
  const known = new Set(["root-trace"]);
  assert.equal(isValidTraceRelationship("child-trace", "root-trace", known), true);
  assert.equal(isValidTraceRelationship("root-trace", "root-trace", known), false);
  assert.equal(isValidTraceRelationship("child-trace", "missing", known), false);
});

test("validates benchmark labels and requires two independent annotators", () => {
  assert.equal(isBenchmarkLabel("highly_relevant"), true);
  assert.equal(isBenchmarkLabel("maybe"), false);
  assert.equal(
    canAdjudicateBenchmark([
      { annotatorId: "reviewer-1", label: "highly_relevant" },
      { annotatorId: "reviewer-2", label: "potentially_relevant" },
    ]),
    true,
  );
  assert.equal(
    canAdjudicateBenchmark([
      { annotatorId: "reviewer-1", label: "highly_relevant" },
      { annotatorId: "reviewer-1", label: "irrelevant" },
    ]),
    false,
  );
});

test("detects unversioned and changed score versions as stale", () => {
  assert.equal(hasStaleVersion(null, "score-v1"), true);
  assert.equal(hasStaleVersion("score-v0", "score-v1"), true);
  assert.equal(hasStaleVersion("score-v1", "score-v1"), false);
});

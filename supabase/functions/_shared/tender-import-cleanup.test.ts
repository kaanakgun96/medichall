import assert from "node:assert/strict";
import test from "node:test";
import {
  partitionTenderImportCleanupPaths,
  redactedTenderImportObjectId,
  validatedTenderImportCleanupPaths,
} from "./tender-import-cleanup.ts";

const importId = "550e8400-e29b-41d4-a716-446655440000";

test("accepts exact scoped cleanup paths and makes duplicate cleanup idempotent", () => {
  assert.deepEqual(
    validatedTenderImportCleanupPaths(42, importId, [
      `42/${importId}/notice.pdf`,
      `42/${importId}/notice.pdf`,
    ]),
    [`42/${importId}/notice.pdf`],
  );
});

test("refuses malformed, traversal, and unrelated-company cleanup paths", () => {
  for (
    const path of [
      `43/${importId}/notice.pdf`,
      `42/${importId}/../notice.pdf`,
      `42/${importId}//notice.pdf`,
      `42/${importId}/folder\\notice.pdf`,
    ]
  ) {
    assert.throws(
      () => validatedTenderImportCleanupPaths(42, importId, [path]),
      /invalid/,
    );
  }
});

test("refuses referenced objects while retaining exact unreferenced objects", () => {
  const referenced = `42/${importId}/registered.pdf`;
  const orphan = `42/${importId}/interrupted.pdf`;
  assert.deepEqual(
    partitionTenderImportCleanupPaths([referenced, orphan], [referenced]),
    {
      removable: [orphan],
      refused: [referenced],
    },
  );
});

test("logs a stable redacted identifier without exposing the object path", async () => {
  const path = `42/${importId}/sensitive-name.pdf`;
  const identifier = await redactedTenderImportObjectId(path);
  assert.match(identifier, /^[0-9a-f]{16}$/);
  assert.doesNotMatch(identifier, /sensitive|pdf|42/);
  assert.equal(await redactedTenderImportObjectId(path), identifier);
});

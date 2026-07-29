import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "npm:fflate@0.8.2";
import { extractZipArchiveBounded, inspectZipArchive } from "./safe-zip.ts";

const encode = (value: string) => new TextEncoder().encode(value);

function zip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 6 });
}

function signatures(bytes: Uint8Array, signature: number[]): number[] {
  const offsets: number[] = [];
  for (let index = 0; index <= bytes.length - signature.length; index++) {
    if (signature.every((value, offset) => bytes[index + offset] === value)) {
      offsets.push(index);
    }
  }
  return offsets;
}

function patchU16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .setUint16(offset, value, true);
}

function patchU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .setUint32(offset, value, true);
}

test("inspects and incrementally extracts a valid small ZIP", () => {
  const bytes = zip({
    "documents/spec.txt": encode("technical specification"),
    "lots.csv": encode("lot,quantity\n1,100"),
  });
  const inspection = inspectZipArchive(bytes);
  assert.equal(inspection.entries.length, 2);
  const extracted = extractZipArchiveBounded(bytes);
  assert.equal(
    new TextDecoder().decode(extracted.get("documents/spec.txt")),
    "technical specification",
  );
});

test("rejects truncated and header-only ZIP input", () => {
  const valid = zip({ "a.txt": encode("a") });
  assert.throws(
    () => inspectZipArchive(valid.slice(0, -5)),
    /central directory|truncated/,
  );
  assert.throws(
    () =>
      inspectZipArchive(
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
      ),
    /truncated/,
  );
});

test("rejects encrypted and unsupported compression methods", () => {
  for (const kind of ["encrypted", "unsupported"] as const) {
    const bytes = zip({ "a.txt": encode("hello") });
    const local = signatures(bytes, [0x50, 0x4b, 0x03, 0x04])[0];
    const central = signatures(bytes, [0x50, 0x4b, 0x01, 0x02])[0];
    if (kind === "encrypted") {
      patchU16(bytes, local + 6, 1);
      patchU16(bytes, central + 8, 1);
      assert.throws(() => inspectZipArchive(bytes), /Encrypted/);
    } else {
      patchU16(bytes, local + 8, 99);
      patchU16(bytes, central + 10, 99);
      assert.throws(() => inspectZipArchive(bytes), /method/);
    }
  }
});

test("rejects symbolic-link-like UNIX entries", () => {
  const bytes = zip({ "link.txt": encode("target") });
  const central = signatures(bytes, [0x50, 0x4b, 0x01, 0x02])[0];
  patchU16(bytes, central + 4, (3 << 8) | 20);
  patchU32(bytes, central + 38, 0xa0000000);
  assert.throws(() => inspectZipArchive(bytes), /Symbolic-link/);
});

test("rejects nested, traversal, absolute, and conflicting paths", () => {
  assert.throws(
    () => inspectZipArchive(zip({ "nested.zip": encode("PK") })),
    /Nested archives/,
  );
  assert.throws(
    () => inspectZipArchive(zip({ "../secret.txt": encode("x") })),
    /traversal/,
  );
  assert.throws(
    () => inspectZipArchive(zip({ "/absolute.txt": encode("x") })),
    /absolute/,
  );
  assert.throws(
    () =>
      inspectZipArchive(zip({
        "Documents/Spec.txt": encode("one"),
        "documents/spec.txt": encode("two"),
      })),
    /duplicate or conflicting/,
  );
});

test("enforces entry count, expanded size, and compression ratio before extraction", () => {
  const twoEntries = zip({ "a.txt": encode("a"), "b.txt": encode("b") });
  assert.throws(
    () => inspectZipArchive(twoEntries, { maximumEntries: 1 }),
    /entry count/,
  );

  const expanded = zip({ "large.txt": new Uint8Array(2_048) });
  assert.throws(
    () =>
      inspectZipArchive(expanded, {
        maximumEntryBytes: 1_024,
        maximumExpandedBytes: 1_024,
      }),
    /expanded size/,
  );

  const highlyCompressed = zip({
    "repeated.txt": new Uint8Array(2 * 1024 * 1024),
  });
  assert.throws(
    () =>
      inspectZipArchive(highlyCompressed, {
        maximumCompressionRatio: 2,
      }),
    /compression-ratio/,
  );
});

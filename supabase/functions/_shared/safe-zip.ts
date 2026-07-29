import { Unzip, UnzipInflate } from "npm:fflate@0.8.2";

export const ZIP_LIMITS = {
  maximumCompressedBytes: 30 * 1024 * 1024,
  maximumExpandedBytes: 100 * 1024 * 1024,
  maximumEntryBytes: 25 * 1024 * 1024,
  maximumEntries: 60,
  maximumCompressionRatio: 200,
} as const;

export type ZipEntryMetadata = {
  name: string;
  directory: boolean;
  compressedBytes: number;
  expandedBytes: number;
  compressionMethod: 0 | 8;
  localHeaderOffset: number;
};

export type ZipInspection = {
  entries: ZipEntryMetadata[];
  compressedBytes: number;
  expandedBytes: number;
};

type ZipLimits = Partial<Record<keyof typeof ZIP_LIMITS, number>>;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function normalizedArchivePath(rawName: string): string {
  if (
    !rawName ||
    rawName.includes("\0") ||
    rawName.startsWith("/") ||
    rawName.startsWith("\\") ||
    /^[a-z]:/i.test(rawName)
  ) {
    throw new Error("ZIP contains an absolute or invalid path");
  }
  const normalized = rawName.replaceAll("\\", "/").normalize("NFC");
  const parts = normalized.split("/");
  const directory = normalized.endsWith("/");
  const pathParts = directory ? parts.slice(0, -1) : parts;
  if (
    !pathParts.length ||
    pathParts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("ZIP contains a traversal or malformed path");
  }
  return pathParts.join("/") + (directory ? "/" : "");
}

function hasNestedArchive(name: string): boolean {
  return /\.(?:zip|7z|rar|tar|tgz|gz|bz2|xz)$/i.test(
    name.replace(/\/$/, ""),
  );
}

function isSymlink(versionMadeBy: number, externalAttributes: number): boolean {
  const hostSystem = versionMadeBy >>> 8;
  const unixMode = externalAttributes >>> 16;
  return hostSystem === 3 && (unixMode & 0xf000) === 0xa000;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const earliest = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= earliest; offset--) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("ZIP central directory is missing or truncated");
}

export function inspectZipArchive(
  bytes: Uint8Array,
  overrides: ZipLimits = {},
): ZipInspection {
  const limits = { ...ZIP_LIMITS, ...overrides };
  if (!bytes.length || bytes.length > limits.maximumCompressedBytes) {
    throw new Error("ZIP compressed size is outside the allowed limit");
  }
  if (bytes.length < 22) throw new Error("ZIP is truncated");

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = u16(view, eocd + 4);
  const centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8);
  const entryCount = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);
  const commentLength = u16(view, eocd + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error("Multi-disk and ZIP64 archives are not supported");
  }
  if (entryCount < 1 || entryCount > limits.maximumEntries) {
    throw new Error("ZIP entry count is outside the allowed limit");
  }
  if (
    eocd + 22 + commentLength !== bytes.length ||
    centralOffset + centralSize > eocd
  ) {
    throw new Error("ZIP central directory bounds are invalid");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntryMetadata[] = [];
  const normalizedNames = new Set<string>();
  const localOffsets = new Set<number>();
  let cursor = centralOffset;
  let expandedBytes = 0;

  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > eocd || u32(view, cursor) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is malformed");
    }
    const versionMadeBy = u16(view, cursor + 4);
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const compressedBytes = u32(view, cursor + 20);
    const entryExpandedBytes = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const entryCommentLength = u16(view, cursor + 32);
    const diskStart = u16(view, cursor + 34);
    const externalAttributes = u32(view, cursor + 38);
    const localHeaderOffset = u32(view, cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength +
      entryCommentLength;
    if (entryEnd > eocd || !nameLength || diskStart !== 0) {
      throw new Error("ZIP central directory entry is truncated");
    }
    if (flags & 0x1) throw new Error("Encrypted ZIP entries are not supported");
    if (method !== 0 && method !== 8) {
      throw new Error("ZIP compression method is not supported");
    }
    if (
      compressedBytes === 0xffffffff ||
      entryExpandedBytes === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 entries are not supported");
    }
    if (isSymlink(versionMadeBy, externalAttributes)) {
      throw new Error("Symbolic-link ZIP entries are not supported");
    }

    let rawName: string;
    try {
      rawName = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      throw new Error("ZIP entry name is not valid UTF-8");
    }
    const name = normalizedArchivePath(rawName);
    const conflictKey = name.replace(/\/$/, "").toLocaleLowerCase("en-US");
    if (normalizedNames.has(conflictKey)) {
      throw new Error("ZIP contains duplicate or conflicting paths");
    }
    normalizedNames.add(conflictKey);
    if (!name.endsWith("/") && hasNestedArchive(name)) {
      throw new Error("Nested archives are not supported");
    }
    if (entryExpandedBytes > limits.maximumEntryBytes) {
      throw new Error("ZIP entry exceeds the expanded size limit");
    }
    expandedBytes += entryExpandedBytes;
    if (expandedBytes > limits.maximumExpandedBytes) {
      throw new Error("ZIP exceeds the total expanded size limit");
    }
    const ratio = entryExpandedBytes / Math.max(1, compressedBytes);
    if (ratio > limits.maximumCompressionRatio) {
      throw new Error("ZIP entry exceeds the compression-ratio limit");
    }

    if (
      localHeaderOffset + 30 > centralOffset ||
      u32(view, localHeaderOffset) !== 0x04034b50 ||
      localOffsets.has(localHeaderOffset)
    ) {
      throw new Error("ZIP local header is missing or conflicting");
    }
    localOffsets.add(localHeaderOffset);
    const localFlags = u16(view, localHeaderOffset + 6);
    const localMethod = u16(view, localHeaderOffset + 8);
    const localNameLength = u16(view, localHeaderOffset + 26);
    const localExtraLength = u16(view, localHeaderOffset + 28);
    const localDataOffset = localHeaderOffset + 30 + localNameLength +
      localExtraLength;
    if (
      localFlags & 0x1 ||
      localMethod !== method ||
      localDataOffset + compressedBytes > centralOffset
    ) {
      throw new Error("ZIP local entry bounds or flags are invalid");
    }
    let localName: string;
    try {
      localName = decoder.decode(
        bytes.subarray(
          localHeaderOffset + 30,
          localHeaderOffset + 30 + localNameLength,
        ),
      );
    } catch {
      throw new Error("ZIP local entry name is not valid UTF-8");
    }
    if (normalizedArchivePath(localName) !== name) {
      throw new Error("ZIP local and central entry paths conflict");
    }

    entries.push({
      name,
      directory: name.endsWith("/"),
      compressedBytes,
      expandedBytes: entryExpandedBytes,
      compressionMethod: method,
      localHeaderOffset,
    });
    cursor = entryEnd;
  }
  if (cursor !== centralOffset + centralSize) {
    throw new Error("ZIP central directory size is inconsistent");
  }
  return {
    entries,
    compressedBytes: bytes.byteLength,
    expandedBytes,
  };
}

export function extractZipArchiveBounded(
  bytes: Uint8Array,
  overrides: ZipLimits = {},
): Map<string, Uint8Array> {
  const inspection = inspectZipArchive(bytes, overrides);
  const expected = new Map(
    inspection.entries.map((entry) => [entry.name, entry]),
  );
  const extracted = new Map<string, Uint8Array>();
  let actualTotal = 0;
  let fatalError: Error | null = null;

  const unzip = new Unzip((file) => {
    if (fatalError) return;
    let normalizedName: string;
    try {
      normalizedName = normalizedArchivePath(file.name);
    } catch (error) {
      fatalError = error as Error;
      return;
    }
    const metadata = expected.get(normalizedName);
    if (!metadata || metadata.directory) {
      file.ondata = (error) => {
        if (error) fatalError = error;
      };
      file.start();
      return;
    }
    const chunks: Uint8Array[] = [];
    let entryLength = 0;
    file.ondata = (error, chunk, final) => {
      if (fatalError) return;
      if (error) {
        fatalError = error;
        return;
      }
      entryLength += chunk.byteLength;
      actualTotal += chunk.byteLength;
      if (
        entryLength > metadata.expandedBytes ||
        actualTotal > inspection.expandedBytes
      ) {
        fatalError = new Error("ZIP expanded beyond inspected limits");
        return;
      }
      if (chunk.byteLength) chunks.push(chunk);
      if (final) {
        if (entryLength !== metadata.expandedBytes) {
          fatalError = new Error("ZIP expanded size does not match metadata");
          return;
        }
        const combined = new Uint8Array(entryLength);
        let offset = 0;
        for (const value of chunks) {
          combined.set(value, offset);
          offset += value.byteLength;
        }
        extracted.set(normalizedName, combined);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  for (let offset = 0; offset < bytes.length && !fatalError; offset += 64_000) {
    unzip.push(
      bytes.subarray(offset, Math.min(bytes.length, offset + 64_000)),
      offset + 64_000 >= bytes.length,
    );
  }
  if (fatalError) throw fatalError;
  const expectedFiles = inspection.entries.filter((entry) => !entry.directory);
  if (extracted.size !== expectedFiles.length) {
    throw new Error("ZIP extraction ended before every entry completed");
  }
  return extracted;
}

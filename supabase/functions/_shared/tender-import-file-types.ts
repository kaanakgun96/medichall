export const TENDER_IMPORT_FILE_LIMIT = 6;
export const TENDER_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024;

export type TenderImportFileType = {
  extension: "pdf" | "docx" | "xlsx" | "csv" | "zip";
  mimeType: string;
  maximumBytes: number;
  archive: boolean;
};

const FILE_TYPES: Record<string, TenderImportFileType> = {
  pdf: {
    extension: "pdf",
    mimeType: "application/pdf",
    maximumBytes: 25 * 1024 * 1024,
    archive: false,
  },
  docx: {
    extension: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    maximumBytes: 25 * 1024 * 1024,
    archive: false,
  },
  xlsx: {
    extension: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maximumBytes: 25 * 1024 * 1024,
    archive: false,
  },
  csv: {
    extension: "csv",
    mimeType: "text/csv",
    maximumBytes: 25 * 1024 * 1024,
    archive: false,
  },
  zip: {
    extension: "zip",
    mimeType: "application/zip",
    maximumBytes: 30 * 1024 * 1024,
    archive: true,
  },
};

function extensionOf(fileName: string): string {
  return (fileName.trim().toLowerCase().match(/[.]([^.]+)$/)?.[1] || "");
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function containsAscii(
  bytes: Uint8Array,
  value: string,
  maximumOffset = bytes.length,
): boolean {
  const target = new TextEncoder().encode(value);
  const limit = Math.min(bytes.length, maximumOffset) - target.length;
  for (let offset = 0; offset <= limit; offset++) {
    let matches = true;
    for (let index = 0; index < target.length; index++) {
      if (bytes[offset + index] !== target[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isZipContainer(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  const sample = bytes.slice(0, Math.min(bytes.length, 8_192));
  let controlCharacters = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) controlCharacters++;
  }
  return controlCharacters / sample.length < 0.01;
}

export function tenderImportFileType(
  fileName: string,
): TenderImportFileType | null {
  return FILE_TYPES[extensionOf(fileName)] || null;
}

export function assertTenderImportFile(
  bytes: Uint8Array,
  fileName: string,
): TenderImportFileType {
  const type = tenderImportFileType(fileName);
  if (!type) {
    throw new Error("Unsupported tender document type");
  }
  if (!bytes.length || bytes.length > type.maximumBytes) {
    throw new Error(
      `${type.extension.toUpperCase()} document size is outside the allowed limit`,
    );
  }

  if (
    type.extension === "pdf" &&
    !containsAscii(bytes, "%PDF-", 1_024)
  ) {
    throw new Error("PDF signature does not match the file name");
  }
  if (
    ["docx", "xlsx", "zip"].includes(type.extension) &&
    !isZipContainer(bytes)
  ) {
    throw new Error(
      `${type.extension.toUpperCase()} signature does not match the file name`,
    );
  }
  if (
    type.extension === "docx" &&
    (
      !containsAscii(bytes, "[Content_Types].xml") ||
      !containsAscii(bytes, "word/")
    )
  ) {
    throw new Error("DOCX package structure does not match the file name");
  }
  if (
    type.extension === "xlsx" &&
    (
      !containsAscii(bytes, "[Content_Types].xml") ||
      !containsAscii(bytes, "xl/")
    )
  ) {
    throw new Error("XLSX package structure does not match the file name");
  }
  if (type.extension === "csv" && !looksLikeText(bytes)) {
    throw new Error("CSV content is not a supported text document");
  }

  return type;
}

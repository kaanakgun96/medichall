import { extractZipArchiveBounded, inspectZipArchive } from "./safe-zip.ts";

export const TENDER_IMPORT_FILE_LIMIT = 6;
export const TENDER_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024;

export async function tenderImportContentSha256(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function tenderImportFileSetFingerprint(
  contentHashes: string[],
): Promise<string> {
  if (
    !contentHashes.length ||
    contentHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))
  ) {
    throw new Error("A valid tender file hash set is required");
  }
  const normalized = [...contentHashes].sort().join("\n");
  return tenderImportContentSha256(new TextEncoder().encode(normalized));
}

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

function ascii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function assertPdf(bytes: Uint8Array): void {
  const header = ascii(bytes.subarray(0, Math.min(bytes.length, 8)));
  if (!header.startsWith("%PDF-1.")) {
    throw new Error("PDF header does not match the file name");
  }
  const content = ascii(bytes);
  const tail = content.slice(-2_048);
  if (
    !/[\r\n]%%EOF[\s\0]*$/.test(tail) ||
    !/\b\d+\s+\d+\s+obj\b/.test(content) ||
    !(/\bxref\b/.test(content) || /\/Type\s*\/XRef\b/.test(content))
  ) {
    throw new Error("PDF is malformed or truncated");
  }
}

function decodeXml(
  entries: Map<string, Uint8Array>,
  name: string,
): string {
  const bytes = entries.get(name);
  if (!bytes) throw new Error(`Office package is missing ${name}`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Office XML is not valid UTF-8: ${name}`);
  }
}

function rejectOfficePayloads(names: string[], contentTypes: string): void {
  if (
    names.some((name) =>
      /(?:^|\/)(?:vbaproject\.bin|[^/]+\.(?:exe|dll|js|vbs|bat|cmd|com|msi|scr))$/i
        .test(name)
    ) ||
    /macroEnabled|vbaProject|application\/vnd\.ms-office\.vbaProject/i.test(
      contentTypes,
    )
  ) {
    throw new Error(
      "Macro-enabled or executable Office payload is unsupported",
    );
  }
}

function relationshipMap(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
    if (/TargetMode=["']External["']/i.test(match[0])) continue;
    const id = match[0].match(/\bId=["']([^"']+)["']/i)?.[1];
    const target = match[0].match(/\bTarget=["']([^"']+)["']/i)?.[1];
    if (id && target) relationships.set(id, target);
  }
  return relationships;
}

function packageTarget(base: string, target: string): string {
  const source = target.replaceAll("\\", "/");
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    throw new Error("Office relationship target is external");
  }
  const parts = (source.startsWith("/") ? source.slice(1) : base + source)
    .split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!normalized.length) {
        throw new Error("Office relationship traverses outside the package");
      }
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

function assertDocx(entries: Map<string, Uint8Array>): void {
  const names = [...entries.keys()];
  const contentTypes = decodeXml(entries, "[Content_Types].xml");
  decodeXml(entries, "word/document.xml");
  const rootRels = decodeXml(entries, "_rels/.rels");
  const targets = [...relationshipMap(rootRels).values()].map((target) =>
    packageTarget("", target)
  );
  if (!targets.includes("word/document.xml")) {
    throw new Error(
      "DOCX root relationship does not reference word/document.xml",
    );
  }
  rejectOfficePayloads(names, contentTypes);
}

function assertXlsx(entries: Map<string, Uint8Array>): void {
  const names = [...entries.keys()];
  const contentTypes = decodeXml(entries, "[Content_Types].xml");
  const workbook = decodeXml(entries, "xl/workbook.xml");
  const workbookRels = decodeXml(entries, "xl/_rels/workbook.xml.rels");
  const sheetIds = [...workbook.matchAll(/\br:id=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (!sheetIds.length) throw new Error("XLSX workbook has no worksheets");
  const relationships = relationshipMap(workbookRels);
  for (const sheetId of sheetIds) {
    const target = relationships.get(sheetId);
    if (!target) {
      throw new Error("XLSX worksheet relationship is missing");
    }
    const path = packageTarget("xl/", target);
    if (!entries.has(path)) {
      throw new Error("XLSX worksheet relationship target is missing");
    }
  }
  rejectOfficePayloads(names, contentTypes);
}

function assertCsv(bytes: Uint8Array): void {
  if (bytes.includes(0)) throw new Error("CSV contains null bytes");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("CSV is not valid UTF-8 text");
  }
  const sample = text.slice(0, 16_384);
  let prohibited = 0;
  for (const character of sample) {
    const code = character.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) prohibited++;
  }
  if (!sample.trim() || prohibited / Math.max(1, sample.length) >= 0.01) {
    throw new Error("CSV content is binary-heavy or empty");
  }
}

export function neutralizeCsvFormulaText(value: string): string {
  let result = "";
  let atCellStart = true;
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (atCellStart) {
      if (character === '"') {
        result += character;
        quoted = true;
        atCellStart = false;
        if (/^[=+\-@\t\r]$/.test(value[index + 1] || "")) result += "'";
        continue;
      }
      if (/^[=+\-@\t\r]$/.test(character)) result += "'";
      atCellStart = false;
    }
    result += character;
    if (character === '"' && quoted) {
      if (value[index + 1] === '"') {
        result += value[++index];
      } else {
        quoted = false;
      }
    } else if (!quoted && character === ",") {
      atCellStart = true;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      atCellStart = true;
    }
  }
  return result;
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
  if (!type) throw new Error("Unsupported tender document type");
  if (!bytes.length || bytes.length > type.maximumBytes) {
    throw new Error(
      `${type.extension.toUpperCase()} document size is outside the allowed limit`,
    );
  }

  if (type.extension === "pdf") assertPdf(bytes);
  if (type.extension === "csv") assertCsv(bytes);
  if (["docx", "xlsx", "zip"].includes(type.extension)) {
    inspectZipArchive(bytes);
  }
  if (type.extension === "docx" || type.extension === "xlsx") {
    const entries = extractZipArchiveBounded(bytes);
    if (type.extension === "docx") assertDocx(entries);
    else assertXlsx(entries);
  }
  return type;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTenderImportFile,
  TENDER_IMPORT_FILE_LIMIT,
  TENDER_IMPORT_TOTAL_BYTES,
  tenderImportFileType,
} from "./tender-import-file-types.ts";

test("recognizes every Universal Tender Import file type", () => {
  assert.equal(tenderImportFileType("notice.PDF")?.mimeType, "application/pdf");
  assert.equal(tenderImportFileType("specification.docx")?.extension, "docx");
  assert.equal(tenderImportFileType("lots.xlsx")?.extension, "xlsx");
  assert.equal(tenderImportFileType("prices.csv")?.extension, "csv");
  assert.equal(tenderImportFileType("package.zip")?.archive, true);
  assert.equal(tenderImportFileType("legacy.doc"), null);
});

test("validates signatures without trusting the browser MIME declaration", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nsynthetic");
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const docx = new Uint8Array([
    0x50,
    0x4b,
    0x03,
    0x04,
    ...new TextEncoder().encode("[Content_Types].xml word/document.xml"),
  ]);
  const xlsx = new Uint8Array([
    0x50,
    0x4b,
    0x03,
    0x04,
    ...new TextEncoder().encode("[Content_Types].xml xl/workbook.xml"),
  ]);
  const csv = new TextEncoder().encode("lot,product,quantity\n1,Gloves,1000");

  assert.equal(assertTenderImportFile(pdf, "notice.pdf").extension, "pdf");
  assert.equal(assertTenderImportFile(zip, "package.zip").extension, "zip");
  assert.equal(assertTenderImportFile(docx, "word.docx").extension, "docx");
  assert.equal(assertTenderImportFile(xlsx, "sheets.xlsx").extension, "xlsx");
  assert.equal(assertTenderImportFile(csv, "lots.csv").extension, "csv");
});

test("rejects extension and content mismatches", () => {
  const text = new TextEncoder().encode("not really a PDF");
  const binary = new Uint8Array([0, 1, 2, 3, 4]);

  assert.throws(
    () => assertTenderImportFile(text, "notice.pdf"),
    /signature/,
  );
  assert.throws(
    () => assertTenderImportFile(text, "package.zip"),
    /signature/,
  );
  assert.throws(
    () => assertTenderImportFile(binary, "lots.csv"),
    /not a supported text/,
  );
});

test("keeps import count and aggregate byte limits bounded", () => {
  assert.equal(TENDER_IMPORT_FILE_LIMIT, 6);
  assert.equal(TENDER_IMPORT_TOTAL_BYTES, 100 * 1024 * 1024);
});

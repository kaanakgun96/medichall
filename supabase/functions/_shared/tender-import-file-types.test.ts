import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "npm:fflate@0.8.2";
import {
  assertTenderImportFile,
  neutralizeCsvFormulaText,
  TENDER_IMPORT_FILE_LIMIT,
  TENDER_IMPORT_TOTAL_BYTES,
  tenderImportContentSha256,
  tenderImportFileSetFingerprint,
  tenderImportFileType,
} from "./tender-import-file-types.ts";

const encode = (value: string) => new TextEncoder().encode(value);

function packageZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [
        name,
        typeof value === "string" ? encode(value) : value,
      ]),
    ),
  );
}

function validPdf(): Uint8Array {
  return encode(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
      "xref\n0 2\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R >>\n" +
      "startxref\n9\n%%EOF\n",
  );
}

function validDocx(extra: Record<string, string | Uint8Array> = {}) {
  return packageZip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    ...extra,
  });
}

function validXlsx(extra: Record<string, string | Uint8Array> = {}) {
  return packageZip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "xl/workbook.xml":
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lots" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
    ...extra,
  });
}

test("recognizes every Universal Tender Import file type", () => {
  assert.equal(tenderImportFileType("notice.PDF")?.mimeType, "application/pdf");
  assert.equal(tenderImportFileType("specification.docx")?.extension, "docx");
  assert.equal(tenderImportFileType("lots.xlsx")?.extension, "xlsx");
  assert.equal(tenderImportFileType("prices.csv")?.extension, "csv");
  assert.equal(tenderImportFileType("package.zip")?.archive, true);
  assert.equal(tenderImportFileType("legacy.doc"), null);
});

test("accepts structurally valid PDF, Office, CSV, and ZIP files", () => {
  assert.equal(
    assertTenderImportFile(validPdf(), "notice.pdf").extension,
    "pdf",
  );
  assert.equal(
    assertTenderImportFile(validDocx(), "word.docx").extension,
    "docx",
  );
  assert.equal(
    assertTenderImportFile(validXlsx(), "sheets.xlsx").extension,
    "xlsx",
  );
  assert.equal(
    assertTenderImportFile(
      encode("lot,product,quantity\n1,Gloves,1000"),
      "lots.csv",
    )
      .extension,
    "csv",
  );
  assert.equal(
    assertTenderImportFile(
      packageZip({ "notice.pdf": validPdf() }),
      "package.zip",
    )
      .extension,
    "zip",
  );
});

test("rejects empty, truncated, executable, and PDF polyglot files", () => {
  assert.throws(
    () => assertTenderImportFile(new Uint8Array(), "empty.pdf"),
    /size/,
  );
  assert.throws(
    () => assertTenderImportFile(encode("%PDF-1.7\ntruncated"), "notice.pdf"),
    /malformed or truncated/,
  );
  const executable = new Uint8Array([
    0x4d,
    0x5a,
    ...encode("fake executable %PDF-1.7\n%%EOF"),
  ]);
  assert.throws(
    () => assertTenderImportFile(executable, "renamed.pdf"),
    /header/,
  );
});

test("rejects marker-only, malformed, relationship-corrupt, and macro Office files", () => {
  const html = encode(
    "<html>[Content_Types].xml word/document.xml</html>",
  );
  assert.throws(() => assertTenderImportFile(html, "renamed.docx"), /ZIP/);

  const markersOnly = packageZip({
    "markers.txt": "[Content_Types].xml word/document.xml",
  });
  assert.throws(
    () => assertTenderImportFile(markersOnly, "markers.docx"),
    /missing/,
  );

  const corruptRelationships = validXlsx({
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="wrong" Target="worksheets/missing.xml"/></Relationships>',
  });
  assert.throws(
    () => assertTenderImportFile(corruptRelationships, "broken.xlsx"),
    /relationship/,
  );

  const macro = validDocx({
    "word/vbaProject.bin": new Uint8Array([1, 2, 3]),
  });
  assert.throws(
    () => assertTenderImportFile(macro, "macro.docx"),
    /Macro-enabled/,
  );
});

test("rejects null-byte, invalid UTF-8, and binary-heavy CSV files", () => {
  assert.throws(
    () => assertTenderImportFile(new Uint8Array([97, 0, 98]), "null.csv"),
    /null bytes/,
  );
  assert.throws(
    () => assertTenderImportFile(new Uint8Array([0xc3, 0x28]), "encoding.csv"),
    /UTF-8/,
  );
  assert.throws(
    () =>
      assertTenderImportFile(
        new Uint8Array(Array.from({ length: 100 }, (_, index) => index % 8)),
        "binary.csv",
      ),
    /null bytes|binary-heavy/,
  );
});

test("neutralizes spreadsheet formulas at raw and quoted cell boundaries", () => {
  assert.equal(
    neutralizeCsvFormulaText(
      'name,value\nAlpha,=HYPERLINK("bad")\n"+cmd",safe\n@call,-2',
    ),
    "name,value\nAlpha,'=HYPERLINK(\"bad\")\n\"'+cmd\",safe\n'@call,'-2",
  );
});

test("keeps import count and aggregate byte limits bounded", () => {
  assert.equal(TENDER_IMPORT_FILE_LIMIT, 6);
  assert.equal(TENDER_IMPORT_TOTAL_BYTES, 100 * 1024 * 1024);
});

test("fingerprints file contents independently of selection order", async () => {
  const first = await tenderImportContentSha256(encode("first"));
  const second = await tenderImportContentSha256(encode("second"));
  assert.equal(
    await tenderImportFileSetFingerprint([first, second]),
    await tenderImportFileSetFingerprint([second, first]),
  );
  assert.notEqual(
    await tenderImportFileSetFingerprint([first, second]),
    await tenderImportFileSetFingerprint([
      first,
      await tenderImportContentSha256(encode("changed")),
    ]),
  );
});

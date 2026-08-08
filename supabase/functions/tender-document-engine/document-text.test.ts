import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "npm:fflate@0.8.2";
import { documentText } from "./handler.ts";

function minimalDocx(text: string): Uint8Array {
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships =
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const document =
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "word/document.xml": strToU8(document),
  }, { level: 0 });
}

test("DOCX text extraction supplies Mammoth's Node buffer option", async () => {
  const extracted = await documentText(
    minimalDocx("Sterile nitrile gloves, quantity 1200 boxes."),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    2_000,
  );

  assert.equal(
    extracted.trim(),
    "Sterile nitrile gloves, quantity 1200 boxes.",
  );
});

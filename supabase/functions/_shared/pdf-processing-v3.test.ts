import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { inspectPdfBytes, materializePdfChunks } from "./pdf-processing-v3.ts";
import { readDocumentIntelligenceConfig } from "./document-intelligence-v3.ts";

async function syntheticProcurementPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const technicalPages = new Set([
    Math.max(4, Math.floor(pageCount * 0.42)),
    Math.max(5, Math.floor(pageCount * 0.78)),
    pageCount - 2,
  ]);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = document.addPage([595, 842]);
    const text = pageNumber === 2
      ? "TABLE OF CONTENTS Technical specification Annex product table"
      : technicalPages.has(pageNumber)
      ? `ANNEX ${pageNumber} TECHNICAL SPECIFICATION sterile medical device quantity 5000 CE ISO requirements`
      : `Procurement notice page ${pageNumber}`;
    page.drawText(text, {
      x: 36,
      y: 800,
      size: technicalPages.has(pageNumber) ? 18 : 10,
      font,
    });
  }
  document.setTitle(`Synthetic ${pageCount}-page procurement document`);
  return await document.save({ useObjectStreams: true, objectsPerTick: 100 });
}

const config = readDocumentIntelligenceConfig((name) => ({
  MAX_PDF_PAGES: "2000",
  KEYWORD_SCAN_LIMIT: "2000",
  MAX_TOTAL_AI_PAGES: "48",
  MAX_CHUNK_SIZE: "12",
  CHUNK_OVERLAP_PAGES: "2",
  INSPECTION_TIMEOUT: "180000",
}[name]));

for (const pageCount of [120, 250, 500]) {
  test(`inspects and plans a ${pageCount}-page PDF without page-count rejection`, async () => {
    const bytes = await syntheticProcurementPdf(pageCount);
    const inspection = await inspectPdfBytes(bytes, config);
    assert.equal(inspection.pageCount, pageCount);
    assert.equal(inspection.scannedPageCount, pageCount);
    assert.equal(inspection.inspectionPartial, false);
    assert.ok(inspection.tableOfContentsPages.includes(2));
    assert.ok(
      inspection.pageSignals.some((signal) =>
        signal.matchedKeywords.includes("technical specification")
      ),
    );
    const chunks = await materializePdfChunks(bytes, inspection, config);
    const selectedPages = chunks.reduce(
      (total, chunk) => total + chunk.plan.pageNumbers.length,
      0,
    );
    assert.ok(chunks.length > 0);
    assert.ok(selectedPages <= config.maxTotalAiPages);
    assert.ok(
      chunks.some((chunk) =>
        chunk.plan.startPage > Math.floor(pageCount * 0.3)
      ),
    );
    for (const chunk of chunks) {
      const sliced = await PDFDocument.load(chunk.bytes);
      assert.equal(sliced.getPageCount(), chunk.plan.pageNumbers.length);
      assert.ok(chunk.bytes.byteLength <= config.maxAiChunkBytes);
    }
  });
}

test("inspection remains partial rather than rejecting when scan work is capped", async () => {
  const bytes = await syntheticProcurementPdf(120);
  const capped = readDocumentIntelligenceConfig((name) => ({
    MAX_PDF_PAGES: "100",
    KEYWORD_SCAN_LIMIT: "100",
    MAX_TOTAL_AI_PAGES: "24",
    INSPECTION_TIMEOUT: "180000",
  }[name]));
  const inspection = await inspectPdfBytes(bytes, capped);
  assert.equal(inspection.pageCount, 120);
  assert.equal(inspection.scannedPageCount, 100);
  assert.equal(inspection.inspectionPartial, true);
  assert.ok(inspection.pageSignals.some((signal) => signal.pageNumber === 120));
});

import { PDFDocument } from "npm:pdf-lib@1.17.1";
import * as pdfjs from "https://esm.sh/pdfjs-dist@4.10.38/legacy/build/pdf.mjs?target=denonext";
import {
  buildPageScanOrder,
  type DocumentIntelligenceConfig,
  generatePdfChunkPlans,
  isTableOfContentsText,
  type PdfChunkPlan,
  type PdfInspection,
  type PdfOutlineEntry,
  type PdfPageSignal,
  procurementKeywords,
  rankRelevantPageRanges,
  scoreProcurementPage,
} from "./document-intelligence-v3.ts";

type PdfJsDocument = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;

type PdfJsOutlineItem = {
  title?: string;
  dest?: string | unknown[] | null;
  items?: PdfJsOutlineItem[];
};

export type MaterializedPdfChunk = {
  plan: PdfChunkPlan;
  bytes: Uint8Array;
};

function boundedMetadataValue(
  value: unknown,
): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\s+/g, " ").trim().slice(0, 1_000) || null;
}

function metadataRecord(value: unknown): Record<
  string,
  string | number | boolean | null
> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key.slice(0, 100)] = boundedMetadataValue(item);
  }
  return output;
}

async function outlinePageNumber(
  document: PdfJsDocument,
  destination: string | unknown[] | null | undefined,
): Promise<number | null> {
  try {
    const resolved = typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
    if (!Array.isArray(resolved) || !resolved[0]) return null;
    const reference = resolved[0] as { num?: number; gen?: number };
    if (
      typeof reference === "object" &&
      Number.isInteger(reference.num) &&
      Number.isInteger(reference.gen)
    ) {
      return await document.getPageIndex(reference as never) + 1;
    }
    if (Number.isInteger(Number(reference))) {
      return Number(reference) + 1;
    }
  } catch {
    // Invalid outline destinations are retained with a null page number.
  }
  return null;
}

async function flattenOutline(
  document: PdfJsDocument,
  items: readonly PdfJsOutlineItem[],
  depth = 0,
  output: PdfOutlineEntry[] = [],
): Promise<PdfOutlineEntry[]> {
  for (const item of items.slice(0, 2_000)) {
    const title = String(item.title || "").replace(/\s+/g, " ").trim()
      .slice(0, 500);
    if (title) {
      output.push({
        title,
        depth,
        pageNumber: await outlinePageNumber(document, item.dest),
      });
    }
    if (Array.isArray(item.items) && depth < 12) {
      await flattenOutline(document, item.items, depth + 1, output);
    }
  }
  return output;
}

function pageTextAndTitle(
  items: readonly unknown[],
): { text: string; sectionTitle: string | null } {
  const textItems = items.flatMap((item) => {
    if (!item || typeof item !== "object" || !("str" in item)) return [];
    const row = item as {
      str?: string;
      hasEOL?: boolean;
      transform?: number[];
      height?: number;
    };
    const text = String(row.str || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const fontSize = Math.abs(Number(row.height || row.transform?.[3] || 0));
    return [{ text, fontSize, hasEOL: Boolean(row.hasEOL) }];
  });
  const text = textItems.map((item) => item.text).join(" ").replace(/\s+/g, " ")
    .trim().slice(0, 100_000);
  const largest = [...textItems]
    .filter((item) => item.text.length >= 3 && item.text.length <= 220)
    .sort((left, right) =>
      right.fontSize - left.fontSize ||
      left.text.localeCompare(right.text)
    )[0];
  return {
    text,
    sectionTitle: largest?.text || null,
  };
}

function mergeScanOrder(
  base: readonly number[],
  outline: readonly PdfOutlineEntry[],
  limit: number,
): number[] {
  const priority = [
    ...base.slice(0, Math.min(10, base.length)),
    ...outline.flatMap((item) => item.pageNumber ? [item.pageNumber] : []),
    ...base,
  ];
  return [...new Set(priority)].slice(0, limit);
}

async function inspectWithPdfJs(
  bytes: Uint8Array,
  config: DocumentIntelligenceConfig,
): Promise<PdfInspection> {
  const startedAt = performance.now();
  const loadingTask = pdfjs.getDocument({
    // pdf.js may transfer/detach its input buffer. Keep the caller's bytes
    // intact because the same source is subsequently sliced into AI chunks.
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    stopAtErrors: false,
  });
  const document = await loadingTask.promise;
  try {
    const pageCount = document.numPages;
    const rawMetadata = await document.getMetadata().catch(() => null);
    const rawOutline = await document.getOutline().catch(() => null);
    const outline = await flattenOutline(
      document,
      Array.isArray(rawOutline) ? rawOutline as PdfJsOutlineItem[] : [],
    );
    const scanLimit = Math.min(
      pageCount,
      config.keywordScanLimit,
      config.maxPdfPages,
    );
    const scanOrder = mergeScanOrder(
      buildPageScanOrder(pageCount, scanLimit),
      outline,
      scanLimit,
    );
    const keywords = procurementKeywords(config.extraKeywords);
    const pageSignals: PdfPageSignal[] = [];
    const tableOfContentsPages: number[] = [];
    let scannedPageCount = 0;
    for (const pageNumber of scanOrder) {
      if (
        performance.now() - startedAt >= config.inspectionTimeoutMs &&
        scannedPageCount > 0
      ) {
        break;
      }
      try {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        });
        const { text, sectionTitle } = pageTextAndTitle(content.items);
        const scored = scoreProcurementPage(text, keywords);
        const isToc = isTableOfContentsText(text.slice(0, 5_000));
        if (isToc) tableOfContentsPages.push(pageNumber);
        pageSignals.push({
          pageNumber,
          keywordScore: scored.score + (isToc ? 12 : 0),
          matchedKeywords: scored.matchedKeywords,
          sectionTitle,
          excerpt: text.slice(0, 500),
        });
        page.cleanup();
      } catch {
        pageSignals.push({
          pageNumber,
          keywordScore: 0,
          matchedKeywords: [],
          sectionTitle: null,
          excerpt: "",
        });
      }
      scannedPageCount++;
    }
    const seed = {
      pageCount,
      outline,
      tableOfContentsPages: [...new Set(tableOfContentsPages)].sort(
        (left, right) => left - right,
      ),
      pageSignals: pageSignals.sort((left, right) =>
        left.pageNumber - right.pageNumber
      ),
    };
    return {
      ...seed,
      scannedPageCount,
      scanLimit,
      inspectionPartial: scannedPageCount < pageCount,
      metadata: {
        ...metadataRecord(rawMetadata?.info),
        ...metadataRecord(rawMetadata?.metadata?.getAll?.()),
        has_outline: outline.length > 0,
        has_table_of_contents: tableOfContentsPages.length > 0,
      },
      rankedRanges: rankRelevantPageRanges(seed),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } finally {
    await document.destroy();
  }
}

async function inspectWithPdfLibFallback(
  bytes: Uint8Array,
  config: DocumentIntelligenceConfig,
  startedAt: number,
): Promise<PdfInspection> {
  const document = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const pageCount = document.getPageCount();
  const seed = {
    pageCount,
    outline: [] as PdfOutlineEntry[],
    tableOfContentsPages: [] as number[],
    pageSignals: [] as PdfPageSignal[],
  };
  return {
    ...seed,
    scannedPageCount: 0,
    scanLimit: Math.min(
      pageCount,
      config.keywordScanLimit,
      config.maxPdfPages,
    ),
    inspectionPartial: true,
    metadata: {
      title: boundedMetadataValue(document.getTitle()),
      author: boundedMetadataValue(document.getAuthor()),
      subject: boundedMetadataValue(document.getSubject()),
      creator: boundedMetadataValue(document.getCreator()),
      producer: boundedMetadataValue(document.getProducer()),
      keywords: boundedMetadataValue(document.getKeywords()),
      parser_fallback: true,
    },
    rankedRanges: rankRelevantPageRanges(seed),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}

export async function inspectPdfBytes(
  bytes: Uint8Array,
  config: DocumentIntelligenceConfig,
): Promise<PdfInspection> {
  const startedAt = performance.now();
  try {
    return await inspectWithPdfJs(bytes, config);
  } catch {
    // Page count and deterministic coverage remain available for PDFs whose
    // text/outline structures are malformed but whose pages can still be read.
    return await inspectWithPdfLibFallback(bytes, config, startedAt);
  }
}

async function slicePdfPages(
  source: PDFDocument,
  pageNumbers: readonly number[],
): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const indices = pageNumbers.map((page) => page - 1);
  const pages = await output.copyPages(source, indices);
  for (const page of pages) output.addPage(page);
  output.setTitle(
    `MedicHall source pages ${pageNumbers[0]}-${pageNumbers.at(-1)}`,
  );
  output.setSubject(
    `Original source page mapping: ${pageNumbers.join(",")}`,
  );
  return await output.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50,
  });
}

async function materializePlan(
  source: PDFDocument,
  plan: PdfChunkPlan,
  maxBytes: number,
): Promise<
  Array<
    Omit<MaterializedPdfChunk, "plan"> & {
      plan: Omit<PdfChunkPlan, "chunkIndex">;
    }
  >
> {
  const bytes = await slicePdfPages(source, plan.pageNumbers);
  if (bytes.byteLength <= maxBytes) {
    return [{ bytes, plan }];
  }
  if (plan.pageNumbers.length <= 1) {
    throw new Error(
      `PDF source page ${plan.startPage} exceeds the configured AI chunk byte limit`,
    );
  }
  const midpoint = Math.ceil(plan.pageNumbers.length / 2);
  const halves = [
    plan.pageNumbers.slice(0, midpoint),
    plan.pageNumbers.slice(midpoint),
  ];
  const output: Array<
    Omit<MaterializedPdfChunk, "plan"> & {
      plan: Omit<PdfChunkPlan, "chunkIndex">;
    }
  > = [];
  for (const pages of halves) {
    output.push(
      ...await materializePlan(source, {
        chunkIndex: 0,
        startPage: pages[0],
        endPage: pages.at(-1)!,
        pageNumbers: pages,
        priorityScore: plan.priorityScore,
        reasons: [...new Set([...plan.reasons, "byte_limit_split"])],
      }, maxBytes),
    );
  }
  return output;
}

export async function materializePdfChunks(
  sourceBytes: Uint8Array,
  inspection: PdfInspection,
  config: DocumentIntelligenceConfig,
  aiPageBudget = config.maxTotalAiPages,
): Promise<MaterializedPdfChunk[]> {
  const source = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
  const plans = generatePdfChunkPlans(inspection.rankedRanges, {
    ...config,
    maxTotalAiPages: Math.max(
      1,
      Math.min(
        config.maxTotalAiPages,
        aiPageBudget,
      ),
    ),
  });
  const materialized = [];
  for (const plan of plans) {
    materialized.push(
      ...await materializePlan(source, plan, config.maxAiChunkBytes),
    );
  }
  return materialized
    .sort((left, right) =>
      left.plan.startPage - right.plan.startPage ||
      left.plan.endPage - right.plan.endPage
    )
    .map((chunk, chunkIndex) => ({
      ...chunk,
      plan: { ...chunk.plan, chunkIndex },
    }));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

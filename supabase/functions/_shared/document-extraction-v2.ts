export const DOCUMENT_EXTRACTION_VERSION = "tender-extraction-v2.0.0";
export const DOCUMENT_PROMPT_SCHEMA_VERSION = "medichall-tender-facts-v2";

const REQUIREMENT_STATUSES = new Set([
  "mandatory",
  "descriptive",
  "unknown",
]);
const QUANTITY_SCOPES = new Set([
  "annual",
  "contract",
  "estimated",
  "minimum",
  "package",
  "lot",
  "unknown",
]);
const EVIDENCE_FIELDS = new Set([
  "buyer",
  "certification",
  "country",
  "currency",
  "deadline",
  "delivery",
  "dimensions",
  "language",
  "material",
  "packaging",
  "product_name",
  "publication_date",
  "quantity",
  "sterility",
  "technical_requirement",
  "tender_title",
  "value",
]);

export type RequirementStatus = "mandatory" | "descriptive" | "unknown";
export type QuantityScope =
  | "annual"
  | "contract"
  | "estimated"
  | "minimum"
  | "package"
  | "lot"
  | "unknown";

export type ExtractionEvidence = {
  document_id: number;
  page_number: number | null;
  sheet_name: string | null;
  cell_range: string | null;
  source_quote: string;
  field_name: string;
  extracted_value: string;
  normalized_value: string | null;
  requirement_status: RequirementStatus;
  source_language: string | null;
  confidence_score: number;
};

export type NormalizedProduct = {
  product_name: string;
  normalized_product_name: string | null;
  product_description_original: string | null;
  product_description_normalized_en: string | null;
  lot_number: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  quantity_scope: QuantityScope;
  packaging: string | null;
  package_quantity: number | null;
  package_unit: string | null;
  units_per_package: number | null;
  sterility: string | null;
  material: string | null;
  dimensions: string | null;
  required_certifications: string[];
  technical_requirements: string[];
  requirements: Array<{
    name: string;
    value: string | null;
    normalized_value: string | null;
    status: RequirementStatus;
  }>;
  confidence_score: number;
  evidence: ExtractionEvidence[];
};

export type NormalizedTenderFacts = {
  title_original: string | null;
  title_normalized_en: string | null;
  authority_original: string | null;
  authority_normalized_en: string | null;
  country_code: string | null;
  country_name_original: string | null;
  publication_date: string | null;
  deadline_at: string | null;
  cpv_codes: string[];
  estimated_value: number | null;
  currency: string | null;
  delivery_requirements: string[];
  submission_languages: string[];
  document_languages: string[];
};

export type NormalizedDocumentAnalysis = {
  schema_version: string;
  analysis_status: "completed" | "partial";
  document_confidence_score: number;
  data_completeness_score: number;
  summary: string;
  missing_information: string[];
  tender: NormalizedTenderFacts;
  products: NormalizedProduct[];
  lots: Array<{
    lot_number: string | null;
    lot_title: string | null;
    estimated_quantity: number | null;
    quantity_unit: string | null;
    estimated_value: number | null;
    currency: string | null;
  }>;
  fit_narrative: string | null;
  evidence_count: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedText(value: unknown, maximum = 1_000): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maximum) : null;
}

function stringArray(
  value: unknown,
  limit = 100,
  maximumLength = 500,
): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) =>
          typeof item === "object" && item
            ? boundedText(
              (item as Record<string, unknown>).value ||
                (item as Record<string, unknown>).name,
              maximumLength,
            )
            : boundedText(item, maximumLength)
        )
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, limit);
}

export function clampExtractionScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function normalizeDecimal(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = boundedText(value, 80);
  if (!raw) return null;
  const withoutSpaces = raw.replace(/[\s\u00a0]/g, "");
  const groupedInteger = /^[-+]?\d{1,3}(?:[.,]\d{3})+$/.test(withoutSpaces);
  const decimalComma = /^[-+]?\d{1,3}(?:\.\d{3})*,\d+$/.test(withoutSpaces);
  const decimalDot = /^[-+]?\d{1,3}(?:,\d{3})*\.\d+$/.test(withoutSpaces);
  const normalized = groupedInteger
    ? withoutSpaces.replace(/[.,]/g, "")
    : decimalComma
    ? withoutSpaces.replaceAll(".", "").replace(",", ".")
    : decimalDot
    ? withoutSpaces.replaceAll(",", "")
    : withoutSpaces.replace(",", ".");
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeUnit(value: unknown): string | null {
  const original = boundedText(value, 80);
  if (!original) return null;
  const key = original.toLowerCase().replace(/[.\s_-]+/g, "");
  const aliases: Record<string, string> = {
    adet: "piece",
    ad: "piece",
    ea: "piece",
    each: "piece",
    pcs: "piece",
    pc: "piece",
    pieces: "piece",
    piece: "piece",
    units: "piece",
    unit: "piece",
    ünite: "piece",
    boîtes: "box",
    boite: "box",
    boxes: "box",
    box: "box",
    cartons: "carton",
    carton: "carton",
    packs: "pack",
    pack: "pack",
    paket: "pack",
    kg: "kg",
    kilogram: "kg",
    kilograms: "kg",
    g: "g",
    gram: "g",
    grams: "g",
    l: "l",
    litre: "l",
    liter: "l",
    ml: "ml",
    millilitre: "ml",
    milliliter: "ml",
  };
  return aliases[key] || original.toLowerCase();
}

export function estimatePdfPageCount(bytes: Uint8Array): number | null {
  const sample = new TextDecoder().decode(bytes);
  const matches = sample.match(/\/Type\s*\/Page\b/g);
  return matches?.length || null;
}

function normalizedStatus(value: unknown): RequirementStatus {
  const status = boundedText(value, 30)?.toLowerCase() || "unknown";
  return REQUIREMENT_STATUSES.has(status)
    ? status as RequirementStatus
    : "unknown";
}

function normalizedScope(value: unknown): QuantityScope {
  const scope = boundedText(value, 30)?.toLowerCase() || "unknown";
  return QUANTITY_SCOPES.has(scope) ? scope as QuantityScope : "unknown";
}

function normalizeEvidence(
  value: unknown,
  allowedDocumentIds: ReadonlySet<number>,
): ExtractionEvidence | null {
  const item = record(value);
  const documentId = Number(item.document_id);
  const quote = boundedText(item.source_quote, 600);
  const field = boundedText(item.field_name, 80)?.toLowerCase();
  const extractedValue = boundedText(item.extracted_value, 500);
  if (
    !Number.isInteger(documentId) ||
    !allowedDocumentIds.has(documentId) ||
    !quote ||
    !field ||
    !EVIDENCE_FIELDS.has(field) ||
    !extractedValue
  ) {
    return null;
  }
  const pageNumber = Number(item.page_number);
  return {
    document_id: documentId,
    page_number: Number.isInteger(pageNumber) && pageNumber > 0
      ? pageNumber
      : null,
    sheet_name: boundedText(item.sheet_name, 160),
    cell_range: boundedText(item.cell_range, 80),
    source_quote: quote,
    field_name: field,
    extracted_value: extractedValue,
    normalized_value: boundedText(item.normalized_value, 500),
    requirement_status: normalizedStatus(item.requirement_status),
    source_language: boundedText(item.source_language, 20),
    confidence_score: clampExtractionScore(item.confidence_score),
  };
}

function normalizeRequirements(
  value: unknown,
): NormalizedProduct["requirements"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((raw) => {
    const item = record(raw);
    const name = boundedText(item.name, 200);
    if (!name) return [];
    return [{
      name,
      value: boundedText(item.value, 500),
      normalized_value: boundedText(item.normalized_value, 500),
      status: normalizedStatus(item.status),
    }];
  });
}

function normalizeProduct(
  value: unknown,
  allowedDocumentIds: ReadonlySet<number>,
): NormalizedProduct | null {
  const item = record(value);
  const productName = boundedText(item.product_name, 500);
  if (!productName) return null;
  const packaging = record(item.packaging_details);
  const evidence = Array.isArray(item.evidence)
    ? item.evidence
      .map((entry) => normalizeEvidence(entry, allowedDocumentIds))
      .filter((entry): entry is ExtractionEvidence => Boolean(entry))
      .slice(0, 200)
    : [];
  return {
    product_name: productName,
    normalized_product_name: boundedText(item.normalized_product_name, 500),
    product_description_original: boundedText(
      item.product_description_original,
      2_000,
    ),
    product_description_normalized_en: boundedText(
      item.product_description_normalized_en,
      2_000,
    ),
    lot_number: boundedText(item.lot_number, 120),
    quantity_value: normalizeDecimal(item.quantity_value),
    quantity_unit: normalizeUnit(item.quantity_unit),
    quantity_scope: normalizedScope(item.quantity_scope),
    packaging: boundedText(item.packaging, 500),
    package_quantity: normalizeDecimal(packaging.package_quantity),
    package_unit: normalizeUnit(packaging.package_unit),
    units_per_package: normalizeDecimal(packaging.units_per_package),
    sterility: boundedText(item.sterility, 500),
    material: boundedText(item.material, 500),
    dimensions: boundedText(item.dimensions, 500),
    required_certifications: stringArray(
      item.required_certifications,
      50,
      200,
    ),
    technical_requirements: stringArray(
      item.technical_requirements,
      100,
      500,
    ),
    requirements: normalizeRequirements(item.requirements),
    confidence_score: clampExtractionScore(item.confidence_score),
    evidence,
  };
}

function normalizeIsoDate(value: unknown, includeTime: boolean): string | null {
  const text = boundedText(value, 80);
  if (!text) return null;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return includeTime
    ? new Date(timestamp).toISOString()
    : new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeCpvCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((item) => {
        const digits = String(item || "").replace(/\D/g, "");
        return digits.length >= 8 ? [digits.slice(0, 8)] : [];
      }),
    ),
  ].slice(0, 100);
}

function normalizeTenderFacts(value: unknown): NormalizedTenderFacts {
  const item = record(value);
  const countryCode = boundedText(item.country_code, 2)?.toUpperCase() || null;
  const currency = boundedText(item.currency, 3)?.toUpperCase() || null;
  return {
    title_original: boundedText(item.title_original, 1_000),
    title_normalized_en: boundedText(item.title_normalized_en, 1_000),
    authority_original: boundedText(item.authority_original, 500),
    authority_normalized_en: boundedText(
      item.authority_normalized_en,
      500,
    ),
    country_code: countryCode && /^[A-Z]{2}$/.test(countryCode)
      ? countryCode
      : null,
    country_name_original: boundedText(item.country_name_original, 200),
    publication_date: normalizeIsoDate(item.publication_date, false),
    deadline_at: normalizeIsoDate(item.deadline_at, true),
    cpv_codes: normalizeCpvCodes(item.cpv_codes),
    estimated_value: normalizeDecimal(item.estimated_value),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    delivery_requirements: stringArray(
      item.delivery_requirements,
      50,
      500,
    ),
    submission_languages: stringArray(
      item.submission_languages,
      20,
      80,
    ),
    document_languages: stringArray(item.document_languages, 20, 80),
  };
}

function normalizeLots(value: unknown): NormalizedDocumentAnalysis["lots"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((raw) => {
    const item = record(raw);
    const currency = boundedText(item.currency, 3)?.toUpperCase() || null;
    const lot = {
      lot_number: boundedText(item.lot_number, 120),
      lot_title: boundedText(item.lot_title, 500),
      estimated_quantity: normalizeDecimal(item.estimated_quantity),
      quantity_unit: normalizeUnit(item.quantity_unit),
      estimated_value: normalizeDecimal(item.estimated_value),
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    };
    return Object.values(lot).some((entry) => entry !== null) ? [lot] : [];
  });
}

export function normalizeDocumentAnalysis(
  value: unknown,
  allowedDocumentIds: ReadonlySet<number>,
): NormalizedDocumentAnalysis {
  const input = record(value);
  const products = Array.isArray(input.products)
    ? input.products
      .map((item) => normalizeProduct(item, allowedDocumentIds))
      .filter((item): item is NormalizedProduct => Boolean(item))
      .slice(0, 100)
    : [];
  const evidenceCount = products.reduce(
    (count, product) => count + product.evidence.length,
    0,
  );
  const requestedStatus = input.analysis_status === "completed"
    ? "completed"
    : "partial";
  const analysisStatus = products.length > 0 && evidenceCount > 0
    ? requestedStatus
    : "partial";
  const modelConfidence = clampExtractionScore(
    input.document_confidence_score,
  );
  const modelCompleteness = clampExtractionScore(
    input.data_completeness_score,
  );
  const evidenceCap = evidenceCount === 0 ? 35 : 100;
  const missing = stringArray(input.missing_information, 100, 500);
  if (!products.length && !missing.includes("Product lines with evidence")) {
    missing.push("Product lines with evidence");
  }
  if (
    evidenceCount === 0 &&
    !missing.includes("Document source references")
  ) {
    missing.push("Document source references");
  }

  return {
    schema_version: DOCUMENT_PROMPT_SCHEMA_VERSION,
    analysis_status: analysisStatus,
    document_confidence_score: Math.min(modelConfidence, evidenceCap),
    data_completeness_score: Math.min(modelCompleteness, evidenceCap),
    summary: boundedText(input.summary, 2_000) || "",
    missing_information: missing,
    tender: normalizeTenderFacts(input.tender),
    products,
    lots: normalizeLots(input.lots),
    fit_narrative: boundedText(input.fit_narrative, 1_200),
    evidence_count: evidenceCount,
  };
}

export function shouldApplyExtraction(
  current: {
    confidenceScore: number;
    extractionVersion?: string | null;
    analyzedAt?: string | null;
  },
  next: {
    confidenceScore: number;
    extractionVersion: string;
  },
): boolean {
  if (!current.analyzedAt) return true;
  if (current.confidenceScore > next.confidenceScore) return false;
  if (
    current.confidenceScore === next.confidenceScore &&
    current.extractionVersion === next.extractionVersion
  ) {
    return false;
  }
  return true;
}

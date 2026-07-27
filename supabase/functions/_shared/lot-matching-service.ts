import {
  aggregateLotMatches,
  calculateTenderLotMatches,
  type CompanyProductCandidate,
  LOT_MATCH_CALCULATION_VERSION,
  type LotMatchCompanyInput,
  type LotMatchResult,
  normalizeMatchText,
  normalizeTenderLots,
} from "./lot-matching-v1.ts";
import { stableVersionHash } from "./matching-observability.ts";

type DataClient = {
  from: (table: string) => unknown;
};

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryBuilder = PromiseLike<QueryResult> & {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => QueryBuilder;
  maybeSingle: () => PromiseLike<QueryResult>;
  update: (value: Record<string, unknown>) => QueryBuilder;
  upsert: (
    value: Record<string, unknown>,
    options: { onConflict: string },
  ) => PromiseLike<QueryResult>;
};

export type RefreshTenderLotMatchesInput = {
  companyId: number;
  tenderId: number;
  traceId?: string | null;
};

export type RefreshTenderLotMatchesResult = {
  calculation_version: typeof LOT_MATCH_CALCULATION_VERSION;
  normalized_lot_count: number;
  changed_count: number;
  reused_count: number;
  failed_count: number;
  summary: Record<string, unknown>;
  results: LotMatchResult[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function table(client: DataClient, name: string): QueryBuilder {
  return client.from(name) as QueryBuilder;
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, maximum = 2_000): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).replace(/\s+/g, " ").trim();
  return result ? result.slice(0, maximum) : null;
}

function numberValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function stringArray(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(/[,;\n]/)
    : [];
  const output = new Map<string, string>();
  for (const item of source) {
    const itemText = text(item, 1_000);
    const key = normalizeMatchText(itemText);
    if (itemText && key && !output.has(key)) output.set(key, itemText);
  }
  return [...output.values()];
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = normalizeMatchText(value);
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return null;
}

function flattenSpecificationValues(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    return text(value, 1_000) ? [String(value)] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenSpecificationValues).slice(0, 100);
  }
  return Object.entries(record(value)).flatMap(([key, item]) => {
    const flattened = flattenSpecificationValues(item);
    return flattened.map((itemValue) => `${key}: ${itemValue}`);
  }).slice(0, 100);
}

export function mapCompanyProduct(
  value: Record<string, unknown>,
): CompanyProductCandidate | null {
  const id = numberValue(value.id);
  const name = text(value.name, 1_000);
  if (!Number.isInteger(id) || !name) return null;
  const specifications = [
    ...flattenSpecificationValues(value.specifications),
    ...flattenSpecificationValues(value.technical_specifications),
    ...flattenSpecificationValues(value.attributes),
  ];
  return {
    id: id as number,
    ref: text(value.ref, 300),
    name,
    category: text(value.category, 500),
    description: text(value.description, 4_000),
    material: text(value.material, 1_000),
    dimensions: text(
      value.dimensions ?? value.size ?? value.measurements,
      1_000,
    ),
    sterility: typeof value.sterility === "boolean"
      ? value.sterility
      : text(value.sterility ?? value.sterile, 300),
    single_use: booleanValue(value.single_use ?? value.disposable),
    reusable: booleanValue(value.reusable),
    packaging: text(
      value.packaging ?? value.package_description ?? value.pack_size,
      1_000,
    ),
    certifications: stringArray(
      value.certifications ?? value.required_certifications,
    ),
    production_capacity: numberValue(
      value.production_capacity ?? value.capacity,
    ),
    capacity_unit: text(
      value.capacity_unit ?? value.production_capacity_unit,
      120,
    ),
    extra_specifications: stringArray(specifications),
  };
}

function evidenceFromRow(value: Record<string, unknown>) {
  return {
    document_id: numberValue(value.document_id),
    page_number: numberValue(value.page_number),
    sheet_name: text(value.sheet_name, 200),
    cell_range: text(value.cell_range, 200),
    field_name: text(value.field_name, 200),
    source_quote: text(value.source_quote, 1_000),
    extracted_value: text(
      value.normalized_value ?? value.extracted_value,
      1_000,
    ),
    confidence_score: numberValue(value.confidence_score) ?? 0,
  };
}

function buildExtractionInput(
  tender: Record<string, unknown>,
  evidenceRows: Record<string, unknown>[],
): Record<string, unknown> {
  const extractionV3 = record(tender.document_extraction_v3);
  const products = values(tender.extracted_products).length
    ? values(tender.extracted_products).map((item) => ({ ...record(item) }))
    : values(extractionV3.products).map((item) => ({ ...record(item) }));
  const lots = values(tender.ai_lots).length
    ? values(tender.ai_lots)
    : values(extractionV3.lots);

  for (const evidenceRow of evidenceRows) {
    const evidenceLot = normalizeMatchText(evidenceRow.lot_number);
    const evidenceProduct = normalizeMatchText(evidenceRow.product_name);
    const candidate = products.find((item) => {
      const productLot = normalizeMatchText(item.lot_number);
      const productName = normalizeMatchText(
        item.normalized_product_name ?? item.product_name,
      );
      return (
        (!evidenceLot || evidenceLot === productLot) &&
        (!evidenceProduct || evidenceProduct === productName)
      );
    });
    if (!candidate) continue;
    candidate.evidence = [
      ...values(candidate.evidence),
      evidenceFromRow(evidenceRow),
    ];
  }

  return {
    ...extractionV3,
    products,
    lots,
    missing_information: values(tender.missing_information).length
      ? tender.missing_information
      : extractionV3.missing_information,
    document_confidence_score: numberValue(tender.document_confidence_score) ??
      numberValue(extractionV3.document_confidence_score) ??
      0,
  };
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 1_000);
  const message = text(record(value).message, 1_000);
  return message || "Lot match persistence failed";
}

export async function refreshTenderLotMatches(
  adminClient: DataClient,
  input: RefreshTenderLotMatchesInput,
): Promise<RefreshTenderLotMatchesResult> {
  const [
    tenderQuery,
    companyQuery,
    profileQuery,
    productsQuery,
    evidenceQuery,
  ] = await Promise.all([
    table(adminClient, "tenders").select(
      "id,extracted_products,ai_lots,document_extraction_v3,missing_information,document_confidence_score",
    ).eq("id", input.tenderId).maybeSingle(),
    table(adminClient, "companies").select("*").eq("id", input.companyId)
      .maybeSingle(),
    table(adminClient, "company_match_profiles").select("*").eq(
      "company_id",
      input.companyId,
    ).maybeSingle(),
    table(adminClient, "products").select("*").eq(
      "company_id",
      input.companyId,
    ).eq("is_active", true).order("id", { ascending: true }),
    table(adminClient, "tender_document_evidence").select(
      "document_id,page_number,sheet_name,cell_range,field_name,source_quote,extracted_value,normalized_value,confidence_score,lot_number,product_name",
    ).eq("tender_id", input.tenderId).order("id", { ascending: true }),
  ]);

  for (
    const [label, query] of [
      ["tender", tenderQuery],
      ["company", companyQuery],
      ["company profile", profileQuery],
      ["company products", productsQuery],
      ["tender evidence", evidenceQuery],
    ] as const
  ) {
    if (query.error) {
      throw new Error(`${label} query failed: ${query.error.message}`);
    }
  }
  if (!tenderQuery.data) throw new Error("Tender not found");
  if (!companyQuery.data) throw new Error("Company not found");

  const companyRecord = record(companyQuery.data);
  const profileRecord = record(profileQuery.data);
  const company: LotMatchCompanyInput = {
    company_id: input.companyId,
    company_name: text(companyRecord.name, 1_000) ||
      `Company ${input.companyId}`,
    company_certifications: stringArray([
      ...stringArray(companyRecord.certifications),
      ...stringArray(profileRecord.certifications),
    ]),
    products: values(productsQuery.data).map((product) =>
      mapCompanyProduct(record(product))
    ).filter((product): product is CompanyProductCandidate => Boolean(product)),
  };
  const extraction = buildExtractionInput(
    record(tenderQuery.data),
    values(evidenceQuery.data).map(record),
  );
  const lots = normalizeTenderLots(extraction);
  const results = calculateTenderLotMatches(lots, company);

  const { data: currentRows, error: currentError } = await table(
    adminClient,
    "tender_lot_matches",
  )
    .select("lot_key,input_hash,status")
    .eq("company_id", input.companyId)
    .eq("tender_id", input.tenderId)
    .eq("calculation_version", LOT_MATCH_CALCULATION_VERSION);
  if (currentError) throw new Error(currentError.message);
  const existingByLot = new Map(
    values(currentRows).map((row) => {
      const item = record(row);
      return [String(item.lot_key), item] as const;
    }),
  );

  let changedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  const activeLotKeys = new Set<string>();
  for (let index = 0; index < results.length; index++) {
    const lot = lots[index];
    let result = results[index];
    activeLotKeys.add(lot.lot_key);
    const inputHash = await stableVersionHash({
      calculation_version: LOT_MATCH_CALCULATION_VERSION,
      lot,
      company,
    });
    const existing = existingByLot.get(lot.lot_key);
    if (
      existing?.input_hash === inputHash &&
      existing.status === result.status
    ) {
      reusedCount++;
      if (result.status === "failed") failedCount++;
      continue;
    }
    const now = new Date().toISOString();
    const row = result.status === "completed"
      ? {
        company_id: input.companyId,
        tender_id: input.tenderId,
        lot_key: result.lot_key,
        lot_number: result.lot_number,
        lot_title: result.lot_title,
        status: result.status,
        match_score: result.match_score,
        recommendation: result.recommendation,
        confidence_score: result.confidence_score,
        best_company_product_id: result.best_company_product_id,
        best_company_product_name: result.best_company_product_name,
        score_components: result.score_components,
        matched_requirements: result.matched_requirements,
        gaps: result.gaps,
        blockers: result.blockers,
        unknowns: result.unknowns,
        tender_evidence: result.tender_evidence,
        company_evidence: result.company_evidence,
        normalized_lot: lot,
        input_hash: inputHash,
        calculation_version: LOT_MATCH_CALCULATION_VERSION,
        calculation_error: null,
        trace_id: input.traceId || null,
        calculated_at: now,
        updated_at: now,
      }
      : {
        company_id: input.companyId,
        tender_id: input.tenderId,
        lot_key: result.lot_key,
        lot_number: result.lot_number,
        lot_title: result.lot_title,
        status: result.status,
        match_score: null,
        recommendation: null,
        confidence_score: null,
        best_company_product_id: null,
        best_company_product_name: null,
        score_components: {},
        matched_requirements: [],
        gaps: [],
        blockers: [],
        unknowns: [],
        tender_evidence: lot.evidence,
        company_evidence: [],
        normalized_lot: lot,
        input_hash: inputHash,
        calculation_version: LOT_MATCH_CALCULATION_VERSION,
        calculation_error: result.error_message,
        trace_id: input.traceId || null,
        calculated_at: now,
        updated_at: now,
      };
    const { error } = await table(adminClient, "tender_lot_matches").upsert(
      row,
      {
        onConflict: "company_id,tender_id,lot_key,calculation_version",
      },
    );
    if (error) {
      result = {
        status: "failed",
        lot_key: lot.lot_key,
        lot_number: lot.lot_number,
        lot_title: lot.lot_title,
        calculation_version: LOT_MATCH_CALCULATION_VERSION,
        error_message: errorMessage(error),
      };
      results[index] = result;
    }
    changedCount++;
    if (result.status === "failed") failedCount++;
  }

  for (const row of values(currentRows)) {
    const item = record(row);
    const key = text(item.lot_key, 300);
    if (!key || activeLotKeys.has(key) || item.status === "superseded") {
      continue;
    }
    const { error } = await table(adminClient, "tender_lot_matches").update({
      status: "superseded",
      updated_at: new Date().toISOString(),
    }).eq("company_id", input.companyId).eq("tender_id", input.tenderId).eq(
      "lot_key",
      key,
    ).eq("calculation_version", LOT_MATCH_CALCULATION_VERSION);
    if (error) throw new Error(error.message);
  }

  const summary = aggregateLotMatches(results);
  const { error: summaryError } = await table(
    adminClient,
    "opportunity_match_scores_v2",
  )
    .update({
      lot_match_summary: summary,
      lot_match_calculation_version: LOT_MATCH_CALCULATION_VERSION,
      lot_matches_calculated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)
    .eq("tender_id", input.tenderId);
  if (summaryError) throw new Error(summaryError.message);

  return {
    calculation_version: LOT_MATCH_CALCULATION_VERSION,
    normalized_lot_count: lots.length,
    changed_count: changedCount,
    reused_count: reusedCount,
    failed_count: failedCount,
    summary,
    results,
  };
}

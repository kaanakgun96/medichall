export const LOT_MATCH_CALCULATION_VERSION = "lot-match-v1";

export type MatchRecommendation =
  | "strong_match"
  | "good_match"
  | "possible_match"
  | "weak_match"
  | "not_recommended";

export type LotMatchStatus =
  | "completed"
  | "failed";

export type TenderEvidenceReference = {
  document_id: number | null;
  page_number: number | null;
  sheet_name: string | null;
  cell_range: string | null;
  field_name: string | null;
  source_quote: string | null;
  extracted_value: string | null;
  confidence_score: number;
};

export type NormalizedTenderProduct = {
  product_name: string;
  normalized_product_name: string | null;
  lot_number: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  packaging: string | null;
  sterility: string | null;
  material: string | null;
  dimensions: string | null;
  required_certifications: string[];
  technical_requirements: string[];
  requirements: Array<{
    name: string;
    value: string | null;
    normalized_value: string | null;
    status: string;
  }>;
  confidence_score: number;
  evidence: TenderEvidenceReference[];
};

export type NormalizedTenderLot = {
  lot_key: string;
  lot_number: string | null;
  lot_title: string;
  ambiguous_association: boolean;
  tender_products: NormalizedTenderProduct[];
  technical_requirements: string[];
  quantities: Array<{
    value: number;
    unit: string | null;
    scope: string | null;
  }>;
  required_certifications: string[];
  evidence: TenderEvidenceReference[];
  missing_information: string[];
  extraction_confidence: number;
};

export type CompanyProductCandidate = {
  id: number;
  ref: string | null;
  name: string;
  category: string | null;
  normalized_category: string | null;
  product_subtype: string | null;
  description: string | null;
  material: string | null;
  dimensions: string | null;
  sterility: string | boolean | null;
  single_use: boolean | null;
  reusable: boolean | null;
  packaging: string | null;
  units_per_package: number | null;
  certifications: string[];
  regulatory_class: string | null;
  sterilization_method: string | null;
  production_capacity: number | null;
  capacity_unit: string | null;
  capacity_period: string | null;
  extra_specifications: string[];
};

export type LotMatchCompanyInput = {
  company_id: number;
  company_name: string;
  company_certifications: string[];
  products: CompanyProductCandidate[];
};

export type ScoreComponent = {
  score: number;
  max_score: number;
  status: "matched" | "partial" | "gap" | "contradiction" | "unknown";
  reason: string;
};

export type MatchReason = {
  code: string;
  message: string;
};

export type CompletedLotMatch = {
  status: "completed";
  lot_key: string;
  lot_number: string | null;
  lot_title: string;
  match_score: number;
  recommendation: MatchRecommendation;
  confidence_score: number;
  best_company_product_id: number | null;
  best_company_product_name: string | null;
  score_components: Record<string, ScoreComponent>;
  matched_requirements: MatchReason[];
  gaps: MatchReason[];
  blockers: MatchReason[];
  unknowns: MatchReason[];
  tender_evidence: TenderEvidenceReference[];
  company_evidence: Array<{
    product_id: number;
    product_name: string;
    product_ref: string | null;
    matched_fields: string[];
  }>;
  calculation_version: typeof LOT_MATCH_CALCULATION_VERSION;
};

export type FailedLotMatch = {
  status: "failed";
  lot_key: string;
  lot_number: string | null;
  lot_title: string;
  calculation_version: typeof LOT_MATCH_CALCULATION_VERSION;
  error_message: string;
};

export type LotMatchResult = CompletedLotMatch | FailedLotMatch;

type MutableLot = NormalizedTenderLot & {
  explicit_title: string | null;
  explicit_confidences: number[];
};

type CandidateEvaluation = Omit<
  CompletedLotMatch,
  "lot_key" | "lot_number" | "lot_title" | "calculation_version"
>;

const COMPONENT_WEIGHTS = {
  product_identity: 30,
  technical_specification: 15,
  dimensions: 10,
  material: 7,
  sterility: 10,
  use_type: 7,
  certification: 10,
  packaging: 4,
  quantity_capacity: 2,
  evidence_completeness: 2,
  company_data_completeness: 3,
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
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

function clampScore(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result)
    ? Math.max(0, Math.min(100, Math.round(result)))
    : 0;
}

export function normalizeMatchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: readonly unknown[]): string[] {
  const output = new Map<string, string>();
  for (const value of values) {
    const item = text(value, 1_000);
    const key = normalizeMatchText(item);
    if (item && key && !output.has(key)) output.set(key, item);
  }
  return [...output.values()];
}

function evidenceKey(value: TenderEvidenceReference): string {
  return JSON.stringify([
    value.document_id,
    value.page_number,
    value.sheet_name,
    value.cell_range,
    value.field_name,
    normalizeMatchText(value.source_quote),
    normalizeMatchText(value.extracted_value),
  ]);
}

function uniqueEvidence(
  values: readonly TenderEvidenceReference[],
): TenderEvidenceReference[] {
  const output = new Map<string, TenderEvidenceReference>();
  for (const value of values) {
    const key = evidenceKey(value);
    const prior = output.get(key);
    if (!prior || value.confidence_score > prior.confidence_score) {
      output.set(key, value);
    }
  }
  return [...output.values()].sort((left, right) =>
    Number(left.document_id || 0) - Number(right.document_id || 0) ||
    Number(left.page_number || 0) - Number(right.page_number || 0) ||
    String(left.field_name || "").localeCompare(String(right.field_name || ""))
  );
}

function evidenceFrom(value: unknown): TenderEvidenceReference | null {
  const item = record(value);
  const quote = text(item.source_quote, 1_000);
  const extracted = text(item.extracted_value, 1_000);
  if (!quote && !extracted) return null;
  return {
    document_id: numberValue(item.document_id),
    page_number: numberValue(item.page_number),
    sheet_name: text(item.sheet_name, 200),
    cell_range: text(item.cell_range, 200),
    field_name: text(item.field_name, 200),
    source_quote: quote,
    extracted_value: extracted,
    confidence_score: clampScore(item.confidence_score),
  };
}

function requirementFrom(value: unknown) {
  const item = record(value);
  const name = text(item.name, 500);
  if (!name) return null;
  return {
    name,
    value: text(item.value, 1_000),
    normalized_value: text(item.normalized_value, 1_000),
    status: text(item.status, 50) || "unknown",
  };
}

function productFrom(value: unknown): NormalizedTenderProduct | null {
  const item = record(value);
  const productName = text(item.product_name, 1_000);
  if (!productName) return null;
  return {
    product_name: productName,
    normalized_product_name: text(item.normalized_product_name, 1_000),
    lot_number: text(item.lot_number, 120),
    quantity_value: numberValue(item.quantity_value),
    quantity_unit: text(item.quantity_unit, 120),
    packaging: text(item.packaging, 1_000),
    sterility: text(item.sterility, 500),
    material: text(item.material, 500),
    dimensions: text(item.dimensions, 500),
    required_certifications: uniqueStrings(
      array(item.required_certifications),
    ),
    technical_requirements: uniqueStrings(
      array(item.technical_requirements),
    ),
    requirements: array(item.requirements)
      .map(requirementFrom)
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    confidence_score: clampScore(item.confidence_score),
    evidence: uniqueEvidence(
      array(item.evidence)
        .map(evidenceFrom)
        .filter((row): row is TenderEvidenceReference => Boolean(row)),
    ),
  };
}

function lotKey(lotNumber: string | null): string {
  const normalized = normalizeMatchText(lotNumber);
  return normalized ? `lot:${normalized}` : "unassigned";
}

function emptyLot(
  key: string,
  lotNumber: string | null,
  explicitTitle: string | null = null,
): MutableLot {
  return {
    lot_key: key,
    lot_number: lotNumber,
    lot_title: explicitTitle || (lotNumber ? `Lot ${lotNumber}` : "Unassigned"),
    ambiguous_association: !lotNumber,
    tender_products: [],
    technical_requirements: [],
    quantities: [],
    required_certifications: [],
    evidence: [],
    missing_information: [],
    extraction_confidence: 0,
    explicit_title: explicitTitle,
    explicit_confidences: [],
  };
}

function mergeProducts(
  existing: NormalizedTenderProduct,
  incoming: NormalizedTenderProduct,
): NormalizedTenderProduct {
  const requirementRows = [
    ...existing.requirements,
    ...incoming.requirements,
  ];
  const requirementMap = new Map<string, typeof requirementRows[number]>();
  for (const requirement of requirementRows) {
    const key = [
      normalizeMatchText(requirement.name),
      normalizeMatchText(requirement.normalized_value || requirement.value),
    ].join("|");
    if (!requirementMap.has(key)) requirementMap.set(key, requirement);
  }
  return {
    ...existing,
    normalized_product_name: existing.normalized_product_name ||
      incoming.normalized_product_name,
    quantity_value: existing.quantity_value ?? incoming.quantity_value,
    quantity_unit: existing.quantity_unit || incoming.quantity_unit,
    packaging: existing.packaging || incoming.packaging,
    sterility: existing.sterility || incoming.sterility,
    material: existing.material || incoming.material,
    dimensions: existing.dimensions || incoming.dimensions,
    required_certifications: uniqueStrings([
      ...existing.required_certifications,
      ...incoming.required_certifications,
    ]),
    technical_requirements: uniqueStrings([
      ...existing.technical_requirements,
      ...incoming.technical_requirements,
    ]),
    requirements: [...requirementMap.values()],
    confidence_score: Math.max(
      existing.confidence_score,
      incoming.confidence_score,
    ),
    evidence: uniqueEvidence([...existing.evidence, ...incoming.evidence]),
  };
}

function finalizeLot(
  lot: MutableLot,
  globalMissing: readonly string[],
  documentConfidence: number,
): NormalizedTenderLot {
  const evidence = uniqueEvidence(
    lot.tender_products.flatMap((product) => product.evidence),
  );
  const confidenceValues = [
    ...lot.tender_products.map((product) => product.confidence_score),
    ...evidence.map((item) => item.confidence_score),
    ...lot.explicit_confidences,
  ].filter((value) => value > 0);
  const extractionConfidence = confidenceValues.length
    ? Math.round(
      confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length,
    )
    : documentConfidence;
  const productTitle = lot.tender_products[0]?.normalized_product_name ||
    lot.tender_products[0]?.product_name;
  return {
    lot_key: lot.lot_key,
    lot_number: lot.lot_number,
    lot_title: lot.explicit_title || productTitle ||
      (lot.lot_number ? `Lot ${lot.lot_number}` : "Unassigned products"),
    ambiguous_association: lot.ambiguous_association,
    tender_products: lot.tender_products,
    technical_requirements: uniqueStrings([
      ...lot.technical_requirements,
      ...lot.tender_products.flatMap((product) => [
        ...product.technical_requirements,
        ...product.requirements.flatMap((requirement) => [
          requirement.name,
          requirement.normalized_value,
          requirement.value,
        ]),
      ]),
    ]),
    quantities: lot.quantities,
    required_certifications: uniqueStrings([
      ...lot.required_certifications,
      ...lot.tender_products.flatMap((product) =>
        product.required_certifications
      ),
    ]),
    evidence,
    missing_information: uniqueStrings(globalMissing),
    extraction_confidence: clampScore(extractionConfidence),
  };
}

export function normalizeTenderLots(
  extraction: Record<string, unknown>,
): NormalizedTenderLot[] {
  const groups = new Map<string, MutableLot>();
  const canonicalOnly = extraction.canonical_only_lots === true;
  const explicitLots = array(extraction.lots);
  for (let index = 0; index < explicitLots.length; index++) {
    const source = record(explicitLots[index]);
    const lotNumber = text(source.lot_number, 120);
    const key = lotNumber ? lotKey(lotNumber) : `explicit:${index + 1}`;
    const title = text(source.lot_title, 1_000);
    const lot = groups.get(key) || emptyLot(key, lotNumber, title);
    if (!lot.explicit_title && title) lot.explicit_title = title;
    const quantity = numberValue(source.estimated_quantity);
    if (quantity != null) {
      lot.quantities.push({
        value: quantity,
        unit: text(source.quantity_unit, 120),
        scope: "lot",
      });
    }
    groups.set(key, lot);
  }

  for (const source of array(extraction.products)) {
    const product = productFrom(source);
    if (!product) continue;
    const key = lotKey(product.lot_number);
    // When an official canonical lot index is available, notice-level or
    // rejected AI product references must not create an extra phantom lot.
    if (canonicalOnly && !groups.has(key)) continue;
    const lot = groups.get(key) ||
      emptyLot(key, product.lot_number, null);
    const productKey = [
      normalizeMatchText(
        product.normalized_product_name || product.product_name,
      ),
      normalizeMatchText(product.lot_number),
    ].join("|");
    const existingIndex = lot.tender_products.findIndex((candidate) =>
      [
        normalizeMatchText(
          candidate.normalized_product_name || candidate.product_name,
        ),
        normalizeMatchText(candidate.lot_number),
      ].join("|") === productKey
    );
    if (existingIndex >= 0) {
      lot.tender_products[existingIndex] = mergeProducts(
        lot.tender_products[existingIndex],
        product,
      );
    } else {
      lot.tender_products.push(product);
    }
    if (product.quantity_value != null) {
      lot.quantities.push({
        value: product.quantity_value,
        unit: product.quantity_unit,
        scope: text(record(source).quantity_scope, 120),
      });
    }
    groups.set(key, lot);
  }

  const missing = uniqueStrings(array(extraction.missing_information));
  const documentConfidence = clampScore(
    extraction.document_confidence_score,
  );
  return [...groups.values()]
    .map((lot) => finalizeLot(lot, missing, documentConfidence))
    .sort((left, right) => {
      if (left.lot_number && !right.lot_number) return -1;
      if (!left.lot_number && right.lot_number) return 1;
      return String(left.lot_number || left.lot_key).localeCompare(
        String(right.lot_number || right.lot_key),
        undefined,
        { numeric: true },
      );
    });
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .filter((token) => token.length >= 2),
  );
}

function textSimilarity(left: string, right: string): number {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (
    Math.min(a.length, b.length) >= 5 &&
    (a.includes(b) || b.includes(a))
  ) {
    return 90;
  }
  const leftTokens = tokenSet(a);
  const rightTokens = tokenSet(b);
  const intersection =
    [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? Math.round(100 * intersection / union) : 0;
}

function productText(product: CompanyProductCandidate): string {
  return uniqueStrings([
    product.name,
    product.category,
    product.normalized_category,
    product.product_subtype,
    product.description,
    product.material,
    product.dimensions,
    typeof product.sterility === "string" ? product.sterility : null,
    product.packaging,
    product.units_per_package
      ? `${product.units_per_package} units per package`
      : null,
    ...product.certifications,
    product.regulatory_class,
    product.sterilization_method,
    ...product.extra_specifications,
  ]).join(" ");
}

function component(
  weight: number,
  rawScore: number | null,
  status: ScoreComponent["status"],
  reason: string,
): ScoreComponent {
  return {
    score: rawScore == null
      ? 0
      : Math.round(weight * clampScore(rawScore) / 100),
    max_score: weight,
    status,
    reason,
  };
}

function statusForScore(score: number): ScoreComponent["status"] {
  if (score >= 80) return "matched";
  if (score >= 40) return "partial";
  return "gap";
}

function booleanSignal(
  value: unknown,
  positive: RegExp,
  negative: RegExp,
): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  if (negative.test(normalized)) return false;
  if (positive.test(normalized)) return true;
  return null;
}

function dimensionSignatures(value: unknown): string[] {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/,/g, ".")
    .replace(/[×✕]/g, "x");
  const matches = normalized.matchAll(
    /(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?(?:\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?)?/g,
  );
  const factors: Record<string, number> = { mm: 1, cm: 10, m: 1_000 };
  return [
    ...new Set([...matches].flatMap((match) => {
      const fallbackUnit = match[6] || match[4] || match[2];
      if (!fallbackUnit) return [];
      const dimensions = [
        [match[1], match[2] || fallbackUnit],
        [match[3], match[4] || fallbackUnit],
        match[5] ? [match[5], match[6] || fallbackUnit] : null,
      ].filter((item): item is string[] => Boolean(item));
      return [
        dimensions.map(([amount, unit]) => Number(amount) * factors[unit]).join(
          "x",
        ),
      ];
    })),
  ];
}

function normalizedCertification(value: string): string {
  return normalizeMatchText(value)
    .replace(/\b(certified|certification|certificate)\b/g, "")
    .replace(/\s+/g, "");
}

function requirementTexts(lot: NormalizedTenderLot): string[] {
  return uniqueStrings([
    ...lot.technical_requirements,
    ...lot.tender_products.flatMap((product) => [
      ...product.technical_requirements,
      ...product.requirements.flatMap((requirement) => [
        `${requirement.name} ${
          requirement.normalized_value || requirement.value || ""
        }`,
      ]),
    ]),
  ]);
}

function explicitContradictions(
  tenderText: string,
  companyText: string,
): MatchReason[] {
  const pairs: Array<[RegExp, RegExp, string, string]> = [
    [
      /\b(powder free|without powder)\b/,
      /\b(powdered|with powder)\b/,
      "technical_powder_contradiction",
      "Tender requires powder-free supply but the company product explicitly states powdered.",
    ],
    [
      /\b(latex free|without latex)\b/,
      /\b(with latex|contains latex|natural latex)\b/,
      "material_latex_contradiction",
      "Tender requires latex-free supply but the company product explicitly contains latex.",
    ],
    [
      /\b(without adhesive|non adhesive)\b/,
      /\b(with adhesive|adhesive coated)\b/,
      "technical_adhesive_contradiction",
      "Tender requires a non-adhesive product but the company product explicitly includes adhesive.",
    ],
  ];
  return pairs.flatMap(([required, offered, code, message]) =>
    required.test(tenderText) && offered.test(companyText)
      ? [{ code, message }]
      : []
  );
}

function evaluateCandidate(
  lot: NormalizedTenderLot,
  candidate: CompanyProductCandidate,
  companyCertifications: readonly string[],
): CandidateEvaluation {
  const matched: MatchReason[] = [];
  const gaps: MatchReason[] = [];
  const blockers: MatchReason[] = [];
  const unknowns: MatchReason[] = [];
  const matchedFields = new Set<string>();
  const corpus = productText(candidate);
  const normalizedCorpus = normalizeMatchText(corpus);
  const tenderNames = lot.tender_products.flatMap((product) =>
    uniqueStrings([product.product_name, product.normalized_product_name])
  );
  const identityScore = tenderNames.length
    ? Math.max(...tenderNames.map((name) =>
      Math.max(
        textSimilarity(name, candidate.name),
        textSimilarity(
          name,
          [
            candidate.name,
            candidate.category,
            candidate.normalized_category,
            candidate.product_subtype,
          ].filter(Boolean).join(" "),
        ),
      )
    ))
    : textSimilarity(
      lot.lot_title,
      [
        candidate.name,
        candidate.category,
        candidate.normalized_category,
        candidate.product_subtype,
      ].filter(Boolean).join(" "),
    );
  if (identityScore >= 80) {
    matched.push({
      code: "product_identity_match",
      message: `Tender product identity aligns with ${candidate.name}.`,
    });
    matchedFields.add("name");
  } else if (identityScore < 25) {
    blockers.push({
      code: "product_category_absent",
      message:
        `Requested product category is not present in ${candidate.name}.`,
    });
  } else {
    gaps.push({
      code: "product_identity_partial",
      message:
        `Only partial deterministic product-name overlap exists with ${candidate.name}.`,
    });
  }

  const technicalRequirements = requirementTexts(lot);
  const technicalScores = technicalRequirements.map((requirement) =>
    textSimilarity(requirement, corpus)
  );
  const technicalScore = technicalScores.length
    ? Math.round(
      technicalScores.reduce((sum, score) => sum + score, 0) /
        technicalScores.length,
    )
    : null;
  if (technicalScore == null) {
    unknowns.push({
      code: "tender_technical_requirements_missing",
      message:
        "No explicit technical requirements were extracted for this lot.",
    });
  } else if (!candidate.description && !candidate.extra_specifications.length) {
    unknowns.push({
      code: "company_technical_specifications_missing",
      message: "Company product technical specifications are missing.",
    });
  } else if (technicalScore >= 70) {
    matched.push({
      code: "technical_requirements_match",
      message:
        "Explicit requirement wording is present in the company product data.",
    });
    matchedFields.add("description");
  } else {
    gaps.push({
      code: "technical_requirements_gap",
      message:
        "Some explicit tender requirements are not evidenced in the company product data.",
    });
  }
  blockers.push(
    ...explicitContradictions(
      normalizeMatchText(technicalRequirements.join(" ")),
      normalizedCorpus,
    ),
  );

  const tenderDimensions = uniqueStrings(
    lot.tender_products.map((product) => product.dimensions),
  );
  const tenderDimensionSignatures = tenderDimensions.flatMap(
    dimensionSignatures,
  );
  const companyDimensionSignatures = dimensionSignatures(
    candidate.dimensions || corpus,
  );
  let dimensionScore: number | null = null;
  let dimensionStatus: ScoreComponent["status"] = "unknown";
  if (tenderDimensionSignatures.length) {
    if (!companyDimensionSignatures.length) {
      unknowns.push({
        code: "company_dimensions_missing",
        message:
          "Tender dimensions are explicit but company dimensions are missing.",
      });
    } else if (
      tenderDimensionSignatures.some((value) =>
        companyDimensionSignatures.includes(value)
      )
    ) {
      dimensionScore = 100;
      dimensionStatus = "matched";
      matched.push({
        code: "dimensions_match",
        message: "An explicit tender dimension matches the company product.",
      });
      matchedFields.add("dimensions");
    } else {
      dimensionScore = 0;
      dimensionStatus = "contradiction";
      blockers.push({
        code: "dimensions_outside_supported_range",
        message:
          "Explicit company dimensions do not include the required tender dimensions.",
      });
    }
  } else {
    unknowns.push({
      code: "tender_dimensions_missing",
      message: "No explicit dimensions were extracted for this lot.",
    });
  }

  const tenderMaterials = uniqueStrings(
    lot.tender_products.map((product) => product.material),
  );
  let materialScore: number | null = null;
  let materialStatus: ScoreComponent["status"] = "unknown";
  if (tenderMaterials.length) {
    if (!candidate.material) {
      unknowns.push({
        code: "company_material_missing",
        message:
          "Tender material is explicit but company material data is missing.",
      });
    } else {
      materialScore = Math.max(
        ...tenderMaterials.map((material) =>
          textSimilarity(material, candidate.material || "")
        ),
      );
      materialStatus = statusForScore(materialScore);
      if (materialScore >= 80) {
        matched.push({
          code: "material_match",
          message:
            "The required material matches the company product material.",
        });
        matchedFields.add("material");
      } else if (materialScore < 25) {
        materialStatus = "contradiction";
        blockers.push({
          code: "material_contradiction",
          message:
            "The explicit company material conflicts with the tender material.",
        });
      } else {
        gaps.push({
          code: "material_gap",
          message: "Material compatibility is only partial.",
        });
      }
    }
  } else {
    unknowns.push({
      code: "tender_material_missing",
      message: "No explicit material requirement was extracted.",
    });
  }

  const tenderSterilityText = uniqueStrings([
    ...lot.tender_products.map((product) => product.sterility),
    ...technicalRequirements,
  ]).join(" ");
  const tenderSterile = booleanSignal(
    tenderSterilityText,
    /\b(sterile|sterilized|sterility)\b/,
    /\b(non sterile|not sterile|unsterile)\b/,
  );
  const companySterile = booleanSignal(
    candidate.sterility ?? corpus,
    /\b(sterile|sterilized|sterility)\b/,
    /\b(non sterile|not sterile|unsterile)\b/,
  );
  let sterileScore: number | null = null;
  let sterileStatus: ScoreComponent["status"] = "unknown";
  if (tenderSterile == null) {
    unknowns.push({
      code: "tender_sterility_missing",
      message: "No explicit sterility requirement was extracted.",
    });
  } else if (companySterile == null) {
    unknowns.push({
      code: "company_sterility_missing",
      message: "Company product sterility data is missing.",
    });
  } else if (tenderSterile === companySterile) {
    sterileScore = 100;
    sterileStatus = "matched";
    matched.push({
      code: "sterility_match",
      message: "Sterility requirements align explicitly.",
    });
    matchedFields.add("sterility");
  } else {
    sterileScore = 0;
    sterileStatus = "contradiction";
    blockers.push({
      code: "sterility_contradiction",
      message: tenderSterile
        ? "Tender requires sterile supply but the company product is explicitly non-sterile."
        : "Tender requires non-sterile supply but the company product is explicitly sterile.",
    });
  }

  const tenderUseText = normalizeMatchText(technicalRequirements.join(" "));
  const tenderSingleUse = booleanSignal(
    tenderUseText,
    /\b(single use|disposable|one time use)\b/,
    /\b(reusable|multiple use)\b/,
  );
  const companySingleUse = candidate.single_use != null
    ? candidate.single_use
    : candidate.reusable != null
    ? !candidate.reusable
    : booleanSignal(
      corpus,
      /\b(single use|disposable|one time use)\b/,
      /\b(reusable|multiple use)\b/,
    );
  let useScore: number | null = null;
  let useStatus: ScoreComponent["status"] = "unknown";
  if (tenderSingleUse == null) {
    unknowns.push({
      code: "tender_use_type_missing",
      message: "No explicit single-use or reusable requirement was extracted.",
    });
  } else if (companySingleUse == null) {
    unknowns.push({
      code: "company_use_type_missing",
      message: "Company single-use/reusable data is missing.",
    });
  } else if (tenderSingleUse === companySingleUse) {
    useScore = 100;
    useStatus = "matched";
    matched.push({
      code: "use_type_match",
      message: "Single-use/reusable requirements align.",
    });
    matchedFields.add("use_type");
  } else {
    useScore = 0;
    useStatus = "contradiction";
    blockers.push({
      code: "use_type_contradiction",
      message: tenderSingleUse
        ? "Tender mandates single-use supply but the company product is reusable."
        : "Tender mandates reusable supply but the company product is single-use.",
    });
  }

  const requiredCertifications = lot.required_certifications;
  const availableCertifications = uniqueStrings([
    ...companyCertifications,
    ...candidate.certifications,
  ]);
  let certificationScore: number | null = null;
  let certificationStatus: ScoreComponent["status"] = "unknown";
  if (!requiredCertifications.length) {
    unknowns.push({
      code: "tender_certifications_missing",
      message: "No mandatory certification was extracted for this lot.",
    });
  } else if (!availableCertifications.length) {
    unknowns.push({
      code: "company_certifications_missing",
      message:
        "Company certification data is missing; absence is not treated as contradiction.",
    });
  } else {
    const available = new Set(
      availableCertifications.map(normalizedCertification),
    );
    const missing = requiredCertifications.filter((certification) =>
      !available.has(normalizedCertification(certification))
    );
    certificationScore = Math.round(
      100 * (requiredCertifications.length - missing.length) /
        requiredCertifications.length,
    );
    certificationStatus = missing.length ? "contradiction" : "matched";
    if (missing.length) {
      blockers.push({
        code: "mandatory_certification_absent",
        message: `Company certification records do not include: ${
          missing.join(", ")
        }.`,
      });
    } else {
      const productAvailable = new Set(
        candidate.certifications.map(normalizedCertification),
      );
      const companyAvailable = new Set(
        companyCertifications.map(normalizedCertification),
      );
      const matchedFromProduct = requiredCertifications.some((certification) =>
        productAvailable.has(normalizedCertification(certification))
      );
      const matchedFromCompany = requiredCertifications.some((certification) =>
        companyAvailable.has(normalizedCertification(certification))
      );
      matched.push({
        code: "certifications_match",
        message: matchedFromProduct && matchedFromCompany
          ? "Mandatory certifications are present in both product-specific and company records."
          : matchedFromProduct
          ? "Mandatory certifications are present in product-specific records."
          : "Mandatory certifications are present in company-level records.",
      });
      matchedFields.add("certifications");
    }
  }

  const packagingRequirements = uniqueStrings(
    lot.tender_products.map((product) => product.packaging),
  );
  let packagingScore: number | null = null;
  if (!packagingRequirements.length) {
    unknowns.push({
      code: "tender_packaging_missing",
      message: "No packaging requirement was extracted.",
    });
  } else if (!candidate.packaging && !candidate.description) {
    unknowns.push({
      code: "company_packaging_missing",
      message: "Company packaging data is missing.",
    });
  } else {
    packagingScore = Math.max(
      ...packagingRequirements.map((requirement) =>
        textSimilarity(
          requirement,
          candidate.packaging || candidate.description || "",
        )
      ),
    );
    if (packagingScore >= 70) {
      matched.push({
        code: "packaging_match",
        message: "Packaging wording aligns with the tender requirement.",
      });
      matchedFields.add("packaging");
    } else {
      gaps.push({
        code: "packaging_gap",
        message: "Packaging compatibility is not fully evidenced.",
      });
    }
  }

  const requiredQuantity = lot.quantities.find((quantity) =>
    quantity.value > 0
  );
  let quantityScore: number | null = null;
  if (
    requiredQuantity &&
    candidate.production_capacity != null &&
    candidate.capacity_unit &&
    normalizeMatchText(candidate.capacity_unit) ===
      normalizeMatchText(requiredQuantity.unit)
  ) {
    quantityScore = candidate.production_capacity >= requiredQuantity.value
      ? 100
      : Math.max(
        1,
        Math.round(
          100 * candidate.production_capacity / requiredQuantity.value,
        ),
      );
    if (quantityScore >= 100) {
      matched.push({
        code: "quantity_capacity_match",
        message: "Comparable company capacity covers the tender quantity.",
      });
      matchedFields.add("production_capacity");
    } else {
      gaps.push({
        code: "quantity_capacity_gap",
        message: "Comparable company capacity is below the tender quantity.",
      });
    }
  } else {
    unknowns.push({
      code: "quantity_capacity_not_comparable",
      message:
        "Tender quantity and company capacity are not available in comparable units.",
    });
  }

  const productsWithEvidence =
    lot.tender_products.filter((product) => product.evidence.length > 0).length;
  const evidenceCompleteness = lot.tender_products.length
    ? Math.round(100 * productsWithEvidence / lot.tender_products.length)
    : lot.evidence.length
    ? 50
    : 0;
  const companyCompleteness = Math.round(
    100 * [
      candidate.name,
      candidate.normalized_category || candidate.category,
      candidate.description,
      candidate.material || candidate.dimensions ||
      candidate.packaging || candidate.extra_specifications[0],
      availableCertifications[0],
    ].filter(Boolean).length / 5,
  );

  const components: Record<string, ScoreComponent> = {
    product_identity: component(
      COMPONENT_WEIGHTS.product_identity,
      identityScore,
      statusForScore(identityScore),
      "Deterministic exact, containment, and token overlap of tender and catalog product identity.",
    ),
    technical_specification: component(
      COMPONENT_WEIGHTS.technical_specification,
      candidate.description || candidate.extra_specifications.length
        ? technicalScore
        : null,
      technicalScore != null &&
        (candidate.description || candidate.extra_specifications.length)
        ? statusForScore(technicalScore)
        : "unknown",
      "Explicit tender requirements compared with company product description/specifications.",
    ),
    dimensions: component(
      COMPONENT_WEIGHTS.dimensions,
      dimensionScore,
      dimensionStatus,
      "Normalized dimensional signatures compared only when both sides are explicit.",
    ),
    material: component(
      COMPONENT_WEIGHTS.material,
      materialScore,
      materialStatus,
      "Explicit material fields compared without semantic inference.",
    ),
    sterility: component(
      COMPONENT_WEIGHTS.sterility,
      sterileScore,
      sterileStatus,
      "Explicit sterile/non-sterile compatibility.",
    ),
    use_type: component(
      COMPONENT_WEIGHTS.use_type,
      useScore,
      useStatus,
      "Explicit single-use/reusable compatibility.",
    ),
    certification: component(
      COMPONENT_WEIGHTS.certification,
      certificationScore,
      certificationStatus,
      "Mandatory extracted certifications compared with company certification records.",
    ),
    packaging: component(
      COMPONENT_WEIGHTS.packaging,
      packagingScore,
      packagingScore == null ? "unknown" : statusForScore(packagingScore),
      "Packaging compared only from explicit tender and company text.",
    ),
    quantity_capacity: component(
      COMPONENT_WEIGHTS.quantity_capacity,
      quantityScore,
      quantityScore == null ? "unknown" : statusForScore(quantityScore),
      "Quantity applies only when tender demand and company capacity use comparable units.",
    ),
    evidence_completeness: component(
      COMPONENT_WEIGHTS.evidence_completeness,
      evidenceCompleteness,
      statusForScore(evidenceCompleteness),
      "Share of normalized tender products carrying deduplicated document evidence.",
    ),
    company_data_completeness: component(
      COMPONENT_WEIGHTS.company_data_completeness,
      companyCompleteness,
      statusForScore(companyCompleteness),
      "Completeness of catalog identity, description, specifications, and certification data.",
    ),
  };

  const unknownComponentNames = new Set(
    Object.entries(components)
      .filter(([, value]) => value.status === "unknown")
      .map(([name]) => name),
  );
  const applicableMaximum = Object.entries(components)
    .filter(([name]) => !unknownComponentNames.has(name))
    .reduce((sum, [, value]) => sum + value.max_score, 0);
  let matchScore = applicableMaximum
    ? Math.round(
      100 * Object.entries(components)
        .filter(([name]) => !unknownComponentNames.has(name))
        .reduce((sum, [, value]) => sum + value.score, 0) /
        applicableMaximum,
    )
    : 0;
  const blockerCodes = new Set(blockers.map((item) => item.code));
  const hardCapCodes = new Set([
    "product_category_absent",
    "sterility_contradiction",
    "use_type_contradiction",
    "mandatory_certification_absent",
    "dimensions_outside_supported_range",
    "technical_powder_contradiction",
    "material_latex_contradiction",
    "technical_adhesive_contradiction",
  ]);
  if ([...blockerCodes].some((code) => hardCapCodes.has(code))) {
    matchScore = Math.min(matchScore, 29);
  } else if (blockerCodes.has("material_contradiction")) {
    matchScore = Math.min(matchScore, 39);
  }

  let confidenceScore = Math.round(
    lot.extraction_confidence * 0.50 +
      evidenceCompleteness * 0.25 +
      companyCompleteness * 0.25,
  );
  if (lot.ambiguous_association) {
    confidenceScore = Math.min(60, confidenceScore);
  }
  if (!lot.evidence.length) confidenceScore = Math.min(45, confidenceScore);

  return {
    status: "completed",
    match_score: clampScore(matchScore),
    recommendation: recommendationForScore(matchScore),
    confidence_score: clampScore(confidenceScore),
    best_company_product_id: candidate.id,
    best_company_product_name: candidate.name,
    score_components: components,
    matched_requirements: matched,
    gaps,
    blockers,
    unknowns,
    tender_evidence: lot.evidence.slice(0, 50),
    company_evidence: [{
      product_id: candidate.id,
      product_name: candidate.name,
      product_ref: candidate.ref,
      matched_fields: [...matchedFields].sort(),
    }],
  };
}

export function recommendationForScore(score: number): MatchRecommendation {
  if (score >= 85) return "strong_match";
  if (score >= 70) return "good_match";
  if (score >= 50) return "possible_match";
  if (score >= 30) return "weak_match";
  return "not_recommended";
}

export function scoreNormalizedLot(
  lot: NormalizedTenderLot,
  company: LotMatchCompanyInput,
): CompletedLotMatch {
  if (!company.products.length) {
    return {
      status: "completed",
      lot_key: lot.lot_key,
      lot_number: lot.lot_number,
      lot_title: lot.lot_title,
      match_score: 0,
      recommendation: "not_recommended",
      confidence_score: Math.min(45, lot.extraction_confidence),
      best_company_product_id: null,
      best_company_product_name: null,
      score_components: {
        product_identity: component(
          COMPONENT_WEIGHTS.product_identity,
          0,
          "contradiction",
          "No active company catalog product is available for comparison.",
        ),
      },
      matched_requirements: [],
      gaps: [],
      blockers: [{
        code: "product_category_absent",
        message: "Company catalog contains no active product candidate.",
      }],
      unknowns: [{
        code: "company_product_data_missing",
        message:
          "Add a company product before relying on lot-level compatibility.",
      }],
      tender_evidence: lot.evidence.slice(0, 50),
      company_evidence: [],
      calculation_version: LOT_MATCH_CALCULATION_VERSION,
    };
  }
  const evaluations = company.products.map((candidate) => ({
    candidate,
    result: evaluateCandidate(lot, candidate, company.company_certifications),
  })).sort((left, right) =>
    right.result.match_score - left.result.match_score ||
    right.result.confidence_score - left.result.confidence_score ||
    left.candidate.id - right.candidate.id
  );
  const best = evaluations[0].result;
  return {
    ...best,
    lot_key: lot.lot_key,
    lot_number: lot.lot_number,
    lot_title: lot.lot_title,
    calculation_version: LOT_MATCH_CALCULATION_VERSION,
  };
}

export function calculateTenderLotMatches(
  lots: readonly NormalizedTenderLot[],
  company: LotMatchCompanyInput,
  scorer: (
    lot: NormalizedTenderLot,
    company: LotMatchCompanyInput,
  ) => CompletedLotMatch = scoreNormalizedLot,
): LotMatchResult[] {
  return lots.map((lot) => {
    try {
      return scorer(lot, company);
    } catch (error) {
      return {
        status: "failed",
        lot_key: lot.lot_key,
        lot_number: lot.lot_number,
        lot_title: lot.lot_title,
        calculation_version: LOT_MATCH_CALCULATION_VERSION,
        error_message: error instanceof Error
          ? error.message.slice(0, 1_000)
          : "Lot match calculation failed",
      };
    }
  });
}

export function aggregateLotMatches(
  results: readonly LotMatchResult[],
): Record<string, unknown> {
  const completed = results.filter(
    (result): result is CompletedLotMatch => result.status === "completed",
  );
  const counts: Record<MatchRecommendation, number> = {
    strong_match: 0,
    good_match: 0,
    possible_match: 0,
    weak_match: 0,
    not_recommended: 0,
  };
  for (const result of completed) counts[result.recommendation]++;
  const ranked = [...completed].sort((left, right) =>
    right.match_score - left.match_score ||
    left.lot_key.localeCompare(right.lot_key)
  );
  const relevant = completed.filter((result) =>
    result.recommendation !== "not_recommended"
  );
  const relevantAverage = relevant.length
    ? Math.round(
      relevant.reduce((sum, result) => sum + result.match_score, 0) /
        relevant.length,
    )
    : null;
  const highest = ranked[0] || null;
  const aggregateScore = highest
    ? relevantAverage == null
      ? highest.match_score
      : Math.round(highest.match_score * 0.70 + relevantAverage * 0.30)
    : null;
  return {
    calculation_version: LOT_MATCH_CALCULATION_VERSION,
    lot_count: results.length,
    completed_count: completed.length,
    failed_count: results.length - completed.length,
    recommendation_counts: counts,
    highest_matching_lot: highest
      ? {
        lot_key: highest.lot_key,
        lot_number: highest.lot_number,
        lot_title: highest.lot_title,
        score: highest.match_score,
        recommendation: highest.recommendation,
        company_product_id: highest.best_company_product_id,
        company_product_name: highest.best_company_product_name,
      }
      : null,
    relevant_lot_average: relevantAverage,
    aggregate_score: aggregateScore,
    blocked_lot_count: completed.filter((result) => result.blockers.length > 0)
      .length,
  };
}

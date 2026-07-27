export const PRODUCT_PROFILE_VERSION = "product-profile-v1";
export const PRODUCT_READINESS_VERSION = "product-readiness-v1";

export type ProductSterilityStatus =
  | "sterile"
  | "non_sterile"
  | "unknown";

export type ProductUseType =
  | "single_use"
  | "reusable"
  | "unknown";

export type ProductFieldSource =
  | "explicit"
  | "derived"
  | "unknown";

export type ProductProfileField =
  | "normalized_category"
  | "product_subtype"
  | "material"
  | "dimensions"
  | "sterility_status"
  | "use_type"
  | "packaging_description"
  | "units_per_package"
  | "product_certifications"
  | "regulatory_class"
  | "sterilization_method"
  | "production_capacity"
  | "capacity_unit"
  | "capacity_period"
  | "technical_specifications";

export type ProductProfileSources = Partial<
  Record<ProductProfileField, ProductFieldSource>
>;

export type ProductProfileInput = {
  name?: unknown;
  category?: unknown;
  description?: unknown;
  normalized_category?: unknown;
  product_subtype?: unknown;
  material?: unknown;
  dimensions?: unknown;
  sterility_status?: unknown;
  use_type?: unknown;
  packaging_description?: unknown;
  units_per_package?: unknown;
  product_certifications?: unknown;
  regulatory_class?: unknown;
  sterilization_method?: unknown;
  production_capacity?: unknown;
  capacity_unit?: unknown;
  capacity_period?: unknown;
  technical_specifications?: unknown;
  matching_profile_sources?: unknown;
};

export type CanonicalProductProfile = {
  normalized_category: string | null;
  product_subtype: string | null;
  material: string | null;
  dimensions: string | null;
  sterility_status: ProductSterilityStatus;
  use_type: ProductUseType;
  packaging_description: string | null;
  units_per_package: number | null;
  product_certifications: string[];
  regulatory_class: string | null;
  sterilization_method: string | null;
  production_capacity: number | null;
  capacity_unit: string | null;
  capacity_period: string | null;
  technical_specifications: string[];
  matching_profile_sources: ProductProfileSources;
  profile_version: typeof PRODUCT_PROFILE_VERSION;
};

export type ProductReadiness = {
  score: number;
  present_fields: string[];
  missing_fields: string[];
  critical_missing_fields: string[];
  calculation_version: typeof PRODUCT_READINESS_VERSION;
};

export type DerivedProductProfile = {
  values: Partial<CanonicalProductProfile>;
  safely_derived_fields: ProductProfileField[];
  ambiguous_fields: ProductProfileField[];
  skipped_fields: ProductProfileField[];
  sources: ProductProfileSources;
};

type Signal<T> = {
  value: T;
  ambiguous: boolean;
};

const PROFILE_FIELDS: readonly ProductProfileField[] = [
  "normalized_category",
  "product_subtype",
  "material",
  "dimensions",
  "sterility_status",
  "use_type",
  "packaging_description",
  "units_per_package",
  "product_certifications",
  "regulatory_class",
  "sterilization_method",
  "production_capacity",
  "capacity_unit",
  "capacity_period",
  "technical_specifications",
];

const SOURCE_VALUES = new Set<ProductFieldSource>([
  "explicit",
  "derived",
  "unknown",
]);

const GENERIC_CATEGORIES = new Set([
  "medical_devices",
  "oem_supplies",
  "raw_materials",
  "services",
  "machinery",
]);

function text(value: unknown, maximum = 2_000): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[,;\n]/);
  return [];
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function normalizeProductText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .toLocaleLowerCase("en")
    .replace(/[’']/g, "")
    .replace(/[-‐‑‒–—]+/g, " ")
    .replace(/[^a-z0-9µ²/+.%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSlug(value: unknown, maximum = 120): string | null {
  const normalized = normalizeProductText(value)
    .replace(/[/.+%-]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized ? normalized.slice(0, maximum) : null;
}

function uniqueStrings(
  value: unknown,
  maximumItems = 50,
  maximumLength = 500,
): string[] {
  const output = new Map<string, string>();
  for (const item of array(value)) {
    const itemText = text(item, maximumLength);
    const key = normalizeProductText(itemText);
    if (itemText && key && !output.has(key)) output.set(key, itemText);
    if (output.size >= maximumItems) break;
  }
  return [...output.values()];
}

function hasAny(value: string, expressions: readonly RegExp[]): boolean {
  return expressions.some((expression) => expression.test(value));
}

export function normalizeSterility(
  value: unknown,
): Signal<ProductSterilityStatus> & { sterilization_method: string | null } {
  const normalized = normalizeProductText(value);
  if (!normalized) {
    return {
      value: "unknown",
      ambiguous: false,
      sterilization_method: null,
    };
  }
  const negative = hasAny(normalized, [
    /\bnon sterile\b/,
    /\bnot sterile\b/,
    /\bunsterile\b/,
    /\bsterile degil\b/,
    /\bsteril degil\b/,
    /\bsteril olmayan\b/,
    /\bsteril degildir\b/,
  ]);
  const positiveCorpus = normalized
    .replace(/\b(?:non|not) sterile\b/g, " ")
    .replace(/\bunsterile\b/g, " ")
    .replace(/\bsterile degil\b/g, " ")
    .replace(/\bsteril (?:degil|olmayan|degildir)\b/g, " ");
  const positive = hasAny(positiveCorpus, [
    /\bsterile\b/,
    /\bsterilized\b/,
    /\bsterilised\b/,
    /\bsteril urun\b/,
    /\bsterildir\b/,
    /\bsteril olarak\b/,
  ]);
  const method = normalizeSterilizationMethod(value);
  const methodImpliesSterility = Boolean(
    method &&
      hasAny(normalized, [
        /\bsterilized\b/,
        /\bsterilised\b/,
        /\bsterilize edil/,
        /\bsteril edildi/,
        /\bsteril olarak/,
        /\bsterile\b/,
      ]),
  );
  if (negative && (positive || methodImpliesSterility)) {
    return {
      value: "unknown",
      ambiguous: true,
      sterilization_method: method,
    };
  }
  if (negative) {
    return {
      value: "non_sterile",
      ambiguous: false,
      sterilization_method: null,
    };
  }
  if (positive || methodImpliesSterility) {
    return {
      value: "sterile",
      ambiguous: false,
      sterilization_method: method,
    };
  }
  return {
    value: "unknown",
    ambiguous: false,
    sterilization_method: method,
  };
}

export function normalizeUseType(value: unknown): Signal<ProductUseType> {
  const normalized = normalizeProductText(value);
  if (!normalized) return { value: "unknown", ambiguous: false };
  const singleUse = hasAny(normalized, [
    /\bsingle use\b/,
    /\bdisposable\b/,
    /\bone time use\b/,
    /\btek kullanimlik\b/,
    /\bkullan at\b/,
  ]);
  const reusable = hasAny(normalized, [
    /\breusable\b/,
    /\bmultiple use\b/,
    /\bmulti use\b/,
    /\btekrar kullanilabilir\b/,
    /\byeniden kullanilabilir\b/,
    /\bcok kullanimlik\b/,
  ]);
  if (singleUse && reusable) return { value: "unknown", ambiguous: true };
  if (singleUse) return { value: "single_use", ambiguous: false };
  if (reusable) return { value: "reusable", ambiguous: false };
  return { value: "unknown", ambiguous: false };
}

export function normalizeSterilizationMethod(value: unknown): string | null {
  const normalized = normalizeProductText(value);
  if (!normalized) return null;
  const methods: Array<[string, RegExp]> = [
    ["EO", /\b(eo|eto|ethylene oxide|etilen oksit)\b/],
    ["gamma", /\b(gamma|gama)\b/],
    ["steam", /\b(steam|autoclave|buhar)\b/],
    ["e-beam", /\b(e beam|electron beam|elektron demeti)\b/],
    ["plasma", /\b(plasma|hidrojen peroksit|hydrogen peroxide)\b/],
  ];
  return methods.find(([, expression]) => expression.test(normalized))?.[0] ??
    null;
}

export function normalizeMaterials(value: unknown): string[] {
  const normalized = normalizeProductText(value);
  if (!normalized) return [];
  const materials: Array<[string, RegExp]> = [
    ["non-woven", /\b(non woven|nonwoven|dokunmamis)\b/],
    ["PE", /\b(pe|polyethylene|polietilen)\b/],
    ["PP", /\b(pp|polypropylene|polipropilen)\b/],
    ["nitrile", /\b(nitrile|nitril)\b/],
    ["natural latex", /\b(natural latex|dogal lateks)\b/],
    ["latex", /\b(latex|lateks)\b/],
    ["PVC", /\b(pvc|polyvinyl chloride|polivinil klorur)\b/],
    ["stainless steel", /\b(stainless steel|paslanmaz celik)\b/],
    ["cellulose", /\b(cellulose|seluloz)\b/],
    ["cotton", /\b(cotton|pamuk)\b/],
    ["polyester", /\b(polyester)\b/],
    ["polyamide", /\b(polyamide|poliamid)\b/],
  ];
  const result: string[] = [];
  for (const [canonical, expression] of materials) {
    if (expression.test(normalized) && !result.includes(canonical)) {
      result.push(canonical);
    }
  }
  if (result.includes("natural latex")) {
    return result.filter((item) => item !== "latex");
  }
  return result;
}

function millimetres(amount: string, unit: string): number {
  const factors: Record<string, number> = {
    mm: 1,
    cm: 10,
    m: 1_000,
  };
  return Number(amount.replace(",", ".")) * factors[unit];
}

function formatMillimetres(value: number): string {
  return Number.isInteger(value)
    ? `${value} mm`
    : `${Number(value.toFixed(3))} mm`;
}

export function normalizeDimensions(value: unknown): string[] {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[×✕]/g, "x");
  const matches = normalized.matchAll(
    /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*x\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)(?:\s*x\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m))?/g,
  );
  const output = new Set<string>();
  for (const match of matches) {
    const fallback = match[6] || match[4] || match[2];
    if (!fallback) continue;
    const parts = [
      formatMillimetres(millimetres(match[1], match[2] || fallback)),
      formatMillimetres(millimetres(match[3], match[4] || fallback)),
    ];
    if (match[5]) {
      parts.push(
        formatMillimetres(millimetres(match[5], match[6] || fallback)),
      );
    }
    output.add(parts.join(" x "));
  }
  return [...output];
}

export function normalizeCertifications(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const output = new Map<string, string>();
  for (const source of values) {
    const original = text(source, 2_000);
    const normalized = normalizeProductText(original);
    if (!original || !normalized) continue;
    const candidates: string[] = [];
    const isoMatches = original.matchAll(/\bISO\s*(\d{4,5}(?:-\d+)?)\b/gi);
    for (const match of isoMatches) candidates.push(`ISO ${match[1]}`);
    const enMatches = original.matchAll(
      /\bEN\s*(\d{3,5}(?:-\d+)*(?::\d{4})?)\b/gi,
    );
    for (const match of enMatches) candidates.push(`EN ${match[1]}`);
    if (/\bce(?: marked| marking| mark)?\b/i.test(original)) {
      candidates.push("CE");
    }
    if (/\b(?:eu\s*)?mdr(?:\s*2017\/745)?\b/i.test(original)) {
      candidates.push(
        /2017\/745/.test(original) ? "EU MDR 2017/745" : "EU MDR",
      );
    }
    for (const candidate of candidates) {
      const key = normalizeProductText(candidate).replace(/\s+/g, "");
      if (!output.has(key)) output.set(key, candidate);
    }
  }
  const priority = (certification: string): number => {
    if (certification === "CE") return 0;
    if (certification.startsWith("ISO ")) return 1;
    if (certification.startsWith("EN ")) return 2;
    if (certification.startsWith("EU MDR")) return 3;
    return 4;
  };
  return [...output.values()].sort((left, right) =>
    priority(left) - priority(right) || left.localeCompare(right, "en")
  );
}

export function normalizeProductCategory(
  name: unknown,
  category: unknown,
  subtype?: unknown,
): string | null {
  const combined = normalizeProductText([name, category, subtype].join(" "));
  const mappings: Array<[string, RegExp]> = [
    [
      "epidural_surgical_drapes",
      /\b(epidural).*(surgical drape|drape|campo cirurgico|ameliyat ortusu)\b/,
    ],
    [
      "surgical_drapes",
      /\b(surgical drape|operating drape|campo cirurgico|ameliyat ortusu|cerrahi ortu)\b/,
    ],
    [
      "surgical_packs",
      /\b(surgical pack|laparotomy pack|laparoscopic pack|c section pack|hip pack|drape pack|trouxa)\b/,
    ],
    [
      "surgical_gowns",
      /\b(surgical gown|sterile gown|non sterile gown|ameliyat onlugu)\b/,
    ],
    [
      "ultrasound_probe_covers",
      /\b(ultrasound|ultrason).*(probe cover|cover|kilif)\b/,
    ],
    [
      "equipment_covers",
      /\b(camera cover|equipment cover|microscope drape|mayo stand cover)\b/,
    ],
    ["medical_gloves", /\b(medical|examination|surgical).*(glove|eldiven)\b/],
    [
      "sterilization_indicators",
      /\b(chemical indicator|biological indicator|bowie dick|helix test)\b/,
    ],
    [
      "sterilization_packaging",
      /\b(sterilization reel|sterilization pouch|autoclave tape)\b/,
    ],
  ];
  const mapped = mappings.find(([, expression]) => expression.test(combined));
  if (mapped) return mapped[0];
  return canonicalSlug(category);
}

export function normalizePackageQuantity(value: unknown): number | null {
  const normalized = normalizeProductText(value);
  if (!normalized) return null;
  const patterns = [
    /\b(?:box|pack|package|pouch|bag|kutu|paket)\s+(?:of\s+)?(\d{1,7})\b/,
    /\b(\d{1,7})\s*(?:pcs|pieces|units|adet)\s*(?:per|\/)\s*(?:box|pack|package|kutu|paket)\b/,
    /\b(?:kutuda|pakette)\s+(\d{1,7})\b/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return finiteNumber(match[1], 1, 10_000_000);
  }
  return null;
}

export function normalizeCapacityUnit(value: unknown): string | null {
  const normalized = normalizeProductText(value);
  if (!normalized) return null;
  if (/\b(pcs|pc|piece|pieces|unit|units|adet)\b/.test(normalized)) {
    return "pieces";
  }
  if (/\b(box|boxes|kutu)\b/.test(normalized)) return "boxes";
  if (/\b(pack|packs|paket)\b/.test(normalized)) return "packs";
  if (/\b(set|sets|takim)\b/.test(normalized)) return "sets";
  if (/\b(kg|kilogram|kilograms)\b/.test(normalized)) return "kg";
  if (/\b(l|litre|litres|liter|liters|litre)\b/.test(normalized)) {
    return "litres";
  }
  if (/\b(m|metre|metres|meter|meters)\b/.test(normalized)) return "metres";
  if (/\b(m2|m²|square metre|square meter)\b/.test(normalized)) return "m²";
  return null;
}

export function normalizeCapacityPeriod(value: unknown): string | null {
  const normalized = normalizeProductText(value);
  if (!normalized) return null;
  if (/\b(day|daily|gun|gunluk)\b/.test(normalized)) return "day";
  if (/\b(week|weekly|hafta|haftalik)\b/.test(normalized)) return "week";
  if (/\b(month|monthly|ay|aylik)\b/.test(normalized)) return "month";
  if (/\b(year|annual|annually|yil|yillik)\b/.test(normalized)) return "year";
  return null;
}

function validSterility(value: unknown): ProductSterilityStatus {
  return value === "sterile" || value === "non_sterile" ? value : "unknown";
}

function validUseType(value: unknown): ProductUseType {
  return value === "single_use" || value === "reusable" ? value : "unknown";
}

function normalizedSources(value: unknown): ProductProfileSources {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const output: ProductProfileSources = {};
  for (const field of PROFILE_FIELDS) {
    if (SOURCE_VALUES.has(record[field] as ProductFieldSource)) {
      output[field] = record[field] as ProductFieldSource;
    }
  }
  return output;
}

export function canonicalizeProductProfile(
  input: ProductProfileInput,
): CanonicalProductProfile {
  const explicitCategory = canonicalSlug(input.normalized_category);
  const dimensions = normalizeDimensions(input.dimensions);
  const materialValues = normalizeMaterials(input.material);
  const certifications = normalizeCertifications(
    input.product_certifications,
  );
  const sources = normalizedSources(input.matching_profile_sources);
  return {
    normalized_category: explicitCategory,
    product_subtype: text(input.product_subtype, 160),
    material: materialValues.length
      ? materialValues.join(" + ")
      : text(input.material, 500),
    dimensions: dimensions.length
      ? dimensions.join("; ")
      : text(input.dimensions, 1_000),
    sterility_status: validSterility(input.sterility_status),
    use_type: validUseType(input.use_type),
    packaging_description: text(input.packaging_description, 1_000),
    units_per_package: finiteNumber(
      input.units_per_package,
      1,
      10_000_000,
    ),
    product_certifications: certifications,
    regulatory_class: text(input.regulatory_class, 120),
    sterilization_method: normalizeSterilizationMethod(
      input.sterilization_method,
    ) ?? text(input.sterilization_method, 120),
    production_capacity: finiteNumber(
      input.production_capacity,
      0.000001,
      1_000_000_000_000,
    ),
    capacity_unit: normalizeCapacityUnit(input.capacity_unit) ??
      text(input.capacity_unit, 80),
    capacity_period: normalizeCapacityPeriod(input.capacity_period) ??
      text(input.capacity_period, 40),
    technical_specifications: uniqueStrings(
      input.technical_specifications,
      50,
      500,
    ),
    matching_profile_sources: sources,
    profile_version: PRODUCT_PROFILE_VERSION,
  };
}

export function deriveProductProfile(
  input: ProductProfileInput,
): DerivedProductProfile {
  const name = text(input.name, 300);
  const category = text(input.category, 200);
  const description = text(input.description, 4_000);
  const corpus = [name, category, description].filter(Boolean).join(" ");
  const values: Partial<CanonicalProductProfile> = {};
  const safelyDerived: ProductProfileField[] = [];
  const ambiguous: ProductProfileField[] = [];
  const sources: ProductProfileSources = {};
  const categoryValue = normalizeProductCategory(name, category);
  if (categoryValue) {
    values.normalized_category = categoryValue;
    safelyDerived.push("normalized_category");
    sources.normalized_category = "derived";
  }
  const sterility = normalizeSterility(corpus);
  if (sterility.ambiguous) {
    ambiguous.push("sterility_status");
    sources.sterility_status = "unknown";
  } else if (sterility.value !== "unknown") {
    values.sterility_status = sterility.value;
    safelyDerived.push("sterility_status");
    sources.sterility_status = "derived";
  }
  if (sterility.sterilization_method && sterility.value === "sterile") {
    values.sterilization_method = sterility.sterilization_method;
    safelyDerived.push("sterilization_method");
    sources.sterilization_method = "derived";
  }
  const useType = normalizeUseType(corpus);
  if (useType.ambiguous) {
    ambiguous.push("use_type");
    sources.use_type = "unknown";
  } else if (useType.value !== "unknown") {
    values.use_type = useType.value;
    safelyDerived.push("use_type");
    sources.use_type = "derived";
  }
  const dimensions = normalizeDimensions(corpus);
  if (dimensions.length) {
    values.dimensions = dimensions.join("; ");
    safelyDerived.push("dimensions");
    sources.dimensions = "derived";
  }
  const materials = normalizeMaterials(corpus);
  if (materials.length) {
    values.material = materials.join(" + ");
    safelyDerived.push("material");
    sources.material = "derived";
  }
  const packageQuantity = normalizePackageQuantity(corpus);
  if (packageQuantity) {
    values.units_per_package = packageQuantity;
    safelyDerived.push("units_per_package");
    sources.units_per_package = "derived";
  }
  const skipped = PROFILE_FIELDS.filter((field) =>
    !safelyDerived.includes(field) && !ambiguous.includes(field)
  );
  for (const field of skipped) sources[field] ??= "unknown";
  return {
    values,
    safely_derived_fields: safelyDerived,
    ambiguous_fields: ambiguous,
    skipped_fields: skipped,
    sources,
  };
}

function hasUsefulCategory(category: string | null): boolean {
  return Boolean(category && !GENERIC_CATEGORIES.has(category));
}

export function calculateProductReadiness(
  input: ProductProfileInput,
): ProductReadiness {
  const profile = canonicalizeProductProfile(input);
  const name = text(input.name, 300);
  const checks = [
    {
      field: "product_identity",
      present: Boolean(name),
      points: 8,
      critical: true,
    },
    {
      field: "normalized_category",
      present: hasUsefulCategory(profile.normalized_category),
      points: 14,
      critical: true,
    },
    {
      field: "dimensions_or_technical_specifications",
      present: Boolean(
        profile.dimensions || profile.technical_specifications.length,
      ),
      points: 14,
      critical: true,
    },
    {
      field: "sterility_status",
      present: profile.sterility_status !== "unknown",
      points: 12,
      critical: true,
    },
    {
      field: "use_type",
      present: profile.use_type !== "unknown",
      points: 10,
      critical: true,
    },
    {
      field: "certification_or_regulatory_support",
      present: Boolean(
        profile.product_certifications.length || profile.regulatory_class,
      ),
      points: 14,
      critical: true,
    },
    {
      field: "material",
      present: Boolean(profile.material),
      points: 8,
      critical: false,
    },
    {
      field: "packaging",
      present: Boolean(
        profile.packaging_description || profile.units_per_package,
      ),
      points: 8,
      critical: false,
    },
    {
      field: "production_capacity",
      present: Boolean(
        profile.production_capacity &&
          profile.capacity_unit &&
          profile.capacity_period,
      ),
      points: 7,
      critical: false,
    },
    {
      field: "product_subtype",
      present: Boolean(profile.product_subtype),
      points: 3,
      critical: false,
    },
    {
      field: "sterilization_method",
      present: profile.sterility_status !== "sterile" ||
        Boolean(profile.sterilization_method),
      points: 2,
      critical: false,
    },
  ];
  const present = checks.filter((check) => check.present);
  const missing = checks.filter((check) => !check.present);
  return {
    score: present.reduce((total, check) => total + check.points, 0),
    present_fields: present.map((check) => check.field),
    missing_fields: missing.map((check) => check.field),
    critical_missing_fields: missing
      .filter((check) => check.critical)
      .map((check) => check.field),
    calculation_version: PRODUCT_READINESS_VERSION,
  };
}

export function mergeSafeDerivedProfile(
  current: ProductProfileInput,
  derived: DerivedProductProfile,
): CanonicalProductProfile {
  const currentProfile = canonicalizeProductProfile(current);
  const currentSources = currentProfile.matching_profile_sources;
  const merged = { ...currentProfile } as CanonicalProductProfile;
  for (const field of derived.safely_derived_fields) {
    const source = currentSources[field];
    if (source === "explicit") continue;
    const existing = currentProfile[field as keyof CanonicalProductProfile];
    const empty = existing == null ||
      existing === "" ||
      existing === "unknown" ||
      (Array.isArray(existing) && existing.length === 0);
    if (!empty) continue;
    (merged as unknown as Record<string, unknown>)[field] =
      derived.values[field as keyof CanonicalProductProfile];
    merged.matching_profile_sources[field] = "derived";
  }
  for (const field of derived.ambiguous_fields) {
    merged.matching_profile_sources[field] ??= "unknown";
  }
  return merged;
}

import {
  calculateProductReadiness,
  canonicalizeProductProfile,
  type CanonicalProductProfile,
  deriveProductProfile,
  mergeSafeDerivedProfile,
  normalizeProductText,
  type ProductFieldSource,
  type ProductProfileField,
  type ProductReadiness,
} from "./product-profile-v1.ts";

export type ProductWriteResult = {
  row: Record<string, unknown>;
  readiness: ProductReadiness;
};

export type ProductBackfillChange = {
  product_id: number;
  product_ref: string;
  product_name: string;
  safely_derived_fields: ProductProfileField[];
  ambiguous_fields: ProductProfileField[];
  proposed_values: Record<string, unknown>;
  readiness_before: ProductReadiness;
  readiness_after: ProductReadiness;
};

export type ProductBackfillReport = {
  products_inspected: number;
  products_with_safe_derivations: number;
  fields_safely_derived: Record<string, number>;
  ambiguous_fields_skipped: Record<string, number>;
  products_still_missing_critical_data: number;
  changes: ProductBackfillChange[];
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(
  value: unknown,
  name: string,
  maximum: number,
  required = false,
): string | null {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${name} must be text.`);
  }
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized && required) throw new Error(`${name} is required.`);
  if (normalized.length > maximum) {
    throw new Error(`${name} must be ${maximum} characters or fewer.`);
  }
  return normalized || null;
}

function integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return parsed;
}

function decimal(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function textArray(
  value: unknown,
  name: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(/[,;\n]/)
    : value == null
    ? []
    : null;
  if (!source) throw new Error(`${name} must be an array of text values.`);
  if (source.length > maximumItems) {
    throw new Error(`${name} may contain at most ${maximumItems} values.`);
  }
  return source.map((item) => {
    const itemText = text(item, name, maximumLength, true);
    if (!itemText) throw new Error(`${name} contains an empty value.`);
    return itemText;
  });
}

function safeUrl(value: unknown, name: string): string | null {
  const candidate = text(value, name, 2_000);
  if (!candidate) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must be an HTTPS URL.`);
  }
  return parsed.toString();
}

function enumValue<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${name} has an unsupported value.`);
  }
  return value as T;
}

function valueIsPresent(
  field: ProductProfileField,
  value: unknown,
): boolean {
  if (field === "sterility_status" || field === "use_type") {
    return value !== "unknown";
  }
  return Array.isArray(value)
    ? value.length > 0
    : value != null && value !== "";
}

function explicitSources(
  profile: CanonicalProductProfile,
): Record<string, ProductFieldSource> {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [
    field,
    valueIsPresent(
        field,
        profile[field as keyof CanonicalProductProfile],
      )
      ? "explicit"
      : "unknown",
  ]));
}

export function profileDatabaseValues(
  profile: CanonicalProductProfile,
): Record<string, unknown> {
  return {
    normalized_category: profile.normalized_category,
    product_subtype: profile.product_subtype,
    material: profile.material,
    dimensions: profile.dimensions,
    sterility_status: profile.sterility_status,
    use_type: profile.use_type,
    packaging_description: profile.packaging_description,
    units_per_package: profile.units_per_package,
    product_certifications: profile.product_certifications,
    regulatory_class: profile.regulatory_class,
    sterilization_method: profile.sterilization_method,
    production_capacity: profile.production_capacity,
    capacity_unit: profile.capacity_unit,
    capacity_period: profile.capacity_period,
    technical_specifications: profile.technical_specifications,
    matching_profile_sources: profile.matching_profile_sources,
  };
}

export function validateProductWrite(
  value: unknown,
  companyId: number,
): ProductWriteResult {
  const input = record(value);
  const ref = text(input.ref, "Product code", 120, true);
  const name = text(input.name, "Product name", 300, true);
  const category = text(input.category, "Category", 160, true);
  const description = text(input.description, "Description", 4_000);
  const profileInput = record(input.profile);
  const sterilityStatus = enumValue(
    profileInput.sterility_status,
    "Sterility status",
    ["sterile", "non_sterile", "unknown"] as const,
    "unknown",
  );
  const useType = enumValue(
    profileInput.use_type,
    "Use type",
    ["single_use", "reusable", "unknown"] as const,
    "unknown",
  );
  const rawCertifications = textArray(
    profileInput.product_certifications,
    "Product certifications",
    30,
    120,
  );
  const rawSpecifications = textArray(
    profileInput.technical_specifications,
    "Technical specifications",
    50,
    500,
  );
  const unitsPerPackage = integer(
    profileInput.units_per_package,
    "Units per package",
    1,
    10_000_000,
  );
  const productionCapacity = decimal(
    profileInput.production_capacity,
    "Production capacity",
    0.000001,
    1_000_000_000_000,
  );
  const capacityUnit = text(
    profileInput.capacity_unit,
    "Capacity unit",
    80,
  );
  const capacityPeriod = text(
    profileInput.capacity_period,
    "Capacity period",
    40,
  );
  const capacityParts = [
    productionCapacity != null,
    Boolean(capacityUnit),
    Boolean(capacityPeriod),
  ];
  if (capacityParts.some(Boolean) && !capacityParts.every(Boolean)) {
    throw new Error(
      "Production capacity, capacity unit, and capacity period must be supplied together.",
    );
  }
  const canonical = canonicalizeProductProfile({
    name,
    category,
    description,
    normalized_category: text(
      profileInput.normalized_category,
      "Normalized category",
      120,
    ),
    product_subtype: text(
      profileInput.product_subtype,
      "Product subtype",
      160,
    ),
    material: text(profileInput.material, "Material", 500),
    dimensions: text(profileInput.dimensions, "Dimensions", 1_000),
    sterility_status: sterilityStatus,
    use_type: useType,
    packaging_description: text(
      profileInput.packaging_description,
      "Packaging description",
      1_000,
    ),
    units_per_package: unitsPerPackage,
    product_certifications: rawCertifications,
    regulatory_class: text(
      profileInput.regulatory_class,
      "Regulatory class",
      120,
    ),
    sterilization_method: text(
      profileInput.sterilization_method,
      "Sterilization method",
      120,
    ),
    production_capacity: productionCapacity,
    capacity_unit: capacityUnit,
    capacity_period: capacityPeriod,
    technical_specifications: rawSpecifications,
  });
  const allowedMethods = new Set([
    "EO",
    "gamma",
    "steam",
    "e-beam",
    "plasma",
    "other",
  ]);
  const allowedCapacityUnits = new Set([
    "pieces",
    "boxes",
    "packs",
    "sets",
    "kg",
    "litres",
    "metres",
    "m²",
  ]);
  const allowedCapacityPeriods = new Set(["day", "week", "month", "year"]);
  if (
    canonical.sterilization_method &&
    !allowedMethods.has(canonical.sterilization_method)
  ) {
    throw new Error("Sterilization method has an unsupported value.");
  }
  if (
    canonical.capacity_unit &&
    !allowedCapacityUnits.has(canonical.capacity_unit)
  ) {
    throw new Error("Capacity unit has an unsupported value.");
  }
  if (
    canonical.capacity_period &&
    !allowedCapacityPeriods.has(canonical.capacity_period)
  ) {
    throw new Error("Capacity period has an unsupported value.");
  }
  if (
    canonical.sterility_status !== "sterile" &&
    canonical.sterilization_method
  ) {
    throw new Error(
      "A sterilization method may be set only for an explicitly sterile product.",
    );
  }
  canonical.matching_profile_sources = explicitSources(canonical);
  const row: Record<string, unknown> = {
    company_id: companyId,
    ref,
    name,
    category,
    description,
    image_url: safeUrl(input.image_url, "Image URL"),
    brochure_url: safeUrl(input.brochure_url, "Brochure URL"),
    ...profileDatabaseValues(canonical),
  };
  return {
    row,
    readiness: calculateProductReadiness({ ...row, name }),
  };
}

export function buildBackfillReport(
  products: readonly Record<string, unknown>[],
): ProductBackfillReport {
  const safeCounts: Record<string, number> = {};
  const ambiguousCounts: Record<string, number> = {};
  const changes: ProductBackfillChange[] = [];
  let productsStillMissingCriticalData = 0;
  for (const product of products) {
    const id = Number(product.id);
    const ref = String(product.ref ?? "");
    const name = String(product.name ?? "");
    if (!Number.isInteger(id) || !ref || !name) continue;
    const derived = deriveProductProfile(product);
    const merged = mergeSafeDerivedProfile(product, derived);
    const proposedValues = profileDatabaseValues(merged);
    const actualSafe = derived.safely_derived_fields.filter((field) => {
      const before = product[field];
      const after = proposedValues[field];
      return normalizeProductText(
        Array.isArray(before) ? before.join(" ") : before,
      ) !== normalizeProductText(
        Array.isArray(after) ? after.join(" ") : after,
      );
    });
    for (const field of actualSafe) {
      safeCounts[field] = (safeCounts[field] ?? 0) + 1;
    }
    for (const field of derived.ambiguous_fields) {
      ambiguousCounts[field] = (ambiguousCounts[field] ?? 0) + 1;
    }
    const readinessBefore = calculateProductReadiness(product);
    const readinessAfter = calculateProductReadiness({
      ...product,
      ...proposedValues,
    });
    if (readinessAfter.critical_missing_fields.length > 0) {
      productsStillMissingCriticalData += 1;
    }
    if (actualSafe.length || derived.ambiguous_fields.length) {
      changes.push({
        product_id: id,
        product_ref: ref,
        product_name: name,
        safely_derived_fields: actualSafe,
        ambiguous_fields: derived.ambiguous_fields,
        proposed_values: Object.fromEntries(
          actualSafe.map((field) => [field, proposedValues[field]]),
        ),
        readiness_before: readinessBefore,
        readiness_after: readinessAfter,
      });
    }
  }
  return {
    products_inspected: products.length,
    products_with_safe_derivations:
      changes.filter((change) => change.safely_derived_fields.length > 0)
        .length,
    fields_safely_derived: safeCounts,
    ambiguous_fields_skipped: ambiguousCounts,
    products_still_missing_critical_data: productsStillMissingCriticalData,
    changes,
  };
}

export function backfillUpdateForProduct(
  product: Record<string, unknown>,
): Record<string, unknown> {
  const derived = deriveProductProfile(product);
  const merged = mergeSafeDerivedProfile(product, derived);
  const proposed = profileDatabaseValues(merged);
  return Object.fromEntries(
    derived.safely_derived_fields.map((field) => [field, proposed[field]])
      .concat(
        [["matching_profile_sources", proposed.matching_profile_sources]],
      ),
  );
}

import { SupabaseApiError } from "../../../shared/api/supabase-http";
import type { ProfileError } from "../types";

const MIGRATION_CODES = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204"]);

export function toCompanyProfileError(error: unknown): ProfileError {
  const message = error instanceof Error
    ? error.message
    : "The company profile could not be loaded.";

  if (error instanceof Error && error.name === "SupabaseConfigurationError") {
    return { kind: "configuration", message };
  }

  const referencesProfileContract = [
    "companies",
    "company_match_profiles",
    "products",
    "cpv_catalog_with_counts",
  ].some((value) => message.includes(value));
  const missingContract = error instanceof SupabaseApiError
    && Boolean(error.code && MIGRATION_CODES.has(error.code));

  if (referencesProfileContract || missingContract) {
    return {
      kind: "migration",
      message:
        "The existing Partner Portal and Match Engine database contracts are required. Apply the migrations already used by production, then retry; this React page requires no new schema.",
    };
  }

  return { kind: "request", message };
}

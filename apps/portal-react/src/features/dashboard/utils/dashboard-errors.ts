import { SupabaseApiError } from "../../../shared/api/supabase-http";
import type { DashboardError } from "../types";

const MIGRATION_CODES = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204"]);

export function toDashboardError(error: unknown): DashboardError {
  const message = error instanceof Error
    ? error.message
    : "The dashboard could not be loaded.";

  if (error instanceof Error && error.name === "SupabaseConfigurationError") {
    return { kind: "configuration", message };
  }

  const referencesDashboardContract = [
    "opportunity_matches",
    "company_match_profiles",
    "rfq_requests",
    "products",
    "tenders",
    "distributor_candidates",
  ].some((value) => message.includes(value));
  const missingContract = error instanceof SupabaseApiError
    && Boolean(error.code && MIGRATION_CODES.has(error.code));

  if (referencesDashboardContract || missingContract) {
    return {
      kind: "migration",
      message:
        "The existing Partner Portal and Match Engine migrations are required. Apply the repository migrations already used by production, then retry; no new dashboard schema is required.",
    };
  }

  return { kind: "request", message };
}

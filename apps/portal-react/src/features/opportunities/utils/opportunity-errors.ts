import { SupabaseApiError } from "../../../shared/api/supabase-http";
import type { OpportunityError } from "../types";

const MIGRATION_CODES = new Set(["42P01", "42703", "42883", "PGRST200", "PGRST202", "PGRST204"]);

export function toOpportunityError(error: unknown): OpportunityError {
  const message = error instanceof Error
    ? error.message
    : "My Opportunities could not be loaded.";

  if (error instanceof Error && error.name === "SupabaseConfigurationError") {
    return { kind: "configuration", message };
  }

  const referencesOpportunityContract = [
    "opportunity_matches",
    "profile_match_score",
    "document_match_score",
    "opportunity_score",
    "confidence_level",
    "refresh_company_opportunity_matches",
    "set_opportunity_match_status",
  ].some((value) => message.includes(value));
  const missingContract = error instanceof SupabaseApiError
    && Boolean(error.code && MIGRATION_CODES.has(error.code));

  if (referencesOpportunityContract || missingContract) {
    return {
      kind: "migration",
      message:
        "The existing Match Engine and Explainable Match Engine migrations are required. Install the repository migrations through 202607200002_english_normalization.sql, then reload this page.",
    };
  }

  return { kind: "request", message };
}

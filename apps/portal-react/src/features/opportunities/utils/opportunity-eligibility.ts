export type OpportunityEligibility = "signed-out" | "checking" | "no-company" | "eligible";

export function determineOpportunityEligibility(
  hasSession: boolean,
  companyId: number | null | undefined,
): OpportunityEligibility {
  if (!hasSession) return "signed-out";
  if (companyId === undefined) return "checking";
  if (companyId === null) return "no-company";
  return "eligible";
}

export function opportunityResultsState(
  status: "loading" | "success" | "error",
  loadedCount: number,
  visibleCount: number,
  hasActiveFilters: boolean,
): "loading" | "error" | "empty" | "filtered-empty" | "results" {
  if (status === "loading") return "loading";
  if (status === "error") return "error";
  if (loadedCount === 0) return hasActiveFilters ? "filtered-empty" : "empty";
  if (visibleCount === 0) return "filtered-empty";
  return "results";
}

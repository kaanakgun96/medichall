export type CompanyProfileEligibility = "signed-out" | "checking" | "no-company" | "eligible";

export function determineCompanyProfileEligibility(
  hasSession: boolean,
  companyId: number | null | undefined,
): CompanyProfileEligibility {
  if (!hasSession) return "signed-out";
  if (companyId === undefined) return "checking";
  if (companyId === null) return "no-company";
  return "eligible";
}

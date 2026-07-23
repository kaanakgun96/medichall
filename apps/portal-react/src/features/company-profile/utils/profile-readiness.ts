import type {
  CompanyDetailsFormValue,
  MatchingProfileFormValue,
  ProfileReadinessValue,
} from "../types";

export function profileReadiness(
  company: CompanyDetailsFormValue,
  matching: MatchingProfileFormValue,
  productCount: number,
  legacyPortalUrl: string,
): ProfileReadinessValue {
  const legacyBase = legacyPortalUrl.split("#")[0];
  const items = [
    {
      id: "description" as const,
      complete: company.description.trim().length > 30,
      label: "Add a company description",
      href: "#/company-profile",
    },
    {
      id: "certifications" as const,
      complete: Boolean(company.certifications.trim()),
      label: "List your certifications",
      href: "#/company-profile",
    },
    {
      id: "products" as const,
      complete: productCount > 0,
      label: "Add at least one product",
      href: legacyBase,
    },
    {
      id: "keywords" as const,
      complete: Boolean(matching.productKeywords.trim()),
      label: "Set product keywords for matching",
      href: "#/company-profile",
    },
    {
      id: "countries" as const,
      complete: Boolean(matching.targetCountries.trim()),
      label: "Choose target countries",
      href: "#/company-profile",
    },
  ];
  const completedCount = items.filter((item) => item.complete).length;

  return {
    percentage: Math.round((100 * completedCount) / items.length),
    completedCount,
    items,
  };
}

export function formatProfileTimestamp(value: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

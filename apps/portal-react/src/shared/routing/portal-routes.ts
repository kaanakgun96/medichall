export const PORTAL_ROUTES = [
  "dashboard",
  "buyer-discovery",
  "all-tenders",
  "my-opportunities",
  "company-profile",
] as const;

export type PortalRoute = (typeof PORTAL_ROUTES)[number];

export function routeFromHash(hash: string): PortalRoute {
  const value = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (value === "dashboard") return "dashboard";
  if (value === "buyer-discovery") return "buyer-discovery";
  if (value === "company-profile") return "company-profile";
  return value === "my-opportunities" ? "my-opportunities" : "all-tenders";
}

export function routeHref(route: PortalRoute): string {
  return `#/${route}`;
}

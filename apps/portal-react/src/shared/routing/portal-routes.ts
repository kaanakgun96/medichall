export const PORTAL_ROUTES = ["dashboard", "all-tenders", "my-opportunities"] as const;

export type PortalRoute = (typeof PORTAL_ROUTES)[number];

export function routeFromHash(hash: string): PortalRoute {
  const value = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  if (value === "dashboard") return "dashboard";
  return value === "my-opportunities" ? "my-opportunities" : "all-tenders";
}

export function routeHref(route: PortalRoute): string {
  return `#/${route}`;
}

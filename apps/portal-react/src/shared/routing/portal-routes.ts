export const PORTAL_ROUTES = ["all-tenders", "my-opportunities"] as const;

export type PortalRoute = (typeof PORTAL_ROUTES)[number];

export function routeFromHash(hash: string): PortalRoute {
  const value = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  return value === "my-opportunities" ? "my-opportunities" : "all-tenders";
}

export function routeHref(route: PortalRoute): string {
  return `#/${route}`;
}

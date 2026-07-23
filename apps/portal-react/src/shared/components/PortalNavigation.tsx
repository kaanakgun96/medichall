import { BriefcaseBusiness, Building2, Gauge, Globe2 } from "lucide-react";
import type { PortalRoute } from "../routing/portal-routes";
import { routeHref } from "../routing/portal-routes";

type PortalNavigationProps = {
  activeRoute: PortalRoute;
};

const links: Array<{
  route: PortalRoute;
  label: string;
  icon: typeof Globe2;
}> = [
  { route: "dashboard", label: "Dashboard", icon: Gauge },
  { route: "all-tenders", label: "All Tenders", icon: Globe2 },
  { route: "my-opportunities", label: "My Opportunities", icon: BriefcaseBusiness },
  { route: "company-profile", label: "Company Profile", icon: Building2 },
];

export function PortalNavigation({ activeRoute }: PortalNavigationProps) {
  return (
    <nav className="portal-navigation" aria-label="Partner portal">
      {links.map(({ route, label, icon: Icon }) => (
        <a
          key={route}
          className={`portal-navigation__link${activeRoute === route ? " is-active" : ""}`}
          href={routeHref(route)}
          aria-current={activeRoute === route ? "page" : undefined}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

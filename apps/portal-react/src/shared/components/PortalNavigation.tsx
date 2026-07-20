import { BriefcaseBusiness, Globe2 } from "lucide-react";
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
  { route: "all-tenders", label: "All Tenders", icon: Globe2 },
  { route: "my-opportunities", label: "My Opportunities", icon: BriefcaseBusiness },
];

export function PortalNavigation({ activeRoute }: PortalNavigationProps) {
  return (
    <nav className="portal-navigation" aria-label="Tender Intelligence">
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

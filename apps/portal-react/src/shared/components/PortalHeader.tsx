import { ArrowLeft } from "lucide-react";
import type { PortalRoute } from "../routing/portal-routes";
import { Brand } from "./Brand";
import { PortalNavigation } from "./PortalNavigation";

type PortalHeaderProps = {
  activeRoute: PortalRoute;
  legacyPortalUrl: string;
};

export function PortalHeader({ activeRoute, legacyPortalUrl }: PortalHeaderProps) {
  return (
    <header className="site-header">
      <div className="page-width site-header__inner">
        <Brand />
        <PortalNavigation activeRoute={activeRoute} />
        <div className="site-header__actions">
          <span className="migration-badge">React migration · 03</span>
          <a className="header-link" href={legacyPortalUrl}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Current Partner Portal</span>
          </a>
        </div>
      </div>
    </header>
  );
}

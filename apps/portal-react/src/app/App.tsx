import { useEffect, useState } from "react";
import { CompanyProfilePage } from "../features/company-profile/components/CompanyProfilePage";
import { DashboardPage } from "../features/dashboard/components/DashboardPage";
import { OpportunitiesPage } from "../features/opportunities/components/OpportunitiesPage";
import { AllTendersPage } from "../features/tenders/components/AllTendersPage";
import { PortalHeader } from "../shared/components/PortalHeader";
import { SiteFooter } from "../shared/components/SiteFooter";
import { routeFromHash } from "../shared/routing/portal-routes";

export function App() {
  const [route, setRoute] = useState(() => routeFromHash(window.location.hash));
  const legacyPortalUrl = String(import.meta.env.VITE_LEGACY_PORTAL_URL ?? "/portal.html");

  useEffect(() => {
    const updateRoute = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  return (
    <div className="app-shell">
      <PortalHeader activeRoute={route} legacyPortalUrl={legacyPortalUrl} />
      <main>
        {route === "dashboard" ? (
          <DashboardPage legacyPortalUrl={legacyPortalUrl} />
        ) : route === "company-profile" ? (
          <CompanyProfilePage legacyPortalUrl={legacyPortalUrl} />
        ) : route === "my-opportunities" ? (
          <OpportunitiesPage legacyPortalUrl={legacyPortalUrl} />
        ) : (
          <AllTendersPage />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

import { useMemo } from "react";
import { StatePanel } from "../../../shared/components/StatePanel";
import { usePartnerCompany } from "../../opportunities/hooks/usePartnerCompany";
import type { PartnerCompany } from "../../opportunities/types";
import { useDashboard } from "../hooks/useDashboard";
import type { DashboardError as DashboardErrorValue } from "../types";
import { buildDashboardViewModel } from "../utils/format-dashboard";
import { DashboardError } from "./DashboardError";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardLoading } from "./DashboardLoading";
import { DashboardStats } from "./DashboardStats";
import { DashboardSummaryCards } from "./DashboardSummaryCards";
import { RecentOpportunities } from "./RecentOpportunities";

type DashboardPageProps = {
  legacyPortalUrl: string;
};

type ReadyDashboardProps = DashboardPageProps & {
  company: PartnerCompany;
};

function ReadyDashboard({ company, legacyPortalUrl }: ReadyDashboardProps) {
  const dashboard = useDashboard(company.id);
  const viewModel = useMemo(
    () => dashboard.data
      ? buildDashboardViewModel(company, dashboard.data, legacyPortalUrl)
      : null,
    [company, dashboard.data, legacyPortalUrl],
  );

  if (dashboard.status === "loading") return <DashboardLoading />;
  if (dashboard.status === "error" && dashboard.error) {
    return <DashboardError error={dashboard.error} onRetry={dashboard.retry} />;
  }
  if (!viewModel) return <DashboardLoading />;

  return (
    <div className="page-width dashboard-content">
      <DashboardSummaryCards metrics={viewModel.metrics} />
      <div className="dashboard-main-grid">
        <RecentOpportunities
          opportunities={viewModel.recentOpportunities}
          legacyPortalUrl={legacyPortalUrl}
        />
        <DashboardStats readiness={viewModel.readiness} />
      </div>
    </div>
  );
}

export function DashboardPage({ legacyPortalUrl }: DashboardPageProps) {
  const partner = usePartnerCompany();
  const companyName = partner.eligibility === "eligible" ? partner.company?.name : null;

  let content;
  if (partner.error) {
    const error: DashboardErrorValue = {
      kind: partner.error.kind,
      message: partner.error.message,
    };
    content = (
      <DashboardError
        error={error}
        title="Could not verify the partner account"
        onRetry={partner.retry}
      />
    );
  } else if (partner.eligibility === "signed-out") {
    content = (
      <div className="page-width dashboard-content">
        <StatePanel
          title="Sign in to see your dashboard"
          description="The dashboard contains company-specific matches, RFQs, products, and profile readiness. Continue through the current Partner Portal login flow; authentication is not part of this migration."
          action={(
            <a className="button button--primary button--medium" href={legacyPortalUrl}>
              Sign in through the current Partner Portal
            </a>
          )}
        />
      </div>
    );
  } else if (partner.eligibility === "no-company") {
    content = (
      <div className="page-width dashboard-content">
        <StatePanel
          title="Create a partner company profile first"
          description="The current session does not own a company row. Complete manufacturer onboarding in the production Partner Portal before opening the company dashboard."
          action={(
            <a className="button button--primary button--medium" href={legacyPortalUrl}>
              Continue in the current Partner Portal
            </a>
          )}
        />
      </div>
    );
  } else if (partner.eligibility === "eligible" && partner.company) {
    content = <ReadyDashboard company={partner.company} legacyPortalUrl={legacyPortalUrl} />;
  } else {
    content = <DashboardLoading />;
  }

  return (
    <>
      <DashboardHeader companyName={companyName} />
      {content}
    </>
  );
}

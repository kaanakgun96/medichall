import { Building2, RefreshCw } from "lucide-react";

type DashboardHeaderProps = {
  companyName?: string | null;
};

export function DashboardHeader({ companyName }: DashboardHeaderProps) {
  return (
    <section className="hero dashboard-hero" aria-labelledby="dashboard-title">
      <div className="page-width hero__inner">
        <div className="hero__copy">
          <span className="eyebrow eyebrow--light">
            <Building2 size={14} aria-hidden="true" /> Manufacturer portal
          </span>
          <h1 id="dashboard-title">
            {companyName ? `Welcome back, ${companyName}.` : "Your opportunity dashboard."}
          </h1>
          <p>
            Tenders and distributors matched to your company — refreshed every morning from
            official EU sources.
          </p>
        </div>
        <div className="hero__facts" aria-label="Dashboard data details">
          <div>
            <RefreshCw size={19} aria-hidden="true" />
            <span>
              <strong>Existing production data</strong>
              Metrics reuse the current Partner Portal queries and business rules
            </span>
          </div>
          <div>
            <Building2 size={19} aria-hidden="true" />
            <span>
              <strong>Company-specific</strong>
              Your authenticated company and RLS policies remain the access boundary
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

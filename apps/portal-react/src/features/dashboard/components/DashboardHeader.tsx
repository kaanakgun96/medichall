import { Building2, Search, ScanSearch } from "lucide-react";

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
            {companyName ? `${companyName}, grow your business across Europe.` : "Grow your business across Europe."}
          </h1>
          <p>
            Discover credible buyers beyond the network, understand European tenders, and
            build relationships with MedicHall members.
          </p>
          <div className="hero__actions">
            <a className="button button--primary button--medium" href="#/buyer-discovery">Discover European buyers</a>
            <a className="button button--secondary button--medium" href="#/my-opportunities">Explore tender intelligence</a>
          </div>
        </div>
        <div className="hero__facts" aria-label="Dashboard data details">
          <div>
            <Search size={19} aria-hidden="true" />
            <span>
              <strong>European Buyer Discovery</strong>
              Public procurement, websites and supported official registry signals
            </span>
          </div>
          <div>
            <ScanSearch size={19} aria-hidden="true" />
            <span>
              <strong>Tender Intelligence</strong>
              Evidence-backed procurement discovery and document understanding
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

import { ArrowRight, FileText, Handshake, MapPin } from "lucide-react";
import type { Opportunity } from "../../opportunities/types";
import {
  dashboardOpportunityMeta,
  dashboardOpportunityTitle,
} from "../utils/format-dashboard";
import { DashboardEmptyState } from "./DashboardEmptyState";

type RecentOpportunitiesProps = {
  opportunities: Opportunity[];
  legacyPortalUrl: string;
};

export function RecentOpportunities({
  opportunities,
  legacyPortalUrl,
}: RecentOpportunitiesProps) {
  return (
    <section className="dashboard-panel" aria-labelledby="top-opportunities-title">
      <div className="dashboard-panel__heading">
        <div>
          <h2 id="top-opportunities-title">Top opportunities</h2>
          <p>Your strongest matches, ranked by compatibility.</p>
        </div>
      </div>

      {opportunities.length ? (
        <div className="dashboard-opportunity-list">
          {opportunities.map((opportunity) => {
            const title = dashboardOpportunityTitle(opportunity);
            const meta = dashboardOpportunityMeta(opportunity);
            const Icon = opportunity.kind === "tender" ? FileText : Handshake;
            return (
              <article className="dashboard-opportunity" key={opportunity.id}>
                <div className="dashboard-opportunity__identity">
                  <span className="dashboard-opportunity__type">
                    <Icon size={13} aria-hidden="true" />
                    {opportunity.kind === "tender" ? "Tender" : "Distributor"}
                  </span>
                  <h3>{title}</h3>
                  {meta.length ? (
                    <p>
                      <MapPin size={13} aria-hidden="true" />
                      {meta.join(" · ")}
                    </p>
                  ) : null}
                </div>
                <div className="dashboard-opportunity__score" aria-label={`Match score ${opportunity.matchScore}%`}>
                  <strong>{opportunity.matchScore}%</strong>
                  <span>Match</span>
                </div>
                <a
                  className="dashboard-opportunity__link"
                  href="#/my-opportunities"
                  aria-label={`View ${title} in My Opportunities`}
                >
                  <ArrowRight size={17} aria-hidden="true" />
                </a>
              </article>
            );
          })}
        </div>
      ) : (
        <DashboardEmptyState legacyPortalUrl={legacyPortalUrl} />
      )}

      <a className="button button--secondary button--small dashboard-panel__action" href="#/my-opportunities">
        See all opportunities <ArrowRight size={15} aria-hidden="true" />
      </a>
    </section>
  );
}

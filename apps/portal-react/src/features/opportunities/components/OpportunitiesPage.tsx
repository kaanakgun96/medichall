import { BriefcaseBusiness, FileCheck2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../shared/components/Button";
import { StatePanel } from "../../../shared/components/StatePanel";
import { useOpportunities } from "../hooks/useOpportunities";
import { usePartnerCompany } from "../hooks/usePartnerCompany";
import { DEFAULT_OPPORTUNITY_FILTERS, type OpportunityFiltersValue, type PartnerCompany } from "../types";
import {
  filterOpportunities,
  hasActiveOpportunityFilters,
  opportunityCountries,
} from "../utils/opportunity-filters";
import { OpportunityFilters } from "./OpportunityFilters";
import { OpportunityResults } from "./OpportunityResults";

type OpportunitiesPageProps = {
  legacyPortalUrl: string;
};

type ReadyOpportunitiesProps = OpportunitiesPageProps & {
  company: PartnerCompany;
};

function ReadyOpportunities({ company, legacyPortalUrl }: ReadyOpportunitiesProps) {
  const [filters, setFilters] = useState<OpportunityFiltersValue>(DEFAULT_OPPORTUNITY_FILTERS);
  const opportunities = useOpportunities(company.id, filters);
  const visibleOpportunities = useMemo(
    () => filterOpportunities(opportunities.opportunities, filters),
    [filters, opportunities.opportunities],
  );
  const countries = useMemo(
    () => opportunityCountries(opportunities.opportunities),
    [opportunities.opportunities],
  );

  return (
    <div className="page-width opportunities-content">
      <div className="opportunities-context">
        <div>
          <span>Authenticated partner company</span>
          <strong>{company.name || `Company ${company.id}`}</strong>
        </div>
        <p>Scores and explanations are displayed exactly as returned by the existing backend.</p>
      </div>
      <OpportunityFilters
        filters={filters}
        countries={countries}
        onChange={setFilters}
        onReset={() => setFilters(DEFAULT_OPPORTUNITY_FILTERS)}
      />
      <OpportunityResults
        opportunities={visibleOpportunities}
        loadedCount={opportunities.opportunities.length}
        status={opportunities.status}
        error={opportunities.error}
        hasActiveFilters={hasActiveOpportunityFilters(filters)}
        hasMore={opportunities.hasMore}
        isLoadingMore={opportunities.isLoadingMore}
        isRefreshing={opportunities.isRefreshing}
        mutatingId={opportunities.mutatingId}
        actionError={opportunities.actionError}
        legacyPortalUrl={legacyPortalUrl}
        onLoadMore={() => void opportunities.loadMore()}
        onRefresh={() => void opportunities.refreshMatches()}
        onRetry={opportunities.retry}
        onReset={() => setFilters(DEFAULT_OPPORTUNITY_FILTERS)}
        onStatusChange={(opportunity, status) => void opportunities.updateStatus(opportunity, status)}
      />
    </div>
  );
}

export function OpportunitiesPage({ legacyPortalUrl }: OpportunitiesPageProps) {
  const partner = usePartnerCompany();

  let content;
  if (partner.error) {
    content = (
      <div className="page-width opportunities-content">
        <StatePanel
          kind={partner.error.kind === "configuration" ? "configuration" : "error"}
          title={partner.error.kind === "configuration" ? "Connect the existing Supabase project" : "Could not verify the partner account"}
          description={partner.error.message}
          action={<Button tone="primary" onClick={partner.retry}>Try again</Button>}
        />
      </div>
    );
  } else if (partner.eligibility === "signed-out") {
    content = (
      <div className="page-width opportunities-content">
        <StatePanel
          title="Sign in to see My Opportunities"
          description="All Tenders remains available anonymously. Company-specific matches require the existing Partner Portal session; login and registration have not moved in this migration."
          action={<a className="button button--primary button--medium" href={legacyPortalUrl}>Sign in through the current Partner Portal</a>}
        />
      </div>
    );
  } else if (partner.eligibility === "no-company") {
    content = (
      <div className="page-width opportunities-content">
        <StatePanel
          title="Create a partner company profile first"
          description="The session is valid, but it does not own a company row. Complete manufacturer onboarding in the current Partner Portal before opening company-specific opportunities."
          action={<a className="button button--primary button--medium" href={legacyPortalUrl}>Continue in the current Partner Portal</a>}
        />
      </div>
    );
  } else if (partner.eligibility === "eligible" && partner.company) {
    content = <ReadyOpportunities company={partner.company} legacyPortalUrl={legacyPortalUrl} />;
  } else {
    content = (
      <section className="page-width opportunities-content results" aria-busy="true" aria-label="Checking partner session">
        <div className="state-panel">
          <span className="spinner" aria-hidden="true" />
          <h2>Checking your partner session…</h2>
          <p>Reusing the current Partner Portal session securely.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="hero opportunities-hero">
        <div className="page-width hero__inner">
          <div className="hero__copy">
            <span className="eyebrow eyebrow--light"><BriefcaseBusiness size={14} aria-hidden="true" /> Company-specific intelligence</span>
            <h1>My opportunities.<br /><span>Explained, not guessed.</span></h1>
            <p>Review tender and distributor matches ranked for your company, with separate profile and document evidence.</p>
          </div>
          <div className="hero__facts" aria-label="Opportunity details">
            <div><FileCheck2 size={19} aria-hidden="true" /><span><strong>Evidence-aware scores</strong>Document match stays pending without analyzed evidence</span></div>
            <div><ShieldCheck size={19} aria-hidden="true" /><span><strong>RLS-protected</strong>Only matches for your owned company are requested</span></div>
          </div>
        </div>
      </section>
      {content}
    </>
  );
}

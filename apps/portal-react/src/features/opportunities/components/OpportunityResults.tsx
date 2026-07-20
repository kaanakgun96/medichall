import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { StatePanel } from "../../../shared/components/StatePanel";
import type { Opportunity, OpportunityError, OpportunityStatus } from "../types";
import { opportunityResultsState } from "../utils/opportunity-eligibility";
import { OpportunityCard } from "./OpportunityCard";

type OpportunityResultsProps = {
  opportunities: Opportunity[];
  loadedCount: number;
  status: "loading" | "success" | "error";
  error: OpportunityError | null;
  hasActiveFilters: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  mutatingId: number | null;
  actionError: string | null;
  legacyPortalUrl: string;
  onLoadMore: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onReset: () => void;
  onStatusChange: (opportunity: Opportunity, status: OpportunityStatus) => void;
};

function OpportunitySkeleton() {
  return (
    <div className="opportunity-card opportunity-card--skeleton" aria-hidden="true">
      <div className="opportunity-card__accent" />
      <div className="opportunity-card__body">
        <span className="skeleton skeleton--kicker" />
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--title-short" />
        <div className="skeleton-row"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
      </div>
    </div>
  );
}

export function OpportunityResults({
  opportunities,
  loadedCount,
  status,
  error,
  hasActiveFilters,
  hasMore,
  isLoadingMore,
  isRefreshing,
  mutatingId,
  actionError,
  legacyPortalUrl,
  onLoadMore,
  onRefresh,
  onRetry,
  onReset,
  onStatusChange,
}: OpportunityResultsProps) {
  const resultState = opportunityResultsState(
    status,
    loadedCount,
    opportunities.length,
    hasActiveFilters,
  );

  if (resultState === "loading") {
    return (
      <section className="results" aria-busy="true" aria-label="Loading opportunities">
        <div className="results__heading"><span className="skeleton skeleton--count" /></div>
        {[0, 1, 2].map((item) => <OpportunitySkeleton key={item} />)}
      </section>
    );
  }

  if (resultState === "error" && error) {
    const title = error.kind === "migration"
      ? "My Opportunities needs the existing match-engine migrations"
      : error.kind === "configuration"
        ? "Connect the existing Supabase project"
        : "Could not load My Opportunities";
    return (
      <StatePanel
        kind={error.kind === "configuration" ? "configuration" : "error"}
        title={title}
        description={error.message}
        action={<Button tone="primary" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Try again</Button>}
      />
    );
  }

  if (resultState === "empty") {
    return (
      <StatePanel
        title="No company opportunities yet"
        description="Set up your matching profile in the current Partner Portal and run Find matches. New tender and distributor matches are also refreshed by the existing daily backend process."
        action={(
          <div className="state-panel__actions">
            <Button tone="primary" disabled={isRefreshing} onClick={onRefresh}>
              {isRefreshing ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {isRefreshing ? "Refreshing…" : "Refresh matches"}
            </Button>
            <a className="button button--secondary button--medium" href={`${legacyPortalUrl.split("#")[0]}#opportunities`}>Open matching profile</a>
          </div>
        )}
      />
    );
  }

  if (resultState === "filtered-empty") {
    return (
      <StatePanel
        title="No loaded opportunities match these filters"
        description={hasMore
          ? "Reset the filters or load more company matches. Search and country filters preserve the legacy client-side behavior across the pages you load."
          : "Try clearing the search, country, type, or minimum-score filter."}
        action={(
          <div className="state-panel__actions">
            <Button onClick={onReset}>Reset filters</Button>
            {hasMore ? (
              <Button tone="primary" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : null}
                {isLoadingMore ? "Loading…" : "Load 20 more matches"}
              </Button>
            ) : null}
          </div>
        )}
      />
    );
  }

  return (
    <section className="results" aria-live="polite" aria-busy={isLoadingMore || isRefreshing}>
      <div className="opportunity-results__heading">
        <div>
          <strong>{opportunities.length.toLocaleString()}</strong>
          <span> visible from {loadedCount.toLocaleString()} loaded company match{loadedCount === 1 ? "" : "es"}</span>
        </div>
        <Button tone="primary" size="small" disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          {isRefreshing ? "Refreshing…" : "Refresh matches"}
        </Button>
      </div>

      {actionError ? <p className="opportunity-action-error" role="alert">{actionError}</p> : null}

      <div className="opportunity-list">
        {opportunities.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            legacyPortalUrl={legacyPortalUrl}
            mutating={mutatingId === opportunity.id}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>

      {hasMore ? (
        <Button className="load-more" onClick={onLoadMore} disabled={isLoadingMore}>
          {isLoadingMore ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}
          {isLoadingMore ? "Loading…" : "Load 20 more company matches"}
        </Button>
      ) : (
        <p className="results__end">You have reached the end of these company matches.</p>
      )}
    </section>
  );
}

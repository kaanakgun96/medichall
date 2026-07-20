import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { StatePanel } from "../../../shared/components/StatePanel";
import type { Tender } from "../types";
import { TenderCard } from "./TenderCard";

type TenderResultsProps = {
  tenders: Tender[];
  totalCount: number;
  status: "loading" | "success" | "error";
  error: { kind: "migration" | "configuration" | "request"; message: string } | null;
  isDebouncing: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMoreError: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onReset: () => void;
};

function TenderSkeleton() {
  return (
    <div className="tender-card tender-card--skeleton" aria-hidden="true">
      <div className="tender-card__accent" />
      <div className="tender-card__body">
        <span className="skeleton skeleton--kicker" />
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--title-short" />
        <div className="skeleton-row"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
      </div>
    </div>
  );
}

export function TenderResults({
  tenders,
  totalCount,
  status,
  error,
  isDebouncing,
  isLoadingMore,
  hasMore,
  loadMoreError,
  onLoadMore,
  onRetry,
  onReset,
}: TenderResultsProps) {
  if (status === "loading") {
    return (
      <section className="results" aria-busy="true" aria-label="Loading tenders">
        <div className="results__heading"><span className="skeleton skeleton--count" /></div>
        {[0, 1, 2, 3].map((item) => <TenderSkeleton key={item} />)}
      </section>
    );
  }

  if (status === "error" && error) {
    const title = error.kind === "migration" ? "Advanced tender search needs its database migrations" : error.kind === "configuration" ? "Connect the existing Supabase project" : "Could not load the tender feed";
    return (
      <StatePanel
        kind={error.kind === "configuration" ? "configuration" : "error"}
        title={title}
        description={error.message}
        action={<Button tone="primary" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Try again</Button>}
      />
    );
  }

  if (tenders.length === 0) {
    return (
      <StatePanel
        title="Nothing found in the feed"
        description="No open tender matches these filters. Try a broader CPV family, another country, or include tenders with no stated value."
        action={<Button onClick={onReset}>Reset filters</Button>}
      />
    );
  }

  return (
    <section className="results" aria-live="polite" aria-busy={isDebouncing || isLoadingMore}>
      <div className="results__heading">
        <div>
          <strong>{totalCount.toLocaleString()}</strong>
          <span> open tender{totalCount === 1 ? "" : "s"} match these filters</span>
        </div>
        {isDebouncing ? <span className="results__updating"><span className="spinner" /> Updating…</span> : null}
      </div>

      <div className="tender-list">
        {tenders.map((tender) => <TenderCard key={tender.id} tender={tender} />)}
      </div>

      {loadMoreError ? <p className="load-more-error" role="alert">{loadMoreError}</p> : null}
      {hasMore ? (
        <Button className="load-more" onClick={onLoadMore} disabled={isLoadingMore}>
          {isLoadingMore ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}
          {isLoadingMore ? "Loading…" : "Load 20 more"}
        </Button>
      ) : (
        <p className="results__end">You have reached the end of these results.</p>
      )}
    </section>
  );
}

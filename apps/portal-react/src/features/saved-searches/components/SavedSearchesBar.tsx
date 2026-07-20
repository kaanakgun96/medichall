import { Bell, BellOff, Bookmark, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import type { SavedSearch } from "../types";

type SavedSearchesBarProps = {
  signedIn: boolean;
  status: "signed-out" | "loading" | "success" | "error";
  searches: SavedSearch[];
  error: string | null;
  mutatingId: number | null;
  legacyPortalUrl: string;
  onApply: (search: SavedSearch) => void;
  onToggleAlert: (search: SavedSearch) => void;
  onDelete: (search: SavedSearch) => void;
  onRetry: () => void;
};

export function SavedSearchesBar({
  signedIn,
  status,
  searches,
  error,
  mutatingId,
  legacyPortalUrl,
  onApply,
  onToggleAlert,
  onDelete,
  onRetry,
}: SavedSearchesBarProps) {
  if (!signedIn || status === "signed-out") {
    return (
      <aside className="saved-searches saved-searches--signed-out">
        <Bookmark size={17} aria-hidden="true" />
        <span><a href={legacyPortalUrl}>Sign in through the current Partner Portal</a> to save searches and manage daily email alerts.</span>
      </aside>
    );
  }

  if (status === "loading") {
    return <aside className="saved-searches"><span className="spinner" /> Loading saved searches…</aside>;
  }

  if (status === "error") {
    return (
      <aside className="saved-searches saved-searches--error" role="alert">
        <span>{error || "Saved searches are unavailable."}</span>
        <Button size="small" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Retry</Button>
      </aside>
    );
  }

  if (!searches.length) {
    return (
      <aside className="saved-searches">
        <Bookmark size={17} aria-hidden="true" />
        <span>No saved searches yet. Set a filter and choose <strong>Save search</strong>.</span>
      </aside>
    );
  }

  return (
    <aside className="saved-searches" aria-label="Saved searches">
      <span className="saved-searches__label"><Bookmark size={15} aria-hidden="true" /> Saved</span>
      <div className="saved-searches__chips">
        {searches.map((search) => {
          const isMutating = mutatingId === search.id;
          return (
            <span className="saved-search" key={search.id}>
              <button className="saved-search__name" type="button" onClick={() => onApply(search)}>
                {search.name}
              </button>
              <button
                className="saved-search__icon"
                type="button"
                disabled={isMutating}
                onClick={() => onToggleAlert(search)}
                aria-label={`${search.email_alerts ? "Turn off" : "Turn on"} daily email for ${search.name}`}
                title={search.email_alerts ? "Daily email on" : "Daily email off"}
              >
                {isMutating ? <LoaderCircle className="spin" size={14} /> : search.email_alerts ? <Bell size={14} /> : <BellOff size={14} />}
              </button>
              <button
                className="saved-search__icon saved-search__icon--delete"
                type="button"
                disabled={isMutating}
                onClick={() => onDelete(search)}
                aria-label={`Delete saved search ${search.name}`}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
    </aside>
  );
}

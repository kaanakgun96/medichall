import { ArrowLeft, Database, Globe2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { filtersToSavedSearch, savedSearchToFilters, suggestedSavedSearchName } from "../../saved-searches/types";
import { SaveSearchDialog } from "../../saved-searches/components/SaveSearchDialog";
import { SavedSearchesBar } from "../../saved-searches/components/SavedSearchesBar";
import { useSavedSearches } from "../../saved-searches/hooks/useSavedSearches";
import type { SavedSearch } from "../../saved-searches/types";
import { Brand } from "../../../shared/components/Brand";
import { Toast, type ToastMessage } from "../../../shared/components/Toast";
import { useTenderFacets } from "../hooks/useTenderFacets";
import { useTenderSearch } from "../hooks/useTenderSearch";
import type { TenderFilters as TenderFiltersValue } from "../types";
import { DEFAULT_TENDER_FILTERS, hasSaveableFilter } from "../utils/tender-filters";
import { TenderFilters } from "./TenderFilters";
import { TenderResults } from "./TenderResults";

export function AllTendersPage() {
  const [filters, setFilters] = useState<TenderFiltersValue>(DEFAULT_TENDER_FILTERS);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | null>(null);
  const tenderSearch = useTenderSearch(filters);
  const { facets, status: facetsStatus } = useTenderFacets();
  const savedSearches = useSavedSearches();
  const legacyPortalUrl = String(import.meta.env.VITE_LEGACY_PORTAL_URL ?? "/portal.html");

  const showToast = useCallback((text: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const requestSave = () => {
    if (!hasSaveableFilter(filters)) {
      showToast("Set at least one filter before saving.");
      return;
    }
    if (!savedSearches.signedIn) {
      showToast("Sign in through the current Partner Portal before saving a search.");
      return;
    }
    setSaveError(null);
    setSaveDialogOpen(true);
  };

  const saveSearch = async (name: string) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await savedSearches.create(filtersToSavedSearch(name, filters));
      setSaveDialogOpen(false);
      showToast("Search saved. Daily email alerts are on.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The search could not be saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const applySavedSearch = (search: SavedSearch) => {
    setFilters(savedSearchToFilters(search));
    showToast(`Applied “${search.name}”.`);
  };

  const toggleSavedAlert = async (search: SavedSearch) => {
    try {
      await savedSearches.toggleAlert(search);
      showToast(`Daily email ${search.email_alerts ? "off" : "on"} for “${search.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The email setting could not be updated.");
    }
  };

  const removeSavedSearch = async (search: SavedSearch) => {
    if (!window.confirm(`Delete saved search “${search.name}”?`)) return;
    try {
      await savedSearches.remove(search);
      showToast(`Deleted “${search.name}”.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The saved search could not be deleted.");
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="page-width site-header__inner">
          <Brand />
          <div className="site-header__actions">
            <span className="migration-badge">React migration · 01</span>
            <a className="header-link" href={legacyPortalUrl}>
              <ArrowLeft size={16} aria-hidden="true" /> Current Partner Portal
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="page-width hero__inner">
            <div className="hero__copy">
              <span className="eyebrow eyebrow--light"><Globe2 size={14} aria-hidden="true" /> Official EU tender feed</span>
              <h1>All tenders.<br /><span>One precise search.</span></h1>
              <p>Browse every open medical tender in MedicHall’s daily feed—independent of your company match score.</p>
            </div>
            <div className="hero__facts" aria-label="Feed details">
              <div><Database size={19} aria-hidden="true" /><span><strong>Live Supabase data</strong>Existing search_tenders RPC</span></div>
              <div><ShieldCheck size={19} aria-hidden="true" /><span><strong>Original values preserved</strong>ECB conversions are approximate</span></div>
            </div>
          </div>
        </section>

        <div className="page-width page-content">
          <TenderFilters
            filters={filters}
            facets={facets}
            facetsStatus={facetsStatus}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_TENDER_FILTERS)}
            onSave={requestSave}
            canSave={hasSaveableFilter(filters)}
          />

          <SavedSearchesBar
            signedIn={savedSearches.signedIn}
            status={savedSearches.status}
            searches={savedSearches.searches}
            error={savedSearches.error}
            mutatingId={savedSearches.mutatingId}
            legacyPortalUrl={legacyPortalUrl}
            onApply={applySavedSearch}
            onToggleAlert={(search) => void toggleSavedAlert(search)}
            onDelete={(search) => void removeSavedSearch(search)}
            onRetry={savedSearches.retry}
          />

          <TenderResults
            {...tenderSearch}
            onLoadMore={() => void tenderSearch.loadMore()}
            onRetry={tenderSearch.retry}
            onReset={() => setFilters(DEFAULT_TENDER_FILTERS)}
          />
        </div>
      </main>

      <footer className="site-footer">
        <div className="page-width">MedicHall Tender Intelligence · Data sourced from official procurement notices.</div>
      </footer>

      <SaveSearchDialog
        open={saveDialogOpen}
        suggestedName={suggestedSavedSearchName(filters)}
        saving={isSaving}
        error={saveError}
        onClose={() => !isSaving && setSaveDialogOpen(false)}
        onSave={(name) => void saveSearch(name)}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

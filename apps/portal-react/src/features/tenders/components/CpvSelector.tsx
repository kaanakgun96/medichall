import { Check, ChevronRight, Search, Tags, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../shared/components/Button";
import { fetchCpvCatalog } from "../api/tenders-api";
import type { CpvCatalogItem } from "../types";
import { parseCpvInput, withCpvCode } from "../utils/tender-filters";

type CpvSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
  inputDescriptionId?: string;
  inputInvalid?: boolean;
  placeholder?: string;
  browseLabel?: string;
  selectedLabel?: string;
  selectedCodes?: string[];
  onToggleCode?: (code: string) => void;
  disabled?: boolean;
};

type CatalogStatus = "idle" | "loading" | "success" | "error";

export function CpvSelector({
  value,
  onChange,
  inputId = "cpv-filter",
  inputDescriptionId,
  inputInvalid = false,
  placeholder = "e.g. 3319 or 33190000",
  browseLabel = "Browse",
  selectedLabel = "Selected CPV families",
  selectedCodes,
  onToggleCode,
  disabled = false,
}: CpvSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<CpvCatalogItem[]>([]);
  const [status, setStatus] = useState<CatalogStatus>("idle");
  const selected = useMemo(
    () => new Set(selectedCodes ?? parseCpvInput(value)),
    [selectedCodes, value],
  );
  const dialogTitleId = `${inputId}-dialog-title`;
  const catalogSearchId = `${inputId}-catalog-search`;

  useEffect(() => {
    if (!open || status !== "idle") return;
    const controller = new AbortController();
    setStatus("loading");
    void fetchCpvCatalog(controller.signal)
      .then((rows) => {
        setCatalog(rows);
        setStatus("success");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [open, status]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const selectableItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalog
      .filter((item) => item.depth >= 4)
      .filter(
        (item) =>
          !normalizedQuery ||
          item.label_en.toLowerCase().includes(normalizedQuery) ||
          item.code.includes(normalizedQuery) ||
          item.code_full.includes(normalizedQuery),
      );
  }, [catalog, query]);

  const toggleCode = (code: string) => {
    if (onToggleCode) onToggleCode(code);
    else onChange(withCpvCode(value, code));
  };

  return (
    <div className="cpv-control">
      <div className="cpv-control__input-row">
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          aria-describedby={inputDescriptionId}
          aria-invalid={inputInvalid || undefined}
          disabled={disabled}
        />
        <Button
          size="small"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          disabled={disabled}
        >
          <Tags size={16} aria-hidden="true" />
          {browseLabel}
        </Button>
      </div>
      {selected.size ? (
        <div className="cpv-control__chips" aria-label={selectedLabel}>
          {[...selected].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => toggleCode(code)}
              title={`Remove CPV ${code}`}
              disabled={disabled}
            >
              {code}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="cpv-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
            <header className="dialog-header">
              <div>
                <span className="eyebrow">Official EU CPV 2008 catalog</span>
                <h2 id={dialogTitleId}>Select product families</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close CPV selector">
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <label className="search-field search-field--dialog" htmlFor={catalogSearchId}>
              <Search size={18} aria-hidden="true" />
              <input
                id={catalogSearchId}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search gloves, imaging, furniture or a CPV code"
              />
            </label>

            <div className="cpv-dialog__selected">
              <span>{selected.size} selected</span>
              <small>Selecting a family also matches its sub-codes.</small>
            </div>

            <div className="cpv-catalog" aria-live="polite">
              {status === "loading" ? (
                <div className="inline-state"><span className="spinner" /> Loading the catalog…</div>
              ) : null}
              {status === "error" ? (
                <div className="inline-state inline-state--error">
                  The catalog is unavailable. Run <code>202607200001_cpv_catalog.sql</code>, or enter a CPV code manually.
                </div>
              ) : null}
              {status === "success" && selectableItems.length === 0 ? (
                <div className="inline-state">No product family matches this search.</div>
              ) : null}
              {status === "success"
                ? selectableItems.map((item) => {
                    const checked = selected.has(item.code);
                    return (
                      <label className={`cpv-option ${item.depth >= 5 ? "cpv-option--nested" : ""}`} key={item.code}>
                        <input type="checkbox" checked={checked} onChange={() => toggleCode(item.code)} />
                        <span className="cpv-option__check" aria-hidden="true">{checked ? <Check size={13} /> : null}</span>
                        <span className="cpv-option__label">
                          <strong>{item.label_en}</strong>
                          <small>{item.code_full}</small>
                        </span>
                        <span className="cpv-option__count">{Number(item.open_tender_count || 0).toLocaleString()} open</span>
                        <ChevronRight size={15} aria-hidden="true" />
                      </label>
                    );
                  })
                : null}
            </div>

            <footer className="dialog-footer">
              <p>Counts are live open tenders from the existing feed.</p>
              <Button tone="primary" onClick={() => setOpen(false)}>Use selected CPVs</Button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

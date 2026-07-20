import { BellRing, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../shared/components/Button";

type SaveSearchDialogProps = {
  open: boolean;
  suggestedName: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
};

export function SaveSearchDialog({
  open,
  suggestedName,
  saving,
  error,
  onClose,
  onSave,
}: SaveSearchDialogProps) {
  const [name, setName] = useState(suggestedName);

  useEffect(() => {
    if (open) setName(suggestedName);
  }, [open, suggestedName]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, saving]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <form
        className="save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-search-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">Saved search</span>
            <h2 id="save-search-title">Name this tender search</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="Close save search dialog">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <p className="save-dialog__intro">The filter set will appear above the results. Daily email alerts start on by default and can be toggled at any time.</p>
        <label htmlFor="saved-search-name">
          Search name
          <input
            id="saved-search-name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Imaging tenders in Germany"
          />
        </label>
        <div className="save-dialog__alert"><BellRing size={17} aria-hidden="true" /> Daily digest: on</div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-footer">
          <Button type="button" tone="quiet" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save search"}</Button>
        </footer>
      </form>
    </div>
  );
}

# MedicHall showroom canonical final fix

This is the minimal manual cPanel patch for the verified showroom metadata timing defect. Codex did not upload it to cPanel and made no backend, database, provider, email, analytics or production-data change.

The upload ZIP is `deliverables/medichall-showroom-canonical-final-fix-2026-08-13.zip`. Its archive root contains only the two required production files.

## Proven cause

The cPanel rewrite preserves `/m/<slug>` and serves `companies.html`. The existing inline loader correctly reads `window.location.pathname`, resolves the public company by slug and renders the correct company. The external metadata controller also correctly builds company-specific metadata from that public company record.

The defect was timing: the metadata controller ran only after `loadProfile()` completed slower certificate, catalogue and product requests. Live tracing showed the company name already visible while the canonical and schema were still generic; the company metadata appeared later. The fix exposes the existing canonical metadata function and invokes it synchronously as soon as the public company record resolves. The existing final enhancement still runs after products load, enriching the same schema. No route-specific hardcoding was added.

Initial static HTML remains the generic Company Directory shell. A server/prerender solution remains a separately scoped future improvement.

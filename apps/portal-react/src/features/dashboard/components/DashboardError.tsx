import { RefreshCw } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { StatePanel } from "../../../shared/components/StatePanel";
import type { DashboardError as DashboardErrorValue } from "../types";

type DashboardErrorProps = {
  error: DashboardErrorValue;
  title?: string;
  onRetry: () => void;
};

export function DashboardError({ error, title, onRetry }: DashboardErrorProps) {
  const heading = title ?? (error.kind === "migration"
    ? "Dashboard needs the existing production migrations"
    : error.kind === "configuration"
      ? "Connect the existing Supabase project"
      : "Could not load the dashboard");

  return (
    <div className="page-width dashboard-content">
      <StatePanel
        kind={error.kind === "configuration" ? "configuration" : "error"}
        title={heading}
        description={error.message}
        action={(
          <Button tone="primary" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </Button>
        )}
      />
    </div>
  );
}

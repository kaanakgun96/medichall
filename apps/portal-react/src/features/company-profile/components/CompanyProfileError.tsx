import { RefreshCw } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import { StatePanel } from "../../../shared/components/StatePanel";
import type { ProfileError } from "../types";

type CompanyProfileErrorProps = {
  error: ProfileError;
  onRetry: () => void;
};

export function CompanyProfileError({
  error,
  onRetry,
}: CompanyProfileErrorProps) {
  const title = error.kind === "configuration"
    ? "Connect the existing Supabase project"
    : error.kind === "migration"
      ? "Company Profile needs the existing production migrations"
      : "Could not load the company profile";

  return (
    <div className="page-width company-profile-content">
      <StatePanel
        kind={error.kind === "configuration" ? "configuration" : "error"}
        title={title}
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

import { Target } from "lucide-react";

type DashboardEmptyStateProps = {
  legacyPortalUrl: string;
};

export function DashboardEmptyState({ legacyPortalUrl }: DashboardEmptyStateProps) {
  const matchingProfileUrl = `${legacyPortalUrl.split("#")[0]}#opportunities`;
  return (
    <div className="dashboard-empty" role="status">
      <Target size={25} aria-hidden="true" />
      <strong>No opportunities yet</strong>
      <p>Set up your matching profile in the Opportunities tab and click Find matches.</p>
      <a className="button button--primary button--small" href={matchingProfileUrl}>
        Set up matching
      </a>
    </div>
  );
}

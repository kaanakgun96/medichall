import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dashboardMetrics } from "../utils/format-dashboard";
import { DashboardStats } from "./DashboardStats";
import { DashboardSummaryCards } from "./DashboardSummaryCards";

describe("dashboard components", () => {
  it("renders all four backend-derived summary metrics as keyboard-accessible links", () => {
    const markup = renderToStaticMarkup(
      <DashboardSummaryCards metrics={dashboardMetrics([], 2)} />,
    );

    expect(markup).toContain("Total matches");
    expect(markup).toContain("High matches");
    expect(markup).toContain("Open tenders");
    expect(markup).toContain("RFQ inbox");
    expect(markup).toContain('href="#/my-opportunities"');
  });

  it("exposes the exact readiness percentage through a progressbar", () => {
    const markup = renderToStaticMarkup(
      <DashboardStats readiness={{
        percentage: 40,
        completedCount: 2,
        items: [
          { id: "description", complete: true, label: "Add a company description", href: "/portal.html#profile" },
          { id: "products", complete: false, label: "Add at least one product", href: "/portal.html" },
        ],
      }} />,
    );

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="40"');
    expect(markup).toContain("40%");
  });
});

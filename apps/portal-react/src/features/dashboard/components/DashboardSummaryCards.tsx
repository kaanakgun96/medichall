import { BriefcaseBusiness, FileText, Inbox, Star } from "lucide-react";
import type { DashboardMetric } from "../types";

type DashboardSummaryCardsProps = {
  metrics: DashboardMetric[];
};

const iconByMetric = {
  total: BriefcaseBusiness,
  high: Star,
  tenders: FileText,
  rfq: Inbox,
};

export function DashboardSummaryCards({ metrics }: DashboardSummaryCardsProps) {
  return (
    <section aria-labelledby="dashboard-summary-title">
      <h2 className="sr-only" id="dashboard-summary-title">Dashboard summary</h2>
      <div className="dashboard-summary-grid">
        {metrics.map((metric) => {
          const Icon = iconByMetric[metric.id];
          return (
            <a
              className="dashboard-summary-card"
              href={metric.href}
              key={metric.id}
              aria-label={`${metric.label}: ${metric.value}. ${metric.detail}`}
            >
              <span className="dashboard-summary-card__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="dashboard-summary-card__label">{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </a>
          );
        })}
      </div>
    </section>
  );
}

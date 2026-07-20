import { ArrowRight, Check } from "lucide-react";
import type { DashboardReadiness } from "../types";

type DashboardStatsProps = {
  readiness: DashboardReadiness;
};

export function DashboardStats({ readiness }: DashboardStatsProps) {
  return (
    <section className="dashboard-panel dashboard-readiness" aria-labelledby="match-readiness-title">
      <div className="dashboard-panel__heading">
        <div>
          <h2 id="match-readiness-title">Match readiness</h2>
          <p>Complete your profile to improve match quality.</p>
        </div>
        <strong aria-label={`${readiness.percentage}% match readiness`}>
          {readiness.percentage}%
        </strong>
      </div>

      <div
        className="dashboard-readiness__meter"
        role="progressbar"
        aria-label="Match readiness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readiness.percentage}
      >
        <span style={{ width: `${readiness.percentage}%` }} />
      </div>

      <p className="dashboard-readiness__count">
        {readiness.completedCount} of {readiness.items.length} profile checks complete
      </p>
      <ul className="dashboard-readiness__list">
        {readiness.items.map((item) => (
          <li className={item.complete ? "is-complete" : ""} key={item.id}>
            <a href={item.href} aria-label={`${item.label}. ${item.complete ? "Complete" : "Needs attention"}`}>
              <span className="dashboard-readiness__status" aria-hidden="true">
                {item.complete ? <Check size={13} /> : "•"}
              </span>
              <span>{item.label}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

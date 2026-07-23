import { Check, Circle, ExternalLink } from "lucide-react";
import type { ProfileReadinessValue } from "../types";

type ProfileReadinessProps = {
  readiness: ProfileReadinessValue;
};

const profileFieldTargets = {
  description: "company-description",
  certifications: "company-certifications-input",
  keywords: "matching-product-keywords-input",
  countries: "matching-target-countries-input",
} as const;

export function ProfileReadiness({ readiness }: ProfileReadinessProps) {
  const focusProfileField = (itemId: ProfileReadinessValue["items"][number]["id"]) => {
    if (itemId === "products") return;
    document.getElementById(profileFieldTargets[itemId])?.focus();
  };

  return (
    <aside className="profile-readiness" aria-labelledby="profile-readiness-title">
      <header>
        <span className="eyebrow">Legacy formula</span>
        <h2 id="profile-readiness-title">Profile readiness</h2>
        <p>Five equally weighted checks, matching the production dashboard.</p>
      </header>
      <div className="profile-readiness__score">
        <strong>{readiness.percentage}%</strong>
        <span>{readiness.completedCount} of {readiness.items.length} complete</span>
      </div>
      <div
        className="profile-readiness__meter"
        role="progressbar"
        aria-label="Profile readiness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readiness.percentage}
      >
        <span style={{ width: `${readiness.percentage}%` }} />
      </div>
      <ul>
        {readiness.items.map((item) => (
          <li className={item.complete ? "is-complete" : ""} key={item.id}>
            <a
              href={item.href}
              onClick={(event) => {
                if (item.id === "products") return;
                event.preventDefault();
                focusProfileField(item.id);
              }}
            >
              <span className="profile-readiness__status" aria-hidden="true">
                {item.complete ? <Check size={13} /> : <Circle size={9} />}
              </span>
              <span>{item.label}</span>
              {item.id === "products" ? <ExternalLink size={13} aria-hidden="true" /> : null}
            </a>
          </li>
        ))}
      </ul>
      <p className="profile-readiness__note">
        The database’s legacy <code>profile_complete_score</code> column is not maintained by the production save or refresh flow, so this page preserves the active five-check portal rule.
      </p>
    </aside>
  );
}

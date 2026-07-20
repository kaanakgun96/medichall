import { FileSearch, Gauge, ShieldCheck } from "lucide-react";
import type { Opportunity } from "../types";
import { documentMatchPresentation, formatScore } from "../utils/format-opportunity";

type MatchBreakdownProps = {
  opportunity: Opportunity;
};

function componentScore(label: string, score: number | null) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatScore(score)}</dd>
    </div>
  );
}

export function MatchBreakdown({ opportunity }: MatchBreakdownProps) {
  const documentMatch = documentMatchPresentation(opportunity);
  const confidence = opportunity.confidenceLevel
    ? `${opportunity.confidenceLevel[0].toUpperCase()}${opportunity.confidenceLevel.slice(1)}`
    : "Not returned";

  return (
    <section className="match-breakdown" aria-labelledby={`match-breakdown-${opportunity.id}`}>
      <h3 id={`match-breakdown-${opportunity.id}`}>Match breakdown</h3>
      <dl className="match-breakdown__primary">
        <div>
          <dt><Gauge size={15} aria-hidden="true" /> Profile match</dt>
          <dd>{formatScore(opportunity.profileMatchScore)}</dd>
          <small>Structured company and opportunity data</small>
        </div>
        <div className={`document-match document-match--${documentMatch.state}`}>
          <dt><FileSearch size={15} aria-hidden="true" /> Document match</dt>
          <dd>{documentMatch.label}</dd>
          <small>{documentMatch.detail}</small>
        </div>
        <div>
          <dt><ShieldCheck size={15} aria-hidden="true" /> Confidence</dt>
          <dd>{confidence}{opportunity.confidenceScore !== null ? ` · ${formatScore(opportunity.confidenceScore)}` : ""}</dd>
          <small>{opportunity.scoreBasis?.replaceAll("_", " ") || "Basis not returned"}</small>
        </div>
      </dl>
      <dl className="match-breakdown__components" aria-label="Profile score components">
        {componentScore("Product", opportunity.keywordScore)}
        {componentScore("Country", opportunity.geographyScore)}
        {componentScore("CPV / category", opportunity.categoryScore)}
        {componentScore("Certificates", opportunity.certificationScore)}
      </dl>
    </section>
  );
}

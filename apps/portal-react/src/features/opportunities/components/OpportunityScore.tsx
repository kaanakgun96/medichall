import { formatScore } from "../utils/format-opportunity";

type OpportunityScoreProps = {
  opportunityScore: number | null;
  matchScore: number;
};

export function OpportunityScore({ opportunityScore, matchScore }: OpportunityScoreProps) {
  const scoreClass = opportunityScore === null
    ? "pending"
    : opportunityScore >= 75 ? "high" : opportunityScore >= 55 ? "medium" : "low";

  return (
    <section className={`opportunity-score opportunity-score--${scoreClass}`} aria-label="Opportunity score">
      <span>Opportunity score</span>
      <strong>{opportunityScore === null ? "—" : formatScore(opportunityScore)}</strong>
      <small>
        {opportunityScore === null
          ? `Not calculated · legacy match ${formatScore(matchScore)}`
          : "Backend-calculated score"}
      </small>
    </section>
  );
}

import { CheckCircle2 } from "lucide-react";

type MatchedReasonsProps = {
  reasons: string[];
};

export function MatchedReasons({ reasons }: MatchedReasonsProps) {
  if (!reasons.length) return null;
  return (
    <section className="opportunity-list-block opportunity-list-block--positive">
      <h3>Matched reasons</h3>
      <ul>
        {reasons.map((reason, index) => (
          <li key={`${reason}-${index}`}><CheckCircle2 size={14} aria-hidden="true" /> {reason}</li>
        ))}
      </ul>
    </section>
  );
}

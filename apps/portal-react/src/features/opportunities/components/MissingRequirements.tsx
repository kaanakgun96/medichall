import { CircleHelp } from "lucide-react";

type MissingRequirementsProps = {
  requirements: string[];
};

export function MissingRequirements({ requirements }: MissingRequirementsProps) {
  if (!requirements.length) return null;
  return (
    <section className="opportunity-list-block opportunity-list-block--missing">
      <h3>Missing requirements</h3>
      <ul>
        {requirements.map((requirement, index) => (
          <li key={`${requirement}-${index}`}><CircleHelp size={14} aria-hidden="true" /> {requirement}</li>
        ))}
      </ul>
    </section>
  );
}

import type { ReactNode } from "react";
import { AlertCircle, Inbox, Settings2 } from "lucide-react";

type StatePanelProps = {
  title: string;
  description: string;
  kind?: "empty" | "error" | "configuration";
  action?: ReactNode;
};

export function StatePanel({
  title,
  description,
  kind = "empty",
  action,
}: StatePanelProps) {
  const Icon = kind === "error" ? AlertCircle : kind === "configuration" ? Settings2 : Inbox;

  return (
    <section className={`state-panel state-panel--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="state-panel__icon" aria-hidden="true">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="state-panel__action">{action}</div> : null}
    </section>
  );
}

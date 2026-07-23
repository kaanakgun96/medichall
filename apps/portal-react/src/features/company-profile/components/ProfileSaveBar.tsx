import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { Button } from "../../../shared/components/Button";
import type { SaveFeedback } from "../types";

type ProfileSaveBarProps = {
  dirty: boolean;
  feedback: SaveFeedback;
  buttonLabel: string;
};

export function ProfileSaveBar({
  dirty,
  feedback,
  buttonLabel,
}: ProfileSaveBarProps) {
  const saving = feedback.status === "saving";
  const message = feedback.message
    ?? (dirty ? "Unsaved changes" : "No unsaved changes");

  return (
    <footer className="profile-save-bar">
      <div
        className={`profile-save-bar__status profile-save-bar__status--${feedback.status}`}
        role={feedback.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {feedback.status === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
        <span>{message}</span>
      </div>
      <Button tone="primary" type="submit" disabled={!dirty || saving}>
        {saving
          ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
          : <Save size={16} aria-hidden="true" />}
        {saving ? "Saving…" : buttonLabel}
      </Button>
    </footer>
  );
}

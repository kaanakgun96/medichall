import type { FormEvent } from "react";
import type {
  MatchingProfileErrors,
  MatchingProfileField,
  MatchingProfileFormValue,
  MatchingProfileRecord,
  SaveFeedback,
} from "../types";
import { formatProfileTimestamp } from "../utils/profile-readiness";
import { MatchingCpvSelector } from "./MatchingCpvSelector";
import { ProfileSaveBar } from "./ProfileSaveBar";

type MatchingProfileFormProps = {
  value: MatchingProfileFormValue;
  profile: MatchingProfileRecord | null;
  errors: MatchingProfileErrors;
  dirty: boolean;
  feedback: SaveFeedback;
  onChange: (field: MatchingProfileField, value: string | boolean) => void;
  onSubmit: () => void;
};

export function MatchingProfileForm({
  value,
  profile,
  errors,
  dirty,
  feedback,
  onChange,
  onSubmit,
}: MatchingProfileFormProps) {
  const saving = feedback.status === "saving";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="profile-section-card" id="matching-profile" onSubmit={submit} aria-busy={saving}>
      <header className="profile-section-card__header profile-section-card__header--split">
        <div>
          <span className="eyebrow">Opportunity engine</span>
          <h2>Matching profile</h2>
          <p>Tell MedicHall what you sell and where you want to sell it.</p>
        </div>
        <dl className="profile-timestamps">
          <div>
            <dt>Last updated</dt>
            <dd>{formatProfileTimestamp(profile?.updatedAt ?? null)}</dd>
          </div>
          <div>
            <dt>Matches indexed</dt>
            <dd>{formatProfileTimestamp(profile?.lastIndexedAt ?? null)}</dd>
          </div>
        </dl>
      </header>

      <fieldset disabled={saving}>
        <legend className="sr-only">Matching profile preferences</legend>
        <div className="profile-field-grid">
          <div className="profile-field" id="matching-target-countries">
            <label htmlFor="matching-target-countries-input">Target countries</label>
            <p>Comma separated, exactly as stored by the current Partner Portal.</p>
            <input
              id="matching-target-countries-input"
              value={value.targetCountries}
              placeholder="e.g. Italy, France, Germany, Spain"
              onChange={(event) => onChange("targetCountries", event.target.value)}
            />
          </div>

          <div className="profile-field">
            <label htmlFor="matching-certifications">Matching certifications</label>
            <p>Comma-separated certificates used by the existing match engine.</p>
            <input
              id="matching-certifications"
              value={value.certifications}
              placeholder="e.g. CE MDR, ISO 13485"
              onChange={(event) => onChange("certifications", event.target.value)}
            />
          </div>

          <div className="profile-field profile-field--wide" id="matching-product-keywords">
            <label htmlFor="matching-product-keywords-input">
              Product keywords <span aria-hidden="true">*</span>
            </label>
            <p id="matching-product-keywords-description">
              Add at least one comma-separated product keyword. This is the only required matching field in the legacy save flow.
            </p>
            <input
              id="matching-product-keywords-input"
              value={value.productKeywords}
              placeholder="e.g. sterile ultrasound probe cover, camera cover, surgical drape"
              required
              aria-invalid={Boolean(errors.productKeywords) || undefined}
              aria-describedby={[
                "matching-product-keywords-description",
                errors.productKeywords ? "matching-product-keywords-error" : "",
              ].filter(Boolean).join(" ")}
              onChange={(event) => onChange("productKeywords", event.target.value)}
            />
            {errors.productKeywords ? (
              <span className="profile-field__error" id="matching-product-keywords-error">
                {errors.productKeywords}
              </span>
            ) : null}
          </div>

          <div className="profile-field profile-field--wide">
            <label htmlFor="matching-cpv-codes">CPV codes</label>
            <p id="matching-cpv-description">
              Optional comma-separated codes. Catalog selections keep the legacy digits-only, eight-character, sorted representation.
            </p>
            <MatchingCpvSelector
              value={value.cpvCodes}
              disabled={saving}
              onChange={(next) => onChange("cpvCodes", next)}
            />
          </div>

          <div className="profile-field">
            <label htmlFor="matching-minimum-score">Minimum match score</label>
            <p id="matching-minimum-score-description">
              Values are clamped to 0–100 on save, preserving the legacy rule.
            </p>
            <input
              id="matching-minimum-score"
              type="number"
              min="0"
              max="100"
              value={value.minimumMatchScore}
              aria-invalid={Boolean(errors.minimumMatchScore) || undefined}
              aria-describedby={[
                "matching-minimum-score-description",
                errors.minimumMatchScore ? "matching-minimum-score-error" : "",
              ].filter(Boolean).join(" ")}
              onChange={(event) => onChange("minimumMatchScore", event.target.value)}
            />
            {errors.minimumMatchScore ? (
              <span className="profile-field__error" id="matching-minimum-score-error">
                {errors.minimumMatchScore}
              </span>
            ) : null}
          </div>

          <fieldset className="profile-preferences">
            <legend>Manufacturing preferences</legend>
            <label>
              <input
                type="checkbox"
                checked={value.oemAvailable}
                onChange={(event) => onChange("oemAvailable", event.target.checked)}
              />
              <span>OEM available</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={value.privateLabelAvailable}
                onChange={(event) => onChange("privateLabelAvailable", event.target.checked)}
              />
              <span>Private label available</span>
            </label>
          </fieldset>
        </div>
      </fieldset>

      <ProfileSaveBar
        dirty={dirty}
        feedback={feedback}
        buttonLabel="Save matching profile"
      />
    </form>
  );
}

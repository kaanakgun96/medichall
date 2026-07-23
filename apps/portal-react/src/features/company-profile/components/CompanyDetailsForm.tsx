import type { FormEvent } from "react";
import type {
  CompanyDetailsErrors,
  CompanyDetailsField,
  CompanyDetailsFormValue,
  SaveFeedback,
} from "../types";
import { ProfileSaveBar } from "./ProfileSaveBar";

type CompanyDetailsFormProps = {
  value: CompanyDetailsFormValue;
  errors: CompanyDetailsErrors;
  dirty: boolean;
  feedback: SaveFeedback;
  onChange: (field: CompanyDetailsField, value: string) => void;
  onSubmit: () => void;
};

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  error?: string;
  description?: string;
  required?: boolean;
  inputMode?: "email" | "tel" | "url";
  onChange: (value: string) => void;
};

function TextField({
  id,
  label,
  value,
  placeholder,
  error,
  description,
  required,
  inputMode,
  onChange,
}: TextFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="profile-field">
      <label htmlFor={id}>
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {description ? <p id={descriptionId}>{description}</p> : null}
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        required={required}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <span className="profile-field__error" id={errorId}>{error}</span> : null}
    </div>
  );
}

export function CompanyDetailsForm({
  value,
  errors,
  dirty,
  feedback,
  onChange,
  onSubmit,
}: CompanyDetailsFormProps) {
  const saving = feedback.status === "saving";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="profile-section-card" id="company-details" onSubmit={submit} aria-busy={saving}>
      <header className="profile-section-card__header">
        <div>
          <span className="eyebrow">Company record</span>
          <h2>Company details</h2>
          <p>These fields map directly to the existing owner-managed <code>companies</code> row.</p>
        </div>
      </header>

      <fieldset disabled={saving}>
        <legend className="sr-only">Company details</legend>
        <div className="profile-field-grid">
          <TextField
            id="company-name"
            label="Company name"
            value={value.name}
            placeholder="Your company's registered name"
            error={errors.name}
            required
            onChange={(next) => onChange("name", next)}
          />
          <TextField
            id="company-type"
            label="Company type"
            value={value.type}
            placeholder="e.g. Medical device manufacturer"
            description="The legacy portal stores this as free text; there is no separate manufacturer/distributor flag."
            onChange={(next) => onChange("type", next)}
          />
          <TextField
            id="company-country"
            label="Country"
            value={value.country}
            placeholder="e.g. Türkiye"
            onChange={(next) => onChange("country", next)}
          />
          <TextField
            id="company-city"
            label="City"
            value={value.city}
            placeholder="e.g. İzmir"
            onChange={(next) => onChange("city", next)}
          />
          <TextField
            id="company-website"
            label="Website"
            value={value.website}
            placeholder="https://…"
            inputMode="url"
            onChange={(next) => onChange("website", next)}
          />
          <TextField
            id="company-contact-email"
            label="Contact email"
            value={value.contactEmail}
            placeholder="sales@yourcompany.com"
            inputMode="email"
            description="Shown to buyers by the existing marketplace flow."
            onChange={(next) => onChange("contactEmail", next)}
          />
          <TextField
            id="company-phone"
            label="Phone"
            value={value.phone}
            placeholder="+90 …"
            inputMode="tel"
            onChange={(next) => onChange("phone", next)}
          />
          <TextField
            id="company-video-url"
            label="Company video"
            value={value.videoUrl}
            placeholder="https://youtube.com/watch?v=…"
            inputMode="url"
            onChange={(next) => onChange("videoUrl", next)}
          />
          <div className="profile-field profile-field--wide" id="company-certifications">
            <label htmlFor="company-certifications-input">Certifications</label>
            <p>Keep the legacy comma-separated text used by public badges and match readiness.</p>
            <input
              id="company-certifications-input"
              value={value.certifications}
              placeholder="e.g. CE MDR, ISO 13485"
              onChange={(event) => onChange("certifications", event.target.value)}
            />
          </div>
          <div className="profile-field profile-field--wide">
            <label htmlFor="company-description">Company description</label>
            <p>Describe what you manufacture, capacity, and export experience.</p>
            <textarea
              id="company-description"
              rows={5}
              value={value.description}
              onChange={(event) => onChange("description", event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <ProfileSaveBar
        dirty={dirty}
        feedback={feedback}
        buttonLabel="Save company details"
      />
    </form>
  );
}

import type {
  CompanyDetailsFormValue,
  CompanyDetailsUpdate,
  CompanyProfileRecord,
  MatchingProfileFormValue,
  MatchingProfileRecord,
  MatchingProfileUpdate,
} from "../types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringValue(value: unknown): string {
  return nullableString(value) ?? "";
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function legacyCsvToArray(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function matchingCpvSelection(value: string): string[] {
  return [...new Set(
    value
      .split(",")
      .map((item) => item.replace(/[^0-9]/g, "").slice(0, 8))
      .filter(Boolean),
  )].sort();
}

export function toggleMatchingCpvCode(value: string, code: string): string {
  const selected = new Set(matchingCpvSelection(value));
  if (selected.has(code)) selected.delete(code);
  else selected.add(code);
  return [...selected].sort().join(", ");
}

export function mapCompanyProfileRow(value: unknown): CompanyProfileRecord | null {
  const row = record(value);
  const id = finiteNumber(row.id, Number.NaN);
  if (!Number.isFinite(id)) return null;

  return {
    id,
    name: stringValue(row.name),
    type: nullableString(row.type),
    description: nullableString(row.description),
    website: nullableString(row.website),
    country: nullableString(row.country),
    city: nullableString(row.city),
    contactEmail: nullableString(row.contact_email),
    phone: nullableString(row.phone),
    certifications: nullableString(row.certifications),
    videoUrl: nullableString(row.video_url),
    isApproved: booleanValue(row.is_approved),
    isVerified: booleanValue(row.is_verified),
    slug: nullableString(row.slug),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
  };
}

export function mapMatchingProfileRow(value: unknown): MatchingProfileRecord | null {
  const row = record(value);
  const companyId = finiteNumber(row.company_id, Number.NaN);
  if (!Number.isFinite(companyId)) return null;

  return {
    companyId,
    targetCountries: stringArray(row.target_countries),
    productKeywords: stringArray(row.product_keywords),
    certifications: stringArray(row.certifications),
    cpvCodes: stringArray(row.cpv_codes),
    minimumMatchScore: Math.min(100, Math.max(0, finiteNumber(row.min_match_score, 60))),
    oemAvailable: booleanValue(row.oem_available),
    privateLabelAvailable: booleanValue(row.private_label_available),
    profileCompleteScore: row.profile_complete_score == null
      ? null
      : Math.min(100, Math.max(0, finiteNumber(row.profile_complete_score, 0))),
    lastIndexedAt: nullableString(row.last_indexed_at),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
  };
}

export function companyRecordToForm(
  company: CompanyProfileRecord,
): CompanyDetailsFormValue {
  return {
    name: company.name,
    type: company.type ?? "",
    description: company.description ?? "",
    website: company.website ?? "",
    country: company.country ?? "",
    city: company.city ?? "",
    contactEmail: company.contactEmail ?? "",
    phone: company.phone ?? "",
    certifications: company.certifications ?? "",
    videoUrl: company.videoUrl ?? "",
  };
}

export function matchingRecordToForm(
  profile: MatchingProfileRecord | null,
  company: CompanyProfileRecord,
): MatchingProfileFormValue {
  return {
    targetCountries: profile?.targetCountries.join(", ") ?? "",
    productKeywords: profile?.productKeywords.join(", ") ?? "",
    certifications: profile
      ? profile.certifications.join(", ")
      : company.certifications ?? "",
    cpvCodes: profile?.cpvCodes.join(", ") ?? "",
    minimumMatchScore: String(profile?.minimumMatchScore ?? 60),
    oemAvailable: profile?.oemAvailable ?? false,
    privateLabelAvailable: profile?.privateLabelAvailable ?? false,
  };
}

function trimmedOrNull(value: string): string | null {
  return value.trim() || null;
}

export function companyFormToUpdate(
  form: CompanyDetailsFormValue,
): CompanyDetailsUpdate {
  return {
    name: form.name.trim(),
    type: trimmedOrNull(form.type),
    description: trimmedOrNull(form.description),
    website: trimmedOrNull(form.website),
    country: trimmedOrNull(form.country),
    city: trimmedOrNull(form.city),
    contact_email: trimmedOrNull(form.contactEmail),
    phone: trimmedOrNull(form.phone),
    certifications: trimmedOrNull(form.certifications),
    video_url: trimmedOrNull(form.videoUrl),
  };
}

function legacyMinimumScore(value: string): number {
  if (!value.trim()) return 60;
  const parsed = Number.parseInt(value, 10);
  return Math.min(100, Math.max(0, Number.isFinite(parsed) ? parsed : 60));
}

export function matchingFormToUpdate(
  companyId: number,
  form: MatchingProfileFormValue,
  updatedAt: string,
): MatchingProfileUpdate {
  return {
    company_id: companyId,
    target_countries: legacyCsvToArray(form.targetCountries),
    product_keywords: legacyCsvToArray(form.productKeywords),
    certifications: legacyCsvToArray(form.certifications),
    cpv_codes: legacyCsvToArray(form.cpvCodes),
    min_match_score: legacyMinimumScore(form.minimumMatchScore),
    oem_available: form.oemAvailable,
    private_label_available: form.privateLabelAvailable,
    updated_at: updatedAt,
  };
}

export function sameCompanyForm(
  left: CompanyDetailsFormValue,
  right: CompanyDetailsFormValue,
): boolean {
  return JSON.stringify(companyFormToUpdate(left)) === JSON.stringify(companyFormToUpdate(right));
}

export function sameMatchingForm(
  left: MatchingProfileFormValue,
  right: MatchingProfileFormValue,
): boolean {
  const comparable = (form: MatchingProfileFormValue) => {
    const payload = matchingFormToUpdate(0, form, "");
    return {
      company_id: payload.company_id,
      target_countries: payload.target_countries,
      product_keywords: payload.product_keywords,
      certifications: payload.certifications,
      cpv_codes: payload.cpv_codes,
      min_match_score: payload.min_match_score,
      oem_available: payload.oem_available,
      private_label_available: payload.private_label_available,
    };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

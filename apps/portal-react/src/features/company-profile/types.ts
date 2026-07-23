export type CompanyProfileRecord = {
  id: number;
  name: string;
  type: string | null;
  description: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  contactEmail: string | null;
  phone: string | null;
  certifications: string | null;
  videoUrl: string | null;
  isApproved: boolean;
  isVerified: boolean;
  slug: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type MatchingProfileRecord = {
  companyId: number;
  targetCountries: string[];
  productKeywords: string[];
  certifications: string[];
  cpvCodes: string[];
  minimumMatchScore: number;
  oemAvailable: boolean;
  privateLabelAvailable: boolean;
  profileCompleteScore: number | null;
  lastIndexedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CompanyProfileData = {
  company: CompanyProfileRecord;
  matchingProfile: MatchingProfileRecord | null;
  productCount: number;
};

export type CompanyDetailsFormValue = {
  name: string;
  type: string;
  description: string;
  website: string;
  country: string;
  city: string;
  contactEmail: string;
  phone: string;
  certifications: string;
  videoUrl: string;
};

export type MatchingProfileFormValue = {
  targetCountries: string;
  productKeywords: string;
  certifications: string;
  cpvCodes: string;
  minimumMatchScore: string;
  oemAvailable: boolean;
  privateLabelAvailable: boolean;
};

export type CompanyDetailsUpdate = {
  name: string;
  type: string | null;
  description: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  contact_email: string | null;
  phone: string | null;
  certifications: string | null;
  video_url: string | null;
};

export type MatchingProfileUpdate = {
  company_id: number;
  target_countries: string[];
  product_keywords: string[];
  certifications: string[];
  cpv_codes: string[];
  min_match_score: number;
  oem_available: boolean;
  private_label_available: boolean;
  updated_at: string;
};

export type CompanyDetailsField = keyof CompanyDetailsFormValue;
export type MatchingProfileField = keyof MatchingProfileFormValue;

export type CompanyDetailsErrors = Partial<Record<CompanyDetailsField, string>>;
export type MatchingProfileErrors = Partial<Record<MatchingProfileField, string>>;

export type ProfileError = {
  kind: "configuration" | "migration" | "request";
  message: string;
};

export type SaveFeedback = {
  status: "idle" | "saving" | "success" | "error";
  message: string | null;
};

export type ProfileReadinessItem = {
  id: "description" | "certifications" | "products" | "keywords" | "countries";
  label: string;
  complete: boolean;
  href: string;
};

export type ProfileReadinessValue = {
  percentage: number;
  completedCount: number;
  items: ProfileReadinessItem[];
};

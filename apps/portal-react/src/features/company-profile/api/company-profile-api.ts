import { supabaseRequest } from "../../../shared/api/supabase-http";
import type {
  CompanyDetailsUpdate,
  CompanyProfileData,
  CompanyProfileRecord,
  MatchingProfileRecord,
  MatchingProfileUpdate,
} from "../types";
import {
  mapCompanyProfileRow,
  mapMatchingProfileRow,
} from "../utils/map-company-profile";

type AuthUser = {
  id: string;
};

export async function fetchProfileUser(signal?: AbortSignal): Promise<AuthUser> {
  return supabaseRequest<AuthUser>("/auth/v1/user", { signal });
}

export async function fetchOwnedCompanyProfile(
  _userId: string,
  signal?: AbortSignal,
): Promise<CompanyProfileRecord | null> {
  const rows = await supabaseRequest<unknown[]>(
    "/rest/v1/rpc/get_my_company_private_v1",
    { method: "POST", body: "{}", signal },
  );
  return mapCompanyProfileRow(rows[0]);
}

async function fetchMatchingProfile(
  companyId: number,
  signal?: AbortSignal,
): Promise<MatchingProfileRecord | null> {
  const parameters = new URLSearchParams({
    select: "*",
    company_id: `eq.${companyId}`,
    limit: "1",
  });
  const rows = await supabaseRequest<unknown[]>(
    `/rest/v1/company_match_profiles?${parameters}`,
    { signal },
  );
  return mapMatchingProfileRow(rows[0]);
}

async function fetchProductCount(
  companyId: number,
  signal?: AbortSignal,
): Promise<number> {
  const parameters = new URLSearchParams({
    select: "id",
    company_id: `eq.${companyId}`,
  });
  const rows = await supabaseRequest<unknown[]>(
    `/rest/v1/products?${parameters}`,
    { signal },
  );
  return rows.length;
}

export async function fetchCompanyProfileData(
  company: CompanyProfileRecord,
  signal?: AbortSignal,
): Promise<CompanyProfileData> {
  const [matchingProfile, productCount] = await Promise.all([
    fetchMatchingProfile(company.id, signal),
    fetchProductCount(company.id, signal),
  ]);
  return { company, matchingProfile, productCount };
}

async function fetchCompanyById(
  companyId: number,
): Promise<CompanyProfileRecord> {
  const rows = await supabaseRequest<unknown[]>(
    "/rest/v1/rpc/get_my_company_private_v1",
    { method: "POST", body: "{}" },
  );
  const company = mapCompanyProfileRow(
    rows.find((row) => Number((row as Record<string, unknown>)?.id) === companyId),
  );
  if (!company) throw new Error("The saved company profile could not be reloaded.");
  return company;
}

export async function updateCompanyProfile(
  companyId: number,
  update: CompanyDetailsUpdate,
): Promise<CompanyProfileRecord> {
  await supabaseRequest<void>(`/rest/v1/companies?id=eq.${companyId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(update),
  });
  return fetchCompanyById(companyId);
}

export async function upsertMatchingProfile(
  update: MatchingProfileUpdate,
): Promise<MatchingProfileRecord> {
  const rows = await supabaseRequest<unknown[]>(
    "/rest/v1/company_match_profiles?on_conflict=company_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(update),
    },
  );
  const profile = mapMatchingProfileRow(rows[0]);
  if (profile) return profile;

  const reloaded = await fetchMatchingProfile(update.company_id);
  if (!reloaded) throw new Error("The saved matching profile could not be reloaded.");
  return reloaded;
}

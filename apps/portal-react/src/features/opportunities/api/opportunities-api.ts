import { postRpc, supabaseRequest } from "../../../shared/api/supabase-http";
import type {
  Opportunity,
  OpportunityFiltersValue,
  OpportunityStatus,
  PartnerCompany,
} from "../types";
import { mapOpportunityRow } from "../utils/map-opportunity";

export const OPPORTUNITY_PAGE_SIZE = 20;

const OPPORTUNITY_SELECT = [
  "id",
  "company_id",
  "opportunity_type",
  "status",
  "match_score",
  "opportunity_score",
  "profile_match_score",
  "document_match_score",
  "confidence_score",
  "confidence_level",
  "keyword_score",
  "geography_score",
  "certification_score",
  "category_score",
  "score_basis",
  "reasons",
  "risks",
  "missing_information",
  "evidence",
  "next_best_action",
  "generated_at",
  "tenders(id,title,title_en,buyer_name,country_code,country_name,cpv_codes,publication_date,deadline_at,estimated_value,estimated_value_eur,currency,eur_rate_as_of,notice_type,source,source_notice_id,source_url,document_analysis_status,document_confidence_score,data_completeness_score,analyzed_document_count,missing_information)",
  "distributor_candidates(id,name,website,country_code,country_name,company_type,product_categories,product_keywords,certifications,channels,source,source_url,verification_status)",
].join(",");

type AuthUser = {
  id: string;
};

type CompanyRow = {
  id: number;
  name: string | null;
  description: string | null;
  certifications: string | null;
};

export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser> {
  return supabaseRequest<AuthUser>("/auth/v1/user", { signal });
}

export async function fetchOwnedCompany(
  userId: string,
  signal?: AbortSignal,
): Promise<PartnerCompany | null> {
  const parameters = new URLSearchParams({
    select: "id,name,description,certifications",
    owner_id: `eq.${userId}`,
    limit: "1",
  });
  const rows = await supabaseRequest<CompanyRow[]>(`/rest/v1/companies?${parameters}`, { signal });
  const company = rows[0];
  return company
    ? {
        id: Number(company.id),
        name: company.name,
        description: company.description,
        certifications: company.certifications,
      }
    : null;
}

export type OpportunityPage = {
  opportunities: Opportunity[];
  hasMore: boolean;
};

export async function fetchOpportunityPage(
  companyId: number,
  filters: Pick<OpportunityFiltersValue, "kind" | "minimumScore">,
  offset: number,
  signal?: AbortSignal,
): Promise<OpportunityPage> {
  const parameters = new URLSearchParams({
    select: OPPORTUNITY_SELECT,
    company_id: `eq.${companyId}`,
    status: "neq.dismissed",
    order: "match_score.desc,generated_at.desc",
    limit: String(OPPORTUNITY_PAGE_SIZE + 1),
    offset: String(Math.max(0, offset)),
  });
  if (filters.kind) parameters.set("opportunity_type", `eq.${filters.kind}`);
  if (filters.minimumScore > 0) {
    parameters.set("match_score", `gte.${filters.minimumScore}`);
  }

  const rows = await supabaseRequest<unknown[]>(
    `/rest/v1/opportunity_matches?${parameters}`,
    { signal },
  );
  return {
    opportunities: rows.slice(0, OPPORTUNITY_PAGE_SIZE).map(mapOpportunityRow),
    hasMore: rows.length > OPPORTUNITY_PAGE_SIZE,
  };
}

export function refreshCompanyOpportunityMatches(companyId: number): Promise<unknown> {
  return postRpc("refresh_company_opportunity_matches", { p_company_id: companyId });
}

export function setOpportunityMatchStatus(
  opportunityId: number,
  status: OpportunityStatus,
): Promise<unknown> {
  return postRpc("set_opportunity_match_status", {
    p_match_id: opportunityId,
    p_status: status,
  });
}

import { supabaseRequest } from "../../../shared/api/supabase-http";
import { mapOpportunityRow } from "../../opportunities/utils/map-opportunity";
import type { DashboardData, DashboardMatchProfile } from "../types";

const DASHBOARD_OPPORTUNITY_SELECT = [
  "id",
  "company_id",
  "opportunity_type",
  "status",
  "match_score",
  "generated_at",
  "tenders(id,title,title_en,buyer_name,country_code,country_name,deadline_at,estimated_value,currency,source,source_notice_id,source_url)",
  "distributor_candidates(id,name,website,country_code,country_name,company_type,source,source_url,verification_status)",
].join(",");

type MatchProfileRow = {
  target_countries?: unknown;
  product_keywords?: unknown;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function mapDashboardMatchProfile(
  row: MatchProfileRow | null | undefined,
): DashboardMatchProfile | null {
  if (!row) return null;
  return {
    targetCountries: stringArray(row.target_countries),
    productKeywords: stringArray(row.product_keywords),
  };
}

export async function fetchDashboardData(
  companyId: number,
  signal?: AbortSignal,
): Promise<DashboardData> {
  const opportunityParameters = new URLSearchParams({
    select: DASHBOARD_OPPORTUNITY_SELECT,
    company_id: `eq.${companyId}`,
    status: "neq.dismissed",
    order: "match_score.desc,generated_at.desc",
    limit: "50",
  });
  const companyFilter = `company_id=eq.${encodeURIComponent(String(companyId))}`;

  const [opportunityRows, rfqRows, productRows, matchProfileRows] = await Promise.all([
    supabaseRequest<unknown[]>(
      `/rest/v1/opportunity_matches?${opportunityParameters}`,
      { signal },
    ),
    supabaseRequest<unknown[]>(
      `/rest/v1/rfq_requests?select=*&${companyFilter}&order=created_at.desc`,
      { signal },
    ),
    supabaseRequest<unknown[]>(
      `/rest/v1/products?select=*&${companyFilter}&order=ref`,
      { signal },
    ),
    supabaseRequest<MatchProfileRow[]>(
      `/rest/v1/company_match_profiles?select=*&${companyFilter}`,
      { signal },
    ),
  ]);

  return {
    opportunities: opportunityRows.map(mapOpportunityRow),
    rfqCount: rfqRows.length,
    productCount: productRows.length,
    matchProfile: mapDashboardMatchProfile(matchProfileRows[0]),
  };
}

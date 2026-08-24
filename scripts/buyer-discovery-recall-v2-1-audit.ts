import {
  boundedTedSearchPlan,
  deduplicateCandidates,
  DISCOVERY_LIMITS,
  partitionTedCandidates,
  type ProspectCandidate,
  rankProspects,
  type TedSearchPlanEntry,
} from "../supabase/functions/_shared/external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  type ProductFamilyProfile,
} from "../supabase/functions/_shared/buyer-discovery-relevance-v2.ts";
import { extractTedCandidatesFromNotice } from "../supabase/functions/external-prospect-discovery/index.ts";

const TED_ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";
const fields = [
  "publication-number",
  "publication-date",
  "notice-title",
  "description-lot",
  "buyer-name",
  "classification-cpv",
  "winner-name",
  "winner-country",
  "winner-identifier",
  "winner-internet-address",
  "winner-touchpoint-internet-address",
  "winner-selection-status",
  "organisation-name-tenderer",
  "organisation-country-tenderer",
  "organisation-identifier-tenderer",
  "organisation-internet-address-tenderer",
  "touchpoint-internet-address-tenderer",
  "contract-conclusion-date",
  "links",
];

type AuditProfile = {
  name: string;
  taxonomyId: number;
  cpvCodes: string[];
  productFamily: ProductFamilyProfile;
};

const profiles: AuditProfile[] = [{
  name: "Sterile Surgical Gown",
  taxonomyId: 1,
  cpvCodes: ["33140000"],
  productFamily: buildProductFamilyProfile([{
    taxonomyId: 1,
    canonicalName: "Sterile Surgical Gowns",
    slug: "sterile-surgical-gowns",
    aliases: [],
  }]),
}, {
  name: "C-Arm Cover",
  taxonomyId: 2,
  cpvCodes: ["33140000"],
  productFamily: buildProductFamilyProfile([{
    taxonomyId: 2,
    canonicalName: "C-Arm Covers",
    slug: "c-arm-covers",
    aliases: [
      "C-Arm Cover",
      "C Arm Drape",
      "Sterile C-Arm Equipment Drape",
    ],
  }]),
}];

function values(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.notices)
    ? record.notices
    : Array.isArray(record.results)
    ? record.results
    : [];
}

async function auditQuery(
  profile: AuditProfile,
  search: TedSearchPlanEntry,
) {
  const response = await fetch(TED_ENDPOINT, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "MedicHall-Buyer-Discovery-Recall-Audit/1.0",
    },
    body: JSON.stringify({
      query: `${search.query} AND (form-type = result)`,
      fields,
      page: 1,
      limit: DISCOVERY_LIMITS.maximumTedResultsPerQuery,
      scope: "ALL",
      paginationMode: "PAGE_NUMBER",
      onlyLatestVersions: true,
      checkQuerySyntax: false,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`TED_${response.status}`);
  }
  const notices = values(await response.json()).slice(
    0,
    DISCOVERY_LIMITS.maximumTedResultsPerQuery,
  );
  let productRelevantNotices = 0;
  let suppliers = 0;
  let domains = 0;
  const candidates: ProspectCandidate[] = [];
  const rejectionReasons: Record<string, number> = {};
  const countries: Record<string, number> = {};
  for (const noticeValue of notices) {
    const extracted = extractTedCandidatesFromNotice({
      noticeValue,
      search,
      targetTaxonomyIds: [profile.taxonomyId],
      targetCpvCodes: profile.cpvCodes,
      productFamily: profile.productFamily,
    });
    productRelevantNotices += extracted.productRelevant ? 1 : 0;
    suppliers += extracted.supplierEntitiesExtracted;
    domains += extracted.domainEntities;
    candidates.push(...extracted.candidates);
    for (const candidate of extracted.candidates) {
      const country = candidate.countryCode || "UNKNOWN";
      countries[country] = (countries[country] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(extracted.rejectionReasons)) {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + count;
    }
  }
  return {
    candidates,
    retrieval_kind: search.retrievalKind,
    countries_requested: search.countries,
    unfiltered_country_fallback: search.unfilteredCountryFallback,
    terms: search.terms,
    notices_returned: notices.length,
    product_relevant_notices: productRelevantNotices,
    supplier_entities_extracted: suppliers,
    domain_entities: domains,
    candidates_produced: candidates.length,
    candidates_by_country: countries,
    rejection_reasons: rejectionReasons,
  };
}

const output = [];
for (const profile of profiles) {
  const plan = boundedTedSearchPlan({
    directTerms: profile.productFamily.directTerms,
    adjacentTerms: profile.productFamily.adjacentTerms,
    cpvCodes: profile.cpvCodes,
    targetCountries: [],
  });
  const queries = [];
  const candidates: ProspectCandidate[] = [];
  for (const search of plan) {
    const result = await auditQuery(profile, search);
    candidates.push(...result.candidates);
    const { candidates: _candidates, ...diagnostics } = result;
    queries.push(diagnostics);
  }
  const partitioned = partitionTedCandidates(candidates);
  const deduplicated = deduplicateCandidates([
    ...partitioned.productTermCandidates,
    ...partitioned.cpvCandidates,
  ]);
  const ranking = rankProspects(
    deduplicated.candidates,
    profile.productFamily,
    { europeWide: true, now: new Date() },
  );
  output.push({
    product: profile.name,
    request_count: queries.length,
    notices_returned: queries.reduce(
      (sum, item) => sum + item.notices_returned,
      0,
    ),
    product_relevant_notices: queries.reduce(
      (sum, item) => sum + item.product_relevant_notices,
      0,
    ),
    supplier_entities_extracted: queries.reduce(
      (sum, item) => sum + item.supplier_entities_extracted,
      0,
    ),
    domain_entities: queries.reduce(
      (sum, item) => sum + item.domain_entities,
      0,
    ),
    candidates_produced: queries.reduce(
      (sum, item) => sum + item.candidates_produced,
      0,
    ),
    product_term_candidates_selected: partitioned.productTermCandidates.length,
    cpv_candidates_selected: partitioned.cpvCandidates.length,
    candidates_rejected_by_source_caps: partitioned.rejectedBySourceCaps,
    candidates_collapsed_before_source_caps:
      partitioned.duplicatesCollapsedBeforeCaps,
    candidates_after_deduplication: deduplicated.candidates.length,
    accepted_candidates: ranking.accepted.length,
    rejected_candidates: ranking.rejected.length,
    precision_proxy: deduplicated.candidates.length
      ? Number(
        (ranking.accepted.length / deduplicated.candidates.length).toFixed(4),
      )
      : 0,
    scoring_diagnostics: ranking.diagnostics,
    queries,
  });
}

console.log(
  JSON.stringify({ generated_at: new Date().toISOString(), output }, null, 2),
);

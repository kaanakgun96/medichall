import {
  boundedTedSearchPlan,
  rankProspects,
} from "../_shared/external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
} from "../_shared/buyer-discovery-relevance-v2.ts";
import { extractTedCandidatesFromNotice } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const gown = buildProductFamilyProfile([{
  taxonomyId: 1,
  canonicalName: "Sterile Surgical Gowns",
  slug: "sterile-surgical-gowns",
  aliases: ["Sterile Surgical Gown"],
}]);

const cover = buildProductFamilyProfile([{
  taxonomyId: 2,
  canonicalName: "C-Arm Covers",
  slug: "c-arm-covers",
  aliases: ["C-Arm Cover", "C Arm Drape"],
}]);

function searches(profile: typeof gown) {
  const plan = boundedTedSearchPlan({
    directTerms: profile.directTerms,
    adjacentTerms: profile.adjacentTerms,
    cpvCodes: ["33140000"],
    targetCountries: [],
  });
  return {
    product: plan.find((item) => item.retrievalKind === "PRODUCT_TERMS")!,
    cpv: plan.find((item) => item.retrievalKind === "RELATED_CPV")!,
  };
}

Deno.test("discovery benchmark: structured winners produce direct and adjacent gown candidates", () => {
  const search = searches(gown).product;
  const direct = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "100001-2025",
      "publication-date": "2025-03-01",
      "notice-title": { eng: "Supply of sterile surgical gowns" },
      "description-lot": {
        eng: "Sterile surgical gowns and disposable surgical apparel",
      },
      "classification-cpv": ["33140000"],
      "winner-name": { eng: ["Synthetic Gown Supplier Ltd"] },
      "winner-country": ["IRL"],
      "winner-identifier": ["IE-SYNTHETIC-1"],
      "winner-touchpoint-internet-address": [
        "https://gown-supplier.example/products",
      ],
      "buyer-name": { eng: ["Synthetic Hospital Authority"] },
    },
    search,
    targetTaxonomyIds: [1],
    targetCpvCodes: ["33140000"],
    productFamily: gown,
  });
  const adjacent = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "100002-2025",
      "publication-date": "2025-04-01",
      "notice-title": { eng: "Custom procedure pack award" },
      "description-lot": {
        eng: "Custom procedure packs, surgical drapes and surgical kits",
      },
      "classification-cpv": ["33000000"],
      "winner-name": { eng: ["Synthetic Procedure Pack GmbH"] },
      "winner-country": ["DEU"],
      "winner-selection-status": ["selec-w"],
      "buyer-name": { eng: ["Synthetic Public Buyer"] },
    },
    search,
    targetTaxonomyIds: [1],
    targetCpvCodes: ["33140000"],
    productFamily: gown,
  });
  assert(direct.candidates.length === 1, "direct winner must be discovered");
  assert(
    direct.candidates[0].evidence[0].relevanceClass === "DIRECT" &&
      direct.candidates[0].evidence[0].discoveryReason ===
        "DIRECT_PRODUCT_TERM_TED",
    "product retrieval and direct scoring evidence must be recorded separately",
  );
  assert(
    direct.domainEntities === 1,
    "official winner touchpoint URL must enable website verification",
  );
  assert(
    adjacent.candidates[0].evidence[0].relevanceClass === "ADJACENT",
    "procedure-pack evidence must remain adjacent rather than exact",
  );
  const ranked = rankProspects(
    [...direct.candidates, ...adjacent.candidates],
    gown,
    { europeWide: true, now: new Date("2026-08-24T00:00:00Z") },
  );
  assert(
    ranked.accepted.length === 2,
    "direct and strongly supported procedure-pack patterns must qualify",
  );
});

Deno.test("discovery benchmark: CPV restores recall but never becomes product proof", () => {
  const search = searches(cover).cpv;
  const direct = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "200001-2024",
      "publication-date": "2024-06-01",
      "notice-title": { eng: "Sterile C-arm cover supply" },
      "description-lot": {
        eng: "Sterile C-arm covers and equipment drapes for operating rooms",
      },
      "classification-cpv": ["33140000"],
      "winner-name": { eng: ["Synthetic Sterile Covers SAS"] },
      "winner-country": ["FRA"],
      "buyer-name": { eng: ["Synthetic University Hospital"] },
    },
    search,
    targetTaxonomyIds: [2],
    targetCpvCodes: ["33140000"],
    productFamily: cover,
  });
  const generic = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "200002-2024",
      "publication-date": "2024-07-01",
      "notice-title": { eng: "General imaging systems" },
      "description-lot": {
        eng: "Capital imaging equipment and radiology technology",
      },
      "classification-cpv": ["33140000"],
      "winner-name": { eng: ["Synthetic Imaging Technology BV"] },
      "winner-country": ["NLD"],
      "buyer-name": { eng: ["Synthetic Regional Hospital"] },
    },
    search,
    targetTaxonomyIds: [2],
    targetCpvCodes: ["33140000"],
    productFamily: cover,
  });
  assert(
    direct.candidates[0].evidence[0].discoveryReason === "RELATED_CPV_TED" &&
      direct.candidates[0].evidence[0].relevanceClass === "DIRECT",
    "CPV candidate source must not overwrite direct text classification",
  );
  assert(
    generic.candidates[0].evidence[0].discoveryReason === "RELATED_CPV_TED" &&
      generic.candidates[0].evidence[0].relevanceClass === "GENERIC",
    "CPV-only candidates must enter verification as generic",
  );
  const ranked = rankProspects(
    [...direct.candidates, ...generic.candidates],
    cover,
    { europeWide: true, now: new Date("2026-08-24T00:00:00Z") },
  );
  assert(
    ranked.accepted.length === 1 && ranked.rejected.length === 1,
    "strict V2 compatibility must reject generic imaging after broad retrieval",
  );
});

Deno.test("procurement roles: buyer authorities are excluded and only an unambiguous selected tenderer may fall back", () => {
  const search = searches(cover).product;
  const buyerCollision = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "300001-2025",
      "notice-title": { eng: "C-arm covers" },
      "description-lot": { eng: "Sterile C-arm covers" },
      "classification-cpv": ["33140000"],
      "winner-name": { eng: ["Synthetic Hospital Authority"] },
      "winner-country": ["ESP"],
      "buyer-name": { eng: ["Synthetic Hospital Authority"] },
    },
    search,
    targetTaxonomyIds: [2],
    targetCpvCodes: ["33140000"],
    productFamily: cover,
  });
  const tendererFallback = extractTedCandidatesFromNotice({
    noticeValue: {
      "publication-number": "300002-2025",
      "notice-title": { eng: "Sterile equipment-cover award" },
      "description-lot": { eng: "Sterile medical equipment covers" },
      "classification-cpv": ["33140000"],
      "winner-selection-status": ["selec-w"],
      "organisation-name-tenderer": {
        eng: ["Synthetic Equipment Cover SRL"],
      },
      "organisation-country-tenderer": ["ITA"],
      "organisation-identifier-tenderer": ["IT-SYNTHETIC-2"],
      "organisation-internet-address-tenderer": [
        "https://equipment-cover.example/",
      ],
      "buyer-name": { eng: ["Synthetic Health Service"] },
    },
    search,
    targetTaxonomyIds: [2],
    targetCpvCodes: ["33140000"],
    productFamily: cover,
  });
  assert(
    buyerCollision.candidates.length === 0 &&
      buyerCollision.rejectionReasons.PROCURING_AUTHORITY_EXCLUDED === 1,
    "procuring authorities must never become supplier prospects",
  );
  assert(
    tendererFallback.candidates.length === 1 &&
      tendererFallback.candidates[0].evidence[0].procurementRole ===
        "TENDERER_FALLBACK",
    "single selected tenderer fallback must retain explicit provenance",
  );
});

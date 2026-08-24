/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  boundedTedSearchPlan,
  deduplicateCandidates,
  DISCOVERY_LIMITS,
  EUROPE_DISCOVERY_COUNTRIES,
  normalizeCompanyName,
  normalizeCpv,
  normalizeDomain,
  normalizeHttpsUrl,
  partitionTedCandidates,
  type ProspectCandidate,
  type ProspectEvidence,
  type ProspectScore,
  rankProspects,
  sanitizeEvidenceText,
  type TedSearchPlanEntry,
} from "../_shared/external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  classifyEvidenceForProduct,
  type ProductFamilyProfile,
} from "../_shared/buyer-discovery-relevance-v2.ts";
import {
  registryAdaptersForCountries,
  type RegistryCandidate,
  registryCandidatesFromCache,
  registryCoverageForCountries,
  type RegistryLookupSeed,
  type RegistryRequest,
} from "../_shared/external-registry-adapters.ts";
import {
  type PublicFetcher,
  type PublicResolver,
  readBoundedResponseBody,
  safeFetchWithRedirects,
} from "../_shared/safe-public-fetch.ts";
import { isPathAllowedByRobots } from "../_shared/attachment-discovery.ts";
import {
  extractWebsiteProductSignals,
  normalizeWebsiteProductSignals,
  prioritizedWebsiteUrls,
  type ProductTaxonomyCandidate,
  sitemapProductUrls,
  validateProductSearchQuery,
  WEBSITE_PRODUCT_SCAN_LIMITS,
  type WebsiteProductSignal,
} from "../_shared/website-product-discovery.ts";
import {
  createBraveSearchProvider,
  normalizePublicWebResult,
  PUBLIC_WEB_DISCOVERY_LIMITS,
  type PublicWebCacheEntry,
  publicWebCandidatesToProspects,
  type PublicWebDiscoveryCache,
  runPublicWebDiscovery,
} from "../_shared/public-web-discovery.ts";

const TED_ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";
const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const COUNTRY_CODES: Record<string, string> = {
  austria: "AT",
  belgium: "BE",
  bulgaria: "BG",
  croatia: "HR",
  cyprus: "CY",
  czechia: "CZ",
  "czech republic": "CZ",
  denmark: "DK",
  estonia: "EE",
  finland: "FI",
  france: "FR",
  germany: "DE",
  greece: "GR",
  hungary: "HU",
  ireland: "IE",
  italy: "IT",
  latvia: "LV",
  lithuania: "LT",
  luxembourg: "LU",
  malta: "MT",
  netherlands: "NL",
  norway: "NO",
  poland: "PL",
  portugal: "PT",
  romania: "RO",
  slovakia: "SK",
  slovenia: "SI",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  turkey: "TR",
  türkiye: "TR",
  "united kingdom": "GB",
};
const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_CODES).map((
    [name, code],
  ) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase())]),
);

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEBSITE_SCAN_USER_AGENT = "MedicHall-Website-Product-Discovery/1.0";
const LEGACY_QUERY_PROGRESS_LIMIT = 4;

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://medichall.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function texts(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const normalized = sanitizeEvidenceText(value, 1000);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) return value.flatMap(texts);
  const valueRecord = record(value);
  if (valueRecord.eng) return texts(valueRecord.eng);
  return Object.values(valueRecord).flatMap(texts);
}

// Typed public-record fields such as CPV codes, legal identifiers and ISO
// dates can resemble phone numbers. Preserve their scalar value here and use
// the contact-redacting `texts` helper only for human-readable free text.
function structuredTexts(value: unknown, maximum = 1000): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).normalize("NFC").replace(/\s+/g, " ")
      .trim().slice(0, maximum);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => structuredTexts(item, maximum));
  }
  const valueRecord = record(value);
  if (valueRecord.eng) return structuredTexts(valueRecord.eng, maximum);
  return Object.values(valueRecord).flatMap((item) =>
    structuredTexts(item, maximum)
  );
}

function structuredFirst(value: unknown, maximum = 1000): string {
  return structuredTexts(value, maximum)[0] || "";
}

function first(value: unknown): string {
  return texts(value)[0] || "";
}

function countryCode(value: unknown): string | null {
  const raw = first(value).trim();
  if (/^[A-Z]{2}$/i.test(raw)) return raw.toUpperCase();
  const iso3: Record<string, string> = {
    AUT: "AT",
    BEL: "BE",
    BGR: "BG",
    HRV: "HR",
    CYP: "CY",
    CZE: "CZ",
    DNK: "DK",
    EST: "EE",
    FIN: "FI",
    FRA: "FR",
    DEU: "DE",
    GRC: "GR",
    HUN: "HU",
    IRL: "IE",
    ITA: "IT",
    LVA: "LV",
    LTU: "LT",
    LUX: "LU",
    MLT: "MT",
    NLD: "NL",
    NOR: "NO",
    POL: "PL",
    PRT: "PT",
    ROU: "RO",
    SVK: "SK",
    SVN: "SI",
    ESP: "ES",
    SWE: "SE",
    CHE: "CH",
    TUR: "TR",
    GBR: "GB",
  };
  return iso3[raw.toUpperCase()] || COUNTRY_CODES[raw.toLowerCase()] || null;
}

function companyType(value: unknown): ProspectCandidate["companyType"] {
  const text = texts(value).join(" ").toLowerCase();
  if (/hospital.+supplier|supplier.+hospital/.test(text)) {
    return "Hospital supplier";
  }
  if (/distribut/.test(text)) return "Distributor";
  if (/wholesale/.test(text)) return "Wholesaler";
  if (/import/.test(text)) return "Importer";
  if (/resell/.test(text)) return "Reseller";
  if (/manufactur/.test(text)) return "Manufacturer";
  return "Unknown";
}

function sha256(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((bytes) =>
      Array.from(
        new Uint8Array(bytes),
        (item) => item.toString(16).padStart(2, "0"),
      ).join("")
    );
}

async function boundedJson(
  response: Response,
  maximumBytes = 1_000_000,
): Promise<unknown> {
  const { bytes } = await readBoundedResponseBody(response, maximumBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

type TedQueryDiagnostics = {
  retrievalKind: TedSearchPlanEntry["retrievalKind"];
  countries: string[];
  terms: string[];
  unfilteredCountryFallback: boolean;
  noticesReturned: number;
  productRelevantNotices: number;
  supplierEntitiesExtracted: number;
  domainEntities: number;
  candidatesProduced: number;
  rejectionReasons: Record<string, number>;
};

type TedCountryDiagnostics = {
  noticesRetrieved: number;
  productRelevantNotices: number;
  supplierEntitiesExtracted: number;
  candidateEntitiesProduced: number;
};

function addCount(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] || 0) + 1;
}

function addRejections(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value;
  }
}

export function extractTedCandidatesFromNotice(input: {
  noticeValue: unknown;
  search: TedSearchPlanEntry;
  targetTaxonomyIds: number[];
  targetCpvCodes: string[];
  productFamily: ProductFamilyProfile;
}): {
  candidates: ProspectCandidate[];
  productRelevant: boolean;
  supplierEntitiesExtracted: number;
  domainEntities: number;
  countryCode: string | null;
  supplierCountries: string[];
  productRelevantCountries: string[];
  rejectionReasons: Record<string, number>;
} {
  const notice = record(input.noticeValue);
  const rejectionReasons: Record<string, number> = {};
  const publicationNumber = structuredFirst(
    notice["publication-number"],
    100,
  );
  if (!publicationNumber) {
    addCount(rejectionReasons, "MISSING_PUBLICATION_NUMBER");
    return {
      candidates: [],
      productRelevant: false,
      supplierEntitiesExtracted: 0,
      domainEntities: 0,
      countryCode: null,
      supplierCountries: [],
      productRelevantCountries: [],
      rejectionReasons,
    };
  }

  let procurementRole: "WINNER" | "TENDERER_FALLBACK" = "WINNER";
  let names = texts(notice["winner-name"]).slice(0, 10);
  let websites = [
    ...structuredTexts(notice["winner-internet-address"], 1000),
    ...structuredTexts(notice["winner-touchpoint-internet-address"], 1000),
  ];
  let identifiers = structuredTexts(notice["winner-identifier"], 240);
  let countries = structuredTexts(notice["winner-country"], 20);
  if (!names.length) {
    const tendererNames = texts(notice["organisation-name-tenderer"]).slice(
      0,
      10,
    );
    const selection = structuredTexts(
      notice["winner-selection-status"],
      40,
    ).map((value) => value.toLowerCase());
    // The generic tenderer organisation list can include losing bidders. It
    // is used only for the unambiguous single-operator selected-winner case.
    if (tendererNames.length === 1 && selection.includes("selec-w")) {
      procurementRole = "TENDERER_FALLBACK";
      names = tendererNames;
      websites = [
        ...structuredTexts(
          notice["organisation-internet-address-tenderer"],
          1000,
        ),
        ...structuredTexts(
          notice["touchpoint-internet-address-tenderer"],
          1000,
        ),
      ];
      identifiers = structuredTexts(
        notice["organisation-identifier-tenderer"],
        240,
      );
      countries = structuredTexts(
        notice["organisation-country-tenderer"],
        20,
      );
    }
  }
  if (!names.length) {
    addCount(rejectionReasons, "NO_STRUCTURED_SUPPLIER_OPERATOR");
    return {
      candidates: [],
      productRelevant: false,
      supplierEntitiesExtracted: 0,
      domainEntities: 0,
      countryCode: null,
      supplierCountries: [],
      productRelevantCountries: [],
      rejectionReasons,
    };
  }

  const cpvCodes = structuredTexts(notice["classification-cpv"], 40)
    .map(normalizeCpv).filter(Boolean) as string[];
  const exactCpv = cpvCodes.some((code) => input.targetCpvCodes.includes(code));
  const relatedCpv = exactCpv ||
    cpvCodes.some((code) =>
      input.targetCpvCodes.some((target) =>
        code.slice(0, 5) === target.slice(0, 5)
      )
    );
  const title = first(notice["notice-title"]) || "TED contract award";
  const lot = first(notice["description-lot"]);
  const evidenceDate = structuredFirst(
    notice["contract-conclusion-date"] || notice["publication-date"],
    20,
  ).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null;
  const buyerNames = new Set(
    texts(notice["buyer-name"]).map(normalizeCompanyName).filter(Boolean),
  );
  const candidates: ProspectCandidate[] = [];
  const supplierCountries: string[] = [];
  const productRelevantCountries = new Set<string>();
  let domainEntities = 0;
  let productRelevant = false;
  for (let index = 0; index < names.length; index += 1) {
    const name = sanitizeEvidenceText(names[index], 240);
    if (!name) {
      addCount(rejectionReasons, "EMPTY_SUPPLIER_NAME");
      continue;
    }
    if (buyerNames.has(normalizeCompanyName(name))) {
      addCount(rejectionReasons, "PROCURING_AUTHORITY_EXCLUDED");
      continue;
    }
    const winnerCountry = countryCode(countries[index] || countries[0]);
    supplierCountries.push(winnerCountry || "UNKNOWN");
    const websiteUrl = [websites[index], websites[0]].map(normalizeHttpsUrl)
      .find(Boolean) || null;
    const classified = classifyEvidenceForProduct({
      sourceType: "TED_AWARD",
      sourceUrl: `https://ted.europa.eu/en/notice/-/detail/${
        encodeURIComponent(publicationNumber)
      }`,
      sourceDomain: "ted.europa.eu",
      title: sanitizeEvidenceText(title, 300),
      snippet: sanitizeEvidenceText(lot || title, 1600),
      // Retrieval provenance and scoring evidence stay separate. A related
      // CPV can introduce this operator, but only title/lot text can establish
      // DIRECT or ADJACENT product-family evidence.
      evidenceKind: "WEAK_CONTEXT",
      confidence: 0.55,
      evidenceDate,
      noticeId: publicationNumber,
      procurementBuyer:
        sanitizeEvidenceText(first(notice["buyer-name"]), 300) || null,
      procurementRole,
      lotContext: sanitizeEvidenceText(lot, 1000) || null,
      cpvCodes,
      taxonomyIds: input.targetTaxonomyIds,
    }, input.productFamily);
    const commerciallyRelevant = classified.relevanceClass !== "GENERIC";
    productRelevant ||= commerciallyRelevant;
    if (commerciallyRelevant) {
      productRelevantCountries.add(winnerCountry || "UNKNOWN");
    }
    if (
      input.search.retrievalKind === "RELATED_CPV" && !relatedCpv &&
      !commerciallyRelevant
    ) {
      addCount(rejectionReasons, "NO_REVIEWED_DISCOVERY_SIGNAL");
      continue;
    }
    const evidence: ProspectEvidence = {
      ...classified,
      confidence: classified.relevanceClass === "DIRECT"
        ? 0.9
        : classified.relevanceClass === "ADJACENT"
        ? 0.86
        : exactCpv
        ? 0.6
        : 0.55,
      discoveryReason: input.search.retrievalKind === "RELATED_CPV"
        ? "RELATED_CPV_TED"
        : classified.relevanceClass === "DIRECT"
        ? "DIRECT_PRODUCT_TERM_TED"
        : classified.relevanceClass === "ADJACENT"
        ? "ADJACENT_PRODUCT_TERM_TED"
        : "RELATED_CPV_TED",
    };
    if (websiteUrl) domainEntities += 1;
    candidates.push({
      name,
      countryCode: winnerCountry,
      countryName: winnerCountry ? COUNTRY_NAMES[winnerCountry] || null : null,
      cityRegion: null,
      companyType: companyType(`${title} ${lot}`),
      websiteUrl,
      registryIdentifier: structuredFirst(
        identifiers[index] || identifiers[0],
        240,
      ) || null,
      description: sanitizeEvidenceText(lot || title, 1600) || null,
      evidence: [evidence],
      activities: [],
      taxonomyIds: commerciallyRelevant ? input.targetTaxonomyIds : [],
      taxonomyRelation: evidence.relevanceClass === "DIRECT"
        ? "exact"
        : evidence.relevanceClass === "ADJACENT"
        ? "family"
        : "none",
      targetCountry: false,
      preferredCompanyType: false,
      relatedAwardCount: commerciallyRelevant ? 1 : 0,
      lastEvidenceAt: evidenceDate,
      discoverySources: [
        input.search.retrievalKind === "RELATED_CPV"
          ? "CPV_TED"
          : "PRODUCT_TED",
      ],
      websiteVerificationUrls: websiteUrl ? [websiteUrl] : [],
    });
  }
  return {
    candidates,
    productRelevant,
    supplierEntitiesExtracted: supplierCountries.length,
    domainEntities,
    countryCode: candidates[0]?.countryCode ||
      (supplierCountries[0] === "UNKNOWN" ? null : supplierCountries[0]),
    supplierCountries,
    productRelevantCountries: [...productRelevantCountries],
    rejectionReasons,
  };
}

async function fetchTedAwards(
  searchPlan: TedSearchPlanEntry[],
  targetTaxonomyIds: number[],
  targetCpvCodes: string[],
  productFamily: ProductFamilyProfile,
): Promise<{
  candidates: ProspectCandidate[];
  checked: number;
  unavailable: boolean;
  queries: TedQueryDiagnostics[];
  countries: Record<string, TedCountryDiagnostics>;
  noticesReturned: number;
  productRelevantNotices: number;
  supplierEntitiesExtracted: number;
  domainEntities: number;
  rejectionReasons: Record<string, number>;
}> {
  const candidates: ProspectCandidate[] = [];
  const queries: TedQueryDiagnostics[] = [];
  const countries: Record<string, TedCountryDiagnostics> = {};
  const rejectionReasons: Record<string, number> = {};
  for (const country of new Set(searchPlan.flatMap((item) => item.countries))) {
    countries[country] = {
      noticesRetrieved: 0,
      productRelevantNotices: 0,
      supplierEntitiesExtracted: 0,
      candidateEntitiesProduced: 0,
    };
  }
  countries.UNKNOWN = {
    noticesRetrieved: 0,
    productRelevantNotices: 0,
    supplierEntitiesExtracted: 0,
    candidateEntitiesProduced: 0,
  };
  let checked = 0;
  let unavailable = false;
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
  for (
    const search of searchPlan.slice(0, DISCOVERY_LIMITS.maximumTedRequests)
  ) {
    checked += 1;
    const queryDiagnostics: TedQueryDiagnostics = {
      retrievalKind: search.retrievalKind,
      countries: search.countries,
      terms: search.terms,
      unfilteredCountryFallback: search.unfilteredCountryFallback,
      noticesReturned: 0,
      productRelevantNotices: 0,
      supplierEntitiesExtracted: 0,
      domainEntities: 0,
      candidatesProduced: 0,
      rejectionReasons: {},
    };
    queries.push(queryDiagnostics);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DISCOVERY_LIMITS.requestTimeoutMs,
    );
    try {
      const response = await fetch(TED_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
        },
        signal: controller.signal,
        body: JSON.stringify({
          query: `${search.query} AND (form-type = result)`,
          fields,
          page: 1,
          limit: DISCOVERY_LIMITS.maximumTedResultsPerQuery,
          // Buyer discovery needs historical award evidence. ACTIVE excludes
          // most concluded result notices and collapsed V2 recall.
          scope: "ALL",
          paginationMode: "PAGE_NUMBER",
          onlyLatestVersions: true,
          checkQuerySyntax: false,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        unavailable = true;
        continue;
      }
      const payload = record(await boundedJson(response));
      const notices = array(payload.notices || payload.results)
        .slice(0, DISCOVERY_LIMITS.maximumTedResultsPerQuery);
      queryDiagnostics.noticesReturned = notices.length;
      for (const noticeValue of notices) {
        const extracted = extractTedCandidatesFromNotice({
          noticeValue,
          search,
          targetTaxonomyIds,
          targetCpvCodes,
          productFamily,
        });
        candidates.push(...extracted.candidates);
        queryDiagnostics.productRelevantNotices += extracted.productRelevant
          ? 1
          : 0;
        queryDiagnostics.supplierEntitiesExtracted +=
          extracted.supplierEntitiesExtracted;
        queryDiagnostics.domainEntities += extracted.domainEntities;
        queryDiagnostics.candidatesProduced += extracted.candidates.length;
        addRejections(
          queryDiagnostics.rejectionReasons,
          extracted.rejectionReasons,
        );
        addRejections(rejectionReasons, extracted.rejectionReasons);
        const ensureCountry = (country: string) => {
          countries[country] ||= {
            noticesRetrieved: 0,
            productRelevantNotices: 0,
            supplierEntitiesExtracted: 0,
            candidateEntitiesProduced: 0,
          };
          return countries[country];
        };
        const noticeCountries = new Set(
          extracted.supplierCountries.length
            ? extracted.supplierCountries
            : ["UNKNOWN"],
        );
        for (const country of noticeCountries) {
          ensureCountry(country).noticesRetrieved += 1;
        }
        for (const country of extracted.productRelevantCountries) {
          ensureCountry(country).productRelevantNotices += 1;
        }
        for (const country of extracted.supplierCountries) {
          ensureCountry(country).supplierEntitiesExtracted += 1;
        }
        for (const candidate of extracted.candidates) {
          ensureCountry(candidate.countryCode || "UNKNOWN")
            .candidateEntitiesProduced += 1;
        }
      }
    } catch (_) {
      unavailable = true;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    candidates,
    checked,
    unavailable,
    queries,
    countries,
    noticesReturned: queries.reduce(
      (total, item) => total + item.noticesReturned,
      0,
    ),
    productRelevantNotices: queries.reduce(
      (total, item) => total + item.productRelevantNotices,
      0,
    ),
    supplierEntitiesExtracted: queries.reduce(
      (total, item) => total + item.supplierEntitiesExtracted,
      0,
    ),
    domainEntities: queries.reduce(
      (total, item) => total + item.domainEntities,
      0,
    ),
    rejectionReasons,
  };
}

async function fetchRegistryCandidates(
  // deno-lint-ignore no-explicit-any -- cache table is introduced by a forward migration.
  admin: any,
  targetCountries: string[],
  seeds: RegistryLookupSeed[],
): Promise<
  {
    candidates: RegistryCandidate[];
    checked: number;
    externalRequests: number;
    cacheHits: number;
    cacheUnavailable: boolean;
    successfulProviders: string[];
    unavailableProviders: string[];
  }
> {
  const adapters = registryAdaptersForCountries(targetCountries);
  const candidates: RegistryCandidate[] = [];
  const unavailableProviders: string[] = [];
  const successfulProviders = new Set<string>();
  let checked = 0;
  let externalRequests = 0;
  let cacheHits = 0;
  let cacheUnavailable = false;
  let lastExternalRequestAt = 0;

  async function cacheKey(request: RegistryRequest): Promise<string> {
    return await sha256(`${request.providerCode}|${request.url}`);
  }

  async function readCache(
    request: RegistryRequest,
  ): Promise<
    {
      candidates: RegistryCandidate[];
      status: "ACTIVE" | "UNAVAILABLE";
    } | null
  > {
    const key = await cacheKey(request);
    const result = await admin.from("external_registry_request_cache").select(
      "normalized_candidates,fetch_status,expires_at,hit_count",
    ).eq("provider_code", request.providerCode).eq("request_key_hash", key)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (result.error) {
      cacheUnavailable = true;
      return null;
    }
    if (!result.data) return null;
    const normalized = registryCandidatesFromCache(
      result.data.normalized_candidates,
    );
    const update = await admin.from("external_registry_request_cache").update({
      hit_count: Math.min(
        2_147_483_647,
        Number(result.data.hit_count || 0) + 1,
      ),
      last_hit_at: new Date().toISOString(),
    }).eq("provider_code", request.providerCode).eq("request_key_hash", key);
    if (update.error) cacheUnavailable = true;
    return {
      candidates: normalized,
      status: result.data.fetch_status === "ACTIVE" ? "ACTIVE" : "UNAVAILABLE",
    };
  }

  async function writeCache(
    request: RegistryRequest,
    normalized: RegistryCandidate[],
    status: "ACTIVE" | "UNAVAILABLE",
  ): Promise<void> {
    const now = new Date();
    const ttlDays = status === "ACTIVE" ? request.cacheTtlDays : 1;
    const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
    const key = await cacheKey(request);
    const result = await admin.from("external_registry_request_cache").upsert({
      provider_code: request.providerCode,
      request_key_hash: key,
      country_code: request.countryCode,
      source_url: request.url,
      normalized_candidates: normalized,
      fetch_status: status,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      last_error_code: status === "ACTIVE" ? null : "SOURCE_UNAVAILABLE",
      failure_count: status === "ACTIVE" ? 0 : 1,
    }, { onConflict: "provider_code,request_key_hash" });
    if (result.error) cacheUnavailable = true;
  }

  for (const adapter of adapters) {
    let adapterAvailable = true;
    for (
      const request of adapter.buildRequests(seeds).slice(
        0,
        adapter.coverage.maximumRequestsPerRun,
      )
    ) {
      if (checked >= DISCOVERY_LIMITS.maximumRegistryChecks) break;
      checked += 1;
      try {
        const cached = await readCache(request);
        if (cached) {
          candidates.push(
            ...cached.candidates.slice(0, request.maximumResults),
          );
          cacheHits += 1;
          if (cached.status === "ACTIVE") {
            successfulProviders.add(adapter.providerCode);
          } else {
            adapterAvailable = false;
          }
          continue;
        }
        const waitMs = Math.max(
          0,
          request.minimumIntervalMs - (Date.now() - lastExternalRequestAt),
        );
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        lastExternalRequestAt = Date.now();
        externalRequests += 1;
        const result = await safeFetchWithRedirects(request.url, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
          },
        }, { maximumAttempts: 1, maximumRedirects: 2 });
        if (!result.response.ok) {
          await result.response.body?.cancel();
          adapterAvailable = false;
          await writeCache(request, [], "UNAVAILABLE");
          continue;
        }
        const parsed = adapter.parse(
          await boundedJson(result.response),
          result.resolvedUrl,
          request.seed,
        ).slice(0, request.maximumResults);
        candidates.push(...parsed);
        await writeCache(request, parsed, "ACTIVE");
        successfulProviders.add(adapter.providerCode);
      } catch (_) {
        adapterAvailable = false;
        await writeCache(request, [], "UNAVAILABLE").catch(() => {
          cacheUnavailable = true;
        });
      }
    }
    if (!adapterAvailable) unavailableProviders.push(adapter.providerCode);
  }
  return {
    candidates,
    checked,
    externalRequests,
    cacheHits,
    cacheUnavailable,
    successfulProviders: [...successfulProviders],
    unavailableProviders,
  };
}

export function mergeSignals(
  tedCandidates: ProspectCandidate[],
  registryCandidates: RegistryCandidate[],
  targetCountries: string[],
  partnerTypes: string[],
  publicWebCandidates: ProspectCandidate[] = [],
): ProspectCandidate[] {
  const byName = new Map<string, ProspectCandidate>();
  const byRegistry = new Map<string, ProspectCandidate>();
  const byDomain = new Map<string, ProspectCandidate>();
  for (const candidate of tedCandidates) {
    const key = `${normalizeCompanyName(candidate.name)}:${
      candidate.countryCode || ""
    }`;
    const registryKey = candidate.registryIdentifier && candidate.countryCode
      ? `${candidate.countryCode}:${candidate.registryIdentifier}`
      : null;
    const previous = (registryKey ? byRegistry.get(registryKey) : null) ||
      byName.get(key);
    if (previous) {
      previous.evidence.push(...candidate.evidence);
      previous.relatedAwardCount += candidate.relatedAwardCount;
      previous.websiteUrl ||= candidate.websiteUrl;
      previous.registryIdentifier ||= candidate.registryIdentifier;
      previous.discoverySources = [
        ...new Set([
          ...(previous.discoverySources || []),
          ...(candidate.discoverySources || []),
        ]),
      ];
      previous.websiteVerificationUrls = [
        ...new Set([
          ...(candidate.websiteVerificationUrls || []),
          ...(previous.websiteVerificationUrls || []),
        ]),
      ];
      previous.lastEvidenceAt =
        [previous.lastEvidenceAt, candidate.lastEvidenceAt]
          .filter(Boolean).sort().reverse()[0] || null;
      byName.set(key, previous);
      if (registryKey) byRegistry.set(registryKey, previous);
      const domain = normalizeDomain(previous.websiteUrl);
      if (domain) byDomain.set(domain, previous);
    } else {
      byName.set(key, candidate);
      if (registryKey) byRegistry.set(registryKey, candidate);
      const domain = normalizeDomain(candidate.websiteUrl);
      if (domain) byDomain.set(domain, candidate);
    }
  }
  for (const registry of registryCandidates) {
    const key = `${
      normalizeCompanyName(registry.name)
    }:${registry.countryCode}`;
    const registryKey =
      `${registry.countryCode}:${registry.registryIdentifier}`;
    const evidence: ProspectEvidence = {
      sourceType: "PUBLIC_REGISTRY",
      sourceUrl: registry.sourceUrl,
      sourceDomain: normalizeDomain(registry.sourceUrl) || "official-registry",
      title: registry.sourceTitle,
      snippet: sanitizeEvidenceText(
        `${registry.activity.nationalCode} ${registry.activity.description}`,
        1600,
      ),
      evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
      discoveryReason: "OFFICIAL_REGISTRY_ACTIVITY",
      confidence: registry.activity.strength === "STRONG_INDIRECT"
        ? 0.82
        : 0.55,
      evidenceDate: registry.activity.effectiveFrom,
      registryProviderCode: registry.activity.providerCode,
    };
    const previous = byRegistry.get(registryKey) || byName.get(key);
    if (previous) {
      previous.activities.push(registry.activity);
      previous.evidence.push(evidence);
      previous.registryIdentifier ||= registry.registryIdentifier;
      previous.cityRegion ||= registry.cityRegion;
      previous.discoverySources = [
        ...new Set([
          ...(previous.discoverySources || []),
          "REGISTRY" as const,
        ]),
      ];
      if (
        previous.companyType === "Unknown" &&
        registry.activity.strength === "STRONG_INDIRECT"
      ) {
        previous.companyType = "Wholesaler";
      }
      byName.set(key, previous);
      byRegistry.set(registryKey, previous);
    } else {
      const created: ProspectCandidate = {
        name: registry.name,
        countryCode: registry.countryCode,
        countryName: registry.countryName,
        cityRegion: registry.cityRegion,
        companyType: registry.activity.strength === "STRONG_INDIRECT"
          ? "Wholesaler"
          : "Unknown",
        websiteUrl: null,
        registryIdentifier: registry.registryIdentifier,
        description: registry.activity.description,
        evidence: [evidence],
        activities: [registry.activity],
        taxonomyIds: [],
        taxonomyRelation: "none",
        targetCountry: false,
        preferredCompanyType: false,
        relatedAwardCount: 0,
        lastEvidenceAt: registry.activity.effectiveFrom,
        discoverySources: ["REGISTRY"],
        websiteVerificationUrls: [],
      };
      byName.set(key, created);
      byRegistry.set(registryKey, created);
    }
  }
  for (const candidate of publicWebCandidates) {
    const domain = normalizeDomain(candidate.websiteUrl);
    const key = `${normalizeCompanyName(candidate.name)}:${
      candidate.countryCode || ""
    }`;
    const previous = (domain ? byDomain.get(domain) : null) || byName.get(key);
    if (previous) {
      previous.websiteUrl ||= candidate.websiteUrl;
      previous.countryCode ||= candidate.countryCode;
      previous.countryName ||= candidate.countryName;
      previous.discoverySources = [
        ...new Set([
          ...(previous.discoverySources || []),
          "PUBLIC_WEB" as const,
        ]),
      ];
      previous.websiteVerificationUrls = [
        ...new Set([
          ...(candidate.websiteVerificationUrls || []),
          ...(previous.websiteVerificationUrls || []),
        ]),
      ];
      byName.set(key, previous);
      if (domain) byDomain.set(domain, previous);
      continue;
    }
    byName.set(key, candidate);
    if (domain) byDomain.set(domain, candidate);
  }
  const wantedTypes = partnerTypes.map((item) => item.toLowerCase());
  return [...new Set(byName.values())].map((candidate) => ({
    ...candidate,
    targetCountry: Boolean(
      candidate.countryCode && targetCountries.includes(candidate.countryCode),
    ),
    preferredCompanyType: wantedTypes.length === 0 ||
      wantedTypes.some((type) =>
        candidate.companyType.toLowerCase().includes(type) ||
        type.includes(candidate.companyType.toLowerCase())
      ),
  }));
}

export async function verifyWebsites(
  candidates: ProspectCandidate[],
  productFamily: ProductFamilyProfile,
  dependencies: {
    resolver?: PublicResolver;
    fetcher?: PublicFetcher;
    now?: Date;
  } = {},
): Promise<{
  available: number;
  checked: number;
  unavailable: number;
  relevant: number;
  generic: number;
  skipped: number;
  publicWebChecked: number;
  publicWebVerified: number;
}> {
  const withWebsites = candidates.filter((item) => item.websiteUrl).sort(
    (left, right) => {
      const priority = (candidate: ProspectCandidate) =>
        candidate.discoverySources?.includes("PUBLIC_WEB")
          ? 0
          : candidate.evidence.some((item) => item.relevanceClass === "DIRECT")
          ? 1
          : candidate.evidence.some((item) =>
              item.relevanceClass === "ADJACENT"
            )
          ? 2
          : 3;
      return priority(left) - priority(right);
    },
  );
  const selected: ProspectCandidate[] = [];
  const countryCounts = new Map<string, number>();
  for (const candidate of withWebsites) {
    const country = candidate.countryCode || "UNKNOWN";
    if ((countryCounts.get(country) || 0) > 0) continue;
    selected.push(candidate);
    countryCounts.set(country, 1);
    if (selected.length >= DISCOVERY_LIMITS.maximumWebsiteChecks) break;
  }
  for (const candidate of withWebsites) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= DISCOVERY_LIMITS.maximumWebsiteChecks) break;
  }
  const results = await Promise.all(selected.map(async (candidate) => {
    const website = normalizeHttpsUrl(
      candidate.websiteVerificationUrls?.[0] || candidate.websiteUrl,
    );
    if (!website) return "SKIPPED" as const;
    try {
      const siteUrl = new URL(website);
      const robotsUrl = `${siteUrl.origin}/robots.txt`;
      let allowed = true;
      try {
        const robots = await safeFetchWithRedirects(robotsUrl, {
          headers: {
            "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
          },
        }, {
          maximumAttempts: 1,
          maximumRedirects: 2,
          resolver: dependencies.resolver,
          fetcher: dependencies.fetcher,
        });
        if (robots.response.ok) {
          const body = await readBoundedResponseBody(robots.response, 128_000);
          allowed = isPathAllowedByRobots(
            new TextDecoder().decode(body.bytes),
            siteUrl.pathname,
            "medichall-external-prospect-discovery",
          );
        } else await robots.response.body?.cancel();
      } catch (_) {
        // An unavailable robots file is not a disallow rule.
      }
      if (!allowed) return "SKIPPED" as const;
      const result = await safeFetchWithRedirects(website, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
        },
      }, {
        maximumAttempts: 1,
        maximumRedirects: 3,
        resolver: dependencies.resolver,
        fetcher: dependencies.fetcher,
      });
      if (
        candidate.discoverySources?.includes("PUBLIC_WEB") &&
        normalizeDomain(result.resolvedUrl) !== normalizeDomain(website)
      ) {
        await result.response.body?.cancel();
        return "SKIPPED" as const;
      }
      if (!result.response.ok) {
        await result.response.body?.cancel();
        return "UNAVAILABLE" as const;
      }
      const contentType = result.response.headers.get("content-type") || "";
      if (!contentType.includes("html")) {
        await result.response.body?.cancel();
        return "SKIPPED" as const;
      }
      const body = await readBoundedResponseBody(result.response, 512_000);
      const text = sanitizeEvidenceText(
        new TextDecoder().decode(body.bytes).replace(
          /<script[\s\S]*?<\/script>/gi,
          " ",
        )
          .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "),
        4000,
      );
      const classified = classifyEvidenceForProduct({
        sourceType: "COMPANY_WEBSITE",
        sourceUrl: result.resolvedUrl,
        sourceDomain: normalizeDomain(result.resolvedUrl) || siteUrl.hostname,
        title: `${candidate.name} official website`,
        snippet: text,
        evidenceKind: "WEAK_CONTEXT",
        confidence: 0.85,
        evidenceDate: (dependencies.now || new Date()).toISOString().slice(
          0,
          10,
        ),
        taxonomyIds: candidate.taxonomyIds,
      }, productFamily);
      candidate.evidence.push({
        ...classified,
        snippet: classified.relevanceClass === "DIRECT"
          ? `Official website contains direct product-family evidence: ${
            (classified.matchedTerms || []).slice(0, 4).join(", ")
          }.`
          : classified.relevanceClass === "ADJACENT"
          ? `Official website contains adjacent commercial evidence: ${
            (classified.matchedTerms || []).slice(0, 4).join(", ")
          }.`
          : "Official website was reachable, but no supported target-product or adjacent commercial claim was found.",
        confidence: classified.relevanceClass === "DIRECT"
          ? 0.9
          : classified.relevanceClass === "ADJACENT"
          ? 0.78
          : 0.4,
      });
      if (candidate.companyType === "Unknown") {
        candidate.companyType = companyType(text);
      }
      if (
        classified.relevanceClass === "DIRECT" &&
        candidate.taxonomyRelation === "none"
      ) {
        candidate.taxonomyRelation = "exact";
      } else if (
        classified.relevanceClass === "ADJACENT" &&
        candidate.taxonomyRelation === "none"
      ) {
        candidate.taxonomyRelation = "family";
      }
      if (classified.relevanceClass !== "GENERIC") {
        candidate.lastEvidenceAt = (dependencies.now || new Date())
          .toISOString().slice(0, 10);
      }
      return classified.relevanceClass === "GENERIC"
        ? "GENERIC" as const
        : "RELEVANT" as const;
    } catch (_) {
      return "UNAVAILABLE" as const;
    }
  }));
  return {
    available: withWebsites.length,
    checked: selected.length,
    unavailable: results.filter((value) => value === "UNAVAILABLE").length,
    relevant: results.filter((value) => value === "RELEVANT").length,
    generic: results.filter((value) => value === "GENERIC").length,
    skipped: results.filter((value) => value === "SKIPPED").length,
    publicWebChecked:
      selected.filter((candidate) =>
        candidate.discoverySources?.includes("PUBLIC_WEB")
      ).length,
    publicWebVerified: results.filter((value, index) =>
      value === "RELEVANT" &&
      selected[index].discoverySources?.includes("PUBLIC_WEB")
    ).length,
  };
}

async function taxonomyCatalog(
  // deno-lint-ignore no-explicit-any -- repository has no generated database types.
  admin: any,
): Promise<ProductTaxonomyCandidate[]> {
  const [taxonomyResult, aliasResult] = await Promise.all([
    admin.from("medical_product_taxonomy").select(
      "id,canonical_name,slug,node_type",
    ).eq("is_active", true).limit(500),
    admin.from("medical_product_aliases").select("taxonomy_id,alias_text")
      .eq("is_active", true).eq("verification_status", "approved").limit(2000),
  ]);
  if (taxonomyResult.error || aliasResult.error) {
    throw new Error("WEBSITE_TAXONOMY_UNAVAILABLE");
  }
  const aliases = new Map<number, string[]>();
  for (const value of array(aliasResult.data)) {
    const row = record(value);
    const taxonomyId = Number(row.taxonomy_id);
    const alias = first(row.alias_text);
    if (!Number.isSafeInteger(taxonomyId) || !alias) continue;
    aliases.set(taxonomyId, [...(aliases.get(taxonomyId) || []), alias]);
  }
  return array(taxonomyResult.data).map((value) => {
    const row = record(value);
    const id = Number(row.id);
    return {
      id,
      canonicalName: first(row.canonical_name),
      slug: first(row.slug),
      nodeType: first(row.node_type),
      aliases: aliases.get(id) || [],
    };
  }).filter((item) => Number.isSafeInteger(item.id) && item.canonicalName);
}

async function fetchWebsiteText(
  sourceUrl: string,
  accept: string,
  maximumBytes: number,
  expectedDomain: string,
  deadlineAt: number,
): Promise<{ text: string; resolvedUrl: string; contentType: string }> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new Error("WEBSITE_SCAN_TIMEOUT");
  const result = await safeFetchWithRedirects(sourceUrl, {
    headers: { "Accept": accept, "User-Agent": WEBSITE_SCAN_USER_AGENT },
  }, {
    maximumAttempts: 1,
    maximumRedirects: WEBSITE_PRODUCT_SCAN_LIMITS.maximumRedirects,
    requestTimeoutMs: Math.min(8_000, remainingMs),
  });
  if (normalizeDomain(result.resolvedUrl) !== expectedDomain) {
    await result.response.body?.cancel();
    throw new Error("WEBSITE_CROSS_DOMAIN_REDIRECT");
  }
  if (!result.response.ok) {
    await result.response.body?.cancel();
    throw new Error(`WEBSITE_HTTP_${result.response.status}`);
  }
  const contentType = result.response.headers.get("content-type") || "";
  const body = await readBoundedResponseBody(result.response, maximumBytes);
  return {
    text: new TextDecoder().decode(body.bytes),
    resolvedUrl: result.resolvedUrl,
    contentType,
  };
}

async function scanCompanyWebsiteProducts(
  // deno-lint-ignore no-explicit-any -- repository has no generated database types.
  admin: any,
  companyId: number,
  scanId: string,
): Promise<JsonRecord> {
  const companyResult = await admin.from("companies").select("website")
    .eq("id", companyId).single();
  const website = normalizeHttpsUrl(companyResult.data?.website);
  if (companyResult.error || !website) {
    throw new Error("COMPANY_WEBSITE_UNAVAILABLE");
  }
  const root = new URL(website);
  const expectedDomain = normalizeDomain(root.href);
  if (!expectedDomain) throw new Error("COMPANY_WEBSITE_UNAVAILABLE");
  root.pathname = root.pathname || "/";
  root.search = "";
  root.hash = "";
  const startedAt = Date.now();
  const deadlineAt = startedAt + WEBSITE_PRODUCT_SCAN_LIMITS.totalRunTimeMs;
  const updateScan = async (values: JsonRecord) => {
    const update = await admin.from("company_website_product_scans").update(
      values,
    )
      .eq("id", scanId).eq("company_id", companyId);
    if (update.error) throw new Error("WEBSITE_SCAN_PROGRESS_FAILED");
  };
  await updateScan({
    status: "RUNNING",
    stage: "reading_website",
    started_at: new Date().toISOString(),
  });

  let robots = "";
  try {
    const robotsResult = await fetchWebsiteText(
      `${root.origin}/robots.txt`,
      "text/plain",
      128_000,
      expectedDomain,
      deadlineAt,
    );
    robots = robotsResult.text;
  } catch (_) {
    // An unavailable robots file is not a disallow instruction.
  }
  if (
    robots &&
    !isPathAllowedByRobots(
      robots,
      root.pathname,
      WEBSITE_SCAN_USER_AGENT.toLowerCase(),
    )
  ) {
    await updateScan({
      status: "ROBOTS_DENIED",
      stage: "failed",
      error_code: "ROBOTS_DENIED",
      completed_at: new Date().toISOString(),
      cache_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    return {
      status: "ROBOTS_DENIED",
      stage: "failed",
      pages_checked: 0,
      suggestions: [],
    };
  }

  await updateScan({ stage: "finding_product_pages" });
  const queued: string[] = [root.href];
  const queuedSet = new Set(queued);
  let sitemap = "";
  try {
    const sitemapResult = await fetchWebsiteText(
      `${root.origin}/sitemap.xml`,
      "application/xml,text/xml,text/plain",
      512_000,
      expectedDomain,
      deadlineAt,
    );
    sitemap = sitemapResult.text;
    for (const url of sitemapProductUrls(sitemap, root.href)) {
      if (!queuedSet.has(url)) {
        queued.push(url);
        queuedSet.add(url);
      }
    }
  } catch (_) { /* a sitemap is optional */ }
  for (
    const path of [
      "/products",
      "/product",
      "/categories",
      "/catalogue",
      "/solutions",
    ]
  ) {
    const url = new URL(path, root.origin).href;
    if (!queuedSet.has(url)) {
      queued.push(url);
      queuedSet.add(url);
    }
  }

  const visited = new Set<string>();
  const signals: WebsiteProductSignal[] = [];
  let unavailable = 0;
  while (
    queued.length && visited.size < WEBSITE_PRODUCT_SCAN_LIMITS.maximumPages &&
    Date.now() - startedAt < WEBSITE_PRODUCT_SCAN_LIMITS.totalRunTimeMs
  ) {
    const next = queued.shift()!;
    if (visited.has(next)) continue;
    const nextUrl = new URL(next);
    if (
      robots &&
      !isPathAllowedByRobots(
        robots,
        nextUrl.pathname,
        WEBSITE_SCAN_USER_AGENT.toLowerCase(),
      )
    ) continue;
    visited.add(next);
    try {
      const page = await fetchWebsiteText(
        next,
        "text/html,application/xhtml+xml",
        WEBSITE_PRODUCT_SCAN_LIMITS.maximumResponseBytes,
        expectedDomain,
        deadlineAt,
      );
      if (!page.contentType.toLowerCase().includes("html")) continue;
      const pageReference = new URL(page.resolvedUrl);
      pageReference.search = "";
      pageReference.hash = "";
      signals.push(
        ...extractWebsiteProductSignals(page.text, pageReference.href),
      );
      if (visited.size === 1) {
        for (
          const discovered of prioritizedWebsiteUrls(
            page.text,
            page.resolvedUrl,
            root.href,
          )
        ) {
          if (!queuedSet.has(discovered)) {
            queued.push(discovered);
            queuedSet.add(discovered);
          }
        }
      }
    } catch (_) {
      unavailable += 1;
    }
    await updateScan({ pages_checked: visited.size });
  }

  if (!visited.size || unavailable === visited.size) {
    await updateScan({
      status: "FAILED",
      stage: "failed",
      pages_checked: visited.size,
      error_code: "WEBSITE_UNAVAILABLE",
      completed_at: new Date().toISOString(),
      cache_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    return {
      status: "FAILED",
      stage: "failed",
      pages_checked: visited.size,
      suggestions: [],
      contact_fields_collected: 0,
      raw_pages_stored: 0,
    };
  }

  await updateScan({
    stage: "identifying_products",
    pages_checked: visited.size,
  });
  const catalog = await taxonomyCatalog(admin);
  await updateScan({ stage: "matching_categories" });
  const suggestions = normalizeWebsiteProductSignals(signals, catalog);
  const status = suggestions.length ? "COMPLETED" : "NO_PRODUCTS";
  const completedAt = new Date();
  await updateScan({
    status,
    stage: "ready",
    pages_checked: visited.size,
    suggestions,
    error_code: null,
    completed_at: completedAt.toISOString(),
    cache_expires_at: new Date(
      completedAt.getTime() +
        WEBSITE_PRODUCT_SCAN_LIMITS.cacheDays * 86_400_000,
    ).toISOString(),
  });
  return {
    status,
    stage: "ready",
    pages_checked: visited.size,
    suggestions,
    contact_fields_collected: 0,
    raw_pages_stored: 0,
  };
}

async function persistCandidate(
  // The repository does not generate database types; service writes target
  // new migration tables that the untyped Supabase client cannot infer.
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: number,
  runId: string,
  intentHash: string,
  taxonomyContext: JsonRecord[],
  candidate: ProspectCandidate,
  score: ProspectScore,
  productFamily: ProductFamilyProfile,
): Promise<boolean> {
  if (!score.eligible || score.relevanceScore < 55) return false;
  const domain = normalizeDomain(candidate.websiteUrl);
  let external: { id: number; membership_status: string } | null = null;
  const lookups: Array<
    () => Promise<{ data: typeof external; error: unknown }>
  > = [];
  if (candidate.registryIdentifier && candidate.countryCode) {
    lookups.push(() =>
      admin.from("external_companies").select("id,membership_status")
        .eq("duplicate_status", "ACTIVE")
        .eq("registry_identifier", candidate.registryIdentifier)
        .eq("country_code", candidate.countryCode).maybeSingle()
    );
  }
  if (domain) {
    lookups.push(() =>
      admin.from("external_companies").select("id,membership_status")
        .eq("duplicate_status", "ACTIVE").eq("normalized_domain", domain)
        .maybeSingle()
    );
  }
  lookups.push(() => {
    let lookup = admin.from("external_companies").select("id,membership_status")
      .eq("duplicate_status", "ACTIVE")
      .eq("normalized_company_name", normalizeCompanyName(candidate.name));
    lookup = candidate.countryCode
      ? lookup.eq("country_code", candidate.countryCode)
      : lookup.is("country_code", null);
    return lookup.maybeSingle();
  });
  for (const lookup of lookups) {
    const result = await lookup();
    if (result.error) throw result.error;
    if (result.data) {
      external = result.data;
      break;
    }
  }
  if (external?.membership_status === "ON_MEDICHALL") return false;
  if (!external) {
    const insertion = await admin.from("external_companies").insert({
      company_name: candidate.name,
      country_code: candidate.countryCode,
      country_name: candidate.countryName,
      city_region: candidate.cityRegion,
      company_type: candidate.companyType,
      website_url: normalizeHttpsUrl(candidate.websiteUrl),
      registry_identifier: candidate.registryIdentifier,
      business_description: sanitizeEvidenceText(candidate.description, 1600) ||
        null,
      last_verified_at: new Date().toISOString(),
      source_last_seen_at: candidate.lastEvidenceAt,
    }).select("id, membership_status").single();
    if (
      insertion.error || !insertion.data ||
      insertion.data.membership_status === "ON_MEDICHALL"
    ) return false;
    external = insertion.data;
  }
  if (!external) return false;
  const externalCompanyId = Number(external.id);
  for (const evidence of candidate.evidence) {
    const sourceHash = await sha256([
      evidence.sourceType,
      evidence.sourceUrl,
      evidence.noticeId || "",
    ].join("|"));
    const insertion = await admin.from("external_company_evidence").upsert({
      external_company_id: externalCompanyId,
      source_type: evidence.sourceType,
      evidence_kind: evidence.evidenceKind,
      source_url: evidence.sourceUrl,
      source_domain: evidence.sourceDomain,
      source_title: evidence.title,
      evidence_snippet: sanitizeEvidenceText(evidence.snippet, 1600) || null,
      taxonomy_signals: (evidence.taxonomyIds || []).map((id) => ({
        taxonomy_id: id,
      })),
      cpv_codes: evidence.cpvCodes || [],
      notice_id: evidence.noticeId || null,
      procurement_buyer: sanitizeEvidenceText(evidence.procurementBuyer, 300) ||
        null,
      lot_context: sanitizeEvidenceText(evidence.lotContext, 1000) || null,
      evidence_date: evidence.evidenceDate,
      confidence: Math.max(0, Math.min(1, evidence.confidence)),
      verification_status: "ACTIVE",
      source_hash: sourceHash,
      last_seen_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    }, { onConflict: "external_company_id,source_hash" }).select("id").single();
    if (insertion.error) throw insertion.error;
    for (
      const activity of candidate.activities.filter((item) =>
        evidence.sourceType === "PUBLIC_REGISTRY" &&
        evidence.registryProviderCode === item.providerCode
      )
    ) {
      const activityWrite = await admin.from("external_company_activities")
        .upsert({
          external_company_id: externalCompanyId,
          evidence_id: insertion.data.id,
          provider_code: activity.providerCode,
          jurisdiction_country_code: activity.countryCode,
          registry_identifier: activity.registryIdentifier,
          national_activity_code: activity.nationalCode,
          national_classification: activity.nationalClassification,
          activity_description: activity.description,
          normalized_nace_code: activity.normalizedNaceCode,
          nace_revision: activity.naceRevision,
          mapping_confidence: activity.mappingConfidence,
          normalized_activity_class: activity.normalizedClass,
          signal_strength: activity.strength,
          is_direct_product_evidence: false,
          effective_from: activity.effectiveFrom,
          verified_at: new Date().toISOString(),
        }, {
          onConflict:
            "external_company_id,provider_code,national_activity_code,evidence_id",
        });
      if (activityWrite.error) throw activityWrite.error;
    }
  }
  for (const taxonomyId of [...new Set(candidate.taxonomyIds)]) {
    const mapping = await admin.from("external_company_taxonomy").upsert({
      external_company_id: externalCompanyId,
      taxonomy_id: taxonomyId,
      mapping_source: "cpv_mapping",
      confidence: candidate.taxonomyRelation === "exact" ? 0.9 : 0.75,
    }, { onConflict: "external_company_id,taxonomy_id" });
    if (mapping.error) throw mapping.error;
  }
  const match = await admin.from("company_external_prospect_matches").upsert({
    company_id: companyId,
    external_company_id: externalCompanyId,
    discovery_run_id: runId,
    intent_hash: intentHash,
    relevance_score: score.relevanceScore,
    product_taxonomy_score: score.productTaxonomyScore,
    geography_score: score.geographyScore,
    company_type_score: score.companyTypeScore,
    procurement_signal_score: score.procurementSignalScore,
    evidence_quality_score: score.evidenceQualityScore,
    recency_score: score.recencyScore,
    target_market: candidate.targetCountry,
    reason_summary: score.reasonSummary,
    reasons: score.reasons,
    evidence_snapshot: candidate.evidence.slice(0, 10).map((evidence) => ({
      source_type: evidence.sourceType,
      evidence_kind: evidence.evidenceKind,
      source_url: evidence.sourceUrl,
      source_domain: evidence.sourceDomain,
      source_title: sanitizeEvidenceText(evidence.title, 300),
      evidence_snippet: sanitizeEvidenceText(evidence.snippet, 1000),
      notice_id: evidence.noticeId || null,
      evidence_date: evidence.evidenceDate,
      confidence: Math.max(0, Math.min(1, evidence.confidence)),
      relevance_class: evidence.relevanceClass || "GENERIC",
      candidate_discovery_reason: evidence.discoveryReason || null,
      procurement_role: evidence.procurementRole || null,
      matched_terms: (evidence.matchedTerms || []).slice(0, 8),
      commercial_reason: sanitizeEvidenceText(evidence.commercialReason, 300),
      verification_status: "ACTIVE",
    })),
    activity_snapshot: candidate.activities.slice(0, 12).map((activity) => ({
      provider_code: activity.providerCode,
      jurisdiction_country_code: activity.countryCode,
      national_activity_code: activity.nationalCode,
      national_classification: activity.nationalClassification,
      activity_description: sanitizeEvidenceText(activity.description, 500),
      normalized_nace_code: activity.normalizedNaceCode,
      nace_revision: activity.naceRevision,
      normalized_activity_class: activity.normalizedClass,
      signal_strength: activity.strength,
      evidence_kind: "INDIRECT_COMMERCIAL_EVIDENCE",
    })),
    taxonomy_snapshot: taxonomyContext.filter((item) =>
      candidate.taxonomyIds.includes(Number(item.taxonomy_id))
    ).slice(0, 8).map((item) => ({
      taxonomy_id: Number(item.taxonomy_id),
      canonical_name: first(item.canonical_name),
      slug: first(item.slug),
      confidence: candidate.taxonomyRelation === "exact" ? .9 : .75,
      mapping_source: "discovery_intent",
      product_family_key: productFamily.key,
      product_family_label: productFamily.label,
      commercial_fit: score.commercialFitClassification,
    })),
    last_scored_at: new Date().toISOString(),
  }, { onConflict: "company_id,external_company_id,intent_hash" });
  if (match.error) throw match.error;
  return true;
}

export function discoveryCompletionStatus(input: {
  tedUnavailable: boolean;
  registryUnavailableProviders: number;
  websiteUnavailable: number;
  publicWebUnavailable?: boolean;
}): "COMPLETED" | "PARTIAL" {
  return input.tedUnavailable || input.registryUnavailableProviders > 0 ||
      input.websiteUnavailable > 0 || input.publicWebUnavailable === true
    ? "PARTIAL"
    : "COMPLETED";
}

export function legacyQueryProgressCount(actualRequests: number): number {
  return Math.max(
    0,
    Math.min(LEGACY_QUERY_PROGRESS_LIMIT, Math.trunc(actualRequests)),
  );
}

function enabledEnvironmentFlag(value: string | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "true";
}

function boundedEnvironmentNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function publicWebDiscoveryCache(
  // deno-lint-ignore no-explicit-any -- forward migration adds this service-only table.
  admin: any,
): PublicWebDiscoveryCache {
  return {
    async read(providerCode, requestKeyHash, now) {
      const result = await admin.from("external_public_web_request_cache")
        .select(
          "provider_code,request_key_hash,product_family_key,country_code,search_language,query_variant,normalized_candidates,fetch_status,fetched_at,expires_at,last_error_code,hit_count",
        ).eq("provider_code", providerCode)
        .eq("request_key_hash", requestKeyHash)
        .gt("expires_at", now.toISOString()).maybeSingle();
      if (result.error || !result.data) return null;
      const row = record(result.data);
      const candidates = array(row.normalized_candidates).map(
        normalizePublicWebResult,
      ).filter((candidate): candidate is NonNullable<typeof candidate> =>
        candidate !== null
      ).slice(0, PUBLIC_WEB_DISCOVERY_LIMITS.maximumCandidates);
      const hit = await admin.from("external_public_web_request_cache").update({
        hit_count: Math.max(0, Number(row.hit_count) || 0) + 1,
        last_hit_at: now.toISOString(),
      }).eq("provider_code", providerCode)
        .eq("request_key_hash", requestKeyHash);
      if (hit.error) throw new Error("PUBLIC_WEB_CACHE_HIT_UPDATE_FAILED");
      const status = String(row.fetch_status);
      if (!["ACTIVE", "ZERO_RESULTS", "UNAVAILABLE"].includes(status)) {
        return null;
      }
      return {
        providerCode,
        requestKeyHash,
        productFamilyKey: String(row.product_family_key || ""),
        countryCode: String(row.country_code || ""),
        searchLanguage: String(row.search_language || ""),
        queryVariant: Number(row.query_variant) || 0,
        status: status as PublicWebCacheEntry["status"],
        candidates,
        fetchedAt: String(row.fetched_at || ""),
        expiresAt: String(row.expires_at || ""),
        errorCode: row.last_error_code ? String(row.last_error_code) : null,
      };
    },
    async write(entry) {
      const normalizedCandidates = entry.candidates.slice(
        0,
        PUBLIC_WEB_DISCOVERY_LIMITS.maximumCandidates,
      ).map((candidate) => ({
        name: sanitizeEvidenceText(candidate.name, 180),
        pageUrl: normalizeHttpsUrl(candidate.pageUrl),
        canonicalDomain: candidate.canonicalDomain,
        countryCode: candidate.countryCode,
      })).filter((candidate) => candidate.pageUrl);
      const result = await admin.from("external_public_web_request_cache")
        .upsert({
          provider_code: entry.providerCode,
          request_key_hash: entry.requestKeyHash,
          product_family_key: sanitizeEvidenceText(
            entry.productFamilyKey,
            120,
          ),
          country_code: entry.countryCode,
          search_language: entry.searchLanguage,
          query_variant: entry.queryVariant,
          normalized_candidates: normalizedCandidates,
          fetch_status: entry.status,
          fetched_at: entry.fetchedAt,
          expires_at: entry.expiresAt,
          failure_count: entry.status === "UNAVAILABLE" ? 1 : 0,
          last_error_code: entry.errorCode,
        }, { onConflict: "provider_code,request_key_hash" });
      if (result.error) throw new Error("PUBLIC_WEB_CACHE_WRITE_FAILED");
    },
  };
}

async function handleDiscovery(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed." }, 405);
  }
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, { error: "Origin not allowed." }, 403);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, { error: "Prospect discovery is unavailable." }, 503);
  }
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json(request, { error: "Authentication required." }, 401);
  }
  const token = authorization.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(
    token,
  );
  if (authError || !user) {
    return json(request, { error: "Authentication required." }, 401);
  }
  let body: JsonRecord;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192) {
      throw new Error("Request is too large.");
    }
    body = record(JSON.parse(raw));
  } catch (error) {
    return json(request, {
      error: error instanceof Error ? error.message : "Invalid request.",
    }, 400);
  }
  const companyId = Number(body.company_id);
  const idempotencyKey = String(body.idempotency_key || "");
  if (
    !Number.isSafeInteger(companyId) || companyId <= 0 ||
    !UUID_PATTERN.test(idempotencyKey)
  ) {
    return json(request, {
      error: "Valid company and idempotency identifiers are required.",
    }, 400);
  }
  const context = await authClient.rpc(
    "get_buyer_discovery_product_context_v1",
    {
      p_company_id: companyId,
    },
  );
  if (context.error) {
    return json(
      request,
      { error: "Company access denied." },
      context.error.code === "42501" ? 403 : 400,
    );
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const operation = String(body.operation || "discover").toLowerCase();
  if (operation === "resolve_product_intent") {
    let productQuery: string;
    try {
      productQuery = validateProductSearchQuery(body.product_query);
    } catch (error) {
      return json(request, {
        error: error instanceof Error
          ? error.message
          : "Invalid product query.",
      }, 400);
    }
    const resolved = await admin.rpc("resolve_medical_product_term_v1", {
      p_term: productQuery,
      p_limit: 5,
    });
    if (resolved.error) {
      return json(request, { error: "Product taxonomy is unavailable." }, 503);
    }
    const result = record(resolved.data);
    const resolution = String(result.resolution || "unmapped");
    return json(request, {
      ok: true,
      resolution,
      recommended: result.recommended || null,
      alternatives: array(result.alternatives).slice(0, 5),
      confirmation_required: resolution !== "high_confidence",
      semantic_provider_used: false,
      provider_requests: 0,
      estimated_cost_usd: 0,
    });
  }
  if (operation === "scan_company_products") {
    const scanStart = await authClient.rpc(
      "start_company_website_product_scan_v1",
      {
        p_company_id: companyId,
        p_idempotency_key: idempotencyKey,
        p_force_rescan: body.force_rescan === true,
      },
    );
    if (scanStart.error) {
      return json(request, {
        error: sanitizeEvidenceText(scanStart.error.message, 300),
      }, scanStart.error.code === "42501" ? 403 : 429);
    }
    const scan = record(scanStart.data);
    const scanId = String(scan.scan_id || "");
    if (scan.reused === true) {
      const saved = await admin.from("company_website_product_scans").select(
        "id,status,stage,pages_checked,suggestions,cache_expires_at",
      ).eq("id", scanId).eq("company_id", companyId).single();
      return json(request, {
        ok: true,
        scan: saved.data || scan,
        cached: true,
        contact_fields_collected: 0,
        provider_requests: 0,
        estimated_cost_usd: 0,
      });
    }
    try {
      const scanned = await scanCompanyWebsiteProducts(
        admin,
        companyId,
        scanId,
      );
      return json(request, {
        ok: true,
        scan: { scan_id: scanId, ...scanned },
        cached: false,
        contact_fields_collected: 0,
        provider_requests: 0,
        estimated_cost_usd: 0,
      });
    } catch (error) {
      const errorCode =
        String(error instanceof Error ? error.message : "WEBSITE_SCAN_FAILED")
          .toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80) ||
        "WEBSITE_SCAN_FAILED";
      await admin.from("company_website_product_scans").update({
        status: "FAILED",
        stage: "failed",
        error_code: errorCode,
        completed_at: new Date().toISOString(),
        cache_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }).eq("id", scanId).eq("company_id", companyId);
      console.error("website product scan failed", {
        scan_id: scanId,
        error_code: errorCode,
      });
      return json(request, {
        error: "The company website could not be scanned right now.",
      }, 503);
    }
  }
  if (operation !== "discover") {
    return json(request, { error: "Unsupported operation." }, 400);
  }
  const intent = record(body.intent);
  const start = await authClient.rpc("start_external_prospect_discovery_v2", {
    p_company_id: companyId,
    p_idempotency_key: idempotencyKey,
    p_intent: intent,
  });
  if (start.error) {
    return json(request, {
      error: sanitizeEvidenceText(start.error.message, 300),
    }, start.error.code === "42501" ? 403 : 429);
  }
  const run = record(start.data);
  if (run.reused === true) {
    return json(request, {
      ok: true,
      run,
      cached: true,
      provider_requests: 0,
      estimated_cost_usd: 0,
    });
  }
  const runId = String(run.run_id || "");
  const intentHash = String(run.intent_hash || "");
  const intentContext = record(run.intent_context);
  const updateProgress = async (progress: JsonRecord) => {
    const result = await admin.from("external_prospect_discovery_runs").update(
      progress,
    ).eq("id", runId);
    if (result.error) throw new Error("DISCOVERY_PROGRESS_UPDATE_FAILED");
  };
  await updateProgress({
    status: "RUNNING",
    stage: "loading_profile",
    started_at: new Date().toISOString(),
  });
  let publicWebProviderRequests = 0;
  let publicWebProviderCostUsd = 0;
  try {
    const [profileResult, matchProfileResult, companiesResult] = await Promise
      .all([
        admin.from("matchmaking_profiles").select(
          "id,role,target_countries,partner_types_sought",
        ).eq("company_id", companyId).eq("is_active", true).single(),
        admin.from("company_match_profiles").select(
          "cpv_codes,target_countries,target_partner_types,product_keywords,certifications,oem_available,private_label_available,min_match_score",
        ).eq("company_id", companyId).maybeSingle(),
        admin.from("companies").select("id,name,website,country").limit(1000),
      ]);
    if (
      profileResult.error || matchProfileResult.error || companiesResult.error
    ) {
      throw new Error("DISCOVERY_CONTEXT_UNAVAILABLE");
    }
    const taxonomyContextRows = array(intentContext.taxonomy).map(record);
    const taxonomyIds = [
      ...new Set(
        taxonomyContextRows.map((item) => Number(item.taxonomy_id)).filter(
          Number.isSafeInteger,
        ),
      ),
    ];
    if (
      !UUID_PATTERN.test(runId) || !/^[a-f0-9]{64}$/.test(intentHash) ||
      !taxonomyIds.length
    ) {
      throw new Error("TAXONOMY_CONTEXT_UNAVAILABLE");
    }
    const catalog = await taxonomyCatalog(admin);
    const selectedTaxonomy = catalog.filter((item) =>
      taxonomyIds.includes(item.id)
    );
    const productFamily = buildProductFamilyProfile(
      selectedTaxonomy.length
        ? selectedTaxonomy.map((item) => ({
          taxonomyId: item.id,
          canonicalName: item.canonicalName,
          slug: item.slug,
          aliases: item.aliases,
        }))
        : taxonomyContextRows.map((item) => ({
          taxonomyId: Number(item.taxonomy_id),
          canonicalName: first(item.canonical_name),
          slug: first(item.slug),
          aliases: [] as string[],
        })),
    );
    const profile = record(profileResult.data);
    const matchProfile = record(matchProfileResult.data);
    const targetCountries = [
      ...new Set(
        texts(intentContext.target_countries).map((item) => countryCode(item))
          .filter(Boolean),
      ),
    ] as string[];
    const discoveryCountries = targetCountries.length
      ? targetCountries
      : [...EUROPE_DISCOVERY_COUNTRIES];
    const partnerTypes = [
      ...new Set([
        ...texts(profile.partner_types_sought),
        ...texts(matchProfile.target_partner_types),
      ]),
    ];
    const cpvCodesFromIntent = [
      ...new Set(
        taxonomyContextRows.flatMap((item) => texts(item.cpv_codes))
          .map(normalizeCpv).filter(Boolean),
      ),
    ] as string[];
    const fallbackCpv = cpvCodesFromIntent.length
      ? cpvCodesFromIntent
      : ["33100000", "33140000", "33190000"];
    const tedSearchPlan = boundedTedSearchPlan({
      directTerms: productFamily.directTerms,
      adjacentTerms: productFamily.adjacentTerms,
      cpvCodes: fallbackCpv,
      targetCountries,
    });
    const registryCoverage = registryCoverageForCountries(discoveryCountries);
    const publicWebEnabled = enabledEnvironmentFlag(
      Deno.env.get("PUBLIC_WEB_DISCOVERY_ENABLED"),
    );
    const publicWebProviderName = String(
      Deno.env.get("PUBLIC_WEB_PROVIDER") || "brave",
    ).trim().toLowerCase();
    const braveSearchApiKey = Deno.env.get("BRAVE_SEARCH_API_KEY") || "";
    const publicWebProvider = publicWebEnabled &&
        publicWebProviderName === "brave" && braveSearchApiKey.trim()
      ? createBraveSearchProvider({ apiKey: braveSearchApiKey })
      : null;
    const publicWebMaximumQueries = Math.trunc(boundedEnvironmentNumber(
      Deno.env.get("PUBLIC_WEB_MAX_QUERIES_PER_RUN"),
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
      1,
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
    ));
    const publicWebMaximumCost = boundedEnvironmentNumber(
      Deno.env.get("PUBLIC_WEB_MAX_COST_USD_PER_RUN"),
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumCostUsdPerRun,
      0,
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumCostUsdPerRun,
    );
    await updateProgress({
      stage: "preparing_market_search",
      // The existing production progress column is constrained to 0..4.
      // V2.1's exact six-request count remains available in diagnostics.
      queries_generated: legacyQueryProgressCount(tedSearchPlan.length),
      taxonomy_mapped: Math.min(100, taxonomyIds.length),
      diagnostics: {
        registry_coverage: registryCoverage.map((item) => ({
          country_code: item.countryCode,
          provider_code: item.providerCode,
          status: item.status,
          access_mode: item.accessMode,
          activity_signal_available: item.activitySignalAvailable,
          company_discovery_available: item.companyDiscoveryAvailable,
          cost: item.cost,
        })),
        product_family: {
          key: productFamily.key,
          label: productFamily.label,
        },
        countries_attempted: discoveryCountries,
        public_web_discovery_enabled: publicWebEnabled,
        public_web_query_limit: publicWebMaximumQueries,
        public_web_cost_limit_usd: publicWebMaximumCost,
        ted_requests_planned: tedSearchPlan.length,
        ted_query_partitions: tedSearchPlan.map((item) => ({
          retrieval_kind: item.retrievalKind,
          countries: item.countries,
          terms: item.terms,
          unfiltered_country_fallback: item.unfilteredCountryFallback,
        })),
      },
    });
    await updateProgress({
      stage: "searching_procurement",
      queries_generated: legacyQueryProgressCount(tedSearchPlan.length),
    });
    const [ted, publicWeb] = await Promise.all([
      fetchTedAwards(
        tedSearchPlan,
        taxonomyIds,
        fallbackCpv,
        productFamily,
      ),
      runPublicWebDiscovery({
        enabled: publicWebEnabled,
        provider: publicWebProvider,
        cache: publicWebDiscoveryCache(admin),
        productFamily,
        targetCountries,
        maximumQueries: publicWebMaximumQueries,
        maximumCostUsd: publicWebMaximumCost,
      }),
    ]);
    publicWebProviderRequests = publicWeb.providerRequests;
    publicWebProviderCostUsd = publicWeb.providerCostEstimateUsd;
    const publicWebProspects = publicWebCandidatesToProspects({
      candidates: publicWeb.candidates,
      taxonomyIds,
      targetCountries,
      partnerTypes,
    });
    await updateProgress({
      stage: "checking_business_sources",
      sources_checked: Math.min(
        60,
        ted.checked + publicWeb.queriesUsed,
      ),
      candidates_found: Math.min(
        100,
        ted.candidates.length + publicWebProspects.length,
      ),
    });
    const registry = await fetchRegistryCandidates(
      admin,
      discoveryCountries,
      ted.candidates.map((candidate) => ({
        name: candidate.name,
        countryCode: candidate.countryCode,
        cityRegion: candidate.cityRegion,
        registryIdentifier: candidate.registryIdentifier,
      })),
    );
    const tedPartitions = partitionTedCandidates(ted.candidates);
    const boundedRegistryCandidates = registry.candidates.slice(
      0,
      DISCOVERY_LIMITS.maximumRegistryCandidates,
    );
    await updateProgress({
      stage: "verifying_websites",
      sources_checked: Math.min(
        60,
        ted.checked + publicWeb.queriesUsed + registry.checked,
      ),
      candidates_found: Math.min(
        100,
        ted.candidates.length + registry.candidates.length +
          publicWebProspects.length,
      ),
    });
    const merged = mergeSignals(
      [
        ...tedPartitions.productTermCandidates,
        ...tedPartitions.cpvCandidates,
      ],
      boundedRegistryCandidates,
      targetCountries,
      partnerTypes,
      publicWebProspects,
    );
    const website = await verifyWebsites(merged, productFamily);
    await updateProgress({
      stage: "removing_duplicates",
      sources_checked: Math.min(
        60,
        ted.checked + publicWeb.queriesUsed + registry.checked +
          website.checked,
      ),
      candidates_found: Math.min(100, merged.length),
    });
    const deduped = deduplicateCandidates(
      merged,
      array(companiesResult.data).map((item) => {
        const company = record(item);
        return {
          id: Number(company.id),
          name: first(company.name),
          website: first(company.website) || null,
          country: countryCode(company.country) || first(company.country) ||
            null,
        };
      }),
    );
    await updateProgress({
      stage: "ranking_prospects",
      candidates_deduplicated: Math.min(
        100,
        deduped.registeredDuplicates + deduped.externalDuplicates,
      ),
    });
    const ranking = rankProspects(deduped.candidates, productFamily, {
      europeWide: targetCountries.length === 0,
    });
    let accepted = 0;
    let rejected = ranking.rejected.length;
    for (const ranked of ranking.accepted) {
      if (
        await persistCandidate(
          admin,
          companyId,
          runId,
          intentHash,
          taxonomyContextRows,
          ranked.candidate,
          ranked.score,
          productFamily,
        )
      ) {
        accepted += 1;
      } else rejected += 1;
    }
    await updateProgress({
      stage: "preparing_results",
      candidates_accepted: Math.min(30, accepted),
      candidates_rejected: Math.min(100, rejected),
    });
    const completionStatus = discoveryCompletionStatus({
      tedUnavailable: ted.unavailable,
      registryUnavailableProviders: registry.unavailableProviders.length,
      websiteUnavailable: website.unavailable,
      publicWebUnavailable: publicWeb.unavailable,
    });
    const partial = completionStatus === "PARTIAL";
    const diagnostics = {
      ted_unavailable: ted.unavailable,
      registry_unavailable_providers: registry.unavailableProviders,
      registry_successful_providers: registry.successfulProviders,
      registry_adapters_available: registryAdaptersForCountries(
        discoveryCountries,
      )
        .map((item) => item.providerCode),
      registry_coverage: registryCoverage.map((item) => ({
        country_code: item.countryCode,
        provider_code: item.providerCode,
        status: item.status,
        access_mode: item.accessMode,
        activity_signal_available: item.activitySignalAvailable,
        company_discovery_available: item.companyDiscoveryAvailable,
        cost: item.cost,
      })),
      registry_external_requests: registry.externalRequests,
      registry_cache_hits: registry.cacheHits,
      registry_cache_unavailable: registry.cacheUnavailable,
      public_web_discovery_status: publicWeb.status,
      public_web_queries_planned: publicWeb.queriesPlanned,
      public_web_queries_used: publicWeb.queriesUsed,
      public_web_results_received: publicWeb.resultsReceived,
      public_web_candidates_created: publicWeb.candidatesCreated,
      public_web_candidates_verified: website.publicWebVerified,
      public_web_candidates_accepted: ranking.accepted.filter((item) =>
        item.candidate.discoverySources?.includes("PUBLIC_WEB")
      ).length,
      public_web_cache_hits: publicWeb.cacheHits,
      public_web_cache_misses: publicWeb.cacheMisses,
      public_web_provider_requests: publicWeb.providerRequests,
      public_web_provider_cost_estimate_usd: publicWebProviderCostUsd,
      public_web_provider_latency_ms: publicWeb.providerLatencyMs,
      public_web_provider_status_codes: publicWeb.providerStatusCodes,
      public_web_provider_circuit_open: publicWeb.circuitOpen,
      public_web_candidate_domains: publicWeb.candidates.map((candidate) =>
        candidate.canonicalDomain
      ),
      public_web_rejection_reasons: publicWeb.rejectionReasons,
      website_unavailable_count: website.unavailable,
      registered_duplicates: deduped.registeredDuplicates,
      external_duplicates: deduped.externalDuplicates,
      ted_candidates_found: ted.candidates.length,
      registry_candidates_found: registry.candidates.length,
      public_web_candidates_found: publicWebProspects.length,
      ted_product_term_candidates_selected:
        tedPartitions.productTermCandidates.length,
      ted_cpv_candidates_selected: tedPartitions.cpvCandidates.length,
      registry_candidates_selected: boundedRegistryCandidates.length,
      public_web_candidates_selected: publicWebProspects.length,
      candidates_rejected_by_source_caps: tedPartitions.rejectedBySourceCaps +
        Math.max(
          0,
          registry.candidates.length - boundedRegistryCandidates.length,
        ),
      ted_duplicates_collapsed_before_source_caps:
        tedPartitions.duplicatesCollapsedBeforeCaps,
      merged_candidates_found: merged.length,
      deduplicated_candidates_remaining: deduped.candidates.length,
      countries_attempted: discoveryCountries,
      countries_with_candidates: Object.keys(
        ranking.diagnostics.candidatesByCountry,
      ).filter((country) =>
        country !== "UNKNOWN"
      ),
      countries_with_accepted_prospects: Object.keys(
        ranking.diagnostics.acceptedByCountry,
      ).filter((country) => country !== "UNKNOWN"),
      candidates_by_country: ranking.diagnostics.candidatesByCountry,
      accepted_by_country: ranking.diagnostics.acceptedByCountry,
      candidates_by_source: ranking.diagnostics.candidatesBySource,
      evidence_by_class: ranking.diagnostics.evidenceByClass,
      buyer_archetypes: ranking.diagnostics.buyerArchetypes,
      generic_only_rejected: ranking.diagnostics.genericOnlyRejected,
      product_family_mismatch_rejected:
        ranking.diagnostics.productFamilyMismatchRejected,
      diversity_tie_breaks_applied:
        ranking.diagnostics.diversityTieBreaksApplied,
      product_family: {
        key: productFamily.key,
        label: productFamily.label,
      },
      ted_requests_planned: tedSearchPlan.length,
      ted_requests_actual: ted.checked,
      ted_queries: ted.queries.map((item) => ({
        retrieval_kind: item.retrievalKind,
        countries: item.countries,
        terms: item.terms,
        unfiltered_country_fallback: item.unfilteredCountryFallback,
        notices_returned: item.noticesReturned,
        product_relevant_notices: item.productRelevantNotices,
        supplier_entities_extracted: item.supplierEntitiesExtracted,
        domain_entities: item.domainEntities,
        candidates_produced: item.candidatesProduced,
        rejection_reasons: item.rejectionReasons,
      })),
      ted_notices_returned: ted.noticesReturned,
      ted_product_relevant_notices: ted.productRelevantNotices,
      ted_supplier_entities_extracted: ted.supplierEntitiesExtracted,
      ted_domain_entities: ted.domainEntities,
      ted_rejection_reasons: ted.rejectionReasons,
      ted_by_country: ted.countries,
      registry_by_country: Object.fromEntries(
        discoveryCountries.map((country) => [
          country,
          registry.candidates.filter((candidate) =>
            candidate.countryCode === country
          ).length,
        ]),
      ),
      registry_requests_checked: registry.checked,
      website_candidates_with_domains: website.available,
      website_checks: website.checked,
      website_product_relevant: website.relevant,
      website_generic_or_mismatch: website.generic,
      candidate_pool_size: deduped.candidates.length,
      rejection_stages: {
        ted_before_verification: Object.values(ted.rejectionReasons).reduce(
          (total, value) => total + value,
          0,
        ),
        source_partition_caps: tedPartitions.rejectedBySourceCaps +
          Math.max(
            0,
            registry.candidates.length - boundedRegistryCandidates.length,
          ),
        registered_company_deduplication: deduped.registeredDuplicates,
        external_entity_deduplication: deduped.externalDuplicates,
        strict_product_verification: ranking.rejected.length,
      },
      quality_metrics: {
        retrieval_candidates: ted.candidates.length +
          registry.candidates.length + publicWebProspects.length,
        verified_candidates: deduped.candidates.length,
        accepted_candidates: ranking.accepted.length,
        persisted_candidates: accepted,
        precision_proxy: deduped.candidates.length
          ? Number(
            (ranking.accepted.length / deduped.candidates.length).toFixed(4),
          )
          : 0,
        source_coverage: {
          product_term_ted: tedPartitions.productTermCandidates.length,
          related_cpv_ted: tedPartitions.cpvCandidates.length,
          official_registry: boundedRegistryCandidates.length,
          public_web_candidate_generation: publicWebProspects.length,
          websites_with_official_domains: website.available,
        },
      },
      country_pipeline: Object.fromEntries(
        [...discoveryCountries, "UNKNOWN"].map((country) => [
          country,
          {
            ted_notices_retrieved: ted.countries[country]?.noticesRetrieved ||
              0,
            ted_product_relevant_notices:
              ted.countries[country]?.productRelevantNotices || 0,
            ted_supplier_entities:
              ted.countries[country]?.supplierEntitiesExtracted || 0,
            ted_candidate_entities:
              ted.countries[country]?.candidateEntitiesProduced || 0,
            registry_entities: registry.candidates.filter((candidate) =>
              candidate.countryCode === country
            ).length,
            verified_candidates:
              ranking.diagnostics.candidatesByCountry[country] || 0,
            accepted_candidates:
              ranking.diagnostics.acceptedByCountry[country] || 0,
          },
        ]),
      ),
      direct_contact_fields_stored: 0,
    };
    const completion = await admin.from("external_prospect_discovery_runs")
      .update({
        status: partial ? "PARTIAL" : "COMPLETED",
        stage: "completed",
        sources_checked: Math.min(
          60,
          ted.checked + publicWeb.queriesUsed + registry.checked +
            website.checked,
        ),
        candidates_found: Math.min(100, merged.length),
        candidates_deduplicated: Math.min(
          100,
          deduped.registeredDuplicates + deduped.externalDuplicates,
        ),
        candidates_accepted: Math.min(30, accepted),
        candidates_rejected: Math.min(100, rejected),
        taxonomy_mapped: Math.min(100, accepted * taxonomyIds.length),
        ai_classifications: 0,
        provider_requests: publicWebProviderRequests,
        // Customer workspaces currently expose this legacy column. Keep it
        // zero and retain the internal estimate only in service diagnostics.
        estimated_cost_usd: 0,
        diagnostics,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    if (completion.error) {
      throw completion.error;
    }
    return json(request, {
      ok: true,
      run: {
        run_id: runId,
        status: partial ? "PARTIAL" : "COMPLETED",
        stage: "completed",
      },
      candidates_accepted: accepted,
      candidates_rejected: rejected,
      provider_requests: publicWebProviderRequests,
      ai_classifications: 0,
      estimated_cost_usd: 0,
      emails_sent: 0,
      notifications_created: 0,
      registry_coverage: registryCoverage.map((item) => ({
        country_code: item.countryCode,
        provider_code: item.providerCode,
        status: item.status,
      })),
    });
  } catch (error) {
    const errorCode =
      String(error instanceof Error ? error.message : "DISCOVERY_FAILED")
        .toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80) ||
      "DISCOVERY_FAILED";
    await admin.from("external_prospect_discovery_runs").update({
      status: "FAILED",
      stage: "failed",
      error_code: errorCode,
      ai_classifications: 0,
      provider_requests: publicWebProviderRequests,
      estimated_cost_usd: 0,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    console.error("external prospect discovery failed", {
      run_id: runId,
      error_code: errorCode,
    });
    return json(request, {
      error: "Prospect discovery could not be completed.",
      run_id: runId,
    }, 503);
  }
}

export {
  handleDiscovery as handleExternalProspectDiscoveryRequest,
  structuredTexts,
};

if (import.meta.main) Deno.serve(handleDiscovery);

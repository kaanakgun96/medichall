import type { ProductFamilyProfile } from "./buyer-discovery-relevance-v2.ts";
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeHttpsUrl,
  type ProspectCandidate,
  sanitizeEvidenceText,
} from "./external-prospect-discovery.ts";
import { readBoundedResponseBody } from "./safe-public-fetch.ts";

export const PUBLIC_WEB_DISCOVERY_LIMITS = Object.freeze({
  maximumQueries: 6,
  maximumResultsPerQuery: 6,
  maximumRawResults: 36,
  maximumCandidates: 20,
  maximumResponseBytes: 512_000,
  maximumConcurrency: 2,
  requestTimeoutMs: 6_500,
  successfulCacheDays: 14,
  zeroResultCacheDays: 7,
  unavailableCacheMinutes: 15,
  braveRequestCostUsd: 0.005,
  maximumCostUsdPerRun: 0.03,
});

export type PublicWebSearchQuery = {
  variant: number;
  query: string;
  country: string;
  language: string;
  uiLanguage: string;
};

export type PublicWebCandidate = {
  name: string;
  pageUrl: string;
  canonicalDomain: string;
  countryCode: string | null;
};

export type PublicWebQueryBatch = {
  query: PublicWebSearchQuery;
  status: "ACTIVE" | "ZERO_RESULTS" | "UNAVAILABLE";
  statusCode: number | null;
  latencyMs: number;
  resultsReceived: number;
  rejectedCount: number;
  candidates: PublicWebCandidate[];
  errorCode: string | null;
};

export type PublicWebSearchInput = {
  queries: PublicWebSearchQuery[];
  maxResults: number;
  timeoutMs: number;
};

export type PublicWebSearchOutput = {
  batches: PublicWebQueryBatch[];
  requestsMade: number;
  circuitOpen: boolean;
};

export interface PublicWebDiscoveryProvider {
  readonly code: string;
  searchCompanies(input: PublicWebSearchInput): Promise<PublicWebSearchOutput>;
}

export type PublicWebCacheEntry = {
  providerCode: string;
  requestKeyHash: string;
  productFamilyKey: string;
  countryCode: string;
  searchLanguage: string;
  queryVariant: number;
  status: "ACTIVE" | "ZERO_RESULTS" | "UNAVAILABLE";
  candidates: PublicWebCandidate[];
  fetchedAt: string;
  expiresAt: string;
  errorCode: string | null;
};

export interface PublicWebDiscoveryCache {
  read(
    providerCode: string,
    requestKeyHash: string,
    now: Date,
  ): Promise<PublicWebCacheEntry | null>;
  write(entry: PublicWebCacheEntry): Promise<void>;
}

export type PublicWebDiscoveryResult = {
  enabled: boolean;
  providerCode: string | null;
  status: "DISABLED" | "ACTIVE" | "LIMITED" | "CONFIGURATION_UNAVAILABLE";
  candidates: PublicWebCandidate[];
  queriesPlanned: number;
  queriesUsed: number;
  resultsReceived: number;
  candidatesCreated: number;
  cacheHits: number;
  cacheMisses: number;
  providerRequests: number;
  providerCostEstimateUsd: number;
  providerLatencyMs: number[];
  providerStatusCodes: Record<string, number>;
  rejectionReasons: Record<string, number>;
  unavailable: boolean;
  circuitOpen: boolean;
};

type ReviewedTerms = Record<string, string[]>;

const EQUIPMENT_COVER_TERMS: Record<string, ReviewedTerms> = {
  camera: {
    en: [
      "camera cover",
      "sterile camera cover",
      "camera drape",
      "camera sleeve",
    ],
    it: ["copri telecamera", "copertura telecamera", "guaina telecamera"],
    fr: ["housse caméra", "gaine caméra"],
    es: ["funda de cámara", "cubierta de cámara"],
    de: ["Kameraabdeckung", "Kamerahülle"],
    nl: ["steriele camerahoes", "camerahoes"],
  },
  c_arm: {
    en: ["c-arm cover", "c-arm drape", "sterile c-arm cover"],
    it: ["copertura sterile arco a C", "telo arco a C"],
    fr: ["housse arceau chirurgical", "housse amplificateur de brillance"],
    es: ["funda estéril arco en C", "funda para arco en C"],
    de: ["C-Bogen Abdeckung", "sterile C-Bogen Hülle"],
    nl: ["steriele C-boog hoes", "C-boog afdekhoes"],
  },
  microscope: {
    en: ["microscope cover", "microscope drape", "sterile microscope cover"],
    it: ["copri microscopio", "telo sterile microscopio"],
    fr: ["housse microscope", "housse stérile microscope"],
    es: ["funda de microscopio", "cubierta estéril de microscopio"],
    de: ["Mikroskopabdeckung", "sterile Mikroskophülle"],
    nl: ["steriele microscoophoes", "microscoop afdekhoes"],
  },
  equipment: {
    en: ["sterile medical equipment cover", "sterile equipment drape"],
    it: ["copertura sterile apparecchiatura medica"],
    fr: ["housse stérile équipement médical"],
    es: ["funda estéril para equipo médico"],
    de: ["sterile Medizingeräteabdeckung"],
    nl: ["steriele hoes medische apparatuur"],
  },
};

const MARKET_LOCALES = Object.freeze([
  { country: "GB", language: "en", uiLanguage: "en-GB", context: "medical" },
  { country: "IT", language: "it", uiLanguage: "it-IT", context: "medicale" },
  { country: "FR", language: "fr", uiLanguage: "fr-FR", context: "médical" },
  { country: "ES", language: "es", uiLanguage: "es-ES", context: "médico" },
  { country: "DE", language: "de", uiLanguage: "de-DE", context: "medizin" },
  { country: "NL", language: "nl", uiLanguage: "nl-NL", context: "medisch" },
]);

const REJECTED_DOMAINS = [
  "alibaba.com",
  "amazon.com",
  "bing.com",
  "brave.com",
  "crunchbase.com",
  "duckduckgo.com",
  "europages.com",
  "facebook.com",
  "google.com",
  "indiamart.com",
  "instagram.com",
  "kompass.com",
  "linkedin.com",
  "made-in-china.com",
  "medicalexpo.com",
  "pinterest.com",
  "tiktok.com",
  "wikipedia.org",
  "x.com",
  "youtube.com",
];

const COMPANY_SUFFIX =
  /\b(?:s\.?r\.?l\.?|s\.?a\.?s\.?|s\.?a\.?|gmbh|b\.?v\.?|ltd\.?|limited|inc\.?|llc|ag|spa|s\.p\.a\.|medical|medikal|healthcare|hospital)\b/i;

function normalizeProductText(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function equipmentCoverVariant(profile: ProductFamilyProfile): string {
  const label = normalizeProductText(profile.label);
  if (/\bc arm\b|fluoroscop/.test(label)) return "c_arm";
  if (/microscope/.test(label)) return "microscope";
  if (/camera/.test(label)) return "camera";
  return "equipment";
}

function localizedTerm(
  profile: ProductFamilyProfile,
  language: string,
  variant: number,
): string {
  if (profile.key === "sterile-equipment-cover-family") {
    const terms =
      EQUIPMENT_COVER_TERMS[equipmentCoverVariant(profile)]?.[language] ||
      EQUIPMENT_COVER_TERMS[equipmentCoverVariant(profile)]?.en || [];
    if (terms.length) return terms[variant % terms.length];
  }
  const approved = profile.directTerms.filter((term) =>
    term.length >= 4 && term.length <= 80 && term.split(" ").length <= 8
  );
  return approved[variant % Math.max(1, approved.length)] || profile.label;
}

function queryFor(
  term: string,
  context: string,
  profile: ProductFamilyProfile,
  includeProcedurePack: boolean,
): string {
  const boundedTerm = sanitizeEvidenceText(term, 80).replace(/["\\]/g, " ")
    .replace(/\s+/g, " ").trim();
  const procedureContext = includeProcedurePack && profile.componentFitLabel &&
      /camera|cover|drape/i.test(boundedTerm)
    ? ' "procedure pack"'
    : "";
  return `"${boundedTerm}" ${context}${procedureContext}`.slice(0, 240);
}

export function buildPublicWebSearchPlan(input: {
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  maximumQueries?: number;
}): PublicWebSearchQuery[] {
  const maximum = Math.max(
    1,
    Math.min(
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
      Math.trunc(
        input.maximumQueries || PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
      ),
    ),
  );
  const wanted = new Set(
    input.targetCountries.map((item) => item.toUpperCase()),
  );
  let locales = input.targetCountries.length
    ? MARKET_LOCALES.filter((item) => wanted.has(item.country))
    : [...MARKET_LOCALES];
  if (!locales.length) {
    locales = [{
      country: input.targetCountries[0] || "GB",
      language: "en",
      uiLanguage: "en-GB",
      context: "medical",
    }];
  }
  const plan: PublicWebSearchQuery[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const locale = locales[index % locales.length];
    const termVariant = Math.floor(index / locales.length);
    const term = localizedTerm(
      input.productFamily,
      locale.language,
      termVariant,
    );
    const query = queryFor(
      term,
      locale.context,
      input.productFamily,
      termVariant > 0,
    );
    if (
      !query ||
      plan.some((item) =>
        item.query === query && item.country === locale.country &&
        item.language === locale.language
      )
    ) continue;
    plan.push({
      variant: plan.length,
      query,
      country: locale.country,
      language: locale.language,
      uiLanguage: locale.uiLanguage,
    });
    if (plan.length >= maximum) break;
  }
  return plan;
}

function isRejectedDomain(domain: string): boolean {
  if (!domain || /(?:^|\.)(?:localhost|local|invalid|example)$/.test(domain)) {
    return true;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain) || domain.includes(":")) {
    return true;
  }
  return REJECTED_DOMAINS.some((item) =>
    domain === item || domain.endsWith(`.${item}`)
  );
}

function inferCountryFromDomain(domain: string): string | null {
  const suffixes: Record<string, string> = {
    ".it": "IT",
    ".fr": "FR",
    ".es": "ES",
    ".de": "DE",
    ".nl": "NL",
    ".co.uk": "GB",
    ".uk": "GB",
  };
  return Object.entries(suffixes).find(([suffix]) => domain.endsWith(suffix))
    ?.[1] ||
    null;
}

export function normalizePublicWebResult(
  value: unknown,
): PublicWebCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const normalizedUrl = normalizeHttpsUrl(row.pageUrl || row.url);
  if (!normalizedUrl) return null;
  const url = new URL(normalizedUrl);
  if (/\.pdf$/i.test(url.pathname)) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  const pageUrl = url.href.slice(0, 1000);
  const canonicalDomain = normalizeDomain(pageUrl);
  if (!canonicalDomain || isRejectedDomain(canonicalDomain)) return null;
  const profile = row.profile && typeof row.profile === "object" &&
      !Array.isArray(row.profile)
    ? row.profile as Record<string, unknown>
    : {};
  const rawTitle = sanitizeEvidenceText(
    row.name || profile.long_name || row.title || canonicalDomain.split(".")[0],
    180,
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const titleSegments = rawTitle.split(/\s+[|–—]\s+|\s+-\s+/).map((item) =>
    item.trim()
  ).filter(Boolean);
  const companySegment =
    titleSegments.find((item) => COMPANY_SUFFIX.test(item)) ||
    titleSegments.at(-1) || rawTitle;
  const name = sanitizeEvidenceText(companySegment, 180) || canonicalDomain;
  if (!normalizeCompanyName(name)) return null;
  return {
    name,
    pageUrl,
    canonicalDomain,
    countryCode: inferCountryFromDomain(canonicalDomain),
  };
}

function normalizedCandidates(values: unknown[], maximum: number): {
  candidates: PublicWebCandidate[];
  rejected: number;
} {
  const byDomain = new Map<string, PublicWebCandidate>();
  let rejected = 0;
  for (const value of values) {
    const candidate = normalizePublicWebResult(value);
    if (!candidate) {
      rejected += 1;
      continue;
    }
    if (!byDomain.has(candidate.canonicalDomain)) {
      byDomain.set(candidate.canonicalDomain, candidate);
    }
    if (byDomain.size >= maximum) break;
  }
  return { candidates: [...byDomain.values()], rejected };
}

function statusCodeKey(value: number | null): string {
  return value == null ? "NETWORK" : String(value);
}

export function createBraveSearchProvider(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}): PublicWebDiscoveryProvider {
  const apiKey = String(input.apiKey || "").trim();
  const fetchImpl = input.fetchImpl || fetch;
  const endpoint = input.endpoint ||
    "https://api.search.brave.com/res/v1/web/search";
  return {
    code: "BRAVE_SEARCH_API",
    async searchCompanies(searchInput): Promise<PublicWebSearchOutput> {
      const batches: PublicWebQueryBatch[] = [];
      let requestsMade = 0;
      let circuitOpen = false;
      let repeatedServerErrors = 0;
      const queries = searchInput.queries.slice(
        0,
        PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
      );
      const runOne = async (query: PublicWebSearchQuery) => {
        if (circuitOpen) return;
        requestsMade += 1;
        const started = performance.now();
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          searchInput.timeoutMs,
        );
        try {
          const url = new URL(endpoint);
          url.searchParams.set("q", query.query);
          url.searchParams.set("country", query.country);
          url.searchParams.set("search_lang", query.language);
          url.searchParams.set("ui_lang", query.uiLanguage);
          url.searchParams.set(
            "count",
            String(Math.max(
              1,
              Math.min(
                PUBLIC_WEB_DISCOVERY_LIMITS.maximumResultsPerQuery,
                searchInput.maxResults,
              ),
            )),
          );
          url.searchParams.set("safesearch", "strict");
          url.searchParams.set("spellcheck", "false");
          url.searchParams.set("result_filter", "web");
          url.searchParams.set("extra_snippets", "false");
          const response = await fetchImpl(url, {
            headers: {
              "Accept": "application/json",
              "X-Subscription-Token": apiKey,
            },
            signal: controller.signal,
          });
          const latencyMs = Math.round(performance.now() - started);
          if (!response.ok) {
            await response.body?.cancel();
            const errorCode = response.status === 429
              ? "PROVIDER_RATE_LIMIT_OR_QUOTA"
              : response.status >= 500
              ? "PROVIDER_SERVER_ERROR"
              : "PROVIDER_HTTP_ERROR";
            if (response.status === 429) circuitOpen = true;
            if (response.status >= 500) {
              repeatedServerErrors += 1;
              if (repeatedServerErrors >= 2) circuitOpen = true;
            }
            batches.push({
              query,
              status: "UNAVAILABLE",
              statusCode: response.status,
              latencyMs,
              resultsReceived: 0,
              rejectedCount: 0,
              candidates: [],
              errorCode,
            });
            return;
          }
          let payload: unknown;
          try {
            const body = await readBoundedResponseBody(
              response,
              PUBLIC_WEB_DISCOVERY_LIMITS.maximumResponseBytes,
            );
            payload = JSON.parse(new TextDecoder().decode(body.bytes));
          } catch (_) {
            batches.push({
              query,
              status: "UNAVAILABLE",
              statusCode: response.status,
              latencyMs,
              resultsReceived: 0,
              rejectedCount: 0,
              candidates: [],
              errorCode: "PROVIDER_MALFORMED_RESPONSE",
            });
            return;
          }
          if (
            !payload || typeof payload !== "object" || Array.isArray(payload)
          ) {
            batches.push({
              query,
              status: "UNAVAILABLE",
              statusCode: response.status,
              latencyMs,
              resultsReceived: 0,
              rejectedCount: 0,
              candidates: [],
              errorCode: "PROVIDER_MALFORMED_RESPONSE",
            });
            return;
          }
          const web = (payload as Record<string, unknown>).web;
          const results = web && typeof web === "object" && !Array.isArray(web)
            ? (web as Record<string, unknown>).results
            : [];
          if (!Array.isArray(results)) {
            batches.push({
              query,
              status: "UNAVAILABLE",
              statusCode: response.status,
              latencyMs,
              resultsReceived: 0,
              rejectedCount: 0,
              candidates: [],
              errorCode: "PROVIDER_MALFORMED_RESPONSE",
            });
            return;
          }
          const boundedResults = results.slice(
            0,
            Math.max(
              1,
              Math.min(
                PUBLIC_WEB_DISCOVERY_LIMITS.maximumResultsPerQuery,
                searchInput.maxResults,
              ),
            ),
          );
          const normalized = normalizedCandidates(
            boundedResults,
            searchInput.maxResults,
          );
          batches.push({
            query,
            status: normalized.candidates.length ? "ACTIVE" : "ZERO_RESULTS",
            statusCode: response.status,
            latencyMs,
            resultsReceived: boundedResults.length,
            rejectedCount: normalized.rejected,
            candidates: normalized.candidates,
            errorCode: null,
          });
        } catch (error) {
          batches.push({
            query,
            status: "UNAVAILABLE",
            statusCode: null,
            latencyMs: Math.round(performance.now() - started),
            resultsReceived: 0,
            rejectedCount: 0,
            candidates: [],
            errorCode:
              error instanceof DOMException && error.name === "AbortError"
                ? "PROVIDER_TIMEOUT"
                : "PROVIDER_NETWORK_ERROR",
          });
        } finally {
          clearTimeout(timeout);
        }
      };
      for (
        let index = 0;
        index < queries.length && !circuitOpen;
        index += PUBLIC_WEB_DISCOVERY_LIMITS.maximumConcurrency
      ) {
        await Promise.all(
          queries.slice(
            index,
            index + PUBLIC_WEB_DISCOVERY_LIMITS.maximumConcurrency,
          )
            .map(runOne),
        );
      }
      return { batches, requestsMade, circuitOpen };
    },
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes)).map((item) =>
    item.toString(16).padStart(2, "0")
  ).join("");
}

export async function publicWebRequestKey(
  providerCode: string,
  productFamilyKey: string,
  query: PublicWebSearchQuery,
): Promise<string> {
  return await sha256([
    "public-web-v1",
    providerCode,
    productFamilyKey,
    query.country,
    query.language,
    query.variant,
    query.query,
  ].join("|"));
}

function expiryFor(status: PublicWebCacheEntry["status"], now: Date): string {
  const milliseconds = status === "ACTIVE"
    ? PUBLIC_WEB_DISCOVERY_LIMITS.successfulCacheDays * 86_400_000
    : status === "ZERO_RESULTS"
    ? PUBLIC_WEB_DISCOVERY_LIMITS.zeroResultCacheDays * 86_400_000
    : PUBLIC_WEB_DISCOVERY_LIMITS.unavailableCacheMinutes * 60_000;
  return new Date(now.getTime() + milliseconds).toISOString();
}

function deduplicatePublicWebCandidates(
  candidates: PublicWebCandidate[],
): PublicWebCandidate[] {
  const byDomain = new Map<string, PublicWebCandidate>();
  for (const candidate of candidates) {
    if (!byDomain.has(candidate.canonicalDomain)) {
      byDomain.set(candidate.canonicalDomain, candidate);
    }
    if (byDomain.size >= PUBLIC_WEB_DISCOVERY_LIMITS.maximumCandidates) break;
  }
  return [...byDomain.values()];
}

export async function runPublicWebDiscovery(input: {
  enabled: boolean;
  provider: PublicWebDiscoveryProvider | null;
  cache: PublicWebDiscoveryCache;
  productFamily: ProductFamilyProfile;
  targetCountries: string[];
  maximumQueries?: number;
  maximumCostUsd?: number;
  now?: Date;
}): Promise<PublicWebDiscoveryResult> {
  const empty = (
    status: PublicWebDiscoveryResult["status"],
  ): PublicWebDiscoveryResult => ({
    enabled: input.enabled,
    providerCode: input.provider?.code || null,
    status,
    candidates: [],
    queriesPlanned: 0,
    queriesUsed: 0,
    resultsReceived: 0,
    candidatesCreated: 0,
    cacheHits: 0,
    cacheMisses: 0,
    providerRequests: 0,
    providerCostEstimateUsd: 0,
    providerLatencyMs: [],
    providerStatusCodes: {},
    rejectionReasons: {},
    unavailable: status === "CONFIGURATION_UNAVAILABLE",
    circuitOpen: false,
  });
  if (!input.enabled) return empty("DISABLED");
  if (!input.provider) return empty("CONFIGURATION_UNAVAILABLE");
  const now = input.now || new Date();
  const maximumCost = Math.max(
    0,
    Math.min(
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumCostUsdPerRun,
      input.maximumCostUsd ?? PUBLIC_WEB_DISCOVERY_LIMITS.maximumCostUsdPerRun,
    ),
  );
  const costBoundedQueries = Math.floor(
    maximumCost / PUBLIC_WEB_DISCOVERY_LIMITS.braveRequestCostUsd + 1e-9,
  );
  const maximumQueries = Math.min(
    PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
    Math.max(
      0,
      input.maximumQueries ?? PUBLIC_WEB_DISCOVERY_LIMITS.maximumQueries,
    ),
    costBoundedQueries,
  );
  const queries = buildPublicWebSearchPlan({
    productFamily: input.productFamily,
    targetCountries: input.targetCountries,
    maximumQueries: Math.max(1, maximumQueries || 1),
  }).slice(0, maximumQueries);
  const cachedCandidates: PublicWebCandidate[] = [];
  const missing: PublicWebSearchQuery[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let cachedUnavailable = false;
  for (const query of queries) {
    const requestKeyHash = await publicWebRequestKey(
      input.provider.code,
      input.productFamily.key,
      query,
    );
    let cached: PublicWebCacheEntry | null = null;
    try {
      cached = await input.cache.read(input.provider.code, requestKeyHash, now);
    } catch (_) {
      cached = null;
    }
    if (cached) {
      cacheHits += 1;
      cachedCandidates.push(...cached.candidates);
      cachedUnavailable ||= cached.status === "UNAVAILABLE";
    } else {
      cacheMisses += 1;
      missing.push(query);
    }
  }
  let providerExecutionFailed = false;
  let providerOutput: PublicWebSearchOutput = {
    batches: [],
    requestsMade: 0,
    circuitOpen: false,
  };
  if (missing.length) {
    try {
      providerOutput = await input.provider.searchCompanies({
        queries: missing,
        maxResults: PUBLIC_WEB_DISCOVERY_LIMITS.maximumResultsPerQuery,
        timeoutMs: PUBLIC_WEB_DISCOVERY_LIMITS.requestTimeoutMs,
      });
    } catch (_) {
      providerExecutionFailed = true;
    }
  }
  const freshCandidates: PublicWebCandidate[] = [];
  const statusCodes: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  let unavailable = cachedUnavailable || providerExecutionFailed;
  if (providerExecutionFailed) {
    rejectionReasons.PROVIDER_EXECUTION_FAILED = 1;
  }
  for (const batch of providerOutput.batches) {
    freshCandidates.push(...batch.candidates);
    unavailable ||= batch.status === "UNAVAILABLE";
    const code = statusCodeKey(batch.statusCode);
    statusCodes[code] = (statusCodes[code] || 0) + 1;
    if (batch.errorCode) {
      rejectionReasons[batch.errorCode] =
        (rejectionReasons[batch.errorCode] || 0) + 1;
    }
    if (batch.rejectedCount) {
      rejectionReasons.FILTERED_NON_COMPANY_RESULT =
        (rejectionReasons.FILTERED_NON_COMPANY_RESULT || 0) +
        batch.rejectedCount;
    }
    const requestKeyHash = await publicWebRequestKey(
      input.provider.code,
      input.productFamily.key,
      batch.query,
    );
    const entry: PublicWebCacheEntry = {
      providerCode: input.provider.code,
      requestKeyHash,
      productFamilyKey: input.productFamily.key,
      countryCode: batch.query.country,
      searchLanguage: batch.query.language,
      queryVariant: batch.query.variant,
      status: batch.status,
      candidates: batch.candidates,
      fetchedAt: now.toISOString(),
      expiresAt: expiryFor(batch.status, now),
      errorCode: batch.errorCode,
    };
    try {
      await input.cache.write(entry);
    } catch (_) {
      rejectionReasons.CACHE_WRITE_UNAVAILABLE =
        (rejectionReasons.CACHE_WRITE_UNAVAILABLE || 0) + 1;
    }
  }
  if (
    providerOutput.circuitOpen && providerOutput.requestsMade < missing.length
  ) {
    unavailable = true;
    rejectionReasons.PROVIDER_CIRCUIT_OPEN = missing.length -
      providerOutput.requestsMade;
  }
  const candidates = deduplicatePublicWebCandidates([
    ...cachedCandidates,
    ...freshCandidates,
  ]);
  const resultsReceived = cachedCandidates.length +
    providerOutput.batches.reduce(
      (total, batch) => total + batch.resultsReceived,
      0,
    );
  return {
    enabled: true,
    providerCode: input.provider.code,
    status: unavailable ? "LIMITED" : "ACTIVE",
    candidates,
    queriesPlanned: queries.length,
    queriesUsed: cacheHits + providerOutput.requestsMade,
    resultsReceived,
    candidatesCreated: candidates.length,
    cacheHits,
    cacheMisses,
    providerRequests: providerOutput.requestsMade,
    providerCostEstimateUsd: Number(
      (providerOutput.requestsMade *
        PUBLIC_WEB_DISCOVERY_LIMITS.braveRequestCostUsd)
        .toFixed(6),
    ),
    providerLatencyMs: providerOutput.batches.map((item) => item.latencyMs),
    providerStatusCodes: statusCodes,
    rejectionReasons,
    unavailable,
    circuitOpen: providerOutput.circuitOpen,
  };
}

export function publicWebCandidatesToProspects(input: {
  candidates: PublicWebCandidate[];
  taxonomyIds: number[];
  targetCountries: string[];
  partnerTypes: string[];
}): ProspectCandidate[] {
  const wantedTypes = input.partnerTypes.map((item) => item.toLowerCase());
  return input.candidates.slice(
    0,
    PUBLIC_WEB_DISCOVERY_LIMITS.maximumCandidates,
  )
    .map((candidate) => ({
      name: candidate.name,
      countryCode: candidate.countryCode,
      countryName: null,
      cityRegion: null,
      companyType: "Unknown" as const,
      websiteUrl: candidate.pageUrl,
      registryIdentifier: null,
      description: null,
      evidence: [],
      activities: [],
      taxonomyIds: input.taxonomyIds,
      taxonomyRelation: "none" as const,
      targetCountry: Boolean(
        candidate.countryCode &&
          input.targetCountries.includes(candidate.countryCode),
      ),
      preferredCompanyType: wantedTypes.length === 0,
      relatedAwardCount: 0,
      lastEvidenceAt: null,
      discoverySources: ["PUBLIC_WEB" as const],
      websiteVerificationUrls: [candidate.pageUrl],
    }));
}

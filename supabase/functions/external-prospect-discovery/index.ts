/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  boundedTedSearchPlan,
  chooseTrustedCompanyIdentity,
  type CompanyIdentityConfidence,
  companyIdentityKeys,
  type CompanyIdentitySource,
  deduplicateCandidates,
  DISCOVERY_LIMITS,
  EUROPE_DISCOVERY_COUNTRIES,
  mergeProspectCandidate,
  normalizeCompanyName,
  normalizeCpv,
  normalizeDomain,
  normalizeHttpsUrl,
  type OrganizationType,
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
import {
  buildTemporaryProductFamilyProfile,
  resolveProductIntentDeterministically,
  unmappedWebsiteProductSuggestions,
} from "../_shared/unknown-product-resolution.ts";
import {
  callSmartProductResolver,
  DEFAULT_SMART_PRODUCT_RESOLVER_MODEL,
  SMART_PRODUCT_RESOLVER_IMPLEMENTATION_VERSION,
  SMART_PRODUCT_RESOLVER_LIMITS,
  SMART_PRODUCT_RESOLVER_VERSION,
  smartResolutionFromOutput,
  technicalResolverFailure,
  validateSmartResolverInput,
  validateSmartResolverOutput,
} from "../_shared/smart-product-resolver.ts";
import {
  AI_BUYER_RELEVANCE_JUDGE_IMPLEMENTATION_VERSION,
  AI_BUYER_RELEVANCE_JUDGE_VERSION,
  aiBuyerJudgeCacheId,
  AiBuyerJudgeCacheOperationError,
  type AiBuyerJudgeCandidate,
  aiBuyerJudgeCompletionMatches,
  type AiBuyerJudgeProductContext,
  type AiBuyerJudgeProviderResult,
  type AiBuyerRelevanceJudgment,
  type AiBuyerReviewedScore,
  DEFAULT_AI_BUYER_RELEVANCE_JUDGE_MODEL,
  runAiBuyerRelevanceJudge,
} from "../_shared/ai-buyer-relevance-judge.ts";
import { normalizeRetrievalTerm } from "../_shared/unmapped-product-terminology.ts";
import {
  ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_IMPLEMENTATION_VERSION,
  ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_VERSION,
  type AdaptiveMedicalRetrievalIntelligence,
  adaptiveRetrievalCacheId,
  AdaptiveRetrievalProviderError,
  type AdaptiveRetrievalValidationDiagnostics,
  callAdaptiveRetrievalIntelligence,
  DEFAULT_ADAPTIVE_MEDICAL_RETRIEVAL_MODEL,
  validateAdaptiveRetrievalIntelligenceWithDiagnostics,
} from "../_shared/adaptive-medical-commercial-retrieval.ts";
import {
  buildDiscoverySearchPlan,
  buildPartitionPersistenceRows,
  classifyDiscoveryResultState,
  type DiscoveryResultState,
  type DiscoveryRunMode,
  discoverySaturation,
  freshDiscoveryMessage,
  type SearchPartitionHistory,
} from "../_shared/buyer-discovery-search-space.ts";

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
const LEGACY_QUERY_PROGRESS_LIMIT = 16;

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

function aiBuyerJudgeRpcError(
  operation: "RESERVATION" | "COMPLETION" | "FAILURE_WRITE",
  value: unknown,
): AiBuyerJudgeCacheOperationError {
  const rawCode = structuredFirst(record(value).code, 32).toUpperCase();
  const sqlState = rawCode.replace(/[^A-Z0-9]/g, "_").slice(0, 32) ||
    "UNKNOWN";
  const retryable = /^(?:08|53|57P0)/.test(rawCode) ||
    ["55P03", "57014", "PGRST000", "PGRST001", "PGRST002", "PGRST003"]
      .includes(rawCode);
  return new AiBuyerJudgeCacheOperationError(
    `AI_BUYER_JUDGE_${operation}_${sqlState}`,
    retryable,
  );
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

type AdaptiveRetrievalRuntime = {
  intelligence: AdaptiveMedicalRetrievalIntelligence | null;
  diagnostics: {
    enabled: boolean;
    source: "DISABLED" | "AI" | "CACHED_AI" | "ADAPTIVE_RETRIEVAL_FALLBACK";
    version: string;
    implementationVersion: string;
    model: string | null;
    providerRequests: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    latencyMs: number;
    cacheHit: boolean;
    fallbackReason: string | null;
    validation: AdaptiveRetrievalValidationDiagnostics | null;
    cacheFailureRecorded: boolean | null;
  };
};

export async function failAdaptiveRetrievalCacheLease(
  // deno-lint-ignore no-explicit-any -- Edge client has no generated DB schema.
  admin: any,
  cacheId: unknown,
  errorCode: string,
): Promise<{ terminal: boolean; attempts: number }> {
  const opaqueCacheId = adaptiveRetrievalCacheId(cacheId);
  if (!opaqueCacheId) return { terminal: false, attempts: 0 };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await admin.rpc("fail_adaptive_medical_retrieval_v1", {
      p_cache_id: opaqueCacheId,
      p_error_code: errorCode,
    });
    if (!result.error) return { terminal: true, attempts: attempt };
  }
  return { terminal: false, attempts: 2 };
}

async function resolveAdaptiveRetrievalRuntime(input: {
  // deno-lint-ignore no-explicit-any -- this Edge client has no generated DB schema.
  admin: any;
  sourceText: string;
  canonicalConcept: string;
  productFamily: string;
  commercialTerms: string[];
  resolverVersion: string;
  inputLanguage: string;
}): Promise<AdaptiveRetrievalRuntime> {
  const base: AdaptiveRetrievalRuntime["diagnostics"] = {
    enabled: false,
    source: "DISABLED",
    version: ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_VERSION,
    implementationVersion:
      ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_IMPLEMENTATION_VERSION,
    model: null,
    providerRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: 0,
    cacheHit: false,
    fallbackReason: null,
    validation: null,
    cacheFailureRecorded: null,
  };
  const feature = await input.admin.from(
    "adaptive_medical_retrieval_feature_state",
  ).select(
    "adaptive_medical_commercial_retrieval_enabled,retrieval_version,implementation_version,model_name,maximum_cost_usd",
  ).eq("singleton", true).maybeSingle();
  if (feature.error) {
    return {
      intelligence: null,
      diagnostics: {
        ...base,
        source: "ADAPTIVE_RETRIEVAL_FALLBACK",
        fallbackReason: "ADAPTIVE_FEATURE_STATE_UNAVAILABLE",
      },
    };
  }
  const state = record(feature.data);
  if (
    state.adaptive_medical_commercial_retrieval_enabled !== true ||
    first(state.retrieval_version) !==
      ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_VERSION
  ) return { intelligence: null, diagnostics: base };

  const model = first(state.model_name) ||
    DEFAULT_ADAPTIVE_MEDICAL_RETRIEVAL_MODEL;
  const maximumCostUsd = Math.min(
    0.005,
    Math.max(0, Number(state.maximum_cost_usd) || 0.005),
  );
  const retrievalKeyHash = await sha256([
    normalizeRetrievalTerm(input.sourceText),
    normalizeRetrievalTerm(input.canonicalConcept),
    normalizeRetrievalTerm(input.productFamily),
    input.resolverVersion,
    ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_VERSION,
    ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_IMPLEMENTATION_VERSION,
    model,
  ].join("|"));
  const reserved = await input.admin.rpc(
    "reserve_adaptive_medical_retrieval_v1",
    {
      p_retrieval_key_hash: retrievalKeyHash,
      p_canonical_concept: input.canonicalConcept,
      p_product_family: input.productFamily,
      p_resolver_version: input.resolverVersion,
      p_retrieval_version: ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_VERSION,
    },
  );
  if (reserved.error) {
    return {
      intelligence: null,
      diagnostics: {
        ...base,
        enabled: true,
        source: "ADAPTIVE_RETRIEVAL_FALLBACK",
        model,
        fallbackReason: "ADAPTIVE_RESERVATION_FAILED",
      },
    };
  }
  const reservation = record(reserved.data);
  const decision = first(reservation.decision);
  if (decision === "CACHED") {
    try {
      const validated = validateAdaptiveRetrievalIntelligenceWithDiagnostics(
        reservation.structured_result,
        {
          canonicalConcept: input.canonicalConcept,
          productFamily: input.productFamily,
          commercialTerms: input.commercialTerms,
        },
      );
      return {
        intelligence: validated.intelligence,
        diagnostics: {
          ...base,
          enabled: true,
          source: "CACHED_AI",
          model: first(reservation.model_name) || model,
          cacheHit: true,
          validation: validated.diagnostics,
        },
      };
    } catch {
      return {
        intelligence: null,
        diagnostics: {
          ...base,
          enabled: true,
          source: "ADAPTIVE_RETRIEVAL_FALLBACK",
          model,
          fallbackReason: "ADAPTIVE_CACHE_INVALID",
        },
      };
    }
  }
  if (decision !== "PROCEED") {
    return {
      intelligence: null,
      diagnostics: {
        ...base,
        enabled: true,
        source: "ADAPTIVE_RETRIEVAL_FALLBACK",
        model,
        fallbackReason: decision === "DISABLED"
          ? "ADAPTIVE_DISABLED_DURING_RESERVATION"
          : `ADAPTIVE_${decision || "RESERVATION_UNAVAILABLE"}`,
      },
    };
  }

  const cacheId = adaptiveRetrievalCacheId(reservation.cache_id);
  if (!cacheId) {
    return {
      intelligence: null,
      diagnostics: {
        ...base,
        enabled: true,
        source: "ADAPTIVE_RETRIEVAL_FALLBACK",
        model,
        fallbackReason: "ADAPTIVE_CACHE_ID_INVALID",
      },
    };
  }
  let providerRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let latencyMs = 0;
  try {
    if ((Deno.env.get("ANTHROPIC_API_KEY") || "").trim()) {
      providerRequests = 1;
    }
    const result = await callAdaptiveRetrievalIntelligence({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "",
      sourceText: input.sourceText,
      canonicalConcept: input.canonicalConcept,
      productFamily: input.productFamily,
      commercialTerms: input.commercialTerms,
      inputLanguage: input.inputLanguage,
      model,
      maximumCostUsd,
      inputUsdPerMillion: boundedEnvironmentNumber(
        Deno.env.get("ANTHROPIC_INPUT_USD_PER_MILLION"),
        1,
        0,
        100,
      ),
      outputUsdPerMillion: boundedEnvironmentNumber(
        Deno.env.get("ANTHROPIC_OUTPUT_USD_PER_MILLION"),
        5,
        0,
        100,
      ),
    });
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    estimatedCostUsd = result.estimatedCostUsd;
    latencyMs = result.latencyMs;
    const completed = await input.admin.rpc(
      "complete_adaptive_medical_retrieval_v1",
      {
        p_cache_id: cacheId,
        p_structured_result: result.intelligence,
        p_model_name: result.model,
        p_provider_request_id: result.providerRequestId,
        p_input_tokens: result.inputTokens,
        p_output_tokens: result.outputTokens,
        p_total_tokens: result.totalTokens,
        p_estimated_cost_usd: result.estimatedCostUsd,
        p_latency_ms: result.latencyMs,
      },
    );
    if (completed.error) throw new Error("ADAPTIVE_CACHE_COMPLETION_FAILED");
    return {
      intelligence: result.intelligence,
      diagnostics: {
        ...base,
        enabled: true,
        source: "AI",
        model: result.model,
        providerRequests,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        latencyMs,
        validation: result.validationDiagnostics,
      },
    };
  } catch (error) {
    if (error instanceof AdaptiveRetrievalProviderError) {
      inputTokens = error.telemetry.inputTokens;
      outputTokens = error.telemetry.outputTokens;
      estimatedCostUsd = error.telemetry.estimatedCostUsd;
      latencyMs = error.telemetry.latencyMs;
    }
    const code = String(
      error instanceof Error ? error.message : "ADAPTIVE_RETRIEVAL_FAILED",
    ).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100);
    const failure = await failAdaptiveRetrievalCacheLease(
      input.admin,
      cacheId,
      code,
    );
    return {
      intelligence: null,
      diagnostics: {
        ...base,
        enabled: true,
        source: "ADAPTIVE_RETRIEVAL_FALLBACK",
        model,
        providerRequests,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        latencyMs,
        fallbackReason: code,
        validation: error instanceof AdaptiveRetrievalProviderError
          ? error.validationDiagnostics
          : null,
        cacheFailureRecorded: failure.terminal,
      },
    };
  }
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
      nameSource: "TED_ECONOMIC_OPERATOR",
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
      organizationType: "COMMERCIAL_COMPANY",
      identityConfidence: "HIGH",
      commercialIdentityVerified: true,
      editorialContent: false,
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
  const output: ProspectCandidate[] = [];
  const identityIndex = new Map<string, ProspectCandidate>();
  const indexCandidate = (candidate: ProspectCandidate) => {
    for (const key of companyIdentityKeys(candidate)) {
      identityIndex.set(key, candidate);
    }
  };
  const addCandidate = (candidate: ProspectCandidate) => {
    const previous = companyIdentityKeys(candidate).map((key) =>
      identityIndex.get(key)
    ).find(Boolean);
    if (previous) {
      mergeProspectCandidate(previous, candidate);
      indexCandidate(previous);
      return;
    }
    output.push(candidate);
    indexCandidate(candidate);
  };
  for (const candidate of tedCandidates) addCandidate(candidate);
  for (const registry of registryCandidates) {
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
    addCandidate({
      name: registry.name,
      nameSource: "OFFICIAL_REGISTRY",
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
      organizationType: registry.activity.strength === "STRONG_INDIRECT"
        ? "COMMERCIAL_COMPANY"
        : "UNKNOWN",
      identityConfidence: "HIGH",
      commercialIdentityVerified:
        registry.activity.strength === "STRONG_INDIRECT",
      editorialContent: false,
    });
  }
  for (const candidate of publicWebCandidates) addCandidate(candidate);
  const wantedTypes = partnerTypes.map((item) => item.toLowerCase());
  return output.map((candidate) => ({
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

function decodeIdentityText(value: unknown): string {
  return sanitizeEvidenceText(value, 180)
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function pageLikeIdentity(value: unknown): boolean {
  const name = decodeIdentityText(value);
  const legalSuffix =
    /\b(?:s\.?r\.?l\.?|s\.?a\.?s\.?|s\.?a\.?|gmbh|b\.?v\.?|ltd\.?|limited|inc\.?|llc|a\.?g\.?|s\.?p\.?a\.?)\s*$/i
      .test(name);
  const articleOrInstructional =
    /(?:\b(?:learn|know|understand|guide|how to|what is|overview|everything you need|ce que vous devez savoir)\b|:\s+\S)/i
      .test(name);
  const productOrCatalogueTitle =
    /\b(?:products?|produits?|productos?|prodotti|produkte|catalog(?:ue)?|catalogue|catalogo|katalog|portfolio|range|system(?:s)?|systèmes?|sistemi?|systeme|set(?:s)?|kit(?:s)?|cover(?:s)?|sleeve(?:s)?|drape(?:s)?|catheter(?:s)?|cathéters?|electrode(?:s)?|électrodes?|trocar(?:s)?|circuit(?:s)?|circuits?|blanket(?:s)?|mixing|dispensing)\b/i
      .test(name) && !legalSuffix;
  const sentenceLike = name.split(/\s+/).length > 10 ||
    (/[.!?]\s*$/.test(name) && name.split(/\s+/).length > 5 && !legalSuffix);
  return articleOrInstructional || productOrCatalogueTitle || sentenceLike;
}

function plausibleWebsiteIdentity(
  value: unknown,
  domain: string,
  pageLabels: string[] = [],
): string | null {
  const name = decodeIdentityText(value);
  const normalized = normalizeCompanyName(name);
  const normalizedPageLabels = pageLabels.map(normalizeCompanyName).filter(
    Boolean,
  );
  if (
    name.length < 2 || name.length > 180 ||
    name.split(/\s+/).length > 16 ||
    normalized === normalizeCompanyName(domain) ||
    pageLikeIdentity(name) ||
    normalizedPageLabels.includes(normalized) ||
    /^(?:home|products?|catalog(?:ue)?|camera covers?|medical devices?|welcome|contact|about us)$/i
      .test(name) ||
    /^[a-z0-9-]+\.[a-z]{2,}$/i.test(name)
  ) return null;
  return name;
}

function htmlAttribute(tag: string, attribute: string): string {
  const match = tag.match(
    new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return match?.[1] || "";
}

function jsonLdOrganizations(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdOrganizations);
  const row = record(value);
  if (!Object.keys(row).length) return [];
  const nested = [
    ...array(row["@graph"]),
    ...array(row.mainEntity),
    ...array(row.publisher),
    ...array(row.manufacturer),
  ].flatMap(jsonLdOrganizations);
  const types = texts(row["@type"]).map((item) => item.toLowerCase());
  return types.some((type) =>
      /^(?:organization|corporation|localbusiness|medicalbusiness|medicalorganization|hospital|medicalclinic|physician)$/
        .test(
          type,
        )
    )
    ? [row, ...nested]
    : nested;
}

function jsonLdRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdRows);
  const row = record(value);
  if (!Object.keys(row).length) return [];
  return [
    row,
    ...[
      ...array(row["@graph"]),
      ...array(row.mainEntity),
      ...array(row.publisher),
      ...array(row.manufacturer),
      ...array(row.brand),
      ...array(row.provider),
    ].flatMap(jsonLdRows),
  ];
}

function websiteJsonLdRows(html: string): JsonRecord[] {
  const output: JsonRecord[] = [];
  for (
    const match of html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )
  ) {
    try {
      output.push(...jsonLdRows(JSON.parse(match[1].trim())));
    } catch (_) {
      // Invalid JSON-LD is not organization evidence.
    }
  }
  return output;
}

function pageIdentityLabels(html: string, rows: JsonRecord[]): string[] {
  const labels = [
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "",
  ];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (htmlAttribute(tag, "property") || htmlAttribute(tag, "name"))
      .toLowerCase();
    if (key === "og:title" || key === "twitter:title") {
      labels.push(htmlAttribute(tag, "content"));
    }
  }
  for (const row of rows) {
    const types = texts(row["@type"]).map((item) => item.toLowerCase());
    if (
      types.some((type) =>
        /^(?:product|article|newsarticle|blogposting|medicalwebpage|webpage|collectionpage|itemlist)$/
          .test(
            type,
          )
      )
    ) labels.push(first(row.name || row.headline));
  }
  return labels.map(decodeIdentityText).filter(Boolean);
}

function extractWebsiteIdentity(
  html: string,
  domain: string,
  rows = websiteJsonLdRows(html),
): { name: string; source: CompanyIdentitySource } | null {
  const pageLabels = pageIdentityLabels(html, rows);
  for (const organization of jsonLdOrganizations(rows)) {
    const name = plausibleWebsiteIdentity(
      organization.legalName || organization.name,
      domain,
      pageLabels.filter((label) =>
        normalizeCompanyName(label) !==
          normalizeCompanyName(organization.legalName || organization.name)
      ),
    );
    if (name) return { name, source: "SCHEMA_ORG" };
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (htmlAttribute(tag, "property") || htmlAttribute(tag, "name"))
      .toLowerCase();
    if (key !== "og:site_name" && key !== "application-name") continue;
    const proposed = htmlAttribute(tag, "content");
    const name = plausibleWebsiteIdentity(
      proposed,
      domain,
      pageLabels.filter((label) =>
        normalizeCompanyName(label) !== normalizeCompanyName(proposed)
      ),
    );
    if (name) return { name, source: "OFFICIAL_WEBSITE" };
  }
  return null;
}

export type WebsiteOrganizationAnalysis = {
  identity: { name: string; source: CompanyIdentitySource } | null;
  identityConfidence: CompanyIdentityConfidence;
  organizationType: OrganizationType;
  commercialIdentityVerified: boolean;
  editorialContent: boolean;
};

export function analyzeOfficialWebsitePage(
  html: string,
  domain: string,
): WebsiteOrganizationAnalysis {
  const rows = websiteJsonLdRows(html);
  const identity = extractWebsiteIdentity(html, domain, rows);
  const schemaTypes = rows.flatMap((row) => texts(row["@type"]))
    .map((item) => item.toLowerCase());
  const visibleText = sanitizeEvidenceText(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
    8000,
  );
  const commercialSignal =
    /\b(?:manufacturer|manufacturing|fabricant|fabbricante|fabricante|hersteller|fabrikant|distributor|distribution|distributeur|distributore|distribuidor|vertrieb|händler|supplier|fournisseur|fornitore|proveedor|lieferant|leverancier|wholesal(?:e|er)|grossiste|ingrosso|mayorista|großhandel|groothandel|importer|importateur|importatore|importador|importeur|exporter|reseller|revendeur|rivenditore|wiederverkäufer|oem|procedure pack|medical technology company|request (?:a )?quote|demander un devis|richiedi un preventivo|solicitar presupuesto|angebot anfordern|product catalogue|product catalog|catalogue produits|catalogo prodotti|produktkatalog)\b/i
      .test(visibleText);
  const healthcareProvider =
    schemaTypes.some((type) =>
      /^(?:hospital|medicalclinic|physician|medicalorganization)$/.test(type)
    ) ||
    /\b(?:hospital|clinic|health system|patient care|make an appointment)\b/i
      .test(identity?.name || "");
  const educationResearch =
    schemaTypes.some((type) =>
      /^(?:collegeoruniversity|educationalorganization|researchorganization)$/
        .test(
          type,
        )
    ) || /\b(?:university|research institute|medical school)\b/i.test(
      identity?.name || "",
    );
  const editorialContent =
    schemaTypes.some((type) =>
      /^(?:article|newsarticle|blogposting|medicalwebpage|scholarlyarticle)$/
        .test(
          type,
        )
    ) ||
    /\b(?:patient information|patient education|health library|medical encyclopedia|what is|how to|guide|ce que vous devez savoir|informations? (?:pour les )?patients?|informazioni (?:per i )?pazienti|cosa sapere|información (?:para )?pacientes|qué es|patienteninformation|was ist|ratgeber|patiënteninformatie|wat is)\b/i
      .test(visibleText);
  // Commercial vocabulary inside an article is not organization-level proof.
  // An editorial page must obtain that proof from the bounded homepage check
  // or an independent registry/TED signal.
  const commercialOrganizationSignal = commercialSignal && !editorialContent;
  const organizationType: OrganizationType = commercialOrganizationSignal
    ? "COMMERCIAL_COMPANY"
    : healthcareProvider
    ? "HEALTHCARE_PROVIDER"
    : educationResearch
    ? "EDUCATION_RESEARCH"
    : editorialContent
    ? "EDITORIAL_PUBLISHER"
    : "UNKNOWN";
  return {
    identity,
    identityConfidence: identity?.source === "SCHEMA_ORG"
      ? "HIGH"
      : identity?.source === "OFFICIAL_WEBSITE"
      ? "MEDIUM"
      : "LOW",
    organizationType,
    commercialIdentityVerified: organizationType === "COMMERCIAL_COMPANY",
    editorialContent,
  };
}

export function extractOfficialWebsiteIdentity(
  html: string,
  domain: string,
): { name: string; source: CompanyIdentitySource } | null {
  return extractWebsiteIdentity(html, domain);
}

const COMMERCIAL_EVIDENCE_PATH =
  /\/(?:about|company|distribution|distributor|import|wholesale|partners?|brands?|supplier|solutions?)(?:\/|$)/i;
const PRODUCT_EVIDENCE_PATH =
  /\/(?:products?|product-categories?|catalog(?:ue)?|portfolio|surgical|operating-room|infection-control|medical-disposables?)(?:\/|$)/i;
const LOW_VALUE_EVIDENCE_PATH =
  /\/(?:blog|news|article|press|patient|education|shop|cart|search)(?:\/|$)/i;

export function websiteEvidenceUrlScore(
  value: string,
  productFamily?: ProductFamilyProfile,
): number {
  const normalized = normalizeHttpsUrl(value);
  if (!normalized) return -1000;
  const url = new URL(normalized);
  const searchable = decodeURIComponent(url.pathname).toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const productMatch = productFamily?.directTerms.slice(0, 12).some((term) => {
    const tokens = term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return tokens.length >= 4 && searchable.includes(tokens);
  });
  return Number(PRODUCT_EVIDENCE_PATH.test(url.pathname)) * 45 +
    Number(COMMERCIAL_EVIDENCE_PATH.test(url.pathname)) * 35 +
    Number(Boolean(productMatch)) * 30 -
    Number(LOW_VALUE_EVIDENCE_PATH.test(url.pathname)) * 55 -
    Number(/\.pdf$/i.test(url.pathname)) * 100 +
    Number(url.pathname === "/") * 8;
}

export function rankWebsiteVerificationCandidates(
  candidates: ProspectCandidate[],
): ProspectCandidate[] {
  const sourceScore = (candidate: ProspectCandidate) =>
    candidate.evidence.some((item) => item.relevanceClass === "DIRECT")
      ? 70
      : candidate.evidence.some((item) => item.relevanceClass === "ADJACENT")
      ? 55
      : candidate.discoverySources?.includes("PUBLIC_WEB")
      ? 15
      : 10;
  return [...candidates].sort((left, right) => {
    const score = (candidate: ProspectCandidate) =>
      sourceScore(candidate) +
      (candidate.websiteCandidateSignals?.verificationScore || 0) +
      Number(Boolean(candidate.commercialIdentityVerified)) * 30 +
      Number(Boolean(candidate.websiteCandidateSignals?.productPageContext)) *
        12 +
      Number(Boolean(
          candidate.websiteCandidateSignals?.commercialRoleContext,
        )) * 10;
    return score(right) - score(left) ||
      String(left.websiteUrl || "").localeCompare(
        String(right.websiteUrl || ""),
      );
  });
}

function sameDomainEvidenceLinks(
  html: string,
  baseUrl: string,
  domain: string,
  productFamily: ProductFamilyProfile,
): string[] {
  const output: string[] = [];
  for (const tag of html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/gi) || []) {
    const href = htmlAttribute(tag, "href");
    try {
      const url = new URL(href, baseUrl);
      url.hash = "";
      if (
        url.protocol !== "https:" || normalizeDomain(url.href) !== domain ||
        websiteEvidenceUrlScore(url.href, productFamily) <= 0
      ) continue;
      output.push(url.href.slice(0, 1000));
    } catch (_) {
      // Ignore malformed or non-HTTPS navigation.
    }
  }
  return [...new Set(output)].sort((left, right) =>
    websiteEvidenceUrlScore(right, productFamily) -
    websiteEvidenceUrlScore(left, productFamily)
  ).slice(0, 8);
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
  identityRejected: number;
  organizationRequests: number;
  organizationVerified: number;
  editorialRejected: number;
  domainFallbackUsed: number;
  candidateDomainsTotal: number;
  candidateDomainsRanked: number;
  verificationSlots: number;
  verificationAttempted: number;
  verificationSuccess: number;
  officialCompanyDomains: number;
  directoryDomainsSkipped: number;
  marketplaceDomainsSkipped: number;
  productPagesFound: number;
  commercialRolePagesFound: number;
  combinedDomainEvidenceCount: number;
}> {
  const withWebsites = candidates.filter((item) => item.websiteUrl);
  const directoryDomainsSkipped =
    withWebsites.filter((candidate) =>
      candidate.websiteCandidateSignals?.domainClass === "DIRECTORY"
    ).length;
  const marketplaceDomainsSkipped =
    withWebsites.filter((candidate) =>
      candidate.websiteCandidateSignals?.domainClass === "MARKETPLACE"
    ).length;
  const ranked = rankWebsiteVerificationCandidates(withWebsites.filter(
    (candidate) =>
      !["DIRECTORY", "MARKETPLACE"].includes(
        candidate.websiteCandidateSignals?.domainClass || "UNKNOWN",
      ),
  ));
  const selected: ProspectCandidate[] = [];
  const countryCounts = new Map<string, number>();
  for (const candidate of ranked) {
    const country = candidate.countryCode || "UNKNOWN";
    if ((countryCounts.get(country) || 0) > 0) continue;
    selected.push(candidate);
    countryCounts.set(country, 1);
    if (selected.length >= DISCOVERY_LIMITS.maximumWebsiteChecks) break;
  }
  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= DISCOVERY_LIMITS.maximumWebsiteChecks) break;
  }
  const results = await Promise.all(selected.map(async (candidate) => {
    type WebsiteResult = {
      status:
        | "SKIPPED"
        | "UNAVAILABLE"
        | "GENERIC"
        | "RELEVANT"
        | "REJECTED_IDENTITY";
      organizationRequests: number;
      organizationVerified: boolean;
      editorialRejected: boolean;
      domainFallbackUsed: boolean;
      verificationSuccess: boolean;
      officialCompanyDomain: boolean;
      productPagesFound: number;
      commercialRolePagesFound: number;
      combinedDomainEvidence: boolean;
    };
    const outcome = (
      status: WebsiteResult["status"],
      overrides: Partial<Omit<WebsiteResult, "status">> = {},
    ): WebsiteResult => ({
      status,
      organizationRequests: 0,
      organizationVerified: Boolean(candidate.commercialIdentityVerified),
      editorialRejected: false,
      domainFallbackUsed: candidate.nameSource === "DOMAIN_FALLBACK",
      verificationSuccess: false,
      officialCompanyDomain: false,
      productPagesFound: 0,
      commercialRolePagesFound: 0,
      combinedDomainEvidence: false,
      ...overrides,
    });
    const website = [
      ...(candidate.websiteVerificationUrls || []),
      candidate.websiteUrl,
    ].map((value) => normalizeHttpsUrl(value)).filter((
      value,
    ): value is string => Boolean(value)).sort((left, right) =>
      websiteEvidenceUrlScore(right, productFamily) -
      websiteEvidenceUrlScore(left, productFamily)
    )[0];
    if (!website) return outcome("SKIPPED");
    try {
      const siteUrl = new URL(website);
      const robotsUrl = `${siteUrl.origin}/robots.txt`;
      let allowed = true;
      let robotsText = "";
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
          robotsText = new TextDecoder().decode(body.bytes);
          allowed = isPathAllowedByRobots(
            robotsText,
            siteUrl.pathname,
            "medichall-external-prospect-discovery",
          );
        } else await robots.response.body?.cancel();
      } catch (_) {
        // An unavailable robots file is not a disallow rule.
      }
      if (!allowed) return outcome("SKIPPED");
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
        return outcome("SKIPPED");
      }
      if (!result.response.ok) {
        await result.response.body?.cancel();
        return outcome("UNAVAILABLE");
      }
      const contentType = result.response.headers.get("content-type") || "";
      if (!contentType.includes("html")) {
        await result.response.body?.cancel();
        return outcome("SKIPPED");
      }
      const body = await readBoundedResponseBody(result.response, 512_000);
      const html = new TextDecoder().decode(body.bytes);
      const resolvedDomain = normalizeDomain(result.resolvedUrl) ||
        siteUrl.hostname;
      const isPublicWeb = candidate.discoverySources?.includes("PUBLIC_WEB") ===
        true;
      if (isPublicWeb && candidate.nameSource === "PAGE_METADATA") {
        candidate.name = resolvedDomain;
        candidate.nameSource = "DOMAIN_FALLBACK";
      }
      type VerifiedPage = {
        url: string;
        html: string;
        text: string;
        analysis: WebsiteOrganizationAnalysis;
      };
      const asVerifiedPage = (url: string, value: string): VerifiedPage => ({
        url,
        html: value,
        text: sanitizeEvidenceText(
          value.replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " "),
          4000,
        ),
        analysis: analyzeOfficialWebsitePage(value, resolvedDomain),
      });
      const pages: VerifiedPage[] = [asVerifiedPage(result.resolvedUrl, html)];
      let organizationRequests = 0;
      if (isPublicWeb) {
        const knownUrls = [
          ...(candidate.websiteVerificationUrls || []),
          ...sameDomainEvidenceLinks(
            html,
            result.resolvedUrl,
            resolvedDomain,
            productFamily,
          ),
          siteUrl.origin + "/",
        ].map((value) => normalizeHttpsUrl(value)).filter(
          (value): value is string => Boolean(value),
        ).filter((value) => normalizeDomain(value) === resolvedDomain);
        const uniqueUrls = [...new Set(knownUrls)].filter((value) =>
          !pages.some((page) => page.url === value)
        );
        const byScore = (left: string, right: string) =>
          websiteEvidenceUrlScore(right, productFamily) -
          websiteEvidenceUrlScore(left, productFamily);
        const productUrl = uniqueUrls.filter((value) =>
          PRODUCT_EVIDENCE_PATH.test(new URL(value).pathname)
        ).sort(byScore)[0];
        const commercialUrl = uniqueUrls.filter((value) =>
          COMMERCIAL_EVIDENCE_PATH.test(new URL(value).pathname)
        ).sort(byScore)[0];
        const additionalUrls = [
          ...new Set([
            productUrl,
            commercialUrl,
            siteUrl.origin + "/",
            ...uniqueUrls.sort(byScore),
          ].filter((value): value is string =>
            Boolean(value)
          )),
        ];
        for (const pageUrl of additionalUrls) {
          if (pages.length >= 3) {
            break;
          }
          const pagePath = new URL(pageUrl).pathname;
          if (
            robotsText && !isPathAllowedByRobots(
              robotsText,
              pagePath,
              "medichall-external-prospect-discovery",
            )
          ) continue;
          organizationRequests += 1;
          try {
            const extra = await safeFetchWithRedirects(pageUrl, {
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
              extra.response.ok &&
              (extra.response.headers.get("content-type") || "").includes(
                "html",
              ) && normalizeDomain(extra.resolvedUrl) === resolvedDomain
            ) {
              const extraBody = await readBoundedResponseBody(
                extra.response,
                512_000,
              );
              pages.push(asVerifiedPage(
                extra.resolvedUrl,
                new TextDecoder().decode(extraBody.bytes),
              ));
            } else await extra.response.body?.cancel();
          } catch (_) {
            // Keep independently verified pages when a bounded companion-page
            // request is unavailable.
          }
        }
      }
      const analyses = pages.map((page) => page.analysis);
      for (const analysis of analyses) {
        if (!analysis.identity) continue;
        const selectedIdentity = chooseTrustedCompanyIdentity({
          currentName: candidate.name,
          currentSource: candidate.nameSource,
          proposedName: analysis.identity.name,
          proposedSource: analysis.identity.source,
        });
        candidate.name = selectedIdentity.name;
        candidate.nameSource = selectedIdentity.source;
      }
      const confidenceOrder: Record<CompanyIdentityConfidence, number> = {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
      };
      candidate.identityConfidence = analyses.reduce(
        (best, item) =>
          confidenceOrder[item.identityConfidence] > confidenceOrder[best]
            ? item.identityConfidence
            : best,
        candidate.identityConfidence || "LOW",
      );
      candidate.commercialIdentityVerified = Boolean(
        candidate.commercialIdentityVerified ||
          analyses.some((item) => item.commercialIdentityVerified),
      );
      if (candidate.commercialIdentityVerified) {
        candidate.organizationType = "COMMERCIAL_COMPANY";
      } else {
        candidate.organizationType = analyses.find((item) =>
          item.organizationType !== "UNKNOWN"
        )?.organizationType || candidate.organizationType || "UNKNOWN";
      }
      candidate.editorialContent = analyses.some((item) =>
        item.editorialContent
      ) && !candidate.commercialIdentityVerified;
      if (isPublicWeb && candidate.nameSource === "PAGE_METADATA") {
        candidate.name = resolvedDomain;
        candidate.nameSource = "DOMAIN_FALLBACK";
        candidate.identityConfidence = "LOW";
      }
      const commercialDomainContext = pages.filter((page) =>
        page.analysis.commercialIdentityVerified
      ).map((page) => page.text).join(" ");
      const classifiedPages = pages.map((page) => ({
        page,
        evidence: classifyEvidenceForProduct({
          sourceType: "COMPANY_WEBSITE",
          sourceUrl: page.url,
          sourceDomain: normalizeDomain(page.url) || siteUrl.hostname,
          title: `${candidate.name} official website`,
          // Product relevance and commercial identity may live on separate
          // pages of the same verified official domain. Add only the bounded
          // commercial-page context; never provider snippets or another host.
          snippet: [page.text, commercialDomainContext].filter(Boolean).join(
            " ",
          ),
          evidenceKind: "WEAK_CONTEXT",
          confidence: 0.85,
          evidenceDate: (dependencies.now || new Date()).toISOString().slice(
            0,
            10,
          ),
          taxonomyIds: candidate.taxonomyIds,
        }, productFamily),
      }));
      for (const { evidence } of classifiedPages) {
        candidate.evidence.push({
          ...evidence,
          snippet: evidence.relevanceClass === "DIRECT"
            ? `Verified official medical-device supplier website contains direct product-family evidence: ${
              (evidence.matchedTerms || []).slice(0, 4).join(", ")
            }.`
            : evidence.relevanceClass === "ADJACENT"
            ? `Verified official medical-device supplier website contains adjacent commercial evidence: ${
              (evidence.matchedTerms || []).slice(0, 4).join(", ")
            }.`
            : "Official website was reachable, but no supported target-product or adjacent commercial claim was found.",
          confidence: evidence.relevanceClass === "DIRECT"
            ? 0.9
            : evidence.relevanceClass === "ADJACENT"
            ? 0.78
            : 0.4,
        });
      }
      const text = pages.map((page) => page.text).join(" ");
      if (candidate.companyType === "Unknown") {
        candidate.companyType = companyType(text);
      }
      const relevantPages = classifiedPages.filter(({ evidence }) =>
        evidence.relevanceClass !== "GENERIC"
      );
      const strongest = relevantPages.find(({ evidence }) =>
        evidence.relevanceClass === "DIRECT"
      )?.evidence || relevantPages[0]?.evidence;
      const productPagesFound = relevantPages.length;
      const commercialRolePagesFound = pages.filter((page) =>
        page.analysis.commercialIdentityVerified
      ).length;
      const combinedDomainEvidence = productPagesFound > 0 &&
        commercialRolePagesFound > 0;
      if (
        strongest?.relevanceClass === "DIRECT" &&
        candidate.taxonomyRelation === "none"
      ) {
        candidate.taxonomyRelation = "exact";
      } else if (
        strongest?.relevanceClass === "ADJACENT" &&
        candidate.taxonomyRelation === "none"
      ) {
        candidate.taxonomyRelation = "family";
      }
      if (strongest) {
        candidate.lastEvidenceAt = (dependencies.now || new Date())
          .toISOString().slice(0, 10);
      }
      const resultDiagnostics = {
        organizationRequests,
        organizationVerified: Boolean(candidate.commercialIdentityVerified),
        domainFallbackUsed: candidate.nameSource === "DOMAIN_FALLBACK",
        verificationSuccess: true,
        officialCompanyDomain: Boolean(candidate.commercialIdentityVerified),
        productPagesFound,
        commercialRolePagesFound,
        combinedDomainEvidence,
      };
      if (!strongest) {
        return outcome("GENERIC", {
          ...resultDiagnostics,
        });
      }
      if (isPublicWeb && !candidate.commercialIdentityVerified) {
        return outcome("REJECTED_IDENTITY", {
          ...resultDiagnostics,
          organizationVerified: false,
          officialCompanyDomain: false,
          editorialRejected: Boolean(candidate.editorialContent),
        });
      }
      return outcome("RELEVANT", {
        ...resultDiagnostics,
      });
    } catch (_) {
      return outcome("UNAVAILABLE");
    }
  }));
  return {
    available: withWebsites.length,
    checked: selected.length,
    unavailable: results.filter((value) => value.status === "UNAVAILABLE")
      .length,
    relevant: results.filter((value) => value.status === "RELEVANT").length,
    generic: results.filter((value) => value.status === "GENERIC").length,
    skipped: results.filter((value) => value.status === "SKIPPED").length,
    publicWebChecked:
      selected.filter((candidate) =>
        candidate.discoverySources?.includes("PUBLIC_WEB")
      ).length,
    publicWebVerified:
      results.filter((value, index) =>
        value.status === "RELEVANT" &&
        selected[index].discoverySources?.includes("PUBLIC_WEB")
      ).length,
    identityRejected:
      results.filter((value) => value.status === "REJECTED_IDENTITY").length,
    organizationRequests: results.reduce(
      (total, value) => total + value.organizationRequests,
      0,
    ),
    organizationVerified:
      results.filter((value) => value.organizationVerified).length,
    editorialRejected: results.filter((value) => value.editorialRejected)
      .length,
    domainFallbackUsed: results.filter((value) => value.domainFallbackUsed)
      .length,
    candidateDomainsTotal: withWebsites.length,
    candidateDomainsRanked: ranked.length,
    verificationSlots: DISCOVERY_LIMITS.maximumWebsiteChecks,
    verificationAttempted: selected.length,
    verificationSuccess: results.filter((value) => value.verificationSuccess)
      .length,
    officialCompanyDomains:
      results.filter((value) => value.officialCompanyDomain).length,
    directoryDomainsSkipped,
    marketplaceDomainsSkipped,
    productPagesFound: results.reduce(
      (total, value) => total + value.productPagesFound,
      0,
    ),
    commercialRolePagesFound: results.reduce(
      (total, value) => total + value.commercialRolePagesFound,
      0,
    ),
    combinedDomainEvidenceCount:
      results.filter((value) => value.combinedDomainEvidence).length,
  };
}

async function taxonomyCatalog(
  // deno-lint-ignore no-explicit-any -- repository has no generated database types.
  admin: any,
): Promise<ProductTaxonomyCandidate[]> {
  const [taxonomyResult, aliasResult] = await Promise.all([
    admin.from("medical_product_taxonomy").select(
      "id,parent_id,canonical_name,slug,node_type,description",
    ).eq("is_active", true).limit(500),
    admin.from("medical_product_aliases").select(
      "taxonomy_id,alias_text,language_code",
    )
      .eq("is_active", true).eq("verification_status", "approved").limit(2000),
  ]);
  if (taxonomyResult.error || aliasResult.error) {
    throw new Error("WEBSITE_TAXONOMY_UNAVAILABLE");
  }
  const aliases = new Map<number, string[]>();
  const localizedAliases = new Map<
    number,
    Array<{ term: string; language: string }>
  >();
  for (const value of array(aliasResult.data)) {
    const row = record(value);
    const taxonomyId = Number(row.taxonomy_id);
    const alias = first(row.alias_text);
    if (!Number.isSafeInteger(taxonomyId) || !alias) continue;
    aliases.set(taxonomyId, [...(aliases.get(taxonomyId) || []), alias]);
    localizedAliases.set(taxonomyId, [
      ...(localizedAliases.get(taxonomyId) || []),
      { term: alias, language: first(row.language_code) || "en" },
    ]);
  }
  const taxonomyRows = array(taxonomyResult.data).map(record);
  const taxonomyNames = new Map<number, string>();
  for (const row of taxonomyRows) {
    const id = Number(row.id);
    if (Number.isSafeInteger(id)) {
      taxonomyNames.set(id, first(row.canonical_name));
    }
  }
  return taxonomyRows.map((row) => {
    const id = Number(row.id);
    const parentId = Number(row.parent_id);
    return {
      id,
      parentId: Number.isSafeInteger(parentId) ? parentId : null,
      canonicalName: first(row.canonical_name),
      slug: first(row.slug),
      nodeType: first(row.node_type),
      description: first(row.description) || null,
      parentName: Number.isSafeInteger(parentId)
        ? taxonomyNames.get(parentId) || null
        : null,
      aliases: aliases.get(id) || [],
      localizedAliases: localizedAliases.get(id) || [],
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
  const mappedSuggestions = normalizeWebsiteProductSignals(signals, catalog)
    .map((item) => ({ ...item, resolution: "MAPPED" }));
  const unknownSuggestions = unmappedWebsiteProductSuggestions(
    signals,
    mappedSuggestions.map((item) => item.raw_website_label),
  );
  const suggestions = [...mappedSuggestions, ...unknownSuggestions].slice(
    0,
    WEBSITE_PRODUCT_SCAN_LIMITS.maximumSuggestions,
  );
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

async function candidateEvidenceFingerprint(
  candidate: ProspectCandidate,
): Promise<string> {
  return await sha256(
    candidate.evidence.map((evidence) =>
      [
        evidence.sourceType,
        normalizeHttpsUrl(evidence.sourceUrl) || "",
        evidence.noticeId || "",
        evidence.relevanceClass || "GENERIC",
        [...(evidence.matchedTerms || [])].map(normalizeRetrievalTerm).sort()
          .join(","),
      ].join("|")
    ).sort().join("\n"),
  );
}

function candidateHistoryKeys(candidate: ProspectCandidate): string[] {
  return [
    normalizeDomain(candidate.websiteUrl),
    normalizeCompanyName(candidate.name),
    candidate.registryIdentifier || "",
  ].filter((value): value is string => Boolean(value));
}

async function persistCandidate(
  // The repository does not generate database types; service writes target
  // new migration tables that the untyped Supabase client cannot infer.
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: number,
  runId: string,
  searchSpaceId: string,
  intentHash: string,
  taxonomyContext: JsonRecord[],
  candidate: ProspectCandidate,
  score: ProspectScore,
  productFamily: ProductFamilyProfile,
): Promise<
  {
    externalCompanyId: number;
    evidenceFingerprint: string;
    discoveryState: DiscoveryResultState;
  } | null
> {
  if (!score.eligible || score.relevanceScore < 55) return null;
  const domain = normalizeDomain(candidate.websiteUrl);
  const safeCompanyName = candidate.nameSource === "PAGE_METADATA"
    ? domain
    : candidate.name;
  const safeIdentitySource = candidate.nameSource === "PAGE_METADATA"
    ? "DOMAIN_FALLBACK"
    : candidate.nameSource || "DOMAIN_FALLBACK";
  if (!safeCompanyName) return null;
  let external: {
    id: number;
    membership_status: string;
    company_name?: string;
  } | null = null;
  const lookups: Array<
    () => Promise<{ data: typeof external; error: unknown }>
  > = [];
  if (candidate.registryIdentifier && candidate.countryCode) {
    lookups.push(() =>
      admin.from("external_companies").select(
        "id,membership_status,company_name",
      )
        .eq("duplicate_status", "ACTIVE")
        .eq("registry_identifier", candidate.registryIdentifier)
        .eq("country_code", candidate.countryCode).maybeSingle()
    );
  }
  if (domain) {
    lookups.push(() =>
      admin.from("external_companies").select(
        "id,membership_status,company_name",
      )
        .eq("duplicate_status", "ACTIVE").eq("normalized_domain", domain)
        .maybeSingle()
    );
  }
  lookups.push(() => {
    let lookup = admin.from("external_companies").select(
      "id,membership_status,company_name",
    )
      .eq("duplicate_status", "ACTIVE")
      .eq("normalized_company_name", normalizeCompanyName(safeCompanyName));
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
  if (external?.membership_status === "ON_MEDICHALL") return null;
  const trustedIdentityUpgrade = safeIdentitySource !== "DOMAIN_FALLBACK";
  const legacyPageIdentityRepair = safeIdentitySource === "DOMAIN_FALLBACK" &&
    pageLikeIdentity(external?.company_name);
  if (
    external && (trustedIdentityUpgrade || legacyPageIdentityRepair) &&
    safeCompanyName !== external.company_name
  ) {
    const identityUpdate = await admin.from("external_companies").update({
      company_name: safeCompanyName,
      last_verified_at: new Date().toISOString(),
    }).eq("id", external.id);
    if (identityUpdate.error) throw identityUpdate.error;
  }
  if (!external) {
    const insertion = await admin.from("external_companies").insert({
      company_name: safeCompanyName,
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
    ) return null;
    external = insertion.data;
  }
  if (!external) return null;
  const externalCompanyId = Number(external.id);
  const evidenceFingerprint = await candidateEvidenceFingerprint(candidate);
  const seen = await admin.from("buyer_discovery_seen_companies").select(
    "first_discovery_run_id,evidence_fingerprint,first_relevance_score,times_verified",
  ).eq("search_space_id", searchSpaceId)
    .eq("external_company_id", externalCompanyId).maybeSingle();
  if (seen.error) throw seen.error;
  const priorSeen = record(seen.data);
  const discoveryState = classifyDiscoveryResultState({
    priorEvidenceFingerprint: first(priorSeen.evidence_fingerprint) || null,
    currentEvidenceFingerprint: evidenceFingerprint,
  });
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
    first_discovery_run_id: structuredFirst(priorSeen.first_discovery_run_id) ||
      runId,
    last_discovery_run_id: runId,
    discovery_state: discoveryState,
    evidence_fingerprint: evidenceFingerprint,
    intent_hash: intentHash,
    relevance_score: score.relevanceScore,
    buyer_fit_score: score.buyerFitScore ?? score.relevanceScore,
    buyer_fit_grade: score.buyerFitGrade || score.confidence,
    ai_buyer_judge_status: score.aiBuyerJudgeStatus || "DISABLED",
    ai_buyer_recommended_grade: score.aiBuyerRecommendedGrade || null,
    ai_buyer_reason_codes: (score.aiBuyerReasonCodes || []).slice(0, 6),
    ai_buyer_short_explanation: sanitizeEvidenceText(
      score.aiBuyerShortExplanation,
      320,
    ) || null,
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
      commercial_buyer_grade: score.commercialBuyerGrade,
      sales_prospect_classification: score.salesProspectClassification,
      buyer_fit_score: score.buyerFitScore ?? score.relevanceScore,
      buyer_fit_grade: score.buyerFitGrade || score.confidence,
      ai_buyer_judge_status: score.aiBuyerJudgeStatus || "DISABLED",
      ai_buyer_recommended_grade: score.aiBuyerRecommendedGrade || null,
      ai_sales_prospect_classification:
        score.aiBuyerSalesProspectClassification || null,
      ai_buyer_reason_codes: (score.aiBuyerReasonCodes || []).slice(0, 6),
      ai_buyer_short_explanation: sanitizeEvidenceText(
        score.aiBuyerShortExplanation,
        320,
      ) || null,
      buyer_role_confidence: score.buyerRoleConfidence,
      qualification_path: score.qualificationPath,
      company_identity_source: safeIdentitySource,
      company_identity_confidence: candidate.identityConfidence || "LOW",
      organization_type: candidate.organizationType || "UNKNOWN",
      commercial_identity_verified: Boolean(
        candidate.commercialIdentityVerified,
      ),
    })),
    last_scored_at: new Date().toISOString(),
  }, { onConflict: "company_id,external_company_id,intent_hash" });
  if (match.error) throw match.error;
  const seenWrite = await admin.from("buyer_discovery_seen_companies").upsert({
    search_space_id: searchSpaceId,
    external_company_id: externalCompanyId,
    first_discovery_run_id: structuredFirst(priorSeen.first_discovery_run_id) ||
      runId,
    last_discovery_run_id: runId,
    evidence_fingerprint: evidenceFingerprint,
    first_relevance_score: Number(priorSeen.first_relevance_score) ||
      score.relevanceScore,
    last_relevance_score: score.relevanceScore,
    times_verified: Math.max(0, Number(priorSeen.times_verified) || 0) + 1,
    first_seen_at: priorSeen.first_discovery_run_id
      ? undefined
      : new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "search_space_id,external_company_id" });
  if (seenWrite.error) throw seenWrite.error;
  return { externalCompanyId, evidenceFingerprint, discoveryState };
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
        identitySource: candidate.identitySource || "DOMAIN_FALLBACK",
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
      productQuery = validateSmartResolverInput(body.product_query);
    } catch (error) {
      return json(request, {
        error: error instanceof Error
          ? error.message
          : "Invalid product query.",
      }, 400);
    }
    let catalog;
    let deterministic;
    try {
      catalog = await taxonomyCatalog(admin);
      deterministic = resolveProductIntentDeterministically(
        productQuery,
        catalog,
      );
    } catch (_) {
      return json(request, { error: "Product taxonomy is unavailable." }, 503);
    }
    const deterministicUnderstandsProduct =
      deterministic.resolution !== "unmapped" ||
      deterministic.search_anyway_allowed;
    if (deterministicUnderstandsProduct) {
      const event = await authClient.rpc("record_product_resolution_event_v1", {
        p_company_id: companyId,
        p_idempotency_key: idempotencyKey,
        p_normalized_phrase: deterministic.normalized_source_text,
        p_phrase_signature: deterministic.phrase_signature,
        p_resolution_status: deterministic.resolution === "high_confidence"
          ? "EXACT_APPROVED"
          : deterministic.resolution === "medium_confidence"
          ? "SUGGESTED"
          : "UNMAPPED",
        p_suggestions: deterministic.suggestions,
      });
      if (event.error) {
        return json(
          request,
          { error: "Product resolution could not be saved." },
          503,
        );
      }
      return json(request, {
        ok: true,
        ...deterministic,
        resolution_type: "DETERMINISTIC",
        resolver_version: "DETERMINISTIC_V2",
        semantic_provider_used: false,
        provider_requests: 0,
        estimated_cost_usd: 0,
        cache_hit: false,
        resolution_event_id: record(event.data).resolution_event_id || null,
        confirmation_required: deterministic.resolution !== "high_confidence",
      });
    }

    const selectedLanguage = String(body.input_language || "und").trim()
      .toLowerCase().slice(0, 12);
    const reservationResult = await admin.rpc(
      "reserve_smart_product_resolution_v1",
      {
        p_company_id: companyId,
        p_requested_by: user.id,
        p_normalized_phrase: deterministic.normalized_source_text,
        p_input_language: selectedLanguage,
        p_resolver_version: SMART_PRODUCT_RESOLVER_VERSION,
      },
    );
    if (reservationResult.error) {
      return json(request, {
        ok: true,
        ...technicalResolverFailure({
          sourceText: productQuery,
          searchAnywayAllowed: false,
        }),
        confirmation_required: false,
      });
    }
    const reservation = record(reservationResult.data);
    const decision = String(reservation.decision || "");
    if (["DISABLED", "IN_PROGRESS", "RECENT_FAILURE"].includes(decision)) {
      return json(request, {
        ok: true,
        ...technicalResolverFailure({
          sourceText: productQuery,
          searchAnywayAllowed: false,
        }),
        confirmation_required: false,
      });
    }

    const cacheId = String(reservation.cache_id || "");
    let smartResult;
    if (decision === "CACHED") {
      try {
        const output = validateSmartResolverOutput(
          reservation.structured_result,
          catalog,
        );
        smartResult = smartResolutionFromOutput({
          sourceText: productQuery,
          output,
          taxonomyCatalog: catalog,
          resolutionType: "CACHED_AI",
          model: String(reservation.model_name || "") || null,
          providerRequests: 0,
          estimatedCostUsd: 0,
          latencyMs: Number.isFinite(Number(reservation.latency_ms))
            ? Number(reservation.latency_ms)
            : null,
        });
      } catch (_) {
        return json(request, {
          ok: true,
          ...technicalResolverFailure({
            sourceText: productQuery,
            searchAnywayAllowed: false,
          }),
          confirmation_required: false,
        });
      }
    } else if (decision === "PROCEED" && UUID_PATTERN.test(cacheId)) {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
      if (!anthropicKey) {
        await admin.rpc("fail_smart_product_resolution_v1", {
          p_cache_id: cacheId,
          p_error_code: "PROVIDER_NOT_CONFIGURED",
        });
        return json(request, {
          ok: true,
          ...technicalResolverFailure({
            sourceText: productQuery,
            searchAnywayAllowed: false,
          }),
          confirmation_required: false,
        });
      }
      const dailyLimit = Math.max(
        1,
        Math.min(100, Number(reservation.daily_limit) || 20),
      );
      const usageReservation = await admin.rpc("reserve_medichall_ai_request", {
        p_user_id: user.id,
        p_mode: "smart_product_resolver",
        p_role: "company",
        p_input_chars: productQuery.length,
        p_daily_limit: dailyLimit,
      });
      const usageRow = record(
        Array.isArray(usageReservation.data)
          ? usageReservation.data[0]
          : usageReservation.data,
      );
      if (usageReservation.error || usageRow.allowed !== true) {
        await admin.rpc("fail_smart_product_resolution_v1", {
          p_cache_id: cacheId,
          p_error_code: usageReservation.error
            ? "USAGE_RESERVATION_FAILED"
            : "DAILY_LIMIT_REACHED",
        });
        return json(request, {
          ok: true,
          ...technicalResolverFailure({
            sourceText: productQuery,
            searchAnywayAllowed: false,
          }),
          confirmation_required: false,
        });
      }
      const usageId = Number(usageRow.usage_id);
      const model = String(
        Deno.env.get("SMART_PRODUCT_RESOLVER_MODEL") ||
          Deno.env.get("ANTHROPIC_MODEL") ||
          DEFAULT_SMART_PRODUCT_RESOLVER_MODEL,
      ).trim().slice(0, 100);
      const inputPrice = boundedEnvironmentNumber(
        Deno.env.get("SMART_PRODUCT_RESOLVER_INPUT_COST_PER_MILLION_TOKENS"),
        1,
        0,
        1000,
      );
      const outputPrice = boundedEnvironmentNumber(
        Deno.env.get("SMART_PRODUCT_RESOLVER_OUTPUT_COST_PER_MILLION_TOKENS"),
        5,
        0,
        1000,
      );
      const maximumCost = boundedEnvironmentNumber(
        Deno.env.get("MAX_SMART_PRODUCT_RESOLVER_COST_USD"),
        SMART_PRODUCT_RESOLVER_LIMITS.maximumEstimatedCostUsd,
        0.0001,
        SMART_PRODUCT_RESOLVER_LIMITS.maximumEstimatedCostUsd,
      );
      if (Number.isSafeInteger(usageId) && usageId > 0) {
        await admin.from("medichall_ai_usage").update({
          feature: "smart_product_resolver",
          company_id: companyId,
          provider_name: "Anthropic",
          model_name: model,
          request_key:
            `${SMART_PRODUCT_RESOLVER_VERSION}:${deterministic.phrase_signature}`,
        }).eq("id", usageId);
      }
      try {
        const provider = await callSmartProductResolver({
          apiKey: anthropicKey,
          model,
          sourceText: productQuery,
          selectedLanguage,
          taxonomyCatalog: catalog,
          inputUsdPerMillion: inputPrice,
          outputUsdPerMillion: outputPrice,
          maximumEstimatedCostUsd: maximumCost,
        });
        const completion = await admin.rpc(
          "complete_smart_product_resolution_v1",
          {
            p_cache_id: cacheId,
            p_structured_result: provider.output,
            p_model_name: provider.model,
            p_provider_request_id: provider.providerRequestId,
            p_input_tokens: provider.inputTokens,
            p_output_tokens: provider.outputTokens,
            p_total_tokens: provider.totalTokens,
            p_estimated_cost_usd: provider.estimatedCostUsd,
            p_latency_ms: provider.latencyMs,
          },
        );
        if (completion.error) {
          throw new Error("SMART_RESOLVER_CACHE_WRITE_FAILED");
        }
        if (Number.isSafeInteger(usageId) && usageId > 0) {
          await admin.from("medichall_ai_usage").update({
            estimated_cost_usd: provider.estimatedCostUsd,
          }).eq("id", usageId);
          await admin.rpc("finish_medichall_ai_request", {
            p_usage_id: usageId,
            p_status: "completed",
            p_output_chars: JSON.stringify(provider.output).length,
            p_prompt_tokens: provider.inputTokens,
            p_completion_tokens: provider.outputTokens,
            p_total_tokens: provider.totalTokens,
            p_error_code: null,
          });
        }
        smartResult = smartResolutionFromOutput({
          sourceText: productQuery,
          output: provider.output,
          taxonomyCatalog: catalog,
          resolutionType: "AI",
          model: provider.model,
          providerRequests: 1,
          estimatedCostUsd: provider.estimatedCostUsd,
          latencyMs: provider.latencyMs,
        });
      } catch (error) {
        const errorCode = String(
          error instanceof Error ? error.message : "SMART_RESOLVER_FAILED",
        ).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100) ||
          "SMART_RESOLVER_FAILED";
        console.error("smart_product_resolver_failed", {
          error_code: errorCode,
        });
        await admin.rpc("fail_smart_product_resolution_v1", {
          p_cache_id: cacheId,
          p_error_code: errorCode,
        });
        if (Number.isSafeInteger(usageId) && usageId > 0) {
          await admin.rpc("finish_medichall_ai_request", {
            p_usage_id: usageId,
            p_status: "failed",
            p_output_chars: 0,
            p_prompt_tokens: null,
            p_completion_tokens: null,
            p_total_tokens: null,
            p_error_code: errorCode,
          });
        }
        return json(request, {
          ok: true,
          ...technicalResolverFailure({
            sourceText: productQuery,
            searchAnywayAllowed: false,
          }),
          confirmation_required: false,
        });
      }
    } else {
      return json(request, {
        ok: true,
        ...technicalResolverFailure({
          sourceText: productQuery,
          searchAnywayAllowed: false,
        }),
        confirmation_required: false,
      });
    }

    const event = await admin.rpc("record_smart_product_resolution_event_v1", {
      p_company_id: companyId,
      p_requested_by: user.id,
      p_idempotency_key: idempotencyKey,
      p_cache_id: cacheId,
      p_resolver_type: smartResult.resolution_type,
    });
    if (event.error) {
      return json(request, {
        error: "Product resolution could not be saved.",
      }, 503);
    }
    return json(request, {
      ok: true,
      ...smartResult,
      resolver_version: SMART_PRODUCT_RESOLVER_VERSION,
      implementation_version: SMART_PRODUCT_RESOLVER_IMPLEMENTATION_VERSION,
      resolution_event_id: record(event.data).resolution_event_id || null,
      confirmation_required: [
        "smart_match",
        "ambiguous",
        "temporary_intent",
      ].includes(smartResult.resolution),
    });
  }
  if (operation === "confirm_product_resolution") {
    const eventId = String(body.resolution_event_id || "");
    const optionIndex = Number(body.option_index);
    if (
      !UUID_PATTERN.test(eventId) || !Number.isSafeInteger(optionIndex) ||
      optionIndex < 0 || optionIndex > 3
    ) {
      return json(request, { error: "Valid clarification is required." }, 400);
    }
    const confirmed = await admin.rpc(
      "confirm_smart_product_resolution_option_v1",
      {
        p_company_id: companyId,
        p_requested_by: user.id,
        p_event_id: eventId,
        p_option_index: optionIndex,
      },
    );
    if (confirmed.error) {
      return json(
        request,
        { error: "This product clarification is no longer available." },
        confirmed.error.code === "42501" ? 403 : 409,
      );
    }
    const result = record(confirmed.data);
    const suggestions = array(result.suggestions);
    return json(request, {
      ok: true,
      ...result,
      resolution: suggestions.length ? "smart_match" : "temporary_intent",
      recommended: suggestions[0] || null,
      alternatives: suggestions.slice(1),
      search_anyway_allowed: !suggestions.length,
      confirmation_required: false,
      confirmed: true,
      use_unmapped: !suggestions.length,
      semantic_provider_used: false,
      provider_requests: 0,
      estimated_cost_usd: 0,
      cache_hit: true,
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
  const requestedRunMode = String(body.run_mode || "NORMAL_DISCOVERY")
    .trim().toUpperCase() as DiscoveryRunMode;
  const intentEventId = String(intent.resolution_event_id || "");
  let smartTemporaryIntent = false;
  if (
    String(intent.intent_source || "").toUpperCase() === "UNMAPPED_PRODUCT" &&
    UUID_PATTERN.test(intentEventId)
  ) {
    const smartEvent = await admin.from("product_resolution_events").select(
      "id,resolver_type,resolution_status,medical_product_confirmed,ambiguity",
    ).eq("id", intentEventId).eq("company_id", companyId).eq(
      "requested_by",
      user.id,
    ).maybeSingle();
    smartTemporaryIntent = !smartEvent.error &&
      ["AI", "CACHED_AI"].includes(String(smartEvent.data?.resolver_type)) &&
      ["UNMAPPED", "UNMAPPED_SEARCH"].includes(
        String(smartEvent.data?.resolution_status),
      ) && smartEvent.data?.medical_product_confirmed === true &&
      String(smartEvent.data?.ambiguity) === "NONE";
  }
  let smartAdminFresh = false;
  const baseRunId = String(body.base_run_id || "");
  if (requestedRunMode === "ADMIN_QA_FRESH" && UUID_PATTERN.test(baseRunId)) {
    const baseRun = await admin.from("external_prospect_discovery_runs").select(
      "id,intent_context",
    ).eq("id", baseRunId).eq("company_id", companyId).maybeSingle();
    smartAdminFresh = !baseRun.error && ["AI", "CACHED_AI"].includes(
      String(record(baseRun.data?.intent_context).resolver_type || ""),
    );
  }
  const start = requestedRunMode === "FRESH_DISCOVERY"
    ? await authClient.rpc("start_customer_buyer_discovery_fresh_v1", {
      p_company_id: companyId,
      p_idempotency_key: idempotencyKey,
      p_base_run_id: baseRunId,
    })
    : smartAdminFresh
    ? await authClient.rpc("start_smart_product_admin_fresh_v1", {
      p_company_id: companyId,
      p_idempotency_key: idempotencyKey,
      p_base_run_id: baseRunId,
    })
    : smartTemporaryIntent
    ? await authClient.rpc("start_smart_external_prospect_discovery_v1", {
      p_company_id: companyId,
      p_idempotency_key: idempotencyKey,
      p_intent: intent,
    })
    : await authClient.rpc("start_external_prospect_discovery_v3", {
      p_company_id: companyId,
      p_idempotency_key: idempotencyKey,
      p_intent: intent,
      p_run_mode: requestedRunMode,
    });
  if (start.error) {
    const startCode = String(start.error.message || "DISCOVERY_START_FAILED")
      .toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
    const publicStartCode = startCode.includes("INSUFFICIENT")
      ? "INSUFFICIENT_CREDITS"
      : startCode;
    return json(
      request,
      {
        error: publicStartCode === "INSUFFICIENT_CREDITS"
          ? "Fresh Discovery requires 1 credit."
          : sanitizeEvidenceText(start.error.message, 300),
        code: publicStartCode,
        credit_charged: false,
      },
      start.error.code === "42501"
        ? 403
        : startCode.includes("INSUFFICIENT")
        ? 409
        : 429,
    );
  }
  const run = record(start.data);
  if (run.reused === true) {
    return json(request, {
      ok: true,
      run,
      cached: true,
      run_mode: "CACHED_REUSE",
      provider_requests: 0,
      estimated_cost_usd: 0,
    });
  }
  const runId = String(run.run_id || "");
  const searchSpaceId = String(run.search_space_id || "");
  const runMode = String(
    run.run_mode || "NORMAL_DISCOVERY",
  ) as DiscoveryRunMode;
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
  let aiBuyerJudgeProviderRequests = 0;
  let aiBuyerJudgeCostUsd = 0;
  let aiBuyerJudgeClassifications = 0;
  let aiBuyerJudgeCacheHits = 0;
  let aiBuyerJudgeFallbacks = 0;
  let aiBuyerJudgeLatencyMs = 0;
  let adaptiveRetrievalProviderRequests = 0;
  let adaptiveRetrievalCostUsd = 0;
  let adaptiveRetrievalRuntime: AdaptiveRetrievalRuntime = {
    intelligence: null,
    diagnostics: {
      enabled: false,
      source: "DISABLED",
      version: ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_VERSION,
      implementationVersion:
        ADAPTIVE_MEDICAL_COMMERCIAL_RETRIEVAL_IMPLEMENTATION_VERSION,
      model: null,
      providerRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
      cacheHit: false,
      fallbackReason: null,
      validation: null,
      cacheFailureRecorded: null,
    },
  };
  let providerExecutionStarted = false;
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
    const unmappedIntent = String(intentContext.intent_source || "") ===
      "UNMAPPED_PRODUCT";
    const taxonomyIds = [
      ...new Set(
        taxonomyContextRows.map((item) => Number(item.taxonomy_id)).filter(
          Number.isSafeInteger,
        ),
      ),
    ];
    if (
      !UUID_PATTERN.test(runId) || !UUID_PATTERN.test(searchSpaceId) ||
      !/^[a-f0-9]{64}$/.test(intentHash) ||
      (!unmappedIntent && !taxonomyIds.length)
    ) {
      throw new Error("TAXONOMY_CONTEXT_UNAVAILABLE");
    }
    const catalog = await taxonomyCatalog(admin);
    const selectedTaxonomy = catalog.filter((item) =>
      taxonomyIds.includes(item.id)
    );
    const productFamily = unmappedIntent
      ? buildTemporaryProductFamilyProfile({
        phrase: intentContext.normalized_product_phrase,
        intentHash,
        smartResolution:
          ["AI", "CACHED_AI"].includes(String(intentContext.resolver_type)) &&
            String(intentContext.resolved_product_concept || "").trim() &&
            String(intentContext.product_family || "").trim()
            ? {
              resolvedConcept: String(
                intentContext.resolved_product_concept,
              ),
              productFamily: String(intentContext.product_family),
              commercialTermsEn: texts(intentContext.commercial_terms_en),
            }
            : null,
      })
      : buildProductFamilyProfile(
        selectedTaxonomy.length
          ? selectedTaxonomy.map((item) => ({
            taxonomyId: item.id,
            canonicalName: item.canonicalName,
            slug: item.slug,
            aliases: item.aliases,
            localizedAliases: item.localizedAliases,
          }))
          : taxonomyContextRows.map((item) => ({
            taxonomyId: Number(item.taxonomy_id),
            canonicalName: first(item.canonical_name),
            slug: first(item.slug),
            aliases: [] as string[],
          })),
      );
    const unmappedRetrievalTerms = productFamily.temporaryIntent
      ?.retrievalTerms || [];
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
    const fallbackCpv = unmappedIntent
      ? []
      : cpvCodesFromIntent.length
      ? cpvCodesFromIntent
      : ["33100000", "33140000", "33190000"];
    adaptiveRetrievalRuntime = await resolveAdaptiveRetrievalRuntime({
      admin,
      sourceText: first(intentContext.normalized_product_phrase) ||
        productFamily.label,
      canonicalConcept: first(intentContext.resolved_product_concept) ||
        productFamily.label,
      productFamily: first(intentContext.product_family) || productFamily.label,
      commercialTerms: [
        ...texts(intentContext.commercial_terms_en),
        ...productFamily.directTerms,
      ].slice(0, 6),
      resolverVersion: first(intentContext.resolver_version) ||
        "DETERMINISTIC_V2",
      inputLanguage: first(intentContext.input_language) || "en",
    });
    adaptiveRetrievalProviderRequests =
      adaptiveRetrievalRuntime.diagnostics.providerRequests;
    adaptiveRetrievalCostUsd =
      adaptiveRetrievalRuntime.diagnostics.estimatedCostUsd;
    const [partitionHistoryResult, freshYieldResult, seenCompanyResult] =
      await Promise.all([
        admin.from("buyer_discovery_partitions").select(
          "partition_key,last_explored_at,executions,new_buyer_yield,updated_buyer_yield,direct_verified_yield,provider_requests",
        ).eq("search_space_id", searchSpaceId),
        admin.from("external_prospect_discovery_runs").select(
          "new_verified_buyers",
        ).eq("search_space_id", searchSpaceId)
          .in("run_mode", ["FRESH_DISCOVERY", "ADMIN_QA_FRESH"])
          .in("status", ["PARTIAL", "COMPLETED"])
          .order("completed_at", { ascending: false }).limit(3),
        admin.from("buyer_discovery_seen_companies").select(
          "external_company_id,evidence_fingerprint",
        ).eq("search_space_id", searchSpaceId),
      ]);
    if (
      partitionHistoryResult.error || freshYieldResult.error ||
      seenCompanyResult.error
    ) {
      throw new Error("DISCOVERY_SEARCH_HISTORY_UNAVAILABLE");
    }
    const seenCompanyRows = array(seenCompanyResult.data).map(record);
    const seenExternalIds = seenCompanyRows.map((item) =>
      Number(item.external_company_id)
    ).filter(Number.isSafeInteger);
    const seenIdentityResult = seenExternalIds.length
      ? await admin.from("external_companies").select(
        "id,normalized_domain,normalized_company_name,registry_identifier,country_code",
      ).in("id", seenExternalIds)
      : { data: [], error: null };
    if (seenIdentityResult.error) {
      throw new Error("DISCOVERY_SEEN_IDENTITY_UNAVAILABLE");
    }
    const seenFingerprintByIdentity = new Map<string, string>();
    const fingerprintByExternalId = new Map(
      seenCompanyRows.map((item) => [
        Number(item.external_company_id),
        first(item.evidence_fingerprint),
      ]),
    );
    for (const value of array(seenIdentityResult.data)) {
      const identity = record(value);
      const fingerprint = fingerprintByExternalId.get(Number(identity.id));
      if (!fingerprint) continue;
      for (
        const key of [
          first(identity.normalized_domain),
          first(identity.normalized_company_name),
          first(identity.registry_identifier),
        ].filter(Boolean)
      ) seenFingerprintByIdentity.set(key, fingerprint);
    }
    const partitionHistory: SearchPartitionHistory[] = array(
      partitionHistoryResult.data,
    ).map(record).filter((item) => item.last_explored_at).map((item) => ({
      partitionKey: first(item.partition_key),
      lastExploredAt: first(item.last_explored_at),
      executions: Math.max(0, Number(item.executions) || 0),
      newBuyerYield: Math.max(0, Number(item.new_buyer_yield) || 0),
      directVerifiedYield: Math.max(
        0,
        Number(item.direct_verified_yield) || 0,
      ),
    }));
    const partitionHistoryRecordByKey = new Map(
      array(partitionHistoryResult.data).map(record).map((item) => [
        first(item.partition_key),
        item,
      ]),
    );
    const recentFreshYields = array(freshYieldResult.data).map((item) =>
      Math.max(0, Number(record(item).new_verified_buyers) || 0)
    ).reverse();
    const searchPlan = buildDiscoverySearchPlan({
      runMode,
      productFamily,
      targetCountries,
      cpvCodes: fallbackCpv,
      history: partitionHistory,
      recentFreshYields,
      adaptiveIntelligence: adaptiveRetrievalRuntime.intelligence,
    });
    const tedSearchPlan = searchPlan.tedPartitions.flatMap((partition) => {
      const plan = boundedTedSearchPlan({
        directTerms: partition.retrievalKind === "DIRECT_TERMS"
          ? partition.terminology
          : [],
        adjacentTerms: partition.retrievalKind === "ADJACENT_TERMS"
          ? partition.terminology
          : [],
        cpvCodes: partition.retrievalKind === "RELATED_CPV"
          ? partition.terminology
          : [],
        targetCountries: partition.countryCodes,
      });
      const selected = plan.find((item) =>
        partition.retrievalKind === "RELATED_CPV"
          ? item.retrievalKind === "RELATED_CPV"
          : item.retrievalKind === "PRODUCT_TERMS"
      );
      return selected ? [selected] : [];
    }).filter((item, index, values) =>
      values.findIndex((candidate) => candidate.query === item.query) === index
    ).slice(0, searchPlan.budget.maximumTedRequests);
    const partitionRows = buildPartitionPersistenceRows(
      searchSpaceId,
      searchPlan.selectedPartitions,
    );
    if (partitionRows.length) {
      const partitionSeed = await admin.from("buyer_discovery_partitions")
        .upsert(partitionRows, {
          onConflict: "search_space_id,partition_key",
          ignoreDuplicates: true,
        });
      if (partitionSeed.error) {
        throw new Error("DISCOVERY_PARTITION_SEED_FAILED");
      }
      const storedPartitions = await admin.from("buyer_discovery_partitions")
        .select("id,partition_key,last_explored_at")
        .eq("search_space_id", searchSpaceId)
        .in("partition_key", partitionRows.map((item) => item.partition_key));
      if (storedPartitions.error) {
        throw new Error("DISCOVERY_PARTITION_LOAD_FAILED");
      }
      const historyKeys = new Set(
        partitionHistory.map((item) => item.partitionKey),
      );
      const planWrites = array(storedPartitions.data).map(record).map(
        (stored, ordinal) => ({
          run_id: runId,
          partition_id: Number(stored.id),
          ordinal,
          novelty: historyKeys.has(first(stored.partition_key))
            ? "STALE_REVISIT"
            : "NEW_PARTITION",
          status: "PLANNED",
        }),
      );
      const planWrite = await admin.from("buyer_discovery_run_partitions")
        .upsert(planWrites, { onConflict: "run_id,partition_id" });
      if (planWrite.error) throw new Error("DISCOVERY_RUN_PLAN_WRITE_FAILED");
    }
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
    const boundedPublicWebQueries = Math.min(
      searchPlan.budget.maximumPublicWebQueries,
      publicWebMaximumQueries,
    );
    const publicWebMaximumCost = boundedEnvironmentNumber(
      Deno.env.get("PUBLIC_WEB_MAX_COST_USD_PER_RUN"),
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumCostUsdPerRun,
      0,
      PUBLIC_WEB_DISCOVERY_LIMITS.maximumCostUsdPerRun,
    );
    const boundedPublicWebCost = Math.min(
      searchPlan.budget.maximumPublicWebCostUsd,
      publicWebMaximumCost,
    );
    await updateProgress({
      stage: "preparing_market_search",
      queries_generated: legacyQueryProgressCount(
        tedSearchPlan.length + searchPlan.publicWebQueries.length,
      ),
      taxonomy_mapped: Math.min(100, taxonomyIds.length),
      product_profile: searchPlan.productProfile,
      partition_summary: {
        version: searchPlan.version,
        run_mode: runMode,
        selected_partition_keys: searchPlan.selectedPartitions.map((item) =>
          item.partitionKey
        ),
        languages: [
          ...new Set(
            searchPlan.selectedPartitions.map((item) => item.language),
          ),
        ],
        regions: [
          ...new Set(
            searchPlan.selectedPartitions.map((item) => item.marketRegion),
          ),
        ],
        buyer_archetypes: [
          ...new Set(
            searchPlan.selectedPartitions.map((item) => item.buyerArchetype),
          ),
        ],
        unused_partitions_remaining: searchPlan.unusedPartitionsRemaining,
        stale_partitions_revisited: searchPlan.stalePartitionsRevisited,
        saturation: searchPlan.saturation,
        provider_budget: searchPlan.budget,
        adaptive: searchPlan.adaptive || null,
      },
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
          market_profile: searchPlan.productProfile,
        },
        discovery_run_mode: runMode,
        search_space_id: searchSpaceId,
        selected_search_partitions: searchPlan.selectedPartitions.map((
          item,
        ) => ({
          partition_key: item.partitionKey,
          provider_kind: item.providerKind,
          partition_type: item.partitionType,
          terminology: item.terminology,
          language: item.language,
          countries: item.countryCodes,
          market_region: item.marketRegion,
          buyer_archetype: item.buyerArchetype,
          retrieval_kind: item.retrievalKind,
          adaptive_stage: item.adaptiveStage || null,
          adaptive_query_type: item.adaptiveQueryType || null,
          commercial_intent: item.commercialIntent || null,
          retrieval_confidence: item.retrievalConfidence || null,
          expected_buyer_channel_value: item.expectedBuyerChannelValue || null,
        })),
        adaptive_medical_retrieval: {
          ...adaptiveRetrievalRuntime.diagnostics,
          product_understanding_source: first(intentContext.resolver_type) ||
            "DETERMINISTIC",
          generated_term_counts: searchPlan.adaptive?.generatedTermCounts || {},
          channel_archetypes:
            adaptiveRetrievalRuntime.intelligence?.channel_archetypes || [],
          negative_context_count:
            adaptiveRetrievalRuntime.intelligence?.negative_contexts.length ||
            0,
          active_stage: searchPlan.adaptive?.activeStage || null,
          stage_stop_reason: searchPlan.adaptive?.stageStopReason || null,
          queries_planned: searchPlan.publicWebQueries.length,
          ted_partitions_planned: searchPlan.tedPartitions.length,
        },
        unused_partitions_remaining: searchPlan.unusedPartitionsRemaining,
        stale_partitions_revisited: searchPlan.stalePartitionsRevisited,
        search_saturation: searchPlan.saturation,
        countries_attempted: discoveryCountries,
        public_web_discovery_enabled: publicWebEnabled,
        public_web_query_limit: boundedPublicWebQueries,
        public_web_cost_limit_usd: boundedPublicWebCost,
        temporary_unmapped_intent: unmappedIntent,
        unmapped_retrieval_plan: unmappedIntent
          ? {
            version: "UNMAPPED_RETRIEVAL_V2",
            family_signature: productFamily.temporaryIntent?.familySignature ||
              null,
            original_normalized_phrase:
              productFamily.temporaryIntent?.normalizedPhrase || null,
            terms: unmappedRetrievalTerms.map((term) => ({
              term: term.term,
              language: term.language,
              countries: term.countries,
              confidence: term.confidence,
              source: term.source,
              reason: term.reason,
            })),
          }
          : null,
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
      queries_generated: legacyQueryProgressCount(
        tedSearchPlan.length + searchPlan.publicWebQueries.length,
      ),
    });
    if (searchPlan.selectedPartitions.length) {
      const executionAcceptance = await admin.rpc(
        "accept_buyer_discovery_execution_v2",
        { p_run_id: runId },
      );
      if (executionAcceptance.error) {
        throw new Error(
          String(
            executionAcceptance.error.message ||
              "DISCOVERY_EXECUTION_ACCEPTANCE_FAILED",
          ),
        );
      }
      const partitionStart = await admin.from("buyer_discovery_run_partitions")
        .update({ status: "STARTED", started_at: new Date().toISOString() })
        .eq("run_id", runId);
      if (partitionStart.error) {
        throw new Error("DISCOVERY_PARTITION_START_FAILED");
      }
      const providerStart = await admin.rpc(
        "mark_buyer_discovery_provider_started_v1",
        { p_run_id: runId },
      );
      if (providerStart.error) {
        throw new Error("DISCOVERY_PROVIDER_START_FAILED");
      }
      providerExecutionStarted = true;
    } else if (runMode === "FRESH_DISCOVERY") {
      throw new Error("NO_FRESH_SEARCH_SPACE");
    }
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
        maximumQueries: boundedPublicWebQueries,
        maximumCostUsd: boundedPublicWebCost,
        queryPlan: searchPlan.publicWebQueries,
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
    const deterministicRanking = rankProspects(
      deduped.candidates,
      productFamily,
      {
        europeWide: targetCountries.length === 0,
      },
    );
    const judgeFeatureResult = await admin.from(
      "ai_buyer_relevance_judge_feature_state",
    ).select(
      "ai_buyer_judge_enabled,judge_version,implementation_version,model_name,maximum_candidates_per_run,maximum_candidates_per_batch,maximum_cost_usd_per_run",
    ).eq("singleton", true).maybeSingle();
    const judgeFeature = record(judgeFeatureResult.data);
    const aiBuyerJudgeEnabled = !judgeFeatureResult.error &&
      judgeFeature.ai_buyer_judge_enabled === true &&
      first(judgeFeature.judge_version) ===
        AI_BUYER_RELEVANCE_JUDGE_VERSION &&
      first(judgeFeature.implementation_version) ===
        AI_BUYER_RELEVANCE_JUDGE_IMPLEMENTATION_VERSION;
    const aiBuyerJudgeModel = first(judgeFeature.model_name) ||
      DEFAULT_AI_BUYER_RELEVANCE_JUDGE_MODEL;
    const aiBuyerJudge = await runAiBuyerRelevanceJudge({
      enabled: aiBuyerJudgeEnabled,
      productFamily,
      accepted: deterministicRanking.accepted,
      rejected: deterministicRanking.rejected,
      apiKey: aiBuyerJudgeEnabled
        ? String(Deno.env.get("ANTHROPIC_API_KEY") || "")
        : "",
      model: aiBuyerJudgeModel,
      inputUsdPerMillion: boundedEnvironmentNumber(
        Deno.env.get("AI_BUYER_JUDGE_INPUT_COST_PER_MILLION_TOKENS"),
        1,
        0.01,
        100,
      ),
      outputUsdPerMillion: boundedEnvironmentNumber(
        Deno.env.get("AI_BUYER_JUDGE_OUTPUT_COST_PER_MILLION_TOKENS"),
        5,
        0.01,
        100,
      ),
      maximumCandidatesPerRun: Number(
        judgeFeature.maximum_candidates_per_run,
      ),
      maximumCandidatesPerBatch: Number(
        judgeFeature.maximum_candidates_per_batch,
      ),
      maximumCostUsdPerRun: Number(
        judgeFeature.maximum_cost_usd_per_run,
      ),
      cache: {
        reserve: async (
          candidate: AiBuyerJudgeCandidate,
          product: AiBuyerJudgeProductContext,
        ) => {
          const reservation = await admin.rpc(
            "reserve_ai_buyer_relevance_judgment_v1",
            {
              p_company_id: companyId,
              p_requested_by: user.id,
              p_discovery_run_id: runId,
              p_candidate_key: candidate.candidateKey,
              p_candidate_name: candidate.candidateName,
              p_candidate_domain: candidate.candidateDomain,
              p_product_intent_key: product.productIntentKey,
              p_product_label: product.canonicalConcept,
              p_evidence_fingerprint: candidate.evidenceFingerprint,
              p_judge_version: AI_BUYER_RELEVANCE_JUDGE_VERSION,
              p_implementation_version:
                AI_BUYER_RELEVANCE_JUDGE_IMPLEMENTATION_VERSION,
              p_model_name: aiBuyerJudgeModel,
              p_deterministic_grade: candidate.deterministicGrade,
              p_deterministic_score: candidate.deterministicScore,
            },
          );
          if (reservation.error) {
            throw aiBuyerJudgeRpcError("RESERVATION", reservation.error);
          }
          const value = record(reservation.data);
          const decision = String(value.decision || "RECENT_FAILURE") as
            | "DISABLED"
            | "CACHED"
            | "PROCEED"
            | "IN_PROGRESS"
            | "RECENT_FAILURE";
          const cacheId = value.cache_id == null
            ? null
            : aiBuyerJudgeCacheId(value.cache_id);
          if (
            value.cache_id != null && !cacheId &&
            (decision === "PROCEED" || decision === "CACHED" ||
              decision === "IN_PROGRESS" || decision === "RECENT_FAILURE")
          ) {
            throw new AiBuyerJudgeCacheOperationError(
              "AI_BUYER_JUDGE_CACHE_ID_INVALID",
            );
          }
          return {
            decision,
            cacheId,
            structuredResult: value.structured_result,
          };
        },
        complete: async (
          candidate: AiBuyerJudgeCandidate,
          judgment: AiBuyerRelevanceJudgment,
          finalScore: AiBuyerReviewedScore,
          provider: AiBuyerJudgeProviderResult,
        ) => {
          if (!candidate.cacheId) {
            throw new AiBuyerJudgeCacheOperationError(
              "AI_BUYER_JUDGE_CACHE_ID_MISSING",
            );
          }
          const allocation = Math.max(1, provider.judgments.length);
          const allocatedInputTokens = Math.ceil(
            provider.inputTokens / allocation,
          );
          const allocatedOutputTokens = Math.ceil(
            provider.outputTokens / allocation,
          );
          const completion = await admin.rpc(
            "complete_ai_buyer_relevance_judgment_v1",
            {
              p_cache_id: candidate.cacheId,
              p_structured_result: judgment,
              p_ai_recommended_grade: judgment.recommended_grade,
              p_final_grade: finalScore.commercialBuyerGrade,
              p_buyer_fit_score: finalScore.buyerFitScore,
              p_model_name: provider.model,
              p_provider_request_id: provider.providerRequestId,
              p_input_tokens: allocatedInputTokens,
              p_output_tokens: allocatedOutputTokens,
              p_total_tokens: allocatedInputTokens + allocatedOutputTokens,
              p_estimated_cost_usd: Number(
                (provider.estimatedCostUsd / allocation).toFixed(6),
              ),
              p_latency_ms: provider.latencyMs,
            },
          );
          if (completion.error) {
            // If the write committed but its response was lost, the bounded
            // retry must behave as a successful duplicate completion rather
            // than degrading a paid provider result to fallback.
            const existingResult = await admin.from(
              "buyer_relevance_judgments",
            ).select(
              "status,candidate_key,product_intent_key,evidence_fingerprint,model_name,structured_result,final_grade,buyer_fit_score",
            ).eq("id", candidate.cacheId).maybeSingle();
            if (
              !existingResult.error && aiBuyerJudgeCompletionMatches({
                row: existingResult.data,
                candidate,
                judgment,
                finalScore,
                provider,
              })
            ) return;
            throw aiBuyerJudgeRpcError("COMPLETION", completion.error);
          }
        },
        fail: async (candidate: AiBuyerJudgeCandidate, errorCode: string) => {
          if (!candidate.cacheId) return;
          const failure = await admin.rpc(
            "fail_ai_buyer_relevance_judgment_v1",
            {
              p_cache_id: candidate.cacheId,
              p_error_code: errorCode,
            },
          );
          if (failure.error) {
            throw aiBuyerJudgeRpcError("FAILURE_WRITE", failure.error);
          }
        },
      },
    });
    aiBuyerJudgeProviderRequests = aiBuyerJudge.diagnostics.providerRequests;
    aiBuyerJudgeCostUsd = aiBuyerJudge.diagnostics.estimatedCostUsd;
    aiBuyerJudgeClassifications = aiBuyerJudge.diagnostics.judgedCandidates;
    aiBuyerJudgeCacheHits = aiBuyerJudge.diagnostics.cacheHits;
    aiBuyerJudgeFallbacks = aiBuyerJudge.diagnostics.fallbackCount;
    aiBuyerJudgeLatencyMs = aiBuyerJudge.diagnostics.totalLatencyMs;
    const ranking = {
      accepted: aiBuyerJudge.accepted,
      rejected: aiBuyerJudge.rejected,
      diagnostics: deterministicRanking.diagnostics,
    };
    const acceptedWithNovelty = await Promise.all(ranking.accepted.map(
      async (ranked) => {
        const currentFingerprint = await candidateEvidenceFingerprint(
          ranked.candidate,
        );
        const priorFingerprint = candidateHistoryKeys(ranked.candidate)
          .map((key) => seenFingerprintByIdentity.get(key)).find(Boolean) ||
          null;
        return {
          ranked,
          discoveryState: classifyDiscoveryResultState({
            priorEvidenceFingerprint: priorFingerprint,
            currentEvidenceFingerprint: currentFingerprint,
          }),
        };
      },
    ));
    const noveltyPriority: Record<DiscoveryResultState, number> = {
      NEW: 0,
      UPDATED: 1,
      PREVIOUSLY_DISCOVERED: 2,
    };
    if (runMode !== "NORMAL_DISCOVERY") {
      acceptedWithNovelty.sort((left, right) =>
        noveltyPriority[left.discoveryState] -
          noveltyPriority[right.discoveryState] ||
        (right.ranked.score.buyerFitScore ??
            right.ranked.score.relevanceScore) -
          (left.ranked.score.buyerFitScore ?? left.ranked.score.relevanceScore)
      );
    }
    const retrievalTermOutcomes = unmappedRetrievalTerms.map((term) => {
      const normalized = normalizeRetrievalTerm(term.term);
      const verifiedDirectEvidence = [...ranking.accepted, ...ranking.rejected]
        .flatMap((item) => item.candidate.evidence)
        .filter((evidence) =>
          evidence.relevanceClass === "DIRECT" &&
          (evidence.matchedTerms || []).some((matched) =>
            normalizeRetrievalTerm(matched) === normalized
          )
        );
      return {
        term: term.term,
        language: term.language,
        confidence: term.confidence,
        source: term.source,
        verified_direct_evidence_count: verifiedDirectEvidence.length,
        verified_direct_source_types: [
          ...new Set(verifiedDirectEvidence.map((item) => item.sourceType)),
        ],
      };
    });
    let accepted = 0;
    let rejected = ranking.rejected.length;
    const persistedCandidates: Array<{
      candidate: ProspectCandidate;
      externalCompanyId: number;
      evidenceFingerprint: string;
      discoveryState: DiscoveryResultState;
    }> = [];
    for (const item of acceptedWithNovelty) {
      const persisted = await persistCandidate(
        admin,
        companyId,
        runId,
        searchSpaceId,
        intentHash,
        taxonomyContextRows,
        item.ranked.candidate,
        item.ranked.score,
        productFamily,
      );
      if (persisted) {
        accepted += 1;
        persistedCandidates.push({
          candidate: item.ranked.candidate,
          ...persisted,
        });
      } else rejected += 1;
    }
    const stateCounts = persistedCandidates.reduce<
      Record<DiscoveryResultState, number>
    >(
      (counts, item) => {
        counts[item.discoveryState] += 1;
        return counts;
      },
      { NEW: 0, UPDATED: 0, PREVIOUSLY_DISCOVERED: 0 },
    );
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
      public_web_query_strategies: publicWeb.queryStrategies,
      public_web_query_plan: publicWeb.queryPlan.map((item) => ({
        term: item.retrievalTerm || null,
        country: item.country,
        language: item.language,
        strategy: item.strategy || null,
        confidence: item.retrievalTermConfidence || null,
        source: item.retrievalTermSource || null,
        family_signature: item.familySignature || null,
      })),
      unmapped_retrieval_term_outcomes: unmappedIntent
        ? retrievalTermOutcomes
        : [],
      public_web_results_received: publicWeb.resultsReceived,
      public_web_candidates_created: publicWeb.candidatesCreated,
      public_web_candidates_verified: website.publicWebVerified,
      public_web_commercial_identity_rejected: website.identityRejected,
      public_web_organization_requests: website.organizationRequests,
      public_web_organization_verified: website.organizationVerified,
      public_web_editorial_rejected: website.editorialRejected,
      public_web_domain_fallback_used: website.domainFallbackUsed,
      candidate_domains_total: website.candidateDomainsTotal,
      candidate_domains_ranked: website.candidateDomainsRanked,
      verification_slots: website.verificationSlots,
      verification_attempted: website.verificationAttempted,
      verification_success: website.verificationSuccess,
      official_company_domains: website.officialCompanyDomains,
      directory_domains_skipped: website.directoryDomainsSkipped,
      marketplace_domains_skipped: website.marketplaceDomainsSkipped,
      product_pages_found: website.productPagesFound,
      commercial_role_pages_found: website.commercialRolePagesFound,
      combined_domain_evidence_count: website.combinedDomainEvidenceCount,
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
      direct_buyers: ranking.diagnostics.directBuyers,
      adjacent_buyers: ranking.diagnostics.adjacentBuyers,
      end_buyer_procurement_signals:
        ranking.diagnostics.endBuyerProcurementSignals,
      end_buyer_procurement_signal_details: deterministicRanking.rejected
        .filter((item) =>
          item.score.salesProspectClassification ===
            "END_BUYER_PROCUREMENT_SIGNAL"
        ).slice(0, 6).map((item) => ({
          candidate_name: sanitizeEvidenceText(item.candidate.name, 180),
          country_code: item.candidate.countryCode,
          procurement_demand_signal: true,
          product_fit: item.score.commercialFitClassification,
          direct_sales_actionability: "LOW",
          evidence: item.candidate.evidence.filter((evidence) =>
            evidence.relevanceClass === "DIRECT" ||
            evidence.relevanceClass === "ADJACENT"
          ).slice(0, 2).map((evidence) => ({
            source_type: evidence.sourceType,
            source_domain: evidence.sourceDomain,
            source_title: sanitizeEvidenceText(evidence.title, 120),
            notice_id: evidence.noticeId || null,
            procurement_role: evidence.procurementRole || null,
          })),
        })),
      product_relevant_not_buyer: ranking.diagnostics.productRelevantNotBuyer,
      generic_only_rejected: ranking.diagnostics.genericOnlyRejected,
      product_family_mismatch_rejected:
        ranking.diagnostics.productFamilyMismatchRejected,
      diversity_tie_breaks_applied:
        ranking.diagnostics.diversityTieBreaksApplied,
      product_family: {
        key: productFamily.key,
        label: productFamily.label,
      },
      adaptive_medical_retrieval: {
        ...adaptiveRetrievalRuntime.diagnostics,
        product_understanding_source: first(intentContext.resolver_type) ||
          "DETERMINISTIC",
        canonical_product:
          adaptiveRetrievalRuntime.intelligence?.canonical_product || null,
        product_family: adaptiveRetrievalRuntime.intelligence?.product_family ||
          null,
        generated_term_counts: searchPlan.adaptive?.generatedTermCounts || {},
        channel_archetypes:
          adaptiveRetrievalRuntime.intelligence?.channel_archetypes || [],
        negative_context_count:
          adaptiveRetrievalRuntime.intelligence?.negative_contexts.length || 0,
        active_stage: searchPlan.adaptive?.activeStage || null,
        stage_stop_reason: searchPlan.adaptive?.stageStopReason || null,
        partition_stages_planned: searchPlan.selectedPartitions.reduce(
          (counts, partition) => {
            const stage = String(partition.adaptiveStage || "LEGACY");
            counts[stage] = (counts[stage] || 0) + 1;
            return counts;
          },
          {} as Record<string, number>,
        ),
        public_web_queries_planned: searchPlan.publicWebQueries.length,
        public_web_queries_executed: publicWeb.queriesUsed,
        ted_partitions_planned: searchPlan.tedPartitions.length,
        ted_requests_executed: ted.checked,
        candidates_observed: merged.length,
        direct_commercial_prospects_accepted: ranking.diagnostics.directBuyers,
        end_buyer_procurement_signals:
          ranking.diagnostics.endBuyerProcurementSignals,
        product_relevant_not_buyer: ranking.diagnostics.productRelevantNotBuyer,
        rejected_or_noisy: rejected,
      },
      ai_buyer_relevance_judge: {
        feature_state_available: !judgeFeatureResult.error,
        enabled: aiBuyerJudgeEnabled,
        judge_version: AI_BUYER_RELEVANCE_JUDGE_VERSION,
        implementation_version: AI_BUYER_RELEVANCE_JUDGE_IMPLEMENTATION_VERSION,
        model: aiBuyerJudgeModel,
        eligible_candidates: aiBuyerJudge.diagnostics.eligibleCandidates,
        judged_candidates: aiBuyerJudgeClassifications,
        cache_hits: aiBuyerJudgeCacheHits,
        provider_requests: aiBuyerJudgeProviderRequests,
        input_tokens: aiBuyerJudge.diagnostics.inputTokens,
        output_tokens: aiBuyerJudge.diagnostics.outputTokens,
        estimated_cost_usd: aiBuyerJudgeCostUsd,
        total_latency_ms: aiBuyerJudgeLatencyMs,
        deterministic_fallbacks: aiBuyerJudgeFallbacks,
        status_counts: aiBuyerJudge.diagnostics.statusCounts,
        failure_code_counts: aiBuyerJudge.diagnostics.failureCodeCounts,
        maximum_candidates_per_run:
          aiBuyerJudge.diagnostics.maximumCandidatesPerRun,
        maximum_candidates_per_batch:
          aiBuyerJudge.diagnostics.maximumCandidatesPerBatch,
        maximum_cost_usd_per_run: aiBuyerJudge.diagnostics.maximumCostUsdPerRun,
        contacts_collected: 0,
        fresh_credit_debits: 0,
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
      website_commercial_identity_rejected: website.identityRejected,
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
      discovery_result_states: {
        new: stateCounts.NEW,
        updated: stateCounts.UPDATED,
        previously_discovered: stateCounts.PREVIOUSLY_DISCOVERED,
      },
    };
    const partitionOutcomes = new Map(searchPlan.selectedPartitions.map(
      (partition) => [partition.partitionKey, {
        partition,
        candidateObservations: 0,
        newBuyers: 0,
        updatedBuyers: 0,
        directVerifiedBuyers: 0,
      }],
    ));
    for (const persisted of persistedCandidates) {
      const sourceKind = persisted.candidate.discoverySources?.includes(
          "PUBLIC_WEB",
        )
        ? "PUBLIC_WEB"
        : "TED";
      const evidenceTerms = new Set(
        persisted.candidate.evidence.flatMap((evidence) =>
          (evidence.matchedTerms || []).map(normalizeRetrievalTerm)
        ),
      );
      const outcome = [...partitionOutcomes.values()].find((item) =>
        item.partition.providerKind === sourceKind &&
        item.partition.terminology.some((term) =>
          evidenceTerms.has(normalizeRetrievalTerm(term))
        )
      ) || [...partitionOutcomes.values()].find((item) =>
        item.partition.providerKind === sourceKind
      );
      if (!outcome) {
        continue;
      }
      outcome.candidateObservations += 1;
      if (persisted.discoveryState === "NEW") {
        outcome.newBuyers += 1;
      }
      if (persisted.discoveryState === "UPDATED") {
        outcome.updatedBuyers += 1;
      }
      if (
        persisted.candidate.evidence.some((evidence) =>
          evidence.relevanceClass === "DIRECT"
        )
      ) {
        outcome.directVerifiedBuyers += 1;
      }
    }
    const storedPartitionResult = searchPlan.selectedPartitions.length
      ? await admin.from("buyer_discovery_partitions").select(
        "id,partition_key",
      ).eq("search_space_id", searchSpaceId).in(
        "partition_key",
        searchPlan.selectedPartitions.map((item) => item.partitionKey),
      )
      : { data: [], error: null };
    if (storedPartitionResult.error) {
      throw new Error("DISCOVERY_PARTITION_COMPLETION_LOAD_FAILED");
    }
    const webPartitions = searchPlan.selectedPartitions.filter((item) =>
      item.providerKind === "PUBLIC_WEB"
    );
    const tedPartitionsUsed = searchPlan.selectedPartitions.filter((item) =>
      item.providerKind === "TED"
    );
    for (const value of array(storedPartitionResult.data)) {
      const stored = record(value);
      const key = first(stored.partition_key);
      const outcome = partitionOutcomes.get(key);
      if (!outcome) continue;
      const prior = partitionHistoryRecordByKey.get(key) || {};
      const requestOrdinal = outcome.partition.providerKind === "PUBLIC_WEB"
        ? webPartitions.findIndex((item) => item.partitionKey === key)
        : tedPartitionsUsed.findIndex((item) => item.partitionKey === key);
      const providerRequests = requestOrdinal >= 0 &&
          requestOrdinal <
            (outcome.partition.providerKind === "PUBLIC_WEB"
              ? publicWebProviderRequests
              : ted.checked)
        ? 1
        : 0;
      const runPartitionWrite = await admin.from(
        "buyer_discovery_run_partitions",
      ).update({
        status: "COMPLETED",
        provider_requests: providerRequests,
        candidate_observations: Math.min(300, outcome.candidateObservations),
        new_buyer_yield: Math.min(30, outcome.newBuyers),
        updated_buyer_yield: Math.min(30, outcome.updatedBuyers),
        direct_verified_yield: Math.min(30, outcome.directVerifiedBuyers),
        estimated_cost_usd: outcome.partition.providerKind === "PUBLIC_WEB"
          ? providerRequests * PUBLIC_WEB_DISCOVERY_LIMITS.braveRequestCostUsd
          : 0,
        completed_at: new Date().toISOString(),
      }).eq("run_id", runId).eq("partition_id", Number(stored.id));
      if (runPartitionWrite.error) {
        throw new Error("DISCOVERY_RUN_PARTITION_COMPLETION_FAILED");
      }
      const partitionWrite = await admin.from("buyer_discovery_partitions")
        .update({
          status: "EXPLORED",
          executions: Math.max(0, Number(prior.executions) || 0) + 1,
          new_buyer_yield: Math.max(0, Number(prior.new_buyer_yield) || 0) +
            outcome.newBuyers,
          updated_buyer_yield:
            Math.max(0, Number(prior.updated_buyer_yield) || 0) +
            outcome.updatedBuyers,
          direct_verified_yield:
            Math.max(0, Number(prior.direct_verified_yield) || 0) +
            outcome.directVerifiedBuyers,
          provider_requests: Math.max(0, Number(prior.provider_requests) || 0) +
            providerRequests,
          last_explored_at: new Date().toISOString(),
        }).eq("id", Number(stored.id));
      if (partitionWrite.error) {
        throw new Error("DISCOVERY_PARTITION_COMPLETION_FAILED");
      }
    }
    const cumulativeResult = await admin.from(
      "buyer_discovery_seen_companies",
    ).select("id", { count: "exact", head: true })
      .eq("search_space_id", searchSpaceId);
    if (cumulativeResult.error) {
      throw new Error("DISCOVERY_CUMULATIVE_COUNT_FAILED");
    }
    const cumulativeVerifiedBuyers = Math.max(0, cumulativeResult.count || 0);
    const terminalSaturation = discoverySaturation([
      ...recentFreshYields,
      stateCounts.NEW,
    ]);
    const searchSpaceWrite = await admin.from("buyer_discovery_search_spaces")
      .update({
        product_profile: searchPlan.productProfile,
        cumulative_verified_buyers: cumulativeVerifiedBuyers,
        last_new_buyer_yield: stateCounts.NEW,
        zero_new_streak: stateCounts.NEW === 0
          ? Math.min(
            1000000,
            [...recentFreshYields].reverse().findIndex((value) => value > 0) < 0
              ? recentFreshYields.length + 1
              : [...recentFreshYields].reverse().findIndex((value) =>
                value > 0
              ) + 1,
          )
          : 0,
        saturation_signal: terminalSaturation,
        last_discovery_at: new Date().toISOString(),
      }).eq("id", searchSpaceId);
    if (searchSpaceWrite.error) {
      throw new Error("DISCOVERY_SEARCH_SPACE_COMPLETION_FAILED");
    }
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
        new_verified_buyers: stateCounts.NEW,
        updated_verified_buyers: stateCounts.UPDATED,
        previously_discovered_buyers: stateCounts.PREVIOUSLY_DISCOVERED,
        cumulative_verified_buyers: cumulativeVerifiedBuyers,
        taxonomy_mapped: Math.min(100, accepted * taxonomyIds.length),
        ai_classifications: aiBuyerJudgeClassifications,
        provider_requests: publicWebProviderRequests +
          aiBuyerJudgeProviderRequests + adaptiveRetrievalProviderRequests,
        estimated_cost_usd: Number(
          (publicWebProviderCostUsd + aiBuyerJudgeCostUsd +
            adaptiveRetrievalCostUsd).toFixed(6),
        ),
        fresh_request_state: runMode === "NORMAL_DISCOVERY"
          ? "NOT_FRESH"
          : partial
          ? "PARTIAL"
          : "COMPLETED",
        diagnostics,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    if (completion.error) {
      throw completion.error;
    }
    const verifiedEvidenceCount = ranking.accepted.reduce(
      (total, item) =>
        total +
        item.candidate.evidence.filter((evidence) =>
          evidence.relevanceClass === "DIRECT" ||
          evidence.relevanceClass === "ADJACENT"
        ).length,
      0,
    );
    const learning = await admin.rpc("record_product_resolution_outcome_v1", {
      p_run_id: runId,
      p_verified_evidence_count: Math.min(100, verifiedEvidenceCount),
      p_successful_discovery_count: accepted > 0 ? 1 : 0,
    });
    if (learning.error) throw new Error("PRODUCT_RESOLUTION_OUTCOME_FAILED");
    const creditAccount = runMode === "FRESH_DISCOVERY"
      ? await admin.from("buyer_discovery_credit_accounts").select("balance")
        .eq("company_id", companyId).maybeSingle()
      : null;
    return json(request, {
      ok: true,
      run: {
        run_id: runId,
        status: partial ? "PARTIAL" : "COMPLETED",
        stage: "completed",
        run_mode: runMode,
        search_space_id: searchSpaceId,
      },
      candidates_accepted: accepted,
      candidates_rejected: rejected,
      new_verified_buyers: stateCounts.NEW,
      updated_verified_buyers: stateCounts.UPDATED,
      previously_discovered_buyers: stateCounts.PREVIOUSLY_DISCOVERED,
      cumulative_verified_buyers: cumulativeVerifiedBuyers,
      result_summary: runMode === "NORMAL_DISCOVERY"
        ? `${cumulativeVerifiedBuyers} verified buyers found so far. Results verified at ${
          new Date().toISOString()
        }.`
        : freshDiscoveryMessage({
          newBuyers: stateCounts.NEW,
          updatedBuyers: stateCounts.UPDATED,
          previousBuyers: stateCounts.PREVIOUSLY_DISCOVERED,
          cumulativeBuyers: cumulativeVerifiedBuyers,
        }),
      provider_requests: publicWebProviderRequests +
        aiBuyerJudgeProviderRequests + adaptiveRetrievalProviderRequests,
      public_web_provider_requests: publicWebProviderRequests,
      adaptive_retrieval_provider_requests: adaptiveRetrievalProviderRequests,
      adaptive_retrieval_cache_hit:
        adaptiveRetrievalRuntime.diagnostics.cacheHit,
      adaptive_retrieval_fallback:
        adaptiveRetrievalRuntime.diagnostics.fallbackReason,
      adaptive_retrieval_estimated_cost_usd: adaptiveRetrievalCostUsd,
      ai_buyer_judge_provider_requests: aiBuyerJudgeProviderRequests,
      ai_classifications: aiBuyerJudgeClassifications,
      ai_buyer_judge_cache_hits: aiBuyerJudgeCacheHits,
      ai_buyer_judge_fallbacks: aiBuyerJudgeFallbacks,
      ai_buyer_judge_estimated_cost_usd: aiBuyerJudgeCostUsd,
      estimated_cost_usd: Number(
        (publicWebProviderCostUsd + aiBuyerJudgeCostUsd +
          adaptiveRetrievalCostUsd).toFixed(6),
      ),
      credit_balance: Number(creditAccount?.data?.balance || 0),
      credit_disposition: runMode === "FRESH_DISCOVERY"
        ? "DEBIT_CONSUMED"
        : runMode === "ADMIN_QA_FRESH"
        ? "WAIVED_ADMIN_QA"
        : "NOT_APPLICABLE",
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
    const publicErrorCode = errorCode.includes("INSUFFICIENT")
      ? "INSUFFICIENT_CREDITS"
      : errorCode;
    await admin.from("external_prospect_discovery_runs").update({
      status: "FAILED",
      stage: "failed",
      error_code: errorCode,
      ai_classifications: aiBuyerJudgeClassifications,
      provider_requests: publicWebProviderRequests +
        aiBuyerJudgeProviderRequests + adaptiveRetrievalProviderRequests,
      estimated_cost_usd: Number(
        (publicWebProviderCostUsd + aiBuyerJudgeCostUsd +
          adaptiveRetrievalCostUsd).toFixed(6),
      ),
      fresh_request_state: runMode === "NORMAL_DISCOVERY"
        ? "NOT_FRESH"
        : providerExecutionStarted
        ? "FAILED_POST_PROVIDER"
        : "FAILED_PRE_PROVIDER",
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    await admin.from("buyer_discovery_run_partitions").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
    }).eq("run_id", runId).in("status", ["PLANNED", "STARTED"]);
    console.error("external prospect discovery failed", {
      run_id: runId,
      error_code: errorCode,
    });
    const [failedCreditAccount, failedRun] = runMode === "FRESH_DISCOVERY"
      ? await Promise.all([
        admin.from("buyer_discovery_credit_accounts").select("balance")
          .eq("company_id", companyId).maybeSingle(),
        admin.from("external_prospect_discovery_runs").select(
          "credit_disposition,provider_execution_started_at",
        ).eq("id", runId).maybeSingle(),
      ])
      : [null, null];
    const failedDisposition = String(
      failedRun?.data?.credit_disposition || "NOT_APPLICABLE",
    );
    const failedCreditCharged = failedDisposition === "DEBIT_CONSUMED" ||
      failedRun?.data?.provider_execution_started_at != null;
    return json(
      request,
      {
        error: "Prospect discovery could not be completed.",
        run_id: runId,
        code: publicErrorCode,
        credit_balance: Number(failedCreditAccount?.data?.balance || 0),
        credit_disposition: failedDisposition,
        credit_refunded: failedDisposition === "REVERSED_PRE_PROVIDER",
        credit_charged: runMode === "FRESH_DISCOVERY" && failedCreditCharged,
      },
      publicErrorCode === "INSUFFICIENT_CREDITS" ||
        errorCode.includes("NO_FRESH_SEARCH_SPACE")
        ? 409
        : 503,
    );
  }
}

export {
  handleDiscovery as handleExternalProspectDiscoveryRequest,
  structuredFirst,
  structuredTexts,
};

if (import.meta.main) Deno.serve(handleDiscovery);

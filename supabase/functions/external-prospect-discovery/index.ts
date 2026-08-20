/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  boundedDiscoveryQueries,
  deduplicateCandidates,
  DISCOVERY_LIMITS,
  normalizeCompanyName,
  normalizeCpv,
  normalizeDomain,
  normalizeHttpsUrl,
  type ProspectCandidate,
  type ProspectEvidence,
  sanitizeEvidenceText,
  scoreProspect,
} from "../_shared/external-prospect-discovery.ts";
import {
  registryAdaptersForCountries,
  type RegistryCandidate,
} from "../_shared/external-registry-adapters.ts";
import {
  readBoundedResponseBody,
  safeFetchWithRedirects,
} from "../_shared/safe-public-fetch.ts";
import { isPathAllowedByRobots } from "../_shared/attachment-discovery.ts";

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

async function fetchTedAwards(
  queries: string[],
  targetTaxonomyIds: number[],
  targetCpvCodes: string[],
): Promise<
  { candidates: ProspectCandidate[]; checked: number; unavailable: boolean }
> {
  const candidates: ProspectCandidate[] = [];
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
    "winner-selection-status",
    "contract-conclusion-date",
    "links",
  ];
  for (const query of queries.slice(0, DISCOVERY_LIMITS.maximumQueries)) {
    checked += 1;
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
          query: `${query} AND (form-type = result)`,
          fields,
          page: 1,
          limit: DISCOVERY_LIMITS.maximumTedResultsPerQuery,
          scope: "ACTIVE",
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
      for (const noticeValue of notices) {
        const notice = record(noticeValue);
        const names = texts(notice["winner-name"]).slice(0, 10);
        if (!names.length) continue;
        const websites = structuredTexts(
          notice["winner-internet-address"],
          1000,
        );
        const identifiers = structuredTexts(notice["winner-identifier"], 240);
        const countries = structuredTexts(notice["winner-country"], 20);
        const cpvCodes = structuredTexts(notice["classification-cpv"], 40)
          .map(normalizeCpv).filter(Boolean) as string[];
        const exactCpv = cpvCodes.some((code) => targetCpvCodes.includes(code));
        const relatedCpv = exactCpv ||
          cpvCodes.some((code) =>
            targetCpvCodes.some((target) =>
              code.slice(0, 5) === target.slice(0, 5)
            )
          );
        if (!relatedCpv) continue;
        const publicationNumber = structuredFirst(
          notice["publication-number"],
          100,
        );
        if (!publicationNumber) continue;
        const title = first(notice["notice-title"]) || "TED contract award";
        const lot = first(notice["description-lot"]);
        const evidenceDate = structuredFirst(
          notice["contract-conclusion-date"] || notice["publication-date"],
          20,
        ).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null;
        for (let index = 0; index < names.length; index += 1) {
          const name = sanitizeEvidenceText(names[index], 240);
          if (!name) continue;
          const winnerCountry = countryCode(countries[index] || countries[0]);
          const websiteUrl = normalizeHttpsUrl(websites[index] || websites[0]);
          const evidence: ProspectEvidence = {
            sourceType: "TED_AWARD",
            sourceUrl: `https://ted.europa.eu/en/notice/-/detail/${
              encodeURIComponent(publicationNumber)
            }`,
            sourceDomain: "ted.europa.eu",
            title: sanitizeEvidenceText(title, 300),
            snippet: sanitizeEvidenceText(lot || title, 1600),
            evidenceKind: exactCpv
              ? "DIRECT_PRODUCT_EVIDENCE"
              : "INDIRECT_COMMERCIAL_EVIDENCE",
            confidence: exactCpv ? 0.9 : 0.78,
            evidenceDate,
            noticeId: publicationNumber,
            procurementBuyer:
              sanitizeEvidenceText(first(notice["buyer-name"]), 300) || null,
            lotContext: sanitizeEvidenceText(lot, 1000) || null,
            cpvCodes,
            taxonomyIds: targetTaxonomyIds,
          };
          candidates.push({
            name,
            countryCode: winnerCountry,
            countryName: winnerCountry
              ? COUNTRY_NAMES[winnerCountry] || null
              : null,
            cityRegion: null,
            companyType: companyType(`${title} ${lot}`),
            websiteUrl,
            registryIdentifier:
              sanitizeEvidenceText(identifiers[index] || identifiers[0], 240) ||
              null,
            description: sanitizeEvidenceText(lot || title, 1600) || null,
            evidence: [evidence],
            activities: [],
            taxonomyIds: targetTaxonomyIds,
            taxonomyRelation: exactCpv ? "exact" : "parent_child",
            targetCountry: false,
            preferredCompanyType: false,
            relatedAwardCount: 1,
            lastEvidenceAt: evidenceDate,
          });
        }
      }
    } catch (_) {
      unavailable = true;
    } finally {
      clearTimeout(timeout);
    }
  }
  return { candidates, checked, unavailable };
}

async function fetchRegistryCandidates(
  targetCountries: string[],
): Promise<
  {
    candidates: RegistryCandidate[];
    checked: number;
    unavailableProviders: string[];
  }
> {
  const adapters = registryAdaptersForCountries(targetCountries);
  const candidates: RegistryCandidate[] = [];
  const unavailableProviders: string[] = [];
  let checked = 0;
  for (const adapter of adapters) {
    let adapterAvailable = true;
    for (const request of adapter.buildRequests().slice(0, 2)) {
      if (checked >= DISCOVERY_LIMITS.maximumRegistryChecks) break;
      checked += 1;
      try {
        const result = await safeFetchWithRedirects(request.url, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
          },
        }, { maximumAttempts: 1, maximumRedirects: 2 });
        if (!result.response.ok) {
          await result.response.body?.cancel();
          adapterAvailable = false;
          continue;
        }
        candidates.push(
          ...adapter.parse(
            await boundedJson(result.response),
            result.resolvedUrl,
          ).slice(0, request.maximumResults),
        );
      } catch (_) {
        adapterAvailable = false;
      }
    }
    if (!adapterAvailable) unavailableProviders.push(adapter.providerCode);
  }
  return { candidates, checked, unavailableProviders };
}

function mergeSignals(
  tedCandidates: ProspectCandidate[],
  registryCandidates: RegistryCandidate[],
  targetCountries: string[],
  partnerTypes: string[],
): ProspectCandidate[] {
  const byName = new Map<string, ProspectCandidate>();
  for (const candidate of tedCandidates) {
    const key = `${normalizeCompanyName(candidate.name)}:${
      candidate.countryCode || ""
    }`;
    const previous = byName.get(key);
    if (previous) {
      previous.evidence.push(...candidate.evidence);
      previous.relatedAwardCount += candidate.relatedAwardCount;
      previous.websiteUrl ||= candidate.websiteUrl;
      previous.registryIdentifier ||= candidate.registryIdentifier;
      previous.lastEvidenceAt =
        [previous.lastEvidenceAt, candidate.lastEvidenceAt]
          .filter(Boolean).sort().reverse()[0] || null;
    } else byName.set(key, candidate);
  }
  for (const registry of registryCandidates) {
    const key = `${
      normalizeCompanyName(registry.name)
    }:${registry.countryCode}`;
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
      confidence: registry.activity.strength === "STRONG_INDIRECT"
        ? 0.82
        : 0.55,
      evidenceDate: registry.activity.effectiveFrom,
      registryProviderCode: registry.activity.providerCode,
    };
    const previous = byName.get(key);
    if (previous) {
      previous.activities.push(registry.activity);
      previous.evidence.push(evidence);
      previous.registryIdentifier ||= registry.registryIdentifier;
      previous.cityRegion ||= registry.cityRegion;
      if (
        previous.companyType === "Unknown" &&
        registry.activity.strength === "STRONG_INDIRECT"
      ) {
        previous.companyType = "Wholesaler";
      }
    } else {
      byName.set(key, {
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
      });
    }
  }
  const wantedTypes = partnerTypes.map((item) => item.toLowerCase());
  return [...byName.values()].map((candidate) => ({
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

async function verifyWebsites(
  candidates: ProspectCandidate[],
  taxonomyNames: string[],
): Promise<{ checked: number; unavailable: number }> {
  const selected = candidates.filter((item) => item.websiteUrl)
    .slice(0, DISCOVERY_LIMITS.maximumWebsiteChecks);
  const results = await Promise.all(selected.map(async (candidate) => {
    const website = normalizeHttpsUrl(candidate.websiteUrl);
    if (!website) return 0;
    try {
      const siteUrl = new URL(website);
      const robotsUrl = `${siteUrl.origin}/robots.txt`;
      let allowed = true;
      try {
        const robots = await safeFetchWithRedirects(robotsUrl, {
          headers: {
            "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
          },
        }, { maximumAttempts: 1, maximumRedirects: 2 });
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
      if (!allowed) return 0;
      const result = await safeFetchWithRedirects(website, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "MedicHall-External-Prospect-Discovery/1.0",
        },
      }, { maximumAttempts: 1, maximumRedirects: 3 });
      if (!result.response.ok) {
        await result.response.body?.cancel();
        return 1;
      }
      const contentType = result.response.headers.get("content-type") || "";
      if (!contentType.includes("html")) {
        await result.response.body?.cancel();
        return 0;
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
      const directTerms = taxonomyNames.filter((term) =>
        term.length >= 3 && text.toLowerCase().includes(term.toLowerCase())
      );
      const evidenceKind = directTerms.length
        ? "DIRECT_PRODUCT_EVIDENCE"
        : "WEAK_CONTEXT";
      candidate.evidence.push({
        sourceType: "COMPANY_WEBSITE",
        sourceUrl: result.resolvedUrl,
        sourceDomain: normalizeDomain(result.resolvedUrl) || siteUrl.hostname,
        title: `${candidate.name} official website`,
        snippet: directTerms.length
          ? `Official website references: ${
            directTerms.slice(0, 4).join(", ")
          }.`
          : "Official website was reachable, but no exact target-product claim was found.",
        evidenceKind,
        confidence: directTerms.length ? 0.85 : 0.45,
        evidenceDate: new Date().toISOString().slice(0, 10),
        taxonomyIds: directTerms.length ? candidate.taxonomyIds : [],
      });
      if (directTerms.length && candidate.taxonomyRelation === "none") {
        candidate.taxonomyRelation = "exact";
      }
      return 0;
    } catch (_) {
      return 1;
    }
  }));
  return {
    checked: selected.length,
    unavailable: results.reduce<number>((total, value) => total + value, 0),
  };
}

async function persistCandidate(
  // The repository does not generate database types; service writes target
  // new migration tables that the untyped Supabase client cannot infer.
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: number,
  runId: string,
  candidate: ProspectCandidate,
): Promise<boolean> {
  const score = scoreProspect(candidate);
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
    last_scored_at: new Date().toISOString(),
  }, { onConflict: "company_id,external_company_id" });
  if (match.error) throw match.error;
  return true;
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
    if (new TextEncoder().encode(raw).length > 2048) {
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
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(idempotencyKey)
  ) {
    return json(request, {
      error: "Valid company and idempotency identifiers are required.",
    }, 400);
  }
  const start = await authClient.rpc("start_external_prospect_discovery_v1", {
    p_company_id: companyId,
    p_idempotency_key: idempotencyKey,
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
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.from("external_prospect_discovery_runs").update({
    status: "RUNNING",
    stage: "loading_profile",
    started_at: new Date().toISOString(),
  }).eq("id", runId);
  try {
    const [profileResult, productsResult, matchProfileResult, companiesResult] =
      await Promise.all([
        admin.from("matchmaking_profiles").select(
          "id,role,target_countries,partner_types_sought",
        ).eq("company_id", companyId).eq("is_active", true).single(),
        admin.from("products").select("id,name,category,description").eq(
          "company_id",
          companyId,
        ).eq("is_active", true).limit(100),
        admin.from("company_match_profiles").select(
          "cpv_codes,target_countries,target_partner_types,product_keywords,certifications,oem_available,private_label_available,min_match_score",
        ).eq("company_id", companyId).maybeSingle(),
        admin.from("companies").select("id,name,website,country").limit(1000),
      ]);
    if (
      profileResult.error || productsResult.error || matchProfileResult.error ||
      companiesResult.error
    ) {
      throw new Error("DISCOVERY_CONTEXT_UNAVAILABLE");
    }
    const products = array(productsResult.data).map(record);
    const productIds = products.map((item) => Number(item.id)).filter(
      Number.isSafeInteger,
    );
    const mappingsResult = await admin.from("product_taxonomy_mappings")
      .select("taxonomy_id,product_id").in("product_id", productIds).eq(
        "status",
        "approved",
      );
    if (mappingsResult.error) throw new Error("TAXONOMY_CONTEXT_UNAVAILABLE");
    const mappings = array(mappingsResult.data).map(record);
    const taxonomyIds = [
      ...new Set(
        mappings.map((item) => Number(item.taxonomy_id)).filter(
          Number.isSafeInteger,
        ),
      ),
    ];
    const taxonomyResult = taxonomyIds.length
      ? await admin.from("medical_product_taxonomy").select("id,canonical_name")
        .in("id", taxonomyIds).eq("is_active", true)
      : { data: [], error: null };
    if (taxonomyResult.error) throw new Error("TAXONOMY_CONTEXT_UNAVAILABLE");
    const taxonomyNames = array(taxonomyResult.data).map((item) =>
      first(record(item).canonical_name)
    ).filter(Boolean);
    const profile = record(profileResult.data);
    const matchProfile = record(matchProfileResult.data);
    const targetCountries = [
      ...new Set(
        [
          ...texts(profile.target_countries),
          ...texts(matchProfile.target_countries),
        ].map((item) => countryCode(item)).filter(Boolean),
      ),
    ] as string[];
    const partnerTypes = [
      ...new Set([
        ...texts(profile.partner_types_sought),
        ...texts(matchProfile.target_partner_types),
      ]),
    ];
    const cpvCodes = [
      ...new Set(
        texts(matchProfile.cpv_codes).map(normalizeCpv).filter(Boolean),
      ),
    ] as string[];
    const fallbackCpv = cpvCodes.length
      ? cpvCodes
      : ["33100000", "33140000", "33190000"];
    const queries = boundedDiscoveryQueries({
      cpvCodes: fallbackCpv,
      targetCountries,
      taxonomyNames: taxonomyNames.length ? taxonomyNames : [
        ...products.map((item) => first(item.name)),
        ...texts(matchProfile.product_keywords),
      ],
    });
    await admin.from("external_prospect_discovery_runs").update({
      stage: "checking_public_sources",
      queries_generated: queries.length,
      diagnostics: {
        registry_adapters: registryAdaptersForCountries(targetCountries).map((
          item,
        ) => item.providerCode),
      },
    }).eq("id", runId);
    const [ted, registry] = await Promise.all([
      fetchTedAwards(queries, taxonomyIds, fallbackCpv),
      fetchRegistryCandidates(targetCountries),
    ]);
    const merged = mergeSignals(
      ted.candidates,
      registry.candidates,
      targetCountries,
      partnerTypes,
    );
    const website = await verifyWebsites(merged, taxonomyNames);
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
    let accepted = 0;
    let rejected = 0;
    for (const candidate of deduped.candidates) {
      if (await persistCandidate(admin, companyId, runId, candidate)) {
        accepted += 1;
      } else rejected += 1;
    }
    const partial = ted.unavailable ||
      registry.unavailableProviders.length > 0 || website.unavailable > 0;
    const diagnostics = {
      ted_unavailable: ted.unavailable,
      registry_unavailable_providers: registry.unavailableProviders,
      registry_adapters_available: registryAdaptersForCountries(targetCountries)
        .map((item) => item.providerCode),
      website_unavailable_count: website.unavailable,
      registered_duplicates: deduped.registeredDuplicates,
      external_duplicates: deduped.externalDuplicates,
      ted_candidates_found: ted.candidates.length,
      registry_candidates_found: registry.candidates.length,
      merged_candidates_found: merged.length,
      deduplicated_candidates_remaining: deduped.candidates.length,
      direct_contact_fields_stored: 0,
    };
    const completion = await admin.from("external_prospect_discovery_runs")
      .update({
        status: partial ? "PARTIAL" : "COMPLETED",
        stage: "completed",
        sources_checked: Math.min(
          60,
          ted.checked + registry.checked + website.checked,
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
        provider_requests: 0,
        estimated_cost_usd: 0,
        diagnostics,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    if (completion.error) throw completion.error;
    return json(request, {
      ok: true,
      run: {
        run_id: runId,
        status: partial ? "PARTIAL" : "COMPLETED",
        stage: "completed",
      },
      candidates_accepted: accepted,
      candidates_rejected: rejected,
      provider_requests: 0,
      ai_classifications: 0,
      estimated_cost_usd: 0,
      emails_sent: 0,
      notifications_created: 0,
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
      provider_requests: 0,
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

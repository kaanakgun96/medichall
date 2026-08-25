import { normalizePublicUrl } from "./attachment-discovery.ts";
import { sanitizeEvidenceText } from "./external-prospect-discovery.ts";

export const WEBSITE_PRODUCT_SCAN_LIMITS = Object.freeze({
  maximumPages: 12,
  maximumDepth: 1,
  maximumRedirects: 2,
  maximumResponseBytes: 512_000,
  maximumSuggestions: 8,
  maximumSignalsPerPage: 80,
  totalRunTimeMs: 25_000,
  cacheDays: 14,
});

export type WebsiteProductSignalKind =
  | "schema_product"
  | "schema_item"
  | "page_title"
  | "heading"
  | "product_link"
  | "breadcrumb";

export type WebsiteProductSignal = {
  label: string;
  pageUrl: string;
  kind: WebsiteProductSignalKind;
  strength: number;
};

export type ProductTaxonomyCandidate = {
  id: number;
  parentId?: number | null;
  canonicalName: string;
  slug: string;
  nodeType: string;
  description?: string | null;
  parentName?: string | null;
  aliases: string[];
  localizedAliases?: Array<{ term: string; language: string }>;
};

export type WebsiteProductSuggestion = {
  taxonomy_id: number;
  canonical_name: string;
  slug: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidence_score: number;
  raw_website_label: string;
  source_pages: string[];
  evidence: Array<
    { label: string; page_url: string; kind: WebsiteProductSignalKind }
  >;
  occurrence_count: number;
  auto_selected: boolean;
};

const PRODUCT_PATH =
  /(?:^|\/)(?:products?|product-famil(?:y|ies)|categories|catalog(?:ue)?|solutions)(?:\/|$)/i;
const EXCLUDED_PATH =
  /(?:^|\/)(?:contact|privacy|legal|terms|careers?|jobs?|news|blog|about)(?:\/|$)/i;
const INVALID_QUERY =
  /(?:https?:\/\/|www\.|\b(?:search|google|bing|crawl|scrape|fetch|javascript|select|insert|update|delete|drop|union|script|prompt)\b|[<>{}`;$]|--|\/\*)/i;
const GENERIC_LABEL =
  /^(?:products?|medical products?|healthcare|solutions?|catalog(?:ue)?|categories|about us|learn more|read more|home)$/i;
const CONTACT_TEXT =
  /(?:\bcontact\b|\be-?mail\b|\bphone\b|\bwhats\s*app\b|\blinked\s*in\b|\bteam\b)/i;

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ");
}

export function normalizeProductTerm(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function validateProductSearchQuery(value: unknown): string {
  const query = sanitizeEvidenceText(value, 160).normalize("NFC").trim();
  if (query.length < 3 || query.length > 160 || INVALID_QUERY.test(query)) {
    throw new Error(
      "Use a specific medical product name between 3 and 160 characters.",
    );
  }
  const words = normalizeProductTerm(query).split(" ").filter(Boolean);
  if (!words.length || words.length > 18) {
    throw new Error(
      "Use a specific medical product name between 3 and 160 characters.",
    );
  }
  return query;
}

function cleanLabel(value: string): string {
  const cleaned = sanitizeEvidenceText(
    decodeHtml(value).replace(/<[^>]+>/g, " "),
    180,
  )
    .replace(/\s+/g, " ").trim();
  if (
    cleaned.length < 3 || cleaned.length > 180 || GENERIC_LABEL.test(cleaned) ||
    CONTACT_TEXT.test(cleaned)
  ) return "";
  return cleaned;
}

function addSignal(
  output: WebsiteProductSignal[],
  label: string,
  pageUrl: string,
  kind: WebsiteProductSignalKind,
  strength: number,
): void {
  const cleaned = cleanLabel(label);
  if (!cleaned) return;
  const key = `${kind}|${normalizeProductTerm(cleaned)}|${pageUrl}`;
  if (
    output.some((item) =>
      `${item.kind}|${normalizeProductTerm(item.label)}|${item.pageUrl}` === key
    )
  ) return;
  output.push({ label: cleaned, pageUrl, kind, strength });
}

function jsonLdValues(
  value: unknown,
  output: WebsiteProductSignal[],
  pageUrl: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => jsonLdValues(item, output, pageUrl));
    return;
  }
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  const types = (Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]])
    .map((item) => String(item || "").toLowerCase());
  const kind = types.includes("product")
    ? "schema_product"
    : types.some((item) => item === "itemlist" || item === "collectionpage")
    ? "schema_item"
    : null;
  if (kind && typeof row.name === "string") {
    addSignal(
      output,
      row.name,
      pageUrl,
      kind,
      kind === "schema_product" ? 1 : .88,
    );
  }
  if (types.includes("itemlist") && Array.isArray(row.itemListElement)) {
    row.itemListElement.slice(0, 40).forEach((item) =>
      jsonLdValues(item, output, pageUrl)
    );
  }
  if (row.item && typeof row.item === "object") {
    jsonLdValues(row.item, output, pageUrl);
  }
  if (Array.isArray(row["@graph"])) {
    jsonLdValues(row["@graph"], output, pageUrl);
  }
}

export function extractWebsiteProductSignals(
  html: string,
  pageUrl: string,
): WebsiteProductSignal[] {
  const output: WebsiteProductSignal[] = [];
  const bounded = html.slice(
    0,
    WEBSITE_PRODUCT_SCAN_LIMITS.maximumResponseBytes,
  );
  for (
    const match of bounded.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )
  ) {
    try {
      jsonLdValues(JSON.parse(match[1]), output, pageUrl);
    } catch (_) { /* malformed public metadata */ }
  }
  const visible = bounded.replace(
    /<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi,
    " ",
  )
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(
      /<(?:footer|form)\b[\s\S]*?<\/(?:footer|form)>/gi,
      " ",
    );
  const title = visible.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  if (PRODUCT_PATH.test(new URL(pageUrl).pathname)) {
    addSignal(output, title.split(/[|–—]/)[0], pageUrl, "page_title", .82);
  }
  for (
    const match of visible.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)
  ) {
    addSignal(
      output,
      match[2],
      pageUrl,
      "heading",
      match[1] === "1" ? .9 : .78,
    );
  }
  for (
    const match of visible.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )
  ) {
    const target = normalizePublicUrl(match[1], pageUrl);
    if (
      !target || target.origin !== new URL(pageUrl).origin ||
      !PRODUCT_PATH.test(target.pathname) || EXCLUDED_PATH.test(target.pathname)
    ) continue;
    addSignal(output, match[2], pageUrl, "product_link", .86);
  }
  for (
    const match of visible.matchAll(
      /<(?:nav|ol)\b[^>]*(?:breadcrumb|breadcrumbs)[^>]*>([\s\S]*?)<\/(?:nav|ol)>/gi,
    )
  ) {
    for (
      const item of match[1].matchAll(
        /<(?:a|span|li)\b[^>]*>([\s\S]*?)<\/(?:a|span|li)>/gi,
      )
    ) addSignal(output, item[1], pageUrl, "breadcrumb", .72);
  }
  return output.sort((a, b) => b.strength - a.strength).slice(
    0,
    WEBSITE_PRODUCT_SCAN_LIMITS.maximumSignalsPerPage,
  );
}

function tokens(value: string): string[] {
  return normalizeProductTerm(value).split(" ").filter((item) =>
    item.length > 1
  );
}

function similarity(left: string, right: string): number {
  const a = normalizeProductTerm(left), b = normalizeProductTerm(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 7) {
    return .9;
  }
  const aa = new Set(tokens(a)), bb = new Set(tokens(b));
  const intersection = [...aa].filter((item) => bb.has(item)).length;
  const union = new Set([...aa, ...bb]).size;
  if (!union) return 0;
  const coverage = intersection / Math.min(aa.size || 1, bb.size || 1);
  return Math.min(.89, (intersection / union) * .65 + coverage * .35);
}

export function normalizeWebsiteProductSignals(
  signals: WebsiteProductSignal[],
  taxonomy: ProductTaxonomyCandidate[],
): WebsiteProductSuggestion[] {
  const grouped = new Map<
    number,
    {
      taxonomy: ProductTaxonomyCandidate;
      matches: Array<WebsiteProductSignal & { score: number }>;
    }
  >();
  for (const signal of signals) {
    let best: { taxonomy: ProductTaxonomyCandidate; score: number } | null =
      null;
    for (
      const candidate of taxonomy.filter((item) => item.nodeType !== "family")
    ) {
      const score = Math.max(
        similarity(signal.label, candidate.canonicalName),
        ...candidate.aliases.map((alias) => similarity(signal.label, alias)),
      );
      if (!best || score > best.score) best = { taxonomy: candidate, score };
    }
    if (!best || best.score < .65) continue;
    const current = grouped.get(best.taxonomy.id) ||
      { taxonomy: best.taxonomy, matches: [] };
    current.matches.push({ ...signal, score: best.score });
    grouped.set(best.taxonomy.id, current);
  }
  return [...grouped.values()].map(({ taxonomy: candidate, matches }) => {
    matches.sort((a, b) => (b.score * b.strength) - (a.score * a.strength));
    const pages = [...new Set(matches.map((item) => item.pageUrl))].slice(0, 3);
    const strongest = matches[0];
    const exactStructured = strongest.score >= .95 &&
      strongest.kind === "schema_product";
    const repeatedStrong = matches.filter((item) =>
      item.score >= .8
    ).length >= 2;
    const confidence: WebsiteProductSuggestion["confidence"] =
      exactStructured || (strongest.score >= .95 && strongest.strength >= .85)
        ? "HIGH"
        : repeatedStrong || strongest.score >= .78
        ? "MEDIUM"
        : "LOW";
    return {
      taxonomy_id: candidate.id,
      canonical_name: candidate.canonicalName,
      slug: candidate.slug,
      confidence,
      confidence_score: Number(
        (strongest.score * strongest.strength).toFixed(4),
      ),
      raw_website_label: strongest.label,
      source_pages: pages,
      evidence: matches.slice(0, 3).map((item) => ({
        label: item.label,
        page_url: item.pageUrl,
        kind: item.kind,
      })),
      occurrence_count: matches.length,
      auto_selected: confidence !== "LOW",
    };
  }).sort((a, b) =>
    b.confidence_score - a.confidence_score ||
    b.occurrence_count - a.occurrence_count
  )
    .slice(0, WEBSITE_PRODUCT_SCAN_LIMITS.maximumSuggestions);
}

export function prioritizedWebsiteUrls(
  html: string,
  pageUrl: string,
  rootUrl: string,
): string[] {
  const root = normalizePublicUrl(rootUrl);
  if (!root) return [];
  const found = new Map<string, number>();
  for (
    const match of html.slice(
      0,
      WEBSITE_PRODUCT_SCAN_LIMITS.maximumResponseBytes,
    ).matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)
  ) {
    const url = normalizePublicUrl(match[1], pageUrl);
    if (
      !url || url.origin !== root.origin || EXCLUDED_PATH.test(url.pathname) ||
      !PRODUCT_PATH.test(url.pathname)
    ) continue;
    url.search = "";
    url.hash = "";
    found.set(
      url.href,
      Math.max(
        found.get(url.href) || 0,
        /\/(?:products?|catalog(?:ue)?)\//i.test(url.pathname) ? 2 : 1,
      ),
    );
  }
  return [...found.entries()].sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  ).map(([url]) => url);
}

export function sitemapProductUrls(xml: string, rootUrl: string): string[] {
  const root = normalizePublicUrl(rootUrl);
  if (!root) return [];
  const output: string[] = [];
  for (
    const match of xml.slice(0, 512_000).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)
  ) {
    const url = normalizePublicUrl(decodeHtml(match[1]));
    if (
      !url || url.origin !== root.origin || EXCLUDED_PATH.test(url.pathname) ||
      !PRODUCT_PATH.test(url.pathname)
    ) continue;
    url.search = "";
    url.hash = "";
    if (!output.includes(url.href)) output.push(url.href);
  }
  return output.slice(0, WEBSITE_PRODUCT_SCAN_LIMITS.maximumPages - 1);
}

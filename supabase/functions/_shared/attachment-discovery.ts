export const SUPPORTED_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "zip",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
] as const;

export type SupportedAttachmentExtension =
  (typeof SUPPORTED_ATTACHMENT_EXTENSIONS)[number];

export const MIME_BY_EXTENSION: Record<SupportedAttachmentExtension, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  doc: "application/msword",
  docx:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};

const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export type AttachmentCandidateSource =
  | "html_anchor"
  | "official_metadata"
  | "raw_url";

export type AttachmentCandidate = {
  sourceUrl: string;
  pageUrl: string;
  title: string;
  source: AttachmentCandidateSource;
  depth: number;
  priorityScore: number;
  confidence: "high" | "medium" | "low";
};

export type AttachmentFileInfo = {
  extension: SupportedAttachmentExtension | null;
  fileName: string | null;
  mimeType: string | null;
};

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [first, second] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.");
}

export function isBlockedAttachmentHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "0" ||
    isPrivateIpv4(normalized) ||
    isPrivateIpv6(normalized);
}

export function normalizePublicUrl(
  value: string,
  base?: string,
): URL | null {
  try {
    const url = new URL(value.trim(), base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || isBlockedAttachmentHost(url.hostname)) {
      return null;
    }
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function canonicalAttachmentUrl(value: string): string | null {
  const url = normalizePublicUrl(value);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith("utm_") ||
      TRACKING_PARAMETERS.has(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.href;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250);
}

function extensionFromPath(
  pathname: string,
): SupportedAttachmentExtension | null {
  const name = pathname.split("/").pop() || "";
  const extension = (name.split(".").pop() || "").toLowerCase();
  return (SUPPORTED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(
      extension,
    )
    ? extension as SupportedAttachmentExtension
    : null;
}

function isOfficialHostname(hostname: string, rootHostname: string): boolean {
  const host = hostname.toLowerCase();
  const root = rootHostname.toLowerCase();
  return host === root ||
    host.endsWith(`.${root}`) ||
    host.endsWith(".europa.eu") ||
    host.endsWith(".eu") ||
    /\.(?:gov|gouv|govt|bund|admin)\.[a-z]{2}$/i.test(host);
}

export function attachmentPriority(
  value: Pick<AttachmentCandidate, "sourceUrl" | "title" | "source" | "depth">,
  rootUrl: string,
): number {
  const candidate = normalizePublicUrl(value.sourceUrl);
  const root = normalizePublicUrl(rootUrl);
  if (!candidate || !root) return -100;
  const text = `${candidate.pathname} ${candidate.search} ${value.title}`
    .toLowerCase();
  let score = 0;
  if (extensionFromPath(candidate.pathname)) score += 55;
  if (isOfficialHostname(candidate.hostname, root.hostname)) score += 25;
  if (value.source === "official_metadata") score += 20;
  if (
    /attachment|download|document|procurement|specification|technical|boq|lot|tender|appalto|bandi|gara|vergabe|march|licit/
      .test(
        text,
      )
  ) {
    score += 25;
  }
  if (/login|signin|account|register|captcha|payment/.test(text)) score -= 35;
  score -= Math.max(0, value.depth) * 4;
  return Math.max(0, Math.min(100, score));
}

function confidenceForScore(score: number): AttachmentCandidate["confidence"] {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function extractAttachmentCandidates(
  html: string,
  pageUrl: string,
  rootUrl: string,
  depth: number,
  limit = 200,
): AttachmentCandidate[] {
  const candidates = new Map<string, AttachmentCandidate>();
  const add = (
    rawUrl: string,
    title: string,
    source: AttachmentCandidateSource,
  ) => {
    const normalized = normalizePublicUrl(decodeHtml(rawUrl), pageUrl);
    if (!normalized) return;
    const canonical = canonicalAttachmentUrl(normalized.href);
    if (!canonical) return;
    const input = {
      sourceUrl: normalized.href,
      pageUrl,
      title: cleanText(title),
      source,
      depth,
    };
    const priorityScore = attachmentPriority(input, rootUrl);
    const candidate = {
      ...input,
      priorityScore,
      confidence: confidenceForScore(priorityScore),
    };
    const existing = candidates.get(canonical);
    if (!existing || candidate.priorityScore > existing.priorityScore) {
      candidates.set(canonical, candidate);
    }
  };

  const anchorPattern =
    /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    add(match[2], match[3], "html_anchor");
  }

  const officialUriPattern =
    /<(?:\w+:)?URI\b[^>]*>([\s\S]*?)<\/(?:\w+:)?URI>/gi;
  for (const match of html.matchAll(officialUriPattern)) {
    add(cleanText(match[1]), "Procurement documents", "official_metadata");
  }

  for (
    const raw of html.match(/https?:\/\/[^\s"'<>\\]+/gi) || []
  ) {
    add(raw.replace(/[),.;]+$/, ""), "", "raw_url");
  }

  return [...candidates.values()]
    .sort((left, right) =>
      right.priorityScore - left.priorityScore ||
      left.sourceUrl.localeCompare(right.sourceUrl)
    )
    .slice(0, Math.max(1, limit));
}

function contentDispositionFileName(value: string | null): string | null {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = value.match(/filename\s*=\s*"?([^";]+)"?/i);
  const raw = utf8?.[1] || plain?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.trim()).slice(0, 250);
  } catch {
    return raw.trim().slice(0, 250);
  }
}

export function attachmentFileInfo(
  value: string,
  contentType?: string | null,
  contentDisposition?: string | null,
): AttachmentFileInfo {
  const url = normalizePublicUrl(value);
  const headerName = contentDispositionFileName(contentDisposition || null);
  const pathName = url
    ? decodeURIComponent(url.pathname.split("/").pop() || "")
    : "";
  const fileName = headerName || pathName || null;
  const extension = extensionFromPath(fileName || "");
  const normalizedMime = String(contentType || "").split(";")[0].trim()
    .toLowerCase();
  const mimeType = SUPPORTED_MIME_TYPES.has(normalizedMime)
    ? normalizedMime
    : extension
    ? MIME_BY_EXTENSION[extension]
    : null;
  return { extension, fileName, mimeType };
}

export function documentTypeForAttachment(
  title: string,
  url: string,
):
  | "technical_specification"
  | "price_schedule"
  | "boq"
  | "lot_document"
  | "administrative"
  | "contract_notice"
  | "other" {
  const value = `${title} ${url}`.toLowerCase();
  if (
    /technical|specification|capitolato|cahier|leistungsverzeichnis/.test(value)
  ) {
    return "technical_specification";
  }
  if (/boq|bill.?of.?quant|quantit|computo/.test(value)) return "boq";
  if (/price|pricing|prezzo|preis|financial.?offer/.test(value)) {
    return "price_schedule";
  }
  if (/lot|lotti/.test(value)) return "lot_document";
  if (/administrative|disciplinare|instructions|declaration/.test(value)) {
    return "administrative";
  }
  if (/contract.?notice|notice/.test(value)) return "contract_notice";
  return "other";
}

export function isHtmlLikeContentType(contentType: string | null): boolean {
  const normalized = String(contentType || "").toLowerCase();
  return normalized.includes("html") ||
    normalized.includes("xhtml") ||
    normalized.includes("xml");
}

export function isPathAllowedByRobots(
  robotsText: string,
  pathname: string,
  userAgent = "medichall-tender-attachment-discovery",
): boolean {
  const groups: Array<{
    agents: string[];
    rules: Array<{ allow: boolean; path: string }>;
  }> = [];
  let current: (typeof groups)[number] | null = null;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }

  const normalizedAgent = userAgent.toLowerCase();
  const matchingGroups = groups.filter((group) =>
    group.agents.some((agent) =>
      agent === "*" || normalizedAgent.includes(agent)
    )
  );
  const rules = matchingGroups.flatMap((group) => group.rules)
    .filter((rule) => pathname.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length);
  return rules[0]?.allow ?? true;
}

export const TRAFFIC_ROUTES = new Set([
  "homepage",
  "products",
  "product_detail",
  "companies",
  "company_showroom",
  "tenders",
  "tender_detail",
  "matchmaking",
  "login",
  "signup",
  "portal",
  "portal_dashboard",
  "portal_products",
  "portal_opportunities",
  "portal_messages",
  "portal_matchmaking",
  "portal_profile",
  "portal_ai",
  "react_dashboard",
  "react_all_tenders",
  "react_opportunities",
  "react_company_profile",
]);

const PAYLOAD_KEYS = new Set([
  "event_id",
  "visitor_id",
  "session_id",
  "route_id",
  "referrer_domain",
  "utm_source",
  "utm_medium",
  "utm_campaign",
]);

export type TrafficPayload = {
  event_id: string;
  visitor_id: string;
  session_id: string;
  route_id: string;
  referrer_domain: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

export type DeviceCategory = "desktop" | "mobile" | "tablet" | "other";
export type BrowserFamily = "chrome" | "safari" | "edge" | "firefox" | "other";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CAMPAIGN_PATTERN = /^[a-z0-9][a-z0-9._ -]*$/;
const BOT_PATTERN =
  /(?:bot\b|crawler|spider|slurp|bingpreview|facebookexternalhit|linkedinbot|whatsapp|telegrambot|headlesschrome|lighthouse|pagespeed|pingdom|uptimerobot|statuscake|healthcheck|kube-probe|curl\/|wget\/)/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && value !== ZERO_UUID &&
    UUID_PATTERN.test(value);
}

export function normalizeCampaignValue(
  value: unknown,
  limit: number,
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Invalid campaign attribution.");
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (
    !normalized || normalized.length > limit ||
    !CAMPAIGN_PATTERN.test(normalized)
  ) {
    throw new Error("Invalid campaign attribution.");
  }
  return normalized;
}

export function normalizeReferrerDomain(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid referrer domain.");
  const normalized = value.trim().toLowerCase().replace(/^www\./, "").replace(
    /\.$/,
    "",
  );
  if (!DOMAIN_PATTERN.test(normalized)) {
    throw new Error("Invalid referrer domain.");
  }
  return normalized;
}

export function parseTrafficPayload(value: unknown): TrafficPayload {
  const payload = record(value);
  const unknownKeys = Object.keys(payload).filter((key) =>
    !PAYLOAD_KEYS.has(key)
  );
  if (unknownKeys.length) throw new Error("Unsupported analytics field.");
  if (
    !validUuid(payload.event_id) || !validUuid(payload.visitor_id) ||
    !validUuid(payload.session_id)
  ) {
    throw new Error("Invalid analytics identifier.");
  }
  if (
    typeof payload.route_id !== "string" ||
    !TRAFFIC_ROUTES.has(payload.route_id)
  ) {
    throw new Error("Invalid normalized route.");
  }
  return {
    event_id: payload.event_id,
    visitor_id: payload.visitor_id,
    session_id: payload.session_id,
    route_id: payload.route_id,
    referrer_domain: normalizeReferrerDomain(payload.referrer_domain),
    utm_source: normalizeCampaignValue(payload.utm_source, 64),
    utm_medium: normalizeCampaignValue(payload.utm_medium, 64),
    utm_campaign: normalizeCampaignValue(payload.utm_campaign, 100),
  };
}

export function acquisitionSource(
  referrerDomain: string | null,
  utmSource: string | null,
):
  | "direct"
  | "google"
  | "linkedin"
  | "bing"
  | "other_search"
  | "other_referral"
  | "internal" {
  const hint = String(utmSource ?? "").toLowerCase();
  const domain = String(referrerDomain ?? "").toLowerCase();
  if (
    hint.includes("linkedin") || domain === "linkedin.com" ||
    domain.endsWith(".linkedin.com")
  ) return "linkedin";
  if (
    hint === "google" || domain === "google.com" || domain.includes(".google.")
  ) return "google";
  if (
    hint === "bing" || domain === "bing.com" || domain.endsWith(".bing.com")
  ) return "bing";
  if (
    ["duckduckgo", "yahoo", "yandex", "baidu", "search"].some((term) =>
      hint.includes(term) || domain.includes(term)
    )
  ) return "other_search";
  if (domain === "medichall.com" || domain.endsWith(".medichall.com")) {
    return "internal";
  }
  if (domain) return "other_referral";
  return "direct";
}

export function classifyUserAgent(userAgent: string): {
  device: DeviceCategory;
  browser: BrowserFamily;
} {
  const ua = String(userAgent || "");
  let device: DeviceCategory = "other";
  if (/ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i.test(ua)) {
    device = "tablet";
  } else if (
    /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)
  ) device = "mobile";
  else if (/windows|macintosh|linux|cros/i.test(ua)) device = "desktop";

  let browser: BrowserFamily = "other";
  if (/edg\//i.test(ua)) browser = "edge";
  else if (/firefox\//i.test(ua)) browser = "firefox";
  else if (/(?:chrome|crios)\//i.test(ua) && !/(?:edg|opr)\//i.test(ua)) {
    browser = "chrome";
  } else if (
    /safari\//i.test(ua) && /version\//i.test(ua) &&
    !/(?:chrome|crios|android)\//i.test(ua)
  ) browser = "safari";
  return { device, browser };
}

export function isObviousBot(userAgent: string): boolean {
  const ua = String(userAgent || "").trim();
  return !ua || BOT_PATTERN.test(ua);
}

export function trustedCountryCode(headers: Headers): string | null {
  // Supabase's Cloudflare boundary owns cf-ipcountry. Client-supplied country
  // fields are never accepted. If this trusted header is absent, geography is
  // deliberately recorded as unknown rather than inferred from a persisted IP.
  const value = String(headers.get("cf-ipcountry") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) && value !== "XX" ? value : null;
}

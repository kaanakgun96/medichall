/* MedicHall canonical privacy-minimized first-party page-view tracker. */
(function (global) {
  "use strict";

  if (global.MedicHallTraffic) return;

  const ENDPOINT = "https://azdmuarzntzqdyirysux.supabase.co/functions/v1/traffic-analytics";
  const PUBLISHABLE_KEY = "sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-";
  const VISITOR_KEY = "mh_traffic_visitor_v1";
  const SESSION_KEY = "mh_traffic_session_v1";
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const RAPID_DUPLICATE_MS = 2000;
  const SAFE_CAMPAIGN = /^[a-z0-9][a-z0-9._ -]*$/;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const PORTAL_PANELS = Object.freeze({
    dashboard: "portal_dashboard",
    products: "portal_products",
    opps: "portal_opportunities",
    rfq: "portal_messages",
    "b-requests": "portal_messages",
    matchmaking: "portal_matchmaking",
    "b-matchmaking": "portal_matchmaking",
    profile: "portal_profile",
    "b-profile": "portal_profile",
    ai: "portal_ai",
    "b-ai": "portal_ai",
    "b-favorites": "portal_dashboard",
  });

  let memoryVisitor = null;
  let memorySession = null;
  let lastRoute = null;
  let lastRecordedAt = 0;

  function storageRead(key) {
    try { return global.localStorage?.getItem(key) || null; } catch (_) { return null; }
  }

  function storageWrite(key, value) {
    try { global.localStorage?.setItem(key, value); } catch (_) { /* ephemeral fallback */ }
  }

  function uuid() {
    if (typeof global.crypto?.randomUUID === "function") return global.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    global.crypto?.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function visitorId() {
    const stored = memoryVisitor || storageRead(VISITOR_KEY);
    if (stored && UUID_PATTERN.test(stored)) return stored;
    memoryVisitor = uuid();
    storageWrite(VISITOR_KEY, memoryVisitor);
    return memoryVisitor;
  }

  function safeCampaign(value, limit) {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    return normalized && normalized.length <= limit && SAFE_CAMPAIGN.test(normalized)
      ? normalized
      : null;
  }

  function referrerDomain() {
    try {
      const host = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, "");
      return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
    } catch (_) { return null; }
  }

  function firstTouch() {
    const parameters = new URLSearchParams(global.location.search);
    return {
      referrer_domain: referrerDomain(),
      utm_source: safeCampaign(parameters.get("utm_source"), 64),
      utm_medium: safeCampaign(parameters.get("utm_medium"), 64),
      utm_campaign: safeCampaign(parameters.get("utm_campaign"), 100),
    };
  }

  function currentSession(now) {
    let session = memorySession;
    if (!session) {
      try { session = JSON.parse(storageRead(SESSION_KEY) || "null"); } catch (_) { session = null; }
    }
    if (!session || !UUID_PATTERN.test(String(session.id || "")) ||
      !Number.isFinite(Number(session.last_activity_at)) ||
      now - Number(session.last_activity_at) > SESSION_TIMEOUT_MS ||
      now < Number(session.last_activity_at)) {
      session = { id: uuid(), last_activity_at: now, ...firstTouch() };
    } else {
      session.last_activity_at = now;
    }
    memorySession = session;
    storageWrite(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function hasStoredAuth() {
    try { return Boolean(global.MedicHallSession?.accessToken?.()); } catch (_) { return false; }
  }

  function portalRoute() {
    const hash = global.location.hash.toLowerCase();
    if (hash === "#register") return "signup";
    if (!hasStoredAuth()) return "login";
    if (hash === "#inbox" || hash.startsWith("#rfq-")) return "portal_messages";
    if (hash.startsWith("#matchmaking")) return "portal_matchmaking";
    if (hash === "#settings" || hash === "#profile") return "portal_profile";
    if (hash === "#opportunities" || hash.startsWith("#tender-import=")) return "portal_opportunities";
    if (hash === "#dashboard" || hash === "#favorites" || hash === "#notifications") return "portal_dashboard";
    return "portal_dashboard";
  }

  function normalizedRoute() {
    const path = global.location.pathname.toLowerCase().replace(/\/+$/, "");
    const file = path.split("/").pop() || "index.html";
    const parameters = new URLSearchParams(global.location.search);
    if (/\/m\/[^/]+$/.test(path)) return "company_showroom";
    if (path.includes("portal-react")) {
      const route = global.location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
      if (route === "dashboard") return "react_dashboard";
      if (route === "my-opportunities") return "react_opportunities";
      if (route === "company-profile") return "react_company_profile";
      return "react_all_tenders";
    }
    if (file === "index.html" || file === "") return "homepage";
    if (file === "products.html") return parameters.has("p") || parameters.has("detail")
      ? "product_detail" : "products";
    if (file === "companies.html") return parameters.has("c") ? "company_showroom" : "companies";
    if (file === "tenders.html") return parameters.has("notice") || parameters.has("tender") || parameters.has("detail")
      ? "tender_detail" : "tenders";
    if (file === "matchmaking.html") return "matchmaking";
    if (file === "portal.html") return portalRoute();
    return null;
  }

  function trackingPreferenceAllows() {
    return global.navigator?.globalPrivacyControl !== true && global.navigator?.doNotTrack !== "1";
  }

  function track(route, options) {
    if (!trackingPreferenceAllows()) return false;
    const normalized = route || normalizedRoute();
    if (!normalized || normalized === "admin") return false;
    const now = Date.now();
    const force = options?.force === true;
    if (normalized === lastRoute && (!force || now - lastRecordedAt < RAPID_DUPLICATE_MS)) {
      currentSession(now);
      return false;
    }
    lastRoute = normalized;
    lastRecordedAt = now;
    const session = currentSession(now);
    const payload = {
      event_id: uuid(),
      visitor_id: visitorId(),
      session_id: session.id,
      route_id: normalized,
      referrer_domain: session.referrer_domain || null,
      utm_source: session.utm_source || null,
      utm_medium: session.utm_medium || null,
      utm_campaign: session.utm_campaign || null,
    };
    const token = global.MedicHallSession?.accessToken?.() || PUBLISHABLE_KEY;
    global.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {
      // Analytics is best-effort: no retry and no product/auth impact.
    });
    return true;
  }

  function trackPortalPanel(panel) {
    const route = PORTAL_PANELS[String(panel || "")];
    return route ? track(route) : false;
  }

  function resetForTest() {
    memoryVisitor = null;
    memorySession = null;
    lastRoute = null;
    lastRecordedAt = 0;
  }

  global.MedicHallTraffic = Object.freeze({
    track,
    trackPortalPanel,
    normalizedRoute,
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    _resetForTest: resetForTest,
  });

  const initialTrack = function () { setTimeout(function () { track(); }, 0); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialTrack, { once: true });
  else initialTrack();
  global.addEventListener("hashchange", function () { track(); });
  global.addEventListener("popstate", function () { track(); });
})(globalThis);

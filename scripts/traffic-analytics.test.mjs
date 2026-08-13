import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tracker = read("medichall-traffic.js");
const migration = read("supabase/migrations/202608130002_traffic_analytics.sql");
const admin = read("admin.html");

function trackerRuntime({ path = "/index.html", search = "", hash = "", stored = {}, reject = false } = {}) {
  const values = new Map(Object.entries(stored));
  const writes = [];
  const requests = [];
  const listeners = {};
  const context = {
    console,
    crypto: webcrypto,
    Date,
    JSON,
    Math,
    Promise,
    Uint8Array,
    URL,
    URLSearchParams,
    navigator: { doNotTrack: "0", globalPrivacyControl: false },
    location: { pathname: path, search, hash },
    document: { readyState: "complete", referrer: "", addEventListener() {} },
    localStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, String(value)); writes.push(key); },
    },
    addEventListener(name, handler) { listeners[name] = handler; },
    setTimeout,
    clearTimeout,
    fetch(url, options) {
      requests.push({ url, options });
      return reject ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true });
    },
    MedicHallSession: { accessToken() { return null; } },
  };
  context.globalThis = context;
  vm.runInNewContext(tracker, context, { filename: "medichall-traffic.js" });
  return { context, values, writes, requests, listeners };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

test("canonical tracker initializes once, deduplicates and retains no raw URL", async () => {
  const runtime = trackerRuntime({
    path: "/products.html",
    search: "?utm_source=LinkedIn&utm_medium=social&utm_campaign=Open%20Beta&token=private&q=secret",
  });
  await settle();
  assert.equal(runtime.requests.length, 1);
  const payload = JSON.parse(runtime.requests[0].options.body);
  assert.equal(payload.route_id, "products");
  assert.equal(payload.utm_source, "linkedin");
  assert.equal(payload.utm_campaign, "open beta");
  assert.deepEqual(Object.keys(payload).sort(), [
    "event_id", "referrer_domain", "route_id", "session_id",
    "utm_campaign", "utm_medium", "utm_source", "visitor_id",
  ]);
  assert.equal(runtime.context.MedicHallTraffic.track("products"), false);
  assert.equal(runtime.requests.length, 1);
  assert.equal(runtime.context.MedicHallTraffic.track("product_detail", { force: true }), true);
  assert.equal(runtime.context.MedicHallTraffic.track("product_detail", { force: true }), false);
  assert.equal(runtime.requests.length, 2);
  assert.equal(tracker.includes("window.fetch ="), false);
  assert.equal(tracker.includes("setInterval("), false);
});

test("30-minute inactivity renews only the traffic session and preserves visitor", async () => {
  const visitor = "83000000-0000-4000-8000-000000000001";
  const expiredSession = "83000000-0000-4000-8000-000000000002";
  const runtime = trackerRuntime({
    stored: {
      mh_traffic_visitor_v1: visitor,
      mh_traffic_session_v1: JSON.stringify({
        id: expiredSession,
        last_activity_at: Date.now() - (30 * 60 * 1000) - 100,
        referrer_domain: null,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
      }),
      mh_p_token: "auth-value-must-not-change",
      mh_p_refresh: "refresh-value-must-not-change",
    },
  });
  await settle();
  const payload = JSON.parse(runtime.requests[0].options.body);
  assert.equal(payload.visitor_id, visitor);
  assert.notEqual(payload.session_id, expiredSession);
  assert.equal(runtime.values.get("mh_p_token"), "auth-value-must-not-change");
  assert.equal(runtime.values.get("mh_p_refresh"), "refresh-value-must-not-change");
  assert.ok(runtime.writes.every((key) => key.startsWith("mh_traffic_")));
  assert.equal(runtime.context.MedicHallTraffic.sessionTimeoutMs, 30 * 60 * 1000);
});

test("analytics failure is non-blocking and never retried", async () => {
  const runtime = trackerRuntime({ reject: true });
  await settle();
  assert.equal(runtime.requests.length, 1);
});

test("migration keeps raw traffic private, bounded and admin aggregates explicit", () => {
  for (const marker of [
    "traffic_analytics_visitors", "traffic_analytics_sessions", "traffic_analytics_page_views",
    "record_traffic_page_view_v1", "get_admin_traffic_analytics_v1", "prune_traffic_analytics_v1",
    "400 days", "set statement_timeout = '3000ms'", "traffic-analytics-retention-v1",
  ]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_admin\(\)/i);
  assert.match(migration, /revoke all on table public\.traffic_analytics_page_views\s+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /\bip_address\b|raw_url|access_token|refresh_token|event_payload\s+jsonb/i);
  assert.match(migration, /revoke all on function public\.record_traffic_page_view_v1\([\s\S]*?\) from public, anon, authenticated;\s*grant execute on function public\.record_traffic_page_view_v1\([\s\S]*?\) to service_role;/i);
});

test("traffic UI is inside Growth, has all ranges and polls no faster than 45 seconds", () => {
  for (const marker of [
    "Business metrics", "Traffic analytics", "Active now", "Top pages", "Countries",
    "Top sources", "External referrers", "Campaigns", "Devices and browsers",
    "No traffic recorded for this period yet.", "Traffic analytics could not be loaded.",
  ]) assert.match(admin, new RegExp(marker, "i"));
  for (const range of ["today", "7d", "30d", "90d", "all"]) {
    assert.match(admin, new RegExp(`data-range="${range}"`));
  }
  assert.match(admin, /get_admin_traffic_analytics_v1/);
  assert.match(admin, /45\s*\*\s*1000/);
  assert.doesNotMatch(admin, /setInterval\([^,]+,\s*1000\)/);
});

test("all canonical customer surfaces load one tracker and Admin is excluded", () => {
  for (const page of ["index.html", "products.html", "companies.html", "tenders.html", "matchmaking.html", "portal.html"]) {
    const source = read(page);
    assert.equal((source.match(/medichall-traffic\.js\?v=20260813traffic1/g) ?? []).length, 1, page);
  }
  assert.doesNotMatch(admin, /medichall-traffic\.js/);
  assert.match(read("apps/portal-react/src/main.tsx"), /medichall-traffic\.js/);
});

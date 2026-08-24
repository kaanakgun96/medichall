import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const sessionSource = readFileSync("medichall-session.js", "utf8");
const rootPages = [
  "index.html",
  "companies.html",
  "products.html",
  "tenders.html",
  "matchmaking.html",
  "portal.html",
  "admin.html",
];

function response(status, data) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return data; },
  };
}

function sessionHarness(fetchImpl, initial = {}) {
  const values = new Map(Object.entries(initial));
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const context = {
    AbortController,
    clearTimeout,
    console,
    fetch: fetchImpl,
    localStorage,
    setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(sessionSource, context, { filename: "medichall-session.js" });
  context.MedicHallSession.configure({
    url: "https://production-project.invalid",
    key: "publishable-test-key",
    fetch: fetchImpl,
  });
  return { session: context.MedicHallSession, values };
}

test("password login persists the canonical access and refresh keys", async () => {
  const calls = [];
  const { session, values } = sessionHarness(async (url) => {
    calls.push(url);
    return response(200, {
      access_token: "access-a",
      refresh_token: "refresh-a",
      user: { id: "user-a" },
    });
  });
  const result = await session.signIn({ email: "qa@example.invalid", password: "not-a-real-password" });
  assert.equal(result.user.id, "user-a");
  assert.equal(values.get("mh_p_token"), "access-a");
  assert.equal(values.get("mh_p_refresh"), "refresh-a");
  assert.match(calls[0], /\/auth\/v1\/token\?grant_type=password$/);
});

test("an expired cross-page session refreshes once and retries the requested route", async () => {
  let refreshCalls = 0;
  let userCalls = 0;
  const { session, values } = sessionHarness(async (url, options) => {
    if (url.includes("grant_type=refresh_token")) {
      refreshCalls += 1;
      return response(200, { access_token: "access-new", refresh_token: "refresh-new" });
    }
    if (url.endsWith("/auth/v1/user")) {
      userCalls += 1;
      return options.headers.Authorization === "Bearer access-new"
        ? response(200, { id: "user-a" })
        : response(401, { code: "bad_jwt" });
    }
    throw new Error(`unexpected request: ${url}`);
  }, { mh_p_token: "access-expired", mh_p_refresh: "refresh-old" });

  const user = await session.getUser();
  assert.equal(user.id, "user-a");
  assert.equal(refreshCalls, 1);
  assert.equal(userCalls, 2);
  assert.equal(values.get("mh_p_token"), "access-new");
  assert.equal(values.get("mh_p_refresh"), "refresh-new");
});

test("concurrent 401 responses share one refresh operation", async () => {
  let refreshCalls = 0;
  const { session } = sessionHarness(async (url, options) => {
    if (url.includes("grant_type=refresh_token")) {
      refreshCalls += 1;
      await Promise.resolve();
      return response(200, { access_token: "access-new", refresh_token: "refresh-new" });
    }
    return options.headers.Authorization === "Bearer access-new"
      ? response(200, {})
      : response(401, {});
  }, { mh_p_token: "access-expired", mh_p_refresh: "refresh-old" });

  const [first, second] = await Promise.all([
    session.request("/rest/v1/first"),
    session.request("/rest/v1/second"),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(refreshCalls, 1);
});

test("invalid refresh credentials clear only the canonical session keys", async () => {
  const { session, values } = sessionHarness(async () => response(401, { code: "bad_refresh_token" }), {
    mh_p_token: "access-expired",
    mh_p_refresh: "refresh-invalid",
    unrelated: "preserve-me",
  });
  assert.equal(await session.refresh(), false);
  assert.equal(values.has("mh_p_token"), false);
  assert.equal(values.has("mh_p_refresh"), false);
  assert.equal(values.get("unrelated"), "preserve-me");
});

test("admin authentication failures remain distinguishable", () => {
  const { session } = sessionHarness(async () => response(500, {}));
  assert.equal(session.classifyAuthFailure(400, { error_code: "invalid_credentials" }).code, "AUTH_INVALID_CREDENTIALS");
  assert.equal(session.classifyAuthFailure(401, {}).code, "AUTH_SESSION_EXPIRED");
  assert.equal(session.classifyAuthFailure(429, {}).code, "AUTH_RATE_LIMITED");
  assert.equal(session.classifyAuthFailure(503, {}).code, "AUTH_SERVICE_ERROR");
});

test("root pages load one canonical session helper before shared navigation", () => {
  const releaseVersions = new Set();
  for (const page of rootPages) {
    const source = readFileSync(page, "utf8");
    const sessionIndex = source.indexOf("medichall-session.js");
    const navigationIndex = source.indexOf("medichall-navigation.js");
    assert.ok(sessionIndex >= 0, `${page} is missing medichall-session.js`);
    assert.ok(navigationIndex > sessionIndex, `${page} loads navigation before the session helper`);
    for (const match of source.matchAll(/(?:src|href)="[^"]+\?v=([^"']+)/g)) {
      releaseVersions.add(match[1]);
    }
  }
  assert.deepEqual([...releaseVersions].sort(), ["20260809s22rc1", "20260810beta1", "20260811tax1", "20260813growth1", "20260813traffic1", "20260813video1", "20260817draft1", "20260817privacy1", "20260820buyer1", "20260824relevance2"].sort());
});

test("Messages, admin authorization, analytics, mobile auth, and notification contracts are present", () => {
  const portal = readFileSync("portal.html", "utf8");
  const admin = readFileSync("admin.html", "utf8");
  const nav = readFileSync("medichall-navigation.js", "utf8");
  const matchmaking = readFileSync("matchmaking-workspace.js", "utf8");
  const companies = readFileSync("marketplace-companies.js", "utf8");
  const products = readFileSync("marketplace-products.js", "utf8");
  const css = readFileSync("medichall-design-system.css", "utf8");

  assert.match(portal, /if\(h === "#inbox"\) showPanel/);
  assert.match(portal, /if\(AUTH_SESSION\.hasStoredSession\(\)\) enterApp\(\)/);
  assert.match(portal, /DASHBOARD_METRICS_STATE\.opportunities = "error"/);
  assert.match(portal, /Dashboard metrics are unavailable\. Your data was not changed\./);
  assert.match(admin, /\/rest\/v1\/rpc\/is_admin/);
  assert.match(admin, /You do not have admin access\./);
  assert.match(admin, /AUTH_INVALID_CREDENTIALS/);
  assert.match(admin, /id="loginErr" role="alert" aria-live="polite"><\/p>/);
  assert.match(nav, /portal\.html#inbox">Messages/);
  assert.match(nav, />Log In<\/a>/);
  assert.match(nav, />Sign Up<\/a>/);
  assert.match(nav, /skipTarget\.id = "main-content"/);
  assert.doesNotMatch(nav, /if \(mainTarget && !document\.getElementById\("main-content"\)\) mainTarget\.id/);
  assert.match(nav, /!bell\.offsetParent \|\| rect\.width === 0 \|\| rect\.height === 0/);
  assert.match(css, /\.mh-main-anchor/);
  assert.match(companies, /row\.company_id/);
  assert.match(companies, /filter\(Number\.isFinite\)/);
  assert.match(companies, /session\.getUser\(\)/);
  assert.match(companies, /session\.request/);
  assert.match(products, /session\.getUser\(\)/);
  assert.match(products, /session\.request/);
  assert.match(products, /headers: \{ "Content-Type": "application\/json"/);
  assert.match(companies, /headers: \{ "Content-Type": "application\/json"/);
  assert.doesNotMatch(companies, /localStorage\.getItem\("mh_p_token"\)/);
  assert.doesNotMatch(products, /localStorage\.getItem\("mh_p_token"\)/);
  assert.match(matchmaking, /AUTH_SESSION\.getUser\(\)/);
  assert.match(css, /\.modal\.mh-notification-panel/);
});

test("canonical source has no global fetch override or temporary hotfix dependency", () => {
  const sources = [
    ...rootPages,
    "medichall-session.js",
    "medichall-navigation.js",
    "matchmaking-workspace.js",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(sources, /(?:window|globalThis)\.fetch\s*=/);
  assert.doesNotMatch(sources, /medichall-(?:auth-navigation-hotfix|notification-popover-hotfix|safe-mobile-hotfix)/);
});

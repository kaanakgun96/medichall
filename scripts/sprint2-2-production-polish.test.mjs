import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "products.html", "companies.html", "tenders.html", "matchmaking.html", "portal.html", "admin.html"];
const defaultVersion = "20260809s22rc1";
const expectedVersions = {
  "products.html": "20260813traffic1",
  "companies.html": "20260811tax1",
  "matchmaking.html": "20260813video1",
  "portal.html": "20260813video1",
};

for (const page of pages) {
  const source = await readFile(resolve(root, page), "utf8");
  const expectedVersion = expectedVersions[page] || defaultVersion;
  assert.equal((source.match(/medichall-ui\.js/g) || []).length, 1, `${page} must load the shared UI safety helper once`);
  assert.match(source, new RegExp(`medichall-ui\\.js\\?v=${expectedVersion}`), `${page} must cache-bust the shared UI helper`);
  const sharedAssets = [...source.matchAll(/((?:medichall-(?:design-system|session|ui|navigation)|marketplace-(?:enterprise|domain|products|companies)|matchmaking-(?:domain|workspace)|tenders)\.(?:css|js))\?v=([a-zA-Z0-9]+)/g)]
    .map((match) => ({ file: match[1], version: match[2] }));
  assert.ok(sharedAssets.length >= 4, `${page} must load the shared production assets`);
  for (const asset of sharedAssets) {
    const expectedAssetVersion = page === "companies.html" && asset.file === "marketplace-companies.js"
      ? "20260813seo2"
      : expectedVersion;
    assert.equal(asset.version, expectedAssetVersion, `${page} must use the audited cache version for ${asset.file}`);
  }
  assert.doesNotMatch(source, /fakeAuth\s*\(/, `${page} must not retain preview-only authentication actions`);
  assert.doesNotMatch(source, /^\s*initAuthChip\(\);/m, `${page} must not start the duplicate legacy session poller`);
  assert.doesNotMatch(source, /throw new Error\(await (?:res|response)\.text\(\)\)/, `${page} must not surface raw HTTP response bodies`);
}

const files = await Promise.all([
  "medichall-ui.js", "medichall-navigation.js", "medichall-design-system.css", "marketplace-domain.js",
  "marketplace-products.js", "marketplace-companies.js", "matchmaking-workspace.js",
  "portal.html", "admin.html",
].map(async (file) => [file, await readFile(resolve(root, file), "utf8")]));
const sourceByFile = Object.fromEntries(files);

assert.match(sourceByFile["medichall-ui.js"], /function safeError\(/, "shared helper must expose safe user errors");
assert.match(sourceByFile["medichall-ui.js"], /function singleFlight\(/, "shared helper must coordinate duplicate requests");
assert.match(sourceByFile["medichall-ui.js"], /document\.visibilityState === "hidden"/, "shared polling must pause in background tabs");
assert.match(sourceByFile["medichall-navigation.js"], /attributeFilter: \["class", "style", "hidden"\]/, "dialogs must resynchronize accessibility state when opened or closed");
assert.match(sourceByFile["medichall-design-system.css"], /prefers-reduced-motion: reduce/, "reduced-motion preferences must be respected");
assert.match(sourceByFile["portal.html"], /This import could not be completed\. Review the source and retry\./, "tender import failures must use safe user copy");
assert.doesNotMatch(sourceByFile["portal.html"], /esc\(String\(row\.error_message\)\)/, "raw tender import errors must not render");
assert.doesNotMatch(sourceByFile["admin.html"], /run supabase-admin-setup\.sql/i, "admin users must not receive internal SQL instructions");
assert.doesNotMatch(sourceByFile["marketplace-products.js"], /\$\{error\.message\}/, "product actions must not interpolate raw API errors");
assert.doesNotMatch(sourceByFile["matchmaking-workspace.js"], /return raw\.replace/, "matchmaking must not return raw API errors");

const marketplaceSandbox = { URLSearchParams };
marketplaceSandbox.globalThis = marketplaceSandbox;
vm.runInNewContext(sourceByFile["marketplace-domain.js"], marketplaceSandbox, { filename: "marketplace-domain.js" });
const marketplaceDomain = marketplaceSandbox.MedicHallMarketplaceDomain;
const malformedCountryProduct = marketplaceDomain.normalizeProduct({
  id: 1,
  company_id: 5,
  companies: { id: 5, name: "Example Medical", country: "TüRkiye" },
});
assert.equal(malformedCountryProduct.company_country, "Türkiye", "country presentation must use the canonical Türkiye spelling");
assert.equal(marketplaceDomain.queryFilters("?country=T%C3%BCRkiye").country, "Türkiye", "legacy country URLs must normalize without losing the filter");
assert.equal(marketplaceDomain.companyFilterLabel([malformedCountryProduct], "5"), "Example Medical", "company filter chips must use loaded company names");
assert.equal(marketplaceDomain.companyFilterLabel([], "999"), "Selected company", "unresolved company filters must use a safe fallback");

const diagnostics = [];
const sandbox = {
  console: { error: (...items) => diagnostics.push(items) },
  setTimeout, clearTimeout,
  document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
};
sandbox.globalThis = sandbox;
vm.runInNewContext(sourceByFile["medichall-ui.js"], sandbox, { filename: "medichall-ui.js" });
const providerError = sandbox.MedicHallUI.httpError({ status: 503 }, { message: "provider secret detail", code: "unexpected_internal_code" });
assert.equal(sandbox.MedicHallUI.errorMessage(providerError), "MedicHall is temporarily unavailable. Please try again shortly.");
assert.doesNotMatch(providerError.message, /provider secret detail/, "HTTP errors must discard provider messages");
assert.equal(sandbox.MedicHallUI.safeError("test.provider", providerError), "MedicHall is temporarily unavailable. Please try again shortly.");
assert.equal(JSON.stringify(diagnostics).includes("provider secret detail"), false, "redacted diagnostics must not log provider messages");

console.log(`Sprint 2.2 production-polish checks passed for ${pages.length} root pages.`);

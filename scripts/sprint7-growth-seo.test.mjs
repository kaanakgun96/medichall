import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const landingPages = [
  "medical-device-tenders.html",
  "ai-tender-intelligence.html",
  "find-medical-device-distributors.html",
  "medical-device-b2b-marketplace.html",
  "ai-medical-device-matchmaking.html",
];
const publicPages = ["index.html", "products.html", "companies.html", "tenders.html", ...landingPages];

function metadata(source, name) {
  const title = source.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = source.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1];
  const canonical = source.match(/<link\s+rel="canonical"(?:\s+id="[^"]+")?\s+href="([^"]+)"/i)?.[1];
  assert.ok(title && title.length >= 20 && title.length <= 68, `${name}: title length`);
  assert.ok(description && description.length >= 80 && description.length <= 180, `${name}: description length`);
  assert.match(canonical || "", /^https:\/\/medichall\.com\//, `${name}: canonical`);
  for (const marker of ["og:title", "og:description", "og:url", "og:image", "twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    assert.match(source, new RegExp(`(?:property|name)="${marker}"`, "i"), `${name}: ${marker}`);
  }
  assert.match(source, /name="robots" content="index,follow,max-image-preview:large"/i, `${name}: public robots`);
}

test("every canonical public page has complete search and social metadata", () => {
  for (const page of publicPages) metadata(read(page), page);
});

test("landing pages have one H1, visible FAQs and valid JSON-LD", () => {
  for (const page of landingPages) {
    const source = read(page);
    assert.equal((source.match(/<h1\b/gi) ?? []).length, 1, `${page}: H1 count`);
    assert.ok((source.match(/<details>/gi) ?? []).length >= 3, `${page}: visible FAQs`);
    const blocks = [...source.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(blocks.length >= 1, `${page}: JSON-LD present`);
    for (const block of blocks) JSON.parse(block[1]);
    assert.doesNotMatch(source, /#1|\bbest\b|\blargest\b|thousands of (?:customers|users)|guaranteed/i, `${page}: unsupported claim`);
  }
});

test("sitemap contains only canonical public URLs and no SEO theater", () => {
  const sitemap = read("sitemap.xml");
  for (const route of [
    "/products", "/companies", "/tenders", "/medical-device-tenders",
    "/ai-tender-intelligence", "/find-medical-device-distributors",
    "/medical-device-b2b-marketplace", "/ai-medical-device-matchmaking",
    "/m/4a-medical", "/blog/",
  ]) assert.match(sitemap, new RegExp(`<loc>https://medichall\\.com${route.replaceAll("/", "\\/")}`));
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
  assert.ok(locations.every((location) => !["/portal", "/admin", "/matchmaking"].includes(location.pathname)));
  assert.ok(locations.every((location) => !location.search && !location.hash));
  assert.doesNotMatch(sitemap, /<changefreq>|<priority>/i);
});

test("robots permits public search, references sitemap and separates AI search from training", () => {
  const robots = read("robots.txt");
  assert.match(robots, /User-agent: OAI-SearchBot[\s\S]*?Allow: \//);
  assert.match(robots, /User-agent: GPTBot\s+Disallow: \//);
  assert.match(robots, /Sitemap: https:\/\/medichall\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/(?:products|companies|tenders)\b/);
});

test("private application surfaces remain noindex", () => {
  for (const page of ["portal.html", "admin.html", "matchmaking.html"]) {
    assert.match(read(page), /name="robots" content="noindex,nofollow"/i, page);
  }
});

test("company showroom metadata uses only public profile fields", () => {
  const source = read("marketplace-companies.js");
  for (const marker of ["mhCanonical", "mhCompanyStructuredData", "Organization", "knowsAbout", "mainEntityOfPage"]) assert.match(source, new RegExp(marker));
  assert.doesNotMatch(source, /owner_id|user_id|private_note|access_token|refresh_token/);
  assert.doesNotMatch(source, /aggregateRating|reviewCount|priceCurrency/);
});

test("static local links resolve to repository artifacts or established production routes", () => {
  const established = new Set(["blog", "m", "portal", "products", "companies", "tenders", "matchmaking"]);
  for (const page of publicPages) {
    for (const match of read(page).matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (!href || /^(?:https?:|mailto:|tel:|#|data:|\$)/.test(href)) continue;
      const clean = href.split(/[?#]/)[0].replace(/^\//, "");
      if (!clean) continue;
      if (established.has(clean.split("/")[0])) continue;
      const candidates = clean.endsWith("/")
        ? [`${clean}index.html`]
        : [clean, `${clean}.html`];
      assert.equal(candidates.some((candidate) => existsSync(new URL(`../${candidate}`, import.meta.url))), true, `${page}: broken local link ${href}`);
    }
  }
});

test("shared navigation correctly labels the mixed company directory", () => {
  const navigation = read("medichall-navigation.js");
  assert.match(navigation, /\["companies", "Companies", "companies\.html"\]/);
  assert.doesNotMatch(navigation, /\["companies", "Manufacturers"/);
});

test("Sprint 7 assets contain no service role, provider or private credentials", () => {
  const combined = [...publicPages, "robots.txt", "sitemap.xml", "medichall-growth.css", "medichall-logo.svg"]
    .map(read).join("\n");
  assert.doesNotMatch(combined, /service_role|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|DAILY_API_KEY|ANTHROPIC_API_KEY|BEGIN (?:RSA |EC )?PRIVATE KEY/i);
});

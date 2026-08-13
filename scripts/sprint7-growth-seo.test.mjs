import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const landingPages = [
  "medical-device-tenders.html",
  "ai-tender-intelligence.html",
  "find-medical-device-distributors.html",
  "medical-device-b2b-marketplace.html",
  "ai-medical-device-matchmaking.html",
];
const publicPages = ["index.html", "products.html", "companies.html", "tenders.html", ...landingPages];
const showroomFixtures = [
  ["4a-medical", "4A Medical"],
  ["dispack-medical", "Dispack Medical"],
  ["grup-a-medical", "Grup A Medical"],
  ["medibant-medikal", "Medibant Medikal"],
];

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

test("the social card is a valid, bounded 1200 by 630 PNG used by every public SEO page", () => {
  const image = readFileSync(new URL("../og-cover.png", import.meta.url));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 1200, "OG image width");
  assert.equal(image.readUInt32BE(20), 630, "OG image height");
  assert.ok(image.byteLength > 20_000 && image.byteLength < 1_500_000, "OG image has a sensible compressed size");
  for (const page of publicPages) {
    const source = read(page);
    assert.match(source, /(?:property|name)="(?:og|twitter):image"[^>]+content="https:\/\/medichall\.com\/og-cover\.png"/i, `${page}: social card reference`);
  }
});

test("the showroom controller cache hotfix is bounded to its one script reference", () => {
  const source = read("companies.html");
  assert.equal((source.match(/20260813seo2/g) ?? []).length, 1);
  assert.match(source, /<script src="marketplace-companies\.js\?v=20260813seo2"><\/script>/);
  assert.doesNotMatch(source, /marketplace-companies\.js\?v=20260813seo1/);
  assert.doesNotMatch(source, /marketplace-companies\.js\?v=20260811tax1/);
});

test("showroom metadata is applied as soon as the public company record resolves", () => {
  const source = read("companies.html");
  const companyResolved = source.indexOf("const c = rows[0]; CURRENT = c;");
  const earlyMetadata = source.indexOf("applyProfileMetadata?.(c, []);", companyResolved);
  const certificateLoad = source.indexOf("await loadCertDocs(c);", companyResolved);
  const productLoad = source.indexOf('const prods = await db("products?', companyResolved);
  assert.ok(companyResolved >= 0, "public company resolution must remain explicit");
  assert.ok(earlyMetadata > companyResolved, "metadata must follow company resolution");
  assert.ok(earlyMetadata < certificateLoad, "metadata must not wait for certificates");
  assert.ok(earlyMetadata < productLoad, "metadata must not wait for products");
  assert.match(source, /location\.pathname\.match\(\/\\\/m\\\/\(\[\^\\\/\]\+\)\/\)/, "showroom mode must use the pathname slug");
  assert.match(source, /loadProfile\(decodeURIComponent\(mPath\[1\]\), true\)/, "pathname slug must drive the public-company lookup");
  assert.doesNotMatch(source, /slug\s*===\s*["'](?:4a-medical|dispack-medical|grup-a-medical|medibant-medikal)/, "showroom routing must stay generic");
});

test("all indexed showrooms receive self-canonical public Organization metadata at runtime", async () => {
  const controller = read("marketplace-companies.js");

  for (const [slug, name] of showroomFixtures) {
    const elements = new Map();
    const element = (id, type = "") => {
      const attributes = new Map(type ? [["type", type]] : []);
      const value = {
        textContent: "",
        setAttribute(key, content) { attributes.set(key, String(content)); },
        getAttribute(key) { return attributes.get(key) ?? null; },
      };
      elements.set(id, value);
      return value;
    };
    const descriptionMeta = element("description");
    const canonical = element("mhCanonical");
    const ogTitle = element("mhOgTitle");
    const ogDescription = element("mhOgDescription");
    const ogUrl = element("mhOgUrl");
    const ogImage = element("mhOgImage");
    const twitterTitle = element("mhTwitterTitle");
    const twitterDescription = element("mhTwitterDescription");
    const twitterImage = element("mhTwitterImage");
    const directoryData = element("mhDirectoryStructuredData", "application/ld+json");
    const companyData = element("mhCompanyStructuredData", "application/ld+json");

    const document = {
      title: "Company Directory — MedicHall Marketplace",
      getElementById(id) { return elements.get(id) ?? null; },
      querySelector(selector) { return selector === 'meta[name="description"]' ? descriptionMeta : null; },
    };
    const sandbox = {
      document,
      MedicHallMarketplaceDomain: {
        asArray(value) { return Array.isArray(value) ? value : []; },
        safeHttpUrl(value) { return /^https:\/\//i.test(String(value || "")) ? String(value) : null; },
      },
      MedicHallUI: { httpError() { return new Error("HTTP error"); } },
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(controller, sandbox, { filename: "marketplace-companies.js" });
    assert.equal(typeof sandbox.MedicHallEnterpriseCompanies.applyProfileMetadata, "function");

    const publicCompany = {
      id: slug,
      slug,
      name,
      type: "Medical-industry company",
      description: `${name} public company showroom on MedicHall.`,
      city: "Istanbul",
      country: "Türkiye",
      website: `https://example.com/${slug}`,
      logo_url: slug === "4a-medical" ? `https://example.com/${slug}.png` : null,
      is_verified: true,
      phone: "+00 private-test-value",
      private_note: "must-not-appear",
    };
    sandbox.MedicHallEnterpriseCompanies.applyProfileMetadata(publicCompany, []);

    const expectedCanonical = `https://medichall.com/m/${slug}`;
    assert.equal(document.title, `${name} — MedicHall Company Showroom`);
    assert.equal(canonical.getAttribute("href"), expectedCanonical);
    assert.equal(ogUrl.getAttribute("content"), expectedCanonical);
    assert.equal(JSON.parse(companyData.textContent).name, name);

    await sandbox.MedicHallEnterpriseCompanies.enhanceProfile(publicCompany, [
      { category: "Medical Devices", taxonomy_category: "Surgical Drapes" },
    ]);

    assert.equal(document.title, `${name} — MedicHall Company Showroom`);
    assert.equal(canonical.getAttribute("href"), expectedCanonical);
    assert.equal(ogUrl.getAttribute("content"), expectedCanonical);
    assert.equal(ogTitle.getAttribute("content"), `${name} — MedicHall Company Showroom`);
    assert.equal(descriptionMeta.getAttribute("content"), `${name} public company showroom on MedicHall.`);
    assert.equal(ogDescription.getAttribute("content"), `${name} public company showroom on MedicHall.`);
    assert.equal(ogImage.getAttribute("content"), slug === "4a-medical" ? `https://example.com/${slug}.png` : "https://medichall.com/og-cover.png");
    assert.equal(twitterTitle.getAttribute("content"), `${name} — MedicHall Company Showroom`);
    assert.equal(twitterDescription.getAttribute("content"), `${name} public company showroom on MedicHall.`);
    assert.equal(twitterImage.getAttribute("content"), ogImage.getAttribute("content"));
    assert.equal(directoryData.getAttribute("type"), "application/json");
    assert.equal(companyData.getAttribute("type"), "application/ld+json");
    const organization = JSON.parse(companyData.textContent);
    assert.equal(organization["@type"], "Organization");
    assert.equal(organization.name, name);
    assert.equal(organization.url, expectedCanonical);
    assert.equal(organization.mainEntityOfPage, expectedCanonical);
    assert.deepEqual(Array.from(organization.knowsAbout), ["Surgical Drapes"]);
    assert.doesNotMatch(companyData.textContent, /private-test-value|must-not-appear|private_note|phone/);
  }
});

test("the generic companies route remains the mixed Company Directory", () => {
  const source = read("companies.html");
  assert.match(source, /<title>Company Directory — MedicHall Marketplace<\/title>/);
  assert.match(source, /<link rel="canonical" id="mhCanonical" href="https:\/\/medichall\.com\/companies">/);
  assert.match(source, /manufacturers, distributors, suppliers, buyers and other companies/i);
  assert.match(source, /"@type":"CollectionPage"/);
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

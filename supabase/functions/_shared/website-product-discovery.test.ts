import assert, {
  deepStrictEqual as assertEquals,
  throws as assertThrows,
} from "node:assert/strict";
import {
  extractWebsiteProductSignals,
  normalizeWebsiteProductSignals,
  prioritizedWebsiteUrls,
  sitemapProductUrls,
  validateProductSearchQuery,
  WEBSITE_PRODUCT_SCAN_LIMITS,
} from "./website-product-discovery.ts";

const taxonomy = [
  {
    id: 11,
    canonicalName: "Ultrasound Probe Covers",
    slug: "ultrasound-probe-covers",
    nodeType: "category",
    aliases: ["Ultrasound Transducer Sheath", "Sterile Probe Cover"],
  },
  {
    id: 12,
    canonicalName: "C-Arm Covers",
    slug: "c-arm-covers",
    nodeType: "category",
    aliases: ["C Arm Drape", "Fluoroscopy Drapes"],
  },
  {
    id: 13,
    canonicalName: "Equipment Covers",
    slug: "equipment-covers",
    nodeType: "family",
    aliases: [],
  },
];

Deno.test("product input accepts product phrases and rejects proxy/crawler payloads", () => {
  assertEquals(
    validateProductSearchQuery(" Ultrasound Probe Cover "),
    "Ultrasound Probe Cover",
  );
  assertThrows(() =>
    validateProductSearchQuery("https://internal.example/products")
  );
  assertThrows(() => validateProductSearchQuery("crawl this website for me"));
  assertThrows(() => validateProductSearchQuery("<script>alert(1)</script>"));
  assertThrows(() => validateProductSearchQuery("x"));
});

Deno.test("website extraction uses headings, product links and schema Product without contacts", () => {
  const html = `<!doctype html><title>Medical manufacturer</title>
    <script type="application/ld+json">{"@type":"Product","name":"Sterile ultrasound transducer sheath"}</script>
    <nav><a href="/products/c-arm-drapes">C Arm Drape</a><a href="/contact">Contact sales@example.com</a></nav>
    <main><h1>Ultrasound Transducer Sheath</h1><h2>C Arm Drape</h2></main>
    <footer>Phone +44 123 456 7890</footer>`;
  const signals = extractWebsiteProductSignals(
    html,
    "https://manufacturer.example/products",
  );
  assert(
    signals.some((item) =>
      item.kind === "schema_product" && item.label.includes("transducer")
    ),
  );
  assert(
    signals.some((item) =>
      item.kind === "product_link" && item.label === "C Arm Drape"
    ),
  );
  assert(!JSON.stringify(signals).includes("sales@example.com"));
  assert(!JSON.stringify(signals).includes("123 456"));
  const suggestions = normalizeWebsiteProductSignals(signals, taxonomy);
  assertEquals(suggestions.map((item) => item.taxonomy_id).sort(), [11, 12]);
  assertEquals(suggestions[0].auto_selected, true);
  assert(
    suggestions.every((item) =>
      item.confidence === "HIGH" || item.confidence === "MEDIUM"
    ),
  );
});

Deno.test("low confidence website matches are never auto-selected", () => {
  const suggestions = normalizeWebsiteProductSignals([{
    label: "Ultrasound protective equipment",
    pageUrl: "https://manufacturer.example/solutions",
    kind: "heading",
    strength: .7,
  }], taxonomy);
  assert(suggestions.length <= 1);
  if (suggestions.length) {
    assertEquals(suggestions[0].confidence, "LOW");
    assertEquals(suggestions[0].auto_selected, false);
  }
});

Deno.test("crawl candidates stay same-origin, product-focused and bounded", () => {
  const html = `<a href="/products/probe-covers">Probe covers</a>
    <a href="https://manufacturer.example/catalogue">Catalogue</a>
    <a href="https://evil.example/products">External</a>
    <a href="/contact">Contact</a>`;
  assertEquals(
    prioritizedWebsiteUrls(
      html,
      "https://manufacturer.example/",
      "https://manufacturer.example/",
    ),
    [
      "https://manufacturer.example/products/probe-covers",
      "https://manufacturer.example/catalogue",
    ],
  );
  const sitemap = `<urlset>${
    Array.from({ length: 30 }, (_, index) =>
      `<url><loc>https://manufacturer.example/products/item-${index}</loc></url>`)
      .join("")
  }
    <url><loc>https://evil.example/products/private</loc></url></urlset>`;
  const urls = sitemapProductUrls(sitemap, "https://manufacturer.example/");
  assert(urls.length <= WEBSITE_PRODUCT_SCAN_LIMITS.maximumPages - 1);
  assert(urls.every((url) => url.startsWith("https://manufacturer.example/")));
});

Deno.test("no reliable product signal yields no fabricated suggestion", () => {
  const signals = extractWebsiteProductSignals(
    "<html><h1>Committed to better healthcare</h1><p>Our mission and team.</p></html>",
    "https://manufacturer.example/",
  );
  assertEquals(normalizeWebsiteProductSignals(signals, taxonomy), []);
});

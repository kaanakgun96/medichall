import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await import(`${pathToFileURL(resolve(root, "marketplace-domain.js")).href}?test=${Date.now()}`);
const domain = globalThis.MedicHallMarketplaceDomain;
assert.ok(domain, "marketplace domain must register globally");

const product = domain.normalizeProduct({
  id: 1, ref: "QA-1", name: "Sterile Surgical Drape", category: "Medical Devices",
  normalized_category: "surgical_drapes", product_subtype: "Epidural drape",
  material: "Non-woven fabric", sterility_status: "sterile", use_type: "single_use",
  product_certifications: ["CE", "EN 13795"], packaging_description: null,
  matching_profile_sources: { material: "explicit", dimensions: "unknown" },
  companies: { id: 9, name: "QA Distributor", country: "Türkiye", type: "distributor" },
});
assert.equal(product.company_type, "distributor", "company type must not be coerced to manufacturer");
assert.equal(domain.sourceFor(product, "dimensions"), "unknown");
assert.equal(domain.displayValue(null), "Not provided");
assert.ok(domain.productReadiness(product).score < 100, "missing data must reduce readiness");

const filters = domain.queryFilters("?q=drape&country=T%C3%BCrkiye&sterility=sterile&view=favorites");
filters.favoriteIds = new Set([1]);
assert.equal(domain.matchesFilters(product, filters), true, "structured catalog filters must compose");
assert.match(domain.filtersQuery(filters), /view=favorites/, "favorite view must persist in the URL");
assert.equal(domain.matchesFilters(product, { readiness: "80" }), false, "readiness filters must not promote sparse profiles");

const comparisonCandidate = domain.normalizeProduct({
  id: 2, ref: "QA-2", name: "Reusable Surgical Drape", category: "Medical Devices",
  normalized_category: "surgical_drapes", material: "Textile",
  sterility_status: "unknown", use_type: "reusable", product_certifications: [],
  companies: { id: 10, name: "QA Supplier", country: "Germany", type: "supplier" },
});
const similar = domain.similarProducts(product, [product, comparisonCandidate]);
assert.equal(similar.length, 1, "similar products must exclude the source and duplicates");
assert.ok(similar[0].reasons.length, "similar products must explain their evidence");

const recommendation = domain.recommendation("sterile single use surgical drape CE", product);
assert.ok(recommendation.matched.includes("sterile"));
assert.equal(recommendation.blockers.length, 0);
const blocked = domain.recommendation("reusable surgical drape", product);
assert.ok(blocked.blockers.some((item) => item.includes("single-use")), "explicit conflicts must be blockers");

assert.equal(domain.fileMeta("javascript:alert(1)"), null, "unsafe download URLs must be rejected");
assert.equal(domain.fileMeta("https://example.com/files/Product%20Sheet.pdf").type, "PDF");

const productsHtml = await readFile(resolve(root, "products.html"), "utf8");
const companiesHtml = await readFile(resolve(root, "companies.html"), "utf8");
const navigation = await readFile(resolve(root, "medichall-navigation.js"), "utf8");
assert.doesNotMatch(navigation, /Search products and manufacturers/);
assert.doesNotMatch(navigation, /\["manufacturers", "Manufacturers"/);
assert.doesNotMatch(productsHtml, /Other manufacturers/);
assert.doesNotMatch(companiesHtml, /<h1>Manufacturers<\/h1>/);

console.log("Enterprise marketplace domain and terminology checks passed.");

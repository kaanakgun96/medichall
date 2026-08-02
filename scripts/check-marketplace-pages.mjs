import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "products.html", "companies.html", "portal.html", "matchmaking.html", "admin.html"];

for (const page of pages) {
  const source = await readFile(resolve(root, page), "utf8");
  const staticMarkup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const ids = [...staticMarkup.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `${page} contains duplicate IDs: ${duplicates.join(", ")}`);

  let inlineIndex = 0;
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || /type=["']application\/(?:ld\+)?json["']/.test(match[1])) continue;
    const code = match[2].trim();
    if (!code) continue;
    assert.doesNotThrow(() => new vm.Script(code, { filename: `${page}:inline-${++inlineIndex}` }), `${page} inline JavaScript must parse`);
  }
}

const products = await readFile(resolve(root, "products.html"), "utf8");
const companies = await readFile(resolve(root, "companies.html"), "utf8");
const marketplaceProducts = await readFile(resolve(root, "marketplace-products.js"), "utf8");
const marketplaceCompanies = await readFile(resolve(root, "marketplace-companies.js"), "utf8");

for (const asset of ["marketplace-enterprise.css", "marketplace-domain.js", "marketplace-products.js"]) {
  assert.match(products, new RegExp(asset.replace(".", "\\.")), `products.html must load ${asset}`);
}
for (const asset of ["marketplace-enterprise.css", "marketplace-domain.js", "marketplace-companies.js"]) {
  assert.match(companies, new RegExp(asset.replace(".", "\\.")), `companies.html must load ${asset}`);
}
assert.match(marketplaceProducts, /data-mh-horizontal-table/, "comparison must opt into the horizontally scrollable table mode");
assert.match(marketplaceProducts, /Duplicate recipients were removed/, "multi-company RFQ must communicate recipient deduplication");
assert.match(marketplaceCompanies, /get_my_followed_company_ids/, "company following must load user-scoped state");
assert.match(marketplaceCompanies, /mh_marketplace_return/, "signed-out follow must preserve the return page");

console.log(`Marketplace page parse and duplicate-ID checks passed for ${pages.length} root pages.`);

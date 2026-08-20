import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/migrations/202608170002_company_contact_privacy.sql",
);
const adminHotfix = read(
  "supabase/migrations/202608200001_company_contact_privacy_admin_access_hotfix.sql",
);
const companiesHtml = read("companies.html");
const companiesController = read("marketplace-companies.js");
const productsController = read("marketplace-products.js");
const portal = read("portal.html");
const admin = read("admin.html");
const reactApi = read(
  "apps/portal-react/src/features/company-profile/api/company-profile-api.ts",
);
const opportunitiesApi = read(
  "apps/portal-react/src/features/opportunities/api/opportunities-api.ts",
);
const publicSearch = [
  read("medichall-navigation.js"),
  read("medichall-assistant.js"),
  read("index.html"),
].join("\n");

for (const marker of [
  "get_public_companies_v1",
  "get_my_company_private_v1",
  "get_admin_companies_private_v1",
  "company_owner_authorized_v1",
  "redact_public_contact_text_v1",
]) {
  assert.ok(migration.includes(marker), `missing company privacy contract: ${marker}`);
}
assert.match(
  migration,
  /revoke select \([\s\S]*contact_email,[\s\S]*phone,[\s\S]*\) on table public\.companies from public, anon, authenticated;/,
  "historical browser column grants must be revoked explicitly",
);
assert.match(
  migration,
  /grant select \([\s\S]*name,[\s\S]*slug,[\s\S]*\) on table public\.companies to anon, authenticated;/,
  "safe company relationships must remain available",
);
const publicDtoSql = migration.slice(
  migration.indexOf("create or replace function public.get_public_companies_v1"),
  migration.indexOf("create or replace function public.get_my_company_private_v1"),
);
assert.doesNotMatch(
  publicDtoSql,
  /company\.(?:phone|contact_email|owner_id)/,
  "public DTO must not select private company fields",
);
assert.match(
  publicDtoSql,
  /redact_public_contact_text_v1\(company\.description\)/,
  "public description must be contact-redacted server-side",
);
assert.match(
  publicDtoSql,
  /redact_public_contact_text_v1\(company\.certifications\)/,
  "public certification text must be contact-redacted server-side",
);

const publicCompanySources = [companiesHtml, companiesController].join("\n");
assert.doesNotMatch(
  publicCompanySources,
  /companies\?select=[^"'\n]*(?:phone|contact_email|owner_id|description|certifications)/,
  "directory/showroom must not query raw private or free-text company columns",
);
assert.doesNotMatch(
  companiesHtml,
  /c\.phone|<span class="k">Phone<\/span>/,
  "public showroom must not render a phone row",
);
assert.match(
  companiesHtml,
  /Send a message via MedicHall/,
  "public contact coordinates must be replaced by an existing platform CTA",
);
assert.match(
  companiesController,
  /rpc\/get_public_companies_v1/,
  "canonical company directory must use the allowlisted public DTO",
);
assert.doesNotMatch(
  companiesController,
  /contactPoint|telephone|email:/,
  "company Organization JSON-LD must not introduce private contacts",
);

assert.doesNotMatch(
  productsController,
  /companies\([^)]*(?:phone|contact_email|owner_id|description|certifications)/,
  "product/company embedding must contain safe relationship fields only",
);
assert.match(
  productsController,
  /rpc\/get_public_companies_v1/,
  "product catalog must source sanitized public certifications from the DTO",
);
assert.doesNotMatch(
  publicSearch,
  /companies\?select=[^"'`\n]*(?:phone|contact_email|owner_id|description|certifications)/,
  "global search and homepage company queries must remain allowlisted",
);

for (const source of [portal, reactApi, opportunitiesApi]) {
  assert.match(
    source,
    /rpc\/get_my_company_private_v1/,
    "own-company profile management must use the private owner RPC",
  );
}
assert.match(
  portal,
  /Private contact email \(account and admin only\)/,
  "owner UI must explain contact privacy",
);
assert.match(
  admin,
  /rpc\/get_admin_companies_private_v1/,
  "admin company operations must use the existing admin boundary",
);
assert.match(
  adminHotfix,
  /owner manage own products[\s\S]*company_owner_authorized_v1\(company_id\)/,
  "product ownership policy must use the privileged owner/admin helper",
);
assert.match(
  adminHotfix,
  /owner read own rfq[\s\S]*company_owner_authorized_v1\(company_id\)/,
  "RFQ ownership policy must use the privileged owner/admin helper",
);
assert.doesNotMatch(
  adminHotfix,
  /grant select[\s\S]*public\.companies/i,
  "Admin recovery must not restore broad company SELECT grants",
);

for (const path of [
  "supabase/functions/product-profile/index.ts",
  "supabase/functions/ted-notice-resolver/index.ts",
]) {
  const source = read(path);
  assert.match(
    source,
    /company_owner_authorized_v1/,
    `${path} must not depend on browser-readable owner_id`,
  );
}

console.log(
  "Company contact privacy static regression: PASS (public DTO, browser grants, own/admin access, directory/showroom/product/search/JSON-LD)",
);

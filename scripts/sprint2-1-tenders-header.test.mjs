import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const tenders = read("tenders.html");
const tenderRuntime = read("tenders.js");
const navigation = read("medichall-navigation.js");
const design = read("medichall-design-system.css");
const portal = read("portal.html");
const migrationPath = "supabase/migrations/202608080001_universal_tender_import_reissue.sql";
const migration = read(migrationPath);
const rootPages = [
  "index.html",
  "products.html",
  "companies.html",
  "tenders.html",
  "matchmaking.html",
  "portal.html",
  "admin.html",
];

test("dedicated Tenders page uses the canonical public architecture", () => {
  assert.match(tenders, /<title>Medical Tenders — MedicHall<\/title>/);
  assert.match(tenders, /<medichall-header mode="public" active="tenders">/);
  assert.match(tenders, /id="main-content"/);
  assert.match(tenders, /medichall-design-system\.css\?v=20260809s22rc1/);
  assert.match(tenders, /medichall-session\.js\?v=20260809s22rc1/);
  assert.match(tenders, /medichall-navigation\.js\?v=20260809s22rc1/);
  assert.match(tenders, /tenders\.js\?v=20260809s22rc1/);
  for (const id of [
    "tenderFilters",
    "tenderSearch",
    "tenderCountry",
    "tenderCpv",
    "tenderDeadline",
    "tenderNoticeType",
    "tenderActiveFilters",
    "tenderPersonalization",
    "tenderList",
  ]) {
    assert.match(tenders, new RegExp(`id="${id}"`));
  }
  assert.match(tenders, /aria-live="polite"/);
  assert.match(tenders, /@media\(max-width:900px\)/);
  assert.match(tenders, /@media\(max-width:680px\)/);
});

test("Tenders navigation never falls back to the homepage anchor", () => {
  assert.doesNotMatch(navigation, /index\.html#tenders/);
  assert.equal((navigation.match(/\["tenders", "Tenders", "tenders\.html"\]/g) || []).length, 4);
  assert.doesNotMatch(read("index.html"), /href="#tenders"/);
});

test("public tender discovery stays separate from private workspace actions", () => {
  assert.match(tenderRuntime, /rpc\/search_tenders/);
  assert.match(tenderRuntime, /rpc\/tender_filter_facets/);
  assert.match(tenderRuntime, /session\?\.hasStoredSession\(\)/);
  assert.match(tenderRuntime, /opportunity_matches\?select=id,tender_id,match_score,status/);
  assert.match(tenderRuntime, /rpc\/set_opportunity_match_status/);
  assert.match(tenderRuntime, /portal\.html#opportunities/);
  assert.match(tenderRuntime, /No private data was requested or changed/);
  assert.doesNotMatch(tenderRuntime, /get_tender_document_analysis_progress/);
  assert.doesNotMatch(tenderRuntime, /queue_tender_document_analysis/);
  assert.doesNotMatch(tenderRuntime, /service_role/);
  assert.doesNotMatch(tenderRuntime, /PGRST\d+/);
});

test("header switches before search and navigation intrinsic widths collide", () => {
  assert.match(design, /grid-template-columns: auto minmax\(160px, 270px\) minmax\(0, 1fr\) auto/);
  assert.match(design, /@media \(max-width: 1240px\)/);
  assert.match(design, /\.mh-primary-nav \{[\s\S]*?display: none;/);
  assert.match(design, /\.mh-menu-button \{ display: inline-grid; \}/);
  assert.doesNotMatch(design, /Marketplace[^\n]*display:\s*none/i);
});

test("root pages use only the audited release cache versions", () => {
  const versions = new Set();
  for (const page of rootPages) {
    const source = read(page);
    for (const match of source.matchAll(/(?:src|href)="[^"]+\?v=([^"']+)/g)) versions.add(match[1]);
  }
  assert.deepEqual([...versions].sort(), ["20260809s22rc1", "20260810beta1", "20260811tax1", "20260813growth1", "20260813seo1", "20260813traffic1", "20260813video1"].sort());
});

test("Universal Tender Import is reissued once after the current production head", () => {
  const current = readdirSync("supabase/migrations").filter((name) => name.includes("universal_tender_import"));
  assert.deepEqual(current, ["202608080001_universal_tender_import_reissue.sql"]);
  assert.match(migration, /^-- MedicHall Universal Tender Import production reissue/);
  assert.match(migration, /begin;[\s\S]*create table if not exists public\.tender_imports/);
  assert.match(migration, /tender_imports_company_idempotency_unique/);
  assert.match(migration, /storage\.objects\.name/);
  assert.match(migration, /public\.get_universal_tender_imports\(/);
  assert.match(migration, /public\.list_stale_tender_import_orphans\(/);
  assert.match(migration, /notify pgrst, 'reload schema';\s*\n\s*commit;\s*$/);
  assert.match(portal, /db\("rpc\/get_universal_tender_imports", \{[\s\S]*?p_company_id: COMPANY\.id/);
});

test("immutable archived Module 1 sources retain their audited hashes", () => {
  const hash = (path) => createHash("sha256").update(read(path)).digest("hex");
  assert.equal(hash("supabase/migration-archive/universal-tender-import/202607290001_universal_tender_import.sql"), "57978a29937d21e2ecd1d95eeab4ecbda0e5c78c6c03800438f296f83eaf77ac");
  assert.equal(hash("supabase/migration-archive/universal-tender-import/202607290002_universal_tender_import_hardening.sql"), "85f3581131f3ba49d078492af68f2704649399cb53e92a81d9845d6a5ab782f7");
});

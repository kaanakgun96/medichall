import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const admin = read("admin.html");
const migration = read("supabase/migrations/202608090005_admin_growth_dashboard.sql");
const handoff = read("docs/final-beta-security-hardening-2026-08-10.md");

test("discoverable admin route keeps a server-authorized deny-by-default boundary", () => {
  assert.match(admin, /name="robots" content="noindex,nofollow"/);
  assert.match(admin, /rpc\/is_admin/);
  assert.match(admin, /allowed!==true/);
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_admin\(\)/i);
  assert.match(migration, /revoke all on function public\.get_admin_growth_dashboard_v1/i);
  assert.doesNotMatch(migration, /grant execute[^;]+\bto anon\b/is);
});

test("admin errors are bounded and MFA cannot be represented as active before owner enrollment", () => {
  assert.match(admin, /Invalid email or password\./);
  assert.doesNotMatch(admin, /user not found|email does not exist/i);
  assert.match(handoff, /Admin TOTP enforcement is \*\*not active\*\*/);
  assert.match(handoff, /real owner scan and verify/i);
  assert.match(handoff, /assurance level 2/i);
});

test("cPanel guidance covers required headers and keeps CSP report-only", () => {
  for (const header of [
    "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options",
    "Referrer-Policy", "Content-Security-Policy-Report-Only",
  ]) assert.match(handoff, new RegExp(header));
  assert.match(handoff, /azdmuarzntzqdyirysux\.supabase\.co/);
  assert.match(handoff, /https:\/\/\*\.daily\.co/);
  assert.match(handoff, /https:\/\/www\.youtube\.com/);
  assert.match(handoff, /https:\/\/player\.vimeo\.com/);
  assert.match(handoff, /Do not convert CSP to enforcement on the first upload/);
});

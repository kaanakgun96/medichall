import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const admin = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const portal = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/202608090005_admin_growth_dashboard.sql", import.meta.url),
  "utf8",
);

test("dashboard is admin-only, bounded and range constrained", () => {
  assert.match(migration, /auth\.uid\(\) is null or not public\.is_admin\(\)/i);
  assert.match(migration, /range_days not in \(0, 7, 30, 90\)/i);
  assert.match(migration, /least\(coalesce\(p_company_limit, 200\), 500\)/i);
  assert.match(migration, /revoke all on function public\.get_admin_growth_dashboard_v1/i);
  assert.doesNotMatch(migration, /grant execute[^;]+\bto anon\b/is);
});

test("overview, funnel, health and company operations use actual records", () => {
  for (const marker of [
    "total_companies", "active_companies", "tender_analyses", "tender_imports",
    "profile_completed", "first_product", "first_match_viewed",
    "first_connection_sent", "first_tender_viewed", "first_rfq",
    "meeting_booked", "rfq_response_rate", "tender_analysis_usage",
    "onboarding_incomplete", "no_products", "inactive_7d",
    "high_tender_unopened", "connection_unanswered", "rfq_unanswered",
  ]) assert.match(migration, new RegExp(`'${marker}'`));
  assert.doesNotMatch(migration, /random\(|Math\.random|placeholder/i);
});

test("last-active heartbeat is self-scoped and non-blocking", () => {
  assert.match(migration, /user_id uuid primary key references auth\.users\(id\)/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /values \(\s*auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /record_user_activity_v1\(\s*p_user/i);
  assert.match(portal, /startPortalActivityHeartbeat\(\)/);
  assert.match(portal, /setInterval\(recordPortalActivity, 5 \* 60 \* 1000\)/);
  assert.match(portal, /Activity telemetry is best-effort and must never block portal use/);
});

test("admin UI exposes every required range and operational section", () => {
  for (const days of [7, 30, 90, 0]) {
    assert.match(admin, new RegExp(`data-days="${days}"`));
  }
  for (const label of [
    "Growth overview", "Activation funnel", "Company engagement",
    "Companies needing attention", "Opportunity and platform health",
  ]) assert.match(admin, new RegExp(label, "i"));
  assert.match(admin, /get_admin_growth_dashboard_v1/);
  assert.match(admin, /MedicHall does not contact anyone automatically/);
});

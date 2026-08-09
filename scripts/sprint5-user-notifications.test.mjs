import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portal = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../supabase/migrations/202608090004_user_retention_notifications.sql", import.meta.url),
  "utf8",
);
const edge = readFileSync(
  new URL("../supabase/functions/user-notifications/index.ts", import.meta.url),
  "utf8",
);
const helper = readFileSync(
  new URL("../supabase/functions/_shared/user-notifications.ts", import.meta.url),
  "utf8",
);
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const cron = readFileSync(new URL("../supabase/setup/CONFIGURE-CRON.sql", import.meta.url), "utf8");

test("all Sprint 5 event contracts have durable mappings", () => {
  for (const event of [
    "NEW_TENDER_MATCH",
    "HIGH_TENDER_MATCH",
    "NEW_COMPANY_MATCH",
    "CONNECTION_REQUEST",
    "CONNECTION_ACCEPTED",
    "NEW_RFQ",
    "NEW_MESSAGE",
    "MEETING_REQUEST",
    "MEETING_CONFIRMED",
    "IMPORT_COMPLETE",
    "TENDER_DEADLINE_APPROACHING",
    "WEEKLY_DIGEST",
  ]) {
    assert.match(migration, new RegExp(`'${event}'`), `${event} missing from migration`);
    assert.match(helper, new RegExp(`${event}`), `${event} missing from email helper`);
  }
});

test("outbox is private, idempotent, leased and retryable", () => {
  assert.match(migration, /force row level security/i);
  assert.match(migration, /notification_id bigint not null unique/i);
  assert.match(migration, /idempotency_key text not null unique/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /status = 'suppressed'/i);
  assert.match(migration, /preference_disabled/i);
  assert.match(migration, /max_attempts integer not null default 6/i);
});

test("email delivery stays server-side and uses provider idempotency", () => {
  assert.match(edge, /x-cron-secret/);
  assert.match(edge, /constantTimeEqual/);
  assert.match(helper, /Idempotency-Key/);
  assert.match(helper, /RESEND_API_KEY/);
  assert.doesNotMatch(portal, /RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(helper, /provider_message_id_redacted/);
  assert.doesNotMatch(edge, /console\.(?:info|error)\([^\n]*recipient/i);
});

test("preference UI exposes all five requested controls", () => {
  for (const id of [
    "pnPrefRfq",
    "pnPrefTender",
    "pnPrefMatchmaking",
    "pnPrefMeeting",
    "pnPrefDigest",
  ]) assert.match(portal, new RegExp(`id="${id}"`));
  assert.match(portal, /get_user_notification_preferences/);
  assert.match(portal, /update_user_notification_preferences/);
  assert.match(portal, /p_timezone:mmTimezone\(\)/);
});

test("weekly digest uses actual platform counts and a strongest opportunity", () => {
  for (const field of [
    "new_tender_matches",
    "new_company_matches",
    "new_rfqs",
    "upcoming_meetings",
    "strongest_opportunity",
  ]) assert.match(migration, new RegExp(`'${field}'`));
  assert.match(helper, /Strongest current opportunity/);
  assert.match(helper, /match_score/);
  assert.match(helper, /deadline_at/);
});

test("deadline alerts are limited to 7, 3 and 1 day dedupe buckets", () => {
  assert.match(migration, /in \(7,3,1\)/);
  assert.match(migration, /'tender-deadline:' \|\| deadline_match\.opportunity_id/);
  assert.match(migration, /tender\.deadline_at::date - current_date/);
});

test("only the new function is added to the cron contract", () => {
  assert.match(config, /\[functions\.user-notifications\]\s*\nverify_jwt = false/);
  assert.match(cron, /medichall-user-notifications/);
  assert.match(cron, /\/functions\/v1\/user-notifications/);
  assert.match(cron, /medichall_project_url/);
  assert.match(cron, /medichall_cron_secret/);
  assert.doesNotMatch(cron, /Bearer\s+[A-Za-z0-9._-]{20,}/);
});

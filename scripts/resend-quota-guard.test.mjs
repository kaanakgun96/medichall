import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202608130003_resend_quota_guard.sql",
    import.meta.url,
  ),
  "utf8",
);
const retentionMigration = readFileSync(
  new URL(
    "../supabase/migrations/202608090004_user_retention_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);

test("tender matches remain in-app and do not project individual email", () => {
  assert.doesNotMatch(migration, /when 'tender_match(?:_high)?' then/i);
  assert.match(migration, /when 'weekly_digest' then 'WEEKLY_DIGEST'/);
  assert.match(
    migration,
    /when 'tender_deadline_7d' then 'TENDER_DEADLINE_APPROACHING'/,
  );
});

test("only unsent tender backlog is suppressed without deleting evidence", () => {
  assert.match(
    migration,
    /event_type in \('NEW_TENDER_MATCH', 'HIGH_TENDER_MATCH'\)[\s\S]*status in \('pending', 'retry'\)/,
  );
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+public\.user_notification_email_outbox/i,
  );
});

test("quota errors receive bounded six-hour deferral", () => {
  assert.match(
    migration,
    /safe_error_code = 'resend_http_429' then 21600/,
  );
  assert.match(migration, /least\(21600, greatest\(/);
});

test("permanent provider errors become terminal", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.match(migration, new RegExp(`'resend_http_${status}'`));
  }
  assert.match(migration, /when permanent_failure[\s\S]*then 'failed'/);
});

test("weekly digest stays idempotent and recipient scoped", () => {
  assert.match(
    retentionMigration,
    /'weekly-digest:' \|\| digest_week \|\| ':' \|\| due_preference\.user_id/,
  );
  assert.match(
    retentionMigration,
    /next_digest_at = now\(\) \+ interval '7 days'/,
  );
});

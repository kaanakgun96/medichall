import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const digest = readFileSync(
  new URL("../supabase/functions/tender-digest/index.ts", import.meta.url),
  "utf8",
);
const digestHelper = readFileSync(
  new URL(
    "../supabase/functions/_shared/saved-search-digest.ts",
    import.meta.url,
  ),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202608130004_email_security_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);

test("saved-search digest sends a bounded hashed provider key", () => {
  assert.match(digest, /sendSavedSearchDigest/);
  assert.match(digestHelper, /"Idempotency-Key": idempotencyKey/);
  assert.match(digestHelper, /saved-search-digest\/\$\{/);
  assert.match(digestHelper, /payload_sha256/);
  assert.doesNotMatch(digest, /body\.slice\(0, 160\)/);
});

test("saved-search service RPCs become service-only", () => {
  for (
    const signature of [
      "digest_due_saved_searches\\(\\)",
      "mark_saved_search_digested\\(bigint\\[\\]\\)",
    ]
  ) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated`,
        "i",
      ),
    );
  }
});

test("all canonical RFQ direct-email templates use shared escaping", () => {
  for (
    const functionName of [
      "trg_rfq_created",
      "trg_message_created",
      "trg_offer_created",
    ]
  ) {
    const start = migration.indexOf(
      `create or replace function public.${functionName}()`,
    );
    assert.notEqual(start, -1, `${functionName} definition`);
    const end = migration.indexOf("$function$;", start);
    const definition = migration.slice(start, end);
    assert.match(definition, /email_escape_html/);
    assert.match(definition, /email_safe_subject/);
    assert.doesNotMatch(definition, /\|\|\s*new\.(?:message|body)\s*\|\|/);
  }
});

test("RFQ links remain static MedicHall portal URLs", () => {
  assert.match(migration, /public\.mh_site_url\(\) \|\| '\/portal\.html/);
  assert.doesNotMatch(
    migration,
    /href=.*new\.(?:website|url|link)/i,
  );
});

test("retired one-off RFQ setup scripts cannot reintroduce raw templates", () => {
  for (
    const path of [
      "../supabase-admin-notify.sql",
      "../supabase-email-privacy-fixed.sql",
      "../supabase-rfq2-setup.sql",
    ]
  ) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /202608130004_email_security_hardening/);
    assert.match(source, /email_escape_html/);
    assert.match(source, /email_safe_subject/);
    assert.doesNotMatch(
      source,
      /\|\|\s*new\.(?:message|body|company|moq|lead_time)\s*\|\|/,
    );
  }
});

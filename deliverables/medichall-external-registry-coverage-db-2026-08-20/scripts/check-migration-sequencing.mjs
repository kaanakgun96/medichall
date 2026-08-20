import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repositoryRoot, path), "utf8");
const fail = (message) => {
  throw new Error(message);
};
const sha256 = (path) => createHash("sha256").update(read(path)).digest("hex");

const sequence = JSON.parse(
  read("supabase/observability/production-migration-sequence.json"),
);
const migrationFiles = readdirSync(join(repositoryRoot, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationVersions = migrationFiles.map((file) => file.slice(0, 12));

if (sequence.branch !== "react-migration") {
  fail("production sequence manifest targets the wrong branch");
}
if (sequence.production_project_ref !== "azdmuarzntzqdyirysux") {
  fail("production sequence manifest targets the wrong project");
}
if (new Set(migrationVersions).size !== migrationVersions.length) {
  fail("canonical migration versions are not unique");
}

const archivedVersions = new Set();
for (const archived of sequence.archived_unapplied) {
  archivedVersions.add(archived.version);
  if (sha256(archived.path) !== archived.sha256) {
    fail(`archived migration hash changed: ${archived.path}`);
  }
  if (migrationVersions.includes(archived.version)) {
    fail(`archived migration returned to the production chain: ${archived.version}`);
  }
}

for (const version of sequence.verified_remote_versions) {
  if (!migrationVersions.includes(version)) {
    fail(`verified production migration is missing locally: ${version}`);
  }
}
for (const version of sequence.verified_definition_drift) {
  if (!migrationVersions.includes(version)) {
    fail(`definition-drift migration is missing locally: ${version}`);
  }
}

const compatibilityVersion = sequence.compatibility_migration.slice(0, 12);
const notificationVersion = sequence.notification_migration.slice(0, 12);
const plannedForwardMigrations = sequence.planned_forward_migrations ?? [];
for (const file of [
  sequence.compatibility_migration,
  sequence.notification_migration,
  ...plannedForwardMigrations,
]) {
  if (!migrationFiles.includes(file)) fail(`required migration is missing: ${file}`);
}
if (compatibilityVersion <= notificationVersion) {
  fail("compatibility migration is not forward-only after the current latest version");
}

const expectedCanonicalVersions = new Set([
  ...sequence.verified_remote_versions,
  ...sequence.verified_definition_drift,
  notificationVersion,
  compatibilityVersion,
  ...plannedForwardMigrations.map((file) => file.slice(0, 12)),
]);
if (
  migrationVersions.length !== expectedCanonicalVersions.size ||
  migrationVersions.some((version) => !expectedCanonicalVersions.has(version))
) {
  fail("canonical production migration set differs from the audited sequence");
}

for (const file of plannedForwardMigrations) {
  if (file.slice(0, 12) <= compatibilityVersion) {
    fail(`planned forward migration is not after compatibility: ${file}`);
  }
}

const compatibilitySql = read(
  `supabase/migrations/${sequence.compatibility_migration}`,
);
for (const forbidden of [
  "create table public.tender_imports",
  "create_universal_tender_import",
  "universal-tender-imports",
]) {
  if (compatibilitySql.toLowerCase().includes(forbidden)) {
    fail(`compatibility migration contains Module 1 object: ${forbidden}`);
  }
}
for (const required of [
  "medichall_resend_api_key",
  "p_company_id bigint",
  "production_compatibility_migration",
  "content_sha256, live_verification_status, and live_verified_at are retained",
]) {
  if (!compatibilitySql.includes(required)) {
    fail(`compatibility contract marker is missing: ${required}`);
  }
}

const hypotheticalApplied = new Set([
  ...sequence.verified_remote_versions,
  ...sequence.allowed_history_repairs_after_compatibility_verification,
  compatibilityVersion,
]);
const hypotheticalPending = migrationFiles.filter(
  (file) => !hypotheticalApplied.has(file.slice(0, 12)),
);
if (
  JSON.stringify(hypotheticalPending) !==
    JSON.stringify(sequence.expected_target_only_dry_run)
) {
  fail(
    `post-compatibility sequence would propose: ${hypotheticalPending.join(", ")}`,
  );
}

if (
  sequence.allowed_history_repairs_after_compatibility_verification.some(
    (version) => archivedVersions.has(version),
  )
) {
  fail("an absent or archived migration is incorrectly eligible for ledger repair");
}

console.log(
  `Migration sequencing: PASS (${migrationFiles.length} canonical, ` +
    `${sequence.archived_unapplied.length} immutable archived, ` +
    `${hypotheticalPending.length} target pending after gated reconciliation)`,
);

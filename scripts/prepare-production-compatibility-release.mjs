import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output");
if (outputFlag < 0 || !process.argv[outputFlag + 1]) {
  throw new Error("usage: prepare-production-compatibility-release.mjs --output <new-directory>");
}

const outputRoot = resolve(process.argv[outputFlag + 1]);
const relativeOutput = relative(repositoryRoot, outputRoot);
if (!relativeOutput.startsWith("..") || outputRoot === repositoryRoot) {
  throw new Error("release output must be outside the repository");
}
if (existsSync(outputRoot)) {
  throw new Error("release output already exists; choose a new empty path");
}

const git = (...args) => execFileSync("git", args, {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "react-migration") {
  throw new Error("release preparation is restricted to react-migration");
}
if (git("status", "--porcelain")) {
  throw new Error("release preparation requires a clean worktree");
}
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/react-migration")) {
  throw new Error("local and origin/react-migration must match");
}

const sequencePath = join(
  repositoryRoot,
  "supabase/observability/production-migration-sequence.json",
);
const sequence = JSON.parse(readFileSync(sequencePath, "utf8"));
const canonicalDirectory = join(repositoryRoot, "supabase/migrations");
const canonicalFiles = readdirSync(canonicalDirectory)
  .filter((file) => file.endsWith(".sql"));
const releaseFiles = sequence.verified_remote_versions.map((version) => {
  const matches = canonicalFiles.filter((file) => file.startsWith(`${version}_`));
  if (matches.length !== 1) {
    throw new Error(`expected one canonical migration for ${version}`);
  }
  return matches[0];
});
releaseFiles.push(sequence.compatibility_migration);

for (const forbidden of [
  ...sequence.verified_definition_drift.map((version) => `${version}_`),
  ...sequence.archived_unapplied.map((entry) => `${entry.version}_`),
  `${sequence.notification_migration.slice(0, 12)}_`,
]) {
  if (releaseFiles.some((file) => file.startsWith(forbidden))) {
    throw new Error(`targeted release contains forbidden pending version ${forbidden}`);
  }
}

const releaseSupabase = join(outputRoot, "supabase");
const releaseMigrations = join(releaseSupabase, "migrations");
mkdirSync(releaseMigrations, { recursive: true, mode: 0o700 });
copyFileSync(
  join(repositoryRoot, "supabase/config.toml"),
  join(releaseSupabase, "config.toml"),
);
for (const file of releaseFiles) {
  copyFileSync(join(canonicalDirectory, file), join(releaseMigrations, file));
  chmodSync(join(releaseMigrations, file), 0o600);
}

const releaseEvidence = {
  branch: sequence.branch,
  production_project_ref: sequence.production_project_ref,
  source_commit: git("rev-parse", "HEAD"),
  included_migrations: releaseFiles,
  expected_dry_run: [sequence.compatibility_migration],
  excluded_pending_versions: [
    ...sequence.verified_definition_drift,
    ...sequence.archived_unapplied.map((entry) => entry.version),
    sequence.notification_migration.slice(0, 12),
  ],
};
writeFileSync(
  join(outputRoot, "RELEASE-EVIDENCE.json"),
  `${JSON.stringify(releaseEvidence, null, 2)}\n`,
  { mode: 0o600 },
);
chmodSync(join(releaseSupabase, "config.toml"), 0o600);

console.log(
  `Prepared ${releaseFiles.length} migration files; dry-run target: ` +
    sequence.compatibility_migration,
);
console.log(outputRoot);

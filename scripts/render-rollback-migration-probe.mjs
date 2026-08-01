import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFlag = process.argv.indexOf("--source");
const outputFlag = process.argv.indexOf("--output");
if (
  sourceFlag < 0 || outputFlag < 0 ||
  !process.argv[sourceFlag + 1] || !process.argv[outputFlag + 1]
) {
  throw new Error(
    "usage: render-rollback-migration-probe.mjs --source <migration> --output <new-file>",
  );
}

const source = resolve(repositoryRoot, process.argv[sourceFlag + 1]);
const output = resolve(process.argv[outputFlag + 1]);
if (!relative(repositoryRoot, source).startsWith("supabase/migrations/")) {
  throw new Error("probe source must be a canonical repository migration");
}
if (!relative(repositoryRoot, output).startsWith("..")) {
  throw new Error("probe output must be outside the repository");
}
if (existsSync(output)) {
  throw new Error("probe output already exists; choose a new path");
}

const migration = readFileSync(source, "utf8");
const beginMatches = migration.match(/^begin;$/gim) ?? [];
const commitMatches = migration.match(/^commit;$/gim) ?? [];
if (beginMatches.length !== 1 || commitMatches.length !== 1) {
  throw new Error("migration must contain exactly one outer begin and commit");
}

const rollbackProbe = migration.replace(/^commit;$/im, "rollback;");
writeFileSync(output, rollbackProbe, { mode: 0o600 });
chmodSync(output, 0o600);
console.log(output);

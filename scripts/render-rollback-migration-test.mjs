import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const migrationPath = argument("--migration");
const testPath = argument("--test");
const outputPath = argument("--output");
if (!migrationPath || !testPath || !outputPath) {
  throw new Error(
    "usage: render-rollback-migration-test.mjs --migration <migration> --test <sql-test> --output <new-file>",
  );
}

const migration = resolve(repositoryRoot, migrationPath);
const test = resolve(repositoryRoot, testPath);
const output = resolve(outputPath);
if (!relative(repositoryRoot, migration).startsWith("supabase/migrations/")) {
  throw new Error("migration must be a canonical repository migration");
}
if (!relative(repositoryRoot, test).startsWith("supabase/tests/")) {
  throw new Error("test must be a canonical repository SQL regression");
}
if (!relative(repositoryRoot, output).startsWith("..")) {
  throw new Error("output must be outside the repository");
}
if (existsSync(output)) {
  throw new Error("output already exists; choose a new path");
}

const migrationSql = readFileSync(migration, "utf8");
const testSql = readFileSync(test, "utf8");
if ((migrationSql.match(/^begin;$/gim) ?? []).length !== 1 ||
  (migrationSql.match(/^commit;$/gim) ?? []).length !== 1) {
  throw new Error("migration must contain one outer begin and commit");
}
if ((testSql.match(/^begin;$/gim) ?? []).length !== 1 ||
  (testSql.match(/^rollback;$/gim) ?? []).length !== 1) {
  throw new Error("SQL test must contain one outer begin and rollback");
}

const combined = `${migrationSql.replace(/^commit;$/im, "")}
\n-- Exact regression follows inside the migration transaction.\n
${testSql.replace(/^begin;$/im, "").replace(/^rollback;$/im, "")}
\nrollback;\n`;
writeFileSync(output, combined, { mode: 0o600 });
chmodSync(output, 0o600);
console.log(output);

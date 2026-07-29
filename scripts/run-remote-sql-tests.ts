// deno-lint-ignore no-import-prefix
import postgres from "npm:postgres@3.4.7";

const productionProjectRef = "azdmuarzntzqdyirysux";
const projectRef = Deno.env.get("MEDICHALL_TEST_PROJECT_REF")?.trim();
const password = Deno.env.get("MEDICHALL_TEST_DB_PASSWORD");
const host = (
  Deno.env.get("MEDICHALL_TEST_DB_HOST") ??
    "aws-0-ap-southeast-1.pooler.supabase.com"
).trim();

if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
  throw new Error("MEDICHALL_TEST_PROJECT_REF must be a Supabase project ref");
}
if (projectRef === productionProjectRef) {
  throw new Error("Remote SQL regressions refuse the production project");
}
if (!password) {
  throw new Error("MEDICHALL_TEST_DB_PASSWORD is required");
}
if (!host.endsWith(".pooler.supabase.com")) {
  throw new Error("MEDICHALL_TEST_DB_HOST must be a Supabase pooler host");
}

const testDirectory = new URL("../supabase/tests/", import.meta.url);
const testFiles: string[] = [];

for await (const entry of Deno.readDir(testDirectory)) {
  if (entry.isFile && entry.name.endsWith(".sql")) {
    testFiles.push(entry.name);
  }
}
testFiles.sort();

const database = postgres({
  host,
  port: 5432,
  database: "postgres",
  username: `postgres.${projectRef}`,
  password,
  ssl: "require",
  max: 1,
  prepare: false,
  connection: {
    application_name: "medichall-baseline-sql-regression",
  },
});

try {
  for (const testFile of testFiles) {
    const source = await Deno.readTextFile(new URL(testFile, testDirectory));
    try {
      await database.unsafe(source);
      console.log(`PASS ${testFile}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${testFile}: ${message}`);
      if (error && typeof error === "object") {
        const diagnostic = error as Record<string, unknown>;
        for (const field of ["code", "detail", "hint", "where"]) {
          if (typeof diagnostic[field] === "string") {
            console.error(`  ${field}: ${diagnostic[field]}`);
          }
        }
      }
      Deno.exitCode = 1;
      break;
    }
  }
} finally {
  await database.end({ timeout: 5 });
}

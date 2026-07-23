import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function repositoryPath(path) {
  return join(repositoryRoot, path);
}

function read(path) {
  return readFileSync(repositoryPath(path), "utf8");
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(repositoryPath(path))).digest("hex");
}

function walk(path) {
  const absolutePath = repositoryPath(path);
  return readdirSync(absolutePath).flatMap((entry) => {
    const child = join(absolutePath, entry);
    if (statSync(child).isDirectory()) {
      return walk(relative(repositoryRoot, child));
    }
    return [relative(repositoryRoot, child)];
  });
}

const currentBranch = execFileSync(
  "git",
  ["rev-parse", "--abbrev-ref", "HEAD"],
  { cwd: repositoryRoot, encoding: "utf8" },
).trim();
check(
  currentBranch === "react-migration",
  `expected branch react-migration, found ${currentBranch}`,
);

const migrationFiles = readdirSync(repositoryPath("supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationVersions = new Map();
for (const file of migrationFiles) {
  const match = file.match(/^(\d{12})_[a-z0-9_]+\.sql$/);
  check(Boolean(match), `invalid migration filename: ${file}`);
  if (!match) continue;
  const files = migrationVersions.get(match[1]) ?? [];
  files.push(file);
  migrationVersions.set(match[1], files);
}
for (const [version, files] of migrationVersions) {
  check(
    files.length === 1,
    `duplicate migration version ${version}: ${files.join(", ")}`,
  );
}

check(
  !migrationFiles.includes("202607100005_match_engine_v2_scoring.sql"),
  "former duplicate 202607100005 scoring file is still in migrations",
);
check(
  !migrationFiles.includes("202607100006_ted_cron.sql"),
  "former duplicate 202607100006 cron file is still in migrations",
);
check(
  existsSync(repositoryPath(
    "supabase/migration-archive/202607100005_match_engine_v2_scoring.sql",
  )),
  "archived 202607100005 scoring source is missing",
);
check(
  read("supabase/migrations/202607100005_explainable_match_engine.sql")
    .includes("create or replace function public.keyword_text_score"),
  "canonical 202607100005 migration is missing the consolidated scoring block",
);

const deployment = JSON.parse(
  read("supabase/observability/phase-zero-deployment.json"),
);
check(
  deployment.branch === "react-migration",
  "Phase 0 deployment manifest targets the wrong branch",
);
check(
  deployment.migration ===
    "supabase/migrations/202607230001_matching_phase_zero_observability.sql",
  "Phase 0 deployment manifest targets an unexpected migration",
);
check(
  deployment.runtime?.supabase_js === "2.110.8",
  "Phase 0 deployment manifest has an unexpected Supabase client version",
);
for (const runtimeInput of [
  deployment.runtime?.deno_config,
  deployment.runtime?.deno_lock,
]) {
  check(Boolean(runtimeInput?.path), "Phase 0 runtime input path is missing");
  if (!runtimeInput?.path) continue;
  check(
    existsSync(repositoryPath(runtimeInput.path)),
    `missing runtime input: ${runtimeInput.path}`,
  );
  if (!existsSync(repositoryPath(runtimeInput.path))) continue;
  check(
    sha256(runtimeInput.path) === runtimeInput.sha256,
    `hash mismatch for runtime input ${runtimeInput.path}`,
  );
}
const denoLock = JSON.parse(read("supabase/functions/deno.lock"));
check(
  denoLock.specifiers?.["npm:@supabase/supabase-js@2.110.8"] === "2.110.8",
  "Deno lockfile does not pin @supabase/supabase-js 2.110.8",
);

const expectedFunctions = new Map([
  ["ted-sync", false],
  ["ted-notice-resolver", true],
  ["tender-attachment-discovery", true],
  ["tender-archive-worker", true],
  ["tender-document-engine", true],
]);
check(
  deployment.functions.length === expectedFunctions.size,
  "Phase 0 deployment manifest has an unexpected function count",
);

for (const entry of deployment.functions) {
  check(
    expectedFunctions.has(entry.name),
    `unexpected Phase 0 function: ${entry.name}`,
  );
  check(
    entry.verify_jwt === expectedFunctions.get(entry.name),
    `unexpected verify_jwt value for ${entry.name}`,
  );
  check(
    entry.entrypoint === `supabase/functions/${entry.name}/index.ts`,
    `Phase 0 function must use the root entrypoint: ${entry.name}`,
  );
  check(existsSync(repositoryPath(entry.entrypoint)), `missing ${entry.entrypoint}`);

  const source = read(entry.entrypoint);
  check(
    source.includes('npm:@supabase/supabase-js@2.110.8'),
    `${entry.entrypoint} does not pin @supabase/supabase-js`,
  );
  check(
    !source.includes('npm:@supabase/supabase-js@2"'),
    `${entry.entrypoint} contains a floating @supabase/supabase-js import`,
  );
  if (source.includes("EdgeRuntime.")) {
    check(
      source.includes('reference path="../_shared/edge-runtime.d.ts"'),
      `${entry.entrypoint} uses EdgeRuntime without the shared declaration`,
    );
  }
}

const manifest = JSON.parse(
  read("supabase/observability/pipeline-versions.json"),
);
const phaseZeroMigration = read(
  "supabase/migrations/202607230001_matching_phase_zero_observability.sql",
);
const backendV2 = JSON.parse(
  read("supabase/observability/backend-v2-deployment.json"),
);
const supersededPhaseZeroSources = new Set([
  ...backendV2.functions.map((entry) => entry.entrypoint),
  ...backendV2.shared_sources.map((entry) => entry.path),
]);
for (const version of manifest.versions) {
  for (const [sourcePath, expectedHash] of Object.entries(version.sources)) {
    check(existsSync(repositoryPath(sourcePath)), `missing version source: ${sourcePath}`);
    if (!existsSync(repositoryPath(sourcePath))) continue;
    if (!supersededPhaseZeroSources.has(sourcePath)) {
      const actualHash = sha256(sourcePath);
      check(
        actualHash === expectedHash,
        `hash mismatch for ${sourcePath}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
    check(
      phaseZeroMigration.includes(expectedHash),
      `Phase 0 migration does not record the manifest hash for ${sourcePath}`,
    );
  }
}

check(
  backendV2.branch === "react-migration",
  "Backend v2 deployment manifest targets the wrong branch",
);
check(
  JSON.stringify(backendV2.migrations) === JSON.stringify([
    "supabase/migrations/202607230002_document_intelligence_v2.sql",
    "supabase/migrations/202607230003_match_score_v2.sql",
  ]),
  "Backend v2 deployment manifest has an unexpected migration scope",
);
const expectedV2Functions = new Map([
  ["tender-attachment-discovery", true],
  ["tender-document-engine", true],
]);
check(
  backendV2.functions.length === expectedV2Functions.size,
  "Backend v2 deployment manifest has an unexpected function count",
);
for (const entry of backendV2.functions) {
  check(
    expectedV2Functions.has(entry.name),
    `unexpected Backend v2 function: ${entry.name}`,
  );
  check(
    entry.verify_jwt === expectedV2Functions.get(entry.name),
    `unexpected Backend v2 verify_jwt value for ${entry.name}`,
  );
  check(
    entry.entrypoint === `supabase/functions/${entry.name}/index.ts`,
    `Backend v2 function must use the root entrypoint: ${entry.name}`,
  );
  check(
    sha256(entry.entrypoint) === entry.sha256,
    `Backend v2 function hash mismatch: ${entry.entrypoint}`,
  );
}
for (const source of backendV2.shared_sources) {
  check(existsSync(repositoryPath(source.path)), `missing Backend v2 source: ${source.path}`);
  if (!existsSync(repositoryPath(source.path))) continue;
  check(
    sha256(source.path) === source.sha256,
    `Backend v2 source hash mismatch: ${source.path}`,
  );
}
const backendV2Text = JSON.stringify(backendV2);
check(
  !/[A-Z_]+_SHA256/.test(backendV2Text),
  "Backend v2 deployment manifest contains an unresolved hash placeholder",
);
for (const migration of backendV2.migrations) {
  const content = read(migration);
  check(
    !/[A-Z_]+_SHA256/.test(content),
    `${migration} contains an unresolved hash placeholder`,
  );
}
const matchScoreV2 = JSON.parse(
  read("supabase/observability/match-score-v2.json"),
);
check(
  matchScoreV2.components.reduce(
    (total, component) => total + Number(component.weight || 0),
    0,
  ) === 100,
  "Match Score v2 component weights must total 100",
);
check(
  matchScoreV2.activation?.maximum_company_batch === 100,
  "Match Score v2 maximum company batch must remain 100",
);

const activeSqlInputs = [
  ...walk("supabase/migrations"),
  ...walk("supabase/setup"),
].filter((path) => path.endsWith(".sql"));
const forbiddenSqlPatterns = [
  [/\bBURAYA_CRON_SECRET_YAZ\b/, "cron placeholder"],
  [/\bCRON_SECRET_INI_YAZ\b/, "cron placeholder"],
  [
    /https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\//i,
    "project-specific Edge Function URL",
  ],
  [
    /['"]x-cron-secret['"]\s*,\s*['"][^'"]+['"]/i,
    "literal x-cron-secret value",
  ],
];
for (const path of activeSqlInputs) {
  const content = read(path);
  for (const [pattern, label] of forbiddenSqlPatterns) {
    check(!pattern.test(content), `${path} contains a ${label}`);
  }
}

const documentationInputs = walk("docs").filter((path) => path.endsWith(".md"));
for (const path of documentationInputs) {
  const content = read(path);
  check(
    !/\bBURAYA_CRON_SECRET_YAZ\b|\bCRON_SECRET_INI_YAZ\b/.test(content),
    `${path} instructs operators to substitute a credential literal`,
  );
  check(
    !/select\s+command\s+from\s+cron\.job/i.test(content),
    `${path} instructs operators to recover a credential from cron.job`,
  );
}

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repositoryRoot, encoding: "utf8" },
).split("\0").filter(Boolean);
const probableSecretPatterns = [
  [
    new RegExp(`${["github", "pat"].join("_")}[A-Za-z0-9_]{20,}`, "g"),
    "GitHub token",
  ],
  [new RegExp(`${["ghp", ""].join("_")}[A-Za-z0-9]{20,}`, "g"), "GitHub token"],
  [new RegExp(`${["sk", "ant"].join("-")}-[A-Za-z0-9_-]{20,}`, "g"), "AI key"],
  [
    /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?(?!<|\$\{)[A-Za-z0-9._-]{20,}/g,
    "Supabase service-role value",
  ],
];
for (const path of repositoryFiles) {
  const absolutePath = repositoryPath(path);
  if (!existsSync(absolutePath) || statSync(absolutePath).size > 2_000_000) continue;
  const content = readFileSync(absolutePath, "utf8");
  for (const [pattern, label] of probableSecretPatterns) {
    check(!pattern.test(content), `${path} contains a probable ${label}`);
    pattern.lastIndex = 0;
  }
}

const config = read("supabase/config.toml");
for (const [name, verifyJwt] of expectedFunctions) {
  const escapedName = name.replaceAll("-", "\\-");
  const blockPattern = new RegExp(
    `\\[functions\\.${escapedName}\\][\\s\\S]*?verify_jwt\\s*=\\s*${verifyJwt}(?:\\s|$)`,
  );
  check(blockPattern.test(config), `supabase/config.toml is missing ${name} JWT policy`);
}

if (failures.length > 0) {
  console.error("Phase 0 repository readiness: FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Phase 0 repository readiness: PASSED (${migrationFiles.length} unique migrations, ` +
    `${deployment.functions.length} canonical functions, hashes verified)`,
);

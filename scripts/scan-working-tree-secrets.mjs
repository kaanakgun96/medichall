import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const detectors = [
  [/\bre_[A-Za-z0-9_-]{20,}\b/g, "provider-token"],
  [/\b(?:sk|rk)-(?:live|prod|test)-[A-Za-z0-9_-]{16,}\b/g, "api-key"],
  [/\b(?:sk-ant|sk-proj)-[A-Za-z0-9_-]{16,}\b/g, "api-key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "github-token"],
  [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    "private-key",
  ],
  [/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/g, "database-password"],
  [
    /["']Authorization["']\s*[:,]\s*["']Bearer\s+[A-Za-z0-9._-]{20,}["']/gi,
    "bearer-literal",
  ],
];

const trackedAndUntracked = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean);

const findings = [];
let scannedFiles = 0;

for (const file of trackedAndUntracked) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;
  scannedFiles += 1;

  for (const [pattern, detector] of detectors) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) findings.push({ file, detector });
  }

  for (
    const match of source.matchAll(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    )
  ) {
    try {
      const payload = JSON.parse(
        Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"),
      );
      if (payload.role === "service_role") {
        findings.push({ file, detector: "service-role-jwt" });
      }
    } catch {
      // A JWT-shaped test string with an invalid payload is not a credential.
    }
  }
}

if (findings.length) {
  console.error(JSON.stringify(findings, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `PASS secret scan: ${scannedFiles} text files, no credential literals`,
  );
}

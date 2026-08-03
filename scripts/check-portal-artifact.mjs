import { readFileSync } from "node:fs";

const source = readFileSync("portal.html", "utf8");
const inlineScripts = [
  ...source.matchAll(
    /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
  ),
].map((match) => match[1]).filter((script) => script.trim());

for (const [index, script] of inlineScripts.entries()) {
  try {
    new Function(script);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`portal inline script ${index + 1}: ${message}`);
  }
}

const staticMarkup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const staticIds = [
  ...staticMarkup.matchAll(/\bid=["']([^"']+)["']/gi),
].map((match) => match[1]);
const duplicateIds = [...new Set(
  staticIds.filter((id, index) => staticIds.indexOf(id) !== index),
)];

if (duplicateIds.length) {
  throw new Error(`duplicate portal IDs: ${duplicateIds.join(", ")}`);
}

const loginContracts = [
  ["bounded authentication request", "async function fetchWithTimeout"],
  ["bounded post-login initialization", "POST_LOGIN_TIMEOUT_MS"],
  ["awaited post-login flow", "await finishAuthenticatedEntry();"],
  ["post-login homepage fallback", "location.assign(target);"],
];

for (const [label, contract] of loginContracts) {
  if (!source.includes(contract)) {
    throw new Error(`missing ${label}: ${contract}`);
  }
}

if (/LOGIN_REDIRECT\s*=\s*true;\s*enterApp\(\);/.test(source)) {
  throw new Error("login still starts the post-login flow without awaiting it");
}

console.log(
  `PASS portal artifact: ${inlineScripts.length} inline scripts, ` +
    `${staticIds.length} unique static IDs`,
);

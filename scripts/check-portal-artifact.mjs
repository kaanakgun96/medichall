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

console.log(
  `PASS portal artifact: ${inlineScripts.length} inline scripts, ` +
    `${staticIds.length} unique static IDs`,
);

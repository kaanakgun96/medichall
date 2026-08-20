import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/202608170001_ted_canonical_lots.sql",
);
const canonical = read("supabase/functions/_shared/ted-canonical-lots.ts");
const engine = read("supabase/functions/tender-document-engine/handler.ts");
const sync = read("supabase/functions/ted-sync/index.ts");
const matching = read("supabase/functions/_shared/lot-matching-v1.ts");
const portal = read("portal.html");

for (const marker of [
  "tender_canonical_lots",
  "tender_canonical_lot_revisions",
  "tender_document_chunk_lot_mappings",
  "replace_ted_canonical_lots_v1",
  "get_tender_canonical_lots_v1",
  "LOT_STRUCTURE_PENDING",
  "TED_STRUCTURED",
]) {
  assert.ok(migration.includes(marker), `missing migration contract: ${marker}`);
}

assert.match(
  migration,
  /revoke all on function public\.replace_ted_canonical_lots_v1[\s\S]+from public, anon, authenticated;/,
  "authoritative replacement RPC must be service-only",
);
assert.match(
  migration,
  /unique \(tender_id, official_lot_identifier\)/,
  "canonical identity must be idempotent per tender",
);
assert.match(
  canonical,
  /internal_identifier_alias/,
  "official internal identifiers must be deterministic aliases",
);
assert.match(
  canonical,
  /rejected_phantom_lot_references/,
  "unrecognized inferred identifiers must be rejected",
);
assert.doesNotMatch(
  canonical,
  /api[_-]?key|anthropic|openai/i,
  "canonical TED lookup must not invoke a paid AI provider",
);

assert.match(
  engine,
  /fetchTedCanonicalNotice/,
  "document processing must fetch official structure before reconciliation",
);
assert.match(
  sync,
  /parseTedCanonicalNotice/,
  "TED sync must parse canonical structure from its official Search API response",
);
assert.match(
  sync,
  /canonical_lot_reconcile/,
  "a known notice must have a bounded zero-AI production reconciliation path",
);
assert.match(
  sync,
  /provider_calls:\s*0/,
  "the exact-notice correction path must not invoke a paid provider",
);
for (const source of [engine, sync]) {
  assert.match(
    source,
    /markTedLotStructurePending/,
    "TED ingestion paths must fail closed to pending structure",
  );
}

assert.match(
  engine,
  /reconcileAnalysisToCanonicalLots/,
  "document extraction must enrich the canonical list",
);
assert.match(
  engine,
  /persistChunkLotMappings/,
  "chunk mapping category and scope must be persisted",
);
assert.match(
  matching,
  /canonical_only_lots/,
  "lot scoring must recognize canonical-only input",
);

for (const marker of [
  "canonical_lot_count",
  "lot_structure_status",
  "tenderDisplayLots",
  "tenderLotStructureNotice",
]) {
  assert.ok(portal.includes(marker), `portal canonical lot UI missing: ${marker}`);
}
assert.doesNotMatch(
  portal,
  /tenderDisplayLots\([^)]*\)\.slice\(0,\s*(?:7|20|30)\)/,
  "canonical lot cards must not be silently truncated",
);

console.log(
  "TED canonical lot static regression: PASS (official authority, pending fallback, deterministic mapping, complete UI projection)",
);

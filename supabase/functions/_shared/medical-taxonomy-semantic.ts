export type MedicalTaxonomyCandidate = {
  id: number;
  canonical_name: string;
  parent_name?: string | null;
  node_type: "family" | "category" | "product_type";
};

export type MedicalTaxonomySemanticSuggestion = {
  canonical_taxonomy_id: number | null;
  canonical_name: string | null;
  confidence: number;
  confidence_band: "high" | "medium" | "low";
  reasoning: string;
  source_text: string;
  decision: "recommend" | "ask_user" | "keep_custom";
};

function boundedText(value: unknown, limit: number): string {
  return String(value ?? "").replaceAll("\u0000", "").replace(/\s+/g, " ")
    .trim().slice(0, limit);
}

function jsonObject(raw: string): Record<string, unknown> {
  const cleaned = boundedText(raw, 8_000)
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_TAXONOMY_PROVIDER_JSON");
  }
  return parsed as Record<string, unknown>;
}

export function buildMedicalTaxonomySemanticPrompt(
  sourceText: string,
  candidates: MedicalTaxonomyCandidate[],
): string {
  const source = boundedText(sourceText, 500);
  if (source.length < 2) throw new Error("INVALID_TAXONOMY_SOURCE_TEXT");
  if (!candidates.length || candidates.length > 40) {
    throw new Error("INVALID_TAXONOMY_CANDIDATES");
  }
  return JSON.stringify({
    task: "Select at most one existing MedicHall medical-product taxonomy node.",
    rules: [
      "Never create or rename a taxonomy node.",
      "Return null when the supplied product meaning is insufficient or unrelated.",
      "Use concise, user-visible evidence; do not return hidden reasoning.",
      "Return JSON only.",
    ],
    output_schema: {
      canonical_taxonomy_id: "number|null",
      canonical_name: "string|null",
      confidence: "number from 0 to 1",
      reasoning: "concise user-visible reason",
      source_text: source,
    },
    source_text: source,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      canonical_name: candidate.canonical_name,
      parent_name: candidate.parent_name ?? null,
      node_type: candidate.node_type,
    })),
  });
}

export function parseMedicalTaxonomySemanticSuggestion(
  raw: string,
  sourceText: string,
  candidates: MedicalTaxonomyCandidate[],
): MedicalTaxonomySemanticSuggestion {
  const parsed = jsonObject(raw);
  const source = boundedText(sourceText, 500);
  const candidateId = parsed.canonical_taxonomy_id == null
    ? null
    : Number(parsed.canonical_taxonomy_id);
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("INVALID_TAXONOMY_PROVIDER_CONFIDENCE");
  }
  const candidate = candidateId == null
    ? null
    : candidates.find((item) => item.id === candidateId) ?? null;
  if (candidateId != null && !candidate) {
    throw new Error("UNKNOWN_TAXONOMY_PROVIDER_NODE");
  }
  const providerName = boundedText(parsed.canonical_name, 160);
  if (candidate && providerName !== candidate.canonical_name) {
    throw new Error("MISMATCHED_TAXONOMY_PROVIDER_NAME");
  }
  const reasoning = boundedText(parsed.reasoning, 360) ||
    "No reliable semantic category evidence was returned.";
  const confidenceBand = confidence >= .9 && candidate
    ? "high"
    : confidence >= .65 && candidate
    ? "medium"
    : "low";
  return {
    canonical_taxonomy_id: confidenceBand === "low" ? null : candidate!.id,
    canonical_name: confidenceBand === "low" ? null : candidate!.canonical_name,
    confidence,
    confidence_band: confidenceBand,
    reasoning,
    source_text: source,
    decision: confidenceBand === "high"
      ? "recommend"
      : confidenceBand === "medium"
      ? "ask_user"
      : "keep_custom",
  };
}

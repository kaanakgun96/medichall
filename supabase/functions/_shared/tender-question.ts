export type TenderQuestionSource = {
  id: string;
  kind: "tender" | "evidence" | "lot" | "company_product" | "score";
  label: string;
  text: string;
  meta?: Record<string, unknown>;
};

export type GroundedTenderAnswer = {
  answer: string;
  uncertainty: string;
  citationIds: string[];
  citations: TenderQuestionSource[];
};

const STOP_WORDS = new Set([
  "about", "after", "also", "are", "can", "could", "does", "for", "from",
  "have", "how", "into", "our", "that", "the", "their", "this", "tender",
  "what", "when", "where", "which", "with", "would", "your",
]);

function boundedText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim()
    .slice(0, limit);
}

export function normalizeTenderQuestion(value: unknown): string {
  return boundedText(value, 600).normalize("NFKC").toLocaleLowerCase("en-US");
}

export function tenderQuestionTokens(value: unknown): string[] {
  return [...new Set(normalizeTenderQuestion(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))];
}

function sourceScore(question: string, source: TenderQuestionSource): number {
  const tokens = tenderQuestionTokens(question);
  const haystack = `${source.label} ${source.text}`.toLocaleLowerCase("en-US");
  let score = source.kind === "tender" ? 4 : 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 6 ? 5 : 3;
  }
  if (/lot|item|line/.test(question) && source.kind === "lot") score += 7;
  if (/quant|unit|amount|how many/.test(question) && /quant|unit|amount/.test(haystack)) score += 7;
  if (/cert|mdr|iso|ce\b/.test(question) && /cert|mdr|iso|ce\b/.test(haystack)) score += 7;
  if (/our product|we participate|current product|match/.test(question) &&
    ["company_product", "lot", "score"].includes(source.kind)) score += 6;
  return score;
}

export function rankTenderQuestionSources(
  question: string,
  sources: TenderQuestionSource[],
  maxSources = 28,
  maxCharacters = 16_000,
): TenderQuestionSource[] {
  const ranked = sources.map((source, index) => ({
    source: {
      ...source,
      id: boundedText(source.id, 100),
      label: boundedText(source.label, 240),
      text: boundedText(source.text, 1_200),
    },
    index,
    score: sourceScore(question, source),
  })).filter((item) => item.source.id && item.source.text)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: TenderQuestionSource[] = [];
  let characters = 0;
  for (const item of ranked) {
    if (selected.length >= Math.max(1, maxSources)) break;
    const next = item.source.label.length + item.source.text.length + 40;
    if (selected.length > 0 && characters + next > Math.max(1_000, maxCharacters)) continue;
    selected.push(item.source);
    characters += next;
  }
  return selected;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function stableTenderQuestionJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export async function tenderQuestionSha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const clean = boundedText(raw, 20_000)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const value = JSON.parse(clean);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_PROVIDER_JSON");
  }
  return value as Record<string, unknown>;
}

export function parseGroundedTenderAnswer(
  raw: string,
  sources: TenderQuestionSource[],
): GroundedTenderAnswer {
  const parsed = parseJsonObject(raw);
  let answer = boundedText(parsed.answer, 12_000);
  const uncertainty = boundedText(parsed.uncertainty, 1_200) ||
    "No additional uncertainty was stated; verify the cited tender evidence before acting.";
  if (!answer) throw new Error("EMPTY_PROVIDER_ANSWER");

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const requested = Array.isArray(parsed.citation_ids) ? parsed.citation_ids : [];
  const citationIds = [...new Set(requested.map((value) => boundedText(value, 100)))]
    .filter((id) => sourceById.has(id));
  if (!citationIds.length) throw new Error("UNGROUNDED_PROVIDER_ANSWER");

  const inline = [...answer.matchAll(/\[([^\]]{1,100})\]/g)]
    .flatMap((match) => match[1].split(/[\s,;]+/))
    .map((id) => boundedText(id, 100))
    .filter(Boolean);
  if (inline.some((id) => !sourceById.has(id))) {
    throw new Error("UNKNOWN_PROVIDER_CITATION");
  }
  if (!inline.length) answer += `\n\nEvidence: ${citationIds.map((id) => `[${id}]`).join(" ")}`;

  return {
    answer,
    uncertainty,
    citationIds,
    citations: citationIds.map((id) => sourceById.get(id) as TenderQuestionSource),
  };
}

export function estimateTenderQuestionCost(
  inputTokens: number,
  outputTokens: number,
  inputCostPerMillion: number,
  outputCostPerMillion: number,
): number {
  const cost = Math.max(0, inputTokens) / 1_000_000 * Math.max(0, inputCostPerMillion) +
    Math.max(0, outputTokens) / 1_000_000 * Math.max(0, outputCostPerMillion);
  return Number(cost.toFixed(6));
}

export function tenderQuestionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/^[A-Z0-9_]{3,100}$/.test(message)) return message;
  return "TENDER_ASK_FAILED";
}

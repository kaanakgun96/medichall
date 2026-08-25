import type { ProductFamilyProfile } from "./buyer-discovery-relevance-v2.ts";
import { validateProductSearchQuery } from "./website-product-discovery.ts";
import {
  buildUnmappedProductRetrievalPlan,
  normalizeRetrievalTerm,
} from "./unmapped-product-terminology.ts";

export type ResolutionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ResolutionTaxonomyNode = {
  id: number;
  parentId?: number | null;
  canonicalName: string;
  slug: string;
  nodeType: string;
  description?: string | null;
  aliases: string[];
  parentName?: string | null;
};

export type ProductResolutionSuggestion = {
  canonical_taxonomy_id: number;
  canonical_name: string;
  slug: string;
  node_type: string;
  confidence: number;
  confidence_label: ResolutionConfidence;
  reasoning: string;
  signal_sources: string[];
};

export type ProductResolution = {
  source_text: string;
  normalized_source_text: string;
  phrase_signature: string;
  resolution: "high_confidence" | "medium_confidence" | "unmapped";
  recommended: ProductResolutionSuggestion | null;
  alternatives: ProductResolutionSuggestion[];
  suggestions: ProductResolutionSuggestion[];
  search_anyway_allowed: boolean;
  temporary_intent_label: string;
  semantic_provider_used: false;
  provider_requests: 0;
  estimated_cost_usd: 0;
};

const SPELLING: Record<string, string> = Object.freeze({
  haemodialysis: "hemodialysis",
  haemofiltration: "hemofiltration",
  haemodynamic: "hemodynamic",
  anaesthesia: "anesthesia",
  anaesthetic: "anesthetic",
  paediatric: "pediatric",
  orthopaedic: "orthopedic",
  oesophageal: "esophageal",
  catalogue: "catalog",
});

const SAFE_SINGULARS: Record<string, string> = Object.freeze({
  sets: "set",
  kits: "kit",
  covers: "cover",
  sleeves: "sleeve",
  pouches: "pouch",
  gowns: "gown",
  devices: "device",
  pumps: "pump",
  bloodlines: "bloodline",
  catheters: "catheter",
  blankets: "blanket",
  drapes: "drape",
  cables: "cable",
  probes: "probe",
  dressings: "dressing",
  packs: "pack",
  needles: "needle",
  syringes: "syringe",
  masks: "mask",
  brushes: "brush",
  tapes: "tape",
  bags: "bag",
  circuits: "circuit",
  consumables: "consumable",
  accessories: "accessory",
  systems: "system",
  tubes: "tube",
  lines: "line",
  extensions: "extension",
  connectors: "connector",
  electrodes: "electrode",
  leads: "lead",
  sensors: "sensor",
  transducers: "transducer",
  trocars: "trocar",
  cannulas: "cannula",
  filters: "filter",
  caps: "cap",
  gloves: "glove",
  aprons: "apron",
  sponges: "sponge",
  pads: "pad",
  drains: "drain",
  reservoirs: "reservoir",
  collectors: "collector",
  meters: "meter",
  warmers: "warmer",
  implants: "implant",
  endoscopes: "endoscope",
  scopes: "scope",
  pencils: "pencil",
  sheaths: "sheath",
});

const MEDICAL_CONTEXT = new Set([
  "medical",
  "clinical",
  "surgical",
  "surgery",
  "sterile",
  "patient",
  "hospital",
  "therapy",
  "treatment",
  "dialysis",
  "hemodialysis",
  "hemofiltration",
  "extracorporeal",
  "arterial",
  "venous",
  "vascular",
  "cardiac",
  "cardiology",
  "blood",
  "bloodline",
  "ecg",
  "ekg",
  "electrocardiography",
  "defibrillator",
  "irrigation",
  "suction",
  "laparoscopy",
  "laparoscopic",
  "arthroscopy",
  "arthroscopic",
  "endoscopy",
  "endoscopic",
  "ultrasound",
  "sonography",
  "radiology",
  "imaging",
  "catheter",
  "cannula",
  "picc",
  "wound",
  "drainage",
  "drain",
  "anesthesia",
  "anesthetic",
  "respiratory",
  "ventilation",
  "breathing",
  "airway",
  "oxygen",
  "endotracheal",
  "infusion",
  "intravenous",
  "iv",
  "urology",
  "urinary",
  "urine",
  "urethral",
  "bladder",
  "orthopedic",
  "bone",
  "arthroplasty",
  "trauma",
  "warming",
  "diagnostic",
  "operating",
  "theatre",
  "procedure",
  "fluoroscopy",
  "microscope",
  "probe",
  "electrosurgical",
  "infection",
  "disinfection",
  "antiseptic",
  "scrub",
  "protective",
  "fluid",
]);

const PRODUCT_FORMS = new Set([
  "set",
  "kit",
  "device",
  "equipment",
  "cover",
  "sleeve",
  "drape",
  "pouch",
  "blanket",
  "gown",
  "bloodline",
  "pump",
  "catheter",
  "cannula",
  "tubing",
  "cable",
  "probe",
  "dressing",
  "pack",
  "needle",
  "syringe",
  "mask",
  "brush",
  "tape",
  "bag",
  "circuit",
  "consumable",
  "accessory",
  "implant",
  "instrument",
  "system",
  "sheath",
  "tube",
  "line",
  "extension",
  "connector",
  "electrode",
  "lead",
  "sensor",
  "transducer",
  "trocar",
  "filter",
  "cap",
  "glove",
  "apron",
  "sponge",
  "pad",
  "drain",
  "reservoir",
  "collector",
  "meter",
  "warmer",
  "cement",
  "scope",
  "endoscope",
  "pencil",
]);

// These nouns are sufficiently specific to medical products that an unknown
// brand/modifier does not need to supply a second domain token. This is a
// domain-admission signal only; it never creates taxonomy or evidence.
const STRONG_MEDICAL_PRODUCT_FORMS = new Set([
  "bloodline",
  "catheter",
  "cannula",
  "electrode",
  "endoscope",
  "syringe",
  "trocar",
]);

// Reviewed multi-word forms preserve bounded support for established medical
// commercial terminology without treating their individual generic nouns as
// universally medical. Other multi-word forms still work through the normal
// context + product-form rule (for example bone + mixing system).
const STRONG_MEDICAL_MULTIWORD_FORMS = [
  ["camera", "cover"],
  ["camera", "sleeve"],
  ["c", "arm", "cover"],
  ["c", "arm", "drape"],
] as const;

const GENERIC_ONLY = new Set([
  "medical",
  "clinical",
  "healthcare",
  "hospital",
  "patient",
  "sterile",
  "surgical",
  "product",
  "products",
  "device",
  "equipment",
  "solution",
  "system",
  "supply",
  "supplies",
  "consumable",
  "accessory",
]);

const CONNECTORS = new Set(["and", "for", "of", "the", "with"]);

const PROXY_COMMANDS = new Set([
  "buyer",
  "buyers",
  "company",
  "companies",
  "competitor",
  "competitors",
  "distributor",
  "distributors",
  "find",
  "manufacturer",
  "manufacturers",
  "research",
  "seller",
  "sellers",
  "supplier",
  "suppliers",
  "buy",
  "cheapest",
  "code",
  "execute",
  "ignore",
  "instruction",
  "instructions",
  "javascript",
  "online",
  "price",
  "prices",
  "write",
]);

function includesTokenSequence(
  tokens: string[],
  sequence: readonly string[],
): boolean {
  if (sequence.length > tokens.length) return false;
  for (let offset = 0; offset <= tokens.length - sequence.length; offset++) {
    if (sequence.every((token, index) => tokens[offset + index] === token)) {
      return true;
    }
  }
  return false;
}

function normalizedTokens(value: unknown): string[] {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe")
    .replace(/[đð]/g, "d").replace(/ı/g, "i").replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean).map((token) =>
      SAFE_SINGULARS[SPELLING[token] || token] || SPELLING[token] || token
    );
}

export function normalizeUnknownProductPhrase(value: unknown): string {
  return normalizedTokens(value).join(" ");
}

export function productPhraseSignature(value: unknown): string {
  return [
    ...new Set(
      normalizedTokens(value).filter((token) => !CONNECTORS.has(token)),
    ),
  ].sort().join(" ");
}

export function validateUnmappedMedicalProductPhrase(value: unknown): {
  displayPhrase: string;
  normalizedPhrase: string;
  phraseSignature: string;
} {
  const rawPhrase = String(value ?? "");
  if (
    rawPhrase.length > 160 || /[\u0000-\u001f\u007f]/u.test(rawPhrase)
  ) {
    throw new Error(
      "Enter a specific medical product name, not a general web-search request.",
    );
  }
  const displayPhrase = validateProductSearchQuery(value);
  const tokens = normalizedTokens(displayPhrase);
  const meaningful = tokens.filter((token) => !CONNECTORS.has(token));
  const hasMedicalContext = meaningful.some((token) =>
    MEDICAL_CONTEXT.has(token)
  );
  const hasProductForm = meaningful.some((token) => PRODUCT_FORMS.has(token));
  const hasStrongMedicalProductForm =
    meaningful.some((token) => STRONG_MEDICAL_PRODUCT_FORMS.has(token)) ||
    STRONG_MEDICAL_MULTIWORD_FORMS.some((sequence) =>
      includesTokenSequence(tokens, sequence)
    );
  const onlyGeneric = meaningful.every((token) => GENERIC_ONLY.has(token));
  const containsProxyCommand = meaningful.some((token) =>
    PROXY_COMMANDS.has(token)
  );
  if (
    meaningful.length < 1 || meaningful.length > 12 ||
    (meaningful.length === 1 && !hasStrongMedicalProductForm) || onlyGeneric ||
    containsProxyCommand || !hasProductForm ||
    (!hasMedicalContext && !hasStrongMedicalProductForm)
  ) {
    throw new Error(
      "Enter a specific medical product name, not a general web-search request.",
    );
  }
  return {
    displayPhrase,
    normalizedPhrase: tokens.join(" "),
    phraseSignature: productPhraseSignature(tokens.join(" ")),
  };
}

function tokenSimilarity(left: unknown, right: unknown): number {
  const a = new Set(
    normalizedTokens(left).filter((item) => !CONNECTORS.has(item)),
  );
  const b = new Set(
    normalizedTokens(right).filter((item) => !CONNECTORS.has(item)),
  );
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const coverage = intersection / Math.min(a.size, b.size);
  return Math.min(.99, (intersection / union) * .6 + coverage * .4);
}

function suggestionFor(
  node: ResolutionTaxonomyNode,
  confidence: number,
  confidenceLabel: ResolutionConfidence,
  signals: string[],
): ProductResolutionSuggestion {
  return {
    canonical_taxonomy_id: node.id,
    canonical_name: node.canonicalName,
    slug: node.slug,
    node_type: node.nodeType,
    confidence: Number(confidence.toFixed(4)),
    confidence_label: confidenceLabel,
    reasoning: confidenceLabel === "HIGH"
      ? "Strong deterministic canonical or approved-alias support."
      : "Multiple deterministic taxonomy and product-family signals support this suggestion; confirmation is required.",
    signal_sources: signals,
  };
}

export function resolveProductIntentDeterministically(
  queryValue: unknown,
  catalog: ResolutionTaxonomyNode[],
): ProductResolution {
  const sourceText = validateProductSearchQuery(queryValue);
  const normalized = normalizeUnknownProductPhrase(sourceText);
  const signature = productPhraseSignature(sourceText);
  const eligible = catalog.filter((node) =>
    Number.isSafeInteger(node.id) && node.nodeType !== "family"
  );
  for (const node of eligible) {
    const approved = [node.canonicalName, ...node.aliases];
    if (approved.some((term) => productPhraseSignature(term) === signature)) {
      const exact = suggestionFor(node, 1, "HIGH", [
        "canonical_or_approved_alias",
        "safe_term_normalization",
      ]);
      return {
        source_text: sourceText,
        normalized_source_text: normalized,
        phrase_signature: signature,
        resolution: "high_confidence",
        recommended: exact,
        alternatives: [],
        suggestions: [exact],
        search_anyway_allowed: true,
        temporary_intent_label: sourceText,
        semantic_provider_used: false,
        provider_requests: 0,
        estimated_cost_usd: 0,
      };
    }
  }

  const ranked = eligible.map((node) => {
    const lexical = Math.max(
      tokenSimilarity(sourceText, node.canonicalName),
      ...node.aliases.map((alias) => tokenSimilarity(sourceText, alias)),
    );
    const parent = node.parentName
      ? tokenSimilarity(sourceText, node.parentName)
      : 0;
    const description = node.description
      ? tokenSimilarity(sourceText, node.description)
      : 0;
    const signals = [
      lexical >= .52 ? "taxonomy_or_approved_alias_tokens" : "",
      parent >= .34 ? "parent_product_family" : "",
      description >= .38 ? "reviewed_taxonomy_description" : "",
    ].filter(Boolean);
    const score = Math.min(
      .94,
      lexical * .72 + parent * .18 + description * .1,
    );
    return { node, lexical, score, signals };
  }).filter((item) =>
    item.lexical >= .52 && item.score >= .5 && item.signals.length >= 2
  ).sort((left, right) =>
    right.score - left.score || right.signals.length - left.signals.length ||
    left.node.canonicalName.localeCompare(right.node.canonicalName)
  ).slice(0, 3).map((item) =>
    suggestionFor(
      item.node,
      item.score,
      item.score >= .82 ? "HIGH" : "MEDIUM",
      item.signals,
    )
  );

  let searchAnywayAllowed = false;
  try {
    validateUnmappedMedicalProductPhrase(sourceText);
    searchAnywayAllowed = true;
  } catch (_) {
    searchAnywayAllowed = false;
  }
  return {
    source_text: sourceText,
    normalized_source_text: normalized,
    phrase_signature: signature,
    resolution: ranked.length ? "medium_confidence" : "unmapped",
    recommended: ranked[0] || null,
    alternatives: ranked.slice(1),
    suggestions: ranked,
    search_anyway_allowed: searchAnywayAllowed,
    temporary_intent_label: sourceText,
    semantic_provider_used: false,
    provider_requests: 0,
    estimated_cost_usd: 0,
  };
}

export function buildTemporaryProductFamilyProfile(input: {
  phrase: unknown;
  intentHash: string;
}): ProductFamilyProfile {
  const safe = validateUnmappedMedicalProductPhrase(input.phrase);
  if (!/^[a-f0-9]{64}$/.test(input.intentHash)) {
    throw new Error("INVALID_TEMPORARY_INTENT_HASH");
  }
  const retrieval = buildUnmappedProductRetrievalPlan({
    originalPhrase: safe.displayPhrase,
    normalizedPhrase: safe.normalizedPhrase,
    phraseSignature: safe.phraseSignature,
  });
  return {
    key: `unmapped-${input.intentHash.slice(0, 24)}`,
    label: safe.displayPhrase,
    equipmentCoverKind: null,
    directTerms: retrieval.terms.map((term) =>
      normalizeRetrievalTerm(term.term)
    ),
    adjacentTerms: [],
    genericTerms: [
      "medical distributor",
      "medical wholesaler",
      "healthcare supplier",
      "medical device",
    ],
    mismatchTerms: [],
    componentFitLabel: null,
    temporaryIntent: {
      normalizedPhrase: safe.normalizedPhrase,
      phraseSignature: safe.phraseSignature,
      requiredTokens: safe.phraseSignature.split(" ").filter(Boolean),
      familySignature: retrieval.familySignature,
      retrievalTerms: retrieval.terms,
    },
  };
}

export function unmappedWebsiteProductSuggestions(
  signals: Array<{
    label: string;
    pageUrl: string;
    kind: string;
    strength: number;
  }>,
  mappedLabels: string[],
): Array<Record<string, unknown>> {
  const mapped = new Set(mappedLabels.map(normalizeUnknownProductPhrase));
  const output: Array<Record<string, unknown>> = [];
  for (const signal of [...signals].sort((a, b) => b.strength - a.strength)) {
    if (
      signal.strength < .82 ||
      !["schema_product", "heading", "product_link", "page_title"].includes(
        signal.kind,
      )
    ) continue;
    let safe;
    try {
      safe = validateUnmappedMedicalProductPhrase(signal.label);
    } catch (_) {
      continue;
    }
    if (
      mapped.has(safe.normalizedPhrase) ||
      output.some((item) => item.normalized_phrase === safe.normalizedPhrase)
    ) continue;
    output.push({
      resolution: "UNMAPPED",
      taxonomy_id: null,
      canonical_name: null,
      slug: null,
      confidence: "MEDIUM",
      confidence_score: Number(signal.strength.toFixed(4)),
      raw_website_label: safe.displayPhrase,
      normalized_phrase: safe.normalizedPhrase,
      source_pages: [signal.pageUrl],
      evidence: [{
        label: safe.displayPhrase,
        page_url: signal.pageUrl,
        kind: signal.kind,
      }],
      occurrence_count: 1,
      auto_selected: false,
    });
    if (output.length >= 3) break;
  }
  return output;
}

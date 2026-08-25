import type {
  ProspectCandidate,
  ProspectEvidence,
} from "./external-prospect-discovery.ts";

export type ProductEvidenceClass = "DIRECT" | "ADJACENT" | "GENERIC";

export type BuyerArchetype =
  | "DISTRIBUTOR"
  | "IMPORTER"
  | "KIT_ASSEMBLER"
  | "PROCEDURE_PACK_MANUFACTURER"
  | "OEM_PRIVATE_LABEL"
  | "MANUFACTURER"
  | "TENDER_SUPPLIER"
  | "UNKNOWN";

export type BuyerArchetypeSignal = {
  archetype: BuyerArchetype;
  strength: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
};

export type ProductFamilyTaxonomyNode = {
  taxonomyId?: number;
  canonicalName: string;
  slug: string;
  aliases?: string[];
  familyName?: string | null;
  familySlug?: string | null;
};

export type ProductRetrievalTerm = {
  term: string;
  normalizedTerm: string;
  language: string;
  countries: string[];
  confidence: "HIGH" | "MEDIUM";
  source:
    | "APPROVED_ALIAS"
    | "TED_TERMINOLOGY"
    | "VERIFIED_PRODUCT_TERMINOLOGY"
    | "DETERMINISTIC_VARIANT";
  reason: string;
  familySignature: string;
};

export type ProductFamilyProfile = {
  key: string;
  label: string;
  equipmentCoverKind?: EquipmentCoverProductKind | null;
  directTerms: string[];
  adjacentTerms: string[];
  genericTerms: string[];
  mismatchTerms: string[];
  componentFitLabel: string | null;
  temporaryIntent?: {
    normalizedPhrase: string;
    phraseSignature: string;
    requiredTokens: string[];
    familySignature: string;
    retrievalTerms: ProductRetrievalTerm[];
  } | null;
};

export type EquipmentCoverProductKind =
  | "camera"
  | "c_arm"
  | "microscope"
  | "equipment";

type ReviewedEquipmentCoverAliases = Record<
  EquipmentCoverProductKind,
  Record<string, readonly string[]>
>;

// Product terminology is reviewed and deterministic. These terms are shared
// by evidence classification and bounded public-web query generation; they
// are never generated or translated at runtime.
export const REVIEWED_EQUIPMENT_COVER_ALIASES: ReviewedEquipmentCoverAliases = {
  camera: {
    en: [
      "camera cover",
      "surgical camera cover",
      "sterile camera cover",
      "camera drape",
      "camera sleeve",
      "sterile camera sleeve",
      "endoscopic camera cover",
      "endoscopy camera cover",
      "video camera cover",
      "camera sheath",
      "sterile camera sheath",
      "camera protective cover",
      "camera equipment cover",
      "sterile camera drape",
      "surgical video camera cover",
      "sterile video camera sleeve",
    ],
    it: [
      "copri telecamera",
      "copertura telecamera",
      "guaina per telecamera",
      "copri videocamera",
    ],
    fr: [
      "housse caméra",
      "gaine caméra",
      "protection caméra stérile",
    ],
    es: [
      "funda de cámara",
      "cubierta de cámara",
      "funda estéril para cámara",
    ],
    de: [
      "Kameraabdeckung",
      "Kamerahülle",
      "sterile Kameraabdeckung",
    ],
    nl: ["camerahoes", "camera hoes", "steriele camerabescherming"],
  },
  c_arm: {
    en: [
      "c-arm cover",
      "c arm cover",
      "c-arm drape",
      "c arm drape",
      "c-arm equipment cover",
      "c-arm protective cover",
      "sterile c-arm cover",
      "sterile c-arm drape",
      "image intensifier cover",
      "image intensifier drape",
      "fluoroscopy equipment cover",
    ],
    it: ["copertura sterile arco a C", "telo arco a C"],
    fr: ["housse arceau chirurgical", "housse amplificateur de brillance"],
    es: [
      "funda estéril arco en C",
      "funda para arco en C",
      "fundas para arco en C",
    ],
    de: ["C-Bogen Abdeckung", "sterile C-Bogen Hülle"],
    nl: ["steriele C-boog hoes", "C-boog afdekhoes"],
  },
  microscope: {
    en: [
      "microscope cover",
      "microscope drape",
      "sterile microscope cover",
      "sterile microscope drape",
      "microscope sleeve",
      "surgical microscope cover",
      "surgical microscope drape",
      "operating microscope cover",
    ],
    it: ["copri microscopio", "telo sterile microscopio"],
    fr: ["housse microscope", "housse stérile microscope"],
    es: ["funda de microscopio", "cubierta estéril de microscopio"],
    de: ["Mikroskopabdeckung", "sterile Mikroskophülle"],
    nl: ["steriele microscoophoes", "microscoop afdekhoes"],
  },
  equipment: {
    en: [
      "sterile medical equipment cover",
      "sterile medical equipment covers",
      "surgical equipment drape",
      "surgical equipment drapes",
      "operating room equipment cover",
      "operating room equipment covers",
      "sterile equipment cover",
      "sterile equipment drape",
    ],
    it: ["copertura sterile apparecchiatura medica"],
    fr: ["housse stérile équipement médical"],
    es: ["funda estéril para equipo médico"],
    de: ["sterile Medizingeräteabdeckung"],
    nl: ["steriele hoes medische apparatuur"],
  },
};

export function reviewedEquipmentCoverTerms(
  kind: EquipmentCoverProductKind,
  language?: string,
): string[] {
  const groups = REVIEWED_EQUIPMENT_COVER_ALIASES[kind];
  return language
    ? [...(groups[language] || groups.en || [])]
    : Object.values(groups).flatMap((terms) => [...terms]);
}

export function reviewedEquipmentCoverDiscoveryTerms(
  kind: EquipmentCoverProductKind,
): string[] {
  const groups = REVIEWED_EQUIPMENT_COVER_ALIASES[kind];
  const representative = [
    ...(groups.en || []).slice(0, 3),
    ...["it", "fr", "es", "de", "nl"].flatMap((language) =>
      (groups[language] || []).slice(0, 1)
    ),
  ];
  return [
    ...new Set([
      ...representative,
      ...Object.values(groups).flatMap((terms) => [...terms]),
    ]),
  ];
}

export type CandidateCompatibility = {
  candidate: ProspectCandidate;
  directEvidence: ProspectEvidence[];
  adjacentEvidence: ProspectEvidence[];
  genericEvidence: ProspectEvidence[];
  directConceptCount: number;
  adjacentConceptCount: number;
  independentDirectSourceCount: number;
  independentAdjacentSourceCount: number;
  archetypes: BuyerArchetypeSignal[];
  commercialReason: string;
  classification:
    | "DIRECT_PRODUCT_FIT"
    | "ADJACENT_COMMERCIAL_FIT"
    | "GENERIC_ONLY"
    | "PRODUCT_FAMILY_MISMATCH";
  mismatch: boolean;
};

const COMMON_GENERIC_TERMS = [
  "medical distributor",
  "medical wholesaler",
  "healthcare supplier",
  "hospital supplier",
  "hospital equipment",
  "medical technology",
  "operating room technology",
  "surgical technology",
  "medical imaging",
  "radiology",
  "oncology",
  "medical device",
];

const GOWN_DIRECT_TERMS = [
  "sterile surgical gown",
  "surgical gown",
  "medical gown",
  "disposable surgical apparel",
  "sterile surgical apparel",
  "disposable clothing",
  "sterile clothing",
  // Bounded, reviewed European-language product phrases used by public
  // catalogues. They are product-family rules, not free-form translations.
  "camice chirurgico",
  "camici chirurgici",
  "bata quirurgica",
  "batas quirurgicas",
  "bata cirurgica",
  "batas cirurgicas",
  "blouse chirurgicale",
  "blouses chirurgicales",
  "operationsmantel",
  "op mantel",
  "fartuch chirurgiczny",
  "fartuchy chirurgiczne",
];

const GOWN_ADJACENT_TERMS = [
  "procedure pack",
  "procedure tray",
  "custom surgical pack",
  "custom procedure pack",
  "surgical pack",
  "surgical set",
  "surgical kit",
  "surgical drape",
  "operating room disposable",
  "or disposable",
  "nonwoven surgical product",
  "infection control apparel",
  "private label disposable",
  "oem disposable",
  "kit procedurali",
  "set procedurali",
  "kit chirurgici",
  "pack chirurgici",
  "teli chirurgici",
  "custom packs",
  "custom procedure trays",
  "op sets",
];

const EQUIPMENT_COVER_ADJACENT_TERMS = [
  "surgical drape",
  "operating room disposable",
  "or disposable",
  "imaging consumable",
  "imaging accessory",
  "radiology consumable",
  "interventional radiology consumable",
  "procedure pack",
  "surgical pack",
  "surgical kit",
  "custom pack",
  "disposable surgical product",
  "protective sterile sheath",
  "sterile accessory",
  "teleria chirurgica",
  "set procedurali",
];

const ULTRASOUND_DIRECT_TERMS = [
  "ultrasound probe cover",
  "ultrasound probe covers",
  "ultrasound transducer cover",
  "ultrasound transducer sheath",
  "probe sheath",
  "sterile probe cover",
  "protection sonde echographie",
  "fundas para sondas de ecografo",
];

const SCRUB_BRUSH_DIRECT_TERMS = [
  "surgical scrub brush",
  "scrub brush",
  "surgical hand brush",
  "preoperative scrub brush",
  "brosse chirurgicale",
];

function normalizeTerm(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueTerms(values: unknown[]): string[] {
  return [
    ...new Set(values.map(normalizeTerm).filter((value) => value.length >= 3)),
  ];
}

function containsTerm(text: string, term: string): boolean {
  if (!term) return false;
  if (text.includes(term)) return true;
  if (term.endsWith("s") && term.length > 4) {
    return text.includes(term.slice(0, -1));
  }
  return false;
}

function temporaryPhraseMatches(
  text: string,
  profile: ProductFamilyProfile,
): boolean {
  const temporary = profile.temporaryIntent;
  if (!temporary || temporary.requiredTokens.length < 2) return false;
  const singular = (token: string) =>
    token === "sets" || token === "kits"
      ? token.slice(0, -1)
      : token.endsWith("s") && token.length > 4
      ? token.slice(0, -1)
      : token;
  const evidenceTokens = new Set(
    normalizeTerm(text).split(" ").filter(Boolean)
      .map(singular),
  );
  const required = temporary.requiredTokens.map(singular);
  return required.every((token) => evidenceTokens.has(token));
}

function matchedTerms(text: string, terms: string[]): string[] {
  return terms.filter((term) => containsTerm(text, term));
}

function evidenceText(evidence: ProspectEvidence): string {
  return normalizeTerm(
    [
      evidence.title,
      evidence.snippet,
      evidence.lotContext,
    ].filter(Boolean).join(" "),
  );
}

function familyFlags(nodes: ProductFamilyTaxonomyNode[]): {
  gown: boolean;
  equipmentCoverKind: EquipmentCoverProductKind | null;
  ultrasound: boolean;
  scrubBrush: boolean;
} {
  const text = normalizeTerm(
    nodes.flatMap((node) => [
      node.canonicalName,
      node.slug,
      node.familyName,
      node.familySlug,
    ]).join(" "),
  );
  const equipmentCoverKind: EquipmentCoverProductKind | null =
    /camera cover/.test(text)
      ? "camera"
      : /\bc arm\b|image intensifier|fluoroscop.+cover/.test(text)
      ? "c_arm"
      : /microscope drape|microscope cover/.test(text)
      ? "microscope"
      : /equipment cover/.test(text)
      ? "equipment"
      : null;
  return {
    gown: /\bgowns?\b|surgical gowns apparel/.test(text),
    equipmentCoverKind,
    ultrasound: /ultrasound probe cover|transducer sheath/.test(text),
    scrubBrush: /scrub brush|surgical hand preparation/.test(text),
  };
}

export function buildProductFamilyProfile(
  nodes: ProductFamilyTaxonomyNode[],
): ProductFamilyProfile {
  const flags = familyFlags(nodes);
  const canonical = nodes.flatMap((node) => [
    node.canonicalName,
    ...(node.aliases || []),
  ]);
  const familyLabels = nodes.map((node) => node.familyName).filter(
    Boolean,
  ) as string[];
  const direct: string[] = [...canonical];
  const adjacent: string[] = [];
  const mismatch: string[] = [];
  let key = nodes.map((node) => node.slug).filter(Boolean).join("+") ||
    "medical-product";
  let equipmentCoverKind: EquipmentCoverProductKind | null = null;
  let componentFitLabel: string | null = null;
  if (flags.gown) {
    key = "surgical-gown-family";
    direct.push(...GOWN_DIRECT_TERMS);
    adjacent.push(...GOWN_ADJACENT_TERMS);
    mismatch.push(
      "surgical robot",
      "robotic surgery",
      "radiopharmaceutical",
      "medical imaging",
      "oncology technology",
      "capital equipment",
    );
    componentFitLabel = "Potential procedure-pack component buyer";
  }
  if (flags.equipmentCoverKind) {
    equipmentCoverKind = flags.equipmentCoverKind;
    key = `${flags.equipmentCoverKind.replace("_", "-")}-cover-family`;
    if (flags.equipmentCoverKind === "equipment") {
      direct.unshift(
        ...reviewedEquipmentCoverDiscoveryTerms("equipment"),
        ...reviewedEquipmentCoverDiscoveryTerms("camera"),
        ...reviewedEquipmentCoverDiscoveryTerms("c_arm"),
        ...reviewedEquipmentCoverDiscoveryTerms("microscope"),
      );
    } else {
      direct.unshift(
        ...reviewedEquipmentCoverDiscoveryTerms(flags.equipmentCoverKind),
      );
      adjacent.push(
        ...reviewedEquipmentCoverTerms("equipment"),
        ...(["camera", "c_arm", "microscope"] as const)
          .filter((kind) => kind !== flags.equipmentCoverKind)
          .flatMap((kind) => reviewedEquipmentCoverTerms(kind)),
      );
    }
    adjacent.push(...EQUIPMENT_COVER_ADJACENT_TERMS);
    mismatch.push(
      "imaging system",
      "imaging equipment",
      "c arm system",
      "microscope system",
      "surgical camera system",
      "capital equipment",
    );
    componentFitLabel = "Potential sterile equipment-cover component buyer";
  }
  if (flags.ultrasound) {
    key = "ultrasound-probe-cover-family";
    direct.push(...ULTRASOUND_DIRECT_TERMS);
    adjacent.push(
      "ultrasound consumable",
      "ultrasound accessory",
      "infection control ultrasound",
      "interventional ultrasound",
    );
  }
  if (flags.scrubBrush) {
    key = "surgical-scrub-brush-family";
    direct.push(...SCRUB_BRUSH_DIRECT_TERMS);
    adjacent.push(
      "surgical hand preparation",
      "infection control consumable",
      "operating room consumable",
      "procedure pack",
    );
    componentFitLabel = "Potential infection-control or procedure-pack buyer";
  }
  return {
    key,
    label: familyLabels[0] ||
      nodes.map((node) => node.canonicalName).join(", ") ||
      "Medical product",
    equipmentCoverKind,
    directTerms: uniqueTerms(direct),
    adjacentTerms: uniqueTerms(adjacent),
    genericTerms: uniqueTerms(COMMON_GENERIC_TERMS),
    mismatchTerms: uniqueTerms(mismatch),
    componentFitLabel,
  };
}

export function classifyEvidenceForProduct(
  evidence: ProspectEvidence,
  profile: ProductFamilyProfile,
): ProspectEvidence {
  const text = evidenceText(evidence);
  const direct = matchedTerms(text, profile.directTerms);
  const adjacent = matchedTerms(text, profile.adjacentTerms);
  let relevanceClass: ProductEvidenceClass = "GENERIC";
  let commercialReason = "General healthcare or company-activity context";
  const temporaryDirect = evidence.sourceType !== "PUBLIC_REGISTRY" &&
    temporaryPhraseMatches(text, profile);
  if (
    evidence.sourceType !== "PUBLIC_REGISTRY" &&
    (direct.length || temporaryDirect)
  ) {
    relevanceClass = "DIRECT";
    commercialReason = temporaryDirect
      ? "Direct verified phrase evidence for this temporary product intent"
      : `Direct product-family evidence: ${direct.slice(0, 3).join(", ")}`;
  } else if (evidence.sourceType !== "PUBLIC_REGISTRY" && adjacent.length) {
    relevanceClass = "ADJACENT";
    commercialReason = `Adjacent commercial evidence: ${
      adjacent.slice(0, 3).join(", ")
    }`;
  } else if (evidence.sourceType === "PUBLIC_REGISTRY") {
    commercialReason = "Official activity evidence supports company type only";
  }
  return {
    ...evidence,
    evidenceKind: relevanceClass === "DIRECT"
      ? "DIRECT_PRODUCT_EVIDENCE"
      : relevanceClass === "ADJACENT"
      ? "INDIRECT_COMMERCIAL_EVIDENCE"
      : "WEAK_CONTEXT",
    relevanceClass,
    matchedTerms: relevanceClass === "DIRECT"
      ? (direct.length
        ? direct
        : [profile.temporaryIntent?.normalizedPhrase || ""])
      : adjacent,
    commercialReason,
    taxonomyIds: relevanceClass === "GENERIC" ? [] : evidence.taxonomyIds,
  };
}

function deduplicateEvidence(evidence: ProspectEvidence[]): ProspectEvidence[] {
  const priority: Record<ProductEvidenceClass, number> = {
    DIRECT: 3,
    ADJACENT: 2,
    GENERIC: 1,
  };
  const bySource = new Map<string, ProspectEvidence>();
  for (const item of evidence) {
    const relevanceClass = item.relevanceClass || "GENERIC";
    const key = [
      item.sourceType,
      item.sourceUrl,
      item.noticeId || "",
    ].join("|");
    const previous = bySource.get(key);
    if (
      !previous ||
      priority[relevanceClass] >
        priority[previous.relevanceClass || "GENERIC"] ||
      (priority[relevanceClass] ===
          priority[previous.relevanceClass || "GENERIC"] &&
        item.confidence > previous.confidence)
    ) bySource.set(key, item);
  }
  return [...bySource.values()];
}

function relevantSourceKey(evidence: ProspectEvidence): string {
  return `${evidence.sourceType}:${evidence.sourceDomain}`;
}

function inferArchetypes(
  candidate: ProspectCandidate,
  evidence: ProspectEvidence[],
  profile: ProductFamilyProfile,
): BuyerArchetypeSignal[] {
  const compatible = evidence.filter((item) =>
    item.relevanceClass === "DIRECT" || item.relevanceClass === "ADJACENT"
  );
  if (!compatible.length) {
    return [{
      archetype: "UNKNOWN",
      strength: "LOW",
      reason:
        "No product-family buying model is supported by the available evidence.",
    }];
  }
  const text = normalizeTerm(
    [
      candidate.description,
      candidate.companyType,
      ...compatible.flatMap((
        item,
      ) => [item.title, item.snippet, item.commercialReason]),
    ].filter(Boolean).join(" "),
  );
  const output: BuyerArchetypeSignal[] = [];
  const add = (
    archetype: BuyerArchetype,
    strength: BuyerArchetypeSignal["strength"],
    reason: string,
  ) => {
    if (!output.some((item) => item.archetype === archetype)) {
      output.push({ archetype, strength, reason });
    }
  };
  if (
    /procedure pack|procedure tray|surgical pack|custom pack|set procedurali|kit procedurali|op sets/
      .test(text)
  ) {
    add(
      "PROCEDURE_PACK_MANUFACTURER",
      "HIGH",
      profile.componentFitLabel || "Potential procedure-pack component buyer",
    );
  }
  if (
    /surgical kit|kit assembler|surgical set|kit chirurgici|assemble/.test(text)
  ) {
    add("KIT_ASSEMBLER", "HIGH", "Potential surgical-kit component buyer");
  }
  if (/\boem\b|private label|contract manufactur|tailor made/.test(text)) {
    add("OEM_PRIVATE_LABEL", "HIGH", "Potential OEM or private-label buyer");
  }
  if (
    candidate.companyType === "Importer" || /\bimport(?:er|ation)?\b/.test(text)
  ) {
    add("IMPORTER", "MEDIUM", "Relevant product-family import activity");
  }
  if (
    candidate.companyType === "Distributor" ||
    candidate.companyType === "Wholesaler" ||
    candidate.companyType === "Reseller" ||
    /distribut|wholesal|grossiste/.test(text)
  ) {
    add(
      "DISTRIBUTOR",
      "MEDIUM",
      "Relevant product-family distribution activity",
    );
  }
  if (
    candidate.companyType === "Manufacturer" ||
    /manufactur|produzione|fabri(?:cant|cation)/.test(text)
  ) {
    add(
      "MANUFACTURER",
      "MEDIUM",
      "Manufacturer with compatible product-family activity",
    );
  }
  if (compatible.some((item) => item.sourceType === "TED_AWARD")) {
    add("TENDER_SUPPLIER", "MEDIUM", "Relevant public procurement supplier");
  }
  if (!output.length) {
    add(
      "UNKNOWN",
      "LOW",
      compatible.some((item) => item.relevanceClass === "DIRECT")
        ? "Direct product-family seller or supplier"
        : "Strong adjacent commercial fit",
    );
  }
  return output;
}

export function evaluateCandidateCompatibility(
  candidate: ProspectCandidate,
  profile: ProductFamilyProfile,
): CandidateCompatibility {
  const classified = deduplicateEvidence(
    candidate.evidence.map((item) => classifyEvidenceForProduct(item, profile)),
  );
  const enrichedCandidate: ProspectCandidate = {
    ...candidate,
    evidence: classified,
  };
  const directEvidence = classified.filter((item) =>
    item.relevanceClass === "DIRECT"
  );
  const adjacentEvidence = classified.filter((item) =>
    item.relevanceClass === "ADJACENT"
  );
  const genericEvidence = classified.filter((item) =>
    item.relevanceClass === "GENERIC"
  );
  const directConcepts = new Set(
    directEvidence.flatMap((item) => item.matchedTerms || []),
  );
  const adjacentConcepts = new Set(
    adjacentEvidence.flatMap((item) => item.matchedTerms || []),
  );
  const directSources = new Set(directEvidence.map(relevantSourceKey));
  const adjacentSources = new Set(adjacentEvidence.map(relevantSourceKey));
  const archetypes = inferArchetypes(enrichedCandidate, classified, profile);
  const mismatchText = normalizeTerm(
    [
      candidate.description,
      ...genericEvidence.flatMap((item) => [item.title, item.snippet]),
    ].filter(Boolean).join(" "),
  );
  const mismatch = !directEvidence.length && !adjacentEvidence.length &&
    profile.mismatchTerms.some((term) => containsTerm(mismatchText, term));
  const classification = directEvidence.length
    ? "DIRECT_PRODUCT_FIT"
    : adjacentEvidence.length
    ? "ADJACENT_COMMERCIAL_FIT"
    : mismatch
    ? "PRODUCT_FAMILY_MISMATCH"
    : "GENERIC_ONLY";
  const bestArchetype = archetypes.find((item) => item.archetype !== "UNKNOWN");
  const commercialReason = directEvidence.length
    ? "Direct product-family buyer"
    : bestArchetype?.reason ||
      (mismatch
        ? "Product-family mismatch"
        : "Generic healthcare relevance only");
  return {
    candidate: enrichedCandidate,
    directEvidence,
    adjacentEvidence,
    genericEvidence,
    directConceptCount: directConcepts.size,
    adjacentConceptCount: adjacentConcepts.size,
    independentDirectSourceCount: directSources.size,
    independentAdjacentSourceCount: adjacentSources.size,
    archetypes,
    commercialReason,
    classification,
    mismatch,
  };
}

export function archetypeLabel(value: BuyerArchetype): string {
  const labels: Record<BuyerArchetype, string> = {
    DISTRIBUTOR: "Distributor",
    IMPORTER: "Importer",
    KIT_ASSEMBLER: "Surgical kit assembler",
    PROCEDURE_PACK_MANUFACTURER: "Procedure pack manufacturer",
    OEM_PRIVATE_LABEL: "OEM / private-label supplier",
    MANUFACTURER: "Manufacturer",
    TENDER_SUPPLIER: "Tender supplier",
    UNKNOWN: "Potential business buyer",
  };
  return labels[value];
}

export function diversityRerank<
  T extends {
    score: number;
    countryCode: string | null;
  },
>(
  values: T[],
  maximumScoreDelta = 3,
): T[] {
  const ranked = [...values].sort((left, right) => right.score - left.score);
  for (let index = 2; index < ranked.length; index += 1) {
    const country = ranked[index].countryCode;
    if (
      !country || ranked[index - 1].countryCode !== country ||
      ranked[index - 2].countryCode !== country
    ) {
      continue;
    }
    const replacementIndex = ranked.findIndex((candidate, candidateIndex) =>
      candidateIndex > index && candidate.countryCode !== country &&
      ranked[index].score - candidate.score <= maximumScoreDelta
    );
    if (replacementIndex > index) {
      const [replacement] = ranked.splice(replacementIndex, 1);
      ranked.splice(index, 0, replacement);
    }
  }
  return ranked;
}

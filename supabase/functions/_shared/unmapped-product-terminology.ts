import type { ProductRetrievalTerm } from "./buyer-discovery-relevance-v2.ts";

export type UnmappedProductRetrievalPlan = {
  version: "UNMAPPED_RETRIEVAL_V2";
  originalPhrase: string;
  normalizedPhrase: string;
  familySignature: string;
  terms: ProductRetrievalTerm[];
};

type ReviewedTerm = Omit<
  ProductRetrievalTerm,
  "normalizedTerm" | "familySignature"
>;

type ReviewedFamilyRule = {
  key: string;
  matches: (tokens: Set<string>) => boolean;
  terms: readonly ReviewedTerm[];
};

const COUNTRIES = Object.freeze({
  en: ["GB", "IE"],
  it: ["IT"],
  fr: ["FR", "BE"],
  de: ["DE", "AT"],
  es: ["ES"],
  nl: ["NL", "BE"],
  pt: ["PT"],
  pl: ["PL"],
});

const high = (
  term: string,
  language: keyof typeof COUNTRIES,
  source: ReviewedTerm["source"],
  reason: string,
): ReviewedTerm => ({
  term,
  language,
  countries: [...COUNTRIES[language]],
  confidence: "HIGH",
  source,
  reason,
});

const medium = (
  term: string,
  language: keyof typeof COUNTRIES,
  source: ReviewedTerm["source"],
  reason: string,
): ReviewedTerm => ({
  term,
  language,
  countries: [...COUNTRIES[language]],
  confidence: "MEDIUM",
  source,
  reason,
});

export function normalizeRetrievalTerm(value: unknown): string {
  return String(value ?? "").normalize("NFKD").toLowerCase()
    .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe")
    .replace(/[đð]/g, "d").replace(/ı/g, "i").replace(/ł/g, "l")
    .replace(/ø/g, "o").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function tokens(value: unknown): Set<string> {
  return new Set(normalizeRetrievalTerm(value).split(" ").filter(Boolean));
}

function hasAll(values: Set<string>, required: string[]): boolean {
  return required.every((term) => values.has(term));
}

function hasAny(values: Set<string>, options: string[]): boolean {
  return options.some((term) => values.has(term));
}

// This is a reviewed, compositional medical terminology lexicon. Rules are
// activated by product-family concepts rather than exact QA phrases. Terms are
// retrieval vocabulary only: an independently fetched official page or TED
// notice must still contain relevant wording before it can become evidence.
const REVIEWED_FAMILY_RULES: readonly ReviewedFamilyRule[] = [
  {
    key: "hemodialysis-bloodline",
    matches: (value) =>
      !hasAny(value, ["catheter", "cannula", "needle"]) &&
      (hasAny(value, ["bloodline", "hemodialysis", "haemodialysis"]) ||
        (hasAll(value, ["arterial", "venous"]) &&
          hasAny(value, ["set", "line", "tubing"])) ||
        (value.has("av") && hasAny(value, ["bloodline", "set", "tubing"]))),
    terms: [
      high(
        "arterial venous bloodline set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed arterial/venous bloodline product-form completion.",
      ),
      high(
        "AV bloodline set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed A/V abbreviation used for dialysis bloodline systems.",
      ),
      high(
        "hemodialysis blood tubing set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Official commercial blood-tubing-set terminology.",
      ),
      medium(
        "hemodialysis bloodline",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Official commercial hemodialysis bloodline terminology.",
      ),
      medium(
        "hemodialysis extracorporeal blood circuit",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed complete extracorporeal blood-circuit product form.",
      ),
      medium(
        "linee ematiche per emodialisi",
        "it",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Italian commercial terminology for hemodialysis bloodlines.",
      ),
      medium(
        "systèmes de lignes à sang pour hémodialyse",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed French commercial terminology for dialysis bloodline systems.",
      ),
      high(
        "Hämodialyse A/V Blutschlauchsysteme",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed German commercial terminology for A/V bloodline systems.",
      ),
      medium(
        "kit de líneas de sangre para hemodiálisis",
        "es",
        "TED_TERMINOLOGY",
        "Reviewed Spanish bloodline-kit wording observed in TED.",
      ),
      medium(
        "linia krwi do hemodializy",
        "pl",
        "TED_TERMINOLOGY",
        "Reviewed Polish dialysis bloodline wording observed in TED.",
      ),
    ],
  },
  {
    key: "ecg-electrode",
    matches: (value) =>
      hasAny(value, ["ecg", "ekg", "electrocardiography"]) &&
      value.has("electrode"),
    terms: [
      high(
        "ECG electrode",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed ECG electrode commercial term.",
      ),
      high(
        "EKG electrode",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound ECG/EKG abbreviation variant.",
      ),
      medium(
        "elettrodo ECG",
        "it",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Italian ECG electrode terminology.",
      ),
      medium(
        "électrode ECG",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed French ECG electrode terminology.",
      ),
      high(
        "EKG-Elektrode",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed German ECG electrode terminology.",
      ),
      medium(
        "electrodo ECG",
        "es",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Spanish ECG electrode terminology.",
      ),
    ],
  },
  {
    key: "ecg-lead-wire",
    matches: (value) =>
      hasAny(value, ["ecg", "ekg", "electrocardiography"]) &&
      hasAny(value, ["lead", "wire", "cable"]) && !value.has("electrode"),
    terms: [
      high(
        "ECG lead wire",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed ECG patient-lead product form.",
      ),
      high(
        "EKG lead cable",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound ECG/EKG abbreviation and lead-wire/cable equivalence.",
      ),
      medium(
        "ECG patient cable",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed patient-cable commercial terminology.",
      ),
    ],
  },
  {
    key: "surgical-suction-tubing",
    matches: (value) =>
      hasAny(value, ["suction", "aspiration"]) &&
      hasAny(value, ["set", "tube", "tubing", "line", "connecting"]),
    terms: [
      high(
        "surgical suction tubing set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed complete suction-tubing product form.",
      ),
      high(
        "suction connecting tube",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed connecting-tube commercial wording.",
      ),
      medium(
        "tubo di aspirazione chirurgica",
        "it",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Italian surgical suction-tube terminology.",
      ),
      medium(
        "tubulure d'aspiration chirurgicale",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed French surgical suction-tubing terminology.",
      ),
      medium(
        "chirurgischer Absaugschlauch",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed German surgical suction-tube terminology.",
      ),
      medium(
        "tubo de aspiración quirúrgica",
        "es",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Spanish surgical suction-tube terminology.",
      ),
    ],
  },
  {
    key: "patient-warming-blanket",
    matches: (value) =>
      value.has("blanket") && hasAny(value, ["warming", "heating", "patient"]),
    terms: [
      high(
        "patient warming blanket",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed patient-warming product form.",
      ),
      high(
        "patient heating blanket",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound warming/heating terminology variant.",
      ),
      medium(
        "forced air warming blanket",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed commercial warming-blanket form; retained as a narrower variant.",
      ),
      medium(
        "coperta termica per paziente",
        "it",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Italian patient-warming terminology.",
      ),
      medium(
        "couverture chauffante pour patient",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed French patient-warming terminology.",
      ),
      medium(
        "Patientenwärmedecke",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed German patient-warming terminology.",
      ),
      medium(
        "manta térmica para paciente",
        "es",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Spanish patient-warming terminology.",
      ),
    ],
  },
  {
    key: "surgical-camera-cover",
    matches: (value) =>
      value.has("camera") &&
      hasAny(value, ["cover", "sleeve", "sheath", "drape"]),
    terms: [
      high(
        "surgical camera cover",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed surgical-camera cover family terminology.",
      ),
      high(
        "sterile camera sleeve",
        "en",
        "APPROVED_ALIAS",
        "Existing reviewed MedicHall taxonomy alias.",
      ),
      high(
        "camera sheath",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed camera-sheath commercial form.",
      ),
      high(
        "copri telecamera",
        "it",
        "APPROVED_ALIAS",
        "Existing reviewed MedicHall multilingual taxonomy alias.",
      ),
      medium(
        "housse caméra",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Existing reviewed camera-cover retrieval terminology.",
      ),
      medium(
        "Kameraabdeckung",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Existing reviewed camera-cover retrieval terminology.",
      ),
      medium(
        "funda de cámara",
        "es",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Existing reviewed camera-cover retrieval terminology.",
      ),
      medium(
        "camerahoes",
        "nl",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Existing reviewed Dutch camera-cover retrieval terminology.",
      ),
    ],
  },
  {
    key: "urinary-drainage-bag",
    matches: (value) =>
      value.has("bag") && hasAny(value, ["urinary", "urine", "urology"]) &&
      hasAny(value, ["collection", "drainage", "drain"]),
    terms: [
      high(
        "urinary drainage bag",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed urinary-drainage product form.",
      ),
      high(
        "urine collection bag",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound urinary/urine and drainage/collection equivalence.",
      ),
      medium(
        "sacca di drenaggio urinario",
        "it",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Italian urinary-drainage terminology.",
      ),
      medium(
        "poche de drainage urinaire",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed French urinary-drainage terminology.",
      ),
      medium(
        "Urinbeutel",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed German urinary-bag terminology.",
      ),
      medium(
        "bolsa de drenaje urinario",
        "es",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Spanish urinary-drainage terminology.",
      ),
    ],
  },
  {
    key: "iv-extension-tubing",
    matches: (value) =>
      hasAny(value, ["iv", "intravenous", "infusion"]) &&
      value.has("extension") &&
      hasAny(value, ["line", "tube", "tubing", "set"]),
    terms: [
      high(
        "IV extension tubing",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed IV extension-tubing product form.",
      ),
      high(
        "intravenous extension line",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound IV abbreviation and line/tubing equivalence.",
      ),
      medium(
        "infusion extension set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed infusion-extension commercial form.",
      ),
    ],
  },
  {
    key: "arthroscopy-irrigation-tubing",
    matches: (value) =>
      hasAny(value, ["arthroscopy", "arthroscopic"]) &&
      hasAny(value, ["irrigation", "tubing", "tube", "set"]),
    terms: [
      high(
        "arthroscopy irrigation tubing set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed arthroscopy irrigation-tubing product form.",
      ),
      high(
        "arthroscopic irrigation tubing",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound procedure adjective variant.",
      ),
      medium(
        "arthroscopy pump tubing set",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed narrower arthroscopy pump-tubing form.",
      ),
    ],
  },
  {
    key: "bone-cement-mixing",
    matches: (value) =>
      hasAll(value, ["bone", "cement"]) &&
      hasAny(value, ["mixing", "mixer", "system", "set"]),
    terms: [
      high(
        "bone cement mixing system",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed bone-cement mixing product form.",
      ),
      high(
        "bone cement mixer",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound mixer/mixing-system morphology variant.",
      ),
      medium(
        "vacuum bone cement mixing system",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed narrower vacuum-mixing commercial form.",
      ),
    ],
  },
  {
    key: "laparoscopy-trocar",
    matches: (value) =>
      value.has("trocar") && hasAny(value, ["laparoscopy", "laparoscopic"]),
    terms: [
      high(
        "laparoscopy trocar",
        "en",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed laparoscopy trocar product form.",
      ),
      high(
        "laparoscopic trocar",
        "en",
        "DETERMINISTIC_VARIANT",
        "Context-bound procedure adjective variant.",
      ),
      medium(
        "trocar laparoscopico",
        "it",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Italian laparoscopic trocar terminology.",
      ),
      medium(
        "trocart laparoscopique",
        "fr",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed French laparoscopic trocar terminology.",
      ),
      medium(
        "laparoskopischer Trokar",
        "de",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed German laparoscopic trocar terminology.",
      ),
      medium(
        "trocar laparoscópico",
        "es",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Spanish laparoscopic trocar terminology.",
      ),
      medium(
        "laparoscopische trocar",
        "nl",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Dutch laparoscopic trocar terminology.",
      ),
      medium(
        "trocar laparoscópico",
        "pt",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Portuguese laparoscopic trocar terminology.",
      ),
      medium(
        "trokar laparoskopowy",
        "pl",
        "VERIFIED_PRODUCT_TERMINOLOGY",
        "Reviewed Polish laparoscopic trocar terminology.",
      ),
    ],
  },
];

function exactTerm(
  normalizedPhrase: string,
  familySignature: string,
): ProductRetrievalTerm {
  return {
    term: normalizedPhrase,
    normalizedTerm: normalizeRetrievalTerm(normalizedPhrase),
    language: "en",
    countries: [...COUNTRIES.en],
    confidence: "HIGH",
    source: "DETERMINISTIC_VARIANT",
    reason: "Exact safely normalized user phrase; retrieval intent only.",
    familySignature,
  };
}

export function buildUnmappedProductRetrievalPlan(input: {
  originalPhrase: string;
  normalizedPhrase: string;
  phraseSignature: string;
}): UnmappedProductRetrievalPlan {
  const inputTokens = tokens(input.normalizedPhrase);
  const rule = REVIEWED_FAMILY_RULES.find((candidate) =>
    candidate.matches(inputTokens)
  );
  const familySignature = rule?.key || `literal-${input.phraseSignature}`;
  const generated = [
    exactTerm(input.normalizedPhrase, familySignature),
    ...(rule?.terms || []).map((term): ProductRetrievalTerm => ({
      ...term,
      normalizedTerm: normalizeRetrievalTerm(term.term),
      familySignature,
    })),
  ];
  const seen = new Set<string>();
  const terms = generated.filter((term) => {
    if (
      !term.normalizedTerm || term.normalizedTerm.length > 100 ||
      term.normalizedTerm.split(" ").length > 9 ||
      term.confidence === undefined
    ) return false;
    const semanticKey = `${term.language}:${term.normalizedTerm}`;
    if (seen.has(semanticKey)) return false;
    seen.add(semanticKey);
    return true;
  });
  return {
    version: "UNMAPPED_RETRIEVAL_V2",
    originalPhrase: input.originalPhrase,
    normalizedPhrase: input.normalizedPhrase,
    familySignature,
    terms,
  };
}

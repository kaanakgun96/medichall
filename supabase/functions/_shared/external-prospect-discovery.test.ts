import {
  boundedDiscoveryQueries,
  deduplicateCandidates,
  normalizeActivitySignal,
  type ProspectCandidate,
  sanitizeEvidenceText,
  scoreProspect,
} from "./external-prospect-discovery.ts";
import {
  francePublicRegistryAdapter,
  norwayPublicRegistryAdapter,
  registryAdaptersForCountries,
} from "./external-registry-adapters.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function candidate(
  overrides: Partial<ProspectCandidate> = {},
): ProspectCandidate {
  return {
    name: "Public Medical Distribution SA",
    countryCode: "FR",
    countryName: "France",
    cityRegion: "Paris",
    companyType: "Distributor",
    websiteUrl: "https://example.org/",
    registryIdentifier: "PUBLIC-123",
    description: "Public evidence only",
    evidence: [{
      sourceType: "PRODUCT_CATALOGUE",
      sourceUrl: "https://example.org/catalogue",
      sourceDomain: "example.org",
      title: "Official product catalogue",
      snippet: "Ultrasound probe covers",
      evidenceKind: "DIRECT_PRODUCT_EVIDENCE",
      confidence: 0.9,
      evidenceDate: "2026-08-01",
      taxonomyIds: [123],
    }],
    activities: [],
    taxonomyIds: [123],
    taxonomyRelation: "exact",
    targetCountry: true,
    preferredCompanyType: true,
    relatedAwardCount: 0,
    lastEvidenceAt: "2026-08-01",
    ...overrides,
  };
}

Deno.test("A/C: external entity inputs and exact taxonomy produce an explainable bounded score", () => {
  const result = scoreProspect(candidate(), new Date("2026-08-20T00:00:00Z"));
  assert(result.eligible, "direct product evidence must qualify");
  assert(result.productTaxonomyScore === 40, "exact taxonomy must score 40/40");
  assert(result.relevanceScore <= 100, "score must remain bounded");
  assert(
    result.reasons.some((item) => item.kind === "DIRECT_PRODUCT_EVIDENCE"),
    "direct evidence must be labelled",
  );
});

Deno.test("C/D: related taxonomy is weaker and unrelated terms never score as exact", () => {
  const related = scoreProspect(
    candidate({ taxonomyRelation: "parent_child" }),
  );
  const unrelated = scoreProspect(candidate({
    taxonomyRelation: "none",
    evidence: [{
      ...candidate().evidence[0],
      snippet: "Generic healthcare consulting",
      evidenceKind: "WEAK_CONTEXT",
      confidence: 0.4,
      taxonomyIds: [],
    }],
  }));
  assert(
    related.productTaxonomyScore === 34,
    "parent/child must score below exact",
  );
  assert(!unrelated.eligible, "unrelated weak text must not qualify");
  assert(
    unrelated.productTaxonomyScore === 0,
    "unrelated taxonomy must score zero",
  );
});

Deno.test("E/F/G/H: type, geography, TED history, and freshness remain independent components", () => {
  const recent = scoreProspect(
    candidate({ relatedAwardCount: 2 }),
    new Date("2026-08-20T00:00:00Z"),
  );
  const stale = scoreProspect(
    candidate({
      companyType: "Unknown",
      preferredCompanyType: false,
      targetCountry: false,
      relatedAwardCount: 0,
      lastEvidenceAt: "2020-01-01",
    }),
    new Date("2026-08-20T00:00:00Z"),
  );
  assert(
    recent.companyTypeScore === 15 && recent.geographyScore === 15,
    "preferred type and target geography must use their caps",
  );
  assert(
    recent.procurementSignalScore === 15,
    "repeated awards must score 15/15",
  );
  assert(
    recent.recencyScore === 5 && stale.recencyScore === 0,
    "stale evidence must not receive recency points",
  );
});

Deno.test("I/J: a hidden distributor can qualify without a website only through multiple independent indirect signals", () => {
  const activity = normalizeActivitySignal({
    providerCode: "FR_RECHERCHE_ENTREPRISES",
    countryCode: "FR",
    nationalCode: "46.46Z",
    nationalClassification: "NAF/APE",
    description: "Wholesale of pharmaceutical and medical goods",
    naceCode: "46.46",
    naceRevision: "NACE_REV_2",
  });
  const hidden = candidate({
    websiteUrl: null,
    evidence: [{
      ...candidate().evidence[0],
      sourceType: "TED_AWARD",
      sourceUrl: "https://ted.europa.eu/en/notice/-/detail/1-2026",
      sourceDomain: "ted.europa.eu",
      evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
      confidence: 0.8,
    }, {
      ...candidate().evidence[0],
      sourceType: "PUBLIC_REGISTRY",
      sourceUrl: "https://recherche-entreprises.api.gouv.fr/search?q=public",
      sourceDomain: "recherche-entreprises.api.gouv.fr",
      evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
      confidence: 0.82,
    }],
    activities: [activity],
    taxonomyRelation: "parent_child",
    relatedAwardCount: 2,
  });
  const score = scoreProspect(hidden);
  assert(
    score.eligible,
    "independent registry and TED evidence must qualify a hidden distributor",
  );
  assert(
    score.directEvidenceCount === 0,
    "activity and related awards must remain indirect",
  );
  assert(
    score.reasonSummary.includes(
      "exact current product availability is not claimed",
    ),
    "explanation must avoid an exact-product claim",
  );
});

Deno.test("J/R: official activity normalization stays indirect and country adapters are explicit", () => {
  const activity = normalizeActivitySignal({
    providerCode: "NO_BRREG_ENHETSREGISTERET",
    countryCode: "NO",
    nationalCode: "46.46",
    nationalClassification: "SN2007",
    description: "Wholesale of pharmaceutical goods",
    naceRevision: "NACE_REV_2",
  });
  assert(
    activity.strength === "STRONG_INDIRECT",
    "medical wholesale must be strong indirect",
  );
  assert(
    activity.normalizedClass === "PHARMACEUTICAL_WHOLESALE",
    "activity must map to common model",
  );
  assert(
    registryAdaptersForCountries(["FR", "DE", "NO"]).length === 2,
    "only implemented country adapters may run",
  );
});

Deno.test("J: France and Norway official registry payloads parse without contact coordinates", () => {
  const france = francePublicRegistryAdapter.parse({
    results: [{
      siren: "123456789",
      nom_raison_sociale: "Medical Public SA",
      activite_principale: "46.46Z",
      siege: { libelle_commune: "Paris", date_debut_activite: "2020-01-02" },
    }],
  }, francePublicRegistryAdapter.buildRequests()[0].url);
  const norway = norwayPublicRegistryAdapter.parse({
    _embedded: {
      enheter: [{
        organisasjonsnummer: "987654321",
        navn: "Nordic Medical AS",
        naeringskode1: {
          kode: "46.46",
          beskrivelse: "Engroshandel med sykepleievarer",
        },
        forretningsadresse: { poststed: "OSLO" },
      }],
    },
  }, norwayPublicRegistryAdapter.buildRequests()[0].url);
  assert(
    france.length === 1 && norway.length === 1,
    "official payloads must parse",
  );
  assert(
    !JSON.stringify([france, norway]).includes("@"),
    "registry DTOs must not contain email fields",
  );
});

Deno.test("K/L/T: unavailable sources are not invented and request generation is bounded", () => {
  const queries = boundedDiscoveryQueries({
    cpvCodes: ["33100000", "33140000", "33190000", "33192000", "33199000"],
    targetCountries: ["FR", "DE", "NO", "ES"],
    taxonomyNames: ["Ultrasound probe covers", "Surgical drapes", "Extra term"],
  });
  assert(queries.length <= 4, "query generation must be capped at four");
  assert(
    scoreProspect(candidate({ websiteUrl: null })).eligible,
    "missing website must not block direct public evidence",
  );
});

Deno.test("B/S: registered MedicHall companies are preferred and duplicate external candidates collapse", () => {
  const result = deduplicateCandidates([
    candidate(),
    candidate({ name: "Duplicate trading name" }),
    candidate({ name: "Other SA", websiteUrl: null }),
    candidate({ name: "Other SA", websiteUrl: null }),
  ], [{
    id: 1,
    name: "Existing member",
    website: "https://example.org",
    country: "FR",
  }]);
  assert(
    result.registeredDuplicates === 2,
    "member-domain candidates must be removed",
  );
  assert(
    result.externalDuplicates === 1,
    "external name/country duplicates must collapse",
  );
  assert(
    result.candidates.length === 1,
    "only one independent external candidate should remain",
  );
});

Deno.test("B/C: registry identifiers deduplicate while same names in different countries remain distinct", () => {
  const registry = deduplicateCandidates([
    candidate({
      name: "Registry One",
      websiteUrl: "https://one.example",
      registryIdentifier: "FR-777",
    }),
    candidate({
      name: "Registry Two",
      websiteUrl: "https://two.example",
      registryIdentifier: "FR-777",
    }),
  ]);
  const countries = deduplicateCandidates([
    candidate({
      name: "Independent Medical",
      countryCode: "FR",
      countryName: "France",
      websiteUrl: null,
      registryIdentifier: null,
    }),
    candidate({
      name: "Independent Medical",
      countryCode: "DE",
      countryName: "Germany",
      websiteUrl: null,
      registryIdentifier: null,
    }),
  ]);
  assert(
    registry.externalDuplicates === 1 && registry.candidates.length === 1,
    "one official registry entity must collapse across differing websites",
  );
  assert(
    countries.candidates.length === 2,
    "the same normalized company name in different countries must remain distinct",
  );
});

Deno.test("W: evidence sanitization removes personal contact coordinates", () => {
  const sanitized = sanitizeEvidenceText(
    "Sales: jane@example.org, +33 1 23 45 67 89",
  );
  assert(!sanitized.includes("jane@example.org"), "email must be redacted");
  assert(!sanitized.includes("45 67 89"), "phone must be redacted");
  assert(
    (sanitized.match(/\[private contact\]/g) || []).length === 2,
    "both contact coordinates must be replaced",
  );
});

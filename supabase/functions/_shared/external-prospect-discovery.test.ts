import {
  boundedDiscoveryQueries,
  deduplicateCandidates,
  nationalActivityCodeMapping,
  normalizeActivitySignal,
  type ProspectCandidate,
  sanitizeEvidenceText,
  scoreProspect,
} from "./external-prospect-discovery.ts";
import {
  francePublicRegistryAdapter,
  norwayPublicRegistryAdapter,
  polandKrsRegistryAdapter,
  REGISTRY_COVERAGE,
  registryAdaptersForCountries,
  registryCandidatesFromCache,
  registryCoverageForCountries,
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
    related.productTaxonomyScore < 40 && related.productTaxonomyScore > 0,
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
    recent.companyTypeScore === 8 && recent.geographyScore === 10,
    "preferred type and target geography must use their caps",
  );
  assert(
    recent.procurementSignalScore === 0,
    "award counts without matching TED evidence must not score",
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
      snippet: "Surgical drapes and procedure packs supplied under the award",
    }, {
      ...candidate().evidence[0],
      sourceType: "PUBLIC_REGISTRY",
      sourceUrl: "https://recherche-entreprises.api.gouv.fr/search?q=public",
      sourceDomain: "recherche-entreprises.api.gouv.fr",
      evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
      confidence: 0.82,
    }, {
      ...candidate().evidence[0],
      sourceType: "ASSOCIATION_DIRECTORY",
      sourceUrl: "https://directory.example.org/public-medical",
      sourceDomain: "directory.example.org",
      evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
      confidence: 0.86,
      snippet: "Distributor of surgical drapes and custom procedure packs",
    }],
    activities: [activity],
    taxonomyRelation: "parent_child",
    relatedAwardCount: 2,
  });
  const score = scoreProspect(hidden);
  assert(
    score.eligible,
    "multiple product-adjacent sources plus registry support must qualify a hidden distributor",
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
          kode: "46.460",
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
  assert(
    france[0].registryIdentifier === "123456789" &&
      norway[0].registryIdentifier === "987654321",
    "numeric legal-entity identifiers must not be mistaken for phone numbers",
  );
  assert(
    france[0].activity.effectiveFrom === "2020-01-02",
    "official activity dates must remain available for recency scoring",
  );
  assert(
    norway[0].activity.mappingConfidence === "HIGH" &&
      norway[0].activity.normalizedNaceCode === "46.46",
    "current Norwegian SN2025 medical wholesale code must normalize",
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

Deno.test("European coverage: every requested country has an explicit truthful capability state", () => {
  const expected = new Map([
    ["FR", "ACTIVE"],
    ["NO", "ACTIVE"],
    ["DE", "DISABLED_PENDING_LEGAL_REVIEW"],
    ["IT", "DISABLED_PENDING_LEGAL_REVIEW"],
    ["ES", "UNAVAILABLE"],
    ["NL", "DISABLED_PENDING_LEGAL_REVIEW"],
    ["BE", "DISABLED_PENDING_LEGAL_REVIEW"],
    ["PL", "PARTIAL"],
  ]);
  const selected = registryCoverageForCountries([...expected.keys()]);
  assert(selected.length === expected.size, "coverage matrix must be complete");
  for (const item of selected) {
    assert(
      item.status === expected.get(item.countryCode),
      `${item.countryCode} coverage state must match the reviewed source decision`,
    );
    assert(
      item.documentationUrl.startsWith("https://"),
      "official source URL required",
    );
    assert(item.maximumRequestsPerRun >= 0, "request cap required");
    if (!item.runtimeEnabled) {
      assert(
        item.maximumRequestsPerRun === 0,
        "disabled sources must have a zero runtime request cap",
      );
    }
  }
  assert(
    REGISTRY_COVERAGE.every((item) => item.cost !== "METERED"),
    "no unapproved metered registry dependency may be active",
  );
});

Deno.test("European mappings: reviewed national codes normalize while ambiguous codes remain unclaimed", () => {
  const reviewed = [
    ["WZ 2008", "46.46.2"],
    ["ATECO 2025", "46.46.39"],
    ["CNAE 2009", "46.46"],
    ["SBI 2008", "46462"],
    ["NACE-BEL 2025", "46.460"],
    ["PKD 2007", "46.46.Z"],
  ];
  for (const [classification, code] of reviewed) {
    const mapping = nationalActivityCodeMapping(classification, code);
    assert(
      mapping?.normalizedNaceCode === "46.46",
      `${classification} mapping missing`,
    );
    assert(
      mapping.mappingConfidence === "HIGH",
      "reviewed mapping must be explicit",
    );
    assert(
      mapping.strength === "STRONG_INDIRECT",
      "activity codes must remain indirect evidence",
    );
  }
  const ambiguous = normalizeActivitySignal({
    providerCode: "DE_UNTERNEHMENSREGISTER",
    countryCode: "DE",
    nationalCode: "46.69.0",
    nationalClassification: "WZ 2008",
    description: "Other wholesale activity",
  });
  assert(
    ambiguous.mappingConfidence === "UNMAPPED",
    "ambiguous code must stay unmapped",
  );
  assert(
    ambiguous.strength !== "STRONG_INDIRECT",
    "ambiguous code must never become a strong activity signal",
  );
});

Deno.test("Poland partial adapter: only explicit KRS seeds are looked up and relevant PKD is parsed", () => {
  const seeds = [
    candidate({ countryCode: "PL", registryIdentifier: "KRS:0000011286" }),
    candidate({ countryCode: "PL", registryIdentifier: "KRS:0000011286" }),
    candidate({ countryCode: "PL", registryIdentifier: "PL 1234567890" }),
  ];
  const requests = polandKrsRegistryAdapter.buildRequests(seeds);
  assert(
    requests.length === 1,
    "KRS requests must deduplicate and remain capped at one",
  );
  assert(
    requests[0].url.includes("/0000011286?"),
    "only the explicit typed KRS identifier may enter the official URL",
  );
  const parsed = polandKrsRegistryAdapter.parse(
    {
      odpis: {
        naglowekA: {
          numerKRS: "0000011286",
          stanPozycji: "AKTYWNA",
          dataRejestracjiWKRS: "2001-05-21",
        },
        dane: {
          dzial1: {
            danePodmiotu: { nazwa: "QA LEGAL MEDICAL S.A." },
            siedzibaIAdres: { siedziba: { miejscowosc: "Warszawa" } },
            // A deliberately present non-business branch must never be read.
            wspolnicy: [{ email: "private@example.invalid" }],
          },
          dzial3: {
            przedmiotDzialalnosci: {
              przedmiotPrzewazajacejDzialalnosci: [{
                kodDzial: "46",
                kodKlasa: "46",
                kodPodklasa: "Z",
                opis: "Wholesale of pharmaceutical and medical goods",
              }],
            },
          },
        },
      },
    },
    requests[0].url,
    requests[0].seed,
  );
  assert(parsed.length === 1, "relevant PKD activity must parse once");
  assert(
    parsed[0].activity.mappingConfidence === "HIGH",
    "PKD mapping must be reviewed",
  );
  assert(
    !/private@example\.invalid|wspolnicy|email/i.test(JSON.stringify(parsed)),
    "person and contact branches must not enter the normalized DTO",
  );
});

Deno.test("Registry privacy: French sole traders and Norwegian ENK entities are excluded", () => {
  const france = francePublicRegistryAdapter.parse({
    results: [{
      siren: "123456789",
      nom_complet: "PERSONAL NAME",
      activite_principale: "46.46Z",
      siege: { libelle_commune: "Paris" },
    }],
  }, francePublicRegistryAdapter.buildRequests()[0].url);
  const norway = norwayPublicRegistryAdapter.parse({
    _embedded: {
      enheter: [{
        organisasjonsnummer: "987654321",
        navn: "PERSONAL NAME",
        organisasjonsform: { kode: "ENK" },
        naeringskode1: { kode: "46.46", beskrivelse: "Wholesale" },
      }],
    },
  }, norwayPublicRegistryAdapter.buildRequests()[0].url);
  assert(
    france.length === 0 && norway.length === 0,
    "natural-person entities must be excluded",
  );
});

Deno.test("Registry cache normalization is deterministic and drops unexpected contact properties", () => {
  const source = francePublicRegistryAdapter.parse({
    results: [{
      siren: "123456789",
      nom_raison_sociale: "Medical Cache SA",
      activite_principale: "46.46Z",
      siege: { libelle_commune: "Paris" },
    }],
  }, francePublicRegistryAdapter.buildRequests()[0].url)[0];
  const cached = registryCandidatesFromCache([{
    ...source,
    email: "private@example.invalid",
  }]);
  assert(cached.length === 1, "valid normalized cache entry must round-trip");
  assert(
    cached[0].activity.mappingConfidence === "HIGH",
    "mapping provenance must survive cache",
  );
  assert(
    !JSON.stringify(cached).includes("private@example.invalid"),
    "unknown contact data must be dropped",
  );
});

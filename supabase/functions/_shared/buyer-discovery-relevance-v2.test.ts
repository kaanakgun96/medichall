import fixtures from "./fixtures/buyer-discovery-relevance-v2.golden.json" with {
  type: "json",
};
import {
  boundedTedSearchPlan,
  deduplicateCandidates,
  DISCOVERY_LIMITS,
  type EvidenceSourceType,
  partitionTedCandidates,
  type ProspectCandidate,
  rankProspects,
  scoreProspect,
} from "./external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  diversityRerank,
  evaluateCandidateCompatibility,
} from "./buyer-discovery-relevance-v2.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const profiles = {
  gown: buildProductFamilyProfile([{
    taxonomyId: 1,
    canonicalName: "Sterile Surgical Gown",
    slug: "sterile-surgical-gown",
    aliases: ["surgical gown"],
  }]),
  cover: buildProductFamilyProfile([{
    taxonomyId: 2,
    canonicalName: "Medical Equipment Covers",
    slug: "medical-equipment-covers",
    aliases: ["C-arm cover", "camera cover", "microscope cover"],
  }]),
};

type Fixture = typeof fixtures[number];

Deno.test("production plural gown taxonomy activates the reviewed product family", () => {
  const profile = buildProductFamilyProfile([{
    taxonomyId: 1,
    canonicalName: "Sterile Surgical Gowns",
    slug: "sterile-surgical-gowns",
    aliases: [],
  }]);
  assert(
    profile.key === "surgical-gown-family" &&
      profile.directTerms.includes("surgical gown") &&
      profile.adjacentTerms.includes("procedure pack"),
    "plural production taxonomy must retain gown retrieval and compatibility rules",
  );
});

function fixtureCandidate(fixture: Fixture): ProspectCandidate {
  return {
    name: fixture.company,
    countryCode: fixture.country,
    countryName: fixture.country,
    cityRegion: null,
    companyType: fixture.companyType as ProspectCandidate["companyType"],
    websiteUrl:
      fixture.evidence.find((item) => item.sourceType === "COMPANY_WEBSITE")
        ?.sourceUrl || null,
    registryIdentifier: null,
    description: fixture.evidence.map((item) => item.snippet).join(" "),
    evidence: fixture.evidence.map((item, index) => ({
      sourceType: item.sourceType as EvidenceSourceType,
      sourceUrl: item.sourceUrl,
      sourceDomain: new URL(item.sourceUrl).hostname,
      title: item.title,
      snippet: item.snippet,
      evidenceKind: "WEAK_CONTEXT",
      confidence: 0.9,
      evidenceDate: "2026-08-20",
      noticeId: item.sourceType === "TED_AWARD"
        ? `benchmark-${fixture.country}-${index}`
        : null,
      taxonomyIds: [fixture.family === "gown" ? 1 : 2],
    })),
    activities: [],
    taxonomyIds: [fixture.family === "gown" ? 1 : 2],
    taxonomyRelation: "exact",
    targetCountry: false,
    preferredCompanyType: true,
    relatedAwardCount: 0,
    lastEvidenceAt: "2026-08-20",
  };
}

Deno.test("golden benchmark: 16 European business patterns classify from evidence, never company names", () => {
  assert(
    fixtures.length === 16,
    "the required 16-company benchmark must remain complete",
  );
  for (const fixture of fixtures) {
    const profile = profiles[fixture.family as keyof typeof profiles];
    const candidate = fixtureCandidate(fixture);
    const compatibility = evaluateCandidateCompatibility(candidate, profile);
    const score = scoreProspect(
      compatibility.candidate,
      new Date("2026-08-24T00:00:00Z"),
      profile,
    );
    assert(
      score.commercialFitClassification === fixture.expectedClassification,
      `${fixture.company} ${fixture.product}: expected ${fixture.expectedClassification}, got ${score.commercialFitClassification}`,
    );
    if ("minimumScore" in fixture) {
      assert(
        score.relevanceScore >= Number(fixture.minimumScore),
        `${fixture.company}: score ${score.relevanceScore} below ${fixture.minimumScore}`,
      );
    }
    if ("maximumScore" in fixture) {
      assert(
        score.relevanceScore <= Number(fixture.maximumScore),
        `${fixture.company}: generic score ${score.relevanceScore} exceeds ceiling`,
      );
      assert(
        !score.eligible,
        `${fixture.company}: generic-only evidence must not qualify`,
      );
    }
  }
});

Deno.test("synthetic Synektik-style surgical-technology supplier is not a gown match", () => {
  const generic = fixtureCandidate({
    company: "Synthetic Surgical Technology Sp. z o.o.",
    country: "PL",
    product: "Sterile Surgical Gown",
    family: "gown",
    companyType: "Distributor",
    expectedClassification: "PRODUCT_FAMILY_MISMATCH",
    maximumScore: 42,
    evidence: [{
      sourceType: "COMPANY_WEBSITE",
      sourceUrl: "https://synthetic.invalid/robotics",
      title: "Surgical technology supplier",
      snippet:
        "Surgical robots, oncology technology, capital equipment and medical imaging systems.",
    }],
  });
  const score = scoreProspect(
    generic,
    new Date("2026-08-24T00:00:00Z"),
    profiles.gown,
  );
  assert(!score.eligible, "generic surgical-tech overlap must not qualify");
  assert(score.relevanceScore <= 42, "generic-only ceiling must apply");
  assert(
    score.commercialFitClassification === "PRODUCT_FAMILY_MISMATCH",
    "cross-product evidence must be identified as a mismatch",
  );
});

Deno.test("Europe-wide TED plan attempts every supported market in bounded balanced batches", () => {
  const plan = boundedTedSearchPlan({
    directTerms: [],
    adjacentTerms: [],
    cpvCodes: ["33140000"],
    targetCountries: [],
  });
  assert(
    plan.length === DISCOVERY_LIMITS.maximumTedRequests,
    "TED request cap must be used",
  );
  const countries = new Set(plan.flatMap((item) => item.countries));
  for (
    const country of [
      "FR",
      "DE",
      "IT",
      "ES",
      "NL",
      "PL",
      "RO",
      "NO",
      "PT",
      "GR",
    ]
  ) {
    assert(
      countries.has(country),
      `${country} must be attempted in Europe-wide discovery`,
    );
  }
  assert(
    Math.max(...plan.map((item) => item.countries.length)) -
        Math.min(...plan.map((item) => item.countries.length)) <= 1,
    "country batches must be balanced",
  );
});

Deno.test("product-specific TED retrieval is not swamped by a broad CPV fallback", () => {
  const plan = boundedTedSearchPlan({
    directTerms: ["Sterile Surgical Gowns", "surgical gown"],
    adjacentTerms: ["procedure pack", "surgical drape"],
    cpvCodes: ["33140000"],
    targetCountries: [],
  });
  assert(
    plan.length === DISCOVERY_LIMITS.maximumTedRequests,
    "bounded plan must retain six balanced requests",
  );
  assert(
    plan.filter((item) => item.retrievalKind === "PRODUCT_TERMS").length ===
      DISCOVERY_LIMITS.maximumTedProductRequests,
    "four bounded product-term requests must be reserved",
  );
  assert(
    plan.filter((item) => item.retrievalKind === "RELATED_CPV").length ===
      DISCOVERY_LIMITS.maximumTedCpvRequests,
    "two bounded CPV discovery requests must remain available",
  );
  assert(
    plan.filter((item) => item.retrievalKind === "PRODUCT_TERMS").every((
      item,
    ) =>
      !item.query.includes("classification-cpv") &&
      item.query.includes("Sterile Surgical Gowns") &&
      item.query.includes("procedure pack")
    ),
    "product and CPV retrieval partitions must remain separate",
  );
  for (const kind of ["PRODUCT_TERMS", "RELATED_CPV"] as const) {
    const covered = new Set(
      plan.filter((item) => item.retrievalKind === kind)
        .flatMap((item) => item.countries),
    );
    assert(
      covered.size === 32,
      `${kind} must cover every supported European market`,
    );
  }
  assert(
    plan.some((item) => item.unfilteredCountryFallback),
    "Europe-wide product retrieval must include one missing-country fallback",
  );
});

Deno.test("TED source partitions prevent broad CPV candidates from consuming the pool", () => {
  const product = Array.from(
    { length: DISCOVERY_LIMITS.maximumProductTedCandidates + 5 },
    (_, index) =>
      fixtureCandidate({
        ...fixtures[0],
        company: `Product ${index}`,
        evidence: fixtures[0].evidence.map((item) => ({ ...item })),
      }),
  ).map((candidate, index) => ({
    ...candidate,
    websiteUrl: `https://product-${index}.example/`,
    evidence: candidate.evidence.map((item) => ({
      ...item,
      discoveryReason: "DIRECT_PRODUCT_TERM_TED" as const,
    })),
  }));
  const cpv = Array.from(
    { length: DISCOVERY_LIMITS.maximumCpvTedCandidates + 5 },
    (_, index) =>
      fixtureCandidate({
        ...fixtures[0],
        company: `CPV ${index}`,
        evidence: fixtures[0].evidence.map((item) => ({ ...item })),
      }),
  ).map((candidate, index) => ({
    ...candidate,
    websiteUrl: `https://cpv-${index}.example/`,
    evidence: candidate.evidence.map((item) => ({
      ...item,
      discoveryReason: "RELATED_CPV_TED" as const,
    })),
  }));
  const partitioned = partitionTedCandidates([...cpv, ...product]);
  assert(
    partitioned.productTermCandidates.length ===
      DISCOVERY_LIMITS.maximumProductTedCandidates,
    "product-term partition must retain its independent budget",
  );
  assert(
    partitioned.cpvCandidates.length ===
      DISCOVERY_LIMITS.maximumCpvTedCandidates,
    "CPV fallback must remain bounded",
  );
  assert(
    partitioned.rejectedBySourceCaps === 10,
    "source-cap diagnostics must report early exclusions",
  );
});

Deno.test("relevance ranks first and diversity changes only near-equal ties", () => {
  const ranked = diversityRerank([
    { name: "A", score: 90, countryCode: "PL" },
    { name: "B", score: 89, countryCode: "PL" },
    { name: "C", score: 88, countryCode: "PL" },
    { name: "D", score: 86, countryCode: "FR" },
    { name: "E", score: 40, countryCode: "DE" },
  ]);
  assert(ranked[2].name === "D", "near-equal third result may diversify");
  assert(ranked[4].name === "E", "weak candidates must not be promoted");
});

Deno.test("evidence and candidates deduplicate before relevance ranking", () => {
  const source = fixtures[0];
  const duplicated = fixtureCandidate({
    ...source,
    evidence: [source.evidence[0], source.evidence[0]],
  });
  const compatibility = evaluateCandidateCompatibility(
    duplicated,
    profiles.gown,
  );
  assert(
    compatibility.directEvidence.length === 1,
    "duplicate evidence must collapse",
  );
  const deduped = deduplicateCandidates([duplicated, duplicated]);
  assert(deduped.candidates.length === 1, "duplicate companies must collapse");
  const ranking = rankProspects(deduped.candidates, profiles.gown, {
    europeWide: true,
    now: new Date("2026-08-24T00:00:00Z"),
  });
  assert(
    ranking.accepted.length === 1,
    "one evidence-backed candidate must remain",
  );
});

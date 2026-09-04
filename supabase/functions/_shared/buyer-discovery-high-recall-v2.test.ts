import {
  buildHighRecallBenchmarkObservations,
  buildHighRecallBenchmarkProfile,
  runHighRecallBenchmark,
  runHighRecallBenchmarkMatrix,
} from "./buyer-discovery-high-recall-v2.benchmark.ts";
import {
  deduplicateCandidates,
  type ProspectCandidate,
  rankProspects,
  scoreProspect,
} from "./external-prospect-discovery.ts";
import { buildProductFamilyProfile } from "./buyer-discovery-relevance-v2.ts";
import {
  HIGH_RECALL_BENCHMARK_FIXTURES,
  type HighRecallBenchmarkFixture,
} from "./fixtures/buyer-discovery-high-recall-v2.fixtures.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const BENCHMARK_NOW = new Date("2026-09-04T00:00:00.000Z");

function expectedUnique(fixture: HighRecallBenchmarkFixture): number {
  return Object.values(fixture.tiers).reduce((sum, count) => sum + count, 0);
}

Deno.test("high-recall benchmark covers the requested heterogeneous 10-product matrix", () => {
  const reports = runHighRecallBenchmarkMatrix();
  assert(reports.length === 10, "all ten benchmark products must be present");
  const required = [
    "Sterile Surgical Gown",
    "Medical Examination Glove",
    "Biopsy Needle",
    "Laparoscopy Trocar",
    "Camera Cover",
    "General Procedure Pack",
    "CT Contrast Injector",
    "ECG Electrode",
    "Patient Warming Blanket",
    "Closed System Drug Transfer Device",
  ];
  assert(
    required.every((product) =>
      reports.some((item) => item.product === product)
    ),
    "the matrix must retain every requested product plus one unseen product",
  );

  for (const [index, report] of reports.entries()) {
    const fixture = HIGH_RECALL_BENCHMARK_FIXTURES[index];
    const displayable = fixture.tiers.strong + fixture.tiers.likely +
      fixture.tiers.potential;
    assert(
      report.rawObservations === fixture.rawObservations,
      `${fixture.key}: raw observation count drifted`,
    );
    assert(
      report.uniqueCompanies === expectedUnique(fixture),
      `${fixture.key}: unique company count drifted`,
    );
    assert(
      report.uniqueDomains === report.uniqueCompanies,
      `${fixture.key}: every synthetic company must retain an independent identity`,
    );
    assert(
      report.duplicatesRemoved ===
        report.rawObservations - report.uniqueCompanies,
      `${fixture.key}: overlapping wave observations must deduplicate`,
    );
    assert(
      report.tiers.STRONG_COMMERCIAL_PROSPECT === fixture.tiers.strong,
      `${fixture.key}: STRONG tier drifted`,
    );
    assert(
      report.tiers.LIKELY_COMMERCIAL_PROSPECT === fixture.tiers.likely,
      `${fixture.key}: LIKELY tier drifted`,
    );
    assert(
      report.tiers.POTENTIAL_COMMERCIAL_PROSPECT === fixture.tiers.potential,
      `${fixture.key}: POTENTIAL tier drifted`,
    );
    assert(
      report.tiers.LOW_CONFIDENCE === fixture.tiers.lowConfidence,
      `${fixture.key}: LOW_CONFIDENCE tier drifted`,
    );
    assert(
      report.tiers.HARD_REJECT === fixture.tiers.hardReject,
      `${fixture.key}: HARD_REJECT tier drifted`,
    );
    assert(
      report.displayableTotal === displayable,
      `${fixture.key}: displayable total must equal the first three transparent tiers`,
    );
    assert(
      report.oldArchitectureDiscarded > 0,
      `${fixture.key}: benchmark must expose the legacy loss of plausible companies`,
    );
  }
});

Deno.test("broad/common Europe fixtures demonstrate 50+ displayable capacity without changing niche expectations", () => {
  const reports = runHighRecallBenchmarkMatrix();
  const broad = reports.filter((item) => item.profile === "BROAD");
  assert(
    broad.length >= 3,
    "the matrix must include multiple broad/common products",
  );
  assert(
    broad.every((item) => item.displayableTotal >= 50),
    "every broad fixture with supporting evidence must retain at least 50 displayable prospects",
  );
  assert(
    reports.some((item) =>
      item.profile === "NICHE" && item.displayableTotal < 50
    ),
    "specialized products must be allowed to produce a smaller honest pool",
  );
});

Deno.test("tier refinement retains verified medical-commercial family and channel companies transparently", () => {
  const fixture = HIGH_RECALL_BENCHMARK_FIXTURES.find((item) =>
    item.key === "medical-glove"
  )!;
  const unique = deduplicateCandidates(
    buildHighRecallBenchmarkObservations(fixture),
  ).candidates;
  const ranked = rankProspects(
    unique,
    buildHighRecallBenchmarkProfile(fixture),
    {
      europeWide: true,
      now: new Date("2026-09-04T00:00:00.000Z"),
    },
  );
  const strong = ranked.accepted.find((item) =>
    item.score.prospectTier === "STRONG_COMMERCIAL_PROSPECT"
  )!;
  const likely = ranked.accepted.find((item) =>
    item.score.prospectTier === "LIKELY_COMMERCIAL_PROSPECT"
  )!;
  const potential = ranked.accepted.find((item) =>
    item.score.prospectTier === "POTENTIAL_COMMERCIAL_PROSPECT"
  )!;

  assert(
    strong.score.genericSemanticClass === "EXACT_PRODUCT_COMMERCIAL_MATCH",
    "exact official product evidence must be STRONG",
  );
  assert(
    strong.score.evidenceFacets.product &&
      strong.score.evidenceFacets.commercial,
    "STRONG must expose product and commercial evidence facets",
  );
  assert(
    likely.score.genericSemanticClass === "MEDICAL_COMMERCIAL_FAMILY_MATCH",
    "category-compatible medical commerce must be LIKELY",
  );
  assert(
    !likely.score.evidenceFacets.product &&
      likely.score.evidenceFacets.category,
    "LIKELY must not imply exact product proof",
  );
  assert(
    potential.score.genericSemanticClass === "MEDICAL_COMMERCIAL_CHANNEL_MATCH",
    "verified channel-only medical commerce must be POTENTIAL",
  );
  assert(
    !potential.score.evidenceFacets.product &&
      !potential.score.evidenceFacets.category,
    "POTENTIAL must remain transparent about missing product/category evidence",
  );
  assert(
    strong.score.finalRankScore > likely.score.finalRankScore &&
      likely.score.finalRankScore > potential.score.finalRankScore,
    "exact product proof must boost rank above family evidence, while verified family/channel prospects remain displayable",
  );
  assert(
    !potential.score.genericOnlyCeilingApplied,
    "a verified medical-commercial channel must not be collapsed into the legacy generic-only rejection bucket",
  );
  assert(
    potential.score.reasonSummary.includes(
      "exact product availability is not claimed",
    ),
    "lower evidence tiers must use careful non-claiming explanations",
  );
});

Deno.test("Buyer Fit and Sales Actionability remain separate ranking dimensions", () => {
  const fixture = HIGH_RECALL_BENCHMARK_FIXTURES[0];
  const unique = deduplicateCandidates(
    buildHighRecallBenchmarkObservations(fixture),
  ).candidates;
  const scores = unique.map((candidate) =>
    scoreProspect(
      candidate,
      new Date("2026-09-04T00:00:00.000Z"),
      buildHighRecallBenchmarkProfile(fixture),
    )
  ).filter((score) => score.displayable);
  assert(
    scores.every((score) => Number.isFinite(score.buyerFitScore)),
    "Buyer Fit must be populated for every displayable prospect",
  );
  assert(
    scores.every((score) => Number.isFinite(score.salesActionabilityScore)),
    "Sales Actionability must be populated independently",
  );
  assert(
    scores.every((score) => Number.isFinite(score.finalRankScore)),
    "final rank must be explicit and bounded",
  );
  assert(
    scores.every((score) =>
      score.finalRankScore >= 0 && score.finalRankScore <= 100
    ),
    "final rank must stay within 0..100",
  );
  assert(
    scores.some((score) =>
      score.buyerFitScore !== score.salesActionabilityScore
    ),
    "Buyer Fit must not be an alias of Sales Actionability",
  );
});

Deno.test("Europe-wide reranking preserves all eight requested regions and diverse commercial archetypes", () => {
  for (const report of runHighRecallBenchmarkMatrix()) {
    assert(
      report.countryCoverage.length >= 12,
      `${report.key}: Europe-wide country coverage is too narrow`,
    );
    for (
      const region of [
        "UK_IRELAND",
        "DACH",
        "FRANCE_BENELUX",
        "ITALY",
        "IBERIA",
        "NORDICS",
        "CENTRAL_EUROPE",
        "EASTERN_EUROPE",
      ]
    ) {
      assert(
        report.regionalCoverage.includes(region),
        `${report.key}: missing ${region}`,
      );
    }
    assert(
      report.archetypeCoverage.length >= 5,
      `${report.key}: commercial archetype coverage is too narrow`,
    );
  }
});

Deno.test("legacy 30-result and exact-evidence gates would discard supported prospects", () => {
  const gown = runHighRecallBenchmark(
    HIGH_RECALL_BENCHMARK_FIXTURES.find((item) =>
      item.key === "surgical-gown"
    )!,
  );
  assert(
    gown.displayableTotal === 68,
    "fixture evidence must support the modeled gown pool",
  );
  assert(
    gown.oldArchitectureRetained === 16,
    "legacy exact/adjacent eligibility would retain only exact supported sellers in this fixture",
  );
  assert(
    gown.oldEvidenceGateDiscarded === 52,
    "legacy generic-only semantics would hide supported family/channel prospects",
  );
  assert(
    gown.oldArchitectureDiscarded === 52,
    "legacy total loss must be reported explicitly",
  );

  const capacityFixture: HighRecallBenchmarkFixture = {
    ...HIGH_RECALL_BENCHMARK_FIXTURES[1],
    key: "capacity-ceiling",
    slug: "capacity-ceiling",
    rawObservations: 120,
    tiers: {
      strong: 40,
      likely: 40,
      potential: 40,
      lowConfidence: 0,
      hardReject: 0,
    },
  };
  const capacity = runHighRecallBenchmark(capacityFixture);
  assert(
    capacity.displayableTotal === 100,
    "ranking contract must support 100 persisted/displayable candidates rather than 30",
  );
  assert(
    capacity.oldArchitectureRetained === 30,
    "legacy display cap must remain modeled as 30",
  );
  assert(
    capacity.oldCapDiscarded === 10,
    "even exact-supported companies beyond legacy 30 must be reported as cap losses",
  );
});

function hardNegativeCandidate(
  overrides: Partial<ProspectCandidate>,
): ProspectCandidate {
  return {
    name: "Synthetic negative fixture",
    nameSource: "OFFICIAL_WEBSITE",
    countryCode: "GB",
    countryName: "United Kingdom",
    cityRegion: null,
    companyType: "Unknown",
    websiteUrl: "https://hard-negative.test/",
    registryIdentifier: null,
    description: "Synthetic local test fixture",
    evidence: [],
    activities: [],
    taxonomyIds: [],
    taxonomyRelation: "none",
    targetCountry: true,
    preferredCompanyType: false,
    relatedAwardCount: 0,
    lastEvidenceAt: "2026-09-01",
    discoverySources: ["PUBLIC_WEB"],
    identityConfidence: "HIGH",
    commercialIdentityVerified: true,
    medicalCommercialIdentityVerified: true,
    ...overrides,
  };
}

Deno.test("hard negatives, registry-only evidence, end buyers, and manufacturers never enter the commercial display pool", () => {
  const gloveProfile = buildProductFamilyProfile([{
    taxonomyId: 1,
    canonicalName: "Medical Examination Glove",
    slug: "medical-examination-glove",
  }]);
  const nonMedical = scoreProspect(
    hardNegativeCandidate({
      name: "Synthetic industrial PPE shop",
      companyType: "Distributor",
      description: "Industrial work glove distributor",
      evidence: [{
        sourceType: "COMPANY_WEBSITE",
        sourceUrl: "https://hard-negative.test/work-gloves",
        sourceDomain: "hard-negative.test",
        title: "Medical Examination Glove",
        snippet: "Industrial work glove and mechanic glove catalogue",
        evidenceKind: "WEAK_CONTEXT",
        confidence: 0.9,
        evidenceDate: "2026-09-01",
      }],
    }),
    BENCHMARK_NOW,
    gloveProfile,
  );
  assert(
    nonMedical.prospectTier === "HARD_REJECT" && !nonMedical.displayable,
    "explicit non-medical context must hard reject an ambiguous product word",
  );

  const registryOnly = scoreProspect(
    hardNegativeCandidate({
      name: "Synthetic registry-only wholesaler",
      websiteUrl: null,
      registryIdentifier: "SYNTHETIC-1",
      companyType: "Distributor",
      evidence: [{
        sourceType: "PUBLIC_REGISTRY",
        sourceUrl: "https://registry.test/entity/1",
        sourceDomain: "registry.test",
        title: "Business activity",
        snippet: "Wholesale of medical goods",
        evidenceKind: "INDIRECT_COMMERCIAL_EVIDENCE",
        confidence: 0.9,
        evidenceDate: "2026-09-01",
      }],
      discoverySources: ["REGISTRY"],
      commercialIdentityVerified: false,
      medicalCommercialIdentityVerified: false,
    }),
    BENCHMARK_NOW,
    gloveProfile,
  );
  assert(
    !registryOnly.displayable,
    "registry activity alone must remain insufficient",
  );

  const gppProfile = buildProductFamilyProfile([{
    taxonomyId: 2,
    canonicalName: "General Procedure Pack",
    slug: "general-procedure-pack",
  }]);
  const endBuyer = scoreProspect(
    hardNegativeCandidate({
      name: "Synthetic public hospital procurement body",
      organizationType: "HEALTHCARE_PROVIDER",
      description:
        "Public hospital procurement organization and contracting authority",
      evidence: [{
        sourceType: "COMPANY_WEBSITE",
        sourceUrl: "https://hard-negative.test/public-procurement",
        sourceDomain: "hard-negative.test",
        title: "General Procedure Pack procurement",
        snippet:
          "Public hospital purchasing and contracting authority for general procedure packs",
        evidenceKind: "WEAK_CONTEXT",
        confidence: 0.9,
        evidenceDate: "2026-09-01",
      }],
    }),
    BENCHMARK_NOW,
    gppProfile,
  );
  assert(
    endBuyer.salesProspectClassification === "END_BUYER_PROCUREMENT_SIGNAL",
    "a public procurer must remain a demand signal, not a direct sales prospect",
  );
  assert(
    !endBuyer.displayable,
    "an end-buyer procurement body must not enter the direct-commercial pool",
  );

  const manufacturer = scoreProspect(
    hardNegativeCandidate({
      name: "Synthetic general procedure pack manufacturer",
      companyType: "Manufacturer",
      description: "Medical manufacturer product catalogue",
      evidence: [{
        sourceType: "PRODUCT_CATALOGUE",
        sourceUrl: "https://hard-negative.test/manufacturer-catalogue",
        sourceDomain: "hard-negative.test",
        title: "General Procedure Pack",
        snippet: "Medical manufacturer of general procedure packs",
        evidenceKind: "WEAK_CONTEXT",
        confidence: 0.9,
        evidenceDate: "2026-09-01",
      }],
    }),
    BENCHMARK_NOW,
    gppProfile,
  );
  assert(
    manufacturer.salesProspectClassification === "PRODUCT_RELEVANT_NOT_BUYER",
    "a competitor/manufacturer needs purchasing or sourcing evidence to become a prospect",
  );
  assert(
    !manufacturer.displayable,
    "manufacturer-only product relevance must not enter the direct-commercial pool",
  );
});

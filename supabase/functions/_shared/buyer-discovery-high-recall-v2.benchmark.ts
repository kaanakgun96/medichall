import {
  deduplicateCandidates,
  type EvidenceSourceType,
  type ProspectCandidate,
  rankProspects,
} from "./external-prospect-discovery.ts";
import {
  buildProductFamilyProfile,
  type ProductFamilyProfile,
  type ProspectTier,
} from "./buyer-discovery-relevance-v2.ts";
import {
  HIGH_RECALL_BENCHMARK_FIXTURES,
  type HighRecallBenchmarkFixture,
} from "./fixtures/buyer-discovery-high-recall-v2.fixtures.ts";

const BENCHMARK_NOW = new Date("2026-09-04T00:00:00.000Z");

const EUROPE_MARKETS = [
  ["GB", "United Kingdom", "UK_IRELAND"],
  ["IE", "Ireland", "UK_IRELAND"],
  ["DE", "Germany", "DACH"],
  ["AT", "Austria", "DACH"],
  ["CH", "Switzerland", "DACH"],
  ["FR", "France", "FRANCE_BENELUX"],
  ["BE", "Belgium", "FRANCE_BENELUX"],
  ["NL", "Netherlands", "FRANCE_BENELUX"],
  ["IT", "Italy", "ITALY"],
  ["ES", "Spain", "IBERIA"],
  ["PT", "Portugal", "IBERIA"],
  ["DK", "Denmark", "NORDICS"],
  ["SE", "Sweden", "NORDICS"],
  ["NO", "Norway", "NORDICS"],
  ["PL", "Poland", "CENTRAL_EUROPE"],
  ["CZ", "Czechia", "CENTRAL_EUROPE"],
  ["RO", "Romania", "EASTERN_EUROPE"],
  ["GR", "Greece", "EASTERN_EUROPE"],
] as const;

const COMMERCIAL_ROLES = [
  {
    companyType: "Distributor" as const,
    text: "medical device distributor with a multi-brand clinical portfolio",
  },
  {
    companyType: "Importer" as const,
    text: "medical device importer and local commercial channel partner",
  },
  {
    companyType: "Hospital supplier" as const,
    text: "hospital supplier providing clinical supplies to care providers",
  },
  {
    companyType: "Distributor" as const,
    text: "framework supplier and commercial supplier to hospitals",
  },
  {
    companyType: "Mixed" as const,
    text: "medical OEM private-label sourcing partner",
  },
] as const;

export type HighRecallBenchmarkReport = {
  key: string;
  product: string;
  profile: HighRecallBenchmarkFixture["profile"];
  rawObservations: number;
  uniqueDomains: number;
  uniqueCompanies: number;
  duplicatesRemoved: number;
  medicalCommercialCompanies: number;
  tiers: Record<ProspectTier, number>;
  displayableTotal: number;
  countryCoverage: string[];
  regionalCoverage: string[];
  archetypeCoverage: string[];
  oldArchitectureRetained: number;
  oldArchitectureDiscarded: number;
  oldCapDiscarded: number;
  oldEvidenceGateDiscarded: number;
};

export function buildHighRecallBenchmarkProfile(
  fixture: HighRecallBenchmarkFixture,
): ProductFamilyProfile {
  const base = buildProductFamilyProfile([{
    taxonomyId: 90_000 +
      HIGH_RECALL_BENCHMARK_FIXTURES.findIndex((item) =>
        item.key === fixture.key
      ),
    canonicalName: fixture.product,
    slug: fixture.slug,
    aliases: fixture.aliases,
    familyName: fixture.categoryTerm,
    familySlug: `${fixture.slug}-commercial-family`,
  }]);
  return {
    ...base,
    categoryTerms: [fixture.categoryTerm],
    clinicalContextTerms: ["clinical care pathway"],
    commercialChannelTerms: [
      "medical device distributor",
      "medical device importer",
      "hospital supplier",
      "framework supplier",
      "private label sourcing partner",
    ],
  };
}

function officialEvidence(
  fixture: HighRecallBenchmarkFixture,
  index: number,
  text: string,
  sourceType: EvidenceSourceType = "COMPANY_WEBSITE",
) {
  const domain = `${fixture.key}-${String(index).padStart(3, "0")}.test`;
  return {
    sourceType,
    sourceUrl: `https://${domain}/products`,
    sourceDomain: domain,
    title: `Official medical commercial catalogue ${index}`,
    snippet: text,
    evidenceKind: "WEAK_CONTEXT" as const,
    confidence: 0.92,
    evidenceDate: "2026-09-01",
    taxonomyIds: [90_000],
  };
}

function commercialCandidate(
  fixture: HighRecallBenchmarkFixture,
  index: number,
  tier: "strong" | "likely" | "potential",
): ProspectCandidate {
  const [countryCode, countryName] =
    EUROPE_MARKETS[index % EUROPE_MARKETS.length];
  const role = COMMERCIAL_ROLES[index % COMMERCIAL_ROLES.length];
  const domain = `${fixture.key}-${String(index).padStart(3, "0")}.test`;
  const productContext = tier === "strong"
    ? `${fixture.product}. ${role.text}. Medical clinical product catalogue.`
    : tier === "likely"
    ? `${fixture.categoryTerm}. ${role.text}. Medical clinical product portfolio.`
    : `${role.text}. Medical clinical supplies portfolio.`;
  return {
    name: `Fixture ${fixture.key} commercial company ${
      String(index).padStart(3, "0")
    }`,
    nameSource: "OFFICIAL_WEBSITE",
    countryCode,
    countryName,
    cityRegion: null,
    companyType: role.companyType,
    websiteUrl: `https://${domain}/`,
    registryIdentifier: null,
    description: productContext,
    evidence: [officialEvidence(fixture, index, productContext)],
    activities: [],
    taxonomyIds: tier === "strong" ? [90_000] : [],
    taxonomyRelation: tier === "strong" ? "exact" : "none",
    targetCountry: true,
    preferredCompanyType: true,
    relatedAwardCount: 0,
    lastEvidenceAt: "2026-09-01",
    discoverySources: ["PUBLIC_WEB"],
    organizationType: "COMMERCIAL_COMPANY",
    identityConfidence: "HIGH",
    commercialIdentityVerified: true,
    medicalCommercialIdentityVerified: true,
    websiteCandidateSignals: {
      verificationScore: 95,
      domainClass: "LIKELY_OFFICIAL",
      medicalContext: true,
      commercialRoleContext: true,
      productPageContext: tier === "strong",
    },
  };
}

function lowConfidenceCandidate(
  fixture: HighRecallBenchmarkFixture,
  index: number,
): ProspectCandidate {
  const [countryCode, countryName] =
    EUROPE_MARKETS[index % EUROPE_MARKETS.length];
  const domain = `benchmark-low-${fixture.key.length}-${
    String(index).padStart(3, "0")
  }.test`;
  const variant = index % 4;
  if (variant === 0) {
    const text =
      `${fixture.categoryTerm}. Medical manufacturer product catalogue.`;
    return {
      ...commercialCandidate(fixture, 10_000 + index, "likely"),
      name: `Fixture medical manufacturer ${fixture.key.length}-${index}`,
      companyType: "Manufacturer",
      websiteUrl: `https://${domain}/`,
      description: text,
      evidence: [{
        ...officialEvidence(fixture, 10_000 + index, text),
        sourceUrl: `https://${domain}/portfolio`,
        sourceDomain: domain,
      }],
    };
  }
  if (variant === 1) {
    const text =
      `${fixture.categoryTerm}. Public hospital procurement organization and contracting authority.`;
    return {
      ...commercialCandidate(fixture, 20_000 + index, "likely"),
      name: `Fixture public procurer ${fixture.key.length}-${index}`,
      companyType: "Unknown",
      websiteUrl: `https://${domain}/`,
      description: text,
      evidence: [{
        ...officialEvidence(fixture, 20_000 + index, text),
        sourceUrl: `https://${domain}/procurement`,
        sourceDomain: domain,
      }],
      organizationType: "HEALTHCARE_PROVIDER",
    };
  }
  if (variant === 2) {
    return {
      ...commercialCandidate(fixture, 30_000 + index, "potential"),
      name: `Fixture registry-only entity ${fixture.key.length}-${index}`,
      countryCode,
      countryName,
      websiteUrl: null,
      registryIdentifier: `FIXTURE-${fixture.key}-${index}`,
      companyType: "Distributor",
      description: "Official activity: wholesale of medical goods",
      evidence: [{
        ...officialEvidence(
          fixture,
          30_000 + index,
          "Wholesale of medical goods",
          "PUBLIC_REGISTRY",
        ),
        sourceUrl: `https://registry.example.test/${fixture.key}/${index}`,
        sourceDomain: "registry.example.test",
      }],
      discoverySources: ["REGISTRY"],
      commercialIdentityVerified: false,
      medicalCommercialIdentityVerified: false,
    };
  }
  return {
    ...commercialCandidate(fixture, 40_000 + index, "potential"),
    name: `Fixture unverified listing ${fixture.key.length}-${index}`,
    websiteUrl: `https://${domain}/`,
    evidence: [{
      ...officialEvidence(
        fixture,
        40_000 + index,
        "Unverified generic company listing",
        "OTHER_PUBLIC_SOURCE",
      ),
      sourceUrl: `https://listing.example.test/${fixture.key}/${index}`,
      sourceDomain: "listing.example.test",
    }],
    commercialIdentityVerified: false,
    medicalCommercialIdentityVerified: false,
  };
}

function hardRejectCandidate(
  fixture: HighRecallBenchmarkFixture,
  index: number,
): ProspectCandidate {
  const variant = index % 3;
  const domainClass = variant === 0
    ? "EDITORIAL" as const
    : variant === 1
    ? "DIRECTORY" as const
    : "MARKETPLACE" as const;
  const sourceType: EvidenceSourceType = variant === 0
    ? "OTHER_PUBLIC_SOURCE"
    : variant === 1
    ? "ASSOCIATION_DIRECTORY"
    : "OTHER_PUBLIC_SOURCE";
  const domain = `${fixture.key}-reject-${index}.test`;
  return {
    ...commercialCandidate(fixture, 50_000 + index, "potential"),
    name: `Fixture ${fixture.key} rejected source ${index}`,
    websiteUrl: `https://${domain}/`,
    description:
      "Generic article or third-party listing with no verified company page",
    evidence: [{
      ...officialEvidence(
        fixture,
        50_000 + index,
        "Generic medical article or third-party product listing",
        sourceType,
      ),
      sourceUrl: `https://${domain}/listing`,
      sourceDomain: domain,
    }],
    editorialContent: variant === 0,
    organizationType: variant === 0 ? "EDITORIAL_PUBLISHER" : "UNKNOWN",
    commercialIdentityVerified: false,
    medicalCommercialIdentityVerified: false,
    websiteCandidateSignals: {
      verificationScore: 5,
      domainClass,
      medicalContext: true,
      commercialRoleContext: false,
      productPageContext: false,
    },
  };
}

export function buildHighRecallBenchmarkObservations(
  fixture: HighRecallBenchmarkFixture,
): ProspectCandidate[] {
  const unique: ProspectCandidate[] = [];
  let sequence = 0;
  for (let index = 0; index < fixture.tiers.strong; index++) {
    unique.push(commercialCandidate(fixture, sequence++, "strong"));
  }
  for (let index = 0; index < fixture.tiers.likely; index++) {
    unique.push(commercialCandidate(fixture, sequence++, "likely"));
  }
  for (let index = 0; index < fixture.tiers.potential; index++) {
    unique.push(commercialCandidate(fixture, sequence++, "potential"));
  }
  for (let index = 0; index < fixture.tiers.lowConfidence; index++) {
    unique.push(lowConfidenceCandidate(fixture, index));
  }
  for (let index = 0; index < fixture.tiers.hardReject; index++) {
    unique.push(hardRejectCandidate(fixture, index));
  }

  // Simulate overlapping multilingual/query-wave observations of the same
  // companies. Production deduplication, not the fixture, collapses them.
  const observations = [...unique];
  for (let index = unique.length; index < fixture.rawObservations; index++) {
    const original = unique[index % unique.length];
    observations.push({
      ...original,
      evidence: original.evidence.map((item) => ({ ...item })),
      discoverySources: [...(original.discoverySources || [])],
    });
  }
  return observations;
}

export function runHighRecallBenchmark(
  fixture: HighRecallBenchmarkFixture,
): HighRecallBenchmarkReport {
  const raw = buildHighRecallBenchmarkObservations(fixture);
  const deduplicated = deduplicateCandidates(raw);
  const ranked = rankProspects(
    deduplicated.candidates,
    buildHighRecallBenchmarkProfile(fixture),
    {
      europeWide: true,
      now: BENCHMARK_NOW,
    },
  );
  const countryCoverage = [
    ...new Set(
      ranked.accepted.map((item) => item.candidate.countryCode || "UNKNOWN"),
    ),
  ].sort();
  const regionByCountry = new Map<string, string>(
    EUROPE_MARKETS.map(([country, _name, region]) => [country, region]),
  );
  const regionalCoverage = [
    ...new Set(
      countryCoverage.map((country) => regionByCountry.get(country) || "OTHER"),
    ),
  ].sort();
  const archetypeCoverage = [
    ...new Set(ranked.accepted.flatMap((item) =>
      item.score.buyerArchetypes
        .filter((signal) => signal.archetype !== "UNKNOWN")
        .map((signal) => signal.archetype)
    )),
  ].sort();
  const oldEligible =
    ranked.accepted.filter((item) =>
      item.score.commercialBuyerGrade === "DIRECT_BUYER" ||
      item.score.commercialBuyerGrade === "ADJACENT_BUYER"
    ).length;
  const oldArchitectureRetained = Math.min(30, oldEligible);
  const oldArchitectureDiscarded = Math.max(
    0,
    ranked.accepted.length - oldArchitectureRetained,
  );
  return {
    key: fixture.key,
    product: fixture.product,
    profile: fixture.profile,
    rawObservations: raw.length,
    uniqueDomains: new Set(
      deduplicated.candidates.map((candidate) =>
        candidate.websiteUrl
          ? new URL(candidate.websiteUrl).hostname
          : `${candidate.countryCode}:${candidate.registryIdentifier}`
      ),
    ).size,
    uniqueCompanies: deduplicated.candidates.length,
    duplicatesRemoved: deduplicated.externalDuplicates,
    medicalCommercialCompanies:
      deduplicated.candidates.filter((candidate) =>
        candidate.medicalCommercialIdentityVerified === true
      ).length,
    tiers: ranked.diagnostics.prospectTiers,
    displayableTotal: ranked.accepted.length,
    countryCoverage,
    regionalCoverage,
    archetypeCoverage,
    oldArchitectureRetained,
    oldArchitectureDiscarded,
    oldCapDiscarded: Math.max(0, oldEligible - oldArchitectureRetained),
    oldEvidenceGateDiscarded: Math.max(0, ranked.accepted.length - oldEligible),
  };
}

export function runHighRecallBenchmarkMatrix(): HighRecallBenchmarkReport[] {
  return HIGH_RECALL_BENCHMARK_FIXTURES.map(runHighRecallBenchmark);
}

if (import.meta.main) {
  console.log(JSON.stringify(
    {
      kind: "SYNTHETIC_LOCAL_CAPACITY_MODEL",
      generatedAt: BENCHMARK_NOW.toISOString(),
      providerCalls: 0,
      productionDataUsed: false,
      results: runHighRecallBenchmarkMatrix(),
    },
    null,
    2,
  ));
}

import {
  type ActivitySignal,
  normalizeActivitySignal,
  type ProspectCandidate,
  sanitizeEvidenceText,
} from "./external-prospect-discovery.ts";

export type RegistryRuntimeStatus =
  | "ACTIVE"
  | "PARTIAL"
  | "DISABLED_PENDING_LEGAL_REVIEW"
  | "UNAVAILABLE";

export type RegistryProviderCost = "FREE" | "PAID" | "METERED" | "UNKNOWN";

export type RegistryAccessMode =
  | "ACTIVITY_SEARCH"
  | "IDENTIFIER_LOOKUP"
  | "LICENSED_SNAPSHOT"
  | "NONE";

export type RegistryCoverage = {
  providerCode: string;
  countryCode: string;
  countryName: string;
  sourceOwner: string;
  sourceName: string;
  documentationUrl: string;
  accessMode: RegistryAccessMode;
  authentication: "NONE" | "API_KEY" | "ACCOUNT" | "CONTRACT";
  classification: string;
  status: RegistryRuntimeStatus;
  runtimeEnabled: boolean;
  activitySignalAvailable: boolean;
  companyDiscoveryAvailable: boolean;
  cost: RegistryProviderCost;
  license: string;
  commercialReuse: "PERMITTED" | "RESTRICTED" | "UNCLEAR";
  cacheTtlDays: number;
  maximumRequestsPerRun: number;
  rateLimitNote: string;
  limitation: string;
};

export type RegistryCandidate = {
  name: string;
  legalName: string;
  countryCode: string;
  countryName: string;
  cityRegion: string | null;
  registeredAddress: string | null;
  registryIdentifier: string;
  entityStatus: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  sourceUrl: string;
  sourceTitle: string;
  sourceReference: string;
  verifiedAt: string;
  providerConfidence: number;
  activity: ActivitySignal;
};

export type RegistryLookupSeed = Pick<
  ProspectCandidate,
  "name" | "countryCode" | "cityRegion" | "registryIdentifier"
>;

export type RegistryRequest = {
  providerCode: string;
  countryCode: string;
  url: string;
  maximumResults: number;
  cacheTtlDays: number;
  minimumIntervalMs: number;
  seed?: RegistryLookupSeed;
};

export type RegistryAdapter = {
  providerCode: string;
  countryCode: string;
  coverage: RegistryCoverage;
  buildRequests(seeds?: RegistryLookupSeed[]): RegistryRequest[];
  parse(
    payload: unknown,
    sourceUrl: string,
    seed?: RegistryLookupSeed,
  ): RegistryCandidate[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown, maximum = 500): string {
  return sanitizeEvidenceText(value, maximum);
}

// Typed official-registry fields can resemble telephone numbers. They are not
// free text, so preserve them while all descriptions continue through contact
// redaction. No adapter reads contact, officer, shareholder or employee fields.
function registryField(value: unknown, maximum = 500): string {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim()
    .slice(0, maximum);
}

function coverage(
  value: Omit<RegistryCoverage, "runtimeEnabled"> & {
    runtimeEnabled?: boolean;
  },
): RegistryCoverage {
  return Object.freeze({
    ...value,
    runtimeEnabled: value.runtimeEnabled === true,
  });
}

export const REGISTRY_COVERAGE: readonly RegistryCoverage[] = Object.freeze([
  coverage({
    providerCode: "FR_RECHERCHE_ENTREPRISES",
    countryCode: "FR",
    countryName: "France",
    sourceOwner: "French State / DINUM",
    sourceName: "API Recherche d'entreprises",
    documentationUrl: "https://recherche-entreprises.api.gouv.fr/docs/",
    accessMode: "ACTIVITY_SEARCH",
    authentication: "NONE",
    classification: "NAF/APE",
    status: "ACTIVE",
    runtimeEnabled: true,
    activitySignalAvailable: true,
    companyDiscoveryAvailable: true,
    cost: "FREE",
    license: "MIT API; underlying public administrative data",
    commercialReuse: "PERMITTED",
    cacheTtlDays: 90,
    maximumRequestsPerRun: 2,
    rateLimitNote: "Two bounded activity searches per run; sequential access.",
    limitation:
      "Only diffusible active legal entities with a company name are retained.",
  }),
  coverage({
    providerCode: "NO_BRREG_ENHETSREGISTERET",
    countryCode: "NO",
    countryName: "Norway",
    sourceOwner: "Brønnøysund Register Centre",
    sourceName: "Central Coordinating Register for Legal Entities Open Data",
    documentationUrl:
      "https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html",
    accessMode: "ACTIVITY_SEARCH",
    authentication: "NONE",
    classification: "SN2007 / SN2025",
    status: "ACTIVE",
    runtimeEnabled: true,
    activitySignalAvailable: true,
    companyDiscoveryAvailable: true,
    cost: "FREE",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
    commercialReuse: "PERMITTED",
    cacheTtlDays: 90,
    maximumRequestsPerRun: 1,
    rateLimitNote: "One bounded activity search per run; sequential access.",
    limitation: "Sole proprietorships are excluded to avoid named-person data.",
  }),
  coverage({
    providerCode: "DE_UNTERNEHMENSREGISTER",
    countryCode: "DE",
    countryName: "Germany",
    sourceOwner: "German Federal Ministry of Justice / Bundesanzeiger Verlag",
    sourceName: "Unternehmensregister",
    documentationUrl: "https://www.unternehmensregister.de/en",
    accessMode: "NONE",
    authentication: "ACCOUNT",
    classification: "WZ 2008 / WZ 2025",
    status: "DISABLED_PENDING_LEGAL_REVIEW",
    activitySignalAvailable: false,
    companyDiscoveryAvailable: false,
    cost: "UNKNOWN",
    license:
      "Register terms; no approved reusable company/activity API located",
    commercialReuse: "UNCLEAR",
    cacheTtlDays: 180,
    maximumRequestsPerRun: 0,
    rateLimitNote: "No automated requests are made.",
    limitation: "Public interactive search is not treated as a bulk-reuse API.",
  }),
  coverage({
    providerCode: "IT_REGISTRO_IMPRESE",
    countryCode: "IT",
    countryName: "Italy",
    sourceOwner: "Italian Chambers of Commerce / InfoCamere",
    sourceName: "Registro Imprese",
    documentationUrl:
      "https://accessoallebanchedati.registroimprese.it/abdo/api",
    accessMode: "NONE",
    authentication: "CONTRACT",
    classification: "ATECO 2025",
    status: "DISABLED_PENDING_LEGAL_REVIEW",
    activitySignalAvailable: false,
    companyDiscoveryAvailable: false,
    cost: "PAID",
    license: "Contracted commercial database service",
    commercialReuse: "RESTRICTED",
    cacheTtlDays: 180,
    maximumRequestsPerRun: 0,
    rateLimitNote: "No automated requests are made.",
    limitation: "No paid dependency may be enabled without explicit approval.",
  }),
  coverage({
    providerCode: "ES_REGISTRO_MERCANTIL_DIRCE",
    countryCode: "ES",
    countryName: "Spain",
    sourceOwner: "Registro Mercantil / Instituto Nacional de Estadística",
    sourceName: "Registro Mercantil and DIRCE",
    documentationUrl:
      "https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736160707&idp=1254735576550",
    accessMode: "NONE",
    authentication: "NONE",
    classification: "CNAE 2009 / CNAE 2025",
    status: "UNAVAILABLE",
    activitySignalAvailable: false,
    companyDiscoveryAvailable: false,
    cost: "UNKNOWN",
    license:
      "DIRCE publishes aggregate statistics, not reusable entity microdata",
    commercialReuse: "UNCLEAR",
    cacheTtlDays: 180,
    maximumRequestsPerRun: 0,
    rateLimitNote: "No automated requests are made.",
    limitation:
      "No official reusable entity-level activity endpoint was verified.",
  }),
  coverage({
    providerCode: "NL_KVK_HVDS",
    countryCode: "NL",
    countryName: "Netherlands",
    sourceOwner: "Kamer van Koophandel",
    sourceName: "KVK Handelsregister Open Dataset Basic Company Information",
    documentationUrl:
      "https://developers.kvk.nl/en/documentation/open-dataset-basis-bedrijfsgegevens-api",
    accessMode: "IDENTIFIER_LOOKUP",
    authentication: "NONE",
    classification: "SBI 2008",
    status: "DISABLED_PENDING_LEGAL_REVIEW",
    activitySignalAvailable: true,
    companyDiscoveryAvailable: false,
    cost: "FREE",
    license:
      "CC BY 4.0 with a specific no-reidentification enrichment restriction",
    commercialReuse: "RESTRICTED",
    cacheTtlDays: 180,
    maximumRequestsPerRun: 0,
    rateLimitNote:
      "Official limit is one request per IP per minute; runtime disabled.",
    limitation:
      "Linking omitted KVK identity fields to TED names needs legal approval.",
  }),
  coverage({
    providerCode: "BE_CBE_OPEN_DATA",
    countryCode: "BE",
    countryName: "Belgium",
    sourceOwner: "Belgian FPS Economy",
    sourceName: "Crossroads Bank for Enterprises Open Data",
    documentationUrl:
      "https://kbopub.economie.fgov.be/kbo-open-data/login?lang=en",
    accessMode: "LICENSED_SNAPSHOT",
    authentication: "ACCOUNT",
    classification: "NACE-BEL 2008 / 2025",
    status: "DISABLED_PENDING_LEGAL_REVIEW",
    activitySignalAvailable: true,
    companyDiscoveryAvailable: true,
    cost: "FREE",
    license: "CBE Open Data contractual licence",
    commercialReuse: "RESTRICTED",
    cacheTtlDays: 30,
    maximumRequestsPerRun: 0,
    rateLimitNote:
      "Daily licensed CSV delivery; no browser-style runtime requests.",
    limitation:
      "Registration, purpose declaration and direct-marketing restriction require review.",
  }),
  coverage({
    providerCode: "PL_KRS_OPEN_API",
    countryCode: "PL",
    countryName: "Poland",
    sourceOwner: "Polish Ministry of Justice",
    sourceName: "National Court Register Open API",
    documentationUrl:
      "https://www.gov.pl/web/sprawiedliwosc/uruchomienie-otwartego-api-krajowego-rejestru-sadowego",
    accessMode: "IDENTIFIER_LOOKUP",
    authentication: "NONE",
    classification: "PKD 2007 / PKD 2025",
    status: "PARTIAL",
    runtimeEnabled: true,
    activitySignalAvailable: true,
    companyDiscoveryAvailable: false,
    cost: "FREE",
    license: "Polish Open Data and Re-use of Public Sector Information Act",
    commercialReuse: "PERMITTED",
    cacheTtlDays: 180,
    maximumRequestsPerRun: 1,
    rateLimitNote:
      "One sequential KRS lookup per run; provider limit is undocumented.",
    limitation:
      "Lookup requires an explicit KRS-prefixed identifier; it is not a name search.",
  }),
]);

function coverageFor(providerCode: string): RegistryCoverage {
  const result = REGISTRY_COVERAGE.find((item) =>
    item.providerCode === providerCode
  );
  if (!result) throw new Error(`Missing registry coverage: ${providerCode}`);
  return result;
}

function candidate(
  input: Omit<RegistryCandidate, "verifiedAt" | "providerConfidence"> & {
    verifiedAt?: string;
    providerConfidence?: number;
  },
): RegistryCandidate {
  return {
    ...input,
    verifiedAt: input.verifiedAt || new Date().toISOString(),
    providerConfidence: Math.max(
      0,
      Math.min(1, input.providerConfidence ?? 0.82),
    ),
  };
}

export const francePublicRegistryAdapter: RegistryAdapter = {
  providerCode: "FR_RECHERCHE_ENTREPRISES",
  countryCode: "FR",
  coverage: coverageFor("FR_RECHERCHE_ENTREPRISES"),
  buildRequests() {
    return ["46.46Z", "46.69B"].map((activity) => ({
      providerCode: this.providerCode,
      countryCode: this.countryCode,
      url:
        `https://recherche-entreprises.api.gouv.fr/search?activite_principale=${
          encodeURIComponent(activity)
        }&etat_administratif=A&minimal=true&include=siege&page=1&per_page=10`,
      maximumResults: 10,
      cacheTtlDays: this.coverage.cacheTtlDays,
      minimumIntervalMs: 250,
    }));
  },
  parse(payload, _sourceUrl) {
    return array(record(payload).results).slice(0, 10).flatMap((value) => {
      const item = record(value);
      const headquarters = record(item.siege);
      // `nom_complet` can contain a sole trader's personal name. Require the
      // legal-company field and never read director/contact payload branches.
      const name = registryField(item.nom_raison_sociale, 240);
      const identifier = registryField(item.siren, 40);
      const code = registryField(
        item.activite_principale || headquarters.activite_principale,
        40,
      );
      if (!name || !identifier || !code) return [];
      const activity = normalizeActivitySignal({
        providerCode: this.providerCode,
        countryCode: "FR",
        registryIdentifier: identifier,
        nationalCode: code,
        nationalClassification: "NAF/APE",
        description: string(
          item.libelle_activite_principale ||
            headquarters.libelle_activite_principale || code,
          500,
        ),
        effectiveFrom: registryField(headquarters.date_debut_activite, 20) ||
          null,
      });
      const recordUrl = `https://recherche-entreprises.api.gouv.fr/search?q=${
        encodeURIComponent(identifier)
      }&page=1&per_page=1`;
      const city = registryField(
        headquarters.libelle_commune || headquarters.commune,
        160,
      ) || null;
      return [candidate({
        name,
        legalName: name,
        countryCode: "FR",
        countryName: "France",
        cityRegion: city,
        registeredAddress: city,
        registryIdentifier: identifier,
        entityStatus: "ACTIVE",
        sourceUrl: recordUrl,
        sourceTitle: "French official business registry activity",
        sourceReference: identifier,
        activity,
      })];
    });
  },
};

export const norwayPublicRegistryAdapter: RegistryAdapter = {
  providerCode: "NO_BRREG_ENHETSREGISTERET",
  countryCode: "NO",
  coverage: coverageFor("NO_BRREG_ENHETSREGISTERET"),
  buildRequests() {
    return [{
      providerCode: this.providerCode,
      countryCode: this.countryCode,
      url:
        "https://data.brreg.no/enhetsregisteret/api/enheter?naeringskode=46.460&size=10",
      maximumResults: 10,
      cacheTtlDays: this.coverage.cacheTtlDays,
      minimumIntervalMs: 250,
    }];
  },
  parse(payload, _sourceUrl) {
    const embedded = record(record(payload)._embedded);
    return array(embedded.enheter).slice(0, 10).flatMap((value) => {
      const item = record(value);
      const organizationForm = record(item.organisasjonsform);
      if (registryField(organizationForm.kode, 20).toUpperCase() === "ENK") {
        return [];
      }
      const activityRecord = record(item.naeringskode1);
      const address = record(item.forretningsadresse);
      const name = registryField(item.navn, 240);
      const identifier = registryField(item.organisasjonsnummer, 40);
      const code = registryField(activityRecord.kode, 40);
      if (!name || !identifier || !code) return [];
      const activity = normalizeActivitySignal({
        providerCode: this.providerCode,
        countryCode: "NO",
        registryIdentifier: identifier,
        nationalCode: code,
        nationalClassification: "SN2025",
        description: string(activityRecord.beskrivelse || code, 500),
      });
      const recordUrl = `https://data.brreg.no/enhetsregisteret/api/enheter/${
        encodeURIComponent(identifier)
      }`;
      const city = registryField(address.poststed || address.kommune, 160) ||
        null;
      return [candidate({
        name,
        legalName: name,
        countryCode: "NO",
        countryName: "Norway",
        cityRegion: city,
        registeredAddress: city,
        registryIdentifier: identifier,
        entityStatus: item.slettedato ? "INACTIVE" : "ACTIVE",
        sourceUrl: recordUrl,
        sourceTitle: "Norwegian official business registry activity",
        sourceReference: identifier,
        activity,
      })];
    });
  },
};

function explicitKrsIdentifier(value: unknown): string | null {
  const match = registryField(value, 80).match(/^KRS[\s:#-]*(\d{10})$/i);
  return match?.[1] || null;
}

export const polandKrsRegistryAdapter: RegistryAdapter = {
  providerCode: "PL_KRS_OPEN_API",
  countryCode: "PL",
  coverage: coverageFor("PL_KRS_OPEN_API"),
  buildRequests(seeds = []) {
    const seen = new Set<string>();
    return seeds.filter((seed) => seed.countryCode === "PL").flatMap((seed) => {
      const krs = explicitKrsIdentifier(seed.registryIdentifier);
      if (!krs || seen.has(krs)) return [];
      seen.add(krs);
      return [{
        providerCode: this.providerCode,
        countryCode: this.countryCode,
        url:
          `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}?rejestr=P&format=json`,
        maximumResults: 12,
        cacheTtlDays: this.coverage.cacheTtlDays,
        minimumIntervalMs: 1_000,
        seed,
      }];
    }).slice(0, this.coverage.maximumRequestsPerRun);
  },
  parse(payload, sourceUrl, seed) {
    const extract = record(record(payload).odpis);
    const header = record(extract.naglowekA);
    const data = record(extract.dane);
    const sectionOne = record(data.dzial1);
    const entity = record(sectionOne.danePodmiotu);
    const seatAndAddress = record(sectionOne.siedzibaIAdres);
    const seat = record(seatAndAddress.siedziba);
    const sectionThree = record(data.dzial3);
    const business = record(sectionThree.przedmiotDzialalnosci);
    const krs = registryField(header.numerKRS, 20);
    const name = registryField(entity.nazwa || seed?.name, 240);
    if (!/^\d{10}$/.test(krs) || !name) return [];
    const activityRecords = [
      ...array(business.przedmiotPrzewazajacejDzialalnosci),
      ...array(business.przedmiotPozostalejDzialalnosci),
    ].slice(0, 25);
    const city = registryField(seat.miejscowosc, 160) || seed?.cityRegion ||
      null;
    return activityRecords.flatMap((value) => {
      const item = record(value);
      const division = registryField(item.kodDzial, 2);
      const group = registryField(item.kodKlasa, 2);
      const subclass = registryField(item.kodPodklasa, 1);
      const code = `${division}.${group}${subclass ? `.${subclass}` : ""}`;
      if (!/^\d{2}\.\d{2}(?:\.[A-Z])?$/.test(code)) return [];
      const activity = normalizeActivitySignal({
        providerCode: this.providerCode,
        countryCode: "PL",
        registryIdentifier: `KRS:${krs}`,
        nationalCode: code,
        nationalClassification: "PKD 2007",
        description: string(item.opis || code, 500),
        effectiveFrom: registryField(header.dataRejestracjiWKRS, 20) || null,
      });
      if (activity.strength === "NON_MATCH") return [];
      return [candidate({
        name,
        legalName: name,
        countryCode: "PL",
        countryName: "Poland",
        cityRegion: city,
        registeredAddress: city,
        registryIdentifier: `KRS:${krs}`,
        entityStatus:
          /WYKREŚL|USUNIĘ/i.test(registryField(header.stanPozycji, 80))
            ? "INACTIVE"
            : "ACTIVE",
        sourceUrl,
        sourceTitle: "Polish National Court Register activity",
        sourceReference: `KRS:${krs}`,
        activity,
        providerConfidence: 0.88,
      })];
    });
  },
};

export const OFFICIAL_REGISTRY_ADAPTERS: RegistryAdapter[] = [
  francePublicRegistryAdapter,
  norwayPublicRegistryAdapter,
  polandKrsRegistryAdapter,
];

export function registryCoverageForCountries(
  countryCodes: string[],
): RegistryCoverage[] {
  const wanted = new Set(countryCodes.map((item) => item.toUpperCase()));
  return REGISTRY_COVERAGE.filter((item) => wanted.has(item.countryCode));
}

export function registryAdaptersForCountries(
  countryCodes: string[],
): RegistryAdapter[] {
  const wanted = new Set(countryCodes.map((item) => item.toUpperCase()));
  return OFFICIAL_REGISTRY_ADAPTERS.filter((adapter) =>
    wanted.has(adapter.countryCode) && adapter.coverage.runtimeEnabled
  );
}

export function registryCandidatesFromCache(
  value: unknown,
): RegistryCandidate[] {
  return array(value).slice(0, 30).flatMap((candidateValue) => {
    const item = record(candidateValue);
    const activityValue = record(item.activity);
    const name = registryField(item.name, 240);
    const legalName = registryField(item.legalName || item.name, 240);
    const countryCode = registryField(item.countryCode, 2).toUpperCase();
    const registryIdentifier = registryField(item.registryIdentifier, 240);
    const sourceUrl = registryField(item.sourceUrl, 1200);
    const nationalCode = registryField(activityValue.nationalCode, 40);
    const classification = registryField(
      activityValue.nationalClassification,
      80,
    );
    if (
      !name || !legalName || !/^[A-Z]{2}$/.test(countryCode) ||
      !registryIdentifier || !sourceUrl.startsWith("https://") ||
      !nationalCode || !classification
    ) return [];
    const activity = normalizeActivitySignal({
      providerCode: registryField(activityValue.providerCode, 80),
      countryCode,
      registryIdentifier,
      nationalCode,
      nationalClassification: classification,
      description: string(activityValue.description, 500),
      naceCode: registryField(activityValue.normalizedNaceCode, 20) || null,
      naceRevision: ["NACE_REV_2", "NACE_REV_2_1", "NATIONAL_ONLY"].includes(
          registryField(activityValue.naceRevision, 20),
        )
        ? activityValue.naceRevision as ActivitySignal["naceRevision"]
        : "NATIONAL_ONLY",
      mappingConfidence: ["HIGH", "MEDIUM", "LOW", "UNMAPPED"].includes(
          registryField(activityValue.mappingConfidence, 20),
        )
        ? activityValue.mappingConfidence as ActivitySignal["mappingConfidence"]
        : "UNMAPPED",
      effectiveFrom: registryField(activityValue.effectiveFrom, 20) || null,
    });
    return [candidate({
      name,
      legalName,
      countryCode,
      countryName: registryField(item.countryName, 120),
      cityRegion: registryField(item.cityRegion, 160) || null,
      registeredAddress: registryField(item.registeredAddress, 160) || null,
      registryIdentifier,
      entityStatus: ["ACTIVE", "INACTIVE", "UNKNOWN"].includes(
          registryField(item.entityStatus, 20),
        )
        ? item.entityStatus as RegistryCandidate["entityStatus"]
        : "UNKNOWN",
      sourceUrl,
      sourceTitle: string(item.sourceTitle, 300),
      sourceReference: registryField(item.sourceReference, 240),
      verifiedAt: registryField(item.verifiedAt, 40),
      providerConfidence: Number(item.providerConfidence),
      activity,
    })];
  });
}

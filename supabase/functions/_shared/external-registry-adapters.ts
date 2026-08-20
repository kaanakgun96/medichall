import {
  type ActivitySignal,
  normalizeActivitySignal,
  sanitizeEvidenceText,
} from "./external-prospect-discovery.ts";

export type RegistryCandidate = {
  name: string;
  countryCode: string;
  countryName: string;
  cityRegion: string | null;
  registryIdentifier: string;
  sourceUrl: string;
  sourceTitle: string;
  activity: ActivitySignal;
};

export type RegistryRequest = {
  providerCode: string;
  countryCode: string;
  url: string;
  maximumResults: number;
};

export type RegistryAdapter = {
  providerCode: string;
  countryCode: string;
  buildRequests(): RegistryRequest[];
  parse(payload: unknown, sourceUrl: string): RegistryCandidate[];
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

export const francePublicRegistryAdapter: RegistryAdapter = {
  providerCode: "FR_RECHERCHE_ENTREPRISES",
  countryCode: "FR",
  buildRequests() {
    return ["46.46Z", "46.69B"].map((activity) => ({
      providerCode: this.providerCode,
      countryCode: this.countryCode,
      url:
        `https://recherche-entreprises.api.gouv.fr/search?activite_principale=${
          encodeURIComponent(activity)
        }&etat_administratif=A&minimal=true&include=siege&page=1&per_page=10`,
      maximumResults: 10,
    }));
  },
  parse(payload, _sourceUrl) {
    return array(record(payload).results).slice(0, 10).flatMap((value) => {
      const item = record(value);
      const headquarters = record(item.siege);
      const name = string(item.nom_raison_sociale || item.nom_complet, 240);
      const identifier = string(item.siren, 40);
      const code = string(
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
        naceCode: code.replace(/[A-Z]$/i, ""),
        naceRevision: code === "46.46Z" || code === "46.69B"
          ? "NACE_REV_2"
          : "NATIONAL_ONLY",
        effectiveFrom: string(headquarters.date_debut_activite, 20) || null,
      });
      const recordUrl = `https://recherche-entreprises.api.gouv.fr/search?q=${
        encodeURIComponent(identifier)
      }&page=1&per_page=1`;
      return [{
        name,
        countryCode: "FR",
        countryName: "France",
        cityRegion:
          string(headquarters.libelle_commune || headquarters.commune, 160) ||
          null,
        registryIdentifier: identifier,
        sourceUrl: recordUrl,
        sourceTitle: "French official business registry activity",
        activity,
      }];
    });
  },
};

export const norwayPublicRegistryAdapter: RegistryAdapter = {
  providerCode: "NO_BRREG_ENHETSREGISTERET",
  countryCode: "NO",
  buildRequests() {
    return [{
      providerCode: this.providerCode,
      countryCode: this.countryCode,
      url:
        "https://data.brreg.no/enhetsregisteret/api/enheter?naeringskode=46.46&size=10",
      maximumResults: 10,
    }];
  },
  parse(payload, _sourceUrl) {
    const embedded = record(record(payload)._embedded);
    return array(embedded.enheter).slice(0, 10).flatMap((value) => {
      const item = record(value);
      const activityRecord = record(item.naeringskode1);
      const address = record(item.forretningsadresse);
      const name = string(item.navn, 240);
      const identifier = string(item.organisasjonsnummer, 40);
      const code = string(activityRecord.kode, 40);
      if (!name || !identifier || !code) return [];
      const activity = normalizeActivitySignal({
        providerCode: this.providerCode,
        countryCode: "NO",
        registryIdentifier: identifier,
        nationalCode: code,
        nationalClassification: "SN2007",
        description: string(activityRecord.beskrivelse || code, 500),
        naceCode: code,
        naceRevision: "NACE_REV_2",
      });
      const recordUrl = `https://data.brreg.no/enhetsregisteret/api/enheter/${
        encodeURIComponent(identifier)
      }`;
      return [{
        name,
        countryCode: "NO",
        countryName: "Norway",
        cityRegion: string(address.poststed || address.kommune, 160) || null,
        registryIdentifier: identifier,
        sourceUrl: recordUrl,
        sourceTitle: "Norwegian official business registry activity",
        activity,
      }];
    });
  },
};

export const OFFICIAL_REGISTRY_ADAPTERS: RegistryAdapter[] = [
  francePublicRegistryAdapter,
  norwayPublicRegistryAdapter,
];

export function registryAdaptersForCountries(
  countryCodes: string[],
): RegistryAdapter[] {
  const wanted = new Set(countryCodes.map((item) => item.toUpperCase()));
  return OFFICIAL_REGISTRY_ADAPTERS.filter((adapter) =>
    wanted.has(adapter.countryCode)
  );
}

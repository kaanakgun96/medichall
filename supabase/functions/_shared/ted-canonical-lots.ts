export const TED_SEARCH_ENDPOINT =
  "https://api.ted.europa.eu/v3/notices/search";

export const TED_CANONICAL_LOT_FIELDS = [
  "publication-number",
  "publication-date",
  "notice-title",
  "identifier-lot",
  "internal-identifier-lot",
  "title-lot",
  "description-lot",
  "main-classification-lot",
  "additional-classification-lot",
  "deadline-receipt-tender-date-lot",
  "estimated-value-lot",
  "estimated-value-cur-lot",
  "notice-type",
  "buyer-name",
  "links",
] as const;

export type TedCanonicalLot = {
  position: number;
  official_lot_identifier: string;
  internal_lot_identifier: string | null;
  lot_number: string;
  lot_title: string;
  description: string | null;
  cpv_codes: string[];
  deadline_at: string | null;
  estimated_value: number | null;
  currency: string | null;
  status: "active";
  source_type: "TED_STRUCTURED";
  publication_number: string;
  source_url: string;
  source_payload: Record<string, unknown>;
};

export type TedCanonicalNotice = {
  publication_number: string;
  publication_date: string | null;
  source_url: string;
  source_xml_url: string | null;
  official_lot_count: number;
  lots: TedCanonicalLot[];
  raw_notice: Record<string, unknown>;
};

export type CanonicalLotMappingCategory =
  | "ONE_CANONICAL_LOT"
  | "MULTIPLE_CANONICAL_LOTS"
  | "NOTICE_LEVEL"
  | "UNMAPPED";

export type CanonicalLotReferenceResolution = {
  category: CanonicalLotMappingCategory;
  canonical_lot_identifiers: string[];
  rejected_references: string[];
  mapping_methods: string[];
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type DataClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => PromiseLike<{
        error: { message: string } | null;
      }>;
    };
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum = 2_000): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringAt(
  value: unknown,
  index: number,
  maximum = 2_000,
): string | null {
  return text(array(value)[index], maximum);
}

function multilingualArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const values = record(value);
  for (const language of ["eng", "fra", "deu", "ita", "spa"]) {
    if (Array.isArray(values[language])) return values[language] as unknown[];
  }
  for (const candidate of Object.values(values)) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function decimalAt(value: unknown, index: number): number | null {
  const raw = stringAt(value, index, 80);
  if (!raw) return null;
  const normalized = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateAt(value: unknown, index: number): string | null {
  const raw = stringAt(value, index, 80);
  if (!raw) return null;
  const datePrefix = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return datePrefix || null;
}

function cpvAt(value: unknown, index: number): string | null {
  const digits = String(array(value)[index] ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function publicationNumber(value: unknown): string {
  const normalized = text(value, 40) || "";
  if (!/^\d{1,10}-\d{4}$/.test(normalized)) {
    throw new Error("TED publication number is missing or invalid");
  }
  return normalized;
}

function officialIdentifier(value: unknown): string {
  const normalized = text(value, 120)?.toUpperCase() || "";
  if (!normalized || !/^[A-Z0-9][A-Z0-9._:/-]{0,119}$/.test(normalized)) {
    throw new Error("TED canonical lot identifier is missing or invalid");
  }
  return normalized;
}

function sourceXmlUrl(links: unknown): string | null {
  const xml = record(record(links).xml);
  const candidate = text(xml.MUL || xml.ENG || Object.values(xml)[0], 1_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.hostname === "ted.europa.eu"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function parseTedCanonicalNotice(
  value: unknown,
): TedCanonicalNotice {
  const notice = record(value);
  const publication = publicationNumber(notice["publication-number"]);
  const identifiers = array(notice["identifier-lot"]);
  if (!identifiers.length) {
    throw new Error("TED structured notice contains no canonical lots");
  }
  if (identifiers.length > 1_000) {
    throw new Error("TED structured notice exceeds the canonical lot limit");
  }
  const internalIdentifiers = array(notice["internal-identifier-lot"]);
  const titles = multilingualArray(notice["title-lot"]);
  const descriptions = multilingualArray(notice["description-lot"]);
  const seen = new Set<string>();
  const sourceUrl = `https://ted.europa.eu/en/notice/-/detail/${publication}`;
  const lots = identifiers.map((rawIdentifier, index): TedCanonicalLot => {
    const identifier = officialIdentifier(rawIdentifier);
    if (seen.has(identifier)) {
      throw new Error(`TED structured notice repeats lot ${identifier}`);
    }
    seen.add(identifier);
    const internalIdentifier = stringAt(internalIdentifiers, index, 120);
    const title = stringAt(titles, index, 1_000);
    const description = stringAt(descriptions, index, 4_000);
    const mainCpv = cpvAt(notice["main-classification-lot"], index);
    const additionalCpv = cpvAt(
      notice["additional-classification-lot"],
      index,
    );
    const currency = stringAt(
      notice["estimated-value-cur-lot"],
      index,
      3,
    )?.toUpperCase() || null;
    return {
      position: index + 1,
      official_lot_identifier: identifier,
      internal_lot_identifier: internalIdentifier,
      lot_number: identifier,
      lot_title: title || description || "Untitled lot",
      description,
      cpv_codes: unique([mainCpv, additionalCpv]),
      deadline_at: dateAt(
        notice["deadline-receipt-tender-date-lot"],
        index,
      ),
      estimated_value: decimalAt(notice["estimated-value-lot"], index),
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      status: "active",
      source_type: "TED_STRUCTURED",
      publication_number: publication,
      source_url: sourceUrl,
      source_payload: {
        official_lot_identifier: identifier,
        internal_lot_identifier: internalIdentifier,
        title,
        description,
        main_cpv: mainCpv,
        additional_cpv: additionalCpv,
        deadline_at: dateAt(
          notice["deadline-receipt-tender-date-lot"],
          index,
        ),
        estimated_value: decimalAt(notice["estimated-value-lot"], index),
        currency,
      },
    };
  });
  return {
    publication_number: publication,
    publication_date: dateAt([notice["publication-date"]], 0),
    source_url: sourceUrl,
    source_xml_url: sourceXmlUrl(notice.links),
    official_lot_count: lots.length,
    lots,
    raw_notice: notice,
  };
}

function normalizedReference(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizedTitle(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formattedOfficialReference(value: string): string | null {
  const match = value.match(/^LOT(?:\s*(?:NO\.?|NUMBER))?[\s:_-]*(\d{1,8})$/i);
  if (!match) return null;
  return `LOT-${match[1].padStart(4, "0")}`;
}

function referenceCandidates(value: unknown): string[] {
  const raw = text(value, 500);
  if (!raw) return [];
  const explicit = raw.match(
    /\bLOT(?:\s*(?:NO\.?|NUMBER))?[\s:_-]*\d{1,8}\b/gi,
  );
  if (explicit?.length) return unique(explicit.map(normalizedReference));
  return [normalizedReference(raw)];
}

function canonicalIndexes(lots: readonly TedCanonicalLot[]) {
  const byOfficial = new Map<string, TedCanonicalLot>();
  const byInternal = new Map<string, TedCanonicalLot>();
  const byTitle = new Map<string, TedCanonicalLot[]>();
  for (const lot of lots) {
    byOfficial.set(normalizedReference(lot.official_lot_identifier), lot);
    if (lot.internal_lot_identifier) {
      byInternal.set(normalizedReference(lot.internal_lot_identifier), lot);
    }
    for (const candidate of [lot.lot_title, lot.description]) {
      const key = normalizedTitle(candidate);
      if (!key) continue;
      const titleLots = byTitle.get(key) || [];
      if (
        !titleLots.some((existing) =>
          existing.official_lot_identifier === lot.official_lot_identifier
        )
      ) {
        byTitle.set(key, [...titleLots, lot]);
      }
    }
  }
  return { byOfficial, byInternal, byTitle };
}

export function resolveCanonicalLotReference(
  lotReference: unknown,
  lotTitle: unknown,
  canonicalLots: readonly TedCanonicalLot[],
): CanonicalLotReferenceResolution {
  const indexes = canonicalIndexes(canonicalLots);
  const resolved = new Set<string>();
  const rejected: string[] = [];
  const methods = new Set<string>();
  const references = referenceCandidates(lotReference);
  for (const reference of references) {
    const direct = indexes.byOfficial.get(reference);
    const formatted = formattedOfficialReference(reference);
    const formattedMatch = formatted
      ? indexes.byOfficial.get(formatted)
      : undefined;
    const internal = indexes.byInternal.get(reference);
    const match = direct || formattedMatch || internal;
    if (match) {
      resolved.add(match.official_lot_identifier);
      methods.add(
        direct || formattedMatch
          ? "official_identifier"
          : "internal_identifier_alias",
      );
    } else {
      rejected.push(reference);
    }
  }
  if (!resolved.size) {
    const titleKey = normalizedTitle(lotTitle);
    const titleMatches = titleKey ? indexes.byTitle.get(titleKey) || [] : [];
    if (titleMatches.length === 1) {
      resolved.add(titleMatches[0].official_lot_identifier);
      methods.add("exact_official_title");
    } else if (titleMatches.length > 1) {
      rejected.push(String(lotTitle));
    }
  }
  const identifiers = [...resolved].sort();
  const category: CanonicalLotMappingCategory = identifiers.length > 1
    ? "MULTIPLE_CANONICAL_LOTS"
    : identifiers.length === 1
    ? "ONE_CANONICAL_LOT"
    : references.length || text(lotTitle)
    ? "UNMAPPED"
    : "NOTICE_LEVEL";
  return {
    category,
    canonical_lot_identifiers: identifiers,
    rejected_references: unique(rejected),
    mapping_methods: [...methods].sort(),
  };
}

export function reconcileChunkToCanonicalLots(
  analysisValue: unknown,
  canonicalLots: readonly TedCanonicalLot[],
): CanonicalLotReferenceResolution {
  const analysis = record(analysisValue);
  const candidates = [
    ...array(analysis.lots).map(record).map((lot) => ({
      reference: lot.lot_number,
      title: lot.lot_title,
    })),
    ...array(analysis.products).map(record).map((product) => ({
      reference: product.lot_number,
      title: null,
    })),
  ];
  if (
    !candidates.some((candidate) =>
      text(candidate.reference) || text(candidate.title)
    )
  ) {
    return {
      category: "NOTICE_LEVEL",
      canonical_lot_identifiers: [],
      rejected_references: [],
      mapping_methods: [],
    };
  }
  const identifiers = new Set<string>();
  const rejected: string[] = [];
  const methods = new Set<string>();
  for (const candidate of candidates) {
    const resolution = resolveCanonicalLotReference(
      candidate.reference,
      candidate.title,
      canonicalLots,
    );
    resolution.canonical_lot_identifiers.forEach((id) => identifiers.add(id));
    rejected.push(...resolution.rejected_references);
    resolution.mapping_methods.forEach((method) => methods.add(method));
  }
  const mapped = [...identifiers].sort();
  return {
    category: mapped.length > 1
      ? "MULTIPLE_CANONICAL_LOTS"
      : mapped.length === 1
      ? "ONE_CANONICAL_LOT"
      : "UNMAPPED",
    canonical_lot_identifiers: mapped,
    rejected_references: unique(rejected),
    mapping_methods: [...methods].sort(),
  };
}

export function reconcileAnalysisToCanonicalLots(
  analysisValue: unknown,
  canonicalLots: readonly TedCanonicalLot[],
): Record<string, unknown> {
  const analysis = record(analysisValue);
  if (!canonicalLots.length) return { ...analysis };
  const inferredByCanonical = new Map<string, Record<string, unknown>>();
  const rejected = new Set<string>();
  for (const rawLot of array(analysis.lots)) {
    const lot = record(rawLot);
    const resolution = resolveCanonicalLotReference(
      lot.lot_number,
      lot.lot_title,
      canonicalLots,
    );
    if (resolution.canonical_lot_identifiers.length === 1) {
      inferredByCanonical.set(resolution.canonical_lot_identifiers[0], lot);
    }
    resolution.rejected_references.forEach((item) => rejected.add(item));
  }
  const products = array(analysis.products).map((rawProduct) => {
    const product = record(rawProduct);
    const resolution = resolveCanonicalLotReference(
      product.lot_number,
      null,
      canonicalLots,
    );
    resolution.rejected_references.forEach((item) => rejected.add(item));
    return {
      ...product,
      source_lot_number: product.lot_number ?? null,
      lot_number: resolution.canonical_lot_identifiers.length === 1
        ? resolution.canonical_lot_identifiers[0]
        : null,
      lot_mapping_scope: resolution.category,
    };
  });
  const lots = canonicalLots.map((canonical) => {
    const inferred =
      inferredByCanonical.get(canonical.official_lot_identifier) || {};
    return {
      ...inferred,
      lot_number: canonical.official_lot_identifier,
      lot_title: canonical.lot_title,
      official_lot_identifier: canonical.official_lot_identifier,
      internal_lot_identifier: canonical.internal_lot_identifier,
      description: canonical.description,
      cpv_codes: canonical.cpv_codes,
      deadline_at: canonical.deadline_at,
      source_type: canonical.source_type,
      source_url: canonical.source_url,
      canonical_status: canonical.status,
    };
  });
  return {
    ...analysis,
    products,
    lots,
    canonical_only_lots: true,
    canonical_lot_count: canonicalLots.length,
    rejected_phantom_lot_references: [...rejected].sort(),
  };
}

export function canonicalLotCoverageSummary(
  mappings: readonly CanonicalLotReferenceResolution[],
  officialLotCount: number,
): string {
  const mapped = new Set(
    mappings.flatMap((mapping) => mapping.canonical_lot_identifiers),
  );
  if (!officialLotCount) return "";
  if (mapped.size === 1) {
    return `Document analysis contains evidence for ${
      [...mapped][0]
    }. The official TED notice contains ${officialLotCount} canonical lots.`;
  }
  if (mapped.size > 1) {
    return `Document analysis contains evidence mapped to ${mapped.size} canonical lots. The official TED notice contains ${officialLotCount} canonical lots.`;
  }
  return `Document analysis currently contains notice-level or unmapped evidence. The official TED notice contains ${officialLotCount} canonical lots.`;
}

export async function fetchTedCanonicalNotice(
  publication: string,
  request: FetchLike = fetch,
): Promise<TedCanonicalNotice> {
  const normalizedPublication = publicationNumber(publication);
  const response = await request(TED_SEARCH_ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "MedicHall-TED-Canonical-Lots/1.0",
    },
    body: JSON.stringify({
      query: `publication-number = "${normalizedPublication}"`,
      fields: TED_CANONICAL_LOT_FIELDS,
      page: 1,
      limit: 5,
      scope: "ALL",
      paginationMode: "PAGE_NUMBER",
      onlyLatestVersions: true,
      checkQuerySyntax: false,
    }),
  });
  const payload = await response.json().catch(() => null) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    throw new Error(
      `TED structured lot request failed with HTTP ${response.status}`,
    );
  }
  const notices = array(payload?.notices ?? payload?.results);
  if (notices.length !== 1) {
    throw new Error("TED structured lot request did not return one notice");
  }
  const parsed = parseTedCanonicalNotice(notices[0]);
  if (parsed.publication_number !== normalizedPublication) {
    throw new Error("TED structured lot response publication mismatch");
  }
  return parsed;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function persistTedCanonicalNotice(
  admin: DataClient,
  tenderId: number,
  notice: TedCanonicalNotice,
): Promise<Record<string, unknown>> {
  const snapshotHash = await sha256({
    publication_number: notice.publication_number,
    publication_date: notice.publication_date,
    lots: notice.lots,
  });
  const { data, error } = await admin.rpc("replace_ted_canonical_lots_v1", {
    p_tender_id: tenderId,
    p_publication_number: notice.publication_number,
    p_source_url: notice.source_url,
    p_source_snapshot_hash: snapshotHash,
    p_lots: notice.lots,
  });
  if (error) throw new Error(error.message);
  return record(data);
}

export async function markTedLotStructurePending(
  admin: DataClient,
  tenderId: number,
  reason: string,
): Promise<void> {
  const { error } = await admin.from("tenders").update({
    lot_structure_status: "LOT_STRUCTURE_PENDING",
    lot_structure_diagnostics: {
      warning: reason.replace(/\s+/g, " ").trim().slice(0, 300),
      authoritative_source_required: "TED_STRUCTURED",
    },
    lot_structure_updated_at: new Date().toISOString(),
  }).eq("id", tenderId);
  if (error && !/column|schema cache/i.test(error.message)) {
    throw new Error(error.message);
  }
}

// Bounded, read-only real-source QA for approved runtime registry adapters.
// It makes exactly one request each to France, Norway, and Poland, stores
// nothing, and prints only provider-level redacted evidence.
import {
  francePublicRegistryAdapter,
  norwayPublicRegistryAdapter,
  polandKrsRegistryAdapter,
  type RegistryAdapter,
  type RegistryLookupSeed,
} from "../supabase/functions/_shared/external-registry-adapters.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(
  adapter: RegistryAdapter,
  url: string,
  seed?: RegistryLookupSeed,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "MedicHall-External-Registry-QA/1.0",
    },
  });
  assert(
    response.ok,
    `${adapter.providerCode} returned HTTP ${response.status}`,
  );
  const candidates = adapter.parse(await response.json(), url, seed);
  assert(
    candidates.length > 0,
    `${adapter.providerCode} returned no relevant legal entity`,
  );
  assert(
    candidates.every((candidate) =>
      candidate.name && candidate.legalName && candidate.registryIdentifier &&
      candidate.sourceUrl.startsWith("https://") &&
      candidate.activity.nationalCode &&
      candidate.activity.strength !== "NON_MATCH"
    ),
    `${adapter.providerCode} produced incomplete provenance or activity evidence`,
  );
  const serialized = JSON.stringify(candidates).toLowerCase();
  for (
    const prohibited of [
      "email",
      "phone",
      "mobile",
      "contact_name",
      "linkedin",
      "director",
      "officer",
      "shareholder",
      "employee",
    ]
  ) {
    assert(
      !serialized.includes(`\"${prohibited}\"`),
      `${adapter.providerCode} exposed ${prohibited}`,
    );
  }
  return {
    provider: adapter.providerCode,
    http_status: response.status,
    legal_entities_verified: new Set(
      candidates.map((candidate) => candidate.registryIdentifier),
    ).size,
    activity_records: candidates.length,
    activity_codes: [
      ...new Set(
        candidates.map((candidate) =>
          `${candidate.activity.nationalClassification}:${candidate.activity.nationalCode}`
        ),
      ),
    ],
    mapping_confidence: [
      ...new Set(
        candidates.map((candidate) => candidate.activity.mappingConfidence),
      ),
    ],
    source_host: new URL(url).hostname,
    personal_contact_fields: 0,
  };
}

const franceRequest = francePublicRegistryAdapter.buildRequests()[0];
const norwayRequest = norwayPublicRegistryAdapter.buildRequests()[0];
const polandSeed: RegistryLookupSeed = {
  name: "QA legal medical entity",
  countryCode: "PL",
  cityRegion: null,
  registryIdentifier: "KRS:0000011286",
};
const polandRequest = polandKrsRegistryAdapter.buildRequests([polandSeed])[0];
assert(polandRequest, "Polish KRS QA request was not generated");

const selectedCountry =
  Deno.args.find((value) => value.startsWith("--country="))
    ?.split("=", 2)[1]?.toUpperCase() || null;
const checks = [{
  countryCode: "FR",
  adapter: francePublicRegistryAdapter,
  request: franceRequest,
}, {
  countryCode: "NO",
  adapter: norwayPublicRegistryAdapter,
  request: norwayRequest,
}, {
  countryCode: "PL",
  adapter: polandKrsRegistryAdapter,
  request: polandRequest,
}].filter((item) => !selectedCountry || item.countryCode === selectedCountry);
assert(checks.length > 0, "Requested registry QA country is not executable");

const evidence = [];
for (const item of checks) {
  evidence.push(
    await check(
      item.adapter,
      item.request.url,
      item.request.seed,
    ),
  );
}

console.log(JSON.stringify(
  {
    result: "PASS",
    external_requests: checks.length,
    paid_requests: 0,
    personal_contact_fields: 0,
    evidence,
  },
  null,
  2,
));

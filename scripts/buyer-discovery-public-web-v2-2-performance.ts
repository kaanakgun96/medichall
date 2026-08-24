import {
  createBraveSearchProvider,
  type PublicWebCacheEntry,
  type PublicWebDiscoveryCache,
  runPublicWebDiscovery,
} from "../supabase/functions/_shared/public-web-discovery.ts";
import { buildProductFamilyProfile } from "../supabase/functions/_shared/buyer-discovery-relevance-v2.ts";

const camera = buildProductFamilyProfile([{
  taxonomyId: 336,
  canonicalName: "Camera Covers",
  slug: "camera-covers",
  aliases: ["Camera Cover", "Sterile Camera Drape", "Camera Sleeve"],
}]);

const noStoreCache: PublicWebDiscoveryCache = {
  read: () => Promise.resolve(null),
  write: (_entry: PublicWebCacheEntry) => Promise.resolve(),
};

let fixtureRequest = 0;
const provider = createBraveSearchProvider({
  apiKey: "fixture-secret-not-a-real-key",
  fetchImpl: async () => {
    const requestNumber = fixtureRequest++;
    await new Promise((resolve) => setTimeout(resolve, 4 + requestNumber % 5));
    return new Response(
      JSON.stringify({
        web: {
          results: [{
            title: `QA Medical ${requestNumber} SRL`,
            url: `https://qa-medical-${requestNumber}.it/products/camera-cover`,
          }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
});

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

const baselineDurations: number[] = [];
for (let index = 0; index < 11; index += 1) {
  const started = performance.now();
  await runPublicWebDiscovery({
    enabled: false,
    provider: null,
    cache: noStoreCache,
    productFamily: camera,
    targetCountries: [],
  });
  baselineDurations.push(performance.now() - started);
}

const enabledDurations: number[] = [];
const providerLatencies: number[] = [];
let providerRequests = 0;
for (let index = 0; index < 7; index += 1) {
  const started = performance.now();
  const result = await runPublicWebDiscovery({
    enabled: true,
    provider,
    cache: noStoreCache,
    productFamily: camera,
    targetCountries: [],
  });
  enabledDurations.push(performance.now() - started);
  providerLatencies.push(...result.providerLatencyMs);
  providerRequests += result.providerRequests;
}

console.log(JSON.stringify(
  {
    mode: "deterministic_mock_provider",
    baseline_samples: baselineDurations.length,
    v2_2_samples: enabledDurations.length,
    baseline_p50_ms: Number(median(baselineDurations).toFixed(3)),
    v2_2_p50_ms: Number(median(enabledDurations).toFixed(3)),
    slowest_mock_provider_request_ms: Math.max(...providerLatencies),
    provider_requests_per_run: providerRequests / enabledDurations.length,
    maximum_added_public_web_requests_per_run: 6,
    theoretical_full_pipeline_external_request_ceiling: 34,
    ai_requests: 0,
  },
  null,
  2,
));

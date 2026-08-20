import { normalizePublicUrl } from "./attachment-discovery.ts";

export const SAFE_FETCH_MAX_REDIRECTS = 5;
export const SAFE_FETCH_TIMEOUT_MS = 12_000;
export const SAFE_FETCH_BODY_IDLE_TIMEOUT_MS = 5_000;

export type PublicResolver = (hostname: string) => Promise<string[]>;
export type PublicFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SafeFetchResult = {
  response: Response;
  sourceUrl: string;
  resolvedUrl: string;
  redirectCount: number;
  attemptCount: number;
  resolvedAddresses: string[];
};

export type SafeFetchOptions = {
  resolver?: PublicResolver;
  fetcher?: PublicFetcher;
  maximumRedirects?: number;
  maximumAttempts?: number;
  requestTimeoutMs?: number;
};

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part))
  ) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.some((part) => part > 255) ? null : octets;
}

function parseIpv6Part(value: string): number[] | null {
  if (!value) return [];
  const groups: number[] = [];
  for (const token of value.split(":")) {
    if (!token) return null;
    const ipv4 = parseIpv4(token);
    if (ipv4) {
      groups.push((ipv4[0] << 8) | ipv4[1]);
      groups.push((ipv4[2] << 8) | ipv4[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
    groups.push(Number.parseInt(token, 16));
  }
  return groups;
}

function parseIpv6(value: string): Uint8Array | null {
  const normalized = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalized || normalized.includes("%")) return null;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = parseIpv6Part(halves[0]);
  const right = parseIpv6Part(halves[1] || "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => 0),
    ...right,
  ];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >>> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function isPublicIpv4(octets: number[]): boolean {
  const [first, second, third] = octets;
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  ) {
    return false;
  }
  return true;
}

export function isPublicIpAddress(value: string): boolean {
  const ipv4 = parseIpv4(value);
  if (ipv4) return isPublicIpv4(ipv4);

  const ipv6 = parseIpv6(value);
  if (!ipv6) return false;

  const mapped = ipv6.slice(0, 10).every((byte) => byte === 0) &&
    ipv6[10] === 0xff && ipv6[11] === 0xff;
  if (mapped) {
    return isPublicIpv4([...ipv6.slice(12)]);
  }

  const unspecified = ipv6.every((byte) => byte === 0);
  const loopback = ipv6.slice(0, 15).every((byte) => byte === 0) &&
    ipv6[15] === 1;
  const uniqueLocal = (ipv6[0] & 0xfe) === 0xfc;
  const linkLocal = ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0x80;
  const multicast = ipv6[0] === 0xff;
  const documentation = ipv6[0] === 0x20 &&
    ipv6[1] === 0x01 &&
    ipv6[2] === 0x0d &&
    ipv6[3] === 0xb8;
  const reservedProtocolAssignments = ipv6[0] === 0x20 &&
    ipv6[1] === 0x01 &&
    ipv6[2] <= 0x01;
  const deprecatedSixToFour = ipv6[0] === 0x20 && ipv6[1] === 0x02;
  const documentationV2 = ipv6[0] === 0x3f &&
    ipv6[1] === 0xff &&
    (ipv6[2] & 0xf0) === 0;
  const globallyRoutable = (ipv6[0] & 0xe0) === 0x20;
  return globallyRoutable &&
    !unspecified &&
    !loopback &&
    !uniqueLocal &&
    !linkLocal &&
    !multicast &&
    !documentation &&
    !reservedProtocolAssignments &&
    !deprecatedSixToFour &&
    !documentationV2;
}

const defaultResolver: PublicResolver = async (hostname) => {
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);
  const addresses = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  return [...new Set(addresses.map((address) => String(address).toLowerCase()))]
    .sort();
};

export async function assertPublicNetworkTarget(
  url: URL,
  resolver: PublicResolver = defaultResolver,
): Promise<string[]> {
  const normalized = normalizePublicUrl(url.href);
  if (!normalized) throw new Error("Invalid or prohibited public HTTPS URL");

  const literal = parseIpv4(normalized.hostname) ||
      parseIpv6(normalized.hostname)
    ? [normalized.hostname.replace(/^\[|\]$/g, "").toLowerCase()]
    : await resolver(normalized.hostname);
  const addresses = [
    ...new Set(literal.map((address) => address.toLowerCase())),
  ]
    .sort();
  if (!addresses.length) {
    throw new Error("Public URL hostname did not resolve");
  }
  if (!addresses.every(isPublicIpAddress)) {
    throw new Error("Public URL resolved to a prohibited network address");
  }
  return addresses;
}

function sameAddresses(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((address, index) => address === right[index]);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status >= 500;
}

async function resolvePublicTargetWithin(
  url: URL,
  resolver: PublicResolver,
  timeoutMs: number,
): Promise<string[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    assertPublicNetworkTarget(url, resolver),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Public URL DNS resolution timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

function timeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal | null,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export async function safeFetchWithRedirects(
  sourceUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const resolver = options.resolver || defaultResolver;
  const fetcher = options.fetcher || fetch;
  const maximumRedirects = options.maximumRedirects ??
    SAFE_FETCH_MAX_REDIRECTS;
  const maximumAttempts = options.maximumAttempts ?? 2;
  const requestTimeoutMs = options.requestTimeoutMs ??
    SAFE_FETCH_TIMEOUT_MS;
  let current = normalizePublicUrl(sourceUrl);
  if (!current) throw new Error("Invalid or prohibited public HTTPS URL");
  let redirectCount = 0;
  let attemptCount = 0;

  while (true) {
    let response: Response | null = null;
    let afterAddresses: string[] = [];
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
      attemptCount++;
      const beforeAddresses = await resolvePublicTargetWithin(
        current,
        resolver,
        requestTimeoutMs,
      );
      const bounded = timeoutSignal(requestTimeoutMs, init.signal);
      try {
        response = await fetcher(current.href, {
          ...init,
          redirect: "manual",
          signal: bounded.signal,
        });
        // Standard fetch cannot pin a hostname to the validated address. A
        // second lookup narrows the rebinding window and rejects changed or
        // mixed answers for every attempt.
        afterAddresses = await resolvePublicTargetWithin(
          current,
          resolver,
          requestTimeoutMs,
        );
        if (!sameAddresses(beforeAddresses, afterAddresses)) {
          await response.body?.cancel();
          throw new Error("Public URL DNS answers changed during the request");
        }
        if (
          !isRetryableStatus(response.status) ||
          attempt === maximumAttempts
        ) {
          break;
        }
        await response.body?.cancel();
      } catch (error) {
        lastError = error;
        if (attempt === maximumAttempts) throw error;
      } finally {
        bounded.dispose();
      }
    }
    if (!response) throw lastError || new Error("Public request failed");

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        return {
          response,
          sourceUrl,
          resolvedUrl: current.href,
          redirectCount,
          attemptCount,
          resolvedAddresses: afterAddresses,
        };
      }
      if (redirectCount >= maximumRedirects) {
        throw new Error("Too many redirects");
      }
      const next = normalizePublicUrl(location, current.href);
      if (!next) {
        throw new Error("Redirect target is not a permitted public HTTPS URL");
      }
      current = next;
      redirectCount++;
      continue;
    }

    const responseUrl = normalizePublicUrl(response.url || current.href);
    if (!responseUrl || responseUrl.href !== current.href) {
      await response.body?.cancel();
      throw new Error("Fetch followed an unvalidated redirect");
    }
    return {
      response,
      sourceUrl,
      resolvedUrl: current.href,
      redirectCount,
      attemptCount,
      resolvedAddresses: afterAddresses,
    };
  }
}

export async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  bodyTimeoutMs = SAFE_FETCH_TIMEOUT_MS,
  idleTimeoutMs = SAFE_FETCH_BODY_IDLE_TIMEOUT_MS,
): Promise<{ bytes: Uint8Array; length: number }> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (
    !Number.isFinite(maximumBytes) ||
    maximumBytes < 0 ||
    declaredLength > maximumBytes
  ) {
    await response.body?.cancel();
    throw new Error("Response exceeds size limit");
  }
  if (!response.body) return { bytes: new Uint8Array(), length: 0 };

  const deadline = Date.now() + bodyTimeoutMs;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const remaining = Math.min(idleTimeoutMs, deadline - Date.now());
      if (remaining <= 0) throw new Error("Response body timed out");
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Response body timed out")),
            remaining,
          );
        }),
      ]).finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      });
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximumBytes) {
        throw new Error("Response exceeds size limit");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, length };
}

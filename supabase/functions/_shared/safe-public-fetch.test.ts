import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicNetworkTarget,
  isPublicIpAddress,
  readBoundedResponseBody,
  safeFetchWithRedirects,
} from "./safe-public-fetch.ts";

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:4700:4700::1111";
const publicResolver = () => Promise.resolve([PUBLIC_V4, PUBLIC_V6]);

test("accepts a DNS-validated public HTTPS URL", async () => {
  const result = await safeFetchWithRedirects(
    "https://public.example/tender",
    {},
    {
      resolver: publicResolver,
      fetcher: () => Promise.resolve(new Response("ok")),
      maximumAttempts: 1,
    },
  );
  assert.equal(result.resolvedUrl, "https://public.example/tender");
  assert.deepEqual(result.resolvedAddresses, [PUBLIC_V6, PUBLIC_V4].sort());
});

test("validates every public HTTPS redirect target", async () => {
  const requested: string[] = [];
  const result = await safeFetchWithRedirects(
    "https://public.example/start",
    {},
    {
      resolver: publicResolver,
      fetcher: (input) => {
        requested.push(String(input));
        return Promise.resolve(
          requested.length === 1
            ? new Response(null, {
              status: 302,
              headers: { location: "https://files.example/spec.pdf" },
            })
            : new Response("pdf"),
        );
      },
      maximumAttempts: 1,
    },
  );
  assert.equal(result.redirectCount, 1);
  assert.deepEqual(requested, [
    "https://public.example/start",
    "https://files.example/spec.pdf",
  ]);
});

test("rejects HTTPS-to-HTTP redirect downgrade", async () => {
  await assert.rejects(
    safeFetchWithRedirects("https://public.example/start", {}, {
      resolver: publicResolver,
      fetcher: () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://public.example/file.pdf" },
          }),
        ),
      maximumAttempts: 1,
    }),
    /permitted public HTTPS URL/,
  );
});

test("rejects redirect targets resolving to private IPv4 or IPv6", async () => {
  for (const privateAddress of ["10.0.0.2", "fd00::2"]) {
    await assert.rejects(
      safeFetchWithRedirects("https://public.example/start", {}, {
        resolver: (hostname) =>
          Promise.resolve(
            hostname === "private.example" ? [privateAddress] : [PUBLIC_V4],
          ),
        fetcher: (input) =>
          Promise.resolve(
            String(input).includes("public.example")
              ? new Response(null, {
                status: 302,
                headers: { location: "https://private.example/internal" },
              })
              : new Response("must not connect"),
          ),
        maximumAttempts: 1,
      }),
      /prohibited network address/,
    );
  }
});

test("rejects localhost, special IPv4, mapped IPv6, and private networks", () => {
  for (
    const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "192.0.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "ff02::1",
      "::ffff:10.0.0.1",
      "::ffff:a00:1",
      "::ffff:169.254.169.254",
      "2001:2::1",
      "2001:db8::1",
      "2002:a00:1::",
      "3fff::1",
    ]
  ) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress(PUBLIC_V4), true);
  assert.equal(isPublicIpAddress(PUBLIC_V6), true);
});

test("rejects a mixed public and private DNS answer", async () => {
  await assert.rejects(
    assertPublicNetworkTarget(
      new URL("https://mixed.example/tender"),
      () => Promise.resolve([PUBLIC_V4, "192.168.1.5"]),
    ),
    /prohibited network address/,
  );
});

test("rejects redirect loops at the configured cap", async () => {
  await assert.rejects(
    safeFetchWithRedirects("https://loop.example/a", {}, {
      resolver: publicResolver,
      fetcher: (input) =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              location: String(input).endsWith("/a")
                ? "https://loop.example/b"
                : "https://loop.example/a",
            },
          }),
        ),
      maximumRedirects: 2,
      maximumAttempts: 1,
    }),
    /Too many redirects/,
  );
});

test("rejects DNS rebinding between validation and response headers", async () => {
  let lookup = 0;
  await assert.rejects(
    safeFetchWithRedirects("https://rebind.example/tender", {}, {
      resolver: () => Promise.resolve([lookup++ === 0 ? PUBLIC_V4 : "1.1.1.1"]),
      fetcher: () => Promise.resolve(new Response("unexpected")),
      maximumAttempts: 1,
    }),
    /DNS answers changed/,
  );
});

test("resolves DNS before and after every retry attempt", async () => {
  let lookups = 0;
  let requests = 0;
  const result = await safeFetchWithRedirects(
    "https://retry.example/tender",
    {},
    {
      resolver: () => {
        lookups++;
        return Promise.resolve([PUBLIC_V4]);
      },
      fetcher: () =>
        Promise.resolve(
          ++requests === 1
            ? new Response("retry", { status: 503 })
            : new Response("ok"),
        ),
      maximumAttempts: 2,
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(requests, 2);
  assert.equal(lookups, 4);
});

test("enforces connection and header timeout", async () => {
  await assert.rejects(
    safeFetchWithRedirects("https://slow.example/tender", {}, {
      resolver: publicResolver,
      fetcher: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
      requestTimeoutMs: 10,
      maximumAttempts: 1,
    }),
    /timed out|TimeoutError/i,
  );
});

test("enforces DNS resolution timeout before connection", async () => {
  await assert.rejects(
    safeFetchWithRedirects("https://slow-dns.example/tender", {}, {
      resolver: () => new Promise(() => undefined),
      fetcher: () => Promise.resolve(new Response("must not connect")),
      requestTimeoutMs: 10,
      maximumAttempts: 1,
    }),
    /DNS resolution timed out/,
  );
});

test("stops declared, streamed, and endless oversized response bodies", async () => {
  await assert.rejects(
    readBoundedResponseBody(
      new Response("small", {
        headers: { "content-length": "1000" },
      }),
      10,
    ),
    /size limit/,
  );

  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
    },
  });
  await assert.rejects(
    readBoundedResponseBody(new Response(oversized), 10),
    /size limit/,
  );

  const endless = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
  });
  await assert.rejects(
    readBoundedResponseBody(new Response(endless), 10, 20, 10),
    /timed out/,
  );
});

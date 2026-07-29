import assert from "node:assert/strict";
import test from "node:test";
import { handleTenderImportEdgeRequest } from "./index.ts";

const endpoint = "https://example.supabase.co/functions/v1/tender-import";

function request(
  method: string,
  origin?: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(endpoint, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
  });
}

test("Universal Tender Import preflight returns 204 without loading business logic", async () => {
  let handlerLoaded = false;
  const response = await handleTenderImportEdgeRequest(
    request("OPTIONS", "https://medichall.com", {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers":
        "authorization, apikey, content-type, x-client-info",
    }),
    () => {
      handlerLoaded = true;
      return Promise.reject(new Error("must not load"));
    },
  );

  assert.equal(response.status, 204);
  assert.equal(handlerLoaded, false);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
});

test("Universal Tender Import rejects unsupported origins", async () => {
  const response = await handleTenderImportEdgeRequest(
    request("OPTIONS", "https://attacker.example"),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal((await response.json()).code, "ORIGIN_NOT_ALLOWED");
});

test("Universal Tender Import preserves the partner authorization header", async () => {
  let authorization = "";
  const response = await handleTenderImportEdgeRequest(
    request("POST", "https://medichall.com", {
      Authorization: "Bearer partner-session",
      apikey: "public-anon-key",
      "Content-Type": "application/json",
    }),
    () =>
      Promise.resolve({
        handleTenderImportRequest: (req: Request) => {
          authorization = req.headers.get("authorization") || "";
          return Promise.resolve(new Response("{}", { status: 202 }));
        },
      }),
  );

  assert.equal(response.status, 202);
  assert.equal(authorization, "Bearer partner-session");
});

test("Universal Tender Import rejects an unauthenticated real POST", async () => {
  const response = await handleTenderImportEdgeRequest(
    request("POST", "https://medichall.com", {
      apikey: "public-anon-key",
      "Content-Type": "application/json",
    }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "AUTHENTICATION_REQUIRED");
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
});

test("Universal Tender Import converts startup failures to CORS-safe 503 responses", async () => {
  const response = await handleTenderImportEdgeRequest(
    request("POST", "https://medichall.com"),
    () => Promise.reject(new Error("synthetic startup failure")),
  );

  assert.equal(response.status, 503);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
  assert.equal((await response.json()).code, "FUNCTION_UNAVAILABLE");
});

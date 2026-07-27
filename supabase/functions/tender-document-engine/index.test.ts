import assert from "node:assert/strict";
import test from "node:test";
import { handleTenderDocumentEngineRequest } from "./index.ts";

const endpoint =
  "https://example.supabase.co/functions/v1/tender-document-engine";

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

test("production OPTIONS succeeds without loading auth or business logic", async () => {
  let handlerLoaded = false;
  const response = await handleTenderDocumentEngineRequest(
    request("OPTIONS", "https://medichall.com", {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers":
        "authorization, apikey, content-type, x-client-info",
    }),
    () => {
      handlerLoaded = true;
      return Promise.reject(
        new Error("The POST handler must not load for preflight"),
      );
    },
  );

  assert.equal(response.status, 204);
  assert.equal(handlerLoaded, false);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "POST, OPTIONS",
  );
  assert.match(
    response.headers.get("access-control-allow-headers") ?? "",
    /authorization/,
  );
  assert.match(
    response.headers.get("access-control-allow-headers") ?? "",
    /x-client-info/,
  );
});

test("supported development and originless preflights remain available", async () => {
  const blockedLoader = (): Promise<never> =>
    Promise.reject(new Error("The POST handler must not load for preflight"));
  const localhost = await handleTenderDocumentEngineRequest(
    request("OPTIONS", "http://localhost:3000"),
    blockedLoader,
  );
  const originless = await handleTenderDocumentEngineRequest(
    request("OPTIONS"),
    blockedLoader,
  );

  assert.equal(localhost.status, 204);
  assert.equal(
    localhost.headers.get("access-control-allow-origin"),
    "http://localhost:3000",
  );
  assert.equal(originless.status, 204);
  assert.equal(
    originless.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
});

test("unsupported origins are rejected without an allow-origin header", async () => {
  const response = await handleTenderDocumentEngineRequest(
    request("OPTIONS", "https://invalid.example"),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal((await response.json()).code, "ORIGIN_NOT_ALLOWED");
});

test("POST keeps authorization headers and returns CORS-safe handler errors", async () => {
  let authorization = "";
  const response = await handleTenderDocumentEngineRequest(
    request("POST", "https://medichall.com", {
      Authorization: "Bearer partner-session",
      apikey: "public-anon-key",
      "Content-Type": "application/json",
    }),
    () =>
      Promise.resolve({
        handleTenderDocumentRequest: (req: Request) => {
          authorization = req.headers.get("authorization") ?? "";
          return Promise.reject(new Error("synthetic startup failure"));
        },
      }),
  );

  assert.equal(authorization, "Bearer partner-session");
  assert.equal(response.status, 503);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
  assert.ok(response.headers.get("x-request-id"));
  assert.equal((await response.json()).code, "FUNCTION_UNAVAILABLE");
});

test("unauthenticated POST is rejected by the real secured handler", async () => {
  const response = await handleTenderDocumentEngineRequest(
    request("POST", "https://medichall.com", {
      apikey: "public-anon-key",
      "Content-Type": "application/json",
    }),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "Authentication required.");
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://medichall.com",
  );
});

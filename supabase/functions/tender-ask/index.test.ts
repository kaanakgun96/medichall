import assert from "node:assert/strict";
import test from "node:test";
import { handleTenderAskRequest } from "./index.ts";

test("Tender Ask preflight returns 204 without loading configuration", async () => {
  const response = await handleTenderAskRequest(new Request("https://medichall.com", {
    method: "OPTIONS",
    headers: { origin: "https://medichall.com" },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://medichall.com");
});

test("Tender Ask rejects unsupported origins", async () => {
  const response = await handleTenderAskRequest(new Request("https://medichall.com", {
    method: "POST",
    headers: { origin: "https://attacker.invalid", authorization: "Bearer fake" },
    body: "{}",
  }));
  assert.equal(response.status, 403);
});

test("Tender Ask rejects unauthenticated POST before reading secrets", async () => {
  const response = await handleTenderAskRequest(new Request("https://medichall.com", {
    method: "POST",
    headers: { origin: "https://medichall.com" },
    body: "{}",
  }));
  assert.equal(response.status, 401);
});

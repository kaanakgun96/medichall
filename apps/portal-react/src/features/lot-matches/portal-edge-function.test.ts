import { describe, expect, it } from "vitest";
import portal from "../../../../../portal.html?raw";

type EdgeDetails = {
  status?: number;
  code?: string;
  backendMessage?: string;
};

type EdgeErrorHelpers = {
  edgeErrorCode: (data: unknown) => string;
  edgeBackendMessage: (data: unknown) => string;
  edgeFailureMessage: (details: EdgeDetails) => string;
};

function between(start: string, end: string) {
  const startIndex = portal.indexOf(start);
  const endIndex = portal.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Missing portal test markers: ${start} / ${end}`);
  }
  return portal.slice(startIndex + start.length, endIndex);
}

const errorSource = between(
  "/* EDGE_FUNCTION_ERROR_PURE_START */",
  "/* EDGE_FUNCTION_ERROR_PURE_END */",
);

const helpers = new Function(
  `${errorSource}
  return { edgeErrorCode, edgeBackendMessage, edgeFailureMessage };`,
)() as EdgeErrorHelpers;

describe("production portal Edge Function invocation", () => {
  it("sends the required authenticated request contract", () => {
    expect(portal).toContain('"/functions/v1/" + fn');
    expect(portal).toContain('"Authorization": "Bearer " + TOKEN');
    expect(portal).toContain('"apikey": SUPABASE_ANON_KEY');
    expect(portal).toContain('"Content-Type":"application/json"');
    expect(portal).toContain("body: JSON.stringify(body)");
  });

  it("shows a specific expired-session message", () => {
    expect(
      helpers.edgeFailureMessage({
        status: 401,
        code: "INVALID_SESSION",
      }),
    ).toBe("Session expired — please sign in again.");
  });

  it("shows a useful network or CORS message", () => {
    expect(
      helpers.edgeFailureMessage({ status: 0, code: "NETWORK_OR_CORS" }),
    ).toContain("Could not reach tender analysis");
  });

  it("distinguishes unavailable, unauthorized, processing, and validation failures", () => {
    expect(
      helpers.edgeFailureMessage({ status: 503, code: "BOOT_ERROR" }),
    ).toContain("temporarily unavailable");
    expect(helpers.edgeFailureMessage({ status: 403 })).toContain(
      "not authorized",
    );
    expect(helpers.edgeFailureMessage({ status: 409 })).toContain(
      "already processing",
    );
    expect(
      helpers.edgeFailureMessage({
        status: 400,
        backendMessage: "Valid tender_id and company_id are required.",
      }),
    ).toContain("Valid tender_id and company_id are required.");
  });

  it("records safe request diagnostics without logging credentials", () => {
    expect(portal).toContain('res.headers.get("sb-request-id")');
    expect(portal).toContain('res.headers.get("x-request-id")');
    expect(portal).toContain('console.error("Edge function request failed"');
    expect(portal).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("stops unread polling when there is no authenticated session", () => {
    expect(portal).toContain("if(!TOKEN || !USER) return;");
    expect(portal).toContain("clearInterval(window.__unreadTimer)");
  });
});

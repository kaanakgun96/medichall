/// <reference path="../_shared/edge-runtime.d.ts" />

import {
  bindRequestId,
  corsHeaders,
  isAllowedOrigin,
  json,
} from "../tender-document-engine/cors.ts";

type RequestHandlerModule = {
  handleTenderImportRequest: (req: Request) => Promise<Response>;
};

type RequestHandlerLoader = () => Promise<RequestHandlerModule>;

const loadRequestHandler: RequestHandlerLoader = () => import("./handler.ts");

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function handleTenderImportEdgeRequest(
  req: Request,
  loadHandler: RequestHandlerLoader = loadRequestHandler,
): Promise<Response> {
  const requestId = bindRequestId(req);
  const origin = req.headers.get("origin");

  if (!isAllowedOrigin(origin)) {
    return json(req, {
      error: "Origin not allowed.",
      code: "ORIGIN_NOT_ALLOWED",
      request_id: requestId,
    }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(req),
    });
  }
  if (req.method !== "POST") {
    return json(req, {
      error: "Method not allowed.",
      code: "METHOD_NOT_ALLOWED",
      request_id: requestId,
    }, 405);
  }

  try {
    const { handleTenderImportRequest } = await loadHandler();
    return await handleTenderImportRequest(req);
  } catch (error) {
    console.error(JSON.stringify({
      event: "tender_import_request_failure",
      request_id: requestId,
      error: safeErrorMessage(error),
    }));
    return json(req, {
      error: "Tender import is temporarily unavailable.",
      code: "FUNCTION_UNAVAILABLE",
      request_id: requestId,
    }, 503);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleTenderImportEdgeRequest(req));
}

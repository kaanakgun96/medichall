const PRODUCTION_ORIGIN = "https://medichall.com";

export const ALLOWED_ORIGINS = new Set([
  PRODUCTION_ORIGIN,
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const REQUEST_IDS = new WeakMap<Request, string>();

export function bindRequestId(req: Request): string {
  const existing = REQUEST_IDS.get(req);
  if (existing) return existing;
  const requestId = crypto.randomUUID();
  REQUEST_IDS.set(req, requestId);
  return requestId;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(req: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Expose-Headers": "sb-request-id, x-request-id",
    "Vary": "Origin",
    "X-Request-Id": bindRequestId(req),
  });
  const origin = req.headers.get("origin");
  if (!origin) {
    headers.set("Access-Control-Allow-Origin", PRODUCTION_ORIGIN);
  } else if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function json(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

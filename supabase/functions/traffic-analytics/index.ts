/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  acquisitionSource,
  classifyUserAgent,
  isObviousBot,
  parseTrafficPayload,
  trustedCountryCode,
} from "../_shared/traffic-analytics.ts";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://medichall.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function optionalAuthenticatedVisit(
  supabaseUrl: string,
  anonKey: string,
  authorization: string,
): Promise<boolean> {
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token || token === anonKey) return false;
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  return !error && Boolean(user);
}

export async function handleTrafficAnalyticsRequest(
  request: Request,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return json(request, { error: "Method not allowed." }, 405);
  }

  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(request, { error: "Origin not allowed." }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 2048) {
    return json(request, { error: "Analytics payload is too large." }, 413);
  }
  const userAgent = request.headers.get("user-agent") ?? "";
  if (isObviousBot(userAgent)) {
    return json(request, { accepted: false, filtered: true }, 202);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, { error: "Traffic analytics is unavailable." }, 503);
  }

  let payload;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 2048) {
      throw new Error("Analytics payload is too large.");
    }
    payload = parseTrafficPayload(JSON.parse(raw));
  } catch (error) {
    return json(request, {
      error: error instanceof Error
        ? error.message
        : "Invalid analytics payload.",
    }, 400);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const isAuthenticated = await optionalAuthenticatedVisit(
    supabaseUrl,
    anonKey,
    authorization,
  );
  const classification = classifyUserAgent(userAgent);
  const source = acquisitionSource(payload.referrer_domain, payload.utm_source);
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await adminClient.rpc("record_traffic_page_view_v1", {
    p_event_id: payload.event_id,
    p_visitor_id: payload.visitor_id,
    p_session_id: payload.session_id,
    p_route_id: payload.route_id,
    p_country_code: trustedCountryCode(request.headers),
    p_acquisition_source: source,
    p_referrer_domain: payload.referrer_domain,
    p_utm_source: payload.utm_source,
    p_utm_medium: payload.utm_medium,
    p_utm_campaign: payload.utm_campaign,
    p_device_category: classification.device,
    p_browser_family: classification.browser,
    p_is_authenticated: isAuthenticated,
  });
  if (error) {
    const invalid = error.code === "22023";
    console.error("traffic-analytics write failed", {
      code: String(error.code || "unknown").slice(0, 20),
      request_id: request.headers.get("x-request-id") || null,
    });
    return json(request, {
      error: invalid
        ? "Invalid analytics event."
        : "Traffic analytics could not be recorded.",
    }, invalid ? 400 : 503);
  }
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  return json(request, {
    accepted: true,
    recorded: result.recorded === true,
    deduplicated: result.deduplicated === true,
  }, result.recorded === true ? 201 : 200);
}

if (import.meta.main) Deno.serve(handleTrafficAnalyticsRequest);

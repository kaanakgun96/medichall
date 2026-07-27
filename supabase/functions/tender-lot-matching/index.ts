/// <reference path="../_shared/edge-runtime.d.ts" />

// deno-lint-ignore no-import-prefix -- Edge bundle pins the production client.
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import { refreshTenderLotMatches } from "../_shared/lot-matching-service.ts";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
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

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return json(req, { error: "Origin not allowed." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(req, { error: "Lot matching is not configured." }, 500);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLocaleLowerCase().startsWith("bearer ")) {
    return json(req, { error: "Authentication required." }, 401);
  }
  const token = authHeader.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return json(req, { error: "Invalid or expired session." }, 401);
  }

  let payload: {
    action?: "refresh" | "status";
    company_id?: number;
    tender_id?: number;
  };
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }
  const companyId = Number(payload.company_id);
  const tenderId = Number(payload.tender_id);
  if (
    payload.action &&
    payload.action !== "refresh" &&
    payload.action !== "status"
  ) {
    return json(req, { error: "Unsupported action." }, 400);
  }
  if (!Number.isInteger(companyId) || !Number.isInteger(tenderId)) {
    return json(req, {
      error: "Valid company_id and tender_id are required.",
    }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: current, error: authorizationError } = await userClient.rpc(
    "get_tender_lot_matches_v1",
    { p_company_id: companyId, p_tender_id: tenderId },
  );
  if (authorizationError) {
    return json(req, { error: authorizationError.message }, 403);
  }
  if (payload.action === "status") {
    return json(req, current);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const result = await refreshTenderLotMatches(adminClient, {
      companyId,
      tenderId,
    });
    return json(req, result);
  } catch (error) {
    console.error(
      "Lot match refresh failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return json(req, { error: "Lot match refresh failed." }, 500);
  }
});

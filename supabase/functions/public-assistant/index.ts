// MedicHall Public Assistant — v1.0
//
// Powers the homepage chat widget for NON-LOGGED-IN visitors.
// Because this endpoint is public (no auth), it is protected against abuse:
//   1. Per-IP rate limit (default 6 questions / 30 min, tracked in DB)
//   2. Hard input length cap
//   3. Tight max_tokens + cheap model (Haiku)
//   4. Topic guardrail: answers only MedicHall / medical-B2B questions
//   5. CORS locked to medichall.com
//
// The rule-based widget answers common questions for free; only free-form
// questions that fall through reach this function. So real spend stays tiny.
//
// Required secret:  ANTHROPIC_API_KEY
// Optional secrets: PUBLIC_AI_MODEL       (default claude-haiku-4-5)
//                   PUBLIC_AI_IP_LIMIT    (default 6)
//                   PUBLIC_AI_WINDOW_MIN  (default 30)
//
// Requires table public.public_assistant_usage (see migration).

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const MAX_INPUT_CHARS = 500;
const MAX_HISTORY = 6; // last N turns kept for context
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_IP_LIMIT = 6;
const DEFAULT_WINDOW_MIN = 30;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://medichall.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0].trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: "Origin not allowed" }, 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    return json(req, { reply: "The assistant is temporarily unavailable. Please email info@medichall.com." }, 200);
  }

  let payload: { message?: string; history?: Array<{ role: string; content: string }> };
  try { payload = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }

  const message = String(payload.message ?? "").replace(/\u0000/g, "").trim().slice(0, MAX_INPUT_CHARS);
  if (!message) return json(req, { error: "Empty message" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- Per-IP rate limit ---
  const ip = clientIp(req);
  const ipLimit = Number(Deno.env.get("PUBLIC_AI_IP_LIMIT") ?? DEFAULT_IP_LIMIT);
  const windowMin = Number(Deno.env.get("PUBLIC_AI_WINDOW_MIN") ?? DEFAULT_WINDOW_MIN);
  const windowStart = new Date(Date.now() - windowMin * 60_000).toISOString();

  try {
    const { count } = await admin
      .from("public_assistant_usage")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= ipLimit) {
      return json(req, {
        reply: "You've reached the limit for the quick assistant. For detailed help, create a free account — the in-app assistant has no such limit — or email info@medichall.com.",
        limited: true,
      }, 200);
    }
  } catch (_) { /* if usage table missing, fail open but log */ }

  // --- Build guarded prompt ---
  const system = [
    "You are the MedicHall website assistant, speaking to a visitor who is NOT logged in.",
    "MedicHall is an AI-powered B2B marketplace for the medical industry. It does three things:",
    "1) Tender Intelligence — pulls European medical tenders daily from official sources (TED), scores them against a company's products/countries/certifications, and uses AI to read the tender documents and extract lots, quantities and requirements with source quotes.",
    "2) Business Matchmaking — two-sided matching that connects manufacturers, distributors and buyers by product, market and commercial fit.",
    "3) Digital marketplace — manufacturer showrooms, product catalogues, RFQs and direct messaging.",
    "Registration is free, as a manufacturer or a buyer, at portal.html. Matchmaking is at matchmaking.html.",
    "",
    "RULES:",
    "- Only answer questions about MedicHall, medical B2B trade, tenders, certifications (CE MDR, ISO 13485), sourcing, exporting, and related medical-industry topics.",
    "- If asked something off-topic (coding, general knowledge, politics, anything unrelated), politely decline in one sentence and steer back to MedicHall.",
    "- Never invent specific tenders, prices, statistics, company names, or certifications. If you don't know, say so and suggest creating a free account.",
    "- Keep answers short: 2-4 sentences, plain and practical. Encourage signing up when relevant.",
    "- You cannot access the visitor's account or private data.",
  ].join("\n");

  const history = Array.isArray(payload.history)
    ? payload.history.slice(-MAX_HISTORY).filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 800) }))
    : [];

  const messages = [...history, { role: "user", content: message }];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("PUBLIC_AI_MODEL") || DEFAULT_MODEL,
        max_tokens: 400,
        system,
        messages,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return json(req, { reply: "I'm having trouble right now. Please try again, or email info@medichall.com." }, 200);
    }
    const reply = Array.isArray(data.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim()
      : "";

    // log usage (best effort)
    admin.from("public_assistant_usage").insert({
      ip,
      input_chars: message.length,
      output_chars: reply.length,
      input_tokens: data.usage?.input_tokens ?? null,
      output_tokens: data.usage?.output_tokens ?? null,
    }).then(() => {}, () => {});

    return json(req, { reply: reply || "Sorry, I didn't catch that. Could you rephrase?" }, 200);
  } catch (_) {
    return json(req, { reply: "I'm having trouble right now. Please try again, or email info@medichall.com." }, 200);
  }
});

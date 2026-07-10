import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const MAX_INPUT_CHARS = 12_000;
const MAX_INSTRUCTION_CHARS = 1_500;
const DAILY_LIMIT_DEFAULT = 20;

const ALLOWED_MODES = new Set([
  "general",
  "tender-analysis",
  "rfq-builder",
  "supplier-checklist",
  "distributor-email",
  "seo-keywords",
]);

type Payload = {
  mode?: string;
  instruction?: string;
  input?: string;
  context?: Record<string, unknown>;
};

type OpenAIResponse = {
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://medichall.com";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
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

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function getDailyLimit(): number {
  const parsed = Number(Deno.env.get("AI_DAILY_LIMIT") ?? DAILY_LIMIT_DEFAULT);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 500)
    : DAILY_LIMIT_DEFAULT;
}

function extractOutputText(data: OpenAIResponse): string {
  if (typeof data.output_text === "string") return data.output_text.trim();
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return json(req, { error: "Origin not allowed" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAIKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !openAIKey) {
    console.error("Missing required Edge Function secrets");
    return json(req, { error: "AI service is not configured." }, 500);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(req, { error: "Authentication required." }, 401);
  }

  const token = authHeader.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);

  if (authError || !user) {
    return json(req, { error: "Invalid or expired session." }, 401);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  const requestedMode = cleanText(payload.mode, 80) || "general";
  const mode = ALLOWED_MODES.has(requestedMode) ? requestedMode : "general";
  const instruction = cleanText(payload.instruction, MAX_INSTRUCTION_CHARS);
  const input = cleanText(payload.input, MAX_INPUT_CHARS);
  const context = payload.context && typeof payload.context === "object"
    ? payload.context
    : {};

  if (!input) {
    return json(req, { error: "Please enter a request." }, 400);
  }

  const dailyLimit = getDailyLimit();
  const { data: reservation, error: reserveError } = await adminClient.rpc(
    "reserve_medichall_ai_request",
    {
      p_user_id: user.id,
      p_mode: mode,
      p_role: cleanText(context.role, 80) || null,
      p_input_chars: input.length,
      p_daily_limit: dailyLimit,
    },
  );

  if (reserveError) {
    console.error("AI reservation error", reserveError);
    return json(req, { error: "Could not verify AI usage limit." }, 500);
  }

  const reservationRow = Array.isArray(reservation) ? reservation[0] : reservation;
  if (!reservationRow?.allowed) {
    return json(
      req,
      {
        error: "Daily AI usage limit reached.",
        code: "DAILY_LIMIT_REACHED",
        daily_limit: dailyLimit,
        used_today: reservationRow?.used_today ?? dailyLimit,
      },
      429,
    );
  }

  const usageId = reservationRow.usage_id as number;
  const remaining = Math.max(
    0,
    dailyLimit - Number(reservationRow.used_today ?? dailyLimit),
  );

  const systemPrompt = [
    "You are MedicHall AI, an assistant for a B2B medical marketplace.",
    "Help medical-device buyers, manufacturers, and distributors with sourcing, RFQs, tender analysis, supplier matching, and export communication.",
    "Never invent certifications, approvals, tender clauses, prices, legal requirements, or company facts.",
    "When evidence is missing, state exactly what must be verified.",
    "Do not provide a final legal, regulatory, clinical, or procurement compliance decision.",
    "Be concise, practical, and business-oriented. Use clear headings and action items.",
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      mode,
      instruction: instruction || "Complete the requested MedicHall task.",
      input,
      context,
    },
    null,
    2,
  );

  try {
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAIKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        instructions: systemPrompt,
        input: userPrompt,
        max_output_tokens: 900,
        temperature: 0.3,
        store: false,
      }),
    });

    const data = (await openAIResponse.json()) as OpenAIResponse;
    if (!openAIResponse.ok) {
      const providerMessage = cleanText(data?.error?.message, 500);
      console.error("OpenAI request failed", openAIResponse.status, providerMessage);
      await adminClient.rpc("finish_medichall_ai_request", {
        p_usage_id: usageId,
        p_status: "failed",
        p_output_chars: 0,
        p_prompt_tokens: null,
        p_completion_tokens: null,
        p_total_tokens: null,
        p_error_code: `OPENAI_${openAIResponse.status}`,
      });
      return json(req, { error: "AI provider request failed. Please try again." }, 502);
    }

    const result = extractOutputText(data);
    if (!result) {
      await adminClient.rpc("finish_medichall_ai_request", {
        p_usage_id: usageId,
        p_status: "failed",
        p_output_chars: 0,
        p_prompt_tokens: data.usage?.input_tokens ?? null,
        p_completion_tokens: data.usage?.output_tokens ?? null,
        p_total_tokens: data.usage?.total_tokens ?? null,
        p_error_code: "EMPTY_RESPONSE",
      });
      return json(req, { error: "AI returned an empty response." }, 502);
    }

    const finish = await adminClient.rpc("finish_medichall_ai_request", {
      p_usage_id: usageId,
      p_status: "completed",
      p_output_chars: result.length,
      p_prompt_tokens: data.usage?.input_tokens ?? null,
      p_completion_tokens: data.usage?.output_tokens ?? null,
      p_total_tokens: data.usage?.total_tokens ?? null,
      p_error_code: null,
    });

    if (finish.error) console.error("AI usage finalization error", finish.error);

    return json(req, {
      result,
      remaining_today: remaining,
      daily_limit: dailyLimit,
    });
  } catch (error) {
    console.error("Unexpected AI error", error);
    await adminClient.rpc("finish_medichall_ai_request", {
      p_usage_id: usageId,
      p_status: "failed",
      p_output_chars: 0,
      p_prompt_tokens: null,
      p_completion_tokens: null,
      p_total_tokens: null,
      p_error_code: "UNEXPECTED_ERROR",
    });
    return json(req, { error: "Unexpected AI error. Please try again." }, 500);
  }
});

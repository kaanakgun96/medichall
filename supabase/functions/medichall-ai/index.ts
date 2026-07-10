const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  mode?: string;
  instruction?: string;
  input?: string;
  context?: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeText(value: unknown, max = 12000) {
  return String(value ?? "").slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured in Supabase secrets." }, 500);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const mode = safeText(payload.mode, 80) || "general";
  const instruction = safeText(payload.instruction, 2000) || "Answer as a medical B2B marketplace assistant.";
  const input = safeText(payload.input, 12000);
  const context = payload.context ?? {};

  const system = [
    "You are MedicHall AI, an assistant for a B2B medical marketplace.",
    "Help buyers and medical manufacturers with sourcing, RFQs, tender analysis, supplier matching, and export communication.",
    "Be practical, concise, and business-oriented.",
    "Do not invent certifications, prices, approvals, or tender requirements. If information is missing, say what is missing.",
    "Use clear headings and action checklists when useful.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    mode,
    instruction,
    input,
    context,
  }, null, 2);

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        temperature: 0.35,
        max_tokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return json({ error: data?.error?.message || "OpenAI request failed" }, 500);
    }

    const result = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};

    // Optional logging. Configure SUPABASE_SERVICE_ROLE_KEY if you want server-side logs.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const authHeader = req.headers.get("authorization") || "";
      let userId: string | null = null;
      try {
        const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { apikey: serviceKey, authorization: authHeader },
        });
        if (userRes.ok) {
          const user = await userRes.json();
          userId = user?.id ?? null;
        }
      } catch (_) {}

      try {
        await fetch(`${supabaseUrl}/rest/v1/medichall_ai_usage`, {
          method: "POST",
          headers: {
            apikey: serviceKey,
            authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            user_id: userId,
            role: (payload.context as any)?.role ?? null,
            mode,
            input_chars: input.length,
            output_chars: result.length,
            prompt_tokens: usage.prompt_tokens ?? null,
            completion_tokens: usage.completion_tokens ?? null,
            total_tokens: usage.total_tokens ?? null,
          }),
        });
      } catch (_) {}
    }

    return json({ result, usage });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected AI error" }, 500);
  }
});

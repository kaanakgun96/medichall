// MedicHall Sprint 4: citation-grounded Q&A for one authorized tender match.

import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  estimateTenderQuestionCost,
  normalizeTenderQuestion,
  parseGroundedTenderAnswer,
  rankTenderQuestionSources,
  stableTenderQuestionJson,
  tenderQuestionErrorCode,
  tenderQuestionSha256,
  type TenderQuestionSource,
} from "../_shared/tender-question.ts";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 900;
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_MAX_COST_USD = 0.05;

type AskPayload = {
  company_id?: unknown;
  tender_id?: unknown;
  question?: unknown;
};

type ProviderPayload = {
  id?: string;
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
};

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

function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function boundedNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(Deno.env.get(name));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function providerText(payload: ProviderPayload): string {
  return (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
}

function sourceText(parts: unknown[]): string {
  return parts.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map((value) => typeof value === "object" ? stableTenderQuestionJson(value) : String(value))
    .join(" · ")
    .slice(0, 1_200);
}

function buildSources(context: {
  tender: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  lots: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  score: Record<string, unknown> | null;
}): TenderQuestionSource[] {
  const tender = context.tender;
  const sources: TenderQuestionSource[] = [{
    id: "TENDER",
    kind: "tender",
    label: "Structured tender notice",
    text: sourceText([
      tender.title,
      tender.country_name,
      tender.buyer_name,
      tender.deadline_at,
      tender.cpv_codes,
      tender.estimated_value,
      tender.currency,
      tender.description,
      tender.extracted_products,
      tender.missing_information,
    ]),
    meta: {
      source_notice_id: tender.source_notice_id ?? null,
      document_analysis_status: tender.document_analysis_status ?? null,
    },
  }];

  context.evidence.forEach((item, index) => {
    sources.push({
      id: `E${index + 1}`,
      kind: "evidence",
      label: sourceText([
        item.product_name || item.evidence_type || "Tender evidence",
        item.field_name,
        item.page_number ? `page ${item.page_number}` : null,
      ]),
      text: sourceText([
        item.extracted_value,
        item.quantity_value,
        item.quantity_unit,
        item.lot_number,
        item.source_quote,
      ]),
      meta: {
        evidence_id: item.id,
        document_id: item.document_id ?? null,
        page_number: item.page_number ?? null,
        sheet_name: item.sheet_name ?? null,
        cell_range: item.cell_range ?? null,
        confidence_score: item.confidence_score ?? null,
      },
    });
  });

  context.lots.forEach((lot, index) => sources.push({
    id: `L${index + 1}`,
    kind: "lot",
    label: sourceText([lot.lot_number || `Lot ${index + 1}`, lot.lot_title]),
    text: sourceText([
      lot.match_score != null ? `match score ${lot.match_score}` : null,
      lot.recommendation,
      lot.best_company_product_name,
      lot.matched_requirements,
      lot.gaps,
      lot.blockers,
      lot.unknowns,
      lot.tender_evidence,
    ]),
    meta: {
      lot_key: lot.lot_key,
      recommendation: lot.recommendation,
      confidence_score: lot.confidence_score,
    },
  }));

  for (const product of context.products) {
    sources.push({
      id: `P${product.id}`,
      kind: "company_product",
      label: sourceText([product.name, product.ref]),
      text: sourceText([
        product.category,
        product.normalized_category,
        product.description,
        product.product_subtype,
        product.material,
        product.dimensions,
        product.technical_specifications,
        product.sterility_status,
        product.use_type,
        product.product_certifications,
        product.regulatory_class,
        product.production_capacity,
        product.capacity_unit,
        product.capacity_period,
      ]),
      meta: { product_id: product.id, product_ref: product.ref },
    });
  }

  if (context.score) {
    sources.push({
      id: "SCORE",
      kind: "score",
      label: "Deterministic opportunity score",
      text: sourceText([
        context.score.score_v2,
        context.score.confidence_score,
        context.score.document_evidence_status,
        context.score.components,
        context.score.matched_reasons,
        context.score.missing_requirements,
        context.score.risk_indicators,
      ]),
      meta: {
        scoring_version: context.score.scoring_version,
        input_hash: context.score.input_hash,
      },
    });
  }

  return sources;
}

export async function handleTenderAskRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return reply(req, null, 204);
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return reply(req, { error: "Origin not allowed." }, 403);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return reply(req, { error: "Authentication required." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !anthropicKey) {
    console.error("tender_ask_configuration_error");
    return reply(req, { error: "Tender Q&A is temporarily unavailable." }, 503);
  }

  const token = authHeader.slice(7).trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return reply(req, { error: "Invalid or expired session." }, 401);

  let payload: AskPayload;
  try {
    payload = await req.json();
  } catch {
    return reply(req, { error: "Invalid request body." }, 400);
  }
  const companyId = Number(payload.company_id);
  const tenderId = Number(payload.tender_id);
  const question = String(payload.question ?? "").replace(/\u0000/g, "").trim().slice(0, 600);
  const normalizedQuestion = normalizeTenderQuestion(question);
  if (!Number.isSafeInteger(companyId) || companyId <= 0 ||
    !Number.isSafeInteger(tenderId) || tenderId <= 0 || normalizedQuestion.length < 3) {
    return reply(req, { error: "Choose a tender and enter a specific question." }, 400);
  }

  const { data: company } = await admin.from("companies").select("id")
    .eq("id", companyId).eq("owner_id", user.id).maybeSingle();
  if (!company) return reply(req, { error: "Tender opportunity not found." }, 404);
  const { data: opportunity } = await admin.from("opportunity_matches")
    .select("id").eq("company_id", companyId).eq("tender_id", tenderId)
    .eq("opportunity_type", "tender").maybeSingle();
  if (!opportunity) return reply(req, { error: "Tender opportunity not found." }, 404);

  const [tenderResult, evidenceResult, lotsResult, productsResult, scoreResult] = await Promise.all([
    admin.from("tenders").select(
      "id,source_notice_id,title,description,country_name,buyer_name,deadline_at,cpv_codes,estimated_value,currency,extracted_products,missing_information,document_analysis_status,ai_extraction_version,updated_at",
    ).eq("id", tenderId).maybeSingle(),
    admin.from("tender_document_evidence").select(
      "id,document_id,evidence_type,product_name,field_name,extracted_value,quantity_value,quantity_unit,lot_number,page_number,sheet_name,cell_range,source_quote,confidence_score",
    ).eq("tender_id", tenderId).order("confidence_score", { ascending: false }).limit(120),
    admin.from("tender_lot_matches").select(
      "lot_key,lot_number,lot_title,status,match_score,recommendation,confidence_score,best_company_product_name,matched_requirements,gaps,blockers,unknowns,tender_evidence,calculation_version,calculated_at",
    ).eq("company_id", companyId).eq("tender_id", tenderId)
      .eq("calculation_version", "lot-match-v1").in("status", ["completed", "failed"]),
    admin.from("products").select("*").eq("company_id", companyId).eq("is_active", true).limit(100),
    admin.from("opportunity_match_scores_v2").select(
      "score_v2,confidence_score,document_evidence_status,components,matched_reasons,missing_requirements,risk_indicators,input_hash,scoring_version,scored_at",
    ).eq("company_id", companyId).eq("tender_id", tenderId).maybeSingle(),
  ]);
  if (tenderResult.error || !tenderResult.data) {
    return reply(req, { error: "Tender evidence is unavailable." }, 409);
  }
  for (const result of [evidenceResult, lotsResult, productsResult, scoreResult]) {
    if (result.error) {
      console.error("tender_ask_context_error", result.error.code ?? "CONTEXT_QUERY_FAILED");
      return reply(req, { error: "Tender evidence is temporarily unavailable." }, 503);
    }
  }

  const allSources = buildSources({
    tender: tenderResult.data as Record<string, unknown>,
    evidence: (evidenceResult.data ?? []) as Array<Record<string, unknown>>,
    lots: (lotsResult.data ?? []) as Array<Record<string, unknown>>,
    products: (productsResult.data ?? []) as Array<Record<string, unknown>>,
    score: scoreResult.data as Record<string, unknown> | null,
  });
  const sources = rankTenderQuestionSources(question, allSources);
  if (!sources.length) return reply(req, { error: "No tender evidence is available yet." }, 409);
  const questionHash = await tenderQuestionSha256(normalizedQuestion);
  const contextHash = await tenderQuestionSha256(stableTenderQuestionJson({
    tender_id: tenderId,
    company_id: companyId,
    extraction_version: tenderResult.data.ai_extraction_version,
    tender_updated_at: tenderResult.data.updated_at,
    sources,
  }));

  const { data: reservation, error: reservationError } = await admin.rpc(
    "reserve_tender_question_v1",
    {
      p_user_id: user.id,
      p_company_id: companyId,
      p_tender_id: tenderId,
      p_question: question,
      p_normalized_question: normalizedQuestion,
      p_question_hash: questionHash,
      p_context_hash: contextHash,
      p_lease_seconds: 120,
    },
  );
  if (reservationError || !reservation) {
    console.error("tender_ask_reservation_error", reservationError?.code ?? "RESERVATION_FAILED");
    return reply(req, { error: "Tender Q&A is temporarily unavailable." }, 503);
  }
  if (reservation.status === "completed") {
    return reply(req, {
      status: "completed",
      cached: true,
      answer: reservation.answer,
      uncertainty: reservation.uncertainty,
      citations: reservation.citations,
      usage: {
        input_tokens: reservation.input_tokens,
        output_tokens: reservation.output_tokens,
        total_tokens: reservation.total_tokens,
        estimated_cost_usd: reservation.estimated_cost_usd,
      },
    });
  }
  if (!reservation.should_execute) {
    if (reservation.status === "failed") {
      return reply(req, {
        error: "This identical question recently failed. Wait briefly before retrying.",
        code: "RETRY_COOLDOWN",
        retry_after: reservation.retry_after ?? null,
      }, 409);
    }
    return reply(req, { status: "processing", cached: false }, 202);
  }

  const dailyLimit = Math.floor(boundedNumber("AI_DAILY_LIMIT", DEFAULT_DAILY_LIMIT, 1, 500));
  const { data: usageReservation, error: usageError } = await admin.rpc(
    "reserve_medichall_ai_request",
    {
      p_user_id: user.id,
      p_mode: "tender_question",
      p_role: "company",
      p_input_chars: question.length + stableTenderQuestionJson(sources).length,
      p_daily_limit: dailyLimit,
    },
  );
  const usageRow = Array.isArray(usageReservation) ? usageReservation[0] : usageReservation;
  if (usageError || !usageRow?.allowed) {
    await admin.rpc("complete_tender_question_v1", {
      p_answer_id: reservation.answer_id,
      p_usage_id: null,
      p_status: "failed",
      p_error_code: usageError ? "USAGE_RESERVATION_FAILED" : "DAILY_LIMIT_REACHED",
    });
    return reply(req, {
      error: usageError ? "Tender Q&A is temporarily unavailable." : "Daily AI usage limit reached.",
      code: usageError ? undefined : "DAILY_LIMIT_REACHED",
    }, usageError ? 503 : 429);
  }

  const usageId = Number(usageRow.usage_id);
  const model = Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_MODEL;
  const inputPrice = boundedNumber("AI_INPUT_COST_PER_MILLION_TOKENS", 3, 0, 1_000);
  const outputPrice = boundedNumber("AI_OUTPUT_COST_PER_MILLION_TOKENS", 15, 0, 1_000);
  const maxCost = boundedNumber("MAX_TENDER_ASK_COST_USD", DEFAULT_MAX_COST_USD, 0.001, 1);
  const providerInput = stableTenderQuestionJson({ question, sources });
  const estimatedMaximum = estimateTenderQuestionCost(
    Math.ceil(providerInput.length / 4), MAX_OUTPUT_TOKENS, inputPrice, outputPrice,
  );
  await admin.from("medichall_ai_usage").update({
    feature: "tender_question",
    company_id: companyId,
    tender_id: tenderId,
    provider_name: "Anthropic",
    model_name: model,
    request_key: `${questionHash}:${contextHash}`,
  }).eq("id", usageId);

  if (estimatedMaximum > maxCost) {
    await admin.rpc("finish_medichall_ai_request", {
      p_usage_id: usageId,
      p_status: "failed",
      p_output_chars: 0,
      p_prompt_tokens: null,
      p_completion_tokens: null,
      p_total_tokens: null,
      p_error_code: "TENDER_ASK_COST_CAP",
    });
    await admin.rpc("complete_tender_question_v1", {
      p_answer_id: reservation.answer_id,
      p_usage_id: usageId,
      p_status: "failed",
      p_error_code: "TENDER_ASK_COST_CAP",
    });
    return reply(req, { error: "This question exceeds the tender Q&A cost guardrail." }, 422);
  }

  let providerRequestId: string | null = null;
  let providerInputTokens: number | null = null;
  let providerOutputTokens: number | null = null;
  let providerTotalTokens: number | null = null;
  let providerEstimatedCost: number | null = null;
  try {
    const providerResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system: [
          "You answer one question about one medical tender using only the supplied sources.",
          "Never invent quantities, requirements, certifications, dates, company capabilities, or compliance conclusions.",
          "Distinguish tender evidence from the company's own product evidence.",
          "If evidence is insufficient, say so explicitly and describe what must be verified.",
          "Do not give a final legal, regulatory, clinical, or procurement eligibility decision.",
          "Return one JSON object only: {\"answer\":string,\"citation_ids\":string[],\"uncertainty\":string}.",
          "Use supplied source IDs in square brackets after factual statements, one source ID per bracket, and include the same IDs in citation_ids. Never rename or renumber an ID.",
        ].join("\n"),
        messages: [{ role: "user", content: providerInput }],
      }),
    });
    const provider = await providerResponse.json() as ProviderPayload;
    providerRequestId = provider.id ?? null;
    providerInputTokens = Number.isFinite(Number(provider.usage?.input_tokens))
      ? Math.max(0, Number(provider.usage?.input_tokens))
      : null;
    providerOutputTokens = Number.isFinite(Number(provider.usage?.output_tokens))
      ? Math.max(0, Number(provider.usage?.output_tokens))
      : null;
    providerTotalTokens = providerInputTokens != null && providerOutputTokens != null
      ? providerInputTokens + providerOutputTokens
      : null;
    providerEstimatedCost = providerInputTokens != null && providerOutputTokens != null
      ? estimateTenderQuestionCost(
        providerInputTokens, providerOutputTokens, inputPrice, outputPrice,
      )
      : null;
    if (providerEstimatedCost != null) {
      await admin.from("medichall_ai_usage").update({
        estimated_cost_usd: providerEstimatedCost,
      }).eq("id", usageId);
    }
    if (!providerResponse.ok) throw new Error(`ANTHROPIC_${providerResponse.status}`);
    if (provider.stop_reason === "max_tokens") throw new Error("TRUNCATED_PROVIDER_ANSWER");
    const grounded = parseGroundedTenderAnswer(providerText(provider), sources);
    const inputTokens = providerInputTokens ?? 0;
    const outputTokens = providerOutputTokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const estimatedCost = providerEstimatedCost ?? 0;
    await admin.rpc("finish_medichall_ai_request", {
      p_usage_id: usageId,
      p_status: "completed",
      p_output_chars: grounded.answer.length,
      p_prompt_tokens: inputTokens,
      p_completion_tokens: outputTokens,
      p_total_tokens: totalTokens,
      p_error_code: null,
    });
    const citations = grounded.citations.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      excerpt: source.text.slice(0, 420),
      meta: source.meta ?? {},
    }));
    await admin.rpc("complete_tender_question_v1", {
      p_answer_id: reservation.answer_id,
      p_usage_id: usageId,
      p_status: "completed",
      p_answer: grounded.answer,
      p_uncertainty: grounded.uncertainty,
      p_citations: citations,
      p_provider_name: "Anthropic",
      p_model_name: model,
      p_provider_request_id: providerRequestId,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_total_tokens: totalTokens,
      p_estimated_cost_usd: estimatedCost,
      p_error_code: null,
    });
    return reply(req, {
      status: "completed",
      cached: false,
      answer: grounded.answer,
      uncertainty: grounded.uncertainty,
      citations,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        estimated_cost_usd: estimatedCost,
      },
    });
  } catch (error) {
    const code = tenderQuestionErrorCode(error);
    console.error("tender_ask_request_failed", code);
    await admin.rpc("finish_medichall_ai_request", {
      p_usage_id: usageId,
      p_status: "failed",
      p_output_chars: 0,
      p_prompt_tokens: providerInputTokens,
      p_completion_tokens: providerOutputTokens,
      p_total_tokens: providerTotalTokens,
      p_error_code: code,
    });
    await admin.rpc("complete_tender_question_v1", {
      p_answer_id: reservation.answer_id,
      p_usage_id: usageId,
      p_status: "failed",
      p_provider_name: "Anthropic",
      p_model_name: model,
      p_provider_request_id: providerRequestId,
      p_input_tokens: providerInputTokens,
      p_output_tokens: providerOutputTokens,
      p_total_tokens: providerTotalTokens,
      p_estimated_cost_usd: providerEstimatedCost,
      p_error_code: code,
    });
    return reply(req, { error: "Tender Q&A could not complete. Please try again." }, 502);
  }
}

if (import.meta.main) Deno.serve(handleTenderAskRequest);

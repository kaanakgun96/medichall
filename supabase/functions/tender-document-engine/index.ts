import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://medichall.com",
  "https://www.medichall.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const MAX_DOCUMENTS = 6;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
]);

type QueuePayload = {
  action?: "queue" | "status";
  tender_id?: number;
  company_id?: number;
};

type AnalysisOutput = {
  analysis_status: "completed" | "partial";
  lots?: Array<Record<string, unknown>>;
  fit_narrative?: string | null;
  document_confidence_score: number;
  data_completeness_score: number;
  summary: string;
  missing_information: string[];
  products: Array<{
    product_name: string;
    normalized_product_name: string | null;
    lot_number: string | null;
    quantity_value: number | null;
    quantity_unit: string | null;
    packaging: string | null;
    sterility: string | null;
    material: string | null;
    dimensions: string | null;
    required_certifications: string[];
    technical_requirements: string[];
    confidence_score: number;
    evidence: Array<{
      document_id: number;
      page_number: number | null;
      sheet_name: string | null;
      cell_range: string | null;
      source_quote: string;
      field_name: string;
      extracted_value: string;
      confidence_score: number;
    }>;
  }>;
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

function clampScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function extractClaudeText(data: any): string {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((block: any) => block?.type === "text")
    .map((block: any) => String(block.text || ""))
    .join("\n")
    .trim();
}

function stripJsonFence(value: string): string {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function fetchAsBase64(url: string): Promise<{
  data: string;
  mimeType: string;
}> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "MedicHall-Tender-Document-Engine/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Could not download document (${response.status})`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_FILE_BYTES) {
    throw new Error("Document exceeds the configured size limit");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("Document exceeds the configured size limit");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return {
    data: btoa(binary),
    mimeType:
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ||
      "application/pdf",
  };
}

async function buildClaudeContent(documents: any[], documentMap: any[], companyContext: any) {
  const content: any[] = [];

  for (const document of documents) {
    const mimeType = String(document.mime_type || "").toLowerCase();
    if (document.__inline_text) {
      content.push({
        type: "text",
        text: `\n[DOCUMENT: ${document.file_name}]\n` + document.__inline_text,
      });
      continue;
    }
    const downloaded = await fetchAsBase64(document.file_url);

    if (mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: downloaded.data,
        },
        title: document.file_name || document.title || `Document ${document.id}`,
        context: `MedicHall tender document ID: ${document.id}. Type: ${document.document_type || "other"}.`,
        citations: { enabled: true },
      });
      continue;
    }

    if (mimeType === "text/plain" || mimeType === "text/csv") {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(downloaded.data), (c) => c.charCodeAt(0)),
      );
      content.push({
        type: "text",
        text: [
          `<document id="${document.id}" filename="${document.file_name || ""}">`,
          decoded.slice(0, 200_000),
          "</document>",
        ].join("\n"),
      });
    }
  }

  const prompt = `
You are MedicHall's medical tender document extraction engine.

Your only task is to extract verifiable procurement facts from the attached tender documents.

STRICT RULES:
1. Never infer, estimate, guess, complete, normalize from industry knowledge, or invent missing facts.
2. A tender title, CPV code, or broad category is not proof of a specific product.
3. Product name and quantity must be explicitly supported by the documents.
4. If a field cannot be proven, return null or an empty array.
5. Keep the source product wording and original quantity unit.
6. Distinguish annual quantity, estimated quantity, minimum quantity, package quantity and contract quantity whenever the document does.
7. Do not multiply package size by package count unless the document explicitly defines both and the calculation is certain.
8. Every extracted material field must have evidence.
9. Evidence must include document_id, a short exact source quote, and page number when visible.
10. Mark the result "partial" if:
   - product names cannot be proven,
   - quantities cannot be proven,
   - relevant appendices appear missing,
   - documents are ambiguous,
   - tables are unreadable,
   - or extraction confidence is limited.
11. Confidence represents evidence strength, not how plausible the result sounds.
12. Return JSON only. Do not add markdown or commentary outside JSON.
13. "lots": list each lot the documents explicitly define (max 30). catalog_fit_score compares the lot against the COMPANY PROFILE below (keyword overlap, certifications, product family) — 0 if the profile is empty or clearly unrelated. fit_reason is one short sentence.
14. "fit_narrative": 2-3 sentences addressed to the company ("Your company ..."), based ONLY on the COMPANY PROFILE below and facts extracted from the documents. Null if the profile is empty.
15. "summary": 2-4 plain-language sentences a busy sales manager can read in 15 seconds: what is being bought, by whom, how big, key requirements.

COMPANY PROFILE (for lots.catalog_fit_score and fit_narrative ONLY — never treat it as tender evidence):
${JSON.stringify(companyContext || {}, null, 2)}

DOCUMENT MAP:
${JSON.stringify(documentMap, null, 2)}

Return this exact JSON structure:
{
  "analysis_status": "completed" | "partial",
  "document_confidence_score": 0-100,
  "data_completeness_score": 0-100,
  "summary": "brief factual summary",
  "missing_information": ["..."],
  "products": [
    {
      "product_name": "exact document wording",
      "normalized_product_name": "optional conservative English normalization or null",
      "lot_number": "lot identifier or null",
      "quantity_value": number or null,
      "quantity_unit": "original unit or null",
      "packaging": "explicit packaging information or null",
      "sterility": "explicit sterility requirement or null",
      "material": "explicit material or null",
      "dimensions": "explicit dimensions or null",
      "required_certifications": ["only explicit requirements"],
      "technical_requirements": ["only explicit requirements"],
      "confidence_score": 0-100,
      "evidence": [
        {
          "document_id": integer,
          "page_number": integer or null,
          "sheet_name": null,
          "cell_range": null,
          "source_quote": "short exact quote",
          "field_name": "product_name|quantity|packaging|sterility|material|dimensions|certification|technical_requirement",
          "extracted_value": "value proven by quote",
          "confidence_score": 0-100
        }
      ]
    }
  ],
  "lots": [
    {
      "lot_number": "string or null",
      "lot_title": "exact document wording",
      "estimated_quantity": number or null,
      "quantity_unit": "string or null",
      "estimated_value": number or null,
      "currency": "string or null",
      "catalog_fit_score": 0-100,
      "fit_reason": "one short sentence"
    }
  ],
  "fit_narrative": "2-3 sentences or null"
}
`.trim();

  content.push({ type: "text", text: prompt });
  return content;
}

async function processJob(
  adminClient: ReturnType<typeof createClient>,
  anthropicKey: string,
  jobId: number,
) {
  const { data: job, error: jobError } = await adminClient
    .from("tender_document_analysis_jobs")
    .select("id,tender_id,company_id,selected_document_ids,status,attempt_count")
    .eq("id", jobId)
    .single();

  if (jobError || !job) throw new Error("Analysis job not found");

  const model = Deno.env.get("DOC_ENGINE_MODEL") ||
    Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
  if (!model) {
    throw new Error("ANTHROPIC_MODEL secret is missing");
  }

  await adminClient
    .from("tender_document_analysis_jobs")
    .update({
      status: "processing",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attempt_count: Number(job.attempt_count || 0) + 1,
      model_name: model,
      error_code: null,
      error_message: null,
    })
    .eq("id", jobId);

  await adminClient
    .from("tenders")
    .update({
      document_analysis_status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.tender_id);

  const selectedIds = (job.selected_document_ids || [])
    .slice(0, MAX_DOCUMENTS)
    .map(Number);

  const { data: documents, error: documentError } = await adminClient
    .from("tender_documents")
    .select("id,title,file_name,file_url,mime_type,document_type,language_code")
    .in("id", selectedIds)
    .eq("tender_id", job.tender_id)
    .eq("is_active", true);

  if (documentError) throw new Error(documentError.message);

  const usableDocuments = (documents || []).filter((document: any) =>
    SUPPORTED_MIME_TYPES.has(String(document.mime_type || "").toLowerCase()) &&
    isSafeHttpsUrl(String(document.file_url || ""))
  );

  let noticeOnly = false;
  if (!usableDocuments.length) {
    // FALLBACK: no downloadable attachments (national portals often sit behind
    // JS/captcha/login). Build the analysis text from structured TED data
    // instead: (1) what we already stored in the tenders row, and (2) the
    // official TED Search API queried by publication number — both are JSON,
    // no scraping, no captcha. (The TED notice web page is a JS app and
    // returns an empty HTML shell, so scraping it never works.)
    const { data: tenderRow } = await adminClient
      .from("tenders")
      .select("source_url,source_notice_id,title,description,buyer_name,country_name,cpv_codes,deadline_at,estimated_value,currency,raw_payload")
      .eq("id", job.tender_id)
      .single();

    const collect = (value: unknown, out: string[], depth = 0) => {
      if (value == null || depth > 6 || out.join(" ").length > 50_000) return;
      if (typeof value === "string") { if (value.trim()) out.push(value.trim()); return; }
      if (typeof value === "number" || typeof value === "boolean") { out.push(String(value)); return; }
      if (Array.isArray(value)) { for (const v of value) collect(v, out, depth + 1); return; }
      if (typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          out.push(k + ":"); collect(v, out, depth + 1);
        }
      }
    };

    const chunks: string[] = [];
    if (tenderRow?.title) chunks.push("TITLE: " + tenderRow.title);
    if (tenderRow?.buyer_name) chunks.push("BUYER: " + tenderRow.buyer_name);
    if (tenderRow?.country_name) chunks.push("COUNTRY: " + tenderRow.country_name);
    if (tenderRow?.deadline_at) chunks.push("DEADLINE: " + tenderRow.deadline_at);
    if (tenderRow?.estimated_value) chunks.push("ESTIMATED VALUE: " + tenderRow.estimated_value + " " + (tenderRow.currency || ""));
    if (Array.isArray(tenderRow?.cpv_codes) && tenderRow.cpv_codes.length) chunks.push("CPV: " + tenderRow.cpv_codes.join(", "));
    if (tenderRow?.description) chunks.push("DESCRIPTION: " + tenderRow.description);

    // Enrich via TED Search API v3 (JSON, public, reliable)
    const pub = String(tenderRow?.source_notice_id || "").trim();
    if (/^\d{1,10}-\d{4}$/.test(pub)) {
      try {
        const apiRes = await fetch("https://api.ted.europa.eu/v3/notices/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `publication-number IN (${pub})`,
            fields: [
              "notice-title", "description-proc", "description-lot", "title-lot",
              "buyer-name", "buyer-country", "classification-cpv",
              "deadline-receipt-tender-date-lot",
              "estimated-value-proc", "estimated-value-cur-proc",
              "estimated-value-lot", "place-of-performance",
            ],
            page: 1,
            limit: 1,
            checkQuerySyntax: false,
          }),
        });
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          const notice = (apiData.notices ?? apiData.results ?? [])[0];
          if (notice) {
            const apiChunks: string[] = [];
            collect(notice, apiChunks);
            if (apiChunks.length) chunks.push("[OFFICIAL TED NOTICE DATA]\n" + apiChunks.join(" "));
          }
        }
      } catch (_) { /* enrichment is best-effort */ }
    }

    // Last resort: fold in the raw feed payload we stored at sync time
    if (tenderRow?.raw_payload && typeof tenderRow.raw_payload === "object") {
      const rawChunks: string[] = [];
      collect(tenderRow.raw_payload, rawChunks);
      if (rawChunks.length) chunks.push("[FEED DATA]\n" + rawChunks.join(" "));
    }

    const text = chunks.join("\n\n").replace(/\s+/g, " ").trim().slice(0, 60_000);
    if (text.length < 200) {
      throw new Error("No documents registered and no notice data is available for this tender");
    }
    const noticeUrl = String(tenderRow?.source_url || "https://ted.europa.eu");
    noticeOnly = true;

    // Resmi bildirim PDF'i — TED'in kendi sunucusundan, captcha'sız:
    // https://ted.europa.eu/en/notice/{pub}/pdf  (varsa en zengin kaynak)
    if (/^\d{1,10}-\d{4}$/.test(pub)) {
      try {
        const pdfUrl = `https://ted.europa.eu/en/notice/${pub}/pdf`;
        const head = await fetch(pdfUrl, { method: "GET", headers: { "Range": "bytes=0-3" } });
        const okPdf = head.ok || head.status === 206;
        if (okPdf) {
          usableDocuments.push({
            id: -1,
            title: "Official TED notice PDF",
            file_name: `ted-notice-${pub}.pdf`,
            file_url: pdfUrl,
            mime_type: "application/pdf",
            document_type: "notice",
            language_code: "en",
          });
        }
      } catch (_) { /* PDF is best-effort; text fallback below always ships */ }
    }
    usableDocuments.push({
      id: 0,
      title: "Official TED notice (fallback — no attachments were downloadable)",
      file_name: "ted-notice.txt",
      file_url: noticeUrl,
      mime_type: "text/plain",
      document_type: "notice",
      language_code: "en",
      __inline_text: text,
    });
  }

  const documentMap = usableDocuments.map((document: any) => ({
    document_id: document.id,
    file_name:
      document.file_name || document.title || `Document ${document.id}`,
    document_type: document.document_type,
    language_code: document.language_code,
  }));

  let companyContext: any = null;
  try {
    const [{ data: comp }, { data: prof }] = await Promise.all([
      adminClient.from("companies").select("name,description,certifications").eq("id", job.company_id).single(),
      adminClient.from("company_match_profiles").select("product_keywords,certifications,target_countries,oem_available,private_label_available").eq("company_id", job.company_id).single(),
    ]);
    companyContext = {
      company_name: comp?.name || null,
      description: (comp?.description || "").slice(0, 600) || null,
      certifications: comp?.certifications || prof?.certifications || null,
      product_keywords: prof?.product_keywords || [],
      target_countries: prof?.target_countries || [],
      oem_available: !!prof?.oem_available,
      private_label_available: !!prof?.private_label_available,
    };
  } catch (_) { /* profil yoksa fit alanları null döner */ }

  const content = await buildClaudeContent(usableDocuments, documentMap, companyContext);

  // Büyük ihaleler için sağlamlaştırılmış çağrı:
  // 1) max_tokens 6000 → 16000 (çok lotlu ihalelerde JSON yarıda kesiliyordu)
  // 2) Lot sayısı sınırı sistem talimatına eklendi (en önemli 30 lot)
  // 3) Cevap kesilirse (stop_reason=max_tokens) daha kompakt formatla
  //    otomatik 2. deneme yapılır
  // 4) JSON ayıklama toleranslı: çitler soyulur, ilk { ile son } arası alınır
  const callClaude = async (extraInstruction: string, maxTokens: number) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system:
          "You extract medical procurement facts conservatively. You never fabricate missing tender data and you return JSON only. " +
          "Output COMPACT JSON (no pretty-printing, no line breaks inside the JSON). " +
          "If the tender has many lots, include at most the 30 most significant product lots and note the omission inside missing_information. " +
          extraInstruction,
        messages: [{ role: "user", content }],
      }),
    });
    const responseData = await response.json();
    if (!response.ok) {
      throw new Error(
        responseData?.error?.message ||
          `Anthropic request failed (${response.status})`,
      );
    }
    return responseData;
  };

  const tryParse = (responseData: any): AnalysisOutput | null => {
    let raw = stripJsonFence(extractClaudeText(responseData)) || "";
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AnalysisOutput;
    } catch {
      return null;
    }
  };

  let responseData = await callClaude("", 16000);
  let analysis = tryParse(responseData);

  if (!analysis) {
    const truncated = responseData?.stop_reason === "max_tokens";
    // 2. deneme: daha az lot, daha kısa kanıt — kesilme ihtimalini bitir
    responseData = await callClaude(
      truncated
        ? "CRITICAL: Your previous answer was cut off. Return at most 12 lots, keep each evidence quote under 15 words, and keep the JSON as short as possible."
        : "CRITICAL: Reply with ONLY one valid JSON object and nothing else.",
      16000,
    );
    analysis = tryParse(responseData);
  }

  if (!analysis) {
    throw new Error(
      responseData?.stop_reason === "max_tokens"
        ? "The tender is too large — the analysis was truncated twice. Try again; if it persists this tender needs manual review."
        : "Claude returned invalid JSON",
    );
  }

  analysis.document_confidence_score = clampScore(
    analysis.document_confidence_score,
  );
  analysis.data_completeness_score = clampScore(
    analysis.data_completeness_score,
  );

  analysis.products = (analysis.products || []).map((product) => ({
    ...product,
    confidence_score: clampScore(product.confidence_score),
    evidence: (product.evidence || [])
      .filter((item) => selectedIds.includes(Number(item.document_id)))
      .map((item) => ({
        ...item,
        confidence_score: clampScore(item.confidence_score),
        source_quote: String(item.source_quote || "").slice(0, 600),
        extracted_value: String(item.extracted_value || "").slice(0, 500),
      })),
  }));

  await adminClient
    .from("tender_document_evidence")
    .delete()
    .eq("job_id", jobId);

  const evidenceRows: any[] = [];
  for (const product of analysis.products) {
    for (const evidence of product.evidence || []) {
      evidenceRows.push({
        tender_id: job.tender_id,
        document_id: evidence.document_id,
        job_id: jobId,
        evidence_type: "product_field",
        product_name: product.product_name,
        field_name: evidence.field_name,
        extracted_value: evidence.extracted_value,
        quantity_value:
          evidence.field_name === "quantity" ? product.quantity_value : null,
        quantity_unit:
          evidence.field_name === "quantity" ? product.quantity_unit : null,
        lot_number: product.lot_number,
        page_number: evidence.page_number,
        sheet_name: evidence.sheet_name,
        cell_range: evidence.cell_range,
        source_quote: evidence.source_quote,
        confidence_score: evidence.confidence_score,
      });
    }
  }

  if (evidenceRows.length) {
    const { error: evidenceError } = await adminClient
      .from("tender_document_evidence")
      .insert(evidenceRows);
    if (evidenceError) throw new Error(evidenceError.message);
  }

  const finalStatus =
    analysis.analysis_status === "completed" ? "completed" : "partial";

  const { error: tenderUpdateError } = await adminClient
    .from("tenders")
    .update({
      document_analysis_status: finalStatus,
      document_confidence_score: analysis.document_confidence_score,
      data_completeness_score: analysis.data_completeness_score,
      analyzed_document_count: usableDocuments.length,
      extracted_products: analysis.products,
      missing_information: analysis.missing_information || [],
      document_analysis_notes: analysis.summary,
      ai_lots: Array.isArray(analysis.lots) ? analysis.lots.slice(0, 30) : [],
      last_document_analysis_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.tender_id);

  if (tenderUpdateError) throw new Error(tenderUpdateError.message);

  await adminClient
    .from("tender_document_analysis_jobs")
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const { data: companyMatches } = await adminClient
    .from("opportunity_matches")
    .select("company_id")
    .eq("tender_id", job.tender_id);

  const companyIds = [
    ...new Set((companyMatches || []).map((row: any) => Number(row.company_id))),
  ];

  for (const companyId of companyIds) {
    await (analysis.fit_narrative
    ? adminClient
        .from("opportunity_matches")
        .update({ fit_narrative: String(analysis.fit_narrative).slice(0, 1200), updated_at: new Date().toISOString() })
        .eq("company_id", job.company_id)
        .eq("tender_id", job.tender_id)
    : Promise.resolve({ error: null })
  );
  await adminClient.rpc("refresh_explainable_tender_matches", {
      p_company_id: companyId,
    });
  }
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
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !anthropicKey) {
    return json(req, { error: "Claude document engine is not configured." }, 500);
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

  let payload: QueuePayload;
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  const tenderId = Number(payload.tender_id);
  const companyId = Number(payload.company_id);

  if (!Number.isInteger(tenderId) || !Number.isInteger(companyId)) {
    return json(req, {
      error: "Valid tender_id and company_id are required.",
    }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (payload.action === "status") {
    const { data, error } = await userClient.rpc(
      "get_tender_document_analysis_status",
      { p_tender_id: tenderId, p_company_id: companyId },
    );

    if (error) return json(req, { error: error.message }, 400);

    return json(req, {
      job: Array.isArray(data) ? data[0] ?? null : data,
    });
  }

  const { data: queued, error: queueError } = await userClient.rpc(
    "queue_tender_document_analysis",
    { p_tender_id: tenderId, p_company_id: companyId },
  );

  if (queueError) {
    return json(req, { error: queueError.message }, 400);
  }

  const job = Array.isArray(queued) ? queued[0] : queued;

  if (!job?.id) {
    return json(req, { error: "Could not create analysis job." }, 500);
  }

  EdgeRuntime.waitUntil(
    processJob(adminClient, anthropicKey, Number(job.id)).catch(
      async (error) => {
        console.error("Claude tender analysis failed", error);

        await adminClient
          .from("tender_document_analysis_jobs")
          .update({
            status: "failed",
            error_code: "CLAUDE_DOCUMENT_ANALYSIS_FAILED",
            error_message: String(error?.message || error).slice(0, 1000),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        await adminClient
          .from("tenders")
          .update({
            document_analysis_status: "failed",
            document_analysis_notes: String(error?.message || error).slice(
              0,
              1000,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("id", tenderId);
      },
    ),
  );

  return json(req, {
    ok: true,
    job_id: job.id,
    status: job.status,
    engine: "claude",
    message: "Tender document analysis has been queued.",
  }, 202);
});

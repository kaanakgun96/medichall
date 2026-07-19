// MedicHall TED Sync — v1.0
//
// Pulls recent medical procurement notices from the official TED Search API v3
// (https://api.ted.europa.eu/v3/notices/search — public, no API key needed),
// upserts them into public.tenders, then refreshes opportunity matches for
// every company that has a matching profile.
//
// Trigger: pg_cron daily schedule (see 202607100006_ted_cron.sql) or manual
// POST with the x-cron-secret header.
//
// Required secrets:  CRON_SECRET            (any long random string)
// Optional secrets:  TED_CPV                (space separated, default medical set)
//                    TED_LOOKBACK_DAYS      (default 2)
//                    TED_MAX_PAGES          (default 2, 250 notices per page)

import { createClient } from "npm:@supabase/supabase-js@2";

const TED_ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";
// Exact CPV codes (TED matches codes exactly; wildcards are unreliable).
// 33100000 medical equipment, 33140000 medical consumables, 33141000 disposable
// non-chemical consumables, 33169000 surgical instruments, 33190000 misc medical
// devices, 33124000 diagnostics, 33141620 medical kits, 33199000 medical clothing,
// 35113400 protective clothing, 33192000 medical furniture.
const DEFAULT_CPV =
  "33000000 33100000 33124000 33140000 33141000 33141100 33141200 33141300 " +
  "33141400 33141420 33141600 33141620 33141700 33150000 33157000 33160000 " +
  "33162000 33169000 33170000 33190000 33192000 33194000 33196000 33198000 " +
  "33199000";
const PAGE_LIMIT = 250;

// ISO2 -> ISO3 map for the EU/EEA countries MedicHall targets.
const ISO3: Record<string, string> = {
  AT:"AUT", BE:"BEL", BG:"BGR", HR:"HRV", CY:"CYP", CZ:"CZE", DK:"DNK",
  EE:"EST", FI:"FIN", FR:"FRA", DE:"DEU", GR:"GRC", HU:"HUN", IE:"IRL",
  IT:"ITA", LV:"LVA", LT:"LTU", LU:"LUX", MT:"MLT", NL:"NLD", PL:"POL",
  PT:"PRT", RO:"ROU", SK:"SVK", SI:"SVN", ES:"ESP", SE:"SWE", NO:"NOR",
  IS:"ISL", CH:"CHE", GB:"GBR", TR:"TUR",
};
const ISO3_TO_2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO3).map(([k, v]) => [v, k]),
);
const COUNTRY_NAMES: Record<string, string> = {
  AT:"Austria", BE:"Belgium", BG:"Bulgaria", HR:"Croatia", CY:"Cyprus",
  CZ:"Czechia", DK:"Denmark", EE:"Estonia", FI:"Finland", FR:"France",
  DE:"Germany", GR:"Greece", HU:"Hungary", IE:"Ireland", IT:"Italy",
  LV:"Latvia", LT:"Lithuania", LU:"Luxembourg", MT:"Malta", NL:"Netherlands",
  PL:"Poland", PT:"Portugal", RO:"Romania", SK:"Slovakia", SI:"Slovenia",
  ES:"Spain", SE:"Sweden", NO:"Norway", IS:"Iceland", CH:"Switzerland",
  GB:"United Kingdom", TR:"Turkey",
};
const NAME_TO_ISO2: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_NAMES).map(([k, v]) => [v.toLowerCase(), k]),
);

type TedNotice = Record<string, unknown>;

function firstText(value: unknown): string {
  // TED multilingual fields come as { eng: ["..."], ita: ["..."] } or arrays.
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstText(value[0]);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.eng) return firstText(obj.eng);
    const keys = Object.keys(obj);
    return keys.length ? firstText(obj[keys[0]]) : "";
  }
  return String(value);
}

function toArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  return [String(value)].filter(Boolean);
}

function toIso2(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  const upper = v.toUpperCase();
  if (upper.length === 2 && ISO3[upper]) return upper;
  if (upper.length === 3 && ISO3_TO_2[upper]) return ISO3_TO_2[upper];
  return NAME_TO_ISO2[v.toLowerCase()] ?? "";
}

// TED dates can look like "2026-08-14+02:00" (date + offset, no time) which
// makes new Date(...) invalid. Parse defensively; never throw.
function safeIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.toISOString();
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const d2 = new Date(m[1] + "T12:00:00Z");
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }
  return null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || given !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Elle tetiklemede gövdeden geçici ayar alınabilir: {"lookback_days":30,"max_pages":5}
  let bodyOverride: { lookback_days?: number; max_pages?: number } = {};
  try { bodyOverride = await req.json(); } catch (_) { /* gövde boş olabilir (cron) */ }

  const lookbackDays = Math.min(60, Math.max(1,
    Number(bodyOverride.lookback_days ?? Deno.env.get("TED_LOOKBACK_DAYS") ?? 2)));
  const maxPages = Math.min(10, Math.max(1,
    Number(bodyOverride.max_pages ?? Deno.env.get("TED_MAX_PAGES") ?? 2)));
  const cpvList = (Deno.env.get("TED_CPV") ?? DEFAULT_CPV).trim();

  // 1) Ülke kapsamı — v1.3 DEĞİŞİKLİĞİ:
  //    Eski davranış, beslemeyi kullanıcı profillerindeki hedef ülkelerle
  //    SINIRLIYORDU (bu yüzden yalnız İtalya/İspanya/Estonya geliyordu).
  //    Yeni varsayılan: kısıt YOK → tüm AB medikal ihaleleri çekilir.
  //    Daraltmak istersen TED_COUNTRIES secret'ı: "DE,FR,IT" gibi ISO2 liste.
  const iso3Set = new Set<string>();
  const envCountries = (Deno.env.get("TED_COUNTRIES") ?? "").trim();
  if (envCountries) {
    for (const c of envCountries.split(",")) {
      const iso2 = toIso2(c.trim());
      if (iso2 && ISO3[iso2]) iso3Set.add(ISO3[iso2]);
    }
  }
  const countryClause = iso3Set.size
    ? ` AND buyer-country IN (${[...iso3Set].join(" ")})`
    : "";

  // 2) Query TED Search API v3 with a fallback chain.
  //    Proven syntax in the wild: numeric dates (yyyymmdd), exact CPV codes.
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const sinceNum = since.toISOString().slice(0, 10).replace(/-/g, "");

  const cpvIn = `classification-cpv IN (${cpvList})`;
  const dateGte = `publication-date >= ${sinceNum}`;

  // Attempt 1: contract notices only, with country filter.
  // Attempt 2: drop the form-type filter (some notice types slip the facet).
  // Attempt 3: drop the country filter too (widest net; scoring sorts it out).
  const attempts = [
    `(${cpvIn}) AND (${dateGte}) AND (form-type = competition)${countryClause}`,
    `(${cpvIn}) AND (${dateGte})${countryClause}`,
    `(${cpvIn}) AND (${dateGte})`,
  ];

  const fields = [
    "publication-number",
    "publication-date",
    "notice-title",
    "description-proc",
    "buyer-name",
    "buyer-country",
    "classification-cpv",
    "notice-type",
    "deadline-receipt-tender-date-lot",
    "estimated-value-proc",
    "estimated-value-cur-proc",
  ];

  const notices: TedNotice[] = [];
  const attemptLog: { query: string; status: string; got: number }[] = [];
  let usedQuery = "";

  for (const query of attempts) {
    let attemptNotices: TedNotice[] = [];
    let failed = "";
    for (let page = 1; page <= maxPages; page++) {
      try {
        const res = await fetch(TED_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            fields,
            page,
            limit: PAGE_LIMIT,
            scope: "ACTIVE",
            paginationMode: "PAGE_NUMBER",
            onlyLatestVersions: true,
            checkQuerySyntax: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          failed = `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`;
          break;
        }
        const pageNotices = (data.notices ?? data.results ?? []) as TedNotice[];
        attemptNotices.push(...pageNotices);
        const total = Number(data.totalNoticeCount ?? data.total ?? pageNotices.length);
        if (page * PAGE_LIMIT >= total || pageNotices.length === 0) break;
      } catch (e) {
        failed = `fetch failed: ${String(e)}`;
        break;
      }
    }
    attemptLog.push({
      query,
      status: failed || "ok",
      got: attemptNotices.length,
    });
    if (!failed && attemptNotices.length > 0) {
      notices.push(...attemptNotices);
      usedQuery = query;
      break;
    }
  }
  const tedError = notices.length
    ? null
    : "All query attempts returned no notices — see attempts log";

  // 3) Map + upsert into public.tenders (bad rows are skipped, never crash).
  const skipped: string[] = [];
  const rows = notices.flatMap((n) => {
    try {
      const pubNumber = firstText(n["publication-number"]);
      if (!pubNumber) return [];
      const countryRaw = firstText(
        Array.isArray(n["buyer-country"]) ? (n["buyer-country"] as unknown[])[0] : n["buyer-country"],
      );
      const iso2 = toIso2(countryRaw);
      const estValue = firstText(n["estimated-value-proc"]);
      const pubDate = firstText(n["publication-date"]).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
      return [{
        source: "TED",
        source_notice_id: pubNumber,
        title: firstText(n["notice-title"]).slice(0, 500) || "Untitled notice",
        description: firstText(n["description-proc"]).slice(0, 5000) || null,
        buyer_name: firstText(n["buyer-name"]).slice(0, 300) || null,
        country_code: iso2 || null,
        country_name: iso2 ? COUNTRY_NAMES[iso2] : (countryRaw || null),
        cpv_codes: toArray(n["classification-cpv"]),
        product_keywords: [] as string[],
        publication_date: pubDate,
        deadline_at: safeIso(firstText(n["deadline-receipt-tender-date-lot"])),
        estimated_value: estValue && !isNaN(Number(estValue)) ? Number(estValue) : null,
        currency: firstText(n["estimated-value-cur-proc"]) || null,
        source_url: `https://ted.europa.eu/en/notice/-/detail/${pubNumber}`,
        language_code: "en",
        raw_payload: n,
        status: "open",
        updated_at: new Date().toISOString(),
      }];
    } catch (e) {
      skipped.push(String(e).slice(0, 120));
      return [];
    }
  });

  let upserted = 0;
  if (rows.length) {
    const { error: upErr, count } = await admin
      .from("tenders")
      .upsert(rows, { onConflict: "source,source_notice_id", count: "exact" });
    if (upErr) {
      return new Response(
        JSON.stringify({ error: "Tender upsert failed", detail: upErr.message, ted_error: tedError }),
        { status: 500 },
      );
    }
    upserted = count ?? rows.length;
  }

  // 4) Close tenders whose deadline has passed.
  await admin
    .from("tenders")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("status", "open")
    .not("deadline_at", "is", null)
    .lt("deadline_at", new Date().toISOString());

  // 5) Refresh matches for every company with a profile.
  let refreshed = 0;
  const refreshErrors: string[] = [];
  for (const p of profiles ?? []) {
    const { error } = await admin.rpc("refresh_company_opportunity_matches", {
      p_company_id: p.company_id,
    });
    if (error) refreshErrors.push(`company ${p.company_id}: ${error.message}`);
    else refreshed++;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      used_query: usedQuery || null,
      attempts: attemptLog,
      fetched: notices.length,
      upserted,
      companies_refreshed: refreshed,
      refresh_errors: refreshErrors,
      skipped_rows: skipped.length,
      ted_error: tedError,
      generated_at: new Date().toISOString(),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req);
  } catch (e) {
    // Never return a bare 500 — always ship a diagnosable JSON body.
    return new Response(
      JSON.stringify({
        ok: false,
        fatal: String(e),
        stack: (e as Error)?.stack?.slice(0, 600) ?? null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
});

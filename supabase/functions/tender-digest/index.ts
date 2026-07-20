// MedicHall Tender Digest — v1.0 (2026-07-20)
//
// Her sabah 07:00 UTC'de (pg_cron, ted-sync'ten 30 dk sonra) çalışır:
//   1. digest_due_saved_searches() → e-posta isteyen kayıtlı aramalar
//   2. Her arama için search_tenders(..., p_created_after=last_digest_at)
//      → SON KOŞUDAN BERİ beslemeye düşen YENİ ihaleler
//   3. Aynı kullanıcının aramaları TEK e-postada gruplanır (Resend)
//   4. Yalnız BAŞARILI gönderimden sonra mark_saved_search_digested()
//      → gönderim patlarsa ihaleler kaybolmaz, ertesi sabah yine gelir
//
// İlkeler:
//   - Yeni ihale yoksa e-posta GÖNDERİLMEZ ("0 sonuç" maili yok — gürültü
//     üretmeyen bildirim, sahte değer üretmeyen platformun e-posta hali).
//   - E-postada orijinal başlık + varsa "EN (machine translation)" satırı;
//     değerlerde orijinal + varsa "≈ EUR" (ECB) — portaldaki kurallar aynen.
//
// Gerekli secrets: CRON_SECRET, RESEND_API_KEY
// Opsiyonel:       DIGEST_FROM  (varsayılan: "MedicHall <alerts@medichall.com>")
//                  DIGEST_MAX_HITS_PER_SEARCH (varsayılan 15)
// Verify JWT: KAPALI (x-cron-secret ile korunur — ted-sync ile aynı)

import { createClient } from "npm:@supabase/supabase-js@2";

type SavedSearch = {
  search_id: number;
  user_id: string;
  name: string;
  query: string | null;
  countries: string[] | null;
  cpv: string[] | null;
  notice_types: string[] | null;
  deadline_days: number | null;
  value_min_eur: number | null;
  value_max_eur: number | null;
  include_unknown_value: boolean;
  last_digest_at: string;
};

type TenderHit = {
  id: number;
  title: string;
  title_en: string | null;
  buyer_name: string | null;
  country_name: string | null;
  deadline_at: string | null;
  estimated_value: number | null;
  currency: string | null;
  estimated_value_eur: number | null;
  notice_type: string | null;
  source_url: string | null;
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function valueLine(t: TenderHit): string {
  if (t.estimated_value == null) return "";
  const orig = `${Number(t.estimated_value).toLocaleString("en-GB")} ${t.currency ?? ""}`.trim();
  if (t.estimated_value_eur != null && t.currency !== "EUR") {
    return `${orig} (≈ ${Math.round(Number(t.estimated_value_eur)).toLocaleString("en-GB")} EUR)`;
  }
  return orig;
}

function tenderHtml(t: TenderHit): string {
  const meta = [
    t.country_name,
    t.buyer_name,
    t.deadline_at ? `Deadline: ${new Date(t.deadline_at).toLocaleDateString("en-GB")}` : null,
    t.notice_type,
    valueLine(t) || null,
  ].filter(Boolean).map(esc).join(" · ");
  const en = t.title_en && t.title_en !== t.title
    ? `<div style="color:#5a7684;font-style:italic;font-size:13px;margin-top:2px">EN (machine translation): ${esc(t.title_en)}</div>`
    : "";
  const link = t.source_url
    ? `<div style="margin-top:4px"><a href="${esc(t.source_url)}" style="color:#0e7490">Open official notice →</a></div>`
    : "";
  return `<div style="padding:12px 0;border-bottom:1px solid #e4edf1">
    <div style="font-weight:600;color:#12313f">${esc(t.title)}</div>
    ${en}
    <div style="color:#5a7684;font-size:13px;margin-top:2px">${meta}</div>
    ${link}
  </div>`;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (!cronSecret || (req.headers.get("x-cron-secret") ?? "") !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      return new Response(JSON.stringify({ ok: false, error: "RESEND_API_KEY secret eksik" }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const fromAddr = Deno.env.get("DIGEST_FROM") ?? "MedicHall <alerts@medichall.com>";
    const maxHits = Math.min(50, Math.max(1,
      Number(Deno.env.get("DIGEST_MAX_HITS_PER_SEARCH") ?? 15)));

    // 1) E-posta isteyen aramalar
    const { data: searches, error: sErr } = await admin.rpc("digest_due_saved_searches");
    if (sErr) throw new Error(`digest_due_saved_searches: ${sErr.message}`);

    // 2) Her arama için YENİ isabetler
    type Bundle = { search: SavedSearch; hits: TenderHit[] };
    const byUser = new Map<string, Bundle[]>();
    const searchErrors: string[] = [];

    for (const s of (searches ?? []) as SavedSearch[]) {
      const { data: hits, error: hErr } = await admin.rpc("search_tenders", {
        p_query: s.query,
        p_countries: s.countries,
        p_cpv: s.cpv,
        p_notice_types: s.notice_types,
        p_deadline_within_days: s.deadline_days,
        p_value_min_eur: s.value_min_eur,
        p_value_max_eur: s.value_max_eur,
        p_include_unknown_value: s.include_unknown_value,
        p_limit: maxHits,
        p_offset: 0,
        p_created_after: s.last_digest_at,
      });
      if (hErr) { searchErrors.push(`search ${s.search_id}: ${hErr.message}`); continue; }
      if (!hits || !hits.length) continue;   // yeni yok → bu arama bu sabah sessiz
      const list = byUser.get(s.user_id) ?? [];
      list.push({ search: s, hits: hits as TenderHit[] });
      byUser.set(s.user_id, list);
    }

    // 3) Kullanıcı başına TEK e-posta
    let emailsSent = 0;
    const digestedIds: number[] = [];
    const sendErrors: string[] = [];

    for (const [userId, bundles] of byUser) {
      // E-posta adresi: Supabase Auth admin API
      const { data: userData, error: uErr } = await admin.auth.admin.getUserById(userId);
      const email = userData?.user?.email ?? null;
      if (uErr || !email) { sendErrors.push(`user ${userId}: e-posta bulunamadı`); continue; }

      const total = bundles.reduce((n, b) => n + b.hits.length, 0);
      const sections = bundles.map((b) =>
        `<h3 style="color:#0e7490;margin:22px 0 4px;font-size:15px">${esc(b.search.name)}
           <span style="color:#5a7684;font-weight:400">— ${b.hits.length} new</span></h3>
         ${b.hits.map(tenderHtml).join("")}`).join("");

      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#12313f">
        <h2 style="color:#12313f">MedicHall — Daily tender digest</h2>
        <p style="color:#5a7684">${total} new tender${total === 1 ? "" : "s"} matched your saved search${bundles.length === 1 ? "" : "es"} since yesterday.</p>
        ${sections}
        <p style="color:#8aa0ab;font-size:12px;margin-top:26px">
          You receive this because email alerts are on for these saved searches in your
          <a href="https://medichall.com/portal.html" style="color:#0e7490">MedicHall portal</a>.
          Turn alerts off per search in Opportunities → All tenders → Saved searches.
        </p>
      </div>`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromAddr,
          to: [email],
          subject: `MedicHall digest: ${total} new tender${total === 1 ? "" : "s"} for your saved searches`,
          html,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        sendErrors.push(`user ${userId}: Resend HTTP ${res.status} ${body.slice(0, 160)}`);
        continue; // damga YOK → yarın yeniden dener, ihale kaybolmaz
      }
      emailsSent++;
      digestedIds.push(...bundles.map((b) => b.search.search_id));
    }

    // 4) Yalnız başarıyla gönderilenlere damga
    let stamped = 0;
    if (digestedIds.length) {
      const { data: st, error: mErr } = await admin.rpc("mark_saved_search_digested", { p_ids: digestedIds });
      if (mErr) sendErrors.push(`damga: ${mErr.message}`); else stamped = Number(st ?? 0);
    }

    return new Response(JSON.stringify({
      ok: true,
      searches_checked: (searches ?? []).length,
      users_with_news: byUser.size,
      emails_sent: emailsSent,
      searches_stamped: stamped,
      search_errors: searchErrors,
      send_errors: sendErrors,
      generated_at: new Date().toISOString(),
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, fatal: String(e) }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
});

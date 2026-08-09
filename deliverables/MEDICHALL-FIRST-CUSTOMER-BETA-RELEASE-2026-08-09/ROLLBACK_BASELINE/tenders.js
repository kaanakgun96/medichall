/* Public tender discovery. Private matching and analysis remain in portal.html. */
(function (global) {
  "use strict";

  const API_URL = "https://azdmuarzntzqdyirysux.supabase.co";
  const PUBLIC_KEY = "sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-";
  const PAGE_SIZE = 20;
  const session = global.MedicHallSession?.configure({ url: API_URL, key: PUBLIC_KEY }) || null;
  const state = {
    rows: [],
    offset: 0,
    total: 0,
    loading: false,
    authenticated: false,
    companyId: null,
    matches: new Map(),
  };

  const elements = {};
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function publicHeaders(extra = {}) {
    return {
      apikey: PUBLIC_KEY,
      Authorization: `Bearer ${PUBLIC_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function publicRequest(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: publicHeaders(options.headers || {}),
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error("Tender discovery is temporarily unavailable.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function authenticatedRequest(path, options = {}) {
    if (!session) throw new Error("Partner session is unavailable.");
    const response = await session.request(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(response.status === 401
        ? "Your session has expired. Sign in again to use private tender actions."
        : "The private tender action could not be completed.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function filters() {
    return {
      query: elements.search.value.trim(),
      country: elements.country.value,
      cpv: elements.cpv.value.trim(),
      deadline: elements.deadline.value,
      notice: elements.notice.value,
    };
  }

  function searchPayload(value, offset) {
    const cpv = [...new Set(value.cpv.split(/[,;]/).map((item) => item.trim()).filter(Boolean))];
    return {
      p_query: value.query || null,
      p_countries: value.country ? [value.country] : null,
      p_cpv: cpv.length ? cpv : null,
      p_notice_types: value.notice ? [value.notice] : null,
      p_deadline_within_days: value.deadline ? Number(value.deadline) : null,
      p_value_min_eur: null,
      p_value_max_eur: null,
      p_include_unknown_value: true,
      p_limit: PAGE_SIZE,
      p_offset: Math.max(0, offset),
      p_created_after: null,
    };
  }

  function updateUrl(value) {
    const parameters = new URLSearchParams();
    for (const [key, item] of Object.entries(value)) {
      if (item) parameters.set(key, item);
    }
    const query = parameters.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }

  function restoreUrl() {
    const parameters = new URLSearchParams(location.search);
    elements.search.value = parameters.get("query") || "";
    elements.cpv.value = parameters.get("cpv") || "";
    elements.deadline.value = parameters.get("deadline") || "";
    elements.pendingCountry = parameters.get("country") || "";
    elements.pendingNotice = parameters.get("notice") || "";
  }

  function activeFilters(value) {
    return [
      ["query", "Keyword", value.query],
      ["country", "Country", value.country],
      ["cpv", "CPV", value.cpv],
      ["deadline", "Deadline", value.deadline ? `next ${value.deadline} days` : ""],
      ["notice", "Notice type", value.notice],
    ].filter((item) => item[2]);
  }

  function renderActiveFilters(value) {
    const active = activeFilters(value);
    elements.filterCount.textContent = String(active.length);
    elements.filterCount.setAttribute("aria-label", `${active.length} active filter${active.length === 1 ? "" : "s"}`);
    elements.activeFilters.hidden = active.length === 0;
    elements.activeFilters.innerHTML = active.map(([key, label, item]) =>
      `<button class="tender-filter-chip" type="button" data-clear-filter="${key}" aria-label="Remove ${escapeHtml(label)} filter">${escapeHtml(label)}: ${escapeHtml(item)} <span aria-hidden="true">×</span></button>`
    ).join("");
  }

  function validHttps(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function formatDate(value) {
    if (!value) return "Deadline not stated";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Deadline not stated";
    return `Deadline ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)}`;
  }

  function formatValue(row) {
    if (row.estimated_value == null) return "";
    const original = `${Number(row.estimated_value).toLocaleString()} ${row.currency || ""}`.trim();
    if (row.estimated_value_eur != null && row.currency !== "EUR") {
      return `${original} · approximately ${Math.round(Number(row.estimated_value_eur)).toLocaleString()} EUR`;
    }
    return original;
  }

  function card(row) {
    const match = state.matches.get(Number(row.id));
    const score = match && Number.isFinite(Number(match.match_score)) ? Math.round(Number(match.match_score)) : null;
    const sourceUrl = validHttps(row.source_url);
    const cpv = Array.isArray(row.cpv_codes) ? row.cpv_codes.filter(Boolean).slice(0, 5) : [];
    const matchBadge = match
      ? `<span class="tender-badge is-match">Company match${match.status === "saved" ? " · saved" : ""}</span>`
      : "";
    const saveAction = match
      ? `<button class="btn btn-ghost btn-sm" type="button" data-save-match="${Number(match.id)}"${match.status === "saved" ? " disabled" : ""}>${match.status === "saved" ? "Saved" : "Save match"}</button>`
      : "";
    const privateAction = state.authenticated
      ? `<a class="btn btn-solid btn-sm" href="portal.html#opportunities">Open private workspace</a>`
      : `<a class="btn btn-solid btn-sm" href="portal.html?return=${encodeURIComponent(`tenders.html${location.search}`)}">Sign in to analyze</a>`;
    return `<article class="tender-card" aria-labelledby="tender-title-${Number(row.id)}">
      <div class="tender-card__top">
        <div>
          <div class="tender-card__kickers"><span class="tender-badge">${escapeHtml(row.notice_type || "Medical tender")}</span><span class="tender-badge">Official feed</span>${matchBadge}</div>
          <h3 id="tender-title-${Number(row.id)}">${escapeHtml(row.title || "Untitled tender")}</h3>
          ${row.title_en && row.title_en !== row.title ? `<p class="tender-title-en">English machine translation: ${escapeHtml(row.title_en)}</p>` : ""}
        </div>
        ${score == null ? "" : `<div class="tender-score" aria-label="Company match score ${score} percent"><strong>${score}%</strong><span>match score</span></div>`}
      </div>
      <div class="tender-meta">
        ${row.country_name ? `<span>${escapeHtml(row.country_name)}</span>` : ""}
        ${row.buyer_name ? `<span>${escapeHtml(row.buyer_name)}</span>` : ""}
        <span>${escapeHtml(formatDate(row.deadline_at))}</span>
        ${formatValue(row) ? `<span>${escapeHtml(formatValue(row))}</span>` : ""}
      </div>
      ${cpv.length ? `<div class="tender-cpv">CPV ${cpv.map(escapeHtml).join(" · ")}</div>` : ""}
      <div class="tender-card__actions">${saveAction}${sourceUrl ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Official notice ↗</a>` : ""}${privateAction}</div>
    </article>`;
  }

  function renderRows(append) {
    const html = state.rows.map(card).join("");
    if (append) elements.list.insertAdjacentHTML("beforeend", html);
    else elements.list.innerHTML = html;
    elements.list.setAttribute("aria-busy", "false");
    elements.status.textContent = `${state.total.toLocaleString()} open tender${state.total === 1 ? "" : "s"}`;
    elements.loadMore.hidden = state.rows.length === 0 || state.offset + state.rows.length >= state.total;
  }

  function renderState(title, message, retry = false) {
    elements.list.setAttribute("aria-busy", "false");
    elements.list.innerHTML = `<div class="tender-state" role="${retry ? "alert" : "status"}"><div class="tender-state__inner"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${retry ? '<button class="btn btn-solid" type="button" data-retry-tenders>Try again</button>' : '<button class="btn btn-ghost" type="button" data-clear-all-tenders>Clear filters</button>'}</div></div>`;
    elements.status.textContent = retry ? "Feed unavailable" : "0 open tenders";
    elements.loadMore.hidden = true;
  }

  function renderLoading(append) {
    elements.list.setAttribute("aria-busy", "true");
    elements.status.textContent = append ? "Loading more…" : "Loading…";
    if (!append) elements.list.innerHTML = '<div class="tender-skeleton" aria-hidden="true"></div><div class="tender-skeleton" aria-hidden="true"></div><div class="tender-skeleton" aria-hidden="true"></div>';
  }

  async function loadTenders({ append = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    const value = filters();
    if (!append) {
      state.offset = 0;
      updateUrl(value);
      renderActiveFilters(value);
    }
    renderLoading(append);
    try {
      const offset = append ? state.rows.length : 0;
      const rows = await publicRequest("/rest/v1/rpc/search_tenders", {
        method: "POST",
        body: JSON.stringify(searchPayload(value, offset)),
      });
      const normalized = Array.isArray(rows) ? rows : [];
      state.total = normalized.length ? Number(normalized[0].total_count || 0) : 0;
      if (append) {
        state.rows.push(...normalized);
        state.offset = offset;
        elements.list.innerHTML = state.rows.map(card).join("");
        elements.list.setAttribute("aria-busy", "false");
        elements.status.textContent = `${state.total.toLocaleString()} open tender${state.total === 1 ? "" : "s"}`;
        elements.loadMore.hidden = state.rows.length >= state.total;
      } else {
        state.rows = normalized;
        if (normalized.length) renderRows(false);
        else renderState("No tenders match these filters", "Try clearing a filter or broadening the keyword or CPV family.");
      }
    } catch (_) {
      if (!append) renderState("Tender feed could not be loaded", "The public discovery service is temporarily unavailable. No private data was requested or changed.", true);
      else elements.status.textContent = "More tenders could not be loaded";
    } finally {
      state.loading = false;
    }
  }

  async function loadFacets() {
    try {
      const facets = await publicRequest("/rest/v1/rpc/tender_filter_facets", { method: "POST", body: "{}" });
      const countries = Array.isArray(facets?.countries) ? facets.countries : [];
      const notices = Array.isArray(facets?.notice_types) ? facets.notice_types : [];
      elements.country.innerHTML = '<option value="">All countries</option>' + countries.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
      elements.notice.innerHTML = '<option value="">All notice types</option>' + notices.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    } catch (_) {
      try {
        const rows = await publicRequest("/rest/v1/tenders?select=country_name&status=eq.open&order=publication_date.desc&limit=1000");
        const countries = [...new Set((rows || []).map((row) => row.country_name).filter(Boolean))].sort();
        elements.country.innerHTML = '<option value="">All countries</option>' + countries.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
      } catch (_) { /* The feed still remains usable without facet suggestions. */ }
    }
    elements.country.value = elements.pendingCountry || "";
    elements.notice.value = elements.pendingNotice || "";
  }

  async function loadPersonalization() {
    if (!session?.hasStoredSession()) return;
    try {
      const user = await session.getUser();
      const companies = await authenticatedRequest(`/rest/v1/companies?select=id,name&owner_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      const company = Array.isArray(companies) ? companies[0] : null;
      state.authenticated = true;
      if (!company) {
        elements.personalization.innerHTML = '<div><b>Partner session active</b><p>Complete a company profile to receive private tender match scores.</p></div><a class="btn btn-solid tender-personalization__action" href="portal.html#profile">Complete company profile</a>';
        return;
      }
      state.companyId = Number(company.id);
      const matches = await authenticatedRequest(`/rest/v1/opportunity_matches?select=id,tender_id,match_score,status&company_id=eq.${state.companyId}&opportunity_type=eq.tender&status=neq.dismissed&limit=500`);
      state.matches = new Map((matches || []).filter((row) => row.tender_id != null).map((row) => [Number(row.tender_id), row]));
      elements.personalization.innerHTML = `<div><b>${escapeHtml(company.name || "Your company")} tender matching</b><p>Existing private match scores are shown where your opportunity workspace already contains a match.</p></div><a class="btn btn-solid tender-personalization__action" href="portal.html#opportunities">Open opportunity workspace</a>`;
      if (state.rows.length) renderRows(false);
    } catch (_) {
      state.authenticated = false;
      state.matches.clear();
    }
  }

  async function saveMatch(button) {
    const matchId = Number(button.dataset.saveMatch);
    if (!Number.isFinite(matchId)) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Saving…";
    try {
      await authenticatedRequest("/rest/v1/rpc/set_opportunity_match_status", {
        method: "POST",
        body: JSON.stringify({ p_match_id: matchId, p_status: "saved" }),
      });
      for (const match of state.matches.values()) {
        if (Number(match.id) === matchId) match.status = "saved";
      }
      renderRows(false);
    } catch (_) {
      button.disabled = false;
      button.textContent = original;
      elements.status.textContent = "Match could not be saved; your existing data was not changed";
    }
  }

  function clearAll() {
    elements.filters.reset();
    loadTenders();
  }

  function bind() {
    elements.filters.addEventListener("submit", (event) => {
      event.preventDefault();
      loadTenders();
    });
    elements.clear.addEventListener("click", clearAll);
    elements.loadMore.addEventListener("click", () => loadTenders({ append: true }));
    elements.activeFilters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clear-filter]");
      if (!button) return;
      const fields = { query: elements.search, country: elements.country, cpv: elements.cpv, deadline: elements.deadline, notice: elements.notice };
      if (fields[button.dataset.clearFilter]) fields[button.dataset.clearFilter].value = "";
      loadTenders();
    });
    elements.list.addEventListener("click", (event) => {
      const save = event.target.closest("[data-save-match]");
      if (save) { saveMatch(save); return; }
      if (event.target.closest("[data-retry-tenders]")) loadTenders();
      if (event.target.closest("[data-clear-all-tenders]")) clearAll();
    });
    global.addEventListener("popstate", () => {
      restoreUrl();
      loadFacets().then(() => loadTenders());
    });
  }

  async function init() {
    Object.assign(elements, {
      filters: document.getElementById("tenderFilters"),
      search: document.getElementById("tenderSearch"),
      country: document.getElementById("tenderCountry"),
      cpv: document.getElementById("tenderCpv"),
      deadline: document.getElementById("tenderDeadline"),
      notice: document.getElementById("tenderNoticeType"),
      clear: document.getElementById("tenderClearFilters"),
      filterCount: document.getElementById("tenderFilterCount"),
      activeFilters: document.getElementById("tenderActiveFilters"),
      personalization: document.getElementById("tenderPersonalization"),
      list: document.getElementById("tenderList"),
      status: document.getElementById("tenderResultsStatus"),
      loadMore: document.getElementById("tenderLoadMore"),
    });
    restoreUrl();
    bind();
    await loadFacets();
    await Promise.all([loadTenders(), loadPersonalization()]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(globalThis);

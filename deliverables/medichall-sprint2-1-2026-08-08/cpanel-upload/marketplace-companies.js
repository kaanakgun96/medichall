/* MedicHall Sprint 2 company directory and public showroom controller. */
(function (global) {
  "use strict";

  const API_URL = "https://azdmuarzntzqdyirysux.supabase.co";
  const PUBLIC_KEY = "sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-";
  const session = global.MedicHallSession?.configure({ url: API_URL, key: PUBLIC_KEY }) || null;
  const D = global.MedicHallMarketplaceDomain;
  const state = {
    companies: [], products: [], followed: new Set(), user: null,
    filters: { q: "", type: "", country: "", category: "", certification: "", verifiedOnly: false, followedOnly: false, sort: "name" },
  };

  const e = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const list = (value) => D ? D.asArray(value) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const initials = (value) => String(value || "?").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  const companyUrl = (company) => company.slug ? `/m/${encodeURIComponent(company.slug)}` : `companies.html?c=${encodeURIComponent(company.id)}`;
  const productsFor = (companyId) => state.products.filter((product) => Number(product.company_id) === Number(companyId));
  const values = (rows) => [...new Set(rows.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
  const insensitiveValues = (rows) => [...new Map(rows.filter(Boolean).map((value) => [String(value).toLocaleLowerCase("en"), value])).values()]
    .sort((left, right) => String(left).localeCompare(String(right)));
  const option = (value, label, current) => `<option value="${e(value)}"${String(value) === String(current) ? " selected" : ""}>${e(label)}</option>`;

  async function request(path, options = {}) {
    const { authenticated = false, ...requestOptions } = options;
    const response = authenticated && session
      ? await session.request(`/rest/v1/${path}`, requestOptions)
      : await fetch(`${API_URL}/rest/v1/${path}`, {
        ...requestOptions,
        headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, "Content-Type": "application/json", ...(requestOptions.headers || {}) },
      });
    if (!response.ok) throw new Error(`Marketplace API ${response.status}`);
    if (response.status === 204) return null;
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }

  async function loadSession() {
    if (!session?.hasStoredSession()) return;
    try {
      state.user = await session.getUser();
      if (state.user) {
        const ids = await request("rpc/get_my_followed_company_ids", { method: "POST", body: "{}", authenticated: true });
        state.followed = new Set((ids || [])
          .map((row) => Number(row && typeof row === "object" ? row.company_id : row))
          .filter(Number.isFinite));
      }
    } catch (_) {
      state.user = null;
      state.followed.clear();
    }
  }

  function signInReturn() {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    sessionStorage.setItem("mh_marketplace_return", returnTo);
    location.href = `portal.html?redirect=${encodeURIComponent(returnTo)}`;
  }

  async function toggleFollow(companyId, button) {
    if (!state.user) { signInReturn(); return; }
    const id = Number(companyId);
    const wasFollowed = state.followed.has(id);
    wasFollowed ? state.followed.delete(id) : state.followed.add(id);
    updateFollowButton(button, id);
    try {
      await request(`rpc/${wasFollowed ? "unfollow_company" : "follow_company"}`, {
        method: "POST", body: JSON.stringify({ p_company_id: id }), authenticated: true,
      });
      if (state.filters.followedOnly) renderDirectory();
    } catch (_) {
      wasFollowed ? state.followed.add(id) : state.followed.delete(id);
      updateFollowButton(button, id);
      announce("Could not update this company. Please try again.");
    }
  }

  function updateFollowButton(button, companyId) {
    if (!button) return;
    const active = state.followed.has(Number(companyId));
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "Following" : "Follow company";
  }

  function announce(message) {
    const summary = document.getElementById("companyDirectorySummary");
    if (summary) summary.textContent = message;
  }

  function companyCategories(company) {
    return values(productsFor(company.id).map((product) => product.category));
  }

  function card(company) {
    const categories = companyCategories(company);
    const certifications = list(company.certifications);
    const description = String(company.description || "").trim();
    const meta = [company.type || "Company", company.city, company.country].filter(Boolean).join(" · ");
    return `<article class="company-enterprise-card">
      <div class="company-enterprise-card__top">
        <div class="company-enterprise-card__identity">
          <a class="company-enterprise-card__logo" href="${companyUrl(company)}" aria-label="Open ${e(company.name)} showroom">${company.logo_url ? `<img src="${e(company.logo_url)}" alt="" loading="lazy">` : e(initials(company.name))}</a>
          <div><h3><a href="${companyUrl(company)}">${e(company.name)}</a></h3><p class="company-enterprise-card__meta">${e(meta)}</p></div>
        </div>
        <span class="marketplace-signal marketplace-signal--verified">Approved profile</span>
      </div>
      <p>${e(description ? `${description.slice(0, 170)}${description.length > 170 ? "…" : ""}` : "Company description not provided.")}</p>
      <div class="chips">${company.is_verified ? '<span class="tagchip cert">✓ Verified company</span>' : ""}${categories.slice(0, 3).map((value) => `<span class="tagchip cat">${e(value)}</span>`).join("")}${certifications.slice(0, 2).map((value) => `<span class="tagchip cert">Listed: ${e(value)}</span>`).join("")}</div>
      <div class="company-enterprise-card__meta">${productsFor(company.id).length} public product${productsFor(company.id).length === 1 ? "" : "s"}</div>
      <div class="company-enterprise-card__actions">
        <a class="btn btn-solid btn-sm" href="${companyUrl(company)}">View showroom</a>
        <a class="btn btn-ghost btn-sm" href="products.html?company=${encodeURIComponent(company.id)}">View products</a>
        <button class="btn btn-ghost btn-sm company-follow" type="button" data-follow-company="${company.id}" aria-pressed="${state.followed.has(Number(company.id))}">${state.followed.has(Number(company.id)) ? "Following" : "Follow company"}</button>
      </div>
    </article>`;
  }

  function matches(company) {
    const f = state.filters;
    const categories = companyCategories(company);
    const certifications = list(company.certifications);
    const haystack = [company.name, company.type, company.description, company.city, company.country, ...categories, ...certifications].join(" ").toLocaleLowerCase("en");
    return (!f.q || haystack.includes(f.q.toLocaleLowerCase("en")))
      && (!f.type || String(company.type || "").toLocaleLowerCase("en") === String(f.type).toLocaleLowerCase("en"))
      && (!f.country || company.country === f.country)
      && (!f.category || categories.includes(f.category))
      && (!f.certification || certifications.includes(f.certification))
      && (!f.verifiedOnly || company.is_verified)
      && (!f.followedOnly || state.followed.has(Number(company.id)));
  }

  function filteredCompanies() {
    const rows = state.companies.filter(matches);
    if (state.filters.sort === "products") return rows.sort((a, b) => productsFor(b.id).length - productsFor(a.id).length || a.name.localeCompare(b.name));
    if (state.filters.sort === "newest") return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || a.name.localeCompare(b.name));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderTools() {
    const host = document.getElementById("companyDirectoryTools");
    if (!host) return;
    const categories = values(state.products.map((product) => product.category));
    const certifications = values(state.companies.flatMap((company) => list(company.certifications)));
    host.innerHTML = `<div class="company-directory-tools" aria-label="Company directory filters">
      <input class="marketplace-filter-control" id="companySearch" type="search" value="${e(state.filters.q)}" placeholder="Search company, role, product or location" aria-label="Search companies">
      <select class="marketplace-filter-control" data-company-filter="type" aria-label="Company type">${option("", "All company types", state.filters.type)}${insensitiveValues(state.companies.map((row) => row.type)).map((value) => option(value, value, state.filters.type)).join("")}</select>
      <select class="marketplace-filter-control" data-company-filter="country" aria-label="Country">${option("", "All countries", state.filters.country)}${values(state.companies.map((row) => row.country)).map((value) => option(value, value, state.filters.country)).join("")}</select>
      <select class="marketplace-filter-control" data-company-filter="category" aria-label="Product category">${option("", "All product categories", state.filters.category)}${categories.map((value) => option(value, value, state.filters.category)).join("")}</select>
      <select class="marketplace-filter-control" data-company-filter="certification" aria-label="Certification">${option("", "All certifications", state.filters.certification)}${certifications.map((value) => option(value, value, state.filters.certification)).join("")}</select>
      <select class="marketplace-filter-control" data-company-filter="sort" aria-label="Sort companies">${option("name", "Name A–Z", state.filters.sort)}${option("products", "Most products", state.filters.sort)}${option("newest", "Newest", state.filters.sort)}</select>
      <label class="marketplace-filter-chip"><input type="checkbox" data-company-filter="verifiedOnly"${state.filters.verifiedOnly ? " checked" : ""}> Verified only</label>
      <label class="marketplace-filter-chip"><input type="checkbox" data-company-filter="followedOnly"${state.filters.followedOnly ? " checked" : ""}> Followed only</label>
      <button class="btn btn-ghost btn-sm" type="button" id="companyFiltersReset">Reset filters</button>
    </div>`;
    let searchTimer;
    document.getElementById("companySearch").addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.filters.q = event.target.value.trim(); renderDirectory(); }, 180);
    });
    host.querySelectorAll("[data-company-filter]").forEach((control) => control.addEventListener("change", () => {
      state.filters[control.dataset.companyFilter] = control.type === "checkbox" ? control.checked : control.value;
      renderDirectory();
    }));
    document.getElementById("companyFiltersReset").addEventListener("click", () => {
      state.filters = { q: "", type: "", country: "", category: "", certification: "", verifiedOnly: false, followedOnly: false, sort: "name" };
      renderTools(); renderDirectory();
    });
  }

  function renderDirectory() {
    const grid = document.getElementById("dirGrid");
    if (!grid) return;
    const rows = filteredCompanies();
    document.getElementById("companyDirectorySummary").innerHTML = `<span><b>${rows.length}</b> of ${state.companies.length} approved companies</span><span>Company roles are shown as provided; distributors and buyers are not presented as manufacturers.</span>`;
    grid.innerHTML = rows.length ? rows.map(card).join("") : '<div class="empty" style="grid-column:1/-1"><b>No companies match these filters</b>Try a different company type, country, product category or certification.</div>';
    grid.querySelectorAll("[data-follow-company]").forEach((button) => button.addEventListener("click", () => toggleFollow(button.dataset.followCompany, button)));
  }

  async function initDirectory() {
    try {
      const [companies, products] = await Promise.all([
        request("companies?select=id,name,type,description,website,phone,country,city,certifications,logo_url,is_approved,is_active,created_at,catalog_url,video_url,plan,plan_expires_at,slug,is_verified&order=name&limit=250"),
        request("products?select=id,company_id,category&company_id=not.is.null&order=name&limit=1000"),
        loadSession(),
      ]);
      state.companies = companies || [];
      state.products = products || [];
      renderTools(); renderDirectory();
    } catch (_) {
      const grid = document.getElementById("dirGrid");
      if (grid) grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Could not load companies</b>Please try again later.</div>';
    }
  }

  function trustCard(title, value) {
    return `<div class="company-trust-card"><b>${e(title)}</b><span>${e(value)}</span></div>`;
  }

  async function enhanceProfile(company, products, certificates = []) {
    if (!company) return;
    await loadSession();
    const trust = document.getElementById("companyShowroomTrust");
    const profileSignals = [company.description, company.country, company.type, company.certifications, company.catalog_url, (products || []).length ? "products" : ""].filter(Boolean).length;
    if (trust) trust.innerHTML = [
      trustCard("Marketplace status", "Approved public profile"),
      trustCard("Company role", company.type || "Not provided"),
      trustCard("Public product catalog", `${(products || []).length} product${(products || []).length === 1 ? "" : "s"}`),
      trustCard("Verification", company.is_verified ? "Verified company" : "Not shown as verified"),
      trustCard("Profile completeness", `${Math.round(profileSignals / 6 * 100)}% of public company signals`),
      trustCard("OEM / private label", "Ask the company; no public structured field"),
    ].join("");
    const follow = document.getElementById("proFollow");
    if (follow) {
      follow.style.display = "inline-flex";
      updateFollowButton(follow, company.id);
      follow.onclick = () => toggleFollow(company.id, follow);
    }
    try {
      const safeDocuments = (certificates || []).map((document) => ({ ...document, meta: D && D.fileMeta(document.file_url, "company-document") })).filter((document) => document.meta);
      if (safeDocuments.length) {
        const card = document.getElementById("companyDocumentsCard");
        const host = document.getElementById("companyShowroomDocuments");
        card.style.display = "block";
        host.innerHTML = safeDocuments.map((document) => `<a class="marketplace-download" href="${e(document.meta.url)}" target="_blank" rel="noopener" download="${e(document.meta.filename)}"><span><b>${e(document.title || "Company document")}</b><small>${e(document.meta.type)} · Size unavailable · Company supplied</small></span><b>Open ↗</b></a>`).join("");
      }
    } catch (_) { /* The legacy certificate modal remains available if this enhancement cannot load. */ }
  }

  global.MedicHallEnterpriseCompanies = { initDirectory, enhanceProfile };
})(globalThis);

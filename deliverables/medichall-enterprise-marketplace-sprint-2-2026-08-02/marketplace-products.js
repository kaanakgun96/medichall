/* MedicHall Sprint 2 product catalog, comparison, favorites and recommendations. */
(function (global) {
  "use strict";

  const D = global.MedicHallMarketplaceDomain;
  if (!D || !document.getElementById("grid")) return;

  const API_URL = "https://azdmuarzntzqdyirysux.supabase.co";
  const API_KEY = "sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-";
  const PAGE_SIZE = 12;
  const COMPARE_KEY = "mh_marketplace_compare_v1";
  const token = () => localStorage.getItem("mh_p_token") || "";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const label = (value) => D.displayValue(value).replace(/\b\w/g, (character) => character.toUpperCase());
  const state = {
    products: [], favoriteIds: new Set(), user: null,
    filters: D.queryFilters(location.search), compareRefs: [],
    recommendationResults: [], selectedProduct: null, rfqReviewed: false,
  };

  function headers(authenticated = false, extra = {}) {
    const accessToken = authenticated ? token() : "";
    return {
      apikey: API_KEY,
      Authorization: `Bearer ${accessToken || API_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: headers(Boolean(options.authenticated), options.headers || {}),
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body && (body.message || body.error_description || body.error) || `Request failed (${response.status})`);
    return body;
  }

  function initials(value) {
    return String(value || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function compareFromStorage() {
    const fromUrl = state.filters.compare.split(",").map((item) => item.trim()).filter(Boolean);
    if (fromUrl.length) return fromUrl.slice(0, 4);
    try {
      const stored = JSON.parse(sessionStorage.getItem(COMPARE_KEY) || "[]");
      return Array.isArray(stored) ? stored.map(String).slice(0, 4) : [];
    } catch (_) { return []; }
  }

  function persistCompare() {
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify(state.compareRefs));
  }

  async function loadUserAndFavorites() {
    if (!token()) return;
    try {
      state.user = await request("/auth/v1/user", { authenticated: true });
      const rows = await request(`/rest/v1/favorites?select=product_id&user_id=eq.${encodeURIComponent(state.user.id)}`, { authenticated: true });
      state.favoriteIds = new Set(rows.map((row) => Number(row.product_id)));
    } catch (_) {
      state.user = null;
      state.favoriteIds = new Set();
    }
  }

  async function loadProducts() {
    const fullSelect = [
      "id", "ref", "name", "category", "description", "image_url", "brochure_url", "is_featured", "company_id",
      "normalized_category", "product_subtype", "material", "dimensions", "sterility_status", "use_type",
      "packaging_description", "units_per_package", "product_certifications", "regulatory_class",
      "sterilization_method", "production_capacity", "capacity_unit", "capacity_period",
      "technical_specifications", "matching_profile_sources",
      "companies(id,name,slug,logo_url,is_verified,country,type,certifications)"
    ].join(",");
    const legacySelect = "id,ref,name,category,description,image_url,brochure_url,is_featured,company_id,companies(id,name,slug,logo_url,is_verified,country,type,certifications)";
    let rows;
    try {
      rows = await request(`/rest/v1/products?select=${fullSelect}&is_active=eq.true&order=is_featured.desc,name&limit=250`);
    } catch (_) {
      rows = await request(`/rest/v1/products?select=${legacySelect}&is_active=eq.true&order=is_featured.desc,name&limit=250`);
    }
    state.products = rows.map(D.normalizeProduct);
  }

  function option(value, current, display = value) {
    return `<option value="${escapeHtml(value)}"${String(value) === String(current) ? " selected" : ""}>${escapeHtml(display)}</option>`;
  }

  function renderFilters() {
    const facets = D.productFacets(state.products);
    const field = (title, key, values, names = null) => values.length ? `<div class="marketplace-filter-section">
      <label class="marketplace-filter-label" for="marketplace-filter-${key}">${title}</label>
      <select class="marketplace-filter-control" id="marketplace-filter-${key}" data-marketplace-filter="${key}">
        <option value="">All</option>${values.map((value, index) => option(names ? value.id : value, state.filters[key], names ? value.name : names && names[index] || label(value))).join("")}
      </select></div>` : "";
    document.getElementById("sidebar").innerHTML = `
      <label class="marketplace-filter-label" for="marketplace-filter-q">Search</label>
      <input class="marketplace-filter-control" id="marketplace-filter-q" data-marketplace-filter="q" type="search" value="${escapeHtml(state.filters.q)}" placeholder="Product, company or specification…">
      ${field("Category", "category", facets.categories)}
      ${field("Company", "company", facets.companies, true)}
      ${field("Company country", "country", facets.countries)}
      ${field("Certification", "certification", facets.certifications)}
      ${field("Sterility", "sterility", facets.sterility)}
      ${field("Use type", "useType", facets.useTypes)}
      ${field("Material", "material", facets.materials)}
      <label class="marketplace-filter-label" for="marketplace-filter-readiness">Profile detail</label>
      <select class="marketplace-filter-control" id="marketplace-filter-readiness" data-marketplace-filter="readiness">
        ${option("", state.filters.readiness, "All detail levels")}
        ${option("50", state.filters.readiness, "50%+ core details")}
        ${option("80", state.filters.readiness, "80%+ detailed profiles")}
      </select>
      <label class="marketplace-filter-label" for="marketplace-filter-sort">Sort</label>
      <select class="marketplace-filter-control" id="marketplace-filter-sort" data-marketplace-filter="sort">
        ${option("featured", state.filters.sort, "Featured and A–Z")}
        ${option("az", state.filters.sort, "Name A–Z")}
        ${option("za", state.filters.sort, "Name Z–A")}
        ${option("company", state.filters.sort, "Company")}
        ${option("readiness", state.filters.sort, "Most detailed profiles")}
      </select>
      <button class="clear-btn" id="marketplaceResetFilters" type="button">× Reset filters</button>`;
  }

  function renderAssistant() {
    const root = document.getElementById("marketplaceAssistant");
    root.innerHTML = `<div class="marketplace-assistant__head"><div>
      <div class="marketplace-card__eyebrow">Evidence-based recommendation assistant</div>
      <h2 id="marketplaceAssistantTitle">Describe what you need</h2>
      <p>MedicHall ranks products from explicit catalog fields first. Results show matches, gaps, blockers and unknown information. No paid AI call is made and results are not regulatory or procurement advice.</p>
    </div><span class="marketplace-fit">Deterministic · zero AI cost</span></div>
    <form class="marketplace-requirement" id="marketplaceRequirementForm">
      <textarea id="marketplaceRequirement" aria-label="Describe your product requirement" placeholder="Example: sterile single-use surgical drape, non-woven material, CE, delivery to Germany"></textarea>
      <button class="btn btn-solid" type="submit">Find evidence-backed options</button>
    </form><div class="marketplace-recommendations" id="marketplaceRecommendations" aria-live="polite"></div>`;
  }

  function activeFilterEntries() {
    const names = {
      q: "Search", category: "Category", company: "Company", country: "Country",
      certification: "Certification", sterility: "Sterility", useType: "Use type", material: "Material", readiness: "Profile detail"
    };
    return Object.entries(names).filter(([key]) => state.filters[key]).map(([key, name]) => [key, name, state.filters[key]]);
  }

  function renderActiveFilters() {
    document.getElementById("activePill").innerHTML = activeFilterEntries().map(([key, name, value]) =>
      `<span class="marketplace-filter-chip">${escapeHtml(name)}: ${escapeHtml(label(value))}<button type="button" data-clear-filter="${key}" aria-label="Remove ${escapeHtml(name)} filter">×</button></span>`
    ).join("");
  }

  function visibleProducts() {
    const filters = { ...state.filters, favoriteIds: state.favoriteIds };
    return D.sortProducts(state.products.filter((product) => D.matchesFilters(product, filters)), state.filters.sort);
  }

  function productSignals(product) {
    const signals = [];
    if (product.company_verified) signals.push(["Verified company", true]);
    if (product.sterility_status !== D.UNKNOWN) signals.push([label(product.sterility_status), false]);
    if (product.use_type !== D.UNKNOWN) signals.push([label(product.use_type), false]);
    product.product_certifications.slice(0, 1).forEach((certification) => signals.push([certification, false]));
    return signals.slice(0, 3);
  }

  function card(product) {
    const readiness = D.productReadiness(product);
    const favorite = state.favoriteIds.has(Number(product.id));
    const compared = state.compareRefs.includes(product.ref);
    return `<article class="marketplace-card" data-product-ref="${escapeHtml(product.ref)}">
      <div class="marketplace-card__image">
        ${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy" width="640" height="480">` : `<span class="marketplace-card__fallback">${escapeHtml(initials(product.name))}</span>`}
        <button class="marketplace-card__favorite" type="button" data-marketplace-action="favorite" aria-label="${favorite ? "Remove from" : "Add to"} favorites" aria-pressed="${favorite}">♥</button>
      </div><div class="marketplace-card__body">
        <div class="marketplace-card__eyebrow">${escapeHtml(product.product_subtype || product.category)}</div>
        <h3>${escapeHtml(product.name)}</h3>
        <div class="marketplace-card__company"><b>${escapeHtml(product.company_name || "Company not assigned")}</b><span>${escapeHtml([product.company_type, product.company_country].filter(Boolean).join(" · ") || "Company details not provided")}</span></div>
        <div class="marketplace-card__signals">${productSignals(product).map(([value, verified]) => `<span class="marketplace-signal${verified ? " marketplace-signal--verified" : ""}">${escapeHtml(value)}</span>`).join("")}</div>
        <div class="marketplace-card__readiness"><span>${escapeHtml(readiness.label)}</span><span>${readiness.score}%</span></div>
        <div class="marketplace-card__actions">
          <button class="btn btn-ghost" type="button" data-marketplace-action="compare" aria-pressed="${compared}">${compared ? "Remove compare" : "Add to compare"}</button>
          <button class="btn btn-ghost" type="button" data-marketplace-action="detail">View details</button>
          <button class="btn btn-solid" type="button" data-marketplace-action="rfq">Request quote</button>
          ${product.company_id ? `<a class="btn btn-ghost" href="${product.company_slug ? `/m/${encodeURIComponent(product.company_slug)}` : `companies.html?c=${product.company_id}`}">Company</a>` : `<span></span>`}
        </div>
      </div></article>`;
  }

  function renderCatalog() {
    const rows = visibleProducts();
    const shown = rows.slice(0, state.filters.page * PAGE_SIZE);
    const grid = document.getElementById("grid");
    grid.innerHTML = shown.map(card).join("");
    document.getElementById("countLbl").innerHTML = `<b>${rows.length}</b> product${rows.length === 1 ? "" : "s"}${state.filters.favoritesOnly ? " in favorites" : " found"}`;
    document.getElementById("noResults").style.display = rows.length ? "none" : "block";
    document.getElementById("noResults").innerHTML = state.filters.favoritesOnly && !state.user
      ? `<b>Sign in to view favorites</b><a class="btn btn-solid btn-sm" href="${loginUrl()}">Sign in without losing this page</a>`
      : state.filters.favoritesOnly ? "<b>No favorite products yet</b>Use the heart action on a product to build a cross-device shortlist."
      : "<b>No products match these filters</b>Remove a filter or describe your requirement above.";
    const loadMore = document.getElementById("loadMore");
    loadMore.style.display = shown.length < rows.length ? "inline-flex" : "none";
    document.getElementById("marketplaceFavoritesCount").textContent = String(state.favoriteIds.size);
    document.getElementById("marketplaceCompareCount").textContent = String(state.compareRefs.length);
    document.getElementById("marketplaceFavoritesView").setAttribute("aria-pressed", String(state.filters.favoritesOnly));
    renderActiveFilters();
    renderCompareTray();
  }

  function syncUrl(extras = {}) {
    const query = D.filtersQuery(state.filters, {
      detail: extras.detail !== undefined ? extras.detail : state.filters.detail,
      compare: extras.compare !== undefined ? extras.compare : state.filters.compare,
    });
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    state.filters.page = 1;
    syncUrl();
    renderCatalog();
  }

  function resetFilters() {
    const preserved = { favoritesOnly: state.filters.favoritesOnly, sort: "featured", page: 1, detail: "", compare: state.filters.compare };
    state.filters = { ...D.queryFilters(""), ...preserved };
    renderFilters(); renderCatalog(); syncUrl();
  }

  function loginUrl() {
    sessionStorage.setItem("mh_marketplace_return", location.href);
    return `portal.html?redirect=${encodeURIComponent(location.href)}`;
  }

  async function favorite(product) {
    if (!state.user) { location.href = loginUrl(); return; }
    const id = Number(product.id);
    const wasFavorite = state.favoriteIds.has(id);
    wasFavorite ? state.favoriteIds.delete(id) : state.favoriteIds.add(id);
    renderCatalog();
    if (state.selectedProduct && state.selectedProduct.id === id) renderDetail(product, false);
    try {
      if (wasFavorite) {
        await request(`/rest/v1/favorites?user_id=eq.${encodeURIComponent(state.user.id)}&product_id=eq.${id}`, { method: "DELETE", authenticated: true });
      } else {
        await request("/rest/v1/favorites", {
          method: "POST", authenticated: true,
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ user_id: state.user.id, product_id: id })
        });
      }
    } catch (error) {
      wasFavorite ? state.favoriteIds.add(id) : state.favoriteIds.delete(id);
      renderCatalog();
      toastMessage(`Favorite was not saved: ${error.message}`);
    }
  }

  function toggleCompare(product) {
    const index = state.compareRefs.indexOf(product.ref);
    if (index >= 0) state.compareRefs.splice(index, 1);
    else if (state.compareRefs.length >= 4) { toastMessage("Compare supports up to four products."); return; }
    else state.compareRefs.push(product.ref);
    persistCompare();
    state.filters.compare = state.compareRefs.join(",");
    syncUrl(); renderCatalog();
    if (state.selectedProduct && state.selectedProduct.ref === product.ref) renderDetail(product, false);
  }

  function renderCompareTray() {
    const tray = document.getElementById("marketplaceCompareTray");
    const products = state.compareRefs.map((ref) => state.products.find((product) => product.ref === ref)).filter(Boolean);
    tray.classList.toggle("is-visible", products.length > 0 && document.getElementById("marketplaceCompareView").hidden);
    tray.innerHTML = products.length ? `<div class="marketplace-compare-tray__items">${products.map((product) => `<span class="marketplace-compare-tray__item"><span>${escapeHtml(product.name)}</span><button type="button" data-remove-compare="${escapeHtml(product.ref)}" aria-label="Remove ${escapeHtml(product.name)}">×</button></span>`).join("")}</div>
      <div><button class="btn btn-solid btn-sm" id="marketplaceTrayCompare" type="button">Compare ${products.length}</button> <button class="btn btn-ghost btn-sm" id="marketplaceClearCompare" type="button">Clear</button></div>` : "";
  }

  function compareValue(value) {
    if (Array.isArray(value)) return value.length ? value.join(", ") : "Unknown";
    return value === null || value === undefined || value === "" || value === "Not provided" ? "Unknown" : String(value);
  }

  function openComparison() {
    const products = state.compareRefs.map((ref) => state.products.find((product) => product.ref === ref)).filter(Boolean);
    if (products.length < 2) { toastMessage("Select at least two products to compare."); return; }
    state.filters.compare = products.map((product) => product.ref).join(",");
    syncUrl({ compare: state.filters.compare, detail: "" });
    const compare = document.getElementById("marketplaceCompareView");
    document.querySelector(".catalog").hidden = true;
    compare.hidden = false;
    compare.innerHTML = `<div class="marketplace-compare-head"><div><div class="marketplace-card__eyebrow">Product comparison</div><h1 id="marketplaceCompareTitle">Compare available evidence</h1><p>Unknown information is neutral and is never treated as inferior.</p></div><div><button class="btn btn-ghost btn-sm" id="marketplaceCopyComparison" type="button">Copy comparison link</button> <button class="btn btn-solid btn-sm" id="marketplaceCloseComparison" type="button">Back to products</button></div></div>
      <div class="marketplace-compare-scroll" tabindex="0" role="region" aria-label="Scrollable product comparison"><table class="marketplace-compare-table" data-mh-horizontal-table style="width:${150 + products.length * 190}px"><colgroup><col style="width:150px">${products.map(() => '<col style="width:190px">').join("")}</colgroup><thead><tr><th>Field</th>${products.map((product) => `<th>${escapeHtml(product.name)}<br><button class="btn btn-ghost btn-sm" type="button" data-remove-compare="${escapeHtml(product.ref)}">Remove</button></th>`).join("")}</tr></thead><tbody>
      ${D.comparisonRows.map(([name, getter]) => {
        const values = products.map((product) => compareValue(getter(product)));
        const different = new Set(values.filter((value) => value !== "Unknown").map((value) => value.toLocaleLowerCase("en"))).size > 1;
        return `<tr><th scope="row">${escapeHtml(name)}</th>${values.map((value) => `<td class="${value === "Unknown" ? "marketplace-unknown" : different ? "marketplace-difference" : ""}">${escapeHtml(value)}</td>`).join("")}</tr>`;
      }).join("")}</tbody><tfoot><tr><th>Commercial action</th>${products.map((product) => `<td><button class="btn btn-solid btn-sm" type="button" data-compare-rfq="${escapeHtml(product.ref)}">Request quote</button></td>`).join("")}</tr></tfoot></table></div>`;
    renderCompareTray();
    compare.querySelector("h1")?.focus?.();
    scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeComparison() {
    document.getElementById("marketplaceCompareView").hidden = true;
    document.querySelector(".catalog").hidden = false;
    state.filters.compare = state.compareRefs.join(",");
    syncUrl(); renderCompareTray();
  }

  function provenance(product, field) {
    const source = D.sourceFor(product, field);
    return source === "derived" ? "Derived" : source === "explicit" ? "Provided" : "Unknown";
  }

  function spec(product, title, field, value = product[field], unknown = "Not provided") {
    const rendered = D.displayValue(value, unknown);
    return `<div class="marketplace-spec"><dt>${escapeHtml(title)} <span class="marketplace-provenance">${escapeHtml(provenance(product, field))}</span></dt><dd class="${rendered === unknown ? "marketplace-unknown" : ""}">${escapeHtml(rendered)}</dd></div>`;
  }

  function renderDetail(product, updateUrl = true) {
    state.selectedProduct = product;
    state.filters.detail = product.ref;
    if (updateUrl) syncUrl({ detail: product.ref });
    const drawer = document.getElementById("drawer");
    const favoriteState = state.favoriteIds.has(Number(product.id));
    const compared = state.compareRefs.includes(product.ref);
    const brochure = D.fileMeta(product.brochure_url, `${product.ref}-brochure.pdf`);
    const similar = D.similarProducts(product, state.products, 4);
    const capacity = product.production_capacity === null ? null : `${product.production_capacity} ${product.capacity_unit || ""} per ${product.capacity_period || "period"}`;
    drawer.className = "drawer marketplace-detail";
    drawer.hidden = false;
    drawer.innerHTML = `<button class="drawer-close" type="button" data-detail-action="close" aria-label="Close product details">×</button>
      <div class="marketplace-detail__header"><div class="marketplace-detail__media">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" width="900" height="700">` : `<span class="marketplace-card__fallback">${escapeHtml(initials(product.name))}</span>`}</div>
      <div class="marketplace-detail__summary"><div class="marketplace-breadcrumbs">Products / ${escapeHtml(product.category)} / ${escapeHtml(product.ref)}</div><div class="marketplace-card__eyebrow">${escapeHtml(product.product_subtype || product.category)}</div><h2 id="dTitle">${escapeHtml(product.name)}</h2>
      <p>${escapeHtml(product.description || "Commercial description not provided. Ask the company for product-specific information.")}</p>
      ${product.company_id ? `<a class="marketplace-detail__company" href="${product.company_slug ? `/m/${encodeURIComponent(product.company_slug)}` : `companies.html?c=${product.company_id}`}"><span class="marketplace-detail__company-logo">${product.company_logo_url ? `<img src="${escapeHtml(product.company_logo_url)}" alt="">` : escapeHtml(initials(product.company_name))}</span><span><b>${escapeHtml(product.company_name || "Company")}</b><br><small>${escapeHtml([product.company_type, product.company_country].filter(Boolean).join(" · ") || "Company profile")}</small></span></a>` : ""}
      <div class="marketplace-detail__actions"><button class="btn btn-solid" type="button" data-detail-action="rfq">Request quotation</button><button class="btn btn-ghost" type="button" data-detail-action="favorite" aria-pressed="${favoriteState}">${favoriteState ? "♥ Saved" : "♡ Save"}</button><button class="btn btn-ghost" type="button" data-detail-action="compare" aria-pressed="${compared}">${compared ? "Remove compare" : "Add to compare"}</button></div></div></div>
      <div class="marketplace-detail__content"><section class="marketplace-detail-section"><h3>Technical and commercial profile</h3><dl class="marketplace-specs">
        ${spec(product, "Category", "normalized_category", product.product_subtype || product.normalized_category || product.category)}
        ${spec(product, "Dimensions", "dimensions")}${spec(product, "Material", "material")}
        ${spec(product, "Sterility", "sterility_status", product.sterility_status, "Unknown")}
        ${spec(product, "Use type", "use_type", product.use_type, "Unknown")}
        ${spec(product, "Packaging", "packaging_description")}${spec(product, "Units per package", "units_per_package")}
        ${spec(product, "Product certifications", "product_certifications")}${spec(product, "Regulatory class", "regulatory_class", product.regulatory_class, "Ask company")}
        ${spec(product, "Sterilization method", "sterilization_method")}${spec(product, "Production capacity", "production_capacity", capacity, "Ask company")}
      </dl>${product.technical_specifications.length ? `<h3 style="margin-top:16px">Additional provided specifications</h3><ul>${product.technical_specifications.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      <p class="marketplace-disclaimer">Regulatory, certification, compatibility and capacity information is supplied by the company unless explicitly marked otherwise. Verify current documents and commercial terms before procurement.</p></section>
      <aside><section class="marketplace-detail-section"><h3>Downloads</h3>${brochure ? `<a class="marketplace-download" href="${escapeHtml(brochure.url)}" target="_blank" rel="noopener" download="${escapeHtml(brochure.filename)}"><span><b>${escapeHtml(brochure.filename)}</b><small>${escapeHtml(brochure.type)} · Size unavailable · Public company-provided asset</small></span><b>Open ↗</b></a>` : `<p class="marketplace-unknown">No public product brochure is available.</p>`}</section>
      <section class="marketplace-detail-section" style="margin-top:10px"><h3>Similar products</h3><div class="marketplace-similar">${similar.length ? similar.map((item) => `<button type="button" data-similar-ref="${escapeHtml(item.product.ref)}"><b>${escapeHtml(item.product.name)}</b><small>${escapeHtml(item.reasons.join(" · "))}</small></button>`).join("") : `<p class="marketplace-unknown">Insufficient structured evidence for useful alternatives.</p>`}</div></section></aside></div>`;
    drawer.classList.add("open");
    document.getElementById("drawerBackdrop").classList.add("open");
    document.body.style.overflow = "hidden";
    drawer.querySelector(".drawer-close")?.focus();
  }

  function closeDetail() {
    const drawer = document.getElementById("drawer");
    drawer.classList.remove("open");
    drawer.hidden = true;
    document.getElementById("drawerBackdrop").classList.remove("open");
    document.body.style.overflow = "";
    state.selectedProduct = null;
    state.filters.detail = "";
    syncUrl({ detail: "" });
  }

  function openRfq(product) {
    state.selectedProduct = product;
    state.rfqReviewed = false;
    global.openModal?.("rfq");
    document.querySelector("#modalBackdrop .modal")?.setAttribute("aria-labelledby", "marketplaceRfqTitle");
    document.querySelector("#modalBackdrop .modal")?.removeAttribute("aria-label");
    document.getElementById("rfqProduct").textContent = `Request quotation for ${product.name} (${product.ref})`;
    document.getElementById("marketplaceRfqReview").classList.remove("is-visible");
    document.getElementById("rfqSend").textContent = "Review request";
    updateRecipientSummary();
  }

  async function recipientIds(product) {
    const multi = state.user && document.getElementById("rfq-multi").checked && product.category;
    if (!multi) return product.company_id ? [product.company_id] : [];
    const rows = await request(`/rest/v1/products?select=company_id&category=eq.${encodeURIComponent(product.category)}&is_active=eq.true&company_id=not.is.null&limit=250`);
    return [...new Set(rows.map((row) => Number(row.company_id)).filter(Boolean))];
  }

  async function updateRecipientSummary() {
    const product = state.selectedProduct;
    const target = document.getElementById("rfqRecipientSummary");
    if (!product || !target) return;
    if (!state.user || !document.getElementById("rfq-multi").checked) {
      target.textContent = product.company_name ? `This request will be sent to ${product.company_name}.` : "The selected product does not have an assigned recipient company.";
      return;
    }
    target.textContent = "Checking eligible recipient companies…";
    try {
      const ids = await recipientIds(product);
      target.textContent = `This category request will be sent once to each of ${ids.length} eligible companies with an active ${product.category} product.`;
    } catch (_) { target.textContent = "Recipient preview is temporarily unavailable. Submission will not continue without a verified recipient list."; }
  }

  function rfqMessage(product) {
    const notes = document.getElementById("rfq-msg").value.trim();
    const details = [
      `Quantity unit: ${document.getElementById("rfq-unit").value}`,
      document.getElementById("rfq-delivery-date").value ? `Requested delivery date: ${document.getElementById("rfq-delivery-date").value}` : "",
      document.getElementById("rfq-packaging").value.trim() ? `Packaging requirements: ${document.getElementById("rfq-packaging").value.trim()}` : "",
      document.getElementById("rfq-private-label").checked ? "Private-label / OEM proposal requested: Yes" : "",
      notes ? `Buyer notes: ${notes}` : "",
    ].filter(Boolean);
    return details.join("\n");
  }

  async function submitRfq() {
    const product = state.selectedProduct;
    if (!product) return;
    const quantity = document.getElementById("rfq-qty").value.trim();
    const destination = document.getElementById("rfq-dest").value.trim();
    const status = document.getElementById("rfqStatus");
    const show = (message, ok) => { status.textContent = message; status.style.display = "block"; status.style.color = ok ? "var(--success)" : "var(--danger)"; };
    if (!quantity || !destination) { show("Quantity and destination country are required.", false); return; }
    let email = document.getElementById("rfq-email")?.value.trim() || state.user?.email || "";
    let company = document.getElementById("rfq-company")?.value.trim() || null;
    if (!/^\S+@\S+\.\S+$/.test(email)) { show("Enter a valid work email.", false); return; }
    let ids;
    try { ids = await recipientIds(product); } catch (_) { show("Recipient companies could not be verified. Please try again.", false); return; }
    if (!ids.length) { show("No eligible recipient company is assigned to this product.", false); return; }
    const review = document.getElementById("marketplaceRfqReview");
    if (!state.rfqReviewed) {
      state.rfqReviewed = true;
      review.classList.add("is-visible");
      review.innerHTML = `<b>Review before sending</b><br>${escapeHtml(product.name)} · ${escapeHtml(quantity)} ${escapeHtml(document.getElementById("rfq-unit").value)} · ${escapeHtml(destination)}<br>${ids.length} recipient compan${ids.length === 1 ? "y" : "ies"}. Unknown commercial details must be confirmed in the resulting conversation.`;
      document.getElementById("rfqSend").textContent = "Submit request";
      return;
    }
    const button = document.getElementById("rfqSend");
    button.disabled = true; button.textContent = "Submitting…";
    const groupId = ids.length > 1 ? crypto.randomUUID() : null;
    const base = {
      product_ref: product.ref, product_name: product.name, user_id: state.user?.id || null,
      email, company, quantity, destination,
      incoterm: document.getElementById("rfq-incoterm").value || null,
      target_price: document.getElementById("rfq-target").value.trim() || null,
      req_certs: document.getElementById("rfq-certs").value.trim() || null,
      message: rfqMessage(product) || null,
    };
    try {
      const payload = ids.map((companyId) => ({ ...base, company_id: companyId, group_id: groupId }));
      const rows = await request("/rest/v1/rfq_requests", {
        method: "POST", authenticated: Boolean(state.user), headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload.length === 1 ? payload[0] : payload)
      });
      const first = Array.isArray(rows) ? rows[0] : rows;
      document.getElementById("rfqView").innerHTML = `<div class="marketplace-rfq-success"><h3>Request submitted</h3><p>Your request was delivered to ${ids.length} intended compan${ids.length === 1 ? "y" : "ies"}. Duplicate recipients were removed.</p>${state.user && first && first.id ? `<a class="btn btn-solid" href="portal.html#rfq-chat=${Number(first.id)}">Open exact RFQ conversation</a>` : `<a class="btn btn-solid" href="portal.html#inbox">Open your requests</a>`}</div>`;
    } catch (error) {
      show(`Request was not submitted: ${error.message}`, false);
      button.disabled = false; button.textContent = "Submit request";
    }
  }

  function renderRecommendations(requirement) {
    const root = document.getElementById("marketplaceRecommendations");
    const results = D.recommendations(requirement, state.products, 6);
    state.recommendationResults = results;
    root.innerHTML = results.length ? results.map((result) => `<article class="marketplace-recommendation" data-recommendation-ref="${escapeHtml(result.product.ref)}"><div><h3><button type="button" class="button-link" data-recommendation-detail="${escapeHtml(result.product.ref)}">${escapeHtml(result.product.name)}</button></h3><p><b>Matched:</b> ${escapeHtml(result.matched.join(", ") || "No direct structured match")} · <b>Gaps:</b> ${escapeHtml(result.gaps.join(", ") || "None detected")} · <b>Unknown:</b> ${escapeHtml(result.unknowns.map((item) => item.replace(/_/g, " ")).join(", ") || "None")}${result.blockers.length ? ` · <b>Blockers:</b> ${escapeHtml(result.blockers.join(", "))}` : ""}</p></div><span class="marketplace-fit ${result.label.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(result.label)} · ${result.score}%</span></article>`).join("")
      : `<div class="empty"><b>Insufficient evidence for a useful recommendation</b>Try product, material, sterility, use-type or certification terms. Generic category wording alone is not treated as a strong fit.</div>`;
  }

  function toastMessage(message) {
    if (typeof global.toast === "function") { global.toast(message); return; }
    let toast = document.getElementById("marketplaceToast");
    if (!toast) { toast = document.createElement("div"); toast.id = "marketplaceToast"; toast.className = "toast"; document.body.appendChild(toast); }
    toast.textContent = message; toast.style.display = "block"; clearTimeout(toast.timer); toast.timer = setTimeout(() => { toast.style.display = "none"; }, 3200);
  }

  function productForElement(element) {
    const cardElement = element.closest("[data-product-ref]");
    return cardElement ? state.products.find((product) => product.ref === cardElement.dataset.productRef) : null;
  }

  function bindEvents() {
    document.getElementById("sidebar").addEventListener("input", (event) => {
      const key = event.target.dataset.marketplaceFilter;
      if (!key) return;
      clearTimeout(state.searchTimer);
      const apply = () => setFilter(key, event.target.value);
      key === "q" ? state.searchTimer = setTimeout(apply, 220) : apply();
    });
    document.getElementById("sidebar").addEventListener("click", (event) => {
      if (event.target.id === "marketplaceResetFilters") resetFilters();
    });
    document.getElementById("activePill").addEventListener("click", (event) => {
      if (event.target.dataset.clearFilter) setFilter(event.target.dataset.clearFilter, "");
    });
    document.getElementById("grid").addEventListener("click", (event) => {
      const action = event.target.closest("[data-marketplace-action]")?.dataset.marketplaceAction;
      const product = productForElement(event.target);
      if (!action || !product) return;
      if (action === "favorite") favorite(product);
      if (action === "compare") toggleCompare(product);
      if (action === "detail") renderDetail(product);
      if (action === "rfq") openRfq(product);
    });
    document.getElementById("drawer").addEventListener("click", (event) => {
      const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
      if (action === "close") closeDetail();
      if (action === "favorite" && state.selectedProduct) favorite(state.selectedProduct);
      if (action === "compare" && state.selectedProduct) toggleCompare(state.selectedProduct);
      if (action === "rfq" && state.selectedProduct) { const product = state.selectedProduct; closeDetail(); openRfq(product); }
      const similar = event.target.closest("[data-similar-ref]")?.dataset.similarRef;
      if (similar) { const product = state.products.find((item) => item.ref === similar); if (product) renderDetail(product); }
    });
    document.getElementById("marketplaceCompareTray").addEventListener("click", (event) => {
      const ref = event.target.closest("[data-remove-compare]")?.dataset.removeCompare;
      if (ref) { const product = state.products.find((item) => item.ref === ref); if (product) toggleCompare(product); }
      if (event.target.closest("#marketplaceTrayCompare")) openComparison();
      if (event.target.closest("#marketplaceClearCompare")) { state.compareRefs = []; persistCompare(); state.filters.compare = ""; syncUrl(); renderCatalog(); }
    });
    document.getElementById("marketplaceCompareView").addEventListener("click", async (event) => {
      if (event.target.closest("#marketplaceCloseComparison")) closeComparison();
      const remove = event.target.closest("[data-remove-compare]")?.dataset.removeCompare;
      if (remove) { const product = state.products.find((item) => item.ref === remove); if (product) { toggleCompare(product); openComparison(); } }
      const rfq = event.target.closest("[data-compare-rfq]")?.dataset.compareRfq;
      if (rfq) { const product = state.products.find((item) => item.ref === rfq); if (product) { closeComparison(); openRfq(product); } }
      if (event.target.closest("#marketplaceCopyComparison")) {
        try { await navigator.clipboard.writeText(location.href); toastMessage("Comparison link copied."); } catch (_) { toastMessage("Copy was unavailable. Use the browser address bar."); }
      }
    });
    document.getElementById("marketplaceFavoritesView").addEventListener("click", () => {
      if (!state.user) { location.href = loginUrl(); return; }
      state.filters.favoritesOnly = !state.filters.favoritesOnly; state.filters.page = 1; syncUrl(); renderCatalog();
    });
    document.getElementById("marketplaceCompareOpen").addEventListener("click", openComparison);
    const loadMore = document.getElementById("loadMore");
    loadMore.onclick = null;
    loadMore.addEventListener("click", () => { state.filters.page += 1; syncUrl(); renderCatalog(); });
    document.getElementById("marketplaceRequirementForm").addEventListener("submit", (event) => {
      event.preventDefault(); renderRecommendations(document.getElementById("marketplaceRequirement").value.trim());
    });
    document.getElementById("marketplaceRecommendations").addEventListener("click", (event) => {
      const ref = event.target.closest("[data-recommendation-detail]")?.dataset.recommendationDetail;
      const product = state.products.find((item) => item.ref === ref); if (product) renderDetail(product);
    });
    document.getElementById("modalBackdrop").addEventListener("input", (event) => {
      if (!event.target.closest("#rfqView")) return;
      if (event.target.id === "rfq-multi") updateRecipientSummary();
      state.rfqReviewed = false;
      document.getElementById("marketplaceRfqReview")?.classList.remove("is-visible");
      const button = document.getElementById("rfqSend"); if (button) button.textContent = "Review request";
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.getElementById("drawer").classList.contains("open")) closeDetail();
      if (event.key !== "Tab" || !document.getElementById("drawer").classList.contains("open")) return;
      const focusable = [...document.getElementById("drawer").querySelectorAll("a[href],button:not([disabled]),input,select,textarea")].filter((item) => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  async function init() {
    // Neutralize the legacy renderer while its already-started request settles.
    global.render = () => {};
    global.clearFilters = resetFilters;
    global.closeDrawer = closeDetail;
    global.sendRFQ = submitRfq;
    document.getElementById("grid").innerHTML = Array.from({ length: 6 }, () => '<div class="loading">Loading products…</div>').join("");
    renderAssistant();
    state.compareRefs = compareFromStorage();
    await Promise.all([loadProducts(), loadUserAndFavorites()]);
    state.compareRefs = state.compareRefs.filter((ref) => state.products.some((product) => product.ref === ref)).slice(0, 4);
    persistCompare();
    renderFilters(); bindEvents(); renderCatalog();
    if (state.filters.detail) {
      const product = state.products.find((item) => item.ref === state.filters.detail);
      if (product) renderDetail(product, false);
    }
    if (state.filters.compare && state.compareRefs.length >= 2) openComparison();
    if (state.filters.favoritesOnly && !state.user) renderCatalog();
  }

  init().catch((error) => {
    document.getElementById("grid").innerHTML = `<div class="no-results" style="display:block"><b>Product catalog unavailable</b>${escapeHtml(error.message)}<br><button class="btn btn-ghost btn-sm" type="button" onclick="location.reload()">Try again</button></div>`;
  });
})(globalThis);

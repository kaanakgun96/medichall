/* MedicHall shared navigation and progressive UI enhancements. */
(function () {
  "use strict";

  const icons = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.8-3.8"></path></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"></path></svg>'
  };
  const marketplaceApi = {
    url: "https://azdmuarzntzqdyirysux.supabase.co",
    key: "sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-"
  };
  const session = globalThis.MedicHallSession?.configure(marketplaceApi) || null;

  const logo = `
    <svg class="mh-brand__mark" viewBox="0 0 66 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="mh-header-gradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f2e5b3"></stop><stop offset=".5" stop-color="#6cccb9"></stop><stop offset="1" stop-color="#4298cc"></stop>
      </linearGradient></defs>
      <polygon fill="url(#mh-header-gradient)" points="0,16 15,8 15,80 0,80"></polygon>
      <polygon fill="url(#mh-header-gradient)" points="24,8 39,2 39,36 24,42"></polygon>
      <polygon fill="url(#mh-header-gradient)" points="24,50 39,44 39,80 24,80"></polygon>
      <polygon fill="url(#mh-header-gradient)" points="48,2 63,10 63,80 48,80"></polygon>
    </svg>
    <span class="mh-brand__wordmark">MEDIC<span>HALL</span></span>`;

  const navigation = {
    public: [
      ["marketplace", "Marketplace", "index.html"],
      ["products", "Products", "products.html"],
      ["companies", "Companies", "companies.html"],
      ["tenders", "Tenders", "index.html#tenders"],
      ["matchmaking", "Matchmaking", "matchmaking.html"]
    ],
    portal: [
      ["marketplace", "Marketplace", "index.html"],
      ["products", "Products", "products.html"],
      ["companies", "Companies", "companies.html"],
      ["tenders", "Tenders", "index.html#tenders"],
      ["matchmaking", "Matchmaking", "matchmaking.html"]
    ],
    matchmaking: [
      ["marketplace", "Marketplace", "index.html"],
      ["products", "Products", "products.html"],
      ["companies", "Companies", "companies.html"],
      ["tenders", "Tenders", "index.html#tenders"],
      ["matchmaking", "Matchmaking", "matchmaking.html"]
    ],
    admin: [
      ["marketplace", "Marketplace", "index.html"],
      ["products", "Products", "products.html"],
      ["companies", "Companies", "companies.html"],
      ["matchmaking", "Matchmaking", "matchmaking.html"]
    ],
    react: [
      ["dashboard", "Dashboard", "#/dashboard"],
      ["all-tenders", "All Tenders", "#/all-tenders"],
      ["my-opportunities", "My Opportunities", "#/my-opportunities"],
      ["company-profile", "Company Profile", "#/company-profile"]
    ]
  };

  function escapeAttribute(value) {
    return String(value || "").replace(/[&"<>]/g, (character) => ({
      "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;"
    })[character]);
  }

  function positionNotificationPanel(backdrop, bell) {
    if (!backdrop || !bell) return;
    if (globalThis.innerWidth <= 680) {
      backdrop.style.removeProperty("--mh-notification-top");
      backdrop.style.removeProperty("--mh-notification-right");
      return;
    }
    const rect = bell.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.bottom + 8, globalThis.innerHeight - 180));
    const right = Math.max(12, globalThis.innerWidth - rect.right);
    backdrop.style.setProperty("--mh-notification-top", `${Math.round(top)}px`);
    backdrop.style.setProperty("--mh-notification-right", `${Math.round(right)}px`);
  }

  globalThis.MedicHallNavigation = Object.freeze({ positionNotificationPanel });

  class MedicHallHeader extends HTMLElement {
    static get observedAttributes() { return ["active", "active-route", "legacy-url", "context"]; }

    connectedCallback() {
      this.render();
      this.addEventListener("click", this.handleClick);
      this.addEventListener("keydown", this.handleKeydown);
      this.addEventListener("input", this.handleSearchInput);
      this.addEventListener("submit", this.handleSearchSubmit);
      this.syncSessionState();
    }

    disconnectedCallback() {
      this.removeEventListener("click", this.handleClick);
      this.removeEventListener("keydown", this.handleKeydown);
      this.removeEventListener("input", this.handleSearchInput);
      this.removeEventListener("submit", this.handleSearchSubmit);
      clearTimeout(this.searchTimer);
      this.searchAbort?.abort();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    handleClick = (event) => {
      const logoutAction = event.target.closest("[data-mh-logout]");
      const menuButton = event.target.closest(".mh-menu-button");
      const search = event.target.closest(".mh-header-search");
      const nav = this.querySelector(".mh-primary-nav");
      if (logoutAction) {
        event.preventDefault();
        session?.clear();
        if (typeof globalThis.logout === "function") globalThis.logout();
        else globalThis.location.assign("index.html");
        return;
      }
      if (search && window.matchMedia("(max-width: 680px)").matches) search.querySelector("input")?.focus();
      if (menuButton && nav) {
        const open = !nav.classList.contains("is-open");
        nav.classList.toggle("is-open", open);
        menuButton.setAttribute("aria-expanded", String(open));
      }
      if (event.target.closest(".mh-primary-nav a") && nav) {
        nav.classList.remove("is-open");
        this.querySelector(".mh-menu-button")?.setAttribute("aria-expanded", "false");
      }
    };

    setAuthState(authenticated) {
      const state = authenticated ? "authenticated" : "guest";
      this.dataset.authState = state;
      this.querySelectorAll("[data-mh-auth]").forEach((element) => {
        element.hidden = element.dataset.mhAuth !== state;
      });
      const authArea = this.querySelector("#authArea");
      if (authArea && this.getAttribute("mode") === "public") {
        authArea.outerHTML = authenticated
          ? this.renderPublicAccount()
          : this.renderGuestUtilities();
      }
    }

    async syncSessionState() {
      if (!session?.hasStoredSession()) {
        this.setAuthState(false);
        return;
      }
      this.dataset.authState = "checking";
      try {
        await session.getUser();
        if (this.isConnected) this.setAuthState(true);
      } catch (_) {
        if (this.isConnected) this.setAuthState(false);
      }
    }

    handleKeydown = (event) => {
      const results = this.querySelector(".mh-search-results");
      const links = results ? Array.from(results.querySelectorAll("a")) : [];
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && links.length && event.target.closest(".mh-header-search")) {
        event.preventDefault();
        const active = links.indexOf(document.activeElement);
        const next = event.key === "ArrowDown"
          ? active < links.length - 1 ? active + 1 : 0
          : active > 0 ? active - 1 : links.length - 1;
        links[next].focus();
        return;
      }
      if (event.key !== "Escape") return;
      this.querySelector(".mh-primary-nav")?.classList.remove("is-open");
      this.querySelector(".mh-menu-button")?.setAttribute("aria-expanded", "false");
      this.querySelector("details[open]")?.removeAttribute("open");
      this.closeSearch();
    };

    handleSearchInput = (event) => {
      const input = event.target.closest(".mh-header-search input");
      if (!input) return;
      clearTimeout(this.searchTimer);
      this.searchAbort?.abort();
      const query = input.value.trim();
      if (query.length < 2) { this.closeSearch(); return; }
      this.renderSearchState("Searching products and companies…", true);
      this.searchTimer = setTimeout(() => this.searchMarketplace(query), 220);
    };

    handleSearchSubmit = (event) => {
      if (!event.target.closest(".mh-header-search")) return;
      const focused = this.querySelector(".mh-search-results a:focus");
      if (focused) {
        event.preventDefault();
        focused.click();
      }
    };

    closeSearch() {
      const results = this.querySelector(".mh-search-results");
      if (results) { results.hidden = true; results.innerHTML = ""; }
      this.querySelector(".mh-header-search input")?.setAttribute("aria-expanded", "false");
    }

    renderSearchState(content, plain = false) {
      const results = this.querySelector(".mh-search-results");
      if (!results) return;
      results.hidden = false;
      results.innerHTML = plain ? `<div class="mh-search-state" role="status">${content}</div>` : content;
      this.querySelector(".mh-header-search input")?.setAttribute("aria-expanded", "true");
    }

    async searchMarketplace(query) {
      this.searchAbort = new AbortController();
      const headers = { apikey: marketplaceApi.key, Authorization: `Bearer ${marketplaceApi.key}` };
      const escaped = encodeURIComponent(`*${query.replace(/[%,()]/g, " ").trim()}*`);
      try {
        const [productsResponse, companiesResponse] = await Promise.all([
          fetch(`${marketplaceApi.url}/rest/v1/products?select=ref,name,category&or=(name.ilike.${escaped},category.ilike.${escaped},product_subtype.ilike.${escaped})&is_active=eq.true&limit=5`, { headers, signal: this.searchAbort.signal }),
          fetch(`${marketplaceApi.url}/rest/v1/companies?select=id,name,slug,type,country&or=(name.ilike.${escaped},type.ilike.${escaped},country.ilike.${escaped})&limit=5`, { headers, signal: this.searchAbort.signal })
        ]);
        if (!productsResponse.ok || !companiesResponse.ok) throw new Error("Search unavailable");
        const [products, companies] = await Promise.all([productsResponse.json(), companiesResponse.json()]);
        const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].slice(0, 3);
        if (!products.length && !companies.length && !categories.length) {
          this.renderSearchState(`No products or companies found for “${escapeAttribute(query)}”.`, true);
          return;
        }
        const group = (label, rows) => rows.length
          ? `<section><h3>${label}</h3>${rows.join("")}</section>` : "";
        this.renderSearchState(
          group("Products", products.map((product) => `<a href="products.html?p=${encodeURIComponent(product.ref)}"><b>${escapeAttribute(product.name)}</b><span>${escapeAttribute(product.category)} · ${escapeAttribute(product.ref)}</span></a>`)) +
          group("Companies", companies.map((company) => `<a href="${company.slug ? `/m/${encodeURIComponent(company.slug)}` : `companies.html?c=${company.id}`}\"><b>${escapeAttribute(company.name)}</b><span>${escapeAttribute(company.type || "Company")}${company.country ? ` · ${escapeAttribute(company.country)}` : ""}</span></a>`)) +
          group("Categories", categories.map((category) => `<a href="products.html?cat=${encodeURIComponent(category)}"><b>${escapeAttribute(category)}</b><span>Browse category</span></a>`))
        );
      } catch (error) {
        if (error && error.name === "AbortError") return;
        this.renderSearchState("Search is temporarily unavailable. Press Enter to search the product catalog.", true);
      }
    }

    renderGuestUtilities() {
      return `<span class="mh-header__dynamic" id="authArea">
        <a class="btn btn-ghost btn-sm" href="portal.html">Partner login</a>
        <a class="btn btn-solid btn-sm" href="portal.html#register">Join for free</a>
      </span>`;
    }

    renderPublicAccount() {
      return `<span class="mh-header__dynamic is-authenticated" id="authArea">
        <details class="mh-account"><summary aria-label="Account menu">${icons.user}<span>Account</span></summary><div class="mh-account__menu">
          <a href="portal.html#dashboard">Dashboard</a>
          <a href="portal.html#inbox">Messages</a>
          <a href="portal.html#notifications">Notification Center</a>
          <a href="portal.html#profile">Company Profile</a>
          <button type="button" data-mh-logout>Log Out</button>
        </div></details>
      </span>`;
    }

    renderMobileActions(mode) {
      const matchProfile = mode === "matchmaking"
        ? `<a href="matchmaking.html#profile">Match Profile</a>`
        : "";
      return `<div class="mh-mobile-nav-actions" data-mh-auth="guest">
          <a href="portal.html">Log In</a>
          <a href="portal.html#register">Sign Up</a>
        </div>
        <div class="mh-mobile-nav-actions" data-mh-auth="authenticated" hidden>
          <a href="portal.html#dashboard">Dashboard</a>
          <a href="portal.html#inbox">Messages</a>
          <a href="portal.html#notifications">Notifications</a>
          <a href="portal.html#profile">Profile</a>
          ${matchProfile}
          <button type="button" data-mh-logout>Log Out</button>
        </div>`;
    }

    renderUtilities(mode, legacyUrl) {
      if (mode === "public") {
        return this.renderGuestUtilities();
      }
      if (mode === "portal") {
        return `<div class="mh-header__dynamic" id="headActions" style="display:none;gap:8px;align-items:center">
          <a class="btn btn-ghost btn-sm marketplace-link" href="index.html">Marketplace</a>
          <button class="mh-icon-button portal-bell" id="portalNotificationBell" type="button" aria-label="Notifications" aria-expanded="false" onclick="togglePortalNotifications()">
            ${icons.bell}<span class="portal-bell-badge" id="portalNotificationBadge"></span>
          </button>
          <details class="mh-account"><summary aria-label="Account menu">${icons.user}<span>Account</span></summary><div class="mh-account__menu">
            <a href="portal.html#profile">Company Profile</a>
            <a href="portal.html#inbox">Messages</a>
            <button type="button" onclick="togglePortalNotifications()">Notification Center</button>
            <a href="portal.html#settings">Settings</a>
            <button type="button" data-mh-logout>Log Out</button>
          </div></details>
        </div>`;
      }
      if (mode === "matchmaking") {
        return `<div class="mh-header__dynamic nav-actions" id="navActions" style="display:none">
          <a class="btn btn-ghost btn-sm" href="portal.html#inbox">Messages</a>
          <button class="mh-icon-button bell" id="notificationBell" type="button" aria-label="Notifications" aria-expanded="false" onclick="toggleNotifications()">
            ${icons.bell}<span class="bell-badge" id="notificationBadge"></span>
          </button>
          <div class="profile-menu mh-account">
            <button class="profile-trigger" id="profileTrigger" type="button" aria-expanded="false" onclick="toggleProfileMenu()">Account ▾</button>
            <div class="profile-popover" id="profilePopover">
              <button type="button" onclick="showView('profile');toggleProfileMenu(false)">Match profile</button>
              <a href="portal.html#inbox">Messages</a>
              <button type="button" onclick="toggleNotifications();toggleProfileMenu(false)">Notifications</button>
              <a href="portal.html">Partner Portal</a>
              <button type="button" data-mh-logout>Log Out</button>
            </div>
          </div>
        </div>`;
      }
      if (mode === "admin") {
        return `<div class="mh-header__dynamic" id="headActions" style="display:none;gap:8px;align-items:center">
          <a class="btn btn-ghost btn-sm" href="products.html" target="_blank" rel="noopener">View site</a>
          <button class="btn btn-ghost btn-sm" type="button" onclick="logout()">Log out</button>
        </div>`;
      }
      return `<div class="mh-header__dynamic">
        <a class="mh-icon-button" href="${escapeAttribute(legacyUrl)}#notifications" aria-label="Notifications">${icons.bell}</a>
        <details class="mh-account"><summary aria-label="Account menu">${icons.user}<span>Account</span></summary><div class="mh-account__menu">
          <a href="${escapeAttribute(legacyUrl)}">Current Partner Portal</a>
          <a href="${escapeAttribute(legacyUrl)}#profile">Company profile</a>
        </div></details>
      </div>`;
    }

    render() {
      const mode = this.getAttribute("mode") || "public";
      const active = this.getAttribute("active-route") || this.getAttribute("active") || "";
      const legacyUrl = this.getAttribute("legacy-url") || "../../../portal.html";
      const contexts = { portal: "Partner Portal", matchmaking: "Matchmaking", admin: "Admin", react: "Partner Portal" };
      const context = this.getAttribute("context") || contexts[mode] || "";
      const home = mode === "react" ? "#/dashboard" : "index.html";
      const navLinks = (navigation[mode] || navigation.public).map(([key, label, href]) =>
        `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`
      ).join("");

      this.innerHTML = `<a class="mh-skip-link" href="#main-content">Skip to main content</a>
        <header class="mh-header">
          <div class="mh-header__inner">
            <a class="mh-brand" href="${home}" aria-label="MedicHall home">${logo}${context ? `<span class="mh-brand__context">${escapeAttribute(context)}</span>` : ""}</a>
            <form class="mh-header-search" action="/products.html" method="get" role="search">
              ${icons.search}<label class="mh-sr-only" for="mh-search-${mode}">Search products and companies</label>
              <input id="mh-search-${mode}" name="q" type="search" autocomplete="off" placeholder="Search products and companies" aria-controls="mh-search-results-${mode}" aria-expanded="false">
              <div class="mh-search-results" id="mh-search-results-${mode}" hidden></div>
            </form>
            <nav class="mh-primary-nav" id="navLinks" aria-label="Primary navigation">${navLinks}${this.renderMobileActions(mode)}</nav>
            <div class="mh-header__utilities">
              ${this.renderUtilities(mode, legacyUrl)}
              <button class="mh-icon-button mh-menu-button" type="button" aria-label="Open navigation" aria-expanded="false">${icons.menu}</button>
            </div>
          </div>
        </header>`;
      this.setAuthState(this.dataset.authState === "authenticated");
    }
  }

  if (!customElements.get("medichall-header")) customElements.define("medichall-header", MedicHallHeader);

  let enhancementQueued = false;
  function addEmptyAction(item) {
    if (item.querySelector("a, button") || item.dataset.mhEmptyAction) return;
    let label = "", href = "", handler = null;
    if (item.id === "noResults") {
      label = "Clear filters";
      handler = () => {
        if (typeof window.clearFilters === "function") window.clearFilters();
        else {
          const search = document.getElementById("searchInput");
          if (search) search.value = "";
          document.querySelector('.fchip[data-cat="All"]')?.click();
          search?.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
    } else if (item.closest("#productList") && typeof window.openProductForm === "function") {
      label = "Add product"; handler = () => window.openProductForm();
    } else if (item.closest("#bannerList") && typeof window.openBannerForm === "function") {
      label = "Add banner"; handler = () => window.openBannerForm();
    } else if (item.closest("#partnerList") && typeof window.openPartnerForm === "function") {
      label = "Add partner"; handler = () => window.openPartnerForm();
    } else if (item.closest("#favList, #myRfqList, #rfqList")) {
      label = "Browse products"; href = "products.html";
    } else if (item.closest("#dirGrid")) {
      label = "Try again"; handler = () => window.location.reload();
    } else if (item.closest("#chatBody")) {
      label = "Write a message"; handler = () => document.getElementById("chatInput")?.focus();
    } else if (item.closest("#portalNotificationList")) {
      label = "Return to workspace"; handler = () => window.closePortalNotifications?.();
    } else if (item.closest("#notificationList")) {
      label = "Return to workspace"; handler = () => window.closeNotifications?.();
    } else if (item.closest("#workspaceRoot, #matchmaking-root, #b-matchmaking-root")) {
      label = "Browse partner matches";
      handler = () => {
        if (typeof window.showView === "function") window.showView("matches");
        else if (typeof window.mmSetView === "function") window.mmSetView("matches");
      };
    }
    if (!label) return;
    const action = document.createElement(href ? "a" : "button");
    action.className = "btn btn-ghost btn-sm empty-state__action";
    action.textContent = label;
    if (href) action.href = href;
    else { action.type = "button"; action.addEventListener("click", handler); }
    item.dataset.mhEmptyAction = "true";
    item.appendChild(action);
  }

  function enhanceInterface() {
    enhancementQueued = false;
    const mainTarget = document.querySelector("main, .auth-shell, .login-shell, #directoryView, .hero");
    if (mainTarget && !document.getElementById("main-content")) mainTarget.id = "main-content";

    document.querySelectorAll("table").forEach((table) => {
      const horizontalOnly = table.hasAttribute("data-mh-horizontal-table");
      if (!horizontalOnly) {
        table.classList.add("responsive-table");
        const labels = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent.trim());
        table.querySelectorAll("tbody tr").forEach((row) => {
          Array.from(row.children).forEach((cell, index) => {
            if (cell.tagName === "TD" && labels[index] && !cell.dataset.label) cell.dataset.label = labels[index];
          });
        });
      }
      if (!horizontalOnly && !table.parentElement?.classList.contains("table-wrap")) {
        const wrapper = document.createElement("div");
        wrapper.className = "table-wrap";
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute("aria-label", "Scrollable data table");
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
    });

    document.querySelectorAll(".loading").forEach((item) => {
      if (!item.hasAttribute("role")) item.setAttribute("role", "status");
      item.setAttribute("aria-live", "polite");
    });
    document.querySelectorAll(".empty, .empty-state, .opp-empty, .mm-empty, .chat-empty, .no-results").forEach((item) => {
      if (!item.hasAttribute("role")) item.setAttribute("role", "status");
      item.setAttribute("aria-live", "polite");
      addEmptyAction(item);
    });
    document.querySelectorAll(".chat-body").forEach((item) => {
      item.setAttribute("role", "log");
      item.setAttribute("aria-live", "polite");
      item.setAttribute("aria-relevant", "additions text");
    });
    document.querySelectorAll(".toast").forEach((item) => {
      if (!item.hasAttribute("role")) item.setAttribute("role", "status");
      item.setAttribute("aria-live", "polite");
    });
    document.querySelectorAll(".modal, [role=\"dialog\"]").forEach((item) => {
      if (!item.hasAttribute("role")) item.setAttribute("role", "dialog");
      item.setAttribute("aria-modal", "true");
      if (!item.hasAttribute("aria-label") && !item.hasAttribute("aria-labelledby")) {
        const heading = item.querySelector("h1, h2, h3, .modal-title");
        item.setAttribute("aria-label", heading?.textContent?.trim() || "MedicHall dialog");
      }
    });
    document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((control) => {
      const labelled = control.closest("label") ||
        (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)) ||
        control.hasAttribute("aria-label") || control.hasAttribute("aria-labelledby") || control.hasAttribute("title");
      if (labelled) return;
      const controlNames = {
        chatInput: "Message",
        cpvSearch: "Search product groups",
        ffValMax: "Maximum estimated value",
        ffValMin: "Minimum estimated value",
        mhaInput: "Ask MedicHall",
        oppCountry: "Opportunity country",
        oppMin: "Minimum match score",
        oppSearch: "Search matches",
        oppType: "Opportunity type",
        prodSearch: "Search products",
        tiFiles: "Tender documents"
      };
      const fallback = control.getAttribute("placeholder") || control.getAttribute("name") || control.id || "Form field";
      control.setAttribute("aria-label", controlNames[control.id] || fallback.replace(/[._-]+/g, " ").replace(/…/g, "").trim());
    });
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      const rel = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      link.setAttribute("rel", Array.from(rel).join(" "));
    });
  }

  function queueEnhancement() {
    if (enhancementQueued) return;
    enhancementQueued = true;
    requestAnimationFrame(enhanceInterface);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceInterface, { once: true });
  else enhanceInterface();
  new MutationObserver(queueEnhancement).observe(document.documentElement, { childList: true, subtree: true });
}());

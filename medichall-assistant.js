/* Canonical MedicHall assistant for public marketplace and product contexts. */
(function (global) {
  "use strict";

  const API_URL = "https://azdmuarzntzqdyirysux.supabase.co";
  const PUBLIC_KEY = "sb_publishable_RaV2ekM6rJTfdfBFUYIbVA_XSJBZ3Z-";
  const MAX_HISTORY = 6;
  const flights = global.__mhAssistantFlights || (global.__mhAssistantFlights = new Map());
  const state = { open: false, started: false, busy: false, history: [], context: defaultContext() };
  let launcher, panel, messages, input, sendButton, contextLabel;

  function defaultContext() {
    const path = location.pathname.toLowerCase();
    if (path.includes("products")) return { kind: "catalog", label: "Public product catalog" };
    if (path.includes("companies") || path.startsWith("/m/")) return { kind: "directory", label: "Public company directory" };
    return { kind: "general", label: "MedicHall marketplace guidance" };
  }

  const icon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.4-.25-3.4-.7L3 21l1.7-5.1A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>';
  function build() {
    if (document.getElementById("mhAssistant")) return;
    launcher = document.createElement("button");
    launcher.className = "mh-assistant-launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Open Ask MedicHall");
    launcher.setAttribute("aria-controls", "mhAssistant");
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML = icon;

    panel = document.createElement("section");
    panel.id = "mhAssistant";
    panel.className = "mh-assistant";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-labelledby", "mhAssistantTitle");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `<header class="mh-assistant__header"><div class="mh-assistant__brand"><span class="mh-assistant__mark">${icon}</span><div><span class="mh-assistant__eyebrow">MedicHall assistant</span><h2 id="mhAssistantTitle">Ask MedicHall</h2><span class="mh-assistant__context" id="mhAssistantContext"></span></div></div><div class="mh-assistant__controls"><button class="mh-assistant__icon-button" type="button" data-mh-assistant-reset aria-label="Start a new conversation">↻</button><button class="mh-assistant__icon-button" type="button" data-mh-assistant-close aria-label="Close Ask MedicHall">×</button></div></header><div class="mh-assistant__messages" id="mhAssistantMessages" role="log" aria-live="polite" aria-relevant="additions"></div><div class="mh-assistant__composer"><span class="mh-assistant__notice">Public catalog guidance. Tender-document answers are available only in the authenticated tender workspace and include citations.</span><form class="mh-assistant__form" id="mhAssistantForm"><input id="mhAssistantInput" maxlength="500" autocomplete="off" aria-label="Message Ask MedicHall" placeholder="Ask about a product, company or MedicHall…"><button class="mh-assistant__send" type="submit">Send</button></form></div>`;
    document.body.append(launcher, panel);
    messages = panel.querySelector("#mhAssistantMessages");
    input = panel.querySelector("#mhAssistantInput");
    sendButton = panel.querySelector(".mh-assistant__send");
    contextLabel = panel.querySelector("#mhAssistantContext");
    updateContextLabel();
    launcher.addEventListener("click", toggle);
    panel.querySelector("[data-mh-assistant-close]").addEventListener("click", close);
    panel.querySelector("[data-mh-assistant-reset]").addEventListener("click", reset);
    panel.querySelector("#mhAssistantForm").addEventListener("submit", (event) => { event.preventDefault(); send(input.value); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.open) close(); });
  }

  function updateContextLabel() {
    if (contextLabel) contextLabel.textContent = state.context.label || "MedicHall marketplace guidance";
  }

  function open() {
    state.open = true;
    panel.setAttribute("aria-hidden", "false");
    launcher.setAttribute("aria-expanded", "true");
    if (!state.started) greet();
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    state.open = false;
    panel.setAttribute("aria-hidden", "true");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  function toggle() { state.open ? close() : open(); }

  function reset() {
    state.started = false;
    state.history = [];
    messages.replaceChildren();
    greet();
    input.focus();
  }

  function addMessage(text, role = "assistant", modifier = "") {
    const node = document.createElement("div");
    node.className = `mh-assistant__message${role === "user" ? " mh-assistant__message--user" : ""}${modifier ? ` mh-assistant__message--${modifier}` : ""}`;
    node.textContent = String(text || "");
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  }

  function addChips(items) {
    const host = document.createElement("div");
    host.className = "mh-assistant__chips";
    items.forEach(({ label, question }) => {
      const button = document.createElement("button");
      button.className = "mh-assistant__chip";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => send(question));
      host.appendChild(button);
    });
    messages.appendChild(host);
  }

  function addCard(href, title, detail) {
    const link = document.createElement("a");
    link.className = "mh-assistant__card";
    link.href = href;
    const heading = document.createElement("b"); heading.textContent = title;
    const small = document.createElement("small"); small.textContent = detail;
    link.append(heading, small); messages.appendChild(link);
  }

  function greet() {
    state.started = true;
    if (state.context.kind === "product") {
      addMessage(`Ask about ${state.context.name}. I use only its public catalog fields and company information in this view.`);
      addChips([{ label: "Listed specifications", question: "What specifications are listed?" }, { label: "Company", question: "Who supplies this product?" }, { label: "Tender evidence?", question: "Is tender evidence available here?" }]);
      return;
    }
    if (state.context.kind === "company") {
      addMessage(`Ask about ${state.context.name} and its public MedicHall showroom.`);
      addChips([{ label: "Products", question: "Show this company's products" }, { label: "Request a quote", question: "How do I request a quote?" }, { label: "Verification", question: "What should I verify?" }]);
      return;
    }
    addMessage("Hi! I can help you explore MedicHall products, companies, matchmaking and European tender workflows.");
    addChips([{ label: "Find a product", question: "Find a product" }, { label: "Companies", question: "Show companies" }, { label: "European tenders", question: "How do tenders work?" }, { label: "Matchmaking", question: "How does matchmaking work?" }]);
  }

  function productAnswer(question) {
    const product = state.context.product || {};
    const lowered = question.toLocaleLowerCase("en");
    if (/tender|evidence|citation|document/.test(lowered)) return "Tender-document evidence is not available in this product view. Open an authenticated tender opportunity to use the cited, evidence-grounded Ask MedicHall workflow.";
    if (/compan|supplier|manufacturer|who/.test(lowered)) return product.company_name ? `${product.name} is listed by ${product.company_name}. Review the public showroom and request confirmation of commercial or regulatory claims directly from the company.` : "No supplier name is available in this public product context.";
    const facts = [product.category && `category: ${product.category}`, product.material && `material: ${product.material}`, product.dimensions && `dimensions: ${product.dimensions}`, product.sterility_status && product.sterility_status !== "unknown" && `sterility: ${product.sterility_status.replace(/_/g, " ")}`, product.use_type && product.use_type !== "unknown" && `use type: ${product.use_type.replace(/_/g, " ")}`, Array.isArray(product.product_certifications) && product.product_certifications.length && `listed product certifications: ${product.product_certifications.join(", ")}`].filter(Boolean);
    return facts.length ? `The public catalog lists ${facts.join("; ")}. These are company-supplied catalog fields, not tender-document evidence or regulatory advice.` : "This product has limited public structured information. Ask the listed company for current specifications and supporting documents.";
  }

  function ruleAnswer(question) {
    const lowered = question.toLocaleLowerCase("en");
    if (state.context.kind === "product") return productAnswer(question);
    if (/rfq|quote|quotation|inquiry/.test(lowered)) return "Open a product and choose Request quote. Signed-in users can continue the exact RFQ conversation in the MedicHall Messages workspace.";
    if (/tender|procurement|ted|bid/.test(lowered)) return "MedicHall imports European tender information and scores opportunities for signed-in companies. Evidence-grounded tender questions are answered only inside the authenticated tender workspace, with citations and explicit uncertainty.";
    if (/matchmak|partner|distributor match/.test(lowered)) return "MedicHall matchmaking connects manufacturers, distributors and buyers using structured profile and commercial-fit evidence. Create a profile to review explanations before requesting a connection.";
    if (/register|sign ?up|join|account/.test(lowered)) return "You can create a free manufacturer, distributor or buyer account from the Partner Portal. Setup is resumable and role-aware.";
    if (/certif|ce\b|iso|mdr|verification/.test(lowered)) return "Certifications shown on public profiles are company-supplied. Review supporting documents and complete your own verification before a commercial decision.";
    if (/show.*compan|companies|manufacturer|supplier/.test(lowered) && lowered.length < 80) return "Use the Company Directory to filter approved public profiles by role, country, product category and listed certification.";
    if (/find.*product|products?$|catalog/.test(lowered)) return "Tell me a product, material, sterility, use type or certification term and I will search the public catalog.";
    return null;
  }

  async function catalogSearch(question) {
    const term = `*${question.replace(/[%,()]/g, " ").trim()}*`;
    const encoded = encodeURIComponent(term);
    try {
      const [productsResponse, companiesResponse] = await Promise.all([
        fetch(`${API_URL}/rest/v1/products?select=ref,name,category,company_id,companies(name)&or=(name.ilike.${encoded},category.ilike.${encoded})&is_active=eq.true&limit=4`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}` } }),
        fetch(`${API_URL}/rest/v1/companies?select=id,name,slug,type&name=ilike.${encoded}&limit=3`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}` } }),
      ]);
      const products = productsResponse.ok ? await productsResponse.json() : [];
      const companies = companiesResponse.ok ? await companiesResponse.json() : [];
      if (!products.length && !companies.length) return false;
      addMessage("Here are the closest public catalog results:");
      products.forEach((product) => addCard(`products.html?p=${encodeURIComponent(product.ref)}`, product.name, `${product.category}${product.companies?.name ? ` · ${product.companies.name}` : ""}`));
      companies.forEach((company) => addCard(company.slug ? `/m/${encodeURIComponent(company.slug)}` : `companies.html?c=${company.id}`, company.name, company.type || "Company"));
      return true;
    } catch (_) { return false; }
  }

  function cacheKey(question) {
    let hash = 2166136261;
    for (const character of question.trim().toLocaleLowerCase("en")) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `mh_assistant_v2_${(hash >>> 0).toString(36)}`;
  }

  async function publicAnswer(question) {
    const key = cacheKey(question);
    try { const cached = sessionStorage.getItem(key); if (cached) return { reply: cached, cached: true }; } catch (_) {}
    if (flights.has(key)) return flights.get(key);
    const task = (async () => {
      const response = await fetch(`${API_URL}/functions/v1/public-assistant`, { method: "POST", headers: { apikey: PUBLIC_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ message: question, history: state.history.slice(-MAX_HISTORY) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.reply) throw new Error("assistant_unavailable");
      const reply = String(data.reply).slice(0, 1800);
      try { sessionStorage.setItem(key, reply); } catch (_) {}
      return { reply, cached: false };
    })().finally(() => flights.delete(key));
    flights.set(key, task); return task;
  }

  async function send(rawQuestion) {
    const question = String(rawQuestion || "").trim().slice(0, 500);
    if (!question || state.busy) return;
    input.value = ""; addMessage(question, "user"); state.busy = true; sendButton.disabled = true;
    if (state.context.kind === "company" && /product|catalog/.test(question.toLocaleLowerCase("en")) && Array.isArray(state.context.products) && state.context.products.length) {
      addMessage(`Public products listed by ${state.context.name}:`);
      state.context.products.slice(0, 5).forEach((product) => addCard(`products.html?p=${encodeURIComponent(product.ref)}`, product.name, product.category || "Public catalog product"));
      state.busy = false; sendButton.disabled = false; return;
    }
    const rule = ruleAnswer(question);
    if (rule) { addMessage(rule); state.history.push({ role: "user", content: question }, { role: "assistant", content: rule }); state.busy = false; sendButton.disabled = false; return; }
    const found = await catalogSearch(question);
    if (found) { state.busy = false; sendButton.disabled = false; return; }
    const loading = addMessage("Checking MedicHall guidance…", "assistant", "loading");
    try {
      const result = await publicAnswer(question); loading.remove(); addMessage(result.reply + (result.cached ? "" : "")); state.history.push({ role: "user", content: question }, { role: "assistant", content: result.reply });
    } catch (_) { loading.remove(); addMessage("Ask MedicHall is temporarily unavailable. Please try again or contact info@medichall.com.", "assistant", "error"); }
    finally { state.busy = false; sendButton.disabled = false; }
  }

  function setContext(next = {}) {
    const previousKind = state.context.kind;
    state.context = { ...defaultContext(), ...next, label: next.label || next.name || defaultContext().label };
    updateContextLabel();
    if (state.started && previousKind !== state.context.kind) reset();
  }

  build();
  global.MedicHallAssistant = Object.freeze({ open, close, toggle, reset, send, setContext });
  if (global.__mhAssistantPendingContext) {
    setContext(global.__mhAssistantPendingContext);
    delete global.__mhAssistantPendingContext;
  }
})(globalThis);

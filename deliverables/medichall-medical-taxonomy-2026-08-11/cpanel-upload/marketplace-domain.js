/* MedicHall enterprise marketplace domain helpers. No network or credential access. */
(function (global) {
  "use strict";

  const UNKNOWN = "unknown";
  const asArray = (value) => Array.isArray(value)
    ? value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
    : value === null || value === undefined || value === ""
      ? []
      : String(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  const text = (value) => String(value ?? "").trim();
  const lower = (value) => text(value).toLocaleLowerCase("en");
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const words = (value) => unique(lower(value).replace(/[^a-z0-9çğıöşü]+/gi, " ").split(/\s+/).filter((word) => word.length > 1));
  const companyOf = (row) => Array.isArray(row && row.companies) ? row.companies[0] : row && row.companies || null;

  function canonicalCountry(value) {
    const country = text(value).normalize("NFC");
    return lower(country) === "türkiye" ? "Türkiye" : country;
  }

  function sourceFor(product, field) {
    const value = product && product[field];
    const configured = product && product.matching_profile_sources && product.matching_profile_sources[field];
    if (configured === "explicit" || configured === "derived" || configured === "unknown") return configured;
    if (Array.isArray(value)) return value.length ? "explicit" : "unknown";
    return value !== null && value !== undefined && value !== "" && value !== UNKNOWN ? "explicit" : "unknown";
  }

  function displayValue(value, fallback = "Not provided") {
    if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
    if (value === null || value === undefined || value === "" || value === UNKNOWN) return fallback;
    return String(value).replace(/_/g, " ");
  }

  function normalizeProduct(row) {
    const company = companyOf(row) || {};
    return {
      id: Number(row && row.id) || null,
      ref: text(row && row.ref),
      name: text(row && row.name) || "Unnamed product",
      category: text(row && row.category) || "Uncategorized",
      taxonomy_id: Number(row && row.taxonomy_id) || null,
      taxonomy_category: text(row && row.taxonomy_category) || null,
      taxonomy_slug: text(row && row.taxonomy_slug) || null,
      normalized_category: text(row && row.normalized_category) || null,
      product_subtype: text(row && row.product_subtype) || null,
      description: text(row && row.description) || null,
      image_url: text(row && row.image_url) || null,
      brochure_url: text(row && row.brochure_url) || null,
      material: text(row && row.material) || null,
      dimensions: text(row && row.dimensions) || null,
      sterility_status: text(row && row.sterility_status) || UNKNOWN,
      use_type: text(row && row.use_type) || UNKNOWN,
      packaging_description: text(row && row.packaging_description) || null,
      units_per_package: Number(row && row.units_per_package) || null,
      product_certifications: asArray(row && row.product_certifications),
      regulatory_class: text(row && row.regulatory_class) || null,
      sterilization_method: text(row && row.sterilization_method) || null,
      production_capacity: row && row.production_capacity !== null && row && row.production_capacity !== undefined
        ? Number(row.production_capacity) : null,
      capacity_unit: text(row && row.capacity_unit) || null,
      capacity_period: text(row && row.capacity_period) || null,
      technical_specifications: asArray(row && row.technical_specifications),
      matching_profile_sources: row && row.matching_profile_sources && typeof row.matching_profile_sources === "object"
        ? row.matching_profile_sources : {},
      is_featured: Boolean(row && row.is_featured),
      company_id: Number(row && row.company_id) || Number(company.id) || null,
      company_name: text(company.name) || null,
      company_slug: text(company.slug) || null,
      company_logo_url: text(company.logo_url) || null,
      company_country: canonicalCountry(company.country) || null,
      company_type: text(company.type) || null,
      company_verified: Boolean(company.is_verified),
      company_certifications: asArray(company.certifications),
    };
  }

  const readinessFields = [
    "description", "product_subtype", "material", "dimensions", "sterility_status",
    "use_type", "packaging_description", "product_certifications", "regulatory_class",
    "technical_specifications",
  ];

  function productReadiness(product) {
    const known = readinessFields.filter((field) => sourceFor(product, field) !== "unknown");
    const score = Math.round((known.length / readinessFields.length) * 100);
    return {
      score,
      label: score >= 80 ? "Detailed profile" : score >= 50 ? "Core details available" : "Limited profile data",
      known: known.length,
      total: readinessFields.length,
    };
  }

  function productSearchText(product) {
    return lower([
      product.name, product.ref, product.taxonomy_category, product.category, product.normalized_category,
      product.product_subtype, product.description, product.material, product.dimensions,
      product.packaging_description, product.regulatory_class, product.sterilization_method,
      product.company_name, product.company_country, product.company_type,
      ...asArray(product.product_certifications), ...asArray(product.company_certifications),
      ...asArray(product.technical_specifications),
    ].join(" "));
  }

  function matchesFilters(product, filters = {}) {
    const q = lower(filters.q);
    const certifications = [...product.product_certifications, ...product.company_certifications].map(lower);
    return (!q || productSearchText(product).includes(q))
      && (!filters.category || (product.taxonomy_category || product.category) === filters.category)
      && (!filters.company || String(product.company_id) === String(filters.company))
      && (!filters.country || product.company_country === filters.country)
      && (!filters.certification || certifications.some((item) => item === lower(filters.certification)))
      && (!filters.sterility || product.sterility_status === filters.sterility)
      && (!filters.useType || product.use_type === filters.useType)
      && (!filters.material || lower(product.material).includes(lower(filters.material)))
      && (!filters.readiness || productReadiness(product).score >= Number(filters.readiness))
      && (!filters.favoritesOnly || filters.favoriteIds && filters.favoriteIds.has(Number(product.id)));
  }

  function sortProducts(products, sort = "featured") {
    const rows = [...products];
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (sort === "za") return rows.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === "readiness") return rows.sort((a, b) => productReadiness(b).score - productReadiness(a).score || byName(a, b));
    if (sort === "company") return rows.sort((a, b) => (a.company_name || "").localeCompare(b.company_name || "") || byName(a, b));
    return rows.sort((a, b) => Number(b.is_featured) - Number(a.is_featured) || byName(a, b));
  }

  function productFacets(products) {
    const values = (key) => unique(products.map((product) => product[key])).sort((a, b) => String(a).localeCompare(String(b)));
    return {
      categories: unique(products.map((product) => product.taxonomy_category || product.category)).sort((a, b) => String(a).localeCompare(String(b))),
      countries: values("company_country"),
      companies: unique(products.filter((product) => product.company_id && product.company_name).map((product) => `${product.company_id}\u0000${product.company_name}`))
        .map((item) => { const [id, name] = item.split("\u0000"); return { id: Number(id), name }; })
        .sort((a, b) => a.name.localeCompare(b.name)),
      certifications: unique(products.flatMap((product) => [...product.product_certifications, ...product.company_certifications])).sort((a, b) => a.localeCompare(b)),
      materials: unique(products.map((product) => product.material).filter(Boolean)).sort((a, b) => a.localeCompare(b)),
      sterility: values("sterility_status").filter((value) => value !== UNKNOWN),
      useTypes: values("use_type").filter((value) => value !== UNKNOWN),
    };
  }

  function companyFilterLabel(products, companyId, fallback = "Selected company") {
    const company = products.find((product) => String(product.company_id) === String(companyId) && product.company_name);
    return company ? company.company_name : fallback;
  }

  function overlapScore(left, right) {
    const a = new Set(asArray(left).flatMap(words));
    const b = new Set(asArray(right).flatMap(words));
    if (!a.size || !b.size) return 0;
    const overlap = [...a].filter((item) => b.has(item)).length;
    return overlap / Math.max(a.size, b.size);
  }

  function similarProduct(source, candidate) {
    if (!source || !candidate || source.id === candidate.id || source.ref === candidate.ref) return null;
    let score = 0;
    const reasons = [];
    const sourceCategory = source.taxonomy_category || source.category;
    const candidateCategory = candidate.taxonomy_category || candidate.category;
    if (sourceCategory && sourceCategory === candidateCategory) { score += 28; reasons.push(`Same category: ${sourceCategory}`); }
    if (source.normalized_category && source.normalized_category === candidate.normalized_category) { score += 22; reasons.push("Same structured category"); }
    const subtype = overlapScore(source.product_subtype, candidate.product_subtype);
    if (subtype) { score += Math.round(subtype * 15); reasons.push("Related product subtype"); }
    const material = overlapScore(source.material, candidate.material);
    if (material) { score += Math.round(material * 10); reasons.push("Material overlap"); }
    if (source.sterility_status !== UNKNOWN && source.sterility_status === candidate.sterility_status) { score += 8; reasons.push(`Both ${displayValue(source.sterility_status)}`); }
    if (source.use_type !== UNKNOWN && source.use_type === candidate.use_type) { score += 7; reasons.push(`Both ${displayValue(source.use_type)}`); }
    const certifications = overlapScore(source.product_certifications, candidate.product_certifications);
    if (certifications) { score += Math.round(certifications * 8); reasons.push("Certification overlap"); }
    if (!reasons.length) return null;
    return { product: candidate, score: Math.min(100, score), reasons: reasons.slice(0, 3) };
  }

  function similarProducts(source, products, limit = 4) {
    return products.map((candidate) => similarProduct(source, candidate)).filter(Boolean)
      .filter((result) => result.score >= 20)
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
      .slice(0, limit);
  }

  function recommendation(requirement, product) {
    const requirementWords = words(requirement);
    const haystackWords = new Set(words(productSearchText(product)));
    const matched = requirementWords.filter((word) => haystackWords.has(word));
    const gaps = requirementWords.filter((word) => !haystackWords.has(word));
    const knownStructured = readinessFields.filter((field) => sourceFor(product, field) !== "unknown").length;
    const normalizedRequirement = lower(requirement);
    const blockers = [];
    if (/\bsterile\b/.test(normalizedRequirement) && product.sterility_status === "non_sterile") blockers.push("Product is explicitly non-sterile");
    if (/\breusable\b/.test(normalizedRequirement) && product.use_type === "single_use") blockers.push("Product is explicitly single-use");
    if (/\bsingle[ -]?use\b/.test(normalizedRequirement) && product.use_type === "reusable") blockers.push("Product is explicitly reusable");
    const lexical = requirementWords.length ? matched.length / requirementWords.length : 0;
    const score = blockers.length ? Math.min(35, Math.round(lexical * 55)) : Math.min(100, Math.round(lexical * 70 + (knownStructured / readinessFields.length) * 30));
    const label = knownStructured < 2 || requirementWords.length < 2 ? "Insufficient information"
      : score >= 80 ? "Strong fit" : score >= 60 ? "Good fit" : score >= 40 ? "Possible fit" : "Weak fit";
    return {
      product, score, label, blockers,
      matched: matched.slice(0, 8), gaps: gaps.slice(0, 8),
      unknowns: readinessFields.filter((field) => sourceFor(product, field) === "unknown").slice(0, 6),
    };
  }

  function recommendations(requirement, products, limit = 6) {
    return products.map((product) => recommendation(requirement, product))
      .filter((result) => result.matched.length || result.blockers.length)
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
      .slice(0, limit);
  }

  function queryFilters(search) {
    const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return {
      q: params.get("q") || "", category: params.get("cat") || "", company: params.get("company") || "",
      country: canonicalCountry(params.get("country") || ""), certification: params.get("cert") || "",
      sterility: params.get("sterility") || "", useType: params.get("use") || "",
      material: params.get("material") || "", readiness: params.get("readiness") || "", sort: params.get("sort") || "featured",
      page: Math.max(1, Number(params.get("page")) || 1), favoritesOnly: params.get("view") === "favorites",
      detail: params.get("p") || "", compare: params.get("compare") || "",
    };
  }

  function filtersQuery(filters, extras = {}) {
    const params = new URLSearchParams();
    const values = {
      q: filters.q, cat: filters.category, company: filters.company, country: filters.country,
      cert: filters.certification, sterility: filters.sterility, use: filters.useType,
      material: filters.material, readiness: filters.readiness, sort: filters.sort && filters.sort !== "featured" ? filters.sort : "",
      page: filters.page > 1 ? filters.page : "", view: filters.favoritesOnly ? "favorites" : "",
      p: extras.detail, compare: extras.compare,
    };
    Object.entries(values).forEach(([key, value]) => { if (value !== "" && value !== null && value !== undefined) params.set(key, value); });
    return params.toString();
  }

  function safeHttpUrl(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch (_) { return ""; }
  }

  function fileMeta(value, fallbackName = "document") {
    const url = safeHttpUrl(value);
    if (!url) return null;
    const pathname = new URL(url).pathname;
    const raw = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || fallbackName);
    const safe = raw.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || fallbackName;
    const extension = (safe.match(/\.([a-z0-9]{1,8})$/i) || [])[1];
    return { url, filename: safe, type: extension ? extension.toUpperCase() : "FILE" };
  }

  const comparisonRows = [
    ["Company", (product) => product.company_name], ["Country", (product) => product.company_country],
    ["Category", (product) => product.taxonomy_category || product.category], ["Subtype", (product) => product.product_subtype],
    ["Dimensions", (product) => product.dimensions], ["Material", (product) => product.material],
    ["Sterility", (product) => displayValue(product.sterility_status)], ["Use type", (product) => displayValue(product.use_type)],
    ["Packaging", (product) => product.packaging_description], ["Units / package", (product) => product.units_per_package],
    ["Certifications", (product) => product.product_certifications], ["Regulatory class", (product) => product.regulatory_class],
    ["Sterilization method", (product) => product.sterilization_method],
    ["Production capacity", (product) => product.production_capacity === null ? null : `${product.production_capacity} ${product.capacity_unit || ""} / ${product.capacity_period || "period"}`],
    ["Profile detail", (product) => `${productReadiness(product).score}%`],
  ];

  global.MedicHallMarketplaceDomain = {
    UNKNOWN, asArray, text, words, displayValue, canonicalCountry, sourceFor, normalizeProduct,
    productReadiness, productSearchText, matchesFilters, sortProducts, productFacets,
    companyFilterLabel, similarProduct, similarProducts, recommendation, recommendations,
    queryFilters, filtersQuery, safeHttpUrl, fileMeta, comparisonRows,
  };
})(globalThis);

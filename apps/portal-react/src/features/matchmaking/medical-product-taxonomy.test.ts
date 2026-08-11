import { describe, expect, it } from "vitest";
import migration from "../../../../../supabase/migrations/202608110001_medical_product_taxonomy.sql?raw";
import taxonomyUi from "../../../../../medichall-taxonomy.js?raw";
import taxonomyAdmin from "../../../../../medichall-taxonomy-admin.js?raw";
import portal from "../../../../../portal.html?raw";
import standalone from "../../../../../matchmaking.html?raw";
import workspace from "../../../../../matchmaking-workspace.js?raw";
import products from "../../../../../marketplace-products.js?raw";
import companies from "../../../../../marketplace-companies.js?raw";
import productDomain from "../../../../../marketplace-domain.js?raw";
import admin from "../../../../../admin.html?raw";
import tenderHandler from "../../../../../supabase/functions/tender-document-engine/handler.ts?raw";

describe("medical product taxonomy production surfaces", () => {
  it("uses a database-backed hierarchy, aliases, mappings, review queue and RLS", () => {
    for (const object of [
      "medical_product_taxonomy", "medical_product_aliases",
      "product_taxonomy_mappings", "matchmaking_taxonomy_interests",
      "tender_taxonomy_mappings", "medical_product_taxonomy_review_queue",
    ]) expect(migration).toContain(object);
    expect(migration).toContain("enable row level security");
    expect(migration).not.toContain("Company B changed Company A");
    expect(migration).toContain("semantic_provider_used', false");
    expect(migration).not.toMatch(/update\s+public\.products\s+set\s+name/i);
  });

  it("keeps required synonyms in the reusable taxonomy instead of frontend conditionals", () => {
    for (const alias of [
      "Ultrasound Transducer Sheath", "Probe Sheath", "Ultrasound Sheath",
      "C Arm Drape", "C-Arm Protective Cover", "Sterile C-Arm Equipment Drape",
    ]) expect(migration).toContain(alias);
    expect(taxonomyUi).not.toContain("Ultrasound Transducer Sheath");
    expect(taxonomyUi).not.toContain("C-Arm Protective Cover");
  });

  it("shares one accessible responsive selector across product and matchmaking forms", () => {
    expect(portal).toContain('medichall-taxonomy.js?v=20260811tax1');
    expect(standalone).toContain('medichall-taxonomy.js?v=20260811tax1');
    expect(portal).toContain('medichall-taxonomy.css?v=20260811tax1');
    expect(standalone).toContain('medichall-taxonomy.css?v=20260811tax1');
    expect(portal).toContain("MedicHallTaxonomy.createSelector");
    expect(workspace).toContain("MedicHallTaxonomy.createSelector");
    expect(taxonomyUi).toContain('role="combobox"');
    expect(taxonomyUi).toContain('role="listbox"');
    expect(taxonomyUi).toContain('aria-live="polite"');
    for (const keyboardAction of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"])
      expect(taxonomyUi).toContain(keyboardAction);
  });

  it("preserves legacy product text while saving structured selections and custom fallback", () => {
    expect(portal).toContain("Legacy product phrases");
    expect(workspace).toContain("Legacy product phrases");
    expect(portal).toContain("save_matchmaking_taxonomy_interests_v1");
    expect(workspace).toContain("save_matchmaking_taxonomy_interests_v1");
    expect(taxonomyUi).toContain("Keep as custom");
    expect(taxonomyUi).toContain("Choose another");
    expect(taxonomyUi).toContain("Possible");
    expect(taxonomyUi).not.toMatch(/fetch\(|anthropic|openai/i);
  });

  it("uses canonical taxonomy in products, the mixed company directory and RFQ targeting without N+1 requests", () => {
    expect(products).toContain("product_taxonomy_mappings?select=product_id");
    expect(products).toContain("taxonomy_category");
    expect(products).toContain("taxonomy_id=eq.");
    expect(companies).toContain("product_taxonomy_mappings?select=product_id");
    expect(companies).toContain("taxonomy_category");
    expect(productDomain).toContain("product.taxonomy_category || product.category");
    expect(products.match(/product_taxonomy_mappings\?select=product_id/g)?.length).toBe(1);
    expect(companies.match(/product_taxonomy_mappings\?select=product_id/g)?.length).toBe(1);
  });

  it("integrates tender and lot mapping without replacing existing intelligence", () => {
    expect(tenderHandler).toContain("refresh_tender_taxonomy_mappings_v1");
    expect(tenderHandler).toContain("taxonomy_mappings_refreshed");
    expect(tenderHandler).toContain("taxonomy_provider_calls: 0");
    expect(portal).toContain("get_tender_taxonomy_compatibility_v1");
    expect(portal).toContain("get_tender_lot_matches_v1");
    expect(portal).toContain("tender-document-engine");
  });

  it("keeps canonical administration behind existing admin RPC authorization", () => {
    expect(admin).toContain('data-panel="taxonomy"');
    expect(admin).toContain('medichall-taxonomy-admin.js?v=20260811tax1');
    expect(taxonomyAdmin).toContain("get_admin_medical_taxonomy_v1");
    expect(taxonomyAdmin).toContain("admin_review_medical_product_term_v1");
    expect(migration).toContain("if not public.is_admin()");
  });
});

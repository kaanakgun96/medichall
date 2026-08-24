import { describe, expect, it } from "vitest";
import migration from "../../../../../supabase/migrations/202608200003_external_prospect_discovery.sql?raw";
import portal from "../../../../../portal.html?raw";
import standalone from "../../../../../matchmaking.html?raw";
import workspace from "../../../../../matchmaking-workspace.js?raw";
import externalWorkspace from "../../../../../external-prospects.js?raw";
import discoveryFunction from "../../../../../supabase/functions/external-prospect-discovery/index.ts?raw";
import registryAdapters from "../../../../../supabase/functions/_shared/external-registry-adapters.ts?raw";

describe("External Prospect Discovery production contract", () => {
  it("uses one shared workspace across first-class Buyer Discovery surfaces", () => {
    for (const page of [portal, standalone]) {
      expect(page).toContain("external-prospects.js?v=20260824relevance2");
      expect(page).toContain("external-prospects.css?v=20260824relevance2");
    }
    expect(portal).toContain("European Buyer Discovery");
    expect(portal).toContain('id="panel-buyer-discovery"');
    expect(workspace).toContain('tab("buyer_discovery","European Buyer Discovery"');
    expect(portal).not.toContain('mmViewButton("external_prospects"');
    expect(externalWorkspace).toContain("MedicHallExternalProspects");
  });

  it("keeps discovery manual, bounded, cached, and zero-paid-provider", () => {
    expect(externalWorkspace).toContain("Discover European buyers");
    expect(externalWorkspace).toContain("data-action=\"discover\"");
    expect(externalWorkspace).not.toMatch(/DOMContentLoaded[^;]+discover/i);
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("interval '30 minutes'");
    expect(migration).toContain("if v_daily >= 3");
    expect(migration).toContain("if v_monthly >= 20");
    expect(discoveryFunction).toContain("maximumTedResultsPerQuery");
    expect(discoveryFunction).toContain("provider_requests: 0");
    expect(discoveryFunction).toContain("estimated_cost_usd: 0");
  });

  it("separates global evidence from tenant matches and feedback", () => {
    for (const table of [
      "external_companies",
      "external_company_evidence",
      "external_company_activities",
      "company_external_prospect_matches",
      "external_prospect_feedback",
    ]) expect(migration).toContain(`public.${table}`);
    expect(migration).toContain("company_owner_authorized_v1(company_id)");
    expect(migration).toContain("membership_status = 'NOT_ON_MEDICHALL'");
    expect(migration).toContain("medichall_company_id");
    expect(migration).toContain("'NOTE_ONLY'");
    expect(externalWorkspace).toContain('feedback(id,"NOTE_ONLY",note)');
  });

  it("labels registry activity as indirect commercial evidence", () => {
    expect(externalWorkspace).toContain("Indirect commercial evidence");
    expect(externalWorkspace).toContain("never presented as proof of exact product availability");
    expect(migration).toContain("is_direct_product_evidence boolean not null default false check (not is_direct_product_evidence)");
    expect(registryAdapters).toContain("FR_RECHERCHE_ENTREPRISES");
    expect(registryAdapters).toContain("NO_BRREG_ENHETSREGISTERET");
    expect(discoveryFunction).toContain("registryAdaptersForCountries");
    expect(discoveryFunction).toContain("evidence_kind: evidence.evidenceKind");
    expect(externalWorkspace).toContain("Target markets");
  });

  it("contains no personal-contact or outreach feature in V1", () => {
    const schema = migration.slice(
      migration.indexOf("create table public.external_companies"),
      migration.indexOf("create table public.external_prospect_discovery_runs"),
    );
    expect(schema).not.toMatch(/\b(contact_email|contact_name|phone|linkedin_url)\b/);
    expect(externalWorkspace).not.toMatch(/Send email|Start outreach|Email prospect|LinkedIn profile/i);
    expect(discoveryFunction).toContain("direct_contact_fields_stored: 0");
    expect(discoveryFunction).toContain("emails_sent: 0");
  });
});

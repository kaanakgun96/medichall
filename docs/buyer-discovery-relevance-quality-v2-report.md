# Buyer Discovery Relevance Quality V2 — QA Report

Date: 2026-08-24

Branch: `react-migration`
Scope: deterministic product-family relevance, buyer archetypes, Europe-wide retrieval planning, relevance-first diversity, and frontend explanations. This release is not deployed.

## Root cause and resolution

The prior discovery path treated broad TED CPV matches as direct product evidence and truncated candidates before ranking. That allowed generic medical/surgical companies to score too highly and concentrated Europe-wide results in the countries returned first by TED.

V2 classifies each independent source as `DIRECT`, `ADJACENT`, or `GENERIC`; requires direct evidence or multiple supported adjacent signals; caps generic-only and product-family mismatch scores at 42; and ranks the bounded Europe-wide pool before applying a maximum three-point diversity tie-break. Registry activity remains company-type context and can never prove exact-product fit.

## Golden benchmark results

The company names below exist only in the test fixture. Production code contains no company-specific rule or score adjustment.

| Company | Country | Test product | Detected buyer archetype | Direct | Adjacent | Generic | Confidence | Score | Expected / actual classification | Result |
|---|---:|---|---|---:|---:|---:|---|---:|---|---|
| Polysistem | IT | Sterile Surgical Gown | Manufacturer | 1 | 0 | 0 | Medium | 68 | Direct / Direct | PASS |
| Mediberg | IT | Sterile Surgical Gown | Procedure-pack manufacturer; manufacturer | 2 | 0 | 0 | Medium | 74 | Direct / Direct | PASS |
| Betatex | IT | Sterile Surgical Gown | Procedure-pack manufacturer; manufacturer | 0 | 1 | 0 | Medium | 59 | Adjacent / Adjacent | PASS |
| Medica Europe | NL | Sterile Surgical Gown | Procedure-pack manufacturer; manufacturer | 2 | 0 | 0 | Medium | 74 | Direct / Direct | PASS |
| Fapomed | PT | Sterile Surgical Gown | Procedure-pack manufacturer; manufacturer | 2 | 0 | 0 | Medium | 74 | Direct / Direct | PASS |
| PRIM | ES | Sterile Surgical Gown | Unknown | 0 | 0 | 1 | Low | 11 | Evidence-dependent / Generic only | PASS — no gown claim inferred from cover evidence |
| biocon Medizintechnik | DE | Sterile Surgical Gown | Procedure-pack manufacturer; manufacturer | 2 | 0 | 0 | Medium | 74 | Direct / Direct | PASS |
| TZMO Global | PL | Sterile Surgical Gown | Procedure-pack manufacturer; kit assembler; manufacturer | 1 | 1 | 0 | Medium | 74 | Direct / Direct | PASS |
| Genimpex | IT | Equipment-cover family | Distributor | 1 | 0 | 0 | Medium | 68 | Direct / Direct | PASS |
| Effebi Hospital | IT | Equipment-cover family | Manufacturer | 1 | 0 | 0 | Medium | 68 | Direct / Direct | PASS |
| BioCommerciale | IT | Equipment-cover family | Distributor | 2 | 0 | 0 | Medium | 70 | Direct / Direct | PASS |
| PRIM | ES | Equipment-cover family | Distributor | 2 | 0 | 0 | Medium | 70 | Direct / Direct | PASS |
| m3m Advance | ES | Equipment-cover family | Unknown | 0 | 0 | 1 | Low | 11 | Evidence-dependent / Generic only | PASS — radiology activity alone is insufficient |
| Inside Medical | GR | Equipment-cover family | Unknown | 0 | 0 | 1 | Low | 11 | Evidence-dependent / Generic only | PASS — broad consumables CPV is insufficient |
| CG Medical | FR | Equipment-cover family | Distributor | 2 | 0 | 0 | Medium | 70 | Direct / Direct | PASS |
| EDM Medical Imaging | FR | C-Arm / Imaging Equipment Cover | Distributor | 1 | 1 | 0 | Medium | 70 | Direct / Direct | PASS |

The separate synthetic surgical-robotics/oncology/imaging fixture is classified as `PRODUCT_FAMILY_MISMATCH`, is ineligible, and remains below the generic score ceiling.

## Public evidence basis

- Polysistem: <https://www.polysistem.com/categoria-prodotto/teleria-ed-accessoristica-chirurgica/>
- Mediberg: <https://www.mediberg.com/en/products/>
- Betatex: <https://www.betatex.com/betatex/portfolio/surgical/>
- Medica Europe: <https://medica-europe.com/en/>
- Fapomed: <https://www.fapomed.pt/>
- PRIM: <https://quirofano.prim.es/quirofano/>
- biocon Medizintechnik: <https://biocon-online.de/en/customized-procedure-packs/>
- TZMO Global: <https://tzmo-global.com/en_IN/brand/matopat-17/>
- Genimpex: <https://www.genimpex.it/home-page>
- Effebi Hospital: <https://www.effebihospital.com/copri-telecamere-operatorie-modelli/>
- BioCommerciale: <https://www.biocommerciale.com/prodotti/>
- CG Medical: <https://www.cgmedical.fr/>
- EDM Medical Imaging: <https://www.edm-imaging.com/>
- m3m Advance: <https://contratos-publicos.comunidad.madrid/contrato/D878_2617>
- Inside Medical: <https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml?referenceNumber=26SYMV019265181>

These URLs are deterministic fixture provenance. Automated tests do not make live requests and do not create production records.

## Safety and compatibility

- No migration was added or applied.
- No Edge Function or cPanel file was deployed.
- No AI/provider call, email, notification, message, or contact collection is introduced.
- Current score columns and JSON snapshots are reused; no production schema change is required.
- Discovery diagnostics now include countries attempted, candidate/accepted counts by country, sources, evidence classes, buyer archetypes, rejection reasons, and diversity tie-break counts.
- Existing product-intent modes, website scan safety, rate limits, tenant/RLS boundary, save/dismiss/note workflow, and zero-contact contract remain unchanged.

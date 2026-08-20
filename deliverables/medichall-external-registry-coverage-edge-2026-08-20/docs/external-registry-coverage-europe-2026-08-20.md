# External Prospect Discovery — European registry coverage review

Date: 2026-08-20

Branch: `react-migration`

Scope: Phase 1 official registry/economic-activity evidence only

This review is the release and legal gate for the European registry expansion. It does not authorize a production deployment. It adds no progress UX, Apollo integration, decision-maker data, email, phone, notification, AI, or cPanel artifact.

## Decision summary

| Country | Official source | Classification | Runtime status | Cost | Commercial/reuse assessment | Runtime requests |
|---|---|---|---|---|---|---:|
| France | French State API Recherche d'entreprises | NAF/APE | `ACTIVE` | FREE | Open API, MIT; public administrative data. Retain only active named legal entities. | max 2/run |
| Norway | Brønnøysund CCR Open Data | SN2007/SN2025 | `ACTIVE` | FREE | NLOD 2.0. Exclude sole proprietorship (`ENK`) records. | max 1/run |
| Germany | Unternehmensregister; Destatis WZ reference | WZ 2008/2025 | `DISABLED_PENDING_LEGAL_REVIEW` | UNKNOWN | Individual official register research is available, but no approved reusable entity/activity API or bulk-reuse basis was verified. | 0 |
| Italy | Registro Imprese / InfoCamere; ISTAT ATECO | ATECO 2025 | `DISABLED_PENDING_LEGAL_REVIEW` | PAID | Official company APIs are contracted commercial services. No paid dependency is authorized. | 0 |
| Spain | Registro Mercantil / INE DIRCE | CNAE 2009/2025 | `UNAVAILABLE` | UNKNOWN | INE publishes statistics and protected/anonymous microdata, not a verified reusable legal-entity activity endpoint. | 0 |
| Netherlands | KVK HVDS Open Dataset | SBI 2008 | `DISABLED_PENDING_LEGAL_REVIEW` | FREE | CC BY 4.0, but the dataset omits identity fields and prohibits enrichment that can make data traceable to a person. TED-to-KVK identity linking is not approved. | 0 |
| Belgium | CBE/KBO Open Data | NACE-BEL 2008/2025 | `DISABLED_PENDING_LEGAL_REVIEW` | FREE snapshot | Registration and a declared purpose are required; licence restricts personal data direct marketing and use outside the declared purpose. | 0 |
| Poland | Ministry of Justice KRS Open API | PKD 2007/2025 | `PARTIAL` | FREE | Official open-data/reuse basis. Runtime is limited to an explicit public `KRS:` identifier; there is no name search and no tax-ID guessing. | max 1/run |

Only France, Norway, and the bounded Polish KRS lookup are included in the executable adapter list. Disabled/unavailable providers are metadata only and cannot issue a request.

## Official source and licensing record

### France

- Owner: French State / DINUM.
- Documentation: <https://recherche-entreprises.api.gouv.fr/docs/>.
- Access: open HTTPS JSON API; no authentication.
- Published limit: up to 7 requests/second/IP and 30/second/ASN, with `Retry-After` on 429. MedicHall is intentionally lower: two sequential activity searches/run.
- Licence: API documentation declares MIT; underlying results are public administrative company data. Non-diffusible entities are unavailable.
- Runtime rule: request only active entities, require `nom_raison_sociale`, ignore `nom_complet` and all officer/contact branches, cache 90 days.
- Remaining question: underlying datasets may have their own attribution terms; the deployment operator should retain source attribution.

### Norway

- Owner: Brønnøysund Register Centre.
- Documentation: <https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html>.
- Access: open HTTPS JSON API; no authentication.
- Licence: Norwegian Licence for Open Government Data (NLOD) 2.0.
- Runtime rule: one sequential current SN2025 activity search/run, exclude organization form `ENK`, never call role/person endpoints, cache 90 days. Official Statistics Norway correspondence retains `46.460` from SN2007 to SN2025; the current API title is the SN2025 medical-goods wording.
- Published provider limit: no numeric search limit was located in the reviewed endpoint documentation; MedicHall therefore applies the conservative one-request/run cap.

### Germany

- Owner: German Federal Ministry of Justice register platform, operated through the Unternehmensregister; WZ classifications by Destatis.
- Register: <https://www.unternehmensregister.de/en>.
- Cost information: <https://www.unternehmensregister.de/en/howto/costs>.
- WZ reference: <https://www.destatis.de/DE/Methoden/Klassifikationen/Gueter-Wirtschaftsklassifikationen/klassifikation-wz-2008.html>.
- Access: public interactive individual-company research; account/terms apply to some use and documents. No authorized reusable entity/activity API was verified.
- Classification signal reviewed: WZ 2008 `46.46.2`, medical/orthopaedic articles and dental/laboratory supplies.
- Decision: no scraping, browser automation, CAPTCHA bypass, or bulk reuse. Metadata and reviewed normalization exist; runtime remains disabled pending a documented legal and technical access route.

### Italy

- Owners: Italian Chambers of Commerce / InfoCamere; ATECO by ISTAT.
- Registry API information: <https://accessoallebanchedati.registroimprese.it/abdo/api>.
- ATECO: <https://www.istat.it/classificazione/ateco-2025/>.
- Official explanatory classification: <https://www.istat.it/wp-content/uploads/2025/03/Note-esplicative-ATECO-2025-italiano.pdf>.
- Access: official entity APIs require a commercial relationship/contract. A free interactive lookup does not establish reusable automated API rights.
- Classification signal reviewed: ATECO 2025 `46.46.39`, wholesale of other medical and orthopaedic products, including medical/surgical instruments and hospital equipment.
- Decision: normalization is ready, but no runtime adapter or paid call is enabled without explicit approval and contract review.

### Spain

- Owners: Registro Mercantil for company records; Instituto Nacional de Estadística (INE) for DIRCE/CNAE.
- CNAE classification: <https://www.ine.es/dyngs/INEbase/en/operacion.htm?c=Estadistica_C&cid=1254736177032&idp=1254735976614&menu=resultados>.
- DIRCE/business statistics: <https://www.ine.es/dyngs/INEbase/es/operacion.htm?c=Estadistica_C&cid=1254736160707&idp=1254735576550>.
- Access/reuse finding: the reviewed INE material describes aggregate or anonymized statistical output and confidentiality controls, not a reusable entity-level company activity API.
- Classification signal reviewed: CNAE 2009 `46.46`, wholesale of pharmaceutical goods, including medical/surgical/orthopaedic instruments at the corresponding product-service level.
- Decision: status `UNAVAILABLE`; no unofficial mirror or scraped register is substituted.

### Netherlands

- Owner: Kamer van Koophandel (KVK).
- Documentation: <https://developers.kvk.nl/en/documentation/open-dataset-basis-bedrijfsgegevens-api>.
- Access: public API by an already-known eight-digit KVK number; BV/NV only. The dataset exposes activity/SBI fields but intentionally omits name, KVK number, and most address data from its response.
- Licence/cost: free, CC BY 4.0; one request/IP/minute and a global 100 requests/five minutes.
- Restriction: the official terms prohibit enriching the dataset so data can be traced to an individual person.
- Classification signals reviewed: SBI 2008 `46461` (pharmaceutical wholesale) and `46462` (medical/dental instruments, nursing, orthopaedic and laboratory supplies).
- Decision: runtime remains disabled because linking omitted identity fields back to a named TED company needs legal approval. No paid KVK subscription is introduced.

### Belgium

- Owner: Belgian FPS Economy, Crossroads Bank for Enterprises (CBE/KBO).
- Access page: <https://kbopub.economie.fgov.be/kbo-open-data/login?lang=en>.
- Licence: <https://economie.fgov.be/sites/default/files/Files/Entreprises/BCE/Licence-BCE-Open-Data-Conditions-d-utilisation.pdf>.
- Access/cost: free active-entity Open Data files after registration; paid Public Search Web Services are a separate product. The open file is a licensed snapshot, not a live unauthenticated search API.
- Restrictions: reuse must match the purpose declared at registration; personal data cannot be used for direct marketing. Natural-person entities must be excluded.
- Classification signal reviewed: NACE-BEL `46.460`, wholesale of pharmaceutical and medical goods; NACE-BEL 2025 entered into force in 2025.
- Decision: runtime disabled until MedicHall's exact purpose, retention, attribution, and marketing classification have written approval.

### Poland

- Owner: Polish Ministry of Justice.
- Official announcement: <https://www.gov.pl/web/sprawiedliwosc/uruchomienie-otwartego-api-krajowego-rejestru-sadowego>.
- API portal: <https://prs.ms.gov.pl/krs/openApi>.
- Access: open HTTPS JSON lookup by a known KRS number; no authentication. The reviewed API did not support company-name lookup.
- Legal basis: Polish open-data and public-sector information reuse law, with the published KRS scope accounting for GDPR.
- Classification: official Statistics Poland PKD 2007/2025 correspondence: <https://stat.gov.pl/Klasyfikacje/doc/pkd_nowelizacja/pdf/klucze_powiazan_PKD_2007_PKD_2025.pdf>.
- Signal reviewed: PKD `46.46.Z`, wholesale of pharmaceutical and medical goods, retained 1:1 in PKD 2025.
- Runtime rule: accept only a typed `KRS:` plus ten digits from an existing public procurement seed, one lookup/run, parse only legal entity header, city, and activity branches, cache 180 days. Never read officers, shareholders, employees, email, phone, or role branches.
- Limitation: TED commonly provides other national identifiers rather than KRS. MedicHall does not guess or transform NIP/REGON into KRS, so coverage is intentionally partial.

## Normalized adapter contract

All executing adapters emit one country-independent DTO:

- provider and country;
- registry identifier and source reference;
- company name and legal name;
- active/inactive/unknown status;
- city/region only (not a personal or full contact address);
- national activity code/system/description;
- reviewed normalized NACE code where defensible;
- normalized activity family, signal strength, mapping confidence;
- source URL, verification timestamp, and provider confidence.

Raw country payloads do not reach scoring or storage. Every cached object is reconstructed through the same allowlisted normalizer. Unknown properties are dropped.

## Activity and evidence behavior

Reviewed exact mappings use `HIGH` mapping confidence. An unreviewed or structurally ambiguous code does not inherit a precise NACE mapping. Broad words may remain weak context, but a broad code cannot become strong merely because its number resembles a medical class.

All registry activity remains `INDIRECT_COMMERCIAL_EVIDENCE` and `is_direct_product_evidence = false`. It can enrich company type and evidence quality. It does not prove the company currently sells the target product and does not inflate the existing 0–100 component caps.

A prospect can qualify without a product keyword on its website through multiple independent indirect sources—for example a relevant registry activity plus a related TED award. The explanation continues to state that exact current product availability is not claimed.

## Cache, rate and outage controls

- One service-only cache table is shared across providers; there is no table per country.
- Cache key: SHA-256 of provider plus request URL.
- Successful data TTL: source-aware 90 or 180 days. Failed source response TTL: one day.
- Cache stores normalized allowlisted DTOs, not raw responses.
- Cache rejects contact/person field names and is inaccessible to browser roles.
- Requests are sequential and provider capped. Poland is additionally delayed one second between permitted lookups; KVK remains disabled despite its one/minute published limit.
- A cached or live provider outage marks that provider unavailable and the discovery run `PARTIAL`; TED and website processing continue.
- Paid provider requests, AI classifications, email sends, and notifications remain zero.

## Privacy and tenancy

Global legal-company/activity evidence remains reusable internally. Company-specific score, reason, save/dismiss state, and notes remain tenant-scoped under the existing forced-RLS model. Official registry IDs continue to strengthen deduplication and the existing company-membership reconciliation avoids duplicate External Prospects.

The implementation collects zero email addresses, telephone/mobile numbers, named contacts, employees, directors, officers, shareholders, or social-profile URLs. France requires a legal-company name; Norway excludes ENK; Poland ignores all personnel branches. The schema adds no contact column.

## Bounded real-source QA evidence

Read-only source QA used `scripts/external-registry-source-qa.ts`; it did not connect to MedicHall production, persist data, mutate customer records, send email/notifications, or call an AI/paid provider.

| Country | Result | Redacted evidence |
|---|---|---|
| France | PASS | HTTP 200; 10 distinct named legal entities; `NAF/APE 46.46Z`; mapping `HIGH`; source host verified; 0 personal-contact fields. |
| Norway | PASS | HTTP 200; 10 distinct non-ENK legal entities; current `SN2025 46.460`; mapping `HIGH`; source host verified; 0 personal-contact fields. |
| Germany | BLOCKED AS DESIGNED | No entity request; runtime limit 0 pending legal/technical approval. Classification fixture passed. |
| Italy | BLOCKED AS DESIGNED | No paid entity request; runtime limit 0. Official ATECO mapping fixture passed. |
| Spain | UNAVAILABLE AS DESIGNED | No entity request because no reusable official entity endpoint was verified. CNAE mapping fixture passed. |
| Netherlands | BLOCKED AS DESIGNED | No identity-enrichment request; runtime limit 0 pending legal approval. SBI mapping fixtures passed. |
| Belgium | BLOCKED AS DESIGNED | No licensed snapshot downloaded; runtime limit 0 pending purpose/licence approval. NACE-BEL mapping fixtures passed. |
| Poland | PASS / PARTIAL | HTTP 200 for one explicit public KRS legal entity; one relevant `PKD 2007 46.46.Z` activity; mapping `HIGH`; source host verified; 0 personal-contact fields. |

Final adapter QA issued four free official-registry HTTP requests: France once, Norway twice (the second verified the current SN2025 mapping correction), and Poland once. Audit/schema research before final QA issued six additional bounded public TED/KRS requests. Total public-source audit and QA requests: 10. Paid requests: 0. AI requests: 0. Emails: 0. Notifications: 0.

## Validation evidence

- Full local `supabase db reset`: PASS; all 57 canonical migrations replayed through `202608200004`.
- New rollback-only registry cache/RLS/privacy SQL: PASS.
- Existing rollback-only External Prospect tenant isolation, idempotency, deduplication, registered-company promotion, and admin access SQL: PASS.
- Deno unit/boundary tests: 21 passed, 0 failed, including registry-ID merging across alternate legal/trading names.
- Edge Function Deno typecheck: PASS.
- Deno lint and format check: PASS.
- External Prospect static contract: PASS.
- Migration sequencing: PASS; 57 canonical migrations, three immutable archived migrations, exactly one planned target (`202608200004`).
- Phase 0 repository readiness: PASS.
- Unrelated safety regression contracts: final beta security, Contact Privacy, TED access hotfix, Traffic Analytics, production auth recovery, and matchmaking retry remediation all exited 0.
- Working-tree credential scan: PASS; 929 text files, no credential literals.
- `git diff --check`: PASS.
- Local database lint: no finding in the new registry objects. Four pre-existing warnings remain in `recover_stale_tender_document_analysis_jobs` and `get_tender_opportunity_intelligence_v1`; they are outside this task and were not changed.
- Vitest/React and ESLint: not applicable because no React, browser JavaScript, or frontend file changed; Deno lint covers the changed TypeScript.

## Deployment plan (not executed)

1. Confirm production migration dry run proposes only `202608200004_external_registry_coverage.sql`.
2. Take the repository-required restricted production database backup.
3. Apply only that migration to `azdmuarzntzqdyirysux`.
4. Run `supabase/tests/external_registry_coverage.sql` in its rollback-only transaction.
5. Deploy only `external-prospect-discovery` from the verified source package.
6. Verify OPTIONS 204, unauthenticated POST 401, owner/admin execution, cross-tenant denial, cache RLS, zero contacts, and zero emails/notifications/AI/provider cost.
7. Run one bounded authenticated production discovery for an isolated QA company, then delete only its QA records and confirm no orphans.

No frontend or cPanel upload is required. Germany, Italy, Spain, Netherlands, and Belgium must remain non-executing until their documented blockers are resolved.

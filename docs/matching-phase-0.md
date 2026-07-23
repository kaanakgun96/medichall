# MedicHall matching Phase 0

## 1. Phase 0 overview

Phase 0 establishes an evidence baseline for the existing tender and matching
pipeline. It adds version identifiers, run and stage traces, document-access
classification, health views, staleness detection, and a human benchmark
schema. It does **not** change matching weights, candidate rules, score
interpretation, the document-extraction prompt, or the production HTML portal.

The repository audit documents remain the source for the pre-remediation
behavior:

- `docs/matching-engine-audit.md`
- `docs/matching-engine-data-flow.md`
- `docs/matching-engine-scorecard.md`

The implementation is additive in
`supabase/migrations/202607230001_matching_phase_zero_observability.sql`.
Observability writes are intentionally best-effort: a diagnostic write failure
is sanitized and logged, but it does not replace the existing business
operation.

## 2. Current live-access status

Live Supabase access is intentionally outside this repository-readiness task.
No project was linked and no access token, project reference, database URL, or
secret value was used. Therefore:

- no live schema, function, RPC, cron, bucket, RLS, or Edge Function definition
  was exported;
- no repository definition is labeled `verified_live`;
- no production data was read;
- no migration or function was deployed.

The authorized owner-run procedure is in
`docs/supabase-live-baseline.md`. Its output is structural only and is ignored
by Git.

Local repository validation now passes for the canonical Phase 0 sources. Run
`node scripts/check-phase0-readiness.mjs` before any staging preview. The
machine-readable deployment scope is
`supabase/observability/phase-zero-deployment.json`.

## 3. Canonical runtime inventory

This inventory distinguishes repository evidence from live proof. “Deployment
status” describes the repository candidate, not production. Confidence values
are limited to `verified_live`, `repository_only`, `conflicting`, and
`unknown`.

| Logical component | Repository path | SQL / RPC | Edge Function | Migration | Manual dependency | Version | Expected caller | Observed frontend caller | Deployment status | Live verification | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Tender ingestion | `supabase/functions/ted-sync/index.ts` | `refresh_tender_eur_values`, then `refresh_company_opportunity_matches` | `ted-sync` | tender/filter and matching migrations | Vault-backed `supabase/setup/CONFIGURE-CRON.sql` | `ted-sync-v1.5+phase0.1` | authorized cron or manual POST | none | canonical root candidate | not verified | `repository_only` |
| TED notice URL resolution | `supabase/functions/ted-notice-resolver/index.ts` | direct table reads/writes | `ted-notice-resolver` | `202607100008_tender_automation.sql` | none known | discovery version | authenticated partner request | no current React caller; not called by legacy `deepAnalyze` | repository candidate | not verified | `repository_only` |
| Attachment discovery | `supabase/functions/tender-attachment-discovery/index.ts` | `queue_tender_document_discovery`, `get_tender_document_discovery_status` | `tender-attachment-discovery` | `202607100007_tender_attachment_discovery.sql` | nested legacy source under `medichall-ai` is explicitly excluded | `document-discovery-v1+phase0.1` | authenticated partner request | no current React caller; not called by legacy `deepAnalyze` | canonical root candidate | not verified | `repository_only` |
| Document queueing | root document/discovery/archive Edge Functions | queue/status RPCs | three root functions | `202607100006`, `202607100007`, `202607100008` | none for standard queueing | component version inherited by job | authenticated company owner | legacy calls `tender-document-engine`; React has no document-analysis UI | repository candidate | not verified | `repository_only` |
| Archive and Office parsing | `supabase/functions/tender-archive-worker/index.ts` | `queue_tender_archive_jobs`, `get_tender_archive_status` | `tender-archive-worker` | `202607100008_tender_automation.sql` | nested legacy source under `medichall-ai` is explicitly excluded | `document-parsing-v1+phase0.1` | authenticated partner request | no current direct caller | canonical root candidate | not verified | `repository_only` |
| PDF/text document parsing | `supabase/functions/tender-document-engine/index.ts` | `queue_tender_document_analysis`, status RPC | `tender-document-engine` | `202607100006_tender_document_engine.sql` | nested legacy source under `medichall-ai` is explicitly excluded | `document-parsing-v1+phase0.1` | authenticated partner request | legacy `portal.html::deepAnalyze` | canonical root candidate | not verified | `repository_only` |
| AI extraction | `supabase/functions/tender-document-engine/index.ts` | writes jobs, tender extraction, evidence | `tender-document-engine` | document/explainable migrations | Anthropic runtime secret and model config | `tender-extraction-prompt-v1+phase0.1` | document engine | legacy deep-analysis flow | canonical root candidate | not verified | `repository_only` |
| Candidate generation and scoring | `202607200002_english_normalization.sql` | `refresh_company_opportunity_matches` | none | `202607200002_english_normalization.sql` | `supabase/setup/CPV-YAMA.sql` can replace the RPC | candidate `candidate-generation-202607200002`; score `matching-score-202607200002` | TED sync, partner refresh, explainable refresh | legacy and React opportunities refresh | multiple competing definitions | not verified | `conflicting` |
| Explainable matching | `202607100005_explainable_match_engine.sql` | `refresh_explainable_tender_matches` | invoked by document engine | `202607100005_explainable_match_engine.sql` | assumes active base refresh RPC | `explainable-match-202607100005` | document engine or authorized RPC | no direct React caller | repository candidate | not verified | `repository_only` |
| Opportunity storage | schema plus matching migrations | `public.opportunity_matches` | none | `202607100003` onward | later migrations add fields | schema lineage is recorded per row | matching RPCs | legacy and React query REST table | repository candidate | not verified | `repository_only` |
| Tender search | React tender API and legacy portal | `search_tenders` | none | latest: `202607200003_saved_searches.sql` | prior definitions in filter/normalization migrations | migration identifier | browser and digest function | legacy All Tenders, React `#/all-tenders` | several sequential definitions | not verified | `conflicting` |
| Profile refresh | legacy and React company-profile code | REST upsert to `company_match_profiles`; no refresh RPC | none | foundation schema | company row defaults and manual portal behavior | row `updated_at` snapshot | authenticated company owner | legacy and React profile forms | repository behavior only | not verified | `repository_only` |
| Scheduled execution | `supabase/setup/CONFIGURE-CRON.sql` | `cron.schedule`, `net.http_post`, Vault reads | calls `ted-sync` and `tender-digest` | outside migration chain by design | live Vault entries and Edge Function secret must be owner-configured | cron definition has no live proof | `pg_cron` | none | Vault-backed setup candidate | not verified | `unknown` |
| Frontend retrieval | legacy/React opportunity and dashboard APIs | PostgREST on `opportunity_matches`, `tenders`, company tables | none | RLS in existing migrations | legacy session bridge | not yet emitted as a backend stage | browser | both portals | observable only in browser today | not verified | `unknown` |

The root and `supabase/functions/medichall-ai/*` document implementations are
not assumed to be aliases. For Phase 0, the repository deployment manifest
selects only the five root entrypoints and explicitly excludes the nested
legacy tree. The deployed live source still must be captured before a staging
change, but the repository deployment input is no longer ambiguous.

## 4. Versioning strategy

`pipeline_versions` records one repository-current definition for each major
component. Every record has an explicit identifier, a SHA-256 content hash,
source or migration path, semantic version where useful, live verification
state, and metadata describing ambiguity. The same reviewable repository
mapping is stored in `supabase/observability/pipeline-versions.json`.

Lineage is additive:

- tenders record ingestion/discovery/parser/AI versions and associated trace
  IDs;
- documents record retrieval/parser versions, access state, confidence, and
  trace ID;
- analysis and archive jobs record the versions that executed;
- opportunity matches record candidate, scoring, and explanation versions,
  snapshots, and traces.

Existing historical rows remain null rather than being falsely stamped with
the new version. New metadata stamping RPCs run only after the existing refresh
RPC succeeds. Hashes identify repository content; they do not prove live
deployment.

## 5. Trace architecture

`pipeline_runs` is the run envelope. `pipeline_run_stages` stores stage-level
events. IDs are UUIDs and a database trigger prevents a stage from naming a
parent in another trace. The model supports parent traces for future
cross-function correlation without requiring that all existing calls already
propagate one.

Instrumented repository paths now emit stages where they actually execute:

- TED source fetch, ingestion, tender update, and candidate/score/upsert
  combined RPC;
- notice resolution and attachment discovery;
- document access and download;
- archive extraction and parsing;
- OCR eligibility (`skipped`, because OCR is not implemented);
- AI extraction and structured validation;
- explanation generation and existing combined refresh/upsert behavior.

Combined SQL RPCs are represented as one stage with
`metadata.combined_rpc_stages`; Phase 0 does not split or rewrite those RPCs.
Frontend retrieval is not yet posted to a diagnostic endpoint because exposing
a new public write endpoint would expand the attack surface.

Recorded fields include trace, stage and optional parent IDs; tender, company
and document IDs; source; status; timestamps and duration; pipeline version;
attempt; machine-readable error category; sanitized message; and bounded JSON
metadata.

Never place authorization headers, cookies, tokens, passwords, user email
addresses, company-private content, document contents, or full AI prompts in
trace metadata.

## 6. Document-access classification

The full controlled vocabulary is stored in `document_access_statuses`:

`no_document_link_found`, `public_direct_download`, `public_detail_page`,
`redirect_required`, `session_required`, `login_required`,
`membership_required`, `paid_access_required`, `captcha_required`,
`terms_acceptance_required`, `dynamic_javascript_required`,
`access_forbidden`, `rate_limited`, `expired_link`, `broken_link`,
`unsupported_file_type`, `file_too_large`, `download_timeout`,
`archive_processing_required`, `manual_review_required`, `downloaded`,
`parsed`, and `parsing_failed`.

Each status maps to one access class:

- `public`;
- `publicly_accessible_but_unsupported`;
- `restricted`;
- `manual`;
- `technical_failure`;
- `processed`.

`document_access_attempts` records a sanitized URL without query parameters or
credentials, portal domain, source type, source confidence, HTTP metadata,
attempt and duration, status, class, error category, and trace linkage.

## 7. CAPTCHA/login/membership handling policy

CAPTCHA, authentication, membership, paid access, session, terms acceptance,
and explicit access-forbidden results are restricted states, never generic
engineering failures. The discovery function records the restriction and
stops automated traversal of that path. It does not solve a CAPTCHA, create an
account, supply credentials, reuse a private session, accept terms, or bypass a
paywall or anti-bot system.

Lawful fallbacks are limited to official TED metadata/notice content, official
public authority pages and APIs, verified openly available publications, and
documents already uploaded by an authorized person. Source confidence is
always retained. See `docs/document-access-policy.md`.

## 8. Manual document-upload workflow

Phase 0 provides provenance fields but does not add a new UI or weaken storage
rules. The intended future flow is:

1. show an authorized company user the sanitized original portal URL and exact
   restriction status;
2. require the person to obtain the document lawfully outside MedicHall;
3. upload through a tenant-authorized storage policy;
4. validate tender/company ownership, MIME type, count, size, and storage path;
5. create or update `tender_documents` with `source_confidence =
   'authorized_upload'`, `uploaded_by`, `uploaded_at`, and bounded
   `upload_provenance`;
6. enqueue the existing parser and AI path with a new trace;
7. retain the restricted access attempt as history rather than overwriting it.

The repository contains a manual patch,
`supabase/setup/DOKUMAN-YUKLEME.sql`, and a legacy upload UI, but the patch
conflicts with the migration-defined `document_type` constraint and the
bucket is configured for public reads. Those facts require live verification
and a separate security-compatible migration before this workflow can be
declared production-ready.

## 9. Error taxonomy

`pipeline_error_categories` contains:

`network`, `timeout`, `redirect`, `authentication`, `authorization`,
`captcha`, `membership`, `payment`, `terms_acceptance`, `dynamic_page`,
`malformed_url`, `unavailable_resource`, `unsupported_format`,
`archive_error`, `parser_error`, `ocr_needed`, `ai_provider`,
`ai_response_validation`, `database`, `scoring`, `stale_data`,
`configuration`, and `unknown`.

Code stores the category separately from a bounded sanitized message. Secret
keys in metadata are redacted recursively; bearer tokens, JWTs, common token
prefixes, query secrets, and email addresses are removed from messages.
Normal HTTP responses no longer include stack traces in the instrumented
functions.

## 10. Health metrics

`pipeline_health_daily` reports daily stage counts, completed/partial/failed
counts, restricted/manual counts, success percentage, and average duration by
source, stage, and version. `document_access_health_daily` reports attempts,
public retrieval success, restricted/CAPTCHA/login/membership/manual counts,
technical failures, separate access rates, and average duration by source and
portal domain.

Reporting rules:

- ingestion success: completed `tender_ingestion` stages / ingestion stages;
- duplicate rate: `(fetched_count - inserted_count) / fetched_count` only after
  insertion-versus-update counts are instrumented; current upsert metadata
  cannot distinguish them and must be shown as unavailable, not guessed;
- link discovery: completed/partial discovery stages with documents found /
  discovery stages;
- public retrieval success: `downloaded` or `parsed` attempts on
  `document_download` stages divided only by non-restricted download attempts;
- restricted rate: restricted attempts / all attempts;
- technical failure rate: technical failures / non-restricted attempts;
- parsing and AI success: completed corresponding stages / attempted stages;
- validation failure: failed validation stages / validation stages;
- match refresh success: completed candidate-generation combined RPC stages /
  attempted stages;
- stale-match rate: stale rows / all rows in
  `opportunity_match_staleness`;
- failures by source/domain/category: group the stage or access tables by the
  respective columns and `error_category`;
- average duration: average non-null `duration_ms` for the chosen stage and
  version.

Restricted access is excluded from the technical-failure denominator.

## 11. Benchmark data model

`benchmark_cases` stores a versioned tender/company pair, immutable snapshot
identifiers, document availability, optional final label and expected score
range, eligibility dimensions, human explanation, engine score/version,
false-positive/negative flags, review state, notes, and adjudicator.

`benchmark_annotations` stores one annotation per case and annotator with the
same relevance dimensions. The database requires distinct annotators, and
`adjudicate_benchmark_case` refuses adjudication until at least two independent
annotators exist. Only an admin can manage or adjudicate cases. No production
labels are seeded; the CSV fixture contains a header only.

Allowed labels are exactly `highly_relevant`, `potentially_relevant`, and
`irrelevant`.

## 12. Benchmark sampling process

Start with 30–50 cases, freeze the tender/profile snapshots, and deliberately
stratify the sample. Include exact products, synonyms, same-category wrong
products, CPV/product disagreements, pharmaceutical/service/construction and
unrelated hospital tenders, expired notices, every document restriction,
missing/scanned/multilingual/archive documents, mixed lots, certificate and
country conflicts, manufacturer/distributor-only conditions, incompatible
dimensions, and generic consumable wording.

Do not choose only current high-scoring matches. Include retrieved matches and
negative controls from the all-tenders feed. Keep annotators blind to the
engine score until their labels are saved. Two people label independently; an
admin adjudicates disagreements with a short evidence-based explanation.

Detailed non-technical instructions are in
`docs/benchmark-labeling-guide.md`.

## 13. Human labeling guide

Ali should answer one question: “Could this company realistically supply what
this tender asks for?” Product fit comes first. Country, certificates,
commercial role, technical dimensions, and document uncertainty modify that
answer. An exact CPV alone is never enough.

- `highly_relevant`: clear product fit and no known blocking requirement;
- `potentially_relevant`: plausible fit, but important evidence is missing or a
  resolvable condition remains;
- `irrelevant`: wrong product/service or a clear blocking condition.

Unknown means “not enough evidence,” not “yes.” Missing documents should reduce
certainty, not automatically make a case irrelevant.

## 14. Staleness model

`opportunity_match_staleness` detects, but does not recompute, stale results.
Reasons cover:

- company row changes;
- matching profile changes, including CPVs, target countries, certificates,
  and keywords;
- company product changes;
- tender changes;
- newer document analysis/upload/reparse;
- missing or changed scoring version;
- missing or changed explanation version.

Snapshot timestamps and versions are stamped only after the current refresh
functions run successfully. Existing unstamped rows are correctly reported as
stale. AI extraction version is stored on the tender/job, and document parser
versions on the tender/document/job. No trigger launches a bulk refresh.

## 15. Security considerations

- Service-role credentials remain Edge-only and are never returned to the
  browser.
- New trace and taxonomy tables have RLS enabled; authenticated reads are
  admin-only and writes use service role.
- Benchmark writes are admin-only, and adjudication requires two annotators.
- Diagnostic views are granted only to service role.
- Trace helpers sanitize structured metadata and messages.
- URLs lose credentials, query strings, and fragments before storage.
- No full prompts or document content are logged.
- The discovered hard-coded cron credential was removed from the repository.
  It must be rotated in Supabase and in the live cron job because Git history
  cannot make an exposed credential safe.
- Live storage/RLS could not be verified. Repository SQL makes the
  `tender-documents` bucket public-read, and the upload RPC is only in a manual
  patch. Treat uploaded documents as potentially public until the owner proves
  otherwise. Do not upload private procurement material before that review.
- Existing tenant RLS was not weakened or replaced.

## 16. Deployment steps

No deployment was performed. Staging order:

1. run `node scripts/check-phase0-readiness.mjs`;
2. run `deno check --frozen` for the shared module and five root entrypoints,
   then
   `deno test --frozen supabase/functions/_shared/matching-observability.test.ts`;
3. revoke and rotate the exposed cron secret through an authorized secret
   channel; do not commit or print the value;
4. run the owner baseline export and compare live objects;
5. compare the deployed function inventory with the root entrypoints listed in
   `supabase/observability/phase-zero-deployment.json`;
6. preview migration history and stop unless the only intended new database
   change is `202607230001_matching_phase_zero_observability.sql`;
7. back up the staging database and test migration rollback;
8. apply that migration to staging;
9. deploy only the five manifest-listed **root** Edge Functions to staging;
10. run one controlled ingestion, one public document, one restricted
    document, one archive, and one notice-only analysis;
11. verify trace relationships, sanitization, RLS, status classification, and
    unchanged scores;
12. capture before/after RPC definitions and representative score rows;
13. obtain explicit production approval in a separate task.

The migration must precede the Edge functions so trace tables and stamping RPCs
exist. Although trace helpers fail safely, version columns on business writes
require the migration.

## 17. Rollback steps

Preferred rollback is application-first:

1. redeploy the previously captured Edge Function versions;
2. stop new Phase 0 trace writes;
3. preserve trace and benchmark data for incident analysis;
4. restore only affected functions from the verified live baseline if a
   compatibility conflict occurred.

The database change is additive. If full schema rollback is approved, first
export Phase 0 tables, then drop the four reporting views, three Phase 0 RPCs,
triggers, new benchmark/trace/taxonomy tables, and added columns in reverse
dependency order. Dropping columns destroys lineage and must not be the default
rollback. Never roll back by resetting `develop`, rewriting migrations, or
deleting production data.

## 18. Known limitations

- No live deployment state is verified.
- Nested `medichall-ai` copies remain as legacy references, but are excluded
  from the Phase 0 deployment manifest.
- Candidate/scoring RPC definitions conflict across migrations/manual setup.
- Active legacy deep analysis still skips discovery and archive functions.
- Frontend retrieval is not traced.
- OCR is only classified as not implemented.
- The AI extraction output receives shape/bounds checks, not evidence
  verification.
- Document-level AI fields remain stored on a shared tender although the
  prompt can include one company context; Phase 0 only records this lineage.
- Public bucket and manual upload compatibility require a separate review.
- Duplicate-rate measurement needs insert/update differentiation.
- No benchmark cases have been labeled.
- Historical unversioned rows are intentionally stale.
- The full migration chain and SQL assertions still require an isolated
  Supabase/PostgreSQL environment with project extensions; repository checks
  cannot replace that staging gate.

## 19. Repository readiness status

The repository-side Phase 0 blockers are resolved:

- migration versions are unique;
- the historical scoring migration is consolidated without changing its SQL;
- project-specific cron literals are removed from active SQL;
- Vault-backed cron configuration is separate from schema migration;
- Supabase client imports are pinned;
- Deno configuration and transitive dependencies are locked;
- the Edge Runtime declaration is explicit;
- all five canonical root functions pass Deno type checking;
- source hashes and the deployment manifest are machine-verified.

The next step is an authorized **staging-only** baseline and migration preview.
That is an environment gate, not permission to deploy. Reconcile the live RPC,
Edge Function, cron, storage, and RLS definitions before any change. Do not
change weights until the active live scoring definition is proven and the
first benchmark is adjudicated.

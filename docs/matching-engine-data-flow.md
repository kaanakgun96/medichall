# MedicHall matching-engine data flow

This diagram is based on the repository implementation on `react-migration` at
commit `735b8eaa44723c5d0d7507fe9bea153a4df23db0`. It describes code paths, not an
assumption that every manually installed SQL patch is present in production.

```mermaid
flowchart TD
    subgraph Sources["Tender sources"]
        TED["TED Search API v3"]
        TEDPDF["Official TED notice PDF"]
        PORTAL["National procurement portals"]
        UPLOAD["Partner-uploaded PDFs"]
        DEMO["Manual SQL/demo seed"]
    end

    subgraph Ingestion["Discovery and ingestion"]
        CRON["pg_cron: medichall-ted-sync<br/>daily 06:30 UTC"]
        SYNC["ted-sync Edge Function<br/>CPV/date query, map, upsert"]
        TENDERS[("public.tenders")]
        TRANSLATE["Anthropic translation batch<br/>title_en / description_en"]
        FX["ECB FX feed<br/>refresh_tender_eur_values"]
    end

    subgraph Retrieval["Optional document retrieval"]
        RESOLVE["ted-notice-resolver<br/>rank URLs from TED API"]
        DISCOVER["tender-attachment-discovery<br/>static HTML/XML crawl"]
        DOCS[("public.tender_documents")]
        ARCHIVE["tender-archive-worker<br/>ZIP, XLS/XLSX, DOCX conversion"]
        STORAGE[("public tender-documents bucket")]
    end

    subgraph Extraction["Document parsing and AI extraction"]
        QUEUE["queue_tender_document_analysis"]
        ENGINE["tender-document-engine<br/>up to 6 PDF/CSV/TXT inputs"]
        NOTICE["Notice-only fallback<br/>TED PDF + Search API + raw payload"]
        CLAUDE["Anthropic Messages API<br/>document extraction prompt"]
        JOBS[("tender_document_analysis_jobs")]
        EVIDENCE[("tender_document_evidence")]
        EXTRACTED["tenders.extracted_products<br/>ai_lots, confidence, completeness"]
    end

    subgraph Profiles["Company inputs"]
        COMPANY[("public.companies")]
        PRODUCTS[("public.products")]
        PROFILE[("public.company_match_profiles")]
    end

    subgraph Matching["Candidate generation and scoring"]
        REFRESH["refresh_company_opportunity_matches"]
        HELPERS["keyword_text_score<br/>country_match_score<br/>array_overlap_score"]
        EXPLAIN["refresh_explainable_tender_matches"]
        MATCHES[("public.opportunity_matches")]
    end

    subgraph Presentation["Presentation and workflow"]
        LEGACY["portal.html<br/>match_score + deep-analysis panel"]
        REACT["apps/portal-react<br/>opportunity_score + breakdown"]
        AIHELPER["medichall-ai<br/>free-form advisory text"]
    end

    CRON --> SYNC
    TED --> SYNC
    SYNC --> TENDERS
    SYNC --> TRANSLATE
    TRANSLATE --> TENDERS
    SYNC --> FX
    FX --> TENDERS
    DEMO --> TENDERS

    TENDERS -. "manual/previous portal path" .-> RESOLVE
    TED --> RESOLVE
    RESOLVE --> TENDERS
    TENDERS -. "manual/previous portal path" .-> DISCOVER
    PORTAL --> DISCOVER
    DISCOVER --> DOCS
    DOCS -. "ZIP jobs" .-> ARCHIVE
    PORTAL --> ARCHIVE
    ARCHIVE --> STORAGE
    STORAGE --> DOCS
    UPLOAD -. "manual setup RPC" .-> STORAGE
    STORAGE -.-> DOCS

    TENDERS --> QUEUE
    DOCS --> QUEUE
    QUEUE --> JOBS
    QUEUE --> ENGINE
    DOCS --> ENGINE
    TEDPDF --> NOTICE
    TED --> NOTICE
    TENDERS --> NOTICE
    NOTICE --> ENGINE
    ENGINE --> CLAUDE
    CLAUDE --> EXTRACTED
    CLAUDE --> EVIDENCE
    ENGINE --> JOBS

    COMPANY --> PROFILE
    PRODUCTS -. "readiness only; not deterministic tender scoring" .-> REFRESH
    PROFILE --> REFRESH
    TENDERS --> REFRESH
    HELPERS --> REFRESH
    REFRESH --> MATCHES
    EXTRACTED --> EXPLAIN
    REFRESH --> EXPLAIN
    EXPLAIN --> MATCHES

    MATCHES --> LEGACY
    MATCHES --> REACT
    TENDERS --> LEGACY
    TENDERS --> REACT
    LEGACY -. "user-requested prose; not stored score" .-> AIHELPER
```

## Important runtime distinction

The current `portal.html` function `deepAnalyze` does **not** invoke
`ted-notice-resolver`, `tender-attachment-discovery`, or
`tender-archive-worker`. It queues `tender-document-engine` directly. The
resolver/crawler/archive path exists in the repository and is described in
older automation documentation, but the active click path intentionally calls
the engine first and falls back to the TED notice when no registered supported
document is available.

This distinction is central to the reported failure mode: a procurement page
can contain an openly downloadable specification while the active application
never crawls that page.

## Persisted boundaries

| Boundary | Persisted data | Current consumer |
|---|---|---|
| TED ingestion | `tenders`, `raw_payload`, translation fields, normalized CPV/value fields | search, base matcher, document fallback |
| Retrieval | `tender_documents`, discovery/archive job tables, storage objects | document analysis queue |
| Extraction | tender-level extracted products/lots/status plus job-scoped evidence | explainable refresh and legacy deep-analysis panel |
| Company profile | company row and `company_match_profiles` | base matcher; partial company context in Claude prompt |
| Matching | `opportunity_matches` base, explainable, confidence, reason, risk, and workflow fields | legacy and React portals |

## Non-implemented arrows

The repository contains no production path for:

- embeddings or vector similarity;
- synonym dictionaries, stemming, or medical terminology normalization;
- deterministic comparison of `public.products` to extracted tender products;
- OCR orchestration or an image parser;
- event-triggered rescoring on company/profile/product changes;
- event-triggered document discovery during TED ingestion;
- deterministic validation that an AI evidence quote occurs in the source
  document.

Those omissions are intentionally shown as absent rather than inferred.

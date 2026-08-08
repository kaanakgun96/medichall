# Universal Tender Import production QA — 2026-08-08

Project: `azdmuarzntzqdyirysux`

Branch: `react-migration`

QA marker: `s21importqa…k7m4` (redacted)

Result: **passed and cleaned**

## Provider-backed acceptance results

All cases used tiny synthetic/non-customer content except the official public
TED notice. They ran sequentially with the existing Document Intelligence v3.1
limits unchanged.

| Case | Terminal state | Documents | Evidence rows | AI requests | Input tokens | Output tokens | Estimated cost (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|
| PDF | completed | 1 | 1 | 1 | 3,199 | 1,551 | 0.032862 |
| DOCX | completed | 1 | 3 | 1 | 893 | 1,935 | 0.031704 |
| XLSX | completed | 1 | 3 | 1 | 903 | 1,840 | 0.030309 |
| CSV | completed | 1 | 3 | 1 | 888 | 1,446 | 0.024354 |
| ZIP containing CSV | completed | 2 | 3 | 1 | 888 | 1,722 | 0.028494 |
| Mixed PDF + CSV submission | completed | 2 | 4 | 2 | 4,088 | 3,100 | 0.058764 |
| Official TED HTTPS PDF URL | completed | 1 | 2 | 4 | 14,554 | 4,428 | 0.110082 |
| **Total** | 7 completed | 9 | 19 | **11** | **25,413** | **16,022** | **0.316569** |

Total tokens were **41,435**. Chunk-level and job-level request, token, and
cost totals matched exactly. Eleven non-null provider request identifiers were
recorded and all eleven were distinct; identifiers are intentionally omitted.

Synthetic facts were plausible in every file case: the extracted records and
cited evidence contained the medical product, quantity, buyer, CPV, deadline,
and certification. The official URL resolved end-to-end from
`https://ted.europa.eu/en/notice/280340-2026/pdf`; its extraction cited the
full-body plethysmography procurement content.

## Focused production correction

The first DOCX attempt stopped before an AI request because Mammoth's Node
runtime rejects the browser-only `arrayBuffer` option. The engine now supplies
a Node `Buffer`, with a real minimal-DOCX regression test. Only
`tender-document-engine` was redeployed, advancing it from version 27 to 28.
The same DOCX import was retried and completed with one provider call, proving
the failed pre-parser attempt was not resent to the provider.

Two XLSX failures were confined to QA fixture generation and occurred before AI
usage: the first fixture uploaded as zero bytes, and SheetJS's generated content
types advertised a macro-enabled binary default that the production validator
correctly rejected. Each exact failed fixture/import was removed. A minimal
macro-free OpenXML workbook then completed successfully. The mixed-case
plausibility warning was an immediate-read timing issue; an eventual-consistent
read exposed all expected facts and required no retry or provider call.

## Idempotency and isolation

- An active PDF retry returned `202`; `attempt_count` did not change.
- Recreating the completed mixed submission returned the same import with
  `replayed=true`.
- Starting that completed import returned `200`; `attempt_count` and
  `updated_at` did not change.
- Request, token, and cost totals were unchanged by both operations.
- Company A and Company B could read their own imports.
- Cross-company import RPC reads returned `403` in both directions.
- Cross-company private object reads returned `400` in both directions.
- A cross-company coordinator status call returned `404`.
- Anonymous mutation and unauthenticated function denial remained covered by
  the SQL and endpoint regressions.

## Cleanup evidence

Before cleanup, the isolated QA graph contained:

- 2 Auth users, 2 identities, 14 sessions, and 14 refresh tokens;
- 2 companies, 7 imports, 7 tenders, and 9 documents;
- 1 discovery job, 1 archive job, 8 analysis jobs, 11 chunks, 62 progress
  events, 19 evidence rows, 3 inspections, and 8 zero-hit cache rows;
- 2 access attempts, 11 pipeline stages, 10 pipeline runs, 9 lot matches, and
  8 portal notifications; and
- 8 private Storage objects.

Dependency-ordered cleanup removed only the explicit QA IDs and marker. Every
listed QA count is now zero, including cache/pipeline metadata and Storage.
Non-QA totals returned exactly to their recorded baselines: 3,035 tenders,
6 companies, 6 Auth users, 1 tender document, 59 analysis jobs, 64 chunks,
55 notifications, and 75 Storage objects.

The redacted machine-readable evidence artifact is 4,909 bytes with SHA-256
`942b9ef0e58045f1c391f89fbaf67044f47233f5fd0ed77eb79b4c281463af34`.

## Deployed tender-function versions after QA

| Function | Version | JWT mode |
|---|---:|---|
| `tender-attachment-discovery` | 9 | platform JWT verification enabled |
| `tender-archive-worker` | 8 | platform JWT verification enabled |
| `tender-document-engine` | 28 | custom authenticated handler verification |
| `tender-import` | 1 | custom authenticated handler verification |

No provider credential, AI cost limit, unrelated Edge Function, unrelated
migration, or customer record was changed during this QA pass.

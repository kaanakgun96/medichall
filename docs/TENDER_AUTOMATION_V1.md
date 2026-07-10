# MedicHall Tender Automation v1

## What becomes automatic

For a TED tender, the portal now runs:

1. Resolve the TED notice through the official Search API.
2. Extract and save the best BT-15/procurement-document URL.
3. Crawl the public procurement page and register attachments.
4. Detect ZIP archives.
5. Safely extract ZIP contents.
6. Convert XLS/XLSX sheets to CSV.
7. Convert DOCX to text.
8. Upload prepared public procurement files to Supabase Storage.
9. Start Claude document analysis.
10. Recalculate the explainable opportunity score.

No tender-by-tender SQL is required.

## Installation

Run once:
`supabase/migrations/202607100008_tender_automation.sql`

Deploy:
- `ted-notice-resolver`
- `tender-archive-worker`

Keep already deployed:
- `tender-attachment-discovery`
- `tender-document-engine`

Upload:
- `cpanel/portal.html` as the live `portal.html`

## ZIP safety limits

- 30 MB maximum compressed ZIP
- 100 MB maximum uncompressed total
- maximum 60 entries
- no nested ZIP
- no executable files
- path traversal rejected
- unsupported files skipped
- extracted files are hashed
- XLSX/XLS converted to per-sheet CSV
- DOCX converted to TXT

## Important limitations

TED Search API response fields and external procurement portals vary. The resolver uses multiple official search-query attempts and recursively scans returned URLs. If a national portal hides documents behind authentication, CAPTCHA, session-only downloads or heavy browser JavaScript, manual intervention may still be required.

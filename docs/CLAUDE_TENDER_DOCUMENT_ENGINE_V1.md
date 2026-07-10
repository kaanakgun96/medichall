# MedicHall Claude Tender Document Engine v1

## Fixed product goal

This engine performs exactly this workflow:

1. A tender and its document URLs are registered.
2. A company owner presses **Analyze documents**.
3. The Supabase Edge Function downloads supported tender files.
4. Claude reads the actual PDF/CSV/text documents.
5. Claude extracts only evidenced:
   - product names,
   - lot numbers,
   - quantities and units,
   - packaging,
   - sterilization requirements,
   - materials,
   - dimensions,
   - certificates,
   - technical requirements.
6. Every extracted field is stored with source evidence.
7. The MedicHall rule-based Match Engine recalculates the opportunity score from the extracted facts.
8. If product or quantity evidence is missing, the result remains partial and those fields stay empty.

Claude extracts facts. MedicHall calculates the score.

## Supported files in this release

- PDF
- CSV
- TXT

Anthropic supports PDF document blocks directly. DOCX and XLSX are not native document blocks and must be converted to PDF/text or handled through a separate preprocessing/code-execution layer.

## Installation

1. Upload these files to the `develop` branch.
2. If not already run, execute:
   `supabase/migrations/202607100006_tender_document_engine.sql`
3. Replace the existing Edge Function files:
   `supabase/functions/tender-document-engine/`
4. Add Supabase secrets:
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_MODEL`
5. Keep the standard Supabase secrets:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Deploy:
   `supabase functions deploy tender-document-engine`
7. Register real direct HTTPS tender-document URLs in `tender_documents`.
8. Upload `cpanel/portal.html` only if the previous document-engine portal was not uploaded.

## Model setting

Set `ANTHROPIC_MODEL` to a model currently available to your Anthropic account. The code intentionally does not hardcode a model name.

## Safety behavior

- no guessed product names,
- no guessed quantities,
- no arithmetic unless explicit and certain,
- no document evidence means no document score,
- ambiguous analyses are marked `partial`,
- source quotes are retained,
- maximum 6 files,
- maximum 20 MB per downloaded file,
- only HTTPS documents.

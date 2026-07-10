# MedicHall Explainable Match Engine v1

This package separates a tender recommendation into three transparent concepts:

1. **Profile Match**  
   Calculated only from available structured data such as CPV codes, product keywords, target country and listed certifications.

2. **Document Match**  
   Remains `Pending` until procurement documents are actually downloaded and analyzed.

3. **Opportunity Score + Confidence**  
   Uses document evidence only when document analysis is completed or partial. Missing product names, quantities, certificates and specifications are displayed explicitly.

## Files

```text
supabase/migrations/202607100005_explainable_match_engine.sql
cpanel/portal.html
docs/EXPLAINABLE_MATCH_ENGINE_V1.md
```

## Installation order

1. Upload all files to the `develop` branch.
2. Run `202607100005_explainable_match_engine.sql` in Supabase SQL Editor.
3. Back up the live `portal.html`.
4. Upload `cpanel/portal.html` to cPanel as `portal.html`.
5. Log in as a manufacturer and press **Refresh matches**.

## Important limitation in this sprint

The **Analyze documents** button is visible but does not yet download or parse tender attachments. It intentionally leaves document scores pending. The next backend sprint will add:

- tender attachment discovery,
- PDF/DOCX/XLSX download,
- text/table extraction,
- product and quantity extraction with source evidence,
- queue and retry handling,
- saved analysis through `save_tender_document_analysis()`.

This staged approach prevents fabricated product details and misleading match scores.

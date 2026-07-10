-- Example: register tender document URLs.
-- Replace the tender ID and URLs with real procurement attachments.
-- Only administrators should insert/update tender_documents.

insert into public.tender_documents (
  tender_id,
  title,
  file_name,
  file_url,
  mime_type,
  document_type,
  language_code,
  source_page_url
)
values
(
  1,
  'Technical specification',
  'technical-specification.pdf',
  'https://example-procurement-portal.eu/files/technical-specification.pdf',
  'application/pdf',
  'technical_specification',
  'en',
  'https://example-procurement-portal.eu/tender/123'
),
(
  1,
  'Price schedule',
  'price-schedule.xlsx',
  'https://example-procurement-portal.eu/files/price-schedule.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'price_schedule',
  'en',
  'https://example-procurement-portal.eu/tender/123'
)
on conflict (tender_id, file_url) do update set
  title = excluded.title,
  file_name = excluded.file_name,
  mime_type = excluded.mime_type,
  document_type = excluded.document_type,
  language_code = excluded.language_code,
  source_page_url = excluded.source_page_url,
  is_active = true,
  updated_at = now();

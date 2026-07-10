-- ============================================================
-- MedicHall — Step 14: keep contact e-mails private
-- Anonymous visitors can no longer read company e-mail addresses,
-- not even directly through the API.
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

revoke select on table public.companies from anon;

grant select (
  id, name, type, description, website, phone, country, city,
  certifications, logo_url, is_approved, is_active, created_at,
  catalog_url, video_url, plan, plan_expires_at, slug
) on table public.companies to anon;

-- (contact_email and owner_id are intentionally NOT in the list above)

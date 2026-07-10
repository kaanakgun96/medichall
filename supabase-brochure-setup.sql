-- ============================================================
-- MedicHall — Step 5: per-product brochure (flyer) PDFs
-- Run this in Supabase Dashboard -> SQL Editor
-- ============================================================

alter table public.products
  add column if not exists brochure_url text;

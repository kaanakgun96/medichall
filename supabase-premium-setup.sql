-- ============================================================
-- MedicHall — Step 7: Premium membership & featured products
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

-- Company plan: 'free' or 'premium' (+ optional expiry date)
alter table public.companies
  add column if not exists plan text not null default 'free',
  add column if not exists plan_expires_at timestamptz;

-- Featured products appear on the homepage and rank first in the catalog
alter table public.products
  add column if not exists is_featured boolean not null default false;

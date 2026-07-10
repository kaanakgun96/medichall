-- ============================================================
-- MedicHall — Step 16: visibility fix
-- Guarantees: products of UNAPPROVED companies are never public.
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1) A bullet-proof helper: "is this company publicly visible?"
--    (security definer = evaluates the same way for everyone)
create or replace function public.company_is_public(cid bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.companies c
    where c.id = cid and c.is_approved = true and c.is_active = true
  );
$$;

-- 2) Make sure row security is enabled (harmless if already on)
alter table public.products  enable row level security;
alter table public.companies enable row level security;

-- 3) Recreate the public visibility rules cleanly
drop policy if exists "public read products" on public.products;
create policy "public read products" on public.products
  for select using (
    is_active = true
    and (company_id is null or public.company_is_public(company_id))
  );

drop policy if exists "public read companies" on public.companies;
create policy "public read companies" on public.companies
  for select using (is_approved = true and is_active = true);

-- 4) Verify (both should return 0 rows if you have an unapproved
--    company with products — that means the fix works):
-- set role anon;
-- select name from public.companies where is_approved = false;
-- reset role;

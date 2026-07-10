-- ============================================================
-- MedicHall — Step 6: migrate Partners -> Manufacturer companies
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

-- Copy every partner into companies as an APPROVED manufacturer
-- (skips any name that already exists in companies)
insert into public.companies (name, type, is_approved, is_active)
select p.name, p.type, true, p.is_active
from public.partners p
where not exists (
  select 1 from public.companies c where lower(c.name) = lower(p.name)
);

-- Check the result:
-- select id, name, type, is_approved from public.companies order by name;

-- Note: these companies have no owner account yet (owner_id is null),
-- so only YOU can edit them from the admin panel. When a real person
-- from that company joins the portal later, we can link their account.

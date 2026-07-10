-- ============================================================
-- MedicHall — Step 2: Admin panel permissions
-- Run this in Supabase Dashboard -> SQL Editor (after Step 1)
-- ============================================================

-- Admin (logged-in user) can manage products & partners,
-- and can read the RFQ inbox.
-- IMPORTANT: also disable public signups in the dashboard so
-- only YOUR account exists:
--   Authentication -> Sign In / Up -> turn OFF "Allow new users to sign up"
-- Then create your own account:
--   Authentication -> Users -> Add user (email + password, check "Auto confirm")

create policy "admin manage products" on public.products
  for all to authenticated using (true) with check (true);

create policy "admin manage partners" on public.partners
  for all to authenticated using (true) with check (true);

create policy "admin read rfq" on public.rfq_requests
  for select to authenticated using (true);

create policy "admin delete rfq" on public.rfq_requests
  for delete to authenticated using (true);

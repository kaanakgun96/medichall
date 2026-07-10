-- ============================================================
-- MedicHall — Step 12: unread-message tracking for chat
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

alter table public.rfq_messages
  add column if not exists is_read boolean not null default false;

-- participants may mark messages as read
create policy "participants update messages" on public.rfq_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.rfq_requests r
      where r.id = rfq_id and (
        r.user_id = auth.uid()
        or r.company_id in (select id from public.companies where owner_id = auth.uid())
        or public.is_admin()
      )
    )
  )
  with check (true);

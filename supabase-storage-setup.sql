-- ============================================================
-- MedicHall — Step 4: FILE UPLOADS (images, logos, PDF catalogs)
-- Run this in Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1) Storage bucket for all media (public read)
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- 2) Storage policies: logged-in users can upload/replace files,
--    everyone can view (bucket is public)
create policy "authenticated upload media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media');

create policy "authenticated update media" on storage.objects
  for update to authenticated
  using (bucket_id = 'media') with check (bucket_id = 'media');

create policy "authenticated delete media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media');

create policy "public read media" on storage.objects
  for select using (bucket_id = 'media');

-- 3) New company fields: PDF catalog + video
alter table public.companies
  add column if not exists catalog_url text,
  add column if not exists video_url text;

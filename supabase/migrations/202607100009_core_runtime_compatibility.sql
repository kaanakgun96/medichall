-- Promote the remaining schema-bearing historical setup fragments into the
-- ordered migration chain.  Run after the Tender Automation migration because
-- the public-stats RPC and upload policy depend on its tender relations and
-- Storage bucket.

begin;

create or replace function public.medichall_public_stats()
returns json
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select json_build_object(
    'open_tenders',
      (
        select count(*)
        from public.tenders
        where deadline_at is not null
          and deadline_at >= now()
      ),
    'tenders',
      (select count(*) from public.tenders),
    'tender_countries',
      (
        select count(distinct country_name)
        from public.tenders
        where country_name is not null
          and country_name <> ''
          and deadline_at is not null
          and deadline_at >= now()
      ),
    'products',
      (
        select count(*)
        from public.products
        where is_active
      ),
    'manufacturers',
      (
        select count(*)
        from public.companies
        where is_approved
          and is_active
      )
  );
$function$;

revoke all on function public.medichall_public_stats()
from public;
grant execute on function public.medichall_public_stats()
to anon, authenticated, service_role;

drop policy if exists "authenticated upload tender documents"
on storage.objects;
create policy "authenticated upload tender documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tender-documents'
  and name like 'user-uploads/%'
);

notify pgrst, 'reload schema';

commit;

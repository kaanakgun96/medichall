-- Restore Admin product/RFQ reads after company contact privacy removed the
-- broad authenticated companies SELECT grant. Keep company contact columns
-- private by routing tenant ownership checks through the existing privileged
-- authorization helper instead of querying public.companies as the caller.

begin;

drop policy if exists "owner manage own products" on public.products;
create policy "owner manage own products"
on public.products for all to authenticated
using (public.company_owner_authorized_v1(company_id))
with check (public.company_owner_authorized_v1(company_id));

drop policy if exists "owner read own rfq" on public.rfq_requests;
create policy "owner read own rfq"
on public.rfq_requests for select to authenticated
using (public.company_owner_authorized_v1(company_id));

notify pgrst, 'reload schema';

commit;

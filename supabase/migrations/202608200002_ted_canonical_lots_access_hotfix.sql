-- Restore authenticated tender discovery after company contact privacy removed
-- broad browser SELECT on public.companies. These policies must use the
-- existing privileged ownership helper rather than querying companies as the
-- caller. No company contact grant is restored.

begin;

do $preflight$
begin
  if to_regprocedure(
    'public.company_owner_authorized_v1(bigint)'
  ) is null then
    raise exception 'Company ownership authorization helper is missing';
  end if;
end
$preflight$;

drop policy if exists "owner manage own match profile"
  on public.company_match_profiles;
create policy "owner manage own match profile"
on public.company_match_profiles
for all to authenticated
using (public.company_owner_authorized_v1(company_id))
with check (public.company_owner_authorized_v1(company_id));

drop policy if exists "owner read own opportunity matches"
  on public.opportunity_matches;
create policy "owner read own opportunity matches"
on public.opportunity_matches
for select to authenticated
using (public.company_owner_authorized_v1(company_id));

drop policy if exists "owners read own tender imports"
  on public.tender_imports;
create policy "owners read own tender imports"
on public.tender_imports
for select to authenticated
using (
  public.is_admin()
  or requested_by = auth.uid()
  or public.company_owner_authorized_v1(company_id)
);

drop policy if exists "owners read own imported tenders"
  on public.tenders;
create policy "owners read own imported tenders"
on public.tenders
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.tender_imports tender_import
    where tender_import.tender_id = tenders.id
      and (
        tender_import.requested_by = auth.uid()
        or public.company_owner_authorized_v1(tender_import.company_id)
      )
  )
);

notify pgrst, 'reload schema';

commit;

-- Forward-only rollback plan: replace only these four policies with a later
-- reviewed migration. Never restore broad authenticated SELECT on companies.

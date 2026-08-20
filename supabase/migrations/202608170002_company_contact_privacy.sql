-- Company contact privacy and platform-bypass hardening.
-- Private contact coordinates remain stored, but browser roles receive only an
-- explicit public projection or an authorized own/admin private projection.

begin;

create or replace function public.redact_public_contact_text_v1(
  p_value text
)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          coalesce(p_value, ''),
          '[[:alnum:]_.%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}',
          '[private contact]',
          'gi'
        ),
        '\+?[[:digit:]][[:digit:] ()/.\-]{6,}[[:digit:]]',
        '[private contact]',
        'g'
      )
    ),
    ''
  )
$function$;

create or replace function public.get_public_companies_v1(
  p_company_id bigint default null,
  p_slug text default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 250);
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_result jsonb;
begin
  select coalesce(
    jsonb_agg(public_row order by public_row.name, public_row.id),
    '[]'::jsonb
  ) into v_result
  from (
    select
      company.id,
      company.name,
      company.type,
      public.redact_public_contact_text_v1(company.description) as description,
      company.website,
      company.country,
      company.city,
      public.redact_public_contact_text_v1(company.certifications)
        as certifications,
      company.logo_url,
      company.is_approved,
      company.is_active,
      company.created_at,
      company.catalog_url,
      company.video_url,
      company.plan,
      company.plan_expires_at,
      company.slug,
      company.is_verified
    from public.companies company
    where company.is_approved
      and company.is_active
      and (p_company_id is null or company.id = p_company_id)
      and (v_slug is null or company.slug = v_slug)
    order by company.name, company.id
    limit v_limit
  ) public_row;
  return v_result;
end
$function$;

create or replace function public.get_my_company_private_v1()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(jsonb_agg(to_jsonb(company) order by company.id), '[]'::jsonb)
  from public.companies company
  where auth.uid() is not null
    and company.owner_id = auth.uid()
$function$;

create or replace function public.get_admin_companies_private_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(company) order by company.created_at desc, company.id),
    '[]'::jsonb
  ) into v_result
  from public.companies company;
  return v_result;
end
$function$;

create or replace function public.company_owner_authorized_v1(
  p_company_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    public.is_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1
      from public.companies company
      where company.id = p_company_id
        and company.owner_id = auth.uid()
    ),
    false
  )
$function$;

-- Remove the historical broad authenticated grant and the historical anon
-- column grants (which included phone). Regrant only non-free-text public
-- relationship columns needed by product embeddings and global search.
revoke select on table public.companies
from public, anon, authenticated;

revoke select (
  id,
  owner_id,
  name,
  type,
  description,
  website,
  contact_email,
  phone,
  country,
  city,
  certifications,
  logo_url,
  is_approved,
  is_active,
  created_at,
  catalog_url,
  video_url,
  plan,
  plan_expires_at,
  slug,
  is_verified
) on table public.companies from public, anon, authenticated;

grant select (
  id,
  name,
  type,
  website,
  country,
  city,
  logo_url,
  is_approved,
  is_active,
  created_at,
  video_url,
  plan,
  plan_expires_at,
  slug,
  is_verified
) on table public.companies to anon, authenticated;

revoke all on function public.redact_public_contact_text_v1(text)
from public, anon, authenticated;
grant execute on function public.redact_public_contact_text_v1(text)
to service_role;

revoke all on function public.get_public_companies_v1(bigint, text, integer)
from public, anon, authenticated;
grant execute on function public.get_public_companies_v1(bigint, text, integer)
to anon, authenticated, service_role;

revoke all on function public.get_my_company_private_v1()
from public, anon, authenticated;
grant execute on function public.get_my_company_private_v1()
to authenticated, service_role;

revoke all on function public.get_admin_companies_private_v1()
from public, anon, authenticated;
grant execute on function public.get_admin_companies_private_v1()
to authenticated, service_role;

revoke all on function public.company_owner_authorized_v1(bigint)
from public, anon, authenticated;
grant execute on function public.company_owner_authorized_v1(bigint)
to authenticated, service_role;

comment on function public.get_public_companies_v1(bigint, text, integer) is
  'Allowlisted public company DTO. Never returns owner_id, contact_email or phone; redacts contact coordinates from public free text.';
comment on function public.get_my_company_private_v1() is
  'Authorized owner-only private company record, including stored contact fields.';
comment on function public.get_admin_companies_private_v1() is
  'Existing MedicHall admin-boundary private company records.';

notify pgrst, 'reload schema';

commit;

-- Forward-only rollback plan: retain the privacy RPCs, restore only the
-- previous frontend version if needed, and grant the minimum missing safe
-- column. Do not restore phone/contact_email browser grants.

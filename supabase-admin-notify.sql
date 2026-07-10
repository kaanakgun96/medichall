-- ============================================================
-- MedicHall — Step 17: e-mail the ADMIN for unassigned RFQs
-- (requests for manufacturer products already e-mail the manufacturer;
--  this adds: requests for MedicHall-managed products e-mail YOU)
--
-- EDIT FIRST: replace YOUR_ADMIN_EMAIL_HERE below with your e-mail.
-- Run ONCE in Supabase Dashboard -> SQL Editor (after Step 11).
-- ============================================================

create or replace function public.mh_admin_email() returns text
language sql immutable as $$ select 'YOUR_ADMIN_EMAIL_HERE' $$;

create or replace function public.trg_rfq_created()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_to text; v_company text;
begin
  if new.company_id is not null then
    select coalesce(nullif(c.contact_email,''), u.email), c.name
      into v_to, v_company
    from public.companies c
    left join auth.users u on u.id = c.owner_id
    where c.id = new.company_id;
  else
    v_to := public.mh_admin_email();
  end if;

  perform public.notify_email(
    v_to,
    'New quotation request — ' || coalesce(new.product_name, 'general inquiry'),
    '<div style="font-family:sans-serif;line-height:1.6">'
    || '<h2 style="color:#003E52">New quotation request</h2>'
    || '<p><b>Product:</b> ' || coalesce(new.product_name, 'General inquiry') || '</p>'
    || '<p><b>From:</b> ' || new.email || coalesce(' · ' || new.company, '') || '</p>'
    || coalesce('<p style="background:#EFF6F9;padding:12px;border-radius:8px">' || new.message || '</p>', '')
    || '<p><a href="' || public.mh_site_url() || '/portal.html" '
    || 'style="background:#4298CC;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none">Open MedicHall</a></p>'
    || '</div>'
  );
  return new;
end $$;

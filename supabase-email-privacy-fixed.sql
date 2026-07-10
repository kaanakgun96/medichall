-- ============================================================
-- MedicHall — Step 18 (FIXED): privacy in notification e-mails
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1) Where unassigned (MedicHall-managed) RFQ notifications go.
--    !! Check the address below is the one you actually use !!
create or replace function public.mh_admin_email() returns text
language sql immutable as $$ select 'info@medichall.co' $$;

-- 2) RFQ notification: registered buyers' e-mails are hidden,
--    manufacturer is directed to reply via MedicHall chat.
create or replace function public.trg_rfq_created()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_to text; v_from_line text;
begin
  if new.company_id is not null then
    select coalesce(nullif(c.contact_email,''), u.email)
      into v_to
    from public.companies c
    left join auth.users u on u.id = c.owner_id
    where c.id = new.company_id;
  else
    v_to := public.mh_admin_email();
  end if;

  if new.user_id is not null then
    v_from_line := '<b>Registered buyer</b>'
      || coalesce(' · ' || new.company, '')
      || ' — reply via the chat in your MedicHall portal.';
  else
    v_from_line := new.email || coalesce(' · ' || new.company, '');
  end if;

  perform public.notify_email(
    v_to,
    'New quotation request — ' || coalesce(new.product_name, 'general inquiry'),
    '<div style="font-family:sans-serif;line-height:1.6">'
    || '<h2 style="color:#003E52">New quotation request</h2>'
    || '<p><b>Product:</b> ' || coalesce(new.product_name, 'General inquiry') || '</p>'
    || '<p><b>From:</b> ' || v_from_line || '</p>'
    || coalesce('<p style="background:#EFF6F9;padding:12px;border-radius:8px">' || new.message || '</p>', '')
    || '<p><a href="' || public.mh_site_url() || '/portal" '
    || 'style="background:#4298CC;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none">Open MedicHall Portal</a></p>'
    || '</div>'
  );
  return new;
end $$;

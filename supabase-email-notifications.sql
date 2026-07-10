-- ============================================================
-- MedicHall — Step 11: E-mail notifications (new RFQs & chat messages)
--
-- BEFORE RUNNING — 3 preparations:
--  1) Supabase Dashboard -> Database -> Extensions -> search "pg_net" -> Enable
--  2) Create a free account at https://resend.com -> API Keys -> create key
--  3) Below, replace RESEND_API_KEY_HERE with your key (keep the quotes)
--
-- NOTE about the sender address: until you verify your domain
-- (medichall.com) inside Resend, use 'MedicHall <onboarding@resend.dev>'
-- as the FROM address — in that mode Resend only delivers to YOUR own
-- email (good for testing). After domain verification, switch to
-- 'MedicHall <notifications@medichall.com>' and emails reach everyone.
-- ============================================================

-- ------------------------------------------------------------
-- 0) One place for settings
-- ------------------------------------------------------------
create or replace function public.mh_email_from() returns text
language sql immutable as $$ select 'MedicHall <onboarding@resend.dev>' $$;

create or replace function public.mh_site_url() returns text
language sql immutable as $$ select 'https://medichall.netlify.app' $$;

-- ------------------------------------------------------------
-- 1) E-mail sender helper (calls Resend)
-- ------------------------------------------------------------
create or replace function public.notify_email(p_to text, p_subject text, p_html text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_to is null or p_to = '' then return; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer re_JuUggDXp_HDzT2uQ1THE96UbjiUyVVztt',
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',    public.mh_email_from(),
      'to',      jsonb_build_array(p_to),
      'subject', p_subject,
      'html',    p_html
    )
  );
end $$;

-- ------------------------------------------------------------
-- 2) New RFQ -> notify the manufacturer
-- ------------------------------------------------------------
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

    perform public.notify_email(
      v_to,
      'New quotation request — ' || coalesce(new.product_name, 'general inquiry'),
      '<div style="font-family:sans-serif;line-height:1.6">'
      || '<h2 style="color:#003E52">New quotation request</h2>'
      || '<p><b>Product:</b> ' || coalesce(new.product_name, 'General inquiry') || '</p>'
      || '<p><b>From:</b> ' || new.email || coalesce(' · ' || new.company, '') || '</p>'
      || coalesce('<p style="background:#EFF6F9;padding:12px;border-radius:8px">' || new.message || '</p>', '')
      || '<p><a href="' || public.mh_site_url() || '/portal.html" '
      || 'style="background:#4298CC;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none">Open Partner Portal</a></p>'
      || '</div>'
    );
  end if;
  return new;
end $$;

drop trigger if exists rfq_created_email on public.rfq_requests;
create trigger rfq_created_email
  after insert on public.rfq_requests
  for each row execute function public.trg_rfq_created();

-- ------------------------------------------------------------
-- 3) New chat message -> notify the other side
--    (throttled: max 1 e-mail per sender per conversation / 15 min)
-- ------------------------------------------------------------
create or replace function public.trg_message_created()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  r public.rfq_requests%rowtype;
  v_to text;
begin
  -- throttle: if the same sender already wrote in the last 15 minutes,
  -- the other side was already notified — skip
  if exists (
    select 1 from public.rfq_messages m
    where m.rfq_id = new.rfq_id
      and m.sender_id = new.sender_id
      and m.id <> new.id
      and m.created_at > now() - interval '15 minutes'
  ) then
    return new;
  end if;

  select * into r from public.rfq_requests where id = new.rfq_id;

  if new.sender_role = 'buyer' then
    select coalesce(nullif(c.contact_email,''), u.email) into v_to
    from public.companies c
    left join auth.users u on u.id = c.owner_id
    where c.id = r.company_id;
  else
    select u.email into v_to from auth.users u where u.id = r.user_id;
    if v_to is null then v_to := r.email; end if;
  end if;

  perform public.notify_email(
    v_to,
    'New message on MedicHall — ' || coalesce(r.product_name, 'your inquiry'),
    '<div style="font-family:sans-serif;line-height:1.6">'
    || '<h2 style="color:#003E52">You have a new message</h2>'
    || '<p style="background:#EFF6F9;padding:12px;border-radius:8px">' || new.body || '</p>'
    || '<p><a href="' || public.mh_site_url() || '/portal.html" '
    || 'style="background:#4298CC;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none">Reply on MedicHall</a></p>'
    || '</div>'
  );
  return new;
end $$;

drop trigger if exists message_created_email on public.rfq_messages;
create trigger message_created_email
  after insert on public.rfq_messages
  for each row execute function public.trg_message_created();

-- MedicHall email security hardening.
--
-- 1. Saved-search digest service RPCs are service-role only.
-- 2. Legacy direct RFQ templates escape every untrusted HTML value.
-- 3. Dynamic RFQ subjects cannot inject CR/LF headers.

begin;

do $preflight$
begin
  if to_regclass('public.saved_searches') is null
    or to_regclass('public.rfq_requests') is null
    or to_regclass('public.rfq_messages') is null
    or to_regclass('public.rfq_offers') is null
    or to_regprocedure('public.digest_due_saved_searches()') is null
    or to_regprocedure('public.mark_saved_search_digested(bigint[])') is null
    or to_regprocedure('public.notify_email(text,text,text)') is null
    or to_regprocedure('public.trg_rfq_created()') is null
    or to_regprocedure('public.trg_message_created()') is null
    or to_regprocedure('public.trg_offer_created()') is null then
    raise exception 'Email security hardening dependencies are incomplete';
  end if;
end
$preflight$;

create or replace function public.email_escape_html(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
  select replace(
    replace(
      replace(
        replace(
          replace(coalesce(p_value, ''), '&', '&amp;'),
          '<', '&lt;'
        ),
        '>', '&gt;'
      ),
      '"', '&quot;'
    ),
    '''', '&#39;'
  );
$function$;

create or replace function public.email_safe_subject(
  p_value text,
  p_fallback text default 'MedicHall notification'
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
  with cleaned as (
    select btrim(regexp_replace(
      coalesce(p_value, p_fallback, 'MedicHall notification'),
      E'[\\r\\n]+',
      ' ',
      'g'
    )) as value
  )
  select left(
    coalesce(nullif(value, ''), 'MedicHall notification'),
    200
  )
  from cleaned;
$function$;

revoke all on function public.email_escape_html(text)
from public, anon, authenticated;
revoke all on function public.email_safe_subject(text,text)
from public, anon, authenticated;
grant execute on function public.email_escape_html(text) to service_role;
grant execute on function public.email_safe_subject(text,text) to service_role;

create or replace function public.trg_rfq_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  recipient_email text;
  sender_line_html text;
  product_text text := coalesce(
    nullif(btrim(new.product_name), ''),
    'General inquiry'
  );
begin
  if new.company_id is not null then
    select coalesce(nullif(company.contact_email, ''), owner.email)
    into recipient_email
    from public.companies company
    left join auth.users owner on owner.id = company.owner_id
    where company.id = new.company_id;
  else
    recipient_email := public.mh_admin_email();
  end if;

  if new.user_id is not null then
    sender_line_html := '<b>Registered buyer</b>'
      || case when nullif(btrim(new.company), '') is not null
        then ' · ' || public.email_escape_html(new.company)
        else '' end
      || ' — reply via the chat in your MedicHall portal.';
  else
    sender_line_html := public.email_escape_html(
      coalesce(nullif(btrim(new.email), ''), 'Unknown sender')
    ) || case when nullif(btrim(new.company), '') is not null
      then ' · ' || public.email_escape_html(new.company)
      else '' end;
  end if;

  perform public.notify_email(
    recipient_email,
    public.email_safe_subject(
      'New quotation request — ' || product_text,
      'New quotation request'
    ),
    '<div style="font-family:sans-serif;line-height:1.6">'
      || '<h2 style="color:#003E52">New quotation request</h2>'
      || '<p><b>Product:</b> '
      || public.email_escape_html(product_text) || '</p>'
      || '<p><b>From:</b> ' || sender_line_html || '</p>'
      || case when nullif(new.message, '') is not null then
        '<p style="background:#EFF6F9;padding:12px;border-radius:8px">'
        || public.email_escape_html(new.message) || '</p>'
        else '' end
      || '<p><a href="' || public.mh_site_url() || '/portal.html">'
      || 'Open MedicHall Portal</a></p></div>'
  );
  return new;
end;
$function$;

create or replace function public.trg_message_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  request_record public.rfq_requests%rowtype;
  recipient_email text;
  product_text text;
begin
  if exists (
    select 1
    from public.rfq_messages message
    where message.rfq_id = new.rfq_id
      and message.sender_id = new.sender_id
      and message.id <> new.id
      and message.created_at > now() - interval '15 minutes'
  ) then
    return new;
  end if;

  select * into request_record
  from public.rfq_requests where id = new.rfq_id;
  product_text := coalesce(
    nullif(btrim(request_record.product_name), ''),
    'your inquiry'
  );

  if new.sender_role = 'buyer' then
    select coalesce(nullif(company.contact_email, ''), owner.email)
    into recipient_email
    from public.companies company
    left join auth.users owner on owner.id = company.owner_id
    where company.id = request_record.company_id;
  else
    select email into recipient_email
    from auth.users where id = request_record.user_id;
    recipient_email := coalesce(recipient_email, request_record.email);
  end if;

  perform public.notify_email(
    recipient_email,
    public.email_safe_subject(
      'New message on MedicHall — ' || product_text,
      'New message on MedicHall'
    ),
    '<div style="font-family:sans-serif;line-height:1.6">'
      || '<h2 style="color:#003E52">You have a new message</h2>'
      || '<p>' || public.email_escape_html(new.body) || '</p>'
      || '<p><a href="' || public.mh_site_url() || '/portal.html">'
      || 'Reply on MedicHall</a></p></div>'
  );
  return new;
end;
$function$;

create or replace function public.trg_offer_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  recipient_email text;
  product_text text;
  company_text text;
begin
  select owner.email, coalesce(
    nullif(btrim(request.product_name), ''),
    'your inquiry'
  )
  into recipient_email, product_text
  from public.rfq_requests request
  left join auth.users owner on owner.id = request.user_id
  where request.id = new.rfq_id;

  if recipient_email is null then
    return new;
  end if;

  select coalesce(nullif(btrim(name), ''), 'A manufacturer')
  into company_text
  from public.companies where id = new.company_id;

  perform public.notify_email(
    recipient_email,
    public.email_safe_subject(
      'You received an offer — ' || product_text,
      'You received an offer'
    ),
    '<div style="font-family:sans-serif;line-height:1.6">'
      || '<h2 style="color:#003E52">New offer received</h2>'
      || '<p><b>' || public.email_escape_html(
        coalesce(company_text, 'A manufacturer')
      ) || '</b> sent an offer.</p>'
      || '<p><a href="' || public.mh_site_url() || '/portal.html#inbox">'
      || 'Compare offers on MedicHall</a></p></div>'
  );
  return new;
end;
$function$;

revoke all on function public.trg_rfq_created()
from public, anon, authenticated;
revoke all on function public.trg_message_created()
from public, anon, authenticated;
revoke all on function public.trg_offer_created()
from public, anon, authenticated;

revoke all on function public.digest_due_saved_searches()
from public, anon, authenticated;
revoke all on function public.mark_saved_search_digested(bigint[])
from public, anon, authenticated;
grant execute on function public.digest_due_saved_searches() to service_role;
grant execute on function public.mark_saved_search_digested(bigint[])
to service_role;

commit;

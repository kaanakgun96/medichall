-- Exact rollback-only contract for 202608130004_email_security_hardening.sql.

begin;

do $helpers$
declare
  malicious text := '<script>alert(1)</script>';
  image_attack text := '<img src=x onerror=alert(1)>';
  link_attack text := '"><a href="javascript:alert(1)">click</a>';
  safe_subject text;
begin
  if public.email_escape_html(malicious) <>
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    or public.email_escape_html(image_attack) <>
      '&lt;img src=x onerror=alert(1)&gt;'
    or public.email_escape_html(link_attack) <>
      '&quot;&gt;&lt;a href=&quot;javascript:alert(1)&quot;&gt;click&lt;/a&gt;'
    or public.email_escape_html('AT&T') <> 'AT&amp;T'
    or public.email_escape_html('5 < 10 > 3') <> '5 &lt; 10 &gt; 3'
    or public.email_escape_html('"quoted" & ''single quoted''') <>
      '&quot;quoted&quot; &amp; &#39;single quoted&#39;'
    or public.email_escape_html('Ultrasound Probe Cover') <>
      'Ultrasound Probe Cover'
    or public.email_escape_html('5,000 pcs') <> '5,000 pcs'
    or public.email_escape_html(
      'Please provide your best price for delivery to İzmir.'
    ) <> 'Please provide your best price for delivery to İzmir.'
    or public.email_escape_html('AKA Medical & Trading') <>
      'AKA Medical &amp; Trading' then
    raise exception 'HTML escaping contract failed';
  end if;

  safe_subject := public.email_safe_subject(
    E'Ultrasound Probe Cover\r\nBcc: attacker@example.invalid',
    'RFQ update'
  );
  if safe_subject like '%' || chr(13) || '%'
    or safe_subject like '%' || chr(10) || '%'
    or safe_subject <> 'Ultrasound Probe Cover Bcc: attacker@example.invalid' then
    raise exception 'Email subject control characters were not normalized';
  end if;
end
$helpers$;

do $rfq_templates$
declare
  definition text;
begin
  foreach definition in array array[
    pg_get_functiondef('public.trg_rfq_created()'::regprocedure),
    pg_get_functiondef('public.trg_message_created()'::regprocedure),
    pg_get_functiondef('public.trg_offer_created()'::regprocedure)
  ]
  loop
    if definition not like '%email_escape_html%'
      or definition not like '%email_safe_subject%' then
      raise exception 'RFQ template does not use shared email safety helpers';
    end if;
    if definition like '%|| new.message ||%'
      or definition like '%|| new.body ||%'
      or definition like '%|| coalesce(company_name%'
      or definition like '%'' — '' || coalesce(new.product_name%' then
      raise exception 'RFQ template retains raw untrusted interpolation';
    end if;
  end loop;
end
$rfq_templates$;

do $security$
begin
  if has_function_privilege(
      'anon', 'public.digest_due_saved_searches()', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.digest_due_saved_searches()', 'EXECUTE'
    ) or has_function_privilege(
      'anon', 'public.mark_saved_search_digested(bigint[])', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.mark_saved_search_digested(bigint[])', 'EXECUTE'
    ) or not has_function_privilege(
      'service_role', 'public.digest_due_saved_searches()', 'EXECUTE'
    ) or not has_function_privilege(
      'service_role', 'public.mark_saved_search_digested(bigint[])', 'EXECUTE'
    ) then
    raise exception 'Saved-search digest RPC privileges are unsafe';
  end if;

  if has_function_privilege(
      'anon', 'public.email_escape_html(text)', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.email_escape_html(text)', 'EXECUTE'
    ) or has_function_privilege(
      'anon', 'public.email_safe_subject(text,text)', 'EXECUTE'
    ) or has_function_privilege(
      'authenticated', 'public.email_safe_subject(text,text)', 'EXECUTE'
    ) then
    raise exception 'Email safety helpers are browser executable';
  end if;
end
$security$;

rollback;

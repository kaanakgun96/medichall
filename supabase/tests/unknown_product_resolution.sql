-- Rollback-only SQL/RLS regression for 202608250002.
begin;

do $structure$
begin
  if to_regclass('public.product_resolution_events') is null
     or to_regclass('public.taxonomy_alias_candidates') is null
     or to_regprocedure('public.record_product_resolution_event_v1(bigint,uuid,text,text,text,jsonb)') is null
     or to_regprocedure('public.record_product_resolution_outcome_v1(uuid,integer,integer)') is null then
    raise exception 'Unknown-product learning objects are missing';
  end if;
  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.product_resolution_events'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) or not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.taxonomy_alias_candidates'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'Unknown-product learning RLS is not forced'; end if;
  if has_table_privilege('anon', 'public.product_resolution_events',
      'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.product_resolution_events',
      'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.taxonomy_alias_candidates',
      'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Unknown-product learning grants are too broad';
  end if;
  if not has_table_privilege('service_role', 'public.product_resolution_events',
      'SELECT,INSERT,UPDATE,DELETE')
     or not has_table_privilege('service_role', 'public.taxonomy_alias_candidates',
      'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Service role lacks unknown-product learning access';
  end if;
  if has_function_privilege('anon',
      'public.record_product_resolution_event_v1(bigint,uuid,text,text,text,jsonb)',
      'EXECUTE')
     or has_function_privilege('anon',
      'public.get_taxonomy_alias_candidates_v1(integer)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.record_product_resolution_outcome_v1(uuid,integer,integer)',
      'EXECUTE') then
    raise exception 'Unknown-product RPC execution grants are too broad';
  end if;
end
$structure$;

do $normalization_and_bounds$
begin
  if public.normalize_unknown_product_phrase_v1('Arterial/Venous Sets')
       <> 'arterial venous set'
     or public.unknown_product_phrase_signature_v1('Venous-Arterial Set')
       <> public.unknown_product_phrase_signature_v1('Arterial / Venous Sets') then
    raise exception 'Safe unknown-product normalization failed';
  end if;
  if not public.is_bounded_medical_product_phrase_v1('arterial venous set')
     or public.is_bounded_medical_product_phrase_v1('search europe')
     or public.is_bounded_medical_product_phrase_v1('find arterial venous set buyers')
     or public.is_bounded_medical_product_phrase_v1('arterial venous set competitors')
     or public.is_bounded_medical_product_phrase_v1('industrial pump set')
     or public.is_bounded_medical_product_phrase_v1('medical device') then
    raise exception 'Medical product intent validation failed';
  end if;
end
$normalization_and_bounds$;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.external_prospect_discovery_runs'::regclass
      and constraint_row.conname = 'external_prospect_runs_intent_source_check'
      and pg_get_constraintdef(constraint_row.oid) like '%UNMAPPED_PRODUCT%'
  ) then raise exception 'UNMAPPED_PRODUCT run constraint is missing'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('product_resolution_events', 'taxonomy_alias_candidates')
      and column_name in (
        'raw_query', 'raw_page', 'website_url', 'email', 'phone',
        'contact_name', 'linkedin_url', 'provider_key'
      )
  ) then raise exception 'Learning table contains a prohibited field'; end if;
end
$constraints$;

-- Alias candidates remain pending even when aggregate counts grow. This
-- deliberately proves that one user/event cannot auto-publish an alias.
do $admin_review_only$
declare
  v_taxonomy_id bigint;
  v_candidate_status text;
begin
  select id into v_taxonomy_id from public.medical_product_taxonomy
  where is_active and node_type <> 'family' order by id limit 1;
  if v_taxonomy_id is null then raise exception 'Taxonomy fixture unavailable'; end if;
  insert into public.taxonomy_alias_candidates(
    normalized_phrase, phrase_signature, suggested_taxonomy_id,
    confirmation_count, verified_evidence_count, successful_discovery_count
  ) values (
    'arterial venous set', 'arterial set venous', v_taxonomy_id, 8, 3, 6
  );
  select status into v_candidate_status from public.taxonomy_alias_candidates
  where phrase_signature = 'arterial set venous'
    and suggested_taxonomy_id = v_taxonomy_id;
  if v_candidate_status <> 'PENDING_REVIEW' then
    raise exception 'Alias candidate was auto-approved';
  end if;
  if exists (
    select 1 from public.medical_product_aliases alias
    where alias.normalized_alias = 'arterial venous set'
  ) then raise exception 'Temporary phrase polluted the global alias table'; end if;
end
$admin_review_only$;

set local role anon;
do $anonymous_denial$
begin
  begin
    perform count(*) from public.product_resolution_events;
    raise exception 'Anonymous learning-event select succeeded';
  exception when insufficient_privilege then null;
  end;
end
$anonymous_denial$;
reset role;

rollback;

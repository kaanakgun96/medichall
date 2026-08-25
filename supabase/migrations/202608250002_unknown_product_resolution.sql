-- Buyer Discovery: no-dead-end resolution and bounded temporary intents.
-- Unknown phrases remain tenant-scoped learning events; global aliases remain
-- admin-reviewed and are never published by this migration.

begin;

do $preflight$
begin
  if to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.medical_product_taxonomy') is null
     or to_regprocedure('public.start_external_prospect_discovery_v2(bigint,uuid,jsonb)') is null
     or to_regprocedure('public.company_owner_authorized_v1(bigint)') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Unknown Product Resolution preflight failed';
  end if;
end
$preflight$;

create or replace function public.normalize_unknown_product_phrase_v1(p_value text)
returns text
language plpgsql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
declare
  v_value text := public.normalize_medical_product_term(p_value);
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    ['haemodialysis', 'hemodialysis'],
    ['haemofiltration', 'hemofiltration'],
    ['anaesthesia', 'anesthesia'],
    ['anaesthetic', 'anesthetic'],
    ['paediatric', 'pediatric'],
    ['orthopaedic', 'orthopedic'],
    ['oesophageal', 'esophageal'],
    ['sets', 'set'],
    ['kits', 'kit'],
    ['covers', 'cover'],
    ['sleeves', 'sleeve'],
    ['pouches', 'pouch'],
    ['gowns', 'gown'],
    ['devices', 'device'],
    ['pumps', 'pump'],
    ['bloodlines', 'bloodline'],
    ['catheters', 'catheter'],
    ['blankets', 'blanket'],
    ['drapes', 'drape'],
    ['cables', 'cable'],
    ['probes', 'probe'],
    ['packs', 'pack'],
    ['circuits', 'circuit'],
    ['consumables', 'consumable']
  ]::text[][] loop
    v_value := regexp_replace(
      v_value, '\m' || v_pair[1] || '\M', v_pair[2], 'g'
    );
  end loop;
  return trim(regexp_replace(v_value, '\s+', ' ', 'g'));
end
$function$;

create or replace function public.unknown_product_phrase_signature_v1(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  select coalesce(string_agg(token, ' ' order by token), '')
  from (
    select distinct token
    from regexp_split_to_table(public.normalize_unknown_product_phrase_v1(p_value), '\s+') token
    where token <> '' and token not in ('and', 'for', 'of', 'the', 'with')
  ) signature_tokens;
$function$;

create or replace function public.is_bounded_medical_product_phrase_v1(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  with phrase as (
    select public.normalize_unknown_product_phrase_v1(p_value) value
  )
  select length(value) between 3 and 160
    and array_length(regexp_split_to_array(value, '\s+'), 1) between 2 and 12
    and value !~ '\m(search|google|bing|crawl|scrape|fetch|prompt|select|insert|update|delete|drop|union|script|find|research|buyer|buyers|company|companies|competitor|competitors|distributor|distributors|manufacturer|manufacturers|seller|sellers|supplier|suppliers)\M'
    and value ~ '\m(medical|surgical|sterile|patient|hospital|dialysis|hemodialysis|hemofiltration|arterial|venous|blood|bloodline|ecg|ekg|irrigation|suction|laparoscopy|laparoscopic|endoscopy|endoscopic|ultrasound|catheter|cannula|wound|anesthesia|respiratory|infusion|intravenous|diagnostic|operating|procedure|fluoroscopy|microscope|probe)\M'
    and value ~ '\m(set|kit|device|equipment|cover|sleeve|drape|pouch|blanket|gown|bloodline|pump|catheter|cannula|tubing|cable|probe|dressing|pack|needle|syringe|mask|brush|tape|bag|circuit|consumable|accessory|implant|instrument|system)\M'
    and value !~ '^(medical|healthcare|hospital|product|device|equipment|solution|system|supply|supplies)( (medical|healthcare|hospital|product|device|equipment|solution|system|supply|supplies))*$'
  from phrase;
$function$;

alter table public.external_prospect_discovery_runs
  drop constraint external_prospect_runs_intent_source_check;
alter table public.external_prospect_discovery_runs
  add constraint external_prospect_runs_intent_source_check check (
    intent_source in (
      'PROFILE_PRODUCT', 'AD_HOC_PRODUCT', 'WEBSITE_DETECTED_PRODUCT',
      'UNMAPPED_PRODUCT'
    )
  );

create table public.product_resolution_events (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  idempotency_key uuid not null,
  normalized_phrase text not null check (
    length(normalized_phrase) between 3 and 160
    and normalized_phrase = public.normalize_unknown_product_phrase_v1(normalized_phrase)
  ),
  phrase_signature text not null check (
    length(phrase_signature) between 3 and 160
    and phrase_signature = public.unknown_product_phrase_signature_v1(normalized_phrase)
  ),
  resolution_status text not null check (
    resolution_status in (
      'EXACT_APPROVED', 'SUGGESTED', 'UNMAPPED', 'CONFIRMED',
      'UNMAPPED_SEARCH'
    )
  ),
  alias_candidate_eligible boolean not null default false,
  suggestions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(suggestions) = 'array'
    and jsonb_array_length(suggestions) <= 3
    and octet_length(suggestions::text) <= 8192
    and suggestions::text !~* '"(?:email|phone|whatsapp|contact|linkedin|url)"'
  ),
  confirmed_taxonomy_id bigint references public.medical_product_taxonomy(id)
    on delete set null,
  rejected_taxonomy_ids bigint[] not null default '{}',
  discovery_run_id uuid references public.external_prospect_discovery_runs(id)
    on delete set null,
  verified_evidence_count integer not null default 0 check (
    verified_evidence_count between 0 and 100
  ),
  successful_discovery_count integer not null default 0 check (
    successful_discovery_count between 0 and 1
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, idempotency_key)
);

create index product_resolution_events_company_idx
on public.product_resolution_events(company_id, created_at desc);
create index product_resolution_events_learning_idx
on public.product_resolution_events(phrase_signature, confirmed_taxonomy_id)
where confirmed_taxonomy_id is not null;
create index product_resolution_events_run_idx
on public.product_resolution_events(discovery_run_id)
where discovery_run_id is not null;

create trigger product_resolution_events_set_updated_at
before update on public.product_resolution_events
for each row execute function public.set_updated_at();

alter table public.product_resolution_events enable row level security;
alter table public.product_resolution_events force row level security;
create policy product_resolution_events_tenant_read
on public.product_resolution_events for select to authenticated
using (public.company_owner_authorized_v1(company_id));

create table public.taxonomy_alias_candidates (
  id bigint generated by default as identity primary key,
  normalized_phrase text not null check (length(normalized_phrase) between 3 and 160),
  phrase_signature text not null check (length(phrase_signature) between 3 and 160),
  suggested_taxonomy_id bigint not null references public.medical_product_taxonomy(id)
    on delete cascade,
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  rejection_count integer not null default 0 check (rejection_count >= 0),
  verified_evidence_count integer not null default 0 check (verified_evidence_count >= 0),
  successful_discovery_count integer not null default 0 check (successful_discovery_count >= 0),
  status text not null default 'PENDING_REVIEW' check (
    status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
  ),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (phrase_signature, suggested_taxonomy_id)
);

create index taxonomy_alias_candidates_review_idx
on public.taxonomy_alias_candidates(status, confirmation_count desc, updated_at desc);
create trigger taxonomy_alias_candidates_set_updated_at
before update on public.taxonomy_alias_candidates
for each row execute function public.set_updated_at();
alter table public.taxonomy_alias_candidates enable row level security;
alter table public.taxonomy_alias_candidates force row level security;

alter table public.external_prospect_discovery_runs
  add column resolution_event_id uuid references public.product_resolution_events(id)
    on delete set null;
create index external_prospect_runs_resolution_event_idx
on public.external_prospect_discovery_runs(resolution_event_id)
where resolution_event_id is not null;

create or replace function public.refresh_taxonomy_alias_candidate_v1(
  p_phrase_signature text,
  p_taxonomy_id bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  v_phrase text;
  v_confirmation_count integer;
begin
  select min(event.normalized_phrase), count(distinct event.company_id)::integer
  into v_phrase, v_confirmation_count
  from public.product_resolution_events event
  where event.phrase_signature = p_phrase_signature
    and event.confirmed_taxonomy_id = p_taxonomy_id
    and event.resolution_status = 'CONFIRMED';
  if v_phrase is null or v_confirmation_count < 2 then return; end if;

  insert into public.taxonomy_alias_candidates(
    normalized_phrase, phrase_signature, suggested_taxonomy_id
  ) values (v_phrase, p_phrase_signature, p_taxonomy_id)
  on conflict (phrase_signature, suggested_taxonomy_id) do nothing;

  update public.taxonomy_alias_candidates candidate set
    normalized_phrase = v_phrase,
    confirmation_count = aggregate.confirmations,
    rejection_count = aggregate.rejections,
    verified_evidence_count = aggregate.evidence_count,
    successful_discovery_count = aggregate.success_count,
    updated_at = clock_timestamp()
  from (
    select count(distinct event.company_id)::integer confirmations,
      coalesce(sum(cardinality(event.rejected_taxonomy_ids)), 0)::integer rejections,
      coalesce(sum(event.verified_evidence_count), 0)::integer evidence_count,
      coalesce(sum(event.successful_discovery_count), 0)::integer success_count
    from public.product_resolution_events event
    where event.phrase_signature = p_phrase_signature
      and event.confirmed_taxonomy_id = p_taxonomy_id
  ) aggregate
  where candidate.phrase_signature = p_phrase_signature
    and candidate.suggested_taxonomy_id = p_taxonomy_id
    and candidate.status = 'PENDING_REVIEW';
end
$function$;

create or replace function public.record_product_resolution_event_v1(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_normalized_phrase text,
  p_phrase_signature text,
  p_resolution_status text,
  p_suggestions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '2000ms'
as $function$
declare
  v_phrase text := public.normalize_unknown_product_phrase_v1(p_normalized_phrase);
  v_signature text := public.unknown_product_phrase_signature_v1(p_normalized_phrase);
  v_status text := upper(trim(coalesce(p_resolution_status, '')));
  v_event public.product_resolution_events%rowtype;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or v_phrase <> p_normalized_phrase
     or v_signature <> p_phrase_signature
     or v_status not in ('EXACT_APPROVED', 'SUGGESTED', 'UNMAPPED')
     or jsonb_typeof(p_suggestions) <> 'array'
     or jsonb_array_length(p_suggestions) > 3
     or octet_length(p_suggestions::text) > 8192 then
    raise exception 'Invalid bounded product-resolution event' using errcode = '22023';
  end if;
  if v_status = 'UNMAPPED' and not public.is_bounded_medical_product_phrase_v1(v_phrase) then
    raise exception 'A specific medical product phrase is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_suggestions) suggestion
    where not coalesce(suggestion->>'canonical_taxonomy_id', '') ~ '^[0-9]{1,18}$'
       or not exists (
         select 1 from public.medical_product_taxonomy taxonomy
         where taxonomy.id = (suggestion->>'canonical_taxonomy_id')::bigint
           and taxonomy.is_active
       )
  ) then
    raise exception 'Resolution suggestions contain an unavailable taxonomy category'
      using errcode = '22023';
  end if;

  insert into public.product_resolution_events(
    company_id, requested_by, idempotency_key, normalized_phrase,
    phrase_signature, resolution_status, alias_candidate_eligible, suggestions
  ) values (
    p_company_id, auth.uid(), p_idempotency_key, v_phrase,
    v_signature, v_status, v_status = 'SUGGESTED', p_suggestions
  ) on conflict (company_id, idempotency_key) do nothing
  returning * into v_event;
  if v_event.id is null then
    select * into v_event from public.product_resolution_events
    where company_id = p_company_id and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object(
    'resolution_event_id', v_event.id,
    'resolution_status', v_event.resolution_status,
    'reused', v_event.created_at < clock_timestamp() - interval '1 millisecond'
  );
end
$function$;

create or replace function public.record_product_resolution_outcome_v1(
  p_run_id uuid,
  p_verified_evidence_count integer,
  p_successful_discovery_count integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  v_event public.product_resolution_events%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_verified_evidence_count not between 0 and 100
     or p_successful_discovery_count not between 0 and 1 then
    raise exception 'Invalid bounded resolution outcome' using errcode = '22023';
  end if;
  update public.product_resolution_events event set
    verified_evidence_count = greatest(event.verified_evidence_count, p_verified_evidence_count),
    successful_discovery_count = greatest(event.successful_discovery_count, p_successful_discovery_count),
    updated_at = clock_timestamp()
  where event.discovery_run_id = p_run_id;
  for v_event in
    select distinct on (event.phrase_signature, event.confirmed_taxonomy_id)
      event.*
    from public.product_resolution_events event
    where event.discovery_run_id = p_run_id
      and event.alias_candidate_eligible
      and event.confirmed_taxonomy_id is not null
      and event.resolution_status = 'CONFIRMED'
    order by event.phrase_signature, event.confirmed_taxonomy_id,
      event.created_at desc
  loop
    perform public.refresh_taxonomy_alias_candidate_v1(
      v_event.phrase_signature, v_event.confirmed_taxonomy_id
    );
  end loop;
end
$function$;

create or replace function public.get_taxonomy_alias_candidates_v1(
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '1500ms'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(candidate_row) order by
    candidate_row.confirmation_count desc, candidate_row.updated_at desc), '[]'::jsonb)
  into v_result
  from (
    select candidate.id, candidate.normalized_phrase,
      candidate.suggested_taxonomy_id, taxonomy.canonical_name,
      candidate.confirmation_count, candidate.rejection_count,
      candidate.verified_evidence_count, candidate.successful_discovery_count,
      candidate.status, candidate.created_at, candidate.updated_at
    from public.taxonomy_alias_candidates candidate
    join public.medical_product_taxonomy taxonomy
      on taxonomy.id = candidate.suggested_taxonomy_id
    order by candidate.confirmation_count desc, candidate.updated_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) candidate_row;
  return v_result;
end
$function$;

create or replace function public.start_external_prospect_discovery_v2(
  p_company_id bigint,
  p_idempotency_key uuid,
  p_intent jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '3500ms'
as $function$
declare
  v_profile public.matchmaking_profiles%rowtype;
  v_source text := upper(trim(coalesce(p_intent->>'intent_source', '')));
  v_taxonomy_ids bigint[];
  v_target_countries text[];
  v_taxonomy jsonb;
  v_label text;
  v_phrase text;
  v_signature text;
  v_resolution_event public.product_resolution_events%rowtype;
  v_context jsonb;
  v_intent_hash text;
  v_existing public.external_prospect_discovery_runs%rowtype;
  v_daily integer;
  v_monthly integer;
  v_run public.external_prospect_discovery_runs%rowtype;
begin
  if auth.uid() is null or not public.company_owner_authorized_v1(p_company_id) then
    raise exception 'Company access denied' using errcode = '42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_intent) <> 'object'
     or octet_length(p_intent::text) > 4096 then
    raise exception 'Valid bounded discovery intent is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_intent) as keys(key)
    where keys.key not in (
      'intent_source', 'taxonomy_ids', 'target_countries',
      'normalized_product_phrase', 'resolution_event_id'
    )
  ) then
    raise exception 'Unsupported discovery intent field' using errcode = '22023';
  end if;
  if v_source not in (
    'PROFILE_PRODUCT', 'AD_HOC_PRODUCT', 'WEBSITE_DETECTED_PRODUCT',
    'UNMAPPED_PRODUCT'
  ) then
    raise exception 'Unsupported discovery intent source' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_intent->'target_countries', '[]'::jsonb)) <> 'array' then
    raise exception 'Discovery intent arrays are invalid' using errcode = '22023';
  end if;

  select * into v_profile from public.matchmaking_profiles
  where company_id = p_company_id and is_active;
  if v_profile.id is null or v_profile.role <> 'manufacturer' then
    raise exception 'Buyer Discovery requires an active manufacturer match profile'
      using errcode = '22023';
  end if;

  select array_agg(distinct value::bigint order by value::bigint)
  into v_taxonomy_ids
  from jsonb_array_elements_text(coalesce(p_intent->'taxonomy_ids', '[]'::jsonb)) value
  where value ~ '^[0-9]{1,18}$';
  v_taxonomy_ids := coalesce(v_taxonomy_ids, '{}'::bigint[]);

  if v_source = 'PROFILE_PRODUCT' and cardinality(v_taxonomy_ids) = 0 then
    select coalesce(array_agg(distinct mapping.taxonomy_id order by mapping.taxonomy_id), '{}'::bigint[])
    into v_taxonomy_ids
    from public.products product
    join public.product_taxonomy_mappings mapping
      on mapping.product_id = product.id and mapping.status = 'approved' and mapping.is_primary
    join public.medical_product_taxonomy taxonomy
      on taxonomy.id = mapping.taxonomy_id and taxonomy.is_active
    where product.company_id = p_company_id and product.is_active;
  end if;

  if v_source = 'UNMAPPED_PRODUCT' then
    v_phrase := public.normalize_unknown_product_phrase_v1(
      p_intent->>'normalized_product_phrase'
    );
    v_signature := public.unknown_product_phrase_signature_v1(v_phrase);
    if cardinality(v_taxonomy_ids) <> 0
       or v_phrase <> coalesce(p_intent->>'normalized_product_phrase', '')
       or not public.is_bounded_medical_product_phrase_v1(v_phrase)
       or coalesce(p_intent->>'resolution_event_id', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'A bounded unmapped medical-product intent is required'
        using errcode = '22023';
    end if;
    select * into v_resolution_event from public.product_resolution_events event
    where event.id = (p_intent->>'resolution_event_id')::uuid
      and event.company_id = p_company_id
      and event.phrase_signature = v_signature
      and event.resolution_status in ('UNMAPPED', 'UNMAPPED_SEARCH');
    if v_resolution_event.id is null then
      raise exception 'Product resolution event is unavailable' using errcode = '42501';
    end if;
    v_label := initcap(v_phrase);
    v_taxonomy := '[]'::jsonb;
  else
    if cardinality(v_taxonomy_ids) < 1 or cardinality(v_taxonomy_ids) > 8 then
      raise exception 'Select between one and eight confirmed medical product categories'
        using errcode = '22023';
    end if;
    if v_source = 'PROFILE_PRODUCT' and exists (
      select 1 from unnest(v_taxonomy_ids) requested_id
      where not exists (
        select 1 from public.products product
        join public.product_taxonomy_mappings mapping
          on mapping.product_id = product.id and mapping.status = 'approved' and mapping.is_primary
        where product.company_id = p_company_id and product.is_active
          and mapping.taxonomy_id = requested_id
      )
    ) then
      raise exception 'Profile-product intent contains a category outside this company'
        using errcode = '42501';
    end if;
    if (select count(*) from public.medical_product_taxonomy taxonomy
        where taxonomy.id = any(v_taxonomy_ids) and taxonomy.is_active)
       <> cardinality(v_taxonomy_ids) then
      raise exception 'Discovery intent contains an unavailable taxonomy category'
        using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object(
        'taxonomy_id', taxonomy.id,
        'canonical_name', taxonomy.canonical_name,
        'slug', taxonomy.slug,
        'node_type', taxonomy.node_type,
        'cpv_codes', case
          when taxonomy.slug ~ '(drape|gown|pack|cover|pouch|tape|dressing|bandage|adhesive|sterilization)' then '["33140000"]'::jsonb
          when taxonomy.slug ~ '(imaging|anesthesia|ventilation|equipment)' then '["33100000"]'::jsonb
          else '["33190000"]'::jsonb
        end
      ) order by taxonomy.id),
      string_agg(taxonomy.canonical_name, ', ' order by taxonomy.canonical_name)
    into v_taxonomy, v_label
    from public.medical_product_taxonomy taxonomy
    where taxonomy.id = any(v_taxonomy_ids) and taxonomy.is_active;

    if v_source = 'AD_HOC_PRODUCT'
       and nullif(p_intent->>'resolution_event_id', '') is not null then
      select * into v_resolution_event from public.product_resolution_events event
      where event.id = (p_intent->>'resolution_event_id')::uuid
        and event.company_id = p_company_id
        and event.resolution_status in ('EXACT_APPROVED', 'SUGGESTED', 'CONFIRMED');
      if v_resolution_event.id is null or cardinality(v_taxonomy_ids) <> 1
         or not exists (
           select 1 from jsonb_array_elements(v_resolution_event.suggestions) suggestion
           where (suggestion->>'canonical_taxonomy_id')::bigint = v_taxonomy_ids[1]
         ) then
        raise exception 'Confirmed product resolution is unavailable' using errcode = '42501';
      end if;
      v_phrase := v_resolution_event.normalized_phrase;
      v_signature := v_resolution_event.phrase_signature;
    end if;
  end if;

  select coalesce(array_agg(distinct upper(value) order by upper(value)), '{}'::text[])
  into v_target_countries
  from jsonb_array_elements_text(coalesce(p_intent->'target_countries', '[]'::jsonb)) value
  where value ~ '^[A-Za-z]{2}$';
  if jsonb_array_length(coalesce(p_intent->'target_countries', '[]'::jsonb))
     <> cardinality(v_target_countries) or cardinality(v_target_countries) > 32 then
    raise exception 'Target countries must be unique two-letter country codes'
      using errcode = '22023';
  end if;

  v_context := jsonb_build_object(
    'intent_source', v_source,
    'normalized_product_label', v_label,
    'normalized_product_phrase', v_phrase,
    'taxonomy', coalesce(v_taxonomy, '[]'::jsonb),
    'target_countries', to_jsonb(v_target_countries),
    'country_scope', case when cardinality(v_target_countries) = 0 then 'EUROPE_WIDE' else 'SELECTED_COUNTRIES' end,
    'temporary_intent', v_source = 'UNMAPPED_PRODUCT'
  );
  v_intent_hash := encode(digest(jsonb_build_object(
    'intent_source', v_source,
    'taxonomy_ids', to_jsonb(v_taxonomy_ids),
    'phrase_signature', case when v_source = 'UNMAPPED_PRODUCT' then v_signature else null end,
    'target_countries', to_jsonb(v_target_countries)
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('external-prospect:' || p_company_id::text, 823));
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'idempotency_key');
  end if;
  select * into v_existing from public.external_prospect_discovery_runs
  where company_id = p_company_id and intent_hash = v_intent_hash
    and created_at >= clock_timestamp() - interval '24 hours'
  order by created_at desc limit 1;
  if v_existing.id is not null then
    if v_resolution_event.id is not null then
      update public.product_resolution_events set
        resolution_status = case when v_source = 'UNMAPPED_PRODUCT'
          then 'UNMAPPED_SEARCH' else 'CONFIRMED' end,
        confirmed_taxonomy_id = case when v_source = 'AD_HOC_PRODUCT'
          then v_taxonomy_ids[1] else null end,
        discovery_run_id = v_existing.id,
        updated_at = clock_timestamp()
      where id = v_resolution_event.id;
    end if;
    if v_resolution_event.resolution_status = 'SUGGESTED' then
      perform public.refresh_taxonomy_alias_candidate_v1(v_signature, v_taxonomy_ids[1]);
    end if;
    return jsonb_build_object('run_id', v_existing.id, 'status', v_existing.status,
      'stage', v_existing.stage, 'intent_hash', v_existing.intent_hash,
      'intent_context', v_existing.intent_context, 'reused', true,
      'reason', 'cached_intent');
  end if;
  if exists (
    select 1 from public.external_prospect_discovery_runs
    where company_id = p_company_id and created_at >= clock_timestamp() - interval '30 minutes'
  ) then
    raise exception 'Discovery cooldown is active' using errcode = 'P0001';
  end if;
  select count(*)::integer into v_daily from public.external_prospect_discovery_runs
  where company_id = p_company_id and created_at >= date_trunc('day', clock_timestamp());
  select count(*)::integer into v_monthly from public.external_prospect_discovery_runs
  where company_id = p_company_id and created_at >= date_trunc('month', clock_timestamp());
  if v_daily >= 3 then raise exception 'Daily discovery limit reached' using errcode = 'P0001'; end if;
  if v_monthly >= 20 then raise exception 'Monthly discovery limit reached' using errcode = 'P0001'; end if;

  insert into public.external_prospect_discovery_runs(
    company_id, requested_by, idempotency_key, intent_hash, intent_source,
    intent_context, resolution_event_id
  ) values (
    p_company_id, auth.uid(), p_idempotency_key, v_intent_hash, v_source,
    v_context, v_resolution_event.id
  ) returning * into v_run;
  if v_resolution_event.id is not null then
    update public.product_resolution_events set
      resolution_status = case when v_source = 'UNMAPPED_PRODUCT'
        then 'UNMAPPED_SEARCH' else 'CONFIRMED' end,
      confirmed_taxonomy_id = case when v_source = 'AD_HOC_PRODUCT'
        then v_taxonomy_ids[1] else null end,
      discovery_run_id = v_run.id,
      updated_at = clock_timestamp()
    where id = v_resolution_event.id;
  end if;
  if v_resolution_event.resolution_status = 'SUGGESTED' then
    perform public.refresh_taxonomy_alias_candidate_v1(v_signature, v_taxonomy_ids[1]);
  end if;
  return jsonb_build_object('run_id', v_run.id, 'status', v_run.status,
    'stage', v_run.stage, 'intent_hash', v_run.intent_hash,
    'intent_context', v_run.intent_context, 'reused', false, 'reason', 'created');
end
$function$;

revoke all on table public.product_resolution_events,
  public.taxonomy_alias_candidates from public, anon, authenticated;
grant select on table public.product_resolution_events to authenticated;
grant all on table public.product_resolution_events,
  public.taxonomy_alias_candidates to service_role;
grant usage, select on sequence public.taxonomy_alias_candidates_id_seq
  to service_role;

revoke all on function public.normalize_unknown_product_phrase_v1(text),
  public.unknown_product_phrase_signature_v1(text),
  public.is_bounded_medical_product_phrase_v1(text),
  public.refresh_taxonomy_alias_candidate_v1(text,bigint),
  public.record_product_resolution_event_v1(bigint,uuid,text,text,text,jsonb),
  public.record_product_resolution_outcome_v1(uuid,integer,integer),
  public.get_taxonomy_alias_candidates_v1(integer)
from public, anon, authenticated;
grant execute on function public.normalize_unknown_product_phrase_v1(text),
  public.unknown_product_phrase_signature_v1(text),
  public.is_bounded_medical_product_phrase_v1(text)
to authenticated, service_role;
grant execute on function public.record_product_resolution_event_v1(bigint,uuid,text,text,text,jsonb),
  public.get_taxonomy_alias_candidates_v1(integer)
to authenticated, service_role;
grant execute on function public.refresh_taxonomy_alias_candidate_v1(text,bigint),
  public.record_product_resolution_outcome_v1(uuid,integer,integer)
to service_role;

comment on table public.product_resolution_events is
  'Tenant-private normalized product-resolution learning events. No contacts, URLs, raw pages or provider queries.';
comment on table public.taxonomy_alias_candidates is
  'Privacy-safe aggregate alias candidates. Permanent aliases still require explicit admin review.';
comment on function public.start_external_prospect_discovery_v2(bigint,uuid,jsonb) is
  'Company-scoped rate/idempotency gate for confirmed taxonomy and bounded UNMAPPED_PRODUCT discovery intents.';

commit;

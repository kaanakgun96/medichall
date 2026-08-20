-- External Prospect Discovery: European official-registry coverage controls.
-- This forward-only migration adds reviewed activity-code provenance and a
-- service-only cache for normalized legal-entity registry responses. It does
-- not add contact fields, outreach, email, AI, or browser-writable surfaces.

begin;

do $preflight$
begin
  if to_regclass('public.external_companies') is null
     or to_regclass('public.external_company_activities') is null
     or to_regprocedure('public.get_admin_external_prospect_metrics_v1()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'External registry coverage preflight failed';
  end if;
end
$preflight$;

alter table public.external_company_activities
add column mapping_confidence text not null default 'UNMAPPED'
check (mapping_confidence in ('HIGH', 'MEDIUM', 'LOW', 'UNMAPPED'));

update public.external_company_activities
set mapping_confidence = case
  when provider_code in ('FR_RECHERCHE_ENTREPRISES', 'NO_BRREG_ENHETSREGISTERET')
    and normalized_nace_code = '46.46' then 'HIGH'
  when normalized_nace_code is not null then 'MEDIUM'
  else 'UNMAPPED'
end;

create table public.external_registry_request_cache (
  provider_code text not null check (provider_code ~ '^[A-Z0-9_]{3,80}$'),
  request_key_hash text not null check (request_key_hash ~ '^[a-f0-9]{64}$'),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  source_url text not null check (
    source_url ~ '^https://[^[:space:]]+$' and length(source_url) <= 1600
  ),
  normalized_candidates jsonb not null default '[]'::jsonb check (
    jsonb_typeof(normalized_candidates) = 'array'
    and lower(normalized_candidates::text) !~
      '"(email|e-mail|phone|telephone|mobile|contact|contact_name|linkedin|person|employee|director|officer|shareholder)"[[:space:]]*:'
  ),
  fetch_status text not null check (fetch_status in ('ACTIVE', 'UNAVAILABLE')),
  fetched_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > fetched_at),
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{3,80}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (provider_code, request_key_hash)
);

create index external_registry_request_cache_expiry_idx
on public.external_registry_request_cache(expires_at, provider_code);

create trigger external_registry_request_cache_set_updated_at
before update on public.external_registry_request_cache
for each row execute function public.set_updated_at();

alter table public.external_registry_request_cache enable row level security;
alter table public.external_registry_request_cache force row level security;

revoke all on table public.external_registry_request_cache
from public, anon, authenticated;
grant all on table public.external_registry_request_cache to service_role;

create or replace function public.get_admin_external_prospect_metrics_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '3000ms'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'external_entities', (select count(*) from public.external_companies where duplicate_status = 'ACTIVE'),
    'not_on_medichall', (select count(*) from public.external_companies where membership_status = 'NOT_ON_MEDICHALL' and duplicate_status = 'ACTIVE'),
    'promoted_to_medichall', (select count(*) from public.external_companies where membership_status = 'ON_MEDICHALL'),
    'evidence_records', (select count(*) from public.external_company_evidence),
    'stale_evidence', (select count(*) from public.external_company_evidence
      where verification_status = 'STALE'
         or last_verified_at < now() - interval '365 days'),
    'source_mix', coalesce((select jsonb_object_agg(source_type, source_count)
      from (select source_type, count(*) as source_count
        from public.external_company_evidence group by source_type) source_counts), '{}'::jsonb),
    'registry_activity_records', (select count(*) from public.external_company_activities),
    'registry_activity_countries', coalesce((select jsonb_object_agg(jurisdiction_country_code, activity_count)
      from (select jurisdiction_country_code, count(*) as activity_count
        from public.external_company_activities group by jurisdiction_country_code) country_counts), '{}'::jsonb),
    'registry_adapter_usage', coalesce((select jsonb_object_agg(provider_code, activity_count)
      from (select provider_code, count(*) as activity_count
        from public.external_company_activities group by provider_code) provider_counts), '{}'::jsonb),
    'registry_cache_entries', (select count(*) from public.external_registry_request_cache),
    'registry_cache_hits', (select coalesce(sum(hit_count), 0) from public.external_registry_request_cache),
    'registry_cache_failures', (select coalesce(sum(failure_count), 0) from public.external_registry_request_cache),
    'tenant_matches', (select count(*) from public.company_external_prospect_matches),
    'saved', (select count(*) from public.company_external_prospect_matches where workflow_status in ('SAVED', 'INTERESTING')),
    'dismissed', (select count(*) from public.company_external_prospect_matches where workflow_status = 'DISMISSED'),
    'new_discoveries_30d', (select count(*) from public.external_companies
      where first_discovered_at >= now() - interval '30 days'),
    'runs_30d', (select count(*) from public.external_prospect_discovery_runs where created_at >= now() - interval '30 days'),
    'completed_30d', (select count(*) from public.external_prospect_discovery_runs where status in ('COMPLETED', 'PARTIAL') and created_at >= now() - interval '30 days'),
    'failed_30d', (select count(*) from public.external_prospect_discovery_runs where status = 'FAILED' and created_at >= now() - interval '30 days'),
    'provider_requests_30d', (select coalesce(sum(provider_requests), 0) from public.external_prospect_discovery_runs where created_at >= now() - interval '30 days'),
    'estimated_cost_usd_30d', (select coalesce(sum(estimated_cost_usd), 0) from public.external_prospect_discovery_runs where created_at >= now() - interval '30 days')
  ) into v_result;
  return v_result;
end
$function$;

revoke all on function public.get_admin_external_prospect_metrics_v1()
from public, anon;
grant execute on function public.get_admin_external_prospect_metrics_v1()
to authenticated, service_role;

comment on column public.external_company_activities.mapping_confidence is
  'Confidence of the reviewed national activity-code to common NACE mapping; never direct product evidence.';
comment on table public.external_registry_request_cache is
  'Service-only normalized official-registry response cache. Legal entities and activity fields only; no personal contacts.';

commit;

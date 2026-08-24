-- Buyer Discovery V2.2: service-only public-web candidate cache and bounded
-- provider-request accounting. Search hits are candidate generation only;
-- the table deliberately stores no snippet, raw query, contact, or evidence.

begin;

do $preflight$
begin
  if to_regclass('public.external_prospect_discovery_runs') is null
     or to_regclass('public.external_registry_request_cache') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Buyer Discovery V2.2 preflight failed';
  end if;
end
$preflight$;

alter table public.external_prospect_discovery_runs
  drop constraint if exists external_prospect_discovery_runs_provider_requests_check;
alter table public.external_prospect_discovery_runs
  add constraint external_prospect_runs_provider_requests_bounded_check
  check (provider_requests between 0 and 6);

create table public.external_public_web_request_cache (
  provider_code text not null check (provider_code ~ '^[A-Z0-9_]{3,80}$'),
  request_key_hash text not null check (request_key_hash ~ '^[a-f0-9]{64}$'),
  product_family_key text not null check (
    product_family_key ~ '^[a-z0-9][a-z0-9+_-]{2,119}$'
  ),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  search_language text not null check (search_language ~ '^[a-z]{2,3}$'),
  query_variant smallint not null check (query_variant between 0 and 5),
  normalized_candidates jsonb not null default '[]'::jsonb check (
    jsonb_typeof(normalized_candidates) = 'array'
    and jsonb_array_length(normalized_candidates) <= 20
    and octet_length(normalized_candidates::text) <= 65536
    and lower(normalized_candidates::text) !~
      '"(snippet|description|raw_query|query|email|e-mail|phone|telephone|mobile|whatsapp|contact|contact_name|linkedin|person|employee|director|officer|shareholder)"[[:space:]]*:'
  ),
  fetch_status text not null check (
    fetch_status in ('ACTIVE', 'ZERO_RESULTS', 'UNAVAILABLE')
  ),
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

create index external_public_web_request_cache_expiry_idx
on public.external_public_web_request_cache(expires_at, provider_code);

create trigger external_public_web_request_cache_set_updated_at
before update on public.external_public_web_request_cache
for each row execute function public.set_updated_at();

alter table public.external_public_web_request_cache enable row level security;
alter table public.external_public_web_request_cache force row level security;

revoke all on table public.external_public_web_request_cache
from public, anon, authenticated;
grant all on table public.external_public_web_request_cache to service_role;

comment on table public.external_public_web_request_cache is
  'Service-only normalized public-web candidate cache. Search results provide candidate domains only and never count as relevance evidence.';
comment on column public.external_public_web_request_cache.normalized_candidates is
  'Bounded company name/domain/page URL records only. No snippets, raw queries, personal contacts, or provider secrets.';
comment on column public.external_prospect_discovery_runs.provider_requests is
  'Bounded server-side public-web search request count. AI classifications remain permanently zero.';

commit;

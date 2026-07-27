-- Add the minimum canonical company-product profile required by lot-match-v1.
-- Existing catalog columns, rows, policies, and product URLs remain unchanged.

create or replace function public.product_profile_text_array_valid(
  p_value text[],
  p_max_items integer,
  p_max_length integer
)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select
    cardinality(p_value) <= p_max_items
    and not exists (
      select 1
      from unnest(p_value) item
      where item is null
        or btrim(item) = ''
        or length(item) > p_max_length
    );
$$;

create or replace function public.product_profile_sources_valid(
  p_value jsonb
)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select
    jsonb_typeof(p_value) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(p_value) entry
      where entry.key not in (
        'normalized_category',
        'product_subtype',
        'material',
        'dimensions',
        'sterility_status',
        'use_type',
        'packaging_description',
        'units_per_package',
        'product_certifications',
        'regulatory_class',
        'sterilization_method',
        'production_capacity',
        'capacity_unit',
        'capacity_period',
        'technical_specifications'
      )
      or entry.value not in ('explicit', 'derived', 'unknown')
    );
$$;

alter table public.products
  add column if not exists normalized_category text,
  add column if not exists product_subtype text,
  add column if not exists material text,
  add column if not exists dimensions text,
  add column if not exists sterility_status text not null default 'unknown',
  add column if not exists use_type text not null default 'unknown',
  add column if not exists packaging_description text,
  add column if not exists units_per_package integer,
  add column if not exists product_certifications text[] not null default '{}',
  add column if not exists regulatory_class text,
  add column if not exists sterilization_method text,
  add column if not exists production_capacity numeric,
  add column if not exists capacity_unit text,
  add column if not exists capacity_period text,
  add column if not exists technical_specifications text[] not null default '{}',
  add column if not exists matching_profile_sources jsonb not null default '{}';

alter table public.products
  drop constraint if exists products_normalized_category_check,
  add constraint products_normalized_category_check check (
    normalized_category is null
    or (
      length(normalized_category) <= 120
      and normalized_category ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
    )
  ),
  drop constraint if exists products_product_subtype_check,
  add constraint products_product_subtype_check check (
    product_subtype is null or length(product_subtype) <= 160
  ),
  drop constraint if exists products_material_check,
  add constraint products_material_check check (
    material is null or length(material) <= 500
  ),
  drop constraint if exists products_dimensions_check,
  add constraint products_dimensions_check check (
    dimensions is null or length(dimensions) <= 1000
  ),
  drop constraint if exists products_sterility_status_check,
  add constraint products_sterility_status_check check (
    sterility_status in ('sterile', 'non_sterile', 'unknown')
  ),
  drop constraint if exists products_use_type_check,
  add constraint products_use_type_check check (
    use_type in ('single_use', 'reusable', 'unknown')
  ),
  drop constraint if exists products_packaging_description_check,
  add constraint products_packaging_description_check check (
    packaging_description is null
    or length(packaging_description) <= 1000
  ),
  drop constraint if exists products_units_per_package_check,
  add constraint products_units_per_package_check check (
    units_per_package is null
    or units_per_package between 1 and 10000000
  ),
  drop constraint if exists products_product_certifications_check,
  add constraint products_product_certifications_check check (
    public.product_profile_text_array_valid(
      product_certifications,
      30,
      120
    )
  ),
  drop constraint if exists products_regulatory_class_check,
  add constraint products_regulatory_class_check check (
    regulatory_class is null or length(regulatory_class) <= 120
  ),
  drop constraint if exists products_sterilization_method_check,
  add constraint products_sterilization_method_check check (
    sterilization_method is null
    or (
      sterility_status = 'sterile'
      and sterilization_method in (
        'EO',
        'gamma',
        'steam',
        'e-beam',
        'plasma',
        'other'
      )
    )
  ),
  drop constraint if exists products_production_capacity_check,
  add constraint products_production_capacity_check check (
    production_capacity is null
    or production_capacity between 0.000001 and 1000000000000
  ),
  drop constraint if exists products_capacity_unit_check,
  add constraint products_capacity_unit_check check (
    capacity_unit is null
    or capacity_unit in (
      'pieces',
      'boxes',
      'packs',
      'sets',
      'kg',
      'litres',
      'metres',
      'm²'
    )
  ),
  drop constraint if exists products_capacity_period_check,
  add constraint products_capacity_period_check check (
    capacity_period is null
    or capacity_period in ('day', 'week', 'month', 'year')
  ),
  drop constraint if exists products_capacity_completeness_check,
  add constraint products_capacity_completeness_check check (
    (
      production_capacity is null
      and capacity_unit is null
      and capacity_period is null
    )
    or (
      production_capacity is not null
      and capacity_unit is not null
      and capacity_period is not null
    )
  ),
  drop constraint if exists products_technical_specifications_check,
  add constraint products_technical_specifications_check check (
    public.product_profile_text_array_valid(
      technical_specifications,
      50,
      500
    )
  ),
  drop constraint if exists products_matching_profile_sources_check,
  add constraint products_matching_profile_sources_check check (
    public.product_profile_sources_valid(matching_profile_sources)
  );

comment on column public.products.normalized_category is
  'Canonical deterministic product category used by lot-match-v1.';
comment on column public.products.product_certifications is
  'Product-specific certifications only; company certifications remain on companies and company_match_profiles.';
comment on column public.products.matching_profile_sources is
  'Per-field provenance restricted to explicit, derived, or unknown.';

revoke all on function public.product_profile_text_array_valid(
  text[],
  integer,
  integer
) from public, anon;
revoke all on function public.product_profile_sources_valid(jsonb)
  from public, anon;
grant execute on function public.product_profile_text_array_valid(
  text[],
  integer,
  integer
) to authenticated, service_role;
grant execute on function public.product_profile_sources_valid(jsonb)
  to authenticated, service_role;

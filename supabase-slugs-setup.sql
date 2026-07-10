-- ============================================================
-- MedicHall — Step 13: company profile URLs (medichall.com/m/company-name)
-- Run ONCE in Supabase Dashboard -> SQL Editor
-- ============================================================

-- 1) slug column
alter table public.companies
  add column if not exists slug text;

-- 2) auto-generate a clean slug from the company name
--    (handles Turkish characters: ç->c, ğ->g, ı->i, ö->o, ş->s, ü->u)
create or replace function public.set_company_slug()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := regexp_replace(
                  regexp_replace(
                    translate(lower(new.name), 'çğıöşüâîû', 'cgiosuaiu'),
                    '[^a-z0-9]+', '-', 'g'),
                  '(^-+|-+$)', '', 'g');
    if new.slug is null or new.slug = '' then new.slug := 'company'; end if;
    while exists (select 1 from public.companies
                  where slug = new.slug and id is distinct from new.id) loop
      new.slug := new.slug || '-' || (floor(random()*9000)+1000)::int;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists company_slug on public.companies;
create trigger company_slug
  before insert or update on public.companies
  for each row execute function public.set_company_slug();

-- 3) generate slugs for all existing companies
update public.companies set slug = null;

-- 4) keep slugs unique
create unique index if not exists companies_slug_idx on public.companies (slug);

-- Check the result:
-- select id, name, slug from public.companies order by name;

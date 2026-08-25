-- Buyer Discovery V2.3: reviewed deterministic equipment-cover terminology.
-- These aliases extend the existing Medical Product Taxonomy; no parallel
-- taxonomy or runtime translation layer is introduced.

begin;

do $taxonomy_guard$
begin
  if exists (
    select 1
    from (values
      ('equipment-covers'),
      ('camera-covers'),
      ('c-arm-covers'),
      ('microscope-drapes')
    ) required(slug)
    where not exists (
      select 1 from public.medical_product_taxonomy taxonomy
      where taxonomy.slug = required.slug and taxonomy.is_active
    )
  ) then
    raise exception 'Buyer Discovery V2.3 requires the existing equipment-cover taxonomy nodes';
  end if;
end
$taxonomy_guard$;

with reviewed_aliases(taxonomy_slug, alias_text, language_code, confidence) as (
  values
    -- Camera Cover: reviewed English commercial terminology.
    ('camera-covers', 'Camera Cover', 'en', 1.0000),
    ('camera-covers', 'Surgical Camera Cover', 'en', 1.0000),
    ('camera-covers', 'Sterile Camera Cover', 'en', 1.0000),
    ('camera-covers', 'Camera Drape', 'en', 1.0000),
    ('camera-covers', 'Camera Sleeve', 'en', 1.0000),
    ('camera-covers', 'Sterile Camera Sleeve', 'en', 1.0000),
    ('camera-covers', 'Endoscopic Camera Cover', 'en', 1.0000),
    ('camera-covers', 'Endoscopy Camera Cover', 'en', 0.9900),
    ('camera-covers', 'Video Camera Cover', 'en', 0.9900),
    ('camera-covers', 'Camera Sheath', 'en', 0.9900),
    ('camera-covers', 'Sterile Camera Sheath', 'en', 1.0000),
    ('camera-covers', 'Camera Protective Cover', 'en', 0.9900),
    ('camera-covers', 'Camera Equipment Cover', 'en', 0.9900),
    ('camera-covers', 'Sterile Camera Drape', 'en', 1.0000),
    ('camera-covers', 'Surgical Video Camera Cover', 'en', 0.9900),
    ('camera-covers', 'Sterile Video Camera Sleeve', 'en', 0.9900),

    -- Camera Cover: reviewed European-language equivalents.
    ('camera-covers', 'Copri telecamera', 'it', 1.0000),
    ('camera-covers', 'Copertura telecamera', 'it', 0.9900),
    ('camera-covers', 'Guaina per telecamera', 'it', 0.9900),
    ('camera-covers', 'Copri videocamera', 'it', 0.9900),
    ('camera-covers', 'Housse caméra', 'fr', 1.0000),
    ('camera-covers', 'Gaine caméra', 'fr', 0.9900),
    ('camera-covers', 'Protection caméra stérile', 'fr', 0.9900),
    ('camera-covers', 'Funda de cámara', 'es', 1.0000),
    ('camera-covers', 'Cubierta de cámara', 'es', 0.9900),
    ('camera-covers', 'Funda estéril para cámara', 'es', 1.0000),
    ('camera-covers', 'Kameraabdeckung', 'de', 1.0000),
    ('camera-covers', 'Kamerahülle', 'de', 0.9900),
    ('camera-covers', 'Sterile Kameraabdeckung', 'de', 1.0000),
    ('camera-covers', 'Camerahoes', 'nl', 1.0000),
    ('camera-covers', 'Camera hoes', 'nl', 1.0000),
    ('camera-covers', 'Steriele camerabescherming', 'nl', 0.9900),

    -- C-Arm Cover: punctuation variants normalize through the existing
    -- taxonomy function, so one reviewed row covers C-Arm and C Arm forms.
    ('c-arm-covers', 'C-Arm Cover', 'en', 1.0000),
    ('c-arm-covers', 'C-Arm Drape', 'en', 1.0000),
    ('c-arm-covers', 'C-Arm Equipment Cover', 'en', 1.0000),
    ('c-arm-covers', 'C-Arm Protective Cover', 'en', 1.0000),
    ('c-arm-covers', 'Sterile C-Arm Cover', 'en', 1.0000),
    ('c-arm-covers', 'Sterile C-Arm Drape', 'en', 1.0000),
    ('c-arm-covers', 'Image Intensifier Cover', 'en', 0.9900),
    ('c-arm-covers', 'Image Intensifier Drape', 'en', 0.9900),
    ('c-arm-covers', 'Fluoroscopy Equipment Cover', 'en', 0.9900),
    ('c-arm-covers', 'Copertura sterile arco a C', 'it', 0.9900),
    ('c-arm-covers', 'Telo arco a C', 'it', 0.9800),
    ('c-arm-covers', 'Housse arceau chirurgical', 'fr', 0.9900),
    ('c-arm-covers', 'Housse amplificateur de brillance', 'fr', 0.9900),
    ('c-arm-covers', 'Funda estéril arco en C', 'es', 0.9900),
    ('c-arm-covers', 'Funda para arco en C', 'es', 0.9900),
    ('c-arm-covers', 'Fundas para arco en C', 'es', 0.9900),
    ('c-arm-covers', 'C-Bogen Abdeckung', 'de', 0.9900),
    ('c-arm-covers', 'Sterile C-Bogen Hülle', 'de', 0.9900),
    ('c-arm-covers', 'Steriele C-boog hoes', 'nl', 0.9900),
    ('c-arm-covers', 'C-boog afdekhoes', 'nl', 0.9800),

    -- Microscope Cover / Drape.
    ('microscope-drapes', 'Microscope Cover', 'en', 1.0000),
    ('microscope-drapes', 'Microscope Drape', 'en', 1.0000),
    ('microscope-drapes', 'Sterile Microscope Cover', 'en', 1.0000),
    ('microscope-drapes', 'Sterile Microscope Drape', 'en', 1.0000),
    ('microscope-drapes', 'Microscope Sleeve', 'en', 0.9900),
    ('microscope-drapes', 'Surgical Microscope Cover', 'en', 1.0000),
    ('microscope-drapes', 'Surgical Microscope Drape', 'en', 1.0000),
    ('microscope-drapes', 'Operating Microscope Cover', 'en', 0.9900),
    ('microscope-drapes', 'Copri microscopio', 'it', 1.0000),
    ('microscope-drapes', 'Telo sterile microscopio', 'it', 0.9900),
    ('microscope-drapes', 'Housse microscope', 'fr', 1.0000),
    ('microscope-drapes', 'Housse stérile microscope', 'fr', 0.9900),
    ('microscope-drapes', 'Funda de microscopio', 'es', 1.0000),
    ('microscope-drapes', 'Cubierta estéril de microscopio', 'es', 0.9900),
    ('microscope-drapes', 'Mikroskopabdeckung', 'de', 1.0000),
    ('microscope-drapes', 'Sterile Mikroskophülle', 'de', 0.9900),
    ('microscope-drapes', 'Steriele microscoophoes', 'nl', 1.0000),
    ('microscope-drapes', 'Microscoop afdekhoes', 'nl', 0.9900),

    -- Broader family terminology used for family intent and adjacency.
    ('equipment-covers', 'Sterile Medical Equipment Cover', 'en', 1.0000),
    ('equipment-covers', 'Sterile Medical Equipment Covers', 'en', 1.0000),
    ('equipment-covers', 'Surgical Equipment Drape', 'en', 1.0000),
    ('equipment-covers', 'Surgical Equipment Drapes', 'en', 1.0000),
    ('equipment-covers', 'Operating Room Equipment Cover', 'en', 1.0000),
    ('equipment-covers', 'Operating Room Equipment Covers', 'en', 1.0000),
    ('equipment-covers', 'Sterile Equipment Cover', 'en', 1.0000),
    ('equipment-covers', 'Sterile Equipment Drape', 'en', 1.0000),
    ('equipment-covers', 'Copertura sterile apparecchiatura medica', 'it', 0.9900),
    ('equipment-covers', 'Housse stérile équipement médical', 'fr', 0.9900),
    ('equipment-covers', 'Funda estéril para equipo médico', 'es', 0.9900),
    ('equipment-covers', 'Sterile Medizingeräteabdeckung', 'de', 0.9900),
    ('equipment-covers', 'Steriele hoes medische apparatuur', 'nl', 0.9900)
), resolved as (
  select taxonomy.id as taxonomy_id, reviewed.alias_text,
    reviewed.language_code, reviewed.confidence
  from reviewed_aliases reviewed
  join public.medical_product_taxonomy taxonomy
    on taxonomy.slug = reviewed.taxonomy_slug and taxonomy.is_active
)
insert into public.medical_product_aliases (
  taxonomy_id, alias_text, language_code, source, confidence,
  verification_status, is_active
)
select taxonomy_id, alias_text, language_code, 'seed', confidence,
  'approved', true
from resolved
on conflict (normalized_alias, language_code) do update set
  taxonomy_id = excluded.taxonomy_id,
  alias_text = excluded.alias_text,
  source = 'seed',
  confidence = excluded.confidence,
  verification_status = 'approved',
  is_active = true,
  updated_at = now();

do $alias_guard$
declare
  missing_count integer;
begin
  select count(*) into missing_count
  from (values
    ('camera-covers', 'Sterile Camera Sleeve', 'en'),
    ('camera-covers', 'Copri telecamera', 'it'),
    ('camera-covers', 'Housse caméra', 'fr'),
    ('camera-covers', 'Funda de cámara', 'es'),
    ('camera-covers', 'Sterile Kameraabdeckung', 'de'),
    ('camera-covers', 'Camera hoes', 'nl'),
    ('c-arm-covers', 'Image Intensifier Drape', 'en'),
    ('microscope-drapes', 'Operating Microscope Cover', 'en'),
    ('equipment-covers', 'Sterile Medical Equipment Covers', 'en')
  ) expected(taxonomy_slug, alias_text, language_code)
  where not exists (
    select 1
    from public.medical_product_aliases alias
    join public.medical_product_taxonomy taxonomy on taxonomy.id = alias.taxonomy_id
    where taxonomy.slug = expected.taxonomy_slug
      and alias.normalized_alias = public.normalize_medical_product_term(expected.alias_text)
      and alias.language_code = expected.language_code
      and alias.is_active
      and alias.verification_status = 'approved'
      and alias.confidence >= 0.95
  );
  if missing_count > 0 then
    raise exception 'Buyer Discovery V2.3 alias verification failed for % reviewed aliases', missing_count;
  end if;
end
$alias_guard$;

commit;

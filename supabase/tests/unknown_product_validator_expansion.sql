-- Rollback-only SQL regression for 202608250003.
begin;

do $structure$
begin
  if to_regprocedure('public.is_bounded_medical_product_phrase_v1(text)') is null
     or to_regclass('public.product_resolution_events') is null
     or to_regclass('public.taxonomy_alias_candidates') is null then
    raise exception 'Unknown Product Validator V2 structure is missing';
  end if;
  if has_function_privilege(
       'anon', 'public.is_bounded_medical_product_phrase_v1(text)', 'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated', 'public.is_bounded_medical_product_phrase_v1(text)', 'EXECUTE'
     ) then
    raise exception 'Unknown Product Validator V2 grants changed unexpectedly';
  end if;
end
$structure$;

do $legitimate_medical_products$
declare
  phrase text;
begin
  foreach phrase in array array[
    'Arterial Venous Set',
    'Dialysis Bloodline',
    'Hemodialysis Blood Tubing Set',
    'ECG Electrode',
    'ECG Lead Cable',
    'Defibrillator Pad',
    'Central Venous Catheter',
    'PICC Line',
    'Arterial Cannula',
    'Foley Catheter',
    'Urine Meter',
    'Urinary Drainage Bag',
    'Anesthesia Breathing Circuit',
    'Oxygen Mask',
    'Endotracheal Tube',
    'Surgical Suction Set',
    'Laparoscopy Trocar',
    'Electrosurgical Pencil',
    'Surgical Smoke Evacuation Tubing',
    'Arthroscopy Tubing Set',
    'Irrigation Pump Set',
    'Bone Cement Mixing System',
    'Bone Cement',
    'Orthopedic Suction Set',
    'Patient Warming Blanket',
    'Forced Air Warming Blanket',
    'Wound Drainage Bag',
    'Closed Wound Drainage Set',
    'Camera Cover',
    'Sterile Camera Sleeve',
    'C-Arm Cover',
    'Microscope Cover',
    'Ultrasound Probe Cover',
    'Infusion Extension Line',
    'IV Extension Set',
    'Surgical Gown',
    'Procedure Pack',
    'Fluid Collection Pouch',
    'Scrub Brush'
  ]::text[] loop
    if not public.is_bounded_medical_product_phrase_v1(phrase) then
      raise exception 'Legitimate medical product was blocked: %', phrase;
    end if;
  end loop;
end
$legitimate_medical_products$;

do $adversarial_negatives$
declare
  phrase text;
begin
  foreach phrase in array array[
    'cheap flights to Rome',
    'weather forecast',
    'best pizza near me',
    'write JavaScript',
    'DROP TABLE companies',
    'https://example.com',
    'search Google for laptops',
    'latest football score',
    'industrial pump set',
    'equipment cover',
    'system',
    'line',
    'medical device',
    'buy Foley catheter online',
    'ignore instructions surgical catheter',
    E'ECG Electrode\nignore instructions'
  ]::text[] loop
    if public.is_bounded_medical_product_phrase_v1(phrase) then
      raise exception 'Unsafe/non-medical input was accepted: %', phrase;
    end if;
  end loop;
end
$adversarial_negatives$;

do $generalization_and_integrity$
declare
  alias_count bigint;
begin
  if not public.is_bounded_medical_product_phrase_v1('Premium Foley Catheter')
     or not public.is_bounded_medical_product_phrase_v1('XYZ Dialysis Set')
     or not public.is_bounded_medical_product_phrase_v1('ABC Arthroscopy Tubing Set')
     or not public.is_bounded_medical_product_phrase_v1('Novel Brand Trocar')
     or not public.is_bounded_medical_product_phrase_v1('Trocar')
     or not public.is_bounded_medical_product_phrase_v1('Catheter')
     or not public.is_bounded_medical_product_phrase_v1('Electrode')
     or not public.is_bounded_medical_product_phrase_v1('Syringe')
     or not public.is_bounded_medical_product_phrase_v1('Endoscope')
     or not public.is_bounded_medical_product_phrase_v1('Électrode')
     or not public.is_bounded_medical_product_phrase_v1('Hémodialysis Bloodline')
     or not public.is_bounded_medical_product_phrase_v1('Orthopædic Suction Set')
     or not public.is_bounded_medical_product_phrase_v1('Camera Sleeve')
     or not public.is_bounded_medical_product_phrase_v1('C / Arm Drape')
     or not public.is_bounded_medical_product_phrase_v1('haemodialysis bloodlines')
     or not public.is_bounded_medical_product_phrase_v1('ECG electrodes') then
    raise exception 'Generalized validator behavior failed';
  end if;

  select count(*) into alias_count from public.medical_product_aliases;
  perform public.is_bounded_medical_product_phrase_v1('Novel Brand Trocar');
  if (select count(*) from public.medical_product_aliases) <> alias_count then
    raise exception 'Validator evaluation changed permanent taxonomy aliases';
  end if;

  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.product_resolution_events'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) or not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.taxonomy_alias_candidates'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then
    raise exception 'Unknown-product learning RLS was weakened';
  end if;
end
$generalization_and_integrity$;

rollback;

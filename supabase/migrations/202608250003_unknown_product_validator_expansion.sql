-- Unknown Product Resolution hotfix V2.
-- Expand the bounded medical-domain admission guard without adding taxonomy
-- aliases, weakening evidence requirements, or changing provider limits.

begin;

do $preflight$
begin
  if to_regclass('public.product_resolution_events') is null
     or to_regclass('public.taxonomy_alias_candidates') is null
     or to_regprocedure('public.normalize_unknown_product_phrase_v1(text)') is null
     or to_regprocedure('public.unknown_product_phrase_signature_v1(text)') is null
     or to_regprocedure('public.is_bounded_medical_product_phrase_v1(text)') is null
     or to_regprocedure('public.start_external_prospect_discovery_v2(bigint,uuid,jsonb)') is null then
    raise exception 'Unknown Product Validator V2 preflight failed';
  end if;
end
$preflight$;

create or replace function public.is_bounded_medical_product_phrase_v1(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  with phrase as (
    select public.normalize_unknown_product_phrase_v1(
      translate(
        replace(replace(replace(lower(coalesce(p_value, '')), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'),
        'áàâäãåāăąçćčďđéèêëēėęěíìîïīįıłñńňóòôöõøōřšśşťţúùûüūůýÿžźż',
        'aaaaaaaaacccddeeeeeeeeiiiiiiilnnnooooooorsssttuuuuuuyyzzz'
      )
    ) value
  ), signals as (
    select value,
      value ~ '\m(medical|clinical|surgical|surgery|sterile|patient|hospital|therapy|treatment|dialysis|hemodialysis|hemofiltration|extracorporeal|arterial|venous|vascular|cardiac|cardiology|blood|bloodline|ecg|ekg|electrocardiography|defibrillator|irrigation|suction|laparoscopy|laparoscopic|arthroscopy|arthroscopic|endoscopy|endoscopic|ultrasound|sonography|radiology|imaging|catheter|cannula|picc|wound|drainage|drain|anesthesia|anesthetic|respiratory|ventilation|breathing|airway|oxygen|endotracheal|infusion|intravenous|iv|urology|urinary|urine|urethral|bladder|orthopedic|bone|arthroplasty|trauma|warming|diagnostic|operating|theatre|procedure|fluoroscopy|microscope|probe|electrosurgical|infection|disinfection|antiseptic|scrub|protective|fluid)\M'
        as has_medical_context,
      value ~ '\m(set(s)?|kit(s)?|device(s)?|equipment|cover(s)?|sleeve(s)?|drape(s)?|pouch(es)?|blanket(s)?|gown(s)?|bloodline(s)?|pump(s)?|catheter(s)?|cannula(s)?|tubing|cable(s)?|probe(s)?|dressing(s)?|pack(s)?|needle(s)?|syringe(s)?|mask(s)?|brush(es)?|tape(s)?|bag(s)?|circuit(s)?|consumable(s)?|accessor(y|ies)|implant(s)?|instrument(s)?|system(s)?|sheath(s)?|tube(s)?|line(s)?|extension(s)?|connector(s)?|electrode(s)?|lead(s)?|sensor(s)?|transducer(s)?|trocar(s)?|filter(s)?|cap(s)?|glove(s)?|apron(s)?|sponge(s)?|pad(s)?|drain(s)?|reservoir(s)?|collector(s)?|meter(s)?|warmer(s)?|cement(s)?|scope(s)?|endoscope(s)?|pencil(s)?)\M'
        as has_product_form,
      value ~ '\m(bloodline(s)?|catheter(s)?|cannula(s)?|electrode(s)?|endoscope(s)?|syringe(s)?|trocar(s)?)\M'
        or value ~ '(^| )(camera (cover|covers|sleeve|sleeves)|c arm (cover|covers|drape|drapes))( |$)'
        as has_strong_medical_product_form
    from phrase
  )
  select coalesce(char_length(p_value), 0) between 3 and 160
    and coalesce(p_value, '') !~ '[[:cntrl:]]'
    and length(value) between 3 and 160
    and (
      array_length(regexp_split_to_array(value, '\s+'), 1) between 2 and 12
      or (
        array_length(regexp_split_to_array(value, '\s+'), 1) = 1
        and has_strong_medical_product_form
      )
    )
    and value !~ '\m(search|google|bing|crawl|scrape|fetch|prompt|select|insert|update|delete|drop|union|script|find|research|buyer|buyers|company|companies|competitor|competitors|distributor|distributors|manufacturer|manufacturers|seller|sellers|supplier|suppliers|buy|cheapest|code|execute|ignore|instruction|instructions|javascript|online|price|prices|write)\M'
    and has_product_form
    and (has_medical_context or has_strong_medical_product_form)
    and value !~ '^(medical|clinical|healthcare|hospital|patient|sterile|surgical|product|products|device|equipment|solution|system|supply|supplies|consumable|accessory)( (medical|clinical|healthcare|hospital|patient|sterile|surgical|product|products|device|equipment|solution|system|supply|supplies|consumable|accessory))*$'
  from signals;
$function$;

comment on function public.is_bounded_medical_product_phrase_v1(text) is
  'Bounded medical-domain admission guard for unknown products. This is not a taxonomy match and creates no evidence.';

commit;

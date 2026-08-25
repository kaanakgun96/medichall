begin;

do $v2_3_aliases$
declare
  value jsonb;
  term text;
begin
  foreach term in array array[
    'Camera Cover',
    'Camera Drape',
    'Sterile Camera Sleeve',
    'Endoscopic Camera Cover',
    'Copri telecamera',
    'Housse caméra',
    'Funda de cámara',
    'Sterile Kameraabdeckung',
    'Camera hoes'
  ] loop
    select public.resolve_medical_product_term_v1(term) into value;
    if value #>> '{recommended,canonical_name}' <> 'Camera Covers'
       or value #>> '{resolution}' <> 'high_confidence' then
      raise exception 'V2.3 Camera Cover alias did not resolve: % => %', term, value;
    end if;
  end loop;

  foreach term in array array['C-Arm Cover', 'C Arm Cover', 'Image Intensifier Drape', 'Fundas para arco en C'] loop
    select public.resolve_medical_product_term_v1(term) into value;
    if value #>> '{recommended,canonical_name}' <> 'C-Arm Covers' then
      raise exception 'V2.3 C-Arm alias did not resolve: % => %', term, value;
    end if;
  end loop;

  foreach term in array array['Microscope Cover', 'Sterile Microscope Drape', 'Operating Microscope Cover'] loop
    select public.resolve_medical_product_term_v1(term) into value;
    if value #>> '{recommended,canonical_name}' <> 'Microscope Drapes' then
      raise exception 'V2.3 Microscope alias did not resolve: % => %', term, value;
    end if;
  end loop;
end
$v2_3_aliases$;

do $v2_3_negative_aliases$
declare
  generic_term text;
begin
  foreach generic_term in array array['camera', 'video', 'endoscopy', 'imaging'] loop
    if exists (
      select 1
      from public.medical_product_aliases alias
      join public.medical_product_taxonomy taxonomy on taxonomy.id = alias.taxonomy_id
      where taxonomy.slug in ('camera-covers', 'c-arm-covers', 'microscope-drapes')
        and alias.normalized_alias = public.normalize_medical_product_term(generic_term)
        and alias.is_active and alias.verification_status = 'approved'
    ) then
      raise exception 'Generic term was incorrectly approved as an equipment-cover alias: %', generic_term;
    end if;
  end loop;
end
$v2_3_negative_aliases$;

do $v2_3_relationships$
begin
  if exists (
    select 1
    from public.medical_product_taxonomy child
    left join public.medical_product_taxonomy parent on parent.id = child.parent_id
    where child.slug in ('camera-covers', 'c-arm-covers', 'microscope-drapes')
      and parent.slug is distinct from 'equipment-covers'
  ) then
    raise exception 'Equipment-cover family relationships changed unexpectedly';
  end if;
end
$v2_3_relationships$;

rollback;

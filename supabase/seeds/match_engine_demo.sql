-- MedicHall Match Engine demo data
-- DO NOT run on production unless you want temporary demo records.
-- Replace :COMPANY_ID manually before running in Supabase SQL Editor.

-- 1) Create or update the manufacturer's matching profile.
insert into public.company_match_profiles (
  company_id,
  target_countries,
  target_partner_types,
  product_keywords,
  cpv_codes,
  certifications,
  oem_available,
  private_label_available,
  min_match_score,
  profile_complete_score
)
values (
  :COMPANY_ID,
  array['Italy', 'Germany', 'Spain', 'France'],
  array['Medical distributor', 'Healthcare distributor'],
  array[
    'sterile ultrasound probe cover',
    'camera cover',
    'c-arm cover',
    'microscope drape',
    'surgical drape'
  ],
  array['33140000', '33141000'],
  array['MDR', 'CE', 'ISO 13485'],
  true,
  true,
  55,
  90
)
on conflict (company_id) do update set
  target_countries = excluded.target_countries,
  target_partner_types = excluded.target_partner_types,
  product_keywords = excluded.product_keywords,
  cpv_codes = excluded.cpv_codes,
  certifications = excluded.certifications,
  oem_available = excluded.oem_available,
  private_label_available = excluded.private_label_available,
  min_match_score = excluded.min_match_score,
  profile_complete_score = excluded.profile_complete_score,
  updated_at = now();

-- 2) Add a demo tender.
insert into public.tenders (
  source,
  source_notice_id,
  title,
  description,
  buyer_name,
  country_code,
  country_name,
  cpv_codes,
  product_keywords,
  publication_date,
  deadline_at,
  estimated_value,
  currency,
  source_url,
  language_code,
  raw_payload,
  status
)
values (
  'DEMO',
  'DEMO-TENDER-001',
  'Sterile ultrasound probe covers and surgical equipment covers',
  'Framework agreement for sterile covers used in operating rooms.',
  'Demo University Hospital',
  'IT',
  'Italy',
  array['33140000', '33141000'],
  array['sterile ultrasound probe cover', 'camera cover', 'c-arm cover'],
  current_date,
  now() + interval '21 days',
  180000,
  'EUR',
  'https://example.com/demo-tender',
  'en',
  jsonb_build_object(
    'required_certifications',
    jsonb_build_array('MDR', 'CE', 'ISO 13485')
  ),
  'open'
)
on conflict (source, source_notice_id) do update set
  deadline_at = excluded.deadline_at,
  updated_at = now();

-- 3) Add a demo distributor.
insert into public.distributor_candidates (
  name,
  website,
  country_code,
  country_name,
  company_type,
  product_categories,
  product_keywords,
  channels,
  certifications,
  source,
  source_url,
  verification_status,
  is_active
)
values (
  'Demo Med Distribution Spain',
  'https://example.com/demo-distributor',
  'ES',
  'Spain',
  'Medical distributor',
  array['Operating Room', 'Ultrasound'],
  array['sterile ultrasound probe cover', 'camera cover', 'surgical drape'],
  array['Hospitals', 'Private clinics'],
  array['ISO 13485'],
  'DEMO',
  'https://example.com/demo-distributor',
  'reviewed',
  true
)
on conflict do nothing;

-- 4) Generate matches.
select public.refresh_company_opportunity_matches(:COMPANY_ID);

-- 5) Review results.
select
  om.id,
  om.opportunity_type,
  om.match_score,
  om.confidence_score,
  om.reasons,
  om.risks,
  om.status,
  t.title as tender_title,
  d.name as distributor_name
from public.opportunity_matches om
left join public.tenders t on t.id = om.tender_id
left join public.distributor_candidates d on d.id = om.distributor_id
where om.company_id = :COMPANY_ID
order by om.match_score desc, om.generated_at desc;

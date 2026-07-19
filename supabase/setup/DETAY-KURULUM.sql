-- İhale Detay Sayfası — 2 yeni kolon (tekrar çalıştırmaya dayanıklı)
alter table public.tenders
  add column if not exists ai_lots jsonb not null default '[]'::jsonb;
alter table public.opportunity_matches
  add column if not exists fit_narrative text;
select 'detay hazir' as sonuc;

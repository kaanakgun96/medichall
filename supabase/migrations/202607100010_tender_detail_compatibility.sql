-- Recover the two remaining Tender Detail fields that production received
-- through supabase/setup/DETAY-KURULUM.sql.  Portal lot rendering, the lot
-- matcher, and Universal Tender Import read ai_lots; the legacy explanation
-- surface reads fit_narrative.  Neither field previously existed in the
-- ordered migration chain.

begin;

alter table public.tenders
  add column if not exists ai_lots jsonb not null default '[]'::jsonb;

alter table public.opportunity_matches
  add column if not exists fit_narrative text;

notify pgrst, 'reload schema';

commit;

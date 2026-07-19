-- MedicHall — Public assistant usage tracking (rate limiting)
-- Tekrar çalıştırmaya dayanıklı.

create table if not exists public.public_assistant_usage (
  id bigserial primary key,
  ip text not null,
  input_chars integer default 0,
  output_chars integer default 0,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

-- IP + zaman bazlı hız limiti sorgusu için indeks
create index if not exists public_assistant_usage_ip_time_idx
  on public.public_assistant_usage (ip, created_at desc);

alter table public.public_assistant_usage enable row level security;
-- Sadece Edge Function (service role) yazar/okur; tarayıcıdan erişim yok.
-- (Politika yok = anon/authenticated erişemez, service_role RLS'i bypass eder.)

select 'public assistant hazir' as sonuc;

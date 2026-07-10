-- MedicHall AI usage log (safe to run multiple times)
-- FIXED: "create policy if not exists" is not valid PostgreSQL syntax.
-- Replaced with drop-then-create pattern.

create table if not exists public.medichall_ai_usage (
  id bigserial primary key,
  user_id uuid,
  role text,
  mode text not null,
  input_chars integer default 0,
  output_chars integer default 0,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  created_at timestamptz not null default now()
);

alter table public.medichall_ai_usage enable row level security;

-- Users can view only their own usage logs
drop policy if exists "ai_usage_select_own" on public.medichall_ai_usage;
create policy "ai_usage_select_own"
on public.medichall_ai_usage
for select
to authenticated
using (auth.uid() = user_id);

-- Browser-side inserts are not allowed.
-- The Edge Function writes via the service role key.

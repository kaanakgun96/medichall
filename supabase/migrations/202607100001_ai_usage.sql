-- MedicHall AI usage log (safe to run multiple times)
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
create policy if not exists "ai_usage_select_own"
on public.medichall_ai_usage
for select
to authenticated
using (auth.uid() = user_id);

-- Do not allow browser-side inserts. Edge Function may use service role if configured.
-- If you do not configure SUPABASE_SERVICE_ROLE_KEY, the AI module still works, only logging is skipped.

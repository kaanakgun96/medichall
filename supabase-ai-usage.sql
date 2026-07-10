-- Optional: AI usage tracking table for MedicHall
-- You can run this later if you want to store AI requests/usage per user.

create table if not exists ai_usage_logs (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  mode text not null default 'general',
  prompt_preview text,
  input_tokens integer default 0,
  output_tokens integer default 0,
  created_at timestamptz not null default now()
);

alter table ai_usage_logs enable row level security;

drop policy if exists "users can view own ai logs" on ai_usage_logs;
create policy "users can view own ai logs"
on ai_usage_logs for select
to authenticated
using (auth.uid() = user_id);

-- Insert should normally be done from the Edge Function using service role.

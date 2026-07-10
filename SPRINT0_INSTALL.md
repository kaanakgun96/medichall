# MedicHall Sprint 0 — AI backend foundation

This package adds the server-side AI function and its usage-log migration.
It does not replace the live portal in this commit.

## Files
- `supabase/functions/medichall-ai/index.ts`
- `supabase/migrations/202607100001_ai_usage.sql`
- `.gitignore`
- `.env.example`

## GitHub upload
Upload these files to the `develop` branch while preserving their folders.
Suggested commit: `chore: add secure AI backend foundation`

## Supabase setup
1. Run `supabase/migrations/202607100001_ai_usage.sql` in SQL Editor once.
2. Add the secret `OPENAI_API_KEY` in Edge Functions secrets.
3. Deploy the function with Supabase CLI when ready:
   `npx supabase functions deploy medichall-ai --project-ref azdmuarzntzqdyirysux`

Do not add API keys to HTML, GitHub, or `.env.example`.

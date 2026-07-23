# Supabase structural baseline

The repository intentionally does not contain a live Supabase export. Run
`scripts/export-supabase-baseline.sh` as an authorized project owner to create a
sanitized, structural-only capture under `supabase/baseline/live/`.

That output directory is ignored by Git. It may still contain sensitive
implementation details, so review it before sharing. The script never requests
or exports customer rows, API keys, authentication tokens, Edge Function
secrets, or cron command bodies.

# Universal Tender Import migration source archive

These two files are the byte-identical, published Module 1 migration sources.
Production project `azdmuarzntzqdyirysux` has neither version in its migration
ledger and none of their tables, bucket, functions, policies, triggers, or
reference rows exists there.

They were removed from the executable production chain because the Supabase
CLI applies pending migrations in version order; leaving them there would make
an unrelated notification release install Module 1. They were not marked
applied and their contents were not edited.

Future Module 1 work must branch from the then-current production head, create
new migration versions, and port these sources into those new forward-only
files. It must pass the archived `supabase/tests/universal_tender_import.sql`
contract in an isolated project before a production gate is considered.

Immutable SHA-256 values are recorded in
`supabase/observability/production-migration-sequence.json` and checked by
`scripts/check-migration-sequencing.mjs`.

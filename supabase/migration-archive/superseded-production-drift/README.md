# Superseded production-drift migration

`202607290003_repository_metadata_reconciliation.sql` was never applied to
production. It is retained byte-for-byte for audit evidence but is no longer
executable because it would overwrite the operational `content_sha256`,
`live_verification_status`, and `live_verified_at` values of four live pipeline
records.

`202608010002_production_compatibility_and_metadata.sql` supersedes only its
safe intent. The replacement writes namespaced repository hash keys inside
`metadata` and deliberately retains all three operational columns.

# External Prospect Discovery — database package

Production project: `azdmuarzntzqdyirysux`

This package contains one forward migration and its rollback-only SQL/RLS
regression. Take the repository-standard restricted backup, require the linked
dry run to propose only `202608200003_external_prospect_discovery.sql`, and
apply only that migration. Do not edit migration history.

The SQL regression ends with `ROLLBACK`; run it only through the approved
production-compatible database test path.

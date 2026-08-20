# External Prospect Discovery — Edge package

Production project: `azdmuarzntzqdyirysux`

After migration `202608200003` is applied, deploy only:

1. `external-prospect-discovery`
2. `traffic-analytics`

The second deployment only extends the existing conversion-event allowlist
with the six External Prospect Discovery aggregate events. Use the repository's
current application-level JWT configuration. Do not change provider secrets,
send email, invoke paid AI, or deploy another function.

The package retains source paths so imports resolve during a reviewed deploy.

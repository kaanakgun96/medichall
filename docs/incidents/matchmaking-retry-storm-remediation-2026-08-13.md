# Matchmaking retry-storm remediation — 2026-08-13

## Scope and incident cause

Production project `azdmuarzntzqdyirysux` was sustaining roughly 2,000
PostgREST transactions per second because deterministic matchmaking conflicts
were raised as PostgreSQL `40001` (`serialization_failure`). The conflict was
permanent, but the retry signal caused the request to start again. Each attempt
inserted an idempotency row and scanned the meeting before the error rolled the
transaction back, including the idempotency write.

This remediation changes no matchmaking lifecycle semantics. It changes only
the error contract for audited business conflicts from retryable `40001` to
PostgREST `PT409` (HTTP 409 Conflict). PostgreSQL-generated serialization
failures, should one occur at the database isolation layer, remain native
`40001` errors.

## Restricted pre-change evidence

Captured at 2026-08-13 08:40 TRT without customer payloads or secrets:

- migration ledger ended at `202608110001`;
- `respond_matchmaking_meeting(bigint,text,integer,uuid,bigint,jsonb,text,text)`
  definition MD5 was `43f920157536b6a3489f635ed212f20d`;
- owner `postgres`, `SECURITY DEFINER` enabled, and
  `search_path=public, pg_temp`;
- EXECUTE grantees were only `authenticated`, `postgres`, and `service_role`;
- production object counts were 3 business connections, 8 meeting requests,
  24 proposals, 16 participants, 23 events, 0 outcomes, 24 reminders,
  764 matchmaking notifications, 3 idempotency rows, 0 private notes, and
  8 video-access-log rows;
- a corrected 10.882-second sample recorded 21,102 request-context calls
  (1,939.17/s), 21,262 idempotency inserts (1,953.87/s), 19,345 meeting
  sequential scans (1,777.71/s), 21,262 rollbacks, 5 commits, and a 99.9765%
  rollback rate;
- the cumulative request-context statement had 2,616,378,931 calls at the
  sample start;
- PostgREST had active and aborted sessions associated with the meeting RPC;
- the incident diagnosis measured production CPU at approximately 93%;
- production lint had no errors. Its pre-existing warnings concerned
  `recover_stale_tender_document_analysis_jobs` assignments and the volatility
  annotation of `get_tender_opportunity_intelligence_v1`, neither in scope.

No statistics were reset.

## Complete explicit `40001` classification

All 20 explicit branches present in the production `public` schema were
deterministic business conflicts. No branch represented a true transient
database serialization failure.

| Routine | Branch | Classification |
|---|---|---|
| `mm_begin_idempotent_operation` | matching operation still processing | permanent/in-progress business conflict |
| `submit_matchmaking_meeting_outcome` | meeting not closed before outcome | invalid lifecycle transition |
| `request_business_connection_v2` | connection request could not be resolved/created | persistent business-state conflict |
| `respond_business_connection_v2` | connection already resolved | already processed |
| `respond_business_connection_v2` | connection version changed | stale version |
| `respond_matchmaking_meeting` | meeting version changed | stale version |
| `respond_matchmaking_meeting` | meeting not awaiting acceptance | invalid/already-processed transition |
| `respond_matchmaking_meeting` | selected proposal no longer active/current | stale proposal |
| `respond_matchmaking_meeting` | meeting not open for counter-proposal | invalid transition |
| `respond_matchmaking_meeting` | meeting not awaiting decline | invalid/already-processed transition |
| `respond_matchmaking_meeting` | meeting can no longer be cancelled | invalid/already-processed transition |
| `respond_matchmaking_meeting` | meeting cannot close before confirmed start | invalid transition |
| `update_matchmaking_meeting_draft` | draft version changed | stale version |
| `claim_matchmaking_video_room` | meeting not accepted/confirmed | invalid lifecycle state |
| `claim_matchmaking_video_room` | accepted proposal has no valid time | incomplete business state |
| `complete_matchmaking_video_room` | meeting not ready for video confirmation | stale/invalid lifecycle state |
| `complete_matchmaking_video_room` | provider room does not match active claim | stale provider result |
| `fail_matchmaking_video_room` | provider claim no longer active | stale provider result |
| `revise_matchmaking_meeting_proposal` | proposal no longer editable | invalid/already-processed transition |
| `revise_matchmaking_meeting_proposal` | meeting version changed | stale version |

## Forward migration and safeguards

Migration `202608130001_matchmaking_retry_storm_remediation.sql` pins the ten
audited routine bodies by MD5 and the expected number of branches. It stops if
any routine is missing, its body drifted, or the occurrence count differs. It
uses each live `pg_get_functiondef` result to replace only the exact error-code
token, verifies owner/security/search-path/ACL metadata is unchanged, verifies
all 20 replacements, and reloads the PostgREST schema cache.

The focused rollback-only metadata regression and canonical lifecycle SQL
regression verify that none of the ten routines retains an explicit `40001`,
each has `PT409`, successful acceptance still works,
identical successful requests replay their original response, stale meeting and
proposal state returns `PT409`, already-processed and invalid transitions return
`PT409`, and rejected attempts leave no idempotency artifact.

## Deployment and production validation

- canonical dry run proposed exactly
  `202608130001_matchmaking_retry_storm_remediation.sql`;
- deployment applied exactly that migration; no Edge Function or frontend was
  deployed;
- the ledger advanced only to `202608130001`, and the post-deploy dry run was
  empty;
- live `respond_matchmaking_meeting` definition MD5 is
  `235cadf768b93c5c30271d01d6f75437`;
- owner, `SECURITY DEFINER`, `search_path`, and EXECUTE grantees are unchanged;
- all ten audited routines now expose 20 `PT409` branches and zero explicit
  `40001` branches;
- all pre-change matchmaking/customer object counts were unchanged immediately
  after deployment and at every stabilization sample;
- a rollback-only production QA used exactly two synthetic users, no companies,
  one connection, and one meeting. Valid acceptance, idempotent replay,
  unavailable proposal, stale version, and the same persistent invalid
  transition twice all passed. No email or AI/provider request was triggered;
- rollback cleanup left zero QA users, identities, sessions, profiles, meeting
  requests, idempotency keys, or child-table orphans.

## Live recovery evidence

The immediate 10.873-second post-deploy sample recorded:

- request-context calls: 0 (before 1,939.17/s);
- idempotency inserts: 0 (before 1,953.87/s);
- meeting sequential scans: 0 (before 1,777.71/s);
- transaction rollbacks: 0, commits: 7, delta rollback rate: 0%;
- no active or aborted PostgREST meeting-RPC session.

The first metrics sample at 2026-08-13 08:51:58 TRT, approximately three
minutes after deployment, measured 1.46% total non-idle CPU on two CPUs:
0.49% user, 0.37% system, 0.60% I/O wait, and 98.54% idle. Load averages were
0.28 / 2.95 / 4.61 (1/5/15 minute), showing the historical load still decaying.

The cache-spanning stabilization sample ending at 08:58:27 TRT measured 2.43%
total non-idle CPU (0.56% user, 0.45% system, 1.42% I/O wait) with load at
0.01 / 0.94 / 3.17. The approximately 15-minute sample ending at 09:04:29 TRT
measured 1.26% total non-idle CPU (0.61% user, 0.33% system, 0.32% I/O wait),
98.74% idle, and load at 0.00 / 0.23 / 2.02. The concurrent 10.229-second
database sample again recorded zero incident calls, inserts, meeting scans, or
rollbacks and no incident PostgREST session.

The final approximately 30-minute checkpoint ending at 09:13:54 TRT measured
1.09% total non-idle CPU (0.52% user, 0.30% system, 0.27% I/O wait), 98.91%
idle, and load at 0.00 / 0.03 / 1.10. Its paired 10.269-second database sample
again measured zero request-context calls, idempotency inserts, meeting scans,
or rollbacks, and no incident PostgREST session. The recovery was stable across
the full observation window.

## Client retry audit

Both `matchmaking-workspace.js` and the embedded portal workspace issue one
`respond_matchmaking_meeting` RPC per user action. `medichall-session.js` permits
only one bounded replay after a 401 token refresh. The `retry` variable near
meeting acceptance refers only to video-confirmation messaging and does not
re-run the meeting response. There is no unbounded meeting-action client retry,
so no frontend or cPanel patch is required.

## Bloat and compute decision

At the immediate sample, `matchmaking_idempotency_keys` was about 26.45 MB with
3 actual live rows and a rapidly changing dead-tuple estimate while autovacuum
had already run more than 22,000 times. By 09:03 TRT normal autovacuum had
truncated the heap from roughly 20 MB to 3.74 MB; the unused primary-key index
remained 6.14 MB and the hot unique idempotency index was only 16 KB. No
`VACUUM FULL`, `REINDEX`, table rewrite, or other blocking maintenance was run.
The remaining few megabytes do not justify blocking maintenance. The two-CPU
instance is near-idle after the workload collapse; a compute upgrade is not
justified.

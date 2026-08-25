# Buyer Discovery vNext — Search Space and Fresh Discovery

## Release boundary

This release is deterministic backend architecture. It introduces no payment
gateway, billing UI, AI provider, contact collection, email, notification or
message side effect. Customer Fresh Discovery is feature-gated. Only a trusted
platform admin can request `ADMIN_QA_FRESH`, capped at 50 accepted runs per admin
per day.

## Search-space contract

A canonical company/product intent owns one `buyer_discovery_search_spaces`
row. Its bounded partitions cover reviewed terminology, trusted language,
country/region, commercially relevant buyer archetype and TED retrieval mode.
`buyer_discovery_partitions` stores the safe plan dimensions and cumulative
yield, including a separate verified-DIRECT yield for the reviewed learning
loop, never raw provider content or contacts. `buyer_discovery_run_partitions`
records what each accepted run actually explored.

Normal discovery checks the existing canonical intent for 14 days and returns
`CACHED_REUSE` with no provider work. An initial run chooses highest-value,
diverse partitions. An admin Fresh run excludes explored partitions, selecting
unused partitions first. A prior partition can be revisited only after the
14-day stale threshold. Stable request idempotency and an advisory lock prevent
double-click or retry duplication.

Verified companies remain in the persistent reservoir. A company is `NEW` only
the first time it is verified for the tenant/product search space, `UPDATED`
when its evidence fingerprint materially changes, and
`PREVIOUSLY_DISCOVERED` otherwise. Fresh ordering prefers those states in that
order; prior verified buyers are never hidden.

## Adaptive provider budgets

| Product profile | Initial Public Web | Admin Fresh Public Web | Initial/Fresh TED | Website verification | Worst paid provider cost |
|---|---:|---:|---:|---:|---:|
| BROAD | 8 | 10 | 4 / 4 | 6 | $0.040 / $0.050 |
| STANDARD | 6 | 8 | 4 / 4 | 6 | $0.030 / $0.040 |
| NICHE | 4 | 6 | 4 / 6 | 6 | $0.020 / $0.030 |

Public Web produces at most 60 raw observations, the cross-source candidate
pool remains bounded at 180, and at most 30 verified buyers are persisted for a
run. TED has no paid-provider charge in the current architecture. Brave is
estimated at $0.005/request. Cache keys exclude query ordinal so a semantically
identical server-generated query cannot become billable merely by moving to a
different plan position.

## Credit-ready attachment point

Run modes, cache reuse, accepted Fresh state, provider-start state and terminal
failure state are explicit. A service-only execution-acceptance transaction
locks the run and requires at least one planned search partition before provider
work starts. A future customer entitlement debit can be attached inside that
transaction. Cached reuse and no-work planning failures never reach the debit
boundary. A run that fails before provider execution remains distinguishable
for no-charge logic. Admin QA is explicitly `WAIVED_ADMIN_QA`.

No credit or financial ledger is added because the repository has no generic
billing entitlement system to reuse safely.

## Quality and security invariants

The existing ranker and its score threshold are unchanged. Generic-only,
broad-CPV-only, registry-only, search-snippet-only and editorial-only candidates
remain ineligible. Company identity, official-site verification, SSRF/DNS,
robots, tenant RLS, medical intent validation and contact privacy remain the
same gates. Clients cannot submit provider query arrays; the Edge Function
builds the query plan server-side.

## Local benchmark scope

`scripts/buyer-discovery-vnext-benchmark.ts` deterministically exercises
initial, Fresh #1 and Fresh #2 planning for Syringe, Sterile Surgical Gown,
Camera Cover and Arterial Venous Set. It proves partition novelty and bounded
economics without making provider requests. Real-source candidate and verified
buyer counts are intentionally `null` until a separately approved bounded
production QA; the local report does not invent market-yield numbers.

Regression fixtures verify `NEW`, `UPDATED`, `PREVIOUSLY_DISCOVERED`, zero-new
behavior, multilingual/country/archetype novelty, stable retries, adaptive caps,
commercial identity, editorial rejection, Camera Cover, Gown and Unmapped
Product behavior. The existing 30-second remount test remains unchanged except
for its expanded combined-query progress assertion.

## Deployment requirement

After separate approval: require a linked dry run that proposes only
`202608250004_buyer_discovery_vnext_search_space.sql`, apply only that migration,
run `supabase/tests/buyer_discovery_vnext.sql` rollback-only, and deploy only
`external-prospect-discovery`. No cPanel artifact is required because this
release changes no production frontend file.

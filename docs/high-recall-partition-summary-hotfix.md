# High-Recall V2 partition-summary blocker

## Root cause (2026-09-05)

Production's `external_prospect_discovery_runs_partition_summary_check` is:

```sql
CHECK (((jsonb_typeof(partition_summary) = 'object'::text)
  AND (octet_length((partition_summary)::text) <= 32768)
  AND ((partition_summary)::text !~*
    '(email|phone|whatsapp|contact_name|linkedin_url|provider_api_key)'::text)))
```

Column: JSONB, NOT NULL, default `{}`; no sibling partition-summary CHECK.
The previous failed QA row was already cleaned. Reconstructing the same planner
from its deterministic Surgical Gown resolution (taxonomy 26), approved taxonomy
data, matching existing Adaptive cache key, target countries and CPV 33140000
reproduces the failure without any provider request. The sanitized input is
`supabase/functions/_shared/fixtures/partition-summary-gown.json`.

| Field | V2 value/type | PostgreSQL bytes | Result |
| --- | --- | ---: | --- |
| version | UNIVERSAL_HIGH_RECALL_V2/string | 26 | compatible |
| run_mode | NORMAL_DISCOVERY/string | 18 | compatible |
| selected_partition_keys | 23 keys/array | 1,994 | compatible |
| languages | en/array | 6 | compatible |
| regions | four regions/array | 82 | compatible |
| buyer_archetypes | three archetypes/array | 65 | compatible |
| unused_partitions_remaining | number | 2 | compatible |
| stale_partitions_revisited | number | 1 | compatible |
| saturation | NONE/string | 6 | compatible |
| provider_budget | object | 273 | compatible |
| universal_high_recall | full three-wave execution plan/object | 37,276 | exceeds total-column budget by itself |
| adaptive | object | 404 | compatible |

Whole PostgreSQL JSONB text: **40,402 bytes**, versus 32,768 allowed.
Compact JavaScript JSON: 38,392 bytes. JSON type and prohibited-term checks pass;
only the byte-size clause fails. The full plan repeats 23 partitions, 17 Web
queries and six TED partitions across wave and nested partition/query objects.
This is a **code defect**, not a schema defect. No migration is required.

## Consumers and correction

`get_external_prospect_workspace_v3` returns the summary for telemetry/reporting;
no frontend or execution/recovery reader dereferences its full wave objects.
Execution keeps the plan in memory; partition definitions and run participation
remain in `buyer_discovery_partitions` and `buyer_discovery_run_partitions`.
Existing diagnostics still include selected partition metadata. None is removed.

The canonical progress writer now calls `buildDiscoveryPartitionSummary`.
High-Recall OFF returns the exact old object, including adaptive metadata.
High-Recall ON emits `summary_version=COMPACT_V1`: scalar counts, policy limits,
coverage counts, up to three wave counters, and small sanitized category/key
samples. Existing top-level keys remain; sampled partition keys explicitly carry
total/omitted counts. No raw query, full partition, term list or free-text
adaptive negative-context list is embedded. Budget, ranking, execution, credits,
feature flags and evidence rules are not changed.

Limits: six keys of at most 256 ASCII characters, twelve samples of at most 48
ASCII characters per category, three fixed-shape wave entries, numeric values
bounded to one million and six decimal places, fixed enum/status and metadata
keys. Invalid/prohibited samples are omitted, not silently rewritten into valid
partition identifiers. Ordinary summaries target <6 KB; worst retained samples
remain <8 KB with a conservative PostgreSQL punctuation allowance.

## Focused validation and deployment gate

Six summary tests cover exact failure reproduction, flag-off equality, arbitrary
product profiles, large/adversarial plans, maximum samples and Edge wiring.
Only the relevant wave-planning/stop/GPP planner tests are rerun; no repeat of the
already-passed 100-result or full SQL/RLS benchmark suite.

`supabase/tests/buyer_discovery_partition_summary.sql` uses the actual catalog
CHECK in a temporary progress table and ends in ROLLBACK. The harness supplies
old/new payloads in `medichall.qa.partition_summary_fixtures`. Positive fixtures:
empty object, saved legacy GPP, legacy Adaptive and exact compact Gown. Negative:
old oversized Gown, arrays, scalar, JSON null, SQL null, oversized object and
prohibited-field object. It makes no customer-row mutations or provider calls.

Production constraint regression must pass before deploying only
`external-prospect-discovery`. No schema or cPanel deployment. Surgical Gown is
the first live QA retry; stop on another technical blocker. Customer Fresh stays
OFF; High-Recall must stay OFF unless all remaining rollout gates pass.

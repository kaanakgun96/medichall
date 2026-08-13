# Privacy-minimized acquisition funnel

## Product question

Which first-touch source produces companies that complete a useful business action—not merely page views?

## Implemented event sequence

`VISIT → SIGN_UP_STARTED → SIGN_UP_COMPLETED → COMPANY_PROFILE_CREATED → PROFILE_COMPLETED → PRODUCT_ADDED → MATCHMAKING_PROFILE_CREATED → MATCH_VIEWED → CONNECTION_REQUESTED / RFQ_CREATED → MEETING_SCHEDULED`

The stages are not a forced linear product journey. A buyer may create an RFQ without adding a product, and different company roles activate differently. The admin view therefore shows stage totals and source-quality signals rather than claiming every visitor must pass through every row.

## Fixed events

| Event | Trigger boundary | Duplicate behavior |
|---|---|---|
| `signup_started` | registration submission begins | once per loaded page |
| `signup_completed` | Supabase signup returns success | once per loaded page |
| `company_profile_created` | company insert succeeds | once per loaded page |
| `profile_completed` | existing activation RPC reports 100% | once per loaded page |
| `product_added` | new product save succeeds | one event per new product action |
| `matchmaking_profile_created` | first matchmaking profile save succeeds | once per loaded page |
| `match_viewed` | company opens populated matches view | once per loaded page |
| `connection_requested` | connection RPC succeeds | one event per successful request |
| `rfq_created` | RFQ insert succeeds | one event per successful submit action, even for a bounded multi-recipient group |
| `meeting_scheduled` | new non-draft meeting proposal succeeds | one event per successful proposal; edits/counters/reschedules are excluded |

## Data contract

Stored:

- independent event UUID;
- existing pseudonymous visitor/session UUIDs;
- fixed event name;
- timestamp;
- server-verified authenticated boolean;
- first-touch source and bounded UTM fields inherited from the session.

Never stored:

- user or company IDs;
- raw email, name, phone or personal information;
- URL, path parameters, tokens or search text;
- RFQ, message or meeting content;
- tender documents, tender content or Ask MedicHall conversations;
- product/profile content;
- IP address or fingerprint.

Raw tables use forced RLS and have no `anon` or `authenticated` grants. Ingress is a service-only idempotent RPC called by the origin-constrained Edge Function. The browser cannot mutate the table directly.

## Attribution

First touch is fixed at the traffic session boundary. Supported source classes:

- LinkedIn;
- Google;
- Bing;
- other search;
- other referral/PR;
- direct;
- internal MedicHall.

UTM source, medium and campaign remain lower-cased, character constrained and length bounded. No cross-site identifier or third-party tracking is introduced.

Recommended launch UTMs:

- `utm_source=linkedin&utm_medium=organic-social&utm_campaign=open-beta-2026`
- `utm_source=<publication>&utm_medium=earned-pr&utm_campaign=open-beta-2026`
- future only: `utm_source=google&utm_medium=cpc&utm_campaign=medical-tenders-pilot`

## Founder interpretation

Use `useful_actions = connection_requested + rfq_created + meeting_scheduled` as an early quality indicator, not revenue. Compare sources only after enough samples exist. Do not optimize for clicks or sign-up starts alone.

## Failure behavior

Analytics is best effort, chained after the page-view request, never retried automatically and never blocks authentication or business workflows. Global Privacy Control and Do Not Track continue to disable collection.

# Smart Product Resolver V1

## Purpose

Smart Product Resolver is a bounded product-understanding fallback for Buyer Discovery. The existing deterministic taxonomy and approved-alias resolver remains first. Only a phrase that the deterministic resolver cannot safely understand is eligible for one server-side structured Anthropic request.

The resolver may normalize a medical concept, suggest active taxonomy nodes, request clarification, or create a user-confirmed temporary medical intent. It never qualifies companies and its terms are tagged as retrieval candidates, not evidence or global aliases.

## Runtime contract

- Resolver version: `SMART_PRODUCT_RESOLVER_V1`
- Default model: `claude-haiku-4-5`
- Input: product phrase, selected language, and at most 12 relevant active taxonomy candidates
- Output: forced tool result with validated enums, bounded strings, at most 3 taxonomy suggestions, 4 clarification options, and 6 English commercial terms
- Limits: 160 input characters, 450 output tokens, 8-second timeout, one provider request, and USD 0.005 hard estimated-cost ceiling
- Cache: tenant + normalized phrase + resolver version, 90-day default TTL
- Daily default: 20 uncached Smart Resolver calls per company user
- Feature flag: `smart_resolver_enabled`, created disabled

At standard Haiku 4.5 list prices of USD 1 per million input tokens and USD 5 per million output tokens, the 320-input/120-output-token regression fixture costs about USD 0.00092. The hard application ceiling is USD 0.005 per uncached result.

## Safety boundaries

- The browser cannot select provider, model, prompt, taxonomy candidates, or query arrays.
- `ANTHROPIC_API_KEY` is read only in the Edge Function.
- URL, code/SQL, and prompt-injection-like product input is rejected before the provider.
- The model receives no company, contact, message, profile, or buyer data.
- Returned taxonomy IDs must exist in the supplied active candidate set.
- Output is schema-checked for enums, lengths, counts, family consistency, contacts, URLs, and secret-like content.
- Ambiguous/uncertain results require 2–4 explicit user options.
- AI terminology is `SMART_RESOLVER_CANDIDATE` retrieval input only. Existing DIRECT, ADJACENT, GENERIC, procurement, registry, commercial-identity, SSRF, DNS, robots, tenant, cooldown, and idempotency controls remain authoritative.
- Provider failure returns a technical state and never starts a guessed search or destroys prior buyer results.

## Persistence and learning

Migration `202608270002_smart_product_resolver_v1.sql` adds a server-controlled feature-state row, a force-RLS tenant cache, structured resolver diagnostics on product-resolution events, service-only cache/event/confirmation functions, and controlled discovery entry points for confirmed temporary intents. It does not enable Customer Fresh Discovery.

Confirmed outcomes remain company scoped. Repeated confirmations can feed the existing admin-reviewed alias-candidate process, but no Smart Resolver output auto-publishes a global taxonomy alias.

## Deployment order (separate approval required)

1. Take the repository-standard restricted production schema backup.
2. Require the linked migration dry run to propose only `202608270002_smart_product_resolver_v1.sql`.
3. Apply only that migration and run `supabase/tests/smart_product_resolver.sql` rollback-only.
4. Confirm `ANTHROPIC_API_KEY` exists without reading its value. Optional bounded overrides are `SMART_PRODUCT_RESOLVER_MODEL`, `SMART_PRODUCT_RESOLVER_INPUT_COST_PER_MILLION_TOKENS`, `SMART_PRODUCT_RESOLVER_OUTPUT_COST_PER_MILLION_TOKENS`, and `MAX_SMART_PRODUCT_RESOLVER_COST_USD`.
5. Deploy only `external-prospect-discovery`; verify OPTIONS 204, unauthenticated POST 401, tenant isolation, deterministic zero-AI routing, one-call fallback, cache reuse, ambiguity confirmation, temporary-intent discovery, and zero contacts/email/message/notification side effects.
6. Manually upload only `external-prospects.css`, `external-prospects.js`, `portal.html`, and `matchmaking.html` to cPanel `public_html/`, preserving their exact filenames.
7. After backend and frontend verification, set `smart_resolver_enabled = true` through an approved secure database operation. Keep `customer_fresh_enabled = false`.

No production, Edge Function, feature-flag, or cPanel action is part of the implementation commit itself.

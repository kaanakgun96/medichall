# Unknown Product Validator V2

## Purpose

This hotfix changes the Unknown Product Resolution validator from a narrow
vocabulary gate into a bounded medical-domain admission guard. It does not add
taxonomy nodes or aliases and it does not treat the submitted product phrase as
evidence.

An unfamiliar but plausible medical product may now continue through exact
resolution, a deterministic suggestion, or the existing bounded
`UNMAPPED_PRODUCT` / Search Anyway path. Non-medical searches, URLs, code/SQL,
prompt-like commands, control characters, generic medical labels, long input,
and search-proxy instructions remain blocked.

## Model

The Edge validator and SQL validator use the same decision model:

1. Apply bounded safe case, whitespace, punctuation, and common Latin-accent
   normalization and enforce two to twelve meaningful words, except that one
   inherently medical product-form word is accepted.
2. Reject unsafe, command-like, generic-only, or non-medical input.
3. Require a recognized product form.
4. Require either a medical-context signal or a high-confidence medical product
   form / reviewed medical compound.

Unknown modifiers are allowed around a recognized medical form. A form such as
`catheter`, `trocar`, or `electrode` can establish medical context without the
word `medical`. Ambiguous forms such as `system`, `cover`, `line`, `pad`, and
`cement` still require medical context, except for the bounded established
compounds already used by MedicHall (`camera cover`, `camera sleeve`, and C-arm
cover/drape).

Bare `OR` is intentionally not treated as an operating-room signal because it is
an English connector. `Operating room` and `theatre` terminology remain
supported when paired with a product form.

## Safety invariants

- Search Anyway remains explicit; resolution makes zero provider calls.
- Unmapped Public Web remains capped at four requests and USD 0.02 uncached
  provider cost.
- TED retrieval, evidence verification, contact privacy, RLS, tenant isolation,
  cooldown, and idempotency are unchanged.
- The user phrase is retrieval intent only. Direct evidence still requires an
  independently verified source.
- Alias candidates still require two independent companies and remain
  `PENDING_REVIEW`; no alias is auto-approved.

## Release scope

- Forward migration:
  `202608250003_unknown_product_validator_expansion.sql`
- Edge bundle: redeploy only `external-prospect-discovery` after the migration.
- Frontend/cPanel: no changed artifact and no upload required for this hotfix.

The linked dry-run must propose only the forward migration. Run
`supabase/tests/unknown_product_validator_expansion.sql` as a rollback-only
regression before applying it. Production provider-backed QA remains a separate
approval gate and should use only the bounded representative subset defined in
the release request.

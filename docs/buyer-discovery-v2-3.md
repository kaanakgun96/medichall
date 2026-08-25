# Buyer Discovery V2.3 — alias and multi-source recall contract

## Scope

V2.3 extends the existing Medical Product Taxonomy and the existing
`external-prospect-discovery` function. It does not create a second taxonomy,
an AI classifier, a translation service, or a second discovery engine.

The release improves recall through reviewed terminology and explicit
independent evidence paths. The V2.1/V2.2 product-family gate, generic-only
rejection, provider ceilings, tenant isolation, contact privacy, SSRF controls,
robots handling, and UI stability contract remain in force.

## Reviewed Camera Cover aliases

- English: Camera Cover; Surgical Camera Cover; Sterile Camera Cover; Camera
  Drape; Camera Sleeve; Sterile Camera Sleeve; Endoscopic Camera Cover;
  Endoscopy Camera Cover; Video Camera Cover; Camera Sheath; Sterile Camera
  Sheath; Camera Protective Cover; Camera Equipment Cover; Sterile Camera
  Drape; Surgical Video Camera Cover; Sterile Video Camera Sleeve.
- Italian: Copri telecamera; Copertura telecamera; Guaina per telecamera; Copri
  videocamera.
- French: Housse caméra; Gaine caméra; Protection caméra stérile.
- Spanish: Funda de cámara; Cubierta de cámara; Funda estéril para cámara.
- German: Kameraabdeckung; Kamerahülle; Sterile Kameraabdeckung.
- Dutch: Camerahoes; Camera hoes; Steriele camerabescherming.

The generic terms `camera`, `video`, `endoscopy`, and `imaging` are not aliases
and cannot independently establish product evidence.

## Reviewed related-family aliases

### C-Arm Cover

English terms include C-Arm Cover/Drape, C-Arm Equipment/Protective Cover,
Sterile C-Arm Cover/Drape, Image Intensifier Cover/Drape, and Fluoroscopy
Equipment Cover. Reviewed Italian, French, Spanish (including singular and
plural `funda/fundas` forms), German, and Dutch terms are persisted by migration
`202608250001_buyer_discovery_v2_3_alias_expansion.sql`.
Punctuation normalization means `C-Arm` and `C Arm` resolve identically.

### Microscope Cover / Drape

English terms include Microscope Cover/Drape, Sterile Microscope Cover/Drape,
Microscope Sleeve, Surgical Microscope Cover/Drape, and Operating Microscope
Cover. Reviewed Italian, French, Spanish, German, and Dutch terms are persisted
by the same migration.

### Sterile medical equipment-cover family

The existing `equipment-covers` taxonomy family receives reviewed aliases for
Sterile Medical Equipment Covers, Surgical Equipment Drapes, Operating Room
Equipment Covers, Sterile Equipment Cover, and Sterile Equipment Drape, plus a
bounded reviewed European-language set.

Camera, C-Arm, and Microscope searches now use product-specific intent/cache
keys. An exact sibling cover is `ADJACENT` for the selected product, not
`DIRECT`. The broader equipment-cover taxonomy remains available for family
intent and query expansion.

## Evidence qualification

A prospect may qualify through:

1. Direct official website or catalogue evidence.
2. Direct product-specific TED/public-procurement evidence, even with no
   website.
3. Independently supported commercial adjacency, such as procedure-pack,
   surgical-kit, or OEM/private-label component fit.
4. Relevant adjacent procurement combined with a supported buyer archetype and
   strong official activity context.

Registry/activity evidence remains generic supporting context. Broad CPV
retrieval remains candidate generation. Neither registry-only nor CPV-only
evidence qualifies a result, and Public Web search metadata never becomes
evidence.

## Bounded request and cost impact

| Boundary | V2.2 | V2.3 |
| --- | ---: | ---: |
| Brave queries per uncached run | 6 max | 6 max |
| Brave results per query | 6 max | 6 max |
| Brave estimated cost per uncached run | $0.03 max | $0.03 max |
| Website verification checks | 6 max | 6 max |
| TED requests | 6 max | 6 max |
| AI/LLM requests | 0 | 0 |

The query planner continues to select a representative subset instead of
forming alias × country × language combinations. Public Web records strategy
counts for exact, localized, synonym, and adjacent variants. TED retains its
12-term ceiling but orders exact, synonym, and one reviewed representative from
each supported European language ahead of the remaining aliases. Equivalent
retries use a stable V2.3 request key and the canonical product-specific family
key.

## Company identity

Display identity priority is:

1. Official registry legal name.
2. TED economic-operator legal name.
3. Schema.org Organization `legalName` or `name` on the verified official site.
4. Official-site `og:site_name` or application name.
5. Reliable official-page title metadata.
6. Domain fallback.

Registry identifiers and exact domains remain the strongest deduplication
keys. Normalized legal suffix and domain-brand keys are used only with country
or trusted identity context. A domain remains visible as the website link and
is retained as the title only when no reliable company identity exists.

## Deployment

No frontend or cPanel artifact changes are required.

1. Apply only `202608250001_buyer_discovery_v2_3_alias_expansion.sql`.
2. Run `supabase/tests/buyer_discovery_v2_3.sql` in a rollback-only validation.
3. Deploy only `external-prospect-discovery`.
4. Run bounded authenticated production QA and clean synthetic records.

Production deployment is not performed by this implementation task.

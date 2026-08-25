# Unknown Product Resolution

Buyer Discovery no longer requires every legitimate medical-product phrase to
already be a permanent taxonomy label or approved alias.

The release keeps three separate contracts:

1. Exact canonical names and approved aliases use the existing taxonomy intent.
2. One to three deterministic HIGH/MEDIUM suggestions require an explicit user
   choice before the taxonomy intent is used.
3. A valid medical-product phrase with no reliable suggestion can use the
   bounded `UNMAPPED_PRODUCT` intent. The phrase generates server-controlled
   Public Web and TED descriptive retrieval only; it is never evidence itself.

An official website or TED record must independently contain the exact or a
strongly equivalent phrase before temporary intent evidence can be DIRECT.
Registry activity and broad CPV context remain supporting or generic evidence
and cannot establish product identity.

Normalized resolution events are tenant-private. Admin review receives only an
aggregate alias candidate with counts and no company identity. Candidate status
starts as `PENDING_REVIEW` only after confirmation by at least two independent
companies; no code in this release inserts or activates a global taxonomy
alias.

Unmapped runs retain the normal 30-minute cooldown, daily three-run and monthly
twenty-run company limits. They further cap Public Web retrieval at four
requests / USD 0.02 per uncached run. AI, email, notification, messaging and
contact collection paths are not used.

Product creation remains non-blocking through its existing custom-term review
path. Website Product Detection additionally surfaces strong legitimate
unmapped phrases for explicit resolution instead of silently dropping them.

Deployment order is migration `202608250002_unknown_product_resolution.sql`,
then only the `external-prospect-discovery` Edge Function, then the four-file
cPanel patch (`portal.html`, `matchmaking.html`, `external-prospects.js`, and
`external-prospects.css`).

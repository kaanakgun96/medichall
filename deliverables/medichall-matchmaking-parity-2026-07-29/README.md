# MedicHall Matchmaking frontend parity cPanel artifact

Upload both files to `public_html`, replacing the existing files with the same
names:

1. `portal.html`
2. `matchmaking.html`

No shared JavaScript or CSS asset is required. The small standalone page loads
the canonical `portal.html` document from the same origin and preserves its own
query string and Matchmaking record hash.

After upload:

1. verify the checksums in `SHA256SUMS.txt`;
2. open `portal.html#matchmaking` while authenticated;
3. open `matchmaking.html` while authenticated;
4. confirm both show the Matchmaking Workspace and the header bell; and
5. open a three-slot scheduler and a Requests card from each URL.

Rollback is a two-file replacement: restore the prior cPanel copies of
`portal.html` and `matchmaking.html` together. Do not restore only one of the
two because the new standalone bootstrap depends on the matching canonical
portal artifact.

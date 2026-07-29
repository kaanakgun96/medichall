# MedicHall standalone Matchmaking cPanel upload

This bundle restores `matchmaking.html` as a dedicated full-page product while
keeping the integrated Matchmaking experience in `portal.html`.

## Upload

1. Back up the current files in `public_html`.
2. Upload all four bundle files to `public_html`:
   - `portal.html`
   - `matchmaking.html`
   - `matchmaking-domain.js`
   - `matchmaking-workspace.js`
3. Preserve the filenames exactly. The HTML files load the JavaScript files by
   relative URL.
4. Verify the uploaded files against `SHA256SUMS.txt`.
5. Open `portal.html#matchmaking` and `matchmaking.html` in authenticated
   sessions. Confirm that the portal retains its integrated layout and the
   standalone URL shows the dedicated navy Matchmaking product.

No database migration or Edge Function deployment belongs to this bundle.

## Rollback

Restore the four backed-up files together. Do not roll back database objects,
RLS policies, notifications, meeting history, or Edge Functions.

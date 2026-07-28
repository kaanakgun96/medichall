# MedicHall Matchmaking Workspace cPanel replacement

This directory contains one complete, self-contained production
`portal.html`. Do not copy snippets from it or edit it in cPanel.

## Artifact identity

- Destination: `public_html/portal.html`
- SHA-256:
  `b3426cc47452cc515e422b4ae1b67d24e95d4c5d1787705abd9633f8eb56224f`
- Size: `284029` bytes

## Non-developer upload guide

1. Sign in to cPanel and open **File Manager**.
2. Open `public_html`.
3. Download the current `portal.html` as a backup.
4. Rename the current file to
   `portal.before-matchmaking-2026-07-28.html`.
5. Upload the `portal.html` from this directory.
6. Confirm that the uploaded file is named exactly `portal.html` and is
   `284029` bytes.
7. Open `https://medichall.com/portal.html` in a private browser window and
   sign in normally.
8. Hard-refresh the page, open **Matchmaking**, and confirm that the workspace
   heading loads. Existing tender and document-intelligence screens should
   still open normally.

The frontend has not been uploaded by Codex because production publishing is
manual through cPanel.

## Rollback

If the new portal does not load correctly:

1. rename the new `public_html/portal.html` to
   `portal.matchmaking.failed-2026-07-28.html`;
2. rename `portal.before-matchmaking-2026-07-28.html` back to `portal.html`;
3. clear any cPanel/CDN cache and hard-refresh the browser.

The repository also retains the immediately preceding known-good artifact at
`deliverables/medichall-tender-document-engine-cors-hotfix-2026-07-27/portal.html`
with SHA-256
`2cf87086559b1790f8ecb1480e5b77aed0e1d84f3d99913df9694b1c3b61cf01`.

The database rollout is additive. A routine frontend rollback does not require
dropping tables or deleting meeting data. With the previous portal restored,
the new Edge Function and schema are dormant for old clients.

# External Prospect Discovery — cPanel patch

Do not upload this patch before the database and the two approved Edge Function
deployments have passed their production gates. Back up every destination file
before replacement.

Upload `UPLOAD_TO_PUBLIC_HTML` to `public_html` in this exact order:

| Order | File | Destination | Bytes | SHA-256 |
| ---: | --- | --- | ---: | --- |
| 1 | `external-prospects.css` | `public_html/external-prospects.css` | 5,391 | `c6b5b62ff56a32bf417f957c97f628d29c11af995ba09cb4138a3fd676ab7a76` |
| 2 | `external-prospects.js` | `public_html/external-prospects.js` | 14,051 | `c38cbabf088c2c41ea3b428b7e78654cb36bf6c6941bc1902393bbfdae4f7c9f` |
| 3 | `medichall-traffic.js` | `public_html/medichall-traffic.js` | 10,831 | `76f7121b5f67fed83ebf41ee688e36589dc09cc3ef43aafd09a7b39f72f427b8` |
| 4 | `matchmaking-workspace.js` | `public_html/matchmaking-workspace.js` | 72,161 | `df0d1dbab0833f7063ca8528fcf21153998ad33f00ce9717e421ce8909dfdd86` |
| 5 | `matchmaking.html` | `public_html/matchmaking.html` | 21,701 | `ede1ba4b3e796fdb783fa03ae90025808c6d5e1fee90f96ee371cc70f5942551` |
| 6 | `admin.html` | `public_html/admin.html` | 94,476 | `0c19c7d88c4a366327d1aaec64c3fdfb6ef3ba5d65901524c77adb5521ac28b1` |
| 7 | `portal.html` | `public_html/portal.html` | 396,220 | `41fe893d6fc44070b9c8d857bcb5488ea6ea70adbb0a2d2c932db92c00b76762` |

After upload, purge only affected cPanel/CDN objects and hard-refresh. Verify
Portal Matchmaking, standalone Matchmaking, Admin aggregate metrics, manual
discovery, feedback, desktop, and 390px. Roll back by restoring the seven
backups in reverse order.

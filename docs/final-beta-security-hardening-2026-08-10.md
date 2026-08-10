# Final beta security hardening handoff — 2026-08-10

## Verified production boundary

- `/admin` and `/admin.html` are intentionally discoverable. The URL is not a security control.
- `admin.html` authenticates through the canonical session helper, calls `public.is_admin()`, and renders no privileged data until that server-side check succeeds.
- `public.get_admin_growth_dashboard_v1()` denies anonymous and non-admin callers inside the database function. Its execution grant is authenticated-only.
- A production non-admin session was denied and received no growth data. A uniquely marked QA admin loaded the dashboard, survived refresh, and was removed afterward.
- `noindex,nofollow` remains present. No service-role or provider secret is present in browser source.
- Login errors are bounded and do not reveal whether a submitted address exists. Supabase Auth remains responsible for credential throttling and failed-sign-in logs.

## Admin MFA gate

Admin TOTP enforcement is **not active**. Activating it before the real owner enrolls and proves recovery could lock the owner out, so this release does not pretend that MFA is complete.

Safe activation sequence:

1. Confirm TOTP MFA is enabled in Supabase Auth without changing ordinary-user requirements.
2. Add an admin-only enrollment screen after primary authentication and `is_admin()` authorization. Do not store the TOTP secret in application tables or browser storage.
3. Have the real owner scan and verify the TOTP factor in a supervised maintenance window.
4. Keep the original authenticated session open and prove a second independent login reaches assurance level 2 before closing it.
5. Verify an owner-controlled recovery path (a separately protected break-glass admin or Supabase operator recovery) before enforcing the gate.
6. Then require assurance level 2 before calling `enterApp()` and before every privileged RPC/action. Continue to rely on server/database authorization; MFA never replaces `is_admin()`.
7. Test expired sessions, invalid codes, factor removal, and recovery. Do not enable MFA for ordinary beta users in this change.

## cPanel response headers

Production currently returns none of the five sampled browser hardening headers. Add the following block to `public_html/.htaccess` only after taking a backup. The CSP is deliberately report-only because the current application uses inline script/style, Supabase, PDF.js, Daily, YouTube and Vimeo.

```apache
<IfModule mod_headers.c>
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-XSS-Protection "0"
  Header always set Content-Security-Policy-Report-Only "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://azdmuarzntzqdyirysux.supabase.co wss://azdmuarzntzqdyirysux.supabase.co; worker-src 'self' blob: https://cdnjs.cloudflare.com; frame-src 'self' blob: https://*.daily.co https://www.youtube.com https://player.vimeo.com; media-src 'self' blob: https://*.daily.co; upgrade-insecure-requests"
</IfModule>
```

Do not add `preload` to HSTS until every subdomain is confirmed HTTPS-only. Do not convert CSP to enforcement on the first upload.

Validation and rollback:

1. Back up the existing `.htaccess` with a timestamp.
2. Add only the block above, then request `/`, `/products.html`, `/companies.html`, `/portal.html`, `/matchmaking.html`, and `/admin`.
3. Confirm the five required headers with `curl -sSI` and review browser CSP console reports at 390 px and 1440 px.
4. Exercise Supabase login/refresh, marketplace reads and mutations, PDF preview, Daily join, and YouTube/Vimeo company video.
5. If Apache returns 500 or a dependency is reported, restore the backup immediately.
6. After a clean observation window, migrate the report-only policy to enforcement in a separate reviewed release.

## Orphaned cPanel files

These files are not referenced by live repository HTML and may be deleted manually from `public_html` after backup:

- `medichall-auth-navigation-hotfix.js`
- `medichall-notification-popover-hotfix.css`
- `medichall-safe-mobile-hotfix.js`
- `medichall-safe-mobile-hotfix.css`

Their deletion was not automated.

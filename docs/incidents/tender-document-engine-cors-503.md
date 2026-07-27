# Tender document engine CORS 503 incident

Date: 2026-07-27
Branch: `react-migration`
Affected function: `tender-document-engine`

## Incident

The production portal could not start Deep analysis because the browser's
preflight request received HTTP 503. Supabase's safe test request reproduced
the same response:

```json
{
  "code": "BOOT_ERROR",
  "message": "Function failed to start (please check logs)"
}
```

The request did not reach the Edge Function handler. Production function logs
for deployment version 23 reported:

```text
worker boot error: Uncaught SyntaxError:
Identifier 'createClient' has already been declared
at .../source/index.ts:2067:10
```

The repository entry point contains only one `createClient` import. The
Supabase code viewer showed that the deployed artifact did not match the
repository source: its entry file contained the duplicate declaration and
new shared files had browser-editor placeholder names. This malformed
deployment artifact caused the worker parser to fail before `Deno.serve`
could register a request handler. The browser reported the gateway's 503 as a
CORS error because no function response—and therefore no CORS headers—could
exist.

## Remediation

The Edge Function now has three layers:

- `index.ts` is a minimal entry point that validates origin and method and
  answers `OPTIONS` without loading the document engine.
- `cors.ts` owns the allowlist and all success/error CORS headers.
- `handler.ts` contains the unchanged document intelligence, extraction,
  caching, resume, and lot-match business logic and is loaded dynamically
  only for an allowed `POST`.

This means an import or initialization failure in document-processing
dependencies can no longer break preflight. Such a `POST` failure returns a
safe CORS-enabled `FUNCTION_UNAVAILABLE` response with a request ID and a
sanitized server log.

`verify_jwt = false` remains intentional in `supabase/config.toml`: Supabase's
gateway may pass unauthenticated `OPTIONS`, while `handler.ts` validates the
partner bearer token with Supabase Auth and continues to use the
authenticated client for company-scoped RPCs. The internal resume path still
requires its separate cron secret. Service-role credentials remain confined
to the function runtime.

## Portal changes

The production `portal.html` invocation still sends:

- `POST /functions/v1/tender-document-engine`;
- the public `apikey`;
- `Authorization: Bearer <partner access token>`;
- `Content-Type: application/json`; and
- the existing `{ tender_id, company_id, action? }` contract.

The portal now refreshes an expired session once and distinguishes signed-out,
network/CORS, unavailable, unauthorized-company, already-processing,
validation, and unexpected failures. Console diagnostics contain only the
endpoint, status, safe error code, and request ID.

The separate `rfq_messages` 401 was not part of the function boot failure.
The unread timer previously survived logout and could keep polling with the
public anonymous credential. Logout now clears the timer, and unread polling
does nothing until both the user and access token are restored. No RLS,
grants, or message data were changed.

## Verification

### Production before the fix

- A production-origin `OPTIONS` request returned `503`.
- The response body was `BOOT_ERROR`; it did not include
  `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers`, or
  `Access-Control-Allow-Methods`.
- The invocation appeared at the Supabase gateway, but the worker failed while
  parsing the deployed bundle. Application request handling never started.
- Deployment version 23 logged the duplicate `createClient` declaration shown
  above.

### Production after the fix

Only `tender-document-engine` was redeployed. The live endpoint returned:

| Request | Result | CORS policy |
| --- | --- | --- |
| Production-origin `OPTIONS` | `204` | Production origin echoed; `POST, OPTIONS`; required request headers allowed |
| Originless `OPTIONS` | `204` | Production origin used as the server-like default |
| `http://localhost:3000` `OPTIONS` | `204` | Localhost origin echoed |
| Unexpected-origin `OPTIONS` | `403 ORIGIN_NOT_ALLOWED` | Unexpected origin not reflected |
| Invalid-session production-origin `POST` | `401` | Production CORS headers retained |

The production-origin preflight returned:

```text
access-control-allow-origin: https://medichall.com
access-control-allow-methods: POST, OPTIONS
access-control-allow-headers: authorization, x-client-info, apikey, content-type
access-control-expose-headers: sb-request-id, x-request-id
vary: Accept-Encoding, Origin
```

The first successful production preflight had Supabase request ID
`019fa34b-0112-7346-8a18-e47747347247` and function request ID
`4ec9703f-60b2-484c-b2cc-58be741abae7`. The invalid-session `POST` had
Supabase request ID `019fa34d-92f0-7ab2-b0cd-927c595a51fe` and function
request ID `0fd45b4a-0857-4c1c-9a52-56ff84b7463d`.

Post-deployment logs show normal worker boot records and no duplicate-identifier
or worker-boot errors. The safe `POST` probe loaded the business handler and
failed at authentication, before request validation, database access, or AI
processing.

No partner credentials were available in the isolated validation browser, so
no production request was represented as an authenticated partner request.
Authenticated behavior is covered by the unchanged Auth `getUser` and
company-scoped RPC path plus repository tests. A real analysis was deliberately
not queued to manufacture this proof.

Repository checks:

```bash
deno fmt --check \
  supabase/functions/tender-document-engine/index.ts \
  supabase/functions/tender-document-engine/handler.ts \
  supabase/functions/tender-document-engine/cors.ts \
  supabase/functions/tender-document-engine/index.test.ts

deno lint --config supabase/functions/deno.json \
  supabase/functions/tender-document-engine/index.ts \
  supabase/functions/tender-document-engine/handler.ts \
  supabase/functions/tender-document-engine/cors.ts \
  supabase/functions/tender-document-engine/index.test.ts

deno check --frozen --config supabase/functions/deno.json \
  supabase/functions/tender-document-engine/index.ts \
  supabase/functions/tender-document-engine/handler.ts \
  supabase/functions/tender-document-engine/index.test.ts

deno test --allow-env --frozen --config supabase/functions/deno.json \
  supabase/functions/tender-document-engine/index.test.ts \
  supabase/functions/_shared/*.test.ts
```

From `apps/portal-react`:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The pre- and post-deployment read-only safety counters for tender 2952 were
identical:

| Counter | Before | After |
| --- | ---: | ---: |
| Analysis jobs | 6 | 6 |
| Analysis chunks | 19 | 19 |
| Recorded AI requests | 13 | 13 |

## Deployment and rollback

The incident deployment updated only `tender-document-engine`. The local CLI
could not reach the Supabase API from the restricted environment, so the
signed-in Supabase dashboard was used. Its editor assigned generated live
filenames to imported modules; their contents and import paths were verified
against the repository before deployment. No other function, database object,
secret, Vault value, cron job, storage object, or production row was changed.

For normal deployments, deploy only the canonical repository function:

```bash
supabase functions deploy tender-document-engine \
  --project-ref "$SUPABASE_PROJECT_REF"
```

Do not use the Supabase browser editor to concatenate or rename dependency
files. Do not deploy another function.

After deployment, verify production `OPTIONS` for the production, `www`, and
localhost origins; an originless `OPTIONS`; an unsupported origin; an
unauthenticated `POST`; and, when a test partner session is available, an
authenticated read-only `action: "status"` request against an existing
completed analysis. Do not queue a new analysis.

If validation fails, redeploy the immediately preceding known-good
`tender-document-engine` source bundle only. No database rollback is required:
this incident changes no schema, data, RLS policy, RPC, secret, prompt,
provider, extraction, cache, chunking, resume, or scoring behavior.

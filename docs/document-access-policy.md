# MedicHall document-access policy

## Purpose

MedicHall may discover and process public procurement material, but it must not
circumvent access controls. A failed download is not automatically a software
failure: it may be a legal, contractual, identity, payment, or human-verification
boundary. The system records that distinction and stops.

## Public access

Automation may use:

- official TED notices, attachments, XML, and public APIs;
- official contracting-authority pages and direct files that are openly
  accessible;
- public metadata endpoints;
- openly published award/specification pages;
- a verified mirror only when its official provenance can be established;
- a document lawfully uploaded by an authorized MedicHall user.

Every document or attempt records source type and confidence. Third-party file
hosts are not automatically trusted or downloaded. Public access does not mean
the content is safe: file type, size, archive paths, and executable formats
still require validation.

## Restricted access

The following are restricted, not technical failures:

- `session_required`;
- `login_required`;
- `membership_required`;
- `paid_access_required`;
- `captcha_required`;
- `terms_acceptance_required`;
- `access_forbidden`.

Record the sanitized original portal URL, portal domain, exact status, time,
source confidence, and that manual action is required. Do not continue to
automate the restricted path.

`dynamic_javascript_required` is publicly accessible but unsupported unless a
future approved browser process can use the page without defeating controls.
`manual_review_required` is for an ambiguous path that needs a person, not a
license to bypass it.

## CAPTCHA handling

When a page presents CAPTCHA, hCaptcha, reCAPTCHA, Turnstile, or a comparable
human challenge:

1. classify it `captcha_required`;
2. stop automated traversal and download attempts;
3. preserve sanitized diagnostic metadata;
4. invite an authorized person to use the official portal directly if allowed;
5. accept only a document the person lawfully obtained and is authorized to
   provide.

MedicHall must not solve, outsource, relay, evade, suppress, or repeatedly
probe a CAPTCHA.

## Login, session, and email verification

MedicHall must not guess credentials, create accounts automatically, borrow
private credentials, persist a user’s portal cookie, hijack or replay a
session, or scrape behind an unauthorized login. A 401 or explicit login page
is `login_required`; an expired/session-bound download is
`session_required`. Email or role verification is manual and must be performed
by the authorized account holder on the official portal.

## Membership and paid portals

Membership and subscription requirements are `membership_required`; a
purchase or paywall is `paid_access_required`. MedicHall does not register,
subscribe, purchase, misrepresent eligibility, share accounts, or bypass a
paywall automatically. An authorized organization may access content under its
own agreement and upload it only when that agreement permits processing.

## Terms acceptance

Terms requiring an informed person’s acceptance are
`terms_acceptance_required`. Backend code must not click or submit acceptance.
The person must review and accept through the official portal under their own
authority before any lawful upload.

## Authorized manual uploads

A future production-ready upload path must:

- require the existing authenticated partner session;
- prove the user owns or administers the selected company;
- use a tenant-authorized storage policy and safe path;
- restrict count, MIME type, extension, and size;
- scan or validate the file before parsing;
- record tender, uploader identity, upload time, source portal, restriction
  status, declared authorization/provenance, and file hash;
- link the document to the normal analysis trace;
- preserve the original restricted attempt;
- allow audit/revocation without exposing other tenants’ documents.

Phase 0 adds provenance fields but does not certify the current upload path.
Repository SQL currently marks `tender-documents` public-read and the upload RPC
exists only as a manual setup patch with a document-type compatibility issue.
Do not use that path for private documents until live RLS/storage behavior is
verified and remediated without breaking the analysis provider’s access model.

## Prohibited behavior

Never implement or use:

- CAPTCHA solving or bypass;
- credential guessing, reuse, collection, or impersonation;
- session theft, replay, or browser-cookie export;
- automated account creation or email verification;
- automated terms acceptance;
- membership or payment bypass;
- anti-bot evasion, stealth scraping, proxy rotation, or rate-limit evasion;
- access to private documents without authorization;
- downloads from untrusted file hosts merely because a filename looks useful.

Repeated requests after a restriction is detected are also prohibited unless a
documented operator retry is needed to confirm a transient technical error.

## Status and class rules

Public:
`public_direct_download`, `public_detail_page`, `redirect_required`.

Public but currently unsupported:
`dynamic_javascript_required`, `unsupported_file_type`, `file_too_large`,
`archive_processing_required`.

Restricted:
`session_required`, `login_required`, `membership_required`,
`paid_access_required`, `captcha_required`, `terms_acceptance_required`,
`access_forbidden`.

Manual:
`manual_review_required`.

Technical:
`no_document_link_found`, `rate_limited`, `expired_link`, `broken_link`,
`download_timeout`, `parsing_failed`.

Processed:
`downloaded`, `parsed`.

## Logging, privacy, and retention

Store only what is needed for diagnosis:

- sanitized URL with username, password, query, and fragment removed;
- portal domain;
- source type/confidence;
- status/class, safe HTTP metadata, duration, attempt, version, and trace;
- machine category and a bounded sanitized message.

Never log authorization headers, cookies, passwords, tokens, personal email,
full private document text, or a full company-specific AI prompt. Metadata is
bounded and secret-like keys are redacted.

Access diagnostics are admin-only under RLS. Retention must be set by the data
owner before production deployment; recommended starting policy is 90 days for
successful raw attempts, 180 days for failures/restrictions, and longer only
for adjudicated incidents or legal audit needs. Aggregate metrics may be kept
longer after URLs and identifiers are removed. This recommendation is not an
automatic deletion job.

## Incident response

If a secret, unauthorized document, private URL, or personal data reaches a
trace:

1. stop the emitting function;
2. rotate the credential if applicable;
3. restrict access to the affected records;
4. preserve minimal incident evidence;
5. delete exposed content under the approved retention/incident process;
6. patch sanitization and test it before resuming.

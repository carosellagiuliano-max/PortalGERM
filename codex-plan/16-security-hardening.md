# Phase 16 — Security Hardening

> **PortalGERM target status: NOT IMPLEMENTED.** Any header/grep/test result below is a target. Security is built in each phase; this phase verifies complete coverage, including separate noindex/no-store controls (ADR-026).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 16. Read [99-rules-quickref.md](./99-rules-quickref.md) §10, §21 before starting.

## Goal

Final security pass on top of the auth/RBAC foundation: production-grade security headers, complete CSRF/IDOR coverage, content sanitisation, file-upload restrictions, audit-log completeness, and abuse-report end-to-end coverage.

## Prerequisites

- [ ] Phase 06 auth + initial headers done
- [ ] All feature phases (07–15) complete so every endpoint, SEO/cache path and Boost/Radar flow can be hardened

## Deliverables (checklist)

### Security headers (full set)

- [ ] At the installed-version request boundary (`proxy.ts` for Next 16; static headers may remain in `next.config.ts`) set and test per-response headers:
  - `Content-Security-Policy` — strict default. Allow: `'self'` for scripts/styles/images, the JSON-LD inline script + Next's hydration/bootstrap scripts via a **per-request nonce** (expect to also need `'strict-dynamic'` so Next's chunk loader works), `data:` for reviewed inline image assets, `https://fonts.googleapis.com` if used. **Disallow** arbitrary remote `img-src` and `unsafe-inline` for `script-src`. The one intentional exception is `style-src 'unsafe-inline'` (framework/CSS). See [decisions.md](./decisions.md) ADR-009.
  - `X-Frame-Options: DENY` (or `frame-ancestors 'none'` via CSP)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (production only)
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [ ] Verify via `curl -I` after a production build + `npm start` (HSTS only takes effect behind real HTTPS termination — note this for the deployment environment)

> **Decision:** Per-request CSP/nonce handling uses the pinned-version boundary (`proxy.ts` for Next 16; ADR-009). `script-src` never allows `unsafe-inline`; any style exception is documented and tested.

### CSRF / mutation safety

- [ ] If using server actions: rely on Next's same-origin enforcement and explicitly check `Origin`/`Referer` for any custom route handlers performing mutations
- [ ] Reject cross-origin mutations server-side
- [ ] Confirm cookies are `SameSite=Lax`, `Secure` in prod, `HttpOnly`

### IDOR / ownership coverage

- [ ] Sweep every route handler/server action that takes an entity id and require a **resource-specific authorized repository/use case** (`findJobForMember`, `findApplicationForCandidate`, `findInvoiceForCompany`, etc.) whose initial query includes tenant/candidate/participant scope. A broad pre-check followed by unscoped lookup is forbidden; missing and foreign objects share the same safe 404.
- [ ] Specifically cover:
  - `/employer/jobs/[id]` (read + write)
  - `/employer/applicants` (per-application access)
  - `/employer/billing/invoices/[id]` (per-company access)
  - `/employer/talent-radar` (anonymous id resolution server-side only)
  - `/candidate/applications/[id]` (per-candidate access)
  - `/candidate/messages/[threadId]` (per-candidate access)
  - `/admin/*` (role check)
  - `/support/[id]`, `/mock/checkout/[orderId]`, `/invite/[token]`, `/reset-password`, `/alerts/unsubscribe/[token]` and non-production `/dev/mailbox` (requester/Company/token/secret scope and generic error)
- [ ] Test guessed cross-company and nonexistent object UUIDs — both return an indistinguishable safe 404; a route-level role failure without object enumeration may return 403

### Input sanitisation

- [ ] All user-generated text rendered to HTML goes through `lib/security/sanitize.ts` (strip-tags or DOMPurify-server) and is rendered as text — never as raw HTML
- [ ] Markdown in guide articles (if used) rendered via a safelist (only headings, paragraphs, lists, links with `rel="noopener noreferrer"`)
- [ ] Zod enforces type, normalization and length and rejects control/null characters. Plain-text fields may contain angle-bracket text but are always output-escaped (so `<script>` renders inert); approved Markdown is parsed/sanitized through the allowlist. Tests distinguish validation from output encoding.

### File upload restrictions

- [ ] CV upload (mock storage): mime whitelist (`application/pdf`, `image/png`, `image/jpeg`, `image/webp`), size ≤ 5 MB, never persist bytes in MVP — metadata only
- [ ] Logo/cover in the Mock MVP stores only validated self-hosted/seed asset metadata whose path is under the reviewed `/assets/company-media/` manifest; no arbitrary employer-hosted HTTPS reference, fetch, tracking pixel or fake download exists. This matches `img-src 'self' data:` and `Referrer-Policy`; a real upload/scanner/proxy/CDN policy is a later reviewed release.
- [ ] Reject filename traversal patterns

### Rate limiting (final pass)

- [ ] Confirmed limits on: login, register, forgot-password, application submit, contact request, lead form, abuse-report submit
- [ ] On limit hit: HTTP 429 + friendly German message + audit log `RATE_LIMITED`

### Audit-log coverage matrix

Confirm `AuditLog` rows are written for every canonical sensitive event below. Adding a new sensitive mutation requires updating this typed matrix, its schema allowlist and the automated coverage test in the owning phase; a free-text catch-all is forbidden.

| Action | Where it fires |
|---|---|
| `USER_REGISTERED` / `USER_LOGIN` / `USER_LOGIN_FAILED` / `USER_LOGOUT` / `PASSWORD_RESET_REQUESTED` / `PASSWORD_RESET_COMPLETED` / `SESSION_REVOKED` | auth flows |
| `USER_SUSPENDED` / `USER_REACTIVATED` / `SESSION_REVOKED` | P0 admin user lifecycle; global role mutation has no P0 action |
| `COMPANY_CREATED_WITH_OWNER` / `COMPANY_CLAIM_REQUESTED` / `COMPANY_CLAIM_EVIDENCE_REQUESTED` / `COMPANY_CLAIM_APPROVED` / `COMPANY_CLAIM_REJECTED` / `COMPANY_PROFILE_UPDATED` / `COMPANY_ONBOARDING_COMPLETED` / `COMPANY_VERIFICATION_SUBMITTED` / `COMPANY_VERIFICATION_CHANGES_REQUESTED` / `COMPANY_VERIFIED` / `COMPANY_VERIFICATION_REJECTED` / `COMPANY_VERIFICATION_REVOKED` / `COMPANY_SUSPENDED` / `COMPANY_REACTIVATED` | company + claim + verification |
| `INVITATION_SENT` / `INVITATION_REVOKED` / `INVITATION_ACCEPTED` / `MEMBERSHIP_ROLE_CHANGED` / `MEMBERSHIP_REMOVED` / `JOB_ASSIGNMENT_CREATED` / `JOB_ASSIGNMENT_REVOKED` | team/membership/assignment |
| `JOB_DRAFT_UPDATED` / `JOB_SUBMITTED` / `JOB_REVIEW_STARTED` / `JOB_CHANGES_REQUESTED` / `JOB_APPROVED` / `JOB_PUBLISHED` / `JOB_REJECTED` / `JOB_FLAGGED` / `JOB_PAUSED` / `JOB_REACTIVATED` / `JOB_EXPIRED` / `JOB_CLOSED` / `JOB_REPORTING_CHECKED` | employer + moderation/system lifecycle |
| `APPLICATION_SUBMITTED` / `APPLICATION_STATUS_CHANGED` / `APPLICATION_WITHDRAWN` / `APPLICATION_EMPLOYER_NOTE_ADDED` / `MESSAGE_SENT` | candidate/employer communication; content excluded from Audit metadata |
| `CANDIDATE_ONBOARDING_COMPLETED` / `CANDIDATE_ONBOARDING_REOPENED` / `USER_CONSENT_CHANGED` / `RADAR_CONSENT_CHANGED` / `CONTACT_REQUEST_SENT` / `CONTACT_REQUEST_ACCEPTED` / `CONTACT_REQUEST_DECLINED` / `CONTACT_REQUEST_EXPIRED` / `CONTACT_REQUEST_CANCELLED` / `IDENTITY_REVEALED` / `IDENTITY_REVEAL_REVOKED` | Candidate/Talent Radar |
| `PRIVACY_CASE_ACCESSED` / `PRIVACY_REQUEST_CREATED` / `PRIVACY_REQUEST_STATUS_CHANGED` / `PRIVACY_EXPORT_MANIFEST_CREATED` | privacy case workflow |
| `CHECKOUT_CREATED` / `ORDER_PAID` / `ORDER_FAILED` / `ORDER_CANCELLED` / `INVOICE_ISSUED` / `INVOICE_PAID` / `INVOICE_VOIDED` / `SUBSCRIPTION_ACTIVATED` / `SUBSCRIPTION_CHANGED` / `SUBSCRIPTION_CANCELLING` / `SUBSCRIPTION_EXPIRED` | billing |
| `CREDITS_GRANTED` / `CREDITS_CONSUMED` / `CREDITS_EXPIRED` / `CREDIT_CONSUME_REVERSED` / `JOB_BOOST_ACTIVATED` / `JOB_BOOST_CANCELLED` / `JOB_BOOST_EXPIRED` | ledger/product fulfillment |
| `ABUSE_REPORT_SUBMITTED` / `ABUSE_REPORT_TRIAGED` / `MODERATION_RESTRICTION_APPLIED` / `MODERATION_RESTRICTION_LIFTED` / `MODERATION_RESTRICTION_EXPIRED` / `ABUSE_REPORT_RESOLVED` | abuse workflow |
| `IMPORT_PARSED` / `IMPORT_DECISION_RECORDED` / `IMPORT_COMMITTED` / `IMPORT_ROLLED_BACK` / `IMPORT_SETUP_APPROVED` / `IMPORT_SETUP_REVOKED` | import workflow |
| `SUPPORT_CASE_CREATED` / `SUPPORT_CASE_TRIAGED` / `SUPPORT_CASE_ASSIGNED` / `SUPPORT_CASE_REPLIED` / `SUPPORT_CASE_RESOLVED` / `SUPPORT_CASE_REOPENED` | support workflow |
| `CONTENT_DRAFTED` / `CONTENT_REVIEWED` / `CONTENT_PUBLISHED` / `CONTENT_UNPUBLISHED` / `TAXONOMY_CHANGED` | content/taxonomy |
| `LEAD_SUBMITTED` / `LEAD_STATUS_CHANGED` / `SYSTEM_TASK_ASSIGNED` / `SYSTEM_TASK_OUTCOME_RECORDED` | Sales/Cockpit |
| `CLUSTER_ASSESSMENT_APPROVED` / `CLUSTER_ACTIVATED` / `CLUSTER_REVOKED` / `CATALOG_VERSION_SCHEDULED` / `CATALOG_VERSION_DEACTIVATED` / `TAX_RATE_APPROVED` | launch/catalog governance |
| `RATE_LIMITED` / `AUTHORIZATION_DENIED_SENSITIVE` / `MAINTENANCE_PROJECTION_SYNCED` | security/system; denial logging is rate-limited and redacted to avoid an audit DoS |

- [ ] Each entry stores nullable `actorUserId`, explicit `actorKind: USER|SYSTEM|ANONYMOUS`, capability, entity type/id, result/reason/correlation and schema-allowlisted redacted metadata plus `version:HMAC-SHA-256(normalizedIp)` under the first active writer version from the dedicated rotating `AUDIT_IP_HASH_KEYS` keyring. Plain SHA/salt, raw IP and reuse of SESSION_SECRET are forbidden; event hash retention is 30 days. Anonymous login/rate/abuse events never fabricate a User actor.

> Verify the full typed matrix end-to-end against seeded workflows on PostgreSQL. Pay special attention to anonymous/system actors, reset/revocation, import decisions, Radar consent/contact/reveal, Credit consumption, Support/Content and maintenance projection events.

### Abuse reporting

- [ ] User-facing abuse-report dialog reachable from: job detail, company profile, message thread, candidate profile (private), employer applicant card
- [ ] Server action creates `AbuseReport` with `targetType`, `targetId`, `reason`, `description`, audit `ABUSE_REPORT_SUBMITTED`
- [ ] Verify the Phase 11 Admin queue at `/admin/reports` end to end
- [ ] Notification: send mock email `abuse_report_received` to the admin distribution list (template now in the Phase 04 `EmailTemplateKey` union)

### Logging & error handling

- [ ] `app/error.tsx` — friendly German error page; never leaks stack traces in production
- [ ] `app/not-found.tsx` — friendly 404
- [ ] All server paths use one structured logger producing timestamp, level, event name, correlation/trace id, environment and allowlisted entity/reason fields. A redaction layer removes secrets, tokens, raw email/IP, passwords, CV/message/body content and stack details from user responses; `console.*` outside the logger is CI-forbidden.

### Health routes

- [ ] `/health/live` reports only process liveness and build identifier; `/health/ready` performs bounded DB/migration readiness and required local dependency checks without leaking connection strings, table contents or provider secrets. Failed readiness returns 503 with a correlation id.

### Privacy headers / preview

- [ ] On `/candidate/messages/[threadId]` (Talent Radar threads pre-reveal) set `Cache-Control: no-store` to avoid CDN caching of personal data
- [ ] Explicit dynamic/no-store behavior for all personal Employer/Admin routes; `noindex` is a separate SEO instruction and does not satisfy cache protection
- [ ] Sensitive out-of-layout routes `/reset-password`, `/invite/[token]`, `/support/[id]`, `/alerts/unsubscribe/[token]`, `/mock/checkout/[orderId]` and local `/dev/mailbox` set `Cache-Control: private, no-store`, `robots: noindex,nofollow`, route-specific `Referrer-Policy: no-referrer`, never include the token/id in Canonical/analytics/log metadata and return generic invalid/foreign responses. `/dev/mailbox` is missing/fail-closed in Production and secret-authenticated in local/CI.

### Final IDOR sweep test plan

- [ ] Document a manual test plan in the README: 6 IDOR attempts (one per portal area) using the dev tools network panel and a second user account; expect all to fail.

## Files to create / modify

- `proxy.ts` for Next 16 (or pinned-version boundary) for nonce/dynamic headers; `next.config.ts` for suitable static headers
- `app/error.tsx`, `app/not-found.tsx`, `app/forbidden/page.tsx` (expected from Phase 06; verify and harden here)
- `app/health/{live,ready}/route.ts`, structured logger/redaction modules and production response tests
- `lib/providers/email/templates/abuse_report_received.ts` (new template)
- Sweep through all server actions ensuring ownership checks

## Rules to respect (from `99-rules-quickref.md`)

- §10 — IDOR, XSS, CSRF, secret hygiene, file upload limits, header set, no logging of secrets
- §21 — abuse handling, no auto-delete without admin review, audit
- §25 — no stack traces leaked

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] `curl -I http://localhost:3000/` after `npm run build && npm start` shows the full header set *(CSP+nonce+strict-dynamic, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, HSTS); homepage + job detail render with 0 CSP console errors*
- [ ] No `Set-Cookie` issues; `session` is `HttpOnly` `Secure` `SameSite=Lax` in prod *(Phase 06; cookie flags unchanged)*
- [ ] Manual IDOR attempts fail (cross-company, cross-candidate, cross-application); README documents the 6-attempt plan
- [ ] Job description with `<script>…</script>` shows literal text (no execution)
- [ ] Application/contact/etc. are rate-limited with friendly German responses and audit `RATE_LIMITED`
- [ ] Automated Audit coverage matrix proves records for every exact `AUDIT_ACTIONS_V1` member, including `RATE_LIMITED`, `USER_CONSENT_CHANGED`, `IMPORT_PARSED` and `ABUSE_REPORT_SUBMITTED`; source grep alone is not evidence
- [ ] HMAC tests prove deterministic output for one key version, different output after rotation, IPv4/IPv6 normalization, absence of raw/plain-SHA values and 30-day cleanup; response matrix proves every sensitive out-of-layout route's cache/robots/referrer/log behavior
- [ ] Reading `/admin` as a non-admin renders the framework's forbidden response with actual HTTP 403 and no object detail; APIs/actions return typed 403. Do not test or describe a redirect-to-200 as a 403.

## Common pitfalls

- Adding `unsafe-inline` to CSP "to make it work" — instead use script nonces or remove inline scripts
- Trusting `request.headers.get('x-forwarded-for')` for rate-limit IP without trusting the proxy chain — document the assumption
- Logging the full request body (which may contain CV / cover-letter text) — never log bodies
- Forgetting `Cache-Control: no-store` on candidate/employer endpoints with personal data
- Letting reactivation restore pre-suspension sessions. Suspension must revoke them; reactivation creates no session and requires a fresh login.

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Close systemic attack/privacy gaps and make failures diagnosable before a controlled pilot; security controls are verified, not first invented here. |
| Roles / requirements | All roles/Ops; REQ-SEC-001–003, IAM-002, TR-003–006, OPS-002. |
| Prerequisites | Every feature phase 06–15, including SEO and Radar; route/action/audit inventory complete. |
| Routes/actions | Apply headers/cache/rate/origin/error/redaction to all; `/health/live` and `/health/ready`; Admin audit/system; abuse flow verification. |
| Data | Audit/security events and minimal health/provider state; no raw bodies/secrets/CV/messages. |
| Validation/security | CSP nonce tested with Next hydration/JSON-LD, frame/nosniff/referrer/permissions/HSTS HTTPS, CSRF/origin, safe redirects, XSS/plain text, upload/import limits, trusted proxy policy, bounded queries. |
| Authorization/privacy | Full resource/action matrix, safe 404, admin capabilities, session/company suspension, Radar safe DTO/reveal, private no-store; noindex is not authorization/cache. |
| Audit/observability | Coverage matrix with actor/target/result/reason/correlation; structured redaction and alert/runbook hooks; rate/abuse/import/ledger events. |
| UX/mobile | safe error/rate/forbidden/conflict and correlation ID, no stacktrace; degradation does not display false success. |
| Seed | malicious XSS/XML/JSON plus denied CSV, IDOR Tenant A/B, secret/PII canaries, rate cases. |
| Tests | Production HTTP header/CSP/hydration, CSRF, XSS, IDOR every resource, cache, rate, audit matrix, log Canary, dependency/secret scan. |
| Verification | Build/start production server and automated security suite; inspect redacted logs. Expected 0 unresolved P0 and no sensitive Canary. |
| Risks / limitations | Production rate limiting is already the shared atomic Phase-03 store; local/test may use memory. Explicit maintenance commands still need a durable scheduled Worker before multi-instance autonomous operation. |
| Definition of Done | Every sensitive route/action has tested control/audit/cache behavior and incident evidence without exposing private data. |

# Phase 06 — Authentication & RBAC

> **PortalGERM target status: NOT IMPLEMENTED.** Middleware is not the security boundary. Current company-context, safe-404 and per-phase testing decisions apply (ADR-020/021/023).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 06. Read [99-rules-quickref.md](./99-rules-quickref.md) §8, §10 before starting.

## Goal

Wire up secure email/password authentication with httpOnly session cookies, server-side route protection, role-based access control, and company-membership ownership checks. After this phase the four demo accounts can log in and reach (only) their own dashboards.

## Prerequisites

- [ ] Phase 02 schema deployed (`User`, `Session`, `CandidateProfile`, `EmployerProfile`, `CompanyMembership`, `CompanyClaimRequest`, `UserConsentEvent`, `CandidateConsent`)
- [ ] Phase 03 helpers (`lib/auth/*`, `lib/security/*`, `lib/validation/auth.ts`)
- [ ] Phase 05 demo accounts seeded

## Deliverables (checklist)

### Auth pages (UI shells; styling polished in Phase 07)
- [ ] `app/(auth)/login/page.tsx` — email + password form with Zod-validated server action; generic error message ("E-Mail oder Passwort falsch")
- [ ] `app/(auth)/register/page.tsx` — landing that links to `/register/candidate` and `/register/employer`
- [ ] `app/(auth)/register/candidate/page.tsx` — name, email, password (strength rule), Terms acceptance. Talent Radar is not bundled into registration; its explicit, versioned opt-in occurs with the JobPass preview in Phase 09.
- [ ] `app/(auth)/register/employer/page.tsx` — name, work email, password, company name, optional Swiss UID, canton, size and an unticked current-Terms checkbox. Copy explains that name/UID/email domain are claim signals, not automatic ownership proof.
- [ ] `app/(auth)/forgot-password/page.tsx` — email input → mock email log entry; **never** reveal whether the email exists
- [ ] `app/(auth)/reset-password/page.tsx` — accepts the raw single-use token delivered through the EmailProvider, shows invalid/expired/used and success states with the same enumeration-safe wording, and collects/confirm-validates the new password
- [ ] `app/(auth)/logout/route.ts` (or server action) — clears session cookie + deletes `Session` row

### Server actions / route handlers
- [ ] `app/(auth)/login` server action: validate → `verifyPassword` → write `Session` → set cookie → redirect by role: candidate → `/candidate/dashboard`, employer/recruiter → `/employer/dashboard`, admin → `/admin`
- [ ] `app/(auth)/register/candidate` server action: create `User` + draft `CandidateProfile` + versioned Terms `UserConsentEvent` → auto-login → redirect to `/candidate/jobpass`
- [ ] `app/(auth)/register/employer` server action validates explicit current Terms (separate from optional Marketing) and atomically creates `User` + `EmployerProfile` + versioned `UserConsentEvent{TERMS}` plus exactly one audited branch under a normalized UID/domain/name+canton collision lock:
  1. **No candidate Company:** create one draft `Company` + Owner `CompanyMembership`, then auto-login and redirect to `/employer/dashboard` onboarding.
  2. **Possible existing Company / claim intent:** create no Company and no Membership; create one `CompanyClaimRequest{PENDING, requestedRole:OWNER}` referencing the existing candidate Company and bounded match-signal codes, then auto-login and redirect to `/employer/company/claim-pending`. Phase 10 collects evidence and Admin explicitly approves `OWNER|ADMIN` or rejects. Email-domain match is only a signal and never grants access/role.
  Any validation/collision/claim write failure rolls back User, Credential, Profile and Terms together—no partial account or duplicate Company. Before paid Billing exists, `getEffectiveEntitlements` resolves the seeded default Free PlanVersion only for a Company that the actor actually owns; Phase 06 creates no Billing effect.
- [ ] `requestPasswordReset({ email })`: normalize + rate-limit; always return the same result/timing envelope; when the account is eligible create a cryptographically random raw token, persist only its hash/expiry/single-use row, and pass the raw reset URL only to the EmailProvider. `EmailLog` stores template/purpose/redacted metadata, never the token or URL. Tests inject/capture the outbound message without persisting the secret.
- [ ] `resetPassword({ token, password, confirmPassword })`: hash token, lock and validate unused/unexpired row, update `Credential.passwordHash`, mark token used, revoke all Sessions and append required Audit evidence in one transaction; redirect to Login without auto-login. Reuse and parallel submissions produce one success.

### Route protection (server-side, mandatory)

> **Runtime note (ADR-001/012):** use the convention documented by the exact version pinned in Phase 01 (`proxy.ts` for the audited Next 16 reference). The boundary performs cheap cookie redirect/header work only. Authoritative `Session`, role, Membership and object access remain in protected layouts/use cases, regardless of Proxy runtime.

- [ ] `proxy.ts` (when retaining Next 16) — runs before private route groups:
  - Keep work bounded; read the session cookie and redirect if absent/invalid. Do not move object authorization or unrestricted Prisma queries into Proxy.
  - Optionally early-redirect based on a signed, non-secret role claim in the cookie (UX only) — **never** the security boundary
- [ ] `app/{candidate,employer,admin}/layout.tsx` (and every protected server action) call `getCurrentUser()` + `requireRole(...)` server-side, which **does** read `Session` + `User` from Prisma (Node runtime):
  - Anonymous / invalid session → redirect to `/login?next=<path>`
  - Wrong role → 403 page (`app/forbidden/page.tsx`)
  - Inactive (`User.status !== 'ACTIVE'`) → destroy session + redirect with reason
- [ ] For a Company context call `requireCompanyAccess(companyId)`; every nested Job/Application/Invoice/Request read or mutation must still use a resource-specific DB query scoped by that membership/assignment. **Proxy and a separate pre-check are never the object-authorization boundary.**
- [ ] `app/admin/*` layout additionally restricted to `Role.ADMIN`

### Company-level permissions
- [ ] All employer reads/writes (jobs, applicants, billing, talent radar, analytics) check active `CompanyMembership` role for the requesting user against the target company id
- [ ] Recruiter cannot edit company profile/billing — gate writes to `OWNER`/`ADMIN`
- [ ] Reject IDOR: derive Company context server-side where possible, then include it plus role/assignment in the nested object's first query; never load by request `id` and filter afterward

### Multi-company context

- [ ] `getEmployerContext()` loads all current user's active Memberships and resolves an optional signed httpOnly `company_context` cookie; it revalidates membership/status on **every** request and falls back only when exactly one active Company is available
- [ ] `switchCompanyContext({ companyId, next? })` selects the requested Company only inside the current user's active Membership query, writes/rotates the signed SameSite cookie and redirects through the safe-`next` allowlist. Foreign/inactive ids return the same safe result and never alter context.
- [ ] The context selects navigation/UX only; every Job/Application/Invoice/Radar query still includes the chosen Company + role/Assignment scope. Membership removal invalidates the context on the next request.

### Rate limiting (using `lib/auth/rate-limit.ts`)
- [ ] Use the single `RATE_LIMIT_PRESETS_V1` from Phase 03 verbatim; Phase 06 does not redefine numbers or keys: Login `IP+email-HMAC 10/15 min` plus `IP 30/hour`; Register `IP 10/hour`; Forgot Password `IP+email-HMAC 5/hour`; Application `User 30/hour` plus `IP 100/hour`; Contact `Company 20/hour` plus `User 30/hour` plus target `3/30 days`; Radar List `active Membership 10/rolling minute` plus persistent Company `30 distinct hashes/Zurich day`; Lead `IP 10/hour`; Abuse `actor-or-IP 10/day` plus `IP 20/day` plus target `3/day`; Privacy Request `User 5/rolling 30 days` plus one open same type; Privacy identity challenge `User 5/15 min` plus `IP 20/hour`.
- [ ] All composite identifiers, trusted-proxy IP normalization, shared Production atomic store, retry-after and redacted Audit semantics come from that preset. In-memory storage is permitted only in local/test and is never presented as Go-live protection.
- [ ] On limit hit: HTTP 429 + friendly German message + audit `RATE_LIMITED`

### Security headers (initial pass; full hardening in Phase 16)
- [ ] In `next.config.ts` set:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Strict-Transport-Security` (production only)
- [ ] CSP added in Phase 16 (placeholder noted)

### Sessions
- [ ] Cookie name `session`, `httpOnly`, `SameSite=Lax`, Secure in production; bounded idle renewal plus fixed absolute expiry, rotation on login/security boundary and hashed DB token
- [ ] On logout / role downgrade / status change, delete `Session` row
- [ ] Successful local reset/password change invalidates the reset token and all existing sessions before issuing any fresh login

### Audit
- [ ] `auditLog({ action: 'USER_LOGIN', actorUserId, ip })` on success
- [ ] Failed login writes an enumeration-safe security event with reason code and keyed normalized-email/IP hash; never raw email or password
- [ ] `auditLog({ action: 'USER_REGISTERED', actorUserId, metadata: { role } })`
- [ ] Employer registration also audits `COMPANY_CREATED_WITH_OWNER` or `COMPANY_CLAIM_REQUESTED` with signal codes but no raw UID/domain evidence; missing Terms creates nothing and emits no success event
- [ ] `auditLog({ action: 'USER_LOGOUT', actorUserId })`

### Forbidden / Not-found pages
- [ ] `app/forbidden/page.tsx` — German "Zugriff nicht erlaubt" + back-to-home link, `noindex`
- [ ] `app/not-found.tsx` — global 404 with search CTA

## Files to create / modify

- `proxy.ts` for Next 16, or the installed-version equivalent recorded by Phase 01
- `app/(auth)/{login,register,forgot-password,reset-password}/{page.tsx,actions.ts}`
- `app/(auth)/register/{candidate,employer}/{page.tsx,actions.ts}`
- `app/(auth)/logout/route.ts`
- `app/forbidden/page.tsx`, `app/not-found.tsx`, `lib/auth/employer-context.ts` and its server action/cookie helpers
- `next.config.ts` — initial security headers

## Rules to respect (from `99-rules-quickref.md`)

- §8 — bcrypt/argon2, httpOnly, no user enumeration, server-side RBAC, audit logs
- §10 — IDOR prevention, never trust client IDs, rate limiting
- §22 — demo accounts must remain functional (`Demo12345!`)
- §25 — friendly error pages; no stack traces to users

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] `candidate@demo.ch` reaches `/candidate/dashboard`; `/employer/dashboard` & `/admin` → 403
- [ ] `employer@demo.ch` reaches `/employer/dashboard`; `/admin` → 403
- [ ] `admin@demo.ch` reaches `/admin`; `recruiter@demo.ch` reaches `/employer/dashboard`
- [ ] Anonymous visits to any `/candidate|/employer|/admin` route redirect to `/login?next=...`
- [ ] Wrong password gives identical error message regardless of whether email exists
- [ ] Forgot for existing/nonexistent email returns indistinguishable UI; captured Mock delivery completes one local reset, expires/reuse fails, parallel reset yields one success, and all prior Sessions are invalid
- [ ] Forging another company's `companyId` in an object-scoped employer read/mutation returns the same safe 404 as a nonexistent object; role denial without object enumeration may return 403
- [ ] A Recruiter with active Companies A/B can switch context; every list/detail/action shows only the selected Company/assigned Jobs, a forged C id changes nothing, and removal from A makes the next A request/context unusable
- [ ] Concurrent Employer registrations with the same normalized UID/domain/name signal produce at most one new Company; the other atomic transaction produces a pending Claim with no Membership. Claim-pending User cannot read the Company until Admin approval.
- [ ] Candidate and Employer registrations both require an unticked current Terms acceptance and persist the exact notice/version; missing/forged acceptance rolls back every account/onboarding row, while Marketing remains optional and separate
- [ ] Login event lands in `AuditLog`
- [ ] Browser cookie `session` is `HttpOnly`, `SameSite=Lax`, `Secure` in production builds

## Common pitfalls

- Trusting middleware alone for ownership — middleware only checks role; ownership checks must run in the server action / data layer
- Returning the user's `passwordHash` to the client by accident — always `select` it out
- Setting `Set-Cookie: session=...; SameSite=None` without `Secure` (browser will reject) — keep SameSite=Lax for MVP
- Persisting or logging plain-text reset tokens/URLs — store only the hash; the raw token exists only in the outbound provider call/browser URL and is redacted from EmailLog/Audit/error output
- Skipping versioned Terms acceptance at registration or bundling Radar consent into it → the consent history becomes legally/technically ambiguous; keep `UserConsentEvent` and later `CandidateConsent` purposes separate

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Secure accounts, resumable onboarding and tenant isolation unlock every private product flow without creating an IDOR foundation. |
| Roles / requirements | Candidate, Employer, Recruiter, Admin; REQ-IAM-001–003, EMP-001, REC-001, SEC-001/003. |
| Prerequisites | 02–05; draft-compatible schema; ADR-001/010/013/020/021/023/026. |
| Routes/actions | Auth routes plus protected layouts; registerCandidate/Employer, login/logout, forgot+local reset mock, session rotate/revoke, company context; Team invitation UI completes in 10. |
| Data | User/Credential/Session/Reset, Company/Membership/Invitation/ClaimRequest, Terms event. Default Free capabilities are resolved from the seeded Free PlanVersion until Phase 12 creates paid Subscription/Grant effects. |
| Validation | Normalized email, password policy, Safe Next allowlist, token hash/expiry/single-use, Origin/CSRF, rate limits, generic enumeration-safe errors. |
| Authorization | Layout guards plus every action/query; global role alone never grants company data; suspended user/company rules; safe 404 object semantics. |
| Audit/notification | Login security events/rate limits, registration, logout/revocation, reset and role/membership changes; mock reset notification without token in logs. |
| UX/mobile | Pending/double-submit, validation, rate, generic auth error, expired token, onboarding choice/success; password-manager-friendly and 360px. |
| Seed | Four roles, Tenant A/B, multi-company recruiter, expired session/reset, suspended actors. |
| Tests | Login/register/logout/reset E2E; both-role Terms parity; new-Company versus collision/Claim branch and concurrent duplicate prevention; cookie flags/rotation/revocation; enumeration/open redirect/CSRF/rate; full role/tenant object matrix. |
| Verification | Auth/IDOR integration suite and browser smoke for four accounts. Expected 0 cross-tenant read/write and revoked sessions unusable. |
| Risks / limitations | Middleware is only redirect/header optimization; multi-role Admin split and real email reset are later. |
| Definition of Done | Protected routes/actions cannot be accessed by wrong/anonymous roles; Employer registration is atomic and cannot auto-claim/duplicate a possible Company; all auth/Terms states persisted/audited/tested. |

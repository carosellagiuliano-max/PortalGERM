# Phase 17 — Testing

> **PortalGERM target status: NOT IMPLEMENTED.** Any test counts/results below are targets. Tests begin in their owning phase; this phase adds cross-role E2E, accessibility, performance and regression, with real PostgreSQL tests for atomicity (ADR-023).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 17. Read [99-rules-quickref.md](./99-rules-quickref.md) §23 before starting.

## Goal

Consolidate the owning-phase Unit/PostgreSQL integration suites and add product-flow E2E-01–07 from [requirements-matrix.md](./requirements-matrix.md) so regressions in scoring, billing, privacy, permissions and complete journeys break the build. Phase 18 alone owns clean-clone/backup/restore/staging E2E-08 because Phase 17 cannot depend on its successor.

## Prerequisites

- [ ] Phases 02–16 implemented (helpers exist)
- [ ] Vitest configured in Phase 01

## Deliverables (checklist)

### Owning-phase test foundation audit

- [ ] Confirm the Phase-01 `vitest.config.ts`, path alias and `npm test` command still work; fix regression/configuration drift only, do not defer first-time setup here
- [ ] Inventory the Unit/PostgreSQL integration tests committed by Phases 02–16 and map each to its owning Requirement; a missing owning-phase test is completed in that domain before this release phase proceeds
- [ ] Confirm CI-friendly deterministic output and actual discovered/pass/skip counts

### Required owning-phase regression inventory

> The files/cases below are acceptance inventory that must already be green from the named owning phases. Phase 17 runs and closes gaps in the owner; it does not introduce new domain behavior or a second test foundation.

- [ ] **`tests/scoring/fair-job-score.test.ts`**
  - returns score 0 for empty job (no positive flags)
  - applies the exact v2 predicates: Tasks MISSING/PARTIAL/CLEAR = 0/8/15, response integer 1/30 accepted and 0/31 rejected, benefits 1/2 boundary, salary validation and injected `now < validThrough <= now+120d`
  - caps at 100 when all flags positive
  - **boost / plan / verification flags do NOT increase score** (assert by passing the same input twice with `boostActive` field absent vs imagined — the function shouldn't accept it)
  - `positiveReasons` and `missingImprovements` reflect the active flags
  - `employerSuggestions` are returned as German strings

- [ ] **`tests/scoring/match-score.test.ts`**
  - named Golden fixtures assert the exact versioned `score`, `confidence`, reasons and missing reasons for full, partial and missing-data cases
  - changing canton/language/workload/salary one factor at a time asserts the exact documented delta and evidence key
  - protected fields are absent at compile time and no result can trigger an employer Application transition

- [ ] **`tests/search/relevance.test.ts`**
  - title hit outranks a company-name hit, which outranks a body-only hit (3 > 2 > 1)
  - no keyword → all scores 0 (ranking then falls back to Fair-Job-Score → `publishedAt`)
  - deterministic for the same input

- [ ] **`tests/billing/feature-gates.test.ts`**
  - `canPublishJob` allows when the effective `ACTIVE_JOB_LIMIT` exceeds transactionally recounted usage, or only for the exact target of a current `AdditionalJobPermit`; no Permit changes global Entitlements
  - rejects when equal; suggested plan slug matches the next plan up
  - `canRequestContact` allows when plan/credits sufficient
  - rejects with `suggestedProductSlug = 'contact-pack-10'` when out
  - `canRunLicensedSupplyImport` permits only the P0 Platform capability with valid source-rights evidence and is independent of Company plan; `canUseEmployerImport` rejects every P0 plan/product, then permits only the matching effective grant/version after an explicit P1 fixture
  - `canUseAdvancedAnalytics` rejects `NONE`/`BASIC`, allows `ADVANCED`/`PRO`
  - typed resolver covers all eight keys, full Free→paid replacement, allowlisted Grants, unknown/mistyped/missing/ambiguous fail-closed and proves Ledger credits never grant Radar access

- [ ] **`tests/billing/boosts.test.ts`**
  - `computeBoostStatus` returns `SCHEDULED` when `now < startsAt`
  - `ACTIVE` when in window
  - `EXPIRED` when `now >= endsAt`; exact `startsAt` is active and exact `endsAt` is not, proving `[startsAt, endsAt)`
  - `CANCELLED` is a terminal explicit state

- [ ] **`tests/billing/talent-radar-credits.test.ts`**
  - decrementing one credit succeeds atomically
  - concurrent decrement attempts run against an isolated migrated PostgreSQL database and prove the Ledger/constraint/transaction cannot fund more requests than the available grant; repository mocks are forbidden for this assertion
  - rejection when no credits remain

- [ ] **`tests/applications/submission-state-response.test.ts`**
  - submit atomically creates exactly one immutable `ApplicationSubmissionSnapshot`, the selected CV `ApplicationSubmissionDocument`, one Application Conversation and the initial Event/Notification/Outbox records; idempotent retry cannot duplicate any of them
  - snapshot freezes Candidate identity/recipient, response target, effort, documents and notice/hash so later profile or JobRevision edits cannot rewrite the submitted evidence
  - the closed actor matrix permits Candidate withdrawal from every nonterminal status; Company Pipeline actors may use only `SUBMITTED→IN_REVIEW`, `IN_REVIEW→SHORTLISTED|REJECTED`, `SHORTLISTED→INTERVIEW|REJECTED`, `INTERVIEW→OFFER|REJECTED`, `OFFER→HIRED|REJECTED`; terminal, skip, backtrack and wrong-actor edges fail
  - `EMPLOYER_RESPONSE_RECORDED` is emitted only by the first authorized Company message or first move to `SHORTLISTED|INTERVIEW|OFFER|HIRED|REJECTED`, never by `SUBMITTED→IN_REVIEW`, a private note or a system/admin action

- [ ] **`tests/notifications/job-alert-policy.test.ts`**
  - `JOB_ALERT_POLICY_V1` schedules Europe/Zurich daily/weekly runs at 08:00, with the documented Monday-before/after, DST and cutoff boundaries under an injected clock
  - each digest contains at most 20 newly eligible Jobs, never repeats a delivered Job for that Alert, persists Digest/Item evidence and uses a hashed 180-day token
  - per-alert unsubscribe disables only that Alert; the separate global consent path disables all Alert delivery without changing Candidate activation or Radar consent

- [ ] **`tests/privacy/radar-policy.test.ts`**
  - listing requires active Membership, ACTIVE+VERIFIED Company, Radar entitlement, ACTIVE User, COMPLETE Candidate, current consent and LIVE provenance; a Contact Pack/credit alone never unlocks the query
  - cohort `<10` returns no cards/exact count; qualifying results use one persistent Company/day/filter sample of at most 20, two signed-cursor pages, 10 list requests/rolling minute/Membership and 30 distinct filter hashes/day/Company across processes
  - random opaque tokens are Company-scoped, rotate in non-overlapping 30-day Europe/Zurich epochs and fail indistinguishably cross-Company/after expiry/after eligibility loss; Contact history never stores the token
  - salary filtering accepts only explicit YEARLY/FTE preferences and never annualizes MONTHLY/HOURLY/unknown values

- [ ] **`tests/privacy/reveal-and-cases.test.ts`**
  - one accepted ContactRequest owns at most one RevealGrant; appended closed fields decrypt only their immutable AES-256-GCM value snapshots after current Company/grant trust checks and never reread live profile identity
  - Candidate-only grant-wide revocation is idempotent and blocks the very next DTO read; Employer/Admin cannot reveal, clear or reactivate it, while already disclosed knowledge and immutable confirmation evidence remain truthful
  - `EXPORT|DELETE|CORRECT` intake, recent-password `PrivacyIdentityChallenge`, Admin capability/status matrix, correction field-code bounds and no-PII Audit/Notification payloads are exhaustive

- [ ] **`tests/billing/subscription-schedule.test.ts`**
  - Company has 0..n history but at most one effective Subscription and one pending schedule; there is no competing `cancelAtPeriodEnd` truth
  - exact boundary projects CANCEL as `ACTIVE→CANCELLING→CANCELLED`, a natural lapse as `ACTIVE→EXPIRED`, and downgrade as old `ACTIVE→EXPIRED` plus successor `SCHEDULED→ACTIVE`, all idempotently
  - Plan change/cancel requires Owner; a target Seat reduction preserves an Owner, suspends non-retained Memberships and revokes pending invitations from the captured schedule snapshot

- [ ] **`tests/import/commit-rollback.test.ts`**
  - every approved item maps to an existing Company and rechecks licensed rights at commit; unmapped/unauthorized items cannot create or publish Jobs
  - rollback changes only checksum-unchanged import-owned `DRAFT→REMOVED`, retains all evidence and yields `ROLLED_BACK|PARTIALLY_ROLLED_BACK`; edited/used Jobs are conflicts and mixed rollback is never `PARTIALLY_COMMITTED`

- [ ] **`tests/security/rate-limit-presets.test.ts`**
  - every exact `RATE_LIMIT_PRESETS_V1` key/window/limit, HMAC identifier and safe error path is covered under an injected clock
  - two application processes sharing PostgreSQL cannot each obtain a fresh local quota; Production/Staging configuration rejects a memory backend

- [ ] **`tests/billing/vat.test.ts`**
  - `computeVat(10000, 810)` returns `{ net: 10000, vatAmount: 810, total: 10810 }` (Rappen + basis points, ADR-002)
  - integer rounding edges (for example `computeVat(3300, 810)` → VAT `267` Rappen)
  - zero-rated version returns VAT 0; missing/unapproved TaxRate fails closed in checkout

- [ ] **`tests/privacy/anonymize-candidate.test.ts`**
  - returned object contains: rotatable opaque `id` (not the PK), coarse `displayLabel` and only consented/bucketed region, skill, workload, salary, language, remote and availability fields
  - returned object **does not** contain: `publicDisplayName`, `firstName`, `lastName`, `email`, `phone`, `cityName`, `cvFileName`, `cvStorageKey`, `address`
  - the opaque id is **not** equal to `CandidateProfile.id`
  - test against a populated mock profile (with `CandidateSkill` + `CandidateLanguage`)

- [ ] **`tests/security/route-access.test.ts`**
  - `requireRole(Role.ADMIN)` against a candidate user throws/redirects
  - `requireCompanyAccess(companyA)` against a user only in `companyB` throws
  - works when user has the matching active `CompanyMembership`

- [ ] **`tests/auth/password.test.ts`**
  - `hashPassword(p)` !== plain
  - `verifyPassword(plain, hash)` true
  - `verifyPassword(wrong, hash)` false

### Required cross-role browser tests

- [ ] Committed browser suite covers E2E-01–07, critical route rendering, no critical console/CSP errors, mobile and accessibility. This is a pre-release gate, not optional. It emits the fixture/command/evidence manifest that Phase 18 reuses; it does not claim backup/restore.

### CI hygiene

- [ ] Tests are deterministic (no real time — pass `now` into helpers where relevant)
- [ ] Pure Unit tests may mock repositories; schema, ownership, idempotency and concurrency tests use an isolated real PostgreSQL database migrated with the production migration path
- [ ] `npm test` exits non-zero on any failure

## Files to create / modify

- Add the cross-role browser/E2E-01–07 suite, release fixtures/factories and CI browser service/configuration.
- Update the requirement→test/evidence manifest and only the minimum existing owner test/config files needed to close detected regressions.
- Do not create duplicate Phase-03/06/12/13/14 unit/domain suites here; those listed above belong to their implementation phase.

## Rules to respect (from `99-rules-quickref.md`)

- §23 — don't skip tests for scoring, billing, privacy, or permission
- §11 — explicit assertion that boosts don't affect Fair-Job-Score
- §17 — anonymizer test must catch regressions of identity leakage
- §38 — when reporting "tests passing" be honest about which tests actually exist

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] Unit, PostgreSQL integration and E2E commands pass on the target release commit; report actual discovered/pass/skip counts rather than inherited numbers
- [ ] Fair-Job-Score v2 golden fixtures assert every current ADR-017 factor/evidence value; Company verification and paid inputs remain absent
- [ ] Anonymizer test fails if a developer adds `email` to the returned shape *(keys + serialized-payload assertions)*
- [ ] Concurrent Credit Ledger test against PostgreSQL proves exactly one funded contact succeeds at balance 1 and the derived balance never becomes negative

## Common pitfalls

- Tests that assert the score is "≥ X" without locking the exact formula — they don't catch drift. Lock specific values for known inputs.
- Reusing real seed data in tests → tests become flaky as seed changes
- Skipping the anonymizer test "because it's just a mapping" — exactly the kind of code that silently grows leaks
- Async tests without proper `await` chain — flake city

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Prove that separately built slices form one stable, accessible and tenant-safe product before release review. |
| Roles / requirements | All four global roles plus company roles; REQ-QA-001/002 and E2E-01–07. E2E-08 is Phase 18. |
| Prerequisites | 01–16; owning-phase Unit/Integration suites already green. |
| Deliverables | Playwright or equivalent cross-role suite, isolated DB factories, CI browser service, A11y/mobile/performance checks, requirement→test/evidence report and flaky-test policy. |
| Data | Parallel-safe deterministic suite fixtures; real PostgreSQL for constraints/races; no mutable shared production/demo DB. |
| Authorization/privacy | Direct action/API adversarial tests across every tenant-owned resource; Radar payload/log Canary; admin/role/assignment matrix. |
| UX/mobile | Critical routes at 360px and desktop; keyboard/focus/error/locked/empty/success; axe critical findings zero; drag UI has list alternative. |
| Tests | E2E-01 Candidate; 02 Employer/Admin publish; 03 Billing idempotency; 04 Radar Reveal; 05 IDOR; 06 Abuse/Import; 07 Boost/Score/Search. Include concurrency and network-disabled providers. Phase 18 executes 08 clean release/restore. |
| Verification | `lint`, `typecheck`, Unit, Integration, E2E, Build, A11y and performance. Expected exit 0; retries may diagnose but not mask deterministic failures. |
| Audit/evidence | Each P0 Requirement links to passing Test ID and target commit. Failures are fixed in owning domain/phase, not patched only in test. |
| Risks / limitations | Missing browser/CI capability becomes Needs Verification and blocks corresponding release gate; “optional Playwright” is removed for critical flows. |
| Definition of Done | E2E-01–07 and the pre-release quality command set are green; no P0 trace gap, critical A11y issue or known cross-tenant/privacy failure. Clean-clone/restore remains explicitly pending for Phase 18. |

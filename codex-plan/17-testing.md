# Phase 17 — Testing

> **PortalGERM-Status: ABGESCHLOSSEN UND VERIFIZIERT.** Der vollständige lokale Unit-/PostgreSQL-/Build-/HTTP-/HSTS-/Zero-Retry-Browserlauf ist auf dem unveränderlichen Code-Commit belegt. Linux/PostgreSQL 16 und Windows sind auf dem direkt nach `main` und den Phasen-Branch gepushten CI-Zielcommit grün; beide Playwright-Artefakte sind für 14 Tage vorhanden. Der vollständige Nachweis steht in [evidence/2026-07-23-phase-17.md](./evidence/2026-07-23-phase-17.md).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 17. Read [99-rules-quickref.md](./99-rules-quickref.md) §23 before starting.

## Goal

Consolidate the owning-phase Unit/PostgreSQL integration suites and add product-flow E2E-01–07 from [requirements-matrix.md](./requirements-matrix.md) so regressions in scoring, billing, privacy, permissions and complete journeys break the build. Phase 18 alone owns clean-clone/backup/restore/staging E2E-08 because Phase 17 cannot depend on its successor.

## Prerequisites

- [x] Phases 02–16 implemented and linked to dated evidence
- [x] Vitest configured in Phase 01; Unit and PostgreSQL suites remain separate

## Deliverables (checklist)

### Owning-phase test foundation audit

- [x] Confirm the Phase-01 `vitest.config.ts`, path alias and `npm test` command still work; fix regression/configuration drift only, do not defer first-time setup here
- [x] Inventory the Unit/PostgreSQL integration tests committed by Phases 02–16 and map each to its owning Requirement; a missing owning-phase test is completed in that domain before this release phase proceeds
- [x] Confirm CI-friendly deterministic output and actual discovered/pass/skip counts

### Required owning-phase regression inventory

> The files/cases below are acceptance inventory that must already be green from the named owning phases. Phase 17 runs and closes gaps in the owner; it does not introduce new domain behavior or a second test foundation.

- [x] **`tests/unit/scoring/fair-job-score.test.ts`**
  - returns score 0 for empty job (no positive flags)
  - applies the exact v2 predicates: Tasks MISSING/PARTIAL/CLEAR = 0/8/15, response integer 1/30 accepted and 0/31 rejected, benefits 1/2 boundary, salary validation and injected `now < validThrough <= now+120d`
  - caps at 100 when all flags positive
  - **boost / plan / verification flags do NOT increase score** (assert by passing the same input twice with `boostActive` field absent vs imagined — the function shouldn't accept it)
  - `positiveReasons` and `missingImprovements` reflect the active flags
  - `employerSuggestions` returns typed, localizable reason codes; the Employer UI maps every rendered code to German copy and a UI assertion prevents raw codes from leaking

- [x] **`tests/unit/scoring/match-score.test.ts`**
  - named Golden fixtures assert the exact versioned `score`, `confidence`, reasons and missing reasons for full, partial and missing-data cases
  - changing canton/language/workload/salary one factor at a time asserts the exact documented delta and evidence key
  - protected fields are absent at compile time/runtime and the pure scorer has no Application-transition dependency

- [x] **`tests/unit/search/search-policies.test.ts`**
  - title hit outranks a company-name hit, which outranks a body-only hit (3 > 2 > 1)
  - no keyword → all scores 0 (ranking then falls back to Fair-Job-Score → `publishedAt`)
  - deterministic for the same input

- [x] **`tests/unit/billing/feature-gates.test.ts`**
  - `canPublishJob` allows when the effective `ACTIVE_JOB_LIMIT` exceeds transactionally recounted usage, or only for the exact target of a current `AdditionalJobPermit`; no Permit changes global Entitlements
  - rejects when equal; suggested plan slug matches the next plan up
  - `canRequestContact` allows when plan/credits sufficient
  - rejects with `suggestedProductSlug = 'contact-pack-10'` when out
  - `canRunLicensedSupplyImport` permits only the P0 Platform capability with valid source-rights evidence and is independent of Company plan; `canUseEmployerImport` rejects every P0 plan/product, then permits only the matching effective grant/version after an explicit P1 fixture
  - `canUseAdvancedAnalytics` rejects `NONE`/`BASIC`, allows `ADVANCED`/`PRO`
  - typed resolver covers all eight keys, full Free→paid replacement, allowlisted Grants, unknown/mistyped/missing/ambiguous fail-closed and proves Ledger credits never grant Radar access

- [x] **`tests/unit/billing/boosts.test.ts`**
  - `computeBoostStatus` returns `SCHEDULED` when `now < startsAt`
  - `ACTIVE` when in window
  - `EXPIRED` when `now >= endsAt`; exact `startsAt` is active and exact `endsAt` is not, proving `[startsAt, endsAt)`
  - `CANCELLED` is a terminal explicit state

- [x] **`tests/integration/privacy/talent-radar-contact-request-postgres.test.ts`** and **`tests/integration/billing/credits-postgres.test.ts`**
  - decrementing one credit succeeds atomically
  - concurrent decrement attempts run against an isolated migrated PostgreSQL database and prove the Ledger/constraint/transaction cannot fund more requests than the available grant; repository mocks are forbidden for this assertion
  - rejection when no credits remain

- [x] **`tests/integration/candidate/applications-saved-jobs-postgres.test.ts`** and **`tests/integration/employer/applications-postgres.test.ts`**
  - submit atomically creates exactly one immutable `ApplicationSubmissionSnapshot`, the selected CV `ApplicationSubmissionDocument`, one Application Conversation and the initial Event, `Notification` and `EmailLog` records; idempotent retry cannot duplicate any of them
  - snapshot freezes Candidate identity/recipient, response target, effort, documents and notice/hash so later profile or JobRevision edits cannot rewrite the submitted evidence
  - the closed actor matrix permits Candidate withdrawal from every nonterminal status; Company Pipeline actors may use only `SUBMITTED→IN_REVIEW`, `IN_REVIEW→SHORTLISTED|REJECTED`, `SHORTLISTED→INTERVIEW|REJECTED`, `INTERVIEW→OFFER|REJECTED`, `OFFER→HIRED|REJECTED`; terminal, skip, backtrack and wrong-actor edges fail
  - `EMPLOYER_RESPONSE_RECORDED` is emitted only by the first authorized Company message or first move to `SHORTLISTED|INTERVIEW|OFFER|HIRED|REJECTED`, never by `SUBMITTED→IN_REVIEW`, a private note or a system/admin action

- [x] **`tests/unit/candidate/job-alert-policy.test.ts`** and **`tests/integration/candidate/job-alerts-postgres.test.ts`**
  - `JOB_ALERT_POLICY_V1` schedules Europe/Zurich daily/weekly runs at 08:00, with the documented Monday-before/after, DST and cutoff boundaries under an injected clock
  - each digest contains at most 20 newly eligible Jobs, never repeats a delivered Job for that Alert, persists Digest/Item evidence and uses a hashed 180-day token
  - per-alert unsubscribe disables only that Alert; the separate global consent path disables all Alert delivery without changing Candidate activation or Radar consent

- [x] **`tests/unit/talentradar/privacy-policy-v1.test.ts`**, **`tests/unit/talentradar/list-candidates.test.ts`** and the PostgreSQL Radar suites
  - listing requires active Membership, ACTIVE+VERIFIED Company, Radar entitlement, ACTIVE User, COMPLETE Candidate, current consent and LIVE provenance; a Contact Pack/credit alone never unlocks the query
  - cohort `<10` returns no cards/exact count; qualifying results use one persistent Company/day/filter sample of at most 20, two signed-cursor pages, 10 list requests/rolling minute/Membership and 30 distinct filter hashes/day/Company across processes
  - random opaque tokens are Company-scoped, rotate in non-overlapping 30-day Europe/Zurich epochs and fail indistinguishably cross-Company/after expiry/after eligibility loss; Contact history never stores the token
  - salary filtering accepts only explicit YEARLY/FTE preferences and never annualizes MONTHLY/HOURLY/unknown values

- [x] **`tests/integration/privacy/talent-radar-reveal-postgres.test.ts`**, **`tests/integration/privacy/privacy-case-service.test.ts`**, **`tests/integration/privacy/privacy-export-postgres.test.ts`** and **`tests/unit/privacy/privacy-case-capability-matrix.test.ts`**
  - one accepted ContactRequest owns at most one RevealGrant; appended closed fields decrypt only their immutable AES-256-GCM value snapshots after current Company/grant trust checks and never reread live profile identity
  - Candidate-only grant-wide revocation is idempotent and blocks the very next DTO read; Employer/Admin cannot reveal, clear or reactivate it, while already disclosed knowledge and immutable confirmation evidence remain truthful
  - `EXPORT|DELETE|CORRECT` intake, recent-password `PrivacyIdentityChallenge`, Admin capability/status matrix, correction field-code bounds and no-PII Audit/Notification payloads are exhaustive

- [x] **`tests/integration/billing/subscription-lifecycle-postgres.test.ts`** and **`tests/integration/billing/subscription-plan-transitions-postgres.test.ts`**
  - Company has 0..n history but at most one effective Subscription and one pending schedule; there is no competing `cancelAtPeriodEnd` truth
  - exact boundary projects CANCEL as `ACTIVE→CANCELLING→CANCELLED`, a natural lapse as `ACTIVE→EXPIRED`, and downgrade as old `ACTIVE→EXPIRED` plus successor `SCHEDULED→ACTIVE`, all idempotently
  - Plan change/cancel requires Owner; a target Seat reduction preserves an Owner, suspends non-retained Memberships and revokes pending invitations from the captured schedule snapshot

- [x] **`tests/integration/admin/phase11-operations-postgres.test.ts`**
  - every approved item maps to an existing Company and rechecks licensed rights at commit; unmapped/unauthorized items cannot create or publish Jobs
  - rollback changes only checksum-unchanged import-owned `DRAFT→REMOVED`, retains all evidence and yields `ROLLED_BACK|PARTIALLY_ROLLED_BACK`; edited/used Jobs are conflicts and mixed rollback is never `PARTIALLY_COMMITTED`

- [x] **`tests/unit/auth/rate-limit.test.ts`** and **`tests/integration/auth/rate-limit-postgres.test.ts`**
  - every exact `RATE_LIMIT_PRESETS_V1` key/window/limit, HMAC identifier and safe error path is covered under an injected clock
  - two application processes sharing PostgreSQL cannot each obtain a fresh local quota; Production/Staging configuration rejects a memory backend

- [x] **`tests/unit/billing/vat.test.ts`**
  - `computeVat(10000, 810)` returns `{ net: 10000, vatAmount: 810, total: 10810 }` (Rappen + basis points, ADR-002)
  - integer rounding edges (for example `computeVat(3300, 810)` → VAT `267` Rappen)
  - zero-rated version returns VAT 0; missing/unapproved TaxRate fails closed in checkout

- [x] **`tests/unit/privacy/anonymize-candidate.test.ts`**
  - returned object contains: rotatable `opaqueId` (not the PK), coarse `displayLabel` and only consented/bucketed region, skill, workload, salary, language, remote and availability fields
  - returned object **does not** contain: `publicDisplayName`, `firstName`, `lastName`, `email`, `phone`, `cityName`, `cvFileName`, `cvStorageKey`, `address`
  - the opaque id is **not** equal to `CandidateProfile.id`
  - test against a populated mock profile (with `CandidateSkill` + `CandidateLanguage`)

- [x] **`tests/unit/security/route-access.test.ts`**
  - `requireRole("ADMIN")` against a Candidate throws the canonical authorization denial
  - `requireCompanyAccess(companyA)` against a user only in `companyB` throws
  - works when user has the matching active `CompanyMembership`

- [x] **`tests/unit/auth/password.test.ts`**
  - `hashPassword(p)` !== plain
  - `verifyPassword(plain, hash)` true
  - `verifyPassword(wrong, hash)` false

### Required cross-role browser tests

- [x] Committed browser suite covers E2E-01–07, critical route rendering, no critical console/CSP errors, mobile and accessibility. This is a pre-release gate, not optional. It emits the fixture/command/evidence manifest that Phase 18 reuses; it does not claim backup/restore.

### Implemented Phase-17 harness

- `playwright.config.ts` pins Chromium, one worker, zero retries, `de-CH`, `Europe/Zurich`, desktop 1440×900 and mobile 360×800 projects. Failure screenshots, traces and video remain local/CI artifacts.
- `scripts/phase17-browser-gate.ts` requires an existing Production build, creates and migrates a fresh allowlisted PostgreSQL database, applies the deterministic demo seed, starts `next start` on a random loopback port, waits for `/health/ready`, runs Playwright and drops the database in `finally`.
- `scripts/e2e/runtime-guard.cjs` applies the server logical-clock offset and rejects non-loopback `fetch`/HTTP/HTTPS. The browser fixture independently aborts non-loopback requests and records critical page/console/CSP/hydration errors.
- `tests/e2e/reporter.ts` writes `test-results/phase17/run-manifest.json` with fixture version, immutable commit token, runtime, anonymized database-run id, migration count/hash, retry policy, per-case result and artifact paths. A full run is accepted only when E2E-01–07 each has exactly one pass with retry `0`.
- `tests/e2e/quality/critical-routes.spec.ts` audits representative public, Auth, Candidate, Employer and Admin success/empty/locked routes at both viewports for critical axe findings, horizontal clipping, visible keyboard focus, critical console errors and explicit navigation/render budgets.
- E2E-08, clean clone, backup, restore and staging/deployment remain exclusively Phase 18.

### CI hygiene

- [x] Domain boundary tests use injected clocks; browser day/expiry boundaries use the logical server clock instead of wall-clock sleeps. Performance timings intentionally measure elapsed browser time against explicit budgets.
- [x] Pure Unit tests may mock repositories; schema, ownership, idempotency and concurrency tests use an isolated real PostgreSQL database migrated with the production migration path
- [x] `npm test` exits non-zero on any failure
- [x] Linux CI runs PostgreSQL 16 plus Unit, Integration, Build, HTTP smoke, Chromium E2E and HSTS smoke; Windows CI proves install/lint/typecheck/Unit/Build portability
- [x] CI uploads `playwright-report/phase17/` and `test-results/phase17/` for 14 days even when the browser gate fails

## Files to create / modify

- `playwright.config.ts`, `scripts/phase17-browser-gate.ts`, `scripts/e2e/runtime-guard.cjs`, `tests/e2e/**` and `.github/workflows/ci.yml` implement the cross-role browser and quality gate.
- `package.json`/`package-lock.json` pin Playwright/axe and expose `test:e2e:http`, `test:e2e:browser`, `test:e2e:list`, combined `test:e2e` and `test:e2e:hsts`.
- The requirement→test map and [draft Phase-17 evidence](./evidence/2026-07-23-phase-17.md) are updated together with only the minimum existing owner tests/configuration needed to close detected regression gaps.
- Do not create duplicate Phase-03/06/12/13/14 unit/domain suites here; those listed above belong to their implementation phase.

## Rules to respect (from `99-rules-quickref.md`)

- §23 — don't skip tests for scoring, billing, privacy, or permission
- §11 — explicit assertion that boosts don't affect Fair-Job-Score
- §17 — anonymizer test must catch regressions of identity leakage
- §38 — when reporting "tests passing" be honest about which tests actually exist

## Verification

> **Plan status:** Der vollständige lokale Gate-Lauf ist auf
> `fb7bc56b76b33d7ca5ad3725984cbf72d20f0696` bestanden: 1.940/1.940 Unit,
> 369/369 PostgreSQL-Integration und 17/17 Browser mit Retry `0`, beiden
> Projekten und vollständiger Quality-Matrix. Der CI-Zielcommit
> `02c6a51a01dd3b81a4eb53e0b989c3ef83c4d832` ist auf `main` und dem
> Phasen-Branch in Linux und Windows grün; beide Artefakte sind verlinkt.

- [x] Unit, PostgreSQL integration and E2E commands pass on the target release commit; report actual discovered/pass/skip counts rather than inherited numbers
- [x] `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e:http` and `npm run test:e2e:hsts` pass on the same code commit
- [x] The complete browser manifest records E2E-01–07 exactly once, retry policy `0`, both configured projects, the final migration hash and no skipped/failed/interrupted result
- [x] Linux PostgreSQL CI and Windows portability CI pass for the final pushed commit; the artifact name/run URL are linked from evidence
- [x] Fair-Job-Score v2 golden fixtures assert every current ADR-017 factor/evidence value; Company verification and paid inputs remain absent
- [x] Anonymizer test fails if a developer adds `email` to the returned shape *(keys + serialized-payload assertions)*
- [x] Concurrent Credit Ledger test against PostgreSQL proves exactly one funded contact succeeds at balance 1 and the derived balance never becomes negative

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
| Data | One isolated migrated/seeded PostgreSQL database per serial browser run; isolated PostgreSQL fixtures for constraints/races; no mutable shared production/demo DB. |
| Authorization/privacy | Representative browser IDOR/role attacks plus broader owning Unit/PostgreSQL route, tenant, Radar payload/log-canary and admin/capability matrices. |
| UX/mobile | Representative critical routes at 360px and desktop; keyboard/focus/locked/empty/success checks, critical axe findings zero and no unallowlisted horizontal clipping. |
| Tests | E2E-01 Candidate; 02 Employer/Admin publish; 03 Billing idempotency; 04 Radar Reveal; 05 IDOR; 06 Abuse/Import; 07 Boost/Score/Search. Include concurrency and network-disabled providers. Phase 18 executes 08 clean release/restore. |
| Verification | `lint`, `typecheck`, Unit, Integration, E2E, Build, A11y and performance. Expected exit 0; retries may diagnose but not mask deterministic failures. |
| Audit/evidence | Each P0 Requirement links to passing Test ID and target commit. Failures are fixed in owning domain/phase, not patched only in test. |
| Risks / limitations | Missing browser/CI capability becomes Needs Verification and blocks corresponding release gate; “optional Playwright” is removed for critical flows. |
| Definition of Done | E2E-01–07 and the pre-release quality command set are green; no P0 trace gap, critical A11y issue or known cross-tenant/privacy failure. Clean-clone/restore remains explicitly pending for Phase 18. |

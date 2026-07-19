# Product Quality Gates

> Cross-cutting checklist for every SwissTalentHub route, component, server action, model, and business flow. Apply this before coding each phase and update the phase file when something is missing.

## Purpose

SwissTalentHub must not become a collection of attractive screens without underlying product behavior. Every feature must be backed by data, permissions, validation, useful UX states, seed data, tests, and documentation.

Use this file as the "done thinking" gate before implementation starts for a feature.

---

## Universal Feature Gate

For every feature, document or implement all items below:

- [ ] **User story:** who uses it, what they are trying to do, and what success means.
- [ ] **Route / entry point:** URL, navigation location, CTA source, and redirect behavior.
- [ ] **Data model:** Prisma model(s), relations, indexes, unique constraints, and seed impact.
- [ ] **Server action / API:** mutation or query boundary; no business-critical client-only logic.
- [ ] **Validation:** Zod schema, German validation messages, field length limits, enum handling.
- [ ] **Authorization:** role check plus ownership/company/candidate scope check before any read or write.
- [ ] **Privacy:** identity-bearing fields reviewed; no Talent Radar leakage; no private data in SEO or logs.
- [ ] **Feature gate:** plan/product/credit limit enforced server-side where monetized.
- [ ] **Audit:** sensitive action writes `AuditLog` with actor, entity, metadata, and hashed IP where useful.
- [ ] **Notifications:** mock email/log created where a real product would notify a user.
- [ ] **UX states:** default, loading, empty, success, validation error, permission error, rate-limit error, and offline/server error.
- [ ] **Mobile:** usable at 360 px width; forms, tables, filters, modals, and dashboards do not overflow.
- [ ] **Accessibility:** semantic HTML, labels, focus states, keyboard-operable dialogs/menus, sufficient contrast.
- [ ] **Seed/demo:** seeded rows make the feature non-empty for the relevant demo account.
- [ ] **Tests:** unit test for pure logic; integration/manual smoke for critical route; edge cases covered.
- [ ] **Documentation:** README/phase docs mention behavior, limitations, and mock provider boundary.

No feature is complete if it only satisfies the UI row.

---

## Required UX State Matrix

Every route must deliberately handle these states.

| State | Requirement |
|---|---|
| Loading | Skeleton or compact loading region; no layout jump. |
| Empty | Helpful German copy, next action, and no dead dashboard tables. |
| Error | Friendly German message; no stack traces or raw exception text. |
| Forbidden | 403 page or inline locked state; explain the missing permission/plan. |
| Not found | 404 that does not reveal whether another tenant's record exists. |
| Success | Clear confirmation, next step, and persisted DB state. |
| Validation | Field-level German errors and preserved user input. |
| Rate limited | Friendly message and audit `RATE_LIMITED`; no retry spam loop. |
| Mobile | Filters become sheet/drawer; tables become cards; buttons remain tappable. |

---

## Flow Completion Checks

### Candidate Flows

- [ ] Register/login/logout works and preserves intended `next` redirect safely.
- [ ] SwissJobPass edit writes profile, skills, languages, consent, and CV metadata.
- [ ] Search/save/apply flow dedupes applications and records an application event.
- [ ] Jobabo create/edit/delete has email preview and mock email log.
- [ ] Application cockpit supports list + Kanban, notes, withdraw, messages, abuse report.
- [ ] Candidate activation uses the exact complete/reopen predicate; Talent Radar requires COMPLETE + current opt-in, is reversible and writes consent history.
- [ ] Reveal is explicit, candidate-initiated and logged. The required Candidate command `revokeIdentityReveal` revokes all **future Radar DTO access** to that request-scoped grant immediately, never erases knowledge already disclosed; Employer/Admin can neither trigger, clear nor re-enable Reveal.
- [ ] Privacy dashboard exposes bounded Export/Delete/Correction cases, contact/Reveal history, explicit Reveal revocation, and consent log with truthful Mock/irreversibility copy.

### Employer Flows

- [ ] Employer Register requires Terms and atomically creates either User/Profile + new Company/Owner or User/Profile + pending Claim with no Company/Membership; collision/domain never auto-grants. Default Free resolves only in an authorized Company and creates no Billing effect before Phase 12.
- [ ] Company profile edit respects company role permissions.
- [ ] Job wizard persists drafts per step and final submit revalidates everything server-side.
- [ ] Publishing respects active-job limit; blocked actions show an upgrade path.
- [ ] Applicant pipeline never exposes Talent Radar identity unless reveal/application permits it.
- [ ] Talent Radar locked preview does not query anonymous candidate data.
- [ ] Radar requires ACTIVE+VERIFIED Company; Contact consumes source-separated plan→purchased→admin credit atomically, enforces 14-day expiry/pending duplicate/30-day recontact and performs no automatic refund.
- [ ] Billing checkout requires authorized complete BillingProfile, line PlanVersion/ProductVersion XOR and typed target; it creates immutable local `Order`/`Invoice`/subscription/credit state via mock provider.
- [ ] Analytics only shows levels allowed by the plan.

### Platform Admin / Operations Flows

- [ ] Admin can moderate jobs, companies, users, reports and imports; triage Support cases; review/publish Content; work leads; and, after Phase 12, manage versioned Billing/Katalog through shared use cases.
- [ ] Suspending a company pauses active jobs and invalidates risky access.
- [ ] Suspending a user invalidates sessions.
- [ ] Admin cannot activate success-fee billing.
- [ ] Business Cockpit shows actionable sales/revenue suggestions, not empty vanity charts.
- [ ] `/admin/business-cockpit` is capability-scoped to Platform Admin/Sales; Company Owner/Admin can read only their own tenant Billing, usage and allowed analytics, never global MRR, leads or another Company.
- [ ] Support lifecycle is capability-scoped, SLA-visible and audited; Content revisions are safe and cannot bypass the liquidity/index gate.
- [ ] Every admin mutation writes audit and has a confirmation where destructive.

---

## Monetization Edge Cases

Handle or document these before billing implementation:

- [ ] Same-plan purchase blocked with clear message.
- [ ] Downgrade path explains what happens to active jobs above the lower limit.
- [ ] Cancelling subscription keeps benefits through the defined instant before `currentPeriodEnd`; exact-boundary tests prove no benefits at/after the end.
- [ ] Failed/cancelled order does not grant credits or plan access.
- [ ] Paid product effects are idempotent; confirming twice does not double-grant.
- [ ] Contact credits cannot go negative under concurrent requests.
- [ ] Included boosts cannot go negative under concurrent requests.
- [ ] Success-fee product stays inactive and disabled even for admins.
- [ ] VAT uses integer Rappen and is displayed only at boundaries.
- [ ] Invoice status transitions are explicit and auditable.

---

## Privacy & Security Edge Cases

- [ ] Talent Radar list payload is constructed from a restricted Prisma `select`; no client-side filtering of private fields.
- [ ] Anonymous ids are not primary keys and cannot be reused to infer candidate identity.
- [ ] Employer can see candidate identity only after direct application or candidate reveal for that company.
- [ ] Message bodies, cover letters, job text, guide content, and abuse descriptions render as sanitized text.
- [ ] No private route is indexable; sitemap excludes dashboards and API routes.
- [ ] File metadata validates MIME, size, and traversal; MVP stores no file bytes.
- [ ] The exact `RATE_LIMIT_PRESETS_V1` covers login, register, reset, apply, privacy intake/challenge, Radar list, contact request, lead form and abuse report; Production/Staging use the shared PostgreSQL bucket store and fail closed on a memory backend.
- [ ] Logs never include passwords, tokens, raw CV content, full message bodies, or payment secrets.

---

## Documentation Evidence

When finishing a phase, capture:

- [ ] Commands run and exact pass/fail status.
- [ ] Manual browser checks and demo account used.
- [ ] Known limitations and "Needs verification" items.
- [ ] Mock-provider behavior and later real-provider integration notes.
- [ ] Screens/routes verified on desktop and mobile widths.

---

## Phase Execution Contract

Every phase file must explicitly contain or link to all of the following before implementation begins:

- [ ] Goal and business/user value.
- [ ] In-scope and explicitly out-of-scope behavior.
- [ ] Affected roles and capabilities.
- [ ] Hard prerequisites and downstream consumers.
- [ ] Requirement IDs and concrete deliverables.
- [ ] Routes/entry CTAs/navigation behavior.
- [ ] Data models, constraints, indexes, migrations and seed impact.
- [ ] Queries, server actions, route handlers, background/command behavior.
- [ ] Zod validation, status transitions and conflict/idempotency rules.
- [ ] Global role, company membership, assignment, ownership and entitlement checks.
- [ ] Audit, notifications, analytics and sensitive-data redaction.
- [ ] Desktop/mobile/A11y behavior and every relevant UX state.
- [ ] Unit, PostgreSQL integration and E2E ownership for the phase.
- [ ] Verification commands with expected assertions, not only command names.
- [ ] Risks, known limitations, rollback/migration notes and Definition of Done.

Linking to the current [architecture blueprint](./architecture-blueprint.md), [requirements matrix](./requirements-matrix.md) and [implementation plan](./implementation-plan.md) is acceptable; inherited source-code evidence is not.

## Route Evidence Record

Use one record for every important page before checking its route deliverable:

| Field | Required evidence |
|---|---|
| Purpose / roles | User goal, allowed roles and entry CTA |
| Primary / secondary actions | Exactly what persists or navigates |
| Data | Read model, pagination/filter and freshness |
| Server policy | Session, capability, tenant, ownership, assignment, entitlement |
| States | Default, loading, empty, validation, conflict, error, forbidden/not-found, locked, success, onboarding/offline where relevant |
| Trust/privacy | Score/source/date/sponsoring/consent/PII behavior |
| Desktop/mobile | Screenshot or named manual check at desktop and 360 px |
| Accessibility | Keyboard path, focus/error announcement, automated result |
| Seed | Named fixture/account/state |
| Tests | Requirement/Test IDs and pass result |
| Evidence | Target commit, date, environment and command/manual check |

## Marketplace and Commercial Gates

- [ ] Production-like data has documented provenance and permission; no scraping or hidden demo data.
- [ ] A promoted/indexed cluster passes its documented liquidity/content gate.
- [ ] Free-to-paid restrictions correspond to additional economic value, not an intentionally broken basic flow.
- [ ] Pricing, period, VAT, renewal, cancellation and downgrade effects are visible before confirmation.
- [ ] Every upgrade prompt has a real reason code and points to a currently available product/plan.
- [ ] Sponsored inventory is capped, clearly labelled and never changes fairness scores.
- [ ] Product analytics can measure activation, application response, employer value, conversion and churn without content/PII.
- [ ] Business Cockpit recommendations contain evidence period, reason, next action, owner and outcome.
- [ ] Unsupported products/claims are removed or explicitly labelled as future; Success Fee cannot be activated.

## Data and Concurrency Gates

- [ ] Schema changes use migrations and include rollback/forward notes; no production `db push`.
- [ ] Money fields are Rappen integers and catalog/invoice fields are immutable snapshots.
- [ ] Credit, quota, publish, checkout and fulfillment races are covered by real PostgreSQL integration tests.
- [ ] Idempotency keys have database uniqueness and are scoped to the use case/tenant.
- [ ] Status changes use an allowed-transition function and append an event.
- [ ] List endpoints are bounded and indexed; ranking is applied globally before pagination.
- [ ] Seed uses a deterministic clock/namespace and refuses production demo data.

## Talent Radar Threat-model Gate

- [ ] One canonical, versioned opt-in source exists and defaults off.
- [ ] Locked state returns before any candidate repository query.
- [ ] Anonymous DTO is an allowlist and has Canary-PII regression tests across JSON, HTML and logs.
- [ ] Opaque Radar identifiers cannot be mapped from primary keys or stable handles by clients.
- [ ] `RADAR_PRIVACY_POLICY_V1` is enforced after the complete filter conjunction: closed buckets, cohort floor 10, no exact total, stable daily max-20 sample, max two signed-cursor pages, 10 list requests/minute/Membership and 30 distinct filter hashes/day/Company.
- [ ] Opaque ids are random Company-scoped 128-bit tokens with keyed lookup, no-overlap 30-calendar-day Europe/Zurich epochs, immediate invalidation on eligibility loss and a fresh id after re-opt-in; replay/cross-company/expired values fail indistinguishably.
- [ ] Contact allowance/credit consumption records funding source and is atomic/idempotent.
- [ ] Accept, decline, exact 14-day expiry, pending duplicate, 30-day recontact, Company trust revocation and no-auto-refund/Admin exact-reversal policies are explicit and clock/DB tested.
- [ ] Reveal identifies recipient Company, accepted request/conversation, one grant per accepted request, closed append-only `RevealField` rows and immutable notice/confirmation evidence. Each field stores its exact confirmed value as an AES-256-GCM encrypted, versioned, typed snapshot under a dedicated PII keyring; Radar reads decrypt that snapshot only after the current trust/grant guard and never reread live profile identity or generic JSON. Employer cannot trigger it.
- [ ] Candidate revocation is idempotent and blocks the next identity read; opt-out/suspension cancels pending requests under the canonical transaction, cancelled requests are read-only/reportable, and already accepted history is retained.
- [ ] EXPORT/DELETE/CORRECT intake is bounded and owner-scoped; Admin privacy routes use named read/verify/process capabilities and the closed status/command matrix. Export/delete remain truthful local Mocks and audits/notifications contain no case text or identity evidence.
- [ ] Candidate UI explains that already delivered identity cannot technically be taken back.
- [ ] Export/delete/retention behavior is honestly marked mock or legally reviewed.

## Release and Operations Gate

- [ ] Clean clone, install, migration, seed, lint, typecheck, all tests and production build pass on the release commit.
- [ ] CI, Preview, Staging and Production have separate secrets/databases and fail-fast env validation.
- [ ] Private pages are both `noindex` and no-store/dynamic as required.
- [ ] Live/readiness checks, structured redacted logs and correlation IDs work.
- [ ] Alerts/runbooks cover auth, database, ledger/payment, import and suspected cross-tenant/privacy incidents.
- [ ] Backup retention and business-approved RPO/RTO exist; an isolated restore was actually tested.
- [ ] Dependency, license and secret scans have no unresolved critical finding.
- [ ] Legal/privacy/tax/provider Go-live blockers are named and signed off separately from technical tests.

## Evidence Status Vocabulary

- **Planned:** requirement exists; no code claim.
- **Implemented, not verified:** code exists; checkbox remains open.
- **Needs verification:** test/check could not be run; checkbox remains open with reason.
- **Verified in target:** dated target-repository evidence exists; eligible for `[x]`.
- **Mock provider:** local persisted behavior only; never phrased as real delivery/payment/storage.
- **Deferred / rejected:** recorded in the audit/ADR with impact and replacement, never silently removed.

# Phase 11 — Admin Portal

> **PortalGERM target status: IMPLEMENTED AND VERIFIED.** The Phase-11 operations, moderation, support, content, import, lead and evidence-based cockpit scope is verified against code commit `b115b49d94297c94df0b85fb40e056d2024fc582`; see [`evidence/2026-07-21-phase-11.md`](./evidence/2026-07-21-phase-11.md). Phase 12 still owns Payment, Invoice, Subscription, Ledger and Admin Billing/Katalog mutations through one Billing domain (ADR-019).

> **Follow-up audit:** The independently re-evaluated Phase-11 gaps and corrections are verified against code commit `ee57eecca4dcee70764fcd48aeebd7b413b5ad54`; see [`evidence/2026-07-22-phase-11-follow-up.md`](./evidence/2026-07-22-phase-11-follow-up.md).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 11. Read [99-rules-quickref.md](./99-rules-quickref.md) §18, §21 before starting.

## Goal

Build the operations, moderation, support, content, import, lead and initial action-cockpit routes. Billing/catalog/invoice/credit routes and revenue definitions are deliberately absent until Phase 12, which owns their use cases and navigation. Every sensitive action is capability-checked and audit-logged.

## Prerequisites

- [x] Phase 06 auth (`requireRole(Role.ADMIN)`) on every admin route
- [x] Phase 03 helpers (`lib/audit`, capability policies, analytics primitives)
- [x] Phase 05 seeded data (jobs in `SUBMITTED/IN_REVIEW`, abuse/support cases, content drafts, sales leads)
- [x] Phase 10 employer Job/Company/Applicant use cases and status machines

## Deliverables (checklist)

### Layout

- [x] `app/admin/layout.tsx` — sidebar for Übersicht · Jobs · Unternehmen · Benutzer · Taxonomie · Reports · Importe · Support · Content · Leads · Business Cockpit · Logout. Phase 12 adds Billing/Katalog/Analytics entries, Phase 14 Privacy and Phase 16 Audit/System only when their routes work; Phase 11 renders no dead links or premature data shells.
- [x] `noindex` meta
- [x] Top bar shows admin user + a global search (jobs/companies/users by id/slug/email)

### `/admin` — Overview

- [x] Operational metric cards: pending/ageing jobs, verification cases, active supply, open reports, import failures, support SLA breaches and new leads. Phase 12 adds financial metrics from its canonical definitions.
- [x] Recent admin actions feed (latest `AuditLog` entries)
- [x] Links to all ten Phase-11 operations sub-pages; later-phase Billing, Privacy, Audit and System routes remain absent

### `/admin/jobs`

- [x] Tabs: Pending Review · Approved · Published · Rejected · Closed · All
- [x] Per-row actions follow the canonical machine and append one event per transition: Start review (`SUBMITTED → IN_REVIEW`), Request changes (`IN_REVIEW → CHANGES_REQUESTED`), Approve (`IN_REVIEW → APPROVED`, sends `job_approved`), Reject (`IN_REVIEW → REJECTED`, sends `job_rejected`), and Publish (`APPROVED → PUBLISHED`) through the shared atomic service with current Company verification/restriction/revision/quota. Publish requires `now<validThrough<=now+90d` and copies expiry, Category/Canton/City and Salary Period/Min/Max projections from the approved Revision in the same transaction; invalid/drift fails. No action skips status/event.
- [x] Detail drawer/page: full job preview, Fair-Job-Score breakdown, scoring explanation, related employer audit history
- [x] Each action writes `AuditLog` (`JOB_APPROVED`/`JOB_REJECTED`/`JOB_FLAGGED`)

### `/admin/companies`

- [x] List with filters: canton, industry, verified, suspended, plan
- [x] Actions use canonical lifecycle/event commands: request evidence/verify/reject/revoke a `CompanyVerificationRequest`; `CHANGES_REQUESTED → PENDING` reuses that request, while a rejected/revoked cycle is closed and the Employer must start a new request with `supersedesRequestId`. At most one open cycle exists. Derive the public `VERIFIED` badge only from the latest current verified event. Transition Company `ACTIVE ↔ SUSPENDED` with mandatory reason; suspension atomically pauses effective public jobs and writes `COMPANY_SUSPENDED`.
- [x] A separate Company-Claim queue inspects the Phase-06 match signals/evidence. `approveCompanyClaim({ claimId, approvedRole: OWNER|ADMIN, reason })` locks Claim/User/Company and seat scope, verifies no conflicting Membership, creates exactly that reviewed Membership and events/Audit; reject/request-evidence creates no Membership. Company email domain/UID never auto-approves or selects role. A claim cannot mutate verification state.
- [x] Detail page: profile, member list, active subscription, plan usage, recent activity, abuse reports, audit log

### `/admin/users`

- [x] List with filters: role, status, has-active-subscription
- [x] P0 actions: Suspend, Reactivate, Force-logout (delete sessions). Global `User.role` mutation is **not exposed** in P0; Company Membership roles are managed by Owner/Admin in Phase 10. A future break-glass global-role workflow needs separate approval, last-Platform-Admin invariant, profile/membership migration and full session revoke.
- [x] **Never** show `passwordHash`
- [x] Detail page: profile, basic activity, audit log
- [x] Audit `USER_SUSPENDED`, `USER_REACTIVATED`, `SESSION_REVOKED`; tests prove no Admin route/action can mutate global Role in P0

### `/admin/taxonomy`

- [x] CRUD/version/deactivate on `Category`, `Canton`, `City`, `Skill`, `OccupationCodeVersion/Code`; prefer deactivation when referenced
- [x] Reordering (sortOrder), activate/deactivate where relevant
- [x] Audit log entries on every change

### `/admin/reports`

- [x] List of `AbuseReport` with status, severity, target type, assignee, due/SLA breach filters and risk-first ordering; Critical has an explicit response target and escalation state
- [x] Detail: least-privilege target preview, reporter (anonymous if missing), reason/description, assignment, restriction impact and append-only event history
- [x] Actions: triage severity/due, assign, apply/lift a typed `ModerationRestriction`, Dismiss or Resolve with reason. Restrict calls canonical downstream policies (hide/pause Job, suspend Company/User+sessions, block thread), shows impact confirmation and appends domain event + required Audit atomically.
- [x] Audit every report/restriction transition with actor/result/correlation; sensitive description never appears in Audit/Analytics

#### Binding moderation-restriction effects

| Restriction | Canonical affected resource | Apply effect | Lift / expiry effect |
|---|---|---|---|
| `HIDE_JOB` | Report target must be `JOB`; affected id is that Job | Keep domain Job status/history unchanged; active Restriction makes `isJobPubliclyEligible` false immediately and blocks publish/reactivate | Remove only the restriction. Visibility returns only if every ordinary public predicate still passes; never force a status transition |
| `PAUSE_COMPANY` | Report target `COMPANY` (or target Job resolved to its Company with explicit impact confirmation) | `Company ACTIVE→SUSPENDED`; pause each currently PUBLISHED Job with event; block Company mutations/Radar/checkout while historical authorized reads remain | Mark Restriction lifted/expired only. Company and Jobs remain suspended/paused until separate reviewed reactivate commands; no session/right is silently restored |
| `SUSPEND_USER` | Report target `USER` (a Message reporter resolves its sender explicitly) | `User ACTIVE→SUSPENDED`, revoke all Sessions, invalidate Radar mappings, cancel affected PENDING Contacts through Phase-14 policy and block new messages | Restriction removal does not reactivate User, restore Sessions or republish Radar; separate `reactivateUser` plus fresh login/explicit Radar opt-in is required |
| `BLOCK_MESSAGE_THREAD` | Report may target `MESSAGE`, but the immutable affected resource is its scoped `Conversation` | Block every new Message/reply in that Conversation; participants retain sanitized read/report access and message history is not deleted | Sending becomes possible only if participant/Company/User/Reveal-independent guards also pass; history/status are not rewritten |

- [x] Apply/lift/expire locks Report+Restriction+affected resource, validates the target mapping and writes restriction event, downstream domain events, Notifications and `MODERATION_RESTRICTION_APPLIED|LIFTED|EXPIRED` Audit atomically. Expiry runs only through an idempotent injected-clock command. Tests cover every target mismatch, apply, exact expiry, lift, double retry and the explicit no-auto-reactivation rule.

#### `OPS_CASE_SLA_POLICY_V1`

- [x] SLA is a versioned operational target in elapsed hours from `createdAt` (not a legal promise and no undefined holiday calendar): Abuse `CRITICAL=1`, `HIGH=4`, `MEDIUM=24`, `LOW=72`; Support `URGENT=4`, `HIGH=8`, `NORMAL=24`, `LOW=72`; submitted Job review `48`; Company claim/verification `72`; Import failure `4`; new Lead first action `24`. `dueAt=createdAt+targetHours`; raising severity/priority tightens to the earlier due date, lowering never extends it. Queues sort overdue first, then severity/priority, dueAt, stable id. A command emits one 75%-warning and one overdue `SystemTask`/Notification per case+policy version; resolve/close stops future alerts. Boundary/retry/timezone-independent elapsed-hour fixtures and visible “operatives Ziel” copy are mandatory.

### `/admin/imports`

- [x] Upload/paste XML or JSON and choose source/format. Run-level Company is never inferred or created; before approval an Admin must map **each** valid item to one existing Company covered by that ImportSource's documented rights.
- [x] Parse action creates `ImportRun`/`ImportItem` preview rows only. `approveImportItem` requires an Admin-selected existing `companyId`, rechecks source rights for that exact Company and records the mapping; unmapped/unauthorized/ambiguous items can only be rejected and never auto-create/claim a Company. A separate audited Commit rechecks all approved mappings and creates Company-owned Job Drafts; parsing alone never creates a Job. Mixed valid/invalid or multi-Company runs commit only explicitly approved items and retain per-item decisions.
- [x] Validation errors stored as bounded/redacted `ImportItem` results and Run summary; do not retain raw secrets or an unbounded parser error dump
- [x] Supported licensed feed mapping per Blueprint §5/6 and REQ-MKT-006/ADM-003:
  `id`, `company`, `title`, `workplace_country`, `zip`, `city`, `canton`, `description`, `requirements`, `offer`, `contact`, `application_url`, `type`, `workload_min`, `workload_max`, `keywords`
- [x] Two explicit capabilities: P0 `canRunLicensedSupplyImport` lets authorized Platform Admin/Supply-Ops parse, decide and commit licensed records to **Draft** after source-rights checks, independent of Company plan. P1 `canUseEmployerImport` governs commercial employer upload/Setup and is deny-by-default for every P0 plan, including Business. UI states that customer import is not yet packaged; no Plan/Company Boolean can broaden the P0 Admin capability.
- [x] **MVP must not fetch external URLs.** Local upload/paste only.
- [x] `rollbackImportRun(runId, idempotencyKey)` operates only on Jobs created by that Run which are still `DRAFT`, whose current Revision checksum equals the committed import checksum, and which have no manual edit, non-import status event, Application, Conversation or Boost. Eligible Jobs are **not deleted**: one bounded transaction appends `DRAFT→REMOVED` + `IMPORT_ROLLED_BACK`, marks Item `ROLLED_BACK` and retains Job/Revision/Decision/source provenance. Modified/used Jobs remain intact as `CONFLICT_MANUAL_REMEDIATION`. Retry is idempotent per Run/key; a DB failure rolls back the batch. All eligible gives `ROLLED_BACK`; intentional mixed eligibility gives `PARTIALLY_ROLLED_BACK`—never `PARTIALLY_COMMITTED`. Provenance/Audit is never deleted.
- [x] P1 `approveImportSetup({companyId,sourceId,rightsEvidence,mappingEvidence,validUntil,idempotencyKey})` requires Platform capability, existing Company/source, bounded evidence references and `validUntil<=now+30 days`; it creates `ImportSetupApproval{APPROVED}`. Revoke/expiry is evented. Phase-12 checkout alone may atomically consume APPROVED→USED and issue the separate source-scoped `ImportAccessGrant`; approval/payment itself creates zero Runs/Jobs.

### Billing/Katalog-Grenze

Phase 11 erstellt **keine** `/admin/billing|orders|invoices|plans|products`-Mutation, kein Revenue-Modul und keinen Credit-Write. Phase 12 erstellt diese Routen auf den versionierten Billing-Use-Cases. Bis dahin sind die Links nicht sichtbar; ein optionaler gesperrter Hinweis lädt keine Finanzdaten.

### `/admin/leads`

- [x] List of `SalesLead` with filters (status, owner, overdue/next date)
- [x] Detail actions: `assignLeadOwner`, `setLeadNextAt`, change status (`NEW`/`CONTACTED`/`QUALIFIED`/`WON`/`LOST`), record bounded note/contact/outcome. Every action appends `SalesActivity`; `nextAt` is required for open `CONTACTED|QUALIFIED` leads and one-business-day initial follow-up is visibly escalated when overdue.
- [x] Audit `LEAD_STATUS_CHANGED`

### `/admin/support`

- [x] Authenticated user intake at `/support` creates a bounded `SupportCase` for the current user/company with category, summary, contact preference and confirmation; `/support/[id]` exposes only that requester's status/events. When an assigned Admin requests information (`TRIAGED|IN_PROGRESS→WAITING_FOR_REQUESTER`), the requester may call `replyToSupportCase({caseId,body,idempotencyKey})` with sanitized plain text 1–2000: owner scope, lock and terminal checks, `WAITING_FOR_REQUESTER→IN_PROGRESS`, `REPLIED` event, `SUPPORT_CASE_CHANGED` Notification and `SUPPORT_CASE_REPLIED` Audit without body. Retry is idempotent; other states/actors fail closed. Anonymous intake is an explicit rate-limited `SalesLead`/mock-contact path, never an orphan SupportCase.
- [x] Queue/Detail für `SupportCase` mit Bereich, Priorität, Status, Assignee, Fälligkeit, minimal nötigem Kontaktkontext und append-only Events
- [x] Aktionen: triage, assign, request-information (only an assigned case), resolve/reopen; every action follows `OPS_CASE_SLA_POLICY_V1`, has reason, `SUPPORT_CASE_CHANGED` Notification and Audit; no sensitive content enters Analytics
- [x] Empty/SLA-breach/stale/conflict/mobile states und Test, dass nicht berechtigte Admin-Capabilities keinen Case lesen

### `/admin/content`

- [x] Draft/Review/Publish/Unpublish für Guide- und Cluster-Content über `ContentPage`/`ContentRevision`; Preview und sichere Markdown-Allowlist
- [x] Veröffentlichung ändert nicht automatisch SEO-Indexierung: Phase 15 kombiniert freigegebenen Inhalt mit dem Liquiditätsgate
- [x] Versions-/Actor-/Zeit-/Canonical-Historie, Audit und Tests für XSS, stale revision, noindex und nicht veröffentlichte Inhalte
- [x] Cluster-Detail shows all six immutable `CLUSTER_LAUNCH_POLICY_V1` numerators/denominators, window/hash/freshness and Content status. Phase 15 supplies `evaluateClusterLaunch`; separate Product/Ops approve, activate and revoke actions require matching capabilities/reasons and append `ClusterLaunchEvent`. Content Publish alone never activates SEO/acquisition.

### `/admin/business-cockpit` — Owner cockpit

- [x] Sections follow Product Strategy §8 and REQ-ADM-004:
  1. Operations overview — ageing moderation/verification/report/import/support queues and cluster supply/demand evidence. Financial cards are added by Phase 12 from its canonical revenue queries.
  2. Leads and assigned follow-ups by due date/outcome
  3. `NEAR_JOB_LIMIT` exactly per `COCKPIT_SIGNAL_POLICY_V1`: ≥80 % active-job usage and ≥3 submitted Applications in the rolling 30-day window
  4. `JOB_CONTENT_DIAGNOSTIC` and only later `BOOST_TEST_CANDIDATE`: exact 100-view/14-day/200-bps/content/baseline thresholds from Phase 03; missing Product-Analytics sample yields no speculative card
  5. `FREE_UPGRADE_CANDIDATE`: ACTIVE+VERIFIED Free Company, first publish ≥14 days, ≥5 Applications in 30 days, no open qualified Lead/30-day dismissal
  6. `SLOW_RESPONSE`: ≥10 due Applications in 30 days and <7000-bps on-time first response (anti-ghosting risk)
  7. **Suggested sales actions** (cards with action buttons that pre-fill an admin note + change lead/company status):
     - "Firma X hat 3 von 3 Jobs aktiv. Upgrade auf Pro anbieten."
     - "Job Y hat viele Views aber wenig Bewerbungsstarts. Zuerst Text/Formular prüfen; Boost danach nur bei bestandener Diagnose anbieten."
     - "Firma Z nutzt Talent Radar stark. Contact Pack anbieten."
     - "Kategorie Pflege hat hohe Nachfrage und zu wenig aktuelle Stellen. Gezielte Arbeitgeberakquise zuweisen."
     - "Firma A hat viele Bewerbungen, aber langsame Antworten. Anti-Ghosting-Prozess empfehlen."
  8. Leads ordered by `dueAt`: NEW/assigned approaching the one-business-day target first, then overdue visibly escalated; no hidden two-day delay
  9. Employer inactivity/retention-risk hypothesis from product usage only; Phase 12 adds the versioned 30/14/7-day renewal/unused-credit/limit signals and `/admin/analytics` read model
  10. Canton/category demand overview
  11. Support and moderation SLA breaches
  12. Talent Radar usage only as privacy-safe aggregates once Phase 14 supplies it

## Files to create / modify

- `app/{support/{page.tsx,[id]/page.tsx,actions.ts},admin/{layout.tsx,page.tsx,jobs/*,companies/*,users/*,taxonomy/*,reports/*,imports/*,support/*,content/*,leads/*,business-cockpit/*}}`; Phase 14 adds `privacy-requests/*`, Phase 16 adds `audit/*` and `system/*`
- `components/admin/{Sidebar.tsx,MetricCard.tsx,AuditFeed.tsx,JobReviewTable.tsx,CompanyTable.tsx,UserTable.tsx,ImportPreview.tsx,SupportQueue.tsx,ContentEditor.tsx,LeadList.tsx,BusinessCockpit/*}`

## Rules to respect (from `99-rules-quickref.md`)

- §18 — every admin action audit-logged with actor, action, entity, metadata
- §21 — abuse handling integrated, no auto-delete without admin review
- §10 — never expose password hashes; never expose private candidate data via admin UI unless candidate has revealed it
- §13 — success-fee product remains inactive even from admin
- §39 — every admin action considers RBAC, audit, downstream side-effects (e.g. suspending a company pauses jobs)

## Verification

- [x] `admin@demo.ch` reaches every Phase-11 operations route; Billing routes are not advertised until Phase 12
- [x] Review, approval and publication produce `IN_REVIEW`, `APPROVED` and `PUBLISHED` events in order; publication rechecks verification and quota atomically, while failed publication leaves the approved job non-public with a typed reason
- [x] Suspending a company pauses its active jobs and writes `AuditLog`; applying each Abuse restriction produces the specified downstream effect, event/audit/SLA update, and lifting follows an explicit non-session-restoring policy
- [x] XML import parse creates preview items but 0 Jobs; explicit approved commit creates only deduplicated Draft Jobs and rollback is audited
- [x] Import rollback tombstones only untouched import-owned Drafts as `REMOVED`; a manually edited/submitted/applied Job remains intact with conflict result, mixed Run is `PARTIALLY_ROLLED_BACK`, retry duplicates nothing, an injected DB error reverts the whole batch, and provenance/Audit remains queryable
- [x] Support case and Content revision each complete their authorized lifecycle with notification/audit; unpublished or ungated content is absent from public/indexable output
- [x] Candidate/employer can create and read only their own SupportCase; it then completes triage→assign→resolve/reopen in the Admin queue
- [x] Business cockpit shows at least one suggested sales action from seeded data; actions persist a prefilled safe Lead note and expose the bounded Lead-status workflow, while the LIVE canton/category demand projection is rendered with an honest empty state
- [x] No Phase-11 route can confirm payment, change Invoice/Katalog state or grant Credits; those acceptance paths belong to Phase 12

## Common pitfalls

- Allowing Admin to edit ScoreSnapshot values → bypasses fairness logic. Relevant revision changes create a new immutable `JobScoreSnapshot` through the scoring use case; paid/moderation fields are not score inputs.
- Activating a success-fee product through the admin UI — keep server-side guard
- Suspending a user without invalidating their sessions → still authenticated. Delete `Session` rows on suspension.
- Showing candidate real names in admin moderation views by default — only when an `AbuseReport` requires it AND the candidate has revealed identity / direct application
- Forgetting that recruiters and employers must not see admin routes: require both layout/navigation rules and server-side capability checks in every use case.

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Enable safe daily operation: moderate supply, verify/suspend actors, resolve abuse, control imports and turn signals into accountable tasks. |
| Roles / requirements | Platform Admin (capability-wrapped); REQ-ADM-001–006, MKT-006, GRW-001, SEC-003. |
| Prerequisites | 06, 10; Phase 12 later owns Admin Billing routes/mutations and revenue metric definitions. |
| Routes/actions | Overview, job/company/user details, taxonomy, reports, imports, support, content, leads and initial cockpit. Approve/request/reject/pause; claim/verification review; suspend; revoke sessions; deactivate taxonomy; triage; parse/preview/commit-to-draft/safe rollback; support/content/lead assign/due/outcome. Privacy arrives in 14, Audit/System in 16. |
| Data | Moderation/Verification/User/Job Events, Abuse, Import*, Taxonomy, SupportCase/Event, ContentPage/Revision, SalesActivity/SystemTask, Audit. No Billing/Katalog mutation or revenue definition. |
| Validation | Mandatory reason, impact preview/confirmation, transition conflict, safe parser size/depth/format and source/license, dedup checks. |
| Authorization/privacy | Admin capability at layout and use case; sensitive Candidate identity shown only for justified case; no password/token/raw CV/message; every object/mutation server checked. |
| Audit/notification/analytics | Every mutation has actor/target/result/reason/correlation; downstream users notified; queue age/action outcomes measured without content. |
| UX/mobile | Action queues sorted by risk/age, detail before destructive action, stale/conflict, import line errors/preview, helpful empty tasks; cards on mobile. |
| Seed | pending/old/high-risk items, duplicate/malicious feed, suspended actors, reports/leads/tasks and one reachable DEMO Cluster assessment. DEMO evidence may receive separate Product/Ops review but can never activate a LIVE cluster. |
| Tests | capability/RBAC including denied Support reads, claim approval without auto-verification, job publish quota concurrency, company/user suspension downstream, Abuse severity/SLA/assignment + each restriction/lift downstream, UTF-8 byte/depth/format import attacks and conditional/idempotent rollback, lead owner/due actions, Cluster dual approval/LIVE activate/revoke, full audit matrix and sensitive DTO. |
| Verification | Owning-phase PostgreSQL integration proves Admin submit/review/publish, suspension, Import, Cluster and audit DB assertions. The continuous cross-role browser journey Employer submit→Admin publish→Public is E2E-02 and remains explicitly owned by Phase 17. |
| Risks / limitations | MVP Admin is broad; Support/Moderator/Sales/Finance split P1. Cockpit revenue waits for 12/metrics. |
| Definition of Done | Operator can act on every P0 queue safely with visible impact and audit; no table-only/fake action and no duplicate Billing logic. |

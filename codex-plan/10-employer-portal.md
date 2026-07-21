# Phase 10 — Employer Portal

> **PortalGERM target status: COMPLETED (21 July 2026).** The Phase-10 core is implemented and verified in code commit `b7afb617876624118cd8c5ea41d4942dfe6c88f1`; see the [Phase-10 evidence record](./evidence/2026-07-21-phase-10.md). Billing fulfillment remains owned by Phase 12. The separately gated P1 external-agency mandate package (REQ-REC-002) remains explicitly deferred and is not part of this completed core.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 10. Read [99-rules-quickref.md](./99-rules-quickref.md) §15, §16, §17 before starting.

## Goal

Build the employer/recruiter-facing routes: dashboard, company profile, job list, 5-step job posting wizard, applicant pipeline, Talent Radar (preview only here — full flow in Phase 14), analytics. Phase 12 owns and will implement `/employer/billing/*`; this phase exposes no broken Billing navigation.

## Prerequisites

- [x] Phase 06 auth (`requireRole(['EMPLOYER','RECRUITER'])`) + `requireCompanyAccess`
- [x] Phase 03 helpers (Fair-Job-Score, match score, feature gates, search/ranking, audit, analytics)
- [x] Phase 04 mock adapters (AI for "Jobtext verbessern", Job-Room for Stellenmeldepflicht, email)
- [x] Phase 05 seeded companies/jobs/applications

## Deliverables (checklist)

### Layout

- [x] `app/employer/layout.tsx` — sidebar nav (Dashboard · Firma · Team · Jobs · Bewerber:innen · Talent Radar · Analytics · Logout). Header shows a keyboard/mobile-accessible CompanyContextPicker when the user has >1 active Membership, current company + effective plan badge; picker calls the Phase-06 switch action and never trusts a client Company id. Before Phase 12 upgrade goes to `/pricing`, and Billing navigation appears only after its route works.
- [x] `noindex` meta
- [x] Every Company-bearing page resolves/revalidates current Company context, then uses resource-specific Company/JobAssignment-scoped repositories. The sole exception is `/employer/company/claim-pending`, which is User/ClaimRequest-scoped and deliberately has no Company data/navigation until approval. Multi-company Recruiter A/B sees only selected context; no cross-context cache/query reuse.

### `/employer/dashboard`

- [x] Cards:
  - Active jobs: `2 / 3` style usage bar based on plan
  - Bewerbungen diese Woche
  - Durchschnittliche Antwortzeit
  - Jobs mit niedrigem Fair-Job-Score + suggested improvements
  - Plan-Status (`Free Basic` / `Starter` / `Pro` / `Business` / `Enterprise`) + exklusives Periodenende und expliziter Mock-Renewal-/Change-Schedule-Status; keine automatische Verlängerung behaupten
  - Boost-Credits remaining
  - Talent Radar contacts remaining (if plan enables)
- [x] CTAs: "Inserat erfassen" → `/employer/jobs/new`; "Pläne vergleichen" → `/pricing`. Phase 12 adds a working Billing CTA; Phase 13 adds a job-scoped Boost action.
- [x] If a job has high views and few application starts, recommend content/form diagnostics first. A Boost suggestion is added by Phase 13 only after the evidence window and job eligibility pass.

### `/employer/company`

- [x] Form: name, UID, industry, size, website, canton, city, safe logo/cover metadata, about, values, benefits, social links and locations. Render only persisted fields; there are no quote/gallery/video controls in P0, and response badges require measured evidence rather than a self-declared guarantee.
- [x] Entitled enhanced sections are limited to persisted cover/values/benefits, evidence-based response statistics, Fair-Hiring commitments and salary-transparency aggregate. A server entitlement gate supplies a locked explanation; it never fabricates premium content.
- [x] Save action validates with Zod, writes `Company` row, audit-logs `COMPANY_PROFILE_UPDATED`
- [x] `completeCompanyOnboarding()` (Owner/Admin) validates name, industry, size, website or UID, primary Swiss canton/city and public description, then atomically moves only `DRAFT → ACTIVE`, appends `CompanyStatusEvent{ONBOARDING_COMPLETED}` and emits the deduped activation event. Verification stays separate; public Jobs still require both ACTIVE and current VERIFIED.
- [x] OWNER + ADMIN can edit; RECRUITER read-only
- [x] Claim/verification section is available on **every** plan. A Phase-06 claim-pending User may add bounded evidence/cancel but has no Company read access; Admin Phase 11 alone approves/rejects `CompanyClaimRequest`, and approval atomically creates the reviewed Membership. For verification, Owner/Admin submits evidence and sees history. `CHANGES_REQUESTED → PENDING` resubmits the same request; after `REJECTED|REVOKED`, `startNewVerificationCycle` creates a new identity with `supersedesRequestId`. At most one open DRAFT/PENDING/CHANGES cycle exists. Domain matching is only a signal; badge derives from the latest current VERIFIED cycle and disappears immediately on revoke/new unverified cycle.
- [x] Consume only a signed, unexpired Phase-07 claim intent after registration/login; re-resolve by public slug, never a client private id. Existing ownership/verification creates an Admin conflict case instead of attaching Membership automatically.

### `/employer/team` and `/employer/team/invitations`

- [x] Owner/Admin lists Memberships and pending invitations; sends/resends/revokes an invite, changes an allowed member role, and calls explicit `removeCompanyMember({ membershipId, reason })`. Removal locks Membership/Company, rejects self-removal/last active Owner, marks `REMOVED`, revokes active JobAssignments and invalidates Company context/access on the next query; it appends Membership events/Audit and sends a post-commit notification. Recruiter/Viewer cannot manage team.
- [x] Send/resend commits the hashed invitation/version + Audit first, then emits one `company_invitation` Mock email after commit. Resend atomically revokes the prior token, issues a new hash and makes the old link unusable; EmailLog contains no raw token/link. Revoke emits no usable invitation.
- [x] `seatUsage = active CompanyMemberships + unexpired PENDING CompanyInvitations`; every company role consumes one Seat. Send/resend locks the Company seat scope, resolves effective Entitlements at `now`, counts reservations and creates at most one active invitation per normalized email. Parallel sends at one remaining Seat yield one success.
- [x] Accept uses a hashed single-use token, matching invited normalized email and active Company; it locks invitation + Company seat scope and rechecks count/entitlement before converting the reservation to Membership. If a downgrade made the Company over-limit, existing active members remain per downgrade policy but no pending invite can be accepted until capacity/upgrade; no partial Membership is created. Last active Owner removal/demotion is rejected.
- [x] Pending/expired/used/revoked, duplicate email, limit, self-removal, company switch and mobile card states are specified; actions append Membership/Invitation events and Audit evidence.
- [x] Exact accept route: `app/(auth)/invite/[token]/route.ts` validates the original raw link token shape and immediately redirects to the token-free `/invite/resume`, sealing the token for at most 30 minutes in an AES-256-GCM-protected, `HttpOnly`, `SameSite=Lax` cookie scoped to `/invite`; login/registration `next` parameters and subsequent referrers never carry the raw token. The resume page resolves the invitation only by token hash, requires the authenticated normalized email to match and covers pending/expired/revoked/used/email-mismatch/Company-inactive/seat-limit and success without revealing another invitee/company on error; success redirects to `/employer/dashboard` in the newly validated context.
- [x] Global-role mapping is explicit: a new invite registration creates global `RECRUITER` only for Membership role `RECRUITER`, otherwise global `EMPLOYER`; Company Membership remains the authorization source. Existing `EMPLOYER`/`RECRUITER` may accept any invited Membership role without mutating global role. Existing `CANDIDATE` or Platform `ADMIN` accounts are denied in P0 with a generic separate-work-account/support path; Accept never silently changes `User.role` or creates a CandidateProfile.
- [x] `/employer/team` includes a Job-Zuweisungen section for Owner/Admin: select an owned Job, active Recruiter Membership, `JobAssignmentRole` and optional expiry; `assignRecruiterToJob`/`revokeJobAssignment` lock and verify same Company, membership status/role and uniqueness, append assignment event/Audit and notify the Recruiter. A Recruiter loses the Job/Application scope immediately on revoke/removal/expiry; unassigned Jobs remain safe 404.

#### Binding Company-role × Job-assignment capability matrix

| Actor | Job content | Application/Conversation | Company/team/billing |
|---|---|---|---|
| Active Owner/Admin Membership | Read/create/edit/submit/pause/clone/reactivate/close every Company Job; Platform Admin still owns moderation approval/publish | Read and perform every `APPLICATION_TRANSITIONS_V1` Employer edge; message/note | Profile/team/assignments; Billing follows Phase-12 Owner-vs-Admin split |
| Active Recruiter + current `EDITOR` Assignment | Read assigned Job; edit `DRAFT\|CHANGES_REQUESTED`, submit; may create a Draft through the self-assignment transaction below | Read assigned pipeline and perform Employer edges/message/note | No Company/team/billing/verification mutation |
| Active Recruiter + current `PIPELINE` Assignment | Read assigned Job summary only; no advert edit/status action | Read assigned pipeline and perform Employer edges/message/note | None |
| Active Recruiter + current `REVIEWER` Assignment | Read full assigned Revision/score/reporting evidence; no mutation | Aggregate application count only; no identity, CV, note, message or status action | None |
| Active Viewer Membership | Read closed safe Company operational DTO and Job list/detail/aggregate for that Company | No Application identity/list/thread/note/message | No mutation, Billing address/invoice or private verification evidence |

- [x] Assignment roles are mutually exclusive per Recruiter+Job; changing role is an evented replacement under one lock. `createJobDraft` by a Recruiter verifies the active Recruiter Membership and atomically creates the Company Draft plus an `EDITOR` self-assignment; failure creates neither. Owner/Admin creation needs no Assignment. All nested queries encode the matrix in their first scope, and allow/deny fixtures cover every row.
- [x] Re-inviting a previously `REMOVED` user reuses/reactivates the same Membership after token/email/seat checks, applies the reviewed role, appends `REACTIVATED` and preserves old events; absolute `(companyId,userId)` uniqueness never dead-ends the flow.

#### P1 external agency mandate work package (inactive in P0)

- [ ] After Phase 07/10 P0 acceptance, implement REQ-REC-002 as a separately gated Phase-10 work package: `RecruiterMandate/Event`, Owner-only grant/revoke, routes `/employer/mandates` and `/employer/mandates/[id]`, explicit client Company + allowlisted Job ids, `[validFrom,validTo)`, and required per-Job Assignment. Every read rechecks current Mandate, Assignment, Company and User; expiry/revoke blocks the next query, preserves Audit/history and grants no global export. PostgreSQL integration plus browser tests cover grant, wrong Owner/tenant, exact validity boundaries, revoke between two reads, job removal and concurrent revoke/use. No route/CTA exists before its migration, privacy/legal review and role×tenant E2E pass.

  **Deferred/open:** REQ-REC-002 remains outside the completed Phase-10 core. No mandate migration, route or CTA is present; implementation requires the stated privacy/legal and role×tenant E2E gate.

### `/employer/jobs` — Job list

- [x] Table/list of company jobs with columns: Titel · Status · Standort · Bewerbungen · Views · Saves · Fair-Job-Score · Boost-Status · Aktionen
- [x] Status badges per `JobStatus`
- [x] Actions: Bearbeiten · Duplizieren · Pausieren · Reaktivieren · Schliessen (`CLOSED`) · "Zur Prüfung einreichen". Phase 13 adds "Job boosten" only when its route/handler exists.
- [x] Draft/create/submit never consumes the active-job quota. Employer reactivation/republication and the Phase-11 Admin `APPROVED → PUBLISHED` service call the server gate atomically; a blocked transition returns a typed limit result, and the working shared UpgradeDialog is added in Phase 12.
- [x] Empty state: "Noch kein Job inseriert — Inserat erfassen"

### `/employer/jobs/new` — 5-step Wizard

- [x] Step 1 **Basics**: title, category, jobType, workloadMin/Max, canton, city, remoteType/remoteCountryCode, versioned required languages (`code` + minimum CEFR level), proposed `validThrough` (draft optional; wizard defaults to server-now+30 days; final publish requires `now<value<=now+90 days`) and exactly one of start date or „nach Vereinbarung“
- [x] Step 2 **Beschreibung**: companyIntro, ordered structured tasks, requirements, niceToHave, offer, selected required Skills through `JobRevisionSkill` and versioned structured benefits (allowlisted code + concrete description)
- [x] Step 3 **Lohn & Fairness**: salaryMin/Max + salaryPeriod (optional but encouraged), bounded `responseTargetDays`, ordered application-process steps, `applicationEffort`, explicit required-document kinds, normalized inclusion statement and validated public application-contact kind/value. These fields feed only `buildFairJobInputV2`; client-supplied evidence Booleans are ignored.
- [x] Step 4 **Schweiz-Compliance**: occupationCode (autocomplete from `OccupationCode`), Stellenmeldepflicht-Check (calls `jobroomProvider.checkReportingObligation`) — persist/render result, reason, `datasetVersion`, source URL/data year and mandatory disclaimer "Dieser Check ist eine Orientierung und keine Rechtsberatung. Bitte prüfen Sie meldepflichtige Stellen offiziell." The official link is visible and safe.
- [x] Step 5 **Vorschau & Veröffentlichen**:
  - Render the complete applicant-facing preview with the same shared `JobTypeBadge`, `JobFacts` and `JobContentSections` components used on `/jobs/[slug]`; only draft-management context remains separate
  - Show calculated Fair-Job-Score with breakdown + improvement suggestions (from `calculateFairJobScoreV2`)
  - AI rewrite buttons (call `aiProvider`): "Jobtext verbessern" · "Text inklusiver formulieren" · "Anforderungen kürzen" · "Lohntransparenz-Hinweis ergänzen"
  - Submit button: "Zur Prüfung einreichen" → validates the complete revision and transitions `Job.status = SUBMITTED`; Phase 11 moves it through `IN_REVIEW/CHANGES_REQUESTED/APPROVED/PUBLISHED`
- [x] Form state persisted across steps via server action drafts (`Job.status = DRAFT` row created on Step 1 save)
- [x] Each step Zod-validated; final submit re-validates the merged schema

### `/employer/jobs/[id]` — Job edit / detail

- [x] Same wizard is reused only through the closed revision policy: `DRAFT|CHANGES_REQUESTED` edits the current draft Revision with optimistic version checks; `PUBLISHED` content is immutable. `pauseAndCreateRevision` atomically appends `PUBLISHED→PAUSED→DRAFT`, immediately removes public eligibility, clones the last published Revision as the new current Draft and preserves the old Revision/Score. An already `PAUSED` Job may either reactivate the unchanged approved Revision under quota or call `createRevisionFromPaused` for `PAUSED→DRAFT`; material edits can never coexist with a public PUBLISHED projection.
- [x] Sidebar: status, latest immutable Fair-Score snapshot, views/saves/applications, effective boost status read-only, "Job pausieren" / "Aktivieren" / "Schliessen". Phase 13 adds the job-scoped Boost CTA.
- [x] Audit log of recent actions for this job (last 10 entries)
- [x] If status is `REJECTED`, the old Revision is read-only and the only edit CTA calls `createRevisionFromRejected`: in one transaction create a copy as a new editable `JobRevision`, set it current, transition `REJECTED → DRAFT`, append `REVISION_REOPENED`/Audit, then require the ordinary `DRAFT → SUBMITTED → IN_REVIEW` flow. Direct `REJECTED → SUBMITTED|APPROVED|PUBLISHED` is impossible.
- [x] Every edit/submit/pause/clone/reactivate command takes expected Job + Revision versions and rejects a stale client without overwriting the newer current Revision. Reactivation rechecks current approved Revision, mandatory future `validThrough`, Company verification/restriction and quota; clone does not reserve quota. Tests cover stale tabs, current-vs-published Revision ids, public disappearance during review, unchanged reactivation, rejected/paused cloning and two concurrent commands.

### `/employer/applicants` — Pipeline

- [x] Filter by job (select), status, search by candidate display name
- [x] Kanban/list columns use `SUBMITTED · IN_REVIEW · SHORTLISTED · INTERVIEW · OFFER · HIRED · REJECTED · WITHDRAWN`; only allowed role/status transitions are actionable
- [x] Card content: candidate identity and application/jobpass fields allowed by the direct Application context, non-downloadable CV metadata in the Mock MVP, application date, evidence-based response target/elapsed time and latest event. P0 exposes **no employer Match score/ranking** and never auto-orders or rejects applicants by it.
- [x] Card actions: erlaubten Status setzen, Nachricht in der Application-scoped `Conversation` senden, Ablehnen/Interview-Text als editierbaren Mock-Vorschlag erzeugen, `ApplicationEmployerNote` hinzufügen; each action uses the Company/Assignment-scoped Application repository. Employer-note body is excluded from Candidate DTO, Notification, Analytics and Audit metadata.
- [x] Every allowed status change atomically writes `ApplicationEvent` + required `AuditLog` with actor/time; after commit/outbox it creates a deduped Candidate `Notification` and Mock `application_status_changed` EmailLog. Notification payload is allowlisted (application/job/status, no private note/message).
- [x] Server-side: an Owner/Admin sees Company Applications; Recruiter requires current `EDITOR|PIPELINE` Assignment; REVIEWER/Viewer receive no candidate/application DTO. All transitions reuse the Phase-09 closed actor×edge matrix (including required rejection reason) and Company/Application scope in the first query.

### `/employer/talent-radar` (preview here, full logic in Phase 14)

- [x] This phase always renders a static, clearly illustrative locked shell and evaluates only entitlement/usage summaries; it performs **zero Candidate/Radar repository queries**, even for an entitled plan. If disallowed, CTA goes to `/pricing`; if entitled, copy says the private search becomes available with Phase 14.
- [x] Phase 14 replaces the shell with Safe DTO search, live allowance `used/limit` (10 Pro, 50 Business in current hypotheses), Contact actions and request detail. No hardcoded `12 / 25` or anonymous candidate fixtures appear here.

### `/employer/analytics`

- [x] Cards: Views, Saves, Applications, Conversion rate, Average response time
- [x] Chart: Fair-Job-Score improvement suggestions (list)
- [x] Salary-transparency panel compares privacy-safe observed funnel groups only after minimum sample/coverage and labels them as correlation, not impact/causality; with insufficient real fixture events it shows an honest „no evidence yet“ state instead of a mock chart
- [x] Chart: response time per job
- [x] Section: jobs with high views & low application starts → content/form diagnostic recommendation; Phase 13 may add Boost only as a labelled second option after the diagnostic gate
- [x] Premium charts call `getEffectiveEntitlements(companyId, now)` server-side and require `analyticsLevel >= ADVANCED`; `<PlanGate>` only renders that server result and is never an independent Plan-field authority

## Files to create / modify

- `app/employer/{layout.tsx,dashboard/page.tsx,company/{page.tsx,actions.ts,claim-pending/{page.tsx,actions.ts},verification/actions.ts},team/{page.tsx,actions.ts,assignments/actions.ts,invitations/page.tsx},jobs/{page.tsx,new/{page.tsx,actions.ts},[id]/{page.tsx,actions.ts}},applicants/{page.tsx,[id]/page.tsx,actions.ts},talent-radar/page.tsx,analytics/page.tsx}` plus `app/(auth)/invite/[token]/route.ts`, `app/(auth)/invite/resume/{page.tsx,actions.ts}` and `lib/auth/invite-resume.ts`
- `components/employer/{CompanyContextPicker.tsx,Dashboard.tsx,CompanyForm.tsx,VerificationPanel.tsx,TeamList.tsx,InvitationForm.tsx,JobsTable.tsx,JobWizard/*,ApplicantPipeline.tsx,ApplicantCard.tsx,TalentRadarLockedPreview.tsx,AnalyticsCards.tsx,PlanGate.tsx}`. The single shared `components/billing/UpgradeDialog.tsx` is created only in Phase 12.

## Rules to respect (from `99-rules-quickref.md`)

- §15 — feature gating server-side; `<PlanGate>` UI is for UX, not security
- §11 — Fair-Job-Score recomputed on save; boosts do not affect score
- §16 — boosting accessed from this portal but Phase 13 owns the actual logic
- §17 — Talent Radar UI here only; credit deduction & contact request live in Phase 14
- §10/ADR-020 — Company context uses `requireCompanyAccess`; every nested read/write is a resource-specific Company/Assignment-scoped query, never load-then-check
- §22 Mock Analytics — privacy-friendly aggregates only

## Verification

- [x] `employer@demo.ch` reaches `/employer/dashboard` and sees real seeded counts
- [x] A Free employer may create and submit a 2nd Draft; only its attempted transition to `PUBLISHED` (or reactivation) is server-rejected at the one-active-job limit, without losing the Draft/approval state
- [x] Wizard step 4 persists and renders result/reason, datasetVersion/year, source/official link and the verbatim disclaimer
- [x] Wizard step 5 shows a Fair-Job-Score breakdown that matches the helper output
- [x] Editing another company's or nonexistent Job via direct URL returns the same safe 404 from the Company/Assignment-scoped Job repository; a separate membership pre-check cannot substitute for this test
- [x] Multi-company Recruiter switches A↔B through the picker; list/detail/cache/action tests return 0 cross-context IDs, and forged/removed context is rejected on the next request
- [x] Combined route/action tests and real PostgreSQL integration cover anonymous Login/Register through the token-free `/invite/resume`, matching-email success exactly once, mismatch/expired/revoked/used/Company-inactive/seat-limit safe states and redirect into the new Company context; tests also prove the sealed resume cookie's AES-GCM integrity, 30-minute expiry and clearing after completion or an invalid/tampered resume
- [x] Invitation provider test captures the raw outbound link, proves one Mock EmailLog per invitation version/idempotency key, resend invalidates old link, revoke/duplicate click fails safely, and no token appears in EmailLog/Audit/structured logs
- [x] Invitation role-matrix test covers new Owner/Admin/Recruiter/Viewer mapping, existing Employer/Recruiter without global-role mutation, and safe denial for Candidate/Platform Admin accounts
- [x] Real PostgreSQL race tests cover two sends/accepts at one remaining Seat, reservation expiry, duplicate email and downgrade-over-limit; derived seat usage never exceeds the effective limit on a successful accept
- [x] Remove/role/assignment tests prove last Owner protection, immediate context/access loss, assignment create/revoke/expiry, no cross-Company assignee and no access to an unassigned Job/Application
- [x] Company onboarding has the exact DRAFT→ACTIVE predicate/event and remains unverified; verification same-request changes cycle plus new-request-after-reject/revoke constraints and badge removal are clock/DB tested
- [x] Rejected/paused/published Job clone commands create exactly one current Draft Revision on retry and cannot skip review; prior Revision/Score evidence is unchanged, public eligibility is absent throughout material edit review, and stale/concurrent commands fail deterministically
- [x] Status change on an application writes `ApplicationEvent` + `AuditLog`
- [x] The same status change produces exactly one Candidate Notification/Mock email per idempotency key; retry duplicates neither event nor notification

## Common pitfalls

- Letting recruiters edit company billing — restrict to OWNER/ADMIN
- Showing the candidate's real identity in the applicant pipeline before reveal in Talent Radar–originated threads
- Forgetting to create/reference a new immutable `JobScoreSnapshot` when the relevant JobRevision changes → displayed reasons drift from approved evidence
- Wizard losing draft when user refreshes — persist as `DRAFT` row early
- Calling `aiProvider` from client component — keep AI calls server-side

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Let a KMU set up its company/team, create a better advert and operate an applicant pipeline with clear next actions. |
| Roles / requirements | Company Owner/Admin/Recruiter/Viewer; REQ-EMP-001–007, IAM-003, REC-001, SCORE-001. |
| Prerequisites | 03–06; seeded applications from 05; Candidate end-to-end interop verified once 09 is complete. Billing/Radar real behavior follows 12/14. |
| Routes/actions | Employer dashboard/company/claim/team/invitations/assignments/jobs/new/detail/applicants/detail/analytics; company onboarding + verification cycles, claim evidence, invite/member removal/role/assignment, draft autosave/submit/edit/pause/reactivate/revision-from-rejected, score/reporting check, pipeline/message. |
| Data | Company/Verification, Membership/Invitation/Assignment, Job/Revision/Score/Reporting, Application/Event/Conversation plus Company-scoped EmployerNote, basic metrics. |
| Validation | Draft-step schemas plus full final schema; status transitions; optimistic conflict; quota at every Published/reactivation transition; job target/company server-derived. |
| Authorization | Company role and JobAssignment; Recruiter no billing/ownership; Viewer read only; last Owner; safe 404; Radar locked state makes no candidate query. |
| Audit/analytics/notification | Company/team/job/status/pipeline changes, reporting dataset, response times and notifications; no private note/content in analytics. |
| UX/mobile | Onboarding tasks, persisted stepper/resume, moderation/limit/locked/conflict/success, card/list alternative to drag-only pipeline, withdrawn applicant, action-first dashboard. |
| Seed | every company role, two tenants, assigned/unassigned Recruiter, jobs/statuses, over-limit and applications. |
| Tests | role×resource matrix, claim/onboarding/verification cycles, invite/remove/role/assignment immediate effect, wizard resume/revalidation, rejected-new-revision and job transitions/concurrency hook, cross-company applicant/message/note, Candidate DTO cannot read EmployerNote, reporting disclaimer/version, candidate interop. |
| Verification | Employer draft→submit integration, recruiter/tenant tests, mobile wizard/pipeline; full publish flow completes in 11. |
| Risks / limitations | Billing links remain honest locked/unavailable until 12; the concrete external-agency Mandate work package is P1/inactive until its explicit gate; advanced analytics later. |
| Definition of Done | Employer/Recruiter can complete authorized non-billing core workflow; no tenant/identity leak; no fake premium panel. |

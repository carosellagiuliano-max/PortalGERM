# Phase 09 — Candidate Portal

> **PortalGERM target status: IMPLEMENTED AND VERIFIED.** Der Candidate-Core mit Save/Apply/Withdraw, SwissJobPass, Jobabos, Messaging und Privacy-Case-Persistenz ist gegen den unveränderlichen Code-Commit `c3ae5332b8d855137798147c3ceab9f5bd8bfdc8` umgesetzt und verifiziert. Der [Phase-09-Evidence-Record](./evidence/2026-07-20-phase-09.md) dokumentiert sämtliche grünen Gates; Phase 09 ist deshalb in [`00-PLAN.md`](./00-PLAN.md) abgeschlossen. Employer-Pipeline-Mutationen folgen in Phase 10, Employer Radar Search/Contact/Reveal in Phase 14 und die vollständige Cross-role-E2E-Journey in Phase 17.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 09. Read [99-rules-quickref.md](./99-rules-quickref.md) §9, §17 before starting.
>
> **MVP boundary:** CV upload stores metadata only via the mock storage adapter. Real file-byte upload and signed provider URLs are post-MVP work and must be introduced only after a separate security/privacy review.

## Goal

Build the candidate core routes. Candidates can create their SwissJobPass, save jobs, manage application detail/timelines, set up Jobabo alerts, message employers, and control privacy & Talent Radar visibility. Phase 14 adds the candidate ContactRequest inbox and Radar accept/decline/reveal actions.

## Prerequisites

- [x] Phase 06 auth (only `Role.CANDIDATE` reaches `/candidate/*`)
- [x] Phase 07 public Discovery and real Job detail/CTA integration
- [x] Phase 03 helpers (`lib/scoring/match-score`, `lib/privacy/anonymize-candidate`, `lib/utils/format`)
- [x] Phase 04 mock email/storage adapters

## Implemented deliverables

### Layout

- [x] `app/candidate/layout.tsx` — sidebar nav (Dashboard · SwissJobPass · Bewerbungen · Jobabos · Nachrichten · Privatsphäre · Logout). Header shows the candidate's display name + avatar
- [x] `app/candidate/layout.tsx` sets `<meta name="robots" content="noindex">`
- [x] `requireCandidatePage()` guards the Candidate layout and each independently invoked Candidate action; private pages are dynamic/no-store and noindex

### `/candidate/dashboard`

- [x] Profile-completion progress bar (% of SwissJobPass fields filled)
- [x] Recommended jobs (server-side: top 6 by match score from `isJobPubliclyEligible`, respecting candidate preferences; no merely-status-PUBLISHED shortcut)
- [x] Saved jobs preview (3 latest)
- [x] Application statuses summary: counts per status, latest 5 with status timeline
- [x] Active job alerts (Jobabos) preview
- [x] Unread messages indicator
- [x] Recent allowlisted Notifications, including Application status changes, link to the candidate-owned Application detail; read/unread update is candidate-scoped
- [x] Salary radar quick-link
- [x] Talent Radar opt-in status banner: "Anonym sichtbar im Talent Radar" / "Nicht im Talent Radar — jetzt aktivieren"
- [x] Quick-action buttons: "SwissJobPass bearbeiten" · "Jobs suchen" · "Jobabo erstellen" · "Bewerbungen ansehen"

### `/candidate/jobpass` — SwissJobPass

- [x] Progressive SwissJobPass fields per Blueprint §5/6 and REQ-CAN-001:
  - first name, last name, public display name (defaults to first name + initial)
  - email (read-only — comes from `User`), phone optional
  - canton, city
  - desired job titles (tag input), skills (autocomplete from `Skill` table), languages with level (DE/FR/IT/EN/other + level enum)
  - desired salary min/max + period
  - workload min/max, remote preference
  - mobility radius km
  - availability date
  - work permit type (optional select)
  - profile summary (textarea, 500 chars)
  - preferred job types (checkboxes), preferred categories (multi-select)
  - CV upload (mock storage, **metadata only**: name, size, mime; max 5 MB; pdf/png/jpeg/webp)
  - **anonymous Talent Radar toggle** with notice/version captured as append-only CandidateConsent and a derived safe RadarProfile; default off
  - data deletion request button (creates a typed `PrivacyRequest{DELETE}` case)
- [x] Server action validates with Zod, updates `CandidateProfile`, **upserts `CandidateSkill` + `CandidateLanguage` rows** and appends a versioned `CandidateConsent` event whenever Radar visibility changes; update the safe RadarProfile projection transactionally. Privacy requests receive their own Audit event.
- [x] `completeCandidateOnboarding()` is the only `DRAFT → COMPLETE` command. It requires first/last name, canton, at least one desired title or preferred category, at least one Skill, at least one Language, valid workload range, RemotePreference and at least one preferred JobType; salary, phone, CV, permit, summary and Radar opt-in stay optional. It appends `CandidateOnboardingEvent{COMPLETED}` plus deduped `CANDIDATE_PROFILE_COMPLETED` analytics. Removing a required value reopens `COMPLETE → DRAFT`, appends `REOPENED` and withdraws the RadarProfile until explicit re-completion without erasing consent history. Progress percentage is informational and never changes state by itself.
- [x] **Public anonymous profile preview** below form using `lib/privacy/anonymize-candidate.ts` — shows what employers in Talent Radar would see (no name/email/phone/CV/exact city)
- [x] Disclaimers: "Datenschutzfreundlich vorbereitet" + "Du kannst die Sichtbarkeit jederzeit deaktivieren."

### `/candidate/talent-radar` — Consent and safe preview

- [x] Dedicated status page reuses the JobPass field preview, shows current/paused/off/incomplete state and appends a versioned `CandidateConsent` event on every explicit change; it never bundles Marketing/Terms consent. Search eligibility is `onboardingStatus=COMPLETE` plus current valid Radar consent; a Draft profile may grant intent but remains withdrawn/non-queryable until completed.
- [x] Link to `/candidate/talent-radar/requests` is added by Phase 14. Before then the UI truthfully says contact requests become available with that phase and does not fabricate a Message thread.

### `/candidate/saved-jobs`

- [x] Candidate-scoped list of current and expired/closed saved jobs with saved date, relevant alternatives and idempotent remove action; save/remove from public cards uses the same authorized repository and unique `(candidateProfileId, jobId)` constraint. Die Liste lädt ihre Job- und Alternativenprojektion gebündelt in genau einer wiederholbaren Transaktion statt mit N+1-Abfragen.
- [x] Direct IDs are resolved inside the candidate-scoped query; duplicate save/remove is safe, and another Candidate's row is indistinguishable from missing

### `/candidate/applications` — Application Cockpit

- [x] Tab/Toggle between **List** and **Kanban** views
- [x] Statuses (columns/labels) follow the canonical Application machine: submitted · in review · shortlisted · interview · offer · hired · rejected · withdrawn
- [x] Each item shows: job title, company, applied date, current status, last update, employer response time so far, notes button
- [x] Actions: add/update candidate-only `ApplicationCandidateNote` (textarea, max 1000 chars), withdraw application (confirmation dialog), report suspicious employer, open message thread if any. Candidate note is excluded from every Employer/Admin read model.
- [x] Filter by status, search by job title/company; die Liste paginiert stabil mit 25 Datensätzen pro Seite in einer wiederholbaren Transaktion und erhält Filter sowie Ansichtsmodus
- [x] Empty state: "Noch keine Bewerbungen — Jobs suchen"
- [x] `/candidate/applications/[id]` shows the candidate-owned application timeline, current published/closed job context, candidate-private note, allowed withdraw/report actions and participant-scoped Conversation link; another Candidate/nonexistent id returns the same safe 404

### Public Save/Apply intent and Application action

> Phase 09 updates the Phase-07 public `JobCard` and `/jobs/[slug]` actions; Phase 07 alone does not own authenticated Save/Apply behavior.

- [x] Anonymous Save/Apply creates a server-signed, allowlisted intent `{ action: 'SAVE'|'APPLY', jobSlug, issuedAt, expiresAt<=30min }` and redirects only to `/login` or `/register/candidate` with a safe internal `next`. It never accepts an external return URL or arbitrary action/ID.
- [x] After Auth, the user returns to the canonical Job detail with the signed intent. Server verifies signature/expiry/action, re-resolves the current public-eligible Job and displays a clear resume confirmation. **No Application is submitted automatically**; Candidate must review recipient data/cover letter and press „Bewerbung senden“. Save may be completed only after an explicit confirmation. Invalid/expired/ineligible intent falls back to the Job/search page without leaking an ID.

- [x] `applyToJob({ signedIntent, coverLetter?, selectedDocumentIds, confirmationVersion, confirmationSnapshotHash, idempotencyKey })` server action; no client-supplied Job/Company/recipient/revision id is authoritative:
  1. `requireRole(Role.CANDIDATE)` + resolve the current candidate's `CandidateProfile`
  2. Verify/consume the signed intent, resolve `jobSlug → Job → current approved/published JobRevision` and rebuild the exact confirmation projection server-side. Zod-validate cover letter (≤4000 chars, sanitized), active Candidate-owned CV metadata and version/hash. **Schnellbewerbung** is allowed only when that revision's `applicationEffort = SIMPLE`.
  3. Reuse `isJobPubliclyEligible(jobId, now, environment)` inside the transaction: `PUBLISHED`; referenced current Revision is approved and is the publication Revision; `publishedAt <= now < expiresAt`; Revision `validThrough = expiresAt`; Company `ACTIVE` with current `VERIFIED` cycle; no effective Job/Company restriction; and `dataProvenance=LIVE` in Production. Every public list/detail/similar/alert/apply/search path calls this one helper. Reject every ineligible state with a safe typed result.
  4. Enforce the P0 required-document contract: published Revisions contain only `NONE|CV|COVER_LETTER`; `NONE` is exclusive, `CV` requires exactly one selected ACTIVE Candidate-owned `DocumentPurpose.CV`, and `COVER_LETTER` requires a non-empty letter. Any unsupported kind or ownership/status race fails closed.
  5. **Dedupe** on the unique `(jobId, candidateProfileId)` plus idempotency key — re-applying shows "Du hast dich bereits beworben" instead of a duplicate
  6. Apply the Phase-03 `APPLICATION_SUBMIT` rate preset (30 successful/attempted submissions per Candidate User/hour plus per-IP abuse guard).
  7. In one database transaction create `Application{submittedJobRevisionId,status=SUBMITTED}`, immutable `ApplicationSubmissionSnapshot` (candidate identity; recipient Company/public contact; response target; effort; required documents; notice/hash), selected `ApplicationSubmissionDocument`, initial Event, exactly one `APPLICATION` Conversation with Candidate and Company principals, in-product Notifications, Audit and analytics outbox/idempotency evidence. Confirmation hashes use the **exact persisted raw values**—including case and whitespace—rather than a second normalization contract. A retry returns the same Application/Conversation and cannot partially duplicate children.
  8. After commit invoke the Mock email through the idempotent outbox/provider boundary; failure leaves the Application successful and retryable, never rolls back or duplicates it. An owned existing Application with the same immutable confirmation contract may heal this notification even after the signed intent expired or the Job closed; the retry cannot create a second Application or `EmailLog`.
- [x] **External-apply jobs:** if the current approved/published `JobRevision.applicationContactKind='APPLY_URL'` and `applicationContactValue` passes the URL policy, CTA links out and no internal `Application` is created; record only an allowlisted external-apply click event when approved
- [x] Canonical `APPLICATION_TRANSITIONS_V1` is closed and its actor×from×to matrix is defined. Phase 09 exposes only the row-locked Candidate command from `SUBMITTED|IN_REVIEW|SHORTLISTED|INTERVIEW|OFFER → WITHDRAWN`; Candidate cannot move `HIRED|REJECTED|WITHDRAWN`. The policy already reserves the authorized Employer `PIPELINE` edges `SUBMITTED→IN_REVIEW`, `IN_REVIEW→SHORTLISTED|REJECTED`, `SHORTLISTED→INTERVIEW|REJECTED`, `INTERVIEW→OFFER|REJECTED`, `OFFER→HIRED|REJECTED`, but Phase 10 owns the Employer-facing mutation, notifications and UI. `REJECTED`, `HIRED`, `WITHDRAWN` are terminal; Employer cannot skip/backtrack/withdraw. Rejection requires `ApplicationRejectionReason` and may include a bounded candidate-visible note. Same-target retry returns current state without a second Event/Notification.

### `/candidate/alerts` — Jobabos

- [x] Create/edit/pause/resume/delete `JobAlert`; first activation has an unticked explicit service-delivery checkbox and appends exactly one deduped `UserConsentEvent{JOB_ALERT_DELIVERY,granted=true}` plus the canonical activation event. It is independent of Marketing and can be revoked at any time. Per-alert unsubscribe/pause changes only that Alert. The separate global revoke command appends `granted=false` and atomically pauses all ACTIVE alerts; re-grant never auto-resumes them, and explicit resume requires current granted consent.
- [x] Form fields: keyword, location (canton/city), radius, category, workload min/max, salary transparency only, remote preference, frequency (daily/weekly), active toggle
- [x] `JOB_ALERT_POLICY_V1` uses `Europe/Zurich`: activation at `now` sets `nextDueAt` to the first applicable local 08:00 strictly after `now`—DAILY is the next calendar day; WEEKLY is the next Monday, including the same Monday when activation is before 08:00, otherwise the Monday seven days later. A due run owns the half-open publication window `(lastSuccessfulCutoffAt ?? createdAt, now]`, selects at most 20 distinct Jobs by `publishedAt DESC,id ASC` through canonical public eligibility, and excludes every `(alertId,jobId)` already stored in a prior successful DigestItem. One `JobAlertDigest` is unique by `(alertId,scheduledFor)` and stores window/count/policy version; its items snapshot ordered Job IDs. Empty digests are valid. Only after the Mock EmailLog/Event transaction succeeds are cutoff=`now` and next daily/weekly 08:00 advanced. DST, Monday-before/at/after-08:00, failure/retry, cap, no-repeat and simultaneous-run fixtures use an injected clock.
- [x] List existing alerts with last-digest date, consent/lifecycle state and "Beispiel-E-Mail anzeigen". Preview is read-only. An explicit idempotent `runJobAlertDigestMock({ now, alertId? })` command locks only `ACTIVE`, currently consented and `nextDueAt<=now` Alerts, scans auch mehr als 1.000 fällige Alerts ohne Starvation, schreibt genau einen `EmailLog{MOCK_RECORDED}` + Digest/Event und advances the schedule; no cron/real delivery is claimed. Suspended Candidates remain excluded. A transient capture failure retains the durable Digest, compensates the schedule and retries without duplicated domain effects.
- [x] Every Mock digest creates a fresh 256-bit raw one-click token and passes it only to the outbound Mock capture URL `/alerts/unsubscribe/[token]`; persisted `JobAlertUnsubscribeToken` stores only hash, `expiresAt=issuedAt+180 days`, Alert/Digest and `usedAt?`. All still-valid historical tokens work. EmailLog/Audit payloads redact token/full URL. `app/alerts/unsubscribe/[token]/page.tsx` is dynamic/no-store/noindex with `Referrer-Policy:no-referrer` and posts an idempotent action. It works without a Session, reveals no account existence/data, marks only that Alert `UNSUBSCRIBED`, consumes all its tokens and appends `UNSUBSCRIBED`; it does **not** revoke global delivery consent. Invalid/used/expired tokens receive the same generic confirmation shell. Resume requires Login, current global consent and an explicit Alert action.
- [x] Disclaimer: "Job-Alerts werden im MVP nur als lokaler Mock-Eintrag erzeugt, ohne externe Tracking-Pixel. Du kannst sie jederzeit mit einem Klick pausieren."

### `/candidate/messages`

- [x] List of actual Conversation threads (Application plus **accepted** Talent Radar requests once Phase 14 creates them) with unread badges. A pending/declined Radar request is never represented as a Conversation. Die Liste paginiert stabil mit 25 Threads pro Seite.
- [x] Thread detail: chronological list, "Antworten" textarea, send via server action; die Historie verwendet eine ownership-geprüfte Cursor-Pagination mit 200 Nachrichten pro Seite
- [x] For an accepted Talent Radar Conversation, Phase 14 may add a separate banner "Identität für [Firma] freigeben". Accept/Decline is never performed in a Message thread; it belongs to the candidate-owned request detail before any Conversation exists.
- [x] Sanitize message bodies via `lib/security/sanitize.ts`; render as plain text (no raw HTML injection paths). Zulässige Empfänger sind aktive Owner/Admins sowie aktive, aktuell der Bewerbung zugewiesene `PIPELINE`-Mitglieder; Empfänger werden dedupliziert.

### `/candidate/privacy`

- [x] Privacy dashboard sections:
  1. Talent Radar status: opt-in/out toggle (mirrors SwissJobPass) + consent log table (date · kind · value · version)
  2. List of employers who contacted the candidate: company name + date + canonical status (pending/accepted/declined/expired/cancelled) and separate reveal event where one exists; do not promise unmodelled profile-view tracking
  3. Data export: button "Datenexport anfordern" → creates an authenticated/rate-limited `PrivacyRequest{EXPORT}` and shows its status/Mock limitations. Only the verified case workflow may later build the allowlisted local manifest; no immediate untracked JSON response.
  4. Data deletion: button "Konto-Löschung beantragen" → creates `PrivacyRequest{DELETE}`, shows pending status, dependencies and Mock/retention limitations
  5. Data correction: reuse the Phase-14 intake contract exactly—choose 1–5 distinct codes from `DISPLAY_NAME|LEGAL_NAME|EMAIL|PHONE|LOCATION|PROFILE_PREFERENCES|CONSENT_HISTORY|APPLICATION_DATA|OTHER_ACCOUNT_DATA` plus sanitized plain text of 20–1000 Unicode characters; create `PrivacyRequest{CORRECT}` without attachment/URL/arbitrary target or analytics/log body and show the same case status
  6. Misuse reporting: link/button to open an `AbuseReport` against an employer/message
- [x] Disclaimers: "DSG-freundliches MVP — Orientierung, keine Rechtsberatung." · "Identität bleibt anonym, bis du sie freigibst."

## Files to create / modify

- `app/candidate/{layout.tsx,dashboard/page.tsx,jobpass/{page.tsx,actions.ts},talent-radar/page.tsx,saved-jobs/{page.tsx,actions.ts},applications/{page.tsx,[id]/page.tsx,actions.ts},alerts/{page.tsx,actions.ts},messages/{page.tsx,[threadId]/page.tsx,actions.ts},privacy/{page.tsx,actions.ts}}`; `app/alerts/unsubscribe/[token]/{page.tsx,actions.ts}`
- Phase-07 public files updated here: `app/(public)/jobs/[slug]/page.tsx`, `app/(public)/jobs/actions.ts`, `components/public/job-card.tsx`, `components/public/apply-save-actions.tsx`, `lib/auth/signed-intent.ts`
- Candidate UI: `components/candidate/{ProfileCompletion.tsx,JobPassForm.tsx,RadarVisibilityForm.tsx,AnonymousPreview.tsx,saved-job-list.tsx,application-actions.tsx,application-kanban.tsx,application-list.tsx,application-pagination.tsx,application-timeline.tsx,alert-form.tsx,alert-list.tsx,job-alert-unsubscribe-form.tsx,message-compose-form.tsx,message-pagination.tsx,privacy-request-forms.tsx}`
- Domain layer: `lib/candidate/{dashboard.ts,profile.ts,saved-jobs.ts,job-alerts.ts,job-alert-policy.ts,job-alert-digest-scan.ts,messages.ts,privacy-dashboard.ts}` and `lib/applications/{candidate-commands.ts,confirmation.ts,contracts.ts,integrity.ts,queries.ts,service.ts}`
- Persistenz: dreizehn additive Phase-09-Migrationen `20260720230000` bis `20260720231200`; `31000` und `31100` bereinigen ausschliesslich eindeutig markierte alte DEMO-Projektionen und lassen LIVE-/gemischte Daten unberührt. `31200` ergänzt unveränderliche Empfänger-/Alertname-Snapshots für exakte Digest-Retries und rekonstruiert ausschliesslich offene historische Digests. Der deterministische Candidate-Workflow-Seed besitzt Vertragsversion `phase-09-demo-v6`.

## Implementierte Phasengrenzen

- Phase 09 besitzt Candidate-Profil, Candidate-Save/Apply/Withdraw, Application-
  Read-Models, Candidate-Nachrichten, Jobabo-Mock und Privacy-Basics. Die
  geschlossene Application-Matrix ist hier definiert; Employer-Pipeline-
  Mutationsendpunkte, Employer-UI und deren Kandidatenbenachrichtigungen gehören
  Phase 10.
- Phase 09 besitzt Radar-Opt-in, versionierte Consent-Historie und die anonyme
  Safe Preview. Employer Search/ContactRequest, Candidate Accept/Decline und ein
  scoped Identity Reveal bleiben vollständig Phase 14; eine Antwort im
  Message-Thread enthüllt niemals automatisch Identität.
- Jobabos werden nur durch einen expliziten lokalen Mock-Command erfasst. Es
  gibt keinen Cron/Worker und keinen externen Mailversand; Production Worker,
  Outbox-Betrieb und reale Provider bleiben späterer Operations-Scope.
- Öffentliche beziehungsweise optionale Product-Analytics werden nur mit einer
  nachweisbaren aktuellen Privacy-Consent-Quelle geschrieben. Essentielle
  Betriebs-, Security- und Idempotenzereignisse bleiben davon getrennt und
  dürfen nicht als Marketing-Tracking umgedeutet werden.
- Phase 09 prüft die Candidate-Hälfte der Journey mit Unit-, PostgreSQL-,
  Build-/Route- und manuellen Browser-Gates. Die vollständige rollenübergreifende
  E2E-Journey mit Employer-Statusmutation gehört Phase 17.

## Rules to respect (from `99-rules-quickref.md`)

- §9 Candidate Privacy — never expose name/email/phone/CV via Talent Radar API; only via reveal
- §17 Talent Radar — reveal explicit, logged, auditable
- §10 — sanitize message bodies, render UGC as plain text and integrate the Phase-06 rate-limit primitive in each application/privacy action owned here
- §39 — Radar visibility appends canonical `CandidateConsent`; reveal/contact/privacy actions append their domain event plus required Audit evidence

## Verification

> Alle folgenden Punkte wurden gegen den unveränderlichen Phase-09-Code-Commit
> `c3ae5332b8d855137798147c3ceab9f5bd8bfdc8` geprüft. Exakte Date-/Testzahlen,
> Exit-Codes, Seed-Hashes und Browserbeobachtungen stehen im Evidence-Record.

- [x] `candidate@demo.ch` can edit SwissJobPass and toggle Talent Radar — every on/off change appends versioned CandidateConsent and updates the derived Radar state
- [x] Anonymous preview shows skills/canton but not name/email
- [x] Application Kanban shows seeded applications across statuses
- [x] Creating a Jobabo persists Alert/Event + explicit delivery consent; Zurich clock fixtures prove daily/weekly due windows, exactly-once/no-repeat/cap behavior and token expiry. One-click unsubscribe affects only its Alert, while explicit global revocation pauses all and re-grant resumes none; inactive/unconsented alerts create 0 EmailLogs
- [x] Draft/Complete/Reopened profile fixtures prove the exact activation predicate; incomplete Radar profiles produce 0 search rows, while a Draft candidate may still submit after the explicit per-application identity confirmation
- [x] Anonymous Save/Apply resumes only a valid signed allowlisted intent after login and always requires final user confirmation; tampered/expired/external-next tokens perform no Save/Application and leak no Job id
- [x] Message list contains no pending/declined Radar request and Candidate saved/application detail routes enforce candidate-scoped safe 404; Phase 14 separately proves Accept and Reveal
- [x] Privacy page can request export, deletion and bounded correction, persisting typed `PrivacyRequest` and event/audit history
- [x] Applications paginate 25/page without loss or duplicates beyond 100 rows; messages paginate 25 threads/page and 200 entries/cursor beyond 200 rows while preserving ownership
- [x] Application confirmation hashes match exact persisted raw fields, and a failed post-commit Mock email can be retried exactly once after intent expiry/Job closure without a second domain effect
- [x] The `phase-09-demo-v6` seed is idempotent and its Application chains, JobAlert consent/digest/token/event projection, delivery snapshots and DEMO-only reconciliation migrations are verified against LIVE canaries

## Common pitfalls

- Rendering UGC (messages, job descriptions, guide articles) as raw HTML — must always go through `lib/security/sanitize.ts` and render as plain text
- Auto-revealing identity when candidate replies — reveal must require an explicit click
- Letting Talent Radar request show real name in a "preview" UI — never. Use `lib/privacy/anonymize-candidate`
- Forgetting consent version — bump `CONSENT_VERSION` const when copy changes so logs stay meaningful
- CV upload writing real bytes to disk — store metadata only via mock storage adapter

## PortalGERM Execution Contract

| Field                        | Binding phase contract                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business value               | Complete the Candidate loop: profile once, find/save/apply, track/respond and return via Alerts while retaining data control.                                                                                                                                                                                                                                                                                                                                                   |
| Roles / requirements         | Candidate; REQ-CAN-001–006, TR-001, SCORE-002, SEC-001.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Prerequisites                | 04, 06, 07; Candidate schema/queries; Phase 14 owns employer Radar search/contact/reveal E2E.                                                                                                                                                                                                                                                                                                                                                                                   |
| Routes/actions               | Dashboard, JobPass, Saved Jobs, Applications list/detail, Alerts + public unsubscribe, Messages list/detail, Talent Radar consent/preview, Privacy; public signed Save/Apply intent integration. Update/complete/reopen profile; save/delete; apply/withdraw; alert CRUD/test; send/report; privacy request.                                                                                                                                                                    |
| Data                         | Candidate profile/skills/languages/preferences/metadata, SavedJob, Application/Event, JobAlert/Event + delivery consent/unsubscribe token, Conversation/Message, Consent, PrivacyRequest, Notification.                                                                                                                                                                                                                                                                         |
| Validation                   | Progressive draft vs submit completeness; apply rechecks Published/current/company-active atomically; duplicate idempotency; bounded message/alert; consent version.                                                                                                                                                                                                                                                                                                            |
| Authorization/privacy        | Candidate ownership on every nested read/write; candidateNote/CV/PII excluded from unintended DTOs; reply never auto-reveals.                                                                                                                                                                                                                                                                                                                                                   |
| Audit/analytics/notification | Apply/withdraw/status-related Candidate actions, Consent, Privacy Request and Abuse Report append their required audit/event evidence. Optional Product-Analytics require current Privacy Consent; essentielle Operations-/Security-Ereignisse bleiben davon unabhängig. Reveal-Evidence entsteht erst mit Phase 14.                                                                                                                                                            |
| UX/mobile                    | Onboarding progress/resume/conflict, empty/recommendation confidence, timeline list, withdrawn/closed/expired, alert pause, chat states, explicit Radar preview and privacy consequences; 360px/keyboard.                                                                                                                                                                                                                                                                       |
| Seed                         | Deterministic `phase-09-demo-v6`: new/incomplete/active/suspended Candidates, expired Saved Job, canonical chains across all Application statuses, coherent Alerts/Consent/Digest/Token/Event projections with immutable delivery snapshots, paginable Messages and Privacy cases.                                                                                                                                                                                              |
| Tests                        | Candidate IDOR, exact onboarding complete/reopen, concurrent absolute duplicate apply, exact raw snapshot hashes, post-commit notification healing, signed intent tamper/expiry/no-auto-submit, Candidate withdraw transitions, DTO leak, >100/200 pagination, message participants, alert consent/due/idempotent mock/capture compensation/public no-store unsubscribe and 0-send inactive/suspended cases; Radar consent/onboarding races; DEMO/LIVE reconciliation canaries. |
| Verification                 | Candidate integration suite, E2E-01 Candidate half, mobile/a11y. Expected persisted reloadable state and 0 cross-candidate/private-field leak. Employer status mutation and full cross-role E2E remain Phase 10/17.                                                                                                                                                                                                                                                             |
| Risks / limitations          | Jobabo is preview/explicit command until Worker; file bytes absent; Privacy Requests are persisted cases rather than completed legal processing; Contact/Reveal remains Phase 14.                                                                                                                                                                                                                                                                                               |
| Definition of Done           | Implementation, Persistenz, Tests, Build, E2E, mobile Browserprüfung und commitgebundener Evidence-Record sind vollständig; Phase 09 ist in `00-PLAN.md` abgeschlossen.                                                                                                                                                                                                                                                                                                         |

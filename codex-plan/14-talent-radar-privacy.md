# Phase 14 — Talent Radar & Privacy

> **PortalGERM status: IMPLEMENTED AND VERIFIED.** Der vollständige Phase-14-Vertrag ist im final verifizierten Code-Commit `fadf54e6b896350ef8488c7b2361a8f91666e638` umgesetzt und durch [Phase-14-Evidence](./evidence/2026-07-22-phase-14.md) belegt. P0 bleibt ein datenschutzrechtlich zu prüfender lokaler Mock, keine Produktions- oder Rechtsfreigabe.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 14. Read [99-rules-quickref.md](./99-rules-quickref.md) §9, §17 before starting. **This is the most privacy-sensitive feature in the project — apply maximal care.**

## Goal

Build the full anonymous Talent Radar flow: anonymous candidate browsing for employers with access, server-side credit deduction per contact request, identity reveal flow with logging, candidate-side controls (consent log, deletion, export, abuse reporting). Wire `/employer/talent-radar` into the data layer.

## Prerequisites

- [x] Phase 02 canonical Candidate Consent/RadarProfile, opaque mapping, ContactRequest/Event, scoped RevealGrant, PrivacyRequest, AbuseReport and Credit Ledger models
- [x] Phase 03 helpers (`lib/privacy/anonymize-candidate`, separate Radar/User consent APIs, `lib/privacy/requests`, `lib/privacy/export-mock`, `lib/audit`)
- [x] Phase 06 auth + ownership
- [x] Phase 09 candidate Consent/Privacy/Message shells; pending requests deliberately have no Conversation
- [x] Phase 10 employer `/employer/talent-radar` UI shell
- [x] Phase 12 mock checkout and Entitlement/Credit Ledger (Contact Pack grants a typed ledger balance)

## Deliverables (checklist)

### Anonymized candidate browsing (employer side)

- [x] Server-side query helper `lib/talentradar/list-candidates.ts`:
  - Before any Candidate query, requires an active Membership role Owner/Admin/Recruiter, Company `ACTIVE`, current verified Company evidence and `TALENT_RADAR_ACCESS=true`; suspended/unverified/closed/draft Companies get locked/denied even if a stale Subscription exists
  - Uses the one canonical eligibility predicate `isRadarCandidateEligible(candidateId, now, environment)`: underlying `User.status=ACTIVE`, `CandidateProfile.onboardingStatus=COMPLETE`, latest effective `CandidateConsent{kind=TALENT_RADAR_VISIBILITY}` is `granted=true` under an accepted notice version, and the derived `RadarProfile` has `publishedAt <= now` and `withdrawnAt IS NULL`; Production additionally requires canonical Candidate/Radar provenance `LIVE`, while Demo provenance is allowed only in Development/Test. Every list/contact resolution reuses this predicate.
  - Maps every record through a Safe DTO using an opaque server-mapped Radar id, never PK/handle as authorization (ADR-006/022)
  - Applies only the filters and buckets in `RADAR_PRIVACY_POLICY_V1` below; clients cannot send raw predicates or extra Prisma fields
  - Returns a privacy-bounded, signed-cursor sample rather than an enumerable full result set
- [x] The response **never** contains `firstName`/`lastName`/`email`/`phone`/`cvFileName`/`cvStorageKey`/full city/address — the Prisma `select` omits those columns and the anonymizer output has none
- [x] If employer has **no** Talent Radar access: render blurred/locked preview with CTA "Talent Radar freischalten"; **do not call the data layer at all**

#### `RADAR_PRIVACY_POLICY_V1` — frozen P0 contract

- **Closed filters:** at most one active `Skill.id`; at most one canton code; one employer annual/FTE salary-budget ceiling; one workload minimum; at most one ISO-639-1 language plus one coarse minimum-level bucket; and one `RemotePreference`. Unknown keys, arrays, free text and ranges outside the buckets fail validation rather than being ignored.
- **Normalization/buckets:** salary ceilings round down to CHF 10,000 steps from CHF 40,000 through CHF 250,000 and mean YEARLY/FTE only. A Candidate enters salary matching only when the preference itself is explicitly `SalaryPeriod.YEARLY`; MONTHLY/HOURLY/missing is `UNKNOWN`, is never annualized, is omitted from the Safe DTO and cannot match a salary-filtered query. Workload minimum is one of `20|40|60|80|100`; language level maps to `BASIC=A1/A2`, `WORKING=B1/B2`, `ADVANCED=C1/C2/NATIVE`; canton and remote preference remain their closed canonical enums. Cards expose only the matching coarse bucket/allowlisted taxonomy labels plus `salaryPeriod='YEARLY_FTE'` when present, never exact salary/location or an unselected language/skill.
- **Cohort floor:** calculate the number of currently eligible candidates after **all** normalized filters and before sampling. Fewer than `10` yields the same `INSUFFICIENT_COHORT` response with zero cards for both zero and rare matches. No exact total is returned. For qualifying cohorts the only count label is the largest applicable bucket `10+|25+|50+|100+`.
- **Bounded discovery:** select a deterministic pseudorandom sample of at most `20` distinct Candidates per Company + normalized-filter hash + Europe/Zurich calendar day, using an HMAC seed held only on the server. Refreshing or opening a new search session on that day returns the same sample and order. Page size is `10`, there are at most two pages, and the signed cursor contains the Company, filter hash, daily sample id, position and 15-minute expiry. The API never exposes an offset, exact total, arbitrary page number or an endpoint for all ids.
- **Enumeration controls:** per active Membership allow `10` list requests per rolling minute; per Company allow at most `30` distinct normalized-filter hashes per Europe/Zurich calendar day. Repeating an existing hash does not consume a distinct-filter slot. Limits are server-derived, return a typed generic rate/limit state without cohort details, and append redacted security/audit evidence; all filter and cursor checks happen before returning Candidate data.
- **No intersection bypass:** cohort floor, daily sample and limits apply to the final conjunction and to every page. Different orderings, omitted defaults, casing or semantically equivalent values canonicalize to the same filter hash. Candidate cards cannot be sorted by a rare attribute.

`RADAR_PRIVACY_POLICY_V1` is versioned code/config with golden tests; changing a bucket, threshold, sample size, rate or opaque-id epoch requires a recorded Privacy/Product decision and regression fixtures. The P0 values are product hypotheses, not legal approval.

#### Opaque Radar identifier lifecycle

- Each card token is a CSPRNG-generated 128-bit base64url value scoped to `(candidateProfileId, companyId, epoch)`; it is not derived from a Candidate/User id, name, email or stable handle. Persist a keyed HMAC lookup plus authenticated-encrypted token ciphertext, scope/epoch/timestamps; use the separate Phase-01 versioned `RADAR_OPAQUE_LOOKUP_KEYS`/`RADAR_OPAQUE_ENCRYPTION_KEYS` keyrings, never log the raw token, and compare lookup hashes server-side. Decrypt only while constructing an already-authorized Safe DTO. Tokens are therefore not correlatable across Companies.
- Platform epochs are consecutive 30-calendar-day periods anchored at `2026-01-01 00:00 Europe/Zurich`. At an epoch boundary old mappings expire with **no overlap**, and a new random value is minted only if the Candidate is still eligible. Opt-out, onboarding reopen, User suspension/deletion or any other eligibility loss revokes every active mapping immediately; a later re-completion/re-opt-in always receives a fresh value.
- A list/contact lookup accepts only an unexpired mapping for the authenticated Company and current epoch, then rechecks `isRadarCandidateEligible` under the mutation lock. Expired/revoked/cross-company/replayed values all return the same safe `NOT_FOUND` result and never reveal whether a Candidate exists.
- `EmployerContactRequest`, accepted Conversation and Reveal records retain internal foreign keys and have their own tenant/participant-scoped URLs. They never store or authorize from the listing token, so rotation does not break legitimate history and old card URLs cannot reopen it.

### Contact request flow

- [x] Modal on a candidate card: form `subject`, `messagePreview` (max 500 chars), sanitised; no field for candidate data *(`components/employer/TalentRadar/ContactDialog.tsx`)*
- [x] Server action `sendContactRequestAction` → `lib/talentradar/request-contact.ts`:
  1. `getEmployerContext` (EMPLOYER/RECRUITER + company membership); VIEWER blocked
  2. Rechecks Company `ACTIVE` plus current Verification and Talent-Radar entitlement before any Candidate query
  3. Resolves the internal Candidate only from the current Company-scoped opaque mapping; under lock it rechecks token epoch/revocation and `isRadarCandidateEligible`
  4. Confirms the signed search-session/filter hash is still valid and its final cohort still passes `RADAR_PRIVACY_POLICY_V1`; a stale card never bypasses cohort suppression
  5. `canRequestContact(effectiveEntitlements, fundableGrantSummary)` → typed `LIMIT` on denial; the mutation then re-locks/re-derives both inputs before consumption
  6. Locks candidate/request/funding scope, enforces no current PENDING duplicate and the 30-day terminal recontact cooldown, then consumes exactly one eligible Credit Ledger grant in this order: current-period `PLAN_ALLOWANCE`, then `PURCHASED_PACK`, then `ADMIN_GRANT`; within a source use earliest non-null expiry then oldest grant. Record funding source/grant/consume entry/idempotency.
  7. Creates `EmployerContactRequest{ PENDING, expiresAt: now + 14 days, fundingSource, … }` in the same transaction. P0 validity is half-open `createdAt <= now < expiresAt`.
  8. Records candidate `CONTACT_REQUEST_RECEIVED` Notification + mock email `talent_contact_request_received`; it does **not** create a Conversation or Message while pending and never asks the employer to request identity
  9. Audit `CONTACT_REQUEST_SENT`
- [x] On failure (no credits) → typed error → shared `<UpgradeDialog>` with `suggestedProductSlug = 'contact-pack-10'`

#### Canonical eligibility-loss effects

- Candidate opt-out, Candidate onboarding `COMPLETE → DRAFT`, User `ACTIVE → SUSPENDED|DELETED`, Company loss of `ACTIVE`, or current Company verification loss runs one idempotent transaction: withdraw the relevant RadarProfile/mappings, write the domain event/audit, and transition every affected effective `PENDING` request to `CANCELLED` with exactly one reason `CANDIDATE_OPTED_OUT|CANDIDATE_PROFILE_INCOMPLETE|CANDIDATE_USER_UNAVAILABLE|COMPANY_INACTIVE|COMPANY_VERIFICATION_LOST`. Both parties receive `CONTACT_REQUEST_CANCELLED`; no Conversation/Reveal is created and the original credit is not automatically refunded.
- A cancelled request is read-only: the Candidate can inspect minimal company/message/status evidence and report abuse, but cannot Accept **or Decline** it. This resolves the trust-loss case deterministically; Decline exists only for an effective `PENDING` request.
- Candidate opt-out/onboarding reopen stops discovery and cancels pending requests, but does not erase an already accepted relationship, Conversation, Reveal or audit history. User suspension additionally blocks new messages and every Radar identity DTO while suspended. Company suspension/verification loss likewise blocks new messages and identity reads. Existing accepted history remains visible in a minimal non-PII form.
- User reactivation never republishes Radar automatically: the Candidate must be `COMPLETE` and append a new explicit opt-in, which mints a new opaque mapping. Existing accepted/unrevoked Reveal history can become readable again only after both Users/Company satisfy the current read guard; Candidate opt-out by itself does not revoke an accepted Reveal, for which the separate explicit revocation action below is provided.

### Reveal flow (candidate side)

- [x] `/candidate/talent-radar/requests` and `/candidate/talent-radar/requests/[id]` list/read only the current Candidate's ContactRequests. The pending detail shows verified Company, bounded message, purpose, expiry and buttons **„Kontaktanfrage annehmen“** / „Ablehnen“; it is reachable without a Conversation.
- [x] Candidate detail rechecks current Company state/verification. If trust was revoked/suspended, it shows „Firma derzeit nicht verifiziert“, disables Accept/new Reveal and new Radar-thread messages, keeps minimal historical evidence and permits reporting. The canonical trust-loss transaction has already moved effective PENDING requests to `CANCELLED`, so a cancelled request deliberately has no contradictory Decline button.
- [x] Candidate Accept transitions only a currently effective `PENDING → ACCEPTED`, appends event, and then creates/reuses the scoped anonymous Conversation. Identity remains anonymous until a separate **„Identität für [Firma] freigeben“** dialog lists unchecked `RevealField` choices (`DISPLAY_NAME`, `EMAIL`, `PHONE`, `CV_METADATA`), exact preview and notice/recipient.
- [x] Exactly one `IdentityRevealGrant` may exist per accepted request (`contactRequestId @unique`). `buildRevealPreview({contactRequestId, fields, noticeVersion})` returns the exact displayed values plus a server-signed, one-use, 10-minute confirmation token containing no plaintext PII. `grantRevealFields({contactRequestId, fields, noticeVersion, confirmationToken, idempotencyKey})` locks request/grant, validates token scope/expiry/use and rereads the Candidate's current selected values: the first non-empty confirmation creates the grant; a later confirmation may append only previously absent closed field rows to that same unrevoked grant. The token and stored confirmation bind the active Phase-01 `REVEAL_CONFIRMATION_KEYS` version via HMAC-SHA-256 of the canonical values—not a plain guessable hash. Every confirmation appends immutable evidence containing recipient Company, request/conversation, complete resulting field set, newly added set, notice/version/key version and preview HMAC. If the server-reread HMAC differs, the command returns `STALE_REVEAL_PREVIEW` and requires reconfirmation; it never overwrites prior evidence, removes a field, accepts a duplicate/unknown/free-string value or reopens a revoked grant.
- [x] Each `IdentityRevealGrantField` is an immutable **value snapshot**, not permission to reread the live profile: store `field`, `valueSchemaVersion`, `keyVersion`, AES-256-GCM `ciphertext`, 12-byte random `nonce`, 16-byte `authTag`, keyed `valueIntegrityHmac`, `capturedAt` and no plaintext value. AAD binds `grantId|candidateProfileId|companyId|contactRequestId|field|valueSchemaVersion`. Closed v1 codecs are: normalized UTF-8 `DISPLAY_NAME` `1..120` chars; canonical email `3..254` chars; E.164 phone `8..16` chars; and a fixed typed binary `CV_METADATA` tuple `(safeFileName<=255, mime=application/pdf|image/png|image/jpeg|image/webp, sizeBytes<=5 MiB)`—never generic JSON, storage key or file bytes. The dedicated Phase-01 `PII_REVEAL_KEYS` keyring encrypts/decrypts these rows; Reveal confirmation, Radar, Session and Audit secrets are not reused, raw values never enter logs/audit/analytics, and rotation retains controlled old-version reads while referenced rows exist.
- [x] The confirmation dialog's server-built preview displays precisely the values that will be encrypted. Later profile/email/phone/CV changes never alter an existing Reveal snapshot; adding a new field captures its then-current value in a new encrypted row and confirmation event on the same grant. Existing field rows cannot be refreshed in place; sharing a changed value requires a later separately consented relationship after revocation/new request policy.
- [x] `revokeIdentityReveal({grantId, reasonCode?, confirmationVersion})` is an authenticated Candidate-only command scoped through the Candidate owner; optional reason is closed to `PRIVACY_CHOICE|TRUST_CONCERN|OTHER`. It is idempotent, locks a currently unrevoked grant, writes `revokedAt/revokedBy/reason`, `IDENTITY_REVEAL_REVOKED` audit/domain evidence and an employer `IDENTITY_REVEAL_REVOKED` Notification. From commit onward every Radar DTO omits all grant fields; the Conversation may continue anonymously if both parties remain allowed. Employer/Admin cannot clear `revokedAt`, append fields or re-enable the grant. UI confirmation states truthfully that data already seen or copied cannot technically be made unseen; a revoked request cannot be revealed again.
- [x] Decline transitions `PENDING → DECLINED`, never creates a RevealGrant and discloses no identity. Requesting Company may cancel only PENDING. An explicit idempotent expiry command writes `EXPIRED`; public GET only treats the half-open boundary as expired. Decline/expiry/cancel does not refund automatically; Admin may append an exact referenced Ledger `REVERSAL` with reason/audit. Recontact waits 30 days after terminal event; after ACCEPTED the existing Conversation is reused.

### Employer view of candidate after reveal

- [x] Helper `lib/talentradar/can-see-identity.ts`: direct Application context follows its own policy. Radar identity is selected field-by-field only when Candidate User is currently `ACTIVE`, Company is currently `ACTIVE` and verified, the request remains `ACCEPTED`, request/conversation/candidate/company all match, and the single grant has `revokedAt IS NULL`; never a global company-wide reveal. Radar opt-out does not retroactively destroy an accepted relationship, but Company/User suspension and verification loss fail this read guard. Existing grant/audit history remains and Candidate may revoke the grant.
- [x] Used on the talent-radar candidate detail; `/employer/applicants` shows identity only through the application context
- [x] **Server-side enforcement**: first query only scope/status and encrypted grant rows; after `canSeeIdentity` succeeds, decrypt each allowlisted field through its exact typed codec and construct the DTO from those immutable snapshots. Radar reads never refetch live Candidate/User identity columns and never deserialize generic JSON. Every request repeats the current guard—there is no cached plaintext PII DTO. A newly appended field appears only after its confirmation commits; later profile edits do not change disclosed values, while revocation or trust loss removes all Reveal-derived fields from the next read and preserves non-PII history.

### Candidate privacy dashboard wiring

- [x] (Phase 09) "Wer hat dich kontaktiert" lists `EmployerContactRequest` for the candidate with company + status + date + abuse-report action
- [x] (Phase 09) Data export action creates only an authenticated/rate-limited `PrivacyRequest{EXPORT}`. The later verified Admin workflow creates a local manifest/status Mock; the intake never returns an immediate dump.
- [x] (Phase 09) Deletion action creates a pending `PrivacyRequest{DELETE}` with dependencies/limitations visible; P0 completes only a documented assessment Mock and performs no erasure/anonymization before retention/legal approval.
- [x] (Phase 14) Correction action creates a bounded `PrivacyRequest{CORRECT}` case and shows its exact status/outcome; it is not a generic Admin database-edit endpoint.
- [x] (Phase 09) Abuse reporting form files an `AbuseReport` — admin handles it in `/admin/reports`

#### Privacy request intake — exact P0 Mock contract

- `createPrivacyRequest({type, noticeVersion, idempotencyKey, deleteConfirmation?, correctionFieldCodes?, correctionText?})` derives `userId` from the authenticated session, requires `User.status=ACTIVE`, applies the Privacy-request rate preset and never accepts an actor/target id from the client. The unique `(userId,idempotencyKey)` makes retries return the existing case.
- `EXPORT` accepts no payload beyond common fields. `DELETE` additionally requires the exact phrase `KONTO-LÖSCHUNG BEANTRAGEN` and rejects correction fields/text. `CORRECT` requires `1..5` distinct values from `DISPLAY_NAME|LEGAL_NAME|EMAIL|PHONE|LOCATION|PROFILE_PREFERENCES|CONSENT_HISTORY|APPLICATION_DATA|OTHER_ACCOUNT_DATA` plus plain-text `correctionText` of `20..1000` Unicode characters; no HTML, attachment, URL callback, model/property path or arbitrary target id is accepted. Export/Delete reject all correction-only properties.
- One nonterminal request per User + type is allowed; an idempotent retry returns it and a semantic duplicate links to it instead of creating parallel work. At most five new cases per User in a rolling 30-day window are self-served; the typed limit state links to authenticated Support so the control never silently discards a privacy concern. The threshold and P0 Mock require Privacy/Legal review before production.
- Creation writes `PENDING`, `dueAt = createdAt + 30 Europe/Zurich calendar days` as an internal service target (not a legal promise), a `CREATED` event and `PRIVACY_REQUEST_CREATED` audit with no correction text. Case content is restricted operational data: no Product Analytics, email/log body or broad Admin-list projection contains `correctionText`.
- `cancelPrivacyRequest({requestId})` is owner-only and idempotent. It permits `PENDING|IDENTITY_CHECK → CANCELLED`, appends event/audit and cannot cancel `IN_PROGRESS` or a terminal case. Cross-user ids are safe 404.

### Admin oversight

- [x] `/admin/reports` lists abuse (COMPANY targets link to the company); Talent Radar reports are filed against the company
- [x] `/admin/companies/[id]` shows privacy-safe Talent Radar usage with included-period, purchased-pack and admin-grant consumption/balances separately, contacts/reveals and abuse reports
- [x] `/admin/privacy-requests` is a bounded queue containing id/type/status/age/due bucket only; `/admin/privacy-requests/[id]` is the need-to-know case detail. Both routes and every action independently enforce the capabilities below and write access/mutation audit evidence.

#### Admin privacy case workflow — exact P0 Mock contract

P0 maps all three named capabilities only to the global Platform Admin role through centralized policy functions; P1 may split Privacy Operations staff without changing route/use-case semantics:

| Capability | Permitted operation |
|---|---|
| `PRIVACY_CASE_READ` | Read queue and one assigned/justified case; no bulk export and no unrelated Candidate private data. |
| `PRIVACY_CASE_VERIFY` | Start and record the approved identity-check result. |
| `PRIVACY_CASE_PROCESS` | Build the typed Mock outcome, reject, add a bounded internal note and complete a verified case. |

Allowed commands/transitions are closed; same-target retries with the same idempotency key return the stored result, and every command uses optimistic version/row-lock checks:

| Actor / command | From → to | Required evidence and effect |
|---|---|---|
| Privacy Admin `startIdentityCheck({requestId, version, idempotencyKey})` | `PENDING → IDENTITY_CHECK` | `PRIVACY_CASE_VERIFY`; creates one `PrivacyIdentityChallenge` expiring after 15 minutes with at most five attempts and sends `PRIVACY_REQUEST_CHANGED`. It stores no password/code/token/government-id image; event `IDENTITY_REQUESTED`. |
| Candidate `completePrivacyIdentityChallenge({requestId, password, idempotencyKey})` | `IDENTITY_CHECK → IDENTITY_CHECK` | Owner-only `/candidate/privacy/requests/[id]/verify`, `private,no-store/noindex`; requires current ACTIVE User, `emailVerifiedAt`, verifies the submitted password directly against `Credential`, increments the server-owned attempt counter and marks the Challenge verified. Password is never persisted/logged; missing/foreign/expired/locked/wrong all share a generic response and do not leak account state. |
| Privacy Admin `verifyPrivacyIdentity({requestId, version, idempotencyKey})` | `IDENTITY_CHECK → IN_PROGRESS` | Current matching Challenge has `verifiedAt`, is unexpired/unconsumed and User remains eligible; atomically consumes it, writes case `verifiedAt`, `VERIFIED`, then `PROCESSING_STARTED`. Failure keeps state and records only a redacted result. |
| Owner `cancelPrivacyRequest({requestId})` | `PENDING` or `IDENTITY_CHECK` → `CANCELLED` | Ownership + current version; `CANCELLED`. |
| Privacy Admin `buildExportManifestAndComplete({requestId, version, idempotencyKey})` | `IN_PROGRESS → COMPLETED` for `EXPORT` only | Allowlisted owner-data category names, row counts, manifest checksum and `expiresAt=now+7 days`; no file bytes/provider delivery. Atomically writes `MANIFEST_CREATED`, then `COMPLETED`. |
| Privacy Admin `recordDeletionAssessmentAndComplete({requestId, dependencyCodes, outcomeCode, safeNote?, version, idempotencyKey})` | `IN_PROGRESS → COMPLETED` for `DELETE` only | Closed dependency codes `ACCOUNTING_RETENTION`, `ACTIVE_APPLICATIONS`, `MESSAGES`, `ABUSE_SECURITY_AUDIT`, `LEGAL_HOLD`, `ACTIVE_COMPANY_DUTY`, `NONE`; `NONE` is mutually exclusive, `safeNote` is plain text `0..500`, and outcome is P0-only `ASSESSMENT_COMPLETED_NO_ERASURE`. It records limitations/next step and explicitly does **not** delete/anonymize a row or change `User.status`. |
| Privacy Admin `recordCorrectionOutcomeAndComplete({requestId, reviewedFieldCodes, outcomeCode, domainEventRefs?, safeNote?, version, idempotencyKey})` | `IN_PROGRESS → COMPLETED` for `CORRECT` only | `1..5` reviewed codes must be a subset of intake, `safeNote` is plain text `0..500`; outcome is `CORRECTED_VIA_CANONICAL_COMMAND`, `NO_CHANGE_REQUIRED` or `REFERRED_FOR_POLICY`. Any supported data change runs the owning validated domain command and stores its event reference—never an arbitrary field patch. |
| Privacy Admin `rejectPrivacyRequest({requestId, reasonCode, safeNote?, version, idempotencyKey})` | `PENDING`, `IDENTITY_CHECK` or `IN_PROGRESS` → `REJECTED` | `PRIVACY_CASE_PROCESS`; closed reason is `IDENTITY_NOT_VERIFIED`, `DUPLICATE`, `OUT_OF_SCOPE`, `INSUFFICIENT_INFORMATION` or `ABUSIVE_REQUEST`; safe note `0..500`; event `REJECTED`. |

No transition leaves `COMPLETED|REJECTED|CANCELLED`. Type/command mismatch, stale version, expired/attempt-exhausted/unverified challenge and an empty/invalid outcome fail closed without a status write. The Candidate verify route is the only challenge-completion path and is covered by ownership/CSRF/rate/generic-error tests. `NOTE_ADDED` allows `0..1000` internal plain-text characters only for `PRIVACY_CASE_PROCESS`, is never emailed/analysed, and records its own audit metadata without note content.

Every status change writes Audit `PRIVACY_REQUEST_STATUS_CHANGED`; export manifest creation also writes `PRIVACY_EXPORT_MANIFEST_CREATED`. Candidate gets persisted `PRIVACY_REQUEST_CHANGED` Notification plus a status-specific Mock email when state becomes `IDENTITY_CHECK`, `COMPLETED` or `REJECTED`; owner cancellation writes the same typed Notification to the assigned Admin queue. The schema-allowlisted Notification payload is exactly request id/type/new status/reason code, and Audit uses the same codes—neither contains correction text, identity evidence, manifest content or internal notes. The Candidate UI labels EXPORT/DELETE as Mock, displays the 7-day manifest-metadata expiry, and says `COMPLETED` for DELETE means **assessment completed, no erasure performed**.

### Disclaimers (German UI)

- [x] Employer view: "Identitäten der Kandidat:innen bleiben anonym, bis sie freigegeben werden." *(list + detail: "Identität bleibt anonym bis zur Freigabe")*
- [x] Candidate view: privacy page shows "DSG-freundliches MVP — Orientierung, keine Rechtsberatung. Identität bleibt anonym, bis du sie ausdrücklich freigibst."

## Files to create / modify

- `lib/talentradar/{privacy-policy-v1.ts, eligibility.ts, opaque-id.ts, list-candidates.ts, can-see-identity.ts, request-contact.ts, reveal.ts, contact-requests.ts, eligibility-loss-effects.ts}`
- `app/employer/talent-radar/{page.tsx,requests/page.tsx,requests/[id]/page.tsx,actions.ts}`; the request-bound detail route is Company-scoped and shows state/funding/reveal timeline without PII before the scoped grant
- `components/employer/TalentRadar/{CandidateCard.tsx, FilterBar.tsx, ContactDialog.tsx, LockedPreview.tsx, RevealedBadge.tsx}`
- `app/candidate/talent-radar/requests/{page.tsx,[id]/page.tsx,actions.ts}` for accept/decline before Conversation; `components/candidate/TalentRadar/RevealActions.tsx` only for the separate post-accept add-fields/revoke flow; `app/candidate/privacy/requests/[id]/verify/{page.tsx,actions.ts}` for the owner-only recent-password Mock identity challenge
- `lib/privacy/{reveal-dto.ts,requests.ts,export-mock.ts,postgres-export-adapter.ts,privacy-case-service.ts}` and `app/candidate/privacy/{page.tsx,actions.ts}` populated lists/intake/cancel; `app/admin/privacy-requests/{page.tsx,[id]/page.tsx,actions.ts}` for capability-scoped verified export/delete/correction case handling
- `lib/privacy/anonymize-candidate.ts` reviewed once more for any new leak vectors

## Rules to respect (from `99-rules-quickref.md`)

- §9 — never leak identity-bearing fields without an explicit reveal; consent is per-action, not implicit
- §17 — server-side credit deduction; locked preview when no access; identity hidden until reveal
- §10 — IDOR: never trust the anonymous candidate id as a primary key; map server-side
- §39 — every step audit-logged; consent versioned; abuse reports first-class
- §25 — friendly errors; no stack traces

## Verification

> **Verification status:** Implemented and verified against final code commit `fadf54e6b896350ef8488c7b2361a8f91666e638`; exact commands and limitations are recorded in [Phase-14-Evidence](./evidence/2026-07-22-phase-14.md).

- [x] Without Talent Radar access (Free Basic seeded employer), the page shows locked preview only — **no** data-layer call to the candidate list
- [x] With Pro plan the list returns anonymous cards; payload contains no `firstName`/`lastName`/`email`/`phone`/`cvFileName` *(10 cards; payload scan clean; select omits identity columns)*
- [x] `RADAR_PRIVACY_POLICY_V1` golden tests prove normalization/hash equivalence, final cohort `0/9 → INSUFFICIENT_COHORT`, `10/24/25/50/100` bucket boundaries, stable same-day max-20 sample/two-page cursor, cursor expiry/tamper, 10-per-minute and 30-distinct-hashes-per-day limits, and no extra filter/sort/total endpoint
- [x] Opaque-id tests prove 128-bit random Company-scoped values, cross-company non-correlation, current epoch lookup, no-overlap rotation, immediate invalidation on opt-out/reopen/suspension, fresh id after re-opt-in and indistinguishable expired/revoked/replayed/cross-company failure
- [x] Sending a contact request decrements credit atomically — concurrent attempts cannot go negative *(two simultaneous requests on 1 credit → exactly one ok, `used=1/1`)*
- [x] Without credits, employer receives the upgrade modal pointing to `contact-pack-10`
- [x] After separate explicit Reveal, exactly one request-scoped `IdentityRevealGrant` and `AuditLog (IDENTITY_REVEALED)` exist; Accept alone still returns no identity. A second confirmation appends only new field rows plus immutable confirmation evidence and cannot create another grant.
- [x] Without reveal, the employer view shows only the anonymous label
- [x] Privacy dashboard lists this contact request for the candidate
- [x] Candidate pending request detail works before any Conversation; Accept creates one Conversation but zero RevealGrants, Decline creates neither; employer request detail remains anonymous until the separately scoped Reveal
- [x] Candidate opt-out/onboarding reopen/User suspension and Company suspension/verification revoke immediately invalidate listing ids and block the defined discovery/contact/accept/reveal paths; effective pending requests become read-only `CANCELLED` (report remains, Decline absent), no automatic refund occurs, and reactivation does not auto-publish Radar *(`talent-radar-candidate-eligibility-loss-postgres.test.ts`; `talent-radar-eligibility-admin-triggers-postgres.test.ts`; all eight trigger paths plus the `expiresAt` boundary)*
- [x] 14-day exact expiry, one pending duplicate, 30-day recontact cooldown, employer-only pending cancel and no automatic refund are DB/clock tested; an Admin reversal references the exact consumption and cannot double-credit
- [x] Reveal DTO/snapshot tests cover every `RevealField` and combination, stale preview rejection, add-field confirmation, one-grant uniqueness, unchecked/duplicate/unknown/free-string/revoked grants, AES-GCM round-trip/AAD-tamper/key-version failures, exact mapping and absence of address/CV bytes/private notes. Editing live name/email/phone/CV after Reveal leaves the employer DTO byte-for-byte unchanged; a newly added field snapshots only its then-current value. Explicit Candidate revocation is idempotent, blocks the very next read, cannot be reversed by Employer/Admin and leaves anonymous thread/history plus truthful "already seen" copy.
- [x] Privacy-case integration tests cover bounded EXPORT/DELETE/CORRECT intake, duplicate/rate/ownership controls, every actor × status transition and terminal/stale-version rejection, challenge expiry, capability denial, 7-day Mock manifest metadata, deletion with zero erased rows/User-status changes, correction only through referenced domain commands, notification/audit redaction and cross-user/admin-safe reads
- [x] `lib/privacy/anonymize-candidate` strips every forbidden field *(`tests/privacy.test.ts`; Phase 17 will fold into the full suite)*

## Common pitfalls

- Returning the full Prisma model and "filtering on the client" — leaks the moment something is logged. Always anonymize at the server boundary.
- Using the Candidate PK or stable human handle as the anonymous id — use an opaque server mapping with explicit rotation/TTL policy and no client correlation path.
- Allowing reveal triggered by an employer-side button — reveal is candidate-initiated only.
- Counting reveals as application identity (a candidate may reveal but not apply). Identity visibility is granted per-thread and per-application context — never globally.
- Forgetting to append canonical `CandidateConsent` when the candidate toggles Talent Radar visibility off (off-toggle is also a versioned consent event).
- Treating opt-out/suspension as only a UI flag — mapping invalidation, pending cancellation, read guards, notifications and audit must commit together according to the eligibility-loss policy.
- Reading credits from the client — always server-side.

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Create a privacy-preserving passive-talent channel where candidates retain control and employers pay only through a traceable contact workflow. |
| Roles / requirements | Candidate, entitled Owner/Admin/Recruiter as explicitly allowed, Privacy/Admin; REQ-TR-001–006, CAN-006, BIL-006, SEC-001–003. |
| Prerequisites | 09, 10, 12; ADR-006/019/022/023/026; threat-model gate completed. |
| Routes/actions | Candidate Radar/Privacy/contact/message detail; Employer Radar/request detail; Admin privacy/report oversight. Opt in/out/pause; safe search; contact; accept/decline/expire; explicit Reveal; privacy case. |
| Data | Canonical Consent/notice version, RadarProfile, opaque mapping, ContactRequest/Event with expiry/funding/idempotency, one request-scoped RevealGrant with append-only encrypted typed value snapshots/confirmation events, Ledger, Privacy/Abuse. |
| Validation | Frozen `RADAR_PRIVACY_POLICY_V1`; ACTIVE User + COMPLETE Candidate + current consent/profile; ACTIVE+VERIFIED Company; 14-day request expiry, pending duplicate, 30-day recontact/no-auto-refund; exact typed Reveal recipient/fields/notice; bounded typed Privacy intake/state matrix. |
| Authorization/privacy | Locked returns before Candidate query; allowlist Safe DTO; no name/email/phone/address/CV/private note/PK pre-reveal; company/request/thread scope; Candidate alone reveals. |
| Audit/notification/analytics | Every consent/contact/state/reveal/revocation/privacy/admin action; minimal events, no text/PII; contact funding source stored. |
| UX/mobile | Default off, anonymous preview, incomplete/paused/locked/no match/no credit/rate/pending/declined/expired/accepted; reveal warning notes data cannot be “unseen”; accessible Cards/Timeline. |
| Seed | Canary PII, rare cohorts, two companies, 0/1 Credits, every request state and one scoped Reveal. |
| Tests | Locked/status/verification repository spy, JSON/HTML/log Canary scan, cohort/enumeration/rate and opaque rotation/replay, separate funding-source/expiry order, parallel balance=1, request/loss lifecycle/refund/recontact, decline no PII, one-grant/add-fields/revoke/cross-company/thread Reveal IDOR, Consent/onboarding version, exact export/delete/correction case matrix, E2E-04. |
| Verification | Network payload inspection before/after Reveal plus Postgres concurrency and privacy suite. Expected forbidden fields absent until exactly scoped grant. |
| Risks / limitations | Frozen P0 cohort/retention/legal-basis/rate values still require Privacy/Legal approval; no-auto-refund/30-day recontact are explicit hypotheses. Export/delete are documented assessment/manifest mocks before legal implementation. |
| Definition of Done | Contact and Reveal work end-to-end with exact ledger/audit and no pre-reveal identity path, including logs/HTML/errors. |

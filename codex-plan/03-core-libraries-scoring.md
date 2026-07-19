# Phase 03 — Core Libraries & Scoring

> **PortalGERM target status: IMPLEMENTED AND VERIFIED.** Phase 03 is frozen in code commit `5664ae8e65eb3d36b66e09404468ac5d433aae1b` and independently reproduced in a clean worktree; the verification record is [`evidence/2026-07-19-phase-03.md`](./evidence/2026-07-19-phase-03.md).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 03. Read [99-rules-quickref.md](./99-rules-quickref.md) §11, §12, §39 before starting.

## Goal

Build the `lib/` foundation: pure utility helpers, Zod schemas, security/permission helpers, **deterministic** scoring functions, search helpers, billing/feature-gating helpers, audit, privacy, and analytics helpers. These modules are imported by every later phase.

## Prerequisites

- [x] Phase 01 done
- [x] Phase 02 done — Prisma client typed against the full schema

## Deliverables (checklist)

### `/lib/db`
- [x] `lib/db/prisma.ts` — singleton Prisma client (with the standard Next.js dev hot-reload guard)

### `/lib/utils`
- [x] `lib/utils/cn.ts` — `clsx` + `tailwind-merge` helper
- [x] `lib/utils/slug.ts` — Umlaut-safe slugify (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, lowercase, `-` separator) + de-duplication helper
- [x] `lib/utils/format.ts` — CHF formatter (`new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' })`), workload `min%–max%` formatter, salary range formatter, date formatter (`de-CH`)
- [x] `lib/utils/random.ts` — deterministic seedable random for seed script
- [x] `lib/utils/hash.ts` — `hashIp(ip: string, key: { version: string; secret: string }): string` normalizes IPv4/IPv6 and returns `version:hmacSha256Hex`. The writer uses the first active version from the dedicated `AUDIT_IP_HASH_KEYS` keyring, never plain/unsalted SHA-256: the small IP address space is dictionary-guessable. Rotation is versioned (monthly target); raw IP never persists, and event-level IP hashes are deleted/nullified after 30 days while longer-lived aggregates contain no IP hash.

### `/lib/validation`
- [x] `lib/validation/auth.ts` — register/login/forgot-password Zod schemas; password rule (≥10 chars, mixed case, digit, symbol)
- [x] `lib/validation/candidate.ts` — SwissJobPass schema, application schema
- [x] `lib/validation/employer.ts` — company profile, job posting wizard (one schema per step + a final unified schema)
- [x] `lib/validation/billing.ts` — checkout schemas, lead form schema
- [x] `lib/validation/admin.ts` — plan/product/category schemas, abuse status update
- [x] All exports `z.infer`-able TS types alongside the schemas

### `/lib/auth`
- [x] `lib/auth/password.ts` — `hashPassword`, `verifyPassword` through a swappable interface; pin/benchmark the bcryptjs cost for the implementation environment and keep timing/rate-limit tests
- [x] `lib/auth/session.ts` — create/read/rotate/destroy an opaque cookie (`httpOnly`, Secure in production, SameSite=Lax); store only token hash, enforce idle plus absolute expiry and revoke on security changes
- [x] `lib/auth/current-user.ts` — `getCurrentUser()` reading cookie → DB; returns `null` for anonymous
- [x] `lib/auth/rate-limit.ts` — typed `RATE_LIMIT_PRESETS_V1`; key namespaces and identifiers are server-derived, never client supplied. Anonymous/Auth recovery uses normalized source IP only from the configured trusted-proxy hop (`LOGIN`: IP+normalized-email-HMAC 10/15 min plus IP 30/hour; `REGISTER`: IP 10/hour; `FORGOT_PASSWORD`: IP+normalized-email-HMAC 5/hour). Authenticated mutations use User id plus an IP abuse guard (`APPLICATION_SUBMIT`: User 30/hour + IP 100/hour; `PRIVACY_REQUEST`: User 5/rolling 30 days + same type at most one open; `PRIVACY_IDENTITY_CHALLENGE`: User 5/15 min + IP 20/hour; `LEAD`: IP 10/hour). Abuse intake uses actor-or-IP 10/day + IP 20/day + same target 3/day. Company actions also use `(companyId,userId)` (`CONTACT_REQUEST`: Company 20/hour + User 30/hour + target Candidate 3/30 days; `RADAR_LIST`: active Membership 10/rolling minute, while the persistent Budget separately enforces Company 30 distinct filter hashes/Zurich day). Spoofed `X-Forwarded-For` is ignored/rejected outside the explicit trusted proxy topology. Production uses the shared PostgreSQL atomic store; in-memory is local/test only. Every preset defines window, limit, 429/retry-after and redacted `RATE_LIMITED` Audit schema; boundary/concurrency/restart/trusted-proxy tests are required.

### `/lib/security`
- [x] `lib/security/require-role.ts` — `requireRole(role: Role | Role[])` (server) → throws/redirects when missing
- [x] `lib/security/company-access.ts` — `requireCompanyAccess(companyId, allowedRoles?)` establishes an active Company context/capability. It never authorizes a nested object by itself; resource-specific repositories include Company/Candidate/Participant/Assignment scope in the first DB query and return safe 404.
- [x] Resource-specific authorized repositories such as `getAuthorizedJob`, `getAuthorizedApplication`, `getAuthorizedInvoice` and `getAuthorizedRadarRequest`; never accept a generic entity object or trust a prior UI lookup as the ownership boundary
- [x] `lib/security/sanitize.ts` — `stripUnsafeHtml` returning plain text (DOMPurify or simple allow-list rejecter)
- [x] `lib/security/csrf.ts` — origin-check helper if not using framework-default protection

### `/lib/scoring` *(deterministic pure functions — must be 100 % unit-testable)*
- [x] `lib/scoring/fair-job-score.ts`
  ```ts
  type FairJobInput = {
    salaryRange: { minChf: number; maxChf: number; period: SalaryPeriod } | null;
    tasksAndRequirementsClarity: 'MISSING' | 'PARTIAL' | 'CLEAR';
    workloadContractAndStartDefined: boolean;
    locationAndRemoteDefined: boolean;
    applicationProcessDefined: boolean;
    responseTargetDays: number | null;
    concreteBenefitsCount: number;
    inclusionAndContactDefined: boolean;
    validThrough: Date | null;
  };
  type FairJobResult = {
    score: number; // 0–100
    version: 'v2';
    evidence: Record<string, boolean | number | string>;
    positiveReasons: string[];
    missingImprovements: string[];
    employerSuggestions: string[];
  };
  export function calculateFairJobScoreV2(input: FairJobInput, clock: { now: Date }): FairJobResult;
  ```
  `buildFairJobInputV2({ revision, job })` is the only production builder; Server Actions never submit the Booleans directly. Its frozen evidence predicates are:
  - normalize each structured text item with trim plus collapsed whitespace; an item is valid only at `20..500` Unicode code points. Tasks are `CLEAR` with at least three valid task **and** three valid requirement items, `PARTIAL` with at least one valid item in each list, otherwise `MISSING`;
  - workload/contract/start is true only with integer `0 <= workloadMin <= workloadMax <= 100`, a valid `JobType`, and exactly one of a valid `startDate` or `startByArrangement=true`;
  - location/remote is true only with a valid `RemoteType` and either `(cantonId, cityId)` for `ONSITE|HYBRID` or `remoteCountryCode='CH'` for `REMOTE`;
  - application process is true only with a valid `ApplicationEffort`, at least one valid ordered process step and an explicitly selected non-empty P0 `RequiredDocumentKind[]` containing only `NONE|CV|COVER_LETTER`; `NONE` cannot coexist with another value. CERTIFICATES/REFERENCES/PORTFOLIO/OTHER fail P0 submit/publication until the versioned storage gate;
  - concrete benefits are the count of unique allowlisted `JobRevisionBenefit.benefitCode` rows whose description is valid by the same `20..500` rule; free prose does not count;
  - inclusion/contact is true only when a normalized inclusion statement is `30..500` code points and the public application contact matches its declared `EMAIL|PHONE|APPLY_URL` validator; response and salary use the fields below, and freshness maps only from the Revision's proposed `validThrough`. On publication this value is copied transactionally into the indexed `Job.expiresAt` projection.

  The builder, its normalization, enum validation and every boundary above have golden fixtures. A Revision input snapshot is stored with the ScoreSnapshot so a score can be reproduced after later edits.

  **Frozen P0/v2 baseline (no interpretation permitted):** validate integer positive salary values and `minChf <= maxChf`; otherwise that factor is missing. Award salary `25`; tasks `MISSING=0`, `PARTIAL=8`, `CLEAR=15`; workload/contract/start Boolean `15`; location/remote Boolean `10`; application-process Boolean `10`; response target `10` only for an integer `1..30` days; benefits `5` only at `concreteBenefitsCount >= 2`; inclusion/contact Boolean `5`; freshness `5` only when `clock.now < validThrough <= clock.now + 120 days`. Missing/invalid evidence scores zero; total is the direct integer sum `0..100` with no normalization or hidden rounding. Evidence keys and reason codes are the factor names plus `MISSING|PARTIAL|MET`; their ordering is fixed. `clock.now` is mandatory and injected in every call/test. Commercial/Product may propose a later score version only through a new ADR/version/fixtures; it cannot silently alter v2. **Company verification, paid boost, Plan and Product are not inputs.**

- [x] `lib/scoring/match-score.ts`
  ```ts
  type MatchInput = {
    candidate: { skills?: string[]; acceptableCantonIds?: string[]; workloadMin?: number; workloadMax?: number;
                  desiredSalaryMin?: number; desiredSalaryMax?: number; desiredSalaryPeriod?: SalaryPeriod;
                  remotePreference?: RemotePreference; languages?: { code: string; level: LanguageLevel }[];
                  jobTypes?: JobType[]; availabilityDate?: Date };
    job: { requiredSkills?: string[]; cantonId?: string; workloadMin?: number; workloadMax?: number;
           salaryMin?: number; salaryMax?: number; salaryPeriod?: SalaryPeriod; remoteType?: RemoteType;
           requiredLanguages?: { code: string; minLevel: LanguageLevel }[];
           jobType?: JobType; startDate?: Date };
  };
  type MatchResult = { score: number | null; confidence: number; version: 'v1'; factorScores: Record<string, number | null>; matchReasons: string[]; missingFitReasons: string[] };
  export function calculateCandidateMatchV1(input: MatchInput): MatchResult;
  ```
  **Frozen P0/v1 baseline:** weights are Skills `30`, Languages `15`, Region/Mobility `15`, Workload `15`, Salary `10`, Job type `5`, Remote `5`, Availability `5`. Normalize string codes by trim/lowercase/de-duplicate. A factor is known only when all fields needed below are present and valid; otherwise its factor score is `null` and its weight is excluded from both numerator and denominator.
  - Skills = `|candidate ∩ required| / |unique required|`; an explicitly supplied empty candidate array is known zero, while no/empty Job requirements makes the factor unknown.
  - Languages = mean over unique required languages: candidate level at/above required = `1`, exactly one CEFR step below = `0.5`, otherwise/missing candidate language = `0`; CEFR order is `A1<A2<B1<B2<C1<C2<NATIVE`. Empty Job requirements makes the factor unknown.
  - Region/Mobility = `1` when `job.cantonId` is in the explicitly supplied `acceptableCantonIds`, else `0`; absent/empty acceptable list is unknown.
  - Workload = overlap length divided by Job interval length using inclusive integer percentage points: `max(0,min(max)-max(min)+1)/(jobMax-jobMin+1)`; ranges must satisfy `0<=min<=max<=100`.
  - Salary = known only when both valid whole-CHF intervals include the same explicit `SalaryPeriod`; differing/missing periods are unknown rather than guessed or converted. With the same period it is `1` when intervals overlap, `0.5` when their nearest gap is at most `10%` of `max(1, desiredSalaryMin)`, otherwise `0`.
  - Job type = `1` when Job type is in the explicitly supplied non-empty candidate list, else `0`; missing/empty list is unknown.
  - Remote compatibility: `ANY→1`; exact type `→1`; candidate `HYBRID` versus `ONSITE|REMOTE` or candidate `ONSITE|REMOTE` versus Job `HYBRID` `→0.5`; other mismatch `→0`.
  - Availability = `1` when candidate date is on/before Job start, `0.5` when 1–30 calendar days after it, otherwise `0`; either date missing is unknown.

  For these non-negative values, `roundHalfUp(x)` is exactly `Math.floor(x + 0.5)`. `confidence = roundHalfUp(knownWeight)` and `score = roundHalfUp(sum(weight*factorScore)/knownWeight*100)`. When `knownWeight=0`, return `{score:null, confidence:0}` and UI text „Noch nicht genügend Angaben“. Stable reason codes are `<FACTOR>_MATCH|PARTIAL|MISMATCH|MISSING`; display text is mapped separately. Golden fixtures cover all boundaries and a published fixture hash freezes formula/order. The input type excludes age, gender, origin, health, family, photo, name and related proxies. P0 is Candidate-facing and never triggers an Employer status decision. The pure function only receives plain values and never reads the DB.

- [x] `lib/scoring/__rules.md` — short doc inside `lib/` describing the exact formula (so future devs / tests stay consistent)

### `/lib/search`
- [x] `lib/jobs/public-eligibility.ts` — the sole `isJobPubliclyEligible(jobId, now, environment)` query/predicate used by public list/detail/similar/search, Job Alerts and Application submit: Job `PUBLISHED`; one current approved publication Revision; `publishedAt<=now<expiresAt` with non-null bounded expiry equal to Revision `validThrough`; Company `ACTIVE` with current `VERIFIED` cycle; no effective Job/Company public-hide restriction; and LIVE provenance in Production. It returns the public projection or the same safe ineligible result; drift/clock/revoke/suspend/imported-Demo tests call every consumer.
- [x] `lib/search/query.ts` — typed filter object & Prisma query builder (case-insensitive `contains`, see [decisions.md](./decisions.md) ADR-003); pagination; sort helper
- [x] `lib/search/relevance.ts` — deterministic relevance proxy (no tsvector in MVP): weighted keyword hits (title = 3, company name = 2, body = 1), summed per job. Used by `sort=relevance` and the ranking's relevance tier.
- [x] `lib/search/ranking.ts` — first exclude irrelevant/ineligible jobs, then apply a bounded and labelled sponsored zone inside the relevant set, followed by the selected organic sort and a stable `publishedAt`/`id` tie-breaker; compute the global order before pagination (ADR-003)
- [x] `lib/search/placement-config.ts` — immutable P0 `SPONSORED_PLACEMENT_CONFIG_V1 = { SEARCH_FIRST_PAGE: 3, HOMEPAGE: 2 }`. Search selects its first-page sponsored IDs from relevant, public-eligible, actively boosted Jobs by `(relevanceTier DESC,relevanceScore DESC,fairScore DESC NULLS LAST,publishedAt DESC,id ASC)`, independent of the requested organic sort. It then appends the selected organic sequence excluding those IDs; later pages never replenish. The signed cursor contains policy/config/query hash, `rankingAsOf`, the at-most-three selected sponsored IDs and the selected organic tuple. Subsequent pages recheck current public eligibility but continue excluding those IDs even if a Boost expires, preventing duplicate re-entry; tampering/version/query mismatch is invalid. Homepage has its own two-slot snapshot. Golden tests cover all organic sorts, page boundary, expiring Boost, new/removed Job, null score and cursor replay.
- [x] `lib/search/types.ts` — public types shared with the UI

### `/lib/billing`
- [x] `lib/billing/entitlements.ts` — `getEffectiveEntitlements(companyId, at)` implements Phase-02's exact typed precedence: default Free baseline → one effective Subscription PlanVersion replaces it → active allowlisted Grants raise/replace/add by stored semantics. It fails closed on unknown/mistyped/missing/ambiguous keys and returns typed plan rights separately from Credit-Ledger `fundableBySource` summaries; credits never imply Radar access.
- [x] `lib/billing/feature-gates.ts` — pure functions:
  - `canPublishJob({ effectiveEntitlements, currentActiveCount, jobId, revisionValidThrough, additionalJobPermit? })`; ordinary Plan limit applies globally, while a current P1 `AdditionalJobPermit` may authorize only its exact target without entering effective Entitlements
  - `canUseTalentRadar(effectiveEntitlements)`
  - `canRequestContact(effectiveEntitlements, fundableGrantSummary)`; the later mutation rechecks/consumes the chosen Ledger funding source atomically and never trusts a client counter
  - `canRunLicensedSupplyImport(platformCapabilities, sourceRights)` — P0 Admin/Supply-Ops parse/preview/commit-to-Draft gate; independent of employer plan and requires documented source/provenance
  - `canUseEmployerImport({ effectiveEntitlements, currentPlanSlug, companyId, sourceId, accessGrant? })` — deny-by-default in P0; P1 requires eligible Business/private-contract Plan and one current matching `ImportAccessGrant`. Neither a stale Company Boolean nor global EntitlementGrant can substitute.
  - `canUseAdvancedAnalytics(effectiveEntitlements)`
  - Return `{ allowed: boolean; reason?: string; suggestedProductSlug?: string; suggestedPlanSlug?: string }`.
- [x] `lib/billing/usage.ts` — read-only helpers to compute current usage (active jobs count, credits remaining, used contacts this month)
  - `isQuotaConsumingJob(job, now)` is exactly `status = PUBLISHED && publishedAt <= now && now < expiresAt`; publication requires non-null bounded expiry. PAUSED/EXPIRED/CLOSED/REMOVED/Draft/Approved do not count. It uses Job identity/time only; Company ACTIVE+VERIFIED/moderation is a separate mandatory publish/public predicate.
  - `publishWithQuota`/reactivation locks the Company quota key (Company row/advisory lock) in PostgreSQL, recounts the canonical predicate for that Company at one injected `now`, checks effective Entitlements, then writes status/event/audit in one transaction. Parallel pending approvals never reserve or bypass quota.
- [x] `lib/billing/vat.ts` — `computeVat(netRappen: number, rateBasisPoints: number)` returns integer-Rappen net/VAT/total using explicit integer rounding. `810` represents 8.1 %; validate the versioned TaxRate snapshot and never use floating-point money/rates in Billing arithmetic.
- [x] `lib/billing/invoice-number.ts` — transaction/lock-backed sequential invoice number allocation exactly `STH-{YYYY}-{00001}` (five-digit minimum, continuing beyond it), with PostgreSQL concurrency tests in Phase 12

### `/lib/audit`
- [x] `lib/audit/log.ts` — critical domain mutations use `writeRequiredAudit(tx, ...)` in the same transaction or guaranteed outbox and fail safely if evidence cannot be recorded. Non-critical telemetry may be best-effort but is a distinct API; metadata is schema-allowlisted/redacted.
- [x] List of canonical `action` strings used across the app (in a TS const) — e.g. `JOB_APPROVED`, `JOB_REJECTED`, `COMPANY_VERIFIED`, `CONTACT_REQUEST_SENT`, `IDENTITY_REVEALED`, `INVOICE_PAID`, `CREDITS_GRANTED`, `USER_SUSPENDED`; Phase 16's exhaustive table uses the same values

### `/lib/notifications`
- [x] `NOTIFICATION_PAYLOADS_V1` is an exhaustive Zod record keyed by every `NotificationKind`; unknown/missing properties fail. All kinds use their recipient-scoped route id plus closed status/reason code only—never message/note/correction/manifest/PII text. In particular: `CONTACT_REQUEST_CANCELLED={requestId,status:'CANCELLED',reasonCode}`, `IDENTITY_REVEAL_REVOKED={contactRequestId,grantId,status:'REVOKED'}`, `SUPPORT_CASE_CHANGED={caseId,status,reasonCode?}`, and `PRIVACY_REQUEST_CHANGED={requestId,type,status,reasonCode?}`. The remaining kinds have equally literal schemas in the same const. Unique `(recipientUserId,kind,dedupeKey)` and transactional/outbox writers make retry exactly once; link builders re-authorize the target rather than trusting payload ownership. Snapshot/PII-canary tests cover every kind.

### `/lib/privacy`
- [x] `lib/privacy/anonymize-candidate.ts` — returns only a rotatable opaque id, coarse derived `displayLabel`, bucketed canton/skills/workload/salary/languages/remote/availability fields permitted by the current consent and cohort policy. It never returns real name, contact data, exact city/address, CV metadata or a stable handle (ADR-006).
- [x] `lib/privacy/radar-consent.ts` records/checks only `RadarConsentKind.TALENT_RADAR_VISIBILITY`; `lib/privacy/user-consent.ts` records/checks all and only `UserConsentKind` (`TERMS`, `MARKETING`, `DATA_USE`, `JOB_ALERT_DELIVERY`). Separate types/APIs make cross-domain consent impossible; each purpose has an explicit current notice version.
- [x] `lib/privacy/reveal-dto.ts` validates candidate-initiated confirmation against the closed `RevealField` enum, reduces CV metadata to its safe subset, encrypts the exact displayed values with AES-256-GCM under the active version of the dedicated `PII_REVEAL_KEYS` keyring, and later decrypts only those immutable snapshots after rechecking accepted request, matching Company/Candidate and `revokedAt IS NULL`. Current profile fields are never silently substituted; no JSON/free-string selector, Audit value or log value exists.
- [x] `lib/privacy/requests.ts` — authenticated/rate-limited create/status helpers for typed Export/Delete/Correction `PrivacyRequest`; Admin processing is a case workflow and never silently marks User deleted without retention/dependency policy
- [x] `lib/privacy/export-mock.ts` — `buildExportManifestForCase(tx, privacyRequestId)` runs only for a verified, authorized `PrivacyRequest{EXPORT}` workflow, selects the requester's own allowlisted data (no employer-private notes), records a local non-provider manifest/outcome and expiry, and never exposes an immediate untracked dump from the request button

### `/lib/analytics`
- [x] `lib/analytics/event-contracts.ts` — Zod discriminated union over the closed Phase-02 `AnalyticsEventKind`; `schemaVersion='1'`. Actor/company/job references use dedicated columns, never `properties`. Allowed properties are fixed by family: Discovery (`surface`, `locale`, `cantonCode?`, `categorySlug?`, `resultCountBucket?`, `sort?`, `intent?`); onboarding (`onboardingRuleVersion`, `completionPercentBucket?`); workflow (`fromStatus?`, `toStatus?`, `applicationEffort?`, `alertFrequency?`, `fundingSource?`); commercial (`planSlug?`, `productSlug?`, `amountRappen?`, `placement?`, `leadPurpose?`). Values are enums/bounded IDs/count buckets—no keyword, full URL/referrer, email, name, message, CV, salary input or free text. Each event kind has an allowlisted subset, owner, purpose, retention and metric mappings in the same const; an unknown key/value rejects the event.
  - P0 `PRODUCT_ANALYTICS` kinds are exactly `PUBLIC_VALUE_VIEWED`, `SEARCH_SUBMITTED`, `SEARCH_RESULTS_VIEWED`, `JOB_DETAIL_VIEWED`, `JOB_SAVED`, `APPLY_INTENT_STARTED`, `PRICING_VIEWED`. Their respective property subsets are `{surface,locale,cantonCode?,categorySlug?}`, `{surface,locale,cantonCode?,categorySlug?,sort?,intent?}`, the same plus `resultCountBucket`, `{surface,locale,placement?}`, `{surface,intent?}`, `{surface,intent?}`, and `{surface,planSlug?}`.
  - Every other closed kind is `ESSENTIAL_OPERATIONAL`, projected only after its owning domain event. Candidate onboarding kinds allow `{onboardingRuleVersion,completionPercentBucket?}`; Alert additionally `{alertFrequency}`. Application/Job/Moderation workflow kinds allow only `{fromStatus?,toStatus?,applicationEffort?}`. Contact/Reveal kinds allow `{fundingSource?}`. Checkout/Subscription kinds allow `{planSlug?,productSlug?,amountRappen?}`; `LIMIT_REACHED` allows `{planSlug?,productSlug?}`; Lead kinds `{leadPurpose?}`; Boost `{productSlug?,fundingSource?,placement?}`; registration/company-verification events have no properties beyond dedicated reference columns plus the onboarding subset where applicable. This mapping is a literal exhaustive TS record, so adding an enum value fails compilation until owner/purpose/properties/retention/metric mappings exist.
  - Raw Product Analytics retention is a versioned P0 hypothesis of 90 days; raw essential analytics projections retain 400 days; `MetricDaily` retains 25 months and contains no actor/session/IP hash. `retainUntil` is written at ingest, expiry is an idempotent command, and a production launch requires Privacy/Legal approval or a documented shorter policy. Domain records follow their own legal retention and are never deleted merely because an analytics projection expires.
- [x] `lib/analytics/track.ts` — internal-only typed writer. Every call supplies `producerEventId`; DB unique `(producer, dedupeKey)` makes retries idempotent. Public views/search/pricing and optional product-usage telemetry use `PRODUCT_ANALYTICS` with the current privacy setting; registration, application, moderation, contact, billing and lead outcomes use minimized `ESSENTIAL_OPERATIONAL` projections derived after the domain transaction/outbox. HMAC IP hash is optional and 30-day bounded; no third-party calls, tracking pixels or raw request payload.
- [x] `lib/analytics/funnel-definitions.ts` — versioned reproducible formulas: `candidateActivation7d = distinct candidateId with CANDIDATE_PROFILE_COMPLETED within 7d of CANDIDATE_REGISTERED / registered cohort`; `employerActivation14d = distinct companyId with JOB_PUBLISHED within 14d of COMPANY_ONBOARDING_COMPLETED / onboarded cohort`; Search→Detail→Apply uses same pseudonymous session and `SEARCH_RESULTS_VIEWED → JOB_DETAIL_VIEWED → APPLY_INTENT_STARTED → APPLICATION_SUBMITTED` within 7d; Lead→Qualified→Won uses first ordered essential event per lead; Checkout conversion uses `CHECKOUT_COMPLETED/CHECKOUT_STARTED` per company/order cohort. All actors inherit immutable User/Company provenance snapshots and DEMO/TEST are excluded. Denominators, half-open windows, timezone (`Europe/Zurich` for daily business metrics) and late-event cutoff are fixture-tested.
- [x] `lib/analytics/metric-definitions-v1.ts` freezes `METRIC_DEFINITIONS_V1` and `COCKPIT_SIGNAL_POLICY_V1` as exhaustive typed records:
  - `EMPLOYER_RESPONSE_RECORDED` for an Application is projected exactly once from the earliest committed candidate-visible human response: either (a) the first non-empty Message by an active authorized Company Owner/Admin or assigned `EDITOR|PIPELINE` Recruiter in that Application Conversation, or (b) the first authorized Application transition to `SHORTLISTED|INTERVIEW|OFFER|HIRED|REJECTED`. `SUBMITTED→IN_REVIEW`, EmployerNote, draft/AI text, System/Admin action and notification delivery do **not** qualify. `occurredAt` is the source Message/Event database timestamp; dedupe key is `EMPLOYER_RESPONSE:<applicationId>`, actor/company/Job/Revision snapshots come from the source/Application submission, and the essential projection is emitted only after the domain transaction. Radar response is separately the first authorized Company Message after Accept with dedupe `RADAR_RESPONSE:<contactRequestId>`. Golden tests cover simultaneous message/status, unauthorized/system actors and retry.
  - North Star key is exactly `APPLICATION:<applicationId>` or `RADAR:<contactRequestId>` and may count once ever. Application qualifies at the first employer `EMPLOYER_RESPONSE_RECORDED` after submit and no later than `submittedAt + ApplicationSubmissionSnapshot.responseTargetDays`; missing/invalid target does not qualify. Radar qualifies at the first employer Message after Accept and within 48 hours. Attribute Application to its submitted Revision's canton/category snapshot and Radar to the ContactRequest's canton/category snapshot; attribute month by first qualifying response in `Europe/Zurich`. Company/Job/User provenance must be LIVE and actors active, and the pair must have an active assessment at that instant. Retry/extra messages/status events do not add another conversation.
  - Cockpit windows are rolling half-open 30 days unless stated. `NEAR_JOB_LIMIT`: usage ≥80% plus ≥3 submitted Applications. `FREE_UPGRADE_CANDIDATE`: ACTIVE+VERIFIED Free Company, first publish ≥14 days ago, ≥5 Applications, no open qualified Lead and no same-reason dismissal in 30 days. `SLOW_RESPONSE`: ≥10 due Applications and on-time response <7000 bps. `RADAR_PACK_CANDIDATE`: ≥80% included contacts consumed and ≥5 accepted requests in current period. `SUPPLY_GAP`: ≥200 Search-results sessions for the pair and either <50 eligible LIVE Jobs or query coverage <8000 bps. One entity/reason/window task is idempotent; dismiss suppresses the same signal for 30 days.
  - `JOB_CONTENT_DIAGNOSTIC`: ≥100 non-sponsored detail-view sessions, apply-intent/detail <200 bps, published ≥14 days, and either Fair v2 <70, missing salary/process evidence or a broken/`LONG` apply path. `BOOST_TEST_CANDIDATE` is allowed only when those content blockers are all absent, the same ≥100 organic sample exists, no active Boost, and conversion is below `max(200 bps, floor(clusterBaselineBps/2))`; baseline is the 90-day median among ≥20 LIVE jobs in the same pair, each with ≥100 organic views. Missing sample/baseline creates no Boost card. Follow-up is 14 days after action. All thresholds are Product hypotheses, versioned and golden-tested; P0 operational queues do not depend on optional Product Analytics.
  - `ANALYTICS_SUPPRESSION_V1`: any dashboard/funnel breakdown needs at least 20 distinct denominator subjects in its requested cell and each emitted segment; otherwise value, numerator and denominator are all returned as `SUPPRESSED` (never zero). An actual zero numerator may display `0` only when denominator ≥20. Suppressed child cells may roll up only to the next predeclared parent dimension, which must independently have ≥20 distinct subjects; cells are never combined ad hoc and complements are suppressed when subtraction could expose a child. Revenue/accounting totals on authorized Company billing pages are not analytics cohorts. Golden fixtures cover 19/20, zero/20, overlapping subjects, parent roll-up and differencing attempts.
- [x] `lib/analytics/response-policy-v1.ts` freezes `EMPLOYER_RESPONSE_POLICY_V1`: rolling `[now-90d,now)`, the canonical first `EMPLOYER_RESPONSE_RECORDED` above per Application, only due Applications with valid immutable `ApplicationSubmissionSnapshot.responseTargetDays`, minimum 20 due cases. `<20` is `UNKNOWN` and sorts after known. Badge/filter `RELIABLE` requires on-time rate ≥8000 bps; launch/cockpit risk uses its separately stated 7000-bps threshold. Response sort is `known DESC, onTimeRateBps DESC, medianFirstResponseMinutes ASC, publishedAt DESC, id ASC`; ordinary median is stored as integer minutes (even sample average half-up). Copy says measured history, never guarantee.
- [x] `lib/salary/policy-v1.ts` freezes `SALARY_RADAR_POLICY_V1`: select exactly one APPROVED `SalaryDatasetVersion` whose half-open validity contains injected `at`, else fail closed. Dataset provides precomputed whole-CHF YEARLY/FTE p25/median/p75 bands with `sampleSize` for these fallback scopes in order: exact Category+Canton+Seniority; Category+Canton+all seniorities; Category+Switzerland+Seniority; Category+Switzerland+all. Choose the first with `sampleSize >=30`; never combine raw quantiles or cross Category. Output names scope/version/as-of/method, sample bucket `30–49|50–99|100+`, FTE band and workload-adjusted band using integer half-up per bound; no qualifying band yields an honest no-result plus adjacent-category guidance, not a fabricated range. Golden tests cover 29/30, each fallback, ambiguous dataset, workload bounds and no result.
- [x] `lib/analytics/employer-metrics.ts` — privacy-safe aggregations from approved view/application/save/conversation events over a window; no message content and entitlement level enforced
- [x] `lib/analytics/metric-contracts.ts` — shared event/metric types and non-revenue aggregation primitives. Phase 11 owns operational recommendations; Phase 12 alone defines and implements subscription, invoice and revenue queries (ADR-019).

## Files to create / modify

- All under `lib/` per the breakdown above
- One short `lib/scoring/__rules.md` documenting Fair-Job-Score & match-score formulas

## Rules to respect (from `99-rules-quickref.md`)

- §11 Fair-Job-Score — paid boosts/plans **must not** affect the score
- §12 Match Score — base from deterministic logic, mock AI may explain only
- §15 Feature Gating — gates are pure functions invoked from server actions; never client-only
- §10 Security — never log password hashes, tokens, or full CV bodies from these helpers
- §22 Mock Analytics — no external trackers, no pixels, hash IPs
- §39 Critical Thinking — every helper considers privacy + audit impact

## Verification

- [x] `npm run typecheck` clean
- [x] Executable unit tests in this phase for exact Fair/Match values, evidence/reasons, injected-time/freshness, missing-data denominator/confidence, rounding and paid/protected-input exclusion. Phase 17 adds only product-wide regression/E2E.
- [x] `slugify('Zürich')` → `'zuerich'`; `slugify('Genève')` → `'geneve'`
- [x] `computeVat(10000, 810)` returns `{ net: 10000, vatAmount: 810, total: 10810 }` (integer Rappen/basis points)
- [x] No file in `lib/` imports a React client component

> **Verification, 19 July 2026:** clean detached reproduction of code commit `5664ae8e65eb3d36b66e09404468ac5d433aae1b`; 629/629 unit tests, 60/60 PostgreSQL integration tests, lint, typecheck, production build and HTTP E2E passed. The independent final audit found no remaining Phase-03 P0/P1 blocker. See the linked evidence record for commands, concurrency cases and scope boundaries.

## Common pitfalls

- Letting `calculateFairJobScoreV2` accept boost / plan info "for convenience" — this **breaks fairness**. Keep inputs clean.
- VAT rounding errors when storing CHF as floats — use integer cents (rappen) consistently
- Forgetting `toAnonymousCandidate` excludes city name; only canton may be exposed
- Joining `Credential.passwordHash` into `getCurrentUser()` or a general repository — only the narrow Auth repository may select it
- Rate-limit storing memory only and being treated as production-grade — note this as a known limitation

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Central, tested policies prevent each portal from inventing its own permission, score, money and status semantics. |
| Roles / requirements | All roles; REQ-IAM-002, SCORE-001/002, BIL-001/004/006, TR-003/004/006, SEC-001/003, DATA-001. |
| Prerequisites | 01–02; installed Next/Prisma docs; ADR-017–023. |
| Deliverables | Resource-specific authorized queries; policy/capability result types; status machines; Safe DTO builders; Fair v2/Match v1; Rappen/VAT; entitlement interface; audit/notification/analytics schemas; deterministic clock/IDs. |
| Data/server | Use Phase-02 models through repositories/use cases; no React/client import and no provider-specific import. |
| Validation | Shared Zod schemas and de-CH error mapping; status/entitlement inputs server derived; bounded search/filter types. |
| Authorization | Session → capability → company membership → assignment/ownership → entitlement → transition. Foreign/missing tenant object = safe 404. |
| Audit/privacy | Critical audit is transaction/outbox guaranteed; metadata redacted. Safe Radar/Application DTOs are allowlists with Canary tests. |
| UX/mobile | Discriminated results drive validation, conflict, limit, rate, not-found and success states consistently; no UI is built here. |
| Seed | Golden score/money/status and Tenant A/B fixtures. |
| Tests | Exact score values and factor reasons; no paid Fair inputs; protected Match fields absent; policy matrix; transitions; VAT boundaries; safe DTO snapshots; rate-limit semantics. Unit tests are real, not stubs. |
| Verification | `npm test -- scoring policies domains`; Postgres ownership integration; `npm run typecheck`. Expected exact assertions and zero client imports. |
| Risks / limitations | Production requires the shared atomic rate store; memory is local/test only. Match employer use is deferred. Fair v2/Match v1 are explicit P0 product hypotheses: Product/Legal/Fairness sign off the frozen fixture hash before implementation, and any later change creates a new version rather than editing these baselines. |
| Definition of Done | Every exported rule has tests and one owner; portals can call use cases without duplicating business logic; no generic post-load ownership filter. |

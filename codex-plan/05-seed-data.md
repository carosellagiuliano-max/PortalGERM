# Phase 05 — Seed Data

> **PortalGERM target status: NOT IMPLEMENTED.** Counts below are coverage targets/hypotheses, not market activity. Seed must be deterministic, idempotent, environment-bound and production-blocked (ADR-027).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 05. Read [99-rules-quickref.md](./99-rules-quickref.md) §19, §22 before starting.

## Goal

Populate the database with realistic, Swiss-specific data so every dashboard, list, and chart looks useful from the first visit. Run via `npx prisma db seed`. Idempotent: running twice must not duplicate.

## Prerequisites

- [ ] Phase 02 schema deployed
- [ ] Phase 03 helpers (`slugify`, password hashing, deterministic random) available
- [ ] Phase 04 provider contracts/mocks available for provider-backed fixture states

## Deliverables (checklist)

### Idempotency & ordering
- [ ] Use `prisma.$transaction` per logical block where possible
- [ ] All upserts keyed on `slug` / `email` / `code` so re-running is safe
- [ ] Seed script logs the versioned manifest at the end (including `26 cantons, ≥29 cities, 115 jobs`) and hashes it for exact second-run comparison

### Swiss reference data

- [ ] **All 26 cantons** with `code`, `name`, `slug`, `language`:
  AG, AR, AI, BL, BS, BE, FR, GE, GL, GR, JU, LU, NE, NW, OW, SH, SZ, SO, SG, TG, TI, UR, VS, VD, ZG, ZH (slug examples: `aargau`, `genf`, `genève`→`geneve`, `zürich`→`zuerich`, etc.)
- [ ] **Cities** (≥29) — Zürich, Winterthur, Basel, Bern, Luzern, St. Gallen, Chur, Aarau, Zug, Schaffhausen, Lausanne, Genève, Fribourg, Neuchâtel, Sion, Lugano, Bellinzona, Biel/Bienne, Thun, Köniz, Rapperswil-Jona, Wil, Frauenfeld, Baden, Olten, Solothurn, Uster, Wetzikon, Dietikon — each linked to its canton with seeded lat/lng
- [ ] **Job categories** (18) — Informatik, Gesundheit/Pflege, Bau/Handwerk, KV/Administration, Verkauf, Gastronomie/Hotellerie, Bildung/Soziales, Finanzen/Treuhand/Recht, Logistik/Transport, Engineering/Technik, Marketing/Kommunikation, Reinigung/Facility, Management/Kader, Lehrstellen, Temporärarbeit, Produktion/Industrie, HR/Recruiting, Kundendienst/Callcenter
- [ ] **Skills** — at least 60 across categories (e.g. `TypeScript`, `React`, `Pflegefachfrau HF`, `Schreiner EFZ`, `Buchhaltung`, `SAP`, `SQL`, `Französisch`, `Italienisch`, `MS Office`, `Patientenbetreuung`, `Servicekompetenz`, etc.)
- [ ] **Occupation codes** — a reviewed Mock `OccupationCodeVersion` with datasetVersion/year, source/official URL, disclaimer and effective period plus ≥40 linked CH-ISCO entries with mixed reporting results. Historical `JobReportingCheck` fixtures snapshot that exact version/reason/source.
- [ ] **Salary data** — at least one `APPROVED` `SalaryDatasetVersion` with original fictional/mock source, method and non-overlapping `[validFrom,validTo)`. Precomputed YEARLY/FTE bands store `p25Chf≤medianChf≤p75Chf`, band-level `sampleSize`, Category and exact/fallback nullable Canton/Seniority scopes. Cover exact, Canton-all-seniority, national-Seniority and national-all for representative categories, including 29/30/49/50/99/100 sample boundaries, ambiguous/no-version and no-result fixtures; no raw-count public DTO or ad-hoc quantile merge.

### Demo accounts (must work for login after Phase 06)

- [ ] `candidate@demo.ch` / `Demo12345!` (Role `CANDIDATE`) → linked `CandidateProfile`
- [ ] `employer@demo.ch` / `Demo12345!` (Role `EMPLOYER`) → Owner `CompanyMembership` of a Pro-plan demo company
- [ ] `recruiter@demo.ch` / `Demo12345!` (Role `RECRUITER`) → Recruiter `CompanyMembership` of the same Pro-plan company
- [ ] `admin@demo.ch` / `Demo12345!` (Role `ADMIN`)

### Plans (exact numbers from `99-rules-quickref.md` §13)

> Seed stable `Plan` identities, immutable effective `PlanVersion` prices in Rappen and typed `PlanEntitlement` rows. The values below are packaging hypotheses (ADR-025), not mutable columns or proven willingness to pay.

- [ ] Every PlanVersion has exactly one correctly typed row for all eight `EntitlementKey`s; zero/false/`NONE` is explicit rather than a missing key. Seed verifier rejects unknown, duplicate or mistyped keys. The complete P0 matrix is literal:

| Plan | Price mode / interval / term | net / monthly-equivalent Rappen | active jobs | seats | Radar | contacts/period | boosts/period | analytics | enhanced profile | employer import |
|---|---|---:|---:|---:|---|---:|---:|---|---|---|
| Free Basic | FIXED · MONTHLY · 1 | `0 / 0` | 1 | 1 | false | 0 | 0 | NONE | false | false |
| Starter | FIXED · MONTHLY · 1 | `14900 / 14900` | 3 | 2 | false | 0 | 0 | BASIC | false | false |
| Pro | FIXED · MONTHLY · 1 | `39900 / 39900` | 10 | 5 | true | 10 | 3 | ADVANCED | true | false |
| Business | FIXED · MONTHLY · 1 | `89900 / 89900` | 30 | 15 | true | 50 | 10 | PRO | true | false |
| Enterprise contract template | CONTRACT · MONTHLY · 12 | `null / null` catalog; private Seed subscription snapshots `149900 / 149900` | 100 | 50 | true | 100 | 20 | PRO | true | false |

The Enterprise numbers are an explicit fictional contract fixture, not „unlimited“ or a public offer; a different negotiated contract creates a new private immutable version/snapshot. Verification is available on every plan and is not an Entitlement. Import remains false for every P0 plan and can be raised only by the P1 approved Import-Setup grant.

- [ ] Seed the monthly Free/Starter/Pro/Business versions as the P0 catalog; only Starter/Pro are paid self-service. Inactive 10-for-12 annual research versions are exact: Starter `149000 / 12417`, Pro `399000 / 33250`, Business `899000 / 74917` net/monthly-equivalent Rappen, `ANNUAL`, `termMonths=12`. `monthlyEquivalentRappen = roundHalfUp(netPriceRappen/12)`; they remain hidden/uncheckoutable until a recorded P1 Commercial decision.

### Products (one-time)

> Every numeric price below is the exact stored integer `priceRappen`; display CHF is derived only in the formatter.

| slug | name | type | priceRappen | duration / credits |
|---|---|---|---|---|
| `boost-7d` | Job Boost 7 Tage | `JOB_BOOST` | `7900` | 7 days |
| `boost-30d` | Job Boost 30 Tage | `JOB_BOOST` | `19900` | 30 days |
| `featured-job` | Homepage Featured Job | `FEATURED_JOB` | `29900` | 14 days |
| `featured-employer` | Featured Employer | `FEATURED_EMPLOYER` | `49900` | 30 days |
| `newsletter-placement` | Newsletter Placement | `NEWSLETTER` | `24900` | 1 credit |
| `social-push` | Social Media Push | `SOCIAL_PUSH` | `39000` | 1 credit |
| `import-setup` | XML/JSON Import Setup | `IMPORT_SETUP` | `75000` | one-time; inactive P1 |
| `additional-job-30d` | Zusatzstelle 30 Tage | `ADDITIONAL_JOB` | `12900` | 30 days; inactive P1 |
| `contact-pack-10` | Talent Radar Contact Pack 10 | `CONTACT_PACK` | `9900` | 10 credits |
| `contact-pack-50` | Talent Radar Contact Pack 50 | `CONTACT_PACK` | `29900` | 50 credits |
| `success-fee` | Success Fee (Coming soon) | `SUCCESS_FEE` | 0 | `requiresLegalReview: true`, `status: INACTIVE` |

- [ ] Seed the four P0 ProductVersions with `CatalogVersionStatus.ACTIVE`: `boost-7d`, `boost-30d`, `contact-pack-10`, `contact-pack-50`. Contact Packs are fulfillable in Phase 12. Boost checkout additionally requires the authorized job context and Phase-13 handler; before that it is denied/no CTA. Additional-Job/Import-Setup and Featured/Newsletter/Social/Success Fee are `INACTIVE` for their P1/P2/legal gates. Catalog presence or status alone never proves fulfillability.

### Companies (≥25, mixed plans)

Required mix:
- [ ] 5 × Free Basic (small KMU)
- [ ] 6 × Starter (mid KMU)
- [ ] 6 × Pro (incl. the demo Pro company `employer@demo.ch` belongs to)
- [ ] 5 × Business (incl. one healthcare, one IT, one logistics)
- [ ] 3 × Enterprise-style mock (large industrial / construction / finance)

Industry coverage: KMU, Healthcare, IT, Construction, Hospitality, Retail, Logistics, Education/Social, Finance/Treuhand, large enterprise. **Use original fictional names** (no real Swiss employer brands).

For each company: `dataProvenance=DEMO`, original about-text, values, benefits, safe local demo assets, mixed lifecycle/verification cycles and response-event fixtures. Include one pending duplicate `CompanyClaimRequest`, a rejected→superseding verification cycle and a complete `CompanyBillingProfile` plus one incomplete negative profile. Enhanced-profile capabilities come from seeded versioned Entitlements, not duplicate Company booleans; commercial Import is deny-by-default for all P0 plans until its P1 gate, and badges require evidence.

### Jobs (115, deterministic mixed manifest)

- [ ] Distribution: 75 DE, 20 FR, 8 IT, 12 EN
- [ ] Mix all categories (≥2 per category)
- [ ] Mix `JobType`: 75 PERMANENT, 15 TEMPORARY, 8 FREELANCE, 6 INTERNSHIP, 7 APPRENTICESHIP, 4 HOLIDAY_JOB
- [ ] ~50 % salary disclosed
- [ ] Mixed response targets and historical response-event fixtures, including unknown/insufficient-evidence states; never seed an unproven guarantee badge
- [ ] ~30 % `applicationEffort: SIMPLE`, 50 % MEDIUM, 20 % LONG
- [ ] ~25 % `remoteType: REMOTE` or `HYBRID`
- [ ] Exact canonical lifecycle: 100 eligible `PUBLISHED`, 3 `DRAFT`, 3 `SUBMITTED`, 2 `IN_REVIEW`, 1 `CHANGES_REQUESTED`, 2 `APPROVED`, and one each `PAUSED`, `EXPIRED`, `REJECTED`, `CLOSED` (=115). Dates/Company status make only the intended 100 publicly eligible in explicit Demo mode.
- [ ] Every Job has `dataProvenance=DEMO`. At the anchor clock, exactly 50 current eligible Jobs fall in the single demonstration pair Zürich × Engineering/Technik; each other start pair remains below 50. This exercises only the count-threshold UI/negative DEMO guard and **cannot** create an activated assessment, market evidence or Production indexability. Phase 15's isolated test factory—not this seed—creates the complete positive LIVE six-gate case.
- [ ] Each relevant approved JobRevision has a `JobScoreSnapshot` computed by the Phase-03 helper (never random and never a mutable `Job.fairJobScore` scalar)
- [ ] ≥5 active `JobBoost` records on eligible, relevant demo-company jobs (so search proves labelled sponsored placement without overriding relevance)
- [ ] `JobRevisionSkill` and `JobRevisionLanguage` rows on every approved/current Revision, including missing/empty/partial negative Match fixtures; no Job-level competing requirement rows

### Candidates (30)

- [ ] One per Swiss canton where possible; mix workloads & seniorities
- [ ] Opted-in candidates receive RadarProfile fixtures with coarse, non-unique `displayLabel`; two Company+30-day-epoch-scoped `RadarOpaqueMapping` sets prove random cross-Company non-correlation, encrypted token/lookup HMAC, rotation/revocation and no PK/name derivation. Seed persistent SearchBudget/Session samples for repeat/parallel enumeration tests.
- [ ] **10 with explicit active Radar opt-in** — write matching versioned CandidateConsent events and safe RadarProfile; default remains off
- [ ] Include COMPLETE, DRAFT and REOPENED onboarding histories. Only candidates meeting the exact completion predicate plus current opt-in have a searchable RadarProfile; include consented-but-incomplete and complete-but-opted-out negative fixtures.
- [ ] All with `CandidateProfile` + **`CandidateSkill` rows (3–8 each, linked to seeded `Skill`s)** + **`CandidateLanguage` rows (2–3 each, `code` + `level`)** + `desiredJobTypes` + salary expectation, remote preference, availability — so match-score and Talent Radar filters have real data
- [ ] CV metadata only (no bytes): one candidate-owned `CandidateDocumentMetadata { safeFileName: 'lebenslauf.pdf', size: 123_456, mimeType: 'application/pdf', storageKey: 'mock-storage/<id>', purpose: CV, status: ACTIVE }`; no duplicate embedded CandidateProfile CV fields and no downloadable URL

### Applications, saved jobs, alerts, messages, abuse

- [ ] ~80 `Application` rows distributed across statuses (including `INTERVIEW`/`OFFER`), each with immutable submitted Revision + `ApplicationSubmissionSnapshot`, required document links where applicable and exactly one Application Conversation; invalid transition/snapshot fixtures live only in test factories
- [ ] `ApplicationEvent` history for ≥20 applications
- [ ] ~40 `SavedJob`
- [ ] ~15 `JobAlert` across all lifecycle states with deterministic nextDue/cutoff, Digest/Item/no-repeat and 180-day hashed unsubscribe-token boundary fixtures
- [ ] Every seeded Application above has exactly one Application Conversation + Participants; additionally seed exactly one Radar Conversation per **accepted** Talent Radar request. Pending/declined requests have no Conversation. Message fixtures cover representative threads without reducing the required Application-Conversation count.
- [ ] ≥5 `EmployerContactRequest` (some accepted, some pending) on opted-in candidates
- [ ] ≥2 request-unique scoped `IdentityRevealGrant` fixtures tied to accepted ContactRequest/Conversation with AES-GCM typed immutable value snapshots + Confirmation events, plus decline/no-reveal, whole-grant revoked, stale-preview, add-field and 14-day expiry/30-day cooldown boundaries; individual field rows are never revoked/rewritten
- [ ] ≥3 `AbuseReport` open for admin demo

### Billing data

- [ ] `EmployerSubscription` history for every paying Company links immutable PlanVersions and periods. Include ACTIVE, CANCELLING + pending CANCEL schedule, EXPIRED/CANCELLED and Pro→Starter SCHEDULED-successor fixtures; no `cancelAtPeriodEnd`, `renewsAt` or competing end truth. Assert one effective Subscription and one pending schedule at the anchor instant.
- [ ] ≥10 `Order` (mix `PAID`, `PENDING`, `CANCELLED`) with Invoice linked for paid ones; seed a reviewed planning `TaxRateVersion` of `810` basis points and immutable rate/amount snapshots with consistent integer-Rappen totals
- [ ] ≥6 `Invoice` (mix `ISSUED`, `PAID`, `VOID`; include an unpaid issued invoice past due date to test derived overdue display) — numbers via the concurrency-safe allocator
- [ ] ≥5 active `JobBoost` + 5 expired
- [ ] Entitlement/Credit Ledger grants for Pro/Business: period allowance and a separately funded purchased Contact Pack with expiry/source
- [ ] ≥4 `SalesLead` (mix statuses) so admin leads page is populated
- [ ] `PaymentEvent` rows mirroring order state transitions
- [ ] Every OrderLine satisfies the PlanVersion/ProductVersion XOR and typed target-context rule; Invoice snapshots a complete historical Billing address. Include a currentPeriodEnd exact-boundary fixture and separated PLAN_ALLOWANCE/PURCHASED_PACK/ADMIN_GRANT ledger rows.

### Audit & analytics

- [ ] ≥30 `AuditLog` entries spanning admin actions (job approved/rejected, company verified, invoice marked paid, credits granted, user suspended)
- [ ] ≥300 schema-v1 `AnalyticsEvent` rows from the closed taxonomy, deterministically covering Candidate activation, Employer activation, Search→Detail→Apply, Lead→Qualified→Won and Checkout cohorts plus small-count suppression; no `JobViewEvent` competing truth and no free-text/PII properties

### Guide articles (≥7)

- [ ] "So erkennst du faire Stelleninserate"
- [ ] "Lohn verhandeln in der Schweiz"
- [ ] "Bewerbung bei KMU vs Konzern"
- [ ] "Was bedeutet Pensum 80–100 %?"
- [ ] "Stellenmeldepflicht einfach erklärt"
- [ ] "Wie du Ghosting im Bewerbungsprozess reduzierst"
- [ ] "Wie Arbeitgeber mit Lohntransparenz bessere Bewerbungen erhalten"

Each: 300–600 words, original copy.
- [ ] All demo `ContentPage` rows carry `dataProvenance=DEMO`; local/preview UI must show the persistent Demo banner and Production/public SEO queries must exclude them

## Files to create / modify

- `prisma/seed.ts` — main entry
- `prisma/seed/{cantons.ts, cities.ts, categories.ts, skills.ts, occupation-codes.ts, salary-bands.ts, plans.ts, products.ts, demo-users.ts, companies.ts, jobs.ts, candidates.ts, applications.ts, messages.ts, billing.ts, boosts.ts, leads.ts, abuse.ts, audit.ts, analytics.ts, content.ts, support.ts}` (one file per concern; orchestrated from `seed.ts`)
- `prisma/seed/utils.ts` — deterministic random + helpers (e.g. `pick`, `sample`)

## Rules to respect (from `99-rules-quickref.md`)

- §22 Data and Seed — demo data must make dashboards look useful immediately
- §19 Swiss-Specific — exact canton/city/category lists; original company names only
- §11 Fair-Job-Score — pre-computed score must match the helper, not random
- §17 Talent Radar — only opted-in candidates appear in Talent Radar; their privacy fields must remain hidden via the anonymizer
- §39 Critical Thinking — seeding sales leads, abuse reports, audit logs reflects real business operations

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] `npx prisma db seed` runs cleanly first time
- [ ] Running it again logs "no changes" / "upserted" without duplications (`prisma studio` shows constant counts)
- [ ] All four demo accounts exist with hashed passwords (NOT plain)
- [ ] At least one company per plan exists
- [ ] `select count(*) from "Job" where status = 'PUBLISHED'` = 100 and the canonical public-eligibility query in explicit Demo mode returns exactly 100 at the anchor clock; Zürich × Engineering/Technik returns exactly 50, another start pair <50, and Production-mode predicate returns zero DEMO Jobs
- [ ] `select count(*) from "JobBoost" where status = 'ACTIVE'` ≥ 5
- [ ] `select count(*) from "AbuseReport" where status = 'OPEN'` ≥ 3
- [ ] Seed verifier asserts all DEMO Company/Job/Content rows are labelled, none contributes to LIVE launch metrics, and a Production seed attempt fails before any write

## Common pitfalls

- Random Fair-Job-Score values that disagree with the displayed reasons → confuses users / tests fail
- Talent Radar candidates whose profile still leaks city/email at the API level — verify via Phase 14 anonymizer
- Plain-text passwords in seed (must hash via `lib/auth/password.ts`)
- Copying real Swiss employer brand names — keep fictional only
- Non-idempotent seed (running twice creates duplicate jobs/skills) — use `upsert` keyed on slug/email

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Realistic, deterministic scenarios make every role/queue/limit testable and prevent empty-template demos. |
| Roles / requirements | All demo roles; REQ-MKT-006/007, QA-001, ADM-001–004 and every route's seed row. |
| Prerequisites | 02–04; ADR-010/027; frozen entitlement/score fixture versions. |
| Deliverables | Swiss reference data, fictional companies/jobs/candidates, applications/messages/alerts, all role memberships, positive and negative lifecycle/privacy/billing/import/ops cases; seed manifest with stable IDs/counts and anchor time. |
| Data/server | Versioned namespace and natural keys; safe reset only that namespace; hashed passwords; no production run. |
| Validation/auth/audit | Production fail-closed; demo flag visible; fictional PII; consistent score/status/ledger relations. Seed does not fabricate real audit actor claims. |
| UX/mobile | Fixtures cover new onboarding, populated, empty, locked, limit, suspended, expired, error-like and success states. |
| Tests | Run twice with identical manifest; FK/ledger/score consistency; demo login preparation; negative fixtures; production guard. |
| Verification | reset isolated DB; seed twice; `seed:verify`. Expected: exact manifest unchanged and no duplicates/orphans. |
| Risks / limitations | Raw count targets may change to improve scenario quality; any change updates manifest and phase docs. Demo data is never public market evidence. |
| Definition of Done | Every P0 route/E2E names a usable fixture; repeatability and production guard are automated; dashboards need no hand edits. |

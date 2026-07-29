# Architecture Decisions (ADR log)

> Central record of cross-cutting decisions so they don't drift across phase files.
> Each phase references the relevant ADR instead of re-stating (or contradicting) the decision.

---

## ADR-001 — Auth & session validation runtime

**Decision:** Own email/password auth with a DB `Session` table and an httpOnly cookie. The request-boundary convention selected by the pinned Next version performs only a cheap anonymous redirect/header/nonce role and is never the authorization boundary. With the audited Next 16 reference this file is **`proxy.ts` on the Node.js runtime**; if Phase 01 pins a different supported version, read its installed docs and record the equivalent convention. Real session, role, tenant and ownership validation always runs in protected layouts and each server use case via `getCurrentUser()` / policies / authorized repositories.

**Why:** Next 16 deprecated `middleware.ts`, renamed it to `proxy.ts`, and its Proxy uses Node.js by default. More importantly, a network boundary cannot prove object-level authorization for every Server Action/Route Handler and must not become a single fragile security layer.

**Implications:**
- Proxy/request boundary: cheap redirect for clearly anonymous requests to `/login?next=…`; never the sole security boundary and no unbounded DB work.
- Every `/candidate|/employer|/admin` layout calls `requireRole(...)` server-side; Company pages establish context with `requireCompanyAccess(companyId)`, while each nested object is authorized in its resource-specific scoped database query per ADR-020.
- Do not configure a runtime from memory. Phase 01 records the pinned-version convention and tests Proxy/header/auth behavior against the production build.

Referenced by: Phase 06, Phase 16.

---

## ADR-002 — Money is stored in integer Rappen

**Decision:** All **billing/catalog** monetary values are stored as **integer Rappen** (1 CHF = 100 Rappen). Field names carry a `Rappen` suffix (`priceMonthlyRappen`, `priceRappen`, `amountRappen`, `vatAmountRappen`, `totalRappen`). **Salaries** (`SalaryBand.p25Chf/medianChf/p75Chf`, versioned `JobRevision.salaryMin/Max`, candidate salary expectations) stay in **whole CHF**—Rappen precision is meaningless for ranges. JobRevision is the only editable salary truth; Public Search/cards/JSON-LD may use invariant-tested `Job.publishedSalaryPeriod/Min/Max` read projections copied atomically from the current approved/published Revision, never independently edited fields.

**Why:** 8.1 % VAT on e.g. CHF 149 = 1206.9 Rappen. Storing billing amounts as CHF major-unit `Int` loses the rappen and produces wrong/rounded VAT. Integer minor units avoid float drift.

**Implications:**
- `computeVat(netRappen, rateBasisPoints)` uses integer arithmetic (`810` = 8.1 %) and returns integer-Rappen net/VAT/total; Order/Invoice snapshot the reviewed `TaxRateVersion`.
- The CHF formatter (`lib/utils/format.ts`) divides by 100 at the display boundary.
- Seed prices are in Rappen: Free 0, Starter `14900`, Pro `39900`, Business `89900`; Boost 7d `7900`, etc.

Referenced by: Phase 02, 03, 04, 05, 08, 12, 17.

---

## ADR-003 — Search baseline, Relevanz und Sponsored-Zone

**Decision:** The implementation may start with Prisma/Postgres case-insensitive filters, but the chosen query must calculate the ordering for the complete bounded result set **before** pagination. Relevance/filter eligibility is evaluated before sponsorship. Active boosts may occupy a clearly labelled Sponsored-Zone only among relevant results. P0 config v1 is exactly Search first page max 3 and Homepage max 2; a global search cursor never replenishes/repeats sponsored slots on later pages and includes the ranking/config version. The stable ordering tuple and every user-selectable sort are specified and tested in Phase 15. If Prisma `contains` cannot produce globally correct ranking/pagination at the required volume, Postgres SQL/FTS is pulled forward rather than shipping page-local ranking.

**Why:** An implementation shortcut must not put irrelevant paid results first or create duplicates/gaps between pages. Search technology is an implementation choice; deterministic product semantics are the invariant.

Referenced by: Phase 13 (ranking), Phase 15 (search).

---

## ADR-004 — No background worker in the controlled MVP: effective time state plus explicit projection

**Decision:** Public GET requests remain side-effect free. Effective Boost, Job and Subscription state is calculated from persisted lifecycle status plus an injected `now` and timestamp boundaries; public queries exclude ineligible/expired rows without writing. An idempotent, auditable maintenance command can project due lifecycle transitions for operational queues, demo startup and tests. Subscription renewal remains an explicit mock Admin action. A durable scheduler/outbox is a P1/real-operation gate.

**Why:** The MVP stays self-contained and deterministic without surprising database writes on search traffic. The same pure predicate drives reads, writes and fixed-clock tests, while explicit commands make stored operational state inspectable.

Referenced by: Phase 03, 12, 13, 15, 18.

---

## ADR-005 — External services via adapter interfaces, mock-first

**Decision:** Every actual external integration (payments, email, AI, Job-Room, storage, commute) is an interface under `lib/providers/<service>` with a working mock that records truthful local state. Real-provider files are unwired placeholders. Business logic imports only the service Composition Root/port, never a concrete adapter. P0 Analytics is an internal typed domain writer/aggregator and the HTML invoice is an internal renderer over immutable Invoice data; neither pretends to be an external provider port.

**Why:** Lets real providers plug in later without touching business logic; satisfies "mock = working local behavior, not fake UI".

Referenced by: Phase 04, 18.

---

## ADR-006 — Talent Radar anonymity is enforced at the server boundary

**Decision:** Anonymous candidate data is produced at the server boundary from `RadarProfile`; the payload never contains identity-bearing fields. Cards use a coarse generated `displayLabel` from approved bucketed fields, never `publicDisplayName`, a name-derived label or stable human handle. Navigation uses a rotatable opaque server mapping, not the Candidate primary key; cohort/query controls limit singling out.

**Why:** "Filter on the client" leaks the moment anything is logged; primary keys link a candidate across requests. Reveal is **candidate-initiated only** and per-thread/per-application — never global.

Referenced by: Phase 03, 09, 14, 17.

---

## ADR-007 — All status/type fields are Prisma enums

**Decision:** No free-string lifecycle/type/kind fields. Use canonical Prisma enums such as `ContactRequestStatus`, `PrivacyRequestStatus`, separate non-overlapping `RadarConsentKind`/`UserConsentKind`, `AlertFrequency`, `ImportRunStatus`, `ImportItemStatus`, `ApplicationEventKind`, `PaymentEventKind` and `LanguageLevel`; state-machine values come from Blueprint §7 and are changed only with migration/ADR/tests.

**Why:** Type-safety end-to-end; prevents typos and undocumented states (e.g. a `PaymentEvent` kind not in the set).

Referenced by: Phase 02.

---

## ADR-008 — Metadata route files live at the `app/` root

**Decision:** `app/sitemap.ts` and `app/robots.ts` live at the **root of `app/`** (not inside the `(public)` route group). One sitemap, one robots.

**Why:** Convention; avoids confusion and duplicate metadata routes.

Referenced by: Phase 07, 15.

---

## ADR-009 — CSP via per-request nonce in middleware

**Decision:** Security headers (including CSP) are set at the pinned Next version's per-request boundary (`proxy.ts` for the audited Next 16 reference) so CSP can carry a nonce. `script-src` does not allow `unsafe-inline`; JSON-LD and framework bootstrap/hydration behavior must be verified against the installed production build before final directives such as `strict-dynamic` are frozen. Any `style-src 'unsafe-inline'` exception is documented and minimized.

**Why:** A strict script CSP is the main XSS hardening; Next streaming/hydration makes a fully nonce-only policy non-trivial, so the exact directives are pinned here to avoid ad-hoc `unsafe-inline` creep.

Referenced by: Phase 16.

---

## ADR-010 — Demo credentials

**Decision:** Demo password is **`Demo12345!`** (10 chars, mixed case, digit, symbol — meets the self-registration strength rule). Seeded passwords are written **already hashed**; the strength rule (`lib/validation/auth.ts`) applies to self-registration, not to seeding.

**Why:** The previous `Demo123!` (8 chars) violated the documented ≥10-char rule, which was confusing.

Referenced by: Phase 05, 06; `00-PLAN.md` demo-accounts table.

---

## ADR-011 — MRR excludes custom Enterprise contracts

**Decision:** `MRR = sum of the recurring monthly-equivalent snapshots on effective paid Subscription/PlanVersion records at the measurement instant`. Custom Enterprise without a recorded contract value contributes 0 and is shown separately; annual terms require the documented monthly-equivalent rule. One-time Orders never enter MRR.

**Why:** Custom-priced contracts would otherwise silently understate or distort MRR.

Referenced by: Phase 11, 12.

---

## ADR-012 — Stack baseline is re-pinned in the target repository

**Decision:** `PortalGERM` pins **Node.js 24.18.0 LTS, npm 11.16.0, Next.js 16.2.10, React/ReactDOM 19.2.7, TypeScript 5.9.3, Tailwind CSS and `@tailwindcss/postcss` 4.3.3, PostCSS 8.5.20, ESLint 9.39.5 with `eslint-config-next` 16.2.10, Prisma CLI/Client/PG adapter 7.8.0, `pg` 8.22.0, Zod 4.4.3, Vitest 4.1.10, Vite 8.1.5 and jsdom 29.1.1**. All direct package versions are exact and npm 11.16.0 generated the committed lockfile. The installed Next 16.2.10 documentation for installation, project structure, Route Handlers, Proxy, ESLint, Vitest and response headers was read before implementing the request boundary. Source-repository versions remain comparison data only and never target evidence.

**Implications of the pinned baseline:**
- **No `tailwind.config.ts`.** Tailwind v4 is CSS-first: theme tokens + brand colors live in `app/globals.css` via `@theme` / `@import "tailwindcss"`. `postcss.config.mjs` uses `@tailwindcss/postcss`.
- **shadcn/ui** is initialised in its Tailwind-v4 mode (CSS variables + `tw-animate-css`); components target React 19.
- **Font:** the scaffold ships Geist; we switch the sans font to **Inter** per the plan's Swiss-clean intent.
- **Next 16 async APIs:** `params` and `searchParams` are **Promises** in route segments — `await` them (affects Phases 07/15). `cookies()`/`headers()` are async too (affects Phase 06).
- **Next 16 request boundary:** use `proxy.ts`; `middleware.ts` is deprecated, Proxy defaults to Node.js and does not accept a runtime override. Authorization still remains in layouts/use cases (ADR-001).
- ESLint is flat config (`eslint.config.mjs`); `lint` script is `next lint`-equivalent via `eslint`.

**Why:** Reproducibility and support matter more than an unpinned "latest" label. This also prevents source-specific Tailwind/Next claims from being mistaken for target implementation.

Referenced by: Phase 01, 07, 15.

---

## ADR-013 — Auth: own session + `bcryptjs`

**Decision:** Own email/password auth with a DB `Session` table (not Auth.js), password hashing via **`bcryptjs`** (pure-JS, no native build).

**Why:** The Phase 06 spec already describes a `Session` table and full cookie/session lifecycle, so own-auth fits directly. `bcryptjs` avoids `node-gyp`/native-build fragility (bcrypt/argon2 need compilation) — important in restricted environments; the interface (`hashPassword`/`verifyPassword`) stays swappable.

Referenced by: Phase 01, 06.

---

## ADR-014 — Mock-only MVP boundary; real providers are deferred

**Decision:** The MVP uses mock adapters only for payments, email, AI, Job-Room, storage and commute. Analytics is an internal domain contract; invoice output is a deterministic internal HTML renderer. Real-provider files may exist as explicit placeholders to protect architecture, but they must not be selected automatically by env keys and must not call external APIs during MVP implementation.

**Why:** The business goal is a privacy-friendly, demo-ready Swiss MVP with working local behavior and no secrets. Real payments, real email delivery, real AI calls, real storage, real Job-Room integration, or real success-fee billing add legal, security, operations, webhook, data-processing, and compliance risks that are out of scope before the product is validated. A Mock checkout validates only product mechanics and commercial **intent**; it never validates willingness to pay. That assumption must be tested through a separately approved real-money Design-Partner pilot, which may use a lawful manual invoice before a self-service provider exists.

**Allowed in MVP:**
- Mock checkout that creates versioned `Order`/`Invoice`, `SubscriptionEvent`/Entitlement or Credit Ledger effects, and `PaymentEvent` rows exactly once.
- Mock email that writes `EmailLog` rows and renders German template text.
- A local/CI-only Mock mailbox may expose a one-time raw reset/invite URL through `/dev/mailbox` or a test capture port **only** when `NODE_ENV !== production`, `ENABLE_LOCAL_MOCK_MAILBOX=true` and a separate `DEV_MAILBOX_SECRET` is supplied. It is secret-authenticated, no-store/noindex, TTL-bounded, single-read, excluded from EmailLog/Audit, and Production startup fails closed if enabled. This makes browser E2E possible without weakening generic forgot-password responses.
- Mock storage that stores metadata only; no CV bytes are persisted.
- Mock AI that returns deterministic rule-based text.
- Mock Job-Room check from seeded `OccupationCode` with a legal disclaimer.
- `.env.example` placeholders for future providers, clearly marked as inactive.

**Deferred real-provider work:** Stripe, real email delivery, Supabase/S3 storage, OpenAI, official Job-Room, maps/commute providers, PDF invoice generation, webhooks, retries, delivery monitoring, data-processing agreements, and legal review.

**Implications:**
- Do not add provider-specific schema fields such as external customer/subscription ids unless the real-provider phase is explicitly approved.
- Do not mark a provider "ready" because a placeholder file exists.
- Never report `CHECKOUT_COMPLETED` from the Mock flow as paid conversion, collected revenue or willingness-to-pay evidence.
- A later real-payment ADR is scoped to payment and its fulfillment/webhook contract. It does not pull email/storage providers forward merely because they exist in another repository.
- README must state "Implemented with mock provider" and "Ready for later real-provider integration"; never "production-ready".

Referenced by: Phase 04, 09, 12, 18; ADR-029.

---

## ADR-015 — Planning evidence standard

**Decision:** A checkbox in `00-PLAN.md` or a phase file means "implemented and verified in `PortalGERM`", not "planned" or "present in `PortalGIT`". Until application code exists in the target repository and the listed command/manual check passes with recorded evidence, the checkbox stays unchecked.

**Why:** The repository currently contains planning documents only. Carrying forward legacy "verified/live" notes creates false confidence and makes later implementation harder to audit.

**Implications:**
- Verification text must be phrased as target checks, not historical claims.
- Completion reports must list actual commands run, actual outputs, and known limitations.
- If a command cannot run in the current environment, write "Needs verification" and explain why.

Referenced by: `00-PLAN.md`, all phases, `plan-audit.md`.

---

## ADR-016 — `codex-plan` is the local planning source of truth

**Decision:** `codex-plan/` plus root `AGENTS.md` is the normative specification. The historically referenced `../plan.md` is absent and its section references have no independent authority. Conflicts are resolved in this order: explicit current ADR → requirements matrix → current master/blueprint/strategy → phase detail → historical wording.

**Why:** A Coding-Agent needs one unambiguous plan and must not infer missing requirements from dead links.

Referenced by: all plan files.

---

## ADR-017 — Fair-Job-Score v2 rates the advert; verification is separate

**Decision:** The score rates structured, observable advert transparency. Company verification is shown as a separate trust badge and contributes no points. Phase 03 contains the complete frozen v2 P0 formula: exact partial points, evidence predicates, response/benefit/freshness boundaries, mandatory injected clock, reason ordering and no hidden normalization. The score is versioned and stored with input evidence and factor breakdown. Plan, payment, product and boost cannot be inputs. Any approved change creates v3 plus new fixtures; it never edits v2 retrospectively.

**Why:** Verification and paid reach are not properties of the fairness/transparency of an individual advert. Separation improves explainability and prevents commercial distortion.

Referenced by: Phase 02, 03, 07, 10, 13, 17.

---

## ADR-018 — Match-Score is candidate-facing in P0

**Decision:** P0 uses Match-Score as an explainable candidate decision aid. Phase 03 freezes v1 weights, normalization/overlap matrices, missing-data denominator, confidence/score rounding and stable reasons. Missing data affects confidence separately from fit; no known factor means `score=null`, not a misleading zero. Protected or proxy-sensitive fields are excluded by type. Employer sorting, automated rejection or hiring decisions do not use the score in P0. Formula changes create a new version and fixture hash.

**Why:** This lowers fairness and legal risk while preserving candidate value. Employer use needs separate consent, bias and legal review.

Referenced by: Phase 03, 07, 09, 10, 17.

---

## ADR-019 — Billing owns catalog, fulfillment, entitlements and ledgers

**Decision:** Phase 03 defines the typed entitlement keys/values, gates and read-only resolver; Phase 05 seeds a complete default Free PlanVersion; Phase 06 may resolve it when no effective paid subscription exists but creates no Billing row/effect. One effective Subscription PlanVersion replaces the complete Free baseline; active allowlisted grants may only raise/replace/add according to their stored typed semantics. Unknown/missing/mistyped/ambiguous keys fail closed. Ledger balances stay separate from access rights. Phase 12 is the only owner of Order confirmation, Invoice creation, Subscription/Entitlement effects, catalog mutations and Credit Ledger movements. Each OrderLine references exactly one PlanVersion or ProductVersion and owns its typed target snapshot; fulfillment is atomic/idempotent. Admin calls the same use case and never duplicates it.

**Why:** This removes Phase-11/12/13 cycles, price manipulation and double grants.

Referenced by: Phase 03–06, 08, 10–14, 17.

---

## ADR-020 — Tenant-object denial uses safe 404 semantics

**Decision:** A requested company/candidate-owned object that is absent or outside the actor's scope returns the same safe not-found response. A pure role/capability failure without an object-enumeration concern may return 403. All private reads and writes are scoped in the database query, not filtered after loading.

**Why:** Consistency prevents IDOR enumeration and makes tests unambiguous.

Referenced by: Phase 03, 06, 09–16, 17.

---

## ADR-021 — Company membership and recruiter access

**Decision:** Global Employer/Recruiter roles do not grant company data. Active `CompanyMembership` plus role and, where required, `JobAssignment` is authoritative. P0 recruiters operate within explicit company contexts. Cross-client agency work uses a time-bounded `RecruiterMandate` in P1; no implicit firm-wide access is inferred.

**Why:** Recruiters may serve several companies, so global roles alone create immediate cross-tenant risk.

Referenced by: Phase 02, 06, 10, 14, 17.

---

## ADR-022 — Canonical consent, opaque Radar identity and scoped reveal

**Decision:** Consent is append-only and versioned; current Radar state is derived and defaults off. Employer-facing IDs are opaque server mappings, not handles or primary keys. Reveal is candidate-initiated for exactly one accepted Company/request/conversation and stores a confirmation snapshot plus only closed `RevealField` enum rows (`DISPLAY_NAME`, `EMAIL`, `PHONE`, `CV_METADATA`). Every DTO maps those enums through a server allowlist and rechecks that the grant is unrevoked; exact address, CV bytes and private notes cannot be granted. A rejected contact never reveals identity.

**Why:** This resolves three competing consent states and prevents correlation or global disclosure.

Referenced by: Phase 02, 03, 09, 14, 16, 17.

---

## ADR-023 — Tests belong to the owning phase

**Decision:** Each phase implements its unit and relevant PostgreSQL integration tests before it can be completed. Phase 17 adds and runs cross-role E2E, accessibility, performance and regression coverage; it does not retroactively create the first tests. Atomicity/constraints cannot be accepted from Prisma mocks alone.

**Why:** Delayed testing turns architectural mistakes into expensive rewrites and cannot prove database races.

Referenced by: every phase, especially 02, 03, 12, 14, 17.

---

## ADR-024 — Launch narrow, expand by cluster liquidity

**Decision:** SwissTalentHub retains a national vision but validates a de-CH launch wedge first: KMU and experienced candidates in selected Zürich/Aargau/Bern × Pflege/Gesundheit and Engineering/Technik clusters. This is a hypothesis. Public acquisition and indexation are unlocked per cluster only after supply, activation, response and content gates are met.

**Why:** Nationwide aggregate counts conceal local marketplace emptiness and worsen the chicken-and-egg problem.

Referenced by: product strategy, Phase 05, 07, 08, 11, 15.

---

## ADR-025 — Pricing is a versioned hypothesis, not a proven market fact

**Decision:** The five plan names and current CHF price points are retained as initial test hypotheses. Plan versions and entitlement snapshots prevent later experiments from rewriting active contracts. One-time MVP scope is reduced to Boosts and Contact Packs; other products are prioritised in the strategy. Annual pricing and trials require explicit commercial approval.

**Why:** Hardcoded marketing copy is not a business model. Versioning allows learning without historical inconsistency or feature bloat.

Referenced by: Phase 05, 08, 12, product strategy.

---

## ADR-026 — `noindex` and private cache protection are separate controls

**Decision:** Private Candidate, Employer and Admin routes are both non-indexable and dynamically rendered/no-store as appropriate. Sensitive routes outside those layout groups (`/reset-password`, `/invite/[token]`, `/support/[id]`, `/mock/checkout/[orderId]`, local `/dev/mailbox`) receive the same explicit dynamic/no-store/noindex protection, strict referrer policy and safe error/ownership rules. `robots` metadata never substitutes for authorization or cache control.

**Why:** Search-engine instructions do not prevent server, framework, browser or CDN caching of personal data.

Referenced by: Phase 06, 09–10, 14–16, 17.

---

## ADR-027 — Demo data is environment-bound

**Decision:** Publicly renderable Company/Job/Content records carry `DataProvenance`. Demo/Test data and accounts are allowed only in local, CI and explicitly labelled demo/preview environments; Production seed refuses them and public Production/SEO queries exclude them. Local/Preview pages containing them render a persistent unmistakable Demo badge/banner. Imported/pilot jobs store LIVE provenance/source rights and are never mixed invisibly with Demo records or counted as real launch evidence.

**Why:** Fake marketplace activity destroys trust and can leak known credentials.

Referenced by: Phase 05, 07, 11, 18.

---

## ADR-028 — Billing Policy v1 freezes rounding, credits and plan changes

**Decision:** Phase 12 implements one immutable `BILLING_POLICY_V1`:

- VAT is rounded **per InvoiceLine**, never again on the Invoice total: `vatRappen = Math.floor(netRappen * rateBasisPoints / 10_000 + 0.5)` for non-negative values. Invoice net/VAT/total are the sums of line snapshots. Invoice numbers are transactionally allocated as `STH-YYYY-NNNNN` with a five-digit minimum.
- Included `PLAN_ALLOWANCE` grants are created once per Subscription/key/period and expire at exclusive `currentPeriodEnd` with no rollover. Purchased packs expire at `addCalendarMonthsClamped(firstPaidAt,12,'Europe/Zurich')`. Every Admin grant requires an explicit `validTo`, at most 12 calendar months after grant. Effective reads ignore a grant at/after `validTo` even before the idempotent expiry projector writes `EXPIRE`.
- Consumption order is `PLAN_ALLOWANCE → PURCHASED_PACK → ADMIN_GRANT`; inside a source it is earliest `validTo`, then oldest `createdAt`, then stable `id`, all under one DB lock. `TALENT_CONTACT` means one request; `JOB_BOOST` means exactly one `BOOST_7D_V1` window. The latter may come from Plan/Admin only in P0 (no purchased generic Boost pack), is eligible when consumed strictly before grant `validTo`, and runs its full seven days even if the source grant expires mid-window. A 30-day Boost always uses its ProductVersion. Decline, request expiry/cancel, Boost cancel and unused credit never auto-refund. An Admin reversal references exactly one prior consume, adds its exact inverse once, requires reason/capability/Audit and cannot revive an already expired source or undo the business effect.
- A new Free→Starter/Pro checkout opens a monthly period using `addCalendarMonthsClamped(paidAt,1,'Europe/Zurich')`. Same-plan checkout is rejected. A Starter→Pro upgrade is immediate: charge `roundHalfUp((targetMonthly-currentMonthly) * remainingSeconds/periodSeconds)` for the half-open remaining period; close/supersede the old effective row at `paidAt`, create a successor ending at the unchanged `currentPeriodEnd`, and issue `floor(targetAllowance * remainingSeconds/periodSeconds)` contacts/boosts. At an expired boundary it is a new full-period purchase. No other self-service upgrade exists in P0.
- A paid downgrade is bought at the full target monthly price and creates one pending change schedule plus a non-effective `SCHEDULED` successor for `[old.currentPeriodEnd, addCalendarMonthsClamped(old.currentPeriodEnd,1,'Europe/Zurich'))`; cancellation creates one pending CANCEL schedule with no successor Subscription and no synthetic Free Subscription row. At/after the boundary, the entitlement resolver returns the seeded default Free PlanVersion baseline because no paid Subscription is effective. Plan changes/cancel require an Owner. There is no stored `cancelAtPeriodEnd`; the pending schedule is canonical and the status is its projection. At the boundary a user cancellation is only `CANCELLED`, a natural unsuperseded lapse only `EXPIRED`, and a downgrade performs old `ACTIVE→EXPIRED` plus successor `SCHEDULED→ACTIVE`. The Owner confirms retained Memberships up to the target Seat limit and must retain an Owner; deterministic fallback is oldest active Owner, then remaining `OWNER→ADMIN→RECRUITER→VIEWER` by join time/id, independent of initiator. All non-retained Memberships are denied immediately/projected `SUSPENDED`, and pending invitations are revoked with events. Existing over-limit Jobs remain readable/public only until their mandatory bounded `validThrough` (maximum 90 days); new publish/reactivate is denied until under limit. New Radar query/contact/import stops; existing Applications, Invoices and accepted Conversations remain readable. Purchased credits keep their own expiry but cannot bypass a lost feature entitlement.

All calculations use one injected UTC instant plus Zurich calendar helpers. Golden tests cover DST, month-end clamp, before/at/after boundaries, proration rounding, allowance flooring, retained seats, double confirmation and projector lag.

**Why:** These choices avoid implementer-defined money totals, credit order and downgrade side effects while preserving an explicit, reversible Mock-MVP contract. They are commercial hypotheses and still require Finance/Legal approval before real payments.

Referenced by: Phase 02, 03, 05, 10, 12, 14, 17, 18.

---

## ADR-029 — Real-market evidence and regulated LIVE launch are separate gates

**Decision:** Technical Demo completion, paid-market validation and a regulated
Swiss LIVE launch are three different states:

1. The current Mock-only MVP may prove deterministic product workflows.
2. Pricing and willingness to pay require a pre-registered experiment with
   real Swiss KMU and a real, transparent money flow. Mock completion and
   Stripe test mode count as zero paid conversions.
3. Public/paid job-market and Talent-Radar operation requires a flowspecific
   AVG/AVV assessment and, where required, cantonal and/or federal permission.
   Disabling Success Fee alone does not close that gate.

Until a reviewed LIVE salary dataset exists, `/salary-radar` stays fail-closed
in Staging/Production, `noindex` and absent from the sitemap. An approved
dataset must carry source, reference URL, data year/as-of, methodology,
taxonomy/region mapping, uncertainty/suppression rules, review status,
validity and refresh ownership. Public BFS/LSE data may be used only at its
honest Grossregion/CH-ISCO granularity; Kanton input must not be presented as a
kantonspecific official estimate. It requires a new Policy/Schema/DTO/UI
version if its real dimensions differ from V1: age is not seniority, an
unpublished sample size is not invented, and monthly values are not converted
to annual values without an approved and disclosed method.

An autonomous worker/outbox is not required for a supervised local demo. It is
a hard prerequisite for unattended public Self-Service, recurring delivery,
renewal and lifecycle promises. A bounded Concierge pilot may use explicit
commands only with a named operator, schedule, checklist and escalation path.

**Why:** Provider plumbing, customer demand, regulatory authorization,
statistical validity and unattended operations fail in different ways and need
different evidence. Treating one green Mock funnel or technical release as all
five would create false market, legal and operational confidence.

**Implications:**

- The authoritative open gates and arithmetic sensitivities are recorded in
  [`commercial-go-live-gates.md`](./commercial-go-live-gates.md).
- Paid conversion dashboards explicitly label Mock confirmations.
- A monthly cashflow/runway model is required before hiring or paid
  acquisition; a point-in-time MRR snapshot is insufficient.
- Episodic hiring is measured with pause/reactivation cohorts and competing
  monthly, hiring-sprint and retainer/credit packages before repricing.
- Talent Radar is tested as a commercial wedge through opt-in, cohort,
  contact, accept, reveal, qualified-conversation and paid-use evidence; it is
  not called a moat before a real network effect is shown.

Referenced by: Product Strategy, Release Checklist, Phase 07/12/14/15/18
follow-up.

---

## ADR-030 — Remediation governance, six launch classes and commit-bound gates

**Status:** prospective; binding for Phase 19+ and not historical Phase-01–18
evidence.

**Decision:** Phase 19+ uses the four-state model `Plan → Technical →
Quality-Gate → Activation` and the six launch classes LC1 local Demo, LC2
supervised Design Partner, LC3 invite-only Pilot, LC4 public Free, LC5 paid
Self-Service and LC6 scaled Production. Every `STH-*`/`REQ-*` has a
launch-class priority, one lead phase, an acceptance-to-test matrix and
commit-bound evidence. A dependent phase may integrate only after its hard
predecessor gate; a feature may avoid a launch blocker only by being
server-side disabled across UI/API/worker/marketing.

`route-inventory.json` remains generated current-state evidence. Future
routes live in the planned delta of `route-role-matrix.md` until the files
exist. Phase 01–18 phase files and Evidence are immutable history.

**Why:** A formally higher but stale Requirement/ADR must not overrule the
new remediation contract, and a technical implementation must not be
misrepresented as an external or LIVE approval.

Referenced by: Phase 19–32,
[`remediation-execution-contract.md`](./remediation-execution-contract.md),
`REQ-GOV-001`, `REQ-QA-003`, `REQ-REL-001`.

---

## ADR-031 — Identity assurance and durable notification delivery are separate layers

**Status:** accepted and technically implemented for Phase 20; activation
remains `DISABLED` beziehungsweise isolated `SANDBOX`. Supersedes ADR-014 only
for the explicitly approved Phase-20/23 scope. The historical Mock-MVP
decision remains true for nicht umgestellte Altpfade.

**Decision:** Registration produces a bounded low-assurance state until a
single-use, expiring, supersedable email-verification token is consumed.
Login-email change re-verifies the new address and notifies the old address.
Domain state and a typed NotificationOutbox record commit atomically.
Attempts, provider idempotency, bounce/suppression and DLQ are durable. Phase
20 liefert den bounded Command-Dispatcher samt Lease, Heartbeat, Retry und
auditiertem Local-Sandbox-Replay; Phase 23 besitzt autonomes Scheduling,
Production-Monitoring, Pager, Recovery und das Aktivierungsledger.

Authentication assurance is distinct from delivery: privileged actions use
a short-lived, actor/purpose/tenant/action-bound StepUpGrant and never infer
freshness merely from an old session or a delivered email.

**Why:** Real mail can be delayed or duplicated, and verified email alone is
not MFA or authorization.

Referenced by: Phase 20, 23, 25; `REQ-ID-004/005`, `REQ-NOT-001`.

---

## ADR-032 — Private object vault is quarantine-first and capability-bound

**Status:** accepted for the Phase-21 Local/CI sandbox on Candidate
`ca36bff59e0d759cc5243da346c6e717c650e35e`; LIVE provider activation
remains blocked.

**Decision:** Private CV/document uploads use a reviewed object-store adapter
and a direct-upload protocol with server-issued, short-lived intents. New
objects are `UPLOADING`/`QUARANTINED`, are identified by content hash and
server-side MIME detection, and become readable only after a successful
malware/policy scan. Download authorization is checked at request time and
issues short-lived, single-object URLs; object keys are never authorization.
Retention, legal hold, version replacement, export and erasure operate from a
canonical Document record. Orphan object/database reconciliation is
idempotent and observable.

If the provider/scanner contract or approved data region is absent, internal
CV-byte submission is disabled; metadata must not masquerade as an uploaded
file.

The accepted sandbox realization uses an external-root, streaming
AES-256-GCM filesystem adapter with versioned keys, SHA-256 verification
before and after storage, atomic publication, a closed PDF/PNG content
policy, a deterministic malware-scanner sandbox and actor-bound single-use
read grants of at most 60 seconds. Uploads are limited to 5 MiB, 1 MiB
chunks, ten-minute intents and three concurrent actor uploads; scanner and
reconciliation commands are bounded. Production configuration, external
object storage/KMS/scanner, DPA/region approval, retention/legal-hold policy,
autonomous scheduling and bulk access are not accepted by this ADR status
and remain fail-closed under Phases 22, 23 and 25.

**Why:** A functional file picker without bytes or scan/retention controls
creates a false and unsafe application promise.

Referenced by: Phase 21/22/23; `REQ-DOC-002`.

---

## ADR-033 — Privacy execution uses a versioned data inventory and legal holds

**Status:** prospective Phase-22 decision.

**Decision:** Export, correction and erasure execute from a versioned
DataInventory that lists every database domain, object store, notification/
payment provider and immutable legal record. Each processor returns a
replay-safe result. Export produces an encrypted, expiring, single-use
artifact. Erasure deletes or irreversibly anonymizes only after a
flowspecific Retention/LegalHold decision; immutable financial, consent,
security and AVG evidence retains only the approved minimum. Partial failure
remains resumable and visible.

Technical implementation does not publish legal text or enable Analytics,
Radar, CV or paid flows until Swiss counsel/privacy owners approve the exact
version. High-risk processing receives a documented DSFA decision.

**Why:** A manifest or generic disclaimer cannot prove a real data-subject
process, and indiscriminate deletion can violate other duties.

Referenced by: Phase 22/23/32; `REQ-PRIV-004`, `REQ-SRCH-002`.

---

## ADR-034 — Real providers and autonomous workers activate through a ledger

**Status:** prospective Phase-23 decision.

**Decision:** Each environment/provider/worker capability has a versioned
activation record covering config completeness, secret version, contract/DPA,
sandbox/LIVE approval, health, owner, runbook and rollback. No implicit
`NODE_ENV` fallback activates a provider, and Production never silently falls
back to Mock.

Worker claims use PostgreSQL-backed leases with heartbeat, bounded batches,
idempotent effect keys, retry classes/backoff, poison-message DLQ, audited
replay and backpressure. SLO, queue age, arrival rate, handling capacity,
pager and shutdown policy are measurable. Exactly-once network delivery is
not claimed; exactly-once business effect is enforced by inbox/outbox and
domain idempotency.

**Why:** A command that can be run manually is not an unattended service, and
provider selection without a reviewable activation state is unsafe.

Referenced by: Phase 20/23/24/26/30; `REQ-OPS-004/005`.

---

## ADR-035 — Paid service recovery supersedes blanket no-auto-refund only for platform failure

**Status:** prospective Phase-24/31 decision; ADR-028 remains unchanged for
ordinary decline, expiry, user cancellation and unused credits.

**Decision:** Paid fulfillment and service delivery are distinct. A
versioned ServiceDeliveryPolicy classifies user-caused outcomes, expected
market outcomes and platform-caused non-delivery. Only an approved
platform-caused case may create exactly one replacement window, restored
credit, extension or monetary refund linked to the original OrderLine,
Ledger entry and service instance. Radar decline/normal expiry and voluntary
Boost cancellation retain ADR-028’s no-auto-refund baseline unless a later
version explicitly changes the commercial promise.

Payment webhooks use raw-payload signature verification, inbox dedupe,
server-side amount/currency/tenant checks and reconciliation. Phase 24 starts
only after a Phase-31A WTP Go for LC5; manual invoices may validate WTP before
self-service payment.

**Why:** Customers must not pay for a platform service the platform failed to
deliver, while normal recruiting outcomes must not create unlimited refund
fraud.

Referenced by: Phase 24/31; `REQ-BIL-010`, `REQ-PAY-001`, `STH-035/037`.

---

## ADR-036 — Privileged assurance, least privilege and Trust & Safety share one risk model

**Status:** prospective Phase-25 decision.

**Decision:** Phase 25 has three tracks:

- **25A:** persisted Admin roles/capabilities, MFA, separation of duties,
  dual approval and time-bounded audited break-glass;
- **25B:** risk-based Step-up for Employer Owner, Billing, team/role changes,
  login-email/account recovery, Candidate export/delete and critical
  Consent/Reveal actions.
- **25C:** a coherent Trust-&-Safety/Fraud lifecycle for Credential
  Stuffing/ATO, compromised companies, scam/duplicate jobs, mass messaging/
  contacts, Reveal-/Export anomalies, complaints and Payment Fraud. Domain
  owners in Phases 24/26/30 implement their specific containment while 25C
  owns risk decisions, case routing, appeal and incident escalation.

A versioned risk model consumes minimal session/device/velocity/trust/
complaint signals and emits allow, step-up, hold, revoke or review. Trust &
Safety cases can rapidly revoke sessions, badges, public jobs, messaging,
Radar and payment operations with appeal and false-positive review. Secret
risk weights and device data are not exposed or retained without purpose.

**Why:** Admin MFA does not protect a compromised verified-company Owner or
candidate high-risk action; a once-only company verification does not prevent
future abuse.

Referenced by: Phase 20/24/25/26/30; `REQ-ID-004`, `REQ-TRUST-001`.

---

## ADR-037 — Cluster quality, job freshness and commercial activation are independent gates

**Status:** prospective Phase-30/31 decision.

**Decision:** A cluster uses one versioned concept contract across Search,
Alerts, Preferences, Recommendations and Matching. It covers occupation,
neutral/gendered forms, singular/plural, abbreviation, typographical and
regional variants, location aliases, qualifications/certificates, skills and
industry. Pflege and Engineering use separate fachlich reviewed corpora; only
an actually activated cluster must be P0. Privacy-safe Search-Learning may
observe redacted/aggregated unknown concepts but never store unrestricted raw
queries.

Cluster activation separately requires current, non-duplicate jobs:
reconfirmation, reminder/grace, filled/unavailable feedback and duplicate/
copy review share public Eligibility across Search, Sitemap, Alerts,
Recommendations and Analytics.

Commercial discovery may compare several cluster hypotheses, but the first
public activation is one Region×Profession pair unless each additional pair
independently passes search, liquidity, freshness, fraud and operations-
capacity gates. Base workflow, Hiring Sprint, Retainer/Credits and Concierge/
Import Setup receive real-money tests before Boost (organic reach gate),
Radar (eligible density gate) or premium breadth.

**Why:** Feature breadth and a taxonomy alone do not create a liquid, current
marketplace or prove willingness to pay.

Referenced by: Phase 23/26/29/30/31/32; `REQ-JOB-007`,
`REQ-SRCH-002/003`, `REQ-COM-001`.

---

## ADR-038 — Company Trust is an evidence-backed current projection

**Status:** accepted for the disabled Phase-26 Local-/CI contract; production
activation remains prospective.

**Decision:** Strong Company Trust is derived only from current, versioned and
purpose-bound evidence. UID/register checks and domain-control challenges use
typed provider ports; supporting documents use the private Phase-21 Vault.
Evidence, checks, decisions and projections are separate append-oriented
records. A strong decision requires the configured evidence set, exact
provider results, current validity, reviewer capability, fresh action-bound
step-up and separation of duties. Manual/Legacy text never becomes strong
trust by migration or payment.

One central current-trust reader is authoritative for Public Company copy,
Company/Job eligibility and Talent Radar. Missing, mismatched, expired,
held, revoked, superseded or wrong-policy evidence removes strong effects at
the next read. Restore after an incident requires fresh strong post-incident
evidence and an independent decision; historical evidence is not overwritten.
Public DTOs expose only the approved scope, method and validity, never document
keys/bytes, provider raw data, challenge secrets or reviewer notes.

Deterministic local adapters prove the provider contract but cannot activate
public trust. Production requires separately approved real register/domain
providers, usage rights, DPA/region, legal policy, reviewer capacity,
staging/pager/rollback evidence and cohort activation. A narrow Local/CI demo
compatibility projection may preserve existing demo flows while public trust
flags are disabled, but it emits no strong badge and is impossible under the
production environment contract.

**Why:** A mutable text field or once-only status cannot justify a public
identity claim, and independent eligibility implementations would allow stale
or revoked trust to remain visible.

Referenced by: Phase 21/23/25/26/30/32; `REQ-EMP-008`,
`REQ-TRUST-001`, `REQ-DOC-002`, `STH-014`.

---

## ADR-039 — Identity, Persona und Tenant bleiben getrennte Autoritäten

**Status:** accepted for the owner-activated, disabled Phase-27 Local-/CI
contract; moderated demand and every market activation remain prospective.

**Decision:** `User` remains the authentication identity and keeps its legacy
`role` only as an N-1 compatibility projection. Candidate and Employer
eligibility are represented by one append-oriented `PersonaAssignment` per
identity and kind. Company access still requires a current
`CompanyMembership`; job access still requires the existing assignment and
ownership rules. Persisted Admin roles and capability grants remain a third,
independent authority and can never be derived from a Persona or Company
Membership.

Every authenticated Session owns exactly one versioned
Candidate/Employer/Admin portal context and, for Employer, one current Company
context. Login with multiple available portals lands on `/account/portal`.
Switches validate the exact current assignment, membership, company and
session version, persist the next context, revoke action-bound step-up grants
from the prior context and write minimized Audit/Analytics evidence. URL,
form, cookie or client state can select neither a Persona nor a Tenant without
that server-side proof.

Candidate self-service Persona creation and first Employer Persona creation
through an existing-identity invitation require the Phase-25 action-bound
step-up contract. Invitations continue to enforce current token, e-mail,
role, seat, company and replay rules atomically. No automatic account merge,
name/domain heuristic, shared account or Admin-to-normal-Persona union is
introduced.

The additive migration backfills only evidence already present in the legacy
role, Candidate profile and current Company Memberships. It adds
append-oriented assignment events, session-context versioning, indexes,
constraints and fail-closed invalidation triggers; it does not create Company
Memberships, Job Assignments, Admin Grants or Consent. Legacy reads remain
available until a later G3/G4 cutover explicitly retires them.

Privacy export/correction/erasure inventory is identity-wide across all
Personas while Company, third-party, financial, consent, security and other
immutable records retain their existing ownership/hold rules. Audit rows
carry typed portal/session context; Analytics uses a pseudonymous identity
subject and allowlisted context only. Suspension remains scoped: User status
is global, Persona status is fachlich scoped and Membership status is
Company-local.

The flags `IDENTITY_PERSONA_V2`, `EXISTING_IDENTITY_INVITATION`,
`PERSONA_PORTAL_SWITCH`, `PERSONA_PRIVACY_V2` and
`PERSONA_LEGACY_CONTRACT` default to disabled/fail-closed. The Owner's
technical scope activation permits implementation and Local-/CI evidence but
is not a demand `GO`, market claim, cohort approval or LIVE authorization.
Any `INTERNAL`, `ALLOWLIST` or `LAUNCH_SCOPE` promotion requires the phase's
moderated demand threshold, named Product/Security/Privacy/Engineering
sign-offs, current G3/G4 evidence and an explicit cohort/rollback decision.

**Why:** A single global role cannot safely represent legitimate
Candidate-plus-Employer use, but treating context selection as authorization
would union Tenant and Admin rights. Additive assignments plus an exact,
versioned Session context solve the technical boundary while preserving
existing Membership, Assignment, capability, privacy and rollback contracts.

Referenced by: Phase 20/22/23/25/27/29/32; `REQ-PER-001`,
`REQ-ID-004`, `REQ-ADM-007`, `REQ-PRIV-004`, `STH-012`.

---

## ADR-040 — Externer Bewerbungs-Tracker und Interview-Scheduler bleiben getrennte, candidate-kontrollierte Verträge

**Status:** accepted for the owner-activated, disabled Phase-28 Local-/CI
contract; Demand-, Provider-, Cohort- and LIVE activation remain prospective.

**Decision:** Phase 28 implements two independent, additive state machines
behind separate server-side modes `DISABLED → TEST → ALLOWLIST → LIVE`.
`EXTERNAL_APPLICATION_TRACKER` and `INTERVIEW_SCHEDULER` default to
`DISABLED`; Local/CI may use `TEST`, while Production rejects that mode. One
track never activates or authorizes the other.

An `APPLY_URL` click remains analytics evidence only and is never interpreted
as a submitted application. A Candidate may explicitly resume that click into
an owner-scoped `ExternalApplicationTracker`, whose status changes are marked
`CANDIDATE_CONFIRMED`. Its immutable job/company snapshot preserves what the
Candidate acted on without claiming ATS delivery, employer confirmation or
hire causality. Events are append-only, versioned and idempotent; export,
correction, erasure, retention and hold follow the Phase-22 privacy contract.

An `Interview` is a separate persisted object and never reinterprets the
legacy `Application.INTERVIEW` pipeline value as a scheduled appointment.
Proposals, participants, responses, calendar artifacts, reminders and events
have their own optimistic version and idempotency boundaries. Instants are
stored in UTC together with validated IANA time zones; DST-invalid or stale
proposals fail closed. Candidate participation and RSVP remain candidate-
controlled. Employer reads and mutations additionally require a current
Company Membership plus the existing Application/Job assignment boundary;
Viewer access stays read-only.

ICS generation is an internal deterministic export, not proof of external
calendar delivery. Reminder work uses the Phase-23 lease/retry/dedupe/DLQ
contract and minimal typed e-mail templates. A kill switch blocks new tracker
and scheduling mutations and reminder delivery while retaining owner reads,
privacy export and safe cancellation/roll-forward paths. No ATS ingestion,
mailbox reading, video hosting, Calendar provider, automated selection or
external outcome verification is introduced.

The technical Local-/CI completion does not satisfy the phase's moderated
Demand thresholds. Any `ALLOWLIST` or `LIVE` promotion requires an explicit
track-specific Product decision, current Privacy/Retention and Operations/
Support evidence, Phase-29 UX evidence, and provider/legal approval where an
external adapter is added.

**Why:** A click, a self-reported outcome, a recruiting pipeline label and a
real calendar appointment are materially different facts. Keeping them
separate avoids false product claims, preserves Candidate agency and prevents
one optional workflow from widening tenant or activation authority.

Referenced by: Phase 22/23/25/28/29/31/32; `REQ-REC-003`,
`REQ-REC-028-002`, `REQ-REC-028A-001`, `REQ-REC-028B-001`,
`STH-015`, `STH-016`.

# Phase 13 — Job Boosts

> **PortalGERM target status: NOT IMPLEMENTED.** Any named files/tests/results below are targets. Boosts require a validated job target and may rank only within relevant results (ADR-003/017/019).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 13. Read [99-rules-quickref.md](./99-rules-quickref.md) §16 before starting.

## Goal

Implement the full job-boost lifecycle: purchase via included credits or one-time products, scheduling, status transitions, search ranking influence, and the public "Geboostet" label. **Boosts must not affect Fair-Job-Score.**

## Prerequisites

- [ ] Phase 02 `JobBoost`, Credit Ledger, versioned `Product`, `Order` and fulfillment-context models
- [ ] Phase 03 `lib/search/ranking`
- [ ] Phase 04 mock payments
- [ ] Phase 07 public Job surfaces and Phase 10 authorized Employer Job flows
- [ ] Phase 12 exactly-once checkout/Fulfillment registry; this phase owns and registers the validated Boost handler

## Deliverables (checklist)

### Boost domain helpers

- [ ] `lib/billing/boosts.ts`:
  - `computeBoostStatus(boost, now): BoostStatus` uses the half-open interval `[startsAt, endsAt)`: `SCHEDULED` if `now < startsAt`, `ACTIVE` if `startsAt ≤ now < endsAt`, `EXPIRED` if `now ≥ endsAt`. Cancelled is set explicitly. Add `isBoostActiveAt` and exact fixed-clock/back-to-back boundary tests in this phase.
  - `getEffectiveBoostStatus(boost, now)` / `isBoostActiveAt` are pure and drive every read; no public GET writes status
  - `syncBoostStatusProjection({ now })` is an explicit idempotent maintenance command for operations/demo evidence, with audit where a persisted lifecycle transition changes

### Buying a boost

- [ ] On `/employer/jobs` and `/employer/jobs/[id]` add a "Job boosten" action *(both link to `/employer/jobs/[id]/boost`; dashboard recommendation links there too)*
- [ ] Modal or dedicated page flow. Preferred MVP path: dedicated page `/employer/jobs/[id]/boost` to keep state and server validation simple.
  1. Show job preview + Fair-Job-Score
  2. Choose the cash ProductVersion: 7 days (CHF 79) / 30 days (CHF 199). A `JOB_BOOST` credit is a frozen `BOOST_7D_V1` unit and can fund **only seven days**; 30 days always uses the 30-day ProductVersion/order and cannot rationally consume one generic unit.
  3. For seven days, show "Boost-Credit verwenden" when `fundableBySource` has a current Plan or Admin unit. Redemption follows ADR-028 automatically `PLAN_ALLOWANCE → ADMIN_GRANT`, then earliest expiry/creation/id; P0 has no purchased Boost-credit pack. The UI previews the exact source/expiry before confirmation and the result names it. Consumption appends one `CreditLedgerEntry{CONSUME,-1}` referencing that Grant; JobBoost rows are effects, never usage counters. No implicit duration/source substitution exists.
  4. Otherwise—or for 30 days—use "Mit Zahlung boosten" via Phase 12 checkout with the selected active ProductVersion.
- [ ] P0 has **activate now only**: server sets `startsAt` from its injected/database `now` and `endsAt = startsAt + ProductVersion duration` or exactly seven days for `BOOST_7D_V1`; there is no client start-date input. Credit eligibility is checked at consumption (`startsAt < grant.validTo`); once consumed, source expiry during the seven-day window does not truncate/refund the Boost. It rejects when the Job expires before `endsAt`. `SCHEDULED` remains a read/test state for future P1 scheduling fixtures, not a purchasable P0 option.
- [ ] Server action validates an authorized Company/Assignment-scoped Job, canonical public eligibility and current approved revision. PostgreSQL exclusion/serialized transaction rejects overlap with **any non-CANCELLED** Boost interval for that Job using half-open `[startsAt,endsAt)`; adjacent intervals are allowed. It never checks only `ACTIVE` status.
- [ ] On success, one transaction locks/consumes the eligible Grant or paid Order funding, checks non-overlap/Job eligibility, appends the Ledger entry and creates exactly one `JobBoost` with source/version/idempotency. Parallel attempts cannot overconsume or overlap.
- [ ] Sends mock email `job_boost_activated`
- [ ] Audit `JOB_BOOST_ACTIVATED`

### Boost cancellation (admin / employer with reason)

- [ ] Employer can cancel an active boost (no refund in MVP — noted in UI: "Keine Rückerstattung im MVP")
- [ ] Admin can cancel for moderation reasons via `/admin/jobs` list action "Boost beenden"
- [ ] Action sets `status = CANCELLED`, audit `JOB_BOOST_CANCELLED`

### Search ranking integration

- [ ] In `lib/search/ranking.ts`, first apply canonical public/filter eligibility and relevance. Search first-page sponsored IDs are the at-most-three active relevant Boosts ordered `(relevanceTier DESC,relevanceScore DESC,fairScore DESC NULLS LAST,publishedAt DESC,id ASC)` independent of organic sort. The remainder uses selected organic sort. Signed cursor carries query/config/version, `rankingAsOf`, selected sponsored IDs and organic tuple; later pages recheck public eligibility, exclude those IDs even after Boost expiry and add zero new slots. Homepage uses its separate at-most-two snapshot (ADR-003).
- [ ] Only relevant active boosts enter the bounded sponsored zone; within it use a stable relevance/Fair-Job-Score/date/id order. Organic results follow the selected sort, and the complete ordering is calculated before pagination.
- [ ] **Fair-Job-Score must NOT be modified by boosts** — covered in `tests/boosts.test.ts`

### Public label

- [ ] On every job card and on the job detail header, render a "Geboostet" badge when there is an active boost *(`hasActiveBoost`/`jobHasActiveBoost` via time-window check; `<BoostedBadge>`)*
- [ ] Tooltip text: "Dieser Job wird vom Arbeitgeber für mehr Sichtbarkeit hervorgehoben."
- [ ] Ad-disclosure must be visible — never hide sponsorship
- [ ] Admin moderation tools see boost status separately *(active boosts flagged "Geboostet bis …" + "Boost beenden" on `/admin/jobs`)*

### Value-first recommendations (used in `/employer/dashboard` + Admin Business Cockpit)

- [ ] `JOB_CONTENT_DIAGNOSTIC` first follows `COCKPIT_SIGNAL_POLICY_V1`: rolling 30d, ≥100 non-sponsored detail-view sessions, apply-intent/detail <200 bps, published ≥14d, with a blocker of Fair v2 <70, missing salary/process or broken/`LONG` apply path. Missing sample produces no claim/card.
- [ ] `BOOST_TEST_CANDIDATE` exists only with those blockers absent, eligible `PUBLISHED`/ACTIVE+VERIFIED Job, no effective Boost, the same ≥100 organic sample and conversion below `max(200 bps,floor(clusterBaselineBps/2))`. Baseline is the rolling-90d median of ≥20 same-pair LIVE Jobs each with ≥100 organic views. Missing baseline creates no card. The card names evidence, cost/duration, Sponsored label, expected metric and +14d follow-up; it never promises applications.
- [ ] High-demand category alone creates a supply-acquisition task, not a Boost recommendation. Subjective hiring-goal signals are ignored in MVP.
- [ ] Tests prove ordering (diagnostic before Boost), blocking factors and that payment/plan never alters Fair Score or relevance eligibility.

### Documentation hooks

- [ ] In README, document: "Boosts beeinflussen die Sichtbarkeit, niemals den Fair-Job-Score."

## Files to create / modify

- `lib/billing/boosts.ts`
- `app/employer/jobs/[id]/boost/{page.tsx,actions.ts}` (or modal-driven action — pick one)
- `components/billing/BoostDialog.tsx`
- `lib/search/ranking.ts` updated with relevant-first, capped sponsored-zone ordering before pagination
- Job card components updated to render the "Geboostet" badge

## Rules to respect (from `99-rules-quickref.md`)

- §16 — boost ranking, `Geboostet` label everywhere, no hidden sponsorship
- §11 — Fair-Job-Score is independent of boosts
- §15 — included boosts are consumed server-side through the period Grant/Ledger (derived balance must not go negative)
- §10 — IDOR: only owners/admins of the company can boost their jobs
- §22 — boost-related events feed analytics dashboards (purchases, redemptions)

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] Buying a 7-day Boost on a Pro company with one included allowance appends exactly one `PLAN_ALLOWANCE` consume and creates one seven-day JobBoost; 30-day redemption by one credit is denied. Plan→Admin fallback, exact grant-expiry boundary, mid-window source expiry, no-refund and parallel balance-1 tests yield one effect and never a negative balance
- [ ] Buying a Boost without an included Grant creates a server-quoted Order whose stored FulfillmentContext contains the authorized `jobId`; Phase-12 confirmation invokes the Phase-13 handler exactly once and creates the eligible JobBoost
- [ ] Search fixtures prove an irrelevant boost never outranks a relevant organic job, caps are exactly Search=3 first page/Homepage=2, later cursors replenish zero sponsored slots, every active placement is labelled and pages contain no gaps/duplicates/repeats
- [ ] At `now >= endsAt`, the pure effective predicate immediately removes sponsored placement without a GET-side write; the explicit sync command changes the stored projection at most once and records evidence
- [ ] Owning-phase test (re-run in Phase 17) asserts `calculateFairJobScoreV2` returns the same result and its TypeScript input excludes `JobBoost` entirely

## Common pitfalls

- Adding `boostActive` as an input to Fair-Job-Score "to make boosting feel valuable" — **forbidden**
- Forgetting to label every surface with "Geboostet" (homepage featured, similar jobs, canton landings)
- Allowing recruiters to boost without OWNER/ADMIN — gate it
- Letting included boosts go negative (race condition) — wrap in a transaction with the conditional update
- Letting boosts affect ranking on `/employer/jobs` admin lists — ranking is for public discovery only; admin views show neutral order

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Sell measurable time-bounded reach while protecting organic relevance, fairness and sponsorship transparency. |
| Roles / requirements | Owner/Admin purchase/cancel; public sees label; REQ-BST-001, SCORE-001, MKT-001/002. |
| Prerequisites | 07, 10, 12; ADR-003/017/019. |
| Routes/actions | Boost from an authorized Job; checkout with server-stored target; activation/scheduling/cancel; badge on every public Job surface; no changed Admin ordering. |
| Data | JobBoost with window/status/source/order/ledger and validated job target; non-overlap strategy. |
| Validation | Own eligible Published Job, duration/ProductVersion; P0 `startsAt=server now`, full duration before Job expiry, job still eligible at fulfillment; non-CANCELLED interval exclusion and stable half-open boundaries. |
| Authorization/audit | Owner/Admin company access; included/purchased funding atomic; cancellation reason; all lifecycle events audited. |
| UX/mobile | eligible/ineligible, already active, read-only scheduled fixture, checkout pending/success, cancelled/expired; no P0 schedule control; exact duration/cost and “Geboostet” at every surface. |
| Seed | active/scheduled/expired/cancelled, paid/included, relevant/irrelevant query and job closes during checkout. |
| Tests | parallel active/scheduled non-overlap, adjacent intervals allowed, target swap, exact start/end/Job-expiry boundary, no client startsAt, ranking before pagination, label inventory, Fair score byte/value unchanged and paid types excluded. |
| Verification | E2E-07 and DB/clock/ranking assertions. Expected only active relevant Boost changes sponsored placement; expiration removes effect. |
| Risks / limitations | No application guarantee; lifecycle worker later, explicit command/projection in MVP; separate Featured inventory is P2 after reach/inventory evidence. |
| Definition of Done | Bought/included boost grants exactly one eligible window, always disclosed, never alters Fair score or irrelevant eligibility. |

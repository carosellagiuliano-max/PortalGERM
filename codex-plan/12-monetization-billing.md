# Phase 12 — Monetization & Billing

> **PortalGERM target status: NOT IMPLEMENTED.** Every concrete function/result below is a target acceptance contract, not evidence. This phase is the sole Billing/Fulfillment/Katalog owner (ADR-019).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 12. Read [99-rules-quickref.md](./99-rules-quickref.md) §13, §14, §15 before starting.
>
> **MVP boundary:** mock checkout only. Stripe env vars remain placeholders in `.env.example`; no Stripe webhook, hosted checkout, real charge, or real subscription renewal is implemented in the MVP.

## Goal

Wire the monetization layer end-to-end: server-side feature gating, mock checkout, order/invoice creation with CHF VAT, subscription activation, credits, and the four `/employer/billing/*` routes. After this phase, an employer hitting a plan limit sees an upgrade modal, completes a mock payment, gets an invoice, and the limit increases.

## Prerequisites

- [ ] Phase 03 helpers (`lib/billing/feature-gates`, `lib/billing/usage`, `lib/billing/vat`, `lib/billing/invoice-number`)
- [ ] Phase 04 mock payment + email adapters
- [ ] Phase 05 seeded plans + products + sample subscriptions
- [ ] Phase 10 employer portal shells
- [ ] Phase 11 admin operations shell; Billing pages/actions are completed here through the shared Billing domain

## Deliverables (checklist)

### Server-side feature gating (mandatory)

- [ ] In every employer mutation that affects a gated feature, call the matching gate from `lib/billing/feature-gates`:
  - Publishing a job → `canPublishJob({ effectiveEntitlements,currentActiveCount,jobId,revisionValidThrough,additionalJobPermit? })`
  - Reading advanced analytics → target `canUseAdvancedAnalytics(entitlements)` integration in the Employer analytics route
  - Submitting a Talent Radar contact request → target `canRequestContact(...)`; the contact mutation and its integration test are owned by Phase 14
  - Triggering a **commercial employer** XML/JSON import → `canUseEmployerImport({ effectiveEntitlements,currentPlanSlug,companyId,sourceId,accessGrant? })` remains deny-by-default in P0 and requires the separate source-scoped `ImportAccessGrant` after its P1 release. Phase-11 Platform licensed-supply ingest uses a separate Admin capability/source-rights policy and no Billing entitlement.
  - Adding/inviting a recruiter seat → the Phase-10 Team mutation calls `canAddRecruiterSeat` and Phase 12 verifies it still derives rights from the same effective entitlement source
- [ ] When a gate returns `{ allowed: false, reason, suggestedProductSlug?, suggestedPlanSlug? }`:
  - Server action returns a typed error consumed by `<UpgradeDialog>` on the client *(JobState `{error, suggestedPlanSlug}` → `components/billing/UpgradeDialog.tsx` opened from `JobWizard`/`JobStatusActions`)*
  - **Never silently fail.** Always show why and link to checkout/pricing

### `/employer/billing` (overview)

- [ ] Phase 12 updates `app/employer/layout.tsx` to add working Billing navigation, `app/admin/layout.tsx` to add Billing/Katalog/Analytics entries, and signed-in `/pricing` CTAs to point only to eligible checkout or Sales routes. No earlier phase exposes a dead link.
- [ ] Cards: aktueller Plan, Aktivjob-Auslastung (`X / Y`), monatlicher Preis, aktuelles Periodenende (keine automatische Erneuerungszusage), offene Rechnungen. Credit read models show separately (a) included current-period Talent contacts/Boosts used and remaining, (b) purchased-pack/admin-grant remaining by source/expiry, (c) total currently fundable, plus expiring-soon warning and ledger history; they never collapse funding sources into one misleading `used/limit`.
- [ ] Quick actions: Plan upgraden · fulfillable P0-Produkte kaufen · Rechnung ansehen (HTML mock) · Abo kündigen (mock) · Plan wechseln (mock). Contact Packs are direct Phase-12 purchases. Boost is shown only as „auf einer Stelle auswählen“ and checkout is server-denied until Phase 13 registers the validated handler; inactive P1/P2 products have no purchase CTA.
- [ ] Table: letzte Bestellungen (status, amount, product/plan, date)

### `/employer/billing/checkout`

- [ ] Entry may select `?plan=<slug>` or `?product=<slug>` but the server creates an immutable Quote/Order from the active PlanVersion or ProductVersion and requires a registered fulfillment handler plus validated target context. A Boost without the Phase-13 handler or without an eligible owned `jobId` is rejected before Order creation.
- [ ] Server validates eligibility/transitions: P0 self-service Plan checkout is monthly Starter/Pro only; Free is the no-Subscription fallback, Business/Enterprise/annual versions route to qualified Sales until their P1 gate, and Success Fee/custom/same-plan is rejected. Contact Packs require current Talent-Radar access and grant credits only; Free/Starter receive an upgrade result and no Order. It computes net/VAT/total in Rappen; client query values never become authoritative.
- [ ] `/employer/billing/profile` lets Owner/Admin maintain `CompanyBillingProfile`: legal name, billing contact email, street, postal code, city, country (`CH` only P0), optional UID/VAT number. Checkout requires a complete server-loaded profile; Recruiter/Viewer/foreign Company is denied. It snapshots the validated address/contact into Order/Invoice and never trusts query/client totals or a client Company id.
- [ ] UI: order summary (product/plan name, description, net, VAT, total in CHF), immutable preview of the server-loaded billing profile, VAT note, "Mock bezahlen" button, "Abbrechen"; incomplete profile links to the profile form and creates no Order
- [ ] Billing creates the Order first, then calls `paymentProvider.createCheckout({ orderId, idempotencyKey, ... })` and receives a local checkout URL
- [ ] The returned `/mock/checkout/[orderId]` route loads only an Owner/Admin-authorized pending Order by server-derived Company scope, displays its immutable snapshot and posts confirmation to the shared Billing command; unknown/foreign ids return safe 404. It is explicitly dynamic, `private,no-store`, `noindex,nofollow`, strict-referrer and never emits Order ids into canonical/referrer/log metadata. It is not a public provider-debug route.
- [ ] The local confirmation invokes the Billing-domain `confirmMockPayment({ orderId, idempotencyKey })`, which in one exactly-once transaction records provider/payment state, creates immutable Invoice/lines, appends Subscription/Entitlement or Credit Ledger effects, or dispatches an eligible product handler with the stored target context. Notifications occur only after commit; every transition is audited.
- [ ] Redirect to `/employer/billing/success?order=<id>`

### `/employer/billing/success`

- [ ] Confirmation card: "Zahlung erfolgreich (Mock)"
- [ ] Show order details + link to invoice
- [ ] If a plan was activated, show the snapshotted new limits from `order.planVersion`/its entitlement snapshot, never a mutable Plan row

### `/employer/billing/invoices`

- [ ] List of `Invoice` rows for this company; columns: number, issue date, due date, status, total, "Anzeigen" button
- [ ] Detail page renders an HTML invoice (no PDF): billing-address/line snapshots, net, snapshotted tax rate/VAT, total CHF and status; cross-company and nonexistent ids return the same safe 404
- [ ] Status transitions are visible and any allowed manual Mock transition is performed in the Phase-12 Admin Billing routes via the same use case; never editable by employer

### `/employer/billing/usage`

- [ ] Per-resource progress bars:
  - Aktive Jobs: `X / Y`
  - Talent-Radar-Kontakte verwendet diesen Zyklus: `X / Y`
  - Inkludierte Boosts verbleibend
  - Recruiter-Seats verwendet
- [ ] Warning banner when ≥80 % usage with a CTA "Plan upgraden"

### Upgrade dialog component

- [ ] `components/billing/UpgradeDialog.tsx` — the only upgrade component, accepting `{ reason, suggestedPlanSlug?, suggestedProductSlug? }`
- [ ] Renders a server-built read model from the effective `PlanVersion`/`ProductVersion` *(German labels + CTA; no DB access in the client modal)*
- [ ] CTA button → `/employer/billing/checkout?plan=...` or `?product=...`

### Subscription lifecycle (mock)

- [ ] Implement ADR-028 `BILLING_POLICY_V1` exactly. New Plan subscription/change/cancel requires Company `OWNER` (Admin may still buy eligible one-time Products and edit Billing profile). Free→Starter/Pro opens a clamped Zurich calendar-month period. Same-plan rejects. Starter→Pro is an immediate, remaining-second prorated delta checkout with prorated-floor allowances and an ACTIVE successor ending at the old boundary; the replaced row ends at the same instant. A paid Pro→Starter downgrade creates one pending `SubscriptionChangeSchedule` and a full-price `SCHEDULED` successor beginning at the old boundary; other paid-plan transitions remain Sales/P1. No two rows are effective at one instant.
- [ ] `SubscriptionChangeSchedule` is the canonical future-change truth; there is no stored `cancelAtPeriodEnd` Boolean. A pending CANCEL schedule projects the current row to `CANCELLING`; UI derives “kündigt per” from that schedule. At its boundary `CANCELLING→CANCELLED` (explicit user cancellation, no successor/Free fallback). An ACTIVE paid term that simply ends without renewal becomes `EXPIRED`. A downgrade performs old `ACTIVE→EXPIRED` and successor `SCHEDULED→ACTIVE` at the same injected instant. These states are mutually exclusive and every transition has one Event/Audit; projector retries are idempotent.
- [ ] Downgrade/cancel preview captures retained Membership ids independent of the initiating user. The Owner may choose up to the target Seat limit but must retain at least one active Owner; deterministic default is oldest active Owner first, then remaining active members by `OWNER→ADMIN→RECRUITER→VIEWER`, `joinedAt`, `id`. At the boundary non-retained Memberships append `PLAN_LIMIT_SUSPENDED`, and all still-pending Invitations are revoked with events so they cannot linger beyond the limit. Jobs above limit stay readable/public only to their already bounded (maximum 90-day) `validThrough`; publish/reactivate is blocked until usage is below limit. Radar/import/new contacts stop while historical Applications/Invoices/accepted Conversations remain readable.
- [ ] Effective paid Subscription predicate is half-open: `currentPeriodStart <= at && at < currentPeriodEnd` for eligible status. Benefits exist at `currentPeriodEnd - 1 instant` and **not** at/after `currentPeriodEnd`; the explicit projector may update status but is not required for access denial.
- [ ] "Plan wechseln" creates the ADR-028 server quote with period/proration/seat-impact snapshots; exactly-once confirmation appends SubscriptionEvents and immediate or scheduled successor state, never stacks two effective plans
- [ ] Renewal mock: nightly job is **out of scope** for MVP — document as known limitation; admin can mark renewal manually if needed *(ADR-004)*

### VAT & invoice rules

- [ ] All amounts are **integer Rappen** end-to-end (`amountRappen`/`vatAmountRappen`/`totalRappen`); convert to CHF only at the display boundary (see [decisions.md](./decisions.md) ADR-002)
- [ ] Compute and snapshot VAT per InvoiceLine with `Math.floor(net*rateBasisPoints/10000 + 0.5)` and set Invoice totals only by summing lines; never recalculate VAT on aggregate net. Golden multi-line cases lock any one-Rappen difference.
- [ ] Select the reviewed effective `TaxRateVersion` server-side (`810` basis points is the current 8.1 % planning fixture), snapshot it on Order/Invoice, and fail closed when no approved rate exists; Tax review remains mandatory
- [ ] Invoice number format: `STH-YYYY-NNNNN` (sequential), unique
- [ ] Invoice statuses: `DRAFT → ISSUED → PAID|VOID`; an exactly-once successful mock payment issues and pays its invoice in the same Billing transaction. Overdue is derived from an unpaid issued invoice's due date. Offline/manual mock settlement, if enabled for Admin, invokes the same confirmation policy rather than editing totals/status directly.

### Admin Billing and versioned catalog (owned here)

- [ ] `/admin/billing` renders canonical MRR/revenue/plan/invoice summaries from Phase-12 queries with definitions and time window
- [ ] `/admin/orders/[id]` and `/admin/invoices/[id]` inspect immutable snapshots/events; any allowed manual Mock transition uses the same idempotent Billing use case and mandatory reason/audit
- [ ] `/admin/plans` and `/admin/products` create future `PlanVersion`/`ProductVersion` rows, schedule/deactivate availability and never rewrite an existing Order/Invoice/Subscription
- [ ] Version scheduling is serialized and database-constrained: half-open effective ranges for one Plan/Product cannot overlap; approved Tax ranges cannot overlap per jurisdiction/type. Exact-boundary selection is deterministic and zero/ambiguous effective versions fail closed.
- [ ] Success Fee remains server-disabled for every role; P1/P2 ProductVersions remain unavailable until their recorded release decision
- [ ] `/admin/companies/[id]` can append a typed, expiring Credit grant through the shared Ledger service with reason/idempotency; no balance edit
- [ ] The same route exposes `reverseCreditConsume({ entryId, reason, idempotencyKey })` only to `ADMIN_CREDIT_REVERSE`. It locks a negative CONSUME entry, requires the same Company/account/type, no prior reversal and a still-recognized original source, then appends the exact positive inverse `REVERSAL{reversesEntryId}`; it never edits/deletes history or automatically undoes Contact/Boost business state. Retry returns the same row; mismatch/second reversal is denied and every outcome is audited.

### P1 product release contracts (inactive until their own gate)

- [ ] `additional-job-30d` (REQ-BIL-008) is eligible only for an effective Starter subscription, one Company-owned non-public Job with approved/current Revision and `validThrough <= paidAt + 30 days`, and no other effective Permit. Its OrderLine context is the authorized `targetJobId`; exactly-once fulfillment creates a separate `AdditionalJobPermit{companyId,targetJobId,orderLineId,validFrom=paidAt,validTo=paidAt+30d}`. `canPublishJob` recognizes it only for that target and never merges it into global Entitlements; Free/Pro/Business/Enterprise, transfer, overlap, later expiry and mismatch are denied. It costs `12900` Rappen, cannot auto-publish, and expiry never rewrites history.
- [ ] `import-setup` (REQ-BIL-009) is a sales/Admin-approved P1 service, not an open upload purchase. Before quote, Phase 11 creates an unexpired `ImportSetupApproval{APPROVED}` after source-rights/mapping review. OrderLine context is that approval id; `75000`-Rappen confirmation atomically marks it `USED` and creates a separate `ImportAccessGrant` for exactly that Company/source and 12 Zurich calendar months. `canUseEmployerImport` additionally requires a current Business/private Enterprise contract, matching current Grant and Phase-11 import policy; it is never merged into `getEffectiveEntitlements`, and Free/Starter/Pro are denied. Fulfillment creates no Job/parser run, is exactly-once, max one current Grant per Company/source and has no automatic refund.
- [ ] Featured Job/Employer, Newsletter and Social stay P2 inactive without handler/CTA. They require a later inventory/channel Requirement and may not reuse Job Boost semantics silently.

### Revenue analytics integration

- [ ] Implement `lib/analytics/admin-metrics.ts` queries used by Phase 11 admin pages and `/admin/business-cockpit`:
  - MRR = sum of effective paid subscriptions' immutable monthly-equivalent recurring snapshots at the measurement instant; custom contracts without recorded value are separate and one-time Orders excluded (ADR-011)
  - Monthly Mock-paid net revenue = sum of immutable InvoiceLine `netRappen` whose Invoice received its first successful `PAID` PaymentEvent in `[monthStart,nextMonthStart)` in `Europe/Zurich`; VAT, VOID/failed/duplicate events are excluded. It includes recurring and one-time lines and is labelled Mock cash-basis volume, not bank settlement or accrual accounting.
  - Product revenue this month = the ProductVersion subset of that same paid-line rule; recurring Plan revenue and one-time Product revenue are displayed separately
  - Active subscriptions count
  - Free vs paid employers
  - Boost sales count + revenue
  - Talent-Radar contact-pack sales count + revenue
  - Invoice status breakdown
- [ ] All deterministic SQL/Prisma queries — no estimates; MRR must match a manual sum in verification. The cockpit shows MRR run-rate, monthly Mock-paid Plan lines and monthly Mock-paid Product lines side by side; it never adds MRR to monthly paid volume and calls the sum „Umsatz“.

### P1 commercial retention and funnel owner (implemented after P0 Billing gate)

- [ ] `runCommercialLifecycleSignals({ now })` is an explicit idempotent command (later Worker target) that creates typed `SystemTask` + in-product Notification/Mock email for exact reason/window keys: subscription period end at 30/14/7 calendar days, cancelling subscription, purchased or included credits expiring within 14/7 days, paid Company with no Job/Application/Employer login activity for 30 days, and ≥80% current limit. It uses one Zurich business clock, one task per Company/reason/boundary, stores evidence window/reference/owner/due/outcome and never includes candidate/message content. A resolved/dismissed task is not silently recreated for the same boundary.
- [ ] `/admin/analytics` and a linked Business-Cockpit section implement the Phase-03 versioned Candidate activation, Employer activation, Search→Detail→Apply, Lead→Qualified→Won and Checkout funnels. Filters are bounded cohort date, launch Region×Beruf cluster, allowlisted channel and Plan; small counts are suppressed, DEMO/TEST is excluded from market KPIs outside demo mode, and every card displays metric version/window/denominator. This P1 read model is the owner for strategy funnels/churn signals; Phase 11 owns only operational queues.

## Files to create / modify

- `app/employer/billing/{page.tsx,profile/{page.tsx,actions.ts}, checkout/{page.tsx,actions.ts}, success/page.tsx, invoices/{page.tsx,[id]/page.tsx}, usage/page.tsx}`
- `app/mock/checkout/[orderId]/{page.tsx,actions.ts}`
- `components/billing/{BillingOverviewCard.tsx, CheckoutSummary.tsx, InvoiceView.tsx, UsageBars.tsx, UpgradeDialog.tsx, CancelSubscriptionDialog.tsx}`
- `lib/analytics/{admin-metrics.ts,commercial-signals.ts}` (canonical financial/funnel/retention queries and command)
- `app/admin/{billing,orders,invoices,plans,products,analytics}/**` (read and mutation routes owned by this phase); update `app/{employer,admin}/layout.tsx` and signed-in CTA branches in `app/pricing/page.tsx`/pricing components
- Server actions injecting feature gates around: every transition to `PUBLISHED` (including reactivation/republication), send Talent Radar contact request, run import. Drafting and submitting for review never consume the active-job quota.

## Rules to respect (from `99-rules-quickref.md`)

- §13 — exact prices; success-fee remains disabled
- §14 — mock payment first; Stripe is placeholder; HTML invoice mock is enough
- §15 — gate every limit server-side; never silent failure; always show upgrade prompt
- §10 — checkout actions validate company ownership, never trust client `companyId`
- §39 — buying a Contact Pack appends a typed Credit Ledger grant; Phase 14 atomically consumes it with funding source

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] `employer@demo.ch` (Pro plan in seed) sees correct usage bars on `/employer/billing/usage`
- [ ] A seeded Free Basic employer trying to transition a 2nd job to Published is blocked atomically and receives a structured `LIMIT` result rendered by the shared UpgradeDialog
- [ ] Quota tests use the canonical `isQuotaConsumingJob` predicate and one injected clock: PAUSED/APPROVED do not count, exact `expiresAt` no longer counts, and two parallel `APPROVED → PUBLISHED` attempts at one remaining slot yield exactly one success under the Company quota lock
- [ ] Mock checkout for `Starter` plan flips `Order` to `PAID`, creates `Invoice` (correct VAT), creates/updates `EmployerSubscription`, sends 3 mock emails (payment_received, invoice_issued, subscription_activated) *(Invoice 14900/1207/16107; sub→Starter; 3 EmailLog templateKeys present)*
- [ ] Mock checkout for `contact-pack-10` appends exactly one `TALENT_CONTACT` Credit Ledger grant of 10 with ProductVersion/Order source; derived balance increases by 10
- [ ] The same Contact Pack request from Free/Starter or a suspended/no-Radar Company creates 0 Orders/Ledger entries; credits present without Radar entitlement still produce 0 candidate queries
- [ ] Invoice HTML view loads under `/employer/billing/invoices/[id]` for the company's invoices only; another company's and a nonexistent id return indistinguishable safe 404 responses
- [ ] An Order cannot be created until the authorized CompanyBillingProfile is complete; after payment, changing it does not change the Invoice snapshot. Profile and Invoice IDOR tests return safe 404/denial and expose no cross-tenant address.
- [ ] Cancelling creates one pending CANCEL schedule and projects `CANCELLING` without a duplicate Boolean; clock tests prove rights before the boundary and `CANCELLED`/Free fallback exactly at it, while natural lapse is only `EXPIRED` and downgrade activates its `SCHEDULED` successor
- [ ] Admin business cockpit MRR matches the independently calculated sum from the versioned Seed manifest for the test clock; no hardcoded historic total is used
- [ ] Monthly Mock-paid net/product/plan totals reconcile to first-paid InvoiceLine fixtures and never double-count retry PaymentEvents or add MRR; exact Zurich month boundary is tested
- [ ] P1 signal tests at 30/14/7 and expiry boundaries create one task/notification per reason, no sensitive payload and no duplicate on retry; `/admin/analytics` fixture funnels exactly reproduce Phase-03 definitions and suppress small cohorts

## Common pitfalls

- Performing post-payment side effects in a route handler instead of inside `confirmMockPayment` → easy to drift between mock and Stripe later
- Float arithmetic for VAT — use integer rappen internally
- Forgetting that buying a Plan should **replace** the active subscription, not stack — handle transitions
- Forgetting that recruiters cannot purchase — gate to OWNER/ADMIN of the company
- Missing audit logs around subscription state changes
- Not handling success-fee products: they must reject in the checkout server action ("requires legal review")

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Convert proven employer usage into transparent recurring/one-time revenue without inconsistent rights, money history or double grants. |
| Roles / requirements | Company Owner for Plan/subscription commands; Owner/Admin for eligible one-time Products and Billing profile; Platform Admin via the same reasoned service; REQ-BIL-001–009, EMP-005, TR-004, SEC-003. |
| Prerequisites | 08, 10, 11; ADR-002/019/025/028. Real Tax/Legal approval remains a launch gate, but P0 rounding/downgrade/credit implementation is no longer undecided. |
| Routes/actions | Employer billing profile/overview/checkout/success/invoices/usage, local mock checkout; Admin billing/orders/invoices/plans/products plus P1 analytics. Quote, create/confirm/cancel Order, exactly-once fulfill, subscription change/cancel, ledger grant/consume, invoice read, commercial signal command. |
| Data | PlanVersion/ProductVersion, Entitlement, Subscription/Event, CreditAccount/Ledger, Order/Line/PaymentEvent, Invoice/Line and immutable price/tax/address/target snapshots. |
| Validation | Server catalog/price, company/product/target eligibility, idempotency keys, allowed transitions, time periods; client amount ignored/rejected. |
| Authorization | Plan checkout/change/cancel is Owner-only; eligible one-time Product checkout and Billing-profile maintenance allow Owner/Admin; Recruiter/Viewer denied; tenant-scoped reads safe 404; Platform Admin capability/reason/audit; Success Fee denied for every actor. |
| Transaction/audit | Payment state + Invoice + fulfillment + ledger/entitlement + Audit atomic; notification after commit/outbox. Admin uses identical command. |
| UX/mobile | current plan, separated included/purchased/admin usage and expiry, billing-address completeness, clear limit reason, quote/VAT/period/renewal, pending/failed/cancel/success, same-plan, downgrade impact, `currentPeriodEnd`, double-submit safe; one shared UpgradeDialog. |
| Seed | monthly plan/catalog versions plus inactive annual research fixtures, Free limit, active/cancelling/expired, failed/cancelled/paid Orders, expiring Credits and invoice cases. |
| Tests | exact VAT/rounding, complete/authorized BillingProfile + immutable address/line snapshots, OrderLine XOR/context, Plan/Product/Tax non-overlap + adjacent-boundary/concurrent scheduling, double/concurrent confirm, rollback/partial failure, entitlement precedence/time travel, active-job concurrency, separated ledger source/balance/concurrency/expiry, invoice IDOR, exact period boundary, same-plan/cancel/downgrade, revenue reconciliation, P1 retention/funnel definitions, Admin reuse. |
| Verification | E2E-03 plus Postgres race tests and DB assertions. Expected exactly one Invoice/Fulfillment per idempotency key and balance ≥ 0. |
| Risks / limitations | Real tax invoice, VAT liability, refund/chargeback/dunning/real renewal remain Legal/Finance/Post-MVP; Mock payment is not money movement. |
| Definition of Done | Billing is sole rights/money source, historical documents stable, every gate server-enforced, Mock flow end-to-end and honestly labelled. |

# Phase 04 — Mock Adapters

> **PortalGERM target status: NOT IMPLEMENTED.** A mock must persist truthful local behavior. The Payment port never accepts an authoritative client amount and does not own product fulfillment (ADR-019).

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 04. Read [99-rules-quickref.md](./99-rules-quickref.md) §24, §33 before starting.
>
> **MVP boundary:** mock adapters only. Real-provider files may exist as explicit placeholders, but they must not be selected by env keys and must not call real external APIs during MVP implementation. See [decisions.md](./decisions.md) ADR-014.

## Goal

Build the adapter pattern for every external service. Each adapter exposes a typed interface and ships with a **working mock** implementation. Persistent effects are written by the owning domain transaction (or by an adapter-specific log repository where no cross-domain transaction is claimed), never by fake UI. Real-provider files exist as **placeholders** only.

## Prerequisites

- [ ] Phase 02 done (versioned Order/Invoice, EmailLog/Notification, JobBoost, Entitlement/Credit Ledger, Import and OccupationCodeVersion models exist)
- [ ] Phase 03 done (`lib/db`, `lib/audit`, `lib/billing/vat`, `lib/billing/invoice-number` exist)

## Deliverables (checklist)

### `/lib/providers/payments`

- [ ] `lib/providers/payments/payment-provider.ts` — interface:
  ```ts
  export interface CreatePaymentOperationInput {
    orderId: string;         // Order + authoritative server-side quote already created by Billing
    idempotencyKey: string;
    successUrl: string;
    cancelUrl: string;
  }
  export interface CheckoutSession {
    orderId: string;
    checkoutUrl: string;     // mock returns the Phase-12 route `/mock/checkout/{orderId}`
    provider: 'MOCK' | 'STRIPE';
  }
  export interface PaymentProvider {
    createCheckout(input: CreatePaymentOperationInput): Promise<CheckoutSession>;
    confirmPayment(input: { orderId: string; idempotencyKey: string }): Promise<{ providerReference: string }>;
    cancel(input: { orderId: string; idempotencyKey: string }): Promise<void>;
  }
  ```
- [ ] `lib/providers/payments/mock-payment-provider.ts` — implementation:
  - is a deterministic, idempotent **pure adapter** for the supplied operation identity: it returns a local checkout URL or confirmation reference and performs no Prisma/database write
  - does **not** record PaymentEvent, Invoice, Subscription, Credit or Boost effects
  - Phase 12 checks existing idempotency state, obtains the deterministic Mock confirmation, then records PaymentEvent + Order/Invoice/Fulfillment/Audit in its one DB transaction under unique constraints. A later real provider needs its own webhook/outbox state machine and does not inherit this Mock atomicity claim.
- [ ] `lib/providers/payments/stripe-payment-provider.ts` — placeholder file exporting an unimplemented `StripePaymentProvider`; it is not wired and must not suggest that adding an env key activates it
- [ ] `lib/providers/payments/index.ts` — Composition Root exports the explicit Mock implementation. No environment-key auto-toggle to a real provider in the MVP.

### `/lib/providers/email`

- [ ] `lib/providers/email/email-provider.ts` — interface:
  ```ts
  export type EmailTemplateKey =
    | 'registration_welcome' | 'password_reset_mock'
    | 'company_invitation' | 'company_verification_status'
    | 'application_submitted' | 'application_status_changed'
    | 'employer_message_received' | 'talent_contact_request_received' | 'identity_revealed'
    | 'job_alert_preview' | 'job_alert_digest_mock' | 'subscription_activated' | 'subscription_renewal_reminder'
    | 'invoice_issued' | 'payment_received'
    | 'plan_limit_reached' | 'job_boost_activated' | 'job_boost_expired'
    | 'talent_radar_credits_low' | 'credits_expiring' | 'usage_warning' | 'demo_request_received' | 'lead_follow_up_reminder'
    | 'job_approved' | 'job_rejected'
    | 'abuse_report_received' | 'credits_granted' | 'privacy_request_changed';
  export interface EmailProvider {
    send(input: { to: string; templateKey: EmailTemplateKey; data: Record<string, unknown>; subject: string }): Promise<{ logId: string }>;
  }
  ```
- [ ] `lib/providers/email/mock-email-provider.ts` — writes `EmailLog` with status `MOCK_RECORDED`, returns `{ logId }` and makes no delivery claim. Render the body via safe German templates.
- [ ] Password-reset/invitation raw tokens exist only in the outbound provider call/test capture; persisted EmailLog/template metadata redacts the token and full URL. Resend rotates/revokes the prior token and dedupes EmailLog by invitation-version/idempotency key.
- [ ] `lib/providers/email/local-mock-mailbox.ts` + `app/dev/mailbox/**` provide the only human/browser delivery path for raw reset/invite URLs. It is enabled only when `NODE_ENV !== 'production'`, `ENABLE_LOCAL_MOCK_MAILBOX=true` and a separate `DEV_MAILBOX_SECRET` authenticates every read; envelopes are process-local or encrypted-at-rest, TTL ≤15 minutes, one-time-readable, `no-store/noindex`, never joined to EmailLog/Audit and cleared on restart. Production startup/build fails if enabled. Playwright uses the same secret-authenticated capture port; public forgot-password UI stays indistinguishable for existing/non-existing accounts.
- [ ] `lib/providers/email/templates/*.ts` — one file per template key returning `{ subject, body }`. **Subjects must be in German.**
- [ ] `lib/providers/email/index.ts` — exports the explicit Mock port

### `/lib/providers/ai`

- [ ] `lib/providers/ai/ai-provider.ts` — interface:
  ```ts
  export interface AiProvider {
    improveJobText(text: string): Promise<string>;
    rewriteInclusive(text: string): Promise<string>;
    shortenRequirements(text: string): Promise<string>;
    suggestFairScoreImprovements(job: { title: string; tasks: string; requirements: string; offer: string; salaryMin?: number; salaryMax?: number; }): Promise<string[]>;
    explainMatch(reasons: string[], missing: string[]): Promise<string>;
    draftRejectionMessage(context: { jobTitle: string }): Promise<string>;
    draftInterviewInvitation(context: { jobTitle: string; suggestedSlots: string[] }): Promise<string>;
    draftEmployerProfileText(context: { companyName: string; industry: string; values?: string }): Promise<string>;
  }
  ```
- [ ] `lib/providers/ai/mock-ai-provider.ts` — deterministic rule-based rewrites. **No external HTTP calls and no identity/content logging.**
- [ ] `lib/providers/ai/openai-ai-provider.ts` — unwired placeholder stub
- [ ] `lib/providers/ai/index.ts` — exports the explicit Mock port

### `/lib/providers/jobroom`

- [ ] `lib/providers/jobroom/jobroom-provider.ts` — interface:
  ```ts
  export interface JobroomProvider {
    checkReportingObligation(input: { occupationCodeId?: string; cantonCode?: string; }): Promise<{ result: 'REQUIRES_REPORTING'|'NOT_REQUIRED'|'UNKNOWN'; reasonCode: string; disclaimer: string; datasetVersion: string; dataYear: number; sourceUrl: string }>;
    submitJob(input: unknown): Promise<{ accepted: false; reason: 'not_implemented_in_mvp' }>;
  }
  ```
- [ ] `lib/providers/jobroom/mock-jobroom-provider.ts` — reads the versioned OccupationCode fixture and returns `UNKNOWN` with a bounded reason when code/data are missing, ambiguous, stale or unsupported; it never coerces unknown to `NOT_REQUIRED`. Every response carries the orientation/legal disclaimer, dataset version/year and official source. Fixtures cover all three results plus missing/ambiguous/stale data. `submitJob` always returns the not-implemented sentinel.
- [ ] `lib/providers/jobroom/index.ts` — exports the explicit Mock port

### `/lib/providers/storage`

- [ ] `lib/providers/storage/storage-provider.ts` — interface:
  ```ts
  export interface UploadInput { fileName: string; mimeType: string; size: number; buffer?: Buffer; }
  export interface StoredFileMetadata { storageKey: string; downloadable: false; }
  export interface StorageProvider {
    upload(input: UploadInput): Promise<StoredFileMetadata>;
    getReadUrl(storageKey: string): Promise<null>;
    delete(storageKey: string): Promise<void>;
  }
  ```
- [ ] `lib/providers/storage/mock-storage-provider.ts` — stores **metadata only** (no real bytes), returns a non-downloadable storage key and `null` for reads. Restrictions enforced: mime allowlist, max size 5 MB, safe filename, and never persist the buffer to disk. UI must not render a download link.
- [ ] `lib/providers/storage/index.ts` — exports the explicit Mock port

### `/lib/providers/commute` *(adapter may remain unused until a distance feature is approved)*
- [ ] `lib/providers/commute/commute-provider.ts` — interface (`getDistanceKm({ from: cityId, to: cityId }): Promise<number>`)
- [ ] `lib/providers/commute/mock-commute-provider.ts` — deterministic straight-line distance from seeded coordinates, clearly labelled an approximation
- [ ] `lib/providers/commute/index.ts`

## Files to create / modify

All inside `/lib/providers/{payments,email,ai,jobroom,storage,commute}/` per the breakdown above.

## Rules to respect (from `99-rules-quickref.md`)

- §24 Mock Adapter — **mock = working local behavior with stored DB records**, not just UI placeholders
- §33 External Integration — never couple business logic to a specific implementation; always import via `lib/<x>/index`
- §10 Security — never log file buffers, never log payment payloads containing card data
- §13/§14 Monetization & Billing — payment success path must produce `Order → Invoice → Subscription/Product effects → mock email`

## Verification

> **Plan status:** Not implemented in this repository yet. Treat the checks below as target verification steps. Do not mark any checkbox until code exists and the command/output has been verified.

- [ ] Billing creates an Order and `CHECKOUT_CREATED` PaymentEvent from a server-side catalog quote; `paymentProvider.createCheckout({ orderId, idempotencyKey, … })` only returns a deterministic local operation URL and never accepts a price or writes DB state
- [ ] `paymentProvider.confirmPayment(...)` returns a deterministic provider reference; Phase 12 integration tests prove Invoice/Fulfillment via the Billing use case
- [ ] `emailProvider.send({ to, templateKey: 'registration_welcome', subject: 'Willkommen bei SwissTalentHub', data: {} })` writes `EmailLog`
- [ ] `aiProvider.improveJobText("Wir suchen einen Junior Entwickler …")` returns rewritten text without HTTP traffic (run with network disabled to confirm)
- [ ] `jobroomProvider.checkReportingObligation({ occupationCodeId: <seeded id> })` returns `{ result: 'REQUIRES_REPORTING'|'NOT_REQUIRED'|'UNKNOWN', reasonCode, disclaimer, datasetVersion, dataYear, sourceUrl }`; version/source match the selected fixture, unknown data never becomes `NOT_REQUIRED`, and disclaimer text matches verbatim
- [ ] Browser E2E retrieves one reset and invitation URL through the secret-authenticated local mailbox, reads each exactly once, and proves the mailbox route is absent/fail-closed in a production build; raw tokens are absent from DB/log snapshots.

## Common pitfalls

- Implementing persistence/fulfillment in both provider and Billing → duplicate or non-atomic side-effects. The Mock PaymentProvider is pure; Phase 12 alone persists payment state and owns `confirmMockPayment`/fulfillment.
- Forgetting to write a `PaymentEvent` per state transition — admin diagnostics suffer
- Real OpenAI fallback wired by accident — verify no `fetch('https://api.openai.com…')` exists
- Storing real file bytes in the mock storage adapter — MVP stores metadata only (`99-rules-quickref.md` §10)
- Forgetting German subjects/bodies in email templates

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Fully local, truthful provider behavior enables complete demos/tests without secrets or accidental external processing. |
| Roles / requirements | System plus all flows; REQ-INT-001/002, EMP-004, BIL-002/003, QA-001. |
| Prerequisites | 02–03; ADR-005/014/019. |
| Deliverables | Ports and truthful mocks for payment, email (including guarded local mailbox), storage metadata, Job-Room dataset, deterministic AI copy and commute. Internal typed Analytics (03) and deterministic Invoice HTML rendering (12) are domain code, not external-provider ports. Composition root selects mocks explicitly. |
| Data/server | Owning domains write EmailLog/Notification, PaymentEvent, ReportingCheck or metadata. The pure Mock PaymentProvider writes nothing; Phase 12 records payment plus exactly-once fulfillment in one transaction. |
| Validation | Server loads Product/Plan price; validated target context; operation/idempotency keys; file metadata limits; dataset version/year. |
| Authorization/audit | Owning domain authorizes before calling a port; adapter cannot broaden access. Provider failures are redacted and correlated. |
| UX/mobile | Result contracts distinguish `MOCK_RECORDED`, failed and retryable; real pages present states in owning phases. No fake download or “sent/paid” claim. |
| Seed | Mock occupation datasets/templates/failure fixtures with explicit year/source/disclaimer. |
| Tests | Contract suite per port, owner-domain persistence where promised, deterministic failures, no-network guard and no real endpoint import/call. |
| Verification | Network-disabled provider tests plus DB assertions. Expected: all flows work with blank external credentials and create named local records. |
| Risks / limitations | No real payment/email/file/AI/legal result; provider migration needs separate Security/Legal/Ops gate. |
| Definition of Done | Every promised integration has one interface, one working local mock and clear limitation; no double side effect or hidden env auto-switch. |

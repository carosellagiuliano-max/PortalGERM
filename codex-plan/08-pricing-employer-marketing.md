# Phase 08 — Pricing & Employer Marketing

> **PortalGERM target status: IMPLEMENTED AND VERIFIED.** Code-Commit `dd1032f6487a3b09b79bdb22e06fc6fd852ddaf2`; reproduzierbarer Nachweis: [Evidence vom 20. Juli 2026](./evidence/2026-07-20-phase-08.md). Preise und Packaging bleiben versionierte Hypothesen (ADR-025); Checkout und reale Provider sind weiterhin ehrlich gesperrt.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 08. Read [99-rules-quickref.md](./99-rules-quickref.md) §13 before starting.

## Goal

Build the public pricing, employer education and persisted demo/lead flow. Pages read the currently effective seeded PlanVersion/ProductVersion snapshots; Phase 12 later owns scheduled catalog version changes. Historical/customer terms never change because an Admin edits copy.

## Prerequisites

- [x] Phase 05 seeded plans + products
- [x] Phase 04 mock email adapter (used by lead form)
- [x] Phase 06 rate-limit, validation and audit primitives (used by the public lead mutation)

## Deliverables (checklist)

### `/pricing`

- [x] Hero: "Wähle den Plan, der dein Recruiting wachsen lässt" + subline mentioning Swiss SaaS positioning
- [x] Plan cards read four uniquely effective public monthly `PlanVersion` snapshots plus the single active, non-public `ENTERPRISE_CONTRACT` template and typed entitlements. `PUBLIC_PLAN_ORDER_V1` owns the reviewed comparison order instead of price or a mutable DB sort field; integer Rappen are formatted only at the display boundary:
  - Free Basic: CHF 0/Monat — 1 aktiver Job, Basis-Firmenprofil, Standard-Sichtbarkeit, Bewerbungen per E-Mail/Dashboard, **kein** Talent Radar, **kein** Premium-Analytics, **keine** inkludierten Boosts
  - Starter: CHF 149/Monat — 3 aktive Jobs, 2 Seats und Basis-Analytics; gleiche organische Rankingregeln wie Free. Basisverifizierung ist in jedem Plan verfügbar und nicht kaufbar.
  - Pro: CHF 399/Monat — 10 aktive Jobs, 5 Seats, erweitertes Firmenprofil/Analytics, Talent Radar mit 10 Kontakten/Monat und **3 klar gekennzeichneten Boost-Credits**; keine unbezeichnete Priorisierung
  - Business: CHF 899/Monat — 30 aktive Jobs, 15 Seats, Talent Radar mit 50 Kontakten/Monat, 10 Boosts; Import erst nach dem dokumentierten P1-Gate
  - Enterprise: Individuell — vereinbarte Kontingente und betreutes Onboarding; ATS/API/SSO und Vertragsbilling sind ausdrücklich spätere, separat geprüfte Leistungen
- [x] Phase-08 CTAs: "Kostenlos starten" → Employer registration; Starter/Pro → qualified lead with selected plan context; Business/Enterprise → demo/interest only. `phase08CheckoutDecision()` denies every Order; Phase 12 alone may activate eligible signed-in Starter/Pro checkout.
- [x] One-time products section reading live from the currently effective, active `ProductVersion` only:
  - Job Boost 7 Tage CHF 79 · Job Boost 30 Tage CHF 199
  - Talent Radar Contact Pack 10 CHF 99 · Talent Radar Contact Pack 50 CHF 299 — nur als Add-on mit bestehendem Talent-Radar-Zugang; Pack schaltet den Radar nicht frei
- [x] P1/P2 catalog hypotheses (Featured, Import Setup, Newsletter, Social) are not rendered as purchasable and have no checkout CTA until their explicit release gate/ADR activates a ProductVersion
- [x] Phase 08 presents all four P0 product prices as information context. Future candidate helpers remain deny-by-default: Phase 12 owns Contact-Pack checkout and Phase 13 must register the job-bound Boost handler before an eligible owned job can proceed.
- [x] **Success-fee placeholder** card: title "Erfolgsbasierte Vermittlung", price "Coming soon", body "Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert." Disabled CTA. Read from product `success-fee` only when `requiresLegalReview && status=INACTIVE`; every checkout remains server-denied.
- [x] FAQ section (≥6 questions) covering: "Brauche ich ein Abo um zu starten?", "Was passiert beim Limit?", "Wie funktioniert Talent Radar?", "Was ist Lohntransparenz?", "Welche Abrechnungswährung?", "Kann ich jederzeit kündigen?"
- [x] Tax notice comes from the reviewed TaxRate/Legal configuration: local demo shows the explicitly fictitious 8,1-% assumption; production-like environments show only the generic review-before-contract notice.
- [x] Public routes are indexable. Optional `Product`/`Offer` JSON-LD was deliberately not added because no checkout-capable offer exists in Phase 08.

### `/employers`

- [x] Hero: "Bessere Bewerbungen. Faires Recruiting. Im kontrollierten de-CH Pilot." ZH/AG/BE × Pflege/Gesundheit und Engineering/Technik werden ausschliesslich als Launchhypothese im Aufbau benannt; es gibt keine nationale Liquiditätsbehauptung.
- [x] Three-column value prop: Sichtbarkeit · Faires Recruiting (Antwortziel, Lohntransparenz) · Talent Radar
- [x] Trust strip uses provable wording only: "Datenschutzfreundlich vorbereitet · Kandidatenkontrolle · keine Drittanbieter-Tracking-Pixel im Mock-MVP". Hosting/data location is not claimed until deployment evidence exists.
- [x] Section "Warum SwissTalentHub": Fair Hiring, ausschliesslich evidenzgebundenes Antwortsignal ohne Fake-Badge, anonymer Talentpool und geführter Posting-Einstieg
- [x] CTA "Kostenlos starten" → `/register/employer`
- [x] CTA "Demo anfragen" → `/employers/demo`

### `/employers/post-job`

- [x] Marketing landing explains the five-step workflow and Fair-Score factors editorially; it shows neither a fake interactive screenshot nor a fabricated result
- [x] Section explaining how Fair-Job-Score works (versioned score weights table)
- [x] Anonymous CTA routes to `/register/employer`; no dead editor route or simulated job creation is exposed before Phase 10

### `/employers/talent-radar`

- [x] Explain anonymous Talent Radar: opt-in candidates, anonymous filtering, contact via credits, identity reveal flow
- [x] Show a clearly schematic, blurred locked preview; it is not presented as a real product screenshot or real candidate data
- [x] Pricing teaser: included in Pro/Business + contact packs
- [x] CTA "Talent Radar freischalten" → `/pricing`

### `/employers/employer-branding`

- [x] Enhanced profile preview uses only modelled example fields and labels demo content; no employee quotes/media or response badge is invented
- [x] CTA "Premium Arbeitgeber werden" → `/pricing`

### `/employers/xml-import`

- [x] Explain the licensed XML/JSON import flow and supported fields defined by Blueprint §5/6 and REQ-MKT-006:
  id, company, title, workplace country, zip, city, canton, description, requirements, offer, contact, application_url, type, workload min/max, keywords
- [x] Explain that assisted Import is a P1 hypothesis requiring source rights, preview and an activated PlanVersion/ProductVersion policy; CHF 750 or Business access is not presented as purchasable
- [x] CTA "Import besprechen" → `/employers/demo` records interest only; no Phase-08 entitlement or checkout

### `/employers/demo` — Lead form (key conversion)

- [x] Lead fields: company name, contact person, email, optional phone, company size, hiring need, bounded message and optional desired callback window; purpose/consent and retention notice are visible
- [x] Zod-validated server action creates one canonical `SalesLead { status: NEW }` per normalized email/purpose and one immutable, retention-bounded `SalesLeadIntake` plus activity, task, required audit and essential analytics per new idempotency key. Anonymous follow-ups never overwrite canonical intake data.
- [x] Mock email `demo_request_received` is post-commit, idempotent and PII-minimized; a transient notification failure is retryable without duplicating committed domain effects.
- [x] Success state: "Danke — deine Anfrage ist erfasst. Unser internes Ziel ist eine Antwort innerhalb eines Werktags; dies ist keine Garantie." Each intake persists `dueAt` from the same versioned Sales SLA policy shown to Ops.
- [x] Rate-limited by canonical `RATE_LIMIT_PRESETS_V1` (`LEAD`: 10/hour/IP); denial-audit writes have their own 1/hour/IP bound.
- [x] Reference disclaimer: "Wir verwenden deine Angaben nur zur Kontaktaufnahme."
- [x] Honeypot field provides bounded bot mitigation without inventing a persisted Lead

## Files to create / modify

- `app/(public)/pricing/page.tsx`
- `app/(public)/employers/page.tsx`
- `app/(public)/employers/post-job/page.tsx`
- `app/(public)/employers/talent-radar/page.tsx`
- `app/(public)/employers/employer-branding/page.tsx`
- `app/(public)/employers/xml-import/page.tsx`
- `app/(public)/employers/demo/{page.tsx,actions.ts}`
- `components/marketing/PricingCard.tsx`, `OneTimeProductCard.tsx`, `SuccessFeeCard.tsx`, `LeadForm.tsx`

## Rules to respect (from `99-rules-quickref.md`)

- §13 — exact prices (CHF), success-fee disabled with German notice
- §7 — German UI; CHF; "Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert."
- §10 — never auto-call external services from the lead form
- §22 — fields persisted to `SalesLead` so admin can act on them in Phase 11

## Verification

- [x] Pricing page lists all 5 plan hypotheses and exactly 4 active P0 products with correct CHF prices; every seeded P1/P2/legal-review product is absent from purchasable results and direct Phase-08 checkout is globally denied
- [x] Future checkout-candidate tests accept only exact, effective, positive-price monthly Starter/Pro catalog rows; Free, Business, Enterprise, annual or malformed versions fail closed and create no Order
- [x] Future Contact-Pack candidates require an existing Radar-entitled Company; credits never broaden Radar access. Boost candidates require the Phase-13 handler and an eligible owned job.
- [x] Success-fee shown as "Coming soon — Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert."
- [x] Submitting `/employers/demo` persists exactly one canonical Lead, immutable Intake, activity, task, audit, analytics event and PII-minimized `EmailLog` per new idempotency key
- [x] Form rejects empty required fields with German validation messages
- [x] All employer marketing pages are indexable and registered in the current sitemap; Phase 15 owns later production/dynamic SEO expansion

## Common pitfalls

- Hardcoding plan prices in JSX — read from DB; Phase 12 owns future-dated catalog versions and existing contracts remain unchanged
- Forgetting VAT note on pricing
- Lead form submitting without rate limiting — IP brute-force risk
- Missing success-fee disclaimer or marking it active by accident
- Saying "100 % DSG compliant" — never. Use "DSG-freundlich vorbereitet"

## PortalGERM Execution Contract

| Field | Binding phase contract |
|---|---|
| Business value | Explain a segment-specific employer outcome, capture qualified demand and make free-to-paid logic understandable before a checkout exists. |
| Roles / requirements | Public/Employer/Sales; REQ-BIL-001/007, GRW-001, INT-001. |
| Prerequisites | 04–06 explicitly (Lead rate/auth primitives); ADR-024/025; catalog fixtures. |
| Routes/actions | `/pricing`, `/employers` and five capability pages plus `/employers/demo`; list active PlanVersion/ProductVersion records; submit/dedupe Lead and create mock notification/task. |
| Data | Versioned catalog/read model, canonical SalesLead, immutable SalesLeadIntake/Activity, Task, Analytics and EmailLog. No hardcoded authoritative price in JSX. |
| Validation | Lead schema, length/email/company, consent purpose, honeypot/rate/idempotency; fail-closed server catalog and `PUBLIC_PLAN_ORDER_V1`. |
| Authorization/audit | Public lead may create only allowed fields; rate event and lead audit/analytics. Success Fee denied in UI/API/Admin. |
| UX/mobile | Plan target/limits/period/VAT/renewal hypothesis, monthly P0 view and comparison usable without wide-only table; inactive annual research is not rendered; unavailable Billing CTA truthfully routes to registration/demo until its owning phase. |
| Seed | Five versioned plan hypotheses with monthly versions public; annual versions inactive research only; exactly four active P0 products, future products disabled; duplicate/qualified leads. |
| Tests | Catalog order/snapshot, copy claims, disabled success fee, lead double submit/rate/notification/privacy, mobile comparison. |
| Verification | Route/action suite and manual original de-CH content review. Exactly one immutable Intake, Activity, Task, Audit, Analytics and mock notification per new idempotency key. |
| Risks / limitations | Prices, annual discount and claims need commercial validation; no “priority visibility” except labelled sponsored products. |
| Definition of Done | Employer understands who each plan serves and can complete a real Lead/registration action; no unsupported feature/provider/compliance promise. |

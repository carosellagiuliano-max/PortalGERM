# Phase 08 — Pricing & Employer Marketing

> **PortalGERM target status: NOT IMPLEMENTED.** Prices and packaging are versioned hypotheses (ADR-025); unavailable checkout/provider behavior must be labelled honestly.

> Detail file for [00-PLAN.md](./00-PLAN.md) Phase 08. Read [99-rules-quickref.md](./99-rules-quickref.md) §13 before starting.

## Goal

Build the public pricing, employer education and persisted demo/lead flow. Pages read the currently effective seeded PlanVersion/ProductVersion snapshots; Phase 12 later owns scheduled catalog version changes. Historical/customer terms never change because an Admin edits copy.

## Prerequisites

- [ ] Phase 05 seeded plans + products
- [ ] Phase 04 mock email adapter (used by lead form)
- [ ] Phase 06 rate-limit, validation and audit primitives (used by the public lead mutation)

## Deliverables (checklist)

### `/pricing`

- [ ] Hero: "Wähle den Plan, der dein Recruiting wachsen lässt" + subline mentioning Swiss SaaS positioning
- [ ] Plan cards read the currently effective public `PlanVersion` plus typed entitlements, ordered by explicit `sortOrder` (not price, because Enterprise is custom); format integer Rappen at the display boundary:
  - Free Basic: CHF 0/Monat — 1 aktiver Job, Basis-Firmenprofil, Standard-Sichtbarkeit, Bewerbungen per E-Mail/Dashboard, **kein** Talent Radar, **kein** Premium-Analytics, **keine** inkludierten Boosts
  - Starter: CHF 149/Monat — 3 aktive Jobs, 2 Seats und Basis-Analytics; gleiche organische Rankingregeln wie Free. Basisverifizierung ist in jedem Plan verfügbar und nicht kaufbar.
  - Pro: CHF 399/Monat — 10 aktive Jobs, 5 Seats, erweitertes Firmenprofil/Analytics, Talent Radar mit 10 Kontakten/Monat und **3 klar gekennzeichneten Boost-Credits**; keine unbezeichnete Priorisierung
  - Business: CHF 899/Monat — 30 aktive Jobs, 15 Seats, Talent Radar mit 50 Kontakten/Monat, 10 Boosts; Import erst nach dem dokumentierten P1-Gate
  - Enterprise: Individuell — vereinbarte Kontingente und betreutes Onboarding; ATS/API/SSO und Vertragsbilling sind ausdrücklich spätere, separat geprüfte Leistungen
- [ ] Phase-08 CTAs: "Kostenlos starten" → Employer registration; Starter/Pro → registration or qualified lead with selected plan context; Business/Enterprise → demo/interest only until the documented P1 sales/self-service gate. Phase 12 alone replaces eligible signed-in Starter/Pro CTAs with real checkout.
- [ ] One-time products section reading live from the currently effective, active `ProductVersion` only:
  - Job Boost 7 Tage CHF 79 · Job Boost 30 Tage CHF 199
  - Talent Radar Contact Pack 10 CHF 99 · Talent Radar Contact Pack 50 CHF 299 — nur als Add-on mit bestehendem Talent-Radar-Zugang; Pack schaltet den Radar nicht frei
- [ ] P1/P2 catalog hypotheses (Featured, Import Setup, Newsletter, Social) are not rendered as purchasable and have no checkout CTA until their explicit release gate/ADR activates a ProductVersion
- [ ] Phase 08 presents all four P0 product prices as information/registration context. Phase 12 may checkout Contact Packs; Boost has no generic purchase CTA and remains server-denied until Phase 13 registers its handler, then starts only from an eligible owned job.
- [ ] **Success-fee placeholder** card: title "Erfolgsbasierte Vermittlung", price "Coming soon", body "Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert." Disabled CTA. Read from product `success-fee` only when `requiresLegalReview && status=INACTIVE`; every checkout remains server-denied.
- [ ] FAQ section (≥6 questions) covering: "Brauche ich ein Abo um zu starten?", "Was passiert beim Limit?", "Wie funktioniert Talent Radar?", "Was ist Lohntransparenz?", "Welche Abrechnungswährung?", "Kann ich jederzeit kündigen?"
- [ ] Note: "Preise zzgl. aktuell geplant 8,1 % MWST; Steuerbehandlung vor Vertragsabschluss prüfen"; copy comes from the current reviewed TaxRate/Legal configuration, not a hardcoded component
- [ ] Public, indexable, JSON-LD `Product`/`Offer` optional

### `/employers`

- [ ] Hero: "Bessere Bewerbungen. Faires Recruiting. Im kontrollierten de-CH Pilot." Supporting copy may call a pair “aktiv” only when `isClusterIndexable` has a current LIVE assessment plus Content; otherwise it names ZH/AG/BE × Pflege/Gesundheit and Engineering/Technik solely as Pilot-/Launchhypothese (“im Aufbau”) and makes no current-liquidity/national claim. DEMO assessments can never drive this public copy.
- [ ] Three-column value prop: Sichtbarkeit · Faires Recruiting (Antwortzeit, Lohntransparenz) · Talent Radar
- [ ] Trust strip uses provable wording only: "Datenschutzfreundlich vorbereitet · Kandidatenkontrolle · keine Drittanbieter-Tracking-Pixel im Mock-MVP". Hosting/data location is not claimed until deployment evidence exists.
- [ ] Section "Warum SwissTalentHub": fair hiring, response-time badge, anonymous talent pool, fast posting
- [ ] CTA "Kostenlos starten" → `/register/employer`
- [ ] CTA "Demo anfragen" → `/employers/demo`

### `/employers/post-job`

- [ ] Marketing landing explains the five-step workflow and Fair-Score factors with a clearly editorial illustration; do not show a fake interactive screenshot or fabricated result
- [ ] Section explaining how Fair-Job-Score works (score weights table)
- [ ] CTA "Inserat erfassen" → `/employer/jobs/new` (logged-in) or `/register/employer` (anonymous)

### `/employers/talent-radar`

- [ ] Explain anonymous Talent Radar: opt-in candidates, anonymous filtering, contact via credits, identity reveal flow
- [ ] Show locked preview screenshot (blurred candidate cards)
- [ ] Pricing teaser: included in Pro/Business + contact packs
- [ ] CTA "Talent Radar freischalten" → `/pricing`

### `/employers/employer-branding`

- [ ] Enhanced profile preview uses only modelled/persisted example fields and labels demo content; no employee quotes/media or response badge without a model and evidence
- [ ] CTA "Premium Arbeitgeber werden" → `/pricing`

### `/employers/xml-import`

- [ ] Explain the licensed XML/JSON import flow and supported fields defined by Blueprint §5/6 and REQ-MKT-006:
  id, company, title, workplace country, zip, city, canton, description, requirements, offer, contact, application_url, type, workload min/max, keywords
- [ ] Explain that assisted Import is a P1 hypothesis requiring source rights, preview and an activated PlanVersion/ProductVersion policy; do not present CHF 750 or Business access as purchasable before that gate
- [ ] CTA "Import besprechen" → `/employers/demo` records interest only; no Phase-08 entitlement or checkout

### `/employers/demo` — Lead form (key conversion)

- [ ] Lead fields: company name, contact person, email, optional phone, company size, hiring need, bounded message and optional desired callback window; purpose/consent and retention notice are visible
- [ ] Zod-validated server action: creates `SalesLead { status: NEW }` + sends mock email `demo_request_received` to admin distribution list (configurable later) + audit-log entry
- [ ] Success state: "Danke — deine Anfrage ist erfasst. Unser internes Ziel ist eine Antwort innerhalb eines Werktags; dies ist keine Garantie." Persist `dueAt` from the same versioned Sales SLA policy shown to Ops.
- [ ] Rate-limited (5/h/IP from Phase 06)
- [ ] Reference disclaimer: "Wir verwenden deine Angaben nur zur Kontaktaufnahme."
- [ ] Optional honeypot field for bot mitigation

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

- [ ] Pricing page lists all 5 plan hypotheses and exactly 4 active P0 products with correct CHF prices; every seeded P1/P2/legal-review product is absent from purchasable results and rejects direct checkout
- [ ] Direct checkout eligibility test permits monthly Starter/Pro only in P0; Free registers/resolves fallback rights and Business/Enterprise/annual versions route to Lead/Demo without an Order
- [ ] Contact Pack direct checkout is denied for Free/Starter with a Pro-upgrade explanation and allowed only for a currently Radar-entitled Company; buying/granting credits alone never broadens Radar query access
- [ ] Success-fee shown as "Coming soon — Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert."
- [ ] Submitting `/employers/demo` form persists a `SalesLead` and writes one `EmailLog` (template `demo_request_received`)
- [ ] Form rejects empty required fields with German validation messages
- [ ] All employer marketing pages indexable; included in sitemap (Phase 15 will register them)

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
| Data | Versioned catalog/read model, SalesLead/Activity, Notification/EmailLog. No hardcoded authoritative price in JSX. |
| Validation | Lead schema, length/email/company, consent purpose, honeypot/rate/idempotency; server-side catalog and sortOrder. |
| Authorization/audit | Public lead may create only allowed fields; rate event and lead audit/analytics. Success Fee denied in UI/API/Admin. |
| UX/mobile | Plan target/limits/period/VAT/renewal hypothesis, monthly P0 view and comparison usable without wide-only table; inactive annual research is not rendered; unavailable Billing CTA truthfully routes to registration/demo until its owning phase. |
| Seed | Five versioned plan hypotheses with monthly versions public; annual versions inactive research only; exactly four active P0 products, future products disabled; duplicate/qualified leads. |
| Tests | Catalog order/snapshot, copy claims, disabled success fee, lead double submit/rate/notification/privacy, mobile comparison. |
| Verification | Route/action suite and manual original de-CH content review. Expected one persisted Lead and one mock notification per idempotency key. |
| Risks / limitations | Prices, annual discount and claims need commercial validation; no “priority visibility” except labelled sponsored products. |
| Definition of Done | Employer understands who each plan serves and can complete a real Lead/registration action; no unsupported feature/provider/compliance promise. |

# Rules Quick Reference

> Local product/technical rule digest for this repository snapshot. The active end-to-end agent process rules live in [`../AGENTS.md`](../AGENTS.md); use both files before each phase.

---

## §1 Product Mission

Help candidates answer: which job fits, which employer is fair/transparent, where is salary clear, where do I get a quick response, which employer matches my skills/salary/language/workload/location/remote preference.
Help employers answer: how to publish quickly, get suitable candidates, present as fair employer, access opt-in passive talent, buy visibility/analytics/Talent Radar/branding.
**Candidates free by default. Employers pay for reach, visibility, analytics, Talent Radar, premium profiles, boosts, imports.**

## §2 Most Important Product Rule

Win through trust. Every decision must protect: candidate trust, employer trust, data privacy, fairness, transparency, commercial clarity, maintainability, scalability. **When in doubt → safer, clearer, more privacy-friendly.**

## §3 Product Differentiation

Keep visible in UI/code/business logic: explainable advert-transparency score · Salary transparency with data coverage · measured response process (not an unproven guarantee) · SwissJobPass · Anonymous Talent Radar · Application Cockpit · Employer workflow/monetization · Swiss-specific features · Privacy-first candidate UX · action-oriented business cockpit. **Paid features may improve clearly labelled visibility, never relevance eligibility or fairness.**

## §4 General Working Style

Before coding: inspect, understand, identify scope, think (security/privacy/UX/billing/RBAC/DB/tests/maintainability), reuse patterns, smallest safe change, keep app runnable, run checks, report clearly.
**Never:** rewrite working code without reason · delete features · break routes · leave TS/Prisma errors · expose secrets/CV data · scrape portals · copy branding/wording.

## §5 Professional Change Process

Step 1 Analyze: goals, roles, routes, models, components, permissions, privacy, billing, audit, search/SEO, seed, README/.env, tests, edge cases.
Step 2 Design: reusable components, server-side validation/permissions, pure functions for business logic, adapter pattern for externals.
Step 3 Implement: focused files, validation, authorization, loading/error/empty states, audit logs, seed update, types, tests, docs.
Step 4 Verify: app runs, routes load, role correctness, ownership server-side, demo accounts work, no TS/Prisma errors, billing limits enforced, anonymity preserved, boost-labeled, invoices consistent, mobile-friendly.
Step 5 Report: precise, honest, "Implemented with mock provider", "Server-side gated", "Demo-ready", "Known limitation".

## §6 Tech Stack

Next.js App Router · TypeScript · Tailwind · shadcn/ui · Prisma · PostgreSQL · Zod · secure auth · server-side route protection · RBAC · company-level access control · mock adapters · seed data · tests as part of every phase.
Exact compatible versions are pinned in Phase 01; source-repository versions are not target evidence. Scripts must be Windows/CI portable. Folders: `/app`, `/components`, `/lib`, `/prisma`, `/tests`. Domain use cases live under `lib/domains`, cross-cutting policies/providers under `lib/policies|providers`; React components do not own business rules.

## §7 Language & Copywriting

**UI: German (de-CH).** Code: English. CHF prices. Swiss cantons/cities. Sample phrases:

- "Finde nicht irgendeinen Job. Finde den Job, der wirklich passt."
- "Lohn transparent" / "Lohn nicht transparent"
- "Antwort in 7 Tagen"
- "Job boosten" · "Talent Radar freischalten" · "SwissJobPass erstellen" · "Identität freigeben"
- "Kostenlos starten" · "Upgrade wählen"
- "Mehr Sichtbarkeit" · "Mehr passende Bewerbungen" · "Passive Talente kontaktieren"
- "Antwortzeit als Vorteil zeigen" · "Lohntransparenz als Recruiting-Vorteil"

## §8 Authentication & Authorization

bcrypt/argon2 · httpOnly cookies · secure cookies in prod · SameSite · session expiry · logout · protected routes · server-side RBAC · server-side ownership checks · password strength validation · explicit versioned Terms for Candidate and Employer · safe password reset mock/local guarded mailbox · no user enumeration · rate limiting. Employer registration chooses atomic new Company **or** pending Claim; domain/UID/name never auto-grants access.
Roles: Candidate, Employer, Recruiter, Admin. **Company-level permissions required** — global role alone is not enough. Audit-log all sensitive admin/employer actions.

## §9 Candidate Privacy Rules

**Never expose to employers in Talent Radar without explicit reveal:** real name, email, phone, exact address, full CV, private notes, sensitive PII.

- candidate must explicitly opt in / can opt out anytime
- employer sees anonymous profile only
- contact requests logged
- candidate may accept/reject
- candidate may reveal manually (logged)
- employer needs current Talent-Radar access **and** one fundable contact credit; a pack/credit never grants access by itself
- credits reduced server-side
  Maintain consent logs · deletion requests · export mock · privacy dashboard · abuse reporting · candidate visibility control.
  **Wording:** "Datenschutzfreundlich vorbereitet" / "DSG-freundliches MVP" / "Orientierung, keine Rechtsberatung" — **never claim full legal compliance**.

## §10 Security & Validation

All writes validated with Zod. Protect: IDOR, XSS, CSRF, privilege escalation, unsafe uploads, leaks (candidate/billing/secrets), unsafe redirects, unbounded queries, missing ownership checks.

- never trust client IDs · always check ownership server-side
- no arbitrary HTML in job descriptions (sanitize or render plain text)
- file upload: validate metadata, restrict mime/size, quarantine bytes, scan before read, never execute; Local/CI uses the filesystem sandbox, Phase 33 adds authority-bound S3/ClamAV contract/live adapters
- never log passwords/tokens/CV contents
- private pages noindex
  Headers: CSP · X-Frame-Options/frame-ancestors · X-Content-Type-Options · Referrer-Policy · HSTS in prod.

## §11 Fair-Job-Score Rules

Versioned deterministic pure function 0–100 for **advert transparency**. Frozen v2: salary 25; tasks MISSING/PARTIAL/CLEAR 0/8/15; workload/contract/start 15; location/remote 10; process 10; response integer 1–30 days 10; ≥2 concrete benefits 5; inclusion/contact 5; injected-time `now < validThrough <= now+120d` 5. Missing/invalid = 0, direct integer sum. Full predicates/reason order are binding in Phase 03.

Returns: score · version · confidence/evidence · positive reasons · missing improvements · employer suggestions. Company verification is a separate badge. **Paid boosts/plans/products must not be function inputs.**

## §12 Candidate Match Score Rules

Versioned deterministic Candidate decision aid. Frozen v1 weights: skills 30 · language 15 · region/mobility 15 · workload 15 · salary 10 · job type 5 · remote 5 · availability 5. Phase 03 fixes overlap/matrices, known-weight denominator, Half-up rounding and null score at confidence 0. Protected/proxy-sensitive attributes are excluded by type. P0 does not expose employer ranking or automated rejection. **No fake AI for critical scoring.**

## §13 Monetization Rules

Five versioned plan hypotheses: Free Basic CHF 0 (1 job/1 seat), Starter CHF 149 (3/2), Pro CHF 399 (10/5, analytics, 10 Radar contacts, 3 Boosts), Business CHF 899 (30/15, 50 contacts, 10 Boosts, advanced Radar; Import only after its P1 gate), Enterprise custom. Annual 10-for-12 pricing is a hypothesis requiring approval. Plan rights come from structured Entitlements, never marketing strings or stale Company booleans.

Die historischen P0-Katalogfixtures Job Boost 7/30 und Talent Contact Packs
10/50 beweisen nur Produktmechanik. Für reale Marktaktivierung gilt:
Basisworkflow → Hiring-Sprint → Retainer → Concierge/rechtmässiger Import vor
Boost; Radar/Contact erst nach Dichte-/Trust-/Legal-Gate. Targeted Additional
Job bleibt P1; Featured/Newsletter/Social P2 bis zum Reichweitenbeleg. Every
sponsored product is disclosed. **Success Fee remains disabled in UI, API and
Admin until legal review.** AVG/AVV review applies to the concrete
entgeltliche job-market/Radar/contact flow, not only Success Fee. See
[product-strategy.md](./product-strategy.md) §10 and
[commercial-go-live-gates.md](./commercial-go-live-gates.md).

## §14 Billing & Payment Rules

Payment remains disabled by default. Adapter boundary:

```
/lib/providers/payments/payment-provider.ts
/lib/providers/payments/mock-payment-provider.ts
/lib/providers/payments/stripe-payment-provider.ts
/lib/providers/payments/payment-composition.ts
/lib/providers/payments/provider-activation-binding.ts
```

Mock checkout: server-side quote/catalog snapshot → Order with validated target context → "Mock bezahlen" → atomic/idempotent PaymentEvent + Invoice + entitlement/ledger/product fulfillment → mock notification after commit → success page. Client never sends authoritative amount. **Mock completion is never paid conversion, collected revenue or WTP evidence.** Stripe contract/sandbox/live code still grants no authority by itself: Production requires the exact provider-ledger binding, approved account/price/webhook evidence and the separate Finance/Tax/Legal/WTP gates. Invoices remain CHF/Rappen snapshots with explicit rounding/numbering policy; VAT 8.1 % is a planning input, not a substitute for tax review. Refund, dispute, dunning and reconciliation follow the durable inbox/ledger contract and remain activation-gated.

## §15 Feature Gating Rules

**One typed server-side `getEffectiveEntitlements` source.** Complete default Free PlanVersion → exactly one effective Subscription replaces that baseline → only allowlisted typed Grants raise/replace/add; unknown/missing/mistyped/ambiguous fails closed. Ledger balances remain distinct and never grant access. Gate active jobs at every Published/reactivation transition, Radar/query/contact, atomic credits/allowances, analytics, import, branding, boosts and seats.
On limit: show upgrade prompt, explain why, show plan/product, link to pricing/checkout. **Never silently fail. Never client-only.**

## §16 Job Boost Rules

**Boosting affects visibility, not fairness.** `JobBoost` fields: jobId, startsAt, endsAt, status, createdAt, updatedAt. Status: scheduled · active · expired · cancelled. Active uses the half-open interval `[startsAt, endsAt)` so back-to-back Boosts do not overlap.
Search first enforces query/filter relevance; then v1 allows max 3 labelled active relevant boosts on Search first page and max 2 on Homepage; later cursors replenish none. Organic ranking follows. Stable ordering/config version is computed before pagination. Public UI **must label** every boosted surface as "Geboostet".

## §17 Talent Radar Rules

Without access: locked preview, blurred details, CTA "Talent Radar freischalten".
Locked/Draft/suspended/unverified Company state must not query candidate data. With ACTIVE+VERIFIED access: Safe DTO + opaque IDs + COMPLETE+consented Candidate + cohort protection; contact consumes plan, then purchased, then admin funding atomically and records source. Request expires after 14 days; terminal recontact waits 30 days; no automatic refund. Candidate accepts/declines; identity remains hidden until a candidate-initiated scoped RevealGrant with closed field enum.

## §18 Admin / Sales Operations Cockpit Rules

Admin manages: jobs, companies, users, categories, cantons, cities, skills, occupation codes, abuse reports, imports, plans, products, orders, invoices, subscriptions, leads, credits.
Platform Admin/Sales cockpit: MRR run-rate, monthly Mock-paid net Plan/Product lines (separate, never added to MRR and called revenue), paying vs free employers, active boosted jobs, open invoices, sales leads, near-limit companies, boost potential, demand by category and suggested actions. A Company Owner sees only its tenant-scoped Billing/usage/analytics, never global MRR, leads or other Companies.
Every suggestion includes reason code, evidence period, recommended action, owner/due date and outcome. Sample suggestions:

- "Firma X hat 3 von 3 Jobs aktiv. Upgrade auf Pro anbieten."
- "Job Y hat viele Views aber wenig Bewerbungsstarts. Zuerst Text/Formular diagnostizieren; Boost nur danach bei Evidenz und Eignung anbieten."
- "Firma Z nutzt Talent Radar stark. Contact Pack anbieten."
- "Kategorie Pflege hat hohe Nachfrage und zu wenig aktuelle Stellen. Arbeitgeberakquise zuweisen."

## §19 Swiss-Specific Rules

**Seed all 26 cantons:** Aargau, Appenzell Ausserrhoden, Appenzell Innerrhoden, Basel-Landschaft, Basel-Stadt, Bern, Fribourg, Genève, Glarus, Graubünden, Jura, Luzern, Neuchâtel, Nidwalden, Obwalden, Schaffhausen, Schwyz, Solothurn, St. Gallen, Thurgau, Ticino, Uri, Valais, Vaud, Zug, Zürich.
Major-city seed coverage includes Zürich, Winterthur, Basel, Bern, Luzern, St. Gallen, Chur, Aarau, Zug, Schaffhausen, Lausanne, Genève, Fribourg, Neuchâtel, Sion, Lugano, Bellinzona, Biel/Bienne, Thun, Frauenfeld, Baden, Olten, Solothurn, Uster, Wetzikon, Dietikon, Köniz, Rapperswil-Jona and Wil. Exact fixtures are versioned in Phase 05.
Categories: Informatik, Gesundheit/Pflege, Bau/Handwerk, KV/Administration, Verkauf, Gastronomie/Hotellerie, Bildung/Soziales, Finanzen/Treuhand/Recht, Logistik/Transport, Engineering/Technik, Marketing/Kommunikation, Reinigung/Facility, Management/Kader, Lehrstellen, Temporärarbeit, Produktion/Industrie, HR/Recruiting, Kundendienst/Callcenter.
**Stellenmeldepflicht: mock Job-Room adapter only**, no real API, disclaimer "Dieser Check ist eine Orientierung und keine Rechtsberatung. Bitte prüfen Sie meldepflichtige Stellen offiziell."

## §20 SEO Rules

Public pages are indexable only when their Content/Liquidity Gate passes. Private dashboards are **noindex and no-store**, separately from authorization. Metadata · stable slugs/redirects · sitemap · robots · safe JSON-LD · canonical URLs. Thin combinations consolidate/noindex. **Never expose private or Radar data via SEO.**

## §21 UI & UX Rules

Modern · Swiss-clean · trustworthy · professional · responsive · accessible · fast · clear.
Use shadcn/ui · Tailwind · cards · badges · usage bars · clear CTAs · empty states · loading states · validation messages · confirmation modals · upgrade modals · tooltips.
A11y: semantic HTML · input labels · keyboard nav · visible focus · contrast · accessible modals · alt text. **Don't look like an unfinished admin template.**

## §22 Data & Seed Rules

Deterministic, versioned, environment-bound fixtures: positive and negative role/status/expiry/limit/privacy cases plus reference/product data. Seed uses stable IDs/clock, is idempotent and fails closed in Production. Demo accounts/data are visibly demo and never market evidence.

## §23 Testing Rules

Tests are delivered in their owning phase: Unit for rules, real PostgreSQL integration for schema/ownership/transactions/concurrency, route/action integration and critical browser E2E. Phase 17 adds cross-role regression/A11y/performance. **Prisma mocks cannot prove credit/payment/publish atomicity.**

## §24 Mock Adapter Rules

Mock adapters remain the Local-/CI-default for external boundaries. Phase 33 adds real provider code for required LC4-/LC5-use-cases (Resend, S3-compatible storage, ClamAV and Stripe) behind the same ports; AI, Job-Room and commute remain disabled/mock-only. Analytics is an internal typed domain writer/aggregator; invoice output is an internal deterministic renderer, not a fake provider port.
Adapters expose interfaces and are selected only by the composition root plus exact activation authority. **No real API calls unless explicitly asked.** Phase 33's isolated `production-contract` tests execute the live adapter code only against local stubs; they have no external effect and are never Live Evidence.
**Mock = working local behavior with stored DB records, NOT fake UI only.**
ADR-031, ADR-034 und ADR-043 ersetzen die historische ADR-014-Grenze für ausdrücklich freigegebene spätere Providertechnik. Production akzeptiert dennoch nur einen exakten freigegebenen Live-Ledgereintrag; Mock/Sandbox/Demo/`.invalid`, Secret-allein und Live→Mock-Fallback bleiben verboten.
Notification Delivery und Empfänger-Korrelation verwenden getrennte Keyrings (`NOTIFICATION_DELIVERY_KEYS` für AES-256-GCM, `NOTIFICATION_RECIPIENT_HASH_KEYS` für HMAC); Resend API und Webhook besitzen unabhängige Secret-Versionen. Zeilengebundene AES-v2-Empfänger-Evidence gilt maximal 31 Tage, im Normalpfad 23 Stunden; die minutenbasierte providerunabhängige Retention entfernt Zustellmaterial auch bei Revoke. Attempt-PII/Receipt/Digest wird nach exakt `400 × 24 h` irreversibel kompaktiert, während die nicht-PII Auditkette bleibt. Netzwerk/5xx/408/malformed-2xx/concurrent-idempotency sind unbekannte Ausgänge: bounded Same-Key-Retry, danach `PAUSED`/manuelle Reconciliation, niemals Blind-Resend oder blindes Dead Letter. Webhooks sperren die exakte Activation im selben TX; Inbox/Suppression sind append-only/monoton.

## §25 Error Handling Rules

User-friendly errors · server logs without sensitive data · form validation errors · 404/401/403 pages · empty states. **No stack traces to users. No revealing whether email exists in login/reset.**

## §26 Performance Rules

Paginate search · no client-side full job lists · DB indexes for common queries · minimize client components · server-side heavy logic · efficient Prisma queries · avoid N+1 · intentional `select`/`include` · seeded dashboards must be reasonably fast.

## §27 Database Rules

Prisma changes: schema · constraints/indexes · real migration · seed · queries · tests · generate. `db push` only for disposable local experiments, never Production or completion evidence. Money/catalog snapshots and ledgers are immutable/append-only as designed.
Important indexes include canonical email, `Job.slug/status/publishedAt`, `Company.slug`, `CompanyMembership(companyId,userId,status)`, `JobAssignment`, `Application(jobId,candidateProfileId)`, effective Subscription periods, Ledger company/type/time, `JobBoost(jobId,startsAt,endsAt,status)`, Invoice company/status and queue due/status fields. Exact set follows Blueprint §6 and query-plan tests.

## §28–31 Routes

See `00-PLAN.md` "Routes summary".

## §32 Main Business Flows

**Candidate:** register → SwissJobPass → search → see Fair-Job-Score & salary → save → apply → track → Jobabo → Talent Radar opt-in → contact request → reveal.
**Employer free:** register → Company onboarding or pending Claim → verification submit → Admin verifies → draft 1 job → submit/admin review → publish → see usage limit.
**Employer upgrade:** try 2nd job on Free Basic → upgrade modal → choose plan → mock checkout → Order/Invoice → subscription active → limit increases.
**Boost:** select job → "Job boosten" → use credit or buy → mock payment → JobBoost record → ranks higher → "Geboostet" badge → expires by endsAt.
**Talent Radar:** locked state without candidate query → entitlement → Safe anonymous cards → atomic funded contact → candidate accepts/declines → scoped explicit reveal → employer sees only granted identity.
**Admin:** review pending → approve/reject → manage subs/invoices → edit plans/products → review leads → grant credits → cockpit suggestions → monitor abuse → see metrics.

## §33 External Integration Strategy

Build every external integration with a typed adapter and use-case-specific composition root. Local/CI may use visibly labelled mocks; Staging only explicitly approved Sandbox/Allowlist adapters; Production only exact `live` adapters bound to Environment × Use Case × Adapter × Version × Mode, configuration/evidence digest, secret version, health, owner and kill switch. E-Mail, Payment, Object Storage and Scanner require Phase-33-Live-Code-Contracttests before configuration readiness. Optional AI, Job-Room, Maps/Commute and Salary remain server-side disabled until their own provider, data and legal gates pass. **Don't couple business logic to mock implementations and never fall back from Live to Mock.**

## §34 Documentation Rules

README explains: product overview · stack · architecture · setup · env vars · DB setup · seed · demo accounts · routes · roles · monetization · mock integrations · security/privacy notes · limitations · how to swap mocks for real providers.
`.env.example` follows Phase 01 exactly: DB/App/name, 32-byte base64 Session secret; versioned 32-byte base64 Audit/Radar lookup/Radar encryption/Reveal confirmation/PII Reveal keyrings; `RATE_LIMIT_BACKEND=postgres`; guarded local mailbox; Ops backup Age recipient plus an external secret-mounted `BACKUP_AGE_IDENTITY_FILE` path; inactive future-provider vars. First keyring version writes and older versions read only. Production/Staging fails on placeholder/missing/length/version/reuse/mailbox/backend errors. Tax rates remain reviewed versioned data.

## §35 Definition of Done

Works end-to-end · no broken routes · UI states (loading/empty/error) · server-side perms enforced · ownership checks · Zod validation · sensitive data protected · seed works · demo accounts work · TS/Prisma clean · build/lint/tests run where practical · README updated when behavior changed.

## §36 Final Self-Check Before Completing Large Task

See `00-PLAN.md` Product/Pilot gates, `requirements-matrix.md` E2E-01–08 and the Release/Operations gate in `product-quality-gates.md`. Phase 17 owns E2E-01–07; Phase 18 owns clean-clone/backup/restore E2E-08.

## §37 Commands to Run

Target scripts: `npm ci` · `npm run db:generate` · `npm run db:migrate` · `npm run db:seed` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:integration` · `npm run test:e2e` · `npm run build`. Phase 33 adds `npm run phase33:audit`, `npm run phase33:scale`, `npm run phase33:providers`, `npm run phase33:e2e`, both `phase33:runtime:*` profile checks and the immutable-candidate orchestrator `npm run test:phase33`. If a check cannot run, record Needs Verification; do not check it.

## §38 Communication Style

Precise, honest. Mention: implemented · files changed · commands run · passed · failed · remaining · known limitations. **Don't exaggerate. Don't say "production-ready" if mocked.** Use: "Implemented with mock provider" · "Server-side gated" · "Demo-ready" · "Known limitation".

## §39 Critical Thinking Requirement

For every change, ask: privacy risk? security risk? RBAC break? identity leak? billing impact? plan-limit impact? admin visibility? seed impact? test impact? SEO impact? mobile UX? performance? future provider integration? fairness/trust? audit log needed? disclaimer needed? doc update needed?
**Always implement underlying business logic, not just visible UI.**

## §40 Final Principle

Build SwissTalentHub like it could become a serious Swiss company. Every feature: clear · safe · useful · testable · maintainable · privacy-friendly · commercially sensible · extendable. **Best implementation works reliably, protects users, creates trust, can grow.**

## §41 Remediation Rules Phase 19–33

- Konfliktpräzedenz:
  [AGENTS.md](../AGENTS.md)/aktuelle Owner-Anweisung → explizit freigegebene
  [ADR](./decisions.md) → [Requirements](./requirements-matrix.md) → aktueller
  Masterplan/[Architecture](./architecture-blueprint.md)/Product Strategy →
  [Ausführungsvertrag](./remediation-execution-contract.md) und
  [Traceability](./remediation-traceability.md) → Detailphase/
  Implementation Plan → Legacy-Inventar. Phase 01–18 und ihre Evidence
  bleiben historisch unverändert.
- Jede Detailphase instanziiert alle 28 Pflichtfelder und eine vollständige
  AC→Test-Matrix. Plan-, Technical-, Quality- und Activation-Status sind
  getrennt; kein Häkchen ohne commitgebundene Evidence.
- Sechs Klassen: LC1 lokale Demo, LC2 beaufsichtigter Design-Partner-Test,
  LC3 Invite-only Pilot, LC4 Public Free, LC5 Paid Self-Service, LC6 Scale.
  P0–P4 wird pro Finding und Zielklasse entschieden, nicht pauschal je Datei.
- Genau ein erster Region×Beruf-Cluster. Pflege und Engineering erhalten
  getrennte Korpora. Shared concepts umfassen Beruf, Ort/Region,
  Qualifikation, Zertifikat, Skill und Branche. Thresholded Zero-Result-
  Aggregate ändern nie automatisch die Taxonomie.
- Non-Admin-Step-up, Fraud/ATO/Scam, Company Trust, Job Freshness,
  moderierter Research, Supportkapazität/Stückkosten und Paid-Service-
  Recovery sind Launchverträge, keine kosmetischen Nacharbeiten.
- Phasen 27 sowie 28A/28B sind technisch durch den Owner aktiviert und
  default-off implementiert. Ihre Markt-/Kohortenaktivierung bleibt an
  getrennte explizite Demand-Gates gebunden; Phase 28 verlangt zusätzlich
  Privacy-/Ops-/Support- und gegebenenfalls Providerfreigabe. 30B/30C bleiben
  triggerabhängig. Phase 26 ist vor öffentlichem Company Trust, Firmenjobs oder
  Radar zwingend.
- G4 umfasst Clean Clone, Migration, Seed zweimal, Full Suite,
  Security/Route/Plan-Audits, Provider-/Worker-/Restore-Drills und manuellen
  Rollen-Walkthrough auf exakt demselben Commit/Artefakt. Jede Änderung nach
  Freeze invalidiert betroffene Evidence.
- Phase 33 erzeugt einen neuen technischen LC4-/LC5-Konfigurationscandidate;
  das historische Phase-32-`NO_GO` bleibt unverändert. Ein grünes
  `production-contract`-Profil darf nur `TECHNICALLY_READY_FOR_LC4` oder
  `TECHNICALLY_READY_FOR_LC5_CONFIGURATION` begründen. Ohne reale externe
  Evidence bleibt die Aktivierung `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`; niemals
  `GO_LIVE_APPROVED`.
- Phase-33-Notification-Key-/Retention-/Failure-Invarianten gelten erst nach
  exact-candidate-G4 als technisch belegt. Provider-, Legal-, Privacy-/DPA-,
  AVG-/SECO-, Tax-/Finance-, Ops- und Staging-Gates bleiben unabhängig offen.

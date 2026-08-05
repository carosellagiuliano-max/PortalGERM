# Product Quality Gates

> Cross-cutting checklist for every SwissTalentHub route, component, server action, model, and business flow. Apply this before coding each phase and update the phase file when something is missing.
> Für Phase 19 und später ist der
> [Remediation-Ausführungsvertrag](./remediation-execution-contract.md)
> normativ; dieses Dokument fasst dessen Produktgrenzen zusammen.

## Purpose

SwissTalentHub must not become a collection of attractive screens without underlying product behavior. Every feature must be backed by data, permissions, validation, useful UX states, seed data, tests, and documentation.

Use this file as the "done thinking" gate before implementation starts for a feature.

---

## Universal Feature Gate

For every feature, document or implement all items below:

- [ ] **User story:** who uses it, what they are trying to do, and what success means.
- [ ] **Route / entry point:** URL, navigation location, CTA source, and redirect behavior.
- [ ] **Data model:** Prisma model(s), relations, indexes, unique constraints, and seed impact.
- [ ] **Server action / API:** mutation or query boundary; no business-critical client-only logic.
- [ ] **Validation:** Zod schema, German validation messages, field length limits, enum handling.
- [ ] **Authorization:** role check plus ownership/company/candidate scope check before any read or write.
- [ ] **Privacy:** identity-bearing fields reviewed; no Talent Radar leakage; no private data in SEO or logs.
- [ ] **Feature gate:** plan/product/credit limit enforced server-side where monetized.
- [ ] **Audit:** sensitive action writes `AuditLog` with actor, entity, metadata, and hashed IP where useful.
- [ ] **Notifications:** LC1 records truthful Mock delivery; every activated
      real flow commits a durable classified Outbox entry atomically and uses
      only the explicitly approved environment/provider.
- [ ] **UX states:** default, loading, empty, success, validation error, permission error, rate-limit error, and offline/server error.
- [ ] **Mobile:** usable at 360 px width; forms, tables, filters, modals, and dashboards do not overflow.
- [ ] **Accessibility:** semantic HTML, labels, focus states, keyboard-operable dialogs/menus, sufficient contrast.
- [ ] **Seed/demo:** seeded rows make the feature non-empty for the relevant demo account.
- [ ] **Tests:** unit test for pure logic; integration/manual smoke for critical route; edge cases covered.
- [ ] **Documentation:** README/phase docs mention behavior, limitations, and mock provider boundary.

No feature is complete if it only satisfies the UI row.

---

## Required UX State Matrix

Every route must deliberately handle these states.

| State        | Requirement                                                                |
| ------------ | -------------------------------------------------------------------------- |
| Loading      | Skeleton or compact loading region; no layout jump.                        |
| Empty        | Helpful German copy, next action, and no dead dashboard tables.            |
| Error        | Friendly German message; no stack traces or raw exception text.            |
| Forbidden    | 403 page or inline locked state; explain the missing permission/plan.      |
| Not found    | 404 that does not reveal whether another tenant's record exists.           |
| Success      | Clear confirmation, next step, and persisted DB state.                     |
| Validation   | Field-level German errors and preserved user input.                        |
| Rate limited | Friendly message and audit `RATE_LIMITED`; no retry spam loop.             |
| Mobile       | Filters become sheet/drawer; tables become cards; buttons remain tappable. |

---

## Flow Completion Checks

### Candidate Flows

- [ ] Register/login/logout works and preserves intended `next` redirect safely.
- [ ] SwissJobPass edit writes profile, skills, languages and consent. LC1
      keeps truthful CV metadata-only behavior; a real-CV scope uses only the
      Phase-21 quarantined Vault lifecycle.
- [ ] Search/save/apply flow dedupes applications and records an application event.
- [ ] Jobabo create/edit/delete has email preview and mock email log.
- [ ] Application cockpit supports list + Kanban, notes, withdraw, messages, abuse report.
- [ ] Candidate activation uses the exact complete/reopen predicate; Talent Radar requires COMPLETE + current opt-in, is reversible and writes consent history.
- [ ] Reveal is explicit, candidate-initiated and logged. The required Candidate command `revokeIdentityReveal` revokes all **future Radar DTO access** to that request-scoped grant immediately, never erases knowledge already disclosed; Employer/Admin can neither trigger, clear nor re-enable Reveal.
- [ ] Privacy dashboard exposes bounded Export/Delete/Correction cases, contact/Reveal history, explicit Reveal revocation, and consent log with truthful Mock/irreversibility copy.

### Employer Flows

- [ ] Employer Register requires Terms and atomically creates either User/Profile + new Company/Owner or User/Profile + pending Claim with no Company/Membership; collision/domain never auto-grants. Default Free resolves only in an authorized Company and creates no Billing effect before Phase 12.
- [ ] Company profile edit respects company role permissions.
- [ ] Job wizard persists drafts per step and final submit revalidates everything server-side.
- [ ] Publishing respects active-job limit; blocked actions show an upgrade path.
- [ ] Applicant pipeline never exposes Talent Radar identity unless reveal/application permits it.
- [ ] Talent Radar locked preview does not query anonymous candidate data.
- [ ] Radar requires ACTIVE+VERIFIED Company; Contact consumes source-separated plan→purchased→admin credit atomically, enforces 14-day expiry/pending duplicate/30-day recontact and performs no automatic refund.
- [ ] Billing checkout requires authorized complete BillingProfile, fresh
      risk-based step-up, line PlanVersion/ProductVersion XOR and typed target.
      LC1 uses the labelled Mock provider; LC4 exposes no purchase path; LC5/LC6
      use only the Phase-24 domain contract through Phase-33 authority-bound
      Contract/Sandbox/Live adapter code after WTP-/Finance-/Provider-/Tax-/Legal-
      and target-environment approval. Contract stubs are never payment evidence.
- [ ] Analytics only shows levels allowed by the plan.

### Platform Admin / Operations Flows

- [ ] Admin can moderate jobs, companies, users, reports and imports; triage Support cases; review/publish Content; work leads; and, after Phase 12, manage versioned Billing/Katalog through shared use cases.
- [ ] Suspending a company pauses active jobs and invalidates risky access.
- [ ] Suspending a user invalidates sessions.
- [ ] Admin cannot activate success-fee billing.
- [ ] Business Cockpit shows actionable sales/revenue suggestions, not empty vanity charts.
- [ ] `/admin/business-cockpit` is capability-scoped to Platform Admin/Sales; Company Owner/Admin can read only their own tenant Billing, usage and allowed analytics, never global MRR, leads or another Company.
- [ ] Support lifecycle is capability-scoped, SLA-visible and audited; Content revisions are safe and cannot bypass the liquidity/index gate.
- [ ] Every admin mutation writes audit and has a confirmation where destructive.

---

## Monetization Edge Cases

Handle or document these before billing implementation:

- [ ] Same-plan purchase blocked with clear message.
- [ ] Downgrade path explains what happens to active jobs above the lower limit.
- [ ] Cancelling subscription keeps benefits through the defined instant before `currentPeriodEnd`; exact-boundary tests prove no benefits at/after the end.
- [ ] Failed/cancelled order does not grant credits or plan access.
- [ ] Paid product effects are idempotent; confirming twice does not double-grant.
- [ ] Contact credits cannot go negative under concurrent requests.
- [ ] Included boosts cannot go negative under concurrent requests.
- [ ] Success-fee product stays inactive and disabled even for admins.
- [ ] VAT uses integer Rappen and is displayed only at boundaries.
- [ ] Invoice status transitions are explicit and auditable.

---

## Privacy & Security Edge Cases

- [ ] Talent Radar list payload is constructed from a restricted Prisma `select`; no client-side filtering of private fields.
- [ ] Anonymous ids are not primary keys and cannot be reused to infer candidate identity.
- [ ] Employer can see candidate identity only after direct application or candidate reveal for that company.
- [ ] Message bodies, cover letters, job text, guide content, and abuse descriptions render as sanitized text.
- [ ] No private route is indexable; sitemap excludes dashboards and API routes.
- [ ] Der historische Demo-MVP speichert nur validierte Metadaten. Ein
      aktivierter realer Upload speichert Bytes ausschliesslich im
      Phase-21-Quarantäne-Vault mit Streaming-Limits, Magic-Byte-/Polyglot- und
      Malware-Prüfung, autorisiertem Download, Retention und Löschung.
- [ ] The exact `RATE_LIMIT_PRESETS_V1` covers login, register, reset, apply, privacy intake/challenge, Radar list, contact request, lead form and abuse report; Production/Staging use the shared PostgreSQL bucket store and fail closed on a memory backend.
- [ ] Logs never include passwords, tokens, raw CV content, full message bodies, or payment secrets.

---

## Documentation Evidence

When finishing a phase, capture:

- [ ] Commands run and exact pass/fail status.
- [ ] Manual browser checks and demo account used.
- [ ] Known limitations and "Needs verification" items.
- [ ] Mock-provider behavior and later real-provider integration notes.
- [ ] Screens/routes verified on desktop and mobile widths.

---

## Phase Execution Contract

Every phase file from Phase 19 onward must instantiate, for its own scope,
all 28 fields below. A link is context, not a substitute:

1. Statusquartett (Plan/Technical/Quality/Activation).
2. Ziel und messbarer Business-/Nutzerwert.
3. tatsächlicher Repositoryzustand samt Code-/Schema-/Test-/Planfundstellen.
4. Findings und Requirements.
5. In Scope.
6. Out of Scope und deaktivierte Nachbarfunktionen.
7. Benutzerrollen und organisatorische Owner.
8. Portale, Routen, Services, Provider und Worker.
9. Datenmodelle, Constraints, Indizes und Datenklassifikation.
10. Migration, Backfill, Kompatibilität und Datenprüfung.
11. Serverlogik, Queue-/Lease-/Retry-/Idempotenz- und Providervertrag.
12. Loading, Empty, Locked, Pending, Error, Retry, Conflict, Expired,
    Cancelled und Success.
13. 360-px-/Touch-/Keyboard-/Screenreader-/Accessibility-Vertrag.
14. Authentisierung, Step-up, Autorisierung, Ownership, Assignment,
    Capability und Tenantgrenze.
15. Datenschutz, Zweck, Minimierung, Retention, Export, Löschung und Audit.
16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien.
17. externe/organisatorische Voraussetzungen mit Owner und Gate.
18. harte Implementierungs- und Aktivierungsabhängigkeiten.
19. geordnete, einzeln integrierbare Implementierungsschritte.
20. Feature-/Provider-/Cohort-Flag, Kill Switch und Aktivierungsreihenfolge.
21. Akzeptanzkriterien und vollständige Testmatrix.
22. Performance-, Query-, Queue-, Datei-, Latenz- und Lastgrenzen.
23. geschützte Phase-01–18-Invarianten und Owning-Regressionen.
24. Rollback oder begründetes Roll-forward-only.
25. benötigte Evidence und Artefakte.
26. Definition of Done für Technik und Quality-Gate.
27. Gate, bevor eine abhängige Folgephase integriert oder aktiviert wird.
28. ausdrücklich nicht bewiesene Aussagen.

The AC→test matrix has separate columns for criterion/requirement, risk,
test type, test case, positive case, negative/abuse case, role,
portal/system, test data, environment, exact command/manual flow, measurable
expected result, evidence, owner and status. “Test exists”, an inherited
green run or an unchecked command is not passed evidence.

## Launch-class Gate

Every release and every P0–P4 decision names exactly one or more target
classes:

- **LC1** local demo;
- **LC2** supervised design-partner test;
- **LC3** invite-only pilot;
- **LC4** public free launch;
- **LC5** paid self-service;
- **LC6** scaled production.

Higher classes inherit safety/evidence requirements; optional product
features do not become mandatory unless the chosen offer promises them.
Phase 26 is mandatory before any public verified-company badge, public
company job or Radar trust claim. Phase 28 is not a universal launch
dependency.

### Technical readiness is not activation

Phase 33 may return `TECHNICALLY_READY_FOR_LC4` or
`TECHNICALLY_READY_FOR_LC5_CONFIGURATION` only when its full repository,
migration, provider, worker, Production-Contract, role/journey/browser and
artifact matrix is green on one immutable candidate. These verdicts mean that
later secrets, accounts and approved configuration need no further code
change; they do not mean that any provider, cohort, paid offer or public
environment is active.

`GO_LIVE_APPROVED` additionally requires the exact target deployment plus all
scope-relevant Provider, Legal, Privacy, AVG, Tax, Finance, Operations,
Rollback, Monitoring, Research/WTP/Capacity and independent Approval evidence.
If any is missing, the only valid activation result is
`ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`. The historical Phase-32-`NO_GO`
remains unchanged.

For Phase 33 the complete action evidence chain is:

```text
User action → UI/state → Zod → Session/AAL → Role/Capability
→ Tenant/Ownership/Assignment → Entitlement/Feature/Provider gate
→ transaction/idempotency → DB/Provider/Worker
→ Audit/Outbox → safe response → persisted UI feedback
```

A page load, route smoke, queued status, sandbox receipt or green build alone
does not satisfy this chain.

## Route Evidence Record

Use one record for every important page before checking its route deliverable:

| Field                       | Required evidence                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Purpose / roles             | User goal, allowed roles and entry CTA                                                                                        |
| Primary / secondary actions | Exactly what persists or navigates                                                                                            |
| Data                        | Read model, pagination/filter and freshness                                                                                   |
| Server policy               | Session, capability, tenant, ownership, assignment, entitlement                                                               |
| States                      | Default, loading, empty, validation, conflict, error, forbidden/not-found, locked, success, onboarding/offline where relevant |
| Trust/privacy               | Score/source/date/sponsoring/consent/PII behavior                                                                             |
| Desktop/mobile              | Screenshot or named manual check at desktop and 360 px                                                                        |
| Accessibility               | Keyboard path, focus/error announcement, automated result                                                                     |
| Seed                        | Named fixture/account/state                                                                                                   |
| Tests                       | Requirement/Test IDs and pass result                                                                                          |
| Evidence                    | Target commit, date, environment and command/manual check                                                                     |

## Marketplace and Commercial Gates

- [ ] Production-like data has documented provenance and permission; no scraping or hidden demo data.
- [ ] Exactly one first Region×Occupation cluster is selected through a
      pre-registered Go/No-go; Pflege and Engineering use independent corpora and
      cannot prove each other.
- [ ] A promoted/indexed cluster passes its documented liquidity/content gate.
- [ ] Free-to-paid restrictions correspond to additional economic value, not an intentionally broken basic flow.
- [ ] Pricing, period, VAT, renewal, cancellation and downgrade effects are visible before confirmation.
- [ ] Every upgrade prompt has a real reason code and points to a currently available product/plan.
- [ ] Sponsored inventory is capped, clearly labelled and never changes fairness scores.
- [ ] Mock checkout completion is labelled as product-mechanics evidence, never paid conversion, collected revenue or willingness-to-pay.
- [ ] Pricing/packaging approval uses a pre-registered real-money KMU offer test; monthly, hiring-sprint and retainer/credit options are compared on normalized value.
- [ ] Base workflow, Hiring Sprint, Retainer, Concierge and approved Import
      are tested before Boost/Radar upsells; Boost proves only reach value and
      Radar requires density.
- [ ] Each paid service has scope, deadline, customer duties, capacity,
      unit cost and platform-failure remedy; refund, credit restoration and
      invoice correction cannot drift.
- [ ] Episodic pause/reactivation is measured separately from durable logo churn.
- [ ] A monthly cashflow/runway model covers hiring, CAC timing, support, infrastructure, churn/reactivation, cumulative burn and peak funding without double-counting Sales/CAC.
- [ ] Any indexed salary orientation uses a versioned, lawful, reviewed LIVE source with honest occupation/region granularity, uncertainty, attribution and refresh owner; otherwise it is unavailable, `noindex` and absent from the sitemap.
- [ ] The concrete job-market/Application/Radar/Contact/Reveal/payment flow has a documented AVG/AVV determination and required permission before real operation.
- [ ] Product analytics can measure activation, application response, employer value, conversion and churn without content/PII.
- [ ] Business Cockpit recommendations contain evidence period, reason, next action, owner and outcome.
- [ ] Unsupported products/claims are removed or explicitly labelled as future; Success Fee cannot be activated.

## Identity, Trust, Fraud and Freshness Gates

- [ ] Registration, invite, reset and email change use verified,
      purpose-bound, expiring single-use identities; email change re-verifies and
      invalidates risky sessions as defined.
- [ ] Non-admin high-risk actions (checkout, bulk export/download, identity
      reveal administration, account/security changes) use risk-based step-up,
      not merely an admin-only MFA assumption.
- [ ] Admin capabilities are least-privilege; sensitive actions have SoD or
      dual control, audited break-glass and recovery.
- [ ] Credential stuffing, ATO, compromised company, scam job, mass
      messaging/contact, reveal/export anomaly and payment fraud have detection,
      containment, appeal/recovery and evidence.
- [ ] Company verification has evidence provenance, reviewer separation,
      expiry/re-review and rapid revocation. Public trust surfaces disappear
      consistently on loss.
- [ ] Job reconfirmation, expiry, duplicate/copied-job detection and
      “filled/unavailable” reporting feed one canonical freshness state.
      Ineligible jobs disappear from Search, Alerts, Recommendations, Radar/
      Matching, Feeds, Exports and Sitemap within the defined SLO.
- [ ] Unknown/zero-result search feedback stores no raw sensitive query or
      stable user fingerprint; only thresholded, retention-limited aggregates
      enter a reviewed taxonomy backlog.

## Research, Support Capacity and Service-Recovery Gates

- [ ] Moderated candidate, employer and operator studies measure task
      success, time, errors, abandonment and comprehension on named flows.
- [ ] Pilot capacity names concurrent customers/cases, minutes per flow,
      fully loaded cost, backlog SLO, escalation budget and overload behavior.
- [ ] A successful automated test does not replace legal, privacy, finance,
      provider or target-user evidence.

## Data and Concurrency Gates

- [ ] Schema changes use migrations and include rollback/forward notes; no production `db push`.
- [ ] Money fields are Rappen integers and catalog/invoice fields are immutable snapshots.
- [ ] Credit, quota, publish, checkout and fulfillment races are covered by real PostgreSQL integration tests.
- [ ] Idempotency keys have database uniqueness and are scoped to the use case/tenant.
- [ ] Status changes use an allowed-transition function and append an event.
- [ ] List endpoints are bounded and indexed; ranking is applied globally before pagination.
- [ ] Seed uses a deterministic clock/namespace and refuses production demo data.

## Talent Radar Threat-model Gate

- [ ] One canonical, versioned opt-in source exists and defaults off.
- [ ] Locked state returns before any candidate repository query.
- [ ] Anonymous DTO is an allowlist and has Canary-PII regression tests across JSON, HTML and logs.
- [ ] Opaque Radar identifiers cannot be mapped from primary keys or stable handles by clients.
- [ ] `RADAR_PRIVACY_POLICY_V1` is enforced after the complete filter conjunction: closed buckets, cohort floor 10, no exact total, stable daily max-20 sample, max two signed-cursor pages, 10 list requests/minute/Membership and 30 distinct filter hashes/day/Company.
- [ ] Opaque ids are random Company-scoped 128-bit tokens with keyed lookup, no-overlap 30-calendar-day Europe/Zurich epochs, immediate invalidation on eligibility loss and a fresh id after re-opt-in; replay/cross-company/expired values fail indistinguishably.
- [ ] Contact allowance/credit consumption records funding source and is atomic/idempotent.
- [ ] Accept, decline, exact 14-day expiry, pending duplicate, 30-day recontact, Company trust revocation and no-auto-refund/Admin exact-reversal policies are explicit and clock/DB tested.
- [ ] Reveal identifies recipient Company, accepted request/conversation, one grant per accepted request, closed append-only `RevealField` rows and immutable notice/confirmation evidence. Each field stores its exact confirmed value as an AES-256-GCM encrypted, versioned, typed snapshot under a dedicated PII keyring; Radar reads decrypt that snapshot only after the current trust/grant guard and never reread live profile identity or generic JSON. Employer cannot trigger it.
- [ ] Candidate revocation is idempotent and blocks the next identity read; opt-out/suspension cancels pending requests under the canonical transaction, cancelled requests are read-only/reportable, and already accepted history is retained.
- [x] EXPORT/DELETE/CORRECT intake is bounded and owner-scoped; Admin privacy routes use named read/verify/process capabilities, two independent action-/resource-bound approvals and the closed status/command matrix. Local/mock remains visibly synthetic; Phase 33 additionally exercises the real encrypted Approval→WorkItem→Worker→Artifact/Outbox contract against isolated production-contract storage without claiming external processing.
- [ ] Candidate UI explains that already delivered identity cannot technically be taken back.
- [ ] Export/delete/retention behavior is honestly classified as local mock,
      `CONTRACT_ONLY` or externally reviewed/activated; no contract stub is labelled
      a real subject-rights fulfilment.

## Release and Operations Gate

Die in diesem Dokument geschlossenen technischen Phase-33-Checkboxen sind im
[Phase-33-Evidence-Record](./evidence/2026-08-05-phase-33.md) auf demselben
Candidate belegt. Offene externe Checkboxen bleiben davon unberührt.

- [x] Clean clone, install, migration, seed, lint, typecheck, all tests and production build pass on the release commit.
- [ ] CI, Preview, Staging and Production have separate secrets/databases and fail-fast env validation.
- [x] Private pages are both `noindex` and no-store/dynamic as required.
- [x] Live/readiness checks, structured redacted logs and correlation IDs work.
- [ ] Alerts/runbooks cover auth, database, ledger/payment, import and suspected cross-tenant/privacy incidents.
- [x] Unattended public self-service has a durable worker/outbox with lease/singleton, idempotency, retry/backoff, dead-letter, monitoring and restart/concurrency/failure-recovery evidence.
- [ ] Backup retention and business-approved RPO/RTO exist; an isolated restore was actually tested.
- [x] Dependency, license and secret scans have no unresolved critical finding.
- [ ] Legal/privacy/tax/provider Go-live blockers are named and signed off separately from technical tests.
- [x] Production accepts no Mock/Sandbox/Demo/`.invalid`, local-filesystem or
      secret-only provider activation and has no Live→Mock fallback.
- [x] Phase-33 E-Mail-Evidence trennt Delivery-AES-/Recipient-HMAC-Keyring und
      Resend-API-/Webhook-Secret-Version samt vollständigem Key-Version-
      Inventar; belegt normalen 23-h-Wipe, AES-v2 maximal 31 d und exakt
      `400 × 24 h` bis zur one-way Attempt-PII/Receipt/Digest-Kompaktion bei
      erhaltener nicht-PII Auditkette; minutenbasierte Retention läuft trotz
      Provider-Revoke. Unknown Outcomes enden nach bounded Same-Key-Retry
      `PAUSED`/manuell reconciliert, nie Blind-Resend/Dead Letter; Webhook-
      Activation ist im TX gelockt und Inbox/Suppression sind monoton.
- [x] A pinned, isolated `local/mock` profile preserves labelled demo behavior
      without external effects.
- [x] A pinned, isolated `production-contract` profile runs the built
      Standalone/OCI app, separate worker, scheduler, PostgreSQL 16, TLS proxy,
      S3-compatible storage, scanner and provider HTTP stubs with healthchecks,
      network boundaries and failure injection. Stubreceipts are marked
      `CONTRACT_ONLY`, never Live evidence.
- [x] Historical migration SQL SHA-256 values are identical before/after;
      Fresh/Upgrade/Legacy/Partial/Restart/Concurrency states are tested with
      `migrate deploy`, never `db push` as evidence.
- [x] Final candidate binds Tree, Lockfile, migration, runtime/feature/provider/
      worker inventories, configuration, Standalone/OCI artifact and Evidence
      digests; any post-freeze fix restarts the complete gate.
- [x] Chromium, Firefox and WebKit cover launch-critical journeys on Desktop,
      360 px and critical 320 px with Keyboard, focus, Zoom/Reflow, Reduced
      Motion and Axe; Fail, unexplained Skip, Retry, Console/Network error,
      cross-tenant leak and Secret/PII finding are all zero.

## Evidence Status Vocabulary

- **Planned:** requirement exists; no code claim.
- **Implemented, not verified:** code exists; checkbox remains open.
- **Needs verification:** test/check could not be run; checkbox remains open with reason.
- **Verified in target:** dated target-repository evidence exists; eligible for `[x]`.
- **Mock provider:** local persisted behavior only; never phrased as real delivery/payment/storage.
- **Production contract:** the real adapter/build/runtime code passed against
  isolated synthetic contract services; always `CONTRACT_ONLY`, never external
  delivery, payment, Staging or Live evidence.
- **Technically ready:** every repository-internal gate for the named launch
  class/configuration passed on one immutable candidate; Activation remains a
  separate decision.
- **Blocked by external gates:** technical path is complete but named real
  Provider/Legal/Privacy/AVG/Tax/Finance/Ops/Staging/Approval evidence is absent.
- **Deferred / rejected:** recorded in the audit/ADR with impact and replacement, never silently removed.

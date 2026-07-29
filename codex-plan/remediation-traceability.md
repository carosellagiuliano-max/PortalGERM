# Remediation-Traceability — STH-001 bis STH-037

> **Planungsstand:** 26. Juli 2026
>
> **Frühere Analysebaseline:** `eb9b45ae5caca638b558f6a98e406af9ee8be0fc`
> (`eb9b45a`)
>
> **Ursprünglicher Planungscommit:** `e34262e3074565840e371c336a5d2ba5cf3efbac`
> (`e34262e`), bei Prüfungsbeginn identisch mit `origin/main` und sauber.
>
> **Ausgeführte Phase-19-Baseline:** Candidate
> `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c`, vollständiger Golden-Run
> bestanden; [Evidence](./evidence/2026-07-26-phase-19.md).
>
> **Geltungsbereich:** unabhängige Neubewertung der 37 Befunde gegen Schema,
> Migrationen, Runtime-Code, Provider-Composition, Rollen-/Capability-Grenzen,
> Tests, Release-Evidence und Runbooks. Dieses Dokument steuert die offenen
> Implementierungen. `STH-029` ist governance-seitig geschlossen;
> `STH-001`, `STH-002` und `STH-013` sind durch Phase 20 technisch
> geschlossen, `STH-026` im fachlichen Kern umgesetzt. Reale Zustellung,
> autonome Worker, Legal-/Providerfreigabe und die Phase-29-Breite bleiben
> offen. Dieses Dokument erteilt keine Go-live-Freigabe.

## 1. Methodik und Statussemantik

Jeder Befund wurde nicht aus der gelieferten Analyse übernommen, sondern gegen
den aktuellen Baum geprüft. Abwesenheitsbefunde wurden zusätzlich über
repository-weite Suchen nach Routen, Modellen, Adaptern, Commands und Tests
geprüft. Vorhandene Demo- oder Sicherheitsmechanik wird ausdrücklich von
Produktionsreife getrennt.

Die Statuswerte bedeuten:

- **bestätigt:** Die behauptete Lücke besteht auf der Baseline.
- **teilweise bestätigt:** Ein belastbarer Teilvertrag ist vorhanden; der
  behauptete Produktions- oder Qualitätsumfang fehlt aber.
- **bewusst anders / korrekt:** Die Abweichung ist ein gewollter Schutzvertrag
  und darf vor den genannten Gates nicht entfernt werden.
- **bereits korrekt gelöst:** Der behauptete Fehler besteht auf der
  Planungsbaseline nicht; seine Owning-Regression bleibt geschützt.
- **falsch oder veraltet:** Code/Plan/Evidence widerlegt die Aussage; daraus
  entsteht keine Scheinanforderung.
- **deferred / fail-closed:** Die Lücke ist real, aber ohne Demand-/Capacity-/
  Zielklassen-Trigger bleibt die Funktion sicher deaktiviert.
- **externe Voraussetzung:** Der technische Mess- oder Gate-Pfad ist vorhanden;
  der Abschluss kann nur durch reale externe Evidenz erfolgen.
- **launchklassenspezifisch:** Priorität und notwendige Testtiefe stehen in
  Abschnitt 3B; ein optionaler Pfad wird entweder vollständig gegatet oder für
  seine aktivierte Klasse P0.

`Implementierungsstatus` beschreibt ausschließlich Remediation-Arbeit nach
Phase 18. Nur commitgebunden belegte Arbeit wird als erledigt markiert.
Zeilenanker beziehen sich auf die geprüfte Baseline und müssen bei
Codeverschiebungen im jeweiligen Phasenabschluss aktualisiert werden.
Technischer Phasenabschluss und LIVE-Aktivierung sind getrennt: Ein
implementierter Handler oder Adapter darf als technisch belegt gelten, während
ein späteres Operations-, Admin-, Legal-, Provider- oder Markt-Gate den
Realmodus weiterhin fail-closed hält. Die Details stehen in
[`remediation-masterplan.md`](./remediation-masterplan.md) §1.3.

## 2. Zentrale Traceability-Matrix

| ID | Kurzbeschreibung | Unabhängiger Status | Neu eingeordnete Priorität | Bereich | Verantwortliche Phase | Abhängigkeiten | Implementierungsstatus | Teststatus auf Baseline | Aktuelle Fundstelle / Evidence | Externer Blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| STH-001 | Keine E-Mail-Verifikation | technisch gelöst; LIVE-Aktivierung extern blockiert | P0 vor personenbezogenem LIVE-Betrieb | Identity/E-Mail | 20 | 19, Provider- und Outbox-Entscheid | Phase-20-Workflow, Low-Assurance, Reverification und E-Mail-Change implementiert | Unit/PostgreSQL/Race/Browser `PASS`; Retry 0 | [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md); `lib/auth/email-verification-service.ts`; `lib/auth/email-change-service.ts` | Absenderdomain, DPA, Zustellprovider |
| STH-002 | Privacy-Identitätschallenge für normale Registrierungen unerreichbar | technisch gelöst; Phase-22-Accountvollzug ebenfalls Sandbox-`PASS`, Production/Nicht-Kontoinhaber blockiert | P0 | Privacy/Identity | 20/22 | STH-001, STH-013; Phase 25 Alternative Identity/Step-up | Registration→Verify→Privacy-Brücke und accountgebundener V2-Vollzug implementiert; alternative Challenge bleibt fail-closed | Phase-20-Identity plus Phase-22-Privacy PostgreSQL/Browser `PASS` | [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md); [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md) | Phase-25-Identity/Step-up, Counsel und Aktivierung |
| STH-003 | CV nur als Metadaten, keine nutzbaren Bytes | technisch gelöst; LIVE-Aktivierung extern blockiert | P0 vor realer Bewerbung | Dokumente/Storage | 21; Privacy-Lifecycle 22 | 19/20, STH-004; Worker/Step-up bleiben 23/25 | Quarantäne-first CV-Bytes, immutable Versionen, single-use Read-Grants, Reconciliation sowie Phase-22-Export-/Hold-/Erasure-Sandboxvertrag implementiert | Unit/Provider/PostgreSQL/Last/Browser Desktop+360 `PASS`; G3 Retry 0 | [Phase-21-Evidence](./evidence/2026-07-26-phase-21.md); [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md); `lib/documents/vault-service.ts` | externer Storage/KMS/Scanner, Region/DPA, fachliche Retention/Legal-Hold, autonome Worker |
| STH-004 | Produktive externe Provider fehlen | teilweise gelöst; E-Mail-, Storage-/Scanner- und Payment-Sandbox technisch, LIVE und weitere Provider offen | P0-Programm, je Provider separat | Provider | 20/21/23/24, Lead 23 | 19 sowie Legal, Secrets, Monitoring | fail-closed E-Mail-, Storage-/Scanner- und Stripe-Testverträge; Payment ohne Real→Mock-Fallback, Production/LIVE nicht implementiert | Provider-Contracts/Failure-Smokes Local/CI `PASS`; keine LIVE-Evidence | [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md); [Phase-21-Evidence](./evidence/2026-07-26-phase-21.md); [Phase-24-Evidence](./evidence/2026-07-27-phase-24.md) | Providerverträge, DPA/Region, DNS/Zugänge, Monitoring, Budget, Staging |
| STH-005 | Keine reale Zahlung/Billing-Abwicklung | technisch Local/CI gelöst; Paid-Aktivierung extern blockiert | P0 für Paid Self-Service | Billing/Finance | 24 | 19, STH-004, Worker, Tax/Legal, früher Phase-31A-Go/No-go | Stripe-Test-Hosted-Checkout, signierte Inbox, monotone Projektion, Reconciliation, Refund/Chargeback/Dunning implementiert; Mock getrennt | Unit/PostgreSQL/Browser Local/CI `PASS`; PSP-/Staging-/LIVE-Evidence blockiert | [Phase-24-Evidence](./evidence/2026-07-27-phase-24.md); `lib/billing/payment-inbox.ts`; `lib/billing/finance-reconciliation.ts` | WTP-Go, PSP-Vertrag, Tax/Legal/Finance, Phase-25-Step-up, Staging/G4 |
| STH-006 | Kein realer Datenexport und keine reale Löschung | technisch im Local-/CI-Sandboxvertrag gelöst; Gesamtgate/Activation blockiert | P0 | Privacy/Legal | 22 | 19, STH-001/002, Storage; Phase 25 Alternative Identity/Step-up | Inventory-V2, verschlüsselter Streamingexport, Correction/Erasure, Holds, Processor-Outcomes und Restore-Tombstones implementiert; Nicht-Kontoinhaber fail-closed | Unit/PostgreSQL/Foreign-Canary/Failure/Restore/Last/Browser/G3 `PASS` auf `0636a875` | [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md); `lib/privacy/export-v2.ts`; `lib/privacy/execution-v2.ts`; `lib/privacy/restore-reconciliation.ts` | signiertes Inventory, Counsel/Retention/Provider; Phase-25-Identity; moderierte Forschung |
| STH-007 | Keine öffentlichen Rechtsseiten/kanonischen Rechtstexte | technische Publication-/Gate-Infrastruktur gelöst; Rechtstexte nicht fachlich freigegeben | P0 vor öffentlichem LIVE | Legal/Consent | 22 | 19, Counsel, STH-006/017/026 | `/legal/privacy`, `/legal/terms`, `/legal/imprint`, Admin-CMS, unabhängige Review/Publish/Revoke und exakte Processing-Gates implementiert; ohne Publication gesperrt | PostgreSQL/Hash/Re-consent/Desktop/360/Axe/G3 `PASS` auf `0636a875` | [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md); `lib/legal/publication-service.ts`; `/admin/legal`; `/legal/*` | signierte CH-Texte, AVG/DSG/AGB/AVV/DPA/DSFA-Entscheide |
| STH-008 | Produktionsbetrieb extern/offen | externe Voraussetzung; lokale Runbooks und strikte Evidence-Validatoren vorhanden | P0 Go-live-Gate | Operations/Release | 23 | 19, Infrastruktur, STH-004/009 | Preview/Staging/Production weiter unverbunden; Deploy-/Pager-/Restore-Gates validieren externe SHA-256-Evidence fail-closed | lokaler Release-/Recovery-Drill und Phase-23-Validator-Tests grün; ohne Stagingkontext erwarteter Block | `codex-plan/runbooks/deployment.md`; `lib/ops/external-operations-evidence.ts` | Infrastruktur, Secrets, Pager/Owner, automatischer Backup-Lifecycle, genehmigte SLO/RPO/RTO |
| STH-009 | Kein autonomer Worker | technisch lokal/CI adressiert; Productionausführung extern blockiert | P0 für unbeaufsichtigten Self-Service | Worker/Outbox/Ops | 23 | 19, STH-013, Monitoring | gemeinsame PostgreSQL-Queue mit Lease/Heartbeat/Fencing, Retry/DLQ/Replay, Scheduler, WorkerRun, Handlerledger und Backpressure implementiert; Default `PAUSED` | Unit/PostgreSQL/Crash/Restart/Rolling-Deploy/10’000×4/Desktop/360 `PASS` im Worktree; formales G3/Staging/Pager offen | `lib/ops/worker-runtime.ts`; `scripts/phase23-worker.ts`; `codex-plan/runbooks/worker-operations.md` | Workerhosting, externes Monitoring/Pager/On-call, SLO-Freigabe |
| STH-010 | Alle Admin-Capabilities hängen am globalen ADMIN | technisch Local/CI gelöst; Activation extern blockiert | P0 vor Admin-LIVE | Admin-RBAC | 25 | 19, Rollen-/Duties-Matrix | deny-by-default Resolution aus zehn persistierten Rollen, zeitgebundenen Assignments/Grants und Break-glass; globale Rolle allein gewährt 0 | Unit/PostgreSQL/Direct-Action/Browser `PASS`; Revoke wirkt im nächsten Read | `lib/admin/role-policy.ts`; `lib/admin/capabilities.ts`; [Phase-25-Evidence](./evidence/2026-07-28-phase-25.md) | benannte Support/Moderation/Finance/Privacy/Security/Trust-Owner weiterhin extern |
| STH-011 | Kein Admin-MFA/Step-up | technisch Local/CI gelöst; Production-RP-ID/Policy extern blockiert | P0 vor privilegiertem LIVE-Zugriff | Admin Security | 25 | 19/20/23, STH-001/013 | Passkey/WebAuthn, verschlüsseltes TOTP, gehashte Single-use-Recovery-Codes, Session-AAL2 und action-bound Step-up | Unit/PostgreSQL/Desktop/360 `PASS`; replay/stale/wrong origin/RP-ID/recovery/direct action negativ | `lib/auth/assurance/**`; `/admin/security/authenticators`; [Phase-25-Evidence](./evidence/2026-07-28-phase-25.md) | Geräte-/Recoverypolicy, Production-RP-ID, getrennte Recovery-Owner und On-call weiterhin extern |
| STH-012 | Exklusive globale Rolle verhindert Multi-Persona | technisch auf `291b953` Local/CI gelöst; Marktaktivierung deferred | P3 default; P0 nur für explizit aktivierten Persona-Scope | Identity/Persona | 27 | 19/20/22/23/25, Tenant-RBAC, Bedarfsgate | additive PersonaAssignments, versionierter Session-/Company-Kontext, Invitation/Self-Service-Step-up, Privacy/Suspension/Audit implementiert; Defaults disabled | Unit/PostgreSQL/Migration/Desktop/360 und lokales G3 `PASS`; vollständiger Abschluss siehe Evidence | [Phase-27-Evidence](./evidence/2026-07-28-phase-27.md); `lib/auth/persona-context.ts`; `/account/portal`; `prisma/migrations/20260728160000_phase_27_multi_persona_identity` | moderierter Bedarf, vier Owner-Sign-offs, Canary/Staging/G4 |
| STH-013 | Kein dauerhafter E-Mail-Outbox-/Retry-Vertrag | technisch gelöst; autonome Productionausführung bleibt offen | P0 | E-Mail/Worker | 20 | 19, STH-004/009 | atomare Outbox, Attempts, Lease, Heartbeat, Retry, Suppression, DLQ und auditiertes Sandbox-Replay implementiert | 105-Message-Two-Worker-, Crash-, Restart-, Bounce-, Poison- und DLQ-Tests `PASS` | [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md); `lib/notifications/outbox.ts`; `lib/notifications/dispatcher.ts` | Zustellprovider, Phase-23-Monitoring/Pager |
| STH-014 | Company Verification beruhte auf Text/Referenz | technisch Local/CI gelöst; öffentliche Aktivierung extern blockiert | P0 für Trust-/Publish-Gate | Company Trust | 26 | 19/21/23/25, STH-003/004, Legal/Operations | strukturierte Evidence/Checks/Challenges/Decisions/Projection, Vault, Expiry/Re-review, SoD, Appeal und gleiche Badge-/Job-/Radar-Revocation implementiert | Unit/PostgreSQL/HTTP/Desktop/360 `PASS`; fehlende/mismatched/expired/revoked/Legacy Evidence erzeugt `0` starken Trust | [Phase-26-Evidence](./evidence/2026-07-28-phase-26.md); `lib/companies/verification/**`; `/employer/verification`; `/admin/company-verification` | reale Register-/Domainprovider, Nutzungsrecht/DPA/Region, Reviewer-Capacity, Staging/Pager und Public-Go |
| STH-015 | Externe Bewerbung endet beim Klick | technisch Local/CI gelöst; Marktaktivierung deferred | P3 default/discovery; P0 nur wenn als Launchfunktion versprochen | Recruiting/Application | 28A | 19/20/22/23/25, 29A-Bedarf und STH-009/013/026 | Candidate-owned Tracker trennt Click, Resume, bestätigtes Submit und Outcome; immutable Snapshot, Reminder, Audit und Privacy-Lifecycle; default disabled | Unit/PostgreSQL/Migration/Privacy/Desktop/360/A11y und interne Application-Regression `PASS` | [Phase-28-Evidence](./evidence/2026-07-29-phase-28.md); `lib/recruiting/external-tracker.ts`; `/candidate/applications/external/**` | moderierter Bedarf, Product/Privacy/Ops/Support; optionale ATS-/Mail-Signale |
| STH-016 | Keine persistente Interviewplanung | technisch Local/CI gelöst; Marktaktivierung deferred | P3 default/discovery; P0 nur wenn als Launchfunktion versprochen | Recruiting/Scheduling | 28B | 19/20/22/23/25, 29A-Bedarf und Application-RBAC | persistente getrennte Interview-State-Machine mit IANA/DST, RSVP, Reschedule/Cancel, ICS, Reminder, Audit und Privacy; default disabled | Unit/PostgreSQL/Migration/Worker/Privacy/Desktop/360/A11y und Tenant-/Assignment-Matrix `PASS` | [Phase-28-Evidence](./evidence/2026-07-29-phase-28.md); `lib/recruiting/interviews.ts`; `/candidate/interviews/**`; `/employer/applicants/[id]/interviews/**` | moderierter Bedarf, Product/Privacy/Ops/Support; optionaler Kalenderprovider |
| STH-017 | Produktionsanalytics deaktiviert | technische Consent-/Gate-Policy gelöst; Productionactivation bewusst blockiert | P1; Legal-Gate vor Aktivierung | Analytics/Consent | 22 | 19, STH-007/026, Legal/Data Governance | eventfamilienweise default-off Policy, exakte Publication/Approval/Consent/Retention/Property-Allowlist und sofortiger Revoke implementiert; Search Learning fail-closed | Unit/PostgreSQL/50-parallel-Last/Browser/G3 `PASS` auf `0636a875`; optionale LIVE-Events weiterhin 0 ohne Gate | [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md); `lib/analytics/live-consent-policy.ts` | Consent-/DPA-/Retention-/Region-Freigabe; moderierte Forschung |
| STH-018 | Marketplace-Liquidität unbewiesen | externe Voraussetzung; technische Gate-Mechanik vorhanden | P0 Markt-Gate | Marketplace/Go-to-market | 31 | 19, reale Kohorten/Analytics und STH-019-Evidence je Startcluster | kein generischer Codefix; LIVE-Evidence offen | Gate, Seed, Dual Approval und Revoke getestet; Search-Quality-Gate fehlt | `lib/seo/cluster-launch-policy.ts:3-15`; `prisma/schema.prisma:2918-2963`; `lib/admin/cluster-launch.ts:36-287` | reale Arbeitgeber/Kandidaten/Jobs/Responses und Fachreview der Suchmenge |
| STH-019 | Startcluster-Suche ohne gemeinsamen Berufs-/Ort-/Qualifikations-/Skill-/Branchenvertrag | bestätigt; normalisierte MVP-Suche vorhanden | P0 je aktivem LC3+-Cluster; P1 Design Partner, P2 Demo | Search | 30A | 19, versionierte Taxonomie, Pflege-/Engineering-Korpus, Golden-/Negativkorpus und Clusterfreigabe | offen; Search, Alert und Recommendations besitzen keinen gemeinsamen Konzeptvertrag | deterministische Basis-Tests, aber kein Startcluster-Recall-/Parity-Benchmark | `lib/search/relevance.ts:7-38`; `lib/jobs/public-read-model.ts:1412-1439`; `lib/candidate/job-alerts.ts:1444-1462`; `lib/candidate/dashboard.ts:318-386` | Fachreview je tatsächlich aktiviertem Cluster |
| STH-020 | Admin-Queues mit harten Caps | bestätigt | P1 vor hohem Betriebsvolumen | Admin Operations/Scale | 30B | 19, STH-010, Cursor-/Indexvertrag | offen | Bounded-read-Tests, keine >250-Erreichbarkeitsmatrix | `lib/admin/companies.ts:33-45`; `lib/admin/jobs.ts:68-79`; `lib/admin/users.ts:18-25`; `lib/admin/support.ts:99-103` | keine |
| STH-021 | Dashboard-Empfehlungen mit Query-Fan-out | technisch wesentlich mitigiert; finales Query-count/p95-Gate offen | P1 Performance | Candidate/DB Scale | 27 Mitigation; 30B Abschluss | 19, Batch-Read-/Rankingvertrag | Jobdetails werden in einem bounded Eligibility-Snapshot statt N parallelen Transaktionen hydratisiert; Notification-/Gesamtquery-Ceiling bleibt Phase 30B | Batch-Query-Shape und Phase-27-Browserregression `PASS`; 48-Job-Instrumentierung offen | `lib/jobs/public-read-model.ts`; `lib/candidate/dashboard.ts`; `tests/unit/jobs/public-read-model-query-shape.test.ts` | keine |
| STH-022 | Business/Enterprise nur eingeschränkt lieferbar | teilweise bestätigt; bewusst gegatet | P1 nach WTP, XL je Integration | Monetization/Enterprise | 31 | 19, STH-004/009/024, Marktvalidierung | offen; Kernentitlements vorhanden, Integrationen fehlen | Release-/Grant-Tests vorhanden, bewusst kein ImportRun | `prisma/seed/fixtures/plans.ts:138-168,263-282`; `components/marketing/pricing-card.tsx:120-157`; `prisma/schema.prisma:3472-3528` | Design-Partner, SLA/DPA, Integrationszugänge |
| STH-023 | Browser-/Accessibility-Matrix unvollständig | technisch weitgehend gelöst; reale AT-Abnahme offen | P1 | UX/A11y/Browser | 29 | 19, CI-Browser, manuelle AT-Matrix | Chromium/Firefox/WebKit, serious+critical Axe, Keyboard, Reflow, Contrast und Motion lokal `PASS`; Releaseartefakt-Retest offen | 340/340 Browsertests; gezielte Phase-29-Matrix 16/16, Retry/Skip 0 | `playwright.config.ts`; `tests/e2e/quality/phase29-*.spec.ts`; [Phase-29-Evidence](./evidence/2026-07-29-phase-29.md) | NVDA/VoiceOver-Geräte/Tester |
| STH-024 | Manueller Walkthrough nicht auf aktuellem Release-Commit | bestätigt | P0 Release-Gate | Release Evidence | 32 | alle Remediation-Phasen, sauberes Artefakt | offen; Walkthrough muss auf finalem Commit neu laufen | Automation auf neueren Commits, manueller Lauf auf Vorgänger | `BUILD_REPORT.md:3-19,141-165`; `codex-plan/evidence/2026-07-24-commercial-launch-follow-up.md:46-69` | Staging/Release-Artefakt und Rollen-Tester |
| STH-025 | Mobile Tabellen bleiben horizontale Desktoptabellen | im aktuellen Repository technisch gelöst; Researchpriorisierung offen | P2; P1 für häufige mobile Aufgaben | Mobile UX | 29 | 19, Responsive-List-Pattern | gemeinsames semantisches Table→Card-Pattern mit einem Action-/Wertebaum in allen inventarisierten Admin-/Employer-/Billing-/Privacy-Tabellen | Unit-Parität und 320/360/768/Desktop-Browseroperationen `PASS`; kein Dokumentoverflow | `components/ui/responsive-table.tsx`; `tests/unit/ui/phase29-responsive-parity.test.tsx`; `tests/e2e/quality/phase29-responsive-operations.spec.ts` | reale mobile Nutzungsprioritäten |
| STH-026 | Kein zentrales Notification Preference Center | fachlicher Kern und automatische Phase-29-Gesamtregression gelöst; Legal-/Research-/LIVE-Aktivierung offen | P1, vor realer Zustellung | Notification/Consent | 20, UX-Regression 29 | 19, STH-007/009/013/017 | Candidate-/Employer-Center, versionierte Projection/Event-Historie und geschlossene Mandatory/Optional-Matrix implementiert | Unit/PostgreSQL/Desktop/320/360/Cross-Browser/Axe `PASS` | [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md); [Phase-29-Evidence](./evidence/2026-07-29-phase-29.md); `/candidate/notifications`; `/employer/notifications` | Legal-Klassifikation, moderierter Teach-back und optionale LIVE-Freigabe |
| STH-027 | Einzelne Sitemap stoppt bei 50.000 URLs | bestätigte spätere Kapazitätsgrenze; aktuelles fail-closed ist korrekt/sicher | P3 kapazitätsabhängige Skalierung; Eskalation nur nach Mess-/Forecast-Gate | SEO/Scale | 30C | 19, LIVE-Count-/Byte-/Wachstumsbaseline und Monitoring; Shardstrategie erst bei Trigger | mitigiert solange unter Trigger; Messung/Alerts offen, Index/Shards konditional deferred | Capacity-Error/no-truncation getestet; kein LIVE-Monitoring, kein Index-/Shard-Test | `lib/seo/public-sitemap.ts:20,85-136,428-435`; `app/sitemap.ts:7-18` | reale Zielumgebungszahl, Growth Forecast, Search Console/Ops Owner |
| STH-028 | Demo-/Preis-Copy nennt Hypothesen | bewusst anders / aktuell korrekt | Schutz-Gate, kein Defect-Prioritätswert | Commercial Copy | 31 | STH-005/007/018/022, WTP/Legal | keine Entfernung vor Gates; später mode-getrennte Copy | aktuelle Mock-/Pricing-Copy getestet | `app/(public)/pricing/page.tsx:16-19,80-143`; `components/marketing/pricing-card.tsx:24-32,113-124` | echter Geldtest, Legal/Tax, freigegebener Katalog |

## 3. Einzeldossiers

### STH-001 — Keine E-Mail-Verifikation

- **Status / Priorität / Phase:** bestätigt; P0; Phase 20
  `20-identity-email-notifications.md`.
- **Phase-20-Abschluss:** technisch geschlossen. Low-Assurance,
  Candidate-/Employer-/Invitation-Verify, Resend/Supersession, Reverification,
  Login-E-Mail-Change, Sessionrotation und negative Race-/Replay-Fälle sind in
  der [Phase-20-Evidence](./evidence/2026-07-26-phase-20.md) belegt.
  Aktivierung bleibt ohne Provider-/DNS-/DPA-Gate `DISABLED`/`SANDBOX`.
- **Fundstellen:** `prisma/schema.prisma:1129-1158` enthält
  `emailVerifiedAt`; Kandidaten- und Arbeitgeberregistrierung schreiben in
  `lib/auth/auth-service.ts:243-259` beziehungsweise `420-437` keinen Wert und
  erzeugen keinen Verification-Token. Die produktive Provider-Belegung ist in
  `lib/providers/email/index.ts:31-43` ausdrücklich Mock-only.
- **Betroffene Modelle:** `User`, `Credential`, `Session`, `EmailLog`,
  `UserConsentEvent`; neu voraussichtlich ein append-only
  E-Mail-Verifikations-Token/-Event oder ein äquivalenter Identity-Vertrag.
- **Betroffene Rollen:** Kandidat:in, Arbeitgeber, Recruiter nach Einladung,
  indirekt Privacy- und Support-Admin.
- **Ist:** Ein neues Konto ist sofort sessionfähig; `emailVerifiedAt` bleibt
  null. Es gibt Reset-/Invite-Tokenmechanik, aber keinen Verify-Mail-Lifecycle.
- **Soll:** Einmaliger, gehashter, kurzlebiger und rotierbarer Verify-Token,
  generische Antworten, Resend-Limit, Adresswechsel-Reverification,
  Session-/Capability-Gates und auditierte Bestätigung.
- **Root Cause:** Das Feld wurde als spätere Sicherheitsnaht modelliert, während
  ADR-014 reale E-Mail-Zustellung bewusst verschob.
- **Impact:** E-Mail-Eigentum ist unbelegt; abhängige Privacy-, Trust- und
  Kommunikationspfade können entweder nicht genutzt oder nicht sicher
  freigegeben werden.
- **Änderungsrisiko:** hoch; Enumeration, Token-Replay, Account-Takeover,
  parallele Verifikation und bestehende Demo-/Invite-Konten müssen geschützt
  werden.
- **Abhängigkeiten:** STH-004 (E-Mail-Anteil), STH-013, Absenderdomain, DPA,
  Bounce-/Suppression-Policy; Migration bestehender Konten fail-closed.
- **Geeignete Tests:** Token-Hash/TTL/Rotation/Single-use, Resend-Rate-Limit,
  parallele Klicks, Adresswechsel, Cross-User-Denial, Provider-Ausfall/Retry,
  registrieren→Mail→verifizieren→neue Session als Browser-E2E.
- **Abnahmekriterium:** Kein LIVE-Konto erhält eine verifikationspflichtige
  Capability vor bestätigter Adresse; Wiederholung ist idempotent, Audit und
  Outbox sind vollständig, rohe Tokens erscheinen in keinem Log.

### STH-002 — Privacy-Challenge ist für normale Registrierungen unerreichbar

- **Status / Priorität / Phase:** bestätigt, wobei die Challenge selbst
  implementiert ist; P0; Phase 20.
- **Phase-20-Abschluss:** die Registration→Verify→Privacy-Brücke ist technisch
  geschlossen; unverifizierte, fremde und abgelaufene Fälle bleiben
  fail-closed. Reale Export-/Erasure-Ausführung bleibt Phase 22.
- **Fundstellen:** Die Verify-Seite fordert
  `requester.emailVerifiedAt != null` in
  `app/candidate/privacy/requests/[id]/verify/page.tsx:21-45`. Derselbe
  Fail-closed-Check steckt in
  `lib/privacy/privacy-case-service.ts:642-652`. Passwortprüfung, Rate-Limit und
  Challenge-Abschluss existieren in
  `app/candidate/privacy/requests/[id]/verify/actions.ts:33-112`.
- **Betroffene Modelle:** `PrivacyRequest`, `PrivacyIdentityChallenge`, `User`,
  `Credential`, `AuditLog`, `Notification`.
- **Betroffene Rollen:** anfragende Kandidat:in, Privacy-Verifier,
  Privacy-Processor.
- **Ist:** Admin kann die 15-Minuten-/fünf-Versuche-Challenge starten; ein
  selbst registriertes Konto bleibt wegen STH-001 auf der Owner-Verify-Route
  unsichtbar und der Service lehnt den Abschluss ab.
- **Soll:** Der reguläre Registration→E-Mail-Verifikation→Privacy-Request-
  Challenge-Pfad muss erreichbar bleiben, ohne den unabhängigen
  Passwort-Step-up oder Admin-Separation-of-Duties abzuschwächen.
- **Root Cause:** Zwei einzeln richtige Sicherheitsbausteine wurden ohne
  verbindenden E-Mail-Verifikations-Lifecycle ausgeliefert.
- **Impact:** Betroffene können Export-/Lösch-/Korrekturverfahren nicht
  selbstständig bis zur verifizierten Bearbeitung bringen.
- **Änderungsrisiko:** hoch; ein scheinbar einfacher Entfernen-des-Prädikats
  würde die Identitätsgarantie zerstören.
- **Abhängigkeiten:** STH-001 und STH-013; Phase 22 darf erst danach reale
  Privacy-Ergebnisse freigeben.
- **Geeignete Tests:** echte Registrierung mit null-Wert, Verify-Mail,
  Verifikation, Challenge-Start, falsches/richtiges Passwort, Ablauf, fünf
  Versuche, Concurrent Replay und Owner/Admin-Capability-Denials.
- **Abnahmekriterium:** Der komplette Pfad ist auf PostgreSQL und im Browser
  grün; unverifizierte, fremde, suspendierte und abgelaufene Fälle bleiben
  generisch gesperrt.

### STH-003 — CV wird nur als Metadaten behandelt

- **Status / Priorität / Phase:** technisch geschlossen und auf Candidate
  `ca36bff` verifiziert; P0 vor realer interner Bewerbung; Aktivierung bleibt
  Local-/CI-Sandbox, Phase 21 `21-document-cv-vault.md`.
- **Fundstellen:** `lib/documents/vault-service.ts`,
  `lib/documents/document-content-policy.ts`,
  `lib/providers/storage/local-encrypted-object-store.ts`,
  `components/candidate/DocumentVaultCard.tsx` und
  `components/employer/DocumentDownloadButton.tsx`; die neun Handler stehen
  im aktuellen Routeinventar.
- **Betroffene Modelle:** `Document`, immutable `DocumentVersion`,
  `DocumentUploadIntent`, append-only `DocumentScanAttempt`,
  `DocumentReadGrant`, `DocumentAccessEvent`, `ObjectLifecycleOutcome`,
  `CandidateDocumentMetadata` und `ApplicationSubmissionDocument`.
- **Betroffene Rollen:** Candidate Owner; explizit berechtigte
  Employer-/Recruiter-Mitglieder; Privacy/Admin nur begründet.
- **Ist:** Der Test-Cohort kann echte, gestreamte und AES-GCM-verschlüsselte
  CV-Bytes hochladen. Nur eine CLEAN-Version ist bewerbbar; Replacement
  mutiert die Submission nicht. Owner beziehungsweise aktuell berechtigter
  Employer/Recruiter lesen über actor-gebundene Single-use-Grants. Legacy
  bleibt ehrlich metadata-only; Production ist fail-closed.
- **Soll:** Der technische Sandboxvertrag ist erreicht. Offen bleiben die
  externe Storage-/KMS-/Scannerwahl und Freigabe, Phase-22-Retention/
  Legal-Hold/Export/Erasure, Phase-23-Autonomie und Phase-25-Bulk-Step-up.
- **Root Cause:** ADR-014 verschob Storage, während die Domäne für spätere
  Integration nur Metadaten konservierte.
- **Impact:** Der frühere technische CV-Blocker ist in Sandbox geschlossen;
  ohne die offenen externen/Privacy-/Operations-Gates darf das Ergebnis
  weiterhin nicht als LIVE-Dokumentbetrieb beworben werden.
- **Änderungsrisiko:** sehr hoch; PII, Malware, Tenant-Leakage, verwaiste
  Objekte, Range Requests und Provider-Transaktionsgrenzen.
- **Abhängigkeiten:** Storage-Anteil STH-004, STH-006, Key-/Bucket-Region,
  DPA, Malware-Scanner, Retention- und Download-Policy.
- **Geeignete Tests:** Magic-Byte-Mismatch, Oversize-/Slow-Streaming,
  Malware/Polyglot/Timeout, Cross-Tenant/expired/replayed Grant,
  Membership-/Assignment-Revoke, Reconciliation, Re-Upload/Race,
  immutable Bewerbungs-Version, Last sowie Desktop/360 px sind `PASS`.
  Export und Erasure bleiben owning Tests der Phase 22.
- **Abnahmekriterium:** In der Sandbox erfüllt: Nur gescannte CLEAN-
  Dokumente sind kurzlebig und aktuell autorisiert abrufbar; Upload,
  Scan, Read, Replacement, Delete-Request und Reconciliation besitzen
  redigierte Evidence ohne öffentliche Objekt-URL.

### STH-004 — Produktive Provider fehlen

> **Aktualisierung Phase 24:** Der nachfolgende Fundstellenblock beschreibt
> den ursprünglichen Providerbefund. Phase 24 ersetzt den werfenden
> Stripe-Placeholder durch einen fail-closed Testadapter mit Hosted Checkout,
> signierter Inbox, Reconciliation und getrennten Aktivierungsschaltern.
> Production/LIVE, Providervertrag/DPA/Region, Staging und echte Receipts
> bleiben externe Gates. Verbindlicher technischer Ist-Nachweis:
> [Phase-24-Evidence](./evidence/2026-07-27-phase-24.md).

- **Status / Priorität / Phase:** bestätigt, aber keine überraschende
  Regression; P0-Programm über Phasen 20, 21, 23 und 24, Lead Phase 23.
- **Fundstellen:** ADR-014 dokumentiert die ursprüngliche Mockgrenze;
  ADR-032 akzeptiert inzwischen den Phase-21-Sandboxvertrag.
  `lib/config/env-schema.ts` trennt `disabled`/Sandbox/Production
  fail-closed. Beispiele sind Resend-Sandbox,
  `document-storage-composition.ts`, der lokale verschlüsselte
  Object-Store, Mock-Payment und der weiterhin unwired AI-Placeholder.
- **Betroffene Modelle:** `EmailLog`, `Order`, `PaymentEvent`,
  `CandidateDocumentMetadata`, `ImportSource/Run`, Salary- und
  Job-Room-Snapshots; je Adapter eigene externe Referenzen nur nach ADR.
- **Betroffene Rollen:** alle Produktrollen; besonders Finance, Privacy,
  Employer Owner und Operations.
- **Ist:** Fachlogik arbeitet über Ports; lokale Mocks sowie E-Mail- und
  Storage-/Scanner-Sandboxadapter sind wahrheitsgetreu und fail-closed.
  Externe Netzwerkzugriffe unterbleiben. Das ist technisch testbar, nicht
  production-ready.
- **Soll:** Pro Provider ein expliziter ADR, Composition Root mit
  Environment-Gate, Secret Handle, Timeouts, Idempotenz, Retry/DLQ,
  Reconciliation, Redaction, DPA/Region, Health/Monitoring und fail-closed
  Fallback. Nicht jeder Mock muss für den ersten Pilot ersetzt werden.
- **Root Cause:** bewusste Risikoreduktion bis zur Produkt- und
  Rechtsvalidierung.
- **Impact:** Kein echter Versand, Geldfluss, externer LIVE-CV-Speicher,
  offizieller Job-Room-/Commute-Dienst oder frei schaltbarer AI-Service.
- **Änderungsrisiko:** XL; ein gemeinsamer „RealProvider“-Umbau würde
  Sicherheits-, Legal- und Fehlerdomänen unzulässig koppeln.
- **Abhängigkeiten:** Providerverträge/Zugänge, DPA, Secrets, STH-009/013 und
  phasenspezifische Legal-/Operations-Gates.
- **Geeignete Tests:** gemeinsame Contract-Suite Mock↔Real, Sandbox-E2E,
  Timeout/429/5xx, Retry/Replay, Restart, Redaction, unbekannte Webhooks,
  deaktivierte/missing Production-Konfiguration fail-closed.
- **Abnahmekriterium:** Jeder freigegebene LIVE-Use-Case wählt genau einen
  geprüften Adapter; ein gesetzter Schlüssel allein aktiviert nichts und kein
  ungeprüfter Provider wird durch dieses Programm implizit mitgezogen.

### STH-005 — Reales Billing fehlt

> **Aktualisierung Phase 24:** Der nachfolgende Fundstellenblock bleibt als
> Ausgangsbefund erhalten. Phase 24 implementiert den Local-/CI-Vertrag für
> serverautoritativen Stripe-Test-Checkout, signierte Webhook-Inbox,
> exactly-once Projektion, Reconciliation, Refund/Chargeback/Dunning und
> Credit Note. Alle Flags sind default geschlossen; WTP, Step-up-UX,
> PSP/Tax/Legal/Finance, Staging und LIVE bleiben blockiert. Verbindlicher
> Nachweis: [Phase-24-Evidence](./evidence/2026-07-27-phase-24.md).

- **Status / Priorität / Phase:** bestätigt; P0 für Paid Self-Service, während
  ein manuell fakturierter Concierge-Pilot getrennt möglich bleibt; Phase 24
  `24-real-billing-finance.md`.
- **Fundstellen:** Der Composition Root ist ausschließlich
  `new MockPaymentProvider()` (`lib/providers/payments/index.ts:1-16`).
  `lib/providers/payments/stripe-payment-provider.ts:7-40` wirft nur
  `STRIPE_PROVIDER_NOT_IMPLEMENTED`. Orders schreiben in
  `lib/billing/orders.ts:248-263` Provider `MOCK`.
- **Betroffene Modelle:** `Order`, `OrderLine`, `PaymentEvent`, `Invoice`,
  `EmployerSubscription`, Credits/Permits/Boosts, neue Webhook-Inbox und
  externe Customer-/Payment-Referenzen.
- **Betroffene Rollen:** Employer Owner/Admin, Finance-Admin, Support,
  System-Worker.
- **Ist:** Katalog, Rappen-/MWST-Snapshots, idempotente Fulfillment- und
  Entitlement-Verträge sind stark; der Checkout bestätigt lokal ohne PSP,
  Settlement, Refund, Chargeback oder Dunning.
- **Soll:** Hosted Checkout, signaturgeprüfte Webhook-Inbox, exakt einmal
  projiziertes Fulfillment, Reconciliation, Refund/Chargeback/Dunning,
  Rechnungs-/Steuervertrag, Monitoring und kontrollierter Fallback.
- **Root Cause:** reale Zahlungen wurden wegen PCI-, Legal-, Tax- und
  Operationsrisiken bewusst nach der WTP-Validierung verschoben.
- **Impact:** Mock-Käufe belegen weder Umsatz noch Zahlungsbereitschaft und
  dürfen keine öffentliche Paid-LIVE-Aussage stützen.
- **Änderungsrisiko:** XL; Geld-, Zeit- und Webhook-Races dürfen bestehende
  Entitlements niemals doppelt oder ohne Zahlung aktivieren.
- **Abhängigkeiten:** Payment-Anteil STH-004, STH-009, Tax-/Refund-/Dunning-
  Freigabe, STH-018/028 und externer echter Geldtest.
- **Geeignete Tests:** Provider-Sandbox, gefälschte/alte/duplizierte/out-of-
  order Webhooks, Betrag/Währung/Order-Mismatch, Retry nach Crash,
  Reconciliation, Refund/Chargeback und Ledger-Invarianten.
- **Abnahmekriterium:** Nur verifizierter Settlement-Zustand erfüllt eine
  Order; Wiederholungen sind no-op, Finanz-/Audit-Snapshots stimmen und
  fehlende Production-Konfiguration schließt Checkout.

### STH-006 — Kein realer Export und keine reale Löschung

> **Aktualisierung Phase 22:** Der nachfolgende Fundstellenblock beschreibt
> den eingefrorenen Ausgangsbefund. Candidate `0636a875` ergänzt einen echten
> verschlüsselten V2-Export samt zulässigen Dokumentbytes, Correction,
> Erasure/Anonymisierung, Legal Holds, processorweise Failure Propagation und
> Restore-Tombstones. Das automatisierte G3 ist grün; Nicht-Kontoinhaber,
> Counsel/Retention und moderierte Forschung blockieren Gesamtabschluss und
> Aktivierung. Verbindlicher Ist-Nachweis:
> [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md).

- **Status / Priorität / Phase:** bestätigt; P0; Phase 22
  `22-privacy-legal-analytics.md`.
- **Fundstellen:** Die Policy deklariert
  `containsProviderBytes: false` (`lib/privacy/export-mock.ts:15-20`) und
  erstellt laut `99-102` nur Kategorienzähler. Der PostgreSQL-Adapter speichert
  dieses Manifest in `lib/privacy/postgres-export-adapter.ts:225-290`.
  `lib/privacy/privacy-case-service.ts:842-890` beendet Delete als
  Assessment und Correction als Ergebnisreferenz. Der Test benennt ausdrücklich
  „without erasure“ (`tests/integration/privacy/privacy-case-service.test.ts:149-160`)
  und `ASSESSMENT_COMPLETED_NO_ERASURE` (`281-290`).
- **Betroffene Modelle:** `PrivacyRequest`, `PrivacyRequestEvent`,
  `PrivacyIdentityChallenge`, alle personenbezogenen Domainmodelle, Storage,
  Audit/Accounting-Retention.
- **Betroffene Rollen:** Data Subject, Privacy Verifier, separater Processor,
  Legal/Operations.
- **Ist:** Fristen, Ownership, Identitätsprüfung, Capability-Separation,
  Manifest-Checksum, Notifications und Audit sind vorhanden; keine Datei mit
  Daten wird ausgeliefert und keine reale Erasure-Kette läuft.
- **Soll:** versioniertes Dateninventar mit Export-Serializer je Domäne,
  einschliesslich zulässiger eigener Dokumentbytes beziehungsweise
  gleichwertig verschlüsselter, gehashter Artefakte; verschlüsseltes
  kurzlebiges Exportpaket, autorisierte Zustellung sowie
  planbare, wiederanlaufbare Löschung/Anonymisierung mit dokumentierten
  Retention-Ausnahmen und Verifikationsbericht.
- **Root Cause:** Die Phase implementierte bewusst nur einen bounded
  Privacy-Case-Workflow, nicht die rechtlich freizugebenden Datenoperationen.
- **Impact:** Betroffenenrechte können technisch nicht vollständig erfüllt
  werden; ein COMPLETED-Status wäre ohne klare Mock-Kennzeichnung irreführend.
- **Änderungsrisiko:** XL; unvollständige Exporte, zu frühe Löschung,
  Referential Integrity, Legal Holds und irreversible Cross-Tenant-Fehler.
- **Abhängigkeiten:** STH-001/002, STH-003, STH-007, Dateninventar,
  Retention-/Legal-Matrix, Encryption/Storage und Worker.
- **Geeignete Tests:** Golden-Export je Rolle/Domäne, Vollständigkeitszähler,
  fremde Tenant-Daten als Canary, expiry/single-download, Erasure mit
  Accounting-/Audit-Ausnahmen, Restart/partial failure und Restore-Check.
- **Abnahmekriterium:** Ein genehmigter EXPORT liefert vollständig und sicher
  die erlaubten Daten; DELETE verändert nach freigegebener Matrix nachweisbar
  alle betroffenen Systeme oder dokumentiert jede zulässige Ausnahme.

### STH-007 — Rechtsseiten und kanonische Rechtstexte fehlen

> **Aktualisierung Phase 22:** Der nachfolgende Fundstellenblock ist der
> historische Ausgangsbefund. `/legal/privacy`, `/legal/terms`,
> `/legal/imprint` und `/admin/legal` sowie versionierte
> Review/Publish/Revoke-/Processing-Gates sind auf `0636a875` technisch
> implementiert und fail-closed getestet. Ohne signierte Counsel-Matrix wird
> keine Fassung als freigegeben oder LIVE behauptet; siehe
> [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md).

- **Status / Priorität / Phase:** bestätigt; P0 vor öffentlichem LIVE;
  Phase 22.
- **Fundstellen:** Der Footer listet in
  `components/shared/app-footer.tsx:5-26,68-84` keine Datenschutz-, Impressum-
  oder AGB-Links. Das vollständige Inventar
  `codex-plan/route-inventory.json:1-399` enthält keine Legal-Route.
  `lib/privacy/user-consent.ts:8-19` führt nur interne Version/Purpose-Konstanten,
  keinen eingefrorenen vollständigen Text oder Dokumentdigest.
- **Betroffene Modelle:** `UserConsentEvent`, `CandidateConsent`,
  Registrierungs-/Lead-/Radar-Notices; neu kanonische LegalDocument-Versionen
  oder unveränderliche Artefaktdigests.
- **Betroffene Rollen:** Öffentlichkeit, Kandidat:innen, Arbeitgeber,
  Recruiter, Legal/Privacy Admin.
- **Ist:** Flows besitzen kurze, zweckbezogene Notices und Hashes, aber keine
  zentral erreichbaren, freigegebenen und historisierbaren Rechtsdokumente.
- **Soll:** Impressum, Datenschutzerklärung, AGB/Vertragsbedingungen,
  Cookie/Analytics-Hinweis und flowspezifische AVG-/Privacy-Texte, versioniert,
  verlinkt, archiviert und in Consent-Snapshots referenziert.
- **Root Cause:** Produktmechanik wurde vor externer Schweizer Rechtsprüfung
  fertiggestellt.
- **Impact:** fehlende Transparenz und unzureichende Nachweisbarkeit der
  tatsächlich akzeptierten Fassung blockieren LIVE.
- **Änderungsrisiko:** hoch; Copy darf nicht von fachlicher Policy,
  Consent-Hash oder bereits erteilten Einwilligungen driften.
- **Abhängigkeiten:** Schweizer Counsel, STH-006/017/026, AVG-/DSG-/AGB- und
  grenzüberschreitende Datenflussbewertung.
- **Geeignete Tests:** Routen/Metadata/noindex nach Entscheidung, Footerlinks,
  exakter Dokumentdigest, alte Version bleibt abruf-/beweisbar,
  Re-consent-Matrix und locale-/copy-regression.
- **Abnahmekriterium:** Jeder consentpflichtige LIVE-Flow zeigt vor Zustimmung
  die freigegebene Version; gespeicherter Hash reproduziert exakt den Text und
  Pflichtseiten sind öffentlich, stabil und im Release-Inventar.

### STH-008 — Produktionsbetrieb ist extern und offen

- **Status / Priorität / Phase:** externe Voraussetzung trotz belastbarer
  lokaler Vorarbeit; P0-Go-live-Gate; Phase 23
  `23-production-operations-workers.md`.
- **Fundstellen:** Umgebungsstatus und fehlende Verbindungen stehen in
  `codex-plan/runbooks/deployment.md:28-48`; offene Gates in `124-132`.
  `codex-plan/release-checklist.md:96-120` lässt Staging, TLS/Ingress,
  Legal/Provider, Backup-Lifecycle, Incident Owner und Worker offen.
  `codex-plan/runbooks/incident-response.md:23-28` bestätigt fehlende
  Rufbereitschaft.
- **Betroffene Modelle/Systeme:** Deployment-Artefakt, DB/Secrets/Keyrings,
  Backupobjekte, Health/Telemetry, `SystemTask`, Provider und Audit.
- **Betroffene Rollen:** Release Owner, Operations, Security, Privacy/Legal,
  Support und Business Owner.
- **Ist:** lokale Env-Gates, Migration/Seed-Guards, verschlüsselter
  Backup-/Restore-Drill und Runbooks sind auf Candidate `d16a2d9`
  commitgebunden grün; reale isolierte Umgebungen, Pager, Retention und Owners
  fehlen. Siehe
  [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md).
- **Soll:** getrennte Preview/Staging/Production-Accounts, immutable Artifact,
  Secret-/Key-Rotation, observability/SLOs, Backup-Retention, getestete
  Restore-/Rollback-/Incident-Prozesse und benannte Verantwortliche.
- **Root Cause:** Repository kann externe Infrastruktur und organisatorische
  Zusagen nicht selbst erzeugen; Phase 18 hat diese Grenze ehrlich offengelegt.
- **Impact:** Ein grüner lokaler Build ist keine Pilot- oder
  Produktionsfreigabe.
- **Änderungsrisiko:** XL; Fehlkonfiguration kann Demo-Daten, Secrets oder
  personenbezogene Daten zwischen Umgebungen mischen.
- **Abhängigkeiten:** STH-004/009, Hosting/DB/Secret Manager/Monitoring,
  Business-Freigabe für RPO/RTO und On-call.
- **Geeignete Tests:** Staging-Smoke auf exaktem Artefakt, Isolation-Canaries,
  TLS/HSTS/Proxy-IP, Key-Rotation, Backup-Retention/Restore, Rollback,
  Incident-Game-Day und Production-Demo-Guard.
- **Abnahmekriterium:** Alle externen Checkboxen besitzen Owner, Datum und
  reproduzierbare Evidence; Production verwendet getrennte Ressourcen und
  erfüllt genehmigte RPO/RTO/SLOs unter einem getesteten Incident-Prozess.

### STH-009 — Kein autonomer Worker

- **Status / Priorität / Phase:** bestätigt; P0 für unbeaufsichtigten
  Self-Service, während ein benannter Concierge-Runner nur als begrenzter Pilot
  zulässig ist; Phase 23.
- **Fundstellen:** Idempotente Jobs existieren, etwa Job-Alert-Digest
  `lib/candidate/job-alerts.ts:535`, Jobablauf
  `lib/jobs/effective-status.ts:95`, Contact-Expiry
  `lib/talentradar/contact-requests.ts:264`, Subscription-Grenzen
  `lib/billing/subscriptions.ts:64,278` und SLA-Projektion
  `lib/admin/sla.ts:73`. Phase 23 ergänzt `scripts/phase23-worker.ts`,
  `lib/ops/worker-runtime.ts`, `worker-scheduler.ts` und das Activation
  Ledger; das kommerzielle Go-live-Gate bleibt offen.
- **Betroffene Modelle:** `SystemTask`, `EmailLog`, Alerts/Digests,
  Subscriptions, Jobs/Boosts, Contact Requests, Privacy Tasks und Audit.
- **Betroffene Rollen:** System Actor, Operations/Admin; fachlich alle
  Empfänger zeitabhängiger Aktionen.
- **Ist:** Die bounded Domainrunner sind über eine gemeinsame durable
  PostgreSQL-Queue mit Lease/Heartbeat/Fencing, Attempt-Historie,
  Backoff/DLQ, Scheduler-Ownership und WorkerRun angebunden. Die Runtime ist
  auf Candidate `d16a2d9` lokal/isoliert commitgebunden verifiziert und
  standardmässig pausiert; reales Hosting, Pager und Production-Recovery
  fehlen. Siehe
  [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md).
- **Soll:** versionierter Jobvertrag mit enqueue-in-transaction/Outbox,
  `SKIP LOCKED`- oder Queue-Leases, Retry/Backoff/Jitter, Dead Letter,
  Concurrency-Limits, Shutdown/Restart, Monitoring und Re-drive.
- **Root Cause:** Die frühere Lücke der gemeinsamen Runtime ist technisch
  adressiert; offen bleibt die externe Betriebsplattform mit namentlichem
  On-call, Monitoring und genehmigten Servicegrenzen.
- **Impact:** Im Local-/CI-Sandboxvertrag laufen aktivierte Handler autonom.
  Ohne reales Workerhosting und Activation Evidence passieren sie in
  Production weiterhin nicht zuverlässig; deshalb bleibt die Aktivierung aus.
- **Änderungsrisiko:** XL; doppelte Ausführung, verlorene Jobs und falsch
  fortgeschrittene Cutoffs können Geld- oder Privacy-Zustände beschädigen.
- **Abhängigkeiten:** STH-008/013, Queue-/Scheduler-Plattform, Telemetrie,
  Runbook und benannter Owner.
- **Geeignete Tests:** Crash nach Claim/vor Ack, Lease-Ablauf, parallele Worker,
  Poison Job→DLQ, Retry-Budget, Provider-429/5xx, Clock Boundary,
  Graceful Shutdown und Re-drive-Audit.
- **Abnahmekriterium:** Alle P0-Zeitjobs laufen nach Restart genau gemäß ihrem
  idempotenten Fachvertrag; kein Fehler geht still verloren und DLQ/Backlog/
  Latenz lösen messbare Alerts mit Runbook aus.

### STH-010 — Alle Admin-Capabilities gehören dem globalen ADMIN

- **Status / Priorität / Phase:** technisch im deaktivierten Local-/CI-Vertrag
  gelöst; P0 vor privilegiertem LIVE-Betrieb; Phase 25.
- **Fundstellen:** `lib/admin/capabilities.ts` ist deny-by-default;
  `lib/admin/role-policy.ts` löst 50 geschlossene Capabilities aus zehn
  persistierten Rollen, aktiven zeitgebundenen Assignments/Direktgrants und
  engen Break-glass-Grants auf. `lib/auth/current-user.ts` und
  `lib/auth/route-guards.ts` tragen den jeweils aktuellen Satz in alle Reads
  und Commands.
- **Betroffene Modelle:** `AdminRole`, `AdminRoleCapability`,
  `AdminRoleAssignment`, `AdminCapabilityGrant`, `PrivilegedApproval`,
  `BreakGlassGrant`, `Session`, `SessionAssurance`, `AuditLog`.
- **Betroffene Rollen:** Platform Admin, künftig Support, Moderator,
  Content/Ops, Finance, Privacy Verifier/Processor und Security Admin.
- **Ist:** Die globale Rolle erlaubt nur Portalzugang und gewährt allein
  exakt null Fachrechte. Finance/Security, Privacy Verify/Process und
  Trust/Security sind konfliktbehaftete Duties. Selbstfreigabe scheitert;
  Revocation beendet Sessions und Assurance in derselben Transaktion.
- **Migration/Seed:** sieben additive Phase-25-Migrationen; der Demo-Seed
  trennt Platform/Moderation/Support/Content/Finance/Privacy Processing,
  Security/Trust Approval und Privacy Verification auf drei Konten. Es gibt
  keinen Wildcard-/Default-All-Grant.
- **Tests:** vollständige Rollenmatrix, global-ADMIN-alone,
  expired/revoked/foreign Duty, SoD, Selbstgrant, unmittelbare Revocation,
  Break-glass TTL/Alert sowie idempotente Migration laufen in Phase-25-Unit-,
  PostgreSQL- und Browser-Suites grün.
- **Verbleibender Gate:** benannte echte Duty-Owner, unabhängige Recovery-/
  Break-glass-Personen, On-call und Staging-Drill. Bis dahin bleibt
  Enforcement/BREAK_GLASS `DISABLED`; siehe
  [Phase-25-Evidence](./evidence/2026-07-28-phase-25.md).

### STH-011 — Kein Admin-MFA und kein Step-up

- **Status / Priorität / Phase:** technisch im deaktivierten Local-/CI-Vertrag
  gelöst; P0; Phase 25.
- **Fundstellen:** `lib/auth/assurance/**`,
  `components/security/**`, `/admin/security/authenticators`,
  `/candidate/settings/security` und `/employer/settings/security`.
- **Betroffene Modelle:** `Authenticator`, `WebAuthnCredential`,
  `TotpCredential`, `AuthenticatorChallenge`, `RecoveryCode`,
  `AuthenticatorEvent`, `SessionAssurance`, `StepUpChallenge` und erweiterte
  `AuthAssuranceEvidence`.
- **Betroffene Rollen:** alle Admin-Personas, besonders Finance, Privacy und
  Security/Break-glass, zusätzlich Candidate und Employer Owner bei
  Hochrisikoaktionen.
- **Ist:** WebAuthn bindet Challenge an Session/RP-ID/Origin und persistiert
  Counter/Backup-State; TOTP-Secrets sind versioniert verschlüsselt und
  akzeptierte Zeitschritte replay-sicher; Recovery-Codes sind gehasht,
  batch-revocable und single-use. `STEP_UP_POLICY_V1` bindet kurze opaque
  Grants an Actor, Session, Purpose, Action, Tenant und Resource.
- **Integration:** Billing/Checkout/Profile/Subscription, Team,
  Login-E-Mail, Privacy Export/Delete/Correct, kritischer Radar-Consent,
  Reveal sowie Finance/Privacy/Trust-Adminaktionen nutzen denselben
  serverseitigen Consumer. Abschluss der Login-E-Mail-Änderung widerruft alte
  Sessions und offene Grants.
- **Tests:** falsche Origin/RP-ID, Challenge-/TOTP-/Recovery-Replay,
  stale/cross-purpose/cross-actor/cross-tenant/cross-resource, entfernte Rolle
  und direkte Action erzeugen null Wirkung; erlaubte Desktop-/360-Journeys
  konsumieren exakt einen Grant.
- **Verbleibender Gate:** zugelassene Production-Geräte, RP-ID/HTTPS,
  Recovery-/Supportpolicy, zwei Recovery-Owner und manueller Device-Loss-/
  Assistive-Technology-Drill. `ADMIN_MFA_REQUIRED` und
  `PRIVILEGED_STEP_UP_MODE` bleiben standardmässig geschlossen; siehe
  [Phase-25-Evidence](./evidence/2026-07-28-phase-25.md).

### STH-012 — Exklusive globale Rolle verhindert Multi-Persona

- **Status / Priorität / Phase:** technisch im deaktivierten Local-/CI-Vertrag
  gelöst; Markt-/Demand-Aktivierung bleibt P3/deferred; Phase 27
  `27-multi-persona-identity.md`.
- **Phase-27-Abschluss:** `User` bleibt Identity/N-1-Projektion;
  `PersonaAssignment` und append-oriented Events modellieren Candidate und
  Employer. Sessions binden genau einen versionierten Portal-/Company-Kontext,
  `/account/portal` wechselt ihn nur nach aktueller Assignment-/Membership-
  Prüfung und widerruft context-bound Step-up-Grants. Bestehende Identity-
  Invitations und Candidate-Self-Service sind action-bound step-up-geschützt.
- **Fundstellen:** `prisma/schema.prisma`,
  `prisma/migrations/20260728160000_phase_27_multi_persona_identity`,
  `lib/auth/persona-policy.ts`, `lib/auth/persona-context.ts`,
  `lib/auth/current-user.ts`, `app/account/portal`, ADR-039 und
  [Phase-27-Evidence](./evidence/2026-07-28-phase-27.md).
- **Betroffene Modelle:** `User`, `CompanyMembership`,
  `RecruiterMandate`, Session/CurrentUser; neu globale Persona-/RoleAssignment-
  Historie oder abgeleitete Capabilities.
- **Betroffene Rollen:** Personen, die Kandidat:in und Employer/Recruiter sind,
  sowie Admins mit getrenntem normalen Konto.
- **Ist:** Eine E-Mail entspricht einer Identity mit optionaler Candidate- und
  Employer-Persona. Company- und Adminrechte bleiben separate aktuelle
  Autoritäten; die technische UI/Mutation bleibt default-off.
- **Soll:** eine Identität mit explizit aktivierbaren Personas, klare
  Context-Auswahl, unveränderliche Membership-/Mandate-Rechte und keine
  Capability-Union über Persona-Grenzen.
- **Root Cause:** globale Rollenvereinfachung in der Auth-Baseline.
- **Impact:** Doppelte Konten, Supportaufwand und schwer verständliche
  Daten-/Consent-Eigentümerschaft; künftige Admin-Trennung würde sonst weiter
  fragmentieren.
- **Änderungsrisiko:** XL; Session-, Route-, Redirect-, Consent-, Tenant- und
  Audit-Semantik sind querschnittlich betroffen.
- **Abhängigkeiten:** STH-010/011, fachliche Persona-Matrix, Account-Linking/
  Merge-Entscheid und Backfill bestehender Konten.
- **Geeignete Tests:** Candidate+Employer, Recruiter in mehreren Companies,
  Admin+Normalpersona, Context-Switch CSRF, Cross-Persona direct action,
  Invite/Claim/Reset, Suspend einer Persona sowie Audit-Actor/Context.
- **Abnahmekriterium:** technisch `PASS`: Eine Person kann erlaubte Personas
  explizit wechseln, aber jeder Request besitzt genau einen serverseitig
  gebundenen Persona- und Tenant-Kontext; Rechte werden nie implizit
  vereinigt. Moderierte Nachfrage, Canary/Staging und G4 bleiben externe
  Aktivierungsgates.

### STH-013 — Keine dauerhafte E-Mail-Outbox mit Retry

- **Status / Priorität / Phase:** bestätigt; P0; Phase 20.
- **Phase-20-Abschluss:** technisch geschlossen durch atomare typisierte
  Outbox, verschlüsseltes Delivery-Material, Attempts, bounded Lease/
  Heartbeat, Retry/Backoff, Suppression, DLQ und auditiertes Local-Sandbox-
  Replay. Phase 23 bleibt Owner für autonome Production-Ausführung,
  Monitoring, Pager und Aktivierungsledger.
- **Fundstellen:** `EmailLogStatus` kennt zwar `QUEUED/SENT/FAILED`
  (`prisma/schema.prisma:596-601`), das Modell
  `prisma/schema.prisma:2250-2264` hat jedoch keine Attempt-, Lease-,
  `nextAttemptAt`- oder DLQ-Felder. Der Mock schreibt direkt
  `MOCK_RECORDED` in `lib/providers/email/mock-email-provider.ts:190-213`;
  `lib/providers/email/prisma-email-log-repository.ts:18-55` dedupliziert nur
  den Logeintrag.
- **Betroffene Modelle:** `EmailLog`, `Notification`, Auth-/Application-/
  Billing-/Privacy-Domain-Events; neu OutboxMessage/DeliveryAttempt/
  Suppression oder ein gleichwertiger Vertrag.
- **Betroffene Rollen:** alle Empfänger; System Worker und Operations;
  verpflichtende Nachrichten besonders Privacy/Finance/Security.
- **Ist:** Template-Allowlist, Redaction und Idempotenz sind stark, Send erfolgt
  aber synchron/Mock-lokal ohne durable Zustellverantwortung.
- **Soll:** atomare Domain+Outbox-Persistenz, getrennte Render-/Delivery-
  Versionen, Lease/Retry/Backoff/DLQ, Provider-ID, Bounce/Suppression,
  Zustellstatus, Re-drive und Monitoring.
- **Root Cause:** `EmailLog` wurde als wahrheitsgetreues Mock-Protokoll, nicht
  als produktive Queue modelliert.
- **Impact:** Prozessabbruch oder Providerfehler kann Pflichtmail verlieren;
  unkontrollierter Retry kann Duplikate oder Token-Leaks erzeugen.
- **Änderungsrisiko:** XL; Transactional Outbox, personenbezogene Payloads,
  tokenhaltige Nachrichten, Preference-Suppression und Provider-Replay.
- **Abhängigkeiten:** E-Mail-Anteil STH-004, STH-009, STH-026,
  Provider-/DPA-/Bounce-Entscheid.
- **Geeignete Tests:** Commit→Crash→Retry, parallele Claims, 429/5xx/timeout,
  Poison→DLQ, Bounce/Suppression, kein Klartexttoken persistiert,
  crash-sichere envelope-verschlüsselte Zustellung/Key-Rotation,
  Preference-Entscheidung und exactly-once Domain-Dedupe.
- **Abnahmekriterium:** Jede freigegebene Pflichtmail ist nach Domain-Commit
  dauerhaft zustellbar oder sichtbar fehlgeschlagen; kein Restart verliert sie,
  und Retry erzeugt weder zweite Fachaktion noch neues Einmal-Secret.

### STH-014 — Company Verification nutzt nur Text und Referenz

- **Status / Priorität / Phase:** technisch im deaktivierten Local-/CI-Vertrag
  geschlossen; P0 für einen vertrauensbasierten LIVE-Publishpfad; Phase 26
  `26-company-trust-verification.md`.
- **Implementierung:** additive strukturierte Evidence-, Check-, Domain-
  Challenge-, Decision-, Projection- und Appealmodelle in `prisma/schema.prisma`;
  zentrale Policy/Reads/Owner-/Adminservices unter
  `lib/companies/verification/**`; Vault-Upload in
  `/api/company-verification/documents/upload-intents`; Workflows unter
  `/employer/verification` und `/admin/company-verification`.
- **Betroffene Modelle:** `Company`, `CompanyVerificationRequest/Event`,
  `CompanyTrustEvidence`, `CompanyVerificationCheck`,
  `CompanyDomainChallenge`, `CompanyTrustDecision`,
  `CompanyTrustProjection`, `CompanyTrustAppeal` und Vault-Dokumentmetadaten.
- **Betroffene Rollen:** Employer Owner/Admin als Antragsteller,
  Trust/Verification Reviewer, Platform/Security Ops.
- **Ist:** Versionierte Prüfpolicy, strukturierte UID-/Domain-/Vault-Evidence,
  typed Providerports, unabhängige Reason-Code-Decision, Expiry/Re-review,
  Appeal und nächste-Read-Wirkung auf Company-/Job-/Radar-Gates sind
  implementiert. Legacy-Freitext bleibt schwach und erzeugt kein starkes Badge.
- **Extern offen:** reale Register-/Domainprovider samt Nutzungsrecht,
  DPA/Region und Contract-Evidence; Reviewer-Staffing, reale Handling-Zeit,
  Cost/Fall, Staging/Pager/Rollback und Public-Rollout.
- **Root Cause:** Verification-Orchestrierung wurde vor realem Storage und
  offizieller Registerintegration gebaut.
- **Impact:** Admin kann eine unbelegte Freitextbehauptung genehmigen; das
  schwächt Arbeitgebervertrauen und Missbrauchsschutz.
- **Änderungsrisiko:** sehr hoch; Firmenidentität, sensible Dokumente,
  False-positive Registry Matches und Widerruf mit abhängigen Jobs/Radar.
- **Abhängigkeiten:** STH-003/004, Phase-21-Vault, Phase-23-Worker,
  Phase-25-Assurance/Trust, Registerzugang/Lizenz, Retention,
  Reviewer-Ownership und STH-010.
- **Evidence:** Providercontract-, Policy-, Vault-, Authorization-, Migration-,
  Legacy-, Validity-, Failure-, Capacity-, Compromise-, Eligibility-,
  Desktop- und 360px-Tests sind auf `96933aa` grün; siehe
  [Phase-26-Evidence](./evidence/2026-07-28-phase-26.md).
- **Abnahmekriterium:** technisch `PASS`: Strong VERIFIED ist nur aus
  nachvollziehbarer, gültiger, versionierter Evidence ableitbar; jede
  Decision nennt Scope, Policy, Reviewer und Grund, und Widerruf greift beim
  nächsten Read. Öffentliche Aktivierung bleibt bis zu den externen Gates
  `BLOCKED`.

### STH-015 — Externe Bewerbungen enden nach dem Klick

- **Status / Priorität / Phase:** technisch Local/CI gelöst; P3 default und P0
  nur bei explizitem Produktversprechen; Phase 28
  `28-recruiting-workflows.md`. Aktivierung bleibt deferred/default-off.
- **Fundstellen:** `app/(public)/jobs/actions.ts` hält
  `EXTERNAL_APPLY_CLICKED` von Submitted getrennt und erzeugt einen
  Candidate-Resume-Intent. `lib/recruiting/external-tracker.ts` und
  `/candidate/applications/external/**` implementieren Owner-Reads,
  Transitionen, Snapshot, Reminder und Eventhistorie.
- **Betroffene Modelle:** `Job/JobRevision`, `AnalyticsEvent`,
  `ExternalApplicationTracker`, `ExternalJobSnapshot` und
  `ExternalApplicationEvent`.
- **Betroffene Rollen:** Kandidat:in als Owner, Arbeitgeber/Admin nur
  datensparsam aggregiert, anonyme Klicker ohne Bewerbungsbehauptung.
- **Ist:** Klick bleibt datensparsame Telemetrie und ausdrücklich keine
  Bewerbung. Ein eingeloggter Candidate kann ihn freiwillig in einen eigenen
  Tracker übernehmen, einen Submit oder Outcome als `CANDIDATE_CONFIRMED`
  fortschreiben und die Daten exportieren, korrigieren oder löschen.
- **Soll:** freiwilliger Kandidaten-Tracker für begonnen, extern eingereicht,
  Interview, Absage, Angebot/eingestellt; Job-Snapshot, Reminder und klare
  Unknown-Zustände ohne ATS-Behauptung.
- **Root Cause:** Der externe Pfad wurde als Analyseereignis statt als
  Kandidatenprozess modelliert.
- **Impact:** Kandidatencockpit, Conversion-/Outcome-Messung und hilfreiche
  Follow-ups bleiben unvollständig.
- **Änderungsrisiko:** hoch; Selbstangabe darf nicht als Arbeitgeber-/ATS-
  Bestätigung gelten, Ownership/Privacy und Jobdeaktivierung müssen halten.
- **Abhängigkeiten:** STH-009/013/026, Candidate Auth/Profile,
  Notification-Policy, Phase-22-Dateninventar/Export/Delete/Correct/Retention/
  Hold und optional spätere ATS-/Mail-Signale.
- **Geeignete Tests:** Click≠Submitted, Owner/Cross-User, idempotente
  Transitionen, Snapshot nach Jobablauf, anonymer Resume, Reminder-Suppression,
  Export/Delete/Correct/Retention/Hold samt Foreign-Canary und E2E
  Klick→Bestätigung→Dashboard.
- **Abnahmekriterium:** technisch `PASS`: Externe Outcomes sind klar als
  kandidatenbestätigt gekennzeichnet, bleiben owned/auditierbar und
  verfälschen weder Application- noch Funnel-Metriken. Demand-/Product-/
  Privacy-/Ops-/Support- und LIVE-Go bleiben offen; es gibt keine
  ATS-Bestätigungsbehauptung.

### STH-016 — Keine echte Interviewplanung

- **Status / Priorität / Phase:** technisch Local/CI gelöst; P3 default und P0
  nur bei explizitem Produktversprechen; Phase 28. Aktivierung bleibt
  deferred/default-off.
- **Fundstellen:** `lib/recruiting/interviews.ts`,
  `/candidate/interviews/**`,
  `/employer/applicants/[id]/interviews/**` und
  `/api/recruiting/interviews/[id]/calendar` bilden den persistenten
  Terminvertrag. Der bestehende Pipeline-Status bleibt separat und erzeugt
  keinen Termin.
- **Betroffene Modelle:** `Application`, `ApplicationEvent`, `Conversation`,
  `Notification`, `Interview`, `InterviewProposal`, `InterviewParticipant`,
  `InterviewResponse`, `InterviewEvent`, `CalendarArtifact` und Reminder.
- **Betroffene Rollen:** Employer Owner/Admin oder berechtigter Recruiter,
  Kandidat:in; System Worker.
- **Ist:** Pipeline und Termin sind getrennt. Berechtigte Company-Actors können
  versionierte IANA-Zeitzonen-Slots vorschlagen; Candidate RSVP, Verschiebung,
  Storno, minimale ICS-Artefakte und deduplizierte Reminder sind persistent.
- **Soll:** Status und Termin getrennt; versionierte Einladung mit Slots/
  Zeitzone/Teilnehmern, Accept/Decline/Reschedule/Cancel, ICS und deduplizierte
  Reminder.
- **Root Cause:** Recruiting-Phase und Kalenderereignis wurden im MVP
  zusammengefasst.
- **Impact:** Operativer Prozess verlässt die Plattform und Response-/Time-to-
  interview-Metriken sind unzuverlässig.
- **Änderungsrisiko:** XL; DST, Doppelbuchung, parallele Antworten,
  Kalender-PII und Reminder-Retry.
- **Abhängigkeiten:** Application-RBAC, STH-009/013/026,
  Phase-22-Dateninventar/Export/Delete/Correct/Retention/Hold und optional
  Kalenderadapter; Interview darf kein automatischer Application-Status sein.
- **Geeignete Tests:** DST/Zeitzone, parallele Accept/Reschedule, Tenant-/
  Assignment-Denials, idempotente ICS-Sequenz, Cancel, Reminder-Retry,
  Export/Delete/Correct/Retention/Hold für Termin-/Participant-/ICS-Daten und
  Employer↔Candidate-Browserreise.
- **Abnahmekriterium:** technisch `PASS`: Termin und Pipeline besitzen
  getrennte, nachvollziehbare Zustände; beide Seiten sehen denselben Zeitpunkt
  und jede Änderung ist idempotent, autorisiert und benachrichtigt.
  Demand-/Product-/Privacy-/Ops-/Support-/Provider- und LIVE-Go bleiben offen;
  ICS ist kein Nachweis einer externen Calendar-Zustellung.

### STH-017 — Produktionsanalytics ist nur teilweise deaktiviert

> **Aktualisierung Phase 22:** Der Ausgangsbefund bleibt unten als Auditspur.
> Candidate `0636a875` ergänzt eine eventfamilienweise default-off
> Publication-/Approval-/Consent-/Retention-/Property-Policy mit sofortigem
> Revoke und Search-Learning-Sperre. Automation und Referenzlast sind grün,
> optionale Productionanalytics bleibt mangels Fachfreigaben `DISABLED`; siehe
> [Phase-22-Evidence](./evidence/2026-07-26-phase-22.md).

- **Status / Priorität / Phase:** teilweise bestätigt; P1 mit Legal-Gate;
  Phase 22.
- **Fundstellen:** Produktnutzungstelemetrie ist in Staging/Production
  fail-closed (`lib/analytics/runtime-policy.ts:8-35`), während anonyme
  essentielle Operationsereignisse in Production korrekt als `LIVE`
  klassifiziert werden (`39-56`). `lib/analytics/track.ts:55-58` unterdrückt
  nur Events mit Zweck `PRODUCT_ANALYTICS`.
- **Betroffene Modelle:** `AnalyticsEvent`, `MetricDaily`, Consent-/Preference-
  Events, Funnel-/Cluster-/Commercial-Signal-Projektionen.
- **Betroffene Rollen:** öffentliche/angemeldete Nutzer, Data/Product Owner,
  Privacy/Analytics Admin.
- **Ist:** DEMO/TEST-Analytics und essentielle LIVE-Operationssignale sind
  sauber getrennt; freiwillige Produktanalytics bleibt mangels
  Nutzermechanismus aus.
- **Soll:** freigegebene Event-/Purpose-Matrix, Datenminimierung,
  Consent/Opt-out wo erforderlich, Retention/Deletion, Provenance,
  serverseitige Enforcement und belastbare LIVE-Metriken.
- **Root Cause:** Phase 16 entschied korrekt fail-closed bis Privacy/Legal die
  LIVE-Verarbeitung freigibt.
- **Impact:** Produkt-/Conversion-Entscheidungen können nicht auf reale
  Nutzungsdaten gestützt werden; Aktivierung ohne Vertrag wäre dagegen ein
  Datenschutzrisiko.
- **Änderungsrisiko:** sehr hoch; Consent-Drift, Zweckvermischung,
  Pseudonym-Reidentifikation und DEMO→LIVE-Kontamination.
- **Abhängigkeiten:** STH-007/026, Counsel/Data Governance, Retention,
  DPA/Hosting und klarer Unterschied zwischen essential und optional.
- **Geeignete Tests:** Environment×Purpose-Matrix, consent grant/revoke,
  historische Events, anonymous/authenticated provenance, deletion/retention,
  DEMO-canary und Browser-Network-/Cookie-Prüfung.
- **Abnahmekriterium:** Production schreibt nur explizit freigegebene Events
  mit korrektem Zweck/Provenance; Widerruf wirkt gemäß Policy und jede Kennzahl
  kann auf versionierte Definition und zulässige Rohdaten zurückgeführt werden.

### STH-018 — Marketplace-Liquidität ist nicht real belegt

- **Status / Priorität / Phase:** externe Voraussetzung; P0-Markt-Gate;
  Phase 31 `31-monetization-market-validation.md`.
- **Fundstellen:** Konkrete Schwellen stehen in
  `lib/seo/cluster-launch-policy.ts:3-15`. Persistenz bietet
  `prisma/schema.prisma:2918-2963`; LIVE-Auswertung
  `lib/admin/cluster-launch.ts:36-287`, Dual Approval/Aktivierung/Widerruf
  `lib/admin/content.ts:149-236` und fail-closed Indexability
  `lib/seo/cluster-indexability.ts:363-391`.
- **Betroffene Modelle:** `ClusterLaunchAssessment/Event`, Jobs, Companies,
  Candidate Profiles, Applications und Analytics.
- **Betroffene Rollen:** Product- und Ops-Approver; reale Arbeitgeber,
  Kandidat:innen und Acquisition/Marketplace Ops.
- **Ist:** Die Anwendung misst Mindestliquidität aus LIVE-Provenienz und sperrt
  dünne oder abgelaufene Cluster. Seed und Tests machen den Pfad erreichbar.
  Nicht belegt ist, dass ein realer Schweizer Cluster die Schwellen erreicht.
  Die V1-Search-Coverage erzeugt nur grobe Kategorie-/Kanton-Phrasen und wertet
  bereits einen beliebigen positiven Substring-Proxy als relevant; sie ist
  deshalb kein belastbarer Nachweis für Berufsvarianten oder tatsächliche
  Startcluster-Suchqualität.
- **Soll:** vorab festgelegter Design-Partner-/Cluster-Test mit auditierten
  LIVE-Kohorten, Zeitfenster, Response/Content Coverage, bestandener
  cluster-/sprachspezifischer STH-019-Relevanzevidence und unabhängiger
  Product-/Ops-Freigabe.
- **Root Cause:** Liquidität ist eine Marktannahme, keine aus Demo-Daten
  ableitbare Softwareeigenschaft.
- **Impact:** Ein technisch funktionierender Marktplatz kann für beide Seiten
  leer wirken und Retention/Akquise verbrennen.
- **Änderungsrisiko:** technisch niedrig, operativ hoch; Schwellen dürfen nicht
  rückwirkend passend gemacht oder mit DEMO/TEST-Daten gefüllt werden.
- **Abhängigkeiten:** reale Design-Partner, Kandidatenakquise,
  consentierte Analytics, Sales/Recruiting Operations und der frühe
  Phase-30A-Suchqualitätsvertrag für den konkret freizugebenden Cluster.
- **Geeignete Tests/Verifikation:** bestehende DB-/Gate-Tests beibehalten;
  zusätzlich auditierbarer LIVE-Snapshot, Provenance-Canaries, Ablauf/Revoke
  und vorab eingefrorene Erfolgs-/Stop-Regel. Die Aktivierungsmatrix referenziert
  außerdem das freigegebene Startcluster-Golden-/Negativkorpus und dessen
  unveränderliche Evidence. Ein V2-Assessment bindet Query-Set-,
  Search-Policy- und Taxonomieversion sowie queryweise Top-K-/Judgment-
  Evidence; eine alte V1-Freigabe gilt nach Cutover nicht automatisch weiter.
- **Abnahmekriterium:** Mindestens der freizugebende Cluster erfüllt im
  definierten Fenster alle eingefrorenen Schwellen aus LIVE-Daten und besitzt
  zwei unabhängige Approvals. Zusätzlich bestehen für seine Sprache/Berufe die
  STH-019-Tests ohne bekannten False-Zero trotz vorhandener passender Stelle;
  sonst bleibt er technisch gesperrt.

### STH-019 — Startcluster-Suche ohne kontrollierte Berufsvarianten

- **Status / Priorität / Phase:** bestätigt, mit brauchbarer
  Akzent-/Substring-Mitigation; **P1 Kandidatennutzen- und Launch-Blocker** für
  jeden aktivierten Startcluster; früher Track 30A in
  `30-search-scale-operations.md`. Breitere Mehrsprachigkeit oder optionale
  semantische Suche außerhalb des Launchscopes bleiben evidenzgetriebene
  Folgearbeit.
- **Fundstellen:** `lib/search/relevance.ts:7-38` bietet NFKD-/
  Akzentnormalisierung, Tokenisierung und gewichtete Substring-Treffer.
  `lib/jobs/public-read-model.ts:1065-1125,1412-1439` nutzt normalisierte
  `%term%`-LIKE-Suche, aber kein FTS, `pg_trgm` oder Berufsaliasnetz.
  `lib/candidate/job-alerts.ts:1444-1462` filtert separat per `contains`;
  `lib/candidate/dashboard.ts:318-386` und `lib/scoring/match-score.ts`
  besitzen keinen gemeinsamen Berufs-Konzeptvertrag.
- **Betroffene Modelle:** `JobRevision`, Category, Skill, CandidatePreference,
  Job Alerts und eine neue versionierte Search-Occupation-Taxonomy. Der
  vorhandene `OccupationCode` ist Reporting-Klassifikation und wird nicht ohne
  explizites fachliches Mapping als Suchontologie umgedeutet.
- **Betroffene Rollen:** Öffentlichkeit/Kandidat:innen; Content/Taxonomy Admin
  für kontrollierte Konzepte/Aliase; Product/Ops als Cluster-Approver.
- **Ist:** deterministische, akzentrobuste Feldgewichtung; gleichwertige
  Schweizer Berufsvarianten, Abkürzungen und Tippfehler können False-Zeros
  erzeugen. Alert und Suche können bei gleichem Begriff abweichen;
  Recommendations/Matching teilen die Fachsemantik nicht.
- **Soll P1:** versionierte Schweizer Berufs-Konzepte mit kanonischen Labels,
  Synonymen, Abkürzungen, geschlechtsspezifischen/neutralen Formen,
  Singular/Plural, regionalen Varianten und freigegebenen häufigen
  Tippfehlern. Query, Jobzuordnung, Alert-Snapshot, Candidate Preference,
  Recommendation und Matching verwenden dieselben Konzept-IDs und dieselbe
  Taxonomieversion. Bevorzugt wird eine erklärbare PostgreSQL-Lösung aus
  kontrollierter Expansion, `pg_trgm`/FTS und stabilen Rankingregeln.
- **Soll später:** weitere Cluster/Sprachen erhalten vor ihrer Aktivierung
  eigene Korpora. Hybrid-/semantische Komponenten oder ein externer
  Search-Service sind kein P1-Gate und werden nur bei belegtem Zusatznutzen,
  Fairness-, Privacy-, Kosten- und Operationsvertrag erwogen.
- **Root Cause:** bewusster deterministischer MVP-Proxy ohne gepflegten
  Berufs-Konzeptvertrag und ohne gepflegten Benchmark-/Negativkorpus.
- **Impact:** passende Jobs werden nicht gefunden; Alert-Relevanz und
  Marketplace-Liquidität erscheinen schlechter als sie sind. Das beschädigt
  Aktivierung, Bewerbungskonversion, Arbeitgeberreichweite und Vertrauen.
- **Änderungsrisiko:** hoch; Ranking-, Boost-, Pagination- und Performance-
  Invarianten können gleichzeitig brechen; unkontrollierte Expansion erzeugt
  fachfremde Treffer.
- **Abhängigkeiten:** Phase-19-Baseline, benannter Pflege-/Gesundheits- und
  Search Owner, fachliche Taxonomie/Aliasliste, Startcluster-Golden- und
  Negativkorpus sowie Cluster-/Sprachfreigabe. `pg_trgm`/FTS wird im ADR
  verglichen; Embeddings oder Search Service sind keine Voraussetzung.
- **Geeignete Tests:** für de-CH Pflege/Gesundheit mindestens
  `Pflegefachkraft → Dipl. Pflegefachfrau HF`,
  `Pflegefachperson → weibliche/männliche/neutrale Varianten`,
  `FaGe → Fachfrau/Fachmann Gesundheit EFZ` ohne falsche Gleichsetzung,
  `Plegefachfrau` als freigegebener Tippfehler sowie negative
  False-Broadening-Fälle. Hinzu kommen Search↔Alert-Parität,
  Recommendation-/Matching-Konzept-Parität, Cursor ohne Duplikate, Boost nie
  vor irrelevanten Treffern und Query-Plan/p95. Weitere Launchsprachen werden
  analog, aber nicht vorab pauschal als de/fr/it behauptet.
- **Abnahmekriterium:** Jeder zentrale Begriff des aktivierten Startclusters
  besitzt positive und negative Evidence; bei vorhandener passender
  indexierbarer Stelle existiert kein bekannter False-Zero. Der eingefrorene
  Korpus erfüllt die vorab definierten Recall-/Precision-/Latenzbudgets,
  Search/Alert/Recommendation teilen die Taxonomie und Ranking/Cursor/Boost
  bleiben versioniert, erklärbar und stabil.

### STH-020 — Admin-Listen besitzen harte Caps statt echter Pagination

- **Status / Priorität / Phase:** bestätigt; P1 vor wachsendem
  Betriebsvolumen; Track 30B.
- **Fundstellen:** `lib/admin/companies.ts:33-45` und
  `lib/admin/jobs.ts:68-79` lesen höchstens 200, `lib/admin/users.ts:18-25`
  und `lib/admin/support.ts:99-103` höchstens 250,
  `lib/admin/audit-read.ts:43-57` höchstens 100. In
  `app/admin/users/page.tsx:3` erfolgt ein Teil der Filterung erst nach diesem
  begrenzten Read.
- **Betroffene Modelle:** praktisch alle Admin-Queues: User, Company, Job,
  Support, Abuse, Lead, Import, Content, Audit, Privacy/Billing.
- **Betroffene Rollen:** jeweils capability-gebundene Admin-Personas aus
  STH-010.
- **Ist:** sichere bounded reads für die Demo; Datensätze hinter dem Cap sind
  unsichtbar und nachträgliche Filter können falsche Leere suggerieren.
- **Soll:** serverseitige Filter vor Pagination, stabile Keyset-Cursor mit
  eindeutiger Tiebreaker-Sortierung, Counts wo bezahlbar, kontrollierte
  Bulk-Aktionen und Exporte.
- **Root Cause:** Phase-11-Queues priorisierten harte Ressourcenbudgets über
  vollständige große Datenmengen.
- **Impact:** Operations übersieht Fälle; SLA, Moderation, Finance und Privacy
  können unvollständige Queuebilder erhalten.
- **Änderungsrisiko:** hoch; parallele Mutationen, Cursor-Fälschung,
  Bulk-RBAC/Audit und teure Counts.
- **Abhängigkeiten:** STH-010, gemeinsame Cursor-Schemas, passende
  zusammengesetzte Indizes und Export-/Privacy-Policy.
- **Geeignete Tests:** >250 Zeilen pro Queue, jede Zeile exakt einmal,
  Filter-before-page, parallele Inserts/Updates, ungültige/cross-filter Cursor,
  Bulk-Teilablehnung und Query-Plan/p95.
- **Abnahmekriterium:** Keine autorisierte Zeile ist nur wegen eines
  unsichtbaren Caps unerreichbar; Cursor sind stabil, opaque und an
  Filter/Sort/Capability gebunden.

### STH-021 — Kandidatenempfehlungen erzeugen Query-Fan-out

- **Status / Priorität / Phase:** technisch wesentlich mitigiert; P1-
  Abschlussmessung bleibt Track 30B.
- **Phase-27-Mitigation:** Der 360-px-Browserlauf reproduzierte Pool-Erschöpfung
  durch parallele Detail-Snapshot-Transaktionen. `getPublicJobsBySlugs`
  hydriert jetzt höchstens 50 Details in genau einem Eligibility-Snapshot,
  erhält die angeforderte Reihenfolge und führt Transaktionsqueries
  sequenziell aus. Der Query-Shape-Vertrag und der zusammenhängende
  Candidate↔Employer-Desktop-/360-Lauf sind grün.
- **Fundstellen:** `lib/candidate/dashboard.ts`,
  `lib/jobs/public-read-model.ts`,
  `tests/unit/jobs/public-read-model-query-shape.test.ts`. Notification-Links
  und ein instrumentiertes Gesamt-Query-Count-/p95-Ceiling bleiben offen.
- **Betroffene Modelle:** `CandidateProfile/Preference/Skill/Language`,
  `Job/JobRevision`, Notifications und Public Eligibility.
- **Betroffene Rollen:** Kandidat:innen; mittelbar DB-/Operations-Owner.
- **Ist:** zwei bounded Suchseiten plus eine einzige bounded
  Detailprojektion; keine Transaktion pro Empfehlungskarte. Eine vollständige
  48-Job-Instrumentierung des gesamten Dashboards fehlt noch.
- **Soll:** ein Batch-Read beziehungsweise materialisierte, versionierte
  Match-Projektion mit identischer Eligibility/Privacy und begrenzter
  Queryanzahl.
- **Root Cause:** Einzeljob-Detail-API wurde als Matching-Hydrator
  wiederverwendet.
- **Impact:** Latenz, Connection-Druck und DB-Kosten wachsen überproportional
  mit dem Kandidatenset.
- **Änderungsrisiko:** hoch; Batchen darf keine private Revision, abgelaufene
  Stelle oder anderes Ranking liefern.
- **Abhängigkeiten:** klarer Matching-Input-/Rankingvertrag,
  Batch-Public-Read-Model oder materialisierte Scores; Search-Änderungen aus
  STH-019 koordinieren.
- **Geeignete Tests:** instrumentiertes Query-Count-Ceiling bei 48 Jobs,
  Rankingparität, Eligibility-Drift, private-field Canary, Notification-Link-
  Batch und p50/p95 mit realistischer DB.
- **Abnahmekriterium:** Dashboard liefert dieselben sechs erlaubten Ergebnisse
  in konstant begrenzter Queryanzahl und innerhalb des freigegebenen
  Latenzbudgets.

### STH-022 — Business/Enterprise sind nur teilweise lieferbar

- **Status / Priorität / Phase:** teilweise bestätigt und bewusst gegatet;
  P1 nach WTP-Validierung, einzelne Integrationen XL; Phase 31.
- **Fundstellen:** Business ist öffentlich, aber nicht Self-Service, Enterprise
  vertraglich (`prisma/seed/fixtures/plans.ts:138-168`). Beide besitzen reale
  Radar-/Branding-/Boost-/Analytics-Entitlements (`263-282`), unterscheiden
  sich jedoch stark über Quotas. Die UI kennzeichnet ATS/API/SSO als später
  (`components/marketing/pricing-card.tsx:120-157`). Import besitzt bereits
  kontrollierte Approval-/Grant-Modelle
  (`prisma/schema.prisma:3472-3528`), erzeugt im aktuellen P1-Test aber bewusst
  keinen ImportRun/Job
  (`tests/integration/billing/p1-product-fulfillment-postgres.test.ts:491-496`).
- **Betroffene Modelle:** Plan/Product/Entitlement, ProductReleaseDecision,
  ImportSource/Approval/Grant/Run; später API Client, SSO und ATS-Mappings.
- **Betroffene Rollen:** Employer Owner/Admin, Sales, Product/Platform Admin,
  Integration/Support Ops.
- **Ist:** ehrliche Research-/Sales-Pläne mit funktionalen Kernbenefits und
  serverseitigen Gates; keine Arbeitgeber-Feed-Synchronisation, ATS/API/SSO
  oder zugesicherte SLA-Erfüllung.
- **Soll:** nur nach realem Bedarf priorisierte Enterprise-Fähigkeit; zuerst
  ein freigegebener Feed→Preview→Draft→Sync-Vertrag, danach nur belegte API/SSO/
  ATS-Angebote mit Tenant-Isolation, Support und SLA.
- **Root Cause:** Premium-Architektur und Marketinghypothese wurden vorbereitet,
  externe Integrationen aber richtigerweise hinter Rechte-/Provider-/
  Markt-Gates gestellt.
- **Impact:** Enterprise darf nicht als vollständig lieferbar verkauft werden;
  Business-Differenzierung kann kommerziell zu schwach sein.
- **Änderungsrisiko:** XL; Source Rights, Mapping, Secrets, SSO-Account-Linking,
  Volumen, Retries, DPA und Support/SLA.
- **Abhängigkeiten:** STH-004/009/018/024/028, Design-Partner, Importrechte,
  Providerzugänge, Preis-/WTP- und Supportmodell.
- **Geeignete Tests:** genehmigter Feed→Preview→Draft→Sync/Error/Retry,
  Tenant-/Source-Rights, Mappingversion, hohes Volumen, Contract Entitlements,
  SSO JIT/deprovision falls freigegeben und weiterhin kein Auto-Publish.
- **Abnahmekriterium:** Jede verkaufte Premium-Zusage besitzt einen laufenden,
  entitlement- und tenantgebundenen Produktpfad samt SLA/Runbook; nicht
  implementierte Integrationen bleiben technisch und sprachlich unverkaufbar.

### STH-023 — Browser- und Accessibility-Abdeckung ist unvollständig

- **Status / Priorität / Phase:** automatische technische Matrix weitgehend
  gelöst, reale AT-/Release-Abnahme offen; P1; Phase 29
  `29-ux-mobile-accessibility.md`.
- **Aktuelle Fundstellen:** `playwright.config.ts` konfiguriert Chromium,
  Firefox und WebKit für kritische Journeys.
  `tests/e2e/quality/phase29-accessibility.spec.ts` prüft Axe
  `critical + serious`, Keyboard, 200/400-%-Reflow, High Contrast und Reduced
  Motion; `phase29-critical-journeys.spec.ts` prüft den fachlichen Abschluss
  in allen drei Engines.
- **Betroffene Bereiche:** Public-, Auth-, Candidate-, Employer-, Admin- und
  Dialog-/Form-Komponenten; Browser-/CI-Infrastruktur.
- **Betroffene Rollen:** alle Nutzer, besonders Keyboard- und
  Screenreader-Nutzer.
- **Ist:** vollständige bestehende Route-/Browservollregression plus
  risikobasierte Chromium-/Firefox-/WebKit-Matrix, serious+critical Axe,
  Keyboard, Reflow, Contrast und Motion bestehen lokal. Dokumentierte reale
  NVDA-/VoiceOver-Runs und derselbe Nachweis auf dem finalen Releaseartefakt
  fehlen.
- **Soll:** risikobasierte Cross-Browser-Journeys, `critical + serious = 0`
  oder explizit befristete Ausnahmen, vollständige Keyboard-/Dialog-Flows,
  Zoom/Reduced Motion/Contrast und manuelle AT-Smokes.
- **Root Cause:** Release-Harness wurde für deterministische,
  ressourcenbegrenzte Chromium-Ausführung optimiert.
- **Impact:** Safari-/Firefox- und AT-spezifische Blocker können unentdeckt
  bleiben.
- **Änderungsrisiko:** mittel; CI-Zeit, Browserinstallation, Flakiness und
  Baseline-Triage dürfen den Gate-Wert nicht verwässern.
- **Abhängigkeiten:** CI-Browserimages, Accessibility Owner, manuelle
  NVDA/VoiceOver-Geräte/Tester und Phase-29-UI-Änderungen.
- **Geeignete Tests:** kritische Reisen auf Chromium/Firefox/WebKit,
  serious+critical Axe, Keyboard-only inklusive Focus Restore/Trap,
  200/400%-Zoom, reduced motion, Screenshots und dokumentierte AT-Smokes.
- **Abnahmekriterium:** Die freigegebene Browser-/AT-Matrix läuft auf dem
  Release-Artefakt ohne blockierende A11y-Verstöße; jede Ausnahme hat Owner,
  Ablaufdatum und reproduzierbaren Fall.

### STH-024 — Manueller Walkthrough lief nicht auf dem finalen Commit

- **Status / Priorität / Phase:** bestätigt und transparent dokumentiert; P0
  Release-Gate; Phase 32 `32-production-release-audit.md`.
- **Fundstellen:** `BUILD_REPORT.md:3-19` bindet technische Verifikation an
  `a9f24e7`, während `BUILD_REPORT.md:141-165` den manuellen Walkthrough auf
  Vorgänger `f7158c7` ausweist. Danach dokumentiert
  `codex-plan/evidence/2026-07-24-commercial-launch-follow-up.md:6-15` den
  Code-Commit `22ea451`, bei `46-58` Automation und bei `66-69` ausdrücklich
  keinen neuen manuellen Live-Browser-Check. Baseline `eb9b45a` ist erneut
  später.
- **Betroffene Artefakte:** Release-Commit/-Image, Seed-/Testdatenbank,
  `BUILD_REPORT`, Route-/Rollenmatrix und Deployment-Evidence.
- **Betroffene Rollen:** Public, Candidate, Employer Owner/Recruiter, alle
  Admin-Personas sowie Release Owner.
- **Ist:** starke Automation und ehrliche Kennzeichnung; menschlich sichtbare
  Rollenreisen sind nicht auf exakt demselben Kandidaten gelaufen.
- **Soll:** unveränderlicher Release Candidate; Automation, Cross-Browser-
  Matrix, manueller Rollen-Walkthrough und Staging-Smoke referenzieren
  denselben Commit und Artefaktdigest. Danach keine Runtime-Änderung.
- **Root Cause:** Nach manuellem Lauf folgten Fixes und Commercial Safeguards.
- **Impact:** visuelle, Copy-, Integrations- oder Rollenregression des
  tatsächlichen Release-Artefakts bleibt möglich.
- **Änderungsrisiko:** Code gering, Evidenz mittel; ein nachträglicher Fix
  invalidiert den Lauf und startet das Gate erneut.
- **Abhängigkeiten:** Abschluss Phasen 19–31, sauberer Worktree, isolierte DB,
  reproduzierbares Build-Artefakt, Staging und verfügbare Rollen-Tester.
- **Geeignete Verifikation:** kompletter Release-Gate-Lauf, manuelle
  Public/Candidate/Employer/Recruiter/Admin-Reisen, Desktop/Mobile, Console/
  Network/Accessibility, Commit+Digest+Zeit+Tester protokolliert.
- **Abnahmekriterium:** Der letzte Runtime-Commit ist identisch mit dem
  automatisiert und manuell geprüften sowie deployten Artefakt; jede spätere
  Runtime-Änderung macht Phase 32 wieder offen.

### STH-025 — Mobile Tabellen waren horizontale Desktoptabellen

- **Status / Priorität / Phase:** im aktuellen Repository technisch gelöst;
  reale mobile Nutzungsprioritäten bleiben offen; P2, für häufige mobile
  Operationen nach Nutzungsdaten P1; Phase 29.
- **Fundstellen:** `components/ui/responsive-table.tsx`,
  `app/globals.css`, `tests/unit/ui/phase29-responsive-parity.test.tsx` und
  `tests/e2e/quality/phase29-responsive-operations.spec.ts`.
- **Betroffene Bereiche:** Employer-/Recruiter- und Admin-Listen, besonders
  Jobs, Applicants, Billing, Audit, Moderation und Support.
- **Betroffene Rollen:** mobile Employer/Recruiter und Operations/Admin.
- **Ist:** die inventarisierten Admin-/Employer-/Billing-/Privacy-Tabellen
  verwenden ein semantisches gemeinsames Primitive. Dieselben Zellen und
  Aktionen werden bei kleinen Viewports als Cards dargestellt; es gibt keinen
  divergierenden zweiten DOM- oder Actionbaum und keinen unkontrollierten
  Dokumentoverflow.
- **Soll:** gemeinsames Responsive-List-Pattern mit priorisierten Spalten,
  mobilen Cards/Disclosure, sichtbarer Hauptaktion und vollständiger Desktop-
  Parität.
- **Root Cause:** Phase 18 behob Blocker und machte Tabellen sicher scrollbar,
  führte aber keinen querschnittlichen mobilen Informationsentwurf durch.
- **Impact:** langsame, fehleranfällige mobile Triage; wichtige Werte oder
  Aktionen liegen außerhalb des Viewports.
- **Änderungsrisiko:** mittel bis hoch; doppelter Responsive-DOM kann A11y,
  Action-State und Testselektoren divergieren.
- **Abhängigkeiten:** UX-Priorisierung je Queue, gemeinsames Komponentenpattern,
  STH-020-Pagination und STH-023.
- **Geeignete Tests:** 320/360 px reale Action-Flows, keine versteckte
  Hauptaktion, Keyboard/Screenreader-Labels, Zoom, Desktopparität,
  Screenshot-/Clipping-Regression.
- **Abnahmekriterium:** Jede P0/P1-Queue ist auf 320 px ohne horizontales
  Suchen vollständig triagier- und bedienbar; seltene Zusatzdaten bleiben
  zugänglich und Desktop verliert keine Information.

### STH-026 — Zentrales Notification Preference Center fehlt

- **Status / Priorität / Phase:** bestätigt; P1 vor realer E-Mail-Zustellung;
  Kern in Phase 20, UX-Regression in Phase 29.
- **Phase-20-Abschluss:** fachlicher Kern technisch geschlossen. Candidate und
  Employer besitzen owner-scoped Preference Center; eine geschlossene
  Purpose-Matrix trennt Pflicht- von optionaler Kommunikation und der
  Dispatcher prüft die aktuelle Version vor Send erneut. Breite Phase-29-
  Browser-/AT-Regression und Legalaktivierung bleiben offen.
- **Fundstellen:** `CandidatePreference` betrifft nur Jobsuche
  (`prisma/schema.prisma:1395-1412`); Frequenz ist je Job Alert
  (`2097-2178`). `Notification` (`2235-2248`), `EmailLog` (`2250-2264`) und
  Consent-Events (`2266-2297`) besitzen keinen zentralen Kanal-/Frequenz-
  Vertrag. Ein `NotificationPreference`-Modell und eine zentrale Route fehlen.
- **Betroffene Modelle:** `UserConsentEvent`, `CandidateConsent`, `JobAlert`,
  `Notification`, `EmailLog`; neu versionierte Preference Events/Projection.
- **Betroffene Rollen:** Kandidat:innen, Arbeitgeber, Recruiter; System für
  Security-, Privacy- und Finance-Pflichtmeldungen.
- **Ist:** sichere zweckbezogene Einzelkontrollen wie Alert-Unsubscribe und
  Radar-Opt-in; keine einheitliche Sicht oder kanalübergreifende Entscheidung.
- **Soll:** versionierte Taxonomie für mandatory/transactional/service/
  marketing, Kanal und Frequenz, sichere Defaults, globaler Marketing-
  Widerruf, domänenspezifische Feinsteuerung und unveränderliche Historie.
- **Root Cause:** Notifications wurden inkrementell pro Domäne ergänzt.
- **Impact:** Überkommunikation, inkonsistente Opt-outs, Supportaufwand und
  Risiko, optionale oder verpflichtende Zustellung falsch zu behandeln.
- **Änderungsrisiko:** sehr hoch; Pflichtmeldungen dürfen nicht unterdrückt,
  Marketing darf nach Widerruf nicht versendet werden.
- **Abhängigkeiten:** STH-007/009/013/017, Legal-Klassifikation, Outbox-
  Dispatch und UI/A11y.
- **Geeignete Tests:** Default-/Migration-Matrix, mandatory nicht abschaltbar,
  globales Marketing-Opt-out, Kanal/Frequenz, Version/EffectiveAt, Tenant/
  Ownership, Suppression bei queued Mail und concurrent update/send.
- **Abnahmekriterium:** Jede Notification-Art besitzt eine freigegebene
  Kategorie und deterministische Preference-Entscheidung; Dispatch speichert
  diese Decision-Version und respektiert Widerrufe ohne Pflichtmeldungen zu
  verlieren.

### STH-027 — Die Sitemap skaliert nicht über 50.000 URLs

- **Status / Priorität / Phase:** als spätere Kapazitätsgrenze bestätigt, aber
  **kein aktueller Produktionsfehler**; P3-Skalierungsvorbereitung solange
  Count-/Byte-/Performancebudget und 90-Tage-Prognose unter dem Trigger liegen;
  Track 30C in Phase 30.
- **Fundstellen:** `lib/seo/public-sitemap.ts:20` setzt 50.000,
  `20-46` definiert 10 statische Pfade, `85-89` den Capacity Error,
  `92-136` eine einzige Sitemap und `428-435` den fail-closed-Abbruch.
  `app/sitemap.ts:7-18` bietet nur eine production-only, request-time Route.
  `tests/unit/seo/public-sitemap.test.ts:111-129` testet bewusst den Abbruch,
  nicht Sharding.
- **Betroffene Modelle:** öffentliche Jobs, Companies, Content und aktive
  Cluster; Crawler-/Search-Console-Betrieb.
- **Betroffene Rollen:** öffentlich/SEO; Content/Acquisition Ops.
- **Ist:** sichere, deterministische einzelne Sitemap; jenseits der Kapazität
  fällt der gesamte Request aus, statt URLs still abzuschneiden. Das schützt
  Integrität/Privacy, ist bei tatsächlichem Überlauf aber nicht
  verfügbarkeitssicher. Ein sitemap-spezifischer Count-/Byte-/Laufzeitmonitor,
  Forecast und Alert fehlen.
- **Aktuelle Größenordnung:** gezählt wird gemeinsam
  `10 + eligible LIVE jobs + LIVE companies + LIVE guides + LIVE clusters`.
  Standorte/Berufe erscheinen nur als aktive Clusterseiten im selben Budget;
  bei 26 Kantonen und 18 Kategorien beträgt deren kombinatorische Obergrenze
  512 (`26 × 18` Paare plus 26/18 Eltern), sofern alle Inhalts-/Launch-Gates
  bestehen. Damit bleiben theoretisch 49.990 dynamische Plätze. Der lokale DEMO-Seed
  besitzt keine eligible LIVE-Datensätze: die Nicht-Production-Route liefert
  0, ein production-like Builder über dieselben DEMO-Daten nur die 10
  statischen Pfade. Eine reale Production-Zahl ist mangels Zielumgebungs-
  Manifest/DB **nicht aus dem Repository belegbar**. Das Start-Szenario der
  Produktstrategie projiziert grob 336–348 URLs und damit deutlich unter 1 %
  des Count-Limits; das ist keine LIVE-Messung. Ein seriöses Datum bis 50.000
  ist ohne reale Ausgangszahl/Wachstumsreihe nicht bestimmbar.
- **Soll jetzt:** reale Zielumgebungs-Counts pro Ressource, gemeinsame Summe,
  unkomprimierte Bytes, Generierungsdauer/DB-Batches, letzter Erfolg,
  7-/30-Tage-Wachstum, konservative 90-Tage-Prognose, Owner, Alerts und
  Runbook. Unter 70 % bleibt die Single-Sitemap als korrektes fail-closed
  Design bestehen.
- **Soll bei Trigger:** ab 70 % Count-/Bytebudget oder entsprechender
  90-Tage-Prognose Shard-ADR/Zielrelease verbindlich planen; ab 80 % den
  Sitemap-Index mit stabilen Ressource- und bei Bedarf Cluster-/Keyset-Shards
  vor weiterer indexierbarer Expansion deployen. Ab 90 %, Capacity Error oder
  Byte-/Timeout-/p95-Bruch ist der Zustand P1/Betriebsblocker. Jeder Shard
  wahrt Count-/Bytebudget, Eligibility und deterministische Namen/Caches.
- **Root Cause:** MVP-Datenmenge lag klar unter dem Protokolllimit und wählte
  bewusst fail-closed statt vorzeitiger Sharding-Komplexität.
- **Impact:** heute kein belegter Launchschaden; bei unbemerktem Wachstum
  verschwindet später die gesamte Discovery-Evidence für Crawler. Request-time
  DB-/Latenzkosten oder die XML-Bytegrenze können früher als 50.000 greifen.
- **Änderungsrisiko:** mittel; Duplikate/Lücken, Canonical-Leaks,
  Revoke-/Expiry-Drift und Cacheinvalidierung. Ein unnötiger Sofortumbau erhöht
  diese Risiken ohne heutigen Nutzen.
- **Abhängigkeiten:** Phase-19-LIVE-Kapazitätsbaseline, Monitoring/Ops aus
  Phase 23, Wachstumsannahme sowie Search-Console-/Robots-Betrieb. Stabile
  Shard-/Keysetstrategie wird erst beim Trigger Implementierungsvoraussetzung.
- **Geeignete Tests jetzt:** bestehender Capacity-Error/no-truncation-Vertrag,
  Ressourcen-/Gesamtcount, XML-Bytes, Forecast-Schwellen, Alert/Runbook,
  Eligibility/Revoke/Expiry und p95/Timeout. **Bei Trigger zusätzlich:**
  >50.000 synthetische LIVE-URLs, valides Index-/Shard-XML, jede eligible URL
  exakt einmal, Count-/unkomprimierte Bytegrenzen, stabile Namen, Cache/
  Freshness, Robots-Verlinkung und keine privaten/DEMO-Pfade.
- **Abnahmekriterium:** Unter dem Trigger besitzt die sichere Single-Sitemap
  datierte Messung, ausreichenden Headroom, Forecast, Alert und Owner; der
  Befund bleibt ehrlich `P3 DEFERRED / MONITORED`. Sobald ein Trigger gilt,
  ist vor weiterer indexierbarer Expansion ein valider Index Pflicht, in dem
  alle und nur indexierbare LIVE-URLs exakt einmal in begrenzten stabilen
  Shards erscheinen.

### STH-028 — Hypothesen-/Mock-Sprache auf Pricing ist aktuell korrekt

- **Status / Priorität / Phase:** bewusst anders umgesetzt und derzeit kein
  Fehler; Schutz-Gate in Phase 31, keine Entfernung vor Freigabe.
- **Fundstellen:** Metadata nennt Hypothesen
  (`app/(public)/pricing/page.tsx:16-19`), Seite kennzeichnet Paket-/Mock-
  Checkout-/Produkt-/Demo-Grenzen (`80-143`).
  `components/marketing/pricing-card.tsx:24-32,113-124` zeigt
  „Planhypothese“, Mock-CTA und keine direkte Enterprise-Bestellung.
  Die bestehende Commercial-Evidence hält fest, dass Mock Payment kein
  WTP-Beleg ist
  (`codex-plan/evidence/2026-07-24-commercial-launch-follow-up.md:30-41`).
- **Betroffene Modelle/Bereiche:** Plans, Products, Orders, mock Subscription,
  Public Pricing, Employer Checkout und Sales Leads.
- **Betroffene Rollen:** Öffentlichkeit, Arbeitgeber, Sales/Product Owner.
- **Ist:** Demo-/Research-Modus kommuniziert ehrlich, was kaufbar,
  hypothetisch oder lokal simuliert ist.
- **Soll:** nicht pauschal „Hypothese“ entfernen, sondern mode-getrennte Copy:
  Demo bleibt ehrlich; Production zeigt ausschließlich rechtlich,
  kommerziell und technisch freigegebene Angebote mit realem Checkout oder
  klarer manueller Vertragsstrecke.
- **Root Cause:** Reale Zahlung, WTP-, Tax-/AVG-/Vertragsfreigabe und Teile des
  Premium-Angebots fehlen.
- **Impact:** Vorzeitiges Entfernen wäre irreführend und könnte Mock-Intent als
  kaufbares Produkt darstellen; dauerhaft nur hypothetische Sprache würde
  später Conversion schwächen.
- **Änderungsrisiko:** hoch; Copy-, Catalog-, Entitlement- und Providerstatus
  könnten auseinanderlaufen.
- **Abhängigkeiten:** STH-005/007/018/022, echter Geldtest, Tax/AVG/AGB,
  ProductReleaseDecision und freigegebener Production-Katalog.
- **Geeignete Tests:** Environment-/mode-Matrix, Demo enthält Mock/Hypothese,
  Production enthält diese Begriffe nur wo fachlich nötig, zeigt nur
  freigegebene Produkte, missing Provider fail-closed und Preise/
  Entitlements bleiben serverseitig.
- **Abnahmekriterium:** Copy wird aus demselben freigegebenen Modus-/Katalog-
  Vertrag wie Checkout abgeleitet; Demo übertreibt nichts und Production
  bewirbt oder verkauft keine ungeprüfte Leistung.

## 3A. Ergänzende Dossiers STH-029 bis STH-037

> Diese Dossiers wurden am 26. Juli 2026 zuerst gegen den sauberen
> Planungscommit `e34262e3074565840e371c336a5d2ba5cf3efbac` bewertet und auf
> Candidate `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c` revalidiert.
> `STH-029` ist durch Phase 19 geschlossen. `STH-001`, `STH-002` und
> `STH-013` sind durch Phase 20 technisch geschlossen, `STH-026` im
> fachlichen Kern umgesetzt; ihre LIVE-/Worker-/Legal-/UX-Gates sowie
> `STH-030` und `STH-031` sind durch Phase 25 technisch im deaktivierten
> Local-/CI-Vertrag geschlossen, bleiben aber aktivierungsseitig an externe
> Security-/Trust-/Operationsgates gebunden. `STH-032`–`STH-037` bleiben nach
> jeweiligem Status, Trigger oder externem Gate offen. Die Priorität je
> Launchklasse steht in Abschnitt 3B.

| ID | Befund und unabhängiger Status | Lead / Mitwirkende | Rollen, Portale und aktuelle Fundstellen | Abhängigkeiten und geschützte Regressionen | Verbindlicher Test-/Evidence-Vertrag | Externer Gate / Abschlussstatus |
| --- | --- | --- | --- | --- | --- | --- |
| `STH-029` | **geschlossen:** höher priorisierte Requirements, Architektur, ADRs, Implementation Guidance, Quickref/Glossary und Phasen 19–32 waren nicht synchron; alle offenen Phasen hatten keinen vollständigen 28-Punkte-/AC-Testvertrag. Candidate `769ee62` synchronisiert und versiegelt diesen Vertrag. | 19 abgeschlossen / alle Phasen 20–32 halten den Vertrag | Product, Engineering, QA; `00-PLAN.md`, `requirements-matrix.md`, `architecture-blueprint.md`, `decisions.md`, `implementation-plan.md`, Phase-19–32-Testabschnitte | Candidate `769ee62`; Phasen 01–18/Evidence immutable; Ist-Routeinventar nicht vorplanen | 37/37 IDs, sechs LC, vier Statusdimensionen, jede Phase 28 Punkte und vollständige AC-Matrix; G4-Baseline und Diff-Invarianten auf einem Commit; [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | kein externes Fachgate; **durch Phase-19-Gate geschlossen, Folgeregression weiter geschützt** |
| `STH-030` | **technisch Local/CI gelöst:** Passkey/TOTP/Recovery, Session-AAL2 und `STEP_UP_POLICY_V1` orchestrieren kurzlebige, opaque, actor-/session-/purpose-/action-/tenant-/resource-bound Single-use-Grants für Candidate-, Employer-, Billing-, Privacy-, Reveal- und Admin-Hochrisikoaktionen. | 25B technisch / 20, 22, 24, 26 Consumer | Candidate, Employer Owner, Billing, Admin; `lib/auth/assurance/**`, Security-Routen und eingebettete `StepUpGrantControl`; bestehende Ownership/Membership bleibt vorgeschaltet | Phase-20 Identity; Session-, safe-next-, tenant-, candidate-owner-, Reveal-, Privacy- und Billing-Autorisierung bleibt erhalten | Unit/PostgreSQL/Desktop/360 `PASS`: stale/replay/cross-purpose/-actor/-tenant/-resource/direct action 0 Wirkung, erlaubte Action genau einmal; Account-Recovery widerruft alte Sessions/Grants | [Phase-25-Evidence](./evidence/2026-07-28-phase-25.md); Geräte-/Recoverypolicy, Production-RP-ID/HTTPS, Security Owner und Enforcement extern `BLOCKED`, Technikbefund geschlossen |
| `STH-031` | **technisch Local/CI gelöst:** `TRUST_RISK_POLICY_V1`, persistierte minimierte Signal/Decision/Case/Event/Appeal-Evidence, bounded Queue, scope-basiertes Hold/Revoke, SoD-Appeal/Restore und Phase-23-Expiry-/Failure-Handler bilden den kohärenten Fraud-/Scam-/ATO-Vertrag. | 25C technisch / 23, 24, 26, 30D Consumer | alle Nutzer, Trust & Safety, Security, Finance; `lib/security/risk/**`, `lib/trust-safety/**`, Admin-/User-Security-Routen; interne Evidence bleibt aus Support-/Subject-DTOs entfernt | Identity/Workers/Payment geschützt; Phase 26 liefert fachliche Company-Reverification, 30D Duplicate-Fachsignal | Policy/PostgreSQL/E2E prüfen Stuffing, Compromise, Scam/Duplicate, Mass Contact, Complaint, Reveal/Export/Payment, Dedupe, false-positive Control, nächste-Read-Sperre, Appeal und Worker-Recovery `PASS` | [Phase-25-Evidence](./evidence/2026-07-28-phase-25.md); Risk-/Retention-/DSFA-Freigabe, benannte Reviewer, Capacity, Pager/Staging extern `BLOCKED`, Technikbefund geschlossen |
| `STH-032` | **teilweise bestätigt:** Job-Ablauf und öffentliche Ausblendung sind fail-closed; Reconfirmation, Reminder, „besetzt/nicht verfügbar“-Feedback, Copy-/Dublettenreview und schnelle kanalübergreifende Deaktivierung fehlen. | 30D / 23 Worker, 26 Trust, 31 Cluster | Visitor, Candidate, Employer, Admin; Public Search/Detail, Employer Jobs, Admin Queue; `lib/jobs/effective-status.ts`, `lib/jobs/public-eligibility.ts`, Alerts/Sitemap/Recommendations | 23 Notifications/Worker und 26 Trust; bestehende Publish-/Revision-/Quota-/Slug-/Boost-/Eligibility-Verträge | Time-travel, concurrency, filled/report, exact/near-duplicate, appeal; identische Ausblendung aus Search, Sitemap, Alerts, Recommendations und Analytics; keine Promotion veralteter Dublette; G2/G3 vor Public | fachliche Freshness-/Duplicate-Policy, Moderationskapazität; **offen** |
| `STH-033` | **teilweise bearbeitet:** Browser-, Mobile- und Axe-Tests beweisen weiterhin keine Verständlichkeit oder Vertrauen. Protocol v1 und eine ausdrücklich leere aggregierte Ergebnisvorlage definieren nun Consent, Segmente, Tasks, Schwellen, Teach-back, Severity und zwei Runden; es wurden noch keine Teilnehmenden rekrutiert oder Sessions durchgeführt. | frühe 29A / 26, 30, 31; 29B Abschluss | Candidate, Employer, Admin/Support; JobPass, Search, Fair Score, Verification, Radar/Reveal, CV/Privacy, Pricing/Limits/Kündigung; `codex-plan/research/phase29-*`, Phase 29 | keine PII in Git; Defekte gehen in owning Phase statt UI-Kaschierung; 30A/30D-Scope vor finalem Re-Test | ≥5 Candidate, ≥5 Employer/Recruiter, ≥3 Admin/Ops in zwei Runden; Task success, Zeit, Fehler, Abbruch, Comprehension/Trust; anonymisierter Report und Go/No-go | [Phase-29-Evidence](./evidence/2026-07-29-phase-29.md); Rekrutierung, Research/Privacy Owner und externe Nutzerhypothesen bleiben **offen** |
| `STH-034` | **bestätigt:** SLA-/Queue-Alter existieren, aber kein Minuten-/Arrival-/Backlog-/Staffing-/Coverage-/Unit-Cost-Modell je Verification, Moderation, Import, Privacy, Support und Fraud. | frühe 31A / Telemetrie 23, Queues 25/26/30 | Ops, Support, Privacy, Trust, Commercial; `lib/admin/sla.ts`, `lib/admin/support.ts`, `product-strategy.md`, Phase 31 | reale oder kontrolliert gemessene Fälle; STH-033 Research; Demo-Zeitwerte nicht als Marktbeleg | p50/p95 Handling Time, Arrival, Backlog Age, FTE/Vertretung/On-call, Automation- und Aufnahme-Stopp, max. Concierge-COGS; Capacity-/Cost-Report mit Owner | Staffing-/Kosten-/Servicelevel-Freigabe; **offen** |
| `STH-035` | **technisch Local/CI gelöst:** Phase 24 klassifiziert Plattformfehler getrennt von normalem Outcome, User- und Providerfehler und erzwingt genau eine Credit-Wiederherstellung, Boostverlängerung oder Refund-Eskalation. ADR-028 bleibt für normale Ablehnung/Ablauf/Kündigung unverändert. | 24 technisch / Policy 31, Trust 26 | Employer Owner, Finance, Support, System; `lib/billing/service-delivery-policy.ts`, `lib/billing/finance-operations.ts`, Billing/Radar/Boost | WTP-Go, echte Zahlung, Trust-/Provider-Failureklassifikation; Ledger/Invoice/Order immutable und idempotent | Policy-/PostgreSQL-Matrix mit Replay/Parallelität und unberechtigten Klassen Local/CI `PASS`; konkrete Paid-Servicepolicy und LIVE-Incident bleiben extern | [Phase-24-Evidence](./evidence/2026-07-27-phase-24.md); Finance/Legal/Support-Freigabe und konkretes Paid-Versprechen **offen** |
| `STH-036` | **teilweise bestätigt:** datenschutzarme Result-Count-Buckets einschließlich Nulltreffer existieren; unbekannte/schlechte Suchbegriffe können nicht sicher in Taxonomiepflege zurückgeführt werden. | 30A / Privacy 22, Fachreview 31A | Visitor/Candidate, Search/Data/Privacy; `lib/analytics/event-contracts.ts`, `app/(public)/jobs/actions.ts`, `lib/search/relevance.ts` | STH-017 Analytics/Consent und STH-019 Taxonomie; keine Rohquery-/PII-/Rare-query-Leaks, Demo/LIVE getrennt | redaction/tokenization, k-/Mindestmengen-Suppression, Retention, Access, Poisoning/Bias, Review→TaxonomyVersion→publish/revoke und Re-identification-negativ; Data/Privacy Evidence | Privacy/Data-/Fachfreigabe; **offen, bestehende Bucket-Erfassung bereits gelöst** |
| `STH-037` | **bestätigt:** Phase 31 priorisierte Boost/Radar vor Basisworkflow-WTP, obwohl deren Wert organische Reichweite beziehungsweise Kandidatendichte voraussetzt; erster Launch war nicht ausdrücklich auf genau ein Paar begrenzt. | frühe 31A / 24, 26, 30A; 31B Freigabe | KMU, Product, Commercial, Finance; Phase 31 Angebotsreihenfolge, Product Strategy/Commercial Gates | Phase 19; fachliches Korpus, WTP-/Cashflow-/Capacity-Modell; Paid Self-Service Phase 24 erst nach Go | preregistrierte Starter/Pro-, Hiring-Sprint-, Retainer+Credits-, Concierge-/Import-Angebote; reale beglichene Rechnung, Stopregel; Boost-Reach-/Radar-Density-Gate; Pause/Reactivation getrennt | reale KMU, Tax/Legal/AVG/Finance; **offen, keine WTP-Behauptung** |

## 3B. P0–P4-Matrix nach Launchklasse

`P0*` bedeutet: P0, sobald der benannte Feature-/Geld-/Volumentrack in dieser
Launchklasse aktiviert wird; andernfalls muss er vollständig fail-closed
bleiben. Diese Matrix ersetzt pauschale globale Prioritäten nicht durch
weniger Testtiefe: Security-, Privacy-, Payment- und Tenant-Negativtests
bleiben für jeden vorhandenen Pfad Pflicht.

| ID | LC1 Demo | LC2 Design Partner | LC3 Invite Pilot | LC4 Public Free | LC5 Paid Self-Service | LC6 Scale |
| --- | --- | --- | --- | --- | --- | --- |
| `STH-001` | P2 | P0 | P0 | P0 | P0 | P0 |
| `STH-002` | P2 | P0 | P0 | P0 | P0 | P0 |
| `STH-003` | P2 | P0* | P0* | P0* | P0* | P0* |
| `STH-004` | P3 | P0* | P0* | P0* | P0* | P0* |
| `STH-005` | P4 | P2 | P2 | P4 | P0 | P0 |
| `STH-006` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-007` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-008` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-009` | P3 | P1 | P0 | P0 | P0 | P0 |
| `STH-010` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-011` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-012` | P4 | P4 | P3 | P3 | P3 | P3 |
| `STH-013` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-014` | P3 | P0* | P0* | P0 | P0 | P0 |
| `STH-015` | P4 | P3 | P3 | P3 | P3 | P3 |
| `STH-016` | P4 | P3 | P3 | P3 | P3 | P3 |
| `STH-017` | P3 | P1 | P1 | P0 | P0 | P0 |
| `STH-018` | P4 | P1 | P0 | P0 | P0 | P0 |
| `STH-019` | P2 | P1 | P0 | P0 | P0 | P0 |
| `STH-020` | P4 | P3 | P2 | P1 | P1 | P0 |
| `STH-021` | P4 | P3 | P2 | P1 | P1 | P0 |
| `STH-022` | P4 | P4 | P3 | P3 | P2 | P1 |
| `STH-023` | P2 | P1 | P1 | P0 | P0 | P0 |
| `STH-024` | P1 | P0 | P0 | P0 | P0 | P0 |
| `STH-025` | P3 | P2 | P1 | P0* | P0* | P0 |
| `STH-026` | P3 | P1 | P0 | P0 | P0 | P0 |
| `STH-027` | P4 | P4 | P4 | P3 | P3 | P0* |
| `STH-028` | P0 | P0 | P0 | P0 | P0 | P0 |
| `STH-029` | P0 | P0 | P0 | P0 | P0 | P0 |
| `STH-030` | P2 | P0 | P0 | P0 | P0 | P0 |
| `STH-031` | P2 | P0 | P0 | P0 | P0 | P0 |
| `STH-032` | P3 | P1 | P0 | P0 | P0 | P0 |
| `STH-033` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-034` | P3 | P0 | P0 | P0 | P0 | P0 |
| `STH-035` | P2 | P0* | P1* | P3 | P0 | P0 |
| `STH-036` | P2 | P1 | P1 | P1 | P1 | P1 |
| `STH-037` | P3 | P0 | P0 | P0 | P0 | P0 |

Scopekorrekturen:

- `STH-012` Multi-Persona wird nur bei explizitem Scope-Go P0; default P3/P4.
- `STH-015/016` werden nur P0, wenn externer Tracker/Vollscheduler ausdrücklich
  verkauft oder als Launchfunktion versprochen wird.
- `STH-020/021` eskalieren anhand gemessener Caps/Querybudgets.
- `STH-027` bleibt P3/P4 bis zum dokumentierten Capacity-Trigger.
- `STH-037` ist für LC3/LC4 wegen „genau ein erster Cluster“ P0; echte
  WTP-Evidence ist dort nur bei bezahltem Angebot Pflicht. LC5/LC6 benötigen
  zusätzlich das Real-Money-/Delivery-Go.
- Salary LIVE bleibt deaktiviert/deferred und wird erst vor Aktivierung P0.

## 4. Abdeckungs- und Evidence-Regeln

- Die Matrix und ergänzenden Dossiers enthalten jede ID von STH-001 bis
  STH-037 genau einmal mit Lead-Owner und launchklassenspezifischer Priorität.
- Phase 19 `19-remediation-baseline-regression.md` rebaselined alle 37 IDs und
  schützt die bestehenden Phase-01-bis-18-Verträge. Die in der Matrix genannte
  Phase ist der fachliche Remediation-Owner; Phase 19 bleibt eine
  Querschnittsabhängigkeit.
- STH-004 wird absichtlich aufgeteilt: E-Mail in Phase 20, Storage in Phase 21,
  verbleibende Provider-/Composition-/Operations-Grenzen unter Lead Phase 23
  und Payment in Phase 24. Ein Provider darf die Freigabe eines anderen nicht
  implizieren.
- STH-026 besitzt eine fachliche Umsetzung in Phase 20 und eine verbindliche
  mobile/A11y-Regression in Phase 29. Das ist keine doppelte Erledigung,
  sondern ein Owner-/Verifier-Verhältnis.
- STH-018 wird nicht mit Demo-/Seed-Daten geschlossen. STH-028 wird nicht durch
  Entfernen ehrlicher Mock-Sprache geschlossen. STH-024 kann erst auf dem
  unveränderten finalen Artefakt abgeschlossen werden.
- Phase 31 besitzt bewusst einen frühen Discovery-Track nach Phase 19 und eine
  spätere Production-Freigabe. Kostenlose Design-Partner können
  Usability/Liquidität, aber niemals WTP belegen; Phase 24 bleibt für LIVE bis
  zum ProductRelease-/Katalog-/Paid-WTP-Gate geschlossen.
- Phase 30 besitzt getrennte Evidenzstände: Track 30A ist ein frühes
  P0-Gate für jeden aktivierten LC3+-Cluster (P1 für beaufsichtigte
  Discovery), 30B schließt die operativen Scale-Befunde, 30C steuert STH-027
  und 30D die LC3+-Freshness. Ein grüner 30A-/30D-Track schließt STH-027
  nicht. Liegt dessen
  Trigger nicht vor, erhält STH-027 eine datierte `P3 DEFERRED / MONITORED`-
  Entscheidung mit Count-/Byte-Headroom, Forecast, Alert und Owner, ohne den
  Launch zu blockieren; bei Trigger werden Index/Shards Pflicht.
- Eine Phase darf ihren Befund erst als erledigt markieren, wenn die genannten
  Abnahmekriterien durch tatsächlich gelaufene Tests beziehungsweise bei
  externen Gates durch datierte, ownergebundene LIVE-Evidence belegt sind.
- Historische Phase-Evidence bleibt unverändert. Neue Test- oder Go-live-
  Behauptungen werden nicht rückwirkend in dieses Planungsdokument
  hineinformuliert.

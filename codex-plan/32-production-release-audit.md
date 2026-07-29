# Phase 32 — Finaler Produktions-, Launchklassen- und Release-Audit

> **Planstatus: GEPLANT. Technikstatus: NICHT IMPLEMENTIERT. Quality-Gate G4:
> NICHT GELAUFEN. Release/Aktivierung: DISABLED.** Diese Phase entwickelt
> keine neuen Runtime-Funktionen. Sie friert genau einen Kandidaten ein,
> re-auditiert `STH-001` bis `STH-037`, prüft die für **eine** von sechs
> Launchklassen erforderliche Evidence und belegt, dass Commit, gebautes
> Artefakt, Deployment und manueller Walkthrough identisch sind.

Es gilt
[`remediation-execution-contract.md`](./remediation-execution-contract.md)
vollständig.

## Phasenspezifische Instanziierung des 28-Punkte-Vertrags

### 1. Status

| Dimension | Status |
|---|---|
| Plan | `PLANNED` |
| Technik | Phase-32-Gate/Manifest noch nicht implementiert |
| Quality-Gate | G4 nicht gelaufen; historische Phase-18-Runs zählen nicht |
| Aktivierung | kein Phase-32-Release freigegeben |

Jede Zielklasse besitzt einen eigenen Status. Ein grünes LC1-Urteil ist kein
LC2–LC6-Urteil; ein technischer Testabschluss ist keine externe Freigabe.

### 2. Ziel und messbarer Nutzer-/Businesswert

- Für genau einen unveränderlichen Commit und Artefaktdigest reproduzierbar
  entscheiden, welcher reale Betriebsumfang sicher und ehrlich zulässig ist.
- Jeder der 37 Findings erhält direkte Evidence und einen zulässigen
  Endstatus statt übertragener Alt-Häkchen.
- Public, Candidate, Employer, Recruiter, Admin, Support/Ops und System werden
  mit positiven, negativen, Tenant-, Abuse- und Failure-Journeys geprüft.
- Reale Nutzer, Unternehmen, Zahlungen und Provider werden erst ab der
  Launchklasse zugelassen, deren fachliche, rechtliche, technische und
  operative Gates vollständig erfüllt sind.

### 3. Tatsächlicher Repositoryzustand

- `STH-024`: der historische Vier-Rollen-Walkthrough und die damalige
  Automation liefen nicht auf einem nach Remediation eingefrorenen,
  identischen Releaseartefakt.
- Phasen 19–31 sind Plan; deren geplante Tests/Evidence wurden durch das
  Erstellen dieses Plans nicht ausgeführt.
- Der aktuelle `npm run test:release`/Phase-18-Vertrag bildet die erweiterten
  Findings, sechs Launchklassen und G4-Manifestbindung noch nicht vollständig
  ab.
- Externe Provider-, Legal-, Privacy-, Tax-, AVG-, Market-, Staffing- und
  Operations-Evidence kann nicht aus Code oder Seed abgeleitet werden.
- Der Sequenzentscheid vom 27. Juli 2026 richtet Staging erst am Ende ein.
  Phase 32 übernimmt deshalb ausdrücklich die realen Anteile von
  Phase-23-`AC-05` bis `AC-09` und `AC-12`: Provider-Sandbox,
  Stagingdeploy/-rollback, Pager/On-call, automatischer Backup-Lifecycle,
  genehmigte SLO/RPO/RTO und Bindung an den deployten Artefaktdigest. Ein
  lokaler Phase-23-Pass darf keines dieser G4-Gates ersetzen.
- Deshalb lautet der aktuelle Phase-32-Status ehrlich `UNVERIFIED /
  DISABLED`.

### 4. Findings und Requirements

Alle Findings sind beim Start von Phase 32 `UNVERIFIED` und müssen einzeln
re-auditiert werden:

`STH-001`, `STH-002`, `STH-003`, `STH-004`, `STH-005`, `STH-006`,
`STH-007`, `STH-008`, `STH-009`, `STH-010`, `STH-011`, `STH-012`,
`STH-013`, `STH-014`, `STH-015`, `STH-016`, `STH-017`, `STH-018`,
`STH-019`, `STH-020`, `STH-021`, `STH-022`, `STH-023`, `STH-024`,
`STH-025`, `STH-026`, `STH-027`, `STH-028`, `STH-029`, `STH-030`,
`STH-031`, `STH-032`, `STH-033`, `STH-034`, `STH-035`, `STH-036`,
`STH-037`.

Zulässige Endstatus sind ausschliesslich `CLOSED`, `EXTERNAL`,
`DEFERRED / MONITORED` oder `DISABLED`. `EXTERNAL` braucht Owner, Dokument,
Datum, Gültigkeitsbereich und sichere technische Deaktivierung bis zur
Freigabe. `DEFERRED / MONITORED` ist nur für triggerbasierte P3-Arbeit mit
Istwert, Trigger, Alert, Owner und Reviewdatum zulässig. `DISABLED` braucht
serverseitiges Gate und Negativtest. Für die Zielklasse offene P0/P1-Findings
blockieren G4.

Zusätzlich gelten alle normativen `REQ-*` aus
`requirements-matrix.md`, die Traceability aus
`remediation-traceability.md`, `STH-029` (Governance/Präzedenz/Testvertrag)
und folgende lokale Requirements:

- `REQ-REL-032-001`: 37-Zeilen-Findingsledger mit direkter Evidence;
- `REQ-REL-032-002`: sechs maschinenprüfbare Launchklassen;
- `REQ-REL-032-003`: exact Commit→Build→Digest→Deploy→Walkthrough;
- `REQ-REL-032-004`: kein Skip/Retry/Evidence-Reuse über andere Artefakte;
- `REQ-REL-032-005`: G4-Manifest, Approval und sicherer Rollback.

### 5. In Scope

- Clean Clone, deterministische Installation, Env-Validierung, leere DB,
  Baseline-Upgrade, Migration, Backfill, Seed/Testfixtures und Restore.
- Lint, Typecheck, Unit, PostgreSQL-Integration, Contract, Security,
  Provider/Worker, HTTP/HSTS, Browser, Accessibility, Performance und Load.
- Cross-role-/Tenant-/Owner-/Persona-/Step-up-/Break-glass-Negativfälle.
- Identity, Jobs, Search, Alerts, Applications, Documents, Messages,
  Notifications, Privacy, Company Trust, Talent Radar, optional Phase 27/28,
  Billing/Finance, Import und Commercial Delivery gemäss Zielklasse.
- Provider-/Queue-/Workerfailure, Retry/DLQ/Replay, Pager, Backup/Restore,
  Rollback/Roll-forward, RPO/RTO und Incident Drill.
- Manueller Rollen-, Mobile-, Keyboard- und Screenreader-Walkthrough auf
  exakt dem deployten G4-Artefakt.
- Finale 37-Findings-, Requirements-, Route/Role-, Evidence-, Flag-,
  Provider-, Migration- und Launchklassen-Manifeste.

### 6. Out of Scope und deaktivierte Nachbarfunktionen

- Keine neue fachliche Runtime-Funktion, opportunistisches Refactoring oder
  Audit-Fix nach Freeze. Ein Defekt geht zurück an seine Owning-Phase; danach
  beginnt G4 auf einem neuen Commit vollständig neu.
- Keine Übernahme historischer Häkchen, lokaler Runs, Screenshots oder
  externer Freigaben ohne Commit-/Digest-/Environmentbindung.
- Keine höhere Launchklasse durch „fast grün“, manuellen Waiver oder
  nicht ausgelösten Test.
- Phase 27 ist nur Pflicht, wenn Multi-Persona öffentlich/vertraglich
  versprochen wird. Sonst bleibt sie disabled.
- Phase 28 ist nur Pflicht, wenn externer Bewerbungs-Tracker oder Scheduler
  öffentlich/vertraglich versprochen wird. Interne Applications bleiben
  unabhängig und müssen in ihrer Owning-Phase funktionieren.
- Salary, SSO/API, Success Fee und andere externe/bedingte Funktionen bleiben
  ohne eigene Freigabe disabled/noindex und dürfen die Zielklasse nicht
  vortäuschen.

### 7. Rollen und Owner

Release Owner führt G4, kann aber Findings nicht selbst fachlich freigeben.
Security, Privacy/DPO, Legal/AVG, Tax/Finance, Trust/Fraud, Product/Search,
Accessibility, Database/SRE, Support/Ops und Provider Owner signieren ihren
Scope. Public, Candidate, Employer Owner, Recruiter, alle Adminpersonas und
Systemworker besitzen getrennte Testidentitäten. Deployment und Evidence
Approval folgen Separation of Duties; Break-glass wird von einer unabhängigen
Person reviewt.

### 8. Portale, Routen, Services, Provider und Worker

Das gesamte Repository und alle Zielumgebungs-Consumer sind in Scope:
Public/SEO/Legal, Candidate, Employer, Recruiter, Admin, Support/Ops, APIs,
Server Actions, Webhooks, Storage, E-Mail, Identity, Payment, Queue/Worker,
Cron/Scheduler, Monitoring/Pager, Backup/Restore und Deployment. Inventar und
Route-/Role-Matrix werden gegen den eingefrorenen Commit erzeugt; unerfasste
Routen, Jobs, Queues, Provider oder Kill Switches blockieren G4.

### 9. Datenmodell, Constraints, Indizes und Klassifikation

Phase 32 fügt **kein fachliches Schema** hinzu. Geplant ist ein
maschinenlesbares Release-/Evidence-Manifest als Build-/CI-Artefakt mit:
Commit SHA, Tree SHA, Lockfiledigest, Migrationstand, Schemafingerprint,
Artefakt-/Containerdigest, SBOMdigest, Envklasse, Provider-/Flag-/Launchklasse,
Testreportdigests, Findingsstatus, Approver und Zeitfenster.
PII/Secrets/Backups/Paymentdaten dürfen darin nicht enthalten sein.
Constraints, Indizes, Klassifikation und Retention werden aus den Owning-
Phasen geprüft; ein fehlender Backstop wird dort behoben.

### 10. Expand–Migrate–Contract und Backfill

- Frische DB: alle produktiven Migrationen genau einmal, danach Schema-/
  Constraint-/Indexvergleich.
- Upgrade: unterstützte Baseline→Release mit realistischem, anonymem Fixture;
  Expand, resumable Backfill, Dual-Read/-Write und Contract gemäss Owning-
  Phase.
- Rollback: App/Worker/Flag/Provider und nur zulässige DB-Schritte; irreversible
  Migration braucht getesteten roll-forward/compatibility window.
- Restore: isoliertes Ziel, Allowlist, Checksums, Tenant-/PII-Kontrollen,
  gemessenes RPO/RTO. Restore-Daten werden nicht in Productiontestzugriffe
  geleakt.
- Jeder Auditfix erzeugt neuen Commit/Digest und invalidiert alle vorherigen
  G4-Ergebnisse.

### 11. Serverlogik, Queue, Provider und G4-Orchestrierung

- Ein geplanter `scripts/phase32-release-gate.ts` erweitert
  `npm run test:release`, erzeugt den Kandidatendigest, startet Pflichtsuiten,
  lehnt Skip/Retry/fehlende Reports ab und vergleicht Commit/Digest vor und
  nach jedem Schritt.
- Provider-Contracttests nutzen explizite Fake/Sandbox/Live-Klassen. Live ist
  nur in der Zielklasse und mit schriftlicher Freigabe erlaubt.
- Worker-/Queue-Evidence umfasst enqueue→claim→lease→retry→DLQ→Replay,
  Idempotency, Outbox, Concurrent Worker, Poison Message und Pager.
- Releasepolicy wertet Findings, Phasen, externe Gates, Trigger und
  serverseitige Flags gegen genau eine beantragte Launchklasse aus.
- Deploy referenziert nur das gespeicherte Digestartefakt; kein Rebuild in
  Staging/Production. Smoke und Walkthrough lesen SHA/Digest aus der Runtime.

### 12. Vollständige UX-Zustandsmatrix

Alle zielrelevanten Journeys prüfen Loading/Skeleton, Empty, Locked/Not
eligible, Pending/Verification/Review/Payment/Delivery, Error, Retry,
Rate-limited, Conflict/Stale version, Offline/Provider unavailable, Partial
failure, Cancelled, Expired/Revoked/Stale, Refunded/Reversed und Success.
Fehler dürfen keine falsche Erfolgscopy oder Endlosschleife erzeugen. Admin-
und Supportqueues zeigen Assignee, Bereich, SLA, Severity und erlaubte Action.
Demo-/Research-/Sandbox-/Livezustand ist sichtbar und widerspruchsfrei.

### 13. Mobile und Accessibility

29B-Evidence umfasst Chromium, Firefox und WebKit auf Desktop sowie 320/360 px
Mobile, Keyboard-only, Zoom/Reflow, Reduced Motion, Focus/Dialogs, Screenreader
und serious/critical automatisierte Regeln. NVDA/Windows und VoiceOver/iOS
werden auf den vereinbarten Kernreisen manuell geprüft. G4 dokumentiert
Task-Success, Zeit, Fehler, Abbruch und Verständnis aus 29A/29B; ein
automatisierter Axe-Lauf ersetzt keinen Screenreader-/Tasktest.

### 14. Authentisierung, Step-up, Autorisierung und Tenant

Anonymous, Candidate, Employer Owner, Recruiter, Billing Persona,
Adminpersonas, Support/Ops und Systemcredential werden positiv und negativ
geprüft. Phase-25-Capabilities, MFA, Non-Admin-Step-up aus `STH-030`,
Separation of Duties, Session-/Recovery-/Revocation und Break-glass gelten.
Jede resource-bearing Route/Action testet foreign owner, foreign tenant,
wrong persona, missing capability, stale session und tampered ID/Cursor.
Admin-/Supportzugriff auf reale PII bleibt ohne vollständige Phase 25
deaktiviert.

### 15. Datenschutz, Retention, Export, Löschung und Audit

Privacy Export/Correct/Delete, Eligibility-Loss, Consent/Opt-out, Retention,
Legal Hold, Tombstone, Dokument-/Object-Storage-Löschung und Restore-
Nichtwiederbelebung werden end-to-end geprüft. Audit ist append-only,
deny-by-default, redigiert und korreliert; Logs, Traces, Analytics, DLQ,
Evidence, Screenshots und SBOM werden auf Secrets/PII gescannt. Testidentitäten
und Restorefixtures besitzen dokumentierte Löschung. Jede externe Freigabe
nennt Zweck, Scope, Land/Provider, DPA und Ablaufdatum.

### 16. Abuse-, Fraud-, ATO- und Missbrauchsszenarien

`STH-031` wird mit Signup-/Verification-Fraud, Account Takeover,
Session-/Reset-Missbrauch, fake/übernommener Company, Scam-/Duplicate-/stale
Jobs, Credential Stuffing, Rate-Limit-Bypass, Cross-tenant IDOR, Radar
Scraping/Harassment, Message-/Attachment-Abuse, Payment-/Refund-Fraud,
Webhook Replay, Import Injection, Admin Privilege Escalation und Queue Poison
Messages geprüft. Detection, Step-up/Hold, Human Review, Appeal, Audit,
Notification und Incident Owner müssen zusammen funktionieren.

### 17. Externe und organisatorische Voraussetzungen

- Schriftliche, flowspezifische Legal-/Privacy-/AVG-/Tax-/Finance-/DPA-/
  Providerfreigaben für die beantragte Klasse; keine generische Freigabe.
- Benannte Product-, Security-, DPO-, Trust/Fraud-, Finance-, SRE-, Support-,
  Accessibility- und Incident-Owner samt Vertretung.
- Kontrollierte Providerkonten, Domains/DNS, Mailauthentisierung,
  Paymentwebhooks, Storage, Monitoring/Pager und Backupziel.
- Reale Operationskapazität und Servicezeiten aus `STH-034`; Paid-Recovery
  aus `STH-035`; WTP aus `STH-037`.
- Freigegebene Candidate-/Employer-Testteilnehmende und Löschplan für
  kontrollierte Real-Data-Tests.

### 18. Harte Abhängigkeiten und sechs Launchklassen

| Klasse | Zulässiger Scope | Zwingende Gates |
|---|---|---|
| **LC1 — Lokale kontrollierte Demo** | nur lokal/isoliert, sichtbare Mocks/Seeds, keine realen PII, Provider oder Geldversprechen | Phase 19 Baseline/Governance, sichere Demo-Klassifikation, keine öffentliche Indexierung/Acquisition; Runtime-Mocks sichtbar |
| **LC2 — Beaufsichtigter Design-Partner** | einzelne vorab benannte Teilnehmer, Operator begleitet jeden Flow, keine öffentliche Verfügbarkeit | LC1 plus flowspezifische Legal/Privacy/AVG/Tax-Freigabe, Consent/DPA, Incident Owner, Support/Operator, Löschung; nur die tatsächlich genutzten Provider/Phasen |
| **LC3 — Invite-only Pilot** | geschlossene Kohorte mit realen Providern und ggf. realen Applications, kein öffentlicher Self-serve-Vertrieb | LC2 plus Phasen 20–23 und 25 für genutzte Flows, Trust/Fraud/Support/Operations; Phase 26 zwingend sobald reale Firmenvertrauenssignale/Jobs/Radar genutzt werden; 29B sowie 30A/30D für jeden sichtbaren Cluster |
| **LC4 — Öffentlicher kostenloser Betrieb** | öffentliche Suche/Jobs/Firmen/Kandidatenflows, alle Kauf-CTAs geschlossen | LC3 plus Phasen 20–23, 25 und **26 zwingend** für Public Trust, reale Jobs/Firmen/Radar; Phase 29 vollständig, 30A/30D je sichtbarem Cluster, Retention/Support; Phase 27 nur bei Multi-Persona-Versprechen, Phase 28 nur bei Tracker-/Scheduler-Versprechen |
| **LC5 — Bezahlter Betrieb** | LC4 plus freigegebene bezahlte Offers | LC4 plus Phase 24 sowie 31A/31B: reale WTP, Tax/Invoice/Ledger/Reconciliation/Dunning, Capacity/Unit Cost/Cashflow und Paid-Service-Recovery; jedes Boost-/Radar-/Salary-Offer nur mit eigenem Gate |
| **LC6 — Breiter Production Launch** | breitere Akquisition/Skalierung im belegten Cluster; weitere Cluster weiterhin separat | LC5 plus SLO/SLI, RPO/RTO, Backup/Restore, On-call, Incident- und Capacitydrills; 30B/30C vollständig nur wenn ihre Trigger ausgelöst sind, sonst datiert `DEFERRED / MONITORED`; jeder neue Cluster braucht 30A/30D/31A neu |

Kein Klassenurteil impliziert die nächste Klasse. Phase 28 ist nicht pauschal
für interne Bewerbungen nötig; sie wird nur bei explizitem externem Tracker-/
Scheduler-Versprechen zwingend.

### 19. Geordnete Implementierungs- und Audit-Schritte

1. Zielklasse, Scope, Cluster, Personas, Provider, Offers und explizit
   deaktivierte Funktionen schriftlich einfrieren.
2. 37-Findingsledger und Requirements-/Route-/Role-/Provider-/Worker-/
   Flaginventar aus dem Kandidatencommit erzeugen.
3. Für jedes Finding Owning-Phase, Priorität, Zielklassenrelevanz, zulässigen
   Status und direkte Evidence prüfen; Blocker zurückweisen.
4. Alle externen Freigaben auf Scope, Datum, Owner und Gültigkeit prüfen.
5. Feature Freeze; Commit/Tree/Lockfile/Migration/SBOM/Artefaktdigests
   erzeugen und signieren.
6. Clean Clone, deterministische Installation, Env-/Secret-/Dependency-/
   License-/Supply-Chain-Gates.
7. Frische DB, Baseline-Upgrade, Backfill, Seedfixture, Rollback und isolierter
   Restore.
8. Unit, Integration/PostgreSQL, Contracts, Security, Provider/Worker,
   Build/HTTP/HSTS und Owning-Suites ohne Skip/Retry.
9. Performance/Load/Soak, Queue-/Providerfailure, Backup/Restore,
   RPO/RTO/Pager/Incident Drill.
10. Deployment **des gespeicherten Artefakts**, Runtime SHA/Digest prüfen,
    Smoke und Rollback/Redeploy.
11. Chromium/Firefox/WebKit, Mobile/A11y und vollständige Rollenjourneys.
12. Manueller Walkthrough mit Console/Network/Audit auf demselben Deployment.
13. Evidence digests ins G4-Manifest binden; unabhängige Approver signieren.
14. G4 erteilt genau eine Launchklasse oder `NO-GO`. Jede Änderung danach
    startet ab Schritt 2 mit neuem Commit.

### 20. Feature-Flags, Kill Switch und Aktivierung

G4 inventarisiert jeden Flag mit Default, Environment, Owner, Ablaufdatum,
Cohort, Abhängigkeit und Kill Switch. Unbelegte Funktionen sind serverseitig
off; versteckte UI allein reicht nicht. Provider-Live, Public Indexing,
Applications, Company Trust, Radar, Phase 27/28, Paid Offers, Import Sync,
Salary und jeder Cluster besitzen getrennte Gates. G4 verändert Flags nicht
ad hoc: Die beantragte Konfiguration ist Teil des signierten Manifests.
Rollback schliesst Public/Paid/Provider zuerst fail-closed und bewahrt
gesetzliche, finanzielle und Supportpflichten.

### 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

- `AC-32-01`: alle 37 Findings besitzen zulässigen Status und direkte Evidence.
- `AC-32-02`: genau eine Launchklasse wird maschinenprüfbar bewertet.
- `AC-32-03`: LC1 verhindert reale PII/Provider/Geld.
- `AC-32-04`: LC2 erzwingt beaufsichtigte, flowspezifisch freigegebene Tests.
- `AC-32-05`: LC3 erzwingt Provider-, Trust-, Fraud- und Supportgates.
- `AC-32-06`: LC4 erzwingt Phase 26 und schliesst alle Kauf-CTAs.
- `AC-32-07`: LC5 erzwingt Phase 24/31 und Paid-Service-Recovery.
- `AC-32-08`: LC6 erzwingt Operations und triggerbasierte 30B/30C-Evidence.
- `AC-32-09`: Migration, Restore und Rollback sind reproduzierbar.
- `AC-32-10`: Security/Privacy/Provider/Worker-Failure sind grün.
- `AC-32-11`: drei Browser, Mobile, A11y und Rollenjourneys sind grün.
- `AC-32-12`: Commit, Artefakt, Deployment, Walkthrough und Evidence stimmen.

| Criterion / Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC-32-01 / STH-001–037, REQ-REL-032-001 | P0 | Unit/Contract + manuell | Ledger mit 37 eindeutigen IDs | jede ID hat Owner/Status/Evidence/Scope | fehlend, doppelt, `DONE` ohne Evidence, expired external, P3 ohne Trigger | Release/Audit Owner | Plan/Evidence | alle 37 Findingrecords | Clean Clone/CI | `npx vitest run --config vitest.config.ts tests/unit/release/phase32-findings-ledger.test.ts`; danach jede Evidence-URI öffnen, Digest/Commit/Datum/Owner gegen Manifest prüfen | IDs exakt 37; zulässiger Status 37/37; targetklassige offene P0/P1 = 0; dangling Evidence = 0 | Findingsledger + Validatorreport | Release Owner + Finding Owner | PLANNED |
| AC-32-02 / REQ-REL-032-002 | P0 | Unit/Policy | LC1–LC6 und requested scope | genau eine höchste zulässige Klasse | Überspringen einer Klasse, Mischklasse, unbekannter Scope/Flag | Release Owner | Release Policy | sechs positive + boundary fixtures | CI | `npx vitest run --config vitest.config.ts tests/unit/release/phase32-launch-class-policy.test.ts` | 6/6 positive; jede fehlende Pflichtdependency senkt/stoppt deterministisch; exakt ein Urteil | JUnit + decision JSON | Release Engineering | PLANNED |
| AC-32-03 / LC1 | P0 | Security/HTTP/E2E | lokale Demo mit Seeds/Mocks | sichtbare DEMO, keine externen Calls | echte E-Mail/Storage/Payment, reale PII, Indexierung, Productionclaim | Demo Operator | alle Portale | synthetische Seedidentitäten | isoliert/lokal | `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-lc1-isolation-postgres.test.ts && npm run test:e2e:http` | externe Provider calls = 0; reale PII canaries = 0; robots/indexing off; DEMO label auf allen Claims | Network/DB/HTTP report | Security + Product | PLANNED |
| AC-32-04 / LC2 | P0 | Contract + manueller Drill | ein beaufsichtigter Design-Partner-Flow | alle scopespezifischen Approvals/Operator/Deletion vorhanden | unbegleiteter Zugriff, fehlende AVG/Tax/DPA/Consent, nicht gelöschte Testdaten | Design Partner/Operator | gewählter Flow | allowlisted Identitäten | kontrolliertes Staging | `npx vitest run --config vitest.config.ts tests/unit/release/phase32-external-gates.test.ts`; manuell: Identität allowlisten→Consent/Approval-Digests prüfen→Operator startet Flow→Incidentkontakt testen→Flow beenden→Export/Löschung→Storage/DB/Audit verifizieren | unvollständiges Gate: 0 Sessions; vollständiger Flow: 1; Testpersonen nach Frist in DB/Storage 0 ausser zulässiger Tombstone/Audit | Approvalbundle + Drill-/Deletionreport | Research + DPO/Legal | PLANNED |
| AC-32-05 / LC3 | P0 | PostgreSQL + Provider/Failure + E2E | invite-only reale Provider/Applications | Trust/Fraud/Support/30A/30D passend grün | unverified company, scam/stale job, provider timeout, no incident owner, fremder Invite | Candidate/Employer/Support | Pilotportale/Provider | invite cohort, fraud/failure fixtures | Staging/Sandbox | `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-lc3-pilot-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase32-lc3-pilot.spec.ts --project=chromium-journeys` | public self-serve = 0; foreign invite = 0; bei Firmenvertrauen Phase-26-Gate 100 %; sichtbare Jobs/Search haben 30A/30D | DB/provider/audit + Playwright | Pilot + Trust/Ops | PLANNED |
| AC-32-06 / LC4 | P0 | Policy + HTTP + 3-Browser E2E | öffentlicher kostenloser Betrieb | Phase 20–23/25/26/29/30A/30D grün | Kauf-CTA, ungeprüfte Firma, stale job, öffentlicher ungegateter Cluster, Phase28-Claim ohne Gate | Public/Candidate/Employer | Public/Free flows | public cluster, six personas | release-like | `npx vitest run --config vitest.config.ts tests/unit/release/phase32-lc4-public-free.test.ts && npm run test:e2e:http && npm run test:e2e:browser` | Kauf-/Checkout-CTA und Paid API = 0; Phase 26 zwingend; 30A/30D je visible cluster; Phase27/28 nur bei Promise sonst off | Policy/HTTP/Browser reports | Product + Trust + Release | PLANNED |
| AC-32-07 / LC5, STH-035/037 | P0 | PostgreSQL + Provider + E2E | reales freigegebenes Offer→Pay→Deliver→Recover/Reconcile | Phase24/31 und Tax/Recovery vollständig | Testmode als WTP, duplicate webhook, delivery failure ohne Remedy, dunning/refund drift | Employer/Finance/Support | Billing/Offer Delivery | paid sandbox/live-authorized fixtures | Staging + freigegebener Provider | `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-lc5-paid-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase32-lc5-paid.spec.ts --project=chromium-journeys` | Ledger/Provider/Invoice/Reconcile diff = 0; duplicate effect = 0; jeder Failurecode genau eine Policyremedy; echte 31A WTP-Evidence vorhanden | Provider receipts + Ledger/Recovery/E2E | Finance + Support + Release | PLANNED |
| AC-32-08 / LC6, STH-020/021/027/034 | P0/P3 Trigger | Load/Soak + Ops Drill | breiter belegter Cluster, Queue/Search/Sitemap-Headroom | SLO/Capacity/RPO/RTO/On-call und ausgelöste Tracks grün | 30B/30C unter Trigger fälschlich Pflicht oder über Trigger nur deferred; Pager/restore fail | SRE/Ops | App/DB/Queue/SEO | peak+2×, >250, optional >50k | production-like isoliert | `npx vitest run --config vitest.performance.config.ts tests/performance/phase32-lc6-capacity.test.ts`; manuell 24h-Soak→Provider/Worker/DB-Ausfall→Pager→Restore→Rollback; 30B/30C-Istwert/Trigger/Forecast prüfen | SLO-Burn innerhalb Budget; Utilization ≤80 %; RPO/RTO ≤ freigegebenes Ziel; ausgelöster Track 100 % umgesetzt, sonst aktuelles Monitored-Record | Load/Soak/Pager/Restore/Capacity bundle | SRE + DB/SEO/Ops | PLANNED |
| AC-32-09 / REQ-DATA-001 | P0 | Migration/Restore | fresh + supported baseline upgrade | deterministisches Schema/Daten/Checksums | partial backfill, orphan, lock over budget, rollback reanimiert gelöschte Daten | System/DBA | PostgreSQL/Storage | empty + anonymized baseline | PostgreSQL 16 isoliert | `npm run db:validate && npm run db:migrate && npm run db:migrate:status && npm run db:smoke && npm run seed:verify && npm run ops:backup && npm run ops:restore`; zusätzlich `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-upgrade-restore-postgres.test.ts` | Exit 0; Schema-/Row-/Checksumdiff 0; Orphans/foreign canaries 0; RPO/RTO gemessen; deleted data nicht restored-public | Migration/DB/backup/restore report | DB/SRE + Privacy | PLANNED |
| AC-32-10 / STH-030/031, REQ-SEC-001/002 | P0 | Security/PostgreSQL | Rollen×Tenant×Owner×Step-up×ATO/Fraud-Matrix | erlaubte Capability genau | missing/wrong role, foreign tenant/owner, stale MFA, break-glass abuse, webhook replay | alle Rollen/System | alle Mutations/Reads | canary tenants, ATO/fraud corpus | CI/PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-security-matrix-postgres.test.ts && npm run security:release-scan` | Denialmatrix 100 %; denied writes/leaks 0; Step-up required 100 %; Secrets/PII findings 0 | Matrix/JUnit/Audit/scan | Security | PLANNED |
| AC-32-10 / REQ-INT-002, REQ-NOT-001, REQ-DOC-002, REQ-OPS-005, REQ-PAY-001 | P0 LC3+ | Contract/Failure | Identity/Email/Storage/Payment/Worker Failure | Retry/DLQ/Replay/Alert/Compensation | timeout, 4xx/5xx, duplicate/out-of-order, poison, lost lease, provider drift | System/Ops | Provider/Queue/Worker | contract + chaos fixtures | sandbox/staging | `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-provider-worker-failure-postgres.test.ts` | keine Doppelwirkung; terminaler Fehler in DLQ/Support; Pager innerhalb SLO; Replay genau einmal | Contract/queue/audit/pager report | Provider + Ops | PLANNED |
| AC-32-10 / REQ-PRIV-004, REQ-DOC-002, REQ-NOT-001 | P0 Real data | PostgreSQL + E2E | Export→Correct/Delete→Restore | vollständige Notification/Evidence/Erasure | oversize, foreign tenant, legal hold bypass, deleted object returns after restore | Candidate/Employer/DPO | Privacy/Storage/Notifications | PII canaries/docs/holds | isolated staging | `npx vitest run --config vitest.integration.config.ts tests/integration/release/phase32-privacy-lifecycle-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase32-privacy.spec.ts --project=chromium-journeys` | Export vollständig/owner-only; oversize fail-safe; delete DB+Storage gemäss Policy; restore reactivation 0; Notification 1 | Export manifest + DB/storage diff + Audit | Privacy/DPO | PLANNED |
| AC-32-11 / STH-033, REQ-QA-001/002 | P0 LC3+ | Browser/A11y + moderiert | Kernreisen in 3 Engines/360 px/Keyboard/SR | alle vereinbarten Tasks verständlich/bedienbar | focus trap, clipped CTA, silent error, falsches Trust-/Paid-Verständnis, Abbruch | Public/Candidate/Employer/Admin/Support | alle Zielportale | Phase29 Taskscript/Personas | deployed candidate | `npm run test:e2e:list && npm run test:e2e:browser`; manuell exakt Phase-29-Script auf Runtime-Digest mit NVDA/Windows und VoiceOver/iOS ausführen | Chromium/Firefox/WebKit Fail/Skip/Retry 0; serious/critical A11y 0; Task-Success ≥80 %, kritisches Verständnis 100 %, Zeiten/Errors/Abandon dokumentiert | Playwright/Axe + moderated/SR evidence | QA + Accessibility/UX | PLANNED |
| AC-32-12 / STH-024, REQ-REL-032-003/004/005 | P0 G4 | Release/Attestation + manuell | freeze→build→digest→deploy→walkthrough | überall gleiche SHA/Digests | rebuild, dirty tree, test/walkthrough anderer Commit, Fix nach Run, missing report | Release Owner + unabhängige Approver | CI/Artifact/Deployment | immutable release candidate | clean CI + target environment | `npm ci && npm run plan:audit && npm run route:audit && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e:http && npm run test:e2e:hsts && npm run test:e2e:browser && npm run license:audit && npm run security:release-scan && npm run test:release`; danach Runtime `/version`/Manifest-SHA+DIGEST gegen gespeichertes Artefakt vergleichen und 10 Kernreisen manuell protokollieren | alle Exit 0; Fail/Skip/Retry 0; dirty diff 0; Commit/Tree/Lock/Migration/Artifact/Runtime/Evidence-Digest exakt gleich; Approvals vollständig | signiertes G4-Manifest + Reports + Walkthrough | Release Owner + Security/Product/Ops | PLANNED |

### 22. Performance-, Skalierungs-, SLO-, RPO- und RTO-Grenzen

G4 verwendet pro Zielklasse vorab eingefrorene p50/p95/p99-, Error-, Queue-,
Worker-, Provider-, Search-, DB- und Browserbudgets aus den Owning-Phasen.
LC6 testet vereinbarte Peaklast plus 2×-Burst, mindestens 24 Stunden Soak und
SLO-Burn. Operationskapazität bleibt ≤80 % planbar. RPO/RTO werden nicht als
Planwert abgehakt, sondern durch Backup-/Restore-/Incident-Drill gemessen.
30B/30C werden gegen aktuellen Count/Bytes/p95/Forecast entschieden: unter
Trigger `DEFERRED / MONITORED`, ab Trigger vollständige technische Evidence.
Ein fehlendes eingefrorenes Budget ist ein rotes Gate, kein Freipass.

### 23. Geschützte Phase-01–18-Invarianten

Alle früheren Owning-Tests bleiben grün: Public Eligibility und Ranking vor
Pagination, Candidate Ownership/Privacy, Company-/Jobmoderation, Tenant- und
Persona-Isolation, Admin Least Privilege, Audit deny-by-default, immutable
Ledger, Payment/Webhook-Idempotency, Radar Opt-in/Accept/Reveal/Widerruf,
Internal Application, Document-/Storagekontrolle, Notification-Dedupe,
Workerretry/DLQ/Replay, Search/Alert/Recommendation-Parität,
Sitemap-no-truncation, Demo/Production-Trennung und keine Fake Actions.

### 24. Rollback / Roll-forward

Vor G4 existiert ein getesteter App-, Worker-, DB-, Provider-, Flag-, DNS- und
Queue-Rollback mit Stopkriterien, Owner und maximalem Zeitfenster.
Irreversible Datenmigrationen nutzen Compatibility Window und Roll-forward.
Rollback darf keine bezahlten Rechte, Audit-, Retention-, Legal-Hold- oder
Privacy-Pflichten verletzen und keine stale/revoked/gelöschte Ressource
reaktivieren. Ein rotes Gate ergibt `NO-GO`; es wird in der Owning-Phase
behoben. Neuer Commit bedeutet vollständiger neuer G4-Lauf.

### 25. Evidence

Signiertes G4-Manifest mit Commit/Tree/Lockfile/Migration/Schema/Artifact/
Runtime/SBOM-Digests; 37-Findingsledger; Requirements-/Route-/Role-/Provider-/
Worker-/Flaginventar; externe Approvalbundles; Clean-clone-/Migration-/
Restore-/Security-/License-/Test-/Coverage-/Performance-/Browser-/A11y-/
Provider-/Queue-/Pager-/Incidentreports; Runtime-Screenshots/Console/Network/
Audit des manuellen Walkthroughs; Rollback-/Redeploy-Nachweis und finale
Launchklassenentscheidung.

### 26. Definition of Done

- `STH-001`–`STH-037` sind 37/37 einzeln klassifiziert und direkt belegt.
- Genau eine beantragte Launchklasse erfüllt jede Pflichtzeile; höhere Klassen
  bleiben ausdrücklich `NOT APPROVED`.
- Phase 26 ist für LC4/Public Trust zwingend; Phase 28 nur bei versprochenem
  Tracker/Scheduler; Phase 27 nur bei Multi-Persona-Scope.
- Für LC5 sind Phase 24 und 31 inklusive WTP, Tax, Reconciliation, Dunning,
  Capacity und Paid-Service-Recovery grün.
- Full Suite, Provider-/Workerfailure, Security/Privacy, drei Browser,
  Mobile/A11y, Performance und Operationsdrills sind ohne Skip/Retry grün.
- Manueller Walkthrough, automatisierte Reports, Deployment und Approval
  referenzieren exakt Commit und Artefaktdigest des signierten G4-Manifests.
- Kein P0/P1 der Zielklasse und keine unbekannte Route/Queue/Provider/
  Featureflag bleibt offen.

### 27. Folgephasen- und Aktivierungsgate

Erst ein signiertes G4-Urteil erlaubt die im Manifest definierte Zielklasse.
Deployment/Flagänderung/Providerwechsel/Migration/Scope-, Cluster-, Price-,
Policy- oder Evidenceänderung nach G4 invalidiert das Urteil und verlangt
mindestens den betroffenen Gate- plus finalen G4-Neulauf. Ein zusätzlicher
Cluster startet erneut bei 31A/30A/30D; ein neues bezahltes Offer bei
31A/31B/24; ein neu versprochener Tracker/Scheduler bei Phase 28. Production
bleibt ohne ausdrücklich freigegebene Klasse disabled.

### 28. Ausdrücklich nicht bewiesen

Ein grünes G4 beweist nur die genannte Klasse, den genannten Scope, Commit,
Digest, Provider-, Cluster- und Evidence-Stand. Es beweist keinen
Product-Market-Fit, nationale Skalierbarkeit, künftige Providerverfügbarkeit,
Rechtsbeständigkeit, Finanzierung oder neue Cluster/Offers. LC1/LC2 beweisen
keine Public Readiness, LC3 keine öffentliche Skalierung, LC4 keine
Zahlungsbereitschaft, LC5 keine breite Skalierung. Unter Trigger deferred
30B/30C sind nicht implementiert; die technisch vorhandenen, aber
deaktivierten Phase-27/28-Verträge sowie Salary-/SSO-/Success-Fee-Funktionen
sind keiner Launchkohorte geliefert.

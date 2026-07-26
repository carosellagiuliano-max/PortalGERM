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
> Implementierungen; nur `STH-029` ist durch die verlinkte Phase-19-Evidence
> geschlossen. Es erteilt keine Go-live-Freigabe.

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
Phase 18. Keine offene Phase und kein offener Test wird hier als erledigt
markiert. Zeilenanker beziehen sich auf die geprüfte Baseline und müssen bei
Codeverschiebungen im jeweiligen Phasenabschluss aktualisiert werden.
Technischer Phasenabschluss und LIVE-Aktivierung sind getrennt: Ein
implementierter Handler oder Adapter darf als technisch belegt gelten, während
ein späteres Operations-, Admin-, Legal-, Provider- oder Markt-Gate den
Realmodus weiterhin fail-closed hält. Die Details stehen in
[`remediation-masterplan.md`](./remediation-masterplan.md) §1.3.

## 2. Zentrale Traceability-Matrix

| ID | Kurzbeschreibung | Unabhängiger Status | Neu eingeordnete Priorität | Bereich | Verantwortliche Phase | Abhängigkeiten | Implementierungsstatus | Teststatus auf Baseline | Aktuelle Fundstelle / Evidence | Externer Blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| STH-001 | Keine E-Mail-Verifikation | bestätigt | P0 vor personenbezogenem LIVE-Betrieb | Identity/E-Mail | 20 | 19, Provider- und Outbox-Entscheid | offen; `emailVerifiedAt` existiert, Workflow fehlt | Auth-Tests vorhanden, kein Verify-Flow | `prisma/schema.prisma:1129-1158`; `lib/auth/auth-service.ts:243-259,420-437` | Absenderdomain, DPA, Zustellprovider |
| STH-002 | Privacy-Identitätschallenge für normale Registrierungen unerreichbar | bestätigt; Challenge selbst ist implementiert | P0 | Privacy/Identity | 20 | STH-001, STH-013 | offen; Passwort-Challenge vorhanden, Verifikationsprädikat blockiert | Challenge-Tests stark, kein Registration→Verify→Privacy-E2E | `app/candidate/privacy/requests/[id]/verify/page.tsx:21-45`; `lib/privacy/privacy-case-service.ts:642-652` | wie STH-001 |
| STH-003 | CV nur als Metadaten, keine nutzbaren Bytes | bestätigt; bewusstes Mock-Verhalten | P0 vor realer Bewerbung | Dokumente/Storage | 21 | 19, STH-004, Malware-/Retention-Entscheid | offen; Metadatenmodell und Port vorhanden | Mock-Storage-/Profiltests vorhanden, kein realer Upload/Download | `lib/providers/storage/mock-storage-provider.ts:56-107`; `lib/candidate/profile.ts:336-376` | Storage-Region/DPA, Scanner, Retention |
| STH-004 | Produktive externe Provider fehlen | bestätigt; historisch bewusst deferred | P0-Programm, je Provider separat | Provider | 20/21/23/24, Lead 23 | 19 sowie Legal, Secrets, Monitoring | offen; Ports/Mocks vorhanden | No-network-/Mock-Tests, keine Provider-Contract-Suites | `codex-plan/decisions.md:156-177`; `lib/config/env-schema.ts:237-243` | Providerwahl, DPA, Zugänge, Budget |
| STH-005 | Keine reale Zahlung/Billing-Abwicklung | bestätigt; Mock-Billing fachlich umfangreich | P0 für Paid Self-Service | Billing/Finance | 24 | 19, STH-004, Worker, Tax/Legal, früher Phase-31A-Go/No-go | offen; Orders/Invoices/Entitlements bleiben erhalten | starke Mock-/DB-Tests, keine Webhook/Reconciliation-E2E | `lib/providers/payments/index.ts:1-16`; `lib/providers/payments/stripe-payment-provider.ts:7-40`; `lib/billing/orders.ts:248-263` | PSP-Vertrag, Steuer-/Refund-/Dunning-Freigabe |
| STH-006 | Kein realer Datenexport und keine reale Löschung | bestätigt; Case-Orchestrierung ist vorhanden | P0 | Privacy/Legal | 22 | 19, STH-001/002, Storage, Retention-/Legal-Matrix | offen; Export ist Manifest, Delete ist Assessment | starke Case-/Manifesttests, bewusst kein Erasure-Test | `lib/privacy/export-mock.ts:15-20,99-102`; `lib/privacy/privacy-case-service.ts:842-890`; `tests/integration/privacy/privacy-case-service.test.ts:149-160,281-290` | Counsel, Aufbewahrungspflichten, Dateninventar |
| STH-007 | Keine öffentlichen Rechtsseiten/kanonischen Rechtstexte | bestätigt | P0 vor öffentlichem LIVE | Legal/Consent | 22 | 19, Counsel, STH-006/017/026 | offen; nur Notice-Identifier und Kurztexte | Consent-Hash-Tests vorhanden, keine Legal-Routen/Version-Regression | `components/shared/app-footer.tsx:5-26,68-84`; `lib/privacy/user-consent.ts:8-19`; `codex-plan/route-inventory.json:1-399` | freigegebene CH-Texte, AVG/DSG/AGB |
| STH-008 | Produktionsbetrieb extern/offen | externe Voraussetzung; lokale Runbooks vorhanden | P0 Go-live-Gate | Operations/Release | 23 | 19, Infrastruktur, STH-004/009 | offen; Preview/Staging/Production unverbunden | lokaler Release-/Recovery-Drill grün, kein Staging-Smoke | `codex-plan/runbooks/deployment.md:28-48,124-132`; `codex-plan/release-checklist.md:96-120` | Infrastruktur, Secrets, Pager/Owner, Backup-Lifecycle |
| STH-009 | Kein autonomer Worker | bestätigt | P0 für unbeaufsichtigten Self-Service | Worker/Outbox/Ops | 23 | 19, STH-013, Monitoring | offen; idempotente Runner existieren, Scheduler/Queue/DLQ fehlen | einzelne Runner getestet, kein Restart-/DLQ-Systemtest | `lib/candidate/job-alerts.ts:535`; `lib/jobs/effective-status.ts:95`; `lib/talentradar/contact-requests.ts:264`; `package.json:11-46` | Queue/Scheduler-Hosting, Alerting |
| STH-010 | Alle Admin-Capabilities hängen am globalen ADMIN | bestätigt; Capability-Namen sind gute Vorarbeit | P0 vor Admin-LIVE | Admin-RBAC | 25 | 19, Rollen-/Duties-Matrix | offen; jede Capability wird demselben Actor erteilt | Test beweist gerade die globale Vollmacht | `lib/admin/capabilities.ts:1-60`; `tests/unit/admin/phase11-policies.test.ts:29-47` | benannte Support/Moderation/Finance/Privacy-Owner |
| STH-011 | Kein Admin-MFA/Step-up | bestätigt | P0 vor privilegiertem LIVE-Zugriff | Admin Security | 25 | 19, STH-001/013, Identity-Provider-Entscheid | offen; Password+Session ohne zweiten Faktor | Session/Auth-Tests, keine MFA-/Recovery-/Step-up-Tests | `prisma/schema.prisma:1181-1208`; `lib/auth/route-guards.ts:18-23,39-55` | MFA-Verfahren, Recovery- und Supportprozess |
| STH-012 | Exklusive globale Rolle verhindert Multi-Persona | bestätigt | P3 default/deferred; P0 nur bei explizitem Persona-Scope | Identity/Persona | 27 | 19, STH-010/011, Tenant-RBAC, Bedarfsgate | offen; CompanyMembership löst nur Unternehmenskontext | Rollen-/Company-Tests vorhanden, keine Persona-Kombination | `prisma/schema.prisma:10-15,1129-1137`; `lib/auth/route-guards.ts:10-23`; `prisma/schema.prisma:1536-1555` | Produktentscheidung und moderierter Bedarf |
| STH-013 | Kein dauerhafter E-Mail-Outbox-/Retry-Vertrag | bestätigt | P0 | E-Mail/Worker | 20 | 19, STH-004/009 | offen; `EmailLog` ist Log, keine Lease-/Attempt-/DLQ-Queue | Idempotenz des Mocks getestet, keine Provider-Ausfallkette | `prisma/schema.prisma:596-601,2250-2264`; `lib/providers/email/mock-email-provider.ts:190-213` | Zustellprovider, Bounce/Suppression, Monitoring |
| STH-014 | Company Verification beruht auf Text/Referenz | bestätigt; Lifecycle selbst ist robust | P0 für Trust-/Publish-Gate | Company Trust | 26 | 19, STH-003/004, Legal/Operations | offen; keine Dokumentbytes/Registry-Validierung | Cycle-/Concurrency-Tests vorhanden, keine Evidenzvalidierung | `prisma/schema.prisma:1665-1699`; `components/employer/verification-panel.tsx:160-195`; `lib/employer/company.ts:1120-1144` | Registerzugang, Prüfpolicy, Reviewer |
| STH-015 | Externe Bewerbung endet beim Klick | bestätigt | P3 default/discovery; P0 nur wenn als Launchfunktion versprochen | Recruiting/Application | 28A | 19, 29A-Bedarf, STH-009/013/026, Phase-22-Privacy-Lifecycle | offen; nur Analytics-Klick, keine Candidate-owned Journey | Redirect/Privacy-Test vorhanden, kein Outcome-/Export/Delete/Correct-E2E | `app/(public)/jobs/actions.ts:92-110,251-278`; `lib/applications/service.ts:193-197` | moderierter Bedarf; optional ATS-/Mail-Signale |
| STH-016 | Keine persistente Interviewplanung | bestätigt | P3 default/discovery; P0 nur wenn als Launchfunktion versprochen | Recruiting/Scheduling | 28B | 19, 29A-Bedarf, STH-009/013, Application-RBAC, Phase-22-Privacy-Lifecycle | offen; Pipeline-Status/Mock-Text statt Termin | Status-Tests vorhanden, keine Slot/DST/ICS-/Privacy-Lifecycle-Tests | `prisma/schema.prisma:264-288`; `lib/policies/status/application.ts:105-113`; `lib/employer/applications.ts:328-335` | moderierter Bedarf; optional Kalenderprovider |
| STH-017 | Produktionsanalytics deaktiviert | teilweise bestätigt | P1; Legal-Gate vor Aktivierung | Analytics/Consent | 22 | 19, STH-007/026, Legal/Data Governance | offen; Product Analytics aus, essentielle Operations-LIVE-Ereignisse möglich | Runtime-Policy getestet, kein consentierter Production-E2E | `lib/analytics/runtime-policy.ts:8-35,39-56`; `lib/analytics/track.ts:55-58` | Consent-/DPA-/Retention-Freigabe |
| STH-018 | Marketplace-Liquidität unbewiesen | externe Voraussetzung; technische Gate-Mechanik vorhanden | P0 Markt-Gate | Marketplace/Go-to-market | 31 | 19, reale Kohorten/Analytics und STH-019-Evidence je Startcluster | kein generischer Codefix; LIVE-Evidence offen | Gate, Seed, Dual Approval und Revoke getestet; Search-Quality-Gate fehlt | `lib/seo/cluster-launch-policy.ts:3-15`; `prisma/schema.prisma:2918-2963`; `lib/admin/cluster-launch.ts:36-287` | reale Arbeitgeber/Kandidaten/Jobs/Responses und Fachreview der Suchmenge |
| STH-019 | Startcluster-Suche ohne gemeinsamen Berufs-/Ort-/Qualifikations-/Skill-/Branchenvertrag | bestätigt; normalisierte MVP-Suche vorhanden | P0 je aktivem LC3+-Cluster; P1 Design Partner, P2 Demo | Search | 30A | 19, versionierte Taxonomie, Pflege-/Engineering-Korpus, Golden-/Negativkorpus und Clusterfreigabe | offen; Search, Alert und Recommendations besitzen keinen gemeinsamen Konzeptvertrag | deterministische Basis-Tests, aber kein Startcluster-Recall-/Parity-Benchmark | `lib/search/relevance.ts:7-38`; `lib/jobs/public-read-model.ts:1412-1439`; `lib/candidate/job-alerts.ts:1444-1462`; `lib/candidate/dashboard.ts:318-386` | Fachreview je tatsächlich aktiviertem Cluster |
| STH-020 | Admin-Queues mit harten Caps | bestätigt | P1 vor hohem Betriebsvolumen | Admin Operations/Scale | 30B | 19, STH-010, Cursor-/Indexvertrag | offen | Bounded-read-Tests, keine >250-Erreichbarkeitsmatrix | `lib/admin/companies.ts:33-45`; `lib/admin/jobs.ts:68-79`; `lib/admin/users.ts:18-25`; `lib/admin/support.ts:99-103` | keine |
| STH-021 | Dashboard-Empfehlungen mit Query-Fan-out | bestätigt | P1 Performance | Candidate/DB Scale | 30B | 19, Batch-Read-/Rankingvertrag | offen | Ranking-/Read-Model-Tests, kein Query-Count-Ceiling | `lib/candidate/dashboard.ts:318-386` | keine |
| STH-022 | Business/Enterprise nur eingeschränkt lieferbar | teilweise bestätigt; bewusst gegatet | P1 nach WTP, XL je Integration | Monetization/Enterprise | 31 | 19, STH-004/009/024, Marktvalidierung | offen; Kernentitlements vorhanden, Integrationen fehlen | Release-/Grant-Tests vorhanden, bewusst kein ImportRun | `prisma/seed/fixtures/plans.ts:138-168,263-282`; `components/marketing/pricing-card.tsx:120-157`; `prisma/schema.prisma:3472-3528` | Design-Partner, SLA/DPA, Integrationszugänge |
| STH-023 | Browser-/Accessibility-Matrix unvollständig | teilweise bestätigt; Chromium-Breite vorhanden | P1 | UX/A11y/Browser | 29 | 19, CI-Browser, manuelle AT-Matrix | offen | Desktop/Mobile Chromium und Critical-Axe; Firefox/WebKit/Serious/AT fehlen | `playwright.config.ts:28-57`; `tests/e2e/fixtures/phase17-test.ts:155-175,224-260` | NVDA/VoiceOver-Geräte/Tester |
| STH-024 | Manueller Walkthrough nicht auf aktuellem Release-Commit | bestätigt | P0 Release-Gate | Release Evidence | 32 | alle Remediation-Phasen, sauberes Artefakt | offen; Walkthrough muss auf finalem Commit neu laufen | Automation auf neueren Commits, manueller Lauf auf Vorgänger | `BUILD_REPORT.md:3-19,141-165`; `codex-plan/evidence/2026-07-24-commercial-launch-follow-up.md:46-69` | Staging/Release-Artefakt und Rollen-Tester |
| STH-025 | Mobile Tabellen bleiben horizontale Desktoptabellen | bestätigt, technisch mitigiert | P2; P1 für häufige mobile Aufgaben | Mobile UX | 29 | 19, Responsive-List-Pattern | offen; Scrollregionen sind bounded/fokusfähig | Overflow-Allowlist/Teiltests, keine mobile Action-Parität | `app/admin/invoices/page.tsx:17`; `app/admin/audit/page.tsx:96-103`; `components/employer/jobs-table.tsx:51-60` | mobile Nutzungsprioritäten |
| STH-026 | Kein zentrales Notification Preference Center | bestätigt | P1, vor realer Zustellung | Notification/Consent | 20, UX-Regression 29 | 19, STH-007/009/013/017 | offen; domänenspezifische Opt-outs vorhanden | Einzelkontrollen getestet, keine zentrale Matrix | `prisma/schema.prisma:1395-1412,2235-2297` | Legal-Klassifikation verpflichtend vs. optional |
| STH-027 | Einzelne Sitemap stoppt bei 50.000 URLs | bestätigte spätere Kapazitätsgrenze; aktuelles fail-closed ist korrekt/sicher | P3 kapazitätsabhängige Skalierung; Eskalation nur nach Mess-/Forecast-Gate | SEO/Scale | 30C | 19, LIVE-Count-/Byte-/Wachstumsbaseline und Monitoring; Shardstrategie erst bei Trigger | mitigiert solange unter Trigger; Messung/Alerts offen, Index/Shards konditional deferred | Capacity-Error/no-truncation getestet; kein LIVE-Monitoring, kein Index-/Shard-Test | `lib/seo/public-sitemap.ts:20,85-136,428-435`; `app/sitemap.ts:7-18` | reale Zielumgebungszahl, Growth Forecast, Search Console/Ops Owner |
| STH-028 | Demo-/Preis-Copy nennt Hypothesen | bewusst anders / aktuell korrekt | Schutz-Gate, kein Defect-Prioritätswert | Commercial Copy | 31 | STH-005/007/018/022, WTP/Legal | keine Entfernung vor Gates; später mode-getrennte Copy | aktuelle Mock-/Pricing-Copy getestet | `app/(public)/pricing/page.tsx:16-19,80-143`; `components/marketing/pricing-card.tsx:24-32,113-124` | echter Geldtest, Legal/Tax, freigegebener Katalog |

## 3. Einzeldossiers

### STH-001 — Keine E-Mail-Verifikation

- **Status / Priorität / Phase:** bestätigt; P0; Phase 20
  `20-identity-email-notifications.md`.
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

- **Status / Priorität / Phase:** bestätigt und als Mock-Verhalten ehrlich;
  P0 vor realer interner Bewerbung; Phase 21 `21-document-cv-vault.md`.
- **Fundstellen:** `StorageProvider` erlaubt laut
  `lib/providers/storage/storage-provider.ts:1-16` keinen Read-URL-Rückgabewert.
  `lib/providers/storage/mock-storage-provider.ts:56-107` verwirft den Buffer.
  `lib/candidate/profile.ts:336-376` übergibt nur Dateiname, MIME und Größe.
  Die UI sendet diese als Hidden Fields
  (`components/candidate/JobPassForm.tsx:251-273`). Metadaten stehen in
  `prisma/schema.prisma:1424-1439`.
- **Betroffene Modelle:** `CandidateDocumentMetadata`,
  `ApplicationSubmissionDocument`, `CandidateProfile`; neuer Scan-/Blob-
  Lifecycle und Löschbeleg.
- **Betroffene Rollen:** Candidate Owner; explizit berechtigte
  Employer-/Recruiter-Mitglieder; Privacy/Admin nur begründet.
- **Ist:** Die Anwendung validiert plausible Metadaten und Snapshots, speichert
  aber keine Bytes; Arbeitgeber sehen ausdrücklich „kein Download im
  Mock-MVP“ (`app/employer/applicants/[id]/page.tsx:23`).
- **Soll:** Streaming-Upload in privaten Storage, serverseitige Größen- und
  MIME-/Magic-Byte-Prüfung, Malware-Quarantäne, atomare Aktivierung,
  kurzlebige autorisierte Downloads, Retention/Löschung und unveränderliche
  Bewerbungs-Snapshots.
- **Root Cause:** ADR-014 verschob Storage, während die Domäne für spätere
  Integration nur Metadaten konservierte.
- **Impact:** Eine reale Bewerbung mit CV ist operativ unbrauchbar; Privacy-
  Export/Löschung und Radar-Reveal können keine Datei liefern.
- **Änderungsrisiko:** sehr hoch; PII, Malware, Tenant-Leakage, verwaiste
  Objekte, Range Requests und Provider-Transaktionsgrenzen.
- **Abhängigkeiten:** Storage-Anteil STH-004, STH-006, Key-/Bucket-Region,
  DPA, Malware-Scanner, Retention- und Download-Policy.
- **Geeignete Tests:** Magic-Byte-Mismatch, Oversize-Streaming, Malware-
  Quarantäne, Cross-Tenant/expired URL, DB-Rollback mit Blob-Cleanup,
  Re-Upload/Race, Bewerbungs-Snapshot, Export und Erasure.
- **Abnahmekriterium:** Nur gescannte ACTIVE-Dokumente sind zeitlich begrenzt
  und autorisiert abrufbar; jeder Upload/Delete besitzt idempotente,
  auditierte DB- und Storage-Evidence ohne öffentliche Objekt-URL.

### STH-004 — Produktive Provider fehlen

- **Status / Priorität / Phase:** bestätigt, aber keine überraschende
  Regression; P0-Programm über Phasen 20, 21, 23 und 24, Lead Phase 23.
- **Fundstellen:** ADR-014 dokumentiert die Mock-only-Entscheidung in
  `codex-plan/decisions.md:156-177`. Production weist zukünftige
  Provider-Variablen in `lib/config/env-schema.ts:237-243` sogar ab.
  Beispiele: Mock-E-Mail-Root `lib/providers/email/index.ts:31-43`,
  Mock-Storage `lib/providers/storage/index.ts:20-21`, Mock-Payment
  `lib/providers/payments/index.ts:1-16` und unwired OpenAI-Placeholder
  `lib/providers/ai/openai-ai-provider.ts:3-59`.
- **Betroffene Modelle:** `EmailLog`, `Order`, `PaymentEvent`,
  `CandidateDocumentMetadata`, `ImportSource/Run`, Salary- und
  Job-Room-Snapshots; je Adapter eigene externe Referenzen nur nach ADR.
- **Betroffene Rollen:** alle Produktrollen; besonders Finance, Privacy,
  Employer Owner und Operations.
- **Ist:** Fachlogik arbeitet über Ports, lokale Mocks sind wahrheitsgetreu und
  externe Netzwerkzugriffe unterbleiben. Das ist demo-ready, nicht
  production-ready.
- **Soll:** Pro Provider ein expliziter ADR, Composition Root mit
  Environment-Gate, Secret Handle, Timeouts, Idempotenz, Retry/DLQ,
  Reconciliation, Redaction, DPA/Region, Health/Monitoring und fail-closed
  Fallback. Nicht jeder Mock muss für den ersten Pilot ersetzt werden.
- **Root Cause:** bewusste Risikoreduktion bis zur Produkt- und
  Rechtsvalidierung.
- **Impact:** Kein echter Versand, Geldfluss, CV-Speicher, offizieller
  Job-Room-/Commute-Dienst oder frei schaltbarer AI-Service.
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
  Backup-/Restore-Drill und Runbooks sind vorhanden; reale isolierte
  Umgebungen, Pager, Retention und Owners fehlen.
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
  `lib/admin/sla.ts:73`. `package.json:11-46` enthält keinen dauerhaften
  Worker-Start; das Gate ist in
  `codex-plan/commercial-go-live-gates.md:168-176` offen.
- **Betroffene Modelle:** `SystemTask`, `EmailLog`, Alerts/Digests,
  Subscriptions, Jobs/Boosts, Contact Requests, Privacy Tasks und Audit.
- **Betroffene Rollen:** System Actor, Operations/Admin; fachlich alle
  Empfänger zeitabhängiger Aktionen.
- **Ist:** Viele Runner sind bounded und idempotent, werden aber nur explizit
  angestoßen. Es gibt keine durable Queue, Lease, Attempt-Historie, Backoff,
  DLQ, Scheduler-Ownership oder Heartbeat.
- **Soll:** versionierter Jobvertrag mit enqueue-in-transaction/Outbox,
  `SKIP LOCKED`- oder Queue-Leases, Retry/Backoff/Jitter, Dead Letter,
  Concurrency-Limits, Shutdown/Restart, Monitoring und Re-drive.
- **Root Cause:** Zeitabhängige Domänenlogik wurde implementiert, die
  Produktionsausführung in ADR-014 jedoch verschoben.
- **Impact:** Alerts, Abläufe, Renewals, Reminders und Cleanup passieren ohne
  manuelle Intervention nicht zuverlässig.
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

- **Status / Priorität / Phase:** bestätigt; P0 vor privilegiertem LIVE-Betrieb;
  Phase 25 `25-admin-security.md`.
- **Fundstellen:** Die 36 fachlich benannten Capabilities stehen in
  `lib/admin/capabilities.ts:1-37`; `hasAdminCapability` gewährt in `52-60`
  jede davon jedem aktiven globalen `ADMIN`. Der Test
  `tests/unit/admin/phase11-policies.test.ts:29-47` beweist genau diese
  Vollmacht.
- **Betroffene Modelle:** `User`, `AuditLog`, Privacy-/Billing-/Moderation-/
  Content-/Support-Domänen; neu AdminRole/RoleAssignment oder äquivalente
  unveränderliche Grant-Evidence.
- **Betroffene Rollen:** Platform Admin, künftig Support, Moderator,
  Content/Ops, Finance, Privacy Verifier/Processor und Security Admin.
- **Ist:** Use Cases nennen bereits eine Capability und auditieren sie, aber
  die Policy differenziert keine Admin-Personas oder Duties.
- **Soll:** deny-by-default Capability-Grants, getrennte Rollen für Finance,
  Privacy, Trust/Moderation, Support und Content/Ops, zeitlich begrenzter
  Break-glass sowie explizite Separation-of-Duties für sensible Aktionen.
- **Root Cause:** Phase 11 schuf absichtlich zunächst einen globalen
  Platform-Admin und bereitete die spätere Trennung nur semantisch vor
  (`lib/admin/capabilities.ts:47-50`).
- **Impact:** Kompromittierte oder fehlbediente Admin-Konten besitzen unnötig
  Zugriff auf Billing, Privacy, User-Suspension und Publikation.
- **Änderungsrisiko:** sehr hoch; falsche Migration kann legitime Operations
  sperren oder still zu breite Rechte erhalten.
- **Abhängigkeiten:** fachliche Duties-Matrix, benannte Owner,
  STH-011 und später STH-012; bestehende Command-Level-Capabilities bleiben
  die Autoritätsgrenze.
- **Geeignete Tests:** vollständige Rolle×Capability-Matrix mit Read/Write-
  Denials, Cross-Duty-Aktionen, Break-glass TTL/Revoke, direkte Server-Action-
  Aufrufe, Seed-Migration und Audit der Grant-Historie.
- **Abnahmekriterium:** Kein Admin besitzt implizit alle Capabilities; jede
  sensible Aktion wird serverseitig aus einem aktuellen Grant entschieden und
  Capability-, Actor-, Grund- und Ergebnis-Evidence bleibt vollständig.

### STH-011 — Kein Admin-MFA und kein Step-up

- **Status / Priorität / Phase:** bestätigt; P0; Phase 25.
- **Fundstellen:** `Credential` enthält in
  `prisma/schema.prisma:1181-1191` nur Passwortdaten, `Session` in `1193-1208`
  keinen Authentication-Assurance-Level. Die Admin-Seitengrenze prüft in
  `lib/auth/route-guards.ts:18-23,39-55` nur Session und globale Rolle. Eine
  repository-weite Suche findet kein TOTP-, WebAuthn-, Recovery-Code- oder
  Step-up-Modell und keinen entsprechenden Test.
- **Betroffene Modelle:** `Credential`, `Session`, `User`, `AuditLog`; neu
  authenticator/recovery enrollment, assurance snapshot und step-up challenge.
- **Betroffene Rollen:** alle Admin-Personas, besonders Finance, Privacy und
  Security/Break-glass.
- **Ist:** starke Passwort-Hash-, Session-Rotation/-Expiry- und Rate-Limit-
  Verträge, aber nur ein Faktor und keine frische Reauthentisierung vor
  Hochrisikoaktionen.
- **Soll:** phishing-resistente Option bevorzugt, mindestens verpflichtender
  zweiter Faktor, sichere Enrollment-/Recovery-Prozesse, Session-AAL und
  zeitgebundener Step-up für Finance/Privacy/RBAC/Break-glass.
- **Root Cause:** Auth Phase 06 fokussierte lokale passwortbasierte
  Demo-Identität; ein externer IdP oder MFA-Lifecycle war nicht im MVP.
- **Impact:** Ein gestohlenes Passwort oder eine bestehende Session genügt für
  alle aktuellen Admin-Capabilities.
- **Änderungsrisiko:** XL; Account-Lockout, Recovery-Social-Engineering,
  Replay, Clock Drift und Session-Downgrade.
- **Abhängigkeiten:** STH-001/013, gewähltes MFA-/IdP-Verfahren, Support-
  Identitätsprüfung, Device-/Recovery-Policy und STH-010.
- **Geeignete Tests:** Enrollment/confirmation, Replay, Recovery-Code single
  use, Clock Boundary, Session-Rotation mit AAL, Step-up expiry, deaktiviertes
  Verfahren, suspendierter Admin und verlorenes Gerät.
- **Abnahmekriterium:** Admin-LIVE-Login erfordert den freigegebenen zweiten
  Faktor; Hochrisiko-Commands verlangen eine frische, serverseitig geprüfte
  Assurance und Recovery kann Rechte weder umgehen noch still erweitern.

### STH-012 — Exklusive globale Rolle verhindert Multi-Persona

- **Status / Priorität / Phase:** bestätigt; P1; Phase 27
  `27-multi-persona-identity.md`.
- **Fundstellen:** `Role` ist ein einzelnes Enum-Feld mit vier exklusiven
  Werten (`prisma/schema.prisma:10-15,1129-1137`). Die Routengrenzen verzweigen
  danach (`lib/auth/route-guards.ts:10-23`). Company-Rollen sind zwar
  relational in `prisma/schema.prisma:1536-1555`, werden aber nur von globalen
  EMPLOYER/RECRUITER-Personas erreicht.
- **Betroffene Modelle:** `User`, `CompanyMembership`,
  `RecruiterMandate`, Session/CurrentUser; neu globale Persona-/RoleAssignment-
  Historie oder abgeleitete Capabilities.
- **Betroffene Rollen:** Personen, die Kandidat:in und Employer/Recruiter sind,
  sowie Admins mit getrenntem normalen Konto.
- **Ist:** Eine E-Mail entspricht genau einer globalen Persona; zusätzliche
  Company-Kontexte lösen Multi-Tenant, nicht Candidate↔Employer oder
  Admin↔Normal-User.
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
- **Abnahmekriterium:** Eine Person kann erlaubte Personas explizit wechseln,
  aber jeder Request besitzt genau einen serverseitig gebundenen Persona- und
  Tenant-Kontext; Rechte werden nie implizit vereinigt.

### STH-013 — Keine dauerhafte E-Mail-Outbox mit Retry

- **Status / Priorität / Phase:** bestätigt; P0; Phase 20.
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

- **Status / Priorität / Phase:** bestätigt, bei vorhandenem robustem
  Lifecycle; P0 für einen vertrauensbasierten LIVE-Publishpfad; Phase 26
  `26-company-trust-verification.md`.
- **Fundstellen:** `CompanyVerificationRequest` speichert ein generisches
  `evidenceMetadata Json?`, Events nur `evidenceRef`
  (`prisma/schema.prisma:1665-1699`). Die UI akzeptiert Beschreibung und
  Freitextreferenz (`components/employer/verification-panel.tsx:160-195`).
  Der Codec enthält nur `summary/reference`
  (`lib/employer/company.ts:1120-1144`).
- **Betroffene Modelle:** `Company`, `CompanyVerificationRequest/Event`,
  `CandidateDocumentMetadata` beziehungsweise neuer TrustEvidence-
  Dokument-/Registry-Snapshot.
- **Betroffene Rollen:** Employer Owner/Admin als Antragsteller,
  Trust/Verification Reviewer, Platform/Security Ops.
- **Ist:** Single-cycle-/Supersession-, Status-, Concurrency-, Notification-
  und Auditvertrag sind vorhanden; die Evidenz selbst wird weder hochgeladen
  noch gegen UID/Handelsregister oder Domain kontrolliert.
- **Soll:** versionierte Prüfpolicy, erlaubte Evidenzarten, sichere Dokument-
  oder Register-Snapshots, Vier-Augen-/Reason-Code-Prüfung, Ablauf/Reverify und
  klare Wirkung auf Company-/Job-/Radar-Gates.
- **Root Cause:** Verification-Orchestrierung wurde vor realem Storage und
  offizieller Registerintegration gebaut.
- **Impact:** Admin kann eine unbelegte Freitextbehauptung genehmigen; das
  schwächt Arbeitgebervertrauen und Missbrauchsschutz.
- **Änderungsrisiko:** sehr hoch; Firmenidentität, sensible Dokumente,
  False-positive Registry Matches und Widerruf mit abhängigen Jobs/Radar.
- **Abhängigkeiten:** STH-003/004, Registerzugang/Lizenz, Trust-Policy,
  Retention, Reviewer-Ownership und STH-010.
- **Geeignete Tests:** Evidenztyp/Magic Bytes, UID-/Name-/Canton-Mismatch,
  Cross-Company-Denial, doppelte/abgelaufene Evidenz, Reviewer-Duty,
  Concurrent approve/revoke und abhängige Visibility-Entziehung.
- **Abnahmekriterium:** VERIFIED ist nur aus nachvollziehbarer, gültiger,
  versionierter Evidenz ableitbar; jede Entscheidung nennt Snapshot, Policy,
  Reviewer und Grund, und Widerruf greift sofort.

### STH-015 — Externe Bewerbungen enden nach dem Klick

- **Status / Priorität / Phase:** bestätigt; P1; Phase 28
  `28-recruiting-workflows.md`.
- **Fundstellen:** APPLY_URL wird in
  `app/(public)/jobs/actions.ts:92-110` validiert und extern weitergeleitet;
  `251-278` schreibt nur `EXTERNAL_APPLY_CLICKED`. Interne Bewerbung lehnt
  externe Jobs in `lib/applications/service.ts:193-197` ab.
  `prisma/schema.prisma:1973-2002` kennt nur intern eingereichte Applications.
- **Betroffene Modelle:** `Job/JobRevision`, `AnalyticsEvent`; neu
  Candidate-owned ExternalApplicationJourney/Event/Snapshot.
- **Betroffene Rollen:** Kandidat:in als Owner, Arbeitgeber/Admin nur
  datensparsam aggregiert, anonyme Klicker ohne Bewerbungsbehauptung.
- **Ist:** Es existiert datensparsame Klick-Telemetrie. Klick ist korrekt keine
  Bewerbung, danach besitzt die Plattform aber keinen Outcome.
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
- **Abnahmekriterium:** Externe Outcomes sind klar als kandidatenbestätigt oder
  integriert gekennzeichnet, bleiben owned/auditierbar und verfälschen weder
  Application- noch Funnel-Metriken.

### STH-016 — Keine echte Interviewplanung

- **Status / Priorität / Phase:** bestätigt; P1; Phase 28.
- **Fundstellen:** Schema besitzt nur Pipeline-Status `INTERVIEW` und
  Eventwert `SCHEDULED_INTERVIEW`
  (`prisma/schema.prisma:264-288`). `SCHEDULE_INTERVIEW` wechselt in
  `lib/policies/status/application.ts:105-113` lediglich den Status.
  `lib/employer/applications.ts:328-335` erzeugt eine Mock-Einladung mit
  leeren `suggestedSlots`; die UI
  `components/employer/applicant-detail-actions.tsx:17-21` bietet keine
  persistenten Slots.
- **Betroffene Modelle:** `Application`, `ApplicationEvent`, `Conversation`,
  `Notification`; neu `Interview`, Slot/Participant/Response/Event.
- **Betroffene Rollen:** Employer Owner/Admin oder berechtigter Recruiter,
  Kandidat:in; System Worker.
- **Ist:** Pipeline-Stufe plus editierbarer Nachrichtentext, aber kein Termin,
  keine Zeitzone, Zusage, Verschiebung, ICS oder Erinnerung.
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
- **Abnahmekriterium:** Termin und Pipeline besitzen getrennte,
  nachvollziehbare Zustände; beide Seiten sehen denselben Zeitpunkt und jede
  Änderung ist idempotent, autorisiert und benachrichtigt.

### STH-017 — Produktionsanalytics ist nur teilweise deaktiviert

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

- **Status / Priorität / Phase:** bestätigt; P1 Performance; Track 30B.
- **Fundstellen:** `lib/candidate/dashboard.ts:318-327` lädt bis zu 24
  bevorzugte und 24 Fallback-Jobkandidaten; `328-360` ruft pro Kandidat
  `getPublicJobBySlug` auf und reduziert danach auf sechs. `364-386` kann
  Notification-Links ebenfalls einzeln autorisieren. Ein Query-Count-Ceiling
  fehlt.
- **Betroffene Modelle:** `CandidateProfile/Preference/Skill/Language`,
  `Job/JobRevision`, Notifications und Public Eligibility.
- **Betroffene Rollen:** Kandidat:innen; mittelbar DB-/Operations-Owner.
- **Ist:** bis ungefähr 48 vollständige Einzeljob-Projektionen für sechs
  Karten, funktional korrekt durch Wiederverwendung des Public Read Models.
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

- **Status / Priorität / Phase:** teilweise bestätigt; P1; Phase 29
  `29-ux-mobile-accessibility.md`.
- **Fundstellen:** `playwright.config.ts:28-57` konfiguriert Desktop/Mobile
  Chromium, nicht Firefox/WebKit. Axe lässt in
  `tests/e2e/fixtures/phase17-test.ts:155-175` nur `critical` scheitern und
  zählt `serious`; ab `224` existiert ein einzelner Tab-/Focus-Smoke.
  `tests/unit/ui/phase18-accessibility-regressions.test.tsx:23-130` ergänzt
  gezielte Regressionen, ersetzt aber keine Assistive-Technology-Matrix.
- **Betroffene Bereiche:** Public-, Auth-, Candidate-, Employer-, Admin- und
  Dialog-/Form-Komponenten; Browser-/CI-Infrastruktur.
- **Betroffene Rollen:** alle Nutzer, besonders Keyboard- und
  Screenreader-Nutzer.
- **Ist:** ungewöhnlich breite 100-Seiten-Chromium-Matrix in Desktop/360 px,
  Critical-Axe-Gate, Clipping-/Console-/Focus-Checks. Firefox, WebKit,
  Serious-Gate und dokumentierte NVDA/VoiceOver-Runs fehlen.
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

### STH-025 — Mobile Tabellen sind weiterhin horizontale Desktoptabellen

- **Status / Priorität / Phase:** bestätigt, jedoch kontrolliert mitigiert; P2,
  für häufige mobile Operationen nach Nutzungsdaten P1; Phase 29.
- **Fundstellen:** Beispiele sind `app/admin/invoices/page.tsx:17`
  (`min-w-[60rem]`), `app/admin/orders/page.tsx:16`,
  `app/admin/audit/page.tsx:96-103`,
  `components/admin/JobReviewTable.tsx:28-35`,
  `components/employer/jobs-table.tsx:51-60` und
  `app/employer/billing/page.tsx:180-188`. Der bestehende Test
  `tests/unit/employer/jobs-table.test.tsx:42-47` schützt absichtlich die
  Scrollregion.
- **Betroffene Bereiche:** Employer-/Recruiter- und Admin-Listen, besonders
  Jobs, Applicants, Billing, Audit, Moderation und Support.
- **Betroffene Rollen:** mobile Employer/Recruiter und Operations/Admin.
- **Ist:** kein unkontrollierter Dokumentoverflow; Scrollregionen sind teils
  fokusfähig/beschriftet und Aktionen sticky. Dennoch muss man breite
  Desktoptabellen horizontal bedienen.
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
> `STH-029` ist durch Phase 19 geschlossen; `STH-030`–`STH-037` bleiben nach
> ihrem jeweiligen Status, Trigger oder externen Gate offen. Die Priorität je
> Launchklasse steht in Abschnitt 3B.

| ID | Befund und unabhängiger Status | Lead / Mitwirkende | Rollen, Portale und aktuelle Fundstellen | Abhängigkeiten und geschützte Regressionen | Verbindlicher Test-/Evidence-Vertrag | Externer Gate / Abschlussstatus |
| --- | --- | --- | --- | --- | --- | --- |
| `STH-029` | **geschlossen:** höher priorisierte Requirements, Architektur, ADRs, Implementation Guidance, Quickref/Glossary und Phasen 19–32 waren nicht synchron; alle offenen Phasen hatten keinen vollständigen 28-Punkte-/AC-Testvertrag. Candidate `769ee62` synchronisiert und versiegelt diesen Vertrag. | 19 abgeschlossen / alle Phasen 20–32 halten den Vertrag | Product, Engineering, QA; `00-PLAN.md`, `requirements-matrix.md`, `architecture-blueprint.md`, `decisions.md`, `implementation-plan.md`, Phase-19–32-Testabschnitte | Candidate `769ee62`; Phasen 01–18/Evidence immutable; Ist-Routeinventar nicht vorplanen | 37/37 IDs, sechs LC, vier Statusdimensionen, jede Phase 28 Punkte und vollständige AC-Matrix; G4-Baseline und Diff-Invarianten auf einem Commit; [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | kein externes Fachgate; **durch Phase-19-Gate geschlossen, Folgeregression weiter geschützt** |
| `STH-030` | **bestätigt:** Admin-MFA war geplant, aber Employer Owner/Billing/Team, Login-E-Mail, Candidate Export/Delete und kritische Consent-/Reveal-Aktionen besitzen keine risikobasierte frische Step-up-Authentisierung. | 25B / 20, 22, 24, 26 | Candidate, Employer Owner, Billing, Admin; `lib/auth/current-user.ts`, `lib/auth/route-guards.ts`, Candidate-Privacy-/Employer-Team-/Billing-Actions; kein MFA-/StepUp-Modell im Schema | Phase-20 Identity; bestehende Session-, safe-next-, tenant-, candidate-owner-, Reveal- und Billing-Autorisierung bleibt erhalten | AAL-/Action-Matrix; fresh/stale/replay/cross-purpose/cross-tenant/direct-action/recovery/credential-revoke Unit+PostgreSQL+E2E; genau eine Wirkung; G3 | MFA-Verfahren, Recovery-/Supportpolicy, Security Owner; **offen** |
| `STH-031` | **teilweise bestätigt:** Rate Limits, Abusequeue, Audit und Revocation existieren; ein kohärenter Fraud-/Scam-/ATO-Vertrag für kompromittierte Firmen, Credential Stuffing, Fake-/Duplicate-Jobs, Massennachrichten, Reveal/Export-Anomalien, Payment Fraud und wiederholte Beschwerden fehlt. | 25 Threat-Model / 23, 24, 26, 30D | alle Nutzer, Trust & Safety, Security, Finance; `lib/auth/rate-limit.ts`, `lib/abuse/public-report.ts`, `lib/admin/moderation.ts`, `lib/admin/capabilities.ts`; keine RiskSignal-/ATO-Orchestrierung | 20 Identity, 23 Incidents/Worker, 26 Trust; Session-/Company-/Job-/Radar-/Payment-/Audit-Invarianten | kompromittierte VERIFIED-Firma, Stuffing, Massennachricht, abnormaler Reveal/Export, Payment Fraud, Complaint-Repeat, false positive/Appeal und Incident-Drill; nächste Reads verlieren riskante Rechte; G3 | benannte Trust-&-Safety-/Security-/Finance-Owner, Signal-/Retentionfreigabe; **offen** |
| `STH-032` | **teilweise bestätigt:** Job-Ablauf und öffentliche Ausblendung sind fail-closed; Reconfirmation, Reminder, „besetzt/nicht verfügbar“-Feedback, Copy-/Dublettenreview und schnelle kanalübergreifende Deaktivierung fehlen. | 30D / 23 Worker, 26 Trust, 31 Cluster | Visitor, Candidate, Employer, Admin; Public Search/Detail, Employer Jobs, Admin Queue; `lib/jobs/effective-status.ts`, `lib/jobs/public-eligibility.ts`, Alerts/Sitemap/Recommendations | 23 Notifications/Worker und 26 Trust; bestehende Publish-/Revision-/Quota-/Slug-/Boost-/Eligibility-Verträge | Time-travel, concurrency, filled/report, exact/near-duplicate, appeal; identische Ausblendung aus Search, Sitemap, Alerts, Recommendations und Analytics; keine Promotion veralteter Dublette; G2/G3 vor Public | fachliche Freshness-/Duplicate-Policy, Moderationskapazität; **offen** |
| `STH-033` | **bestätigt:** Browser-, Mobile- und Axe-Tests beweisen keine Verständlichkeit oder Vertrauen; es gibt kein rekrutiertes, moderiertes Research-Protokoll mit Schwellen. | frühe 29A / 26, 30, 31; 29B Abschluss | Candidate, Employer, Admin/Support; JobPass, Search, Fair Score, Verification, Radar/Reveal, CV/Privacy, Pricing/Limits/Kündigung; `playwright.config.ts`, `tests/e2e/quality/*`, Phase 29 | nach Phase 19 früh möglich; keine PII in Research; Defekte gehen in owning Phase statt UI-Kaschierung | vorab definierte Segmente/Tasks, Task success, Zeit, Fehler, Abbruch, Comprehension/Trust; anonymisiertes Research-Repository, Moderatorprotokoll und Go/No-go | Rekrutierung, Research/Privacy Owner; externe Nutzerhypothesen bleiben **offen** |
| `STH-034` | **bestätigt:** SLA-/Queue-Alter existieren, aber kein Minuten-/Arrival-/Backlog-/Staffing-/Coverage-/Unit-Cost-Modell je Verification, Moderation, Import, Privacy, Support und Fraud. | frühe 31A / Telemetrie 23, Queues 25/26/30 | Ops, Support, Privacy, Trust, Commercial; `lib/admin/sla.ts`, `lib/admin/support.ts`, `product-strategy.md`, Phase 31 | reale oder kontrolliert gemessene Fälle; STH-033 Research; Demo-Zeitwerte nicht als Marktbeleg | p50/p95 Handling Time, Arrival, Backlog Age, FTE/Vertretung/On-call, Automation- und Aufnahme-Stopp, max. Concierge-COGS; Capacity-/Cost-Report mit Owner | Staffing-/Kosten-/Servicelevel-Freigabe; **offen** |
| `STH-035` | **bestätigt:** Phase 24 plante Refundmechanik, aber keine fachliche Service-Recovery für plattformverursachten Boost-/Radar-Ausfall; ADR-028 kennt bewusst nur no-auto-refund und exakte Adminreversal. | 24 / Policy 31, Trust 26 | Employer Owner, Finance, Support, System; Billing/Radar/Boost; ADR-028, `lib/billing/credit-policy.ts`, `lib/billing/boosts.ts`, `lib/talentradar/request-contact.ts` | WTP-Go, real Payment, Trust-/Provider-Failureklassifikation; Ledger/Invoice/Order unverändert und idempotent | Outcome-Matrix Plattformfehler vs Decline/Expiry/User-Cancel; exactly-once replacement/extension/credit/refund, concurrent webhook/reconciliation/support E2E; G3 | Finance/Legal/Support-Freigabe und konkretes Paid-Versprechen; **offen, P0 nur bei Geldfluss** |
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

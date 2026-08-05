# Phase 33 — Technische Go-live-Härtung, Mock-/Live-Parität und vollständige End-to-End-Abnahme

> **Vertrag:** Diese Phase ist die letzte technische Abschluss- und
> Remediationphase nach dem historischen Phase-32-`NO_GO`. Sie erzeugt einen
> neuen, commitgebundenen technischen LC4-/LC5-Konfigurationskandidaten. Sie
> ändert weder die historische
> [Phase-32-Evidence](./evidence/2026-07-30-phase-32.md) noch ersetzt sie reale
> Provider-, Legal-, Privacy-, AVG-, Tax-, Finance-, Operations-, Staging- oder
> Markt-Evidence. Der vollständige gemeinsame Vertrag steht in
> [remediation-execution-contract.md](./remediation-execution-contract.md).

## Phasenspezifische Instanziierung des 28-Punkte-Vertrags

### 1. Status

| Dimension     | Aktueller Stand                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Planstatus    | `COMPLETED`                                                                                                                  |
| Technikstatus | `TECHNICALLY_READY_FOR_LC4` und `TECHNICALLY_READY_FOR_LC5_CONFIGURATION`                                                    |
| Quality-Gate  | `PASSED` — lokaler Clean-Clone-Golden-Run sowie GitHub-CI 31029349214 und G4 31029349476 auf Candidate `d5f4646…` grün       |
| Aktivierung   | `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`; sämtliche Production-/Provider-/Commercial-Flags bleiben fail-closed                 |
| Zielklassen   | technische Readiness für **LC4 Public Free** und **LC5 Paid Self-Service Configuration**, getrennt bewertet                  |
| Startbaseline | `59ed81033d409aac847c55f1da3ecf5370f4f035`; Abschlusscandidate `d5f4646de295ab30f3dfef546ca44c87e224a1a3`                    |

Ein späterer technischer Pass darf ausschließlich
`TECHNICALLY_READY_FOR_LC4` beziehungsweise
`TECHNICALLY_READY_FOR_LC5_CONFIGURATION` ausgeben. `GO_LIVE_APPROVED` bleibt
ohne sämtliche zielklassengültigen externen Nachweise unzulässig.

### 2. Ziel und messbarer Nutzer-/Businesswert

LC4 soll einen öffentlichen, kostenlosen und unbeaufsichtigten Kernbetrieb
ermöglichen, während sämtliche Kaufpfade vollständig, serverseitig und ehrlich
geschlossen bleiben. LC5 soll denselben Kern um technisch produktionsfähigen
Paid Self-Service erweitern. Nach technischer Abnahme soll für die
freigegebenen Use Cases kein weiterer Codewechsel nötig sein, wenn später
echte Secrets, Providerkonten, Zielumgebungskonfiguration und externe
Freigaben bereitgestellt werden.

Messbar bedeutet:

- 100 % der Launchscope-Routen, Actions, Provider, Worker und Flags sind
  inventarisiert und besitzen genau einen ehrlichen Status;
- Production akzeptiert für aktivierte Use Cases ausschließlich explizit
  freigegebene Live-Adapter und fällt nie auf Mock, Sandbox, Demo oder lokale
  Dateisystemadapter zurück;
- jede sichtbare Kernaktion wird bis zur persistenten DB-/Provider-/Worker-
  Wirkung, Audit/Outbox und sicheren UI-Rückmeldung geprüft;
- LC4 besitzt null erreichbare Kaufwirkung; LC5 besitzt vollständige technische
  Checkout-, Webhook-, Projection-, Reconciliation-, Dunning-, Refund- und
  Recovery-Verträge;
- jeder technische Pass ist an genau einen unveränderlichen Commit sowie
  Migration-, Config-, Provider- und Artefaktdigests gebunden.

### 3. Tatsächlicher Repositoryzustand

Der verifizierte Ausgangsbaum besitzt Phasen 01–32, 67 committed Prisma-SQL-
Migrationen, PostgreSQL 16, ein umfangreiches Unit-/PostgreSQL-/Playwright-
Harness, persistierte Provider-/Worker-Aktivierungsmodelle, fail-closed
Local-/CI-Sandboxprovider und einen Phase-32-Orchestrator. Die
[Phase-32-Evidence](./evidence/2026-07-30-phase-32.md) belegt ausschließlich
den LC1-Vertrag und endet ehrlich mit `NO_GO`; LC2–LC6 sind dort
`NOT APPROVED`.

Die aktuelle Basis enthält bereits wichtige Schutzverträge: Production-Demo-
Seed-Verbot, Environmentvalidation, Provider Activation Ledger, Queue-Leases,
Retry/DLQ/Replay, Payment-Inbox, Quarantäne-Vault, Step-up/Least Privilege,
Public Eligibility und SQL-/JS-Ranking-Parität. Noch nicht belegt sind ein
vollständiger technischer Live-Adapterpfad für alle LC4-/LC5-Pflicht-Use-Cases,
eine reproduzierbare lokale Production-Contract-Topologie und eine vollständige
rollen-, provider-, failure-, browser- und artefaktgebundene Abnahme des
aktuellen Candidates. Das detaillierte Ledger steht in
[phase33-findings-ledger.md](./phase33-findings-ledger.md).

### 4. Findings und Requirements

Phase 33 führt keine neue `STH-*`-ID ein. Sie schließt oder klassifiziert die
bereits vorhandenen `STH-003`, `STH-004`, `STH-005`, `STH-006`, `STH-008`,
`STH-009`, `STH-013`, `STH-023` und `STH-024` für den gewählten Scope und
regressiert die übrigen LC4-/LC5-P0/P1-Invarianten.

Neu registriert werden nur vier echte Phase-33-Ausführungsverträge:

| ID                | Verbindlicher Vertrag                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REQ-INT-033-001` | Environment × Use Case × Adapter × Version × Mode ist vollständig und fail-closed; Production erlaubt nie Mock/Sandbox/Demo/`.invalid`, Secret-allein oder Live→Mock-Fallback.                         |
| `REQ-OPS-033-001` | Ein isoliertes `production-contract`-Profil betreibt gebaute App, Worker, Scheduler, PostgreSQL 16, TLS-Proxy, S3-kompatiblen Storage, Scanner und HTTP-Provider-Stubs mit echten Failure-Injektionen. |
| `REQ-QA-033-001`  | Jede launchrelevante Journey wird als vollständige Wirkungskette über Rollen, Tenant, Provider, Worker, Browser, Mobile und Accessibility statt als bloßer Route-Smoke geprüft.                        |
| `REQ-REL-033-001` | Technische LC4-/LC5-Konfigurationsreadiness und tatsächliche Production-Aktivierung sind getrennte, commit- und artefaktgebundene Entscheidungen.                                                      |

Die übergeordneten Verträge `REQ-INT-002`, `REQ-OPS-005`, `REQ-QA-002`,
`REQ-QA-003`, `REQ-REL-001` und `REQ-REL-032-001` bis `005` bleiben
unverändert gültig.

### 5. In Scope

- vollständiger Plan-/Code-/Schema-/Route-/Action-/Provider-/Worker-/Flag-/
  Migration-/Test-Audit auf dem aktuellen Baum;
- technische Live-Adapter- und Composition-Readiness für E-Mail,
  Object Storage, Malware-Scanning und Payment, soweit LC4/LC5 sie benötigt;
- sichere Environment-/Provider-Modusmatrix und persistierte
  Activation-Ledger-Bindung;
- getrennte, isolierte Docker-Profile `local/mock` und `production-contract`;
- Standalone-/OCI-App, separater Worker, Scheduler/Maintenance, lokaler TLS-
  Proxy, PostgreSQL 16, S3-kompatibler Storage, Scanner und Provider-Stubs;
- vollständige Public-, Candidate-, Employer-, Recruiter-, Admin-, Security-,
  Privacy-, Finance- und Support/Ops-Wirkungsketten;
- Negative-, Abuse-, Provider-, Worker-, Recovery-, Browser-, Mobile- und
  Accessibility-Matrix;
- Remediation bestätigter repository-interner P0/P1-Blocker;
- neuer Phase-33-Release-Orchestrator, reproduzierbare Evidence und ehrliches
  technisches/aktivierungsbezogenes Abschlussurteil.

### 6. Out of Scope und deaktivierte Nachbarfunktionen

Nicht autorisiert sind echtes Production-Deployment, DNS-Änderungen,
Providerkontoanlage, Secretmutation in externen Systemen, echte Nachrichten,
echte Zahlungen, echte Production-/personenbezogene Daten oder ein
Produktions-Migrationslauf. Ebenso nicht durch Code abschließbar sind Legal-,
AVG-/AVV-, Tax-, DPA-/DSFA-, Finance-, WTP-, Markt-, Operations-, Pager-,
Staging- und Approval-Gates.

Salary LIVE, Success Fee, AI, Job-Room, Maps/Commute, externe Tracker,
Vollscheduler, Multi-Persona, Boost und Paid Radar sind nur dann Scope, wenn der
konkrete LC5-Launch sie ausdrücklich verspricht und ihre eigenen Gates erfüllt
sind. Andernfalls bleiben sie serverseitig `DISABLED`, nicht kaufbar,
`noindex` und ohne irreführende Production-Copy. Deferred Phase-30B/30C-Arbeit
bleibt bei nachgewiesenem Headroom `DEFERRED_MONITORED`.

### 7. Rollen und Owner

| Rolle/Owner                                       | Verantwortung in Phase 33                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Visitor / Candidate                               | Public Discovery, Identity, Bewerbung, Vault, Alerts, Messages, Radar und Privacy als reale Wirkungsketten          |
| Employer Owner / Recruiter                        | Company, Team/Assignment, Job Lifecycle, Pipeline, Messaging, Analytics, Planlimits und optional Billing            |
| Admin Capability-Rollen                           | Moderation, Company Trust, Privacy, Finance, Security, Legal, Imports und Operations ausschließlich least-privilege |
| Support/Ops / Worker / Scheduler                  | Queue, Lease, Retry, DLQ, Replay, Reconciliation, Maintenance, Readiness und Incidentwirkung                        |
| Engineering / QA / SRE                            | Adapter, Runtime, Migrationsschutz, Testmatrix, Artefaktidentität und Remediation Loop                              |
| Security / Privacy / Finance / Legal / Commercial | fachliche Freigaben und externe Evidence; kein Code-Selbstapproval                                                  |
| Provider-/Infrastructure-Owner                    | Accounts, Secrets, DNS, Region/DPA, Zielruntime, Pager, Backups und Zielsystem-Smokes                               |

### 8. Portale, Routen, Services, Provider und Worker

Ausgangspunkt sind das generierte
[Routeinventar](./route-inventory.json), die
[Route-/Rollenmatrix](./route-role-matrix.md), alle Server Actions/Route
Handler und sämtliche Composition Roots. Phase 33 erzeugt zusätzlich ein
vollständiges Provider-/Use-Case-/Mode-/Version-/Health-/Owner-Inventar.

Die Runtimegrenze umfasst den Next.js-Appprozess, einen separaten Worker,
Scheduler/Maintenance, `/health/live`, `/health/ready`, PostgreSQL 16,
Reverse Proxy/TLS, Object Storage, Scanner sowie E-Mail-/Payment-Contract-
Endpunkte. Jeder Use Case besitzt genau einen Adapterentscheid; die
Aktivierung eines Providers erteilt keinem anderen Provider, Feature oder
Tenant automatisch Rechte.

### 9. Datenmodell, Constraints, Indizes und Klassifikation

Bestehende Modelle wie `ProviderActivation`, `WorkerHandlerActivation`,
`OperationsActivationEvent`, Notification Outbox/Attempts, Payment Inbox/
Attempts, Document Vault/Scan, Privacy Execution und Release-Manifeste sind
zuerst wiederzuverwenden. Schemaänderungen sind nur zulässig, wenn der Audit
eine konkrete persistente Sicherheits-, Idempotenz-, Provenienz- oder
Activation-Ledger-Lücke beweist.

Secrets und Providerpayloads bleiben `SECRET` beziehungsweise strikt
minimierte `SENSITIVE`-Daten. Konfigurations-, Evidence- und Artefaktdigests
speichern keine Secretwerte. Tenant-/Owner-/Provider-/Environment-FKs,
Unique-/Check-Constraints und bounded Indizes müssen die Applikationspolicy
als DB-Backstop unterstützen.

Für Notification-Evidence gelten zwei unabhängige kryptografische Domänen:
`NOTIFICATION_DELIVERY_KEYS` verschlüsselt Provider-Requestmaterial und den
zeilengebundenen expliziten AES-v2-Empfängerumschlag;
`NOTIFICATION_RECIPIENT_HASH_KEYS` erzeugt ausschließlich HMAC-Lookups für
Korrelation und Suppression. Jede persistierte Verwendung inventarisiert ihre
Key-Version. `EmailProviderEventInbox` und `NotificationSuppression` sind
append-only/monoton; nur der exakt definierte einmalige Inbox-Terminalübergang
beziehungsweise die endliche Suppression-Release darf Felder verändern.
Attempt-Evidence erlaubt ausschließlich die irreversible, einmalige
PII-/Receipt-/Digest-Kompaktion nach ihrer Retentionfrist; die verbleibende
nicht-PII Audit-/Timeline-Kette bleibt unveränderlich.

### 10. Expand–Migrate–Contract und Backfill

Vor der ersten Änderung werden SHA-256-Digests aller 67 vorhandenen
`prisma/migrations/**/migration.sql` erfasst; am Ende müssen sie bytegenau
identisch sein. Keine historische Migration wird editiert, umbenannt,
formatiert oder zusammengeführt. `prisma db push` und nicht eindeutig
disposable `migrate reset` sind verboten.

`codex-plan/evidence/phase33-migration-baseline.json` ist ein prüfbares
Inventar, aber keine eigene Vertrauensquelle. `scripts/phase33-audit.ts`
rekonstruiert Pfad und SHA-256 aller 67 historischen Migrationen direkt aus
dem unveränderlichen Baseline-Commit
`59ed81033d409aac847c55f1da3ecf5370f4f035` und verlangt anschließend die
exakte Übereinstimmung mit Arbeitsbaum und Inventar.

Nur eine echte Schemaänderung erhält eine neue, zeitlich nachgelagerte
Phase-33-Migration. Sie muss per `prisma migrate deploy` auf frischer DB und
vollständig bisher migrierter Upgrade-DB bestehen sowie Null-/Legacy-/
Randdaten, realistische Datensätze, Teil-Backfill, Abbruch/Restart,
Idempotenz, Concurrency und das Roll-forward-Kompatibilitätsfenster prüfen.
Wenn keine Änderung erforderlich ist, wird keine leere Scheinmigration
erzeugt.

### 11. Serverlogik, Queue, Provider und G4-Orchestrierung

Providercomposition validiert `APP_ENV`, Use Case, Adapterkey/-version, Modus,
Konfigurationsdigest, Secret-Version, Evidence, Region/DPA, Owner, Health,
Gültigkeit und Kill Switch. Production startet einen sichtbaren Use Case nur
mit vollständig freigegebenem `live`-Eintrag; fehlende Konfiguration führt
zum Boot-/Readiness-Fehler oder zu einer bewusst nicht beworbenen,
serverseitig deaktivierten Funktion.

Jeder Provider-/Workerpfad deckt Timeout, bounded Retry/Backoff,
Idempotency, Duplicate-/Out-of-order-Delivery, Crash vor und nach Effekt,
Leaseverlust, Poison/DLQ, Replay, Reconciliation und sichere Redaction ab. Der
Phase-33-Orchestrator ergänzt Phase 32, schwächt dessen fail-closed G4-
Verträge aber nicht. Er bindet Migration-, Environment-, Provider-, Feature-,
Worker-, Route-/Rollen-, E2E- und Standalone-/OCI-Digests sowie ein getrenntes
External-Gate-Ledger.

Beim E-Mail-Provider sind Netzwerkfehler, HTTP 408/5xx, malformed/oversized
2xx und konkurrierende Idempotency-Konflikte ausdrücklich **unbekannte
Provider-Ausgänge**. Sie dürfen nur bounded mit demselben Idempotency-Key
wiederholt werden und wechseln nach ausgeschöpftem Budget auf `PAUSED` plus
manuelle Reconciliation; ein Blind-Resend oder blindes Dead Letter ist
verboten. Webhook-Ingestion sperrt die exakte `ProviderActivation` innerhalb
derselben Transaktion, bevor Inbox- oder Suppression-Wirkung entsteht.

### 12. Vollständige UX-Zustandsmatrix

Jede launchrelevante Oberfläche und Aktion prüft `Loading`, `Empty`, `Locked`,
`Pending`, `Error`, `Retry`, `Conflict`, `Expired`, `Cancelled`, `Revoked` und
`Success`, soweit fachlich möglich. Kein UI darf Queueaufnahme als Zustellung,
Testmode als Zahlung, Scan-Pending als sauberes Dokument oder technischen
Readiness-Pass als Go-live bezeichnen. Fehler bleiben handlungsfähig und
enthalten keine Secrets/PII; jede erfolgreiche Meldung besitzt eine
nachgewiesene persistente Wirkung.

### 13. Mobile und Accessibility

Kritische Journeys laufen auf Chromium, Firefox und WebKit, Desktop, 360 px
und bei Kernseiten zusätzlich 320 px. Verbindlich sind Keyboard-only,
sichtbarer Fokus, Dialog-/Drawer-Fokusmanagement, Zoom/Reflow, Reduced Motion,
semantische Status-/Fehleransage und Axe. Abnahme: keine horizontale
Seitenüberläufe, abgeschnittenen CTAs, unbenutzbaren Tabellen/Dialoge oder
non-colour-only Statusanzeigen; Retries `0`.

### 14. Authentisierung, Step-up, Autorisierung und Tenant

Die Reihenfolge bleibt: Session/Identity → aktuelle Persona/Company → frische
Assurance/Step-up → Capability/Rolle → Tenant/Ownership/Assignment →
Entitlement/Featuregate → Repository/Provider. Direct Actions, manipulierte
IDs, Cross-Tenant/-Owner, entfernte/suspendierte Membership, stale Session,
stale/replayed/cross-purpose Step-up und falsche Provider-/Accountkontexte
bewirken null fachliche oder externe Wirkung und liefern sichere 404/403/
Conflict-Zustände nach dem bestehenden Vertrag.

### 15. Datenschutz, Retention, Export, Löschung und Audit

Production-Contractdaten bleiben synthetisch und getrennt von Demo-, Sandbox-
und Live-Provenienz. Logs, Responses, Screenshots, Reports und Buildartefakte
werden auf Secrets, PII und Providerpayloads geprüft. Vault, Privacy Export,
Correction/Erasure, Legal Hold, Reveal und Payment nutzen Zweckbindung,
Minimierung, Retention, single-use Grants, Reconciliation und vollständigen
Audit. Lokale Contract-Stubs zählen weder als Processor-Evidence noch als
reale Zustellung oder Löschung.

Der normale E-Mailpfad hält expliziten Empfänger und eingefrorenes Provider-
Requestmaterial höchstens 23 Stunden vor. Der zeilengebundene AES-v2-
Empfängerumschlag besitzt zusätzlich eine harte Obergrenze von 31 Tagen. Eine
minutenbasierte, providerunabhängige Maintenance vollzieht den Wipe auch bei
deaktivierter, abgelaufener oder widerrufener Provideraktivierung. Nach exakt
`400 × 24 h` werden `providerReceipt`, `providerRequestDigest`, Empfänger-Hash
und dessen Key-Version aus jedem Attempt einmalig entfernt; nicht-PII Status-,
Zeit- und Audit-Evidence bleibt erhalten. Die konkrete produktive
Aufbewahrung bleibt bis Privacy-/Legal-/DPA-Freigabe extern blockiert.

### 16. Abuse-, Fraud-, ATO- und Failure-Szenarien

Pflichtfälle sind IDOR, CSRF, Enumeration, Credential Stuffing, ATO,
kompromittierte Firma, Scam-/Duplicate-Job, Mass Contact/Messaging,
Reveal-/Export-Anomalie, manipulierte Preise/IDs/Cursor/Statusversionen,
Webhook-Signatur/Account/Mode/Replay/Out-of-order, Provider 400/401/409/429/
500/Timeout/Invalid Payload, malformed/oversized 2xx und konkurrierende
Idempotency, Worker-Crash/Leaseverlust/Poison/DLQ/Replay,
Upload MIME/Polyglot/Oversize/Malware/Hashkonflikt und Secret-/PII-Leak.

Jeder Negativfall belegt: null unautorisierte DB-/Providerwirkung, korrektes
Audit ohne Geheimnisse, bounded Retry/Rate Limit, sicheren Nutzerzustand und
einen reproduzierbaren Recoverypfad.
Unbekannte E-Mail-Provider-Ausgänge belegen zusätzlich bounded Same-Key-Retry,
anschließend `PAUSED`/manuelle Reconciliation und null Blind-Resend-/
Dead-Letter-Wirkung.

### 17. Externe und organisatorische Voraussetzungen

| Gate                                                     | Owner                               | Benötigte reale Evidence                                                                    | Wirkung bis dahin                                          |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AGB, Privacy, Impressum, DPA/Processor, DSG/AVG/AVV/SECO | Legal/Privacy                       | publizierte, versionierte CH-Texte und flowspezifischer Entscheid                           | öffentlicher betroffener Flow oder Launch bleibt blockiert |
| E-Mail/Storage/Scanner/Payment                           | Provider + Security/Privacy/Finance | Konto, Vertrag, Region/DPA, Domain/DNS, Secret-Version, Sandbox-/Stagingreceipt, Monitoring | Use Case bleibt `DISABLED`; Secret allein aktiviert nichts |
| Tax, VAT, Invoice, Refund/Dunning                        | Finance/Tax                         | signierte Policy und PSP-/Buchhaltungsreconciliation                                        | LC5 bleibt blockiert; LC4 Kaufpfade geschlossen            |
| Workerhost, Scheduler, Monitoring, Pager, SLO            | SRE/Ops                             | Zielruntime, Alerts, On-call, Outage-/Restart-/Capacity-Drill                               | unbeaufsichtigter Self-Service bleibt blockiert            |
| Backup/Restore/RPO/RTO/Incident                          | SRE/Business/Security               | Zielsystemrestore, genehmigte Schwellen und Incidentprobe                                   | tatsächliches Go-live bleibt blockiert                     |
| Cluster, Fachreview, WTP, Delivery, Capacity, Research   | Product/Commercial/Ops/Research     | reale, vorregistrierte und unabhängige Evidence                                             | keine PMF-/WTP-/Scale-/Paid-Go-Behauptung                  |

### 18. Harte Abhängigkeiten und Launchklassen

Phase 19 bleibt Baselinevertrag; Phase 32 bleibt historisches `NO_GO` und
Input für die technische Closure. Phase 20/21/23/24/25/26/29/30/31 besitzen
die Owning-Invarianten. LC5 erbt sämtliche LC4-Sicherheits-, Privacy-,
Operations- und Evidencepflichten und ergänzt Payment/Tax/Finance/WTP/
Delivery/Service-Recovery. LC4 hält Payment und jede Kauf-CTA serverseitig
geschlossen. Optionaler Scope wird nicht durch höhere Launchklasse automatisch
aktiviert.

### 19. Geordnete Implementierungs- und Audit-Schritte

1. **33A — vollständiger Audit:** Baseline, Migration-SHA, Requirements/
   Findings, Routen/Actions, Provider/Flags, Worker, Tests, Skips/Retry und
   Governance inventarisieren; Ledger klassifizieren.
2. **33B — Mock-/Sandbox-/Live-Parität:** Environment-/Provider-Modi,
   Activation Ledger, Live-Adaptercode, Fail-closed Composition, Feature-
   Sichtbarkeit und Failure-Contracts schließen.
3. **33C — lokale Production-Contract-Runtime:** gepinnte isolierte Compose-
   Profile mit App/OCI, Worker, Scheduler, TLS, PostgreSQL 16, S3, Scanner,
   Provider-Stubs, Healthchecks und Netzgrenzen liefern.
4. **33D — Rollen-/E2E-/Failure-Matrix:** komplette Wirkungsketten,
   Cross-Tenant/Action-Denials, Provider/Worker-Failures, drei Browser,
   360/320, Keyboard/Axe und Artefaktscans ausführen.
5. **33E — Remediation, Freeze und Release-Gate:** jeden bestätigten Fehler
   reproduzieren, minimal fixen, targeted und vollständige Regression neu
   laufen lassen, Candidate einfrieren, Digests erstellen und technisches/
   externes Urteil getrennt ausgeben.

### 20. Feature-Flags, Provider-Modi und Aktivierung

Die sichere Matrix verwendet `APP_ENV=local|ci|preview|staging|production`,
Use-Case-spezifische Modi `disabled|mock|sandbox|allowlist|live`, unabhängige
Capability-/Featuregates und das persistierte Activation Ledger. Local/CI darf
Mock verwenden und muss ihn sichtbar kennzeichnen. Staging darf nur explizit
freigegebene Sandbox/Allowlist-Verträge verwenden. Production akzeptiert für
sichtbare Funktionen ausschließlich `live`; Mock/Sandbox/Demo/`.invalid`,
lokales Dateisystem, abgelaufene/revokte/unhealthy Ledgereinträge und
ungebundene Secrets scheitern geschlossen.

Aktivierungsreihenfolge: externe Evidence → Ledger Draft → unabhängige
Approval/SoD → Contract-/Staging-Smoke → Health/Capacity → Allowlist → G4 auf
exaktem Candidate → ausdrücklicher Go-Entscheid → kontrollierte Flagpromotion.
Kill Switch, Revoke und Providerdegradation entfernen die sichtbare Wirkung
oder stoppen den Consumer sicher; sie schalten nie einen Mockfallback ein.
`RESEND_SECRET_VERSION` und `RESEND_WEBHOOK_SECRET_VERSION` werden unabhängig
gebunden und rotiert. Retention/Maintenance bleibt absichtlich
providerunabhängig und darf durch einen fehlenden oder widerrufenen
Provider-Ledgereintrag weder angehalten noch neu autorisiert werden.

### 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Alle 17 Zeilen sind auf dem unveränderten Candidate `d5f4646…` mit Exit `0`,
Fail `0`, unerklärten Skip `0` und Retry `0` belegt. Die vollständige
Command-, Digest- und GitHub-G4-Evidence steht im
[Phase-33-Record](./evidence/2026-08-05-phase-33.md).

| AC / Requirement                             | Risiko · LC4/LC5                   | Testart und Testfall                                                    | Positiv                                                                                                                                                                                                                                                                                           | Negativ/Abuse                                                                                                                                                                                                                             | Cross-Role/Tenant/IDOR                                                                 | Provider/Failure                                                                                                                                                                                                                       | Testdatei                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Exakter Befehl/Ablauf                                                                                                                | Messbare Abnahme                                                                                                                                                                                                             | Evidence                            | Owner                         | Status    |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- | --------- |
| `AC-33-01`, `REQ-GOV-001`                    | P0/P0 · Governance-Drift           | G0: Plan/Route/Test/Provider/Flag/Migration vollständig                 | alle Inventare stimmen                                                                                                                                                                                                                                                                            | unbekannt, doppelt, unreferenziert oder falsches Häkchen blockiert; Baseline-JSON allein wird nie vertraut                                                                                                                                | jede Rolle/Route genau klassifiziert                                                   | fehlender Provider/Handler blockiert                                                                                                                                                                                                   | `scripts/plan-evidence-audit.ts`, `scripts/route-inventory-audit.ts`, `scripts/phase33-audit.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `npm run plan:audit`; `npm run route:audit`; `npm run phase33:audit`                                                                 | 16/16 Phase-33-Auditchecks einschließlich `MIGRATION_BASELINE_ANCHORED_TO_GIT` und `PHASE_33_CI_G4_WORKFLOW`; 67 historische SHA direkt aus Baseline-Commit; 0 Drift/broken link/unklassifizierte Route/Action/Provider/Flag | Auditreports                        | Engineering + QA              | `PASS` |
| `AC-33-02`, `REQ-REL-032-003`                | P0/P0 · Migrationdrift             | SHA/Fresh/Upgrade/Legacy/Interrupted→Rollback→Restart/Idempotenz        | kompletter Deploy auf fresh und historisch vollständig migrierter Upgrade-DB; zweites Deploy bleibt idempotent                                                                                                                                                                                    | Test injiziert vor `COMMIT` absichtlich SQLSTATE `22012`; `ROLLBACK` muss 0 DDL-/Backfill-Teilwirkung hinterlassen                                                                                                                        | Tenant-/Legacydaten und Providerbindings bleiben getrennt                              | nach dem erzwungenen Abbruch migriert derselbe Upgradezustand normal und wiederholbar                                                                                                                                                  | `tests/integration/schema/phase33-payment-upgrade-migration-postgres.test.ts`; `tests/integration/billing/phase33-subscription-provider-ordering-postgres.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `npm run db:migrate`; `npm run db:migrate:status`; `npm run test:integration`                                                        | 67 alte SHA identisch; genau eine additive, explizit atomare Phase-33-Migration; nach Fehler 0 Teilwirkung, danach normaler Deploy + zweiter Deploy idempotent                                                               | Migration-Digestreport              | Data + Engineering            | `PASS` |
| `AC-33-03`, `REQ-INT-033-001`                | P0/P0 · Mock in Production         | Unit Env-/Mode-Matrix                                                   | freigegebenes Live-Mapping akzeptiert                                                                                                                                                                                                                                                             | Mock/Sandbox/Demo/`.invalid`, Secret-allein, fehlende Config scheitert                                                                                                                                                                    | Use-Case-/Environment-Crossbinding scheitert                                           | unhealthy/expired/revoked/kill switch scheitert                                                                                                                                                                                        | `tests/unit/config/phase33-provider-mode-matrix.test.ts`, `phase33-payment-mode-matrix.test.ts`, `phase33-storage-scanner-mode-matrix.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `npm run phase33:providers`                                                                                                          | 100 % erlaubte/verbotene Matrixzeilen deterministisch; 0 Fallback                                                                                                                                                            | Mode-Matrixreport                   | Security + Provider Owner     | `PASS` |
| `AC-33-04`, `REQ-INT-002`                    | P0/P0 · Ledger-Bypass              | Activation Ledger und Composition Roots                                 | exakte Binding aktiviert genau einen Use Case                                                                                                                                                                                                                                                     | incomplete/duplicate/stale/revoked Ledger wirkt 0                                                                                                                                                                                         | anderer Tenant/Use Case/Adapter erhält 0 Autorität                                     | Health-/Evidence-/Secretversion mismatch blockiert                                                                                                                                                                                     | `tests/unit/ops/phase33-provider-health-monitor.test.ts`; `tests/unit/ops/phase33-document-provider-binding.test.ts`; `tests/integration/documents/phase33-provider-authority-postgres.test.ts`; `tests/integration/billing/phase33-subscription-provider-lifecycle-postgres.test.ts`; `tests/integration/providers/email/resend-event-inbox-postgres.test.ts`                                                                                                                                                                                                                                       | `npm run providers:smoke`; `npm run phase33:providers`                                                                               | genau ein Ledgeroutcome je Use Case; 0 Crossactivation; 0 Secrets                                                                                                                                                            | Providerinventar/Queryreport        | Ops + Security + Fachowner    | `PASS` |
| `AC-33-05`, `STH-004`, `REQ-NOT-001`         | P0/P0 · E-Mail-Verlust/Falschclaim | Live-Adapter-, Key-, Retention-, Inbox-/Suppression- und Reconciliation-Vertrag gegen Stub/PostgreSQL | accepted + Receipt; bounded idempotente Zustellung; getrennte Delivery-AES-/Recipient-HMAC-Key-Versionen und unabhängige API-/Webhook-Secret-Versionen; gewöhnlicher 23-h-Wipe, AES-v2 maximal 31 d; Attempt-Kompaktion exakt nach `400 × 24 h` bei erhaltener nicht-PII Auditkette | 400/401/409/429/500/Timeout/invalid/bounce; network/5xx/408/malformed-2xx/concurrent-idempotency enden nach bounded Same-Key-Retry `PAUSED`; Keyring-/Secret-Version-Swap, verspäteter/duplizierter Webhook und Restore-/Mutationversuch werden fail-closed abgelehnt | fremder Recipient/Tenant/Template/Use Case abgelehnt; falsche Activation oder Key-Version bewirkt 0 Send/Projection | Crash/Duplicate/Retry ohne Doppelclaim; unbekannter Outcome nie Blind-Resend/Dead Letter; Webhook-Activation wird im selben TX gesperrt; Inbox/Suppression bleiben append-only/monoton; minutenbasierte Retention läuft providerunabhängig | `tests/unit/providers/email/legacy-local-mock-provider.test.ts`; `tests/unit/providers/phase33-resend-live-contract.test.ts`, `phase33-resend-webhook.test.ts`, `phase33-resend-webhook-route.test.ts`; `tests/unit/notifications/delivery-material.test.ts`, `provider-request-material.test.ts`; `tests/in…7440 tokens truncated…                          | Leaseverlust, Poison, Revoke und stale Fencing wirken nicht doppelt                                                                                                                                                                       | Handler/Ledger anderer Use Cases bleibt unberührt                                      | Provider outage→Retry/DLQ→Replay/Reconcile                                                                                                                                                                                             | `tests/unit/ops/heartbeat-loop.test.ts`, `worker-scheduler.test.ts`, `worker-service.test.ts`, `registered-handler-runtime.test.ts`, `phase33-runtime-roles.test.ts`; `tests/integration/ops/worker-runtime-postgres.test.ts`, `worker-effect-idempotency-postgres.test.ts`, `scheduled-domain-handlers-postgres.test.ts`                                                                                                                                                                                                                                                                            | `npm run worker:chaos`; `npm run worker:benchmark`; `npm run test:integration`                                                       | 10.000 Items/4 Worker; executable/manuell gleicher Service; Authority-Generation/Effect Receipt gebunden; 0 verloren/doppelt; bounded DLQ/Backlog                                                                            | Chaos-/Capacityreport               | Ops + Domain Owner            | `PASS` |
| `AC-33-06`, `STH-003/004/006`                | P0*/P0* · schädliche/private Datei | Storage-/Scanner-Contract                                               | Upload→Quarantäne→Scan→Clean Read/Export                                                                                                                                                                                                                                                          | MIME/Polyglot/Oversize/Malware/Hash/Timeout blockiert                                                                                                                                                                                     | cross-owner/-tenant/-grant read 0 Bytes                                                | Scanner/Storage outage, retry, revoke, reconcile                                                                                                                                                                                       | `tests/unit/providers/storage/phase33-s3-object-store-contract.test.ts`, `phase33-clamav-contract.test.ts`, `phase33-provider-authority-bound-store.test.ts`; `tests/integration/documents/phase33-provider-authority-postgres.test.ts`                                                                                                                                                                                                                                                                                                                                                              | `npm run documents:smoke`; `npm run phase33:providers`                                                                               | 0 ungescannte Reads, 0 fremde Bytes, 0 Secret/PII im Report                                                                                                                                                                  | S3-/Scannerstubreport               | Document + Privacy + Security | `PASS` |
| `AC-33-07`, `STH-005`, `REQ-PAY-001`         | P4/P0 · falsche Zahlung            | LC4 Closed + LC5 Payment Contract                                       | LC4 0 Kaufpfad; LC5 hosted Checkout→Webhook→Projection→Invoice                                                                                                                                                                                                                                    | manipulierte Preise, Signatur/Mode/Account, Replay/Out-of-order blockiert                                                                                                                                                                 | fremder Tenant/Order/Finance-Actor 0 Wirkung                                           | PSP 4xx/5xx/Timeout, post-provider DB-Fehler→Retry/Webhook, Reconcile, Dunning, Refund/Recovery                                                                                                                                        | `tests/unit/providers/payments/phase33-stripe-mode-contract.test.ts`, `phase33-stripe-http-contract.test.ts`, `phase33-payment-webhook-route.test.ts`, `payment-provider-contract.test.ts`; `tests/integration/billing/phase33-checkout-authority-postgres.test.ts`, `phase33-subscription-provider-lifecycle-postgres.test.ts`, `phase33-subscription-provider-ordering-postgres.test.ts`, `phase33-payment-recovery-postgres.test.ts`, `real-payment-lifecycle-postgres.test.ts`, `reconciliation-postgres.test.ts`; `tests/integration/schema/phase33-payment-upgrade-migration-postgres.test.ts` | `npm run phase33:providers`; `npm run test:integration`                                                                              | LC4 0 Checkout; LC5 exactly-once Authority/Inbox/Ledger/Entitlement, stabile Alias-/Renewal-/Refund-Lineage und 0 falsche Invoice                                                                                            | PSP-stub/ledgerreport               | Billing + Finance + Security  | `PASS` |
| `AC-33-08`, `REQ-OPS-033-001`                | P0/P0 · Demo-Regression            | Docker `local/mock`                                                     | Seed/Mock-Demo vollständig und sichtbar                                                                                                                                                                                                                                                           | externe Provider-/Liveclaim/Demo in Production 0                                                                                                                                                                                          | Fixtures bleiben isolierte Tenants                                                     | Mockfailure zeigt ehrlichen Fehler                                                                                                                                                                                                     | `compose.phase33.yml`; `scripts/phase33-compose.ts`; `scripts/phase33-local-bootstrap.ts`; `scripts/phase33-local-smoke-internal.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `npm run phase33:runtime:config:local`; `npm run phase33:runtime:up:local`; `npm run phase33:runtime:down:local`                     | alle Healthchecks grün; Seedmanifest identisch; 0 externe Effekte                                                                                                                                                            | Compose-/Seedreport                 | Engineering + QA              | `PASS` |
| `AC-33-09`, `REQ-OPS-033-001`                | P0/P0 · unrealistische Runtime     | Docker `production-contract`                                            | PG16, OCI/Standalone-App, Worker, Scheduler, TLS, S3, Scanner, Stubs healthy                                                                                                                                                                                                                      | fehlender Service/Health/Netzgrenze/Config blockiert                                                                                                                                                                                      | getrennte DBs/Volumes/Netze, keine Localdaten                                          | Restart, Dependency outage und TLS/Proxy-Hop fail-closed                                                                                                                                                                               | `compose.phase33.yml`; `scripts/phase33-compose.ts`; `scripts/phase33-contract-bootstrap.ts`; `scripts/phase33-contract-smoke-internal.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `npm run phase33:runtime:config:contract`; `npm run phase33:runtime:smoke:contract`; `npm run phase33:runtime:down:contract`         | 100 % required Services healthy; HTTPS/Secure Cookie/HSTS/Readiness korrekt                                                                                                                                                  | Compose-/Image-/TLSreport           | SRE + Security                | `PASS` |
| `AC-33-10`, `REQ-QA-033-001`                 | P0/P0 · Public/Candidate Sackgasse | neue Discovery/Save/Alert-Reise plus bestehende Candidate-Owner-Reisen  | Phase-33-Spec: Discovery→private Save→owned Alert; bestehende Specs: Identity, Apply/Message, Vault, Radar und Privacy                                                                                                                                                                            | Replay/Role-Denial im neuen Spec; Empty/Conflict/Expired/Revoked in Owning-Specs                                                                                                                                                          | Employer erhält 403/0 Alert-Leak; bestehende Owner-/Radar-IDOR bleiben bindend         | Outbox-/Vault-/Privacy-Failures über Owning-Specs/PG                                                                                                                                                                                   | `tests/e2e/flows/phase33-public-candidate.spec.ts`; `phase17-journeys.spec.ts`; `phase17-talent-radar.spec.ts`; `phase20-identity-email.spec.ts`; `phase21-document-vault.spec.ts`; `phase22-privacy-rights.spec.ts`; dazu Candidate-/Document-/Privacy-PG-Suites                                                                                                                                                                                                                                                                                                                                    | `npm run phase33:e2e`; `npm run test:e2e:browser`; `npm run test:integration`                                                        | neue Spec: genau ein Save und Alert, 0 Rollenleck; Gesamtclaim nur bei grüner bestehender Browser-/PG-Suite; drei Engines, Fail/Skip/Retry 0                                                                                 | Playwrightreport/DB assertions      | Candidate + QA                | `PASS` |
| `AC-33-11`, `REQ-QA-033-001`                 | P0/P0 · Employer/Recruiter IDOR    | neue Recruiter-Message/IDOR-Reise plus bestehende Employer-Owner-Reisen | Phase-33-Spec: zugewiesener Recruiter sendet genau einmal; bestehende Specs: Onboarding, Team/Persona, Job Publish, Application/Pipeline und Interview                                                                                                                                            | falsches Assignment/Tenant 404 und 0 Wirkung; stale Version/Limit/Status in Owning-Specs                                                                                                                                                  | same-tenant unassigned und cross-tenant Application 0 Read/Write                       | neue Spec belegt Message+Event+Notification+Outbox+Audit; übrige Failures in Owning-Specs/PG                                                                                                                                           | `tests/e2e/flows/phase33-employer-recruiter.spec.ts`; `phase17-employer-publish.spec.ts`; `phase17-journeys.spec.ts`; `phase17-billing.spec.ts`; `phase27-persona-switch.spec.ts`; `phase28-interview-scheduler.spec.ts`; `tests/integration/employer/applications-postgres.test.ts`; `employer/jobs-postgres.test.ts`; `employer/team-invitations-postgres.test.ts`; `recruiting/recruiting-authorization-postgres.test.ts`                                                                                                                                                                         | `npm run phase33:e2e`; `npm run test:e2e:browser`; `npm run test:integration`                                                        | neue Spec: 1 Message/Event/Notification/Outbox/Audit und 0 IDOR; breiter Company/Team/Job/Pipeline-Claim nur bei grünen Owning-Suites                                                                                        | Journeyreport                       | Employer + QA                 | `PASS` |
| `AC-33-12`, `REQ-ADM-007`, `REQ-QA-033-001`  | P0/P0 · Privilege Escalation       | neue Support-Triage/Capability-Reise plus bestehende Admin-Fachreisen   | Phase-33-Spec: Supportfall→Capability-Operator→Triage; bestehende Specs: Privacy, Finance, Ops, Assurance/SoD und Trust                                                                                                                                                                           | unrelated Security-Admin 404/0 PII; direct Action/stale/replay/self-approval/Break-glass in Owning-Specs                                                                                                                                  | Support/Moderation/Finance/Privacy bleiben durch Capability-/SoD-Suites getrennt       | neue Spec belegt Case+Event+Notification+Audit; Queue/Reconcile/Recovery über Owning-Specs/PG                                                                                                                                          | `tests/e2e/flows/phase33-privileged-operations.spec.ts`; `phase17-admin-abuse.spec.ts`; `phase22-privacy-rights.spec.ts`; `phase23-ops-control.spec.ts`; `phase24-paid-checkout.spec.ts`; `phase25-admin-assurance.spec.ts`; `phase25-trust-safety.spec.ts`; `tests/integration/admin/admin-grants-postgres.test.ts`; `admin-sod-breakglass-postgres.test.ts`; `ops/ops-authorization-postgres.test.ts`                                                                                                                                                                                              | `npm run phase33:e2e`; `npm run test:e2e:browser`; `npm run test:integration`                                                        | neue Spec: genau eine Triage/Notification/Audit und 0 fremde Case-/PII-Sicht; breiter Fachrollenclaim nur bei grünen Owning-Suites                                                                                           | Capability-/Auditreport             | Security + Fachowner          | `PASS` |
| `AC-33-13`, `STH-009`, `REQ-OPS-005`         | P0/P0 · Doppel-/verlorene Wirkung  | Worker Chaos/Load/Recovery                                              | before-/after-effect Crash, Restart, Rolling Deploy recovered                                                                                                                                                                                                                                     | Leaseverlust, Poison, Revoke und stale Fencing wirken nicht doppelt                                                                                                                                                                       | Handler/Ledger anderer Use Cases bleibt unberührt                                      | Provider outage→Retry/DLQ→Replay/Reconcile                                                                                                                                                                                             | `tests/unit/ops/heartbeat-loop.test.ts`, `worker-scheduler.test.ts`, `worker-service.test.ts`, `registered-handler-runtime.test.ts`, `phase33-runtime-roles.test.ts`; `tests/integration/ops/worker-runtime-postgres.test.ts`, `worker-effect-idempotency-postgres.test.ts`, `scheduled-domain-handlers-postgres.test.ts`                                                                                                                                                                                                                                                                            | `npm run worker:chaos`; `npm run worker:benchmark`; `npm run test:integration`                                                       | 10.000 Items/4 Worker; executable/manuell gleicher Service; Authority-Generation/Effect Receipt gebunden; 0 verloren/doppelt; bounded DLQ/Backlog                                                                            | Chaos-/Capacityreport               | Ops + Domain Owner            | `PASS` |
| `AC-33-14`, `STH-023`, `REQ-QA-003`          | P0/P0 · Browser/A11y Bruch         | 3 Browser + Mobile + Axe                                                | Kernreisen funktional und semantisch gleich                                                                                                                                                                                                                                                       | Console/Network/Overflow/Fokus-/Label-/Statusfehler blockiert                                                                                                                                                                             | Rollen-/Locked-Zustände gleichwertig                                                   | Failure UI ohne falschen Success                                                                                                                                                                                                       | `tests/e2e/flows/phase33-public-candidate.spec.ts`, `phase33-employer-recruiter.spec.ts`, `phase33-privileged-operations.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `npm run phase33:e2e`; `npm run test:e2e:browser`                                                                                    | Chromium/Firefox/WebKit; 360/320; Axe critical/serious 0; Retry 0                                                                                                                                                            | HTML-/Screenshot-/A11yreport        | UX + QA                       | `PASS` |
| `AC-33-15`, `STH-024`, `REQ-REL-032-003/004` | P0/P0 · Evidence-Drift             | Freeze/Clean Clone/Full Gate                                            | Tree, Lockfile, Migration, Config, Provider, OCI/Standalone und Evidence identisch                                                                                                                                                                                                                | Dirty Tree, anderer Digest, stale/partial/symlink/hardlink/overwrite Output, Fail/Skip oder ungemessene Nullmetriken blockiert                                                                                                            | alle Rollen auf demselben Candidate                                                    | Failure-/Recoveryreports an Candidate gebunden                                                                                                                                                                                         | `scripts/phase33-test-report.ts`; `lib/release/phase33-test-report-contract.ts`; `.github/workflows/phase33-g4.yml`; `tests/unit/release/phase33-test-report-contract.test.ts`, `phase33-ci-workflow-contract.test.ts`, `phase33-release-files.test.ts`, `phase33-artifact.test.ts`, `phase33-oci-identity.test.ts`, `phase33-process-invocation.test.ts`, `phase33-recovery-evidence.test.ts`; `tests/unit/security/sensitive-data-registry.test.ts`                                                                                                                                                | `npm run test:phase33`; statischer CI-Workflowvertrag                                                                                | Exit 0; 38/38 Pflichtbefehle; Fail/unerklärte Skip 0; alle Digests identisch; LC4+LC5 aus demselben Report; 0 Secret/PII; Activation extern blockiert                                                                        | finales G4-Technikmanifest          | Release Manager + QA          | `PASS` |
| `AC-33-16`, `REQ-REL-033-001`                | P0/P0 · falsches Go-live           | Verdictpolicy und External Ledger                                       | technischer Pass gibt nur zulässiges Readinessurteil                                                                                                                                                                                                                                              | fehlende externe Evidence verhindert `GO_LIVE_APPROVED`                                                                                                                                                                                   | kein einzelner Owner approvet eigenen sensiblen Scope                                  | Provider-/Legal-/Ops-Gate bleibt explizit extern                                                                                                                                                                                       | `lib/release/phase33-release-verdict.ts`; `tests/unit/release/phase33-release-verdict.test.ts`; `scripts/phase33-technical-manifest.ts`; `scripts/phase33-release-gate.ts`                                                                                                                                                                                                                                                                                                                                                                                                                           | `npm run phase33:manifest`; `npm run phase33:release:technical`; `npm run phase33:release:activation` (erwartet Exit `2`)            | genau ein technisches Urteil plus getrenntes Activationurteil; jeder Blocker mit Owner/Evidence/Wirkung                                                                                                                      | Findings-/External-Gate-Ledger      | Release + externe Owner       | `PASS` |
| `AC-33-17`, `STH-006`, `REQ-PRIV-004`        | P0/P0 · Privacy-Scheinwirkung      | Persistierte Approval→Queue→Worker→Artifact-/Notification-Kette         | Verifier gibt Fall frei; Processor fordert mit gebundenem Step-up an; unabhängiger Processor gibt mit zweitem Step-up frei; genau ein WorkItem führt EXPORT/CORRECT/DELETE resumierbar aus; Kandidat lädt Export nach vollständiger Storage-Prüfung mit eigenem artifact-bound Single-use-Step-up | Self-Approval, freie Evidence-Refs, stale Version/Config/Capability, falscher Request/Approval/Artifact/Release-Key, zweiter Download und deaktivierter/revokter Provider bewirken 0 Wirkung; ungültiger Step-up verändert den Case nicht | Verifier≠Processor, Requester≠Approver; fremder Admin/Kandidat erhält 0 WorkItem/Bytes | Storageausfall löst Download-CAS-Lease ohne Consume; COMMITTED Recovery rekonstruiert immutable Receipt; DELETE-Faults nach Staging/Anonymisierung/Outcome/Complete→Retry→genau ein Effekt; Status/Event/Audit/Outbox committen atomar | `tests/unit/privacy/phase33-privacy-worker-policy.test.ts`; `tests/integration/privacy/phase33-privacy-approval-worker-postgres.test.ts`, `phase33-privacy-delete-notification-postgres.test.ts`, `privacy-case-service.test.ts`; `tests/integration/ops/worker-effect-idempotency-postgres.test.ts`; `tests/unit/providers/storage/phase33-provider-authority-bound-store.test.ts`; `scripts/phase33-contract-smoke-internal.ts`                                                                                                                                                                    | gezielte Unit-/PostgreSQL-Suites; `npm run test:integration`; `npm run phase33:runtime:smoke:contract`; final `npm run test:phase33` | 2 unabhängige verbrauchte Step-ups; 1 Approval; 1 WorkItem/Execution/Artifact/Effekt; Retry/Replay/Recovery ohne Doppelwirkung; Download genau einmal erst nach SHA/Size/Body-Prüfung; Outbox nicht verloren                 | Approval-/Worker-/DB-/S3-Assertions | Privacy + Security + Ops      | `PASS` |

### 22. Performance-, Skalierungs-, SLO-, RPO- und RTO-Grenzen

Phase 33 misst mindestens App-Boot/Readiness, Provider-Timeout-/Retrybudgets,
Worker-Queuealter/-Durchsatz, Uploadgrößen/Scanzeit, DB-Pool-/Statement-
Timeouts, Public Search/Detail/Homepage, Sitemap und Artefaktgröße. Bestehende
Owning-Schwellen bleiben bindend; sie werden nicht pauschal erhöht. Der
Worker-Benchmark bleibt 10.000 Items mit vier Workern und null verlorener oder
doppelter fachlicher Wirkung.

Diese Messbereiche stammen nicht alle aus `npm run phase33:scale`. Der
Phase-33-Scale-Command persistiert und strukturiert ausschließlich den
aktuellen Candidate-/Seedumfang, Sitemap-URLzahl/-Bytes/-Laufzeit, 7-/30-Tage-
Wachstumsbasis und 90-Tage-Forecast, Sitemap-Headroom/-Schwellen sowie die
Auslastung des ersten 500er-Cluster-Evaluationsbatches. Er simuliert weder
50.000 Jobs/URLs noch einen vollständigen Boot-/Search-/Upload-/Provider-p95-
Lasttest. Die übrigen Owning-Commands liefern nur ihre jeweils dokumentierten
Schwellen; echte Zielumgebungs- und Volumenmessung bleibt vor Aktivierung
extern erforderlich.

Offene Cluster-500er-Batchzählung und nichtindexierte Teilstringsuche dürfen
nur `DEFERRED_MONITORED` bleiben, wenn aktueller Istwert, Headroom,
90-Tage-Forecast, Warn-/Blockschwelle, Owner und Reaktionsplan belegt sind.
RPO/RTO-Hypothesen oder lokale Restorezeiten werden nicht als genehmigtes
Production-SLO ausgegeben.

### 23. Geschützte Phase-01–18-Invarianten

Unverändert geschützt bleiben Auth/Session/safe-next, Tenant/Ownership/
Assignment/sichere 404, Candidate Apply/Status/Messages/Alerts, Radar-
Anonymität/Reveal, Billing/Ledger/Entitlements/Boost, Job Publish/Moderation/
Eligibility, Search/Sponsored/SEO/Sitemap, Privacy/Consent, Audit/Rate Limit/
Redaction/CSP sowie Seed/Migration/Recovery. Insbesondere darf der absichtliche
SQL-/JS-Ranking-Paritätswächter aus ADR-003 nicht entfernt oder abgeschwächt
werden. Historische Phase-01–18-Dateien und Evidence bleiben bytegenau
unverändert; Owning-Suites werden auf dem Phase-33-Candidate neu ausgeführt.

### 24. Rollback / Roll-forward

Reversible Adapter-/Config-/Flagänderungen nutzen Kill Switch, Ledger-Revoke
und Rückkehr zum bewusst `disabled` Vorgänger — niemals einen Production-
Mockfallback. Das vorige kompatible OCI-/Standalone-Artefakt wird mit Digest
und DB-Kompatibilitätsfenster benannt. Vor einem irreversiblen Contract erfolgt
Restore-Evidence; bereits externe Providerwirkungen, Privacy-Löschung,
Zahlungen/Webhooks und irreversible Migrationen werden ausschließlich per
Roll-forward/Reconciliation behandelt.

Jeder Fix nach Freeze erzeugt einen neuen unveränderlichen Candidate und
invalidiert alle betroffenen Gates; der vollständige Phase-33-Abschlusslauf
beginnt erneut.

### 25. Evidence

Der neue Record
`codex-plan/evidence/YYYY-MM-DD-phase-33.md` enthält Basis- und Endcommit,
Branch/Remote, Tool-/DB-/Browser-/Imageversionen, alte Migration-SHAs und neue
Migrationen, getestete DB-Zustände, beide Composeprofile, jede Commandline mit
Exit/Dauer/Testzahlen, initiale Fehler/Root Causes/Fixes/Re-Runs, Rollen-/
Journey-/Browser-/Viewportmatrix, Provider-/Worker-/Failureberichte,
Standalone-/OCI-/Config-/Provider-/Migration-Digests sowie alle externen Gates
mit Owner, benötigter Evidence und sicherem deaktiviertem Zustand.

Für `AC-33-05` enthält der Record zusätzlich das vollständige Delivery-/
Recipient-Hash-Key-Version-Inventar, getrennte Resend-API-/Webhook-
Secret-Versionen, die 23-h-/31-d-/exakt-400×24-h-Grenzläufe, den
providerunabhängigen Minuten-Maintenance-Nachweis, Inbox-/Suppression-
Monotonie, den Webhook-Activation-TX-Lock und jeden unbekannten Provider-
Ausgang bis `PAUSED`/manueller Reconciliation. Nur tatsächlich gelaufene,
exakt referenzierte Tests dürfen dort ein Resultat erhalten.

Lokale Stubs, Sandboxreceipts, synthetische Daten und ältere Evidence werden
ausdrücklich als solche bezeichnet. Der historische Phase-18-Buildreport und
die Phase-32-Evidence werden nicht überschrieben oder rückwirkend aufgewertet.

### 26. Definition of Done

- 100 % der Phase-33-AC-Zeilen sind auf demselben Candidate `PASS` oder bei
  nicht aktivierter optionaler Funktion begründet `N/A` plus serverseitig
  `DISABLED`;
- alle LC4-/LC5-technischen P0/P1-Findings sind `CLOSED` oder ausschließlich
  durch echte externe Evidence `EXTERNAL`; technische Lücken werden nicht als
  extern kaschiert;
- vollständiger Install-/Env-/Migration-/Seed-/Plan-/Route-/Security-/License-/
  Unit-/Integration-/Build-/HTTP-/HSTS-/Browser-/Worker-/Provider-/Recovery-
  Lauf besitzt Exit `0`, Fail `0`, unerklärte Skip `0`, Retry `0`, unhandled
  Rejections `0`, Console Errors `0`, Cross-Tenant-Leaks `0` und Secret-/PII-
  Funde `0`;
- 67 historische Migration-SHAs bleiben identisch; Candidate, Tree, Lockfile,
  Config, Provider, Migration, Standalone/OCI und Evidence sind digestgebunden;
- `local/mock` und `production-contract` sind reproduzierbar und isoliert;
- der vollständige `AC-33-05`-Key-/Retention-/Unknown-Outcome-Vertrag ist auf
  demselben unveränderlichen Candidate belegt; keine offene Key-Version,
  Blind-Resend-/Dead-Letter-Wirkung oder vorzeitige/verspätete Kompaktion
  bleibt;
- LC4 Kaufpfade sind geschlossen; LC5-Live-Adaptercode ist technisch ohne
  weiteren Codewechsel konfigurierbar;
- Evidence, Findings Ledger, Governance und Abschlussurteil sind aktuell und
  widerspruchsfrei.

### 27. Folgephase und Aktivierungsgate

Phase 33 besitzt keine automatische Produktfolgephase. Ein technischer Pass
erlaubt ausschließlich die externe Konfiguration und einen neuen Staging-/G4-
Candidate. Provider-, Flag-, Scope-, Cluster-, Preis-, Policy-, Migration-,
Secret- oder Artefaktänderungen nach dem Pass invalidieren das Urteil.

`GO_LIVE_APPROVED` erfordert zusätzlich die für den konkreten Scope vollständige
Provider-, Legal-, Privacy-, AVG-, Tax-, Finance-, Operations-, Staging-,
Rollback-, Monitoring-, Research-/WTP-/Capacity- und unabhängige Approval-
Evidence auf genau demselben deployten Artefakt. Bis dahin lautet der
Aktivierungsstatus `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`.

Das repositoryeigene Phase-33-CLI wertet ein External Ledger deshalb nur als
strukturell vollständige, **nicht authentifizierte** Deklaration und kann selbst
niemals `GO_LIVE_APPROVED` ausgeben. Auch bei vollständigen Feldern bleibt der
Blocker `PROTECTED_EXTERNAL_ATTESTATION_REQUIRED`. Das eigentliche Approval
muss in einer geschützten Deployment-Control erfolgen, die unabhängig
provisionierte Identitäten beziehungsweise Signaturen prüft; candidate-
kontrolliertes JSON, Namen oder Evidence-Strings sind keine Autorität.

### 28. Ausdrücklich nicht bewiesen

Ein grüner Phase-33-Techniklauf beweist keinen Product-Market-Fit, keine
Zahlungsbereitschaft oder reale Delivery, keine rechtliche/steuerliche
Freigabe, keine Provider-SLA oder Domainreputation, keine genehmigte
Operationskapazität/RPO/RTO, keine tatsächliche Staging-/Production-
Deploymentidentität und keine nationale Skalierbarkeit. Contract-Stubs sind
keine Livezustellung, Sandboxzahlungen kein Umsatz, synthetische Daten keine
Marktnachfrage und Automation ersetzt keine moderierte Nutzer-, Screenreader-
oder externe Fachprüfung.

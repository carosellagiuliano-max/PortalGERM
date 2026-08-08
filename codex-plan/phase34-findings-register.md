# Phase-34-Findingsregister

> **Arbeitsstand:** technisch abgeschlossene Verifikation auf Startbaseline
> `f60db6a35dd7225fadbc8f6aa1cb3551251685c5` und dem technisch geprüften
> Phase-34-Candidate-Digest
> `a3a28db00a2f46a0121d77f73125aefb4f9a9b3429ec0f6a09aabaf812d8526a`.
> `FIXED` bezeichnet einen positiven und negativen Nachweis auf genau diesem
> Candidate. Der [datierte Abschlussrecord](./evidence/2026-08-07-phase-34.md)
> hält die vollständigen Befehle und Grenzen fest; die Aktivierung bleibt
> wegen der externen Gates ausdrücklich `NO_GO`.
> Die Detailrecords bewahren ihre anfängliche und zwischenzeitliche
> Klassifikation als Auditspur. Der aktuelle Endstatus jedes Findings steht
> im Index und in Abschnitt 14; er ersetzt dortige Zwischenformulierungen wie
> „ausstehend“ oder `IMPLEMENTED_E2E_PENDING`.

## 1. Quellen, Leseregeln und Status

- **R:** externe Review-Eingabe
  `e6e63495-ae9e-4d82-ab23-4f44f5a1152e/pasted-text.txt`. Sie ist eine
  Hypothesenquelle, keine Wahrheit.
- **A:** verbindlicher Phase-34-Auftrag
  `3d0611b4-3ae9-4f94-a088-681b06b25686/pasted-text.txt`, insbesondere dessen
  Mindestprüfumfang A–I.
- **N:** während der aktuellen Code-, Datenbank- oder Planprüfung neu
  entdeckter Befund.
- **Bestehende Evidence** bezeichnet einen reproduzierbaren Code-/Test-/Plan-
  Beleg. **Abschließende Evidence** bezeichnet ausschließlich einen Nachweis
  auf dem letzten unveränderten Candidate. Wo dieser Lauf fehlt, steht
  ausdrücklich `ausstehend`.
- Zulässige Prüfstatus sind die im Auftrag vorgegebenen Werte. Ein
  Verbesserungsvorschlag steht separat in Abschnitt 12 als `PROPOSAL` und
  erhält nicht allein durch seine Erwähnung den Status eines Fehlers.

## 2. Kompaktindex

| ID                | Kurzbezeichnung                                                                | Risiko          | Prüfstatus                |
| ----------------- | ------------------------------------------------------------------------------ | --------------- | ------------------------- |
| `F34-BASE-001`    | Review-Zahlen und Deployment-Snapshot                                          | P2              | `OBSOLETE`                |
| `F34-BASE-002`    | Produkt-, Rollen- und Featurebeschreibung                                      | P1 Activation   | `FIXED`                   |
| `F34-ARCH-001`    | fail-closed Doppelprüfung ist Absicht, Drift nicht                             | P0 Runtime      | `FIXED`                   |
| `F34-GOV-001`     | abgeschnittene Phase-33-AC-Matrix                                              | P0 Governance   | `FIXED`                   |
| `F34-GOV-002`     | Plan-Audit akzeptierte beschädigte Evidence                                    | P0 Governance   | `FIXED`                   |
| `F34-GOV-003`     | weitere fehlerhafte normative Tabellen                                         | P1 Governance   | `FIXED`                   |
| `F34-GOV-004`     | aktuelles Routen-/Handlerinventar driftete                                     | P1 Governance   | `FIXED`                   |
| `F34-GOV-005`     | geschlossenes Ledger versus aktuelles Inventar                                 | P1 Governance   | `DUPLICATE`               |
| `F34-GOV-006`     | freie String-Statusfelder verletzen ADR-007                                    | P1              | `FALSE_POSITIVE`          |
| `F34-GOV-007`     | ältere und neuere Provider-/Worker-ADRs widersprechen sich                     | P1 Governance   | `FIXED`                   |
| `F34-GOV-008`     | Phase 32/33 seien abgeschlossen oder go-live-fähig                             | P0 Activation   | `FALSE_POSITIVE`          |
| `F34-REPO-001`    | lokale `.vercel/`-Metadaten im Worktree                                        | P2 Governance   | `FIXED`                   |
| `F34-COM-001`     | Commercial-Gates werden nicht von Runtime konsumiert                           | P1 Product      | `FIXED`                   |
| `F34-LEG-001`     | unveröffentlichte Rechtstexte bei offener Registrierung                        | P0 Legal        | `OBSOLETE`                |
| `F34-LEG-002`     | AVG-/AVV-Entscheid fehlt im Talent-Radar-Runtimepfad                           | P0 Legal        | `FIXED`                   |
| `F34-LEG-003`     | Stellenmeldepflicht pauschal fünf Arbeitstage                                  | P0 Legal        | `BLOCKED_EXTERNAL`        |
| `F34-LEG-004`     | Minderjährigenschutz bei Lehrstellen nicht freigegeben                         | P0 Legal        | `BLOCKED_EXTERNAL`        |
| `F34-LEG-005`     | Moderation ohne verbindliche Rechts-/Policykriterien                           | P1 Legal        | `BLOCKED_EXTERNAL`        |
| `F34-LEG-006`     | Retention, DSFA, Auslandtransfers und DPA offen                                | P0 Privacy      | `BLOCKED_EXTERNAL`        |
| `F34-LEG-007`     | öffentliche Lead-/Abuse-Erfassung ohne aktuelle Publikationsbindung            | P1 Privacy      | `FIXED`                   |
| `F34-LEG-008`     | Impressum/AGB/PBV-Anforderungen seien pauschal abschließend bekannt            | P1 Legal        | `BLOCKED_EXTERNAL`        |
| `F34-TAX-001`     | MWST-Rechnung sei allein durch 8,1 % rechtlich freigegeben                     | P0 Finance      | `BLOCKED_EXTERNAL`        |
| `F34-COMPANY-001` | `CompanyStatus.CLOSED` ohne ausführbaren Offboardingpfad                       | P1 Runtime      | `FIXED`                   |
| `F34-A11Y-001`    | WCAG-Version/-Stufe und reale AT-Abnahme                                       | P1 Quality      | `BLOCKED_EXTERNAL`        |
| `F34-PAY-001`     | Payment-/Incident-Runbooks sind historisch unvollständig                       | P1 Operations   | `FIXED`                   |
| `F34-PAY-002`     | Mock-Checkout kann außerhalb Local/CI Rechte erteilen                          | P0 Runtime      | `FIXED`                   |
| `F34-PAY-003`     | Abo und Einmalkauf besitzen versteckte, divergente Composition Roots           | P0 Runtime      | `FIXED`                   |
| `F34-PAY-004`     | Mock- und Live-Finanzereignisse können vermischt werden                        | P0 Finance      | `FALSE_POSITIVE`          |
| `F34-PAY-005`     | globaler Mock-Mailer wird in echten Billing-Flows benutzt                      | P1 Runtime      | `OBSOLETE`                |
| `F34-PAY-006`     | Environment, Adapter und Activation Ledger sind nicht zentral gebunden         | P0 Runtime      | `FIXED`                   |
| `F34-PAY-007`     | unklare Providerantworten oder Retries erzeugen Doppelwirkung                  | P0 Finance      | `FALSE_POSITIVE`          |
| `F34-PAY-008`     | Contract-/Sandbox-Zahlung sei als reale Kauf-Evidence belegt                   | P0 Activation   | `BLOCKED_EXTERNAL`        |
| `F34-PAY-009`     | Entitlements können ohne gültiges Zahlungsereignis entstehen                   | P0 Finance      | `FIXED`                   |
| `F34-SEARCH-001`  | SQL- und kanonische Trust-Prüfung driften                                      | P0 Runtime      | `FIXED`                   |
| `F34-SEARCH-002`  | Startseite lädt 2.001 Jobs für sechs Karten                                    | P1 Scale        | `FIXED`                   |
| `F34-SEARCH-003`  | Clusterzählung scannt alle Jobs in Batches                                     | P1 Scale        | `FIXED`                   |
| `F34-SEARCH-004`  | Startseite erschöpft durch Fan-out den DB-Pool                                 | P1 Scale        | `FIXED`                   |
| `F34-SEARCH-005`  | Stichwortsuche hat keinen nutzbaren Index                                      | P1 Scale        | `FIXED`                   |
| `F34-SEARCH-006`  | jede Suchseite führt einen unbounded `COUNT(*)` aus                            | P2 Scale        | `FIXED`                   |
| `F34-SEARCH-007`  | Pooler verwirft Timeout-Optionen oder PG17 ändert Semantik                     | P1 Operations   | `BLOCKED_EXTERNAL`        |
| `F34-SEARCH-008`  | `force-dynamic` und tote Modelle verursachen belegten Defekt                   | P2              | `FALSE_POSITIVE`          |
| `F34-SEARCH-009`  | fehlende Error Boundary legt Suchoberfläche vollständig lahm                   | P1 UX           | `FIXED`                   |
| `F34-SEARCH-010`  | Trust-Ablauf/Revoke verursacht globalen Suchausfall                            | P0 Runtime      | `FIXED`                   |
| `F34-DATA-001`    | öffentliche Antwortquoten stammen aus nie gepflegten Seed-Feldern              | P1 Truth        | `FIXED`                   |
| `F34-OPS-001`     | Worker-Runbook nennt falschen HMAC-Keyring                                     | P0 Operations   | `FIXED`                   |
| `F34-OPS-002`     | Worker-Readiness bleibt nach Hänger grün                                       | P1 Runtime      | `FIXED`                   |
| `F34-OPS-003`     | Provider-Inbox-Age/Projector-Health fehlten                                    | P1 Runtime      | `FIXED`                   |
| `F34-OPS-004`     | Payment-Recovery scannt fremde Environments                                    | P1 Isolation    | `FIXED`                   |
| `F34-OPS-005`     | Deploy führt Migrationen nicht aus und Readiness wird nicht abgefragt          | P0 Operations   | `BLOCKED_EXTERNAL`        |
| `F34-OPS-006`     | es existiert kein Worker-/Scheduler-Artefakt                                   | P0 Runtime      | `OBSOLETE`                |
| `F34-OPS-007`     | es existiert kein Live-E-Mail-Adapter                                          | P0 Runtime      | `OBSOLETE`                |
| `F34-OPS-008`     | Monitoring/Pager fehlen, Fehlerursachen sind unsichtbar                        | P0 Operations   | `BLOCKED_EXTERNAL`        |
| `F34-OPS-009`     | `/health/live` und `/health/ready` fehlen                                      | P1 Operations   | `FALSE_POSITIVE`          |
| `F34-OPS-010`     | Backup/Restore, Ziel-PG und Staging sind nicht real belegt                     | P0 Operations   | `BLOCKED_EXTERNAL`        |
| `F34-OPS-011`     | historische/destruktive Migrationen und Expand/Contract                        | P1 Data         | `FIXED`                   |
| `F34-OPS-012`     | Scans, Retention und Abläufe laufen nirgends                                   | P0 Runtime      | `OBSOLETE`                |
| `F34-OPS-013`     | Resend-Event-Inbox hatte keinen autonomen Retry-/DLQ-Handler                   | P1 Runtime      | `FIXED`                   |
| `F34-OPS-014`     | Production-HSTS-Smoke erzeugte eine vom aktuellen Auth-Vertrag abgelehnte Env | P1 Operations   | `FIXED`                   |
| `F34-OPS-015`     | bekannte Eligibility-/Alert-Fan-outs nutzten die pg-Queue; breitere Warnungen offen | P1 Runtime | `FIXED` |
| `F34-DOC-001`     | CV-/Document-Vault ist in Preview grundsätzlich tot                            | P1 Runtime      | `OBSOLETE`                |
| `F34-SEC-001`     | Auth-Flows haben kein IP-unabhängiges Zielbudget                               | P1 Security     | `FIXED`                   |
| `F34-SEC-002`     | Reset-Consume erlaubt unbounded Lookup/Hashing                                 | P2 Security     | `FIXED`                   |
| `F34-SEC-003`     | ungültige Forwarded-Ketten fallen auf Loopback zurück                          | P1 Security     | `FIXED`                   |
| `F34-SEC-004`     | Bewerbung ist ohne ausreichende Identität möglich                              | P1 Security     | `FIXED`                   |
| `F34-SEC-005`     | fehlgeschlagene Audit-/Risk-Signale bleiben unsichtbar                         | P1 Forensics    | `FIXED`                   |
| `F34-SEC-006`     | Prefetch überspringt Proxy und erlaubt IP-Spoofing                             | P0 Security     | `FALSE_POSITIVE`          |
| `F34-SEC-007`     | Preview teilt zwingend einen globalen Rate-Limit-Bucket                        | P0 Availability | `OBSOLETE`                |
| `F34-SEC-008`     | Admin-MFA sei standardmäßig aus und nicht erzwungen                            | P0 Security     | `OBSOLETE`                |
| `F34-SEC-009`     | CSP fehlt bei Prefetch-Antworten                                               | P1 Security     | `FALSE_POSITIVE`          |
| `F34-SEC-010`     | IDOR/Tenant-/Capability-Grenzen seien offen                                    | P0 Security     | `FALSE_POSITIVE`          |
| `F34-SEC-011`     | Sessions, CSRF, Validierung oder Secret-Redaktion seien unsicher               | P0 Security     | `FALSE_POSITIVE`          |
| `F34-SEC-012`     | Webhook-Signatur-/Replay-Schutz fehle                                          | P0 Finance      | `FALSE_POSITIVE`          |
| `F34-SEC-013`     | Secret-Scan verwechselte öffentliche Loopback-Templates mit Leaks              | P1 QA/Security  | `FIXED`                   |
| `F34-FLOW-001`    | Passwort-Reset verspricht Versand, tut aber nichts                             | P0 UX/Security  | `OBSOLETE`                |
| `F34-FLOW-002`    | Team-Einladung behauptet Versand und zeigt Interna                             | P1 UX           | `OBSOLETE`                |
| `F34-PRIV-001`    | Privacy Requests werden angenommen, aber nie ausgeführt                        | P0 Privacy      | `OBSOLETE`                |
| `F34-UX-001`      | Inserate-Assistent verliert Navigationstext ohne Warnung                       | P1 UX           | `OBSOLETE`                |
| `F34-NOT-002`     | Arbeitgeber erhält keine Bewerbungsbenachrichtigung                            | P1 UX           | `OBSOLETE`                |
| `F34-NOT-003`     | Bewerbungsbestätigung wird nur scheinbar versendet                             | P1 Truth        | `OBSOLETE`                |
| `F34-DOC-002`     | CV-Upload ist strukturell unmöglich                                            | P1 UX           | `FALSE_POSITIVE`          |
| `F34-FLOW-003`    | Jobs, Einladungen, Credits und Abos laufen nie ab                              | P0 Runtime      | `FALSE_POSITIVE`          |
| `F34-NOT-004`     | Job-Alerts versprechen Zustellung trotz inaktiver Delivery                     | P1 Truth        | `FIXED`                   |
| `F34-NOT-005`     | Outbox-basierte lokale Mailbox wurde vor Worker-Erfolg als erfasst dargestellt | P1 Truth        | `FIXED`                   |
| `F34-AUTH-001`    | Login-E-Mail kann nicht geändert werden                                        | P1 UX/Security  | `OBSOLETE`                |
| `F34-UX-002`      | Anschreiben geht bei abgelehntem Submit verloren                               | P1 UX           | `OBSOLETE`                |
| `F34-NOT-001`     | `resend_live` erscheint als `record_only`                                      | P2 Truth        | `FIXED`                   |
| `F34-UX-003`      | rohe Enums, Codes und interne Mock-/Phasentexte                                | P1 UX           | `FIXED`                   |
| `F34-UX-004`      | Responsive, Fokus, Tastatur und WCAG-Regressionsschutz                         | P1 Quality      | `FIXED`                   |
| `F34-SEO-001`     | Canonical/noindex/Sitemap/Robots schützen Demo nicht                           | P1 SEO          | `FIXED`                   |
| `F34-AI-001`      | Mock-AI kann in Production-like als echte Funktion erscheinen                  | P1 Truth        | `FIXED`                   |
| `F34-JOBROOM-001` | Mock-Stellenmeldepflicht kann in Production-like als real gelten               | P0 Legal        | `FIXED`                   |
| `F34-RADAR-001`   | Talent-Radar leakt Identität vor Freigabe                                      | P0 Privacy      | `FALSE_POSITIVE`          |
| `F34-QA-001`      | fixes Fixture-Datum macht Search-Test zeitabhängig rot                         | P1 QA           | `FIXED`                   |
| `F34-QA-002`      | alte/feste Testzahlen und Phase-33-Evidence gelten weiter                      | P1 Governance   | `FIXED`                   |
| `F34-QA-003`      | Preview/prod-like und erlaubter Aktivpfad sind unzureichend E2E-geprüft        | P0 QA           | `FIXED`                   |
| `F34-QA-004`      | Browser-Gate akzeptierte stale Builds und unvollständige Erfolgsmanifeste      | P0 QA           | `FIXED`                   |
| `F34-QA-005`      | Browserprojekte kollidierten in gemeinsamen Login-Rate-Limit-Buckets           | P1 QA           | `FIXED`                   |
| `F34-QA-006`      | Live-Payment-Fixture verletzte den aktuellen Identity-/Outbox-Vertrag          | P2 QA           | `FIXED`                   |
| `F34-QA-007`      | Live-Storage-Fixture verletzte denselben Identity-/Outbox-Vertrag              | P2 QA           | `DUPLICATE`               |
| `F34-QA-008`      | UI-Fixtures verwendeten die ungültige Deployment-Identität `test`             | P2 QA           | `FIXED`                   |
| `F34-QA-009`      | Sitemap-Testport bildete den sequentiellen Eligibility-Loader nicht ab         | P2 QA           | `FIXED`                   |
| `F34-QA-010`      | natürlicher EXPLAIN-Plan wurde als deterministischer Indexvertrag behandelt    | P2 QA           | `FIXED`                   |
| `F34-QA-011`      | Browserverträge erwarteten rohe Enums und vor Phase 34 erlaubte Zustellung     | P1 QA           | `FIXED`                   |
| `F34-QA-012`      | Retentionstest verglich PostgreSQL- und Host-Uhr an der Millisekundengrenze    | P1 QA           | `FIXED`                   |
| `F34-SUPPLY-001`  | verwundbare transitive YAML-Version im Build-/Lint-Tooling                     | P2 Supply Chain | `FIXED`                   |
| `F34-MIG-001`     | Generated Search-Spalte brach Revision-Immutability-Trigger                    | P1 Data         | `FIXED`                   |

### 2.1 Verbindliche Ownership

Diese Zuordnung gilt für jeden einzelnen Kompakt- und Detaildatensatz, sofern
der Detailtext keinen spezielleren Owner nennt. Externe Abnahme-Owner aus
Abschnitt 14 ersetzen diese Repository-Verantwortung nicht.

| ID-Familie                          | Verantwortlicher Repository-Owner                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `BASE`, `ARCH`, `GOV`, `REPO`, `QA` | Architecture / QA & Release Engineering                                              |
| `COM`                               | Product & Commercial Engineering                                                     |
| `LEG`, `TAX`                        | Legal-/Privacy-/Finance-Integration Engineering; externe Fachfreigabe bleibt separat |
| `COMPANY`, `FLOW`, `AUTH`           | Identity & Company Lifecycle Engineering                                             |
| `PAY`                               | Billing & Finance Engineering                                                        |
| `SEARCH`, `DATA`, `SEO`             | Search, Data & Public Platform Engineering                                           |
| `OPS`                               | Platform & Operations Engineering                                                    |
| `DOC`, `PRIV`, `RADAR`              | Privacy & Document Security Engineering                                              |
| `SEC`                               | Application Security Engineering                                                     |
| `A11Y`, `UX`                        | Frontend Quality & Accessibility Engineering                                         |
| `NOT`                               | Notification/Application Engineering                                                 |
| `AI`, `JOBROOM`                     | Provider Integration Engineering                                                     |
| `MIG`                               | Database Engineering                                                                 |
| `SUPPLY`                            | Build & Supply-Chain Security Engineering                                            |

## 3. Baseline, Governance und Repository

### `F34-BASE-001` — Review-Zahlen und externer Deployment-Snapshot

- **Ursprüngliche Behauptung:** 149/150 Routen, 68 Migrationen, 2.388 Tests,
  fünf offene Phasen sowie Vercel/Supabase-Zürich mit 115 Demo-Jobs,
  25 Firmen, 62 Konten und pausiertem Worker seien der aktuelle Stand.
  **Quelle:** R, Z. 7–25. **Kategorie:** Baseline/externes Deployment.
  **Anfängliches Risiko:** P2. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `scripts/route-audit.ts`,
  `prisma/migrations/**`, Testinventare, `codex-plan/00-PLAN.md`; externe
  Vercel-/Supabase-Zustände. **Tatsächlicher Ausführungspfad:** Inventar-CLI
  versus nicht versionierter Cloudzustand. **Reproduktion:** Inventare am
  aktuellen Tree dynamisch erzeugen; Cloudwerte nur über autorisierte
  Metadaten prüfen. **Beweise:** aktuelles Route-Audit weist 130 Pages,
  22 Handler und 2 Metadata-Routen aus; nach Phase-34-Migrationen ist auch die
  Zahl 68 historisch. Cloud-Daten wurden nicht als Repository-Wahrheit
  übernommen.
- **Ursache:** zeitgebundener Review-Snapshot. **Blast Radius:** falsche
  Abnahme- und Kapazitätsaussagen, keine unmittelbare Runtimewirkung.
  **Abhängigkeiten:** finaler Candidate und externer Lesezugriff.
  **Gewählte Lösung:** dynamische Inventare; Deploymentwerte als externe
  Evidence. **Verworfene Alternative:** Zahlen aus dem Review festschreiben,
  weil sie bereits veraltet sind.
- **Migration/Environment:** keine. **Erforderliche Tests:** Unit – nein;
  Integration – Inventargenerator; Contract – Plan/Code-Abgleich; E2E –
  Deployment-Smoke nur extern. **E2E-ID:** `E2E-34-19`, `E2E-34-20`.
  **Implementierungsstatus:** klassifiziert. **Abschließende Evidence:** finaler
  Inventarlauf ausstehend. **Verbleibendes externes Gate:** tatsächliche
  Vercel-/Supabase-Konfiguration und Datenbestand.

### `F34-BASE-002` — Produkt-, Rollen- und Featurebeschreibung

- **Ursprüngliche Behauptung:** SwissTalentHub sei ein de-CH-Stellenportal
  mit Candidate, Employer, Recruiter und Admin, Fair-Job-Score, Lohn-Radar und
  anonymem Talent Radar. **Quelle:** R, Z. 5–13. **Kategorie:** Product
  Baseline. **Anfängliches Risiko:** P1 Activation, falls „vorhanden“ mit
  „live/freigegeben“ verwechselt wird. **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** role/capability model, public jobs,
  fairness/salary/radar domains, pricing and plan documents.
  **Tatsächlicher Ausführungspfad:** role entrypoints → respective domain and
  public/private UI. **Reproduktion:** route/inventory and critical journeys
  per role; inspect live provenance/activation. **Beweise:** roles and feature
  implementations exist; Salary-/Radar-/Paid-/provider scopes remain gated,
  and no current live-use claim is justified.
- **Ursache:** product summary collapses implemented, demo, inactive and live
  states. **Blast Radius:** marketing, legal and commercial expectations.
  **Abhängigkeiten:** LEG-002/003/006, COM-001, payment/provider gates.
  **Gewählte Lösung:** retain feature description only with explicit state and
  provenance. **Verworfene Alternative:** delete features or market demos as
  live.
- **Migration/Environment:** none by classification. **Erforderliche Tests:**
  route/role audit and feature E2Es; public claim/provenance contract.
  **E2E-ID:** `E2E-34-01`–`15` according to feature.
  **Implementierungsstatus:** classified; final route/journey run pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  legal, provider, research and commercial activation.

### `F34-ARCH-001` — fail-closed Doppelprüfung

- **Ursprüngliche Behauptung:** the app intentionally compares SQL ranking
  with a second evaluator and returns no possibly wrong list; the Preview
  outage was therefore „Absicht, kein Absturz“. **Quelle:** R, Z. 11–16/
  102–104. **Kategorie:** Architecture/Availability. **Anfängliches Risiko:**
  P0 Runtime. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** public search query/hydration contract,
  trust evaluator, error types/boundary. **Tatsächlicher Ausführungspfad:**
  SQL result → canonical evaluator → mismatch error/deny. **Reproduktion:**
  eligible and deliberately drifted row in each environment.
  **Beweise:** fail-closed cross-check is intentional and valuable; the
  duplicated predicate drift and unhelpful global UX were not intended and
  are tracked by SEARCH-001/009/010.
- **Ursache:** a safety invariant was described as sufficient explanation for
  an implementation drift. **Blast Radius:** all search users.
  **Abhängigkeiten:** SEARCH-001/009/010. **Gewählte Lösung:** preserve
  independent validation while eliminating known predicate drift and adding
  recoverable UI. **Verworfene Alternative:** remove the check or accept
  silently dropped rows.
- **Migration/Environment:** search migration under SEARCH-005.
  **Erforderliche Tests:** SQL/domain differential, HTTP/browser eligible and
  drift/revoke negative. **E2E-ID:** `E2E-34-03`, `E2E-34-11`,
  `E2E-34-18`. **Implementierungsstatus:** die unabhängige fail-closed
  Doppelprüfung bleibt erhalten; Predicate-Drift, Trust-Revoke und sichere
  Fehler-Recovery sind auf demselben Candidate positiv und negativ geprüft.
  **Abschließende Evidence:** Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` sowie
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes external gate:** none for local correctness.

### `F34-GOV-001` — abgeschnittene Phase-33-AC-Matrix

- **Ursprüngliche Behauptung:** Die kanonische Evidence sei vollständig;
  tatsächlich enthielt AC-33-05 Transport-Truncation und vermischte Zeilen.
  **Quelle:** N. **Kategorie:** Governance/Evidence. **Anfängliches Risiko:**
  P0 Governance. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `codex-plan/33-go-live-readiness-e2e-acceptance.md`; Verbraucher
  `scripts/plan-evidence-audit.ts`. **Tatsächlicher Ausführungspfad:**
  Markdown → Plan-Audit → Release-Evidence. **Reproduktion:** beschädigte
  Matrix durch Audit lesen. **Beweise:** Rekonstruktion aus unveränderlicher
  Vorgängerversion; positiver und negativer echter CLI-Lauf.
- **Ursache:** abgeschnittener Transporttext. **Blast Radius:** falsche
  Release-Traceability. **Abhängigkeiten:** historische Evidence unverändert
  halten. **Gewählte Lösung:** AC-Zeilen strukturell wiederherstellen und
  Integrity-Prüfung vorschalten. **Verworfene Alternative:** historische
  Statusaussagen umschreiben.
- **Migration/Environment:** keine. **Erforderliche Tests:** Unit – Integrity;
  Integration/Contract – CLI gegen gültige und absichtlich beschädigte Kopie;
  Browser-E2E – für reine Doku nicht erforderlich. **E2E-ID:**
  Dokumentationsverbrauchspfad statt Browser. **Implementierungsstatus:**
  abgeschlossen. **Abschließende Evidence:** Plan-Audit Positiv/Negativ grün.
  **Verbleibendes externes Gate:** keines.

### `F34-GOV-002` — Plan-Audit akzeptierte beschädigte Evidence

- **Ursprüngliche Behauptung:** `plan:audit` meldete trotz abgeschnittener
  Tabelle `PASS`. **Quelle:** N. **Kategorie:** Governance-Tooling.
  **Anfängliches Risiko:** P0 Governance. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `lib/governance/plan-document-integrity.ts`,
  `scripts/plan-evidence-audit.ts`, `tests/unit/governance/**`.
  **Tatsächlicher Ausführungspfad:** npm-CLI → Dokumentenscan → Exitcode.
  **Reproduktion:** bekannte Truncation oder ungültige Markdown-Tabelle
  einspeisen. **Beweise:** sechs Integrity-/CLI-Fälle sowie Gesamtaudit grün.
- **Ursache:** semantischer Audit ohne syntaktische Integritätsgrenze.
  **Blast Radius:** jede nachgelagerte Phase konnte beschädigte Evidence als
  gültig ansehen. **Abhängigkeiten:** robuste Marker- und Tabellenregeln.
  **Gewählte Lösung:** fail-closed Scanner im realen CLI-Einstieg.
  **Verworfene Alternative:** einzelne Fundstelle manuell reparieren.
- **Migration/Environment:** keine. **Erforderliche Tests:** Unit und
  CLI-Contract positiv/negativ; kein Browser. **E2E-ID:** echter
  Plan-Audit-Verbrauchspfad. **Implementierungsstatus:** abgeschlossen.
  **Abschließende Evidence:** gültiger Plan Exit 0, beschädigte Fixture Exit
  ungleich 0. **Verbleibendes externes Gate:** keines.

### `F34-GOV-003` — weitere fehlerhafte normative Tabellen

- **Ursprüngliche Behauptung:** Weitere Plan-/Routenmatrizen seien
  strukturell konsistent; Scan fand fehlende beziehungsweise falsch getrennte
  Zellen. **Quelle:** N. **Kategorie:** Governance. **Anfängliches Risiko:**
  P1 Governance. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `codex-plan/25-admin-security.md`,
  `codex-plan/route-role-matrix.md`, Scanner. **Tatsächlicher Ausführungspfad:**
  Markdown → Tabellenparser → Plan-Audit. **Reproduktion:** allgemeiner
  Tabellencheck. **Beweise:** fehlende Zelle, Separatorzeile und Capability-
  Pipes reproduziert und repariert.
- **Ursache:** manuelle Tabellenpflege. **Blast Radius:** unzuverlässige
  Traceability. **Abhängigkeiten:** keine Runtime. **Gewählte Lösung:** nur
  Struktur korrigieren. **Verworfene Alternative:** historische Aussagen
  neu bewerten, weil das nicht zur Strukturkorrektur gehört.
- **Migration/Environment:** keine. **Erforderliche Tests:** Scanner und
  `plan:audit` positiv/negativ; kein Browser. **E2E-ID:** CLI-Verbrauchspfad.
  **Implementierungsstatus:** abgeschlossen. **Abschließende Evidence:**
  Tabellencheck grün. **Verbleibendes externes Gate:** keines.

### `F34-GOV-004` — aktuelles Routen-/Handlerinventar driftete

- **Ursprüngliche Behauptung:** Requirements-Matrix und geschlossenes
  Inventar spiegeln die aktuelle Routenzahl. **Quelle:** A §A; N.
  **Kategorie:** Traceability. **Anfängliches Risiko:** P1 Governance.
  **Prüfstatus:** `CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `codex-plan/requirements-matrix.md`
  (`REQ-QA-002`), `scripts/route-audit.ts`, Routeninventar.
  **Tatsächlicher Ausführungspfad:** Dateibaum → Route-Audit → Requirement-
  Abnahme. **Reproduktion:** aktuellen Audit gegen die gebundene Zahl laufen
  lassen. **Beweise:** 130 Pages, 22 Handler, 2 Metadata-Routen versus alter
  Requirement-Text.
- **Ursache:** additives Routing nach historischer Abnahme. **Blast Radius:**
  nicht abgedeckte Oberflächen können als geprüft erscheinen.
  **Abhängigkeiten:** finaler Tree. **Gewählte Lösung:** aktuelle kanonische
  Abnahme dynamisch/aktuell binden; historische Phase-18-Evidence belassen.
  **Verworfene Alternative:** historische Records rückwirkend ändern.
- **Migration/Environment:** keine. **Erforderliche Tests:** Route-Audit,
  Plan-Audit, Link-/Referenzcheck; kein Browser nur für Zahländerung.
  **E2E-ID:** Governance-Verbrauchspfad. **Implementierungsstatus:**
  Korrektur im Arbeitsbaum, finaler Audit ausstehend. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** keines.

### `F34-GOV-005` — geschlossenes Ledger versus aktuelles Inventar

- **Ursprüngliche Behauptung:** Ein geschlossener Ledger-Eintrag widerspreche
  dem aktuellen Routenbestand. **Quelle:** A §A. **Kategorie:** Governance.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `DUPLICATE` zu
  `F34-GOV-004`.
- **Betroffene Dateien/Funktionen:** Requirements-Matrix, Plan-/Route-Audit.
  **Tatsächlicher Ausführungspfad:** identisch zu `F34-GOV-004`.
  **Reproduktion:** historischen Snapshot von aktuellem Inventar trennen.
  **Beweise:** Historie ist für ihren Commit korrekt; nur aktuelle Bindung
  driftete.
- **Ursache:** Snapshot und aktuelle Anforderung wurden vermischt. **Blast Radius:**
  wie `F34-GOV-004`. **Abhängigkeiten:** dessen Abschluss.
  **Gewählte Lösung:** dort konsolidieren. **Verworfene Alternative:** zweite
  konkurrierende Zahl pflegen.
- **Migration/Environment:** keine. **Erforderliche Tests:** wie
  `F34-GOV-004`. **E2E-ID:** Governance-Verbrauchspfad.
  **Implementierungsstatus:** dedupliziert. **Abschließende Evidence:** über
  `F34-GOV-004`. **Verbleibendes externes Gate:** keines.

### `F34-GOV-006` — freie String-Statusfelder versus ADR-007

- **Ursprüngliche Behauptung:** freie String-Statusfelder verletzten den
  verbindlichen Statusmaschinenvertrag. **Quelle:** A §A. **Kategorie:**
  Architektur/Data. **Anfängliches Risiko:** P1. **Prüfstatus:**
  `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** `prisma/schema.prisma`, Status-Contracts
  der Domain-Services, ADR-007. **Tatsächlicher Ausführungspfad:** validierter
  Command → Domaintransition → DB-Constraint/Enum. **Reproduktion:** alle
  schreibbaren Statusfelder samt Validator und Transitionstabelle inventarisieren.
  **Beweise:** relevante Runtime-Statuswerte sind Prisma-Enums oder durch
  geschlossene Zod-/Transition-Contracts begrenzt; freie beschreibende
  Strings sind keine Statusmaschine.
- **Ursache:** Schema-Spaltentyp ohne Verbraucherpfad betrachtet. **Blast Radius:**
  keiner für den behaupteten Defekt. **Abhängigkeiten:** Schema-
  Contract-Regressionslauf. **Gewählte Lösung:** keine Schemaänderung.
  **Verworfene Alternative:** destruktive Enum-Migration ohne reproduzierten
  ungültigen Write.
- **Migration/Environment:** keine. **Erforderliche Tests:** bestehende
  Transition-/Schema-Contracts; kritische Status-E2E im Candidate.
  **E2E-ID:** `E2E-34-02`, `E2E-34-03`, `E2E-34-12`.
  **Implementierungsstatus:** keine Änderung. **Abschließende Evidence:**
  finaler Regressionlauf ausstehend. **Verbleibendes externes Gate:** keines.

### `F34-GOV-007` — historische ADRs versus heutiger Providervertrag

- **Ursprüngliche Behauptung:** bindende ADRs verbieten einerseits Worker
  oder Env-selektierte echte Adapter und erlauben sie andererseits.
  **Quelle:** R, Z. 118–120; A §A. **Kategorie:** Architektur/Governance.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `codex-plan/decisions.md` ADR-004,
  ADR-014 sowie spätere ADR-031/032/034/043; Provider-Composition Roots.
  **Tatsächlicher Ausführungspfad:** ADR → Env-Schema → Composition → Effekt.
  **Reproduktion:** normative Aussagen und Runtime-Matrix gegeneinander
  prüfen. **Beweise:** ältere Texte waren als fortgeltende Baseline
  missverständlich; Arbeitsbaum kennzeichnet sie nun als historisch
  superseded, ohne Env/Secret-only-Aktivierung zu erlauben.
- **Ursache:** additive ADRs ohne expliziten Supersession-Vermerk. **Blast Radius:**
  unsicherer Operator-Cutover oder falsche Mockannahme.
  **Abhängigkeiten:** E2E-34-20. **Gewählte Lösung:** historischen Umfang und
  bleibende Invarianten präzisieren. **Verworfene Alternative:** alte ADRs
  löschen oder Live allein per Secret aktivieren.
- **Migration/Environment:** Dokumentation, keine Variablenaktivierung.
  **Erforderliche Tests:** Plan-Audit, Env-Contract, prod-like Boot positiv/
  negativ. **E2E-ID:** `E2E-34-20`. **Implementierungsstatus:** Textänderung
  vorhanden; Runtime-Candidate-Evidence fehlt. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** reale Provideraktivierung.

### `F34-GOV-008` — Phase 32/33 und `NO_GO`

- **Ursprüngliche Behauptung:** offene Checkboxen beziehungsweise der
  Release-Audit bedeuteten, die Implementierung sei entweder unfertig oder
  bereits produktionsfreigegeben. **Quelle:** R, Z. 24–25; A §A.
  **Kategorie:** Release Governance. **Anfängliches Risiko:** P0 Activation.
  **Prüfstatus:** `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** `codex-plan/32-release-audit.md`,
  `codex-plan/33-go-live-readiness-e2e-acceptance.md`,
  `codex-plan/00-PLAN.md`. **Tatsächlicher Ausführungspfad:** technische
  Abnahme → externe Gates → Aktivierungsurteil. **Reproduktion:** Status- und
  Gateformulierungen lesen. **Beweise:** Phasen trennen technische
  Implementierung ausdrücklich vom unveränderten `NO_GO`; offene Legal-,
  Provider- und Ops-Gates werden nicht als erledigt dargestellt.
- **Ursache:** Planstatus mit Go-live-Entscheid gleichgesetzt. **Blast Radius:**
  gefährliche Scheinfreiheit. **Abhängigkeiten:** Phase-34-Abschluss.
  **Gewählte Lösung:** Trennung beibehalten. **Verworfene Alternative:**
  Checkboxen allein in `GO` umdeuten.
- **Migration/Environment:** keine. **Erforderliche Tests:** Plan-Audit und
  Gate-Traceability; kein künstlicher Browser-E2E. **E2E-ID:**
  Governance-Verbrauchspfad. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler Plan-Audit ausstehend.
  **Verbleibendes externes Gate:** alle in Abschnitt 13 genannten Gates.

### `F34-REPO-001` — lokale `.vercel/`-Metadaten

- **Ursprüngliche Behauptung:** `.vercel/project.json` oder der lokale Ordner
  könne in Candidate-Evidence beziehungsweise Commits geraten. **Quelle:** A
  §A; N. **Kategorie:** Repository/Control Plane. **Anfängliches Risiko:** P2.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `.gitignore`, lokaler `.vercel/`-Ordner.
  **Tatsächlicher Ausführungspfad:** Git-Status/Staging, nicht App-Runtime.
  **Reproduktion:** `git status --short` vor/nach Ignore-Regel; Ordnerinhalt
  bleibt ungelesen. **Beweise:** Ordner war untracked; `.gitignore` enthält im
  Arbeitsbaum jetzt `.vercel/`.
- **Ursache:** Vercel CLI erzeugt lokale Projektbindung. **Blast Radius:**
  versehentliche Control-Plane-Metadaten oder dirty candidate. **Abhängigkeiten:**
  finaler Git-Diff. **Gewählte Lösung:** ausschließlich generischen Ordner
  ignorieren. **Verworfene Alternative:** Inhalt lesen, löschen oder committen.
- **Migration/Environment:** keine. **Erforderliche Tests:** Git-Ignore-
  Contract und Clean-Candidate-Prüfung; kein Browser. **E2E-ID:**
  Repository-Verbrauchspfad. **Implementierungsstatus:** Ignore-Regel
  vorhanden. **Abschließende Evidence:** finaler Status/Diff ausstehend.
  **Verbleibendes externes Gate:** keines.

### `F34-COM-001` — Commercial-Gates ohne Runtime-Verbraucher

- **Ursprüngliche Behauptung:** Boost-, bezahlte Radar-, Salary- und weitere
  Phase-31-Steuerungen bestünden Tests, würden aber von Produktivdateien nicht
  importiert und steuerten nichts. **Quelle:** R, Z. 116–120; A §A/I.
  **Kategorie:** Product/Commercial. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `lib/commercial/**`,
  `tests/unit/commercial/**`, `codex-plan/31-commercial-validation.md`,
  `commercial-go-live-gates.md`. **Tatsächlicher Ausführungspfad:** derzeit
  Research-/Decision-Support, kein Runtime-Cutover. **Reproduktion:**
  Importgraph außerhalb Tests/Fixtures prüfen. **Beweise:** Module sind
  überwiegend nur in Tests und Commercial-Evidence konsumiert; Phase 31
  bezeichnet Aktivierung selbst als gesperrt.
- **Ursache:** bewusst vorgelagerte Commercial-Validierung. **Blast Radius:**
  keine heutige versteckte Freischaltung, aber falsche Produktannahme, wenn
  „implementiert“ mit „aktiv“ verwechselt wird. **Abhängigkeiten:** WTP,
  Legal, Finance, Capacity. **Gewählte Lösung:** als inaktiv dokumentieren und
  fail-closed lassen. **Verworfene Alternative:** ungeprüfte Runtime-Imports
  und Monetarisierung aktivieren.
- **Migration/Environment:** keine Aktivierung. **Erforderliche Tests:**
  Import-/Flag-Contract; spätere Produktaktivierung benötigt vollständige
  Payment-/Radar-E2E. **E2E-ID:** `E2E-34-06`, `E2E-34-07`,
  `E2E-34-20`. **Implementierungsstatus:** bewusst offen.
  **Abschließende Evidence:** aktueller Importaudit; Candidate-Wiederholung
  ausstehend. **Verbleibendes externes Gate:** Commercial Owner, WTP,
  Legal/AVG, Finance.

## 4. Schweizer Recht, Privacy und fachliche Policies

### `F34-LEG-001` — Rechtspublikationen und Registrierung

- **Ursprüngliche Behauptung:** Datenschutz, AGB und Impressum seien
  unveröffentlicht, während Registrierung Zustimmung zu nicht vorhandenen
  AGB verlange. **Quelle:** R, Z. 98–100 und 163–169. **Kategorie:**
  Legal/Registration. **Anfängliches Risiko:** P0. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `lib/legal/publication-service.ts`,
  `lib/auth/registration-legal-gate.ts`, `app/(public)/legal/**`,
  Registrierungsactions. **Tatsächlicher Ausführungspfad:** Registration →
  aktuelle de-CH-Publikationen/Hashes → Consent → Konto. **Reproduktion:**
  Registrierung ohne aktuelle Publikation und danach mit versionierter
  Publikation. **Beweise:** heutiger Code sperrt Registration fail-closed und
  bindet Zustimmungen; er behauptet keine Legal-Freigabe.
- **Ursache:** Review bezog sich auf älteren Baum. **Blast Radius:** damalige
  Scheineinwilligung; aktuell verhindert. **Abhängigkeiten:** veröffentlichte,
  counsel-freigegebene Inhalte. **Gewählte Lösung:** bestehenden Gatevertrag
  beibehalten. **Verworfene Alternative:** Platzhalter als legal wirksam
  markieren.
- **Migration/Environment:** Publikationsdatensätze, keine neue Phase-34-
  Migration. **Erforderliche Tests:** Unit/PG-Contract und Registration-E2E
  positiv/negativ. **E2E-ID:** `E2E-34-01`. **Implementierungsstatus:**
  vorhandener Fix; Candidate-Regressionslauf ausstehend. **Abschließende Evidence:**
  bestehende Phase-22-/Registration-Tests, finaler E2E ausstehend.
  **Verbleibendes externes Gate:** freigegebene Texte und datierte Publikation.

### `F34-LEG-002` — AVG-/AVV-Gate im Talent Radar

- **Ursprüngliche Behauptung:** AVG werde nirgends genannt beziehungsweise
  der Radar könne trotz ungeklärter Bewilligungs-/Consentfrage Kandidaten
  listen, kontaktieren, freigeben und Nachrichten ermöglichen. **Quelle:** R
  (Gesamturteil/SECO-Hinweis); A §A/F. **Kategorie:** Legal/Runtime.
  **Anfängliches Risiko:** P0. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/privacy/legal-gate-policy.ts`,
  `lib/talentradar/legal-gate.ts`, `list-candidates.ts`,
  `request-contact.ts`, `contact-requests.ts`, `reveal.ts`, Messaging-Actions.
  **Tatsächlicher Ausführungspfad:** Employer Radar entry → Legal decision →
  list/contact; Candidate accept → reveal; message send → current decision.
  **Reproduktion:** Preview/prod-like ohne gültigen `ProcessingApproval` und
  mit gültigem Entscheid; lokale synthetische Demo getrennt. **Beweise:** AVG
  ist in Plan/Policy vorhanden; echter Mangel war fehlende Runtime-Nutzung.
  Fail-closed Guards und PG-Tests sind im Arbeitsbaum.
- **Ursache:** Legal-Control existierte als Admin/Policy-Evidence, nicht als
  Effect-Guard an allen Radar-Seams. **Blast Radius:** unzulässige
  Arbeitsvermittlung/Identitätsfreigabe. **Abhängigkeiten:** behördliche oder
  counsel-freigegebene Entscheidung, Consent-/Retention-Policy.
  **Gewählte Lösung:** aktuelle Freigabe vor jedem sensitiven Read/Write und
  nochmals transaktional unmittelbar vor Effekt; Decline/Cancel/Revoke/
  Offboarding bleiben möglich. **Verworfene Alternative:** nur UI verstecken
  oder Rechtsauslegung hardcoden.
- **Migration/Environment:** keine neue Schemaänderung; prod-like benötigt
  persistierten Entscheid, local/ci nur klar synthetisch. **Erforderliche Tests:**
  Unit-Matrix; PG positiv/negativ/transactional revoke; Browser/API-
  E2E für list/contact/accept/reveal/message sowie sichere Rücknahme.
  **E2E-ID:** `E2E-34-11`, `E2E-34-14`, `E2E-34-20`.
  **Implementierungsstatus:** Runtime und Integration implementiert;
  Browser-E2E noch laufend/ausstehend. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** AVG/AVV-Einstufung, Bewilligung und
  akzeptierte Signatur-/Consent-Evidence.

### `F34-LEG-003` — Stellenmeldepflicht/Fünf-Arbeitstage-Sperre

- **Ursprüngliche Behauptung:** jede relevante Stelle müsse pauschal fünf
  Arbeitstage blockiert werden; Mock-Jobroom könne dies beweisen. **Quelle:**
  A §A; R. **Kategorie:** Schweizer Arbeitsmarkt-Recht. **Anfängliches Risiko:**
  P0. **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** `lib/providers/jobroom/**`,
  `lib/jobs/reporting/**`, Job-Submit/Publish, Admin-Moderation.
  **Tatsächlicher Ausführungspfad:** Berufscode/Schwellenwert → Job-Room-
  Meldung → bestätigter Publikationszeitpunkt → Sperrfrist → öffentliche
  Freigabe. **Reproduktion:** Contract-Fälle mit meldepflichtigem und nicht
  meldepflichtigem Beruf; echter Nachweis benötigt offizielle Schnittstelle.
  **Beweise:** offizielle Regel ist konditional und beginnt nicht beliebig am
  lokalen Submit; Repository-Mock ist keine Behörden-Evidence.
- **Ursache:** juristische Regel und Mock-Simulation wurden gleichgesetzt.
  **Blast Radius:** zu frühe oder unnötig verspätete Publikation.
  **Abhängigkeiten:** SECO/arbeit.swiss-Vertrag, aktuelle Berufsliste,
  Kalender-/Zeitregel. **Gewählte Lösung:** Production-like Mockzugriff
  fail-closed, Policy konfigurierbar halten. **Verworfene Alternative:** fixe
  globale Fünf-Tage-Regel hardcoden.
- **Migration/Environment:** später Provider-/Policy-Aktivierung; derzeit aus.
  **Erforderliche Tests:** Unit/Contract, signed callback/idempotency,
  Publish-E2E positiv/negativ. **E2E-ID:** `E2E-34-03`, `E2E-34-10`,
  `E2E-34-20`. **Implementierungsstatus:** technische Mock-Grenze wird unter
  `F34-JOBROOM-001` gehärtet; Rechtsentscheid offen. **Abschließende Evidence:**
  keine Live-Evidence. **Verbleibendes externes Gate:** offizielle Einstufung
  und Providerzugang.

### `F34-LEG-004` — Minderjährigenschutz bei Lehrstellen

- **Ursprüngliche Behauptung:** Lehrstellen können Minderjährige betreffen;
  Consent, Profilierung, Kontakt, Dokumente und Retention seien nicht
  abschließend geregelt. **Quelle:** A §A. **Kategorie:** Legal/Privacy.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** Registrierung, Candidate-Profil,
  Application, Document Vault, Talent Radar, Privacy-/Retention-Policies.
  **Tatsächlicher Ausführungspfad:** Geburts-/Altersstatus → zulässige
  Features/Consent → Verarbeitung. **Reproduktion:** Minderjährigen-Persona
  durch Kernreisen; aktuelle Geschäftsregel kann ohne Rechtsentscheid nicht
  als korrekt bewertet werden. **Beweise:** kein datierter fachjuristischer
  Freigaberecord im Repository.
- **Ursache:** offene Produkt-/Rechtsentscheidung. **Blast Radius:** besondere
  Schutzpflichten und unwirksame Einwilligung. **Abhängigkeiten:** Legal,
  Privacy, Product. **Gewählte Lösung:** betroffene Aktivierung bis Entscheid
  sperren und umsetzungsreife Alters-/Guardian-Policy definieren.
  **Verworfene Alternative:** willkürliche Altersgrenze oder stilles Zulassen.
- **Migration/Environment:** Entscheidung kann additive Evidenzfelder
  erfordern; noch keine Migration. **Erforderliche Tests:** Persona-Unit,
  Consent-/Tenant-Integration, Browser-E2E positiv/negativ nach Freigabe.
  **E2E-ID:** `E2E-34-01`, `E2E-34-14`. **Implementierungsstatus:** keine
  ungesicherte Regel implementiert. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** Schweizer Legal-/Privacy-Freigabe.

### `F34-LEG-005` — normative Moderations- und Ablehnungskriterien

- **Ursprüngliche Behauptung:** Kriterien gegen Diskriminierung,
  Scheinselbständigkeit, reine Provisionsangebote und unzulässige Inhalte
  seien nicht verbindlich genug. **Quelle:** A §A. **Kategorie:** Trust &
  Safety/Legal. **Anfängliches Risiko:** P1. **Prüfstatus:**
  `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** `lib/admin/moderation.ts`, Job-Revision-
  Validation, Admin-Moderationsactions, Reason-Codes. **Tatsächlicher Ausführungspfad:**
  Submit → automatische Checks → Adminentscheid →
  Publikation/Ablehnung. **Reproduktion:** Grenzfall-Corpus je Kriterium und
  Rollenpfad. **Beweise:** technische Reason-/Statusmaschine existiert; ein
  datierter, fachlich freigegebener Kriterienkatalog fehlt.
- **Ursache:** technische Moderation vor finaler Legal-/Policy-Freigabe.
  **Blast Radius:** rechtswidrige Anzeigen oder uneinheitliche Ablehnung.
  **Abhängigkeiten:** Schweizer Counsel, T&S Owner, Appeal-/Evidence-Regel.
  **Gewählte Lösung:** versionierte, konfigurierbare Policy mit Review-/Appeal-
  Pfad planen; unsichere Kategorien nicht automatisch live schalten.
  **Verworfene Alternative:** freie Admintexte oder KI-Entscheid als
  verbindliches Recht.
- **Migration/Environment:** eventuell additive Policy-Version/Evidence;
  aktuell keine. **Erforderliche Tests:** Corpus-Contract, Admin-RBAC,
  Publish-/Appeal-E2E. **E2E-ID:** `E2E-34-03`, `E2E-34-14`.
  **Implementierungsstatus:** externer Entscheid offen. **Abschließende Evidence:**
  keine. **Verbleibendes externes Gate:** Legal/T&S-Freigabe.

### `F34-LEG-006` — Retention, DSFA, Auslandtransfers und DPA

- **Ursprüngliche Behauptung:** DSG-Rechtsgrundlage, Aufbewahrung,
  internationale Bekanntgabe, Provider-DPA und DSFA seien für CV, Radar,
  Nachrichten, Billing und Analytics freigegeben. **Quelle:** A §A/D/I; R.
  **Kategorie:** Privacy/Operations. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** `lib/privacy/**`, `lib/documents/**`,
  Retention Worker, Provider-Bindings, Legal Publications, Dateninventar.
  **Tatsächlicher Ausführungspfad:** Erhebung → Zweck/Consent → Provider/
  Speicherung → Retention/Export/Löschung. **Reproduktion:** Dateninventar und
  Processor-/Regionmatrix gegen jeden Nutzerflow. **Beweise:** technische
  Policies, Requests und Löschpfade existieren; keine externe datierte
  Freigabe für reale Anbieter/Zwecke. Zusätzlich ist ein konkreter Drift
  bestätigt: der Lead-Intake berechnet 730 Tage, während der aktive
  Inventareintrag `SALES_LEAD` 400 Tage nennt. Für `AbuseReport` nennt das
  Inventar 400 Tage, das Modell besitzt jedoch kein eigenes `retainUntil` und
  der ausführbare Ablauf belegt die Löschung noch nicht.
- **Ursache:** externe Compliance-Evidence kann nicht aus Code entstehen.
  **Blast Radius:** sämtliche personenbezogenen Daten. **Abhängigkeiten:**
  Legal/Privacy Owner, Verträge, Regionen, Löschbestätigungen.
  **Gewählte Lösung:** Live-Provider und destruktive Production-Prozesse
  fail-closed; Decision Records pro Zweck. **Verworfene Alternative:**
  `null`-Retention oder Mocktests als Rechtsfreigabe interpretieren. Die
  widersprüchlichen Zahlen werden nicht eigenmächtig auf einen geratenen Wert
  vereinheitlicht.
- **Migration/Environment:** später ggf. additive Purpose-/Approval-Bindings;
  keine vor erfundener Entscheidung. **Erforderliche Tests:** Data-inventory-
  Contract, Retention/Export/Delete Worker-E2E, Provider-Revoke.
  **E2E-ID:** `E2E-34-10`, `E2E-34-13`, `E2E-34-20`.
  **Implementierungsstatus:** extern blockiert. **Abschließende Evidence:**
  keine. **Verbleibendes externes Gate:** DSFA/DPA/Transfer-/Retentionfreigabe.

### `F34-LEG-007` — öffentliche Lead-/Abuse-Erfassung

- **Ursprüngliche Behauptung:** öffentliche Formulare dürfen PII/Freitext
  erfassen, ohne die konkrete aktuelle Privacy-Publikation nachweisbar zu
  binden. **Quelle:** A §F; N aus Legal-Audit. **Kategorie:** Privacy/Runtime.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `app/(public)/employers/demo/actions.ts`, `lib/sales/public-lead.ts`,
  `app/(public)/actions.ts`, `lib/abuse/public-report.ts`, zugehörige Forms,
  `lib/privacy/public-intake-privacy-contract.ts`,
  `lib/privacy/public-intake-privacy-gate.ts` und Migration
  `20260806250000_phase_34_public_intake_privacy_evidence`.
  **Tatsächlicher Ausführungspfad:** anonymer Browser → Lead/Abuse-Action →
  Privacy-Lock → Rate-Limit → DB/Notification. **Reproduktion:** prod-like
  ohne aktuelle de-CH-Privacy-Publikation posten und Persistenz prüfen; Local
  mit exakt gebundener Publikation positiv. **Beweise:** beide Eingänge sperren
  nun die aktuelle Publikation innerhalb derselben Transaktion vor Rate-Limit-
  und Geschäftsschreibvorgängen, binden Version/Hash/ID aus dem Formular und
  persistieren unveränderliche Evidence. Rotation/Revoke ergibt in den
  PG-Race-Tests null Geschäfts-, Rate-Limit-, Audit-, Analytics- oder
  Outbox-Schreibvorgänge; direkte DB-Umgehung und spätere Evidence-Änderung
  werden abgelehnt.
- **Ursache:** öffentliche Intake-Flows entstanden außerhalb des zentralen
  Registration-Gates. **Blast Radius:** Kontaktdaten und freier Berichtstext.
  **Abhängigkeiten:** aktuelle Publikation und Safety-Fallback.
  **Gewählte Lösung:** zentraler fail-closed Intake-Publikationsvertrag vor
  Read/Write und persistierte Version/Hash-/ID-Evidence; Abuse-Schutzweg nicht
  ersatzlos verbergen. **Verworfene Alternative:** Checkbox ohne gebundene
  Publikation.
- **Migration/Environment:** additive Evidence-Felder, Constraints,
  Foreign Keys und Immutability-Trigger in Migration `...250000`; Local nur
  mit synthetisch gebundener Publikation, Preview/prod-like fail-closed.
  **Erforderliche Tests:** Unit-Policy, PG zero-write denial, Browser-E2E Lead
  und Abuse positiv/negativ. **E2E-ID:** `E2E-34-18`, `E2E-34-20`;
  konkrete Spec-Kennung `F34-LEG-007`. **Implementierungsstatus:** Code,
  Migration, Unit-/PG-/Schema-/Race-Tests sowie der positive Local- und der
  direkte manipulationsfeste Preview-Negativpfad sind in allen drei Browsern
  grün. **Abschließende Evidence:** Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** freigegebener Inhalt und
  Rechtsgrundlage für eine echte öffentliche Aktivierung; die technische
  Bindung selbst benötigt keine externe Ausnahme.

### `F34-LEG-008` — Impressum, AGB und PBV

- **Ursprüngliche Behauptung:** ein Schweizer Portal brauche pauschal genau
  die behaupteten AGB-/Impressum-/PBV-Inhalte; mit Veröffentlichung sei der
  Vertrag rechtlich vollständig. **Quelle:** R, Z. 98–100; A §A.
  **Kategorie:** Legal. **Anfängliches Risiko:** P1. **Prüfstatus:**
  `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** Legal-Publications, Pricing/Checkout,
  Billing-Confirmation, Registration. **Tatsächlicher Ausführungspfad:**
  Information → Consent/Bestellung → Bestätigung. **Reproduktion:**
  Veröffentlichungen und Checkout gegen tatsächliche B2B/B2C-Zielgruppe und
  Geschäftsmodell prüfen. **Beweise:** Publikationsmechanik existiert;
  Anwendbarkeit und Inhalt von UWG/PBV/AGB sind keine rein technische
  Schlussfolgerung.
- **Ursache:** richtige technische Warnung mit zu breiter Rechtsbehauptung.
  **Blast Radius:** unwirksame oder fehlende Pflichtinformation.
  **Abhängigkeiten:** Geschäftsmodell, Zielgruppe, Counsel.
  **Gewählte Lösung:** versionierbare Publikation und Bestell-Evidence, Inhalt
  extern freigeben. **Verworfene Alternative:** generischen Text als
  rechtsverbindlich generieren.
- **Migration/Environment:** keine ungeprüfte Aktivierung. **Erforderliche Tests:**
  Publication/Consent/Checkout-Contract und E2E; Inhaltsabnahme
  extern. **E2E-ID:** `E2E-34-01`, `E2E-34-06`, `E2E-34-07`.
  **Implementierungsstatus:** technisch vorbereitet, fachlich offen.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Schweizer Counsel.

### `F34-TAX-001` — MWST und Finance-Freigabe

- **Ursprüngliche Behauptung:** korrekte ganzzahlige 8,1-%-Berechnung belege
  die steuerliche und buchhalterische Go-live-Fähigkeit. **Quelle:** R,
  Z. 106–110/205–207; A §A/I. **Kategorie:** Tax/Finance.
  **Anfängliches Risiko:** P0 Activation. **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** `lib/billing/vat.ts`, Invoice-/Ledger-/
  Reconciliation-Pfade. **Tatsächlicher Ausführungspfad:** Preis → Steuer →
  Rechnung → Buchung/Abgleich. **Reproduktion:** Rechenfälle sind lokal
  testbar; Steuerpflicht, Registrierung und Beleganforderung nicht.
  **Beweise:** Geldarithmetik ist integer/BigInt und technisch positiv;
  Tax-/Accounting-Entscheid fehlt.
- **Ursache:** mathematische Korrektheit wurde mit Rechtsfreigabe verwechselt.
  **Blast Radius:** Rechnungen, Steuer und Abschluss. **Abhängigkeiten:**
  Treuhand/Tax/Finance, PSP-Reconciliation. **Gewählte Lösung:** technische
  Invariante halten, Paid-Aktivierung blockieren. **Verworfene Alternative:**
  allein aus 8,1 % `GO` ableiten.
- **Migration/Environment:** spätere Finance-/Provider-Aktivierung.
  **Erforderliche Tests:** VAT-Unit, Invoice-/Payment-PG, Contract-/Sandbox-
  E2E; externe Buchungsabnahme. **E2E-ID:** `E2E-34-06`, `E2E-34-07`.
  **Implementierungsstatus:** technische Basis vorhanden. **Abschließende Evidence:**
  externe Evidence fehlt. **Verbleibendes externes Gate:** Tax,
  Accounting, PSP und Reconciliation Owner.

### `F34-COMPANY-001` — Company-Offboarding/`CLOSED`

- **Ursprüngliche Behauptung:** `CompanyStatus.CLOSED` existiere ohne
  ausführbaren, konsistenten Offboardingpfad. **Quelle:** A §A; N.
  **Kategorie:** Lifecycle/Privacy/Billing. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `app/admin/actions.ts`,
  `lib/admin/companies.ts`, Admin-Company-Detail,
  `components/admin/company-closure-action.tsx`, Audit enum; additive
  `20260806220000_phase_34_company_closure`. **Tatsächlicher Ausführungspfad:**
  Admin mit Capability → typed confirmation → transaction →
  Status, Jobs, Radar, Audit. **Reproduktion:** suspendierte Firma ohne
  zahlungspflichtige Restzustände schließen; aktive Subscription und Replay
  ablehnen. **Beweise:** Arbeitsbaum pausiert veröffentlichte Jobs, widerruft
  Radar, erhält Daten/Memberships und schreibt terminal/idempotent Audit;
  fokussierte Unit-/PG-Tests grün.
- **Ursache:** Enum wurde vor operativem Endzustand angelegt. **Blast Radius:**
  öffentliche Jobs, Radar-Identität, Billing und Retention. **Abhängigkeiten:**
  Paid-Lifecycle, Privacy-Retention. **Gewählte Lösung:** enger Adminpfad nur
  `SUSPENDED→CLOSED`, bezahlte Zwischenzustände blockieren.
  **Verworfene Alternative:** Cascade-Delete oder Schließen trotz aktiver
  Leistung.
- **Migration/Environment:** additive AuditAction-Migration, keine Löschung.
  **Erforderliche Tests:** Unit/UI, PG positive/negative/idempotent,
  Browser-Admin-E2E samt Public-/Radar-Nachwirkung. **E2E-ID:**
  `E2E-34-03`, `E2E-34-11`, `E2E-34-14`, `E2E-34-19`.
  **Implementierungsstatus:** Admin-UI-Positivpfad, persistiertes `CLOSED`,
  pausierter Job, widerrufenes Radar-Mapping und Audit/Event sowie der
  zahlungsbedingt gesperrte Null-Wirkungs-Pfad sind in Chromium, Firefox und
  WebKit grün; die PG-Verträge belegen Replay/Idempotenz.
  **Abschließende Evidence:** Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** finale Retention-/Finance-Offboardingpolicy.

### `F34-A11Y-001` — WCAG-Vertrag und Assistive-Technology-Abnahme

- **Ursprüngliche Behauptung:** WCAG-Version/-Stufe und Konformität seien
  verbindlich beziehungsweise bereits nachgewiesen. **Quelle:** A §A/G.
  **Kategorie:** Accessibility. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** Designsystem, alle Journeys,
  `tests/e2e/quality/phase29-accessibility.spec.ts`, Phase 29.
  **Tatsächlicher Ausführungspfad:** Browser/Keyboard/Screenreader → UI →
  Resultat. **Reproduktion:** 320/360 px, Zoom, Keyboard, Fokus und Axe;
  anschließend reale NVDA/VoiceOver-Prüfung. **Beweise:** automatisierte
  Checks existieren, ersetzen aber keine umfassende WCAG-2.2-AA-/AT-Abnahme.
- **Ursache:** technische Regressionstests wurden als vollständige
  Konformität gelesen. **Blast Radius:** alle Nutzer mit Assistenzbedarf.
  **Abhängigkeiten:** Accessibility Owner und externe AT-Tester.
  **Gewählte Lösung:** WCAG 2.2 AA als Zielvertrag, Findings einzeln belegen.
  **Verworfene Alternative:** Axe-pass als Zertifizierung.
- **Migration/Environment:** keine. **Erforderliche Tests:** Komponenten,
  drei Browser, Keyboard/Fokus/Zoom/Axe und manuelle AT-Evidence.
  **E2E-ID:** alle UI-E2Es, besonders `E2E-34-01`–`05`.
  **Implementierungsstatus:** automatisierte Basis vorhanden; vollständige
  Abnahme offen. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** NVDA/VoiceOver und Accessibility-Review.

## 5. Payment und Provider

### `F34-PAY-001` — historische Payment-/Incident-Runbooks

- **Ursprüngliche Behauptung:** Runbooks beschreiben nur Mock/Sandbox und
  nicht den implementierten, weiterhin deaktivierten Phase-33-Livevertrag.
  **Quelle:** N; A §B/D. **Kategorie:** Operations. **Anfängliches Risiko:**
  P1. **Prüfstatus:** `CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `codex-plan/runbooks/payment-operations.md`,
  `incident-response.md`, Provider-Composition. **Tatsächlicher Ausführungspfad:**
  Operator-Runbook → Konfiguration → Aktivierung/Recovery.
  **Reproduktion:** Runbook-Matrix gegen Env-Schema und Adaptermodi diffen.
  **Beweise:** historische Formulierungen unterschlagen Live-Code und dessen
  bewusst fehlende Aktivierungsevidence.
- **Ursache:** Runbook blieb auf Phase-24-Scope. **Blast Radius:** falscher
  Cutover oder falsche Incidentreaktion. **Abhängigkeiten:** Provider-/Ledger-
  Vertrag. **Gewählte Lösung:** versioniert präzisieren: Code vorhanden,
  Aktivierung/Evidence nicht. **Verworfene Alternative:** Live als aktiv
  markieren.
- **Migration/Environment:** keine Aktivierung. **Erforderliche Tests:**
  Plan-/Env-Contract und prod-like Bootmatrix. **E2E-ID:** `E2E-34-06`,
  `E2E-34-07`, `E2E-34-20`. **Implementierungsstatus:** Textkorrektur im
  Arbeitsbaum; finaler Audit ausstehend. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** PSP-/Finance-Freigabe.

### `F34-PAY-002` — Mock-Checkout außerhalb isolierter Umgebungen

- **Ursprüngliche Behauptung:** statischer `MockPaymentProvider`,
  `/mock/checkout/...` und `confirmMockPayment` könnten in Preview/Production
  ohne Geldfluss bezahlte Rechte erteilen. **Quelle:** A §B; R ADR-014-Kritik.
  **Kategorie:** Payment/Security. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/billing/mock-billing-policy.ts`,
  Checkout Page/Actions, `app/mock/checkout/[orderId]/**`, Billing-/Marketing-
  CTAs. **Tatsächlicher Ausführungspfad:** Browser → Order → Mock page/action
  → PaymentEvent → Entitlement. **Reproduktion:** Local+disabled positiv;
  CI-contract, Preview, Staging, Production direkt und über CTA negativ.
  **Beweise:** serverseitiges Gate und UI-Gates implementiert; PG-Negativtest
  belegt null Orders/Invoices/Events/Subscriptions außerhalb Local/CI.
- **Ursache:** Legacy-Demo war nur provider-, nicht environmentgebunden.
  **Blast Radius:** kostenlose Rechte und falsche Zahlungsnachweise.
  **Abhängigkeiten:** zentrale Env-Klasse, Payment mode.
  **Gewählte Lösung:** nur `local|ci` plus `disabled`, Gate unmittelbar vor
  jedem Effekt. **Verworfene Alternative:** Route nur verstecken oder anhand
  eines Secrets zulassen.
- **Migration/Environment:** keine Schemaänderung; striktere Env-Matrix.
  **Erforderliche Tests:** Policy-Unit, PG zero-write, Browser local positiv
  und prod-like direkte URL/Action negativ. **E2E-ID:** `E2E-34-08`,
  `E2E-34-09`, `E2E-34-20`. **Implementierungsstatus:** Code/Unit/PG grün;
  E2E auf finalem Candidate ausstehend. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** keines für Mock; echte Zahlung
  separat.

### `F34-PAY-003` — Abo-/Einmalkauf-Composition Roots

- **Ursprüngliche Behauptung:** Abos und Einmalkäufe könnten unterschiedliche
  Providerwahl und versteckte Mock-Fallbacks besitzen. **Quelle:** A §B.
  **Kategorie:** Payment Architecture. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:**
  `lib/providers/payments/payment-composition.ts`, Billing-Checkout- und
  Subscription-Actions, `employer-action-dependencies.ts`.
  **Tatsächlicher Ausführungspfad:** jeweilige UI/Action → Composition →
  Provider/Activation binding → webhook/ledger. **Reproduktion:** alle
  Produktarten und Environments über Importgraph/Bootmatrix ausführen.
  **Beweise:** echte Flows verwenden gemeinsame Contracts; der Legacy-
  Mockcheckout brauchte jedoch das separate Gate aus `F34-PAY-002`.
- **Ursache:** historische Mock- und spätere Live-Pfade wurden additiv
  aufgebaut. **Blast Radius:** inkonsistente Provider- oder Entitlementwahl.
  **Abhängigkeiten:** `F34-PAY-002`, `F34-PAY-006`.
  **Gewählte Lösung:** eine exhaustive Composition plus explizite Legacy-
  Boundary. **Verworfene Alternative:** parallele Env-Heuristiken je Action.
- **Migration/Environment:** Env-Validierung, keine neue Schemaänderung.
  **Erforderliche Tests:** mode matrix, boot contract, one-time/subscription
  Contract- und E2E-Flows. **E2E-ID:** `E2E-34-06`–`10`, `E2E-34-20`.
  **Implementierungsstatus:** statisch verifiziert, finaler voller E2E fehlt.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  echte PSP-Sandbox/Live-Freigabe.

### `F34-PAY-004` — Trennung von Mock- und Live-Finanzereignissen

- **Ursprüngliche Behauptung:** Mock-Ereignisse könnten in echte
  Finanzabgleiche gelangen. **Quelle:** A §B. **Kategorie:** Finance/Data.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** PaymentEvent/Order Providerfelder,
  `finance-reconciliation.ts`, `payment-inbox.ts`, Phase-33-Bindings.
  **Tatsächlicher Ausführungspfad:** Provider webhook/mock confirm → immutable
  event/binding → reconciliation. **Reproduktion:** gemischte Environment-/
  Providerfixture einspeisen. **Beweise:** Provider, mode, environment und
  binding sind persistiert/validiert; Mock wird vom Livepfad abgewiesen.
- **Ursache:** mögliche Gefahr aus Architektur abgeleitet, ohne aktuellen
  Contract zu verfolgen. **Blast Radius:** keiner nachgewiesen; bei Regression
  wäre Finance betroffen. **Abhängigkeiten:** inbox env isolation.
  **Gewählte Lösung:** vorhandene Trennung regressieren.
  **Verworfene Alternative:** neue parallele Ledger-Tabelle ohne Defekt.
- **Migration/Environment:** keine. **Erforderliche Tests:** PG cross-mode,
  reconciliation und signed webhook E2E. **E2E-ID:** `E2E-34-06`,
  `E2E-34-07`, `E2E-34-10`. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler Candidate-E2E ausstehend.
  **Verbleibendes externes Gate:** echte Finance-Reconciliation.

### `F34-PAY-005` — globaler Mock-Mailer in Billing

- **Ursprüngliche Behauptung:** echte Billing-Abläufe könnten global den
  Mock-E-Mail-Provider verwenden. **Quelle:** A §B. **Kategorie:** Provider.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** Notification Outbox,
  `lib/providers/email/delivery-composition.ts`, Billing templates.
  **Tatsächlicher Ausführungspfad:** Billing transaction → durable Outbox →
  Worker → env-/activationgebundener Adapter. **Reproduktion:** Billing event
  in Local, Contract und prod-like; Adapterauswahl prüfen. **Beweise:** heutige
  Composition ist effect-bound; prod-like akzeptiert keinen Local-Mock.
- **Ursache:** älterer globaler Providervertrag. **Blast Radius:** aktuell
  keiner; Regression würde falsche „gesendet“-Evidence erzeugen.
  **Abhängigkeiten:** Email activation/worker. **Gewählte Lösung:** vorhandenen
  Outboxvertrag beibehalten. **Verworfene Alternative:** Billing synchron an
  Mailadapter koppeln.
- **Migration/Environment:** keine. **Erforderliche Tests:** Delivery mode
  unit/contract und Billing→Outbox→Worker E2E. **E2E-ID:** `E2E-34-07`,
  `E2E-34-12`, `E2E-34-16`. **Implementierungsstatus:** keine neue Änderung.
  **Abschließende Evidence:** finaler E2E ausstehend.
  **Verbleibendes externes Gate:** echter Mailprovider.

### `F34-PAY-006` — zentrale Activation-/Environment-Bindung

- **Ursprüngliche Behauptung:** Environment, Provider mode, Adapter und
  persistierte Aktivierung würden nicht erschöpfend zentral geprüft.
  **Quelle:** A §B und Implementierungsinvarianten. **Kategorie:** Provider
  Security. **Anfängliches Risiko:** P0. **Prüfstatus:**
  `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `lib/config/application-environment.ts`,
  `env-schema.ts`, Provider activation bindings/policies, Composition Roots.
  **Tatsächlicher Ausführungspfad:** Prozessboot → Config validation →
  Composition → aktuelles Ledger → immediate effect recheck.
  **Reproduktion:** alle Local/CI/Preview/Staging/Production × disabled/mock/
  contract/sandbox/live Kombinationen. **Beweise:** Phase 33 implementiert
  Bindings; Legacy-Mock und einzelne UI-Seams brauchten Phase-34-Härtung.
- **Ursache:** mehrere Generationen von Adaptern. **Blast Radius:** alle
  externen Effekte. **Abhängigkeiten:** per-Provider Aktivierung und Revocation.
  **Gewählte Lösung:** zentrale Env-Klasse, startup fail-closed und recheck
  unmittelbar vor Effekt. **Verworfene Alternative:** Secret-Präsenz oder
  UI-Flag als Aktivierung.
- **Migration/Environment:** Env-Schema/Activation Ledger; keine zusätzliche
  Freigabe. **Erforderliche Tests:** exhaustive Unit matrix, boot contract,
  revoke-before-effect E2E. **E2E-ID:** `E2E-34-10`, `E2E-34-20`.
  **Implementierungsstatus:** großteils vorhanden; Gesamt-E2E ausstehend.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Provider-Credentials, Vertrag und Approval.

### `F34-PAY-007` — Idempotenz und unklare Providerantworten

- **Ursprüngliche Behauptung:** Timeout, Retry, out-of-order oder unklare
  Providerantwort könne als Erfolg gelten oder doppelt abbuchen.
  **Quelle:** A §B. **Kategorie:** Payment Correctness. **Anfängliches Risiko:**
  P0. **Prüfstatus:** `FALSE_POSITIVE` für den aktuellen Contract.
- **Betroffene Dateien/Funktionen:** Payment provider contract,
  idempotency keys, inbox, order/event state machines, reconciliation.
  **Tatsächlicher Ausführungspfad:** checkout → provider request → webhook →
  inbox/projector → fulfillment. **Reproduktion:** timeout, gleicher Retry,
  duplicate/out-of-order signed event. **Beweise:** dieselbe Operation bindet
  denselben Key; unknown bleibt pending/held; DB uniqueness/locks und
  state-machine tests verhindern Doppelwirkung.
- **Ursache:** Risikohypothese ohne reproduzierten aktuellen Fehler.
  **Blast Radius:** bei Regression Zahlung/Entitlement. **Abhängigkeiten:**
  Provider-Contract-E2E. **Gewählte Lösung:** bestehende Invarianten
  regressieren. **Verworfene Alternative:** unknown als success behandeln.
- **Migration/Environment:** keine. **Erforderliche Tests:** Unit/PG
  concurrency, signed webhook contract, sandbox E2E. **E2E-ID:**
  `E2E-34-06`, `E2E-34-07`. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler Sandboxlauf fehlt.
  **Verbleibendes externes Gate:** PSP-Testzugang.

### `F34-PAY-008` — Contract-/Sandbox-E2E ist kein realer Zahlungsnachweis

- **Ursprüngliche Behauptung:** Einmalkäufe und Abos seien bis zu echter
  Zahlung/WTP bewiesen oder könnten allein durch Mocks bewiesen werden.
  **Quelle:** A §B/I; R. **Kategorie:** QA/Commercial Activation.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `BLOCKED_E2E` technisch und
  `BLOCKED_EXTERNAL` für WTP/Live.
- **Betroffene Dateien/Funktionen:** Stripe contract adapter, webhook route,
  checkout/subscription/fulfillment, Commercial Evidence.
  **Tatsächlicher Ausführungspfad:** Browser → Provider-Testmodus → signierter
  webhook → invoice/ledger/entitlement → sichtbarer Zustand.
  **Reproduktion:** echter PSP-Testmodus ohne Belastung; separater realer
  unabhängiger Kauf für WTP. **Beweise:** lokale Contract-/Stubtests existieren,
  sind aber ausdrücklich keine Live-Evidence.
- **Ursache:** technische Simulation und Marktbeweis wurden vermischt.
  **Blast Radius:** falsches `GO` und ungeprüfte Umsatzannahmen.
  **Abhängigkeiten:** PSP-Testkonto, Finance, Legal, Nutzer.
  **Gewählte Lösung:** Contract, Sandbox und Live separat evidenzieren.
  **Verworfene Alternative:** Mock als Zahlung oder Seed als Nachfrage zählen.
- **Migration/Environment:** Sandbox-/Live-Konfiguration erst mit Approval.
  **Erforderliche Tests:** vollständige positive/negative Payment-E2Es.
  **E2E-ID:** `E2E-34-06`, `E2E-34-07`. **Implementierungsstatus:** lokal noch
  nicht final, extern blockiert. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** PSP und echte WTP-Evidence.

### `F34-PAY-009` — Entitlements nur aus gültiger Payment-Evidence

- **Ursprüngliche Behauptung:** Credits, Boosts oder Rechte könnten ohne
  nachweislich gültiges Zahlungsereignis entstehen. **Quelle:** A §B.
  **Kategorie:** Finance/Authorization. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `PARTIALLY_CONFIRMED` wegen des Legacy-Mockpfads; echte
  Providerpfade selbst zeigen keinen Bypass.
- **Betroffene Dateien/Funktionen:** Entitlements, Credits, Boosts,
  fulfillments, Mock confirm, payment inbox. **Tatsächlicher Ausführungspfad:**
  event → validated order/provider binding → idempotent fulfillment.
  **Reproduktion:** direkte Action, falscher Betrag/provider, replay und Mock
  in prod-like; DB-Diff prüfen. **Beweise:** Live/contract verlangt gültige
  Evidenz; `F34-PAY-002` schließt den einzigen bestätigten Legacy-Bypass.
- **Ursache:** Mock-Demo war fachlich eine Berechtigungsquelle.
  **Blast Radius:** Paid Features und Finance. **Abhängigkeiten:** PAY-002,
  PAY-006. **Gewählte Lösung:** Mock strikt isolieren, echte Fulfillment-
  Invarianten unangetastet lassen. **Verworfene Alternative:** sämtliche
  Demoentitlements entfernen und Local-Tests brechen.
- **Migration/Environment:** keine neue Migration. **Erforderliche Tests:**
  PG zero-write denials, payment contracts, browser payment E2E.
  **E2E-ID:** `E2E-34-06`–`09`. **Implementierungsstatus:** Fix implementiert,
  E2E pending. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** Live PSP/Finance.

## 6. Suche, Trust, Datenbank und öffentliche Wahrheit

### `F34-SEARCH-001` — SQL- und kanonische Trust-Prüfung driften

- **Ursprüngliche Behauptung:** SQL-Ranking und JS-/Domain-Evaluator liefern
  unterschiedliche Jobmengen; `HYDRATION_MISMATCH` blockiert deshalb die
  Suche. **Quelle:** R, Z. 13–15/102–104; A §C. **Kategorie:** Public Search.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `lib/jobs/public-read-model.ts`,
  `lib/companies/verification/policy-v2.ts`, Trust-/Moderation-Projektionen,
  `/jobs`. **Tatsächlicher Ausführungspfad:** HTTP `/jobs` → SQL candidates →
  canonical hydration/evaluation → response. **Reproduktion:** publizierten
  Job mit gültigem Trust suchen; danach Projektion, UID-Evidence, Gültigkeit
  oder Containment entziehen. **Beweise:** alter SQL-Pfad spiegelte nicht alle
  Strong-Trust-Invarianten; neue Predicate-Matrix und PG-Tests liefern
  zulässige Treffer beziehungsweise exakt null statt globalem 500.
- **Ursache:** duplizierte Eligibility-Logik mit unterschiedlichem Umfang.
  **Blast Radius:** gesamte öffentliche Suche. **Abhängigkeiten:** einheitliches
  `asOf`, Trust-/Moderationversionen. **Gewählte Lösung:** SQL-Prädikate an den
  kanonischen Evaluator angleichen, Drift weiterhin fail-closed.
  **Verworfene Alternative:** Hydration-Prüfung entfernen oder Fehler nur
  verdecken.
- **Migration/Environment:** nutzt additive Suchmigration unter SEARCH-005.
  **Erforderliche Tests:** Predicate-Unit, PG Trust-Matrix, Browser/HTTP
  positiv und Trust-Entzug negativ. **E2E-ID:** `E2E-34-03`, `E2E-34-11`.
  **Implementierungsstatus:** Code-/PG-Verträge und der reale Browserpfad
  belegen gültige Sichtbarkeit sowie Freshness-/Trust-Ausschluss ohne globalen
  Fehler in Chromium, Firefox und WebKit. **Abschließende Evidence:**
  Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines für lokale technische Korrektur.

### `F34-SEARCH-002` — Startseite lädt 2.001 Jobs für sechs Karten

- **Ursprüngliche Behauptung:** Homepage lädt bis zu 2.001 Jobs und sortiert
  im JS, obwohl sechs Karten benötigt werden. **Quelle:** R, Z. 185–189; A
  §C. **Kategorie:** Performance. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `listHomepageJobs()` in
  `lib/jobs/public-read-model.ts`, `app/(public)/page.tsx`.
  **Tatsächlicher Ausführungspfad:** GET `/` → DB-ranked paginated query →
  sechs Karten. **Reproduktion:** 2.006+ zulässige Treffer seeden und Queryzahl/
  Resultset messen. **Beweise:** neuer Pfad liefert genau sechs eindeutige
  Jobs; PG-Test und Query-shape-Test grün.
- **Ursache:** Home nutzte früher toleranten Bulk-Hydrationpfad. **Blast Radius:**
  Homepage-Latenz, RAM und Pool. **Abhängigkeiten:** SEARCH-001,
  SEARCH-005. **Gewählte Lösung:** denselben DB-gerankten, begrenzten Public-
  Read-Pfad verwenden. **Verworfene Alternative:** JS-Limit nach Bulkload.
- **Migration/Environment:** Suchindexmigration. **Erforderliche Tests:**
  Unit query shape, PG large cohort, echter HTTP-/Browser-Lastpfad.
  **E2E-ID:** `E2E-34-03` plus Performance-Evidence. **Implementierungsstatus:**
  Code/PG grün, HTTP-Last-E2E ausstehend. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** Ziel-SLO und Staginglast.

### `F34-SEARCH-003` — unbounded Clusterzählung

- **Ursprüngliche Behauptung:** Startseitencluster würden alle Jobs in
  500er-Batches lesen und bei 50.000 Jobs hunderte DB-Runden erzeugen.
  **Quelle:** R, Z. 185–189; A §C. **Kategorie:** Performance/DB.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `loadExactPublicClusterCounts()` in
  `lib/jobs/public-read-model.ts`. **Tatsächlicher Ausführungspfad:** Homepage
  → eine SQL-Aggregation mit canonical eligibility → Category-/Canton-Counts.
  **Reproduktion:** >2.000 Treffer, Queryspy und Trust-Revoke.
  **Beweise:** alter Batchscan reproduziert; Arbeitsbaum verwendet eine
  Repeatable-Read-Aggregatquery, exakte Counts und keine Trust-Fan-outs;
  Query-shape 23/23 und PG 20/20 grün.
- **Ursache:** exakte Counts wurden aus hydratisierten Records gebaut.
  **Blast Radius:** DB-Verbindungen und Home-Verfügbarkeit.
  **Abhängigkeiten:** SEARCH-001. **Gewählte Lösung:** kleinste robuste SQL-
  Aggregation mit denselben Prädikaten. **Verworfene Alternative:** sofortiges
  materialisiertes Read-Model ohne Messnachweis.
- **Migration/Environment:** keine zusätzliche Migration. **Erforderliche Tests:**
  Query-shape, PG count/trust, HTTP-Last-E2E.
  **E2E-ID:** `E2E-34-03`. **Implementierungsstatus:** Code/Integration
  vorhanden; E2E/realistische Last ausstehend. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** Staging-SLO.

### `F34-SEARCH-004` — DB-Pool-Fan-out der Startseite

- **Ursprüngliche Behauptung:** ein Homepage-Request öffne 8–10 gleichzeitige
  Verbindungen bei Poollimit 10 und der zweite Request scheitere.
  **Quelle:** R, Z. 185–188; A §C. **Kategorie:** Performance/Availability.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** öffentliche Home-Loader,
  `lib/db/prisma.ts`, Poolkonfiguration. **Tatsächlicher Ausführungspfad:**
  GET `/` → parallele Loader → Pool. **Reproduktion:** Connection telemetry
  unter parallelen echten HTTP-Anfragen. **Beweise:** unbounded Search-/Cluster-
  Pfade waren real und wurden reduziert; die exakte Behauptung „8–10“ ist
  ohne Runtime-Poolmessung nicht abschließend bewiesen.
- **Ursache:** parallele Serverkomponenten plus teure/mehrstufige Read-Pfade.
  **Blast Radius:** öffentliche Homepage. **Abhängigkeiten:** Deploymentpool,
  Supabase-Pooler. **Gewählte Lösung:** Query-Fan-out zuerst reduzieren und
  reale Poolmetriken messen. **Verworfene Alternative:** Pool blind erhöhen.
- **Migration/Environment:** eventuell Poolkonfiguration nach Messung.
  **Erforderliche Tests:** instrumentierter concurrent HTTP load, DB
  connection count, timeout/error assertions. **E2E-ID:** Performanceanhang zu
  `E2E-34-03`. **Implementierungsstatus:** Teilursachen geändert; E2E-Messung
  fehlt. **Abschließende Evidence:** ausstehend. **Verbleibendes externes
  Gate:** Zielpool/SLO auf Staging.

### `F34-SEARCH-005` — fehlender Suchindex

- **Ursprüngliche Behauptung:** `LIKE '%term%'` über berechnete Ausdrücke sei
  nicht indexierbar; ohne Volltext-/Trigramindex scheitere Suche unter Last.
  **Quelle:** R, Z. 187–191; A §C. **Kategorie:** DB/Performance.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** JobRevision Search-Prädikate,
  `20260806210000_phase_34_public_search_trigram`,
  `lib/jobs/public-read-model.ts`. **Tatsächlicher Ausführungspfad:** GET
  `/jobs?q=...` → indexed SQL → hydration. **Reproduktion:** realistische
  Treffer-/Nichttrefferdaten, `EXPLAIN (ANALYZE, BUFFERS)` und Browserquery.
  **Beweise:** historische Migrationen hatten keinen passenden Index;
  additive generated search column/trigram index im Arbeitsbaum; Benchmark
  zeigt Indexnutzung auf lokaler PG16.
- **Ursache:** Suchfunktion wuchs ohne persistierten indexierbaren Ausdruck.
  **Blast Radius:** alle Keyword-Suchen. **Abhängigkeiten:** `pg_trgm`,
  immutable revision semantics (`F34-MIG-001`). **Gewählte Lösung:** additive
  generated column plus GIN/trigram, keine alte Migration ändern.
  **Verworfene Alternative:** sofort externe Search Engine oder ungemessene
  FTS-Neuarchitektur.
- **Migration/Environment:** additive Migration; Fresh/Upgrade/Restart nötig.
  **Erforderliche Tests:** schema/query-shape, PG explain/load, Migration- und
  HTTP-E2E positiv/negativ. **E2E-ID:** `E2E-34-03`, `E2E-34-19`.
  **Implementierungsstatus:** Migration/Tests vorhanden, vollständiger E2E
  fehlt. **Abschließende Evidence:** ausstehend. **Verbleibendes externes
  Gate:** Zielplattform-Extension und reale SLO.

### `F34-SEARCH-006` — `COUNT(*)` pro Suchseite

- **Ursprüngliche Behauptung:** jede paginierte Suchseite führe einen teuren
  vollständigen `COUNT(*)` aus. **Quelle:** A §C. **Kategorie:** Performance.
  **Anfängliches Risiko:** P2. **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** Pagination/count path in
  `lib/jobs/public-read-model.ts`. **Tatsächlicher Ausführungspfad:**
  `/jobs` query → result page plus total. **Reproduktion:** broad/selective
  Queries mit großer Datenmenge und Explain. **Beweise:** Count existiert für
  exakte Pagination; lokale Benchmarks liegen innerhalb Testbudget, aber
  Ziel-SLO und Produktionskardinalität sind nicht belegt.
- **Ursache:** UX verlangt exakte Seitenzahl. **Blast Radius:** Search-Latenz.
  **Abhängigkeiten:** Produktentscheidung exact versus approximate/has-more.
  **Gewählte Lösung:** messen, Index nutzen, erst bei belegtem Engpass UX/
  Count ändern. **Verworfene Alternative:** exakte Pagination ohne
  Produktentscheid entfernen.
- **Migration/Environment:** keine weitere. **Erforderliche Tests:** Explain,
  concurrent HTTP load und UX pagination E2E. **E2E-ID:** Performanceanhang
  zu `E2E-34-03`. **Implementierungsstatus:** gemessen lokal, final offen.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  SLO/Produktentscheidung.

### `F34-SEARCH-007` — Timeout-/Pooler- und PostgreSQL-Version

- **Ursprüngliche Behauptung:** als Startparameter gesetzte Statement-,
  Transaction- oder Idle-Timeouts könnten vom Supabase-Pooler verworfen
  werden; PG17 könne eine auf PG16 ausgelegte Semantik verändern.
  **Quelle:** R, Z. 189–191; A §C/D/H. **Kategorie:** Platform Compatibility.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** DB URL/options, transaction wrappers,
  Docker PG16, Supabase target. **Tatsächlicher Ausführungspfad:** App/Worker
  → Pooler → DB session/transaction. **Reproduktion:** `SHOW`/timeout query
  durch exakt den Zielpooler und Versionsmatrix PG16/aktuelle Zielversion.
  **Beweise:** lokale PG16-Tests können den Cloud-Pooler nicht beweisen; kein
  belastbarer Beleg, dass PG17 die konkrete Rankingsemantik verursacht.
- **Ursache:** Plattformmetadaten fehlen beziehungsweise Reviewverdacht.
  **Blast Radius:** unbounded Queries oder überraschende Timeouts.
  **Abhängigkeiten:** Supabase-Zugriff. **Gewählte Lösung:** expliziten Runtime-
  Probe/Smoke definieren; DB-Transaktions-Timeouts zusätzlich dort setzen, wo
  nötig. **Verworfene Alternative:** Versionsverdacht als Ursache erklären.
- **Migration/Environment:** möglicherweise Connection-/transaction config.
  **Erforderliche Tests:** PG16/target matrix, Pooler timeout E2E, kill/
  recovery. **E2E-ID:** `E2E-34-19`, `E2E-34-20`.
  **Implementierungsstatus:** lokal nicht abschließbar. **Abschließende Evidence:**
  fehlt. **Verbleibendes externes Gate:** Ziel-Supabase/PgBouncer.

### `F34-SEARCH-008` — `force-dynamic` und tote Prisma-Modelle

- **Ursprüngliche Behauptung:** unnötiges `force-dynamic` und tote Modelle
  seien Performance-/Wartbarkeitsdefekte. **Quelle:** A §C. **Kategorie:**
  Architecture/Performance. **Anfängliches Risiko:** P2. **Prüfstatus:**
  `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** öffentliche Routes mit dynamic flags,
  `prisma/schema.prisma`, Import-/Querygraph. **Tatsächlicher Ausführungspfad:**
  Request-Rendering mit aktuellem Trust-, Zeit-, Tenant- oder
  Sicherheitskontext; die fünf nicht über Prisma-Delegates konsumierten
  Modelle gehören zu bewusst deaktivierten P1-Paketen.
  **Reproduktion:** 91 Routes deklarieren den Modus explizit. Bereits das
  Root-Layout liest pro Request den CSP-Nonce aus `headers()`, damit kein
  vorgerendertes HTML einen wiederverwendeten Nonce trägt. Öffentliche
  Datenflächen lesen ausserdem zeitabhängige Trust-/Freshness-Zustände.
  `ReferralLink`/`ReferralAttribution` sind dem deaktivierten
  `REQ-GRW-003`-Paket zugeordnet; `RecruiterMandate`,
  `RecruiterMandateJob` und `RecruiterMandateEvent` dem ausdrücklich
  route-losen `REQ-REC-002`-P1-Paket. **Beweise:** `app/layout.tsx`,
  `codex-plan/10-employer-portal.md`, `requirements-matrix.md` und der
  vollständige Model-/Referenzscan; ein gemessener Cache- oder Runtimefehler
  wurde nicht reproduziert.
- **Ursache:** Der Review deutete explizite Sicherheits-/Aktualitätssemantik
  und vorab modellierte, aber deaktivierte Pakete als Defekt. **Blast Radius:**
  keine bestätigte Laufzeitwirkung; ein pauschales Entfernen könnte dagegen
  CSP, Trust-Freshness oder spätere additive Aktivierung brechen.
  **Abhängigkeiten:** Aktivierung der beiden dokumentierten P1-Pakete bleibt
  separat gegatet. **Gewählte Lösung:** keine spekulative Runtime- oder
  Schemamutation. **Verworfene Alternative:** globale Flag-Entfernung oder
  destruktive Modelldrops ohne Messwert und aktivierten Fachvertrag.
- **Migration/Environment:** keine. **Erforderliche Tests:** finaler Build,
  Route-/Plan-Audit und die bestehenden CSP-/sensitive-route Contracts;
  Performanceoptimierung erst mit reproduzierbarem Profil. **E2E-ID:** keine
  eigene Journey für den widerlegten Defekt. **Implementierungsstatus:** keine
  Codeänderung erforderlich. **Abschliessende Evidence:** finaler Candidate
  ausstehend. **Verbleibendes externes Gate:** keines.

### `F34-SEARCH-009` — Such-Error-Boundary

- **Ursprüngliche Behauptung:** fehlende Error-Boundary mache einen
  fail-closed Suchfehler für alle Nutzer zur unverständlichen Fehlerseite.
  **Quelle:** A §C/G; N. **Kategorie:** UX/Resilience. **Anfängliches Risiko:**
  P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** neue `app/(public)/jobs/error.tsx`,
  `/jobs`. **Tatsächlicher Ausführungspfad:** Browser → Server rendering error
  → segment boundary → sichere Retry/Home-Aktion. **Reproduktion:**
  kontrollierten PublicSearch-Fehler injizieren, keine Interna anzeigen.
  **Beweise:** Boundary und Unit/UI-Test vorhanden.
- **Ursache:** Route hatte keinen segmentspezifischen Recovery-Zustand.
  **Blast Radius:** gesamte Search UX, nicht Datenintegrität.
  **Abhängigkeiten:** Error observability. **Gewählte Lösung:** verständliche
  de-CH Boundary, Ursache serverseitig weiter erfassen. **Verworfene Alternative:**
  fail-closed Datenprüfung abschalten.
- **Migration/Environment:** keine. **Erforderliche Tests:** component und
  echter Browser Fehler/Retry positiv/negativ; Log-Redaction.
  **E2E-ID:** `E2E-34-18`. **Implementierungsstatus:** der kontrolliert
  induzierte Suchfehler rendert die redigierte Segment-Boundary, schreibt
  keine Geschäftsdaten und erholt sich in allen drei Browsern; die temporär
  umbenannte `searchDocument`-Spalte war ausschliesslich Fault Injection und
  kein Migrationsdefekt. **Abschließende Evidence:** Phase-34-Browsergate
  45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** externer Error-Sink unter OPS-008.

### `F34-SEARCH-010` — Trust-Ablauf/Revoke ohne globalen Ausfall

- **Ursprüngliche Behauptung:** ablaufende, gesperrte oder widerrufene Trust-
  Projektion könne `HYDRATION_MISMATCH` für den gesamten Resultset auslösen.
  **Quelle:** A §C; R. **Kategorie:** Trust/Availability.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** Public Job/Company Read Models,
  Trust projection, restrictions, search/home/recommendations/sitemap.
  **Tatsächlicher Ausführungspfad:** Trust mutation → public consumers at
  same `asOf`. **Reproduktion:** gültige Projektion veröffentlichen, dann
  expire/revoke/ON_HOLD und alle Oberflächen prüfen. **Beweise:** SQL-
  Prädikate wurden auf canonical trust ergänzt; PG-Tests zeigen sicheren
  Ausschluss.
- **Ursache:** Consumer drift und unterschiedliche Zeitpunkte.
  **Blast Radius:** Suche, Homepage, Firma, Alerts, Empfehlungen und SEO.
  **Abhängigkeiten:** SEARCH-001, response policy, sitemap.
  **Gewählte Lösung:** gemeinsame eligibility/provenance und konsistentes
  `asOf`. **Verworfene Alternative:** stale Daten tolerant anzeigen.
- **Migration/Environment:** keine zusätzliche. **Erforderliche Tests:** PG
  cross-consumer und Browser-E2E mit Revoke. **E2E-ID:** `E2E-34-03`,
  `E2E-34-11`, `E2E-34-15`. **Implementierungsstatus:** Search, Direct Detail,
  Company-Badge und Radar reagieren konsistent auf Freshness und echten
  Trust-Revoke; die beim Gate entdeckte fehlende Freshness-Projektion im
  Direct-Detail-Read wurde geschlossen und durch Unit-/PG-Regressionsschutz
  versiegelt. **Abschließende Evidence:** Phase-34-Browsergate 45/45 auf
  Digest `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa`
  sowie [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines.

### `F34-DATA-001` — öffentliche Antwortquoten ohne Live-Projektion

- **Ursprüngliche Behauptung:** Response-Rate-Angaben stammen aus Seed-
  Feldern und werden im echten Bewerbungs-/Messaging-Lifecycle nie gepflegt.
  **Quelle:** R, Z. 171–183; A §C. **Kategorie:** Data Truth/UX.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `lib/search/public-response-evidence-policy.ts`,
  public jobs/company/recommendations, response evidence fields.
  **Tatsächlicher Ausführungspfad:** Public read → provenance policy → render,
  ranking/filter. **Reproduktion:** Demo/seed value in local versus prod-like
  lesen; kein Live-Durable-Projektor vorhanden. **Beweise:** Felder werden
  geseedet, aber nicht aus realem Lifecycle aktualisiert; Arbeitsbaum blendet
  sie in prod-like aus und entfernt ihren Ranking-/Filtereinfluss, Local/CI
  darf synthetische Demo zeigen.
- **Ursache:** Demo-Projektion wurde als Produktclaim konsumiert. **Blast Radius:**
  öffentliche Vertrauens- und Rankingbehauptungen.
  **Abhängigkeiten:** spätere durable response projection und KPI-Definition.
  **Gewählte Lösung:** bis dahin production-like suppression.
  **Verworfene Alternative:** Seedwert als live deklarieren oder ad hoc aus
  unvollständigen Events rechnen.
- **Migration/Environment:** keine; zentrale environment/provenance policy.
  **Erforderliche Tests:** policy unit, PG public consumers, Browser local
  positiv/prod-like negativ. **E2E-ID:** `E2E-34-03`, `E2E-34-15`,
  `E2E-34-20`. **Implementierungsstatus:** Local zeigt das klar synthetische
  Signal; Preview entfernt Claim, Sortierung und Filter ohne Geschäftsschreib-
  vorgang, jeweils in Chromium, Firefox und WebKit. **Abschließende Evidence:**
  Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** KPI/Product-Definition und Live-Datenbasis.

## 7. Deployment, Worker und Betrieb

### `F34-OPS-001` — falscher HMAC-Keyring im Worker-Runbook

- **Ursprüngliche Behauptung:** Suppression-HMAC-Cutover nennt den Delivery-
  AES-Keyring statt des Recipient-HMAC-Keyrings. **Quelle:** N; A §D.
  **Kategorie:** Operations/Privacy. **Anfängliches Risiko:** P0 Operations.
  **Prüfstatus:** `CONFIRMED`.
- **Betroffene Dateien/Funktionen:**
  `codex-plan/runbooks/worker-operations.md`,
  `NOTIFICATION_RECIPIENT_HASH_KEYS`, `NOTIFICATION_DELIVERY_KEYS`.
  **Tatsächlicher Ausführungspfad:** Operator folgt Runbook → Keyrotation →
  Suppression lookup/delivery. **Reproduktion:** Runbooknamen gegen Env-Schema
  und Hash-/Encryption-Verbraucher vergleichen. **Beweise:** Zeilen 186–188
  verwiesen auf den falschen Keyring; Korrektur ist im Arbeitsbaum.
- **Ursache:** zwei getrennte Schlüsselzwecke verwechselt. **Blast Radius:**
  Suppressionverlust oder unzustellbare Payloads. **Abhängigkeiten:** Env-
  Inventory. **Gewählte Lösung:** korrekten Recipient-HMAC-Keyring nennen und
  Zwecke explizit trennen. **Verworfene Alternative:** Code an falsches
  Runbook anpassen.
- **Migration/Environment:** nur Runbook; keine Rotation ausgeführt.
  **Erforderliche Tests:** Plan-/Env-Contract, lokaler Rotation-/Suppression-
  Drill; Browser nicht für reine Textkorrektur. **E2E-ID:**
  `E2E-34-12`, `E2E-34-16` bei späterem Runtime-Drill.
  **Implementierungsstatus:** Textkorrektur vorhanden, finaler Audit fehlt.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Operator-Rotation in echter Umgebung.

### `F34-OPS-002` — stale Worker-Readiness

- **Ursprüngliche Behauptung:** nach einem erfolgreichen Lauf bleibe
  `/health/ready` bei später hängendem Cycle oder Heartbeat dauerhaft grün.
  **Quelle:** N; A §D. **Kategorie:** Runtime Health. **Anfängliches Risiko:**
  P1. **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/ops/runtime-health.ts`,
  `heartbeat-loop.ts`, worker health server/runtime. **Tatsächlicher Ausführungspfad:**
  worker cycle/heartbeat → in-memory health → real HTTP
  `/health/ready`. **Reproduktion:** erst success, dann hängenden Cycle/
  Heartbeat simulieren. **Beweise:** neue per-request Bewertung, fünf Minuten
  Cyclebudget und Heartbeat-Timeout; fokussierter echter HTTP-Test liefert
  live=200 und ready=503.
- **Ursache:** readiness speicherte nur letzten Erfolg. **Blast Radius:**
  Orchestrator hält wirkungslosen Worker für gesund. **Abhängigkeiten:**
  Scheduler/health thresholds. **Gewählte Lösung:** aktuelle Liveness-
  Zustände und Bounds jedes Mal berechnen. **Verworfene Alternative:** Prozess
  bei jedem einzelnen Fehler sofort töten.
- **Migration/Environment:** keine. **Erforderliche Tests:** Unit timing,
  HTTP contract, Compose worker happy/hung/heal E2E.
  **E2E-ID:** `E2E-34-12`, `E2E-34-20`. **Implementierungsstatus:** Code und
  fokussierte Tests grün; Compose-Candidate-E2E fehlt. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** Hosting health probe.

### `F34-OPS-003` — Provider-Inbox-Age und Projector-Health

- **Ursprüngliche Behauptung:** Phase 33 erkläre Payment-/E-Mail-Inbox-Age
  und Projector-Health geschlossen, obwohl gemeinsamer Age-Vertrag und
  Runtime-Degradation fehlten. **Quelle:** N; A §D. **Kategorie:** Operations.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/ops/provider-inbox-health.ts`,
  `runtime-health.ts`, Admin-Systemseite, additive Migration
  `20260806200000_phase_34_provider_inbox_health`. **Tatsächlicher Ausführungspfad:**
  inbox rows → age/broken retry snapshot → worker/scheduler
  readiness und redigierte Adminsicht. **Reproduktion:** aged pending,
  broken retry und healed row je Environment einspielen; HTTP readiness und
  Admin-RBAC prüfen. **Beweise:** 5-/15-Minuten-Policy, Env-Bindung, Indizes,
  PG positiv/negativ/heal und Runtime-HTTP-Contract vorhanden.
- **Ursache:** Queue-Zustand war nur als Datenbankzeile, nicht als operativer
  Healthvertrag konsumiert. **Blast Radius:** unbemerkter Zahlungs-/E-Mail-
  Projektionsstau. **Abhängigkeiten:** autonomous handlers, monitoring.
  **Gewählte Lösung:** gemeinsamer Snapshot und worker/scheduler degradation;
  Web-App readiness bleibt für Recovery erreichbar. **Verworfene Alternative:**
  gesamte Web-App wegen Inbox-Stau abschalten.
- **Migration/Environment:** additive Indizes; Environment in Query.
  **Erforderliche Tests:** Unit, PG age/heal/isolation, Admin authorization,
  Compose/HTTP E2E. **E2E-ID:** `E2E-34-12`, `E2E-34-13`,
  `E2E-34-19`. **Implementierungsstatus:** Code/PG/HTTP-Contract vorhanden,
  full Compose E2E fehlt. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** Pager/alert receipt.

### `F34-OPS-004` — Payment-Recovery über Environmentgrenze

- **Ursprüngliche Behauptung:** Scheduler-Bridge-Scan filterte Payment-
  Inboxen nicht nach Environment und konnte Work Items für fremde
  Umgebungen anlegen. **Quelle:** N; A §B/D. **Kategorie:** Isolation.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:**
  `resumePaymentInboxProjectionBacklog()` in `lib/billing/payment-inbox.ts`,
  `lib/ops/worker-scheduler.ts`. **Tatsächlicher Ausführungspfad:** scheduler
  scan → WorkItem → projector. **Reproduktion:** gleiche Statuszeilen in zwei
  Environments, Scheduler nur eines starten. **Beweise:** Query und Callsite
  verlangen jetzt validiertes `APP_ENV`; bestehender paralleler PG-Recovery-
  Test belegt isolation/exactly-once.
- **Ursache:** Scan hatte keinen expliziten Tenant „Environment“.
  **Blast Radius:** Test/Preview-Ereignisse in falscher Workerqueue.
  **Abhängigkeiten:** provider binding. **Gewählte Lösung:** Environment im
  SQL-Prädikat und Schedulerargument. **Verworfene Alternative:** nachträglich
  im Handler filtern, weil Work Item bereits falsch wäre.
- **Migration/Environment:** keine. **Erforderliche Tests:** PG concurrent
  isolation und echter Scheduler→worker E2E positiv/negativ.
  **E2E-ID:** `E2E-34-10`, `E2E-34-12`. **Implementierungsstatus:** Code/PG
  grün, Runtime-E2E fehlt. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** keines lokal.

### `F34-OPS-005` — Migrationen und Deployment-Readiness

- **Ursprüngliche Behauptung:** Deploy-Build führe keine Migrationen aus;
  obwohl Readiness Schema-Drift erkennt, frage die Plattform sie nicht ab.
  **Quelle:** R, Z. 27–35; A §D. **Kategorie:** Deployment/Data.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `BLOCKED_EXTERNAL` bei
  bestätigtem Repository-/Deploymentvertrag.
- **Betroffene Dateien/Funktionen:** `package.json` build, Deployment-
  Runbook, `lib/db/health.ts`, `/health/ready`, Vercel/Scheduler-Config.
  **Tatsächlicher Ausführungspfad:** release migration job → app boot →
  readiness probe → traffic. **Reproduktion:** alte DB gegen neuen Build ohne
  migrate, danach mit `prisma migrate deploy`; Platform probe beobachten.
  **Beweise:** App-Build migriert bewusst nicht; das ist sicher, wenn ein
  separater release step/probe existiert, für die externe Vercel-Konfiguration
  aber nicht belegt. Latest required migration wurde im Arbeitsbaum aktualisiert.
- **Ursache:** Repository und Cloud-Orchestration sind getrennt.
  **Blast Radius:** neue App auf altem Schema. **Abhängigkeiten:** Hosting,
  release pipeline, DB credentials. **Gewählte Lösung:** separate idempotente
  Migration vor Traffic plus readiness gate. **Verworfene Alternative:**
  Migration in jeden serverless App-Build/Boot einbauen.
- **Migration/Environment:** alle neuen additiven Migrationen; external deploy
  config. **Erforderliche Tests:** old→new migrate, partial/restart,
  app+worker boot, health/smoke. **E2E-ID:** `E2E-34-19`, `E2E-34-20`.
  **Implementierungsstatus:** lokaler Vertrag teilweise; Platformintegration
  unbewiesen. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** Vercel/Supabase release pipeline/probes.

### `F34-OPS-006` — angeblich kein Worker-/Scheduler-Artefakt

- **Ursprüngliche Behauptung:** es gebe nur ein npm-Skript, kein
  deploybares Worker-/Scheduler-Artefakt; Phase 23 funktioniere nirgends.
  **Quelle:** R, Z. 90–96/163–168. **Kategorie:** Operations.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `scripts/phase23-worker.ts`, worker
  runtime/service/scheduler, Docker-/runtime scripts, runbooks.
  **Tatsächlicher Ausführungspfad:** separater Prozess → queue claim/lease →
  handler → completion/retry/DLQ. **Reproduktion:** Docker/local runtime mit
  realer PG-Queue starten. **Beweise:** aktueller Baum enthält explizite
  Worker-, Scheduler-, health-, chaos- und activation artifacts sowie Tests.
  Dass Vercel den Dauerprozess nicht hostet, bleibt externe Architektur.
- **Ursache:** Review analysierte älteren Tree beziehungsweise verwechselte
  Apphosting mit Workerhosting. **Blast Radius:** damalige Automation;
  aktuell Hostinggate. **Abhängigkeiten:** separater Workerhost.
  **Gewählte Lösung:** vorhandenen Prozessvertrag E2E prüfen.
  **Verworfene Alternative:** Worker als Vercel request hacken.
- **Migration/Environment:** Worker env/activation. **Erforderliche Tests:**
  queue/lease/retry/DLQ/kill-switch und Compose E2E. **E2E-ID:**
  `E2E-34-12`, `E2E-34-13`. **Implementierungsstatus:** Code vorhanden,
  finaler Candidate-E2E ausstehend. **Abschließende Evidence:** bestehende
  Tests, finaler Run offen. **Verbleibendes externes Gate:** Worker-/Scheduler-
  Hosting und Owner.

### `F34-OPS-007` — angeblich kein Live-E-Mail-Adapter

- **Ursprüngliche Behauptung:** E-Mail kenne nur disabled/local_mock/
  resend_sandbox und besitze keinen Produktivmodus. **Quelle:** R,
  Z. 90–96/163–166. **Kategorie:** Provider. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `lib/providers/email/resend-email-provider.ts`,
  delivery composition, env schema, activation binding, Resend webhook/inbox.
  **Tatsächlicher Ausführungspfad:** outbox → worker → activation-bound
  `resend_live` → provider → signed event inbox. **Reproduktion:** exhaustive
  mode matrix; no-network local/CI; production-like without activation.
  **Beweise:** Live-Adapter und webhook contract existieren; Live bleibt
  mangels externer Evidence deaktiviert.
- **Ursache:** Review bezog sich auf vor Phase 33. **Blast Radius:** keine
  heutige Codeabwesenheit; Aktivierungsrisiko bleibt. **Abhängigkeiten:**
  provider contract, DPA, domain setup. **Gewählte Lösung:** vorhandene
  fail-closed Composition prüfen. **Verworfene Alternative:** Sandbox als
  Live deklarieren.
- **Migration/Environment:** `EMAIL_PROVIDER_MODE=resend_live` nur mit
  erlaubter Environment-/Ledgerbindung. **Erforderliche Tests:** contract,
  outbox/worker/webhook E2E; keine echte Mail ohne Freigabe.
  **E2E-ID:** `E2E-34-12`, `E2E-34-16`, `E2E-34-20`.
  **Implementierungsstatus:** Code vorhanden; final/extern offen.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Resend-Konto, Domain, DPA, Testempfänger und Approval.

### `F34-OPS-008` — Monitoring, Pager und Fehlerdiagnose

- **Ursprüngliche Behauptung:** bei nächtlichem Ausfall existierten weder
  Error-Tracking, Monitoring noch Alarme; Fehlerlogging verliere die Ursache.
  **Quelle:** R, Z. 31–35/159–161; A §D. **Kategorie:** Operations/Security.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `BLOCKED_EXTERNAL` mit
  repository-interner Teilhärtung unter `F34-SEC-005`.
- **Betroffene Dateien/Funktionen:** structured logger/error boundary,
  runtime/provider health, admin ops, incident runbook; externer sink/pager.
  **Tatsächlicher Ausführungspfad:** Exception/health degradation → redigiertes
  Event/metric → sink → alert → receipt/owner. **Reproduktion:** kontrollierte
  Exception, queue age, worker hang und provider error; Receipt nachweisen.
  **Beweise:** Code kann sichere context/digest events erzeugen; kein externer
  Pagerreceipt oder SLO/Schedule im Repository.
- **Ursache:** externe Observability-Plattform ist nicht Teil lokaler Tests.
  **Blast Radius:** jede Produktionsstörung. **Abhängigkeiten:** Monitoring-
  Provider, on-call, SLO. **Gewählte Lösung:** sichere strukturierte Events,
  Healthsignale und externen Receipt-Drill. **Verworfene Alternative:** Stack
  oder PII an Nutzer/Logs ausgeben.
- **Migration/Environment:** Monitoring DSN/routing erst mit Approval.
  **Erforderliche Tests:** failure injection, redaction, sink contract,
  alert receipt E2E. **E2E-ID:** `E2E-34-17`, `E2E-34-18`.
  **Implementierungsstatus:** lokale Härtung pending E2E; extern blockiert.
  **Abschließende Evidence:** keine Pager-Evidence. **Verbleibendes externes
  Gate:** Monitoring/Pager/On-call.

### `F34-OPS-009` — Health-Endpunkte fehlen

- **Ursprüngliche Behauptung:** `/health/live` und `/health/ready` seien
  nicht vorhanden oder wirkungslos. **Quelle:** A §D. **Kategorie:**
  Operations. **Anfängliches Risiko:** P1. **Prüfstatus:** `FALSE_POSITIVE`
  für Existenz; semantische Worker-Lücke ist `F34-OPS-002`.
- **Betroffene Dateien/Funktionen:** `app/health/live/route.ts`,
  `app/health/ready/route.ts`, `lib/db/health.ts`, Worker health server.
  **Tatsächlicher Ausführungspfad:** HTTP probe → build/schema/DB/runtime
  checks. **Reproduktion:** gesund, DB down, migration stale, worker hung.
  **Beweise:** beide Web-Routen und Tests existieren; latest migration pin
  wird im Arbeitsbaum fortgeführt.
- **Ursache:** Mindestprüfpunkt, nicht belegter Reviewdefekt. **Blast Radius:**
  bei Regression traffic routing. **Abhängigkeiten:** platform probe.
  **Gewählte Lösung:** Regression und external wiring prüfen.
  **Verworfene Alternative:** neue parallele Endpunkte.
- **Migration/Environment:** readiness latest migration. **Erforderliche Tests:**
  unit/HTTP, boot, DB down/stale schema, platform probe E2E.
  **E2E-ID:** `E2E-34-19`, `E2E-34-20`. **Implementierungsstatus:** vorhanden.
  **Abschließende Evidence:** finaler Boot ausstehend.
  **Verbleibendes externes Gate:** Cloud-Probe-Wiring.

### `F34-OPS-010` — Backup/Restore, Ziel-PG und Staging

- **Ursprüngliche Behauptung:** reale Backups, Restore, Supabase-Version,
  Preview-/Staging-Boot, Smoke-URL und RPO/RTO seien belegt. **Quelle:** A §D/H.
  **Kategorie:** Operations/Data. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `BLOCKED_EXTERNAL`.
- **Betroffene Dateien/Funktionen:** `scripts/ops/backup.ts`, `restore.ts`,
  backup runbook, Docker PG16; externe DB/hosting. **Tatsächlicher Ausführungspfad:**
  snapshot → separate restore DB → migrate → app/worker
  boot → smoke. **Reproduktion:** datierter Restore-Drill mit checksum,
  Zeiten und kritischem Read. **Beweise:** lokale Scripts/Drills existieren;
  sie beweisen weder Cloudbackup noch Zielversion/region/RPO.
- **Ursache:** Infrastruktur-Evidence fehlt. **Blast Radius:** vollständiger
  Datenverlust oder inkompatibler Cutover. **Abhängigkeiten:** Supabase,
  encrypted storage, owner. **Gewählte Lösung:** lokalen Drill plus externen
  unabhängigen Restore. **Verworfene Alternative:** Backup-Konfiguration als
  Restore-Beweis zählen.
- **Migration/Environment:** Ziel-PG/extension matrix. **Erforderliche Tests:**
  backup/restore/migrate/boot/smoke E2E. **E2E-ID:** `E2E-34-19`,
  `E2E-34-20`. **Implementierungsstatus:** lokal möglich, extern offen.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  echte Staging-/Backup-/Restore-Infrastruktur.

### `F34-OPS-011` — historische/destruktive Migrationen

- **Ursprüngliche Behauptung:** bestehende destruktive Migrationen,
  Expand/Contract, Roll-forward und Rollback müssten geprüft werden.
  **Quelle:** A §D. **Kategorie:** Database Change Management.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `prisma/migrations/**`, baseline hash,
  deployment/backup runbooks. **Tatsächlicher Ausführungspfad:** historical DB
  → ordered migrations → app/worker. **Reproduktion:** Hashvergleich,
  Fresh-/Upgrade-/Partial-/Restartlauf und SQL review auf drops/rewrites.
  **Beweise:** unveränderliche Baseline erfasst; Phase-34-Änderungen sind
  additiv. Ein vollständiger finaler Upgrade-/Restart-/rollback drill fehlt.
- **Ursache:** kumulative Schemahistorie. **Blast Radius:** gesamte DB.
  **Abhängigkeiten:** latest migrations, realistic old snapshot.
  **Gewählte Lösung:** alte SQL byteidentisch lassen, neue additive Schritte,
  roll-forward bevorzugen. **Verworfene Alternative:** historische Migration
  „reparieren“ oder `db push`.
- **Migration/Environment:** vier aktuelle additive Phase-34-Migrationen,
  eventuell weitere nur additiv. **Erforderliche Tests:** hash, Fresh,
  Upgrade, partial/restart/idempotency, app/worker smoke.
  **E2E-ID:** `E2E-34-19`. **Implementierungsstatus:** Baseline/Fresh teilweise;
  Finaldrill ausstehend. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** production backup/cutover window.

### `F34-OPS-012` — Scans, Retention und Abläufe laufen nirgends

- **Ursprüngliche Behauptung:** Jobs, Einladungen, Credits, Abos, Scans,
  Retention und Privacy-Prozesse liefen grundsätzlich nie. **Quelle:** R,
  Z. 59–68/163–180; A §D. **Kategorie:** Worker. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** worker handler catalog, expiry/security/
  retention/recruiting/privacy handlers, scheduler. **Tatsächlicher Ausführungspfad:**
  scheduler/work item → lease → handler → final/retry/DLQ.
  **Reproduktion:** jeweilige fällige Zeile seeden, echten worker starten.
  **Beweise:** aktuelle Handler-/Worker-Artefakte und PG-Tests existieren;
  tatsächlicher Productionbetrieb bleibt separat unbewiesen.
- **Ursache:** älterer Reviewstand und pausierte externe Runtime.
  **Blast Radius:** aktuell nicht Codeabwesenheit, sondern Hosting/Aktivierung.
  **Abhängigkeiten:** OPS-002/003/006/010. **Gewählte Lösung:** als
  Deploymentgate, nicht als fehlende Fachlogik behandeln.
  **Verworfene Alternative:** zusätzliche doppelte Schedulerlogik.
- **Migration/Environment:** Worker activation. **Erforderliche Tests:**
  alle Handler positiv/negativ/retry/DLQ in Compose.
  **E2E-ID:** `E2E-34-12`, `E2E-34-13`. **Implementierungsstatus:** Code
  vorhanden; finaler full worker E2E offen. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** Workerhost/Scheduler/On-call.

### `F34-OPS-013` — Resend-Event-Inbox ohne autonomen Handler

- **Ursprüngliche Behauptung:** Provider-Webhooks würden zwar persistiert,
  aber Resend-Events nicht autonom aus Inbox über Retry bis DLQ projiziert.
  **Quelle:** N aus Phase-34-Inboxprüfung; A §D/F. **Kategorie:** Worker/
  Provider. **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:**
  `lib/providers/email/resend-event-inbox.ts`, handler catalog/runtime,
  worker scheduler, integration tests. **Tatsächlicher Ausführungspfad:**
  signed webhook → durable inbox → WorkItem → handler → EmailLog/suppression
  → done/retry/DLQ. **Reproduktion:** accepted/delivered/bounced/complained,
  duplicate, poison, crash/retry. **Beweise:** autonomous handler, retry/DLQ,
  exactly-once guards und umfangreiche PG-Tests im Arbeitsbaum.
- **Ursache:** ingestion und projection wurden zunächst getrennt, ohne
  registrierten worker consumer. **Blast Radius:** falsche Zustellanzeige und
  fehlende Suppression. **Abhängigkeiten:** OPS-003, notification keys.
  **Gewählte Lösung:** registrierter environment-bound Inboxhandler.
  **Verworfene Alternative:** Projektion synchron im webhook oder manuelles
  Admin-Replay als Normalbetrieb.
- **Migration/Environment:** nutzt Provider-Inbox-Indizes; Resend activation
  bleibt separat. **Erforderliche Tests:** unit handler catalog, PG state
  transitions/replay, echten webhook→worker→visible-state E2E.
  **E2E-ID:** `E2E-34-12`, `E2E-34-16`. **Implementierungsstatus:** Code/PG
  vorhanden; Full E2E fehlt. **Abschließende Evidence:** ausstehend.
  **Verbleibendes externes Gate:** Resend webhook/domain/test recipient.

### `F34-OPS-014` — Production-HSTS-Smoke bootete mit ungültigem Auth-Vertrag

- **Ursprünglicher Befund:** Der HSTS-Smoke-Environment-Builder setzte für
  `APP_ENV=production` zunächst weder verpflichtende Identity Verification
  noch durable Notification-Outbox-Produzenten. Nach dem ersten Unit-Fix blieb
  ein zweiter realer Defekt: Der Builder kopierte beide Notification-Keyrings
  nur aus dem aufrufenden Shell-Environment. Auf einem normalen Rechner waren
  sie dort nicht exportiert und in `.env.local` nicht vorhanden; der echte
  `next start` endete deshalb mit HTTP 500, bevor HSTS geprüft werden konnte.
  **Quelle:** N im Unit-Suffixlauf und im anschliessenden realen HSTS-Gate.
  **Kategorie:** Operations/Runtime Contract. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `scripts/ops/production-hsts-environment.ts`, `scripts/http-smoke.ts` und
  dessen Unitvertrag. **Tatsächlicher Ausführungspfad:**
  `npm run test:e2e:hsts` → minimaler Production-Environment-Builder →
  `parseEnvironment` → Build/HTTPS/HSTS-Probe. **Reproduktion:** lokalen
  Source-Environment ohne exportierte Notification-Keyrings in den Production-
  HSTS-Builder geben und danach den echten Build-/Startpfad ausführen.
  **Beweise:** Der erste Parserfehler betraf den Production-Identity-Invariant;
  der reale Re-Run erreichte `next start`, lieferte aber 500 mit exakt den zwei
  fehlenden Keyring-Invarianten.
- **Ursache:** der minimale Smoke-Vertrag wurde nach Verschärfung von
  Identity-/Delivery-Bootregeln nicht mitgezogen. **Blast Radius:** verlorene
  HSTS-Release-Evidence; keine Production-App-Aktivierung durch den Test.
  **Abhängigkeiten:** Notification-Keymaterial des isolierten Testharness.
  **Gewählte Lösung:** Identity Enforcement und Outbox-Produzenten explizit
  setzen und beide Smoke-Keyrings deterministisch aus dem ephemeren
  Datenbank-/Build-Kontext ableiten. Der Test benötigt und erbt dadurch weder
  lokale noch echte Notification-Secrets; Delivery, Provider, Worker und
  sämtliche Local/CI-Sandboxfähigkeiten bleiben deaktiviert/pausiert.
  **Verworfene Alternative:** Production-Authregel umgehen, Local-Environment
  vollständig erben oder echte Entwickler-/Live-Keyrings für einen Health-
  Header-Smoke verlangen.
- **Migration/Environment:** keine; isolierter Production-HSTS-Testvertrag.
  **Erforderliche Tests:** Environment-Unit positiv und Sandbox-Erbschaft
  negativ; realer `test:e2e:hsts`. **E2E-ID:** `E2E-34-20`/HTTP-Security-
  Verbrauchspfad. **Implementierungsstatus:** Environment-Unit 2/2, Typecheck
  und ESLint grün; der erste reale Lauf reproduzierte HTTP 500, der korrigierte
  reale Lauf bestand Build, Start, `/health/live` und exakte HSTS-Headerausgabe
  in 186,3 Sekunden. **Abschließende Evidence:** lokaler Header-Smoke grün.
  **Verbleibendes externes Gate:** echte TLS-, Edge-, Domain- und Browser-HSTS-
  Konfiguration bleibt Hosting-Evidence; Loopback beweist nur Headeremission.

### `F34-OPS-015` — bekannte Eligibility-/Alert-Fan-outs nutzten die pg-Queue; breitere Warnungen offen

- **Ursprünglicher Befund:** Der vollständige PostgreSQL-Lauf war fachlich
  grün, emittierte aber reproduzierbar die `pg@8.22.0`-Deprecation für
  parallele `client.query()`-Aufrufe auf derselben Verbindung. `pg@9` entfernt
  diese Queue vollständig. **Quelle:** N aus dem vollständigen Phase-34-
  Integrationslauf. **Kategorie:** Runtime/Database Compatibility.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `lib/candidate/job-alerts.ts`,
  `lib/jobs/public-eligibility.ts`, `assertQueryReferences()`,
  `hasCurrentDeliveryAuthorization()`, `resolveStoredQuery()` und
  `loadPublicEligibilitySnapshots()`. **Tatsächlicher Ausführungspfad:** acht
  konkurrierende Alert-Digest-Claims → interaktive Serializable-Transaktion →
  kanonische Public-Eligibility → Prisma-Relation-Fan-out → ein gebundener
  PostgreSQL-Client. **Reproduktion:** der erste Job-Alert-PostgreSQL-Fall mit
  `NODE_OPTIONS=--trace-deprecation`; ein enger Treiber-Tracer belegte als
  gleichzeitig aktive Statements Company-Trust, Category und ScoreSnapshot.
- **Ursache:** drei direkte Produktreads liefen per `Promise.all`; zusätzlich
  fächerte der Prisma-Query-Interpreter den mehrteiligen Relation-Select intern
  ebenfalls per `Promise.all` auf. **Blast Radius:** Alert-Digests und weitere
  transaktionale Verbraucher der kanonischen Eligibility könnten bei einem
  späteren pg-9-Upgrade statt einer Warnung ausfallen. **Abhängigkeiten:**
  Prisma `7.9.1`, Adapter-pg und der gebundene Transaktionsclient.
  **Gewählte Lösung für die belegten engen Pfade:** die direkten Reads in
  `assertQueryReferences()`, `hasCurrentDeliveryAuthorization()` und
  `resolveStoredQuery()` sequentiell ausführen; außerdem Company,
  Verification, Revision, Category sowie Score im kanonischen
  `loadPublicEligibilitySnapshots()` als begrenzte sequentielle Batches im
  selben Snapshot hydrieren. Ein explizites Verification-Limit bleibt
  fail-closed. **Verworfene Alternative:** Warnung unterdrücken,
  Provider-Patches im `node_modules`-Baum oder Transaktionsschutz entfernen.
- **Migration/Environment:** keine. **Erforderliche Tests:** gezielter
  Concurrent-Digest-PG-Fall mit Deprecation-Trace, vollständige Integration,
  Alert-/Eligibility-E2E und künftiger pg-9-Upgrade-Vertrag. **E2E-ID:**
  `E2E-34-12`, `E2E-34-19`. **Implementierungsstatus:** Der gezielte Alert-
  Pfad ist 1/1 grün und für genau diesen Pfad blieb der Treiber-Tracer danach
  still. Der vollständige Lauf und der Public-Read-Model-Pfad emittieren jedoch
  weiterhin wiederholt dieselbe `pg`-Warnung aus breiteren, teils Prisma-
  internen Relation-Fan-outs. Damit sind weder repositoryweite Warnungsfreiheit
  noch pg-9-Kompatibilität belegt. **Abschließende Evidence:** vollständiger
  Candidate-Lauf muss funktional grün sein; die verbleibende Warnung wird als
  bekannte Restschuld protokolliert. Vor einem pg-9-Upgrade sind ein eigenes
  Warnung-als-Fehler-Gate und weitere sequentielle Hydratoren beziehungsweise
  eine belastbare Upstream-Lösung erforderlich. **Verbleibendes externes Gate:**
  kein externes Gate für die engen Fixes; das Dependency-Major-Upgrade bleibt
  ausdrücklich gesperrt, bis diese Evidence vorliegt.

### `F34-DOC-001` — Document Vault in Preview

- **Ursprüngliche Behauptung:** Document/CV Vault kenne Preview nicht und
  sei außerhalb Development tot. **Quelle:** R, Z. 74–96. **Kategorie:**
  Environment/Storage. **Anfängliches Risiko:** P1. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `lib/config/application-environment.ts`,
  `lib/documents/runtime-policy.ts`, storage/scanner composition.
  **Tatsächlicher Ausführungspfad:** upload/read → environment class →
  provider activation → storage/scanner. **Reproduktion:** Local/CI/Preview/
  prod-like mode matrix. **Beweise:** zentrale exhaustive environment class
  wird konsumiert; Preview erhält keine Local-Rechte und fällt bewusst
  fail-closed, nicht versehentlich durch.
- **Ursache:** behobener Legacy-Boolean-Check. **Blast Radius:** aktuell
  keiner; reale Previewfunktion bleibt providerabhängig.
  **Abhängigkeiten:** storage/scanner activation. **Gewählte Lösung:**
  vorhandene zentrale Policy regressieren. **Verworfene Alternative:** Preview
  wie Local behandeln.
- **Migration/Environment:** keine. **Erforderliche Tests:** mode matrix,
  upload/scan/read E2E positiv im Contract und negativ ohne activation.
  **E2E-ID:** `E2E-34-10`, `E2E-34-13`, `E2E-34-20`.
  **Implementierungsstatus:** Code vorhanden. **Abschließende Evidence:**
  finaler E2E ausstehend. **Verbleibendes externes Gate:** Storage/Scanner DPA
  und provider setup.

## 8. Sicherheit und Missbrauchsschutz

### `F34-SEC-001` — Auth-Zielbudget unabhängig von IP

- **Ursprüngliche Behauptung:** Login, Passwort-Reset und Verification-
  Resend könnten durch wechselnde IPs für eine Zieladresse unbegrenzt
  ausgelöst werden; Mailbombing/Guessing bleibe möglich. **Quelle:** A §E.
  **Kategorie:** Auth Abuse. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/auth/rate-limit.ts`,
  `rate-limit-runtime.ts`, auth-/verification services, neuer Scope
  `AUTH_IDENTIFIER`. **Tatsächlicher Ausführungspfad:** HTTP auth action →
  normalized target HMAC + IP buckets → generic response/outbox.
  **Reproduktion:** bekannte/unbekannte Adresse über wechselnde IPs; zusätzlich
  viele Ziele aus einer IP. **Beweise:** gleiche pre-lookup Buckets, Login
  10/15min, Recovery/Resend 5/h, Recovery zusätzlich 20/h/IP; PG-Test belegt
  Grenze und generische Antwort.
- **Ursache:** zuvor vor allem actor/IP-orientierte Presets. **Blast Radius:**
  Account guessing, Mailvolumen, Kosten. **Abhängigkeiten:** HMAC keyring,
  proxy trust. **Gewählte Lösung:** privacy-preserving identifier scope vor
  Lookup. **Verworfene Alternative:** rohe E-Mail im Bucket/Audit.
- **Migration/Environment:** keine; HMAC runtime key erforderlich.
  **Erforderliche Tests:** unit, PG multi-IP, echter HTTP/Browser positiv/
  negativ und audit redaction. **E2E-ID:** `E2E-34-01`, `E2E-34-05`,
  `E2E-34-17`. **Implementierungsstatus:** Code/PG grün; E2E fehlt.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  production proxy topology.

### `F34-SEC-002` — Reset-Consume-Budget

- **Ursprüngliche Behauptung:** parallele Resetversuche könnten Token-Lookup
  und teures Passwort-Hashing unbounded anstoßen. **Quelle:** A §E; N.
  **Kategorie:** Capacity/Security. **Anfängliches Risiko:** P2.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** reset service/action, rate-limit presets,
  token hash scope. **Tatsächlicher Ausführungspfad:** HTTP consume → HMAC von
  Tokenhash/IP limit → lookup → bcrypt → session revoke. **Reproduktion:**
  gleiches Token aus wechselnden IPs und viele Token aus einer IP.
  **Beweise:** neues Preset greift vor Lookup/bcrypt; PG-Test zeigt Grenze und
  redigiertes Denial-Audit.
- **Ursache:** Consume-Pfad war nur durch Tokenvalidität begrenzt. **Blast Radius:**
  CPU/DB und Auth-Verfügbarkeit. **Abhängigkeiten:** SEC-001/003.
  **Gewählte Lösung:** tokenhash- und IP-bound budget.
  **Verworfene Alternative:** Token im Klartext loggen oder nur nach bcrypt
  begrenzen.
- **Migration/Environment:** keine. **Erforderliche Tests:** unit/PG und
  Browser gültig/abgelaufen/replay/ratelimited. **E2E-ID:** `E2E-34-05`,
  `E2E-34-17`. **Implementierungsstatus:** Code/PG vorhanden; E2E fehlt.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  keines lokal.

### `F34-SEC-003` — Forwarded-Kette fällt auf Loopback zurück

- **Ursprüngliche Behauptung:** fehlende, malformed oder zu kurze
  `X-Forwarded-For`-Ketten würden in Public-Ingress auf `127.0.0.1`
  zusammenfallen und Buckets/Audit verfälschen. **Quelle:** R,
  Z. 31–35/132–141; A §E. **Kategorie:** Proxy Trust.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `proxy.ts`, trusted hop parser,
  `TRUSTED_PROXY_HOPS`. **Tatsächlicher Ausführungspfad:** HTTP ingress →
  sanitize/derive internal IP → app/auth/rate limit. **Reproduktion:**
  prod-like mit valid, missing, short, malformed chains und invalid hop config.
  **Beweise:** Arbeitsbaum antwortet vor App no-store mit 400, invalid config
  503; Local behält expliziten Loopbackfallback; Unitmatrix grün.
- **Ursache:** Developmentfallback galt auch für öffentliche Environments.
  **Blast Radius:** globaler Lockout oder falsche Forensik. **Abhängigkeiten:**
  tatsächliche Edge-Hopzahl. **Gewählte Lösung:** public fail-closed, local
  explicit fallback. **Verworfene Alternative:** beliebigem Clientheader
  vertrauen.
- **Migration/Environment:** korrekte `TRUSTED_PROXY_HOPS` Pflicht.
  **Erforderliche Tests:** proxy unit und realer prod-like HTTP ingress/
  rate-limit E2E. **E2E-ID:** `E2E-34-17`, `E2E-34-20`.
  **Implementierungsstatus:** der reale Preview-Prozess akzeptiert seinen
  direkten Next-Peer und weist eine explizit malformed Forwarded-Kette mit
  `400`/`no-store` vor der App ab; die Unitmatrix belegt zusätzlich den
  fehlenden rohen Public-Topology-Fall fail-closed. **Abschließende Evidence:**
  Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** Vercel/Proxy-Hopvertrag und direkte
  Originabschottung.

### `F34-SEC-004` — Bewerbung ohne ausreichende Identität

- **Ursprüngliche Behauptung:** bei deaktiviertem Identity-Flag könnten
  Low-Assurance-Konten Bewerbungen, Conversations und Notification-Fan-out
  erzeugen. **Quelle:** A §E/F; N. **Kategorie:** Abuse/Product.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/applications/service.ts`, zentrale
  `APPLICATION_SUBMIT` identity policy, env schema. **Tatsächlicher Ausführungspfad:**
  Candidate form → auth/identity gate → transaction →
  Application/Conversation/Outbox/Audit. **Reproduktion:** unverifiziert in
  prod-like mit absichtlich false; verifiziert positiv. **Beweise:** Domain-
  Service nutzt Gate; Preview/Staging/Production verlangen Flag beim Start;
  PG-Test belegt zero mutation/fan-out/audit-diff und positiven Submit.
- **Ursache:** UI/Env-Featureflag war nicht unveränderliche Domainpolicy.
  **Blast Radius:** Bewerbungs-Spam und Notifications. **Abhängigkeiten:**
  registration verification. **Gewählte Lösung:** serverseitiger Domain-Guard
  vor Transaktion plus boot contract. **Verworfene Alternative:** nur Button
  verstecken.
- **Migration/Environment:** prod-like Identityflag Pflicht.
  **Erforderliche Tests:** policy unit, PG zero-effect, echter Browser submit
  positiv/negativ. **E2E-ID:** `E2E-34-01`, `E2E-34-20`.
  **Implementierungsstatus:** Code/PG vorhanden; E2E fehlt.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Identity-provider activation für Live.

### `F34-SEC-005` — stille Audit-/Risk-/Security-Signal-Fehler

- **Ursprüngliche Behauptung:** best-effort Audit, Risk und Security Signal
  können bei sicheren Denials selbst fehlschlagen und vollständig unsichtbar
  bleiben; Auditereignisse könnten verloren/zusammengelegt werden.
  **Quelle:** A §E; N. **Kategorie:** Forensics. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/security/rate-limit-audit.ts`, audit
  logger/error events, denial sampling. **Tatsächlicher Ausführungspfad:**
  denied action → sampled audit/risk/signal → structured error callback/sink.
  **Reproduktion:** jeden Sink gezielt werfen lassen, öffentliche Antwort und
  redigiertes Error Event prüfen. **Beweise:** Sampling jetzt per Actor/IP +
  preset/scope; alle inneren/äußeren Fehler erzeugen redigierte strukturierte
  Events; Unit-Negativtests vorhanden.
- **Ursache:** „best effort“ fing Fehler ohne second channel ab. **Blast Radius:**
  Incidentbeweiskette. **Abhängigkeiten:** OPS-008 external sink.
  **Gewählte Lösung:** sichere Response beibehalten, separaten diagnostischen
  Event erzeugen. **Verworfene Alternative:** Denial wegen Auditfehler in 500
  verwandeln oder PII loggen.
- **Migration/Environment:** keine. **Erforderliche Tests:** unit failure
  injection, real HTTP denial, sink receipt/redaction E2E.
  **E2E-ID:** `E2E-34-17`, `E2E-34-18`.
  **Implementierungsstatus:** Code/unit vorhanden; system/external E2E fehlt.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  monitored sink/pager.

### `F34-SEC-006` — angebliche Prefetch-Proxy-Umgehung

- **Ursprüngliche Behauptung:** `Purpose: prefetch` überspringe den Proxy,
  lasse eine frei erfundene interne IP durch und umgehe Rate-Limits.
  **Quelle:** R, Z. 124–141/193–197; A §E nennt die Behauptung ausdrücklich
  als früher falsch. **Kategorie:** Security. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** `proxy.ts`, Next matcher, CSP/header
  application, internal-IP sanitize. **Tatsächlicher Ausführungspfad:** jede
  passende HTTP-Anfrage einschließlich Prefetch → Proxy → trusted IP header.
  **Reproduktion:** Purpose-/Sec-Purpose-Varianten mit gespooftem Header.
  **Beweise:** aktueller Matcher schließt Prefetch nicht aus; Tests belegen
  Proxy/CSP/overwrite. Ein Kommentar oder alte Matcherconfig ist kein aktueller
  Bypass.
- **Ursache:** historische Konfiguration beziehungsweise Test falsch gelesen.
  **Blast Radius:** keiner nachgewiesen; Behauptung wäre sonst kritisch.
  **Abhängigkeiten:** SEC-003 für echte Hopsemantik. **Gewählte Lösung:** keine
  künstliche Proxyänderung; Regression beibehalten. **Verworfene Alternative:**
  bereits sicheren Pfad doppeln.
- **Migration/Environment:** keine. **Erforderliche Tests:** real HTTP prefetch
  headers, spoof denial, CSP. **E2E-ID:** `E2E-34-17`, `E2E-34-18`.
  **Implementierungsstatus:** kein Fix nötig. **Abschließende Evidence:**
  finaler HTTP-Regressionslauf ausstehend. **Verbleibendes externes Gate:**
  echte Proxy-Hops unter SEC-003.

### `F34-SEC-007` — globaler Preview-Rate-Limit-Bucket

- **Ursprüngliche Behauptung:** Preview verwende zwingend `127.0.0.1`, daher
  teilten alle Nutzer Login-/Registration-/Application-Budgets.
  **Quelle:** R, Z. 132–141/193–197. **Kategorie:** Availability/Security.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** proxy/IP derivation, env schema,
  rate-limit runtime. **Tatsächlicher Ausführungspfad:** Preview ingress →
  trusted forwarded chain → HMAC IP bucket. **Reproduktion:** mehrere echte
  Clientketten versus fehlende Kette. **Beweise:** aktuelle Previewpolicy
  verlangt valide trusted-hop-Konfiguration und fällt nicht still auf
  Loopback zurück; malformed wird unter SEC-003 denied.
- **Ursache:** älterer Fallbackvertrag. **Blast Radius:** aktuell verhindert.
  **Abhängigkeiten:** externe korrekte Hopzahl. **Gewählte Lösung:** vorhandene
  fail-closed Grenze testen. **Verworfene Alternative:** Preview weiterhin
  wie Local behandeln.
- **Migration/Environment:** `TRUSTED_PROXY_HOPS`. **Erforderliche Tests:**
  multi-client HTTP rate-limit. **E2E-ID:** `E2E-34-17`, `E2E-34-20`.
  **Implementierungsstatus:** Code vorhanden. **Abschließende Evidence:**
  prod-like E2E ausstehend. **Verbleibendes externes Gate:** Edge topology.

### `F34-SEC-008` — Admin-MFA angeblich nicht erzwungen

- **Ursprüngliche Behauptung:** Admin-MFA sei standardmäßig aus und nirgends
  erzwungen. **Quelle:** R, Z. 141–143/193–199. **Kategorie:** Security.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `lib/auth/admin-runtime-policy.ts`,
  route guards, WebAuthn/MFA service, `ADMIN_MFA_REQUIRED`, Admin Security UI.
  **Tatsächlicher Ausführungspfad:** public environment boot → Admin route →
  AAL2/step-up. **Reproduktion:** prod-like ohne required flag booten und mit
  AAL1 Admin route aufrufen. **Beweise:** öffentliche Runtime ist ohne MFA-
  Requirement geschlossen; route guards und Phase-25 capability/MFA flows
  existieren.
- **Ursache:** Reviewstand vor Phase 25/33 oder Flag isoliert betrachtet.
  **Blast Radius:** kein aktueller Bypass nachgewiesen. **Abhängigkeiten:**
  production RP-ID/device/on-call. **Gewählte Lösung:** Regression und
  external MFA drill. **Verworfene Alternative:** MFA-Code neu bauen.
- **Migration/Environment:** prod-like flag/RP-ID. **Erforderliche Tests:**
  boot fail, AAL1 denial, AAL2 positive, recovery/replay E2E.
  **E2E-ID:** `E2E-34-14`, `E2E-34-20`. **Implementierungsstatus:** vorhanden.
  **Abschließende Evidence:** finaler Candidate-E2E ausstehend.
  **Verbleibendes externes Gate:** RP-ID, devices, device-loss/on-call drill.

### `F34-SEC-009` — CSP bei Prefetch

- **Ursprüngliche Behauptung:** Prefetch-Antworten könnten Security Header/
  CSP umgehen. **Quelle:** A §E. **Kategorie:** Web Security.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** `proxy.ts`, response headers.
  **Tatsächlicher Ausführungspfad:** prefetched document/data request → proxy
  headers → response. **Reproduktion:** echte Purpose-/Sec-Purpose-Requests,
  Header vergleichen. **Beweise:** Matcher/handler setzt CSP auch für diese
  Requests; Unitmatrix deckt die Varianten.
- **Ursache:** mit `F34-SEC-006` gekoppelte Hypothese. **Blast Radius:** keiner
  nachgewiesen. **Abhängigkeiten:** Next runtime. **Gewählte Lösung:** realen
  HTTP-Regressionstest. **Verworfene Alternative:** doppelte CSP-Logik.
- **Migration/Environment:** keine. **Erforderliche Tests:** HTTP/header E2E
  inkl. prefetch. **E2E-ID:** `E2E-34-18`.
  **Implementierungsstatus:** keine Änderung. **Abschließende Evidence:**
  finaler E2E ausstehend. **Verbleibendes externes Gate:** keines.

### `F34-SEC-010` — IDOR, Tenant- und Capability-Isolation

- **Ursprüngliche Behauptung:** fremde IDs könnten Reads/Writes erlauben;
  alternativ meldet R ausdrücklich „keine IDOR-Lücke“. **Quelle:** R,
  Z. 145–153/201–207; A §E. **Kategorie:** Authorization.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FALSE_POSITIVE` für die
  Lückenhypothese; positiver Invariant bestätigt.
- **Betroffene Dateien/Funktionen:** Employer/Admin/Candidate actions,
  membership/assignment/capability guards, CV access chain.
  **Tatsächlicher Ausführungspfad:** session actor → resource ID → tenant/
  ownership/assignment → query/mutation. **Reproduktion:** eigene und fremde
  IDs, abgelaufene Assignment, falsche Rolle. **Beweise:** geprüfte Actions
  binden IDs an Actor/Firma/Assignment; CV verlangt ownership oder vollständige
  membership/application/pipeline chain.
- **Ursache:** Mindest-Abuseprüfung, kein bestätigter Defekt. **Blast Radius:**
  alle privaten Daten bei Regression. **Abhängigkeiten:** vollständiges
  Route-/Actioninventar. **Gewählte Lösung:** positive und negative E2E
  regressieren. **Verworfene Alternative:** pauschale Behauptung ohne
  entrypoint tests.
- **Migration/Environment:** keine. **Erforderliche Tests:** capability/unit,
  PG tenant isolation und Browser/API cross-tenant. **E2E-ID:**
  `E2E-34-13`, `E2E-34-14`. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler vollständiger E2E ausstehend.
  **Verbleibendes externes Gate:** unabhängiger Security Review/Pentest.

### `F34-SEC-011` — Sessions, CSRF, Validierung und Redaction

- **Ursprüngliche Behauptung:** Sessions, Eingabevalidierung, CSRF, Secret-/
  PII-Redaktion könnten unsicher sein; R meldet sie als sauber.
  **Quelle:** R, Z. 151–153/205–207; A §E. **Kategorie:** Security.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FALSE_POSITIVE` für einen
  aktuellen Defekt.
- **Betroffene Dateien/Funktionen:** session issuance/store, CSRF/origin,
  Zod actions, logger redaction, secret scans. **Tatsächlicher Ausführungspfad:**
  browser request → session/origin/validation → domain →
  redigierter log. **Reproduktion:** fixation, revoked token, cross-origin,
  malformed payload, known secret/PII canaries. **Beweise:** 256-bit tokens
  gehasht, rotation bei Login, Origin checks und allowlisted validation;
  redaction tests vorhanden.
- **Ursache:** verpflichtende Prüfung, kein reproduzierter Bypass.
  **Blast Radius:** systemweit bei Regression. **Abhängigkeiten:** finaler
  secret/PII scan. **Gewählte Lösung:** bestehende Invarianten regressieren.
  **Verworfene Alternative:** Cookie-/Sessionmigration ohne Befund.
- **Migration/Environment:** keine. **Erforderliche Tests:** security unit/PG,
  cross-origin HTTP, secret/PII scan. **E2E-ID:** `E2E-34-14`,
  `E2E-34-18`. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler scan/E2E ausstehend.
  **Verbleibendes externes Gate:** unabhängiger Pentest.

### `F34-SEC-012` — Webhook-Signatur und Replay

- **Ursprüngliche Behauptung:** Payment-/E-Mail-Webhooks könnten vor
  Signaturprüfung parsen oder Replays doppelt wirken; R meldet Payment als
  korrekt. **Quelle:** R, Z. 151–153; A §E. **Kategorie:** Provider Security.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FALSE_POSITIVE` für aktuellen
  Contract.
- **Betroffene Dateien/Funktionen:** payment/email webhook routes,
  signature verifiers, inbox uniqueness/idempotency. **Tatsächlicher Ausführungspfad:**
  raw HTTP body → signature/timestamp → durable inbox →
  projector. **Reproduktion:** invalid signature, altered body, expired
  timestamp, exact replay/out-of-order. **Beweise:** Signatur wird vor
  semantischem Parse geprüft; inbox/provider event keys verhindern Doppelwirkung.
- **Ursache:** Mindestprüfung. **Blast Radius:** Finance/E-Mail-Suppression bei
  Regression. **Abhängigkeiten:** provider keys/time tolerance.
  **Gewählte Lösung:** Contracts/E2E wiederholen. **Verworfene Alternative:**
  Webhookstatus allein als Beweis.
- **Migration/Environment:** keine. **Erforderliche Tests:** raw HTTP contract,
  PG replay/exactly-once, provider sandbox. **E2E-ID:** `E2E-34-06`,
  `E2E-34-07`, `E2E-34-16`. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler/provider E2E ausstehend.
  **Verbleibendes externes Gate:** Sandbox webhook secret/provider.

### `F34-SEC-013` — Secret-Scan und öffentliche Loopback-Templates

- **Ursprünglicher Befund:** Der reale Release-Secret-Scan schlug auf
  `DATABASE_URL`/`TEST_DATABASE_URL` fehl, sobald die lokale Konfiguration die
  bewusst versionierten Loopback-Defaults aus `.env.example`, CI oder
  `env-init` verwendete. Damit war der Release-Check für die dokumentierte
  lokale Standardkonfiguration unbrauchbar. **Quelle:** N im vollständigen
  Phase-34-Commandlauf. **Kategorie:** Security/QA Tooling.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `scripts/release-secret-scan.ts`,
  `lib/security/release-secret-scan-policy.ts`, `.env.example`, lokale
  Setup-/CI-Verbraucher. **Tatsächlicher Ausführungspfad:** konfigurierte
  Sensitive Values → alle getrackten Dateien → exakter Leak-Abgleich.
  **Reproduktion:** lokale Template-DBs konfigurieren und
  `npm run security:release-scan` ausführen. **Beweise:** vor der Korrektur
  wurden ausschliesslich die identischen öffentlichen Loopback-Werte gemeldet;
  Provider- und echte Secret-Regeln blieben unbetroffen.
- **Ursache:** exakter Stringvergleich unterschied keine veröffentlichte,
  rein lokale Setup-Identity von einem operativen Secret. **Blast Radius:**
  blockierte Release-Evidence oder Versuchung, den Scanner ganz zu umgehen.
  **Abhängigkeiten:** kanonische `.env.example`. **Gewählte Lösung:** eine
  eng begrenzte Ausnahme nur für `DATABASE_URL`/`TEST_DATABASE_URL`, nur wenn
  der konfigurierte Wert exakt dem öffentlichen Template entspricht, nur
  PostgreSQL-Loopback mit Credentials, DB-Pfad und optional exakt
  `schema=public`; das Template selbst wird separat fail-closed validiert.
  **Verworfene Alternative:** `.env.example` pauschal vom Scan ausschliessen
  oder alle Loopback-Werte unabhängig vom öffentlichen Template erlauben.
- **Migration/Environment:** keine. **Erforderliche Tests:** Loopback/IPv4/
  IPv6/schema positiv; non-loopback, fremder Pfad, Providername, fehlende
  Credentials, Query und abweichendes lokales Secret negativ; realer CLI-
  Scan. **E2E-ID:** Security-CLI-Verbrauchspfad.
  **Implementierungsstatus:** zwölf Policyfälle und Scan über 1.810 getrackte
  Dateien grün. **Abschließende Evidence:** finaler Candidate-Scan wird
  wiederholt. **Verbleibendes externes Gate:** keines.

## 9. E-Mail, Nutzerflüsse, UX, Accessibility und SEO

### `F34-FLOW-001` — Passwort-Reset als angebliche Sackgasse

- **Ursprüngliche Behauptung:** Reset erzeuge einen Token und zeige Erfolg,
  versende aber nichts; das Konto sei nur durch Admin rettbar. **Quelle:** R,
  Z. 41–51/171–176. **Kategorie:** Auth/UX. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** forgot/reset actions, Notification
  Outbox, email delivery state/provider, reset token/session revoke.
  **Tatsächlicher Ausführungspfad:** Browser forgot → generic response →
  token/outbox → worker/provider or honest unavailable state → reset.
  **Reproduktion:** delivery disabled und allowed sink getrennt; gültig,
  expired, replay. **Beweise:** heutiger Pfad bindet durable Outbox und zeigt
  keinen ungeprüften „gesendet“-Claim; Phase-20/33 flows existieren.
- **Ursache:** Reviewstand vor ehrlicher Delivery-Komposition.
  **Blast Radius:** Account recovery bei Regression. **Abhängigkeiten:**
  OPS-006/007/013, SEC-001/002. **Gewählte Lösung:** bestehenden ehrlichen
  State regressieren. **Verworfene Alternative:** Token/Link öffentlich oder
  im Log anzeigen.
- **Migration/Environment:** keine neue. **Erforderliche Tests:** unit/PG,
  browser→outbox→worker→sink positiv; disabled, expired, replay negativ.
  **E2E-ID:** `E2E-34-05`, `E2E-34-16`.
  **Implementierungsstatus:** vorhandene Lösung; finaler E2E ausstehend.
  **Abschließende Evidence:** bestehende Specs, Candidate-Lauf fehlt.
  **Verbleibendes externes Gate:** Live-Mailprovider/Domain.

### `F34-FLOW-002` — Team-Einladung behauptet Versand/zeigt Interna

- **Ursprüngliche Behauptung:** UI melde „lokale Mailbox“, Einladung komme
  nicht an und Resend habe keine ehrliche Wirkung. **Quelle:** R,
  Z. 47–50/171–177. **Kategorie:** Team/UX. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** invitation actions/form/acceptance,
  outbox, delivery-state, local mailbox. **Tatsächlicher Ausführungspfad:**
  Employer invite → durable invitation/outbox → worker/sink/provider → token
  acceptance → membership. **Reproduktion:** Local sink, provider disabled,
  expired/replay/wrong email and resend. **Beweise:** aktueller UI-Vertrag
  trennt gespeichert, zustellbar und extern versendet; sensible Ersatzlinks
  sind nur im erlaubten lokalen/test scope verfügbar.
- **Ursache:** frühere Entwicklersprache und synchrone Erfolgsannahme.
  **Blast Radius:** Team-Onboarding. **Abhängigkeiten:** notification runtime.
  **Gewählte Lösung:** vorhandene state-aware Copy/Outbox beibehalten.
  **Verworfene Alternative:** Token im Production-UI kopierbar machen.
- **Migration/Environment:** keine. **Erforderliche Tests:** UI/unit, PG
  invitation, Browser sink positive/disabled negative/acceptance replay.
  **E2E-ID:** `E2E-34-04`, `E2E-34-16`.
  **Implementierungsstatus:** vorhanden; Candidate-E2E ausstehend.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Live-Mailprovider.

### `F34-PRIV-001` — Privacy Requests angeblich nie ausgeführt

- **Ursprüngliche Behauptung:** Nutzer erhielten eine Frist, Export/Delete/
  Correct werde aber mangels Worker nie ausgeführt. **Quelle:** R,
  Z. 47–51/163–180. **Kategorie:** Privacy/Worker. **Anfängliches Risiko:** P0.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** privacy case service, approval/execution,
  export adapters/storage, worker handlers, candidate/admin UI.
  **Tatsächlicher Ausführungspfad:** Candidate request/verification → Admin
  decision → WorkItem → export/correct/delete → notification/status.
  **Reproduktion:** alle Typen, deadline, retry/provider unavailable und
  download auth. **Beweise:** heutige Pipeline und worker handlers existieren;
  UI behauptet ohne erfüllten Endstatus keinen Abschluss. Production-Recht/
  Provider bleiben separate Gates.
- **Ursache:** älterer paused-worker Snapshot. **Blast Radius:** Datenschutz-
  Betroffenenrechte bei Deploymentfehler. **Abhängigkeiten:** OPS-006/010/012,
  LEG-006. **Gewählte Lösung:** vollständigen Candidate-Worker-E2E ausführen.
  **Verworfene Alternative:** Requestformular entfernen statt Prozess zu
  betreiben.
- **Migration/Environment:** keine neue. **Erforderliche Tests:** PG service,
  browser request/admin, worker export/delete/correct, storage failure/retry.
  **E2E-ID:** `E2E-34-13`, `E2E-34-14`.
  **Implementierungsstatus:** Code vorhanden; finaler E2E offen.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  Privacy Owner, Retention, live storage/provider.

### `F34-UX-001` — ungesicherter Inserate-Assistent

- **Ursprüngliche Behauptung:** normale Step-Links verlören lange Eingaben
  ohne Warnung oder Zwischenspeicherung. **Quelle:** R, Z. 53–57/171–178; A
  §G. **Kategorie:** Employer UX. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:**
  `components/employer/job-wizard/use-unsaved-changes.ts`, `job-wizard.tsx`.
  **Tatsächlicher Ausführungspfad:** dirty form → SPA link/browser unload →
  confirm/discard/save. **Reproduktion:** Text eingeben, Step-/Nav-Link und
  reload/back auslösen. **Beweise:** current guard blockiert same-tab
  Navigation und `beforeunload`, disarmed nur nach save/discard; Unitfälle
  existieren.
- **Ursache:** historischer Multi-Step-Wizard ohne dirty state.
  **Blast Radius:** Arbeitgeberentwürfe. **Abhängigkeiten:** browser semantics.
  **Gewählte Lösung:** vorhandenen Guard regressieren.
  **Verworfene Alternative:** nur Tooltip oder automatische Serverwrites bei
  jedem Keystroke.
- **Migration/Environment:** keine. **Erforderliche Tests:** component und
  echter Browser SPA/reload/back, save/discard. **E2E-ID:** `E2E-34-02`.
  **Implementierungsstatus:** vorhanden; finaler Browser-E2E ausstehend.
  **Abschließende Evidence:** bestehende Unit, final offen.
  **Verbleibendes externes Gate:** keines.

### `F34-NOT-002` — fehlende Arbeitgeberbenachrichtigung bei Bewerbung

- **Ursprüngliche Behauptung:** Arbeitgeber bemerke Bewerbungen tagelang
  nicht, weil keine Notification erzeugt werde. **Quelle:** R, Z. 59–64/
  171–180. **Kategorie:** Notification. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** application service transaction,
  notification/outbox, application-submitted template, preferences.
  **Tatsächlicher Ausführungspfad:** Candidate submit → Application +
  employer notification/outbox → worker/provider → visible inbox/log.
  **Reproduktion:** verifizierter Submit und duplicate/denied Submit;
  Empfängerpräferenz. **Beweise:** aktueller transactional fan-out und
  templates/tests existieren.
- **Ursache:** älterer Flow ohne Phase-20-Notifications. **Blast Radius:**
  Employer response time. **Abhängigkeiten:** email/worker activation.
  **Gewählte Lösung:** vorhandenen durable flow E2E prüfen.
  **Verworfene Alternative:** synchroner Mailversand in Submittransaction.
- **Migration/Environment:** keine neue. **Erforderliche Tests:** PG
  exactly-once/preferences und browser→worker→sink.
  **E2E-ID:** `E2E-34-01`, `E2E-34-12`, `E2E-34-16`.
  **Implementierungsstatus:** vorhanden. **Abschließende Evidence:** finaler
  E2E ausstehend. **Verbleibendes externes Gate:** live delivery.

### `F34-NOT-003` — scheinbare Bewerbungsbestätigung

- **Ursprüngliche Behauptung:** Confirmation werde als „gesendet“
  protokolliert, obwohl keine Zustellung existiere. **Quelle:** R,
  Z. 63–65. **Kategorie:** Notification Truth. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** application confirmation contract,
  notification outbox/delivery state, Candidate UI. **Tatsächlicher Ausführungspfad:**
  successful submit → durable receipt/outbox → delivery
  state; failed submit → no success claim. **Reproduktion:** sink enabled,
  disabled and provider failure. **Beweise:** current copy/state distinguishes
  recorded/queued/dispatched; no raw „sent“ from enqueue alone.
- **Ursache:** frühere Statussemantik. **Blast Radius:** Doppelbewerbungen und
  Vertrauen. **Abhängigkeiten:** NOT-001/OPS-013. **Gewählte Lösung:** current
  truth model regressieren. **Verworfene Alternative:** enqueue als sent.
- **Migration/Environment:** keine. **Erforderliche Tests:** delivery state
  unit/PG and browser→worker/provider state E2E.
  **E2E-ID:** `E2E-34-01`, `E2E-34-16`.
  **Implementierungsstatus:** vorhanden; E2E offen. **Abschließende Evidence:**
  ausstehend. **Verbleibendes externes Gate:** provider receipt.

### `F34-DOC-002` — CV-Upload strukturell unmöglich

- **Ursprüngliche Behauptung:** geforderter CV könne nicht hochgeladen
  werden; Bewerbung scheitere erst nach Anschreiben. **Quelle:** R,
  Z. 63–66. **Kategorie:** Application/Documents. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `FALSE_POSITIVE`.
- **Betroffene Dateien/Funktionen:** candidate documents/vault, application
  required-document validation, apply UI. **Tatsächlicher Ausführungspfad:**
  upload→scan→active document → apply preflight/submit. **Reproduktion:** Job
  requires CV, candidate without/with valid document. **Beweise:** uploader
  and requirement path exist; absence is surfaced before valid completion and
  current tests cover requirement.
- **Ursache:** unavailable Provider-/Demo-Zustand als strukturelle
  Unmöglichkeit interpretiert. **Blast Radius:** keiner für behaupteten Code-
  Defekt; live Provider gate remains. **Abhängigkeiten:** DOC-001.
  **Gewählte Lösung:** no code change, end-to-end contract verify.
  **Verworfene Alternative:** CV requirement entfernen.
- **Migration/Environment:** keine. **Erforderliche Tests:** upload/scan/read,
  apply missing/valid CV browser E2E. **E2E-ID:** `E2E-34-01`,
  `E2E-34-13`. **Implementierungsstatus:** keine Änderung.
  **Abschließende Evidence:** finaler E2E ausstehend.
  **Verbleibendes externes Gate:** storage/scanner live.

### `F34-FLOW-003` — nichts läuft ab

- **Ursprüngliche Behauptung:** Jobs, Einladungen, Credits und Abos liefen
  nie ab. **Quelle:** R, Z. 65–68/177–180. **Kategorie:** Lifecycle.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FALSE_POSITIVE` im aktuellen
  Code; Deployment bleibt OPS-006/012.
- **Betroffene Dateien/Funktionen:** expiry/security/recruiting/billing worker
  handlers, public eligibility, invitation/credit/subscription policies.
  **Tatsächlicher Ausführungspfad:** deadline/read guard and/or scheduled work
  → terminal state → public/entitlement denial. **Reproduktion:** clock beyond
  each boundary with worker off/on. **Beweise:** effective read boundaries und
  handlers/tests existieren; stale job/credit is not merely worker-dependent.
- **Ursache:** paused external worker mit fehlender Fachlogik verwechselt.
  **Blast Radius:** bei Deploymentfehler stale data/rights. **Abhängigkeiten:**
  worker hosting. **Gewählte Lösung:** boundaries plus autonomous convergence
  E2E. **Verworfene Alternative:** nur cron state mutation ohne read guard.
- **Migration/Environment:** keine neue. **Erforderliche Tests:** boundary
  unit/PG, worker time travel/retry and public/entitlement E2E.
  **E2E-ID:** `E2E-34-11`–`13`. **Implementierungsstatus:** vorhanden.
  **Abschließende Evidence:** finaler full worker E2E ausstehend.
  **Verbleibendes externes Gate:** scheduler host.

### `F34-NOT-004` — Job-Alerts versprechen nicht vorhandene Zustellung

- **Ursprüngliche Behauptung:** UI verspreche „täglich 08:00“, zeige Mock-
  Begriffe und aktiviere Alert, obwohl keine Delivery läuft. **Quelle:** R,
  Z. 65–68; A §F/G. **Kategorie:** Notification Truth.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `lib/candidate/job-alert-delivery-runtime.ts`,
  alert page/actions/form/list, dashboard copy, worker/digest.
  **Tatsächlicher Ausführungspfad:** Candidate UI → create/update/activate →
  runtime availability gate → digest work → EmailLog/visible state.
  **Reproduktion:** Local mock delivery positive; Preview/provider disabled
  view and direct manipulated activation negative; pause/delete remain.
  **Beweise:** Arbeitsbaum makes delivery availability explicit, prevents
  false ACTIVE/queued claims, and replaces dashboard's unconditional local
  mock copy; unit/PG/component tests and an E2E spec exist.
- **Ursache:** schedule configuration was rendered as delivery promise.
  **Blast Radius:** all alert subscribers. **Abhängigkeiten:** worker/email
  activation. **Gewählte Lösung:** truth-state gate at UI and action, while
  allowing inactive drafts/pause/delete. **Verworfene Alternative:** hide all
  management or claim schedule from config alone.
- **Migration/Environment:** no schema; environment/provider runtime state.
  **Erforderliche Tests:** unit/component, PG zero-side-effect, browser local
  digest positive and preview manipulation negative. **E2E-ID:**
  `E2E-34-12`, `E2E-34-16`, `E2E-34-20`.
  **Implementierungsstatus:** Local-UI und echter Worker liefern den dauerhaften
  Mock-Alert genau einmal; Preview zeigt die fehlende Delivery ehrlich und
  blockiert auch eine manipulierte Aktivierung ohne Wirkung, jeweils in allen
  drei Browsern. **Abschließende Evidence:** Phase-34-Browsergate 45/45 auf
  Digest `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa`
  sowie [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** live email/worker deployment.

### `F34-NOT-005` — queued lokale Mailbox wurde zu früh als erfasst gemeldet

- **Ursprünglicher Befund:** Outbox-basierte Einladungen und Passwort-Resets
  verwendeten denselben `local_mailbox`-Zustand wie eine direkte synchrone
  Mock-Erfassung. Die UI konnte deshalb „erfasst“ melden, obwohl noch kein
  Worker-Versuch und kein Mailbox-Sink-Eintrag existierte. **Quelle:** N beim
  Aufbau von `E2E-34-16`. **Kategorie:** Notification Truth.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `lib/notifications/delivery-state.ts`, Team-Einladungsaktionen,
  Passwort-Reset-Feedback, Notification-Outbox/Dispatcher und lokaler
  `EmailLog`-Sink. **Tatsächlicher Ausführungspfad:** Browser →
  Invitation-/Reset-Action → verschlüsselte `NotificationOutbox` → sofortige
  Rückmeldung → Worker → DeliveryAttempt/`EmailLog`.
  **Reproduktion:** Local-Outbox erzeugen und Rückmeldung vor dem Worker mit
  DB-Zustand vergleichen; denselben Weg in Preview bei pausierter Delivery
  ausführen. **Beweise:** vor der Korrektur teilten direkter und asynchroner
  Pfad denselben Zustand; die neue E2E prüft vor dem Worker null Attempts und
  null `EmailLog`, danach genau einen akzeptierten Versuch und einen
  redigierten Mock-Sink-Eintrag.
- **Ursache:** der Delivery-State unterschied Providerart, aber nicht
  synchrone Capture von durable Queueing. **Blast Radius:** Einladungs- und
  Reset-Vertrauen sowie Supportdiagnose. **Abhängigkeiten:** Outbox-Worker und
  lokaler Mock-Sink. **Gewählte Lösung:** neuer Zustand
  `local_mailbox_queued`; bis zum Worker-Erfolg lautet die Aussage
  „vorgemerkt“, direkter nicht-Outbox-Capture bleibt „erfasst“.
  **Verworfene Alternative:** Outbox-Enqueue als Zustellung behandeln oder
  Worker im Request synchron ausführen.
- **Migration/Environment:** keine Schemaänderung; Local/CI-spezifische
  Wahrheit, Preview bleibt pausiert und ohne Aktivierung. **Erforderliche
  Tests:** Delivery-State-Unitmatrix; Einladung Local/Preview mit echtem
  Worker; Passwort-Reset mit expliziter queued/no-overclaim-Prüfung sowie
  unbekannter Adresse. **E2E-ID:** `E2E-34-05`, `E2E-34-16`.
  **Implementierungsstatus:** Einladung und Passwort-Recovery zeigen vor dem
  Worker korrekt nur `queued`, belegen null Attempt/Sink und danach exakt einen
  lokalen Sink-Erfolg; Preview bleibt ohne falsche Zustellbehauptung pausiert,
  jeweils in Chromium, Firefox und WebKit. **Abschließende Evidence:**
  Phase-34-Browsergate 45/45 auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines für die Copy-Korrektur; echter
  Provider-Receipt bleibt unter `F34-NOT-001`/`F34-OPS-013` offen.

### `F34-AUTH-001` — E-Mail-Adresse nicht änderbar

- **Ursprüngliche Behauptung:** Login-E-Mail könne nicht geändert werden und
  mache zusammen mit Resetproblemen Konten tot. **Quelle:** R, Z. 65–70.
  **Kategorie:** Account Security/UX. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `lib/auth/email-change-service.ts`,
  policy, security form, verification and old-address notice.
  **Tatsächlicher Ausführungspfad:** authenticated request → verify new
  address → change/rotate sessions → notify old/new. **Reproduktion:** valid,
  duplicate, wrong/replayed/expired token and assurance denial.
  **Beweise:** complete email change policy/service/UI/tests now exist.
- **Ursache:** Review snapshot before implementation. **Blast Radius:** none
  current; security journey if regression. **Abhängigkeiten:** mail delivery.
  **Gewählte Lösung:** existing flow regressieren. **Verworfene Alternative:**
  direct unverified address overwrite.
- **Migration/Environment:** none new. **Erforderliche Tests:** service/PG and
  browser mail-sink positive/replay negative. **E2E-ID:** `E2E-34-05`,
  `E2E-34-16`. **Implementierungsstatus:** present; final E2E pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  live email.

### `F34-UX-002` — Anschreiben nach abgelehntem Submit

- **Ursprüngliche Behauptung:** bei einem serverseitig abgelehnten Submit
  gehe das getippte Anschreiben verloren. **Quelle:** R, Z. 171–179.
  **Kategorie:** Candidate UX. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `OBSOLETE`.
- **Betroffene Dateien/Funktionen:** `components/public/apply-save-actions.tsx`,
  application action state/validation. **Tatsächlicher Ausführungspfad:** form
  → rejected server action → returned safe values → re-render.
  **Reproduktion:** long cover letter, trigger validation/business denial,
  inspect field. **Beweise:** current component restores cover letter from
  action state; dedicated unit test asserts exact text.
- **Ursache:** old form reset behavior. **Blast Radius:** candidate effort.
  **Abhängigkeiten:** no secret/unsafe value echo. **Gewählte Lösung:** current
  bounded safe rehydration. **Verworfene Alternative:** persist rejected
  application or store in logs.
- **Migration/Environment:** none. **Erforderliche Tests:** component and real
  browser rejected/accepted submit. **E2E-ID:** `E2E-34-01`.
  **Implementierungsstatus:** present; browser candidate rerun pending.
  **Abschließende Evidence:** existing unit, final E2E outstanding.
  **Verbleibendes externes Gate:** none.

### `F34-NOT-001` — falsches `resend_live`-Delivery-Label

- **Ursprüngliche Behauptung:** active live provider appeared as
  `record_only`, misleading UI/operator about actual external dispatch.
  **Quelle:** N; A §F/G. **Kategorie:** Notification Truth.
  **Anfängliches Risiko:** P2. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:**
  `lib/notifications/delivery-state.ts`, invitation/reset/pricing state
  consumers. **Tatsächlicher Ausführungspfad:** provider mode/activation →
  delivery-state → user/operator copy. **Reproduktion:** disabled, local mock,
  resend sandbox and resend live matrix. **Beweise:** working tree classifies
  sandbox/live as `external_dispatch`; focused tests green.
- **Ursache:** enum mapping omitted newer live mode. **Blast Radius:** false
  user and operational state. **Abhängigkeiten:** provider activation.
  **Gewählte Lösung:** exhaustive mapping; no claim of recipient receipt.
  **Verworfene Alternative:** label all durable outbox entries „sent“.
- **Migration/Environment:** none. **Erforderliche Tests:** unit matrix and
  real invite/reset→outbox→worker contract positive/disabled negative.
  **E2E-ID:** `E2E-34-05`, `E2E-34-16`, `E2E-34-20`.
  **Implementierungsstatus:** code/unit present; E2E pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  live provider receipt.

### `F34-UX-003` — rohe Enums, Codes und interne Begriffe

- **Ursprüngliche Behauptung:** Nutzer sehen Werte wie `PERMANENT`, `HYBRID`,
  `MONTH`, `CV`, Eingaben wie `de:B2`/`CODE|Beschreibung` oder interne Texte
  wie Mock-Checkout, Phase 13 und ProductVersion-Snapshot. **Quelle:** A §G;
  R, Z. 47–50/65–68. **Kategorie:** UX/de-CH Truth.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/jobs/labels-de.ts`,
  `lib/employer/job-contracts.ts`, public job card/search/content, employer
  job wizard/table/applicant, billing/marketing components.
  **Tatsächlicher Ausführungspfad:** DB/domain enum → formatter/form option →
  visible de-CH UI. **Reproduktion:** route corpus over each enum/code and
  provider/environment state. **Beweise:** central label/contracts and broad
  component updates/tests are in working tree; no claim that every route has
  been browser-checked.
- **Ursache:** raw domain values rendered and demo copy leaked across layers.
  **Blast Radius:** conversion and comprehension. **Abhängigkeiten:** design
  system and actual environment. **Gewählte Lösung:** reusable de-CH mappings
  and honest state-specific copy. **Verworfene Alternative:** broad redesign
  or per-page hardcoded synonyms.
- **Migration/Environment:** none. **Erforderliche Tests:** unit/component
  label matrix, route text scan, browser mobile/desktop positive and prod-like
  no-internal-copy negative. **E2E-ID:** `E2E-34-01`–`09`, `E2E-34-20`.
  **Implementierungsstatus:** code/tests present; full browser corpus pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes externes Gate:**
  language/content review.

### `F34-UX-004` — Responsive, Fokus, Tastatur und Accessibility

- **Ursprüngliche Behauptung:** 320/360 px, keyboard operation, focus
  management, loading/error/empty/success states and WCAG 2.2 AA must be
  verified. **Quelle:** A §G. **Kategorie:** UX/Accessibility.
  **Anfängliches Risiko:** P1. **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** all changed UI components/routes,
  design-system controls, Phase-29 accessibility specs.
  **Tatsächlicher Ausführungspfad:** real Chromium/Firefox/WebKit and assistive
  technology → route/forms/dialogs. **Reproduktion:** all critical journeys at
  320/360, zoom, keyboard/focus, axe. **Beweise:** design-system and existing
  automated coverage are substantial; Phase-34 changes have not yet completed
  all engines/sizes and external AT review.
- **Ursache:** cross-cutting acceptance obligation, not a single code defect.
  **Blast Radius:** all changed user surfaces. **Abhängigkeiten:** final UI and
  A11Y-001. **Gewählte Lösung:** run full matrix and create findings per actual
  failure. **Verworfene Alternative:** assert compliance from component tests.
- **Migration/Environment:** none. **Erforderliche Tests:** component, axe,
  browser engines, mobile, keyboard/focus; manual AT.
  **E2E-ID:** every affected UI journey. **Implementierungsstatus:** pending.
  **Abschließende Evidence:** none final. **Verbleibendes external gate:**
  NVDA/VoiceOver review.

### `F34-SEO-001` — Canonical/noindex/Sitemap/Robots und Demo-Inhalte

- **Ursprüngliche Behauptung:** Canonicals, `noindex`, sitemap/robots,
  controlled index activation and demo exclusion may be incomplete.
  **Quelle:** A §G. **Kategorie:** SEO/Data Truth. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** `app/robots.ts`, `app/sitemap.ts`,
  `lib/seo/**`, public environment/provenance, job/company content.
  **Tatsächlicher Ausführungspfad:** crawler HTTP → metadata/robots/sitemap →
  eligible live source. **Reproduktion:** Local/demo, Preview and prod-like
  matrices with LIVE/Demo records. **Beweise:** robust cluster launch/index
  gates and tests exist; final prod-like candidate and real deployment URL
  have not been crawled, and response-truth change affects public claims.
- **Ursache:** activation depends on environment and data provenance.
  **Blast Radius:** indexing demo or blocking live content. **Abhängigkeiten:**
  SEARCH-010/DATA-001, legal go-live. **Gewählte Lösung:** keep noindex until
  explicit valid live provenance/activation; regress all sources.
  **Verworfene Alternative:** production domain alone enables indexing.
- **Migration/Environment:** SEO/index flags. **Erforderliche Tests:** unit
  metadata, HTTP robots/sitemap/canonical, crawler E2E positive/negative.
  **E2E-ID:** `E2E-34-15`, `E2E-34-20`.
  **Implementierungsstatus:** existing controls; full final E2E pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes external gate:**
  production URL/content/legal approval.

### `F34-AI-001` — Mock-AI in Production-like

- **Ursprüngliche Behauptung:** local mock AI actions/copy could appear as a
  real feature or execute in Preview/Production. **Quelle:** A §B/G and
  general Mock/Live invariant; N. **Kategorie:** Provider Truth.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/providers/ai/index.ts`, employer job
  and applicant actions/pages/components. **Tatsächlicher Ausführungspfad:**
  UI CTA/direct action → AI provider resolver → generated draft only.
  **Reproduktion:** local/ci shows explicit local suggestion; preview/prod-like
  hides CTA and direct action denies without writes/provider call.
  **Beweise:** resolver now permits mock only local/ci; UI/action tests cover
  hidden/denied states.
- **Ursache:** mock adapter availability was not consistently reflected at
  every consumer. **Blast Radius:** misleading AI claim/provider effect.
  **Abhängigkeiten:** future approved OpenAI activation.
  **Gewählte Lösung:** server gate plus UI truth; generated text never auto-
  sends. **Verworfene Alternative:** env secret silently selects provider.
- **Migration/Environment:** provider mode matrix. **Erforderliche Tests:**
  unit/component and browser local positive/prod-like direct-action negative.
  **E2E-ID:** `E2E-34-10`, `E2E-34-20`.
  **Implementierungsstatus:** code/tests present; E2E pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes external gate:**
  AI provider, DPA, purpose approval.

### `F34-JOBROOM-001` — Mock-Jobroom in Production-like

- **Ursprüngliche Behauptung:** mock occupation/reporting results could be
  mistaken for a real Stellenmeldepflicht decision in Preview/Production.
  **Quelle:** A §A/B/G; N. **Kategorie:** Legal Provider Truth.
  **Anfängliches Risiko:** P0. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** `lib/providers/jobroom/index.ts`,
  employer job pages/actions, reporting UI. **Tatsächlicher Ausführungspfad:**
  job workflow → provider resolver → occupation/reporting result → publish
  gate. **Reproduktion:** local mock positive; prod-like mock flag/UI/direct
  action negative with no reporting evidence/write.
  **Beweise:** resolver and UI/action gates now local/ci only; tests present.
- **Ursache:** deterministic demo provider looked like authority evidence.
  **Blast Radius:** unlawful early publication. **Abhängigkeiten:** LEG-003.
  **Gewählte Lösung:** fail-closed and explicit local demo semantics.
  **Verworfene Alternative:** mock fixture as official decision.
- **Migration/Environment:** provider mode/activation. **Erforderliche Tests:**
  unit/component, browser/action positive/negative, later official contract.
  **E2E-ID:** `E2E-34-03`, `E2E-34-10`, `E2E-34-20`.
  **Implementierungsstatus:** code/tests present; E2E pending.
  **Abschließende Evidence:** ausstehend. **Verbleibendes external gate:**
  official arbeit.swiss/SECO interface and legal policy.

### `F34-RADAR-001` — angebliches Identitätsleck im Talent Radar

- **Ursprüngliche Behauptung:** Talent Radar könnte identity before explicit
  candidate release leak; R itself says the anonymity holds. **Quelle:** R,
  Z. 106–114/145–151/201–207; A §E/F. **Kategorie:** Privacy/Security.
  **Anfängliches Risiko:** P0. **Prüfstatus:** `FALSE_POSITIVE` for leak
  hypothesis; positive invariant confirmed.
- **Betroffene Dateien/Funktionen:** `list-candidates.ts`, anonymized DTO,
  `lib/privacy/radar-opaque.ts`, reveal snapshot, request/contact flows.
  **Tatsächlicher Ausführungspfad:** employer list → allowlisted anonymous DTO
  - company/epoch token → candidate accept → reveal. **Reproduktion:** cross-
    company/epoch/revoked token, pre-accept inspect fields and DB query.
    **Beweise:** list query does not select direct identifiers; DTO rebuilt
    field-by-field; opaque tokens scoped, authenticated and constant-time
    compared; reveal requires candidate confirmation.
- **Ursache:** required high-risk verification, no current leak.
  **Blast Radius:** candidate identity if regression. **Abhängigkeiten:**
  LEG-002/006 and eligibility revoke. **Gewählte Lösung:** preserve strict
  boundary and run abuse E2E. **Verworfene Alternative:** deny legal review
  merely because anonymity works.
- **Migration/Environment:** none. **Erforderliche Tests:** DTO/unit, PG
  cross-scope/revoke, browser cross-tenant/pre/post reveal.
  **E2E-ID:** `E2E-34-11`, `E2E-34-14`.
  **Implementierungsstatus:** no code change for anonymity; final E2E pending.
  **Abschließende Evidence:** existing tests/static proof, final pending.
  **Verbleibendes external gate:** AVG/consent/retention under LEG-002/006.

## 10. Test- und Migrationsintegrität

### `F34-QA-001` — fixes Fixture-Datum

- **Ursprüngliche Behauptung:** Public-read-model-Test sei rot, weil ein
  festes Datum inzwischen vor der realen DB-Wanduhr lag und als abgelaufen
  galt. **Quelle:** N. **Kategorie:** QA. **Anfängliches Risiko:** P1 QA.
  **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `tests/integration/jobs/public-read-model-postgres.test.ts` fixture clock.
  **Tatsächlicher Ausführungspfad:** PG fixture → schema/eligibility → test.
  **Reproduktion:** Test nach festem Stichtag ausführen. **Beweise:** fixture
  now derives a minute-aligned date seven days before runtime; full file
  19/19 green at repair point.
- **Ursache:** wall-clock-sensitive fixed timestamp. **Blast Radius:** false
  regression signal, not product semantics. **Abhängigkeiten:** DB clock.
  **Gewählte Lösung:** relative bounded date. **Verworfene Alternative:**
  bypass expiration constraint or freeze production code clock.
- **Migration/Environment:** none. **Erforderliche Tests:** full PG file and
  final regression; product browser E2E not caused by fixture-only edit.
  **E2E-ID:** QA integration consumer. **Implementierungsstatus:** complete.
  **Abschließende Evidence:** 19/19 gezielt und der finale Integrationslauf
  756/756 grün; [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes external gate:** none.

### `F34-QA-002` — feste Testzahlen und alte Evidence

- **Ursprüngliche Behauptung:** hardcoded pass counts, insbesondere
  `unexplainedSkips: 0`, `.skip`/`.only`, expected failures/retries and 38 old
  gate commands might be treated as current evidence. **Quelle:** A §H.
  **Kategorie:** Test Integrity. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `CONFIRMED` as a candidate-wide evidence obligation; no
  single runtime defect yet.
- **Betroffene Dateien/Funktionen:** test reporters/manifests, Phase-33
  evidence, package scripts, all test files. **Tatsächlicher Ausführungspfad:**
  runner → reporter → generated counts/skips/retries → evidence.
  **Reproduktion:** scan `.skip`/`.only`, run current candidate, compare
  reporter counts and commit/tree identity. **Beweise:** old Phase-33 runs
  predate Phase-34 edits and cannot certify current tree.
- **Ursache:** historical evidence reused across changed candidate.
  **Blast Radius:** false release claim. **Abhängigkeiten:** immutable final
  candidate. **Gewählte Lösung:** dynamic counts and complete rerun after last
  change. **Verworfene Alternative:** copy old totals or lower thresholds.
- **Migration/Environment:** none. **Erforderliche Tests:** full unit/
  integration/e2e all engines, skip/only/retry scan and manifest validation.
  **E2E-ID:** all `E2E-34-*`. **Implementierungsstatus:** die aktuellen
  dynamischen Kernzahlen sind Unit 2834/2834, Integration 756/756,
  allgemeiner Browser 354/354, Phase-33-Browser 9/9 und Phase-34-Browser
  45/45; die Pflicht bleibt als candidate-weite Governance-Regel bestätigt
  und darf nicht durch historische Zahlen ersetzt werden. **Abschließende
  Evidence:** [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes external gate:** none for local, provider-specific E2Es
  separate.

### `F34-QA-003` — Preview/prod-like und allowed active paths

- **Ursprüngliche Behauptung:** tests may claim Preview while actually using
  Local, test only fail-closed denials, or run against a different PG version;
  critical allowed states remain unproved. **Quelle:** A §H and strict E2E
  mandate. **Kategorie:** QA/Environment. **Anfängliches Risiko:** P0 QA.
  **Prüfstatus:** `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** Playwright configs/runners,
  `scripts/phase34-browser-gate.ts`, env fixtures, Docker PG16, all changed
  flows. **Tatsächlicher Ausführungspfad:** production build → real process
  with selected env → browser/HTTP → DB/worker/provider boundary.
  **Reproduktion:** assert actual process env and run positive/negative pairs
  on same artifact/database snapshot. **Beweise:** der neue Phase-34-Runner
  baut den aktuellen Candidate, startet getrennte echte Local- und Preview-
  Prozesse, migriert eine isolierte PG16-Datenbank und führte auf Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa`
  15 logische Szenarien in Chromium, Firefox und WebKit mit 45/45 Resultaten
  aus. Das deckt weiterhin nicht automatisch jede der 20 übergreifenden
  Journeys oder echte Provider-/Deployment-Pfade ab.
- **Ursache:** test label and actual process config can diverge.
  **Blast Radius:** every claimed fix. **Abhängigkeiten:** all implementations
  stable, migrations, build. **Gewählte Lösung:** candidate-bound manifest,
  actual entrypoints and persisted side effects. **Verworfene Alternative:**
  unit mocks or HTTP status alone as E2E.
- **Migration/Environment:** Local/CI/Preview/prod-like matrix.
  **Erforderliche Tests:** all tests specified in Auftrag, no skip/only/retry;
  three engines. **E2E-ID:** all `E2E-34-01`–`20`.
  **Implementierungsstatus:** Local/Preview-Harness und finaler 45/45-
  Candidate-Lauf grün; Crosswalk zu allen 20 Journeys und prod-like erlaubte
  Providerpfade ausstehend. **Abschließende Evidence:**
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md), begrenzt auf
  die dort ausgewiesene Local-/Preview-Matrix. **Verbleibendes externes Gate:**
  live provider/real deployment tests where required.

### `F34-QA-004` — Browser-Gate konnte stale oder partielle Evidence akzeptieren

- **Ursprünglicher Befund:** `phase34:e2e` akzeptierte eine vorhandene
  `.next/BUILD_ID`, ohne sie an den aktuellen Arbeitsbaum zu binden, und der
  Manifestprüfer verlangte nur eine nicht leere Erfolgsmenge in drei benannten
  Projekten. Ein alter Build oder eine partielle Suite konnte dadurch als
  aktueller Candidate erscheinen. **Quelle:** N, unabhängiger E2E-Preflight.
  **Kategorie:** QA/Release Integrity. **Anfängliches Risiko:** P0 QA.
  **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `scripts/phase34-browser-gate.ts`,
  `lib/governance/phase34-browser-manifest.ts`,
  `tests/e2e/phase34-reporter.ts`, `playwright.phase34.config.ts`.
  **Tatsächlicher Ausführungspfad:** `npm run phase34:e2e` → frischer Build →
  Digest → Runtime/Playwright → pending Reporter-Manifest → exakte Validierung
  → atomare Veröffentlichung. **Reproduktion:** Build vor Source-Änderung,
  fehlenden/zusätzlichen/doppelten Test, falsche IDs/Projekt/Zählung oder Retry
  einspeisen. **Beweise:** der frühere Validator besass keine geschlossene
  Testallowlist und konnte ein bestehendes Build weiterverwenden.
- **Ursache:** Artifact-Existenz wurde mit Candidate-Identität und ein
  Open-World-Reportergebnis mit vollständiger Abnahme verwechselt.
  **Blast Radius:** sämtliche Phase-34-Evidence. **Abhängigkeiten:** stabiler
  Arbeitsbaum, Production-Build, Reporter und Cleanup. **Gewählte Lösung:**
  zwingender frischer Build; Digest vor/nach Build, vor Test und nach Cleanup;
  exakt 15 Resultate je Browser/45 total; null Skip/Retry/Failure; Reporter
  schreibt nur pending, Veröffentlichung erst nach Manifest-/Digestprüfung und
  erfolgreichem Runtime-/DB-/Temp-Cleanup. **Verworfene Alternative:** bloss
  `BUILD_ID` prüfen oder den Reporter direkt die finale Datei schreiben lassen.
- **Migration/Environment:** keine; Release-/Testtooling. **Erforderliche
  Tests:** gültiges Manifest positiv; missing/extra/duplicate/wrong IDs,
  project/count/retry und falscher Digest negativ; realer finaler
  `npm run phase34:e2e`. **E2E-ID:** QA-Verbrauchsgate aller enthaltenen
  Journeys, kein Ersatz für `E2E-34-01`–`20`.
  **Implementierungsstatus:** Gate und neun positive/negative Unitfälle sind
  grün; das Gate baute den Candidate frisch, band ihn vor/nach Build, Test und
  Cleanup an denselben Digest und veröffentlichte erst danach exakt 45/45
  Resultate ohne Skip, Retry oder Fehler. **Abschließende Evidence:** Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines.

### `F34-QA-005` — Browserprojekte teilten Rate-Limit-Buckets

- **Ursprünglicher Befund:** Chromium, Firefox und WebKit nutzten in derselben
  isolierten Datenbank für lokale Requests den Loopback-Fallback als gleiche
  Quell-IP; zwei Alert-Specs meldeten zusätzlich dasselbe Demo-Konto nochmals
  in Preview an. Nach korrekten früheren Browserläufen konnte WebKit deshalb
  zeitabhängig am echten LOGIN-IP- oder `AUTH_IDENTIFIER`-Limit scheitern.
  **Quelle:** N, unabhängiger E2E-Preflight. **Kategorie:** QA/Determinismus.
  **Anfängliches Risiko:** P1 QA. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `playwright.phase34.config.ts`,
  `tests/e2e/fixtures/phase34-network.ts`, `openActor()` sowie manuelle
  Kontexte in Cross-Tenant-/Password-/Alert-Specs. **Tatsächlicher
  Ausführungspfad:** Browserprojekt → Forwarded-Identity → Proxy → reales
  DB-Rate-Limit → Login/Action. **Reproduktion:** alle drei Projekte seriell
  gegen dieselbe DB innerhalb einer Stunde ausführen. **Beweise:** vor der
  Korrektur liefen alle Default-Local-Seiten als `127.0.0.1`, während LOGIN
  30/IP/Stunde und 10/Identifier/Stunde begrenzt.
- **Ursache:** manuell erzeugte Browserkontexte erben Playwright-Projekt-
  Header nicht; Testidentität wurde browserübergreifend wiederverwendet.
  **Blast Radius:** falsche rote E2E-Ergebnisse und zeitabhängige Abnahme.
  **Abhängigkeiten:** Proxy-Topologie und produktionsnahe Rate-Limits.
  **Gewählte Lösung:** stabile, getrennte TEST-NET-Quell-IP pro Projekt in
  Default- und allen lokalen manuellen Kontexten; Alert-Preview übernimmt die
  bereits authentifizierte Session statt einen fachfremden zweiten Login zu
  verbrauchen. **Verworfene Alternative:** Sicherheitslimits erhöhen,
  Rate-Limits im E2E abschalten oder globale Buckets löschen.
- **Migration/Environment:** keine; nur isolierter Local/Preview-E2E-Harness.
  **Erforderliche Tests:** Testliste/Typecheck und vollständige 45er-Matrix in
  einem gemeinsamen DB-Fenster. **E2E-ID:** Harness-Integrität.
  **Implementierungsstatus:** der vollständige serielle Lauf bestand gegen
  dieselbe isolierte Datenbank in Chromium, Firefox und WebKit mit getrennten
  TEST-NET-Quellidentitäten; 45/45 Resultate, null Retry/Skip/Failure.
  **Abschließende Evidence:** Digest
  `0c3fdc6790423e9e9f429689b504c019090503b77a5426626386de76c373bffa` und
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines.

### `F34-QA-006` — Live-Payment-Fixture verletzte Identity-/Outbox-Vertrag

- **Ursprünglicher Befund:** Der vollständige Unit-Runner brach in der
  Phase-33-Payment-Modematrix ab. Das als gültig erwartete Production-Live-
  Environment aktivierte durch den aktuellen Fixture-Vertrag zwingend
  Identity Verification, setzte aber keine Notification-Outbox-Produzenten;
  `parseEnvironment` lehnte es deshalb korrekt fail-closed ab. **Quelle:** N
  im ersten vollständigen Phase-34-Unitlauf. **Kategorie:** QA/Contract Drift.
  **Anfängliches Risiko:** P2. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `tests/unit/config/phase33-payment-mode-matrix.test.ts`,
  `tests/fixtures/environment.ts`, `lib/config/env-schema.ts`.
  **Tatsächlicher Ausführungspfad:** Testfixture → Production-Environment-
  Parser → Payment-Composition. **Reproduktion:** positiven Live-Payment-Fall
  ohne `NOTIFICATION_OUTBOX_PRODUCERS` ausführen. **Beweise:** der Parser
  meldete exakt, dass verifizierte Nutzer ohne durable Verification-Nachricht
  gesperrt werden könnten; der Produktvertrag war richtig, nur die ältere
  Payment-Fixture unvollständig.
- **Ursache:** ein älterer isolierter Provider-Test wurde nach Verschärfung des
  Identity-/Delivery-Vertrags nicht als vollständige Production-Komposition
  aktualisiert. **Blast Radius:** abgebrochene Unit-Suite und schwacher
  Negativtest, kein nachgewiesener Runtime-Bypass. **Abhängigkeiten:** zentrale
  Environment-Fixture. **Gewählte Lösung:** Outbox-Produzenten im positiven
  Live-Fall und im beabsichtigten Sandbox-Negativfall aktivieren, damit letzterer
  weiterhin aus dem richtigen Payment-Grund scheitert. **Verworfene
  Alternative:** Identity-Gate oder Parserregel für den Payment-Test lockern.
- **Migration/Environment:** keine. **Erforderliche Tests:** gezielte
  Phase-33-Payment-Matrix und erneuter vollständiger Unitlauf. **E2E-ID:**
  Environment-Contract-Verbrauchspfad. **Implementierungsstatus:** gezielte
  Datei 3/3 grün; vollständiger Re-Run ausstehend. **Abschließende Evidence:**
  finaler Unitlauf. **Verbleibendes externes Gate:** keines.

### `F34-QA-007` — Live-Storage-Fixture mit demselben Vertragsdrift

- **Ursprünglicher Befund:** Unmittelbar nach `F34-QA-006` brach der Unit-
  Runner im positiven Production-Live-Storage-/Scanner-Fall aus demselben
  Grund ab: Identity Verification war aktiv, der Outbox-Produzent fehlte.
  **Quelle:** N im zweiten vollständigen Unitlauf. **Kategorie:** QA/Contract
  Drift. **Anfängliches Risiko:** P2. **Prüfstatus:** `DUPLICATE` zu
  `F34-QA-006`.
- **Betroffene Dateien/Funktionen:**
  `tests/unit/config/phase33-storage-scanner-mode-matrix.test.ts` und derselbe
  zentrale Environment-Parser. **Tatsächlicher Ausführungspfad,
  Ursache, Blast Radius und Entscheidung:** identisch zu `F34-QA-006`; der
  positive Storage-Live-Vertrag und seine beabsichtigten Storage-Negativfälle
  müssen zuerst eine gültige Production-Identity-Komposition bilden.
- **Migration/Environment:** keine. **Erforderliche Tests:** gezielte
  Storage-/Scanner-Modematrix und vollständiger Unit-Re-Run. **E2E-ID:**
  Environment-Contract-Verbrauchspfad. **Implementierungsstatus:** Fixture um
  den erforderlichen Outbox-Produzenten ergänzt; gezielte Datei 3/3 grün.
  **Abschließende Evidence:** finaler Unitlauf ausstehend.
  **Verbleibendes externes Gate:** keines.

### `F34-QA-008` — UI-Fixtures verwendeten ungültiges `APP_ENV=test`

- **Ursprünglicher Befund:** Der Unit-Suffixlauf brach in drei Public-Job-
  Detailfällen ab, weil deren Server-Environment-Mock `APP_ENV: "test"`
  lieferte. Die zentrale exhaustive Deployment-Klassifikation kennt bewusst
  nur `local`, `ci`, `preview`, `staging` und `production` und lehnte den
  erfundenen Wert korrekt ab. Ein zweiter Support-Test enthielt denselben
  latenten Fixture-Wert. **Quelle:** N aus dem Unit-Suffixlauf. **Kategorie:**
  QA/Environment Contract. **Anfängliches Risiko:** P2. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `tests/unit/ui/public-job-detail.test.tsx`,
  `tests/unit/support/support-actions-rate-limit.test.ts` und
  `environmentClass()`. **Tatsächlicher Ausführungspfad:** UI-Render → Public-
  Intake-Privacy-Gate → exhaustive Environment-Class. **Reproduktion:** die
  Public-Job-Detaildatei mit dem alten Mock ausführen; alle drei Fälle endeten
  vor dem Rendern mit `Unsupported application environment: test`.
- **Ursache:** ältere Tests verwendeten Vitests Laufzeitbezeichnung zugleich
  als Deployment-Identität. **Blast Radius:** falsche rote Unit-Evidence und
  ein latent irreführender Support-Test; kein Runtime-Bypass. **Gewählte
  Lösung:** beide Fixtures als isoliertes `ci` klassifizieren. **Verworfene
  Alternative:** `test` als sechste Produktionsumgebung zulassen und damit den
  exhaustiven Sicherheitsvertrag aufweichen.
- **Migration/Environment:** keine. **Erforderliche Tests:** beide betroffenen
  Dateien sowie kompletter Unit-Re-Run. **E2E-ID:** Environment-Contract-
  Verbrauchspfad. **Implementierungsstatus:** gezielt 2 Dateien/6 Tests grün;
  Suffix- und Vollsuite laufen separat. **Abschließende Evidence:** finaler
  Unitlauf. **Verbleibendes externes Gate:** keines.

### `F34-QA-009` — Sitemap-Testport driftete vom Eligibility-Loader

- **Ursprünglicher Befund:** Der erste vollständige Unit-Abschlusslauf nach
  der pg-Queue-Härtung erreichte 365 Dateien, bevor der Sitemap-Quellentest
  scheiterte. Sein schmaler Transaktions-Doppelgänger lieferte weiterhin den
  alten verschachtelten Prisma-Row, aber nicht die nun expliziten Company-
  Verification-, Revision-, Category- und Score-Delegates. **Quelle:** N aus
  dem vollständigen Unitlauf. **Kategorie:** QA/Port Contract.
  **Anfängliches Risiko:** P2. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `tests/unit/seo/public-sitemap-sources.test.ts` und
  `loadPublicEligibilitySnapshots()`. **Tatsächlicher Ausführungspfad:**
  Sitemap-Batch → kanonische Eligibility → schmaler Unit-Transaktionsport.
  **Reproduktion:** den Sitemap-Quellentest gegen den neuen Loader ausführen;
  der Port endete bei `companyVerificationRequest.findMany` mit `undefined`.
- **Ursache:** der neue explizite Datenbankvertrag war im produktiven PG-Test,
  aber nicht im manuell konstruierten Sitemap-Unitport gespiegelt. Der alte
  Mock verwendete zudem dieselbe Revision-/Category-Identität für fachlich
  verschiedene Zeilen. **Blast Radius:** falscher roter Unit-Abschluss und
  schwächerer normalisierter Sitemap-Test, kein Production-Write.
  **Gewählte Lösung:** den Port mit getrennten Company-, Verification-,
  Revision-, Category- und Score-Reads sowie eindeutigen normalisierten IDs
  abbilden. **Verworfene Alternative:** im Produktcode auf den alten
  verschachtelten Mock zurückfallen.
- **Migration/Environment:** keine. **Erforderliche Tests:** gezielter Sitemap-
  Quellentest und vollständiger Unit-Re-Run. **E2E-ID:** `E2E-34-15`/Sitemap-
  Verbrauchspfad. **Implementierungsstatus:** gezielt 1 Datei/4 Tests grün;
  Typecheck und dateibezogenes ESLint grün. **Abschließende Evidence:**
  finaler Unitlauf. **Verbleibendes externes Gate:** keines.

### `F34-QA-010` — natürlicher EXPLAIN-Plan wurde als deterministischer Indexvertrag behandelt

- **Ursprünglicher Befund:** Der erste vollständige Integrations-Re-Run war
  fachlich in 196/197 Dateien und 755/756 Tests grün; einzig die Performance-
  Evidence verlangte, dass PostgreSQL in einem natürlichen kostenbasierten
  `EXPLAIN` zwingend den Phase-34-Trigram-Index auswählt. Derselbe Datensatz
  lieferte je nach Statistik, Cache und Join-Plan sowohl einen Trigram- als auch
  einen Primärschlüssel-/Sequence-Pfad. Selbst `enable_seqscan=off` am gesamten
  Join erzwang den Textindex nicht, weil PostgreSQL weiterhin legitim über
  Join-Schlüssel einsteigen konnte. **Quelle:** N aus dem vollständigen und den
  wiederholten gezielten PostgreSQL-Läufen. **Kategorie:** QA/Performance
  Evidence. **Anfängliches Risiko:** P2. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `tests/integration/jobs/public-read-model-postgres.test.ts`,
  `insertLargeSearchCohort()` und `benchmarkGlobalKeywordSearch()`.
  **Tatsächlicher Ausführungspfad:** 2.006 publizierte Fixtures → reale globale
  Public-Search-Hydration → natürliche Laufzeitmessung/EXPLAIN → separate
  Index-Capability-Probes. **Reproduktion:** denselben gezielten Test mehrfach
  ausführen; vor der Korrektur wechselte der natürliche Indexsatz und die
  starre Assertion fiel intermittierend aus, obwohl Resultat und Laufzeit
  korrekt blieben.
- **Ursache:** Optimizer-Entscheidung, Index-Existenz/-Gültigkeit,
  Operator-Fähigkeit und End-to-End-Latenz wurden in einer einzigen Assertion
  vermischt. **Blast Radius:** flakige, sehr späte Integrations-Evidence; kein
  belegter Produktionsdefekt. **Gewählte Lösung:** Fixture-Statistiken mit
  `ANALYZE` aktualisieren; harte reale P95-Budgets beibehalten; natürliche
  Pläne nur als Telemetrie ausgeben; `indisvalid` und `indisready` für alle drei
  erwarteten Indizes im Katalog prüfen; Revision-, Company- und strukturierten
  Prädikatpfad in einer ausschließlich testlokalen Transaktion mit `SET LOCAL`
  getrennt auf ihre tatsächliche Indexfähigkeit prüfen. Ein fehlgeschlagenes
  Rollback verwirft die Poolverbindung. **Verworfene Alternative:** Retries,
  globales Planner-Tuning oder eine schwache Assertion auf irgendeinen Index.
- **Migration/Environment:** keine; nur PostgreSQL-16-Testharness.
  **Erforderliche Tests:** wiederholter gezielter 21/21-PG-Lauf, Typecheck,
  dateibezogenes ESLint und vollständige Integration. **E2E-ID:**
  `E2E-34-15`. **Implementierungsstatus:** zwei aufeinanderfolgende gezielte
  Läufe nach der endgültigen Trennung jeweils 21/21 grün; ein natürlicher Lauf
  nutzte Trigram, der nächste bewusst einen anderen Kostenpfad, während beide
  Capability-Probes und die Latenzbudgets stabil bestanden. **Abschließende
  Evidence:** vollständige Integration 197/197 Dateien und 756/756 Tests in
  858,63 Sekunden; enge Suche p95 56,70 ms, breite Seite p95 189,31 ms, beide
  Trigram- sowie der strukturierte Index gültig und im Capability-Probe
  nutzbar. **Verbleibendes externes Gate:** keines für diesen QA-Fix; reale
  Zielpool-/Staging-Last bleibt getrennt unter `SEARCH-004`/`006`/`007` offen.

### `F34-QA-011` — Browserverträge erwarteten rohe Enums und vor Phase 34 erlaubte Zustellung

- **Ursprünglicher Befund:** Der vollständige allgemeine Browserlauf erreichte
  344/354 Fälle und endete nach 40,3 Minuten mit sechs Fehlern sowie vier nicht
  mehr gestarteten Fällen. Ein Phase-17-Journey suchte 120 Sekunden nach dem
  nicht mehr sichtbaren Enum `NONE`; der Phase-33-Candidate-Journey versuchte
  in Chromium, Firefox und WebKit 180 Sekunden lang eine bewusst deaktivierte
  Jobabo-Aktivierung anzuklicken; Desktop und Mobile erwarteten auf derselben
  Seite weiterhin `Freigegeben`. **Quelle:** N aus dem vollständigen Phase-34-
  Candidate-Browserlauf. **Kategorie:** QA/Browser Contract. **Anfängliches
  Risiko:** P1. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:**
  `tests/e2e/flows/phase17-employer-publish.spec.ts`,
  `tests/e2e/flows/phase33-public-candidate.spec.ts`,
  `tests/e2e/quality/critical-routes.spec.ts` und
  `tests/unit/employer/job-contract-labels.test.ts`. **Tatsächlicher
  Ausführungspfad:** Employer-Step 3 beziehungsweise Candidate-Jobabo-Seite →
  lokalisierte Accessibility-Namen und aktuelle Provider-/Worker-/Scheduler-
  Availability → Playwright-Assertion → Datenbankzustand/Rollendenial.
  **Reproduktion:** allgemeines Browsergate ohne Phase-34-spezifische
  Provider-/Handler-Authority ausführen; alle sechs Fehler sind deterministisch
  und in den drei Engines semantisch identisch.
- **Ursache:** Die UI hatte korrekt `NONE` als `Keine Pflichtunterlagen`
  lokalisiert und aktive Zustellung bei fehlender technischer Authority
  fail-closed auf `Zustellung gesperrt` umgestellt. Ältere E2E-/Quality-
  Erwartungen wurden bei dieser bewussten Produktwahrheitsänderung nicht
  portiert. **Blast Radius:** rotes 40-Minuten-Gate und irreführende alte QA-
  Erwartungen; kein Produkt-, Browser-, Responsive-, Auth- oder Datenbankfehler.
  **Gewählte Lösung:** über sichtbaren de-CH-Accessible-Name wählen; die beiden
  Aktivierungscontrols als deaktiviert und den Availability-Hinweis prüfen;
  einen pausierten Entwurf mit `PAUSED`/`CREATED_PAUSED` persistieren und den
  Cross-Role-403/Zero-Leak unverändert erhalten; die Quality-Assertion auf die
  konkrete Seed-Karte begrenzen und dort den gesperrten statt eines
  freigegebenen Zustellpfads verlangen. Ein Label-Unittest versiegelt
  `NONE` → `Keine Pflichtunterlagen`. **Verworfene Alternative:** im allgemeinen
  Harness künstlich Provider-/Worker-Authority aktivieren oder die sichere UI
  wieder freischalten.
- **Migration/Environment:** keine; Testverträge für den allgemeinen Local-
  Browserharness. **Erforderliche Tests:** betroffene Unit-/PG-Verträge,
  ESLint/Typecheck, gezielter Drei-Dateien-Browserlauf sowie das vollständige
  allgemeine Browsergate und `phase33:e2e`. **E2E-ID:** ältere `E2E-02`,
  `P33-AC-10/14` und Quality-Desktop/Mobile; Finding-Evidence, kein Ersatz für
  die offene `E2E-34-01`–`20`-Crosswalk-Lücke. **Implementierungsstatus:**
  gezielt 3 Unit-Dateien/23 Tests, 1 PG-Datei/4 Tests und 14/14 Browserfälle
  sowie anschließend das allgemeine Browsergate 354/354 und `phase33:e2e`
  9/9 grün. Die während des Phase-34-Gates korrigierten Erwartungen an native
  Optionen, geschlossene `details`, mehrere wirksame `noindex`-Tags,
  gestreamtes App-Router-`notFound()` und kontrollierte RSC-Diagnostik bleiben
  als semantische Browserverträge versiegelt. **Abschließende Evidence:**
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines für die Testportierung; reale
  Zustellaktivierung bleibt provider-/operationsabhängig und fail-closed.

### `F34-QA-012` — Retentionstest verglich PostgreSQL- und Host-Uhr

- **Ursprünglicher Befund:** Der erste vollständige PostgreSQL-Lauf bestand
  196/197 Dateien und 755/756 Tests; einzig der Retentionstest erwartete, dass
  der von PostgreSQL geschriebene Wipe-Zeitpunkt mindestens dem unmittelbar
  davor mit Node/Windows erfassten Host-Zeitpunkt entspricht. PostgreSQL
  lieferte `1786079103097`, die Host-Uhr `1786079103098`. **Quelle:** N aus
  dem finalen Candidate-Integrationslauf. **Kategorie:** QA/Time Boundary.
  **Anfängliches Risiko:** P1 QA. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** ausschließlich
  `tests/integration/schema/phase33-notification-attempt-retention-postgres.test.ts`;
  geprüft, aber unverändert blieb `lib/notifications/retention.ts` samt
  Retention-Constraint und Append-only-Trigger. **Tatsächlicher
  Ausführungspfad:** Node-Testuhr → Retention-Aufruf → PostgreSQL-Transaktion →
  `date_trunc('milliseconds', CURRENT_TIMESTAMP)` → Cross-Clock-Assertion.
  **Reproduktion:** vollständige Integration unter paralleler Systemlast;
  exakt ein Millisekunden-Tick zwischen den beiden unabhängigen Uhren genügte.
- **Ursache:** Der Test mischte die Host-Uhr mit einem DB-autorisierten,
  millisekundengenau truncierten Zeitstempel. Es gab keine Early-Wipe-Lücke:
  Query, Check-Constraint und Trigger verlangen unabhängig voneinander
  `recipientEvidenceWipedAt >= recipientEvidenceRetainUntil` und eine bereits
  erreichte DB-Deadline. **Blast Radius:** falsches rotes Release-Signal, nicht
  die 400-Tage-Produktionsretention. **Gewählte Lösung:** DB-erzeugte
  Zeitfenster mit `date_trunc('milliseconds', statement_timestamp())` messen;
  `retainUntil - 1 ms` bleibt negativ und exakt `retainUntil` ist der inklusive
  Positivrand. **Verworfene Alternative:** Toleranzfenster, Sleep, Retry,
  Schwellenabsenkung oder eine sachlich unnötige Produktionsänderung.
- **Migration/Environment:** keine. **Erforderliche Tests:** derselbe isolierte
  PG-Dateitest mehrfach sowie vollständige Integration. **E2E-ID:**
  Candidate-Integrationsverbrauchspfad. **Implementierungsstatus:** drei
  unabhängige gezielte Läufe jeweils 1/1 Datei und 7/7 Tests grün; der finale
  Gesamtlauf bestand 197/197 Dateien und 756/756 Tests ohne Skip.
  **Abschließende Evidence:**
  [Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).
  **Verbleibendes externes Gate:** keines.

### `F34-SUPPLY-001` — verwundbare transitive YAML-Version im Tooling

- **Ursprünglicher Befund:** `npm ci` meldete eine High-Schwachstelle in
  `js-yaml@4.3.0` (`GHSA-5p4m-2wfm-xmqj`, `CVE-2026-59870`) über die reinen
  Dev-Ketten ESLint/`@eslint/eslintrc` und shadcn/cosmiconfig. **Quelle:** N
  aus aktuellem Dependency-Audit. **Kategorie:** Supply Chain/Build.
  **Anfängliches Risiko:** P2, weil der Production-Dependency-Graph bereits
  null Findings hatte. **Prüfstatus:** `FIXED`.
- **Betroffene Dateien/Funktionen:** `package-lock.json`; lokale Lint-/Build-
  YAML-Verarbeitung. **Tatsächlicher Ausführungspfad:** `npm ci` → transitive
  Toolinstallation → YAML-Parser. **Reproduktion:** `npm audit --json` vor
  der Lockfile-Aktualisierung; Production-only separat prüfen. **Beweise:**
  beide Ketten akzeptieren `js-yaml@4.3.1` ohne Majorwechsel; der gezielte
  Lockfile-Diff ändert nur Version/Resolved/Integrity dieses Pakets.
- **Ursache:** veraltete kompatible Lockfile-Auflösung. **Blast Radius:** CI/
  Entwicklung bei fremdkontrolliertem YAML, nicht nachgewiesene App-Runtime.
  **Abhängigkeiten:** aktueller npm-Advisory-Feed. **Gewählte Lösung:** exakt
  `4.3.1` per package-lock-only Update; kein blindes `npm audit fix` und kein
  Majorwechsel. **Verworfene Alternative:** Dev-Finding ignorieren.
- **Migration/Environment:** keine. **Erforderliche Tests:** `npm ci`,
  `npm audit --json`, `npm audit --omit=dev --json`, Lint/Typecheck/Suite.
  **E2E-ID:** Build-/Audit-CLI-Verbrauchspfad. **Implementierungsstatus:**
  abgeschlossen; beide Auditvarianten aktuell 0 Findings.
  **Abschließende Evidence:** finaler Candidate-Audit wird erneut ausgeführt.
  **Verbleibendes externes Gate:** laufende Advisory-/Dependabot-Pflege.

### `F34-MIG-001` — Generated Search-Spalte und Revision-Immutability

- **Ursprüngliche Behauptung:** additive generated `searchDocument` caused
  the existing BEFORE UPDATE immutability trigger to compare the old generated
  value before regeneration and reject valid moderation transitions.
  **Quelle:** N during Phase-11 PG regression. **Kategorie:** Database.
  **Anfängliches Risiko:** P1. **Prüfstatus:**
  `IMPLEMENTED_E2E_PENDING`.
- **Betroffene Dateien/Funktionen:** additive migration
  `20260806230000_phase_34_job_revision_generated_column_immutability`,
  trigger function, search generated column. **Tatsächlicher Ausführungspfad:**
  employer revision → admin moderation timestamp/status update → trigger →
  public search. **Reproduktion:** migrated PG, valid `submittedAt→approvedAt`
  transition; attempt authored content mutation. **Beweise:** old trigger
  rejected valid seed; replacement excludes only derived `searchDocument`
  from JSON comparison and Phase-11 PG suite passes 18/18; dedicated PG test
  added.
- **Ursache:** generated column timing inside BEFORE UPDATE trigger.
  **Blast Radius:** all job approvals after search migration.
  **Abhängigkeiten:** SEARCH-005 and migration order. **Gewählte Lösung:**
  redefine trigger additively, retain authored-field immutability.
  **Verworfene Alternative:** edit historical trigger migration, disable
  trigger, or make source fields mutable.
- **Migration/Environment:** additive SQL only; Fresh/Upgrade/partial/restart.
  **Erforderliche Tests:** schema contract, PG positive moderation/negative
  content mutation, migration→app/admin→public E2E.
  **E2E-ID:** `E2E-34-03`, `E2E-34-19`.
  **Implementierungsstatus:** migration/PG regression present; migration
  system E2E pending. **Abschließende Evidence:** ausstehend.
  **Verbleibendes external gate:** target PG/extension compatibility.

## 11. Getrennte Verbesserungsvorschläge

Die folgenden Punkte sind ausdrücklich **keine bestätigten Defekte allein
aufgrund ihrer Nennung**. `Typ: PROPOSAL` ist getrennt vom Prüfstatus.

### `P34-ARCH-001` — zentraler Environment-Class-Helper

- **Ursprünglicher Vorschlag:** alle offenen Boolean-Ketten durch eine
  erschöpfende zentrale `environmentClass()`-Fallunterscheidung ersetzen,
  damit ein neues Environment einen Compiler-/Testfehler auslöst. **Quelle:**
  R, Z. 74–88. **Typ:** `PROPOSAL`. **Kategorie:** Architecture.
  **Anfängliches Risiko des adressierten Problems:** P1.
  **Prüfstatus:** `OBSOLETE`, weil bereits umgesetzt.
- **Betroffene Dateien/Funktionen:**
  `lib/config/application-environment.ts` and provider/document/worker
  policies. **Tatsächlicher Ausführungspfad:** parsed `APP_ENV` → class →
  policy. **Reproduktion:** exhaustive compile/test matrix.
  **Beweise:** helper exists and named consumers use it.
- **Ursache/Blast Radius:** historical duplicated env checks; all providers.
  **Abhängigkeiten:** env schema. **Gewählte Lösung:** existing helper retain.
  **Verworfene Alternativen:** second parallel classifier or preview=local.
- **Migration/Environment:** no migration. **Erforderliche Tests:** exhaustive
  unit and boot/E2E. **E2E-ID:** `E2E-34-20`.
  **Implementierungsstatus:** already implemented; candidate regression
  pending. **Abschließende Evidence:** final boot matrix pending.
  **Verbleibendes external gate:** none.

### `P34-SEARCH-001` — materialisiertes öffentliches Read-Model

- **Ursprünglicher Vorschlag:** public search/home/counts should use a
  materialized read model. **Quelle:** A §C. **Typ:** `PROPOSAL`.
  **Kategorie:** Architecture/Performance. **Anfängliches Risiko des
  adressierten Problems:** P1. **Prüfstatus:** `UNVERIFIED` as necessary.
- **Betroffene Dateien/Funktionen:** public job/company read models, trust
  projections, workers/migrations. **Tatsächlicher Ausführungspfad:** domain
  writes → projector → materialized public row → consumers.
  **Reproduktion:** measure current query plan/load after SEARCH-001–005,
  compare consistency/latency and recovery cost. **Beweise:** smaller indexed
  aggregate/ranking changes already eliminate confirmed unbounded paths;
  materialization need not yet be justified.
- **Ursache/Blast Radius:** proposal addresses scale but adds projection drift
  risk across all public consumers. **Abhängigkeiten:** SLO/load data.
  **Gewählte Lösung:** defer until measured threshold. **Verworfene Alternativen:**
  build solely because suggested.
- **Migration/Environment:** would require additive schema/projector/worker.
  **Erforderliche Tests:** projection exactly-once/rebuild, drift, load and
  public E2E. **E2E-ID:** `E2E-34-03`, `E2E-34-11`, `E2E-34-19`.
  **Implementierungsstatus:** not implemented. **Abschließende Evidence:**
  benchmark decision pending. **Verbleibendes external gate:** SLO/capacity.

### `P34-SEC-001` — `__Host-`-Cookie-Präfix

- **Ursprünglicher Vorschlag:** session cookie should use `__Host-` prefix.
  **Quelle:** A §E. **Typ:** `PROPOSAL`. **Kategorie:** Defense in Depth.
  **Anfängliches Risiko des adressierten Problems:** P2.
  **Prüfstatus:** `UNVERIFIED` as a current vulnerability.
- **Betroffene Dateien/Funktionen:** session cookie names/set/clear/refresh,
  existing sessions and tests. **Tatsächlicher Ausführungspfad:** login → set
  secure HttpOnly SameSite=Lax Path=/ no-Domain cookie → request/refresh/logout.
  **Reproduktion:** inspect all cookie writers/readers and subdomain threat
  model. **Beweise:** current attributes already meet most `__Host-`
  requirements; no concrete exploit is reproduced.
- **Ursache/Blast Radius:** naming defense against subdomain cookie shadowing;
  session ecosystem. **Abhängigkeiten:** migration/dual-read retirement.
  **Gewählte Lösung:** retain as planned hardening, not rush into Phase-34
  candidate. **Verworfene Alternativen:** one-step rename that logs everyone
  out or leaves clear path inconsistent.
- **Migration/Environment:** cookie rollout, not DB. **Erforderliche Tests:**
  dual cookie precedence, set/refresh/logout/browser subdomain denial.
  **E2E-ID:** `E2E-34-01`, `E2E-34-05`, `E2E-34-14`.
  **Implementierungsstatus:** not implemented. **Abschließende Evidence:**
  threat decision pending. **Verbleibendes external gate:** domain/subdomain
  architecture.

### `P34-UX-001` — gemeinsamer „nicht verfügbar“-Resultattyp

- **Ursprünglicher Vorschlag:** all no-effect user actions should return a
  neutral „function unavailable“ state rather than green success.
  **Quelle:** R, Z. 181–183/209–217. **Typ:** `PROPOSAL`.
  **Kategorie:** UX Architecture. **Anfängliches Risiko:** P1.
  **Prüfstatus:** `PARTIALLY_CONFIRMED` as recurring pattern, not universal.
- **Betroffene Dateien/Funktionen:** server action result unions and feedback
  components across auth/invite/alert/billing/provider tools.
  **Tatsächlicher Ausführungspfad:** action → typed domain outcome → state-
  specific UI. **Reproduktion:** inventory success messages against durable
  side effect/delivery evidence. **Beweise:** several historical issues are
  obsolete; NOT-004/NOT-001/AI/JOBROOM show the pattern still matters.
- **Ursache/Blast Radius:** boolean success conflates accepted/queued/sent/
  unavailable across conversion paths. **Abhängigkeiten:** domain-specific
  states. **Gewählte Lösung:** adopt shared semantics where domains align,
  keep typed domain details. **Verworfene Alternativen:** one global boolean or
  blanket string replacement.
- **Migration/Environment:** none. **Erforderliche Tests:** action union unit,
  component and real flow positive/disabled/error. **E2E-ID:**
  `E2E-34-05`, `E2E-34-08`–`10`, `E2E-34-16`, `E2E-34-20`.
  **Implementierungsstatus:** applied selectively, no cross-repo abstraction.
  **Abschließende Evidence:** per-finding E2E pending.
  **Verbleibendes external gate:** none.

### `P34-COM-001` — manuelle Rechnung als erster Zahlungsnachweis

- **Ursprünglicher Vorschlag:** before self-service checkout, validate WTP via
  manually issued invoices. **Quelle:** A §I. **Typ:** `PROPOSAL`.
  **Kategorie:** Commercial Experiment. **Anfängliches Risiko:** P1 business.
  **Prüfstatus:** `UNVERIFIED`.
- **Betroffene Dateien/Funktionen:** managed sales/order/invoice/reconciliation
  paths; not the mock checkout. **Tatsächlicher Ausführungspfad:** qualified
  company → approved offer/invoice → real receipt → delivered service →
  retention/interview. **Reproduktion:** preregistered pilot with independent
  payer and accounting evidence. **Beweise:** repository can record billing,
  but no real payment/WTP evidence is present.
- **Ursache/Blast Radius:** proposal reduces premature PSP/product investment;
  affects go-to-market, not current correctness. **Abhängigkeiten:** Legal,
  Tax, Finance, privacy, service capacity. **Gewählte Lösung:** plan pilot,
  keep paid self-service off. **Verworfene Alternativen:** mock payment/seed as
  WTP evidence.
- **Migration/Environment:** none until approved; may need managed order
  workflow. **Erforderliche Tests:** finance authorization/reconciliation and
  service-delivery E2E. **E2E-ID:** `E2E-34-06`/future commercial journey.
  **Implementierungsstatus:** not activated. **Abschließende Evidence:** none.
  **Verbleibendes external gate:** customer, Legal/Tax/Finance and actual receipt.

### `P34-COM-002` — Lifecycle-Signale

- **Ursprünglicher Vorschlag:** use real lifecycle signals rather than clicks
  to evaluate demand/retention. **Quelle:** A §I. **Typ:** `PROPOSAL`.
  **Kategorie:** Analytics/Commercial. **Anfängliches Risiko:** P2.
  **Prüfstatus:** `PARTIALLY_CONFIRMED` as existing research-only capability.
- **Betroffene Dateien/Funktionen:** `lib/analytics/commercial-signals.ts`,
  lifecycle events, consent/analytics policy. **Tatsächlicher Ausführungspfad:**
  real job/payment/service lifecycle → privacy-approved aggregate → decision.
  **Reproduktion:** live provenance and denominator/retention cohort.
  **Beweise:** technical signal modules/tests exist; live independent data and
  privacy activation do not.
- **Ursache/Blast Radius:** improve decisions; risk of false analytics claims.
  **Abhängigkeiten:** consent, data provenance, minimum sample.
  **Gewählte Lösung:** keep inactive until preregistered metrics and live data.
  **Verworfene Alternativen:** demo/seed analytics as market evidence.
- **Migration/Environment:** possible analytics activation only after privacy
  approval. **Erforderliche Tests:** event provenance/deduplication/consent and
  reporting E2E. **E2E-ID:** future commercial experiment.
  **Implementierungsstatus:** research code only. **Abschließende Evidence:**
  none. **Verbleibendes external gate:** analytics consent and real cohort.

### `P34-COM-003` — Inserat-Optimierung als Dienstleistung

- **Ursprünglicher Vorschlag:** sell a managed job-ad optimization service
  before or alongside software plans. **Quelle:** A §I. **Typ:** `PROPOSAL`.
  **Kategorie:** Product/Service. **Anfängliches Risiko:** P2 business/legal.
  **Prüfstatus:** `UNVERIFIED`.
- **Betroffene Dateien/Funktionen:** managed import/service delivery, job
  editor/moderation, billing. **Tatsächlicher Ausführungspfad:** customer order
  → scoped content work → approval → delivery/evidence. **Reproduktion:**
  manual pilot measuring conversion and effort. **Beweise:** supporting
  modules may exist; no WTP, capacity, terms or outcome evidence.
- **Ursache/Blast Radius:** proposal seeks early revenue; could create labor,
  moderation and liability obligations. **Abhängigkeiten:** service owner,
  terms, pricing, capacity. **Gewählte Lösung:** decision-ready pilot only.
  **Verworfene Alternatives:** silently auto-enable AI/managed edits.
- **Migration/Environment:** none before approval. **Erforderliche Tests:**
  ownership/approval, immutable revisions, billing/delivery E2E.
  **E2E-ID:** future managed-service journey.
  **Implementierungsstatus:** not activated. **Abschließende Evidence:** none.
  **Verbleibendes external gate:** product/legal/capacity/customer.

### `P34-COM-004` — Preisleiter Starter/Pro

- **Ursprünglicher Vorschlag:** the price/feature jump between Starter and Pro
  may be too large and should be changed. **Quelle:** A §I. **Typ:**
  `PROPOSAL`. **Kategorie:** Pricing. **Anfängliches Risiko:** P1 business.
  **Prüfstatus:** `UNVERIFIED`.
- **Betroffene Dateien/Funktionen:** public catalog, pricing page, entitlements,
  grandfathering, billing. **Tatsächlicher Ausführungspfad:** offer exposure →
  checkout → usage/renewal/churn. **Reproduktion:** preregistered price test or
  sales evidence, not internal opinion. **Beweise:** current price math/limits
  exist; no statistically/qualitatively sufficient live WTP evidence.
- **Ursache/Blast Radius:** pricing hypothesis; could alter revenue and
  existing contracts. **Abhängigkeiten:** real customers, unit economics.
  **Gewählte Lösung:** do not change catalog in Phase 34; prepare experiment.
  **Verworfene Alternatives:** arbitrary midpoint tier or underpricing based
  on competitor list prices alone.
- **Migration/Environment:** catalog version migration only after decision.
  **Erforderliche Tests:** catalog lifecycle/grandfathering, checkout/invoice/
  entitlement E2E. **E2E-ID:** `E2E-34-06`, `E2E-34-07` after approval.
  **Implementierungsstatus:** no change. **Abschließende Evidence:** none.
  **Verbleibendes external gate:** Commercial/Finance approval and WTP.

### `P34-COM-005` — Kontaktpakete

- **Ursprünglicher Vorschlag:** sell separate Talent-Radar contact packages.
  **Quelle:** A §I. **Typ:** `PROPOSAL`. **Kategorie:** Monetization/AVG.
  **Anfängliches Risiko:** P0 legal. **Prüfstatus:** `UNVERIFIED` and
  activation blocked.
- **Betroffene Dateien/Funktionen:** contact credits, orders/entitlements,
  Radar contact/reveal, pricing. **Tatsächlicher Ausführungspfad:** purchase →
  credit → request → candidate consent → reveal/refund/revoke.
  **Reproduktion:** only after legal decision, sandbox payment and candidate
  consent E2E. **Beweise:** technical credits exist; AVG classification and
  WTP do not.
- **Ursache/Blast Radius:** monetization idea touches regulated mediation and
  candidate privacy. **Abhängigkeiten:** LEG-002/006, PAY gates.
  **Gewählte Lösung:** keep off; decision-ready contract.
  **Verworfene Alternatives:** enable because code/tests exist.
- **Migration/Environment:** activation ledger/catalog after approval.
  **Erforderliche Tests:** payment→credit→contact→reveal/refund positive and
  revoke/denial E2E. **E2E-ID:** `E2E-34-06`, `E2E-34-10`,
  `E2E-34-11`. **Implementierungsstatus:** inactive.
  **Abschließende Evidence:** none. **Verbleibendes external gate:** AVG/
  consent, pricing, PSP, WTP.

### `P34-COM-006` — Rechnungsprofil als Checkout-Abbruch

- **Ursprünglicher Vorschlag:** requiring a billing profile before checkout
  may cause abandonment. **Quelle:** A §I. **Typ:** `PROPOSAL`.
  **Kategorie:** Conversion/Compliance. **Anfängliches Risiko:** P2.
  **Prüfstatus:** `UNVERIFIED`.
- **Betroffene Dateien/Funktionen:** billing profile, checkout eligibility/UI,
  invoice requirements. **Tatsächlicher Ausführungspfad:** checkout CTA →
  missing profile → profile completion → order. **Reproduktion:** real funnel
  with consent-safe event denominator and user research. **Beweise:** technical
  precondition exists; no current live abandonment evidence.
- **Ursache/Blast Radius:** hypothesis about friction; removing fields may
  break invoice/tax duties. **Abhängigkeiten:** Tax/Finance requirements.
  **Gewählte Lösung:** measure and simplify copy/order only after compliance
  decision. **Verworfene Alternatives:** remove required invoice data blindly.
- **Migration/Environment:** none before decision. **Erforderliche Tests:**
  profile validation, checkout resume and invoice E2E.
  **E2E-ID:** `E2E-34-06`, `E2E-34-07` after approval.
  **Implementierungsstatus:** no change. **Abschließende Evidence:** none.
  **Verbleibendes external gate:** Finance/Tax and real funnel data.

### `P34-COM-007` — Talent-Radar-Monetarisierung

- **Ursprünglicher Vorschlag:** make Talent Radar the central defensible paid
  asset. **Quelle:** A §I; broader review framing. **Typ:** `PROPOSAL`.
  **Kategorie:** Strategy/Legal. **Anfängliches Risiko:** P0 legal/product.
  **Prüfstatus:** `UNVERIFIED`.
- **Betroffene Dateien/Funktionen:** radar cohort/contact/reveal/messaging,
  commercial gates/catalog. **Tatsächlicher Ausführungspfad:** employer value
  proposition → access/payment → anonymous discovery → consented contact.
  **Reproduktion:** legal clearance plus moderated employer/candidate pilot
  measuring value, safety and consent withdrawal. **Beweise:** anonymity is
  strong, but legal/runtime gate and WTP remain unresolved.
- **Ursache/Blast Radius:** strategic recommendation, not code defect; affects
  core marketplace trust. **Abhängigkeiten:** LEG-002/004/006, PAY/WTP.
  **Gewählte Lösung:** keep fail-closed and run staged research after approval.
  **Verworfene Alternatives:** paid launch from mock data.
- **Migration/Environment:** no activation. **Erforderliche Tests:** full
  payment/radar/revoke/privacy E2E. **E2E-ID:** `E2E-34-06`,
  `E2E-34-10`, `E2E-34-11`, `E2E-34-14`.
  **Implementierungsstatus:** inactive. **Abschließende Evidence:** none.
  **Verbleibendes external gate:** AVG/legal/privacy/WTP/customer research.

### `P34-COM-008` — Kosten-, Burn- und Mittelabflussannahmen

- **Ursprünglicher Vorschlag:** validate cashflow/break-even assumptions and
  real provider/worker/support costs before scaling. **Quelle:** A §I.
  **Typ:** `PROPOSAL`. **Kategorie:** Finance/Strategy.
  **Anfängliches Risiko:** P1 business. **Prüfstatus:** `UNVERIFIED`.
- **Betroffene Dateien/Funktionen:** `lib/commercial/cashflow.ts`, capacity
  models, Commercial Evidence; external budget. **Tatsächlicher Ausführungspfad:**
  assumptions → scenario → actual receipts/costs → decision.
  **Reproduktion:** owner-approved assumptions with source/date and sensitivity
  bands; later actuals reconciliation. **Beweise:** calculation modules/tests
  are decision support, not audited business truth.
- **Ursache/Blast Radius:** model inputs may be arbitrary; runway/pricing.
  **Abhängigkeiten:** Finance, provider quotes, salary/support plan.
  **Gewählte Lösung:** version sources and run scenarios; no runtime activation.
  **Verworfene Alternatives:** hardcoded best case as forecast.
- **Migration/Environment:** none. **Erforderliche Tests:** deterministic model
  unit/contract; no product E2E until an offer is activated.
  **E2E-ID:** future commercial evidence. **Implementierungsstatus:** research
  only. **Abschließende Evidence:** none. **Verbleibendes external gate:**
  Finance-approved assumptions and actuals.

### `P34-ROADMAP-001` — empfohlene Umsetzungsreihenfolge

- **Ursprünglicher Vorschlag:** first honest no-effect states, then proxy/
  rate-limit/MFA, then load; pursue legal texts/SECO in parallel.
  **Quelle:** R, Z. 209–217. **Typ:** `PROPOSAL`. **Kategorie:** Delivery Plan.
  **Anfängliches Risiko des falschen Reihenfolgens:** P1.
  **Prüfstatus:** `PARTIALLY_CONFIRMED`.
- **Betroffene Dateien/Funktionen:** all Phase-34 tracks. **Tatsächlicher Ausführungspfad:**
  remediation sequencing, not runtime. **Reproduktion:**
  compare dependencies/severity and E2E stop rule. **Beweise:** recommendation
  correctly prioritizes user truth and security, but Phase-34 Auftrag gives
  payment/trust/env first and forbids moving to independent package while E2E
  red; several review items are already obsolete.
- **Ursache/Blast Radius:** useful heuristic based on older tree; following it
  literally could duplicate fixes or bypass mandated sequence.
  **Abhängigkeiten:** verified register. **Gewählte Lösung:** use Auftrag's
  dependency order and this proposal only where compatible.
  **Verworfene Alternatives:** execute review order without verification.
- **Migration/Environment:** none. **Erforderliche Tests:** plan audit and
  per-package E2E. **E2E-ID:** all applicable scenarios.
  **Implementierungsstatus:** incorporated selectively. **Abschließende Evidence:**
  final plan/evidence pending. **Verbleibendes external gate:**
  Legal workstream owners.

## 12. Mindestumfang des Auftrags — Traceability

Die Tabelle verhindert, dass ein Pflichtpunkt still aus dem Register fällt.
Sie ersetzt nicht die Detailrecords.

| Auftragbereich                                                                                                   | Abgedeckte Records                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A — Inventare, Ledger, ADR-007, Commercial imports, `.vercel`, Phasen 32/33                                      | `BASE-001`, `GOV-004`–`008`, `REPO-001`, `COM-001`                                   |
| A — Minderjährige, Stellenmeldepflicht, Company Closed, WCAG, Moderation, Legal/Tax/Ops                          | `LEG-003`–`008`, `TAX-001`, `COMPANY-001`, `A11Y-001`, `OPS-008`–`010`               |
| B — Mock checkout/provider, composition, finance separation, activation, idempotency, sandbox, entitlement       | `PAY-002`–`009`, `NOT-001`, `AI-001`, `JOBROOM-001`                                  |
| C — Trust, mismatch, expiry, boundaries, home scale/pool/index/count/timeout/dynamic/models/read-model           | `ARCH-001`, `SEARCH-001`–`010`, `DATA-001`, `P34-SEARCH-001`                         |
| D — Docker/PG16, Vercel/Supabase, worker/scheduler/outbox/scans/retention/migration/health/monitoring/backup     | `OPS-002`–`015`, `DOC-001`, `MIG-001`                                                |
| E — Account/IP/reset limits, proxy/XFF, audit, application abuse, cookies, CSP, IDOR/RBAC/CSRF/webhooks/secrets  | `SEC-001`–`013`, `P34-SEC-001`                                                       |
| F — Registration, verification, application, publish/payment/radar/team/reset/invite and truthful delivery       | `LEG-001`–`002`, `FLOW-001`–`003`, `PRIV-001`, `NOT-001`–`005`, `AUTH-001`, `QA-003` |
| G — de-CH labels/codes, internal copy, drafts, responsive/a11y/states, canonical/noindex/sitemap/robots          | `UX-001`–`004`, `SEARCH-009`, `SEO-001`, `AI-001`, `JOBROOM-001`                     |
| H — dynamic counts/skips/retries/current evidence/Preview/prod-like/PG target/allowed state                      | `QA-001`–`012`, `SUPPLY-001`, `BASE-001`, `OPS-010`–`011`, `OPS-015`                 |
| I — inactive products, WTP/manual invoice, signals, service, tiers, contacts, checkout friction, radar, cashflow | `COM-001`, `PAY-008`, `P34-COM-001`–`008`                                            |

## 13. Externe Gates und sichere Zwischenzustände

Diese Gates dürfen nur mit echter, datierter Evidence wechseln. Lokale
Contract-, Mock- oder Sandbox-Tests ersetzen sie nicht.

| Gate                                                                              | Owner/Eingang                                                                  | Abnahmekriterium                                                                                                       | Sicherer Zwischenzustand                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| AVG/AVV und Bewilligung für Jobboard, Radar, Contact/Reveal/Messaging und Entgelt | Sitzkanton/SECO und Schweizer Counsel; konkreter Flow, Entgelt und Zielkantone | schriftlicher datierter Entscheid, ggf. Bewilligungsnummer/Geltungsbereich; technisch an `ProcessingApproval` gebunden | Radar prod-like list/contact/reveal/message und Success Fee aus; Decline/Cancel/Revoke verfügbar |
| Stellenmeldepflicht/Job-Room                                                      | arbeit.swiss/SECO, aktuelle Berufsliste, Schnittstellenvertrag                 | offizieller positiver und negativer Contractfall inkl. bestätigtem Start der Sperrfrist                                | Mock nur Local/CI, Production-like Publish fail-closed wo Entscheidung nötig                     |
| Minderjährige/Lehrstellen                                                         | Legal/Privacy/Product                                                          | freigegebene Alters-, Consent-, Guardian-, Profiling-, Dokument- und Retentionpolicy                                   | betroffene aktivierte Flows gesperrt oder auf freigegebene Volljährige begrenzt                  |
| DSG/Privacy, DSFA, DPA, Transfers und Retention                                   | Legal-/Privacy-Owner, Providerverträge/Regionen                                | datierte Zweck-/Daten-/Empfänger-/Fristenmatrix, DSFA-Entscheid, DPA/Transferbasis                                     | Live Provider und unbelegte/destruktive Production-Prozesse aus                                  |
| Legal Publications/Impressum/AGB/UWG/PBV                                          | Schweizer Counsel und Product Owner                                            | freigegebene aktuelle de-CH Publikationen, Bestell-/Consent-Evidence und Zielgruppenentscheid                          | Registrierung/Public Intake/Checkout dort fail-closed; keine Platzhalter als Zustimmung          |
| Tax/Finance/PSP/Reconciliation                                                    | Finance/Tax/Treuhand/PSP                                                       | MWST-/Steuerpflicht, Rechnungs-/Buchungsvertrag, Sandbox-E2E und unabhängiger Reconciliation-Pass                      | Paid Self-Service und Live PSP aus; Mock/Contract klar isoliert                                  |
| Real WTP/Pricing/Commercial                                                       | unabhängige zahlende Kundschaft und Commercial Owner                           | vorregistrierte Messung, realer Receipt plus nachweisliche Leistung und Follow-up                                      | keine Preis-/Produktaktivierung aus Seed, Clicks oder Mockzahlungen                              |
| Hosting/Deployment/Staging                                                        | Platform Owner, Vercel/Workerhost/Supabase                                     | migrate-before-traffic, app+worker+scheduler boot, health probes, smoke URL, target PG/extension/pooler evidence       | keine Production-Aktivierung                                                                     |
| Monitoring/Pager/SLO/On-call                                                      | Operations/Security Owner                                                      | synthetic failure → redigiertes event → alert → datierter receipt/ack; SLO und escalation owner                        | `NO_GO`, lokale structured events/health only                                                    |
| Backup/Restore/RPO/RTO                                                            | Data/Operations Owner                                                          | unabhängiger Restore auf separater DB, migrate, app+worker boot, critical smoke within approved RPO/RTO                | keine Productiondaten/kein Go-live                                                               |
| Live E-Mail/Storage/Scanner/AI und Provider-DPAs                                  | Provider-/Privacy-/Security Owner                                              | contract + revocation + failure/retry E2E, real test recipient/object, DPA/region and approval                         | Local/CI mocks; prod-like disabled/fail-closed                                                   |
| Accessibility und Content/Research                                                | Accessibility, Content, T&S, Research Owner                                    | NVDA/VoiceOver, WCAG 2.2 AA review, moderated users and approved policy corpus                                         | keine Konformitäts-/Marktbehauptung; unapproved clusters/claims off or noindex                   |

## 14. Aktuelles Gesamturteil dieses Registers

Das Register umfasst 106 Finding-Records; die getrennten `P34-*`-Vorschläge
aus Abschnitt 11 zählen nicht zu dieser Verteilung.

| Anfängliche Severity | Anzahl |
| -------------------- | -----: |
| P0                   |     39 |
| P1                   |     55 |
| P2                   |     12 |
| **Gesamt**           | **106** |

| Prüfstatus                    | Anzahl |
| ----------------------------- | -----: |
| `FIXED`                       |     61 |
| `FALSE_POSITIVE`              |     14 |
| `OBSOLETE`                    |     17 |
| `DUPLICATE`                   |      2 |
| `BLOCKED_EXTERNAL`            |     12 |
| `BLOCKED_E2E`                 |      0 |
| `CONFIRMED`                   |      0 |
| `PARTIALLY_CONFIRMED`         |      0 |
| `IMPLEMENTED_E2E_PENDING`     |      0 |
| `UNVERIFIED`                  |      0 |
| **Gesamt**                    | **106** |

**Technisches Urteil: `GO`; Aktivierungsurteil: `NO_GO`.** Der ausführbare
Candidate bestand die vollständige Unit-Suite, Integration 756/756, das
allgemeine Browsergate 354/354, `phase33:e2e` 9/9 und das Digest-gebundene
Phase-34-Browsergate 51/51 in Chromium, Firefox, WebKit und einem isolierten
Chromium-Trust-Sandbox-Projekt. Der Digest lautet
`a3a28db00a2f46a0121d77f73125aefb4f9a9b3429ec0f6a09aabaf812d8526a`.
Damit sind sämtliche repository-internen P0/P1-Defekte geschlossen; 18 der
20 übergreifenden Reisen sind im ausführbaren Scope `COVERED`.

Bewusst offen bleiben ausschließlich zwölf echte externe Legal-/Privacy-/
Tax-/Accessibility-/Payment-/Operations-/Staging-Gates, darunter die beiden
realen PSP-Reisen `E2E-34-06` und `E2E-34-07`. Sie sind mit Owner,
Abnahmeevidence und fail-closed Zwischenzustand als `BLOCKED_EXTERNAL`
klassifiziert. Das technische `GO` aktiviert daher weder Productiontraffic
noch einen Provider und ist kein `GO_LIVE_APPROVED`; maßgeblich ist der
[Phase-34-Abschlussrecord](./evidence/2026-08-07-phase-34.md).

# Remediation-Ausführungs-, Test- und Evidence-Vertrag

> **Normativer Planungsstand: 26. Juli 2026.** Dieses Dokument gilt für alle
> offenen Phasen ab 19. Es implementiert keinen Produktcode, ersetzt keine
> historische Evidence der Phasen 01–18 und erteilt keine LIVE-Freigabe. Bei
> Widersprüchen gilt die Präzedenz aus [`00-PLAN.md`](./00-PLAN.md). Die
> phasenspezifische Detaildatei darf diesen Mindestvertrag verschärfen, aber
> nicht abschwächen.

## 1. Geprüfte Planungsbaseline und historische Grenze

| Feld                             | Wert                                             |
| -------------------------------- | ------------------------------------------------ |
| Repository                       | `carosellagiuliano-max/PortalGERM`               |
| geprüfter Branch                 | `codex/phase-18-release-audit`                   |
| geprüfter Planungscommit         | `e34262e3074565840e371c336a5d2ba5cf3efbac`       |
| `origin/main` bei Prüfungsbeginn | `e34262e3074565840e371c336a5d2ba5cf3efbac`       |
| Arbeitsbaum bei Prüfungsbeginn   | sauber                                           |
| Auftragsscope                    | ausschliesslich Planung/Governance für Phase 19+ |

Der Commit `eb9b45a` bleibt die unveränderliche Identität der früheren
Remediation-Analyse. `e34262e` ist die aktuelle Planungsbaseline und enthält
bereits die Remediation-Dokumente, `.claude/launch.json` sowie
`components/layout/brand-link.tsx`. Keiner dieser Commits besitzt automatisch
einen neuen vollständigen Golden Run. Phase 19 wählt bei ihrem tatsächlichen
Start den dann aktuellen, sauberen `main`-Commit, friert ihn als
**Implementierungsbaseline** ein und führt alle vorgeschriebenen Tests neu auf
genau diesem Commit aus.

Die datierten Evidence-Records der Phasen 01–18 bleiben wahr für ihre jeweils
genannten unveränderlichen Commits. Sie sind Regressionsevidence, aber kein
Pass für einen späteren Commit.

## 2. Sechs Launchklassen

Jede Priorität und jedes Gate ist gegen eine konkrete Launchklasse zu lesen.
Eine höhere Klasse erbt alle Sicherheits-, Datenschutz-, Tenant-, Rechts- und
Evidence-Garantien der niedrigeren Klassen.

| Code | Launchklasse                        | Zulässiger Umfang                                                       | Mindestgrenze                                                                                                                   |
| ---- | ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| LC1  | lokaler Demo-MVP                    | Fixtures, lokale Mocks, keine echten Personen- oder Zahlungsdaten       | Production-Demo-Guard, klare Mock-Copy, reproduzierbare lokale Tests                                                            |
| LC2  | beaufsichtigter Design-Partner-Test | kleine benannte Kohorte, Operator kontrolliert jeden kritischen Schritt | flowspezifische Legal-/Privacy-/AVG-/Tax-Freigabe, Incident Owner, reale Einwilligung, sichere manuelle Fallbacks               |
| LC3  | Invite-only Pilot                   | echte Nutzer in geschlossenem, begrenztem Cluster                       | produktive Provider für den Scope, getestete Kernworker oder ausdrücklich beaufsichtigte Ausnahmen, Trust-/Fraud-/Support-Gates |
| LC4  | öffentlicher kostenloser Launch     | öffentlicher Self-Service ohne Zahlung                                  | autonome Kernprozesse, bestandene Cluster-/Search-/Freshness-/Trust-Gates, alle Kaufpfade fail-closed                           |
| LC5  | bezahlter Self-Service              | öffentlicher Geldfluss und selbstbediente bezahlte Leistungen           | WTP-Go, Payment/Finance, Refund-/Service-Recovery, Reconciliation, Dunning, Tax/Legal und Paid-Support                          |
| LC6  | skalierter Produktionsbetrieb       | dauerhaftes Angebot mit wachsendem Volumen                              | SLO/RPO/RTO, On-call, Kapazitäts-/Lastnachweis, Trigger-Scale-Tracks, laufende Compliance und Incident-Übungen                  |

Prioritäten bedeuten je Launchklasse:

- **P0:** blockiert technische Aktivierung oder LIVE-Freigabe dieser Klasse;
- **P1:** nächster kritischer Lieferumfang; darf nur mit dokumentierter,
  zeitlich begrenzter und nicht sicherheitskritischer Mitigation verschoben
  werden;
- **P2:** wichtig nach dem Launchkern oder nur für einen optionalen Teilflow;
- **P3:** beobachtete, triggerbasierte Vorsorge mit Istwert, Headroom, Forecast,
  Owner, Alert und Runbook;
- **P4:** optional/deferred; kein CTA, keine Route und keine Produktbehauptung,
  solange kein neuer Bedarfsgate bestanden ist.

Ein Feature darf einen P0-Blocker nur vermeiden, indem der gesamte betroffene
Flow serverseitig deaktiviert und in Navigation, Marketing, API und Worker
ehrlich nicht verfügbar ist. Ein versteckter Button ist kein Gate.

## 3. Phasenstatus und getrennte Freigaben

Jede Phase führt vier voneinander unabhängige Zustände:

1. **Planstatus:** `GEPLANT`, `BEGONNEN` oder `DEFERRED`;
2. **Technikstatus:** `NICHT IMPLEMENTIERT` oder `TECHNISCH ABGESCHLOSSEN`;
3. **Quality-Gate:** `NICHT GELAUFEN`, `ROT` oder `BESTANDEN`;
4. **Aktivierung:** `DISABLED`, `SANDBOX`, `ALLOWLIST`, `LIVE` oder
   `BLOCKED BY EXTERNAL GATE`.

`TECHNISCH ABGESCHLOSSEN` setzt vollständige Implementierung und Migration
voraus. `BESTANDEN` setzt die phasenspezifische Testmatrix auf demselben
unveränderlichen Commit voraus. `LIVE` setzt zusätzlich alle
launchklassenspezifischen externen Freigaben, Smoke-Tests und einen
dokumentierten Go-Entscheid voraus. Ein fehlendes externes Gate darf einen
technisch getesteten Sandbox-Stand nicht als LIVE ausgeben.

Phase 33 ergänzt zwei zulässige technische Zwischenurteile:
`TECHNICALLY_READY_FOR_LC4` und
`TECHNICALLY_READY_FOR_LC5_CONFIGURATION`. Beide setzen den vollständigen
Phase-33-Repository-, Production-Contract-, Provider-, Worker-, E2E- und
Artefaktvertrag voraus, erteilen aber keine Aktivierung. Ohne sämtliche reale
zielklassengültige External-/Approval-Evidence bleibt die vierte Dimension
exakt `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`; das historische
Phase-32-`NO_GO` wird nicht rückwirkend umgeschrieben. Während der Umsetzung
verwendet Phase 33 nach dem Abschluss das eindeutige Statusquartett Plan
`COMPLETED`, Technik `TECHNICALLY_READY_FOR_LC4` und
`TECHNICALLY_READY_FOR_LC5_CONFIGURATION`, Quality `PASSED` und Aktivierung
`ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`. Der exact-candidate-G4 ist in der
[Phase-33-Evidence](./evidence/2026-08-05-phase-33.md) gebunden.

Der Phase-33-Notificationvertrag ist Bestandteil dieses G4: getrennte
`NOTIFICATION_DELIVERY_KEYS` (AES) und
`NOTIFICATION_RECIPIENT_HASH_KEYS` (HMAC), unabhängige
`RESEND_SECRET_VERSION`/`RESEND_WEBHOOK_SECRET_VERSION`, vollständiges
Key-Version-Inventar, zeilengebundene AES-v2-Empfänger-Evidence normal 23 h
und maximal 31 d, minutenbasierte providerunabhängige Maintenance sowie exakt
`400 × 24 h` bis zur irreversiblen Attempt-PII/Receipt/Digest-Kompaktion bei
erhaltener nicht-PII Auditkette. Unknown Outcomes (network, 408/5xx,
malformed/oversized 2xx, concurrent idempotency) erhalten bounded Same-Key-
Retry und danach `PAUSED`/manuelle Reconciliation, nie Blind-Resend oder
blindes Dead Letter. Webhooks sperren die exakte Activation im selben TX;
Inbox/Suppression bleiben append-only/monoton.

## 4. Pflichtaufbau jeder offenen Phase

Jede Detailphase 19–33 muss in ihrer eigenen Datei phasenspezifisch alle
folgenden Punkte ausweisen:

1. Status in den vier Dimensionen aus Abschnitt 3.
2. Ziel und messbarer Business-/Nutzerwert.
3. tatsächlicher Repositoryzustand mit Code-, Schema-, Test- und Planfundstellen.
4. zugeordnete `STH-*`-Findings und `REQ-*`-Anforderungen.
5. In Scope.
6. Out of Scope und serverseitig deaktivierte Nachbarfunktionen.
7. Benutzerrollen und organisatorische Owner.
8. Portale, vorhandene/geplante Routen, Services, Provider und Worker.
9. Datenmodelle, Constraints, Indizes und Datenklassifikation.
10. Expand–Migrate–Contract, Backfill, Kompatibilität und Datenprüfung.
11. Serverlogik, Queue-/Lease-/Retry-/Idempotenz- und Providervertrag.
12. Loading, Empty, Locked, Pending, Error, Retry, Conflict, Expired,
    Cancelled und Success.
13. 360-px-/Touch-/Keyboard-/Screenreader- und Accessibility-Vertrag.
14. Authentisierung, Step-up, Autorisierung, Ownership, Assignment,
    Capability und Tenantgrenze.
15. Datenschutz, Zweck, Minimierung, Retention, Export, Löschung und Audit.
16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien.
17. externe/organisatorische Voraussetzungen mit Owner und Frist/Gate.
18. harte Implementierungs- und Aktivierungsabhängigkeiten.
19. geordnete, einzeln integrierbare Implementierungsschritte.
20. Feature-/Provider-/Cohort-Flag, Kill Switch und Aktivierungsreihenfolge.
21. Akzeptanzkriterien und vollständige Testmatrix.
22. Performance-, Query-, Queue-, Datei-, Latenz- und Lastgrenzen.
23. geschützte Phase-01–18-Invarianten und Owning-Regressionen.
24. Rollback oder begründetes Roll-forward-only.
25. benötigte Evidence und Artefakte.
26. Definition of Done für Technik und Quality-Gate.
27. Bedingung, bevor eine abhängige Folgephase integriert oder aktiviert wird.
28. ausdrücklich nicht bewiesene Aussagen.

Ein Link in dieses Dokument darf gemeinsame Regeln übernehmen. Rollen,
Risiken, Daten, Akzeptanzkriterien, Tests, Passschwellen, externe Gates und
Folgefreigabe bleiben jedoch in der jeweiligen Phase konkret.

## 5. Testzeitpunkte

### Vor der Implementierung

- sauberen Startcommit und Remote-Identität erfassen;
- Baseline-Gate auf exakt diesem Commit ausführen;
- bekannte Vorfehler mit Testname, Resultat und Owner dokumentieren;
- geschützte Invarianten und Owning-Suites auswählen;
- geplante Migration auf leere und realistische Bestandsdaten entwerfen;
- keine neue Fachänderung beginnen, solange Phase 19 rot ist.

### Während der Implementierung

- Happy Path, Negativ-/Abuse-Fall und Persistenz-/Rollback-Fall gemeinsam
  liefern;
- Migration und Backfill vor UI-Aktivierung testen;
- additive Writes vor Dual-Read/Read-Cutover, Contract zuletzt;
- keine ungezielten Cross-Domain-Refactorings oder Sammel-Commits;
- jeder Provider-/Workerpfad erhält Timeout, Retry, Duplicate Delivery,
  Poison Message und Recovery-Tests.

### Technischer Abschluss

- jede Zeile der phasenspezifischen Akzeptanzmatrix ist grün oder begründet
  `N/A`;
- Lint, Typecheck, Production-Build, owning Unit-/PostgreSQL-/E2E-Suites,
  Security/Tenant und notwendige Golden Runs laufen auf demselben Commit;
- keine `.only`, `.skip`, Quarantäne, Retry oder blind aktualisierte Snapshots;
- Evidence nennt Start-/Endcommit, Umgebung, Befehle, Exit Codes,
  Discover/Pass/Fail/Skip/Retry, Rollen, Datenzustände und Limitationen.

### Nach Aktivierung

- deploytes Artefakt/Digest entspricht dem getesteten Artefakt;
- Allowlist- und später LIVE-Smoke, Queue-/DLQ-/Provider-/Error-Rate-Check;
- Baseline-/KPI-Vergleich ohne Demo-Daten;
- Kill-Switch-/Rollbackprobe und dokumentierter Go/No-go-Entscheid.

## 6. Reproduzierbare Befehle

Die folgenden Befehle sind die aktuelle reale Testoberfläche. Eine Phase darf
neue Skripte ergänzen, muss sie aber vor Verwendung implementieren,
dokumentieren und in CI verdrahten.

### Repository- und Plan-Preflight

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/main
npm ci
npm run env:validate
npm run db:generate
npm run db:validate
npm run plan:audit
npm run route:audit
npm run security:release-scan
npm run license:audit
```

### Gezielte Tests

```powershell
npx vitest run --config vitest.config.ts tests/unit/<owning-test>.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/<owning-test>-postgres.test.ts
npx playwright test --config=playwright.config.ts tests/e2e/flows/<owning-flow>.spec.ts --project=chromium-journeys
npx playwright test --config=playwright.config.ts tests/e2e/quality/<owning-quality>.spec.ts --project=chromium-mobile-360
```

Die Platzhalter werden in jeder Phase durch geplante, konkrete Testdateien
ersetzt. Ein Testpfad darf erst als Evidence verwendet werden, nachdem die
Datei existiert und der Befehl Exit Code `0` liefert.

### Vollständiges Repository-Gate

```powershell
npm run lint
npm run typecheck
npm test
npm run db:migrate
npm run db:migrate:status
npm run db:seed
npm run db:seed
npm run seed:verify
npm run db:smoke
npm run test:integration
npm run build
npm run test:e2e:http
npm run test:e2e:browser
npm run test:e2e:hsts
```

### Release-/Recovery-Gate

```powershell
npm run test:release
```

Phase 33 stellt einen eigenen unveränderten Abschlusslauf bereit:

```powershell
npm run test:phase33
```

Dieser Command orchestriert 38 fest definierte technische Prüfungen für
LC4-/LC5-Konfigurationsreadiness, darunter Migration, Config, Provider,
Worker, Route/Rolle, E2E und Standalone-/OCI-Runtime. Das daraus erzeugte
Testreport wird anschließend durch `npm run phase33:manifest` an den Candidate
und seine Artefaktdigests gebunden; `npm run phase33:release:technical` und das
getrennte External-Gate-Ledger liefern zwei unterschiedliche Urteile. Der
Vertrag darf den Phase-32-Orchestrator nicht abschwächen oder Contract-Stubs
als Productionreceipts ausgeben.

Der Release-Drill benötigt ausdrücklich isolierte Source-, Restore- und
Production-Guard-Datenbanken sowie extern bereitgestellte Age-Secrets. Er
darf nicht gegen eine persönliche oder gemeinsame Datenbank laufen.

## 7. Gate-Stufen und Golden Runs

| Gate              | Inhalt                                                                                                                                                                                                         | Mindestanwendung                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| G0 Plan           | Plan-/Link-/Route-/Traceability-Audits, Diff- und Invariantenprüfung                                                                                                                                           | Planänderungen und Phase 19                                                                                      |
| G1 Owning         | gezielte Unit-, PostgreSQL-, Contract-, Rolle-/Tenant- und E2E-Tests plus Lint/Typecheck/Build                                                                                                                 | jede Phase                                                                                                       |
| G2 Track          | vollständige Unit-/Integration-Suite und betroffene Browser-/Mobile-/A11y-Flows                                                                                                                                | Abschluss eines Teiltracks                                                                                       |
| G3 Portal-Golden  | vollständiges Repository-Gate, E2E-01–07, Security/Provider/Worker-Failure                                                                                                                                     | Auth/RBAC, grosse Migration, Privacy, Payment, Worker, Trust, Search-Cutover sowie Ende zusammenhängender Tracks |
| G4 Release-Golden | G3 plus clean clone, Migration/Seed, Backup/Restore, deploytes Artefakt, Vier-Rollen-/Mobile-/AT-Walkthrough; Phase 33 ergänzt Production-Contract-, Provider-/Worker-/Config- und technische LC4-/LC5-Digests | vor LC4, LC5, LC6, Phase 32 und Phase 33                                                                         |

G3 ist zwingend nach Phase 20, 22, 23, 25, 26, 27, 30A/30B und 24 bei
Paid-Scope. Phase 21 benötigt G3, wenn interne Bewerbungen auf reale
Dokumentbytes umgestellt werden. Phase 27 benötigt wegen der ausdrücklichen
technischen Owner-Aktivierung ein lokales G3; Demand-/Kohortenaktivierung
benötigt erneut aktuelle zielklassengültige Evidence. Die optionalen
Phase-28-Tracks benötigen G3 nur bei tatsächlicher Aktivierung. Phase 32
besitzt den historischen launchklassenspezifischen G4-Vertrag. Phase 33
besitzt einen neuen technischen G4-Candidate; ein grüner Contractlauf ersetzt
weder reales Staging noch Provider-, Legal-, Operations- oder
Production-Approval-Evidence.

## 8. Akzeptanz-zu-Test-Matrix

Jede Phase verwendet mindestens diese Spalten:

| Feld               | Pflichtinhalt                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------- |
| AC/Requirement     | eindeutige Criterion-/`REQ-*`-/`STH-*`-ID                                                     |
| Risiko             | fachlicher Schaden und P0–P4 je relevanter Launchklasse                                       |
| Testart            | Unit, PostgreSQL, Contract, Provider, E2E, Security, Last oder manuell                        |
| Testfall           | konkrete fachliche Reise, Transition, Migration oder Failure-Injektion                        |
| Positiv            | erlaubter Erfolg                                                                              |
| Negativ/Abuse      | verbotener, fehlerhafter, konkurrierender oder missbräuchlicher Fall                          |
| Rolle              | konkreter Actor                                                                               |
| Portal/System      | konkrete Oberfläche, API, Queue, Provider oder Datenbank                                      |
| Testdaten          | konkrete Fixture, Bestandszustand, Tenant-/Canary- und Failure-Daten                          |
| Umgebung           | lokale/CI-PostgreSQL-Instanz, Sandbox/Staging/LIVE-Konsole, Browser/Viewport                  |
| Befehl/Ablauf      | existierender oder in der Phase anzulegender exakter Pfad                                     |
| Erwartung/Schwelle | erwarteter Zustand **und** numerische/objektive Pass-/Fail-Schwelle; nicht nur „funktioniert“ |
| Evidence           | Report/Manifest/Screenshot/Query Plan/Provider Receipt ohne Secrets                           |
| Owner              | Engineering plus Fach-/Security-/Ops-Owner, soweit nötig                                      |
| Status             | `PLANNED`, `PASS`, `FAIL`, `N/A` mit Begründung                                               |

Ein Akzeptanzkriterium ohne Matrixzeile blockiert das Quality-Gate. Mehrere
Tests dürfen ein Kriterium belegen; ein Test darf mehrere Kriterien nur dann
abdecken, wenn jede Assertion und jeder Negativfall eindeutig zuordenbar ist.

## 9. Migrations- und Backfill-Gate

Bei Schema- oder Datenänderungen prüft die Phase:

1. leere Datenbank mit vollständigem `migrate deploy`;
2. realistische Kopie/Fixture des bisherigen Schemas und aller relevanten
   Status-/Null-/Tenant-/Provenienzfälle;
3. teilweise ausgeführten oder unterbrochenen Backfill;
4. wiederholte Ausführung ohne Doppelwirkung;
5. Parallelbetrieb alter und neuer Writer/Reader;
6. Count-, Null-, Orphan-, FK-, Unique-, Checksum- und Tenant-Abgleich;
7. Lockdauer, Batchgrösse, Laufzeit- und Abbruchbudget;
8. Rollback vor Contract beziehungsweise Roll-forward nach irreversiblem
   Contract;
9. Restore-Probe vor destruktiver Löschung oder Schlüsselrotation.

Produktive Migrationen laufen nie im Requestpfad. Privacy-Erasure und bereits
extern zugestellte Daten werden nicht durch ein Datenbank-Rollback
„wiederhergestellt“.

## 10. Geschützte Phase-01–18-Invarianten und Owning-Suites

| Invariante                                         | Mindestens erneut auszuführende bestehende Suites bei Berührung                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, Session, safe-next, Firmenkontext            | `tests/unit/auth/*`, `tests/integration/auth/*`, `tests/integration/employer/team-invitations-postgres.test.ts`, E2E Journeys                                                     |
| Tenant, Rolle, Assignment, Capability, sichere 404 | `tests/integration/security/authorized-repositories.test.ts`, `tests/unit/security/route-access.test.ts`, Admin-/Employer-PostgreSQL-Suites                                       |
| Candidate Apply, Status, Nachrichten, Alerts       | `tests/integration/candidate/*`, `tests/integration/employer/applications-postgres.test.ts`, E2E Journeys                                                                         |
| Talent-Radar-Anonymität, Contact, Reveal           | `tests/unit/talentradar/*`, `tests/integration/privacy/talent-radar-*-postgres.test.ts`, `phase17-talent-radar.spec.ts`                                                           |
| Billing, Ledger, Entitlements, Boost               | `tests/unit/billing/*`, `tests/integration/billing/*`, `phase17-billing.spec.ts`                                                                                                  |
| Job-Publish, Moderation, öffentliche Eligibility   | `tests/integration/employer/jobs-postgres.test.ts`, `tests/integration/admin/phase11-operations-postgres.test.ts`, `tests/integration/jobs/*`, `phase17-employer-publish.spec.ts` |
| Search, Sponsored-Relevanz, SEO/Sitemap            | `tests/unit/search/*`, `tests/integration/jobs/public-read-model-postgres.test.ts`, `tests/unit/seo/*`, `phase17-security-search.spec.ts`                                         |
| Privacy Case, Consent, Export-Mock-Grenze          | `tests/integration/privacy/privacy-*.test.ts`, `tests/unit/privacy/*`                                                                                                             |
| Audit, Rate Limit, Redaction, Cache/CSP            | `tests/integration/audit/*`, `tests/integration/auth/rate-limit-postgres.test.ts`, `tests/unit/security/*`, HTTP/HSTS-Smoke                                                       |
| Seed, Migration, Recovery                          | `tests/integration/schema/*`, `tests/integration/seed/*`, `npm run test:release` bei G4                                                                                           |

Die Phase nennt daraus eine konkrete Teilmenge und ergänzt ihre neuen
Owning-Suites. Ein geänderter Altvertrag benötigt eine neue ADR-/Requirement-
Version und Parallel-/Migrations-Evidence; historische Erwartungen werden
nicht still umgedeutet.

## 11. Parallelisierung und Integrationssperren

- Nach grünem Phase-19-G0 dürfen Phase-31A-Discovery und die fachliche
  Vorbereitung von 30A ohne Codeänderung parallel laufen.
- Phase 20, 21 und 22 dürfen fachlich parallel entworfen werden. Ihre
  Migrationen werden nacheinander integriert: Identity/Outbox-Basis vor
  Document-/Privacy-Contract.
- Phase 23 darf Worker-/Environment-Grundlagen vorbereiten, aktiviert aber
  keine fachliche Queue vor dem jeweiligen Domain-Contract.
- Phase 25 und 26 dürfen nach Phase 20 technisch parallel vorbereitet werden;
  gemeinsame Auth-/Role-/Company-Migrationen werden nicht gleichzeitig
  gemergt.
- Phase 24 beginnt technisch erst nach WTP-Go und nur für LC5-Scope.
- Die default-off Technikverträge der Phasen 27 und 28 sind owner-aktiviert;
  ihre jeweils getrennte Markt-/Kohortenaktivierung bleibt ausserhalb des
  kritischen Pfads, bis moderierte Research den konkreten Bedarf und die
  zusätzlichen Aktivierungsgates belegt.
- 30C bleibt P3, solange der Capacity-Trigger nicht erreicht ist.
- Phase 29 poliert nur stabilisierte Fachverträge; moderierte Research startet
  früh und liefert Feedback an die besitzende Fachphase.
- Phase 32 integriert keine neuen Features.
- Phase 33 implementiert ausschließlich bestätigte technische LC4-/LC5-
  Closure-Gaps. Optionaler Produktumfang bleibt deaktiviert; ein Auditbefund
  rechtfertigt keinen ungezielten Feature- oder Broad-Refactor-Scope.

Schema-, Auth-/RBAC-, Verschlüsselungs-/Keyring-, Payment- und Worker-Cutover
dürfen nicht als unabhängige Grossmigrationen gleichzeitig aktiviert werden.
Zwischen zwei solchen Cutovers liegt mindestens ein grünes G3 mit
Rollback-/Kill-Switch-Evidence.

## 12. Evidence-Pflicht

Der neue Record beginnt mit
[`remediation-evidence-template.md`](./remediation-evidence-template.md).
Die historische Evidence-Struktur der Phasen 01–18 wird nicht editiert oder
als leere Vorlage kopiert.

Jeder Phase-19+-Record enthält:

- Start- und Abschlusscommit, Branch, Datum/Zeitzone und Artefakt-Digest;
- OS, Node/npm, PostgreSQL, Browser und relevante Provider-/Sandbox-Version;
- Scope, Launchklasse, aktivierte Flags und ausdrücklich ausgeschlossene Flows;
- alle Befehle mit Arbeitsverzeichnis, Exit Code, Laufzeit und
  Pass/Fail/Skip/Retry;
- Migrationen auf den Zuständen aus Abschnitt 9;
- Rollen-/Portale-/Tenant-/Security-/Abuse-/Failure-Ergebnisse;
- E2E-, A11y-, Mobile-, Performance-/Load- und Providerartefakte;
- für Phase 33 zusätzlich historische Migration-SHA, Mock-/Production-
  Contract-Profile, Environment-/Provider-/Feature-/Workerinventare und
  Config-/Standalone-/OCI-Digests; für Notification zusätzlich Key-/Secret-
  Versionsinventar, 23-h-/31-d-/exakt-400×24-h-Grenzläufe,
  providerunabhängige Maintenance, Unknown-Outcome-Reconciliation,
  Activation-TX-Lock und monotone Inbox-/Suppression-Evidence;
- manuelle/moderierte Prüfungen mit Protokoll und anonymisierten Ergebnissen;
- offene externe Gates, Owner, Datum und Go/No-go;
- bekannte Limitationen sowie Rollback-/Kill-Switch-Test.

Evidence eines anderen Commits, Testmode-Zahlungen, Mock-Mail, Demo-Daten,
Screenshots ohne Ablauf oder ein grüner Build allein gelten nicht als Pass.

## 13. Harte Fail-Regeln

Das Gate ist rot bei fehlenden Pflichtzeilen, fehlerhaften oder flakigen Tests,
Retry größer `0`, unanalysierten Skips, `.only`, deaktivierten Security-/
Privacy-/Payment-/Tenant-Tests, Snapshot-Blindupdates, SQLite/In-Memory-Ersatz
für PostgreSQL-Semantik, anderem Testcommit, fehlender Negativabdeckung,
ungebundenen externen Freigaben oder einem deployten Artefakt mit anderem
Digest.

Eine zeitlich begrenzte Risikoakzeptanz darf nur ein nicht-P0-, nicht-
Security-, nicht-Privacy-, nicht-Payment- und nicht-Tenant-Gate überbrücken.
Sie nennt Owner, Ablaufdatum, Mitigation, Monitoring und Removal-Task.

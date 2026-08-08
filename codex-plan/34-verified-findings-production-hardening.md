# Phase 34 — Verified Findings, Production Hardening and Final Validation

> **Status:** `IN_PROGRESS`  
> **Startbaseline:** Commit `f60db6a35dd7225fadbc8f6aa1cb3551251685c5`,
> Tree `27df70c589ea45987dddc2e1e67550a18c7a072a`, Branch
> `codex/phase-34-verified-hardening`, `origin/main` auf demselben Commit.  
> **Technical Status:** `PENDING`  
> **Quality Status:** `PENDING`  
> **Activation Status:** `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`  
> **Gesamturteil:** `NO_GO`  
> **Aktueller Abschlussrecord:**
> [`2026-08-07-phase-34.md`](./evidence/2026-08-07-phase-34.md)  
> Phase 34 autorisiert weder Deployment noch reale Provider, Zahlungen,
> Nachrichten, Produktionsdaten oder externe Freigaben.

## 1. Zweck

Phase 34 prüft den nach Phase 33 entstandenen Gesamtbaum erneut gegen Code,
Schema, Migrationen, Runtime, Provider, Worker, Security, öffentliche und
private Nutzerreisen sowie die kanonischen Planartefakte. Jeder gemeldete
Befund beginnt als unbestätigte Hypothese. Nur reproduzierte
Repository-Probleme werden geändert; bewusste Fail-closed-Grenzen,
Geschäftshypothesen und externe Legal-/Privacy-/Tax-/Provider-/Ops-Gates
werden nicht in scheinbare technische Erfolge umgedeutet.

## 2. Verbindliche Quellen- und Statusregeln

Es gilt die Konfliktpräzedenz aus [`AGENTS.md`](../AGENTS.md) und
[`remediation-execution-contract.md`](./remediation-execution-contract.md).
Historische Evidence bleibt unverändert. Der laufende Zustand steht im
[`Phase-34-Findingsregister`](./phase34-findings-register.md).

Zulässige Befundstatus sind:

- `UNVERIFIED`, `CONFIRMED`, `PARTIALLY_CONFIRMED`, `FALSE_POSITIVE`,
  `OBSOLETE`, `DUPLICATE`;
- `IMPLEMENTED_E2E_PENDING`, `BLOCKED_E2E`, `BLOCKED_EXTERNAL`;
- `FIXED` ausschließlich nach grünem positiven und negativen End-to-End-
  Nachweis auf demselben Candidate;
- `ACCEPTED_RISK` nur mit Owner, Begründung, Ablauf-/Reviewdatum und
  unveränderter sicherer Voreinstellung.

Eine Empfehlung ohne reproduzierten Defekt bleibt `PROPOSAL` außerhalb der
Statusspalte und darf keine Aktivierung oder Produktentscheidung auslösen.

## 3. Nicht-Ziele und Sicherheitsgrenzen

- keine Production-/Preview-/Staging-Bereitstellung;
- keine echten PSP-, E-Mail-, Storage-, Scanner-, Register- oder AI-Aufrufe;
- keine echten Käufe, E-Mails, Webhooks oder personenbezogenen Daten;
- keine Secrets, Cloud-Konfiguration, Providerkonten oder Legal-Freigaben;
- kein Edit historischer Migrationen und kein `prisma db push`;
- kein Push, Pull Request, Force-Push oder PC-Shutdown durch diese Phase;
- kein Pricing-, Produkt- oder Monetarisierungscutover ohne separate
  Commercial-/Legal-/Finance-Autorisierung.

## 4. Phase-0-Snapshot und Unveränderlichkeitsvertrag

Vor dem ersten Edit wurden Branch, Commit, Tree, Remotes, Ahead/Behind,
Worktree, Lockfile, Toolversionen, Route-/Action-/Provider-/Worker-/Flag-
Inventare sowie alle 68 SQL-Migrationen erfasst. Die ersten 67 historischen
Migrationen und die additive Phase-33-Migration bleiben byteidentisch. Der
vollständige Hashsatz steht in
[`phase34-migration-baseline.json`](./evidence/phase34-migration-baseline.json).

Lokale, unversionierte Control-Plane-Zustände werden weder gelesen noch als
Evidence verwendet. Jede spätere Migration ist additiv und benötigt Fresh-,
Upgrade-, Partial-/Restart-, Idempotenz- und Roll-forward-Nachweis.

## 5. Tracks und Reihenfolge

### 34A — Governance, Traceability und Evidence-Integrität

1. aktuellen Plan, ADRs, Requirements, Architektur, Route-/Rollenmatrix,
   Runbooks und Evidence gegeneinander prüfen;
2. abgeschnittene, strukturell beschädigte oder stale Abnahmetabellen
   reproduzieren und aus unveränderlichen Quellen rekonstruieren;
3. Plan-Audit um fail-closed Truncation-, Tabellenform- und
   Requirement-/Phase-34-Checks ergänzen;
4. positive und negative CLI-Evidence für den echten Audit-Einstieg erzeugen.

### 34B — Environment, Provider, Payment und Worker

1. `local`, `ci`, `preview`, `staging`, `production` erschöpfend gegen Mock,
   Contract, Sandbox und Live klassifizieren;
2. jeden Composition Root und jede Aktivierung an Environment, Use Case,
   Adapter, Version, Mode und aktuelles Ledger binden;
3. Mock-Checkout/-Mail/-Storage in Preview/Production und Live→Mock-Fallback
   über UI, Action, Route und Persistenz negativ prüfen;
4. Worker-Readiness, Queue-/Inbox-Alter, Lease, Heartbeat, Revoke, Retry,
   DLQ/Replay und Providerdegradation prüfen;
5. Runbooks an den tatsächlich implementierten Phase-33-Vertrag angleichen,
   ohne externe Aktivierung vorzutäuschen.

### 34C — Search, Trust, Datenbank und Performance

1. Public Search, Homepage, Alerts, Preferences, Recommendations, Matching,
   Sitemap und Trust-Projektionen auf dasselbe `asOf` und dieselbe kanonische
   Eligibility prüfen;
2. SQL-Ranking und Hydration-/JS-Prüfung mit realem PostgreSQL 16 positiv und
   negativ vergleichen; ein Drift bleibt fail-closed, aber nicht unerklärt;
3. Queryzahl, Ergebnislimit, Counts, FTS/Indexnutzung, Pool-/Statement-
   Timeouts und `force-dynamic` nur anhand gemessener Evidence ändern;
4. historische Migrationen hashen; nur additive Backstops mit vollständiger
   Upgrade-Evidence zulassen.

### 34D — Security, Privacy, E-Mail und UX

1. Account-/IP-Limits, Reset-Mailbombing, Proxy-/Forwarded-For-Vertrag,
   CSRF, Webhook-Replay, Cookie/Host/CSP und Auditverlust prüfen;
2. Tenant-, Owner-, Assignment-, Capability-, SoD- und Step-up-Denials aus
   realen Entry Points bis zur Datenbankwirkung belegen;
3. verpflichtende und optionale E-Mailreisen samt ehrlicher Fallback-UI,
   Outbox/Attempt/Inbox/Suppression und PII-Redaktion prüfen;
4. de-CH-Copy, Enum-Mappings, Encoding, responsive 320/360, Keyboard/Fokus,
   WCAG 2.2 AA, Canonical/noindex/Sitemap/Robots prüfen.

### 34E — Priorisierte Remediation-Schleifen

Nur `CONFIRMED`/`PARTIALLY_CONFIRMED` repository-interne Defekte werden in
kleinen Paketen geschlossen. Nach jedem Paket laufen Reproduktion, Unit,
PostgreSQL-/Contracttest, positiver und negativer E2E, angrenzende kritische
Reisen, Lint und Typecheck. Ein rotes Pflichtgate stoppt den nächsten Cutover.

### 34F — Immutable Candidate und Abschlussurteil

Nach dem letzten Edit werden Commit-/Tree-/Lock-/Migration-/Artefakt-
Identitäten eingefroren und die vollständige Candidate-Matrix erneut
ausgeführt. Fehlende kritische E2E- oder externe Evidence ergibt `NO_GO`, nicht
eine Schätzung. Der Abschlussrecord trennt Technical-, Quality- und
Activation-Urteil.

## 6. Verbindliche End-to-End-Matrix

Jede Reise prüft den tatsächlichen Einstieg, serverseitige Policy,
Persistenz/Outbox/Audit und die sichtbare Endlage. Je Zeile sind mindestens ein
positiver und ein negativer/Abuse-Pfad Pflicht.

| ID          | Reise                                              | Positiver Endzustand                                        | Negativer Endzustand                                      |
| ----------- | -------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `E2E-34-01` | Candidate Registrierung → Verifikation → Bewerbung | verifiziertes Konto, genau eine Bewerbung/Outbox/Audit      | replay/fremde Stelle/unverifizierter Zugriff: 0 Wirkung   |
| `E2E-34-02` | Employer Registrierung → Firma → Stelle → Submit   | eigener Draft und genau ein Submit                          | fremder Tenant/ungültiger Status: 0 Write                 |
| `E2E-34-03` | Admin Moderation → Publish → Public Search/Detail  | freigegebene Stelle überall konsistent sichtbar             | fehlende Capability/Trust/Freshness: nirgends sichtbar    |
| `E2E-34-04` | Einladung → Login/Registrierung → Membership       | Token single-use, richtige Firma/Rolle                      | expired/replay/falsche E-Mail: 0 Membership               |
| `E2E-34-05` | Passwort vergessen → Mailbox/Provider → Reset      | genau ein Reset und alte Sessions widerrufen                | Enumeration/replay/fremder Actor: 0 Übernahme             |
| `E2E-34-06` | einmaliger Contract-Payment-Flow                   | autorisierte Order→Webhook→Ledger/Invoice                   | falscher Betrag/Signatur/replay: 0 Fulfillment            |
| `E2E-34-07` | Subscription im Stripe-Testvertrag                 | Subscription/Invoice/Reconciliation konsistent              | out-of-order/duplicate/timeout: fail-closed/held          |
| `E2E-34-08` | lokaler Mock-Kauf                                  | sichtbar als Demo, genau eine Mockwirkung                   | Production-/Preview-Kontext: Route/Action 404 oder denied |
| `E2E-34-09` | Preview/Production Mock-Denial                     | 0 Mock-CTA/Route/Write                                      | direkte URL/Action kann Gate nicht umgehen                |
| `E2E-34-10` | Provider-Revoke                                    | nächster Read/Claim stoppt Wirkung                          | stale Binding/Secret allein aktiviert nichts              |
| `E2E-34-11` | Company-Trust-Ablauf/Revoke                        | Badge, Jobs und Radar gleichzeitig entzogen                 | Legacy-/stale Projection bleibt nicht öffentlich          |
| `E2E-34-12` | Worker E-Mail/Alert/Retention                      | genau eine Wirkung, Fristen eingehalten                     | Crash/retry/poison ohne Verlust/Doppelwirkung             |
| `E2E-34-13` | Worker Scan/Privacy/Retention                      | WorkItem→Artifact/Status/Outbox atomar                      | Providerausfall/replay: resumierbar, keine Teilfreigabe   |
| `E2E-34-14` | Cross-Tenant-/Assignment-Zugriff                   | eigener Scope funktioniert                                  | fremde ID/abgelaufene Zuweisung: 0 Read/Write             |
| `E2E-34-15` | Production ohne Demo-Indexierung                   | nur LIVE-eligible Inhalte indexierbar                       | Demo/Test/Salary-unavailable: noindex/keine Sitemap       |
| `E2E-34-16` | Einladung/Notification Sink und Fallback           | ehrlicher Status plus durable Outbox                        | Provider disabled: kein falsches „gesendet“               |
| `E2E-34-17` | HTTP Rate Limit                                    | erlaubte Anfrage funktioniert und blockierte wird auditiert | Proxyspoof/replay/Limitüberschreitung ohne Auditverlust   |
| `E2E-34-18` | redigierter Fehlerpfad                             | Correlation und sicherer nächster Schritt sichtbar          | 0 Secret/Token/PII/rohes Providerobjekt in UI/Log         |
| `E2E-34-19` | historische DB → additive Migration → Boot         | alle Daten/Constraints und Health grün                      | Partial/Restart/zweiter Deploy ohne Drift/Teilwirkung     |
| `E2E-34-20` | Preview- und prod-like Runtime-Matrix              | erlaubte Contract-/Live-Komposition exakt                   | jede Mock-/Demo-/Sandbox-Kombination fail-closed          |

## 7. Qualitäts- und Befehlsvertrag

Mindestens erforderlich, jeweils auf dem finalen Candidate und ohne
unerklärten Skip/Retry:

```powershell
npm ci
npm run env:validate
npm run db:generate
npm run db:validate
npm run plan:audit
npm run route:audit
npm run phase33:audit
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e:http
npm run test:e2e:browser
npm run phase33:e2e
npm run phase34:e2e
npm run phase33:runtime:config:local
npm run phase33:runtime:config:contract
npm run phase33:runtime:smoke:contract
npm run security:release-scan
```

Zusätzlich laufen alle aus bestätigten Findings entstehenden gezielten
positiven/negativen Tests, Migration-Upgrade-/Restore-Drills, Provider-/Worker-
Failuretests, drei Browser, 320/360 px, Keyboard/Fokus/Axe sowie Secret-/PII-
Scans. Ein früherer grüner Phase-33-Lauf ersetzt keinen Phase-34-Candidate.

## 8. Evidence und Definition of Done

Der aktuelle Abschlussrecord belegt auf dem letzten ausführbaren Candidate
alle vorhandenen Repository-Suites als grün. Die verbindliche
20-Reisen-Matrix ist jedoch nur mit 4 `COVERED`, 14 `PARTIAL` und 2
`EXTERNAL` geschlossen. Das Findingsregister enthält 106 vollständig
klassifizierte Records, aber weiterhin repository-interne E2E-Restnachweise
und echte externe Gates. Deshalb bleiben Technical Status, Quality Status und
die Phase selbst offen; das Aktivierungsurteil bleibt `NO_GO`.

Phase 34 bleibt `[ ]`, bis:

- jedes Registerelement eine reproduzierbare Klassifikation, Owner,
  Auswirkung, Test und Entscheidung besitzt;
- jeder repository-interne P0/P1-Befund `FIXED` mit positivem und negativem
  E2E ist oder ehrlich `BLOCKED_E2E` bleibt;
- alle externen Punkte `BLOCKED_EXTERNAL` mit konkretem Owner, Eingang,
  Abnahmekriterium und sicherem Zwischenzustand sind;
- Migrationen und Candidate-Identität unverändert gebunden sind;
- die vollständige Suite auf dem letzten geänderten Candidate grün ist;
- der datierte Abschlussrecord die 15 geforderten Berichtsteile, alle
  Befehle/Exits/Dauern und das ehrliche `GO`/`NO_GO` enthält.

Ein technischer Pass darf höchstens die technische Konfigurationsreife des
geprüften Scopes feststellen. Ohne echte Zielumgebung, Provider-, Legal-,
Privacy-, AVG/AVV-, Tax-/Finance-, Operations-, Backup-, Monitoring-, WTP-,
Research- und unabhängige Approval-Evidence bleibt die Aktivierung `NO_GO`.

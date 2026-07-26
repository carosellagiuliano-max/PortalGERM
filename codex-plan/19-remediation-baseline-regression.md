# Phase 19 — Aktuelle Remediation-Baseline, Governance und Regressionsschutz

> **Planstatus:** ABGESCHLOSSEN
> **Technikstatus:** IMPLEMENTIERT — Governance-/Baseline-Versiegelung ohne Runtimeänderung
> **Quality-Gate:** BESTANDEN auf `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c`
> **Aktivierung:** DISABLED
>
> Phase 19 hat die zwingende Ausführungsschranke vor jeder Änderung an
> Produkt-, Runtime-, Schema- oder Testcode ab Phase 20 geschlossen. Der
> vollständige Clean-Clone-/G4-Baselinelauf ist im
> [Phase-19-Evidence-Record](./evidence/2026-07-26-phase-19.md) dokumentiert.
> Die Aktivierungsgrenzen der Phasen 20–32 bleiben unverändert geschlossen.

## 1. Status

| Dimension | Status |
| --- | --- |
| Planstatus | `ABGESCHLOSSEN` |
| Technikstatus | `IMPLEMENTIERT — Governance-/Baseline-Versiegelung ohne Runtimeänderung` |
| Quality-Gate | `BESTANDEN` auf `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c` |
| Aktivierung | `DISABLED` |

Der Vorspann und diese Tabelle beschreiben denselben Abschlussstand. Die
technische Phase ist abgeschlossen, ohne daraus eine Produkt- oder
Launchaktivierung abzuleiten.

## 2. Ziel und Business Value

Den bei Umsetzungsbeginn tatsächlich aktuellen, sauberen `main`-Commit
reproduzierbar versiegeln, den vollen Phase-01–18-Vertrag neu testen und alle
Findings `STH-001` bis `STH-037` widerspruchsfrei in Requirements,
Architektur, ADRs, Phasen, Tests, Launchklassen und Evidence verankern. Dadurch
startet keine teure Remediation auf einer unbekannten oder formal
widersprüchlichen Grundlage.

## 3. Aktueller tatsächlicher Repositoryzustand

- Historische Phasen 01–18 und ihre Evidence-Dateien sind abgeschlossen und
  unveränderliche Historie.
- Der letzte vollständige Phase-18-Code-Golden-Run gehört zu `a9f24e7`, nicht
  zum heutigen Planungscommit.
- Die frühere Remediation-Analyse gehört zu `eb9b45a`.
- Der am 26. Juli geprüfte saubere Planungsstand ist `e34262e`; `HEAD` und
  `origin/main` stimmten bei Prüfungsbeginn überein.
- `e34262e` enthält die Phasen 19–32, `.claude/launch.json` und die Änderung
  an `components/layout/brand-link.tsx`. Die alte Aussage, diese seien lokale
  Fremdänderungen, ist veraltet.
- Der für Phase 19 gewählte Candidate
  `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c` war beim Start und Ende des
  Golden-Runs identisch mit `origin/main`; sein Parent ist `e34262e`.
- Der Candidate enthält ausschliesslich die synchronisierte Governance- und
  Planbaseline. Runtime-, Schema-, Migrations- und Testcode blieben
  unverändert.
- Die Testarchitektur ist stark: Vitest Unit, isolierte reale PostgreSQL-
  Integration, Production-Build/HTTP, Playwright Desktop/360 px, Linux- und
  Windows-CI sowie ein isolierter Release-/Recovery-Drill.
- Der neue Golden Run bestand 1.974 Unit-, 369 PostgreSQL- und 219
  Browsertests mit Retry `0`, 43 Migrationen, Seed×2, Build, HTTP/HSTS sowie
  verschlüsselten Backup-/Restore-Drill. Die vollständigen Resultate und
  offenen Grenzen stehen im Phase-19-Evidence-Record.

## 4. Findings und Requirements

| ID | Eigentum dieser Phase |
| --- | --- |
| `STH-001`–`STH-037` | aktuelle Baseline, Owner-, Test-, Launch- und Evidence-Vollständigkeit |
| `STH-029` / `REQ-GOV-001` | Governance, Präzedenz, sechs Launchklassen und verbindlicher Phase-19+-Testvertrag |
| `REQ-QA-003` | jede offene Phase besitzt Akzeptanz→Test, exakte Befehle, Passschwellen und Folgephasengate |

Phase 19 behebt keine fachliche Runtime-Lücke. Sie macht alle Dossiers
ausführbar und verhindert, dass ein höher priorisiertes Altdokument eine
neuere Detailphase überschreibt.

## 5. In Scope

- bei tatsächlichem Start `origin/main` fetchen und den exakten sauberen
  Startcommit wählen;
- Clean-Clone-/detached-Golden-Run auf genau diesem Commit;
- Commit-, Runtime-, Env-, Schema-, Migration-, Seed-, Route-, Provider-,
  Queue-, Test-, CI- und Runbookinventar;
- Synchronität aller autoritativen Dokumente für `STH-001`–`STH-037`;
- aktuelle Search-/Alert-/Preference-/Recommendation-/Matching-Baseline;
- aktuelle Zero-result-Bucket-, Admin-Cap-/Pagination-/Fan-out- und
  Sitemap-Count-/Bytes-/Laufzeit-/Forecast-Baseline;
- sechs Launchklassen, Priority-Matrix, kritischer Pfad,
  Parallelisierungs-/Integrationssperren;
- Owning-Suite und phasenspezifischer Testvertrag für jede Phase 20–32;
- Evidence-Template und Statusmodell aus
  [`remediation-execution-contract.md`](./remediation-execution-contract.md).

## 6. Out of Scope

- Produkt-, Runtime-, Schema-, Migration-, Provider-, UI- oder Testcode;
- rückwirkende Änderungen an Phasen 01–18 oder ihrer Evidence;
- Branch, Commit, Push, PR, Deployment oder Freigabe ohne separaten Auftrag;
- Übernahme historischer Testresultate als Pass des neuen Baseline-Commits;
- ungeprüfte Rechts-, Provider-, Markt- oder Produktionsfreigaben.

## 7. Betroffene Rollen und Owner

Alle Rollen und Portale sind als Regression betroffen: Public, Candidate,
Employer, Recruiter, Company Owner/Admin/Viewer, Platform Admin/Support/
Moderation/Finance/Privacy/Sales sowie System/Ops.

| Verantwortung | Owner |
| --- | --- |
| Baseline/Golden Run | Engineering + QA |
| Planpräzedenz/Traceability | Product + Engineering |
| Security-/Tenant-Invarianten | Security |
| Migration/Recovery | Data/DB + Ops |
| Launchklasse/Scope | Product + Commercial + Legal/Ops je Klasse |

## 8. Portale, Routen, Services und Hintergrundprozesse

Alle 100 implementierten Seiten und sieben Handler aus
`route-inventory.json`, sämtliche Domain-Services, Provider-Composition-Roots,
Maintenance Commands und CI-Gates werden inventarisiert. Das
`route-inventory.json` bleibt ein **Ist-Inventar**: geplante Phase-20+-Routen
werden nur in der geplanten Delta-Matrix dokumentiert und erst nach ihrer
Implementierung per `route:audit:update` übernommen.

## 9. Datenmodell, Constraints und Indizes

Keine fachliche Änderung. Phase 19 inventarisiert das aktuelle Prisma-Schema,
alle committed Migrationen, benannte PostgreSQL-Constraints/Indizes,
Provenienz-, Ledger-, Snapshot-, Consent-, Audit- und Seed-Verträge. Anzahl
und Hash werden aus dem bei Start gewählten Commit ermittelt; keine alte
Zahl wird hart übernommen.

## 10. Migration, Backfill und Kompatibilität

Der Golden Run prüft:

- `migrate deploy` auf leerer isolierter Datenbank;
- Upgrade auf einer realistischen Phase-18-Bestandsfixture;
- Seed zweimal mit identischem Manifest;
- Production-Demo-Guard;
- Migrationstatus, Schema-/Constraint-/Indexinventar;
- Backup/Restore in eine andere leere Datenbank.

Es gibt in Phase 19 keinen Backfill. Ein roter Upgradepfad wird nicht durch
Reset oder `db push` kaschiert.

## 11. Serverlogik, Worker, Queue und Provider

Nur Ist-Aufnahme: Mock-/Placeholder-/unwired-/produktive Composition Roots,
idempotente Runner, fehlende Scheduler/Leases/DLQ, Provider- und Failure-
Tests. Keine Verbindung zu realen Providerzugängen wird in Phase 19
aktiviert.

## 12. UI-/UX-Zustandsvertrag

Das Routeinventar ordnet kritischen Reisen Loading, Empty, Locked, Pending,
Error, Retry, Conflict, Expired, Cancelled und Success zu. Fehlende Zustände
werden der owning Phase zugewiesen; Phase 19 baut keine UI. Öffentliche
Nichtverfügbarkeit und Mock-Copy müssen während der ganzen Remediation
unverändert ehrlich bleiben.

## 13. Mobile und Barrierefreiheit

Die bestehende Desktop-/360-px-/Keyboard-/Focus-/Axe-Baseline wird neu auf
dem Startcommit ausgeführt. Sie belegt keine Verständlichkeit; moderierte
Research gehört `STH-033`/Phase 29A.

## 14. Authentisierung, Autorisierung und Tenantgrenzen

Rollen-, Membership-, Assignment-, Ownership-, Capability-, Status- und
Entitlement-Grenzen sowie sichere 404 werden als geschützte Invarianten
erfasst. Jeder spätere Phasevertrag benennt die berührten Owning-Suites.

## 15. Datenschutz, Retention, Export, Löschung und Audit

Evidence enthält keine Secrets, Tokens, vollständigen URLs, Backup-Bytes oder
reale Identitäten. TEST/DEMO-Provenienz ist Pflicht. Die aktuellen Mock-
Grenzen für CV, Export, Erasure, Mail und Payment werden als offene
Remediation, nicht als verdeckter Testfehler oder LIVE-Funktion, erfasst.

## 16. Abuse-, Fraud- und Missbrauchsszenarien

Die Baseline erfasst vorhandene Rate Limits, Abuse-/Supportqueues, Audit,
Session-Revocation und Trust-Loss. Fehlende ATO-, kompromittierte Firmen-,
Jobduplikat-, Massennachrichten-, Reveal/Export-Anomalie- und Payment-Fraud-
Szenarien werden `STH-031` zugeordnet; sie werden nicht als bereits gelöst
ausgegeben.

## 17. Externe und organisatorische Voraussetzungen

Für den technischen Golden Run: gepinnte Node-/npm-Version, Docker,
PostgreSQL 16, Playwright-Browser und Age. Hosting, Provider, AVG/AVV,
Legal/Privacy/Tax, WTP, reale Salary-Daten, Incident Owner und Operations-
Personal bleiben externe Gates.

## 18. Abhängigkeiten

Keine Produktphase. Ein fehlendes Tool oder ein rotes Pflichtgate blockiert
jede Produktänderung ab Phase 20. Fachliche Discovery in 29A/31A darf
vorbereitet werden, aber keine Runtime aktivieren.

## 19. Geordnete Implementierungsschritte

1. `origin/main` fetchen, aktuellen sauberen Commit und Nutzeränderungen
   protokollieren.
2. Isolierten Clean Clone/detached Worktree ohne lokale Env-/DB-Artefakte
   erzeugen.
3. Runtime, Env, Plan, Links, Routes, Schema, Migrationen, Seed, Provider,
   CI und Tests inventarisieren.
4. Baseline- und vollständiges G4-Release-Gate ausführen.
5. bestehende Vorfehler unverändert erfassen; nichts skippen/abschächen.
6. Search-/Zero-result-/Admin-/Fan-out-/Sitemap-/Performance-Istwerte
   aufnehmen, getrennt nach DEMO und echter Zielumgebung.
7. alle `STH-001`–`STH-037` mit Requirement, Phase, Launchpriorität,
   Testmatrix, Owner, Gate und Evidence abgleichen.
8. für jede Phase 20–32 die konkrete Owning-Suite und Integrationssperre
   bestätigen.
9. erst nach grünem Gate den Beginn unabhängiger Tracks freigeben.

## 20. Feature-Flag- und Aktivierungsstrategie

Keine Aktivierung. Alle Phase-20+-Funktionen bleiben in ihrem heutigen
Mock-/Unavailable-/Absent-Zustand. Phase 19 dokumentiert die spätere
Flaghierarchie `build → environment → provider → legal/product → cohort →
runtime health` und verlangt Kill Switches; sie erstellt keine impliziten
`NODE_ENV`-Schalter.

## 21. Verbindlicher Testvertrag

### Ausgangsbaseline

Die ursprüngliche Planungsidentität war `e34262e`. Beim
Implementierungsstart wurde der damalige saubere `origin/main`-Commit
`769ee620b60bfae4b3c80f318e4cf3595ea8ff7c` als Candidate gewählt.
Historische Zahlen blieben Vergleichswerte; der neue Pass entstand durch die
folgenden Befehle exakt auf diesem Commit.

### Exakte Phase-19-/G4-Befehlsfolge

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/main
npm ci
npm run env:validate
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:migrate:status
npm run db:seed
npm run seed:verify
npm run db:seed
npm run seed:verify
npm run db:smoke
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e:http
npm run test:e2e:browser
npm run test:e2e:hsts
npm run plan:audit
npm run route:audit
npm run security:release-scan
npm run license:audit
npm run test:release
git diff --check
git status --short
```

Der Ablauf läuft im isolierten Clean Clone mit getrennten, allowlist-
konformen Source-, Test-, Restore- und Production-Guard-Datenbanken.
`npm run db:seed` plus `npm run seed:verify` wird bewusst zweimal ausgeführt;
beide Manifeste müssen bytegleich sein. Browser-Evidence hat Retry `0`.
`npm run test:release` ersetzt keinen der vorherigen Einzelbefehle.

### Akzeptanz-zu-Test-Matrix

| AC/Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Testumgebung | Exakter Befehl/Ablauf | Erwartung und Schwelle | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `19-AC-01`, `REQ-GOV-001` | falscher Commit/Evidence | Repository-Preflight | Startidentität | sauberer HEAD entspricht dokumentiertem Commit | Dirty Tree oder Remoteabweichung blockiert | Engineering | Git | aktueller Clone | lokales Repository | `git status --short`; `git rev-parse HEAD`; `git rev-parse origin/main` | Status leer; erwartete Commitwerte identisch | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | QA | PASS |
| `19-AC-02`, `REQ-QA-003` | gebrochene Planung | Contract-Audit | Plan/Route/Secret/License | Links und Istinventare grün | fehlender Link oder vorgeplante Route rot | Engineering | Plan/Repository | Markdown und App-Baum | Clean Clone | `npm run plan:audit`; `npm run route:audit`; `npm run security:release-scan`; `npm run license:audit` | vier Exit Codes `0` | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | Engineering | PASS |
| `19-AC-03` | nicht reproduzierbare DB | PostgreSQL/Recovery | leer, Upgrade, Seed×2, Restore | alle Zustände migrieren und Seedmanifest identisch | Partial-/Production-Seed oder fremde Restore-DB blockiert | System | PostgreSQL/Recovery | leere, Bestands-, Guard- und Restore-DB | isoliertes PostgreSQL 16 | `npm run db:migrate`; `npm run db:migrate:status`; `npm run db:seed` zweimal; `npm run seed:verify`; `npm run db:smoke`; `npm run test:release` | Exit `0`; Seedmanifeste identisch; Restore-DB verschieden; Cleanup vollständig | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | Data/Ops | PASS |
| `19-AC-04` | verdeckte Regression | G3/G4 Golden | vollständiger Altvertrag | alle vorhandenen Suites bestehen | Skip, Retry, Flake oder anderer Commit blockiert | alle Rollen | alle Portale | deterministischer Seed | PostgreSQL 16, Production Build, Desktop/360 | die lokale „Exakte Phase-19-/G4-Befehlsfolge“ unmittelbar oberhalb dieser Matrix, ohne Auslassung | alle Exit `0`; Seedmanifest A=B; Browser Retry `0`; keine unerklärten Skips; Start-/End-HEAD identisch | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | QA | PASS |
| `19-AC-05`, `STH-019`, `STH-036` | falsche Searchbaseline | Read/Analytics/Performance | Query-/Consumer-Istzustand | reproduzierbare Resultsets und Ergebnis-Buckets | Rohquery-PII oder vermischte Taxonomieversion blockiert | Visitor/Candidate | Search/Alerts/Recommendations/Analytics | Startcluster-Demoqueries plus freigegebene Zielmessung | Demo und Zielmessung getrennt | manuelle SQL-/HTTP-Messung plus bestehende Search-/Analytics-Suites | Resultsets, Queryplan, p50/p95 und Consumer-Deltas versioniert; null Rohtext in Evidence | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | Search/Data | PASS |
| `19-AC-06`, `STH-020/021/027` | falsche Scalepriorität | Capacity/Query-Messung | Caps/Fan-out/Sitemap | reale Counts, Bytes und Queryanzahl erfasst | DEMO wird nicht als LIVE ausgegeben; Capacity Error darf nicht truncieren | Admin/Candidate/Visitor | Queues/Dashboard/Sitemap | Demo und freigegebene Zielwerte | getrennte Umgebungen | bestehende Admin-/Dashboard-/Sitemap-Tests plus dokumentierte Messqueries | Istwert, Headroom, Forecast, Trigger und Owner; Sitemap fail-closed | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | Ops/Data | PASS |
| `19-AC-07`, `STH-001`–`037` | verlorener Befund | Governance-Review | Traceability-Vollständigkeit | jede ID hat genau einen Lead-Owner und LC-/Testmatrix | unowned, doppelt oder widersprüchlich ist rot | Product/Engineering | Plan | alle STH-/REQ-Zeilen | Clean Clone + zweiter Reviewer | manueller zweiter Review plus `npm run plan:audit` | 37/37 IDs mit Status, Phase, LC-Matrix, Tests, Evidence und externem Gate | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | Product + QA | PASS |
| `19-AC-08` | historische Umschreibung | Diff-Invariantenprüfung | Phase-01–18-Historie | 01–18/Evidence bytegleich | jede Änderung blockiert | Governance | Git/Plan | Start- und Endcommit | Clean Clone | `git diff --name-only <start>...<end> -- codex-plan/01-*.md codex-plan/02-*.md codex-plan/03-*.md codex-plan/04-*.md codex-plan/05-*.md codex-plan/06-*.md codex-plan/07-*.md codex-plan/08-*.md codex-plan/09-*.md codex-plan/10-*.md codex-plan/11-*.md codex-plan/12-*.md codex-plan/13-*.md codex-plan/14-*.md codex-plan/15-*.md codex-plan/16-*.md codex-plan/17-*.md codex-plan/18-*.md codex-plan/evidence` | keine Ausgabe | [Phase-19-Evidence](./evidence/2026-07-26-phase-19.md) | Governance | PASS |

`N/A` ist für Unit-, PostgreSQL-, E2E-, Mobile-, A11y-, Security- oder
Release-Gates dieser Phase nicht zulässig. Moderierte Nutzerforschung und
reale Provider-Smokes sind hier `N/A`, weil Phase 19 nichts aktiviert; ihre
späteren Owner bleiben sichtbar.

## 22. Performance- und Skalierungsgrenzen

Phase 19 hat die Istwerte im Evidence-Record eingefroren, erteilt aber keine
Performancefreigabe. Erfasst sind Search p50/p95 und Query Plan,
Candidate-Recommendation-Querycount, Adminlisten-Caps/Erreichbarkeit,
Sitemap-Count/unkomprimierte Bytes/Laufzeit sowie Release-Gate-Laufzeiten.
Mangels freigegebener LIVE-Zielumgebung existieren ehrlich keine 7-/30-Tage-
Historie oder 90-Tage-LIVE-Prognose. `STH-020`, `STH-021` und `STH-027`
bleiben mit dokumentierten Triggern offen.

## 23. Zu verhindernde Regressionen

- keine Änderung an Phase-01–18-Dateien/Evidence;
- kein Verlust von Tenant-, Radar-, Ledger-, Job-Publish-, Fairness-,
  Import-, Audit-, Demo-/LIVE- oder Kompatibilitätsinvarianten;
- kein Test auf anderem Commit, kein Dirty-Tree-Einfluss;
- kein Datenbankreset als Ersatz für Upgrade-Evidence;
- kein Vorabeintrag geplanter Routen in das Ist-Inventar;
- keine falsche Umdeutung grober Zero-result-Buckets als Taxonomie-Learning.

## 24. Rollback-/Roll-forward-Strategie

Keine Runtimeänderung. Plandokumente sind per Git revertierbar. Temporäre
Clones, Datenbanken und Recovery-Artefakte werden nur mit explizit
allowlist-geprüften Pfaden/Namen entfernt. Ein rotes Baseline-Gate wird
vorwärts im owning Phase-01–18-Domaincode behoben und neu vollständig
getestet; historische Evidence wird nicht umgeschrieben.

## 25. Benötigte Evidence

Der neue [`evidence/2026-07-26-phase-19.md`](./evidence/2026-07-26-phase-19.md)
folgt
[`remediation-execution-contract.md`](./remediation-execution-contract.md)
§12, einschließlich Start-/Endcommit, Umgebung, vollständiger Befehlstabelle,
Migration-/Recovery-Manifest, 37-ID-Traceability, Route-/Testinventar,
Baseline-Metriken, Diff-Invarianten und Go/No-go.

## 26. Definition of Done

- [x] `19-AC-01` bis `19-AC-08` sind auf demselben Commit grün.
- [x] Keine Pflichtprüfung ist geerbt, übersprungen, flakig oder abgeschwächt.
- [x] 37/37 STH-IDs und alle Phase-19+-Requirements sind widerspruchsfrei
  zugeordnet.
- [x] Phasen 01–18 und historische Evidence sind unverändert.
- [x] Alle offenen Phasen besitzen ihren 28-Punkte- und Testvertrag.
- [x] Es besteht keine ungeklärte Regression des historischen Vertrags; offene
  Remediation-P0s bleiben erwartungsgemäß offen und deaktiviert.

## 27. Quality-Gate für Folgephasen

Die verlinkte Phase-19-Evidence ist grün; Phase 20 darf deshalb als nächster
technischer Track beginnen. 31A und 29A dürfen gemäss Dependency-Graph
parallel nichtaktivierende Research-Vorbereitung leisten. Ein späterer
Wechsel des Baseline-Commits erfordert einen neuen vollständigen
Phase-19-Lauf.

## 28. Was Phase 19 ausdrücklich nicht beweist

Keine Produktlücke ist behoben. Sie beweist keine reale Mail, Datei,
Datenschutz-Erasure, Provider-, Payment-, Worker-, MFA-, Firmen-, Search-,
Markt-, AVG-, Tax-, Staging- oder Produktionsfreigabe.

### Verbindliche Referenzen

- [`remediation-execution-contract.md`](./remediation-execution-contract.md)
- [`remediation-traceability.md`](./remediation-traceability.md)
- [`requirements-matrix.md`](./requirements-matrix.md)
- [`architecture-blueprint.md`](./architecture-blueprint.md)
- [`decisions.md`](./decisions.md)
- [`route-role-matrix.md`](./route-role-matrix.md)
- [`evidence/README.md`](./evidence/README.md)

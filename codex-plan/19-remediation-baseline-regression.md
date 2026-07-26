# Phase 19 — Remediation-Baseline und Regressionsschutz

> **Status: GEPLANT / NICHT BEGONNEN.** Diese Phase ist die zwingende
> Ausführungsschranke vor jeder Remediation am Produktcode. Die statische
> Analyse und die neuen Planungsdokumente ersetzen weder einen frischen
> Golden Run noch einen unveränderlichen Evidence-Commit.

## Ziel

Den aktuellen Repositoryzustand reproduzierbar versiegeln, alle 28 Befunde
gegen denselben Stand zurückverfolgen und die Null-Regressions-Basis für die
Phasen 20–32 schaffen.

## Ausgangslage und bestätigte Probleme

- Die historischen Phasen 01–18 sind innerhalb ihres kontrollierten
  Mock-MVP-Vertrags abgeschlossen.
- Der letzte vollständige Release-Gate gilt für den Code-Commit `a9f24e7`.
  Danach folgten die kommerziellen Schutzkorrekturen in `22ea451` und der
  reine Evidence-Commit `eb9b45a`.
- Auf `22ea451` liefen Unit, Lint, Build und ein gezielter
  PostgreSQL-Funneltest; der vollständige Integrations-, Browser- und
  Recovery-Gate wurde danach nicht erneut ausgeführt.
- `STH-001` bis `STH-028` sind in
  [remediation-traceability.md](./remediation-traceability.md) unabhängig
  klassifiziert. Keine ID darf während der Umsetzung verloren gehen.
- Lokale Nutzeränderungen an `components/layout/brand-link.tsx` und `.claude/`
  gehören nicht zur Remediation-Baseline.

## Betroffene Problem-IDs

Alle `STH-001` bis `STH-028` als Governance-, Baseline- und
Traceability-Vertrag. Diese Phase behebt noch keinen Produktbefund.

## In Scope

- Clean-Clone-/detached-Worktree-Golden-Run auf dem gewählten Baseline-Commit.
- Commit-, Runtime-, Migrations-, Route-, Schema-, Provider- und Testinventar.
- Verifizierte Liste aller kritischen Nutzerreisen und Owning-Tests.
- Query-/Queue-/Sitemap-/Admin-Cap-Baselines für spätere Performancevergleiche:
  insbesondere heutige Berufsquery-/Alert-/Recommendation-Semantik, das
  Cluster-V1-Coverage-Verfahren sowie Sitemap-Count/Bytes/Laufzeit/Headroom.
- Vollständige Zuordnung Problem → Phase → Test → Evidence → externer Gate.
- Feature-Flag-, Migrations-, Rollback- und Datenkompatibilitätskonventionen.
- Neuer Remediation-Branch erst nach sauberer Scope-Prüfung.

## Out of Scope

- Produkt-, Schema-, Provider- oder UI-Implementierung.
- Neuinterpretation oder rückwirkendes Umschreiben der Phasen 01–18.
- Push, Merge oder Produktionsaktivierung ohne ausdrückliche Freigabe.
- Anerkennung historischer Testzahlen als frischer Pass des aktuellen HEAD.

## Rollen und geschützte Prozesse

Alle Rollen sind betroffen: Public, Candidate, Employer, Recruiter, Company
Owner/Admin/Viewer, Platform Admin und System/Ops. Besonders zu schützen sind:

- Public Eligibility, Suche, Ranking, Boost-Kennzeichnung, SEO und Fair Score;
- Registrierung, Login, JobPass, Apply, Alerts, Messages, Privacy und Radar;
- Company, Team, Jobs, Pipeline, Billing, Credits und Boosts;
- Moderation, Support, Privacy, Import, Billing, Audit und Systemoperationen;
- Tenant-/Owner-/Assignment-Grenzen, Idempotenz, Ledger und Snapshots.

## Betroffene Dateien und Module

- `codex-plan/**`, `BUILD_REPORT.md`, `README.md`, `.env.example`
- `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed/**`
- `app/**`, `components/**`, `lib/**`, `scripts/**`, `tests/**`
- `.github/workflows/ci.yml`, `playwright.config.ts`, Vitest-Konfigurationen

## Datenmodell und Migration

Keine fachliche Migration. Es wird nur ein unveränderliches Inventar aus
Schema, 43 bestehenden Migrationen, Constraints, Indizes und Seed-Manifest
erzeugt. Abweichungen zwischen leerer Datenbank, Upgradepfad und Seed gelten als
Blocker und werden nicht durch Datenreset kaschiert.

## Implementierungsschritte

- [ ] Baseline-Commit, Branch, Remotes und fremde Arbeitsbaumänderungen
  redigiert protokollieren.
- [ ] Einen sauberen isolierten Clone/Worktree exakt auf dem Baseline-Commit
  erstellen; keine lokale `.env`, Datenbank oder Nutzerdatei erben.
- [ ] Gepinnte Node-/npm-/Docker-/PostgreSQL-Versionen prüfen.
- [ ] `npm ci`, Env-/Schema-/Compose-Prüfung, Migration und Seed zweimal
  reproduzierbar ausführen.
- [ ] Lint, Typecheck, alle Unit- und PostgreSQL-Integrationstests ausführen.
- [ ] Production-Build, HTTP, HSTS und vollständigen Zero-Retry-Browsergate
  ausführen.
- [ ] Route-, Plan-, Secret-, Dependency- und License-Audits ausführen.
- [ ] Release-/Backup-/Restore-Gate gegen eine explizit isolierte Datenbank
  ausführen; keine bestehende Datenbank verändern.
- [ ] Für die gewählten Startcluster ein vor Shadowresultaten eingefrorenes
  Berufsquery-Inventar anlegen: heutige must-find-/must-not-find-Resultate,
  False-Zeros, Search↔Alert-Abweichungen, `desiredTitles`-Einfluss,
  Cluster-V1-Proxy und Query-Plan/p50/p95. Das ist Baseline, keine
  Fachfreigabe; Track 31A liefert anschließend das fachliche Judgment-Korpus.
- [ ] Kritische Query Shapes, Admin-Caps und Recommendation-Fan-out als
  Vergleichswerte dokumentieren.
- [ ] Sitemap-Baseline getrennt dokumentieren: Formel und Count pro
  Ressourcentyp, gemeinsame Summe, unkomprimierte Bytes, Laufzeit/DB-Batches,
  letzter Erfolg, 7-/30-Tage-Wachstum und 90-Tage-Prognose. Repo-/DEMO-Werte
  werden nicht als reale Production-Zahl ausgegeben.
- [ ] Für STH-027 anhand der Zielumgebung `P3 DEFERRED / MONITORED` oder
  ausgelösten Ausbau entscheiden: unter 70 % mit Headroom/Alert/Owner, ab 70 %
  verbindlicher Shardplan, spätestens vor 80 % Cutover; Capacity-/Byte-/
  Timeout-/p95-Fehler eskalieren sofort. Diese Messung ist kein
  unconditionaler Sitemap-Umbau.
- [ ] Für jede STH-ID Owning-Tests und noch fehlende Abnahmetests bestätigen.
- [ ] Erst nach grünem, dokumentiertem Gate den Remediation-Branch und die
  Umsetzungsreihenfolge freigeben.

## Sicherheits- und Datenschutzfolgen

Die Phase erzeugt keine personenbezogenen Testartefakte außerhalb isolierter
DEMO/TEST-Datenbanken. Logs und Evidence enthalten keine Secrets, Tokens,
vollständigen Verbindungs-URLs, Backup-Bytes oder reale Identitäten.

## Abhängigkeiten

Keine Produktphase. Docker/PostgreSQL und die gepinnte Runtime müssen
verfügbar sein. Ein fehlendes Pflichtwerkzeug ist `Needs Verification` und
blockiert jeden Produkttrack nach Phase 19, einschließlich Phase 20 und 30A.

## Risiken und Regressionen

- Ein Golden Run auf einem anderen Commit erzeugt falsche Baseline-Evidence.
- Lokale Nutzeränderungen könnten versehentlich gestaged oder getestet werden.
- Ein roter historischer Test darf nicht gelöscht, geskippt oder abgeschwächt
  werden.
- Ein Datenbankreset könnte echte Upgradeprobleme verbergen.

## Abwärtskompatibilität und Rollback

Keine Runtimeänderung. Dokumentänderungen sind per Git revertierbar. Temporäre
Worktrees, Datenbanken und Recovery-Artefakte werden nur anhand explizit
allowlist-geprüfter Namen entfernt.

## Verifikation

- [ ] Vollständige Baseline-Befehlstabelle mit Exit-Codes vorhanden.
- [ ] Leere Migration, Upgradepfad und Seed×2 sind konsistent.
- [ ] Vollständige Unit-/Integration-/Browser-/Release-Gates sind grün.
- [ ] Alle 28 STH-IDs besitzen Owner-Phase, Risiko, Test und Gate.
- [ ] STH-019 besitzt eine reproduzierbare Ist-Ergebnismenge je zentraler
  Startcluster-Query; STH-027 besitzt Count-/Byte-/Forecast-Headroom und einen
  dokumentierten Triggerstatus.
- [ ] `git diff --check`, Plan- und Linkaudit sind grün.
- [ ] Fremde Arbeitsbaumänderungen sind weder Teil noch Voraussetzung.

## Evidence

Der Abschluss benötigt einen neuen Record nach dem Vertrag in
`codex-plan/evidence/README.md`. Er muss den unveränderlichen Baseline-Commit,
die isolierte Umgebung und sämtliche tatsächlichen Ergebnisse nennen. Eine
statische Codeanalyse allein ist kein Abschlussnachweis.

## Definition of Done

- [ ] Der Golden Run ist auf exakt einem unveränderlichen Commit reproduzierbar.
- [ ] Keine Pflichtprüfung ist übersprungen oder nur aus alter Evidence geerbt.
- [ ] Die Remediation-Traceability ist vollständig und widerspruchsfrei.
- [ ] Kritische Invarianten und Rollbackkonventionen sind freigegeben.
- [ ] Loading-, Empty-, Error-, Locked-, Retry-, Conflict- und Success-Zustände
  sowie relevante Mobile-Ansichten sind im kritischen Flussinventar erfasst.
- [ ] Es existiert keine ungeklärte P0-Regression innerhalb des bestehenden
  Phase-01–18-Vertrags und kein ungeklärter roter Pflicht-Gate; die
  dokumentierten offenen Remediation-P0s bleiben erwartungsgemäss offen.
- [ ] Erst danach darf Produktcode in Phase 20 oder einem anderen
  Remediation-Track wie 30A verändert werden.

## Offene externe Voraussetzungen

Keine Fachfreigabe wird in dieser Phase erteilt. Hosting-, Provider-, Legal-,
Privacy-, Tax-, AVG-, On-call- und Marktfreigaben bleiben ausdrücklich offen.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Verhindert, dass Remediation auf einer unbewiesenen oder bereits regressierten Basis startet. |
| Requirements / Rollen | Alle STH-IDs und Rollen; keine fachliche Mutation. |
| Prerequisites | Historischer Stand 01–18; sauberer isolierter Baseline-Commit. |
| Deliverables | Golden-Run-Evidence, Traceability, Startcluster-Search-/Alert-/Recommendation-Istbaseline, Sitemap-Headroom-/Triggerstatus, Branch- und Rollbackvertrag. |
| Security / Privacy | Keine Secrets/PII in Evidence; keine fremde Datenbank oder lokale Nutzerdatei. |
| Tests | Vollständige bestehende Gates ohne Skip/Retry-Kaschierung. |
| Expected Result | Reproduzierbarer grüner Ausgangspunkt für Phase 20. |
| Risks / Limits | Historische Evidence ist Kontext, kein frischer Pass. |

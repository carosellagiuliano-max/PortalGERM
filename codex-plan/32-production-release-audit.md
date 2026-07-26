# Phase 32 — Finaler Produktions- und Release-Audit

> **Status: GEPLANT / NICHT BEGONNEN.** Diese Phase wird erst nach allen
> freigegebenen Remediation-Phasen ausgeführt. Sie implementiert keine
> versteckten Features, sondern schließt Befunde im Owning-Bereich und
> wiederholt danach den gesamten Releasevertrag.

## Ziel

Auf exakt einem unveränderlichen Releasecommit und demselben deployten Artefakt
beweisen, welche STH-Befunde geschlossen, extern offen oder bewusst
deaktiviert sind und welche Launchklasse sicher zulässig ist.

## Ausgangslage und Problem-ID

- `STH-024` bestätigt: der frühere manuelle Vier-Rollen-Walkthrough lief auf
  einem Vorgängercommit; aktuelle Automation ist stark, aber menschliche
  Sichtprüfung und finaler Kandidat waren nicht identisch.
- Nach Remediation ändert sich der technische und externe Gate-Vertrag
  wesentlich; historische Phase-18-Evidence ist kein neuer Produktionsnachweis.

## In Scope

- Re-audit `STH-001` bis `STH-028` und Phasen 19–31.
- Clean Clone, Install, Env, Migration, Seed/Testfixtures und Upgrade.
- Vollständige Unit-, PostgreSQL-, Contract-, Provider-, Browser- und
  Performance-Suiten.
- Public/Candidate/Employer/Recruiter/Admin/System Cross-role-Journeys.
- Identity/Verification, Documents, Apply/External Tracker, Interview,
  Notifications, Privacy, Company Trust, Billing und Finance.
- Worker/Queue/DLQ/Replay, Provider Failure, Monitoring und Pager.
- Staging/Production Deploy, Migration, Rollback, Backup/Restore und Incident.
- Mobile, Firefox/WebKit/Chromium, Keyboard, NVDA/VoiceOver.
- Manueller Walkthrough auf exakt Commit + Artefaktdigest + Deployment.
- Launchurteil: Demo, kostenlose Beta, reale Bewerbungen, bezahlter Betrieb.

## Out of Scope

- Neue Features oder opportunistische Refactorings.
- Übertragen alter Häkchen ohne neue Target-Evidence.
- „Production-ready“ bei offenen P0-/P1-, Provider-, Legal-, Ops- oder
  Markt-Gates.
- Erfundene Credentials, Partner, Umsätze oder Freigaben.

## Rollen und Kernreisen

Mindestens:

1. Public Search → Job/Firma/Legal → Candidate Registration/Verify.
2. JobPass + echtes CV → interne Bewerbung → Employer Pipeline/Messages.
3. Externer Apply → Candidate Tracker.
4. Interview Proposal → RSVP/Reschedule/Reminder.
5. Employer Registration → Company Evidence → Admin Review → Publish.
6. Radar Search/Contact/Accept/Reveal mit unveränderter Privacy.
7. Sandbox/Live-gegatetes Billing → Webhook → Invoice/Entitlement/Reconcile.
8. Privacy Export/Delete/Correct inklusive Dokumenten und Restore-Schutz.
9. Admin Least Privilege/MFA/Step-up/Break-glass.
10. Worker/Providerfehler → Retry/DLQ/Replay/Alert/Incident.

## Betroffene Dateien und Artefakte

Gesamtes Repository, `BUILD_REPORT.md`, README, Env-Katalog, Route-/Role-/
Requirements-/Remediation-Matrix, Release-Checkliste, Runbooks, Evidence Index
und Deploymentartefakt-/SBOM-/Migration-/Backup-Manifeste.

## Datenmodell und Migration

Keine neue fachliche Migration in dieser Phase. Schema-/Migration-/Backfill-
Probleme werden in der Owning-Phase behoben und anschließend der Audit neu
gestartet. Der Release prüft leere DB, Upgrade von Baseline, Rollback und
Restore.

## Sicherheits- und Datenschutzfolgen

- Releaseartefakte/Logs enthalten keine Secrets/PII/Backups.
- Penetrations-/Threat-Model- und Dependency-/License-Evidence wird geprüft.
- Externe Provider laufen nur in freigegebenen Sandbox/Staging/Live-Konten.
- Manuelle Tests nutzen kontrollierte Testidentitäten und dokumentierte
  Löschung.

## Audit-Schritte

- [ ] Releasecommit einfrieren, signieren/identifizieren und Artefaktdigest
  erzeugen.
- [ ] Clean Clone und Supply-Chain-/Secret-/Dependency-/License-/SBOM-Audit.
- [ ] leere Migration, Baseline-Upgrade, Backfill, Seed/Testfixture und
  Rollback.
- [ ] Lint, Typecheck, vollständige Unit/Integration/DB/Contract-Suiten.
- [ ] Build, HTTP, HSTS und alle Browser-/A11y-/Performance-/Load-Gates.
- [ ] alle Kernreisen und negativen Cross-role/Tenant/Owner-Fälle.
- [ ] Provider-Sandbox/Failure/Webhook/Storage/Email/Queue-Evidence.
- [ ] Privacy Export/Erasure/Retention/Hold/Restore.
- [ ] Staging deploy → smoke → migration → rollback → redeploy.
- [ ] Backup/Restore, gemessene RPO/RTO und Incident/Pager Drill.
- [ ] vollständiger manueller Rollenwalkthrough auf exakt diesem Artefakt.
- [ ] alle 28 STH-Dossiers mit finalem Status/Evidence aktualisieren.
- [ ] je öffentlichem Startcluster Phase-30A-Query-/Taxonomie-/Search-/Alert-/
  Recommendation-/Cluster-V2-Evidence prüfen; kein V1-Proxy als Ersatz.
- [ ] STH-027 mit realem Count-/Byte-/Laufzeit-/Forecast-Stand bewerten:
  datiert `P3 DEFERRED / MONITORED` unter Trigger oder vollständig
  index-/shard-verifiziert bei ausgelöstem Ausbau.
- [ ] Launchklasse und verbleibende Risiken durch benannte Owner freigeben.

## Abhängigkeiten

Alle zur Ziel-Launchklasse notwendigen Findings/Tracks aus den Phasen 19–31
und externe Provider-, Legal-, Privacy-, Tax-, AVG-, Finance-, Operations- und
Marktevidence. Eine gemischt priorisierte Phase wird nicht pauschal verlangt:
nicht ausgelöste P3-Arbeit benötigt einen belegten Deferred-Vertrag.

## Risiken und Regressionen

- Auditfix wird nach Commit eingebaut, ohne alle Gates neu auszuführen.
- Manual Walkthrough verwendet anderen Commit/Artefakt/Environment.
- Externe Gate-Behauptung ist nicht schriftlich belegbar.
- Full Suite wird durch Retries/Skips/Allowlist-Abschwächung kaschiert.
- Productiondaten werden für Test oder Restore gefährdet.

## Rollbackstrategie

Release benötigt getesteten App-/Worker-/DB-/Provider-/DNS-Rollback mit
expliziten Stop-Kriterien. Ein roter Gate stoppt Freigabe; er wird nicht in der
Auditphase wegdokumentiert. Backups/Restoreziele sind allowlist-geprüft und
isoliert.

## Akzeptanzkriterien

### Automatisiert

- [ ] alle Pflichtruns Exit 0, Retry 0 wo vorgesehen, kein Skip.
- [ ] Schema/Migration/Upgrade/Rollback/Restore konsistent.
- [ ] alle Rollen/Tenants/Provider/Worker/Payments/Privacy-Grenzen grün.
- [ ] 3 Browserengines, Desktop/Mobile, serious+critical A11y und Budgets.
- [ ] Security/Secret/Dependency/License/SBOM ohne ungeklärten Blocker.

### Manuell / extern

- [ ] Public, Candidate, Employer, Recruiter, Admin und Ops auf exakt
  Releasecommit/Artefaktdigest.
- [ ] Keyboard/Screenreader/360 px und Console/Network geprüft.
- [ ] Provider-, Pager-, Backup-, Restore-, Rollback- und Incident-Owner.
- [ ] Legal/Privacy/Tax/AVG/Finance/Market-Gates schriftlich klassifiziert.

## Launchklassen

| Klasse | Mindesturteil |
|---|---|
| Kontrollierte Demo | Mocks sichtbar, keine realen PII-/Geldversprechen. |
| Kostenlose Beta | Phasen 20–23, Admin-Security aus Phase 25 und die zielrelevante Phase-29-UX/A11y sind belegt; reale Identity/Email/Documents/Privacy/Ops, alle Kauf-CTAs geschlossen. Sobald ein Startcluster öffentlich suchbar/beworben ist, ist Track 30A für dessen Sprache/Berufe Pflicht. Admin-/Supportzugriff auf reale PII bleibt ohne Phase 25 vollständig deaktiviert. |
| Reale Bewerbungen | zusätzlich Company Trust aus Phase 26, Recruiting aus Phase 28, Retention und Support vollständig sowie Track 30A je öffentlichem Bewerbungscluster; Phase 27 nur, falls Multi-Persona Teil des Scopes ist. |
| Bezahlter Betrieb | zusätzlich Phase 24 Finance/Payment sowie Tax/Legal/Reconciliation. |
| Breiter Production Launch | zusätzlich zielrelevanter Track 30B, Phase-31-Marktevidence, nachgewiesene Clusterliquidität, SLO/RPO/RTO, On-call und finaler Audit. Track 30C/STH-027 braucht bei niedrigem Headroom nur Monitoring/Deferred-Evidence, bei ausgelöstem Capacity-/Forecast-/Performance-Gate zwingend Index/Shards. |

## Evidence und Definition of Done

- [ ] Der manuelle Walkthrough und alle technischen Gates referenzieren exakt
  denselben Releasecommit und Artefaktdigest.
- [ ] Jede STH-ID besitzt einen finalen Status und direkte Evidence.
- [ ] Keine bekannte P0-/P1-Regression der Ziel-Launchklasse ist offen.
- [ ] Kein öffentlich aktivierter Startcluster besitzt einen bekannten
  zentralen False-Zero trotz passender Stelle oder abweichende Berufssemantik
  zwischen Search, Alert und Recommendation.
- [ ] Alle extern offenen Punkte besitzen Owner, Blocker und sichere
  Deaktivierung.
- [ ] Loading-, Empty-, Locked-, Error-, Retry-, Conflict- und Success-Zustände
  der zielrelevanten Kernreisen sind manuell und automatisiert belegt.
- [ ] BUILD_REPORT und Go-live-Status sind präzise, reproduzierbar und
  widerspruchsfrei.
- [ ] Push/Merge/Deployment erfolgen nur nach ausdrücklicher Freigabe.

## Abschlussfragen

Der Evidence-Record beantwortet ausdrücklich alle im Remediation-Auftrag
genannten Fragen: bestätigte/abweichende Befunde, gelöste/offene Punkte,
Phasen, Dateien/Modelle/Migrationen, geschützte Funktionen, Regressionstests,
Tenant-/Rollenstatus, End-to-End-Flows, Mock-/Realprovider, Feature Flags,
zulässige Launchklassen, Rest-Risiken, fünf größte Reifeverbesserungen und drei
höchste Rentabilitätspotenziale.

## Offene externe Voraussetzungen

Alle zur gewählten Launchklasse gehörenden schriftlichen Freigaben. Ein fehlender
externer Nachweis bleibt `BLOCKED BY EXTERNAL GATE`, nicht `[x]`.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Reproduzierbare Entscheidung, welcher reale Launch verantwortbar ist. |
| Problem-ID | STH-024; finale Re-Audit-Verantwortung für STH-001–028. |
| Prerequisites | Alle zielrelevanten Findings/Tracks aus 19–31 und externe Gates; P3 nur bei Trigger, sonst datiert deferred. |
| Deliverables | Immutable RC, vollständige Evidence, exact-artifact walkthrough, Launchurteil. |
| Security / Privacy | Isolierte Testdaten, keine Secrets/PII-Artefakte, getesteter Rollback/Restore. |
| Tests | Full clean-clone, DB, providers, worker, browser/A11y, performance, incident. |
| Expected Result | Keine Diskrepanz zwischen geprüftem Code, Artefakt und menschlichem Walkthrough. |
| Risks / Limits | Ein grüner technischer Build ersetzt keine Legal-/Provider-/Marktfreigabe. |

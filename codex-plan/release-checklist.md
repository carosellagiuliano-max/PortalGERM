# Phase-18 Release-Checkliste

> **Arbeitsdokument, kein eigenständiger Pass-Nachweis.** Runtime-Häkchen
> beziehen sich auf den unveränderlichen Code-Commit; Plan-, Link-, Secret-,
> License-, Dependency- und Diff-Häkchen auf den nachfolgenden reinen
> Dokumentations-Close-out. Beide Prüfstände sind im datierten
> Phase-18-Evidence-Record getrennt belegt. Externe Go-live-Gates bleiben
> offen, auch wenn der lokale technische Release-Drill grün ist.

## Release-Identität

| Feld                      | Wert                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| verifizierter Code-Commit | `a9f24e7190681c23886de84add321db32b43651e`                                 |
| Branch                    | `codex/phase-18-release-audit`                                             |
| E2E-08 Start/Ende         | `2026-07-24T16:26:24.308Z` / `2026-07-24T16:32:37.438Z`                    |
| Operator/Reviewer         | Codex · technischer Selbstreview; keine unabhängige Fach-/Go-live-Freigabe |
| Phase-18-Evidence         | [`evidence/2026-07-24-phase-18.md`](./evidence/2026-07-24-phase-18.md)     |
| BUILD_REPORT              | [`../BUILD_REPORT.md`](../BUILD_REPORT.md)                                 |

## Preflight

- [x] Phasen 01–17 und ihre Ziel-Evidence sind verlinkt.
- [x] Der verifizierte Code-Commit ist unveränderlich benannt; der zu prüfende Clone ist sauber.
- [x] Node `24.18.0`, npm `11.16.0`, PostgreSQL `16`, Docker/Compose, Age und Playwright-Version sind erfasst.
- [x] `DATABASE_URL` und `TEST_DATABASE_URL` zeigen auf getrennte, ausdrücklich erlaubte Ziele.
- [x] Env-Werte wurden validiert und weder ausgegeben noch committed.
- [x] Lokale Nutzeränderungen, `.env*`, Backup-, Identity-, Build- und Testartefakte sind ausserhalb des Release-Diffs.
- [x] [Deployment](./runbooks/deployment.md), [Rollback](./runbooks/rollback.md), [Recovery](./runbooks/backup-restore.md) und [Incident Response](./runbooks/incident-response.md) wurden technisch reviewed.

## Reproduzierbare Qualitätsgates

- [x] `npm ci`
- [x] `npm run env:validate`
- [x] `npm run db:generate`
- [x] `npm run db:validate`
- [x] `npm run db:migrate`
- [x] `npm run db:migrate:status`
- [x] `npm run db:seed` zweimal mit identischem vollständigem Manifest
- [x] `npm run seed:verify`
- [x] `npm run db:smoke`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run test:integration`
- [x] `npm run build`
- [x] `npm run test:e2e:http`
- [x] `npm run test:e2e:browser` mit Retry `0`
- [x] `npm run test:e2e:hsts`

Jeder Eintrag benötigt Exit-Code, Laufzeit/Ergebnis und Zielcommit im
Evidence-Record. Ein früherer Phase-17-Lauf ist Regressionsbasis, ersetzt aber
keinen Lauf auf dem Phase-18-Release-Commit.

## E2E-08 — Clean Release und Recovery

- [x] `npm run test:release` lief aus dem Release-Commit.
- [x] Ein echter `git clone --no-local` wurde detached auf den Zielcommit gestellt.
- [x] `env:init -- --ci` validierte vorab bereitgestellte Variablen und schrieb keine Env-Datei.
- [x] Leere Source-, Restore- und Production-Guard-Datenbanken hatten allowlist-konforme, verschiedene Namen.
- [x] Der Production-Demo-Seed scheiterte vor dem ersten User-/Manifest-Write.
- [x] Backup streamte ohne Klartext über `pg_dump -Fc` und Age in eine externe `.dump.age`.
- [x] Ciphertext und `.sha256` waren vorhanden; Digest und verschlüsselte Bytezahl wurden erfasst.
- [x] Restore erfolgte nur in die leere, getrennte Restore-DB.
- [x] Migration, Seed-Manifest und DB-Smoke bestanden nach Restore.
- [x] Public Desktop/360px sowie Candidate-, Employer-, Recruiter- und Admin-Login bestanden nach Restore.
- [x] Forgot Password → geschützte lokale Mailbox → einmaliges Reset → Login bestand.
- [x] RPO/RTO wurden gemessen und nur gegen die noch unbestätigten Hypothesen verglichen.
- [x] Clone, Identity, Ciphertext/Sidecar und alle drei Drill-Datenbanken wurden entfernt.
- [x] `test-results/phase18/run-manifest.json` meldet `passed` und enthält keine Secrets/Backup-Bytes.

## Trace-, Route- und Security-Audit

- [x] `npm run route:audit` stimmt mit `codex-plan/route-inventory.json` überein.
- [x] [Route-/Rollen-Matrix](./route-role-matrix.md) deckt alle 103 Seiten und 16 Handler ab.
- [x] Candidate-/Employer-/Admin-Mutationen besitzen Pending-Zustände; keine
      breite private Streaming-Grenze verdeckt echte Tenant-/Owner-404-Status;
      Fehler-/404-/Locked-Zustände sind nachvollziehbar.
- [x] Der manuelle Vier-Rollen-Walkthrough nennt Route, Fixture, Desktop/360px, Tastatur/Fokus und Resultat.
- [x] `npm run plan:audit` meldet keine `[x]` ohne erreichbare Target-Evidence und keine gebrochenen lokalen Links.
- [x] Alle 51 P0-/P0-P1-Zeilen und E2E-01–08 besitzen im Abschlussrecord Requirement → Test → Evidence.
- [x] `npm run security:release-scan` ist grün.
- [x] `npm run license:audit` ist technisch grün; offene rechtliche Bewertung bleibt separat.
- [x] `npm audit --audit-level=moderate` hat keinen ungelösten Befund.
- [x] Git-Diff-/Deletion-/Whitespace- und generierter-Artefakt-Audit sind sauber.

## Dokumentation und Übergabe

- [x] README beschreibt Produkt, Stack, Architektur, Setup, Env, DB/Seed, Demo-Konten, Routen/Rollen, Monetarisierung, Mocks, Security, Grenzen, Provider-Swap, Deployment und Disclaimer.
- [x] `.env.example` entspricht dem finalen Env-Vertrag und enthält nur erkennbare Platzhalter.
- [x] Evidence-Index enthält alle abgeschlossenen Records.
- [x] `BUILD_REPORT.md` nennt Befehle, Ergebnisse, Mocks, Grenzen und offene Gates.
- [x] Phase-18-Detaildatei wurde zuerst anhand der Evidence aktualisiert.
- [x] Erst danach wird Phase 18 im Masterplan abgeschlossen.

## Externe Gates — bewusst offen

Diese Punkte dürfen nicht durch einen lokalen Test auf `[x]` wechseln:

- [ ] echte Preview-/Staging-/Production-Umgebungen mit getrennten Secrets/DBs;
- [ ] Staging-Smoke und reale HTTPS-/Ingress-/HSTS-Wirkung;
- [ ] Legal-/Privacy-/Tax-Freigabe;
- [ ] flowspezifische AVG/AVV-Beurteilung des Stellenmarkt-, Bewerbungs-,
      Radar-, Contact-/Reveal- und Entgeltmodells; erforderliche kantonale sowie
      gegebenenfalls eidgenössische Bewilligung oder schriftliche
      Nicht-Bewilligungspflicht;
- [ ] vorab definierter Design-Partner-Test mit echtem Geldfluss; lokale
      Mock-Bestätigungen und Provider-Testmode zählen nicht als Paid Conversion;
- [ ] Freigabe realer Provider, DPA, Webhooks/Retry/Monitoring;
- [ ] versionierter, rechtmässiger und fachlich geprüfter LIVE-Lohndatensatz
      samt Berufsgruppen-/Grossregionsmapping, Attribution, Unsicherheit und
      Refresh Owner, bevor `/salary-radar` indexiert/in die Sitemap aufgenommen
      wird;
- [ ] monatliches 18-/24-Monats-Cashflow-/Runway-Modell vor Hiring oder
      bezahlter Akquise;
- [ ] produktiver verschlüsselter Storage-Lifecycle `30 daily + 12 monthly`;
- [ ] Business-Freigabe RPO ≤24 h und RTO ≤8 h;
- [ ] benannter Incident Owner, On-call/Pager und getestete Übung;
- [ ] reale Export-/Lösch-/Retention-Prozesse;
- [ ] autonomer Worker/Outbox mit Retry, Dead-Letter, Monitoring und
      Restart-/Concurrency-/Failure-Recovery für Renewal, Alerts und fällige
      Projektionen vor unbeaufsichtigtem öffentlichen Self-Service.

## Remediation-Zusatz für den nächsten öffentlichen Start

> Diese offenen Gates ergänzen den historischen Phase-18-Record. Sie sind keine
> rückwirkende Phase-18-Evidence und werden erst auf dem künftigen
> Releasekandidaten bewertet. Für Phase 19–33 gilt der
> [Remediation-Ausführungsvertrag](./remediation-execution-contract.md);
> Zielcommit, Artefakt und Evidence dürfen nicht auseinanderfallen.

### Zielklasse und Finding-Scope

- [ ] Genau eine Zielklasse ist benannt: LC1 lokale Demo, LC2 beaufsichtigter
      Design-Partner-Test, LC3 Invite-only Pilot, LC4 öffentlicher kostenloser
      Launch, LC5 bezahlter Self-Service oder LC6 skalierter Betrieb.
- [ ] Die zielklassenspezifische P0–P4-Matrix für `STH-001`–`STH-037`
      besitzt für jede Zeile Status, Owner und Evidence beziehungsweise einen
      zulässigen Deferred-/External-Gate-Entscheid.
- [ ] Plan-, Technical-, Quality- und Activation-Status sind getrennt.
      Ein implementierter Adapter oder ein grüner Test ist keine LIVE-Freigabe.
- [ ] Phase 26 ist vor öffentlichem Trust-Badge, öffentlichem Firmenjob oder
      Radar-Vertrauensbehauptung grün. Phase 28 ist nur Pflicht, wenn Tracker oder
      Scheduler Bestandteil des konkret verkauften/kommunizierten Scopes ist.
- [ ] G0–G4 sind nachweislich auf dem vorgesehenen Commit durchlaufen; Seed
      lief zweimal deterministisch und alle Änderungen nach Freeze lösten den
      erforderlichen Neulauf aus.

### Zwingend vor Start eines öffentlichen Kandidatenclusters

- [ ] Phase 31A hat aus Pflege/Gesundheit und Engineering/Technik genau einen
      ersten Cluster gewählt; das jeweils separate Korpus des nichtgewählten
      Clusters erteilt keine Freigabe und dessen Oberfläche bleibt fail-closed.
- [ ] Die wichtigsten Berufsbezeichnungen, Schweizer Synonyme, Abkürzungen,
      neutralen/geschlechtsspezifischen Formen, Schreib-, regionalen und
      Singular-/Pluralvarianten sowie kontrollierten häufigen Tippfehler des
      Startclusters sind versioniert und fachlich freigegeben.
- [ ] Ort/erreichbare Region, Qualifikation, Zertifikat, Skill und Branche
      verwenden kontrollierte gemeinsame Konzepte; Search, Alert, Preferences,
      Recommendation, Matching und Cluster-Assessment driften nicht.
- [ ] Fachlich gleichwertige Berufsbezeichnungen liefern konsistente relevante
      Resultate; dokumentierte Gegenbeispiele verhindern eine unkontrollierte
      Ausweitung auf verwandte oder falsch qualifizierte Berufe.
- [ ] Public Search, Job-Alerts, Candidate Preferences, Recommendations und
      Matching verwenden dieselben Berufs-Konzept-IDs und dieselbe
      Taxonomieversion.
- [ ] Die Suchqualität wurde mit einer dokumentierten Startcluster-Testmenge
      aus must-find/must-not-find und relevanten Top-K-Urteilen geprüft.
- [ ] Für zentrale Suchbegriffe existiert bei vorhandener passender
      indexierbarer Stelle kein bekannter Zero-Result-Fehler.
- [ ] Das Cluster-Launch-Assessment bindet Query-Set-, Search-Policy-,
      Ranking- und Taxonomieversion; alte V1-Approvals oder reine
      Location-/Kategorie-/`Stellen`-Treffer genügen nicht.
- [ ] Nulltreffer-/Unknown-Term-Lernen verwendet nur thresholded,
      retention-begrenzte Aggregate ohne Raw-PII/stabilen Nutzerfingerprint und
      führt ausschliesslich über fachlichen Review zu einer Taxonomieänderung.
- [ ] Reconfirmation, Ablauf, Filled-/Unavailable-Meldung,
      Duplicate-/Copied-Job-Prüfung und Deaktivierung wirken innerhalb des
      freigegebenen SLO auf alle öffentlichen/privaten Consumer.
- [ ] Company-Evidenz, Ablauf/Re-Review und schneller Widerruf sind belegt;
      kompromittierte Firmen verlieren Badge, Jobs und Radarzugang konsistent.
- [ ] Credential-Stuffing-/ATO-/Scam-/Mass-Contact-/Reveal-Export-Anomalie
      besitzt Detection, Containment, Recovery/Appeal und Incident-Runbook.
- [ ] Moderierte Candidate-/Employer-/Operator-Aufgaben bestehen die
      vorregistrierten Task-Success-, Zeit-, Fehler-, Abbruch- und
      Verständnisschwellen.

### Zusätzlich vor LC5 Paid Self-Service

- [ ] Vor Real-Payment-Ausbau bestand ein vorregistrierter WTP-Test für
      Basisworkflow/Hiring-Sprint/Retainer/Concierge/Import; Mock- und
      Provider-Testmode zählen null. Boost folgt nur dem Reichweitenbeleg, Radar
      nur ausreichender Dichte.
- [ ] Hosted Checkout/Webhook, serverseitiger Betrag, Idempotenz,
      Reconciliation, Dunning/Dispute, Tax/Invoice und Payment-Fraud sind auf
      Sandbox und freigegebener LIVE-Konfiguration belegt.
- [ ] Checkout, Billing-/Security-Änderung sowie risikoreicher Bulk-
      Download/Export verwenden Non-Admin-Step-up.
- [ ] Jede bezahlte Leistung besitzt Scope, Frist, Kundenpflichten,
      Capacity-/Unit-Cost-Limit und eine auditable Plattformfehler-Abhilfe über
      Refund, Credit-Restoration beziehungsweise Rechnungskorrektur.

### Zusätzlich vor einem technischen Phase-33-Readinessurteil

- [ ] Notification-Verschlüsselung und Empfänger-Korrelation verwenden
      getrennte Delivery-AES-/Recipient-HMAC-Keyrings mit vollständigem
      Key-Version-Inventar; Resend API und Webhook binden unabhängige
      Secret-Versionen.
- [ ] Der exact-candidate-G4 belegt normalen 23-h- und maximalen 31-d-
      Empfänger-/Request-Wipe sowie exakt `400 × 24 h` bis zur one-way Attempt-
      PII/Receipt/Digest-Kompaktion bei unveränderlicher nicht-PII Auditkette;
      die Minuten-Maintenance läuft providerunabhängig auch nach Revoke.
- [ ] Network/5xx/408/malformed-2xx/concurrent-idempotency endet nach bounded
      Same-Key-Retry `PAUSED` und wird manuell reconciliert, nie blind erneut
      gesendet oder dead-lettered. Resend-Webhooks sperren die exakte
      Activation im selben TX; Inbox/Suppression sind append-only/monoton.

Diese technischen Checkboxen ersetzen keine Provider-, Legal-, Privacy-/DPA-,
AVG-/SECO-, Tax-/Finance-, Operations- oder Stagingfreigabe.

### Zusätzlich vor LC6 Scale

- [ ] Autonome Worker belegen Lease/Heartbeat, Retry/Backoff, Dedupe, DLQ,
      Replay, Backpressure und Providerdegradation ohne manuellen Cron-Vertrag.
- [ ] Produktionsnahe Last belegt SLO, RPO/RTO, Queue-/Supportkapazität,
      Vollkosten, Alarmierung, On-call und getestete Recovery.
- [ ] 30B/30C wurden nur bei ihren Query-/Queue-/Count-/Byte-/Forecast-
      Triggern aktiviert; andernfalls bestehen datierter Headroom, Owner, Alert
      und Runbook.

### Später sinnvoll beziehungsweise vor der Sitemap-Kapazitätsgrenze

- [ ] Aktuelle LIVE-Counts pro Ressource und gemeinsam, unkomprimierte
      Sitemap-Bytes, Laufzeit, letzter Erfolg und Wachstum/90-Tage-Prognose werden
      überwacht; Owner, Alert und Runbook sind benannt.
- [ ] Ein Sitemap-Index mit getrennten Ressource- und bei Bedarf
      Cluster-Shards wird nach dem freigegebenen Warnschwellenvertrag und jedenfalls
      vor Erreichen der 50.000-URL-/Bytegrenze umgesetzt.
- [ ] Das bestehende no-truncation-/fail-closed-Verhalten bleibt bis zum
      getesteten Cutover erhalten.

## Abschlussentscheidung

| Status                                                               | Zulässige Aussage                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| technische Checkliste/E2E-08 grün, externe Gates offen               | „Demo-ready, serverseitig gegatet, mit lokalen Mock-Providern“                                                                                   |
| Phase-33-exact-candidate-G4 inklusive CI grün, externe Gates offen   | `TECHNICALLY_READY_FOR_LC4` beziehungsweise `TECHNICALLY_READY_FOR_LC5_CONFIGURATION`; Aktivierung bleibt `ACTIVATION_BLOCKED_BY_EXTERNAL_GATES` |
| Staging oder externe Gates fehlen                                    | **nicht** „pilot-ready“ und **nicht** „production-ready“                                                                                         |
| ein P0-, Security-, Privacy-, Tenant-, Backup- oder Cleanup-Gate rot | Phase 18 bleibt offen                                                                                                                            |

Der Phase-33-Arbeitsbaum ist derzeit `IN_PROGRESS`; Technik und Quality sind
`PENDING`. Die zusätzliche Zeile ist eine zulässige spätere Urteilsform, keine
vorweggenommene Evidence oder Checkbox-Freigabe.

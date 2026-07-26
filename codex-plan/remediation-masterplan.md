# SwissTalentHub — Remediation-Masterplan

> **Planungsstand:** 26. Juli 2026. Dieses Dokument steuert die
> Remediation-Phasen 19 bis 32. Phase 19 ist auf
> `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c`, Phase 20 auf
> `59089009f54312a4c10989b7efde2d5fda9a2b8d` abgeschlossen und verifiziert;
> Phasen 21 bis 32 bleiben offen, bis ihre eigene unveränderliche
> Code-Evidence vorliegt. Daraus folgt weder Pilot- noch
> Produktionsfreigabe. Die abgeschlossenen Phasen 01 bis 18 und ihre
> historischen Nachweise werden nicht rückwirkend umgedeutet.

## 1. Auftrag, Geltungsbereich und Status

Der technische MVP ist als lokale, serverseitig geschützte Demo mit
persistierenden Mock-Providern stark belegt. Der neue Arbeitsstrang schliesst
die Lücke zwischen diesem Stand und einem kontrolliert betreibbaren,
rechtlich und kommerziell freigegebenen Produkt. Dazu werden die Befunde
`STH-001` bis `STH-037` nicht pauschal als Defekte behandelt, sondern nach
ihrem tatsächlichen Charakter:

- bestätigte interne Produkt- oder Techniklücke;
- teilweise bestätigter Befund mit bereits vorhandener Schutzwirkung;
- bewusst anders implementierter und weiterhin korrekter Demo-Vertrag;
- bereits behobener oder durch bestehende Evidence widerlegter Teilbefund;
- manuell zu verifizierender Zustand;
- externe Markt-, Rechts-, Daten-, Provider- oder Betriebsanforderung.

Die vollständige Einzelbewertung, Fundstellen, Rollen, Modelle,
Sollzustände, Risiken, Abhängigkeiten und Testbeweise stehen in
[`remediation-traceability.md`](./remediation-traceability.md). Bei einem
Widerspruch gelten weiterhin die Präzedenzregeln aus
[`00-PLAN.md`](./00-PLAN.md); dieser Remediation-Plan erweitert den
historischen Plan, ersetzt ihn aber nicht.

Für jede Ausführung ab Phase 19 gilt zusätzlich der
[`remediation-execution-contract.md`](./remediation-execution-contract.md).
Er trennt Plan-, Technical-, Quality- und Activation-Status, definiert die
28 Pflichtfelder jeder Phase, die vollständige AC→Test-Matrix sowie die
commitgebundenen Gates G0 bis G4. Eine Detailphase darf diese Felder nicht
nur verlinken, sondern muss sie für ihren eigenen Scope konkret
instanziieren.

### 1.1 Unveränderliche Analyse-Baseline

| Feld | Baseline |
| --- | --- |
| Repository | `PortalGERM` |
| frühere Analyseidentität | `eb9b45ae5caca638b558f6a98e406af9ee8be0fc` (`eb9b45a`) |
| aktueller geprüfter Branch | `codex/phase-18-release-audit` |
| ursprünglicher Planungscommit | `e34262e3074565840e371c336a5d2ba5cf3efbac` (`e34262e`) |
| Remote-Stand bei Prüfungsbeginn 26. Juli | `origin/main` und `origin/codex/phase-18-release-audit` zeigten auf `e34262e` |
| Arbeitsbaum bei Prüfungsbeginn | sauber; `brand-link.tsx` und `.claude/launch.json` sind bereits in `e34262e` committed |
| Aktivität der ursprünglichen Planprüfung | Repository-, Plan-, Schema-, Code-, Test- und Evidence-Analyse sowie Plan-Governance; damals noch keine Produktimplementierung und keine erneute vollständige Testausführung |
| gewählter Phase-19-Candidate | `769ee620b60bfae4b3c80f318e4cf3595ea8ff7c` (`769ee62`), beim Golden-Start/-Ende identisch mit `origin/main` |
| Phase-19-Evidence | [`evidence/2026-07-26-phase-19.md`](./evidence/2026-07-26-phase-19.md): vollständiger Clean Clone, 43 Migrationen, Seed×2, 1.974 Unit-, 369 PostgreSQL- und 219 Browsertests, Build/HTTP/HSTS sowie Recovery bestanden |
| Phase-20-Candidate | `59089009f54312a4c10989b7efde2d5fda9a2b8d` (`5908900`), Parent `8087c0c` |
| Phase-20-Evidence | [`evidence/2026-07-26-phase-20.md`](./evidence/2026-07-26-phase-20.md): 45 Migrationen, Seed×2, 1.984 Unit-, 408 PostgreSQL- und 233 Browsertests, Build/HTTP/HSTS sowie Provider-/Dispatcher-Failure-Gates bestanden; LIVE bleibt deaktiviert |

`eb9b45a` und `e34262e` bleiben historische Analyse-/Planungsidentitäten,
keine Releasekandidaten. Phase 19 wählte bei ihrem tatsächlichen Start den
damals aktuellen sauberen `origin/main`-Commit `769ee62` und testete genau
diesen neu. Die historische Evidence wird dadurch weder vererbt noch
umgeschrieben.

### 1.2 Präzise historische Evidence-Grenze

- Der unveränderliche Phase-18-Code-Commit
  `a9f24e7190681c23886de84add321db32b43651e` bestand unter anderem
  1.970 Unit-, 369 PostgreSQL-Integrations- und 219 Browsertests mit Retry
  `0`, Production-Build, HTTP/HSTS sowie den E2E-08-Clean-Clone- und
  Recovery-Drill. Diese Evidence gilt exakt für diesen Commit.
- Der spätere Commercial-/Salary-/AVG-Follow-up-Commit
  `22ea4516b2481ed6f3dc6537ab9c8a8d1c6aa670` bestand 1.974 Unit-Tests,
  Lint, Production-Build, fünf gezielte PostgreSQL-Tests sowie Plan-, Route-
  und Security-Audits. Er erhielt keinen vollständigen neuen Browser- oder
  manuellen Vier-Rollen-Nachweis.
- `eb9b45a` dokumentiert den Follow-up, ist aber in dieser
  Remediation-Planung nicht als vollständig neu getesteter Releasecommit zu
  behandeln.
- Der manuelle Phase-18-Walkthrough lief transparent ausgewiesen auf
  `f7158c7999b25da467f172d228b9d475ec00c127`, nicht auf dem späteren
  Ziel- oder Follow-up-Commit. `STH-024` bleibt deshalb ein echter
  Evidence-Abschlussauftrag für Phase 32.

Diese Unterscheidung schützt vor zwei falschen Schlüssen: Ein historisch
grüner Commit beweist nicht automatisch den heutigen Arbeitsbaum; ein
fehlender heutiger Testlauf macht die damals unveränderlich dokumentierte
Evidence aber auch nicht rückwirkend ungültig.

### 1.3 Technischer Phasenabschluss und LIVE-Aktivierung

Die Reihenfolge 19–32 unterscheidet zwei Arten von Abhängigkeiten, damit
Provider-, Operations-, Legal- und Security-Gates keinen Zirkelschluss bilden:

- **Implementierungsabhängigkeit:** Der Vorgänger besitzt Schema, Domain,
  Ports, Policies, Migration und lokal beziehungsweise in Sandbox gelaufene
  Contract-/Failure-Tests. Erst danach darf der Nachfolger darauf aufbauen.
- **Aktivierungsabhängigkeit:** Eine spätere Phase oder externe Freigabe wird
  für Staging/LIVE benötigt. Bis dahin bleibt der betreffende Modus
  fail-closed, kann den technisch belegten Vorgänger aber nicht rückwirkend zu
  einer produktionsreifen Funktion erklären.

Ein Phasenhäkchen belegt nur den vollständig umgesetzten und getesteten
Phasenvertrag auf seinem Codecommit. Es ist ausdrücklich keine
Produktionsfreigabe. Fehlt eine Aktivierungsabhängigkeit, nennt der
Evidence-Record `BLOCKED BY ACTIVATION GATE`, den sicheren deaktivierten
Zustand und den späteren Owner. Ein Nachfolger darf nach dem technischen
Schnittstellen-Gate beginnen; LIVE wird erst freigegeben, wenn alle
zielklassenspezifischen Aktivierungsabhängigkeiten zusammen erfüllt sind.

Prioritäten gelten auf Finding-/Track-Ebene, nicht pauschal pro Dateinummer:
P0/P1 blockiert die betroffene Launchklasse, P2 folgt nach dem Launchkern und
P3 ist beobachtete Kapazitätsvorsorge. Ein P3 darf nur deferred werden, wenn
Istwert, Headroom, Wachstumsforecast, Warnschwelle, Owner und Reaktionsplan
belegt sind; das Erreichen seines Triggers stuft die konkrete Arbeit hoch.

## 2. Zielzustände und zulässige Produktbehauptungen

Die Remediation trennt sechs Launchklassen. Eine höhere Klasse erbt die
Sicherheits-, Rechts-, Datenschutz-, Datenintegritäts- und Evidence-Garantien
der niedrigeren Stufen. Stufenspezifische Betriebsbeschränkungen wie
„beaufsichtigt“ oder „kein unbeaufsichtigter Pfad“ werden dagegen durch die
strengeren Betriebsnachweise der höheren Stufe abgelöst.

| Stufe | Zulässiger Zweck | Mindestgrenze | Unzulässige Behauptung |
| --- | --- | --- | --- |
| **LC1 Lokaler Demo-MVP** | Entwicklung, Tests, Stakeholder-Demo mit klar markierten Fixtures | Mock-Provider, Production-Demo-Guard, keine echten Personen-/Zahlungsdaten | WTP, reale Delivery, Pilot-/Produktionsreife |
| **LC2 Beaufsichtigter Design-Partner-Test** | kleine benannte Kohorte mit Operator je kritischem Schritt | flowspezifische AVG-/Vertrags-/Tax-/Privacy-Freigabe, Einwilligung, Incident Owner, manuelle Recovery und Kapazitätsbudget | öffentlicher oder unbeaufsichtigter Self-Service |
| **LC3 Invite-only Pilot** | geschlossene echte Kohorte in genau freigegebenem Cluster | produktive Provider für den Scope, Trust/Fraud/Support, Search/Freshness, getestete Worker oder ausdrücklich beaufsichtigte Ausnahme | öffentlicher oder skalierter Betrieb |
| **LC4 Öffentlicher kostenloser Launch** | öffentlicher Self-Service ohne Zahlung | alle Scope-P0, autonome Kernprozesse, Cluster-/Trust-/Freshness-/Legal-/Recovery-Gates; Kaufpfade vollständig geschlossen | Paid Conversion oder Paid-Self-Service |
| **LC5 Bezahlter Self-Service** | öffentlicher realer Geldfluss | LC4 plus WTP-Go, Payment/Finance/Tax, Service-Recovery/Refund, Reconciliation/Dunning und Paid Support | Profitabilität oder Scale ohne Evidence |
| **LC6 Skalierter Produktionsbetrieb** | dauerhaftes Angebot mit wachsendem Volumen | bestätigte SLO/RPO/RTO, On-call, Datenschutz-/Retention-Lifecycle, Kapazitäts-/Lastnachweis, triggerbasierte Scale-Tracks, laufende Compliance | unbegrenzte Reichweite oder ungeprüfte Produkte/Länder/Datenflüsse |

Mock-Checkout bleibt bis Phase 24 eine Demo-Funktion und zählt niemals als
bezahlte Conversion. Die Begriffe „Hypothese“, „Mock“ und „Demo“ aus
`STH-028` dürfen erst entfernt werden, wenn das konkrete Angebot, der
Geldfluss und seine externen Gates tatsächlich freigegeben sind.

## 3. Geschützte Kernverträge

Remediation bedeutet additive Produktionsreife, nicht Neuschreiben des
bewiesenen Kerns. Jede Phase muss mindestens folgende Invarianten bewahren:

1. **Tenant, Rolle und Ownership:** Jeder private Read und jede Mutation
   prüft Rolle, Company-Kontext, Ownership, Assignment, Capability und
   Status serverseitig. Ein UI-Gate gilt nie als Autorisierung.
2. **Talent-Radar-Anonymität:** Keine Identität, CV-Datei, interne ID,
   private Notiz oder seltene Merkmalskombination verlässt den Server vor
   einem gültigen, kandidateninitiierten und auf Firma, Anfrage, Thread und
   Felder begrenzten Reveal.
3. **Geld und Rechte:** Beträge bleiben ganze Rappen, Preise stammen aus
   versionierten Server-Snapshots, Fulfillment ist atomar und idempotent,
   Ledger werden nie negativ und Payment-Events dürfen nicht doppelt wirken.
4. **Job-Publikation:** Draft, Review, Moderation, Quota, Firma,
   Verifizierung, Sperren, Ablauf und öffentliche Projektion bleiben
   transaktional beziehungsweise fail-closed gekoppelt.
5. **Fairness und Sponsoring:** Bezahlte Reichweite ist sichtbar markiert und
   verändert weder Fair-Job-Score noch die fachliche Relevanzgrundlage.
6. **Import und Datenrechte:** Kein Scraping, kein Import ohne
   Quellen-/Lizenznachweis und Preview, kein ungeprüftes Auto-Publish.
7. **Audit und Security:** CSRF/Origin, Rate Limits, Redaction, no-store,
   Session-Widerruf, Secret-Hygiene und allowlist-basierte Audits werden
   durch neue Provider oder Worker nicht umgangen.
8. **Demo-/LIVE-Trennung:** Fixtures und Mock-Erfolge dürfen in Production
   weder erzeugt noch als reale Kennzahl, Datenquelle oder Marktbeweis
   gezählt werden.
9. **Explizite Produktfreigabe:** Ein vorhandener Adapter, Plan oder
   Feature-Flag ist keine automatische Freigabe. Fehlende oder widersprüchliche
   Gate-Evidence führt zu `disabled` beziehungsweise einem ehrlichen
   Nicht-verfügbar-Zustand.
10. **Kompatible Evolution:** Bestehende URLs, Daten und Events werden
    versioniert migriert. Kein Providerwechsel darf historische Rechnungen,
    Consent-Evidence, Audit-Trails oder Bewerbungsstände umdeuten.

## 4. Remediation-Architektur

### 4.1 Ports, Domain und produktive Adapter

Die bestehende Port-/Adapter-Trennung bleibt erhalten. Reale Adapter dürfen
nicht über einen impliziten Environment-Switch oder über direkten Import in
Domain-Services aktiviert werden. Für jeden Provider gelten:

- versionierte Konfiguration und explizite Releaseentscheidung;
- getrennte Sandbox-/Staging-/LIVE-Credentials;
- Secret-Rotation ohne Commit oder Log-Ausgabe;
- Timeout, Retry-Klasse, Idempotency Key und Circuit-Breaker-Verhalten;
- persistente Zustandsmaschine beziehungsweise Outbox statt
  „Request erfolgreich = fachlich erledigt“;
- signaturgeprüfte, replay-geschützte Webhooks mit Rohpayload-Retention nur
  innerhalb des freigegebenen Minimalumfangs;
- providerunabhängige Domain-Events und unveränderliche fachliche Snapshots;
- Health, Metriken, Alarmierung, Dead Letter und manuelle Recovery;
- dokumentierter Datenstandort, DPA/AVV, Subprozessoren, Aufbewahrung und
  Löschung;
- lokaler Fake/Mock plus deterministische Failure-Fixtures für Tests.

### 4.2 Durable Ausführung

Phase 20 definiert die persistente Outbox und Delivery-Semantik; Phase 23
macht sie autonom und betreibbar. Die Trennung ist absichtlich:

```text
fachliche Transaktion
  -> Domainzustand + Outbox-Eintrag atomar committen
  -> Worker leaset/claimt mit Lease
  -> Adapter führt idempotent aus
  -> Erfolg oder klassifizierter Retry
  -> Dead Letter + Alarm + kontrollierte Replay-Aktion
```

Ein periodischer Befehl kann während der Entwicklung die gleiche
Worker-Domain ausführen, ist aber kein Nachweis für unbeaufsichtigten
öffentlichen Self-Service. „Exactly once“ wird nicht vom Netzwerk behauptet;
fachliche Einmalwirkung entsteht durch Inbox/Outbox, Deduplizierung,
Provider-Idempotenz und idempotentes Reconciliation.

### 4.3 Datenbank- und Migrationsvertrag

Jede Schemaänderung folgt, sofern technisch anwendbar, dem
Expand–Migrate–Contract-Muster:

1. additive Tabellen/Spalten/Indizes und abwärtskompatible Reads;
2. begrenzter, wiederaufnehmbarer und beobachtbarer Backfill;
3. Dual-Read oder versionierte Projektion, falls alte und neue Writer
   überlappen können;
4. Gegenprüfung von Counts, Checksums, Null-/Orphan-Raten und Tenant-Grenzen;
5. erst danach `NOT NULL`, Unique-/FK-/Check-Constraints oder alter
   Contract-Abbau;
6. Restore-Probe und dokumentierte Roll-forward-/Rollback-Entscheidung.

Produktive Migrationen laufen nicht im Requestpfad. Irreversible
Löschmigrationen und grossflächige Datentransformationen benötigen vorab
Backup-/Restore-Evidence, Laufzeitbudget, Lock-Analyse und Abbruchkriterium.
Bei Privacy-Löschung ist „Rollback“ bewusst kein Wiederherstellen gelöschter
Personendaten; dort gilt stattdessen legal freigegebene Tombstone- und
Recovery-Semantik.

### 4.4 Feature-, Provider- und Release-Gates

Konkrete Flag-Namen werden erst in den besitzenden ADRs festgelegt. Die
Gate-Matrix muss jedoch diese Ebenen separat modellieren:

- **Build capability:** Code/Adapter ist vorhanden.
- **Environment capability:** Infrastruktur, Secrets und Callback-URLs sind
  vollständig und validiert.
- **Provider approval:** Vertrag, DPA/AVV, Sandbox/LIVE-Freigabe und
  Operations-Owner sind vorhanden.
- **Legal/product approval:** konkreter Flow, Copy, Preis, Daten und Rollen
  sind schriftlich freigegeben.
- **Tenant/cohort rollout:** allowlist-basierte Aktivierung mit Kill Switch.
- **Runtime health:** offene Incidents oder degradierte Provider können den
  Pfad fail-closed stoppen.

Kein einzelnes Boolean und insbesondere kein `NODE_ENV=production` darf alle
Ebenen überstimmen. Gate-Entscheidungen sind auditierbar; Security-,
Privacy- und Pflichtbenachrichtigungen dürfen nicht durch Marketing-Flags
deaktiviert werden.

## 5. Go-live-Gates ausserhalb reiner Domainimplementierung

Diese Gates lassen sich nicht allein durch Fachcode schliessen. Rechts-,
Markt-, Provider- und Organisationsfreigaben benötigen externe Evidence.
Betriebsartefakte wie Staging, Monitoring, Backups und Restore werden zwar in
Phase 23 implementiert und getestet, benötigen für LIVE aber zusätzlich reale
Infrastruktur, benannte Owner und bestätigte Betriebsziele.

### 5.1 Recht, Datenschutz und Verträge

- schriftliche AVG-/AVV-Beurteilung des konkreten Stellenmarkt-,
  Bewerbungs-, Radar-, Contact-/Reveal- und Entgeltflusses; nötige kantonale
  und gegebenenfalls eidgenössische Bewilligung oder dokumentierte
  Nicht-Bewilligungspflicht;
- freigegebene AGB, Datenschutzerklärung, Einwilligungs- und
  Widerrufstexte, Aufbewahrungs-/Löschmatrix und Betroffenenprozess;
- Verträge/DPA mit jedem im Launchscope aktivierten E-Mail-, Storage-,
  Payment-, Monitoring-, Support- und weiteren Subprozessor inklusive
  internationaler Bekanntgaben; deaktivierte Provider bleiben fail-closed;
- bei bezahltem Scope: steuerlich und buchhalterisch geprüfte Rechnung, MWST,
  Gutschrift, Erstattung, Mahnung und Aufbewahrung;
- Rechtsgrundlage und fachliche Freigabe der Company-Verifikation und ihrer
  Beweisdokumente;
- Barrierefreiheitsziel und dokumentierte manuelle Assistive-Technology-
  Abnahme.

### 5.2 Markt, Produkt und Daten

- für bezahlte beziehungsweise kommerziell beworbene Angebote:
  vorregistrierter, echter Geldfluss mit Schweizer KMU; Mock- oder
  Provider-Testmode zählt null. Ein ausdrücklich kostenloser Lernpilot bleibt
  möglich, belegt aber keine WTP und hält Kauf-CTAs geschlossen;
- bei bezahltem oder kommerziell beworbenem Scope: monatliches
  18-/24-Monats-Cashflow-/Runway-Modell mit Churn, Pause/Reaktivierung,
  CAC-Zahlungszeitpunkt, Support, Steuern und Downside. Für einen
  ausdrücklich kostenlosen Lernpilot genügen vor Freigabe ein finanziertes
  Budget, Lernziel, Laufzeit und Stopregel; WTP bleibt unbelegt;
- echte LIVE-Liquidität je Cluster; DEMO-/TEST-Daten und Seeds zählen null;
- für jeden öffentlich aktivierten Startcluster fachlich freigegebene
  Berufs-Konzepte, Schweizer Synonyme/Abkürzungen/Varianten/Tippfehler,
  dokumentierte must-find-/must-not-find- und Top-K-Relevanzevidence sowie
  Search-/Alert-/Recommendation-/Matching-Parität. Der Cluster-V2-Entscheid
  bindet Query-Set-, Search-Policy-, Ranking- und Taxonomieversion; V1-Proxy,
  reine Location-/Kategorie-/`Stellen`-Treffer und DEMO-Evidence genügen nicht;
- Talent Radar als Wedge über reale Opt-in-, Contact-, Accept-, Reveal-,
  Gesprächs- und Paid-Use-Kohorten prüfen, bevor „Moat“ behauptet wird;
- falls Salary Radar Teil des Launchscopes ist: fachlich geprüfter,
  rechtmässiger und versionierter LIVE-Lohndatensatz
  mit quellengetreuem Berufsgruppen-/Grossregionsmapping, Attribution,
  Unsicherheit und Refresh Owner; andernfalls Route, Sitemap und Indexierung
  fail-closed;
- falls Business-/Enterprise Teil des Launchscopes ist: nur tatsächlich
  lieferbare, supportbare und vertraglich beschriebene Leistungen; andernfalls
  Angebote, CTAs und Entitlements fail-closed.

### 5.3 Betrieb

- getrennte Preview-/Staging-/Production-Konten, Netzwerke, Datenbanken,
  Domains und Secrets;
- reales HTTPS-/Ingress-/DNS-/E-Mail-Authentifizierungs- und
  Webhook-Endpunkt-Setup;
- benannter Service-, Security-, Privacy- und Incident Owner mit
  erreichbarem On-call/Pager;
- SLOs, Error Budgets, Dashboards, Alarmierung und mindestens eine
  dokumentierte Incident- sowie Provider-Ausfallübung;
- produktiver verschlüsselter Backup-Lifecycle, Restore aus dem echten
  Zielsystem sowie fachlich bestätigtes RPO/RTO;
- Capacity-, Queue-Backlog-, Rate-Limit- und Kostenalarme;
- Sitemap-Counts pro Ressource und gemeinsam, unkomprimierte Bytes,
  Generierungsdauer, letzter Erfolg, Wachstum und 90-Tage-Prognose. Unter dem
  STH-027-Trigger bleibt die sichere Single-Sitemap fail-closed; bei 70 %
  Count-/Bytebudget wird der Shard-Release verbindlich geplant, vor 80 %
  umgesetzt und ab 90 % beziehungsweise Capacity-/Performancefehlern zur
  Betriebs-/Releaseblockade eskaliert.

## 6. Phasenübersicht 19–32

Phasen 19 und 20 sind durch ihre verlinkte Candidate-Evidence geschlossen;
alle Kästchen 21–32 bleiben offen. Ein Planartefakt oder ein vorhandener
Teilmechanismus schliesst keine weitere Phase. Bei gemischt priorisierten
Phasen erhält jeder Track eigene Evidence. Ein grüner P1-Track darf
freigegeben werden, ohne einen nicht ausgelösten P3-Befund fälschlich zu
schließen; dieser benötigt stattdessen einen datierten Deferred-Entscheid mit
Headroom, Forecast, Alert und Owner.

| Phase | Titel | Primäre Befunde | Hauptziel |
| --- | --- | --- | --- |
| [x] 19 | [Remediation-Baseline und Regression](./19-remediation-baseline-regression.md) | alle `STH-*` als Steuerung | Candidate `769ee62`, vollständige aktuelle Golden-Baseline, Regressionvertrag, Test-/Migrationsinventar und Gate-Backlog verifiziert |
| [x] 20 | [Identity, E-Mail und Notifications](./20-identity-email-notifications.md) | `STH-001`, `STH-002`, `STH-013`, `STH-026`, Identity-Anteil `STH-031`; E-Mail-Anteil `STH-004` | technischer Verification-/E-Mail-Change-/Outbox-/Dispatcher-/Preference-Vertrag auf Candidate `5908900`; LIVE/Worker/Step-up bleiben gegatet |
| [ ] 21 | [Document-/CV-Vault](./21-document-cv-vault.md) | `STH-003`; Storage-Anteil `STH-004` | echte CV-/Evidenzdateien mit Quarantäne, Zugriff, Retention und Audit |
| [ ] 22 | [Privacy, Legal und Analytics](./22-privacy-legal-analytics.md) | `STH-006`, `STH-007`, `STH-017` | vollständiges Dateninventar, reale Export-/Korrektur-/Löschprozesse, Legal Holds, versionierte Rechtstexte und consent-bewusste LIVE-Analytics |
| [ ] 23 | [Production Operations und Worker](./23-production-operations-workers.md) | verbleibende Provideranteile `STH-004`, `STH-008`, `STH-009`, `STH-034` | explizit freigegebene reale Adapter, autonome Ausführung, Kapazitäts-/Stückkostenmodell und belastbare Staging-/Recovery-Grenzen |
| [ ] 24 | [Reales Billing und Finance](./24-real-billing-finance.md) | `STH-005`, `STH-035`; Payment-Anteil `STH-004`, Fraud-Anteil `STH-031` | echter, webhookbasierter Geldfluss, Reconciliation, Dunning/Dispute sowie vertraglich korrekte Refund-/Credit-Restoration |
| [ ] 25 | [Privileged Action Assurance, Admin Least Privilege und Trust & Safety](./25-admin-security.md) | `STH-010`, `STH-011`, `STH-030`, `STH-031` | 25A Admin-Least-Privilege/SoD/Break-glass, 25B risikobasiertes Non-Admin-Step-up, 25C Fraud-/Scam-/ATO-Abwehr |
| [ ] 26 | [Company Trust und Verifikation](./26-company-trust-verification.md) | `STH-014`, Company-Anteil `STH-031`, Kapazitätsanteil `STH-034` | beweisgestützter, vier-Augen-fähiger Trust-Lifecycle mit Ablauf, Re-Review und schneller Sperrung |
| [ ] 27 | [Multi-Persona Identity](./27-multi-persona-identity.md) | `STH-012` | additive Plattform-/Company-Personas mit explizitem aktivem Kontext |
| [ ] 28 | [Recruiting-Workflows](./28-recruiting-workflows.md) | `STH-015`, `STH-016` | zwei unabhängige, nachgewiesen nachgefragte optionale Tracks: 28A externer Statusimport und 28B persistente Interviewplanung |
| [ ] 29 | [Research, UX, Mobile und Accessibility](./29-ux-mobile-accessibility.md) | `STH-023`, `STH-025`, `STH-033`; UX-Regression `STH-026` | früher moderierter Research-Track und später bedienbare Cross-Browser-/Mobile-/A11y-Abnahme |
| [ ] 30 | [Startcluster-Suche, Freshness und Scale Operations](./30-search-scale-operations.md) | 30A: `STH-019`, `STH-036`; 30B: `STH-020/021`; 30C: `STH-027`; 30D: `STH-032` | gemeinsamer berufsfachlicher Suchvertrag samt sicherem Lernkreislauf, Job-Freshness in allen Consumern sowie triggerbasierte Scale-/Sitemap-Arbeit |
| [ ] 31 | [Monetarisierung und Marktvalidierung](./31-monetization-market-validation.md) | `STH-018`, `STH-022`, `STH-028`, `STH-034`, `STH-035`, `STH-037` | genau ein erster Cluster, WTP vor Ausbau, real lieferbare Basis-/Serviceangebote sowie belegte Kapazität, Stückkosten, Cashflow und Service-Recovery |
| [ ] 32 | [Finaler Production-Release-Audit](./32-production-release-audit.md) | `STH-024` und Abschluss aller `STH-001`–`STH-037` | zielklassenspezifische Freigabe eines exakten Commits/Artefakts mit vollständiger automatischer, manueller und externer Evidence |

## 7. Ausführungsplan je Phase

### [x] 19 — Remediation-Baseline und Regression

**Zweck:** Die aktuelle Anwendung wird auf einem sauberen, unveränderlichen
Commit erneut inventarisiert, ohne die Phase-01–18-Evidence umzuschreiben.
Test-, Route-, Schema-, Provider-, Env-, Capability-, Datenklassifikations-
und Operationsverträge werden als Ausgangspunkt eingefroren. Jeder
`STH-*`-Befund erhält Owner, Priorität, Abnahme, Abhängigkeiten und
Nicht-Ziele.

**Abschluss:** Der Vertrag ist auf Candidate `769ee62` vollständig bestanden;
Resultate, Baseline-Metriken und offene Grenzen stehen im
[Phase-19-Evidence-Record](./evidence/2026-07-26-phase-19.md). Phase 20 darf
beginnen; sämtliche Produkt- und Aktivierungsgates bleiben bei ihren owning
Phasen offen.

**Abhängigkeiten:** keine neue Produktphase; die historischen Phasen 01–18
sind die fachliche Basis.

**Pflicht-Gates:** Nutzeränderungen isolieren; Zielcommit und Datenbank
eindeutig identifizieren; Migrationen und Providerkomposition inventarisieren;
keine offene Klassifikationsfrage als Implementierungsannahme verstecken.

**Risiken:** Ein Testlauf auf schmutzigem Worktree oder veralteten
Generated Files erzeugt falsche Baseline; historische Zahlen könnten
versehentlich dem heutigen HEAD zugeschrieben werden.

**Regression und Rollback:** Vollsuite, Clean Clone, Seed zweimal und
Plan-/Route-/Secret-Audits definieren den neuen Nullpunkt. Die Phase ändert
keine Produktsemantik; bei Abweichungen wird der Befund dokumentiert statt
durch einen unautorisierten Schnellfix verdeckt.

### [x] 20 — Identity, E-Mail und Notifications

**Zweck:** Registration, Invite, Password Recovery, Privacy Challenge und
geschäftliche Benachrichtigungen erhalten einen gemeinsamen, persistenten
Identity-/Delivery-Vertrag. Eine E-Mail gilt erst nach gehashtem,
einmaligem, abgelaufenem und atomar konsumiertem Token als verifiziert. Die
heute unerreichbare Privacy-Challenge wird über einen verifizierten
Identity-Faktor erreichbar. Zugleich erhält jede Nachricht einen
versionierten Zweck, Kanal, Dringlichkeit und eine sichere
Suppression-/Preference-Regel.

**Befunde:** `STH-001`, `STH-002`, `STH-013`, `STH-026` sowie der
E-Mail-Provideranteil von `STH-004`.

**Abhängigkeiten:** 19; bestehende Auth-, Session-, Notification-,
EmailLog-, Consent-, Audit- und Rate-Limit-Verträge.

**Pflicht-Gates:** Tokenrotation und Enumeration-Schutz; Zwecktrennung;
Privacy-Step-up mit Recovery- und Missbrauchsschutz; Outbox atomar mit
Fachtransaktion; Retry/Dedupe/Dead-Letter-Modell; sichere Default-Matrix;
Marketing-Opt-out; Pflichtmails getrennt von optionaler Kommunikation;
Suppression vor Claim und erneut vor Send; Mailbox-/Mock-Parität; ein realer
E-Mail-Adapter nur nach Providerfreigabe und nie durch impliziten
Environment-Switch.

Phase 20 besitzt Adaptercode, providerklassenspezifischen ADR und
Contract-/Sandbox-Tests. Phase 23 besitzt die environmentbezogene
LIVE-Aktivierung, autonome Ausführung, übergreifendes Monitoring, Recovery und
die Governance der übrigen Provider.

**Risiken:** Account Takeover, Token-Replay, doppelte Zustellung,
Login-Aussperrung bestehender Demo-/Legacy-Konten, Unterdrückung zwingender
Security-/Privacy-Mail, Preference-Drift und PII in Logs.

**Regression und Rollback:** Bestehende Sessions und Invite-/Reset-Flows,
RBAC/IDOR, Mock-Mailbox und Auth-E2E bleiben grün. Tests umfassen
Purpose×Channel×Role×Consent, Preference-Update während Queueing,
Unsubscribe, Pflichtmail, Token-Replay sowie unerreichbare/falsche
Identity-Challenge. Rollout erfolgt kompatibel mit `unverified`-Zustand und
kontrollierter Legacy-Migration. Ein Kill Switch darf Versand stoppen,
aber weder bestätigte Identität zurücksetzen noch Pflichtfälle still als
zugestellt markieren.

**Abschluss:** Candidate
`59089009f54312a4c10989b7efde2d5fda9a2b8d` besteht 45 Migrationen,
1.984 Unit-, 408 PostgreSQL- und 233 Browserprüfungen sowie Build, HTTP,
HSTS, Seed×2, Provider-/Dispatcher-Failure- und Governance-Gates. Der
[Phase-20-Evidence-Record](./evidence/2026-07-26-phase-20.md) trennt diesen
technischen Abschluss von weiterhin `DISABLED`/`PAUSED` gesetzter
Productionzustellung, autonomer Phase-23-Ausführung und Phase-25-Step-up.
Phase 21 darf beginnen.

### [ ] 21 — Document-/CV-Vault

**Zweck:** CVs und später Verifikationsevidenz werden als echte,
verschlüsselte und autorisierte Objekte verwaltet statt nur als Metadaten.
Upload, Quarantäne, Malware-/Typprüfung, Aktivierung, Versionierung, Download,
Widerruf und Löschung bilden einen durchgängigen Lifecycle.

**Befunde:** `STH-003` sowie der Storage-Provideranteil von `STH-004`.

**Abhängigkeiten:** 19 und der technische Identity-/Outbox-Vertrag aus Phase
20; bestehende Candidate-/Application-/Radar-Policies. Der Storage-Port und
sein produktiver Adapter werden hier fachlich geschlossen; zentrale
Privacy-Policy gehört Phase 22, LIVE-Aktivierung, Monitoring und Recovery
bleiben zusätzlich an die Operations-Gates aus Phase 23 gebunden.

**Pflicht-Gates:** serverseitige Grössen-/Magic-Byte-/Typprüfung; zufällige
Objektschlüssel; kein öffentlicher Bucket; kurzlebige autorisierte Downloads;
Virus-Scan-Fail-closed; Verschlüsselung/Key-Rotation; Retention und Legal
Hold; CV niemals vor Radar-Reveal.

**Risiken:** Malware, SSRF, Object-IDOR, unvollständige Löschung, sensible
Backups und fehlerhafte MIME-Vertrauensannahmen.

**Regression und Rollback:** Upload→Scan→aktive Version→Bewerbung→Download
sowie abgewiesene/infizierte/zu grosse Dateien und Cross-User-/Cross-Tenant-
Zugriffe werden getestet. Metadaten bleiben während eines kompatiblen
Rollouts lesbar; bei Adapterausfall werden neue Uploads gestoppt, aber keine
historischen Referenzen umgebogen.

### [ ] 22 — Privacy, Legal und Analytics

**Zweck:** Der bestehende Privacy-Case wird von einer kontrollierten
Demo-Simulation zu einem nachvollziehbaren Dateninventar-, Export-,
Korrektur-, Lösch-, Retention- und Legal-Hold-Prozess. Öffentliche
Rechtstexte und Einwilligungen referenzieren unveränderliche,
locale-spezifische Versionen. Produktmetriken werden in LIVE
consent-bewusst, provenance-getrennt und ohne Abhängigkeit des
Produktflusses von einem Analytics-Provider erhoben.

**Befunde:** `STH-006`, `STH-007`, `STH-017`.

**Abhängigkeiten:** 20 für verifizierte E-Mail/Challenge und
Notification-Taxonomie; 21 für Dokumentexport und -löschung; bestehende
Radar-/Consent-/Audit-/Analytics-Verträge.

**Pflicht-Gates:** exportierbares Dateninventar mit Herkunft; Löschung über
DB, Storage, Search/Analytics und Provider; Legal Hold;
Workflowzustand für Zweipersonenfreigabe riskanter Adminaktionen, in Phase 22
fail-closed vorbereitet und erst nach den personell getrennten Grants aus
Phase 25 für LIVE aktiviert; versionierte
AGB/Datenschutz/Impressum/Consent-Evidence; Datenminimierung, Retention,
Consent/DNT und DEMO/LIVE-Provenienz für Analytics; fachjuristische
Freigabe vor LIVE; flowspezifischer, versionierter AVG-/AVV-Entscheid und
DSFA-Status (`REQUIRED`, begründet `NOT REQUIRED` oder `APPROVED`) mit Owner,
Scope, Gültigkeit und Re-Review.

**Risiken:** Über- oder Unterlöschung, Wiedererscheinen durch Retries,
unzulässige Audit-/Backup-/Analytics-Inhalte, falsche Identität,
rechtswidriges Tracking und Widerspruch zwischen Widerruf, Aufbewahrung und
Vertrag.

**Regression und Rollback:** Radar-Eligibility-Loss, Reveal-Grenzen,
Application-/Billing-Aufbewahrung, Notification nach jedem zulässigen
Abschluss, Cross-User-Denial, Consent-Änderung und DEMO/LIVE-
Metriktrennung werden über echte Trigger geprüft. Analytics-Ausfall darf
keinen Produktflow blockieren. Erasure ist nicht rückrollbar; deshalb Dry
Run, Approval, Export-Checksum und irreversible Bestätigung vor Ausführung.

### [ ] 23 — Production Operations und Worker

**Zweck:** Die verbleibenden realen Provideradapter werden über die
bestehenden Ports und eine gemeinsame Governance integriert. Gleichzeitig
laufen Outbox, Alerts, Expiry, Retention, Searchprojektionen und weitere
fällige Arbeit autonom, lease-basiert, beobachtbar und wiederaufnehmbar.
Staging, Deployment, Backup/Restore, Incident Response und SLOs werden an
den realen Runtime-Vertrag gebunden. Fachlicher Payment-Abschluss bleibt
Eigentum von Phase 24.

**Befunde:** die verbleibenden Providergrenzen von `STH-004` sowie
`STH-008`, `STH-009` und Telemetrie-/Kapazitätsanteil `STH-034`.

**Abhängigkeiten:** 20–22 definieren Identity-, Delivery-, Storage-,
Privacy- und Analytics-Verträge; bestehende Maintenance Commands und
Runbooks.

**Pflicht-Gates:** separate ADR je Providerklasse; keine automatische
Env-Umschaltung; DPA/Subprozessor-/Datenresidenzprüfung; Secrets/Rotation;
Webhook-Signatur und Replay-Schutz; Timeout/Retry/Circuit Breaker;
Queue/Lease/Heartbeat; Retryklassen und Jitter; Dead Letter/Requeue mit
Audit; Multi-Instance-Concurrency; Shutdown/Restart; Sandbox-/Staging-
Contract-Tests; Backlog-, Age-, Failure- und Cost-Alarme; echte
Staging-Probe; verschlüsselter produktiver Backup-/Restore-Lifecycle;
Incident Owner und Kill Switch; je Queue/Provider Arrival Rate, p50/p95,
SLO/Error Budget, Throughput, Backpressure, Headroom, Vollkosten,
30-/90-Tage-Forecast, Aufnahme-/Shutdown-Schwelle und benannter Operator.

**Risiken:** Vendor Lock-in, Secret-Leak, doppelte Side Effects,
Provider-/Domainstatus-Drift, Datenexport in falsche Region,
Poison Messages, hängende Leases und unbegrenztes Retry-/Kostenwachstum.

**Regression und Rollback:** Port-Contract-Suite läuft identisch gegen Mock
und Sandbox-Fake. Crash vor/nach Side Effect, parallele Worker,
Lease-Ablauf, Provider-Timeout, Replay, DLQ und Recovery werden mit
deterministischer Uhr geprüft. Providerdeaktivierung stoppt neue Side
Effects und erhält persistierte Arbeit; Worker-Rollback pausiert Claims,
nicht Outbox-Inhalte. Ein Rollback darf echte Zustellungen oder externe
Side Effects nicht als ungeschehen markieren.
Ein konsolidiertes Provider Ledger belegt je Use Case und Environment Owner,
DPA/Region, Secretklasse, Health, Contract-/Sandbox-Evidence, LIVE-Gate oder
die begründete fail-closed Deaktivierung.

### [ ] 24 — Reales Billing und Finance

**Zweck:** Der bewiesene Mock-Domainvertrag wird um echten Checkout,
signierte Webhooks, Reconciliation, Subscription-Renewal,
Fehlzahlung/Mahnung, Refund/Chargeback und freigegebene Rechnungsausgabe
ergänzt. Der Provider besitzt weiterhin nicht das Fulfillment.

**Befunde:** `STH-005`, `STH-035`, Payment-Fraud-Anteil von `STH-031`
sowie der Payment-Provideranteil von `STH-004`.

**Abhängigkeiten:** 23 reale Payment-Adapter-Governance und Worker;
22 Legal/Privacy/Retention; 25B Non-Admin-Step-up vor öffentlichem Checkout;
externe Tax-/Vertrags-/AVG-Gates sowie ein positives, vorregistriertes
Phase-31A-WTP-Go für LC5. Der frühe WTP-Track darf einen rechtlich
freigegebenen manuellen Rechnungs-/Design-Partner-Test nutzen, bevor ein PSP
gebaut wird; Phase 24 belegt danach die technische Geldflussfähigkeit.
Phase 31B aktiviert nur tatsächlich lieferbare Angebote.

**Pflicht-Gates:** serverseitige Preise/Snapshots; Payment Intent zu Order;
Webhook-Inbox; genau einmal wirkende Domaintransition; Reconciliation;
Payment-Fraud-/Chargeback-/Dunning-Vertrag; Refund-/Dispute-Auswirkung auf
Grants ohne Ledgerkorruption; versionierte Service-Delivery-Matrix für
Plattformfehler versus normales Markt-/Nutzerergebnis; exactly-once
Refund/Credit-Restoration/Extension/Replacement; PDF/
Rechnungsnummern/Aufbewahrung; Staging- und kontrollierter LIVE-Penny-Test.

**Risiken:** Geldverlust, doppeltes Fulfillment, falsche MWST/Rechnung,
Out-of-order Webhooks, Chargebacks nach Verbrauch und irreführende
Conversion-Metriken.

**Regression und Rollback:** Der vollständige bisherige Mock-Flow bleibt im
Demo-Modus grün. Sandbox prüft success/failure/delay/duplicate/out-of-order/
refund/dispute. Ein Kill Switch verhindert neue Checkouts; Reconciliation
und gesetzliche Aufbewahrung laufen weiter. Reale Orders werden nie in
Mock-Orders konvertiert.

### [ ] 25 — Privileged Action Assurance, Admin Least Privilege und Trust & Safety

**Zweck:** 25A entwickelt die bestehende Capability-Abstraktion zu echten
Least-Privilege-Adminrollen mit MFA, Separation of Duties und Break-glass.
25B schützt auch risikoreiche Candidate-/Employer-Aktionen mit frischer,
zweckgebundener Step-up-Evidence. 25C führt die verstreuten Rate-Limit-,
Abuse-, Audit- und Revocation-Schutzwirkungen zu einem kohärenten
Fraud-/Scam-/ATO-/Trust-&-Safety-Vertrag zusammen.

**Befunde:** `STH-010`, `STH-011`, `STH-030`, `STH-031`.

**Abhängigkeiten:** 20 verifizierte Identität und Step-up-Grundlage; 22
Privacy-/Legal-Aktionsklassen; bestehende Session- und Capability-Policies.
Phase 23 liefert das Aktivierungs-Gate für Production-RP-ID, HTTPS, Secrets,
Alarmierung und Recovery, nicht die lokale RBAC-/MFA-Implementierung.

**Pflicht-Gates:** deny-by-default Capability-Matrix; Separation of Duties;
MFA-Recovery und Step-up-Alter; zweck-/actor-/tenantgebundene frische
Assurance für Checkout, Security-/Login-E-Mail-, Team-/Rollen-, Bulk-
Download-/Export- und kritische Consent-/Reveal-Aktionen; Sessionversion bei
Rollenänderung; Break-glass mit Zeitlimit, Alarm und Audit; kein globaler
`ADMIN`-Fallback bei unbekannter Capability; Risk Decision/Case/Appeal für
Credential Stuffing, ATO, Scam-/Duplicate-Jobs, kompromittierte Firmen,
Mass Messaging/Contacts, Reveal-/Exportanomalie und Payment Fraud.

**Risiken:** Privilege Escalation, ausgesperrte Betreiber, Selbstfreigabe
riskanter Aktionen und unkontrolliertes break-glass.

**Regression und Rollback:** Rollen×Ressourcen×Aktionen als PostgreSQL- und
Direct-Action-Matrix; Suspendierung, Sessionwiderruf, Support-/Privacy-/
Billing-Trennung und Cross-Tenant-IDOR. Legacy-`ADMIN` wird erst nach
Backfill und expliziter Rollenzuordnung entfernt; Rollback erhält
Capability-Snapshots statt global alle Rechte zu öffnen.

### [ ] 26 — Company Trust und Verifikation

**Zweck:** Textreferenzen werden durch strukturierte,
zugriffsgeschützte Nachweise, Prüfschritte, Ablauf, Widerruf und
Vier-Augen-Freigabe ersetzt. Der öffentliche Badge bleibt eine abgeleitete,
zeitlich gültige Projektion.

**Befund:** `STH-014` sowie Company-/Scam-Anteil `STH-031` und
Operationskapazität `STH-034`.

**Abhängigkeiten:** 21 sichere Dokumente; 25 Admin-Capabilities und Step-up;
22 Retention-/Legal-Basis.

**Pflicht-Gates:** erlaubte Evidenztypen und Quelle; Virus-/Dokumentprüfung;
Reviewer-Separation; Reason/Expiry; Reverification; Suspension-/Revocation-
Kaskade; öffentliche Projektion ohne Beweisdaten; fachliche Definition, was
„verifiziert“ tatsächlich bedeutet.

**Risiken:** gefälschte Dokumente, PII-Leak, dauerhafte falsche Trust-
Behauptung und Selbstfreigabe durch zu mächtige Admins.

**Regression und Rollback:** Claim→Evidence→Review→Approve→Publish,
Reject/Resubmit, Expiry/Revoke/Suspend und sofortige Job-/Radar-Auswirkung.
Bei Rollback wird der Badge fail-closed entfernt; Evidence bleibt gemäss
Retention geschützt, nicht öffentlich.

### [ ] 27 — Multi-Persona Identity

**Status/Priorität:** standardmässig `DEFERRED`, P3. Ohne datierten,
moderierten Persona-Bedarf, Product-/Security-Go und explizite Zielklasse
entstehen keine Route, CTA oder Migration; Phase 27 liegt nicht auf dem
Standard-Critical-Path.

**Zweck bei aktiviertem Demand-Gate:** Personen können additive Plattform- und Company-Personas
besitzen, ohne Tenant-, Rollen- oder Sessiongrenzen zu verwischen. Ein
expliziter aktiver Kontext bestimmt Navigation und Komfort; jede
Serveraktion autorisiert dennoch erneut gegen die persistierten
Mitgliedschaften und Capabilities.

**Befund:** `STH-012`.

**Abhängigkeiten:** 20 Identity/Session; 25 Admin-Capabilities; bestehende
CompanyMembership-, Invitation- und Assignment-Verträge.

**Pflicht-Gates:** additive statt exklusiver Rollen; expliziter
Persona-/Tenant-Kontext; Sessionversion bei Membershipänderung; Einladung,
Entfernung, Suspendierung und letzter Owner; keine Persona-Information in
fremden Cache-/Navigation-/Analytics-Kontexten; additive Migration statt
destruktiver Role-Enum-Umschreibung.

**Risiken:** confused deputy, falscher Tenant, Persona-Leak,
Privilege-Eskalation durch Context-Switch und ausgesperrte Unternehmen.

**Regression und Rollback:** Candidate+Employer, Employer+Admin,
Multi-Company-Recruiter sowie negative Cross-Tenant-/Direct-Action-Fälle
werden geprüft. Context-Switch invalidiert keine berechtigte andere
Persona, aber entzogene Membership wirkt sofort. Die alte Einzelrolle bleibt
während des Backfills lesbar; ein Rollback darf niemals globale Rechte
verleihen.

### [ ] 28 — Optionale Recruiting-Workflows

**Status/Priorität:** 28A und 28B sind getrennt `DEFERRED`, P3. Der bestehende
interne Submit→Pipeline→Status-Flow hängt von keinem der beiden Tracks ab.
Jeder Track benötigt ein eigenes moderiertes Demand-Go; ein Go für 28A
aktiviert 28B nicht und umgekehrt.

**Zweck 28A bei Go:** Externe Bewerbungen werden nicht mehr nur als Klick
interpretiert; Kandidaten können einen eigenen, ehrlich benannten
Outcome-Tracker führen. **Zweck 28B bei Go:** Interviews erhalten Termin,
Zeitzone, Teilnehmer, Zusage, Absage, Verschiebung, ICS und Reminder,
getrennt vom Pipeline-Status.

**Befunde:** `STH-015`, `STH-016`.

**Abhängigkeiten:** 20/23 für Delivery und Reminder; 21/22 für Dokument- und
Privacy-/Retention-Verträge; 25/26 für Capability-, Company-Trust- und
Tenant-Rechte; Phase 27 nur, falls Multi-Persona Teil des Launchscopes ist.
Bestehende Application-, Conversation- und Notification-Domain.

**Pflicht-Gates:** Click ist niemals Submitted; Kandidaten-Ownership;
unveränderlicher Job-/Company-Snapshot; explizite Statusherkunft;
Interview- und Pipelinezustand getrennt; IANA-Zeitzone/DST;
idempotente Accept/Decline/Reschedule; Kalenderadapter optional und gegatet.

**Risiken:** falsche Conversion, Arbeitgeberzugriff auf private
Selbstauskunft, Doppeltermine, Zeitzonenfehler und Reminder-Spam.

**Regression und Rollback:** interner Apply-/Withdraw-/Pipeline-/Messaging-
Flow, External Redirect und Analytics bleiben korrekt. Tests decken
Click→selbst bestätigt→Outcome sowie Employer-Vorschlag→Candidate-Antwort→
Verschiebung→Reminder ab. Neue Tracker/Termine sind additiv; Rollback
deaktiviert Mutationen, ohne Historie zu löschen.

### [ ] 29 — Research, UX, Mobile und Accessibility

**Zweck:** 29A startet nach Phase 19 mit moderierten Candidate-, Employer-
und Operator-Aufgaben und misst Task Success, Zeit, Fehler, Abbruch und
Verständnis. 29B prüft die danach stabilisierten kritischen Journeys in
Chromium, Firefox und WebKit sowie mit Tastatur und dokumentierten
Assistive-Technology-Smokes.
Breite Tabellen werden auf kleinen Viewports zu priorisierten Cards/Listen
mit vollständiger Action-Parität. Das in Phase 20 eingeführte
Preference-Center erhält hier die vollständige responsive, verständliche
und barrierearme Oberfläche samt Empty/Error/Locked/Success-Zuständen.

**Befunde:** `STH-023`, `STH-025`, `STH-033` sowie die
UX-/Regressionsebene von `STH-026`.

**Abhängigkeiten:** 29A beginnt nach 19 ohne technische Featureabhängigkeit
und übergibt rote Befunde an deren Owner. 29B folgt den zielrelevanten
Phasen aus 20–30. Phase 24 ist bei
Paid Scope für Checkout-/Invoice-/Refund-/Dunning-Oberflächen Pflicht; im
kostenlosen Scope prüft Phase 29 stattdessen die fail-closed Kauf-CTAs und
Locked States. Phase 27, 28A und 28B gelten nur bei ihrem jeweiligen
Demand-/Launchscope. Capability-, Trust-, Search- und Freshness-Oberflächen
werden im öffentlichen Scope in jedem Fall im endgültigen Vertrag geprüft.

**Pflicht-Gates:** Chromium/Firefox/WebKit auf kritischen Journeys;
`critical` und `serious` Accessibility-Triage; vollständige Keyboard-,
Dialog-, Focus-Trap- und Focus-Restore-Flows; NVDA-/VoiceOver-Smokes;
320/360/Desktop; keine versteckte Primäraktion; Action-Parität zwischen
Card und Tabelle; verständliche Preference-Zwecke und nicht deaktivierbare
Pflichtklassen.

**Risiken:** Browserflakiness, responsive Action-Verlust, doppelter DOM mit
abweichender Semantik, unsichtbarer Overflow und irreführende
Notification-Kontrollen.

**Regression und Rollback:** Alle 100 historischen Seiten bleiben als
Ausgangsinventar erhalten und neue Routen kommen hinzu. Kritische
Public-/Candidate-/Employer-/Recruiter-/Admin-Journeys laufen auf
Desktop/320/360; Tabellen-/Card-Aktionen verändern dieselben serverseitigen
Verträge. Ein UI-Rollback darf Capability- oder Preference-Gates nicht
umgehen.

### [ ] 30 — Startcluster-Suche und Scale Operations

**Zweck:** Vier getrennt evidenzierte Tracks vermeiden falsche Prioritäten.
Track 30A liefert früh gemeinsame Berufs-, Orts-/Regions-,
Qualifikations-/Zertifikats-, Skill- und Branchenkonzepte, fachliche Korpora
und privacy-safe Search-Learning für den tatsächlichen Startcluster.
Track 30B skaliert später Adminqueues und Recommendations. Track 30C misst
Sitemap-Kapazität und behält die sichere Single-Sitemap unter dem Trigger;
Index/Shards werden erst rechtzeitig vor realem Capacity-Bedarf gebaut.
Track 30D schliesst Reconfirmation, Reminder/Grace, Filled-/Unavailable-
Meldung, Duplicate-/Copied-Job-Review und die Eligibility-Parität aller
Consumer.

**Befunde:** Track 30A `STH-019`/`STH-036` P0 je aktivierter
LC3+-Clusterfreigabe (P1 im beaufsichtigten Design-Partner-Scope); Track 30B
`STH-020`, `STH-021`; Track 30C `STH-027` P3/kapazitätsabhängig; Track 30D
`STH-032` P0 für LC3+.

**Abhängigkeiten:** 30A folgt auf Phase 19 und das in 31A durch
Berufsfachpersonen freigegebene Startcluster-Query-/Judgment-Korpus. Er muss vor
öffentlicher Clusteraktivierung, Indexierung, Paid Acquisition und finaler
Search-/Alert-/Recommendation-UX abgeschlossen sein. 30B hängt von 22, 23 und
25 ab; 29 verifiziert danach die sichtbaren Search-Flows. 30C erhält seine
Messbaseline aus 19 und produktive Alerts/Runbooks aus 23; Sharding hängt nur
vom dokumentierten Trigger ab. 30D hängt für Reminder/Expiry-Worker von 23
und für Trust-Entzug/Appeal von 25/26 ab; es muss vor LC3+ grün sein.

**Pflicht-Gates 30A:** immutable Berufs-/Ort-/Region-/Qualifikations-/
Zertifikats-/Skill-/Branchen-Konzepte/Aliase und
Taxonomie-/Search-/Ranking-Releases; Search↔Alert-Parität; `desiredTitles`
wirkt auf Recommendations/Match; ClusterLaunchAssessment V2 bindet Query-Set,
Search-Policy, Ranking und Taxonomie und zählt fachlich relevante Top-K-
Judgments statt beliebiger Substrings. Zentralbegriffe besitzen positive und
negative Tests, keinen bekannten False-Zero bei vorhandenem passenden Job und
erfüllen das eingefrorene Recall-/Precision-/p95-Budget. Pflege und
Engineering besitzen getrennte Korpora; nur der gewählte Cluster zählt.
Bestehende Result-count-Buckets bleiben, neue Unknown-/Zero-Result-Signale
sind thresholded, retention-begrenzt, frei von Raw-PII/stabilen
User-Identifiern und gelangen nur durch Human Review in eine neue
Taxonomieversion. Boost bleibt hinter Relevanz; Cursor/Alert behandeln
Releasewechsel kontrolliert.

**Pflicht-Gates 30B:** serverseitige Adminfilter vor Pagination,
Cursorstabilität, vollständige >250-Fälle, Query-Count-/p95-Budgets,
capability-gebundene Bulk-/Export-Teilfehler und Freshness-Metriken.

**Pflicht-Gates 30C:** Zielumgebungs-Counts pro Ressource/gemeinsam,
unkomprimierte Bytes, Laufzeit, letzter Erfolg, 7-/30-Tage-Wachstum,
90-Tage-Prognose, Alert, Runbook und Owner. Unter 70 % bleibt
`STH-027 P3 DEFERRED / MONITORED`; ab 70 % wird Sharding terminiert, vor 80 %
deployt, ab 90 % oder Capacity-/Byte-/Timeout-/p95-Fehlern wird Expansion
gestoppt. Nur beim Trigger sind Sitemap-Index, Ressource-/optionale
Cluster-Shards und die >50.000-/Byte-/Eligibility-Suite Abschlussgate.

**Pflicht-Gates 30D:** kanonische Freshness-Policy; idempotente Reconfirmation
und Reminder; bounded Filled-/Unavailable-Abuse-Intake; Exact-/Near-Duplicate-
Review mit False-Positive-Appeal; bei Ablauf, Trustverlust, Filled oder
Entzug identische Deaktivierung in Public Search, Alerts, Recommendations,
Matching/Radar, Feeds, Exports, Analytics und Sitemap innerhalb des
freigegebenen SLO.

**Risiken:** Alias-/Trigramm-False-Broadening, Rankingregression,
doppelte/fehlende Cursorresultate, Querykosten, Search-/Alert-/Recommendation-
Versionsdrift, Index-Leak privater/DEMO-Daten, veraltete Projektionen,
verfrühte Shardkomplexität oder verspäteter Capacity-Ausbau.

**Regression und Rollback:** 30A nutzt Vorher/nachher Golden-/Negativkorpus,
task-only-Alert-Parität, Query Plans, parallele Publish/Expiry-Fälle und
Cluster-V1→V2-Fail-closed-Cutover. 30B schützt Query-Count-Ceiling und >250
Adminitems. 30C testet unter Trigger das heutige no-truncation/fail-closed plus
Monitoring; nur bei ausgelöstem Ausbau zusätzlich >50.000 synthetische URLs,
Bytegrenze, exakt-einmal-Eligibility und Index-/Shard-Rollback. Kein Rollback
darf bekannte zentrale Search-False-Zeros oder unzulässig indexierbare URLs
reaktivieren.

### [ ] 31 — Monetarisierung und Marktvalidierung

**Zweck:** Produktbreite, Cluster und Preis werden nicht aus Demoaktivität
abgeleitet. Business/Enterprise zeigt nur freigegebene, lieferbare
Leistungen. ATS/API/SSO/Import/SLA werden entweder end-to-end gebaut und
betrieben oder ausdrücklich nicht verkauft. Demo-Copy wird erst nach echter
Freigabe in produktive Angebotskommunikation überführt.

**Befunde:** `STH-018`, `STH-022`, `STH-028`, `STH-034`, `STH-035`,
`STH-037`.

**Abhängigkeiten:** Der Query-/Judgment-Substream startet nach Phase 19 mit
bestätigtem Startcluster und Berufsfachreview und liefert sein freigegebenes
Korpus sofort an 30A. Der übrige Discovery-Track für ICP, Packaging,
Cashflow/Runway, Liquiditätshypothesen und rechtlich zulässige manuelle
Zahlungsbereitschaftstests benötigt zusätzlich seine AVG/Tax/Vertrags-/
Partner-Gates und setzt frühe Go-/No-go-Gates. Die technische
Production-Freigabe, endgültige Paid-WTP-Auswertung und Angebotsaktivierung
hängen von den zielrelevanten P1-Tracks der Phasen 22–30 sowie Provider-,
Liquiditäts- und Salary-Daten-Gates ab. Track 30C/STH-027 ist nur bei seinem
Capacity-/Forecast-/Performance-Trigger Pflicht.

**Pflicht-Gates:** genau ein erster Region×Beruf-Cluster; vorregistrierte
bezahlte KMU-Angebotstests in der Reihenfolge Basisworkflow,
Hiring-Sprint, Retainer, Concierge/rechtmässiger Import vor Boost (nur bei
Reichweitenengpass) und Radar (nur bei Dichte);
Kohorten-/Quellprovenienz; Cashflow/Runway; Cluster-Dual-Approval aus
ausschliesslich LIVE-Daten **plus** bestandenem Cluster-V2-Suchqualitätsgate
aus 30A; Package-to-Entitlement-to-Delivery-/Service-Recovery-Matrix;
Support-/SLA-Owner, Minuten/Arrival/Backlog/Capacity/Vollkosten/
Überlast-Stopp; Enterprise-Integrations-ADR; Salary-LIVE-Gate.

**Risiken:** Scheinliquidität, Unterpreis, hoher Concierge-Aufwand,
verkaufte aber nicht lieferbare Funktionen, AVG-Verstoss und Entfernung
ehrlicher Mock-Hinweise zu früh.

**Regression und Rollback:** DEMO/TEST bleibt unverändert klar markiert und
aus LIVE-KPIs ausgeschlossen. Jedes Angebot wird vom Marketingtext über
Entitlement, operativen Prozess, Provider und Support-Evidence geprüft.
Nicht erfüllte Gates entfernen CTA/Indexierung fail-closed; sie werden nicht
durch manuelle DB-Edits umgangen.

### [ ] 32 — Finaler Production-Release-Audit

**Zweck:** Ein einziger unveränderlicher Commit und sein tatsächlich
deployedes Artefakt erhalten vollständige technische, manuelle, betriebliche
und externe Evidence. Die Phase schliesst keine offenen Rechts- oder
Marktfragen durch Code und übernimmt keine Testergebnisse von
Vorgängercommits.

**Befund:** `STH-024` sowie Abschlussprüfung aller `STH-001` bis
`STH-037`.

**Abhängigkeiten:** alle für die gewählte Betriebsstufe und den konkreten
Launchscope relevanten Findings/Tracks aus 19–31 sowie deren externe Gates.
Die Betriebsstufe ist exakt eine der sechs Klassen LC1–LC6. Phase 26 ist für
öffentliche Firmen-/Job-/Badge-/Radar-Trustflächen zwingend. Phase 28A/28B
sind nur erforderlich, wenn das konkrete Produktversprechen ihren Tracker
beziehungsweise Scheduler enthält; der interne Bewerbungsflow hängt nicht
pauschal davon ab.
Bewusst ausgeschlossene P2-/Enterprise-Funktionen müssen nachweislich
fail-closed sein. Nicht ausgelöste P3-Kapazitätsarbeit wie STH-027 benötigt
stattdessen datierten Headroom, Forecast, Monitoring, Alert und Owner, ohne den
Audit künstlich zu blockieren.

**Pflicht-Gates:** Release-Freeze; Clean Clone; Migration/Backfill/Seed/
Build; vollständige Unit-/Integration-/HTTP-/Browser-/Security-/A11y-/
Performance-Suite; Production-Demo-Guard; echter Staging-Smoke; Worker- und
Provider-Failure-Drill; verschlüsselter Backup/Restore; manueller
Public-/Candidate-/Employer-/Recruiter-/Admin-Walkthrough auf exakt
demselben Commit/Artefakt; Commit-, Image- und Evidence-Digests.

**Risiken:** Evidence-Drift, nachträgliche Codefixes ohne Neulauf,
unvollständige externe Freigaben und Freigabe unter Zeitdruck.

**Regression und Rollback:** Jede Code- oder Konfigurationsänderung nach
Beginn invalidiert die betroffenen Gates und erzwingt einen neuen
Releasekandidaten. Rollback wird gegen die vorherige kompatible
Produktionsversion geprobt; Migrationen, Provider-Side-Effects und
Privacy-Löschung werden als Roll-forward-/Reconciliation-Fälle separat
behandelt.

## 8. Abhängigkeiten, Parallelisierung und Konfliktgrenzen

### 8.1 Kritischer Pfad

```text
19 Baseline/Governance
  ├─> 31A: genau ein Cluster + Problem/WTP/Offer-/Cashflow-Discovery
  │     ├─> 29A moderierter Research
  │     └─> 30A Search-/Judgment-Korpus + sichere Zero-Result-Lernschleife
  ├─> 20 Identity/E-Mail/atomare Outbox
  │     └─> 21 Quarantäne-Document-Vault
  │            └─> 22 Privacy-/Legal-/Analytics-Vertrag
  │                   └─> 23 autonome Worker/Provider/Ops-Kapazität
  └─> 25A/25B/25C Assurance-/Fraud-Design parallel, Integration nach 20/23

20 + 23 -> 25 Privileged/Non-Admin Assurance + Trust & Safety
21 + 22 + 23 + 25 -> 26 Company Trust
19 + 23 -> 30D Job-Freshness/Anti-Ghosting
31A-Go + 20 + 22 + 23 + 25 -> 24 Billing/Finance (nur LC5/LC6)

20–23 + 25 + 26 + 30A + 30D + zielklassenspezifische externe Gates
  -> 29B finale UX/Mobile/A11y/Cross-Browser-Abnahme
  -> 31B Angebot aktivieren (Base/Hiring Sprint/Retainer/Concierge/Import
     vor Boost; Radar nur bei Talentdichte)
  -> 32 zielklassenspezifischer G4-Release-Audit

Optionale Seitenpfade, nicht Standard-Critical-Path:
  27 nur nach explizitem Multi-Persona-Go
  28A Tracker und 28B Scheduler jeweils nur nach eigenem Demand-Go
  30B nur bei Query-/Queue-/Volumentrigger
  30C Shards nur bei Count-/Byte-/Forecasttrigger
```

Die Darstellung zeigt den konservativen Integrationspfad. Externe Research-
und Vertragsarbeit für 22, 23, 24 und 31 darf früher beginnen, schliesst die
technische Phase aber nicht.

### 8.2 Sinnvoll parallelisierbar

- Nach Phase 19 können Identity/Outbox, Vault-Threat-Model,
  Assurance/Fraud-Design, 31A-Marktdiscovery, 29A-Research und das
  30A-Query-/Judgment-Korpus getrennt vorbereitet werden. Gemeinsame
  Schema-/Event-/Capability-Schnittstellen werden erst an den im
  Ausführungsvertrag benannten Integrationslocks zusammengeführt.
- Der Phase-31A-Discovery-Track mit Provider-Due-Diligence,
  AVG-/Privacy-/Tax-Review, Salary-Datenprüfung, vorregistrierten
  WTP-Angebotsversuchen, Cashflowmodell und fachlichem Startcluster-Query-/
  Judgment-Korpus startet nach Phase 19 parallel zur technischen Vorarbeit.
  Sein Korpus speist Track 30A; das Go-/No-go-Ergebnis liegt vor teurem
  Payment-/Premium-Ausbau vor. Die Phase-31B-Produktionsfreigabe bleibt am Ende
  der technischen Kette.
- Track 30A beginnt nach Phase 19/31A-Korpus früh. Phase 29 kann die
  moderierte Discovery 29A parallel durchführen; 29B übernimmt die finale
  sichtbare Search-/Alert-/Recommendation-Abnahme aber erst gegen den grünen
  30A-/30D-Vertrag.
- Track 30D inventarisiert nach Phase 19 alle öffentlichen, Alert-,
  Recommendation-, Radar-, Feed-, Export- und SEO-Consumer. Er kann vor dem
  breiten UX-Refactor umgesetzt werden, muss aber mit 23 (Reminder/Worker),
  26 (Company Trust) und 30A (Searchprojektion) sequenziert werden.
- Sitemap-Count-/Byte-/Growth-Baseline und Shard-ADR können früh vorbereitet
  werden. Der operative Monitor folgt Phase 23; Index/Shards werden nur bei
  STH-027-Trigger integriert.
- Phase-32-Runbook- und Evidence-Templates können vorbereitet werden, aber
  keine Ergebnisse oder Häkchen vorwegnehmen.

### 8.3 Nicht gleichzeitig integrieren

- Phasen 20–22 dürfen keine konkurrierenden Migrationen an User, Consent,
  Notification, Document und Privacy Case auf demselben Zielbranch landen.
- Phase 23 bündelt Providercomposition und autonome Runtime; deren
  Teilstränge dürfen nicht unabhängig aktiviert werden. Phase 24 baut auf
  diesem stabilen Worker-/Webhookvertrag auf.
- Phase 24 darf nicht parallel zu Katalog-/Ledger-/Order-Änderungen aus
  anderen Phasen gemerged werden.
- Phase 25 muss vor Phase 26 und vor jedem aktivierten Track 27/28 integriert
  sein; sonst würden Trust-, Persona- und Recruiting-Aktionen gegen eine bewegliche
  Capability-Grundlage gebaut.
- Phase 20 besitzt Notification-/Preference-Taxonomie, Phase 22 die
  Analytics-/Consent-Semantik. Keine parallele Phase darf eigene
  unversionierte Alternativen einführen.
- Phase 30A darf früh Taxonomie/Search Core bauen, muss seine Job-Alert-
  Snapshot-/Dispatch-Änderungen aber mit Phase 20 sequenzieren; kein
  konkurrierendes unversioniertes Alertmodell darf gemerged werden.
- Phase 29A ist frühe Research-Arbeit; der breite Portal-/UI-Refactor 29B
  beginnt erst nach den im Launchscope enthaltenen fachlichen Änderungen
  25–28 sowie den Search-/Freshness-Verträgen 30A/30D. Die breiten
  Admin-/Recommendation-Änderungen aus 30B folgen der stabilen
  UI-/Capability-Grundlage. Track 30C berührt Sitemap-Routen nur bei
  dokumentiertem Trigger.
- Während Phase 32 gilt Feature Freeze. Jeder notwendige Fix erzeugt einen
  neuen Releasecommit und einen risikobasiert vollständigen Neulauf.

## 9. Globaler Risiko- und Regressionsplan

| Risikoklasse | Schutz vor Umsetzung | Automatischer Nachweis | Manueller/externer Nachweis |
| --- | --- | --- | --- |
| Identity/Privilege | Threat Model, Capability- und Step-up-Matrix | Token-Replay, Sessionversion, Rollen×Ressourcen, IDOR | Admin-Recovery, break-glass, Supportprozess |
| Fraud/Trust | versionierte Risk-Signale/Entscheide, False-Positive-/Appeal- und schnelle Revocation-Matrix | Credential Stuffing/ATO, Scam-/Duplicate-Job, compromised Company, Mass Contact, Reveal/Export, Payment Fraud | Trust-&-Safety-Triage, Incident-/Appeal-Drill |
| Privacy/Radar | Dateninventar, Zweck/Retention, Safe DTOs | Canary-Leak, Reveal-Scope, Export/Löschung, Eligibility-Kaskaden | Legal/Privacy Sign-off, Betroffenen-Drill |
| Dokumente | Klassifizierung, Quarantäne, Key-/Bucket-Design | MIME/Magic Byte, Malware, Object-IDOR, Löschung | DPA, Storage-/Key-Recovery |
| Async/Provider | Outbox/Inbox, Idempotenz, Retrybudget | Crash, Duplicate, Out-of-order, DLQ, Replay | Sandbox-/Staging-Ausfallübung |
| Geld | Snapshot, Ledger, Reconciliation, Tax-Matrix | Webhook-Replay, Refund, Dispute, Double Confirm | Tax/Finance Sign-off, echter kontrollierter Test |
| Migration | Expand/Migrate/Contract, Lock-/Backfill-Budget | Clean Migration, alter+neuer Reader, Counts/Checksums | Staging-Copy, Backup/Restore |
| Startcluster Search P0 je LC3+ | fachlich freigegebenes Golden-/Negativkorpus und versionierte Shared-Concept-Taxonomie | Search/Alert/Recommendation/Cluster-V2-Parität, Ranking, Cursor, Recall/Precision/p95 | Berufsfachreview je Cluster/Sprache |
| Job Freshness | Reconfirmation-/Expiry-/Report-/Duplicate-Policy und Consumerinventar | Reminder/Grace/Race, Filled/Unavailable, Exact-/Near-Duplicate, Eligibility-Parität | Arbeitgeber-/Candidate-Meldepfad und Appeal |
| SEO Capacity P3 | Count-/Byte-/Growth-Headroom und Triggervertrag | Monitor/Forecast/Alert; >50k-/Byte-/Shard-Suite nur bei Trigger | Ops Owner, Runbook und Search Console |
| UX/A11y | responsive State-/Action-Inventar | 320/360/Desktop, Browsermatrix, axe, Keyboard | NVDA/VoiceOver und Rollen-Walkthrough |
| Moderierter Research | vorregistrierte Segmente, Tasks und Stop-/Erfolgsschwellen | Researchdaten-Schema/Redaction, keine PII-Analytics-Ersatzbehauptung | Task Success, Zeit, Fehler, Abbruch, Verständnis mit Zielrollen |
| Ops/Service | Capacity-/Unit-Cost-/Backlog-/Overload- und Service-Recovery-Matrix | Last/Backpressure, exactly-once Credit/Refund/Extension/Replacement | Staffing-/Kostenfreigabe und bezahlter Failure-/Recovery-Drill |
| Markt/Commercial | vorregistrierte Hypothese und Provenienz | DEMO/LIVE-Trennung, Funnelreconciliation | reale KMU-Zahlung, Liquidität, Cashflow |
| Release Evidence | exakter Commit, Freeze, Manifest | Clean Clone, Full Suite, Digests | exakt gleiches Artefakt manuell, Freigaben |

### 9.1 Verbindliche Regressionsebenen

Jede Phase definiert ein risikobasiertes Teilset, aber folgende Ebenen dürfen
nicht still ausgelassen werden:

1. **Unit/Contract:** Policies, Parser, Token, Statusmaschinen,
   Providerports, DTOs, Feature-Gates.
2. **PostgreSQL-Integration:** Constraints, Transaktionen, Concurrency,
   Tenant/Ownership, Outbox/Inbox, Ledger, Backfill und Query Plans.
3. **HTTP/Server Actions:** Auth, Origin/CSRF, Rate Limit, Cache/Headers,
   Fehlerkontrakte und direkte Mutationsaufrufe.
4. **Browser:** kritische Cross-role-Journeys, Desktop und kleine
   Viewports; ab Phase 29 kritische Journeys auch in Firefox/WebKit.
5. **Security/Privacy:** Secret-/Dependency-Scan, IDOR-Matrix,
   Daten-/Log-Canaries, Webhook-Replay und Dateiuploadangriffe.
6. **Betrieb:** Migration, Worker-Failure, Providerdegradation,
   Backup/Restore und Alarmzustände.
7. **Manuell/extern:** Copy, Screenreader, Providerkonsole,
   Finance-/Legal-/Privacy-/Operations-Entscheidungen.

Ein Test darf nur als Evidence zählen, wenn Befehl, Umgebung, Commit,
Ergebnis und relevante Artefaktdigests dokumentiert sind. „Test existiert“
ist kein bestandener Nachweis.

## 10. Rollback- und Kompatibilitätsstrategie

- **Code:** kleine, phasenbezogene Commits; keine Vermischung mit lokalen
  Nutzeränderungen. Rollbackziel ist der letzte fachlich kompatible
  Releasecommit.
- **Schema:** additive Migration zuerst. Eine bereits produktiv angewandte
  destruktive Migration wird nicht durch Git-Revert „zurückgerollt“, sondern
  durch vorbereiteten Roll-forward und Restore-/Reconciliation-Entscheid
  behandelt.
- **Events/Queues:** Payloads sind versioniert. Mindestens die laufende und
  unmittelbar vorherige Worker-Version müssen während eines Rolling
  Deployments kompatibel sein.
- **Provider:** Kill Switch stoppt neue Aufträge; Inbox, Outbox,
  Reconciliation und Audit bleiben lesbar. Externe Side Effects werden
  kompensiert, nicht aus der Historie gelöscht.
- **Payments:** Keine manuelle Statuskorrektur ohne auditiertes
  Reconciliation-Ereignis. Refund, Chargeback und Fulfillment-Korrektur
  bleiben getrennte Vorgänge.
- **Privacy:** Bestätigte Löschung wird nicht rückgängig gemacht.
  Backups folgen der freigegebenen kryptografischen Erasure-/Expiry-Policy;
  Legal Holds sind explizit und minimal.
- **UI/API:** neue Zustände werden vor Aktivierung alter Clients
  fehlertolerant eingeführt. Contractversionen und Sunset-Fristen werden
  dokumentiert.
- **Commercial:** Ein nicht erfülltes Gate deaktiviert Angebot/CTA
  fail-closed. Bereits geschlossene Verträge erhalten eine dokumentierte
  Service-/Kommunikationsstrategie statt stiller Produktänderung.

## 11. Globale Definition of Done

Eine Remediation-Phase ist erst `[x]`, wenn alle für sie zutreffenden Punkte
erfüllt und in ihrer eigenen Evidence belegt sind:

- [ ] fachlicher Ist-/Soll-Vertrag und Nicht-Ziele sind eindeutig;
- [ ] betroffene Rollen, Tenants, Datenklassen, Statusmaschinen und
  Downstream-Flows sind vollständig erfasst;
- [ ] Schemaänderungen besitzen Migration, Constraints, Indizes,
  Backfill-/Rollback- und Restore-Nachweis;
- [ ] Domain, Providerport, Serverpolicy und UI bilden einen echten
  End-to-End-Flow ohne Fake-Aktion oder reine Textkarte;
- [ ] Auth, Capability, Ownership, Assignment, Step-up, Consent und
  Feature-/Release-Gates werden serverseitig geprüft;
- [ ] Loading-, Empty-, Error-, Locked-, Retry-, Conflict-, Success- und
  mobile Zustände sind vorhanden;
- [ ] Audit, Redaction, Rate Limit, Idempotenz, Observability und
  Recovery sind der Risikoklasse angemessen;
- [ ] positive, negative, Cross-Tenant, Concurrency, Failure- und
  Regressionstests sind auf dem unveränderlichen Codecommit gelaufen;
- [ ] Seed-/Fixture-Daten machen den Flow lokal erreichbar, bleiben aber
  klar DEMO/TEST und sind kein LIVE-Nachweis;
- [ ] Dokumentation, ADRs, Runbooks, Requirements-/Traceability-Matrix und
  Route-/Role-Inventar stimmen mit Code und Schema überein;
- [ ] jeder externe Gate hat Owner, Entscheidung, Datum, Scope und
  referenzierbare Evidence oder bleibt ausdrücklich offen;
- [ ] keine offene P0-/Critical-Lücke wird durch Wortwahl, Feature-Flag oder
  manuelle Bedienung als geschlossen dargestellt;
- [ ] `git diff --check`, Plan-/Link-/Route-/Security-Audits und das
  phasenbezogene Testset sind grün;
- [ ] der Phase-Commit enthält keine fremden Dateien, Credentials,
  generierten Laufzeitdaten oder Klartext-Backups;
- [ ] die Detailphase wird zuerst, danach der Masterstatus aktualisiert;
  beide verweisen auf denselben Evidence-Record und Codecommit.

Phase 32 besitzt zusätzlich die globale Freigabegrenze: vollständige Suite,
Clean Clone, Staging-/Failure-/Restore-Drills und manueller Walkthrough
müssen auf exakt demselben Releasecommit beziehungsweise nachweislich
identischen Artefakt laufen. Ein danach notwendiger Codefix macht die
betroffenen Ergebnisse erneut offen.

## 12. Git- und Evidence-Ausführung

### 12.1 Branch- und Commitdisziplin

1. Phase 19 startete erst nach bestätigter, sauber isolierter Baseline; ihr
   Abschlusscommit und Record bleiben die Basis aller Folgephasen.
2. Jede Phase nutzt einen eigenen `codex/phase-XX-*`-Branch und enthält nur
   ihren freigegebenen Scope.
3. Vorhandene Nutzeränderungen werden weder gestaget noch überschrieben.
4. Commit-Identität bleibt, wenn der Nutzer den Commit autorisiert,
   `Giuliano Carosella <carosellagiuliano@gmail.com>`.
5. Commit erst nach bestandener phasenbezogener Verification und
   aktualisierter Evidence; ein Zwischencommit darf nicht als Phaseabschluss
   bezeichnet werden.
6. Kein Push, Merge oder Pull Request erfolgt allein aufgrund dieses Plans.
   Es gilt die jeweils ausdrückliche Nutzerfreigabe; ohne neue Freigabe
   bleibt die Arbeit lokal. Ein Pull Request wird nur auf expliziten Wunsch
   erstellt.
7. Nach einem autorisierten Push werden lokaler SHA, Remote-SHA und Zielbranch
   verglichen. Eine erfolgreiche Übertragung ersetzt keine CI- oder
   Release-Evidence.

### 12.2 Evidence pro Phase

Der spätere Record wird aus
[`remediation-evidence-template.md`](./remediation-evidence-template.md)
erst auf dem Zielcommit erzeugt. Er liegt als
`codex-plan/evidence/YYYY-MM-DD-phase-XX.md` vor und enthält
mindestens:

- Datum/Zeitzone, Branch, vollständigen Codecommit und Commitidentität;
- Ausgangs- und Zielvertrag sowie zugeordnete `STH-*`-Befunde;
- tatsächliche Schema-/Migrations-/Provider-/Route-/Role-Änderungen;
- exakte Befehle, Tool-/DB-/Browser-/Providerumgebung und Exitcodes;
- Testzahlen ohne Addition gezielter Diagnosewiederholungen;
- Concurrency-/Failure-/IDOR-/Privacy-/Money-Nachweise;
- manuelle Schritte mit Rolle, Route, Artefakt und sichtbarem Ergebnis;
- externe Freigaben als Referenz, Scope, Owner und Datum, ohne vertrauliche
  Verträge oder Secrets ins Repository zu kopieren;
- bekannte Grenzen, offene Gates und zulässige Releaseaussage;
- `git status`, Diff-/Secretprüfung und Bestätigung, dass lokale
  Nutzeränderungen nicht Teil des Commits sind.

Für noch nicht implementierte Phasen existiert bewusst keine vorgetäuschte
Evidence und dieser Masterplan verlinkt keine zukünftigen
Evidence-Dateinamen.

## 13. Abschlussregel

Die Reihenfolge 19–32 ist die verbindliche technische Integrationsreihenfolge,
nicht die Reihenfolge externer Recherche. Ein Befund wird erst geschlossen,
wenn die Zeile in [`remediation-traceability.md`](./remediation-traceability.md)
auf eine tatsächlich bestandene Phase-Evidence zeigt. Bis dahin bleibt die
korrekte Produktaussage:

> SwissTalentHub ist ein umfangreich verifizierter lokaler Demo-MVP mit
> serverseitigen Schutzmechanismen und klaren Mock-Grenzen. Reale Provider,
> autonome Operations, Rechts-/Privacy-/Tax-Freigaben, bezahlte
> Marktvalidierung und ein exakt identisch verifizierter Produktionskandidat
> sind durch die offenen Phasen 19–32 gegatet.

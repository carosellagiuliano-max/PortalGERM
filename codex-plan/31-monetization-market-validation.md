# Phase 31 — WTP-first Monetarisierung, Cluster- und Lieferfähigkeitsvalidierung

> **Planstatus: PARTIELL / OPEN. Technikstatus: 31B-LOCAL-/CI-BASIS
> IMPLEMENTIERT. Quality-Gate: LOCAL/CI PASS. Aktivierung: DISABLED.** Track
> 31A ist nicht durch Code ersetzbar und weiterhin extern offen: Es gibt noch
> keinen fachlich freigegebenen ersten Cluster, keinen realen Net-WTP-
> Nachweis, keine echte Deliverykohorte und keine Legal-/Tax-/AVG-/
> Operationsfreigabe. Track 31B stellt dafür nun fail-closed Persistenz,
> Release-Gates, Capacity-/Cashflow-/Recovery-Verträge, ehrliche Copy und
> einen Draft-only-Import bereit. Mock-/Testmode-Zahlungen, kostenlose
> Design-Partner und unverbindliche Leads zählen weiterhin null
> Zahlungsbereitschaft.

Es gilt
[`remediation-execution-contract.md`](./remediation-execution-contract.md)
vollständig.

## Phasenspezifische Instanziierung des 28-Punkte-Vertrags

### 1. Status

| Track | Planstatus | Technikstatus | Quality-Gate | Aktivierung |
|---|---|---|---|---|
| 31A WTP-/Delivery-Discovery | nach bestandener Phase 19 zulässig, noch nicht durchgeführt | externe/manuell kontrollierte Validierung nicht begonnen | technische Evidence-Klassifikation `PASS`; reale Fach-/Marktprüfung offen | keine öffentliche Produktaktivierung |
| 31B Product Release | technische Vorarbeit vorhanden; öffentliche Freigabe erst nach grüner 31A-Evidence und Owning-Phasen | additive Persistenz, immutable Releases und fail-closed Policies implementiert | Unit/PostgreSQL/HTTP/Browser und Vollregression `PASS` | `DISABLED` |
| Boost | Hypothese | Release-Gate implementiert; ohne Kernoffer plus organische LIVE-Reichweitenevidence nicht freigebbar | technische Positiv-/Negativmatrix `PASS`; reale Reichweite offen | `DISABLED` |
| Talent Radar | Hypothese | Release-Gate implementiert; Candidate Opt-in/Accept/Reveal bleibt zwingend | technische Privacy-/Funnelmatrix `PASS`; reale Dichte/Nutzung offen | Paid-Entitlement `DISABLED` |
| Salary-Angebot | extern bedingt | Default-off/noindex-Gate implementiert; kein freigegebener Realdatenvertrag | technische Negativmatrix und HTTP `PASS`; BFS/LSE-/Legal-Gate offen | Public/SEO/Paid `DISABLED` |

### 2. Ziel und messbarer Nutzer-/Businesswert

- Ein KMU bezahlt zuerst für eine verständliche, lieferbare Kernleistung:
  Basis-Recruiting-Workflow, zeitbegrenzter Hiring Sprint, Retainer mit
  Credits, Concierge/Design-Partner-Leistung oder betreuten Import.
- Genau ein erster Region×Profession-Cluster bündelt Angebot, Nachfrage,
  Operations und Search-Qualität; weitere Cluster benötigen eigene Evidence.
- Bruttomarge, Servicezeit, Cash Conversion, Churn-/Pauseverhalten und
  Supportaufwand werden vor Skalierung gemessen.
- Boost verkauft nur nachweisbare zusätzliche Reichweite. Radar wird nur bei
  ausreichender Opt-in-Dichte und belegtem Contact→Accept→Reveal-Nutzen
  monetarisiert.
- Bezahlte Leistung hat vor Verkauf eine klare Recovery-, Refund-,
  Replacement- und Eskalationszusage.

### 3. Tatsächlicher Repositoryzustand

- `STH-018`: Cluster-Assessment-/Dual-Approval plus Phase-31-Releasebindung
  und DB-Backstop für genau einen ersten öffentlichen Cluster existieren;
  reale Liquidität und die externe erste Clusterentscheidung fehlen.
- `STH-019`: grobe Search-/Coverage-Evidence ersetzt kein fachliches
  Query-/Judgment-Korpus; 31A muss dieses an Phase 30A liefern.
- `STH-022`: Der betreute Import besitzt nun Source-Rights→Mapping→Preview→
  expliziten Draft-only-Commit und bleibt default-off; produktive ATS-/Feed-/
  API-/SSO-Leistungen sind weiterhin weder belegt noch verkaufbar.
- `STH-028`: Research-/Production-Copy wird aus demselben fail-closed
  Releasevertrag abgeleitet; echte Angebote sind mangels 31A-Evidence nicht
  freigegeben.
- `STH-034`: Versionierte Capacity-/Unit-Cost-Releaseverträge für
  Verification, Moderation, Import, Privacy, Fraud/Support und Billing-
  Ausnahmen sind technisch vorhanden; reale Messwerte, Staffing und Owner-
  Freigabe fehlen.
- `STH-035`: Eine versionierte kundensichtbare Paid-Service-Recovery-Policy
  bindet technische Remedies, SLA und Eskalation; echte Finance-/Support-/
  Legal-Freigabe und LIVE-Incident-Evidence fehlen.
- `STH-037`: Kernoffer-before-add-on ist technisch und in der DB erzwungen;
  Boost und Radar benötigen eigene LIVE-Evidence. Reale Kernworkflow-WTP ist
  weiterhin nicht bewiesen.

### 4. Findings und Requirements

- `STH-018`, `STH-019`, `STH-022`, `STH-028`, `STH-034`, `STH-035`,
  `STH-037`.
- `REQ-BIL-001/002/003/004`, `REQ-MKT-001/002`, `REQ-COM-001`,
  `REQ-ADM-005`,
  `REQ-OPS-001/002`, `REQ-INT-001/002`, `REQ-SEC-001/002`.
- Neu:
  - `REQ-COM-031-001`: genau ein erster öffentlicher
    Region×Profession-Cluster;
  - `REQ-COM-031-002`: WTP-first Angebotssequenz und bezahlte Evidence;
  - `REQ-COM-031-003`: Capacity-/Unit-Cost-/Cashflow-Gate;
  - `REQ-COM-031-004`: Paid-Service-Recovery vor Verkauf;
  - `REQ-COM-031-005`: Boost-/Radar-Add-ons erst nach eigenem Nutzengate.

### 5. In Scope

- **31A:** ICP und genau einen ersten Region×Profession-Cluster auswählen;
  Alternativen dürfen als Discovery-Kandidaten verglichen, aber nicht parallel
  aktiviert werden.
- WTP-first für Basisworkflow, 30-/45-/90-Tage-Hiring-Sprint, Retainer plus
  Credits, Concierge/Design-Partner-Paket und Paid Import Setup.
- Rechtlich, steuerlich und buchhalterisch freigegebene manuelle Rechnung als
  zulässiger früher Zahlungsnachweis; netto eingegangener Geldfluss und
  tatsächliche Delivery sind Pflicht.
- Zwei getrennte Discovery-Korpora für Pflege/Gesundheit und
  Engineering/Technik, jeweils mit eigener Fachperson und Digest. Genau eines
  wird nach dem Clusterentscheid als `SELECTED` an Phase 30A übergeben; das
  andere bleibt `DISCOVERY_ONLY`, erteilt keine Search-/SEO-/Acquisition-
  Freigabe und darf nie als Evidence des gewählten Clusters zählen.
- Kapazität und Unit Cost je Company Verification, Jobmoderation, Import,
  Privacy Request, Support-/Fraudfall und Billing-Ausnahme; Arrival Rate,
  Backlog, Staffing, On-call und maximaler Concierge-COGS je Kunde.
- 18-/24-Monats-Cashflow mit Timing von Cash-in, CAC, Providerkosten,
  Personal, Refunds, Pause/Reactivation, Churn und Sensitivitäten.
- **31B:** versionierte Offer-/Product-Releases, serverautorisierte Preise,
  Entitlements, Limits, Billing-/Recoveryvertrag und ehrliche Copy.
- Betreuter Import mit Source Rights, Mapping, Preview, Draft-only Commit,
  Fehlerreport und SLA. Wiederkehrender Sync nur nach eigenem Gate.

### 6. Out of Scope und deaktivierte Nachbarfunktionen

- Kein zweiter öffentlicher Cluster, bevor der erste seinen Messzeitraum
  abgeschlossen hat und ein eigener Folgeentscheid dokumentiert ist.
- Kein Success Fee vor AVG-/Legal-/Attribution-/Tax-/Unit-Economics-Freigabe.
- Kein Boost als erstes WTP-Angebot; kein bezahlter Boost ohne organisches
  Inventar, Reichweitenbaseline und messbaren Deliveryvertrag.
- Kein Paid Radar ohne ausreichende aktive Candidate-Opt-ins, Suchdichte,
  Contact-/Accept-/Reveal-Evidence und bestätigte Privacy-/Trust-Gates.
- Keine Enterprise-API, SSO, native App, White Label, Social Feed,
  öffentlicher Reviewmarkt oder ATS-Ersatz ohne separat bezahlte Nachfrage.
- Kein Salary-Radar mit synthetischen/erfundenen Werten. Ohne freigegebene
  BFS/LSE-Datenquelle, zulässige Methodik und Disclosure bleibt er deaktiviert
  und `noindex`.
- Mock, Stripe-Testmode, Seed, kostenloser Pilot, LOI und Lead zählen null WTP.

### 7. Rollen und Owner

Employer Buyer/Owner bestätigt Kauf und Nutzen. Sales/Research rekrutiert,
ohne Leads als Umsatz zu zählen. Product besitzt Offer-/Clusterhypothese.
Finance besitzt Cashflow, Rechnung, Tax und Reconciliation. Ops/Customer
Success besitzt Delivery-/Recovery-SLA. Search plus Berufsfachperson besitzen
das Korpus. Privacy/Security/Legal/AVG genehmigen flowspezifisch. Engineering
besitzt 31B, Import und Kill Switch. Zwei getrennte Phase-25-Approver
aktivieren den Cluster; niemand genehmigt eigene Evidence.

### 8. Portale, Routen, Services, Provider und Worker

- Public Pricing/Marketing, Employer Billing/Plans, Employer Jobs/Pipeline,
  Company/Cluster Cockpit, Talent Radar und Admin Commercial/Product Release.
- Bestehende Billing-/Ledger-/Invoice-/Entitlement-Logik aus Phase 24;
  Cluster Launch aus Phase 25/30A; Trust aus Phase 26; Analytics aus Phase 22.
- Implementiert: versionierte Commercial-Hypothesen/-Evidence,
  Cluster-/Offer-Releases, Paid-Service-Recovery-Policy,
  Capacity-/Cashflow-Releases und ein default-off betreuter Importwrapper.
- Reale Provider nur aus Phase 24; manuelle Rechnung braucht kontrollierten
  Financeabschluss. Worker für Import/Sync, Dunning oder Service-Fristen nur
  über Phase 23 mit Retry/DLQ/Replay/Alert.
- 31A darf als kontrollierter manueller Prozess laufen; öffentliche Runtime
  und Kauf-CTA bleiben dabei aus.

### 9. Datenmodell, Constraints, Indizes und Klassifikation

- Versionierte `CommercialHypothesis`, `CommercialEvidence`,
  `CommercialOfferRelease`, `CommercialClusterDecision`,
  `CapacityModelRelease`, `CashflowModelRelease` und
  `ServicePolicyRelease` mit Actor, Provenienz, Zeitraum und Digest.
- Ein partial/transactional Constraint erlaubt höchstens **einen** ersten
  `PUBLIC_ACTIVE` Region×Profession-Cluster; Discovery-Kandidaten bleiben
  `RESEARCH`.
- Payment-/Invoice-/Refund-/Entitlement-Wahrheit bleibt bei Phase 24.
  Commercial Evidence referenziert deren immutable IDs und darf keinen
  zweiten Geldledger bilden.
- `CapacityModelRelease` und `CashflowModelRelease` sind versionierte
  Artefakte, keine manipulierbaren Runtime-Kundendaten.
- Import speichert Source-Rights-Evidence, Mapping-Version, Source Digest,
  Tenant, Preview-/Commitstatus und Fehler; Credentials als Secrets, nicht DB-
  Klartext. Uploads/Company-/Candidate-Daten bleiben personenbezogen bzw.
  vertraulich klassifiziert.

### 10. Expand–Migrate–Contract und Backfill

- 31A erzeugt zunächst versionierte, nichtöffentliche Evidence ohne
  Runtime-Schemazwang.
- 31B migriert Offer/Product/Service-Policy additiv und lässt bestehende
  Plan-/Entitlement-Snapshots unverändert. Kein Preis wird rückwirkend
  überschrieben.
- Bestehende Demo-/Testprodukte werden explizit als `DEMO`/`TEST` klassifiziert
  und nie still zu Production migriert.
- Cluster V2 bindet Query-Set-, Search-/Ranking-/Taxonomie- und Offerrelease;
  V1-Approvals werden nicht übernommen.
- Import-/Contract-Backfill ist tenantweise, idempotent und checksumgeprüft.
  Contract entfernt Altfelder erst nach Read-/Write-Parität und Rollbackfenster.

### 11. Serverlogik, Queue und Provider

- Preis, Eligibility, Entitlement, Serviceumfang, verfügbare Kapazität und
  Cluster sind serverautoritativ; Clientparameter wählen keine günstigere
  Produktversion.
- Der WTP-Nachweis zählt nur `CAPTURED/PAID` bzw. reconcilierten manuellen
  Geldeingang minus vollständige Refunds/Reversals und nur nach real
  begonnener/gelieferter Leistung.
- Offer-Sequenz: Kernworkflow/Hiring Sprint/Retainer/Concierge/Paid Import
  zuerst. Boost und Radar sind nachgelagerte, separat gegatete Add-ons.
- Boost kauft Reichweite/Platzierung innerhalb der Phase-09-Fairnessgrenzen,
  nie Score, Eligibility, Empfehlung oder Garantie auf Bewerbungen.
- Radar verkauft nur freigegebene Kontaktcredits; kein Kauf umgeht Candidate
  Opt-in, Accept, Reveal, Eligibility Loss oder Grant-Widerruf.
- Service Failure erzeugt idempotent Supportcase und gemäss freigegebener
  Policy Retry, Fristverlängerung, Replacement/Credit oder Refund/Reversal.
- Import ist Preview→explicit Commit→Draft; kein automatisches Publish.

### 12. Vollständige UX-Zustandsmatrix

Jedes Angebot zeigt Loading, Empty/No eligible offer, Research-only,
Locked/Gate missing, Capacity full, Pending invoice/payment/review/delivery,
Active, Partially delivered, Paused, Cancelled, Expired, Failed, Recovery
offered, Refunded/Reversed und Success. Preis, Laufzeit, Credits,
Leistungsgrenzen, Kündigung, Pause/Reactivation, Delivery-SLA und Recovery
stehen vor Bestätigung. Boost zeigt Baseline/gekaufte Reichweite ohne
Erfolgsgarantie; Radar zeigt verfügbare Credits und Privacygrenzen. Import
zeigt Preview, Row errors, Draft count und Commitconfirmation.

### 13. Mobile und Accessibility

Pricing, Checkout/Invoice, Entitlements, Recovery und Import Preview bleiben
bei 320/360 px vollständig bedienbar. Vergleichstabellen besitzen ein
semantisches Card-/List-Fallback. Preis, Rhythmus, Steuer, Status und Fehler
werden nicht nur farblich vermittelt. Dialoge fokussieren korrekt, Async-
Status wird angekündigt und bezahlpflichtige Bestätigung besitzt eindeutigen
Accessible Name plus finalen Betrag.

### 14. Authentisierung, Step-up, Autorisierung und Tenant

Employer Owner bzw. explizite Billing-Persona darf kaufen, kündigen,
refund/recovery beantragen oder Import committen. Preis-/Product-/Cluster-/
Service-Policy-Release sowie manuelle Geldzuordnung benötigen Phase-25-
Capabilities, Step-up und Separation of Duties. Recruiter erhält nur
delegierte Entitlements. Candidate zahlt nicht und erhält keine schlechtere
organische Fairness. Jede Order, Invoice, Credit, Delivery und Importoperation
ist tenant-scoped; IDOR-/Owner-/Persona-Negativtests sind Pflicht.

### 15. Datenschutz, Retention, Export, Löschung und Audit

- WTP-/Research-Evidence minimiert personenbezogene Interviewdaten; Einwilligung,
  Zweck, Zugriff, Retention und Löschung sind dokumentiert.
- Commercial Events enthalten keine CVs, Messages, Rohqueries,
  Payment-Secrets oder unnötige Personenmerkmale.
- Vertraglich aufzubewahrende Rechnungs-/Ledgerdaten folgen Phase 24 und Legal
  Hold; Researchnotizen, Importquellen und Deliverycases besitzen getrennte
  Fristen.
- Offer-/Price-/Policy-/Cluster-Release, Kauf, Cancel, Refund, Credit,
  Recovery, Import Commit und Adminoverride sind unveränderlich auditiert.
- Candidate Radar Opt-in, Reveal-Grants und Privacy Requests bleiben von
  Monetarisierung unverändert export-/widerruf-/löschbar.

### 16. Abuse-, Fraud-, ATO- und Missbrauchsszenarien

Gefälschte WTP-Evidence, Selbstkauf, Gutschein-/Refund-Cycling, Payment Replay,
gestohlene Firmenkonten, manipulierte Preise/Entitlements, Radar-Scraping,
Boost-Spam, Duplicate Jobs, Import fremder Inhalte, Formula-/CSV-Injection,
Source-Rights-Fälschung und Concierge-Überlastung. `STH-031`-Riskqueue,
Velocity-/Value-Limits, Step-up, Reviewer Separation, Provenienz,
Reconciliation, sichere Importparser und Kill Switch sind Pflicht.

### 17. Externe und organisatorische Voraussetzungen

- Ein benannter Product Owner, genau ein gewählter Startcluster und
  Berufsfachreview.
- Reale KMU-Buyer, rechtskonforme Ansprache, Research Consent und Budget für
  tatsächlich bezahlte Tests.
- Schriftliche Tax-/Accounting-/VAT-/AVG-/Legal-/Privacy-Freigabe je Offer,
  Rechnung, Import, Radar und möglichem Provider.
- Financekonto/Reconciliation, Support-/Opsbesetzung, Servicezeiten,
  Eskalation, Refundautorität und Fraud/Incident Owner.
- BFS/LSE-Lizenz-/Methodikfreigabe nur falls Salary-Angebot überhaupt verfolgt
  wird.

### 18. Harte Abhängigkeiten

- 31A startet nach Phase 19. Frühe Research-Methodik und Verständlichkeit
  werden mit 29A koordiniert.
- 31A liefert genau für den gewählten Cluster ein fachlich signiertes
  Query-/Judgment-Korpus an 30A; Search-Evidence fliesst zurück ins
  Cluster-Gate.
- 31B benötigt für seinen Scope Phasen 20–26, 29B, 30A und 30D. Phase 24 ist
  für realen Provider-Geldfluss, Ledger, Tax, Invoice, Refund und
  Reconciliation zwingend.
- 30B/30C blockieren nur, wenn ihre dokumentierten Scale-/Sitemap-Trigger
  ausgelöst sind; sonst bleiben sie datiert `DEFERRED / MONITORED`.
- Phase 28 ist nur für ein verkauftes Tracker-/Scheduler-Versprechen Pflicht.
  Phase 27 nur für ein versprochenes Multi-Persona-Angebot.

### 19. Geordnete Implementierungsschritte

#### 31A — WTP, Delivery und Economics

1. ICP, Vergleichskandidaten und **genau einen** ersten
   Region×Profession-Cluster samt Stop-/Success-Regeln entscheiden.
2. Clusterkorpus durch Berufsfachpersonen signieren und an 30A übergeben.
3. Kernangebote in dieser Reihenfolge spezifizieren: Basisworkflow, Hiring
   Sprint, Retainer/Credits, Concierge/Design Partner, Paid Import Setup.
4. Je Offer Preis, Umfang, Laufzeit, Capacity, Delivery, Pause/Cancel,
   Recovery und Net-WTP-Messregel vorregistrieren.
5. Legal/Tax/AVG/Privacy/Accounting freigeben; manuelle Rechnung und
   Reconciliation kontrolliert vorbereiten.
6. Moderierte Verständlichkeit und echte bezahlte Tests durchführen;
   kostenlose/Mock-/Testmode-Fälle separat klassifizieren.
7. Servicezeiten und Unit Cost messen; Backlog-/Staffing-/On-call-Modell
   kalibrieren.
8. 18-/24-Monats-Cashflow und Sensitivitäten mit realem Zahlungs-/CAC-Timing
   freigeben.
9. Pro Offer und Cluster Go/Pivot/Stop dokumentieren.

#### 31B — Technische und öffentliche Produktaktivierung

1. Nur ein in 31A freigegebenes Offer als versionierten Product Release
   implementieren.
2. Entitlement, Billing, Invoice, Tax, Dunning, Refund und Reconciliation mit
   Phase 24 integrieren.
3. Delivery-/Support-/Recovery-Workflow und Capacity Guard implementieren.
4. Serverautorisierte Public-/Employer-Copy sowie Demo/Production-Trennung.
5. Betreuten Import als Source Rights→Preview→Draft-only vertikal umsetzen.
6. Boost erst nach organischem Reach-Gate; Radar erst nach Dichte-/Paid-Use-
   Gate; jedes Add-on mit eigenem Release.
7. Canary mit Stop-/Rollbackregeln; danach G3.

### 20. Feature-Flags, Kill Switch und Aktivierung

Getrennte serverseitige Gates für `productionOffers`, jedes Offerrelease,
manuelle Rechnung, Provider Checkout, Import Commit/Sync, Boost, Paid Radar
und Salary. Aktivierung: internal→design partner allowlist→ein gewählter
Cluster→kontrollierter Cohort. Capacity Full, Reconciliation Drift,
Provider-/Delivery-SLO, Trust/Fraud oder Recoveryausfall stoppen Neukauf
fail-closed. Bestehende bezahlte Rechte werden erfüllt, ersetzt oder
zurückerstattet; Kill Switch darf die Servicepflicht nicht löschen.

### 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

- `AC-31-01`: Es gibt genau einen ersten öffentlichen Cluster.
- `AC-31-02`: Das signierte Clusterkorpus ist an 30A gebunden.
- `AC-31-03`: Kernangebote werden vor Add-ons gegen reales Geld getestet.
- `AC-31-04`: Boost erfüllt sein organisches Reichweiten-/Delivery-Gate.
- `AC-31-05`: Paid Radar erfüllt Dichte-, Privacy- und Nutzengate.
- `AC-31-06`: Kapazität und Unit Cost begrenzen Verkauf und Concierge.
- `AC-31-07`: Cashflow modelliert Geld-/CAC-Timing ohne Doppelzählung.
- `AC-31-08`: Paid-Service-Recovery ist vor Kauf durchgängig belegbar.
- `AC-31-09`: Product Release, Copy und Entitlements sind fail-closed.
- `AC-31-10`: Import ist rechtegeprüft, previewbar und Draft-only.
- `AC-31-11`: Salary bleibt ohne reale Freigabe deaktiviert/noindex.

| Criterion / Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AC-31-01 / STH-018, REQ-COM-031-001 | P0 LC3+ | Unit + PostgreSQL | zwei Research-Kandidaten, Aktivierung des ersten | genau ein Cluster wird `PUBLIC_ACTIVE` | parallele Aktivierung, stale approval, V1/mismatched releases | Product/Ops Approver | Cluster Launch | zwei Regionen×Berufe, V1/V2 | PostgreSQL 16 | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-cluster-gates.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/admin/phase31-cluster-v2-postgres.test.ts` | `PUBLIC_ACTIVE` count = 1; zweiter Versuch 0 Writes; zwei getrennte Approvals | JUnit + DB diff + Assessmentdigest | Product/Ops | TECHNICAL PASS / EXTERNAL CLUSTER DECISION OPEN |
| AC-31-02 / STH-019 | P0 aktiver Cluster | Contract + Fachreview | zwei Discovery-Korpora→genau ein 30A-Release/Cluster V2 | Pflege und Engineering besitzen verschiedene Digests/Fachowner; exakt eines ist `SELECTED` | Demo-/Marketingliste, Cross-Corpus-Evidence, anderer Cluster/Locale, nachträglich geänderter Digest | Search Owner + Pflege-/Engineering-Fachpersonen | Evidence/30A | getrennte Pflege- und Engineering-Korpora | CI + zwei manuelle Reviews | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-corpus-handoff.test.ts`; beide Fachowner verifizieren je Corpusdigest, Sprache, must-find/must-not-find; Product markiert genau einen Digest `SELECTED` | zwei getrennte gültige Digests; `SELECTED` exakt 1; unbekannter/geänderter/`DISCOVERY_ONLY`-Digest aktiviert 0 Cluster | Contractreport + zwei Reviews + Selection Decision | Search + Berufsfachowner | CONTRACT PASS / TWO EXPERT REVIEWS OPEN |
| AC-31-03 / STH-037, REQ-COM-031-002 | P0 Paid | Unit + externes Experiment | Kernoffers vor Boost/Radar; bezahlter Auftrag | reconciliertes Geld und reale Delivery zählen | Mock/Testmode/Free/LOI/Lead/Selbstkauf/refunded zählt null | Employer Buyer/Finance | Research/Finance Evidence | vorregistrierte Offer-Cohort | kontrollierte Design-Partner-Umgebung | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-offer-sequencing.test.ts`; manuell: Hypothese+Datenfreeze→Legal/Tax-Freigabe→Buyer akzeptiert Preis/Scope→Rechnung→Bank-/Ledger-Reconcile→Delivery→Outcome→Go/Pivot/Stop | Add-on vor Kernoffer wird denied; WTP count entspricht nur netto bezahlten, unabhängigen, gelieferten Fällen; Mindest-n/Stopregel vorab fixiert | Experimentprotokoll + Rechnung-/Ledgerreferenz ohne PII | Product + Finance | TECHNICAL PASS / REAL WTP AND DELIVERY OPEN |
| AC-31-04 / REQ-COM-031-005 | P1 iff Boost | Unit + Integration | organische Baseline→Boost Delivery | zusätzlicher eligible Reach gemäss Vertrag | dünnes Inventar, garantierte Bewerbungen, Score-/Rankingkauf, Fraudclicks | Employer/Product | Search/Boost/Billing | organic + paid cohorts | PostgreSQL + Analytics | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-addon-gates.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/billing/phase31-product-release-postgres.test.ts` | ohne Reach-/Inventory-Schwelle purchasable=false; Fair Score/Eligibility diff=0; Deliverymetriken dedupliziert | Gate-/Reach-/Fairnessreport | Growth + Search | TECHNICAL PASS / ADD-ON DISABLED |
| AC-31-05 / REQ-COM-031-005 | P0 iff Paid Radar | PostgreSQL + Privacy | opt-in Supply→Search→Contact→Accept→Reveal→Credit | erlaubter Kontakt liefert belegten Nutzen | zu geringe Dichte, opt-out, reject/expire, cross-tenant, scraping, gekauftes Reveal | Employer/Candidate | Talent Radar/Billing | opt-in/out, accept/reject/expire | PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/billing/phase31-radar-paid-gate-postgres.test.ts` | unter Dichte-/Accept-/Reveal-Schwelle purchasable=false; Eligibility Loss widerruft Mapping; Privacydenials 0 Leaks/0 Charge oder Policy-Recovery | Density/Funnel/Privacy/Ledger diff | Product + Privacy | TECHNICAL PASS / PAID RADAR DISABLED |
| AC-31-06 / STH-034, REQ-COM-031-003 | P0 Paid | Unit + Ops Simulation | Arrival Rate versus Staffing/Servicezeiten | Verkauf bleibt innerhalb Capacity/COGS | Spike, Krankheit, Import-/Fraudbacklog, Concierge über COGS-Cap | Ops/Finance | Capacity Guard/Queues | sechs Worktypes, base/high/stress | Modell + staging-like queue | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-capacity-model.test.ts`; Ops trägt gemessene Minuten/Case, Arrivals, Backlog, Servicezeit und verfügbare Stunden in den versionierten Input ein | je Worktype Utilization ≤80 %, Backlog innerhalb SLA, Concierge-COGS/Kunde ≤ vorregistriertem Cap; sonst Neukauf geschlossen | Modelldigest + Messquellen + Capacity decision | Ops + Finance | MODEL CONTRACT PASS / REAL MEASUREMENTS OPEN |
| AC-31-07 / REQ-COM-031-003 | P0 Paid | Unit + Finance Review | 18/24 Monate base/downside/upside | Cash-in/out und Runway stimmen | CAC doppelt, Invoice=Cash, jährlicher Betrag sofort, Pause/Reactivation ignoriert | Finance/Product | Cashflow Model | real timing + sensitivities | versioniertes Modell | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-cashflow.test.ts`; Finance gleicht Monat 0–24 mit Bank/Ledger, Payroll, Provider, Refund und CAC-Quellen ab | Monatssummen/Opening/Closing Cash auf Rappen; CAC einmal; 18/24-Monats-Runway, Break-even, Burn und Downside ausgewiesen | Modelldigest + Reconciliation + Approval | Finance | MODEL CONTRACT PASS / FINANCE APPROVAL OPEN |
| AC-31-08 / STH-035, REQ-COM-031-004 | P0 Paid | Unit + PostgreSQL + E2E | Provider-/Platform-/Deliveryfehler nach Kauf | Retry/Extension/Replacement/Credit/Refund gemäss Policy | Doppelerstattung, Entitlementverlust ohne Recovery, Trustverlust, abgelaufener Radarcontact, Boost outage | Employer/Support/Finance | Billing/Support/Delivery | paid offers, failure matrix | PostgreSQL + Chromium | `npx vitest run --config vitest.config.ts tests/unit/billing/paid-service-recovery-policy.test.ts && npx vitest run --config vitest.integration.config.ts tests/integration/billing/phase31-service-recovery-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase31-production-offer.spec.ts --project=chromium-journeys` | jeder Failurecode genau eine kundensichtbare Remedy/SLA; Ledger/Reversal idempotent; ungelöste Fälle eskalieren | Policyrelease + JUnit + Ledger/Audit + Screenshot | Support + Finance | TECHNICAL PASS / POLICY APPROVAL AND LIVE INCIDENT OPEN |
| AC-31-09 / STH-028 | P0 Public/Paid | Unit + E2E | Demo/Research/Production release | nur freigegebenes Offer zeigt korrekten Preis/CTA | Clientpreis, unknown release, expired capacity, Copy ohne Delivery/Taxfreigabe | Public/Employer/Admin | Marketing/Pricing/Billing | releases/gates/capacity | CI + Chromium | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-production-copy.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase31-production-offer.spec.ts --project=chromium-journeys` | unbekannt/disabled/gate missing: Kauf-CTA 0; Serverpreis=Invoicepreis; Productionclaim nur freigegebener Release | DOM/API snapshot + Release/Audit | Product + Engineering | PASS / PRODUCTION DISABLED |
| AC-31-10 / STH-022 | P0 Import | PostgreSQL + Security/E2E | source rights→mapping→preview→commit | nur eigene validierte Rows als Draft | fremde Rechte/Tenant, formula/zip bomb, invalid rows, replay, Auto-Publish | Employer Owner/Ops | Managed Import | XML/JSON/CSV positive/abuse | PostgreSQL + worker sandbox | `npx vitest run --config vitest.integration.config.ts tests/integration/imports/phase31-managed-import-postgres.test.ts && npx playwright test --config=playwright.config.ts tests/e2e/flows/phase31-managed-import.spec.ts --project=chromium-journeys` | 0 Auto-Publish; per-row error; checksum-idempotent; foreign writes 0; Preview=committed Draft set | Import/Audit/DB diff | Import + Security | PASS / DISABLED |
| AC-31-11 / REQ-MKT-002 | P1 iff Salary | Contract + HTTP | fehlende/reale BFS/LSE-Freigabe | realer freigegebener Release mit Disclosure | Seed/mock/alte Quelle, falsche Region/Occupation, indexierbare Placeholderseite | Public/Ops | Salary/Public/SEO | disabled + approved source fixtures | CI + target env | `npx vitest run --config vitest.config.ts tests/unit/commercial/phase31-salary-gate.test.ts && npm run test:e2e:http`; manuell Quellenlizenz, Stand, Methodik, Brutto-/Perzentil-/Region-/CH-ISCO-Disclosure prüfen | ohne alle Freigaben: Route/CTA disabled und noindex; mit Freigabe: 100 % Werte mit Sourceversion/As-of/Disclosure | Contract/HTTP report + Source approval | Product + Legal/Data | PASS FAIL-CLOSED / REAL DATA APPROVAL OPEN |
| AC-31-01–11 / G3 | Release Gate | Full Regression | unveränderlicher 31B-Kandidat | alle owning/global Gates grün | Skip/Retry/anderer Commit oder externe Evidence fehlt | alle | Repository + Provider | isolierte DB/provider fixtures | CI/Staging | `npm run lint && npm run typecheck && npm test && npm run test:integration && npm run build && npm run test:e2e:http && npm run test:e2e:browser` | Exit 0; Fail/Skip/Retry 0; technische Gates ersetzen keine WTP-/Legal-/Ops-Evidence | G3 Bundle + Commit SHA | Release Owner | LOCAL/CI PASS / EXTERNAL 31A AND TARGET OPEN |

### 22. Performance-, Kapazitäts- und Wirtschaftsgrenzen

- Ein erster Cluster erhält vor Aktivierung ein eingefrorenes Supply-/Demand-/
  Response-/Search-Gate; die Zahlen sind Hypothesen bis 31A sie vorregistriert.
- Je Worktype werden p50/p90 Minuten, Arrival Rate, Backlog und SLA gemessen.
  Planbare Auslastung bleibt ≤80 %; über dem Wert schliesst Capacity Guard
  Neukauf, statt eine nicht lieferbare Leistung zu verkaufen.
- Concierge besitzt einen expliziten COGS-/Stunden-Cap je Kunde und Offer.
- Cashflow zeigt 18 und 24 Monate, monatlichen Burn, Break-even,
  schlechtesten Cash-Punkt und Runway; Cash-in ist nicht Invoice-/MRR-
  Buchungsdatum. CAC wird genau einmal und mit Zahlungsverzug erfasst.
- Offer-SLOs und Performancebudgets werden vor erstem bezahlten Release
  eingefroren; Boost/Radar erhalten eigene Delivery- und Recoverybudgets.

### 23. Geschützte Phase-01–18-Invarianten

Candidate bleibt kostenlos. Fair Score, organische Relevanz, Public
Eligibility, Company Trust, Tenant-/Owner-Isolation, Radar Opt-in/Accept/
Reveal, immutable Ledger, Idempotency, Invoice-/Refundwahrheit, Admin Dual
Approval, Source Rights, Draft-only Import sowie Demo-/Production-Trennung
bleiben unverändert. Monetarisierung darf keine Privacy-, Verification-,
Moderation- oder Searchkontrolle umgehen.

### 24. Rollback / Roll-forward

Offer-/Price-/Service-Policy-Releases sind immutable und cohortweise
deaktivierbar. Rollback stoppt Neukauf und Copy, nie offene Delivery-,
Refund-, Invoice- oder Retentionpflichten. Bestehende Entitlements behalten
ihren Snapshot oder erhalten die dokumentierte Recovery. Cluster kann
fail-closed auf Research zurückgesetzt werden; Index, Acquisition und
Productionclaims werden dann entfernt. Ledger-/Providerkorrekturen erfolgen
als Reversal/Compensation, nicht durch Mutation. Import bleibt Draft; bereits
publizierte Jobs folgen dem normalen Moderations-/Unpublishvertrag.

### 25. Evidence

Clusterentscheidung und Assessment V2, fachlich signiertes Corpusdigest,
vorregistrierte Hypothesen/Stopregeln, anonymisierte Interview-/Taskdaten,
reconciliierte Zahlungsreferenzen, Net-WTP- und Deliverykohorte,
Capacity-/Unit-Cost-/Cashflow-Releases, Legal/Tax/AVG/Privacy-Freigaben,
Service-Policy und Failurematrix, Boost-/Radar-Gates, Import Source Rights,
Testreports, Featureflags, exakter Commit und G3-Bundle.

### 26. Definition of Done

- 31A ist nur `DONE`, wenn genau ein Cluster, mindestens ein zuerst
  priorisiertes Kernangebot, echter Net-Geldfluss, reale Delivery,
  Capacity/Unit Cost, 18-/24-Monats-Cashflow und Go/Pivot/Stop dokumentiert
  sind. Mindeststichprobe und Stopregel wurden vor Kontakt/Kauf festgelegt.
- 31B ist nur `DONE`, wenn das freigegebene Angebot serverseitig, billing-,
  tenant-, privacy-, operations- und recovery-sicher geliefert wird.
- Boost und Radar bleiben unabhängig `DISABLED`, bis ihre eigenen Gates grün
  sind; kein Gesamtphasen-Häkchen aktiviert sie.
- Salary bleibt ohne externe Realdatenfreigabe deaktiviert/noindex.
- Alle Matrixzeilen besitzen direkte Evidence; externe Arbeit wird nicht durch
  grüne Unit Tests ersetzt.

### 27. Folgephasen-Gate

Phase 32 darf höchstens die Launchklasse freigeben, deren 31A-/31B-Evidence
tatsächlich benötigt und grün ist. LC1 braucht Phase 31 nicht. LC2 darf
kontrollierte manuelle Tests nur mit flowspezifischer Legal/Privacy/Tax/AVG-
Freigabe durchführen. LC4 hält alle Kauf-CTAs geschlossen. LC5 benötigt
vollständig grüne Phase 24 und Phase 31 inklusive Paid-Service-Recovery.
LC6 benötigt zusätzlich nachgewiesene Kapazität, On-call und ausgelöste
Scale-Gates.

### 28. Ausdrücklich nicht bewiesen

Ein bezahlter Auftrag beweist keinen Product-Market-Fit, keinen niedrigen CAC,
keine Retention und keine nationale Skalierbarkeit. Ein Cluster beweist keinen
zweiten. Rechnung, LOI oder Testmode beweisen ohne reconcilierten Geldfluss
und Delivery keine WTP. Free Design Partner beweisen nur Research/Delivery.
Bestehender Radarcode beweist keine Dichte oder Paid-Nachfrage. Ein
Cashflowmodell beweist keine Finanzierung. Deaktivierter Salary ist kein
Realdatenprodukt.

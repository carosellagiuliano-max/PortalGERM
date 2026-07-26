# Phase 31 — Monetarisierung, Rentabilität und Marktvalidierung

> **Status: GEPLANT / NICHT BEGONNEN.** Der externe Discovery-Track für ICP,
> Packaging, Cashflow, Clusterhypothesen und rechtlich zulässige manuelle
> Angebots-/Rechnungstests beginnt nach Phase 19, bevor teure Provider- oder
> Premium-Implementierung freigegeben wird. Erst die technische
> Production-Aktivierung dieser Phase wartet auf realen Betrieb, Billing und
> die relevanten Kernprozesse. Mock-Käufe, DEMO-Daten und unverbindliche Leads
> sind kein Zahlungsbereitschafts- oder Liquiditätsnachweis.

## Ziel

Nur belegte, lieferbare und wirtschaftlich sinnvolle Angebote produktiv
freigeben; Clusterliquidität, Packaging, Pricing, Runway und Supportkosten mit
echten Design-Partnern und Geldfluss messen.

## Ausgangslage und Problem-IDs

- `STH-018`: technische Cluster-Gates, Seed und Tests existieren; reale
  Marktliquidität ist externe Evidence.
- `STH-019` ist ein querliegendes P1-Gate: Ein öffentlich beworbener
  Startcluster braucht zusätzlich ein fachlich freigegebenes Berufsquery-/
  Judgment-Korpus und grüne Phase-30A-Evidence. Die heutige grobe
  Kategorie-/Kanton-Coverage belegt diesen Kandidatennutzen nicht.
- `STH-022`: Business/Enterprise besitzen Kernbenefits und kontrollierte
  Import-Architektur, aber keine produktive Feed-/ATS-/API-/SSO-Leistung.
- `STH-028`: Demo-/Hypothesen-Sprache ist aktuell korrekt und darf erst nach
  Freigaben durch eine getrennte Production-Darstellung ersetzt werden.

## Priorisierte Angebotsreihenfolge

1. Job-Boost-Pakete;
2. Talent-Radar-Kontaktpakete;
3. zusätzliche Stellenkontingente;
4. Premium-Unternehmensprofile;
5. Advanced Analytics;
6. Jahresabonnements;
7. betreute XML-/JSON-/ATS-Imports;
8. monatliche Feed-Synchronisierung;
9. später Enterprise SSO/API.

## In Scope

- ICP/Cluster-Design-Partner und echte LIVE-Gate-Evidence.
- Real-Money-Angebotstests oder rechtlich zulässige manuelle Rechnung.
- 18-/24-Monats-Cashflow, Burn, CAC, Support/COGS, Churn und Runway.
- Monats-, Hiring-Sprint-, Retainer-/Credit- und Jahrespaketvergleich.
- Produktrelease, serverseitige Entitlements, Limits, Abuse, Analytics,
  Upgrade/Downgrade/Cancel/Refund je Angebot.
- Betreuter Import: Source Rights, Mapping, Preview, Draft-only Commit,
  Fehlerreport, SLA und optional wiederkehrender Sync.
- Ehrliche Trennung Demo/Research/Production.

## Out of Scope / nicht früh priorisieren

- Success Fee vor AVG/Legal/Attribution/Unit-Economics-Freigabe.
- Community/Social Feed, generischer AI-Karrierecoach, öffentliche Reviews,
  Native Apps, White Label, ATS-Ersatz oder internationale Expansion.
- Enterprise SSO/API vor realem Kundenbedarf und Supportfähigkeit.
- Preisänderung allein durch Konkurrenzlisten ohne bezahlten Test.
- DEMO/TEST-Metriken als LIVE-Marktbeweis.

## Rollen und Prozesse

Employer Buyer/Owner, Sales/Customer Success, Finance, Product, Ops und Legal.
Candidate bleibt kostenlos und privacy-geschützt. Product/Ops aktiviert Cluster
nur mit echter LIVE-Evidence, bestandener cluster-/sprachspezifischer
Phase-30A-Suchqualität und getrennten Approvern aus Phase 25. Interviews,
Concierge-Research und nichtöffentliche Tests aus Track A dürfen davor
stattfinden, aber keine öffentliche Cluster-, SEO- oder Liquiditätsbehauptung.

## Betroffene Dateien und Module

- Product Strategy, Commercial Gates, Plans/Products/Entitlements
- Public Pricing/Employer Marketing und Product Release Decisions
- Billing/Finance aus Phase 24, Analytics aus Phase 22
- Cluster Launch/Cockpit, Sales Leads und Admin Content
- Import Schema/Services/Workers/Storage/Provider
- Cashflow-/Experiment-Evidence und Runbooks

## Datenmodelländerungen

Nur nach Angebotsspezifikation: versionierte Plan/Product Releases,
Experiment/Offer Assignment ohne manipulative Dark Patterns, Contract/
ImportFeed/SyncRun/SLA-Evidence. Bestehende Entitlement-, Order-, Invoice- und
Import-Approval-Modelle werden verwendet. Kein allgemeines Boolean-Featuregate.

## Sicherheits- und Datenschutzfolgen

- Preise, Eligibility und Entitlements serverautoritativ.
- Feed/ATS braucht Source Rights, tenant-scoped Secrets, DPA, least privilege
  und Draft-only Default.
- Experimentanalytics nutzt nur Phase-22-freigegebene Events.
- Kein Social Proof, Partnerlogo oder Umsatzwert ohne echte Freigabe.
- Success Fee bleibt technisch deaktiviert.

## Implementierungs- und Validierungsschritte

- [ ] **Track A – frühe Discovery nach Phase 19:** ICP, Startcluster,
  Cashflow-/Runway-Modell, Packaging und vorregistrierte Erfolgs-/Stopregeln
  festlegen; rechtlich freigegebene manuelle Angebots-/Rechnungstests
  durchführen und ein Go/No-go vor Phase-24-LIVE-Ausbau dokumentieren.
- [ ] Track A liefert pro gewähltem Startcluster ein durch Berufsfachpersonen
  geprüftes, versioniertes Query-/Judgment-Korpus mit Sprache, erwarteten
  Berufs-Konzepten, must-find/must-not-find, Top-K-Relevanz und zentralen
  Zero-Result-Gegenfällen an Phase 30A. DEMO-Seed oder Marketingbegriffe gelten
  nicht als Fachurteil.
- [ ] Kostenlose Design-Partner nur für Usability, Delivery und
  Clusterliquidität auswerten; sie zählen niemals als WTP-Evidence.
- [ ] **Track B – Production-Freigabe nach den Kernphasen:** tatsächlichen
  Provider-Geldfluss, Katalog, Entitlements, Support, LIVE-Kohorten und den
  zielrelevanten Phase-30A-Search-Release reconciliieren, bevor öffentliche
  CTAs aktiviert werden.
- [ ] Reale Supply-/Demand-/Response-Gates mit LIVE-Provenienz erfassen;
  `ClusterLaunchAssessment V2` bindet Query-Set-, Search-Policy-, Ranking- und
  Taxonomieversion. V1-Approvals werden nicht still übernommen.
- [ ] Cashflow/Runway/Support-/CAC-Modell mit Sensitivitäten freigeben.
- [ ] Angebots-/Packaging-Hypothesen und bezahlte Tests vorab registrieren.
- [ ] Je Angebot Nutzen, Zielgruppe, Preis, Limits, Gate, Billing, Abuse,
  Analytics, Upgrade/Downgrade/Cancel/Refund spezifizieren.
- [ ] Priorisierte Add-ons über bestehende Ledger/Entitlements produktisieren.
- [ ] Jahresmodelle erst nach Renewal-/Cancel-/Refund-Evidence.
- [ ] Betreuten Import vertikal bis Draft/Fehler/SLA umsetzen.
- [ ] Wiederkehrenden Sync erst mit Worker/Monitoring/Datenrechten aktivieren.
- [ ] Production Pricing nur aus freigegebenen Releases rendern.
- [ ] SSO/API nur durch konkrete zahlende Nachfrage in neue Folgephase heben.

## Abhängigkeiten

Der Query-/Judgment-Substream von Track A hängt nur von Phase 19, bestätigtem
Startcluster, Product/Search Owner und verfügbaren Berufsfachpersonen ab;
Track 30A setzt unmittelbar auf diesem Korpus auf. Manuelle Angebots-/
Rechnungstests in Track A benötigen zusätzlich flowspezifische
Legal-/Tax-/AVG-Freigabe, Design-Partner, Marktakquise und Budget. Track B hängt
von den zielrelevanten Phasen 22–26 und 28, besonders realem Billing Phase 24
sowie den P1-Tracks 30A/30B ab. STH-027/Track 30C blockiert Track B nur, wenn
sein dokumentierter Count-/Byte-/Forecast-/Performance-Trigger gilt.

## Risiken und Regressionen

- Zu frühe Production-Copy täuscht Lieferbarkeit/Zahlungsreife vor.
- Mehr Umsatzfeatures erhöhen Support/COGS stärker als ARPA.
- Import verletzt Source Rights oder erzeugt Auto-Publish.
- Dünne Cluster beschädigen Candidate Trust.
- Monetarisierung beeinflusst Fair Score, organische Relevanz oder Radar-
  Privacy.

## Abwärtskompatibilität und Rollback

Produkte sind versioniert, release-gegatet und serverseitig deaktivierbar.
Bestehende Verträge/Entitlements behalten ihre Snapshots. Stop-Kriterien
pausieren Neukauf, nicht rückwirkend bezahlte Rechte. Demo/Research bleibt als
separater Modus ehrlich erhalten.

## Akzeptanzkriterien und Tests

### Produkt / Finance / externe Evidence

- [ ] kostenlose Design-Partner besitzen getrennte Usability-/Delivery-/
  Liquiditätsevidence und werden nicht als Zahlungsbereitschaft gezählt.
- [ ] WTP beruht auf tatsächlich beglichenen Aufträgen und erfüllt die
  vorregistrierte Mindeststichprobe beziehungsweise Stopregel; Umfang und
  Resultat sind dokumentiert, Mock/Testmode zählt null.
- [ ] Cluster-Gates ausschließlich mit LIVE-Provenienz und bestandener
  cluster-/sprachspezifischer Phase-30A-Search-Evidence.
- [ ] Cashflow/Runway, CAC, COGS, Churn und Supportsensitivität.
- [ ] vorab definierte Erfolg-/Stop-Kriterien und Experimentresultate.

### Unit / Integration / E2E

- [ ] Offer/Product/Plan Release, Entitlements, Limits und serverseitige Preise.
- [ ] Upgrade/Downgrade/Cancel/Refund je aktivem Angebot.
- [ ] Boost/Kontakt/Add-on beeinflusst Fair Score/Privacy nicht.
- [ ] Import Source Rights → Preview → Draft → Error/Retry/Sync, kein Auto-Publish.
- [ ] Production/Demo Copy und Feature Flags fail-closed.
- [ ] Cluster V2 lehnt alte V1-Approvals, Release-Mismatch, reine
  Location-/`Stellen`-Treffer und unterschwellige Relevanz ab; Revoke/
  Re-Evaluation sperrt Indexierung und Akquise.
- [ ] Finance-, Tenant-, Abuse-, Analytics- und Mobile/A11y-E2E.

## Evidence und Definition of Done

- [ ] Reale Liquidität und die Phase-30A-Suchqualität sind je Startcluster
  belegt oder der Cluster bleibt für Public, SEO und Paid Acquisition
  geschlossen.
- [ ] Kein Produkt wird als lieferbar verkauft, bevor sein End-to-End-Service
  und Supportmodell bereit ist.
- [ ] Demo-/Hypothesencopy wird nur im freigegebenen Productionmodus ersetzt.
- [ ] Preise und Packaging beruhen auf echtem Angebotsversuch, nicht Mock.
- [ ] Cashflow/Runway und Unit Economics besitzen Owner und Sensitivität.
- [ ] Loading-, Empty-, Locked-, Unavailable-, Error-, Pending-, Cancelled- und
  Success-Zustände folgen demselben freigegebenen Angebotsvertrag.
- [ ] Alle Produkt-, Billing-, Tenant-, Privacy- und Operationsgates sind grün.
- [ ] Offene SSO/API/Success-Fee-Hypothesen bleiben sichtbar offen.

## Offene externe Voraussetzungen

Design-Partner, echte Kandidaten/Supply, Paid-Test-Budget, Finance/Tax/Legal/
AVG, Verträge, Support/SLA und Product/Sales Ownership. Diese Phase kann nicht
durch Code allein abgeschlossen werden.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Belegter Umsatz statt Demo-Mechanik und bessere Kapitaldisziplin. |
| Problem-IDs | STH-018, STH-022, STH-028; STH-019 als von Phase 30A geliefertes Cluster-Launch-Gate. |
| Prerequisites | Query-/Judgment-Substream: 19 + Startcluster/Fachreview, danach 30A. Angebots-/Rechnungstest: zusätzlich Legal/Tax/AVG/Partner/Budget. Track B: zielrelevante 22–26, 28, P1-Tracks 30A/30B, besonders 24; 30C nur bei Kapazitätstrigger. |
| Deliverables | LIVE-Gates, Pricing/Packaging-Evidence, priorisierte Produkte, betreuter Import. |
| Security / Privacy | Serverpreise, Source Rights, tenant-scoped Integrationen, keine Score-/Radar-Manipulation. |
| Tests | Product releases, billing lifecycle, import, production/demo modes plus externe Evidence. |
| Expected Result | Nur lieferbare und wirtschaftlich begründete Angebote sind produktiv sichtbar. |
| Risks / Limits | Code beweist weder WTP noch Liquidität; Success Fee bleibt aus. |

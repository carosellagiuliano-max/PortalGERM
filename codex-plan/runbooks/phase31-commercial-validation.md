# Phase 31 — Commercial Validation und Product Release Runbook

## 1. Zweck und aktueller Modus

Dieses Runbook trennt die externe WTP-/Delivery-Validierung (`31A`) von der
technischen Product-Release-Basis (`31B`).

- Aktueller öffentlicher Modus: `RESEARCH_ONLY`.
- Echte Käufe, öffentliche Cluster, Paid Boost, Paid Radar, Salary und
  Success Fee: `DISABLED`.
- Die technische Local-/CI-Basis darf mit ausdrücklich als Test markierten
  Fixtures verifiziert werden. Solche Fixtures sind keine Markt-Evidence.
- Ein fehlender Nachweis ist ein `NO_GO`, kein Anlass für eine Schätzung.

Massgeblich sind
[`commercial-go-live-gates.md`](../commercial-go-live-gates.md),
[`31-monetization-market-validation.md`](../31-monetization-market-validation.md)
und ADR-042 in [`decisions.md`](../decisions.md).

## 2. Evidence-Klassifikation

| Eingang | Als WTP zählen? | Pflichtbehandlung |
|---|---:|---|
| LIVE-Providerzahlung | nur nach Reconciliation, positiver Net-Wert und Delivery-Start | Phase-24-OrderLine referenzieren |
| manuelle Rechnung | nur nach Legal/Tax/Accounting-Freigabe, Geldeingang, Reconciliation und Delivery-Start | unveränderliche Reconciliation-Referenz |
| Refund/Reversal | mindert WTP vollständig in Rappen | nie ausblenden oder periodenverschieben |
| Mock-/Stripe-Testmode | nein | `SANDBOX`/`TEST`, getrennt ausweisen |
| kostenloser Pilot/Design Partner | nein | `FREE`, nur Delivery-Learning |
| Demo-Anfrage/Lead/LOI | nein | `DEMO`/`LEAD`/`LOI`, nie Umsatz |
| Gründer-, Team- oder verbundener Selbstkauf | nein | `sellerControlledBuyer=true` |
| Zahlung ohne Delivery-Start | nein | `NOT_STARTED`, Recovery/Eskalation prüfen |

Personenbezogene Interviewrohnotizen gehören nicht in
`CommercialEvidence`. Persistiert werden nur minimierte, versionierte
Nachweise und Digests.

## 3. 31A — Vorregistrierung und manuelle Durchführung

Vor dem ersten Outreach erstellt Product je Offer eine neue
`CommercialHypothesis`-Version mit:

1. Offer, ICP und genau einem Region×Profession-Cluster;
2. Start-/Enddatum des Messfensters;
3. Mindestzahl unabhängiger zahlender Firmen;
4. Mindest-Net-WTP in Rappen;
5. Preis, Umfang, Laufzeit, Limits, Pause/Cancel und Delivery-SLA;
6. Stop-/Pivot-/Go-Regel;
7. Capacity- und Concierge-COGS-Cap;
8. Recovery-/Refund-/Replacement-Zusage;
9. benannten Product-, Finance-, Ops-, Legal-/AVG- und Privacy-Ownern.

Die Schwellen werden nach Beginn des Messfensters nicht geändert. Eine
Korrektur ist eine neue Hypothesen-Version; die alte bleibt append-only.

### Cluster- und Corpus-Handoff

- Pflege/Gesundheit und Engineering/Technik besitzen getrennte
  Query-/Judgment-Korpora, Fachowner und Digests.
- Genau ein Corpus wird `SELECTED`; das andere bleibt `DISCOVERY_ONLY`.
- Der gewählte Digest muss exakt in einer aktuellen Phase-30-V2-
  `ClusterSearchQualityEvidence` stehen.
- Precision@10, Recall@10 und Coverage sind jeweils mindestens 80 %,
  relevante Top-K-Jobs mindestens 5.
- Product- und Ops-Approver sind zwei verschiedene Personen.
- Ein zweiter `SELECTED`/`PUBLIC_ACTIVE`-Cluster wird von der Datenbank
  abgewiesen.

## 4. Capacity-, Unit-Cost- und Cashflow-Release

Ein `CapacityModelRelease` enthält je:

- Company Verification;
- Jobmoderation;
- Managed Import;
- Privacy Request;
- Support/Fraud;
- Billing-Ausnahme.

Pflichtwerte sind Arrival Rate/Woche, Backlog, verfügbare Minuten, p50/p95,
SLA und On-call. Freigabe nur bei höchstens 8.000 Basispunkten gemessener
Auslastung und eingehaltenem Concierge-COGS-Cap.

Ein `CashflowModelRelease` enthält jeden Monat eines vollständigen
18- oder 24-Monatsfensters. Alle Werte sind ganzzahlige Rappen:

- Cash-in nach tatsächlichem Zahlungszeitpunkt;
- CAC genau einmal;
- Provider-, Service-/Personal- und sonstige variable Kosten;
- Refunds/Reversals nach tatsächlichem Cash-Zeitpunkt;
- Opening/Closing Customer und Cash;
- Peak Funding Need und Break-even-Monat.

Base, Downside und Upside sind getrennte Scenario-Codes; Werte werden weder
gemittelt noch zwischen Szenarien wiederverwendet.

## 5. Paid-Service-Recovery

Vor Offerfreigabe benötigt jede Leistung ein `ServicePolicyRelease` mit:

- verständlicher Kunden-Copy vor Bestätigung;
- Response-SLA und Eskalationsowner;
- mindestens Extension, Credit und Refund;
- idempotentem Remedy;
- getesteter Refund-/Reversal-Reconciliation in Phase 24;
- reservierter Supportkapazität.

Ein Platform Failure darf je nach noch möglicher Delivery Retry, Extension,
Replacement, Credit oder Refund auslösen. Erwarteter Marktausgang,
Kundenhandlung oder Payment-Provider-Fehler wird nicht als Platform Failure
umklassifiziert.

## 6. Offer-Sequenz und Add-ons

Freigabereihenfolge:

1. Basisworkflow;
2. Hiring Sprint;
3. Retainer/Credits;
4. Concierge;
5. betreuter Import;
6. erst danach Boost;
7. erst danach Paid Radar.

Boost braucht organisches eligible Inventar, vorregistrierte Baseline,
gemessene zusätzliche Reichweite und einen Test, dass Fairness, Ranking-Score
und Eligibility unverändert bleiben.

Paid Radar braucht aktive Opt-ins, Mindestdichte, Contact→Accept- und
Accept→Reveal-Quoten, Privacy/Trust-Freigabe und einen grünen
Eligibility-Loss-/Grant-Revoke-Test. Ein Credit kauft nur die Möglichkeit
einer Anfrage; Candidate Accept und Reveal bleiben zwingend.

Salary benötigt reale, rechtegeprüfte BFS/LSE- oder äquivalente Daten,
CH-ISCO-/Grossregion-Mapping, Methodik- und Legal-Review, Disclosure und
Reviewdatum. Ohne dies bleibt die Route unavailable/noindex und ausserhalb
der Sitemap. Success Fee bleibt bis zur separaten AVG-/Legal-/Tax-Entscheidung
aus.

## 7. Managed Import

Der kommerzielle Wrapper verwendet den bestehenden lizenzierten Importer:

1. aktive Quelle und aktuelles Firmenrecht lesen;
2. normalisieren/parsen und nur Preview erzeugen;
3. jedes Item explizit derselben Firma zuordnen;
4. Rights-, Mapping- und Preview-Digest anzeigen/binden;
5. explizite Commit-Bestätigung verlangen;
6. Digests und Tenant unmittelbar vor Commit erneut prüfen;
7. ausschliesslich `Job.status=DRAFT` schreiben;
8. Fehlerbericht/Audit erzeugen.

Digestabweichung, gemischter Tenant, abgelaufenes/revoziertes Recht,
deaktivierter Schalter oder fehlende Bestätigung erzeugt null Job-Writes.
Recurring Sync und Auto-Publish sind nicht Teil von Phase 31.

## 8. Technische Schalter und Rollback

Alle fünf Schalter stehen standardmässig auf `false`:

```dotenv
COMMERCIAL_PRODUCTION_OFFERS=false
COMMERCIAL_MANAGED_IMPORT=false
COMMERCIAL_BOOST=false
COMMERCIAL_PAID_RADAR=false
COMMERCIAL_SALARY=false
```

Bis zur externen Freigabe sind `true`-Werte ausschliesslich in Local/CI
zulässig. Add-ons benötigen zusätzlich `COMMERCIAL_PRODUCTION_OFFERS=true`.
Ein Kill Switch stoppt neue Käufe/Commits, löscht aber keine bestehenden
Servicepflichten. Bereits bezahlte Leistungen werden erfüllt, ersetzt,
gutgeschrieben oder zurückerstattet.

## 9. Verifikation

Gezielte technische Matrix:

```powershell
npx vitest run --config vitest.config.ts tests/unit/commercial tests/unit/billing/paid-service-recovery-policy.test.ts tests/unit/config/env-schema.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/admin/phase31-cluster-v2-postgres.test.ts tests/integration/billing/phase31-product-release-postgres.test.ts tests/integration/billing/phase31-radar-paid-gate-postgres.test.ts tests/integration/billing/phase31-service-recovery-postgres.test.ts tests/integration/imports/phase31-managed-import-postgres.test.ts
npm run test:e2e:browser -- tests/e2e/flows/phase31-production-offer.spec.ts tests/e2e/flows/phase31-managed-import.spec.ts --project=chromium-journeys
```

G3 bleibt trotz grüner Automation `OPEN`, bis reale 31A-Evidence,
Freigabeowner und ein Zielumgebungs-/Canary-Nachweis vorliegen.

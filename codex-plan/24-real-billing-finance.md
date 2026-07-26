# Phase 24 — Reales Billing, Finance Operations und bezahlte Service-Recovery

## 1. Status

| Dimension | Status |
| --- | --- |
| Planstatus | `GEPLANT` |
| Technikstatus | `NICHT IMPLEMENTIERT` |
| Quality-Gate | `NICHT GELAUFEN` |
| Aktivierung | `DISABLED` |

Diese Datei ist ein prospektiver Ausführungsvertrag. Sie enthält keine technische
Evidence, keine Paymentprovider-Freigabe und keine Aussage über einen bereits
zahlungsbereiten Markt. Phase 24 darf erst beginnen, wenn Phase 31A für einen
konkret benannten LC5-Scope ein dokumentiertes WTP-`GO` erteilt hat. Ein
manueller, rechtlich und steuerlich freigegebener Rechnungspilot kann WTP vor
dieser Phase testen; er aktiviert keinen öffentlichen Self-Service.

## 2. Ziel und messbarer Business-/Nutzerwert

Ein freigegebener Arbeitgeber soll eine klar benannte Leistung mit echtem Geld
bezahlen können, während Order, Provider Receipt, Invoice, Ledger,
Subscription/Credits und Entitlements nachvollziehbar synchron bleiben. Bei
plattformverursachter Nichterfüllung erhält er genau eine policykonforme
Ersatzleistung, Credit-Wiederherstellung, Verlängerung oder Rückzahlung.

Messbarer Zielwert für den technischen Vertrag:

- `0` clientautorisierte Preis-, Währungs-, Tenant- oder Entitlementmutationen;
- genau `1` fachliche Wirkung je signiertem Providerereignis, auch bei Replay,
  Parallelität und Out-of-order-Zustellung;
- `100 %` tägliche Zuordnung der freigegebenen Sandbox-Receipts zu Order,
  Invoice und Ledger oder ein expliziter Repair-/Incident-Fall;
- `0` doppelte Refunds, Credit-Restores oder Ersatzleistungen;
- öffentlicher Checkout bleibt bis zum LC5-Go serverseitig unerreichbar.

## 3. Tatsächlicher Repositoryzustand

- `STH-005` ist offen: die bestehende Billing-Domain modelliert Orders,
  Invoices, Rappen, VAT, Credits, Subscriptions, Entitlements und
  idempotentes Fulfillment, aber der aktive Paymentprovider ist ein lokaler
  Mock.
- Der Payment-Composition-Root wählt keinen produktiven PSP; der vorhandene
  Stripe-Klassenname ist ein werfender Placeholder und keine Integration.
- Es gibt keine produktive Webhook-Inbox, Payment Attempts, Reconciliation,
  Dunning-, Chargeback-, Refund- oder Credit-Note-Ausführung.
- Historische Mock-Orders und Mock-Invoices sind gültige Demo-Evidence, aber
  niemals Umsatz- oder WTP-Evidence.
- ADR-014 bleibt für Phasen 01–18 wahr. ADR-035 genehmigt nur den prospektiven
  Real-Payment- und Service-Recovery-Scope dieser Phase.

Vor Implementierung werden die konkreten Fundstellen, Modellzahlen,
Migrationen, Tests, offenen Findings und der aktuelle Baseline-Commit in der
Phase-24-Evidence neu erfasst; diese Planbeschreibung ersetzt die Erfassung
nicht.

## 4. Findings und Requirements

| ID | Bedeutung in dieser Phase |
| --- | --- |
| `STH-005` | realer Checkout, Providerereignisse und Finance-Lifecycle fehlen |
| `STH-004` | Payment-Anteil des produktiven Providerprogramms |
| `STH-030` | non-admin Step-up vor Billing-/Owner-Hochrisikoaktionen |
| `STH-031` | Payment Fraud und ATO gehören in den gemeinsamen Risk-Vertrag |
| `STH-035` | bezahlte Service-Recovery bei Plattformversagen |
| `STH-037` | Basisnutzen/WTP muss vor Paid-Self-Service und Produktbreite belegt sein |
| `REQ-PAY-001` | Hosted Checkout, signierte Webhooks, Reconciliation und fail-closed Providerwahl |
| `REQ-BIL-010` | exactly-once Ersatzleistung/Credit/Verlängerung/Refund |
| `REQ-ID-004` | frische, zweckgebundene Assurance für Owner/Billing |
| `REQ-TRUST-001` | Payment-Fraud-/ATO-Signale, Hold, Review und Appeal |
| `REQ-COM-001` | dokumentiertes Phase-31A-WTP-Go vor Start dieser Phase |
| `REQ-QA-003` | 28-Punkte-Vertrag und vollständige AC→Test-Matrix |

ADR-028 bleibt für normale Ablehnung, Ablauf, freiwillige Kündigung und
ungenutzte Credits unverändert. Nur ein nach ADR-035 klassifizierter
plattformverursachter Fehler darf die neue Kompensationskette auslösen.

## 5. In Scope

- freigegebener Hosted-Checkout-/Paymentprovider in Sandbox; LIVE erst nach
  separater Aktivierungsentscheidung;
- serverautorisierte Preise, Currency, VAT, Product-/Plan-Version,
  Company-/Target-Kontext und Idempotency Key;
- `PaymentAttempt` und immutable Provider-Event-Inbox mit Raw-Body-Signatur,
  Timestamp-, Account- und Environment-Prüfung;
- Dedupe, Replay, Out-of-order-Verarbeitung, Retry und Provider-Reconciliation;
- Success, Failure, Pending, Timeout, Renewal, Upgrade, Downgrade,
  Cancellation, Dunning, Grace, Suspension, Refund, Partial Refund,
  Chargeback und Credit Note;
- sichere, fachlich freigegebene Rechnungsbereitstellung;
- Finance-Cockpit, Repair Queue und auditiertes manuelles Reconciliation;
- Service-Delivery-Assessment für Boost und Radar-Kontakte mit exactly-once
  Ersatz, Credit-Restore, Verlängerung oder Refund;
- Payment-Fraud-Holds und Schnittstelle zum Phase-25C-Trust-Safety-Fall;
- provider-/umgebungsgetrennte Telemetrie und Runbooks.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- Success Fee, Marketplace-Payouts, Escrow, Wallet oder Bankdatenhaltung;
- automatischer Verkauf von Boosts ohne belegte organische Reichweite oder
  Radar-Kontakten ohne belegte Kandidatendichte;
- Business-/Enterprise-Leistungen ohne lieferbare Entitlement-/Supportmatrix;
- clientautorisierte Preise, Currency, VAT oder direkte Entitlementmutation;
- Karten-/Bankdaten im Portal;
- pauschaler Auto-Refund bei normaler Kandidatenablehnung, gewöhnlichem Ablauf,
  freiwilliger Kündigung oder ungenutztem Credit;
- LIVE-Aktivierung ohne Phase 25B, Phase 23, Phase 31B, Tax/Legal/Finance und
  Providerfreigabe.

Solange diese Gates fehlen, sind Kauf-CTA, Checkout-Action, Webhook-LIVE-Key,
Renewal und bezahlte Produktcopy serverseitig `DISABLED`; ein versteckter Button
genügt nicht.

## 7. Benutzerrollen und organisatorische Owner

- **Employer Owner:** darf nach frischem, action-bound Step-up kaufen, kündigen
  und Zahlungsmittel-/Billingaktionen starten.
- **Employer Admin/Recruiter/Viewer:** besitzt standardmäßig kein Kauf-,
  Refund- oder Billing-Owner-Recht.
- **Finance:** bearbeitet Reconciliation, Refund, Chargeback und Credit Note
  mit eigener Capability, Step-up, Reason und Audit.
- **Support:** sieht redigierte Zustände und kann einen Fall eskalieren, aber
  weder Geld noch Ledger direkt verändern.
- **Trust & Safety:** setzt Payment-/ATO-Holds und entscheidet Risiko-/Appeal-
  Fälle, ohne allein einen Refund zu buchen.
- **System Worker:** konsumiert Inbox-/Reconciliation-/Dunning-Aufträge.
- **Product/Commercial Owner:** besitzt das WTP- und Package-Go.
- **Tax/Legal/Privacy/Security/Ops Owner:** besitzen ihre externen
  Aktivierungsgates.

## 8. Portale, Routen, Services, Provider und Worker

Geplante Routen werden bis zu ihrer Implementierung nur als Planned Route Delta
geführt:

- Employer: `/employer/billing`, `/employer/billing/checkout`,
  `/employer/billing/invoices/[id]`, `/employer/billing/subscription`;
- Provider: `/api/webhooks/payments/<provider>` mit Raw-Body-Vertrag;
- Admin/Finance: `/admin/billing`, `/admin/invoices`,
  `/admin/finance/reconciliation`, `/admin/finance/service-recovery`;
- Services: Quote, Checkout, Payment Inbox, Finance Projector,
  Reconciliation, Dunning und Service Recovery unter `lib/billing/**`;
- Provider: Port und freigegebener Adapter unter
  `lib/providers/payments/**`;
- Worker: Inbox Projector, Reconciliation, Dunning und Recovery Dispatch über
  Phase-23-Leases/Retry/DLQ.

Jede vorhandene Route behält ihre aktuelle Rollen-/Tenantgrenze. Neue Dateien
werden erst nach Implementierung in das generierte Ist-Routeninventar
übernommen.

## 9. Datenmodelle, Constraints, Indizes und Datenklassifikation

Prospektiv additive Modelle:

- `PaymentAttempt` mit serverseitigem Quote-/Order-/Company-Kontext,
  Environment, Provider und idempotentem Attempt-Key;
- immutable `ProviderEventInbox` mit Provider Event ID, Payload-Version,
  Signaturprüfstatus, minimalem verschlüsseltem/redigiertem Payload oder
  Referenz, Received-/Processed-Zeit und Fehlerklasse;
- `ReconciliationRun`/`ReconciliationItem`;
- `Refund`, `Chargeback`, `CreditNote`, `DunningCase`;
- `ServiceDeliveryAssessment`/`ServiceDeliveryEvent` mit
  `PLATFORM_FAILURE|EXPECTED_MARKET_OUTCOME|USER_ACTION|PROVIDER_PAYMENT_FAILURE`
  und genau einer zulässigen Remedy;
- `PaymentRiskDecision` oder Referenz auf den Phase-25C-Fall.

Pflichtconstraints:

- Provider Event ID ist je Provider+Environment unique;
- Attempt-/Refund-/Recovery-Idempotency Keys sind tenant- und zweckgebunden;
- Geld bleibt Integer-Rappen und Currency serverautoritativ;
- Service-Recovery referenziert genau eine ursprüngliche OrderLine und
  Serviceinstanz; maximal eine effektive Remedy derselben Policy-Version;
- Invoice-, Order-, Receipt- und Ledger-Snapshots sind immutable;
- Indizes decken Inbox-Status/ReceivedAt, Reconciliation-Status, Company,
  Provider Receipt, Dunning-Due und offene Recovery-Fälle.

Providerpayloads, Billingkontakte und Risikosignale sind vertraulich; Karten-
oder Bankdaten dürfen nicht gespeichert werden.

## 10. Migration, Backfill und Kompatibilität

1. additive Tabellen, Enums, FKs, Unique-/Check-Constraints und Indizes;
2. bestehende Mock-Orders bleiben unverändert als `MOCK` klassifiziert und
   werden nie zu echtem Umsatz umgeschrieben;
3. leere DB und realistische Bestandsfixture mit Mock-Orders, Subscriptions,
   Credits, Boosts, Radar-Requests und offenen Invoices migrieren;
4. teilweise/unterbrochenen Backfill und erneute Ausführung ohne Doppelwirkung
   testen;
5. Sandbox-Inbox zunächst `observe-only`, danach projektieren;
6. alte App liest neue optionale Felder weiterhin sicher; neuer Projector
   ignoriert unbekannte historische Mock-Ereignisse;
7. Contracting erst nach Count-/Null-/Orphan-/Ledger-/Tenant-Abgleich;
8. nach extern zugestellten oder finanziell verbuchten Ereignissen ist
   Roll-forward/Reconciliation der Standard, kein destruktiver DB-Rollback.

Mock- und Real-Datenbank/Secrets/Provider-Accounts bleiben strikt getrennt.

## 11. Server-, Worker-, Queue- und Providervertrag

- Checkout erhält nur Product/Plan/Target-ID; der Server lädt aktuelle
  Katalogversion, Tenant, Eligibility und Betrag.
- Der PSP erhält einen opaque, nicht autorisierenden Correlation-Key.
- Webhook prüft Raw Body, Signatur, Toleranzfenster, Provider Account,
  Environment und durable Inbox-Write, bevor Erfolg bestätigt wird.
- Exactly-once Network Delivery wird nicht behauptet. Inbox-Dedupe,
  Transaktion, fachlicher Effect-Key und immutable Ledger erzwingen exactly-once
  Business Effect.
- Out-of-order-Ereignisse werden gehalten/projiziert, niemals durch
  Zurücksetzen historischer Zustände „gelöst“.
- Worker nutzt Lease, Heartbeat, Retry-Klasse, Backoff, DLQ, Replay-Capability
  und Backpressure aus Phase 23.
- Provider-Timeout/429/5xx, Maintenance und unvollständige Konfiguration fallen
  geschlossen aus; Production fällt nie auf Mock zurück.
- Reconciliation vergleicht Receipt, Attempt, Order, Invoice, Ledger,
  Subscription/Credit und Remedy; Abweichungen werden nicht still korrigiert.

## 12. UX-Zustände

Employer-, Finance- und Webhook-/Workerflüsse besitzen explizit:

- **Loading:** Quote, Checkout-Redirect, Invoice und Reconciliation laden;
- **Empty:** keine Rechnungen, kein Zahlungsmittel, kein offener Repair-Fall;
- **Locked:** fehlendes WTP-/Entitlement-/Owner-/Step-up-/Finance-Gate;
- **Pending:** Providerautorisierung, 3DS, Webhook, Dunning oder Prüfung;
- **Error:** sichere Fehler-ID ohne Providerpayload/Secret;
- **Retry:** retriable Checkout-/Provider-/Projection-Fehler, ohne Doppelwirkung;
- **Conflict:** bereits bestätigter Attempt, paralleler Refund oder veraltete
  Quote;
- **Expired:** Checkout Session, Step-up oder Zahlungsfrist abgelaufen;
- **Cancelled:** Nutzerabbruch, Subscription-/Checkout-Cancel;
- **Success:** bestätigte Zahlung beziehungsweise abgeschlossene, reconciliierte
  Remedy mit klarer nächster Aktion.

Payment-Pending wird nie als bezahlt oder erfüllt dargestellt.

## 13. Mobile und Accessibility

- Checkout, Invoice, Kündigung und Recovery funktionieren bei 360 px ohne
  abgeschnittene Beträge, CTA oder Pflichtcopy.
- Beträge, Status und Fehler sind nicht nur farbcodiert.
- Hosted-Checkout-Rückkehr besitzt stabile Fokusführung und verständlichen
  Seitentitel.
- Tabellen im Finance-Cockpit erhalten semantische Header, Tastaturnavigation
  und für häufige mobile Aufgaben Card-/Detaildarstellung.
- Live-Status nutzt keinen ungezügelten Screenreader-Stream.
- Kritische Journeys werden in Chromium Desktop/360 sowie ab Phase 29 in der
  freigegebenen Firefox-/WebKit-/AT-Matrix geprüft.

## 14. Authentisierung, Step-up, Autorisierung und Tenant

- Public Checkout ist bis zur Phase-25B-Evidence deaktiviert.
- Employer-Kauf, Subscriptionwechsel, Kündigung, Billingkontakt- und
  Zahlungsmittelaktionen benötigen Owner-Capability plus frischen
  `StepUpGrant`, gebunden an Actor, Company, Action, Betrag/Quote und Purpose.
- Stale, replayed, cross-purpose, cross-company oder nach Rollenentzug erzeugte
  Grants haben `0` Wirkung.
- Finance-/Repair-/Refund-/Replay-Aktionen benötigen persistierte Capability,
  stärkere frische Assurance, Reason und Audit.
- Support und Trust & Safety dürfen keine Finance-Capability ableiten.
- Webhook besitzt keine Userrolle; seine Autorität endet bei erfolgreicher
  Signatur-/Account-/Environmentprüfung und Inbox-Persistenz.
- Jede Company-/Order-/Invoice-/Serviceinstanz wird serverseitig tenant-
  spezifisch geladen; fremde IDs liefern sichere 404/deny.

## 15. Datenschutz, Retention, Export, Löschung und Audit

- Hosted PSP minimiert PCI-Scope; keine Zahlungsinstrumentdaten im Portal.
- Raw Providerpayload wird nur soweit zwingend verschlüsselt/retained; Logs und
  Audit enthalten eine geschlossene Redaction-Allowlist.
- Retention/Legal Hold für Invoice, Ledger, Tax, Refund, Chargeback,
  Reconciliation, Security und Consent folgt Phase 22.
- Datenschutzexport enthält verständliche Payment-/Invoice-/Recovery-Evidence,
  aber keine Providersecrets oder internen Fraud-Regeln.
- Löschung anonymisiert zulässige Kontaktdaten, erhält gesetzlich gebundene
  Finanz-/Audit-Evidence minimal und nach freigegebener Matrix.
- Jede Finance-, Risk-Hold-, Service-Recovery- und Replay-Mutation schreibt
  transaktional Audit beziehungsweise garantierte Outbox-Evidence.

## 16. Abuse-, Fraud-, ATO-, Replay- und Insider-Szenarien

- gestohlene Owner-Session startet Checkout/Refund oder ändert Billingrollen;
- Credential Stuffing und Recovery-Abuse vor bezahlter Aktion;
- Client manipuliert Betrag, Currency, Product, Company oder Target;
- gefälschte, alte, falschem Account zugehörige oder wiederholte Webhooks;
- Checkout-/Coupon-/Refund-/Chargeback-/Credit-Restore-Velocity;
- Doppelrefund beziehungsweise Kollusion zwischen Support und Finance;
- Plattformfehler wird fälschlich behauptet, um normale Radar-Ablehnung oder
  Boost-Ablauf zu monetarisieren;
- kompromittierte verifizierte Company kauft, veröffentlicht oder exportiert;
- Insider-Replay/Repair ohne SoD, Step-up, Reason oder Audit.

Phase 25C liefert RiskSignal, Hold, Review, Appeal und schnelle Revocation.
Phase 24 liefert paymentnahe Signale, stoppt die Wirkung fail-closed und
überlässt die fachliche Fraud-Entscheidung nicht dem PSP allein.

## 17. Externe und organisatorische Voraussetzungen

| Gate | Owner | Erforderliche Evidence |
| --- | --- | --- |
| Phase-31A-WTP-`GO` für LC5 | Product/Commercial/Finance | preregistrierter echter Geldtest, Stichprobe, Schwelle und datierter Entscheid |
| PSP/Acquirer | Finance/Security/Ops | Vertrag, Merchantkonto, Sandbox-/LIVE-Zugang, DPA, Region, Webhook-/Incidentvertrag |
| Tax/VAT/Invoice | Tax/Finance/Legal | freigegebene CH-Behandlung, Rechnungs-/Credit-Note-/Refund-Regeln |
| AVG/AGB/Refundcopy | Legal | flowspezifische schriftliche Freigabe |
| Step-up/SoD | Security | Phase-25B/25A-Evidence |
| Betrieb | Ops | Phase-23-Queue, Monitoring, On-call, RPO/RTO, Runbooks |
| Serviceversprechen | Product/Finance/Support | versionierte Delivery-/Recovery-Policy und Support-SLA |

Fehlt ein Gate, bleibt die betreffende Aktivierung `BLOCKED BY EXTERNAL GATE`.

## 18. Interphase-Abhängigkeiten

- Phase 19: grünes G0 und synchronisierte Requirements/ADRs;
- Phase 20: verifizierte Identity, Outbox-/Delivery-Vertrag;
- Phase 22: Legal-/Retention-/Erasure-Matrix;
- Phase 23: autonome Inbox-/Dunning-/Reconciliation-Worker und Operations;
- Phase 25A/B/C: Finance Least Privilege, non-admin Step-up und Fraud/ATO;
- Phase 26: Current Trust für öffentliche bezahlte Company-Flows;
- Phase 31A: WTP-`GO` vor technischem Start;
- Phase 31B: ProductRelease-/Copy-/Katalog-Go vor LIVE;
- Phase 29/32: finale Mobile/A11y beziehungsweise Release-Evidence.

Sandbox-Domainarbeit beginnt erst nach 31A-`GO`; Public Checkout wartet
zusätzlich auf Phase 25B und 31B.

## 19. Geordnete Implementierungsschritte

1. WTP-/Scope-Go, ADR-035, PSP-/Tax-/Refund-/Servicepolicy und Threat Model
   versionieren.
2. geplante Routen, Capability-/Step-up- und Provideraktivierungsmatrix
   freigeben.
3. additive Payment-/Inbox-/Reconciliation-/Recovery-Migration samt
   Bestandsfixture implementieren.
4. serverautoritative Quote und Hosted Sandbox Checkout implementieren.
5. Raw-Body-Webhook-Ingestion durable und observe-only anbinden.
6. Projector für Payment Lifecycle, Invoice und bestehendes Fulfillment
   idempotent integrieren.
7. Reconciliation, Dunning, Refund, Chargeback und Credit Note implementieren.
8. Service-Delivery-Assessment und exactly-once Remedy anbinden.
9. Payment-Risk-Signale/Holds an Phase 25C, privilegierte Commands an
   Phase 25A/B binden.
10. Employer-/Finance-UX und sichere Dokumentbereitstellung implementieren.
11. Owning-, Migration-, Failure-, Concurrency-, Sandbox- und A11y-Tests
    ausführen.
12. Sandbox-Canary, Reconciliation- und Kill-Switch-Drill; LIVE bleibt bis zu
    allen Aktivierungsgates geschlossen.

## 20. Feature Flags, Kill Switch und Aktivierung

- `REAL_PAYMENT_INGESTION`: zunächst Sandbox/observe-only;
- `REAL_PAYMENT_PROJECTION`: getrennt von Ingestion canarybar;
- `PAID_SELF_SERVICE`: serverseitig default `false`;
- `FINANCE_REPAIR_ACTIONS`: nur Phase-25A-Capability/Step-up;
- `PAID_SERVICE_RECOVERY`: Policy-Version und Produkt getrennt aktivierbar;
- Provider Registry: Environment, Mode, Account, Secret-Version, DPA, Health,
  Owner und Gate;
- Kill Switches pausieren neue Checkouts, Projection, Dunning oder Remedies
  getrennt. Signaturgeprüfte durable Ingestion bleibt nach Möglichkeit aktiv,
  um Events nicht zu verlieren.

Aktivierungsreihenfolge:
`DISABLED → SANDBOX_INGEST → SANDBOX_PROJECT → ALLOWLIST → LIVE`. Jeder Schritt
benötigt eigenes Smoke-, Reconciliation- und Rollback-/Kill-Switch-Protokoll.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Alle Testdateien sind **geplant** und werden in dieser Phase angelegt. Kein
Eintrag behauptet einen gelaufenen Test.

| Criterion/Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P24-AC-01` / `REQ-COM-001` | P0 LC5: Produkt vor WTP gebaut/verkauft | Unit + E2E | WTP-/Activation-Gate | datiertes 31A-Go öffnet nur Sandboxscope | fehlendes/abgelaufenes/anderes Package-Go, direkte Action | Product Owner | Pricing, Checkout, Server Action | GO/NO-GO/expired Decisions, zwei Packages | Unit + Browser | `npx vitest run --config vitest.config.ts tests/unit/billing/paid-activation-policy.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase24-paid-checkout.spec.ts --project=chromium-journeys` | ohne passendes GO `0` Checkout Sessions und CTA/Action fail-closed; mit GO genau eine Sandbox Session | Vitest/Playwright-Report, Decision-ID | Product + QA | `PLANNED` |
| `P24-AC-02` / `REQ-PAY-001` | P0: Preis-/Tenantmanipulation | Unit + PostgreSQL | serverautoritative Quote/Checkout | gültiger Owner/Quote erzeugt Attempt | Betrag, Currency, Product, Target, Company oder stale Quote manipuliert | Employer Owner | Employer Checkout/Quote Service | CHF-Rappen, VAT, Company A/B, stale Catalog | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/billing/real-payment-contract.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/billing/real-payment-postgres.test.ts` | erlaubter Fall: 1 Attempt mit Serversnapshot; jeder Negativfall: 0 Provider Calls/DB-Wirkung | Testreport + redigierter Quote-Snapshot | Billing + QA | `PLANNED` |
| `P24-AC-03` / `REQ-PAY-001` | P0: gefälschter/verlorener/doppelter Webhook | Contract + PostgreSQL | Raw Body, Signatur, Inbox, Replay/Order | gültiges Event wird durable angenommen und einmal projiziert | falsche Signatur/account/env/timestamp, Replay, out-of-order | PSP/System | Webhook + Inbox Projector | signierte Fixtures, duplicate IDs, reversed Reihenfolge | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/providers/payments/payment-provider-contract.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/billing/payment-webhook-postgres.test.ts` | ungültig: 0 Inbox-/Domainwirkung; gültiges Replay N-mal: 1 Inbox/1 fachliche Wirkung | Contract-/DB-Report, Provider-Event-ID redigiert | Billing + Security | `PLANNED` |
| `P24-AC-04` / `REQ-PAY-001` | P0: Geld und Entitlement divergieren | PostgreSQL | Lifecycle/fulfillment | Success/Renewal/Upgrade/Downgrade/Cancel wirken policytreu | Failure/Pending/Timeout/Race dürfen nicht erfüllen | System Worker | Billing Domain | alle Payment-/Subscriptionzustände, feste Uhr | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/billing/real-payment-lifecycle-postgres.test.ts` | je Eventfolge exakt 1 zulässiger Endzustand; Pending/Failure `0` Fulfillment | DB-State-/Ledger-Assertions | Billing + Finance + QA | `PLANNED` |
| `P24-AC-05` / `REQ-PAY-001` | P0: unbemerkte Finanzabweichung | PostgreSQL + Provider | Reconciliation/Repair | Receipt↔Order↔Invoice↔Ledger stimmt oder Repairfall entsteht | missing/extra/wrong amount/currency/tenant; unautorisierter Repair | Finance/System | Reconciliation Worker/Cockpit | matched und sechs mismatch Fixtures | real PostgreSQL + PSP Sandbox | `npx vitest run --config vitest.integration.config.ts tests/integration/billing/reconciliation-postgres.test.ts`; manuell: Sandbox-Settlement importieren, Run starten, jeden Mismatch mit Reason bearbeiten | `100 %` Items matched oder explizit OPEN/ESCALATED; `0` stille Korrekturen | Reconciliation-Manifest, Screenshots ohne PII | Finance + Ops | `PLANNED` |
| `P24-AC-06` / `REQ-ID-004` | P0: ATO führt zu Kauf/Refund | Security + PostgreSQL | action-bound Owner/Finance Step-up | frischer passender Grant erlaubt genau eine Aktion | stale/replay/cross-purpose/cross-company/revoked role/direct action | Owner/Finance | Checkout, Refund, Repair Commands | Grants je Actor/Purpose/Tenant, Company A/B | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/billing/payment-step-up-postgres.test.ts` | Negativfälle: 0 Provider-/Ledgerwirkung; Positivfall: genau 1 Wirkung und Audit | Security-Testreport, Audit-IDs | Security + Billing | `PLANNED` |
| `P24-AC-07` / `REQ-TRUST-001` | P0/P1: Payment Fraud/Chargeback Abuse | Unit + PostgreSQL | velocity/risk hold/appeal | riskante Aktion wird gehalten und Fall eröffnet | Signal-Replay, fremder Tenant, Support-Bypass, false positive ohne Appeal | Trust & Safety/Finance | Risk Engine/Finance | velocity, device, refund/chargeback, complaint Fixtures | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/billing/payment-risk-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/billing/payment-fraud-postgres.test.ts` | High Risk: `0` Fulfillment bis Review, 1 Case; Appeal ändert nur per auditiertem Entscheid | Risk-/Case-Manifest | Trust & Safety + Security | `PLANNED` |
| `P24-AC-08` / `REQ-BIL-010` | P0 LC5: bezahlte Nichterfüllung/doppelter Refund | Unit + PostgreSQL | Service-Delivery-Policy | Plattformfehler erzeugt genau die freigegebene Remedy | normal decline/expiry/user cancel; parallele/replayed Remedies | Owner/Finance/System | Boost/Radar/Billing Recovery | alle ADR-035-Klassen, Original OrderLine/Ledger | Unit + real PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/billing/service-delivery-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/billing/service-recovery-postgres.test.ts` | jede Klasse genau 1 zulässiges Outcome; Nicht-Plattformfälle 0 Auto-Refund; Replay 1 Remedy | Policy-Matrix, Ledger-Diff | Product + Finance + Billing | `PLANNED` |
| `P24-AC-09` / `REQ-PAY-001` | P0: Race/Doppelwirkung | PostgreSQL Concurrency | Checkout/Webhook/Refund parallel | konkurrierende Wiederholungen konvergieren | Crash vor/nach Side Effect, doppelte Worker/Requests | System/Finance | DB + Worker | 20 parallele gleiche/differente Keys | real PostgreSQL | `npx vitest run --config vitest.integration.config.ts tests/integration/billing/payment-concurrency-postgres.test.ts` | 20 gleiche Requests → 1 Attempt/Effect; Ledger/Invoice unverändert und Balance korrekt | Concurrency-Report + Counts | Billing + QA | `PLANNED` |
| `P24-AC-10` / `REQ-QA-003` | P0: Migration korrumpiert Mock-/Geldhistorie | Migration | empty/upgrade/partial/idempotent | neue Modelle ohne Änderung historischer Snapshots | unterbrochener Backfill, N-1 Writer, Orphans/duplicates | System/Ops | Prisma/PostgreSQL | leere DB + Phase-18-Bestandsfixture + partial state | isoliertes PostgreSQL | `npm run db:migrate`; `npm run db:migrate:status`; `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase24-payment-migration-postgres.test.ts` | Exit 0; Mock→Real-Reklassifizierung `0`; Count/Checksum/Tenant-Abweichung `0` | Migrationlog + redigierter Abgleich | Data/DBA + Billing | `PLANNED` |
| `P24-AC-11` / `REQ-QA-003` | P1: unverständlicher/unerreichbarer Zahlfluss | E2E + A11y | Checkout/3DS/Pending/Invoice/Cancel/Recovery | alle Zustände, Fokus und Beträge verständlich | Providerabbruch, expired session, Locked, Error/Retry | Employer Owner/Finance | Employer/Admin UI | Sandbox Orders, alle UX-Zustände | Chromium Desktop + 360 | `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase24-billing-quality.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase24-billing-quality.spec.ts --project=chromium-mobile-360` | Axe serious/critical `0`; horizontales Clipping kritischer CTA/Beträge `0`; jeder Zustand per Heading/Text unterscheidbar | Playwright/Axe/Screenshots | UX + Accessibility + QA | `PLANNED` |
| `P24-AC-12` / `REQ-OPS-005` | P0: Provider-/Worker-Ausfall verliert Geldereignis | Failure + Sandbox | timeout/429/5xx/DLQ/restart | durable Inbox wird nach Recovery einmal projiziert | Provider offline, poison event, deploy zwischen write/effect | System/Ops | PSP/Worker/DLQ | Sandbox Events und Fault Injection | Staging/Sandbox | `npx vitest run --config vitest.integration.config.ts tests/integration/billing/payment-failure-recovery-postgres.test.ts`; manuell: Worker nach durablem Inbox-Write stoppen, neu starten, DLQ re-drive | verlorene signierte Events `0`; doppelte Effekte `0`; Alert für DLQ/age innerhalb freigegebener SLO | Failure-Manifest, Alert-/Runbook-Record | Ops + Billing | `PLANNED` |
| `P24-AC-13` / `REQ-PAY-001` | P0 LC5: falsches Artefakt/Secret live | Provider Smoke | Sandbox→Allowlist→LIVE Gate | getestetes Artefakt mit korrektem Account/Environment | Testevent/Mockprovider/abweichender Digest in Production | Ops/Finance | Deployment/Provider Registry | Build-Digest, Sandbox/LIVE Accounts, Secret-Version | Staging; LIVE erst nach Freigabe | manuell: deployten Digest prüfen, Provider-Health, 3DS-Test, Webhook, Invoice, Reconciliation, Kill Switch; anschließend `npm run test:e2e:http` | Digest exakt gleich; Mock/LIVE-Mix `0`; Smoke vollständig reconciliiert; Kill Switch stoppt neue Käufe | Provider Receipt, Deployment-/Go-Record | Ops + Finance + Release Manager | `PLANNED` |

## 22. Performance und Scale

- Hosted-Checkout-Erzeugung: serverseitig p95 höchstens `750 ms` ohne
  Providernetzwerk beziehungsweise dokumentiertes Providerbudget separat;
- Webhook-Ingestion bis durable Inbox: p95 höchstens `500 ms` bei normaler
  Providerpayloadgrösse, bevor asynchrone Fachprojektion startet;
- Inbox-Projektion: kein N+1; p95 Queue Age und Durchsatz werden in Phase 23 pro
  LC5-Kohorte freigegeben, Backlog-Alert bei Überschreitung;
- Reconciliation verarbeitet bounded Batches, benutzt Keyset/Indizes und
  speichert Fortschritt; `10.000` synthetische Items ohne Full-Table-Scan oder
  unbounded Memory;
- Finance-Listen besitzen Keyset-Pagination und keine harte unerreichbare Cap;
- Payment-/Recovery-Risikoregeln haben begrenzte Zeitfenster und Indizes;
- Loadtest misst p50/p95/p99, DB Queries, Queue Age, Provider Rate Limits und
  Kosten je erfolgreichem Checkout/Recovery.

Abweichende reale Provider-SLOs werden vor Aktivierung versioniert; sie dürfen
nicht als bereits bewiesen gelten.

## 23. Geschützte Phase-01–18-Invarianten

- Phase 03: Integer-Rappen, serverautorisierte Policies, auditierte Effekte;
- Phase 04: Businesslogik hängt nur am Providerport; kein stiller Real→Mock-
  Wechsel;
- Phase 05: DEMO/TEST-Provenienz zählt nie als LIVE/WTP;
- Phase 06/10: Session, Company Membership, Owner-/Tenantgrenzen und sichere 404;
- Phase 08: Preise bleiben Hypothesen bis echter Evidence;
- Phase 11: Admin-/Support-Capabilities und Audit; kein zweites Billingmodell;
- Phase 12: einzige Autorität für Katalog, Order, Invoice, Ledger,
  Subscription, Credits und Entitlements; immutable Snapshots;
- Phase 13: Boost bleibt sichtbar gekennzeichnet, Relevanz-only und ohne
  Fair-Score-Effekt;
- Phase 14: Radar-Anonymität, Kandidatenfreigabe und Creditverbrauch;
- Phase 16: CSRF, IDOR, Redaction, no-store, Rate Limit und Audit;
- Phase 17/18: E2E-01–08, Zero Retry, Production-Demo-Guard und ehrliche
  Demo-ready-/nicht-production-ready-Grenze.

Owning Regressionen werden aus Abschnitt 10 des
`remediation-execution-contract.md` konkret ausgewählt und mit allen neuen
Phase-24-Suites im G3 erneut ausgeführt.

## 24. Rollback und Roll-forward

- neue Checkouts, Projection, Dunning und Recovery besitzen getrennte Kill
  Switches;
- Webhook-Ingestion bleibt, soweit sicher, durable aktiv; andernfalls antwortet
  sie retriable statt Erfolg zu behaupten;
- nach externem Geldereignis erfolgt keine DB-Zeitreise. Fehler werden durch
  Inbox-Replay, Reconciliation, Credit Note, Refund oder kompensierende
  Ledger-/Service-Events vorwärts korrigiert;
- Schema ist bis Contract additiv rückwärtskompatibel;
- bereits bezahlte Rechte werden bei Providerpause nicht pauschal gelöscht;
- Rollback-Drill trennt App, Worker, Schema, Secret und Provider Account;
- nach irreversiblem Provider-/Finance-Side-Effect ist Roll-forward-only
  ausdrücklich im Incident festzuhalten.

## 25. Benötigte Evidence und Artefakte

- WTP-Go-Decision und freigegebener LC5-/Package-Scope;
- vollständige AC-Matrix mit tatsächlichen Befehlen/Exit Codes auf einem Commit;
- Migration-/Backfill-/Count-/Checksum-Report;
- PSP-Contract-/Sandbox-Receipts, Webhook-/Replay-/Out-of-order-Manifest;
- Reconciliation-, Dunning-, Refund-/Chargeback- und Recovery-Evidence;
- Security-/Step-up-/Fraud-/Tenant-Negativmatrix;
- Desktop-/360-/A11y-Artefakte;
- Provider-/Worker-Failure-, Kill-Switch- und Runbook-Drill;
- Tax/Legal/AVG/Refund-/Servicepolicy-, Finance-, Security- und Ops-Gates mit
  Owner/Datum;
- Artefakt-/Commit-Digest und getrennte Sandbox-/LIVE-Aktivierungsentscheidung.

Secrets, Raw Providerpayloads, Zahlungsinstrumentdaten und PII bleiben aus der
Evidence ausgeschlossen.

## 26. Definition of Done

Technisch abgeschlossen ist Phase 24 erst, wenn:

- sämtliche In-Scope-Modelle, Migrationen, serverseitigen Flows, Workerhooks,
  UIs, Flags, Runbooks und geplanten Tests implementiert sind;
- jede AC-Zeile `PASS` oder nachvollziehbar `N/A` ist;
- Owning Tests, vollständige Unit-/PostgreSQL-Suite, Lint, Typecheck, Build,
  Payment-/Tenant-/Security-Gates und G3 auf demselben Commit grün sind;
- Sandbox-Payment, Webhook, Invoice, Fulfillment, Reconciliation, Failure und
  Service-Recovery vertikal belegt sind;
- Mock-Evidence weiterhin sichtbar getrennt ist.

Das bedeutet höchstens `TECHNISCH ABGESCHLOSSEN` und Quality-Gate `BESTANDEN`.
Ohne externe Gates bleibt Aktivierung `SANDBOX` oder
`BLOCKED BY EXTERNAL GATE`, niemals automatisch `LIVE`.

## 27. Quality-Gate für abhängige Phasen

- Phase 29 darf Paid-UX nur gegen den grünen stabilen Phase-24-Vertrag
  finalisieren.
- Phase 31B darf einen Paid-Katalog/CTA nur freigeben, wenn Phase 24 G3,
  Phase 25A/B/C, Service-Recovery, WTP-, Tax-/Legal-/Finance- und
  Operations-Gates grün sind.
- Phase 32 akzeptiert LC5 nur mit G4 auf exakt dem deployten Artefakt und
  vollständiger Reconciliation-/Provider-/Incident-Evidence.
- Ein kostenloser LC3/LC4-Scope darf Phase 24 als `DISABLED / NOT REQUIRED FOR
  THIS LAUNCH CLASS` führen, muss aber sämtliche Kaufpfade serverseitig
  geschlossen belegen.

## 28. Was diese Phase nicht beweist

Phase 24 beweist nicht:

- Zahlungsbereitschaft, Product-Market-Fit, CAC, Retention oder Rentabilität;
- dass Boost organische Reichweite oder Radar qualifizierte Kandidatendichte
  besitzt;
- eine AVG-, Steuer-, AGB-, Datenschutz- oder allgemeine Produktionsfreigabe;
- dass ein PSP-Sandbox-Test echte LIVE-Zahlungen oder Chargeback-Raten abbildet;
- dass normale Recruiting-Ablehnung oder gewöhnlicher Ablauf refundfähig ist;
- dass Business-/Enterprise-, Success-Fee-, Payout- oder Escrow-Produkte
  lieferbar sind;
- allgemeine LC6-Skalierbarkeit.

Diese Aussagen bleiben bei Phase 31, externen Fachowner, Phase 23/25 und dem
finalen Phase-32-Audit.

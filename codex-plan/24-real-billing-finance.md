# Phase 24 — Reales Billing und Finance Operations

> **Status: GEPLANT / NICHT BEGONNEN.** Die interne Billing-Domain ist stark,
> aber der einzige aktive Paymentprovider ist ein lokaler Mock. Diese Phase ist
> für einen bezahlten Launch Pflicht; eine kostenlose Beta hält alle Kauf-CTAs
> geschlossen.

## Ziel

Realen Geldfluss sicher mit Order, Invoice, Subscription, Credits und
Entitlements synchronisieren und sämtliche Betriebsfälle von Checkout bis
Reconciliation nachvollziehbar beherrschen.

## Ausgangslage und Problem-IDs

- `STH-005` bestätigt: keine realen Webhooks, Payment Attempts, Dunning,
  Refunds, Chargebacks, Credit Notes oder Reconciliation.
- `STH-004` (Payment-Anteil): Stripe-Klasse ist ein werfender Placeholder,
  Composition Root fest Mock.
- Bestehende Rappen-, VAT-, Snapshot-, Ledger-, Idempotenz- und Fulfillment-
  Regeln werden erweitert und nicht neu erfunden.

## In Scope

- Freigegebener Paymentprovider in Sandbox und später Live.
- Hosted Checkout/Setup, serverseitige Preise und Currency.
- Payment Attempt und Provider Event Inbox mit Raw-body-Signatur.
- Replay-, Dedupe- und Out-of-order-Verarbeitung.
- Success/Failure/Pending/Timeout, Renewal, Upgrade, Downgrade, Cancel.
- Dunning, Grace/Suspension, Refund, Partial Refund, Chargeback, Credit Note.
- PDF-/rechtlich freigegebene Rechnungsdokumente und sichere Bereitstellung.
- Tägliche Reconciliation, Repair Queue und Finance-Cockpit.
- Entitlement-Synchronisierung über bestehende Fulfillment- und Ledgerregeln.

## Out of Scope

- Success Fee, Marketplace-Payouts oder Escrow.
- Clientautoritative Preise oder direkte Entitlement-Mutation durch Webhook.
- Liveaktivierung ohne Tax/Legal/Provider-/Finance-Freigabe.
- Ersatz des bestehenden Order-/Invoice-/Credit-Ledgers.

## Rollen und Prozesse

Employer Owner/Admin kauft und verwaltet Verträge. Finance bearbeitet
Reconciliation, Refund/Chargeback und Credit Notes mit eigener Capability und
Step-up. System Worker konsumiert Providerereignisse. Support sieht nur
redigierte sichere Zustände.

## Betroffene Dateien und Module

- `lib/billing/**`, `lib/providers/payments/**`
- Employer Checkout/Billing/Invoice/Success-Routen
- neue Webhook Route mit Raw-body-Vertrag
- Admin Billing/Orders/Invoices/Finance/Queue
- Notification-Outbox und Worker
- `prisma/schema.prisma`, Migrationen, Tests und Runbooks

## Datenmodelländerungen

PaymentAttempt, immutable ProviderEventInbox, ReconciliationRun/Item,
Refund/Chargeback/CreditNote und Dunning/Collection State. Provider IDs werden
opaque und unique gespeichert, aber fachliche Zustände folgen weiterhin
serverseitigen Transitionen. Invoice-/Order-Snapshots bleiben unveränderlich.

## Sicherheits- und Datenschutzfolgen

- Keine Karten-/Bankdaten im System; hosted provider flow.
- Webhook verifiziert Raw Body, Signatur, Timestamp, Account und Environment.
- Kein Secret oder kompletter Providerpayload in Audit/Logs.
- Finance-Aktionen benötigen Least Privilege, Step-up, Reason und Audit.
- Test-/Live-Providerereignisse und Datenbanken sind strikt getrennt.

## Migrationsstrategie

- [ ] Additive Payment-/Finance-Modelle und Unique Constraints.
- [ ] Mock-Orders bleiben als `MOCK` eindeutig und werden nie in echte
  Umsätze umklassifiziert.
- [ ] Provider-Event-Inbox zunächst observe-only in Sandbox.
- [ ] Canary-Produkte und serverseitige Release Decisions.
- [ ] Kein Contract/Enum entfernen, bevor Backfill/Reconciliation vollständig.

## Implementierungsschritte

- [ ] Payment-/Tax-/Invoice-/Refund-/Dunning-ADR und Threat Model.
- [ ] Provideradapter, Secretrotation und fail-closed Composition.
- [ ] PaymentAttempt und Event Inbox migrieren.
- [ ] Checkout Session serverautoritativ erstellen.
- [ ] Signierte Webhook-Ingestion minimal persistieren, danach asynchron
  verarbeiten.
- [ ] State Machine für Success/Failure/Renewal/Dunning/Refund/Chargeback.
- [ ] Bestehendes Fulfillment idempotent anbinden; keine doppelte Erfüllung.
- [ ] Invoice/Credit Note und sichere Dokumentbereitstellung.
- [ ] Reconciliation/Repair und Finance-Cockpit.
- [ ] Sandbox-, Failure-, Out-of-order- und End-to-End-Drills.

## Abhängigkeiten

Phasen 20, 22 und 23 für Identity/Delivery, Legal/Retention und autonome
Providerausführung. Damit kann Phase 24 technisch `SANDBOX_READY` werden.
Phase 25 ist das Aktivierungs-Gate für Finance-Cockpit, Refund,
Reconciliation-Repair und andere privilegierte LIVE-Mutationen. Der frühe
Phase-31A-Track liefert vor weiterem LIVE-Ausbau einen dokumentierten
Commercial-Go/No-go; öffentlicher Checkout und Production-Copy bleiben bis
zur Phase-31B-ProductRelease-/Katalog-/WTP-Freigabe geschlossen. Hinzu kommen
Paymentvertrag, Tax/VAT-/Invoice-/AGB-Freigabe, Finance Owner,
Merchant-/Bankkonto und Produktionssecrets.

## Risiken und Regressionen

- Geld- und Entitlementzustand divergieren.
- Replay oder Out-of-order-Event erfüllt doppelt.
- Refund/Chargeback entzieht Rechte falsch oder verändert historischen Ledger.
- Renewal-Race mit Cancel/Downgrade.
- Mock-Zahlen erscheinen als echter Umsatz.

## Abwärtskompatibilität und Rollback

Mockmodus bleibt nur in Local/CI/Preview explizit erreichbar. Production ohne
freigegebenen Realprovider bootet oder Checkout fail-closed. Provider-Rollback
pausiert neue Käufe und den Domainprojektor. Die signaturgeprüfte,
minimal-redigierte Webhook-Ingestion bleibt verfügbar und bestätigt dem
Provider erst nach durablem Inbox-Write; so können Events später exakt einmal
projiziert werden. Ist selbst sichere Ingestion nicht möglich, antwortet die
Route retriable statt Erfolg zu behaupten. Bereits bezahlte Rechte werden nicht
pauschal gelöscht.

## Akzeptanzkriterien und Tests

### Unit / Contract

- [ ] Serverpreise, Currency, VAT/Rundung und Provider Mapping.
- [ ] Signatur, Timestamp, Environment, Replay und Eventreihenfolge.
- [ ] Finance-State-Machine und Entitlementwirkung.

### PostgreSQL / Integration

- [ ] parallele Checkout-/Webhook-/Adminaktionen.
- [ ] success/failure/pending/renewal/dunning/cancel/upgrade/downgrade.
- [ ] full/partial refund, chargeback, credit note und reconciliation repair.
- [ ] genau ein Fulfillment und unveränderliche Snapshots/Ledger.
- [ ] Cross-Tenant-/Finance-Capability-/Step-up-Denials.
- [ ] Event während pausiertem Projektor/Deployment wird nach
  Signaturprüfung durable angenommen, erst später exakt einmal projiziert und
  nie durch einen vorzeitigen HTTP-Erfolg verloren.

### E2E und manuell

- [ ] echte Sandbox-Zahlung → Webhook → Invoice → Entitlement.
- [ ] 3DS/Abbruch/Fehler/Retry/Dunning/Refund.
- [ ] Finance-Reconciliation und DLQ-Replay.
- [ ] Checkout/Invoice/Cancellation auf Desktop/360 px und Accessibility.
- [ ] kostenlose Beta zeigt keine echten Kaufversprechen.

## Evidence und Definition of Done

- [ ] Provider-Sandbox und signierte Webhooks sind vertikal belegt.
- [ ] Geld, Invoice, Subscription, Credits und Entitlements reconciliieren.
- [ ] Failure/Dunning/Refund/Chargeback/Credit Note funktionieren.
- [ ] Finance-Commands verlangen Least Privilege/Step-up/Audit und bleiben
  ausser Sandbox bis zur Phase-25-Evidence fail-closed.
- [ ] Mock bleibt sichtbar getrennt und zählt nie als Umsatz/WTP.
- [ ] Loading-, Empty-, Pending-, Locked-, Error-, Retry-, Conflict- und
  Success-Zustände sind für Employer-, Finance- und Webhook-Flows umgesetzt.
- [ ] Vollständige Tests, Provider-/Reconciliation- und Runbook-Evidence grün.
- [ ] Live bleibt geschlossen, bis externe Gates bestätigt sind.

## Offene externe Voraussetzungen

Paymentvertrag, Merchantkonto, Tax/VAT, Rechnungs-/AGB-/Refund-Freigabe,
Produktpreise/WTP, Finance Owner, Bankabgleich, Secrets und Incident-Support.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Belastbarer Umsatz und korrekte Rechte statt lokaler Mock-Bestätigung. |
| Problem-IDs | STH-005; Payment-Anteil STH-004. |
| Prerequisites | 20, 22, 23 für Sandbox; 25 und 31B sowie externe Finance-/Legal-Gates für LIVE. |
| Deliverables | Real checkout, event inbox, billing lifecycles, invoices, reconciliation. |
| Security / Privacy | Hosted payment, signed raw webhooks, least-privilege Finance, redaction. |
| Tests | Replay/out-of-order, concurrency, all money states, sandbox E2E. |
| Expected Result | Geld- und Entitlementzustand bleiben nachvollziehbar synchron. |
| Risks / Limits | Ohne Live-Gates nur Sandbox-ready; kein Success Fee. |

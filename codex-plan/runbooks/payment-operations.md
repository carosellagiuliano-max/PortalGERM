# Payment Operations — Phase 24

## Zweck und Schutzgrenze

Dieses Runbook gilt für den technisch implementierten Phase‑24-Sandboxvertrag:
Hosted Checkout, signierte Webhook-Inbox, Projection, Reconciliation, Refund,
Chargeback, Dunning und Service-Recovery. Es ist keine LIVE-, Steuer-, Rechts-,
Finance- oder WTP-Freigabe.

Production und `LIVE` sind im Phase‑24-Adapter absichtlich nicht konfigurierbar.
Der sichere Ausgangszustand ist:

```text
PAYMENT_PROVIDER_MODE=disabled
PAYMENT_SANDBOX_COHORT=none
REAL_PAYMENT_INGESTION=false
REAL_PAYMENT_PROJECTION=false
PAID_SELF_SERVICE=false
FINANCE_REPAIR_ACTIONS=false
PAID_SERVICE_RECOVERY=false
```

Mock-Orders bleiben Demo-Evidence und zählen niemals als Umsatz oder
Zahlungsbereitschaft. Ein Real-Payment-Fehler darf nie auf Mock zurückfallen.

## Aktivierungsreihenfolge

Jeder Schritt benötigt ein datiertes, environment- und artefaktgebundenes
ProviderActivation-Record. Fehlende, abgelaufene, falsche oder per Kill Switch
gesperrte Records bedeuten `0` neue Providerwirkungen.

1. `DISABLED`: alle oben genannten Flags aus.
2. `SANDBOX_INGEST`: Stripe-Testkonto, Secret-Version und Webhook-Endpoint
   freigegeben; nur durable Ingestion, Projection aus.
3. `SANDBOX_PROJECT`: signierte Testevents werden nach Inbox-Reconciliation
   fachlich projiziert.
4. `ALLOWLIST`: zusätzlich datierter WTP-GO-Entscheid für exakt ein Paket und
   eine Testkohorte; Self-Service bleibt ohne Phase‑25B-Step-up-UX geschlossen.
5. `LIVE`: nicht Bestandteil von Phase 24. Erst Phase 31B/32 darf dies nach
   Tax, Legal, Finance, Security, Ops, WTP und deploygebundener G4-Evidence
   entscheiden.

Vor jeder Promotion:

- Provider-Account, Environment, Adapterversion, Secret-Version, DPA,
  Vertrag, Region, Health, Quota/Kosten, Owner und Runbook prüfen;
- denselben Build-Digest für App und Worker bestätigen;
- einen serverautorisierten CHF-Testbetrag über Hosted Checkout ausführen;
- Inbox, Attempt, Order, Invoice, Subscription/Ledger und Reconciliation
  abgleichen;
- Duplicate-, Out-of-order-, Timeout- und Kill-Switch-Fälle durchführen;
- keine Raw-Payloads, Signaturen, Secrets, Karten- oder Personendaten in
  Evidence übernehmen.

## Webhook und Inbox

Der Route Handler liest den Request-Body genau einmal als Raw Body. Nur der
Provideradapter darf Signatur, Toleranzfenster, Account, API-Version,
Environment und Testmodus bestätigen. Eine ungültige Nachricht erhält keine
Inbox- oder Domainwirkung.

Nach erfolgreicher Prüfung werden nur normalisierte, begrenzte Felder sowie
SHA‑256-Digests von Raw Body und Signatur persistiert. Der Handler bestätigt
nach durablem Inbox-Write; Domainprojektion erfolgt über
`payments.inbox-project`.

Bei Backlog oder Projection-Ausfall:

1. `REAL_PAYMENT_PROJECTION=false` setzen beziehungsweise Handler pausieren;
   verifizierte Ingestion nach Möglichkeit aktiv lassen.
2. ältestes `RECEIVED|FAILED`, Queue Age, Attempts und DLQ prüfen;
3. Provider Event IDs, Attempt-/Orderzuordnung und Account/Environment
   redigiert vergleichen;
4. Ursache beheben, dann über den Phase‑23-Lease-/Retry-Pfad wiederaufnehmen;
5. Reconciliation ausführen und erst nach `MATCHED` oder explizitem
   `OPEN|ESCALATED` schließen.

Inbox-Zeilen und Signatur-Evidence werden nicht gelöscht oder umgeschrieben.

## Provider-Unklarheit beim Checkout

Timeout, 429 oder 5xx nach dem Checkout-Create kann bedeuten, dass der Provider
die idempotente Operation angenommen hat. Deshalb:

- Attempt auf `HELD/CHECKOUT_CALL_UNCERTAIN` belassen;
- keinen zweiten Anbieter und keinen Mock verwenden;
- denselben Provider-Idempotency-Key zur Statusklärung verwenden;
- Provider-/Inbox-Evidence reconciliieren;
- bei bestätigter Zahlung nur das signierte Event projizieren;
- bei sicher nicht angenommener Operation einen auditierten,
  capability-geschützten Wiederanlauf verwenden.

## Reconciliation

`payments.reconcile` verarbeitet begrenzte Keyset-Batches. Verglichen werden:

- PaymentAttempt und Provider-Inbox;
- Orderbetrag, CHF-Währung und Company;
- genau ein PAID-Event;
- bezahlte Invoice;
- Subscription oder produktbezogener Ledger-/Fulfillment-Effekt.

Abweichungen werden als `ReconciliationItem OPEN` gespeichert. Phase 24 führt
keine stille Reparatur aus. `FINANCE_REPAIR_ACTIONS` bleibt bis Phase 25A
standardmäßig `false`; ein späterer Repair benötigt Capability, Step-up,
Pflichtgrund, Audit und bei Geldwirkung Vier-Augen-Trennung.

## Refund, Chargeback und Credit Note

Refund:

1. Finance-Requester benötigt `FINANCE_REFUND_REQUEST` und eine frische,
   action-/amount-/order-/tenantgebundene Assurance-Evidence.
2. Eine andere Person benötigt `FINANCE_REFUND_EXECUTE` und eine separate,
   refundgebundene Approval-Evidence.
3. Provider-Timeout bleibt `PENDING`; nicht erneut mit anderem Key ausführen.
4. Nur ein signiertes `refund.*`-Event finalisiert `SUCCEEDED`, erzeugt genau
   ein PaymentEvent und genau eine CreditNote.

Chargeback:

- `charge.dispute.created` eröffnet genau einen Fall zur Provider-Dispute-ID;
- `charge.dispute.closed` setzt nur einen erlaubten terminalen Providerstatus;
- offene Disputes sind Payment-Risk-Signale und sperren neue automatische
  Erfüllung bis Review;
- Belege und Fristen liegen beim PSP/Finance-Prozess, nicht in freien App-Logs.

## Dunning

Ein fehlgeschlagener Folgezahlungsversuch öffnet nur für eine bestehende
`ACTIVE|CANCELLING`-Subscription eine Grace Period. Während der Grace Period
bleibt der bestehende bezahlte Zeitraum erhalten. Nach sieben Tagen:

- Subscription wird `SUSPENDED`;
- Entitlements lesen `SUSPENDED` nicht als aktiv;
- der vorherige Status (`ACTIVE` oder `CANCELLING`) bleibt im DunningCase
  gespeichert;
- eine rechtzeitige bestätigte Zahlung stellt genau diesen Status wieder her;
- nach Periodenende wird `EXPIRED` statt reaktiviert.

## Bezahlte Service-Recovery

Nur `PLATFORM_FAILURE` kann automatisch kompensierbar sein:

- Credit-finanzierte Wirkung: exakte Reversal-Lineage des ursprünglichen
  Consume;
- bezahlter, weiterhin lieferbarer Job Boost: einmalig sieben Tage
  Verlängerung, DB-seitig an das genehmigte Assessment gebunden;
- notwendiger Refund: Eskalation an Finance, keine automatische Auszahlung.

`EXPECTED_MARKET_OUTCOME`, `USER_ACTION` und `PROVIDER_PAYMENT_FAILURE`
erzeugen keine pauschale automatische Erstattung. `PAID_SERVICE_RECOVERY=false`
stoppt die Ausführung, lässt Assessments aber sichtbar.

## Roll-forward, Incident und Abschluss

Nach externer Geldwirkung gibt es keinen destruktiven DB-Rollback. Zulässige
Werkzeuge sind Inbox-Replay, Reconciliation, Credit Note, Refund,
Subscription-Recovery und append-only Service-/Ledger-Ereignisse.

Ein Incident-Record enthält mindestens:

- Environment, Build-/Migration-Digest und Correlation IDs;
- Zeitraum, Providerstatus und betroffene Counts ohne PII;
- Kill-Switch-Zustände;
- Inbox-/DLQ-/Reconciliation-/Dunning-/Refund-/Chargeback-Counts;
- Entscheidung, Owner, nächste Prüfung und Roll-forward-Ergebnis.

Schließen erst, wenn jede betroffene Zahlung entweder vollständig `MATCHED`
oder mit Owner und Reason `OPEN|ESCALATED` ist und keine unkontrollierte
Providerwirkung verbleibt.

## Lokale/CI-Verifikation

```text
npm run db:validate
npm run typecheck
npx vitest run --config vitest.config.ts tests/unit/billing/paid-activation-policy.test.ts tests/unit/billing/real-payment-contract.test.ts tests/unit/billing/payment-risk-policy.test.ts tests/unit/billing/service-delivery-policy.test.ts tests/unit/providers/payments/payment-provider-contract.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase24-payment-migration-postgres.test.ts tests/integration/billing/real-payment-postgres.test.ts tests/integration/billing/payment-webhook-postgres.test.ts tests/integration/billing/real-payment-lifecycle-postgres.test.ts tests/integration/billing/reconciliation-postgres.test.ts tests/integration/billing/payment-step-up-postgres.test.ts tests/integration/billing/payment-fraud-postgres.test.ts tests/integration/billing/service-recovery-postgres.test.ts tests/integration/billing/payment-concurrency-postgres.test.ts tests/integration/billing/payment-failure-recovery-postgres.test.ts
```

Provider-, Tax-, Legal-, WTP-, Finance-, Staging- und LIVE-Evidence wird durch
diese lokalen Befehle nicht ersetzt.

# Remediation-Runbookziel Phase 19–32

> **PLAN, nicht ausgeführt.** Dieses Dokument ergänzt die historischen
> Phase-18-Runbooks um den erwarteten Produktionsvertrag. Es ist weder
> technische Evidence noch Provider-/LIVE-Freigabe. Konkrete Providerbefehle
> dürfen erst mit freigegebener Zielumgebung, Secret-/DPA-Vertrag und
> getesteter Recovery eingetragen und ausgeführt werden.

## Zielklassenspezifischer Betriebsmodus

| Klasse | Betriebsgrenze |
| --- | --- |
| LC1 | lokale Mocks, keine echten Personen-/Zahlungsdaten |
| LC2 | benannter Operator für jeden kritischen Schritt, begrenzte Kohorte und manuelle Recovery |
| LC3 | produktive Provider im Scope; Worker oder ausdrücklich begrenzte beaufsichtigte Ausnahme; Trust/Fraud/Support |
| LC4 | autonome Kernprozesse, Public-Trust-/Freshness-/Legal-/Recovery-Gates |
| LC5 | LC4 plus Payment/Finance/Tax/Reconciliation/Service-Recovery |
| LC6 | bestätigte SLO/RPO/RTO/On-call/Capacity/Cost und triggerbasierte Scale-Tracks |

## Deployment-Gate

1. Exakten Commit, Artefakt-Digest, Zielklasse und Statusquartett erfassen.
2. G0–G4 aus dem
   [Ausführungsvertrag](../remediation-execution-contract.md) anwenden.
3. Preview/Staging/Production-DB, Storage, Queue, Providerkonten, Domains und
   Secrets getrennt nachweisen; kein stiller Mock-Fallback.
4. Migration per Expand–Migrate–Contract, begrenztem Backfill,
   Counts/Checksums/Orphans/Lockbudget und vorab getesteter Roll-forward-
   Entscheidung ausführen.
5. Worker/Provider zuerst read-only beziehungsweise shadow, dann begrenzte
   Canaries; Aktivierungsledger schreibt Actor, Environment, Provider,
   Configversion, Scope, Zeitpunkt und Freigaben.
6. Trust-, Payment-, Public-Index- und Bulk-Aktionen bleiben bis zu ihrem
   individuellen Aktivierungsgate fail-closed.

## Worker-/Provider-Betrieb

- Leases besitzen Owner, `leasedUntil`, Heartbeat, maximale Laufzeit und
  sichere Reclaim-Regel.
- Retry ist nach Fehlerklasse begrenzt und jittered; permanente Fehler gehen
  in DLQ. Replay ist capability-/step-up-gebunden, idempotent und auditiert.
- Inbox/Outbox und Provider-Idempotency verhindern doppelte fachliche Wirkung;
  Netzwerk-„exactly once“ wird nicht behauptet.
- Dashboards/Alerts umfassen Queuealter, oldest due, lease expiry, attempt
  rate, success/failure, DLQ, provider latency/error, reconciliation drift,
  Kosten und Backpressure.
- Kill Switch stoppt neue Side Effects, ohne Audit/Inbox/Outbox/
  Reconciliation unlesbar zu machen.

## Kapazität und Support

Vor LC2+ werden pro Flow dokumentiert:

- gleichzeitige Firmen/Stellen/Fälle und Operatoren;
- Ankunftsrate, p50/p95-Zeit, Minuten je manueller Aufgabe und Vollkosten;
- Queue-/Support-SLO, Warn-/Hard-Limit und Eskalationsbudget;
- 30-/90-Tage-Forecast, Owner und Überlastverhalten;
- Abbruch-/Deaktivierungsregel, die keine Kundenversprechen überbucht.

30B/30C werden nur bei dokumentiertem Query-/Queue-/Count-/Byte-/
Forecasttrigger aktiviert. Ein Deferred-Entscheid braucht Istwert, Headroom,
Forecast, Alert, Owner und Reaktionsfrist.

## Incident-Klassen und erste Eindämmung

| Ereignis | Sofortmassnahme |
| --- | --- |
| ATO/Credential Stuffing | riskante Sessions/Tokens widerrufen, Login/Action-Bucket verschärfen, Recovery-Kanal sichern |
| kompromittierte Firma/Scam Job | Company/Jobs/Radar/Contacts pausieren, Badge entziehen, Evidence sichern, Appeal trennen |
| Reveal-/Exportanomalie | betroffenen Read/Export stoppen, Grants/Links widerrufen, Canary-/Audit-Scope prüfen |
| Payment/Webhook-Fraud | Fulfillment stoppen, Event quarantinieren, providerseitig prüfen, Reconciliation statt Hand-Update |
| Worker-Backlog/Providerausfall | Claim stoppen/drosseln, Circuit/Kill Switch, DLQ/Replay kontrollieren, Kunden-SLO kommunizieren |
| Freshness-/Ghost-Job | Job in allen Consumern deaktivieren, Arbeitgeber kontaktieren, Projektionen reconciliieren |
| Privacy-/Cross-Tenant-Verdacht | Zugriff und Verarbeitung minimieren, Evidence unverändert sichern, Privacy/Security Owner eskalieren |

## Recovery und Service-Abhilfe

- Restore wird aus dem echten verschlüsselten Ziel-Lifecycle in eine
  isolierte leere Umgebung geprobt; gemessen werden RPO/RTO und fachliche
  Counts/Checksums.
- Bereits ausgelöste Provider-/Payment-Side-Effects werden reconciliiert oder
  kompensiert, nie aus Audit/Ledger gelöscht.
- Bezahlte Service-Recovery folgt dem versionierten Angebot: Refund,
  Credit-Restoration, Rechnungskorrektur und Kommunikation sind getrennte
  auditierte Vorgänge. Normale Ablehnung, Ablauf oder fehlender
  Markterfolg sind kein Plattformfehler.
- Nach jeder Aktivierung laufen 15-Minuten-/24-Stunden-/7-Tage-Checks für
  Error Rate, Queuealter, Security/Fraud, Reconciliation, Supportlast,
  Kosten und Produkt-KPIs; Schwellen und Owner stehen im Phase-Record.

## Noch vor Ausführung zu konkretisieren

- Hosting-/DB-/Storage-/Queue-/E-Mail-/Payment-Provider und exakte Befehle;
- Secret Rotation, DPA/AVV/Subprozessoren und Datenstandorte;
- Pager/On-call, Eskalationskontakte und Kommunikationskanäle;
- SLO, RPO/RTO, Capacity-/Cost-Schwellen;
- Backup-Retention/Expiry und Legal-Hold-Ausnahme;
- zielklassenspezifische Legal/Privacy/Finance/Tax-Freigaben.

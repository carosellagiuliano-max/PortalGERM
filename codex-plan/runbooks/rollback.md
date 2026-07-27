# Rollback-Runbook

> **Status:** Entscheidungs- und Sicherheitsvertrag. Es existiert derzeit
> kein verbundener Staging-/Production-Deployment-Provider; konkrete
> Provider-Schritte müssen vor dem ersten realen Rollout ergänzt und geprüft
> werden.
> Phase-19+-Provider-, Worker- und Service-Recovery-Ziele stehen im
> [Remediation-Runbookziel](./remediation-production-target.md).
> Der lokale Phase-23-Workervertrag ist ergänzend in
> [worker-operations.md](./worker-operations.md) dokumentiert.

## Grundsätze

- Prisma-Migrationen sind committed und vorwärtsgerichtet.
- `prisma db push`, `prisma migrate reset`, manuelle Schemaänderungen und
  unkontrollierte SQL-Reparaturen sind in Staging/Production verboten.
- Ein App-Rollback ist nur zulässig, wenn der vorherige Commit mit dem bereits
  migrierten Schema kompatibel ist.
- Ein Datenrollback erfolgt nie direkt auf Verdacht. Zuerst wird ein
  verschlüsseltes Backup in einer isolierten leeren Datenbank restauriert und
  geprüft.
- Ledger, Audit, Payment-, Invoice-, Consent- und Domain-Events bleiben
  append-only. Korrekturen verwenden die vorgesehenen kompensierenden
  Use Cases, keine `UPDATE`-/`DELETE`-Handarbeit.
- Keine Recovery-Aktion darf ein unbekanntes oder gemeinsames Ziel ansprechen.

## Entscheidungsmatrix

| Lage | Bevorzugte Reaktion |
| --- | --- |
| App-Regression ohne Daten-/Schemainkompatibilität | vorheriges kompatibles Artefakt deployen |
| additive Migration, alte App bleibt kompatibel | App zurückrollen, Schema stehen lassen, Forward-Fix vorbereiten |
| Migration unvollständig/fehlgeschlagen | Writes stoppen, Status sichern, neue reparierende Migration; kein Reset |
| fehlerhafte Domänendaten mit intakter Historie | autorisierten kompensierenden Use Case ausführen |
| Datenverlust/-korruption | Traffic/Writes stoppen, Backup isoliert restaurieren, Integrität prüfen, kontrollierten Cutover entscheiden |
| vermuteter Cross-Tenant-/Privacy-Vorfall | Incident-Runbook, Zugriff eindämmen, Evidence sichern; kein vorschnelles Restore |
| Worker-/Providerfehler | betroffenen Handler/Provider pausieren, Backlog und append-only Attempts/Receipts erhalten; kein Mockfallback |

## Sofortmassnahmen

1. Release-Commit, Migration, Zeitpunkt, Correlation IDs und sichtbaren Fehler
   erfassen; keine Secrets oder privaten Inhalte kopieren.
2. Neue Deployments und schreibende Maintenance-Befehle stoppen.
   Bei Workerproblemen zuerst neue Claims für den betroffenen Handler stoppen;
   die globale Queue nur bei systemischer DB-/Integrity-Gefahr pausieren.
3. Bei Datenintegritäts- oder Privacy-Risiko Writes am externen Ingress
   sperren. Diese Infrastruktur ist noch nicht Teil des Repositories.
4. `/health/live` und `/health/ready` sowie redigierte strukturierte Logs
   sichern.
5. Incident Owner, DB Owner und gegebenenfalls Security/Privacy/Legal
   einbeziehen. Solange kein Incident Owner benannt ist, ist Production
   blockiert.

## App-Rollback

1. Prüfen, ob der vorherige Commit alle bereits angewandten Spalten,
   Constraints und Statuswerte toleriert.
2. Vorheriges **gebautes und geprüftes** Artefakt auswählen; keinen lokalen
   Dirty-Tree bauen.
3. Deployment-Provider-Rollback nach dessen künftig freigegebenem Runbook
   ausführen.
4. `APP_BUILD_ID`, `/health/live`, `/health/ready`, öffentliche Kernroute und
   Rollen-Smokes prüfen.
5. Ursache und verbleibende Schemarisiken dokumentieren.

Ist die Schema-Kompatibilität nicht eindeutig, wird die App nicht blind
zurückgerollt. Ein Forward-Fix ist dann sicherer.

## Worker-/Provider-Rollback

1. Deployment-Digest, WorkerRun, Handler-/Provider-Version, Fencing-Token und
   minimale Correlation-/Work-Item-IDs sichern.
2. Betroffenen Handler oder Provider über seinen Kill Switch pausieren.
   Work Items, Attempts, DLQ, Receipts und Activation Events nicht löschen.
3. Neue Workerclaims stoppen und laufende Prozesse bounded drainen. Ein alter
   Worker darf nach Leaseverlust keinen Ack/Effect committen.
4. Vorheriges kompatibles Workerartefakt nur starten, wenn es das additive
   Schema und alle aktivierten Payloadversionen versteht. Unbekannte Versionen
   bleiben ungeclaimt.
5. Externe Side Effects über Dedupe/Providerreceipt reconciliieren. Nach
   Zustellung, Erasure oder Zahlung gilt Roll-forward beziehungsweise ein
   kanonischer kompensierender Use Case.
6. Reaktivierung erst nach Chaos-/Provider-Smoke und neuer versionierter
   Activation Evidence.

## Migrationsfehler

```text
npm run env:validate
npm run db:migrate:status
```

- Ausgabe und betroffene Migration redigiert sichern.
- Keine fehlgeschlagene Migration manuell als erfolgreich markieren, solange
  der tatsächliche DB-Zustand nicht durch DB Owner und Review geklärt ist.
- Eine neue additive/reparierende Migration erstellen und zuerst auf einem
  Clone des betroffenen Schemazustands prüfen.
- `prisma migrate resolve` ist nur nach dokumentierter Ursachenanalyse und
  expliziter DB-Owner-Freigabe zulässig.
- Danach Migration, Integritätsprüfungen, Seed-Verifier nur in Demo-
  Umgebungen und Anwendungssmoke erneut ausführen.

## Daten-Recovery

Für Local/CI gilt [backup-restore.md](./backup-restore.md). Die dortigen
Wrapper verweigern Production absichtlich. Ein produktiver Recovery-Runner
muss denselben Stream-/Encryption-/Checksum-/Allowlist-Vertrag besitzen und
vorher separat freigegeben sein.

Reihenfolge:

1. betroffenes System gegen weitere Writes schützen;
2. Backup-Metadaten und SHA-256 auswählen;
3. in eine neue isolierte leere Datenbank restaurieren;
4. Migration, Schema, Manifest/Integrität und gezielte Domänenaggregate
   prüfen;
5. RPO/RTO und Datenverlustfenster bewerten;
6. Cutover oder selektive, fachlich freigegebene Reparatur entscheiden;
7. ursprüngliche Datenbank bis zum Abschluss der Untersuchung unverändert
   aufbewahren.

Ein Restore ist kein Ersatz für die Untersuchung eines Ledger-, Audit- oder
Privacy-Vorfalls.

## Abnahme nach Rollback

- Live/Ready grün und erwarteter `APP_BUILD_ID`;
- keine ausstehende/fehlgeschlagene Migration;
- öffentliche und rollenbezogene Kernrouten erreichbar;
- Tenant-/Ownership-Grenzen unverändert;
- Billing-/Ledger-/Invoice-Aggregate konsistent;
- keine Demo-Daten in Staging/Production;
- Audit-/Incident-Evidence vollständig und redigiert;
- Queue/DLQ/WorkerRuns und Provideractivation konsistent, keine Doppeleffekte;
- Folgefix mit Owner und Termin erfasst.

## Pflicht-Evidence

Der Record nennt Release und Rollback-Commit, Umgebung, Zeitfenster,
Entscheider, Datenbank-/Migrationsidentifier ohne URL, Befehle/Exit-Codes,
Health-/Smoke-Ergebnis, Backup-Referenz und verbleibendes Risiko. Ein
erfolgreicher technischer Rollback hebt Legal-/Privacy-/Tax-, Provider-,
Retention-/RPO-/RTO- oder Incident-Owner-Gates nicht auf.

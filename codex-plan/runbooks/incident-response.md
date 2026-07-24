# Incident-Response-Runbook

> **Status:** kontrollierte MVP-Basis. Das Repository besitzt strukturierte
> redigierte Logs, Audit-Evidenz, Health-Routen und Admin-Systemansichten, aber
> keinen verbundenen Pager, kein externes Monitoring und noch keinen
> benannten Incident Owner. Ohne diese Freigaben besteht keine
> Production-Bereitschaft.

## Schweregrade

| Stufe | Beispiele | Reaktionsziel-Hypothese |
| --- | --- | --- |
| SEV-1 | Cross-Tenant-/Talent-PII-Leak, aktive Credential-Kompromittierung, Datenverlust, falsche Ledger-/Zahlungseffekte in Breite | sofort; Betrieb eindämmen |
| SEV-2 | Auth-Ausfall, DB-Readiness rot, Import-/Queue-Stau, einzelne falsche Billingwirkung ohne bestätigten Leak | binnen 30 Minuten |
| SEV-3 | begrenzter Funktionsfehler oder degradiertes Mock-Subsystem ohne Daten-/Security-Auswirkung | nächster Arbeitsblock |

Diese Zeiten sind bis zur Ops-/Owner-Freigabe keine SLA.

## Rollen

- Incident Commander: Entscheidung, Timeline, Kommunikationsrhythmus;
- Ops/DB Owner: Infrastruktur, Health, Backup/Restore;
- Security/Privacy: Zugriff, Datenumfang, Melde-/Informationsprüfung;
- Product/Domain Owner: fachliche Auswirkungen und sichere Kompensation;
- Legal/Communications: externe Pflichten und betroffene Personen.

Die Personen und Rufbereitschaft sind noch nicht benannt. Dieser offene Punkt
blockiert Production.

## Universeller Erstablauf

1. Zeitpunkt, Umgebung, `APP_BUILD_ID`, Route/Use Case und Correlation IDs
   erfassen.
2. Keine Passwörter, Tokens, DB-URLs, Raw-IP, CV-/Nachrichten-/Case-Inhalte
   oder Reveal-Werte in Chat/Ticket kopieren.
3. Auswirkung begrenzen: Deployment stoppen; bei bestätigtem Risiko Traffic
   oder Writes am externen Ingress sperren; betroffene User/Company über
   kanonische Admin-Use-Cases suspendieren und Sessions widerrufen.
4. `/health/live`, `/health/ready`, `/admin/system` und `/admin/audit`
   kontrollieren. Audit nur über geschlossene Filter/Correlation ID lesen.
5. Incident-Schweregrad, Commander und nächsten Update-Zeitpunkt festhalten.
6. Beweise unverändert sichern. Keine Audit-/Ledger-/Eventhistorie löschen
   und keine Datenbank per Hand „reparieren“.
7. Recovery gemäss [rollback.md](./rollback.md) durchführen.

## Auth-Ausfall oder Credential-Verdacht

**Signale:** erhöhte Loginfehler/Rate Limits, Session-Anomalien,
`/health/ready` grün bei nicht funktionierender Auth, verdächtige
`USER_LOGIN*`-/`SESSION_REVOKED`-Audits.

**Eindämmung:**

- betroffene User über den geprüften Adminpfad suspendieren;
- Sessions über den kanonischen Revoke-/Force-Logout-Befehl widerrufen;
- lokale Mailbox ausser Local deaktiviert halten;
- kompromittierte Key-Version nicht löschen, bevor Rotation und Read-
  Kompatibilität geplant sind.

**Recovery:** Root Cause beheben, Keyring gemäss Writer-first/old-read-only
rotieren, Login/Logout/Reset sowie generische Enumeration-Antworten erneut
prüfen.

## Datenbankausfall oder Datenkorruption

**Signale:** `/health/ready` liefert `503`, Connection-/Statement-Timeouts,
fehlgeschlagene Migration oder inkonsistente Integritätsprüfung.

**Eindämmung:**

- Writes stoppen; keine Retry-Schleife gegen eine überlastete DB starten;
- Datenbank-/Migrationsstatus und Zeitpunkt erfassen;
- bei Korruptionsverdacht Original unverändert halten.

**Recovery:** Infrastruktur wiederherstellen oder verschlüsseltes Backup
zuerst isoliert prüfen. Details stehen in
[backup-restore.md](./backup-restore.md) und [rollback.md](./rollback.md).

## Ledger-/Payment-/Invoice-Anomalie

**Signale:** negativer oder unerklärlicher Saldo, doppeltes Fulfillment,
Order/Invoice/PaymentEvent nicht konsistent, wiederholte Checkout-Konflikte.

**Eindämmung:**

- betroffenen Produkt-/Checkoutpfad sperren;
- keine Ledgerzeile, Invoice oder PaymentEvent ändern/löschen;
- Order, Permit, Grant, Ledger und Audit über IDs/Correlation verknüpfen.

**Recovery:** ausschliesslich idempotente Fulfillment- oder explizite
Reversal-Use-Cases verwenden. Der MVP-Provider ist ein lokaler Mock; es gibt
keine echte Belastung, keinen Stripe-Webhook und keine automatische
Reconciliation.

## Import- oder Content-Vorfall

**Signale:** viele `VALIDATION_FAILED`, Parser-/Payloadfehler, Dubletten,
ungeprüfte Quelle oder verdächtiger Text.

**Eindämmung:**

- Run nicht committen beziehungsweise weitere Decisions stoppen;
- Source-/Lizenz- und Checksum-Evidence sichern;
- keine URL abrufen und keine unbekannte Datei ausführen.

**Recovery:** nur unveränderte Import-Drafts über den kanonischen Rollback
zurücknehmen. Manuell bearbeitete/submitte Jobs und Provenienz bleiben
erhalten; Konflikte werden sichtbar dokumentiert.

## Cross-Tenant-, Talent-Radar- oder Privacy-Verdacht

**Signale:** fremde ID liefert Daten statt safe 404, Candidate-PII vor
application/scoped Reveal, Opaque-ID funktioniert firmenübergreifend,
ungeklärter Privacy-Case-Zugriff.

**Eindämmung:**

- als SEV-1 behandeln und betroffene User/Company/Radar-Zugriffe sperren;
- keine Kandidatenidentität in Incident-Kommunikation kopieren;
- betroffene Request-, Grant-, Mapping-, Membership- und Audit-IDs sichern;
- Legal/Privacy zur Bewertung möglicher Melde-/Informationspflicht
  einschalten.

**Recovery:** Ownership-/Capability-/Trust-Guard korrigieren, Sessions und
gegebenenfalls Grants über kanonische Commands widerrufen, adversarial
Cross-Tenant-/PII-Tests vor Wiederfreigabe ausführen. Bereits gesehene
Identität kann technisch nicht „ungesehen“ gemacht werden.

## Provider- oder Notification-Fehler

Alle externen Provider sind aktuell persistierende Mocks. Fehler werden über
Domainzustand, `EmailLog`, Notification, SystemTask und Audit untersucht.
Ein gesetzter späterer API-Key aktiviert keinen realen Provider. Für reale
Provider sind separate DPA/Security-, Retry/Webhook-, Monitoring- und
Fallback-Runbooks erforderlich.

## Kommunikation und Evidence

Jeder Incident-Record enthält:

- Incident-ID, Schweregrad, Commander, Start/Ende und Update-Timeline;
- Umgebung und Release-Commit;
- betroffene Use Cases und minimale pseudonymisierte Objekt-IDs;
- Correlation IDs, Health-/Audit-Ergebnisse und Entscheidungen;
- Eindämmung, Recovery, Datenverlust-/Privacy-Bewertung;
- Follow-up-Owner und Termin.

Keine Evidence enthält Secrets oder freie private Inhalte. Bei einem
Privacy-Verdacht entscheidet die zuständige Fachstelle über Aufbewahrung,
Meldung und Information; dieses Runbook erteilt keine Rechtsberatung.

## Abschlusskriterien

- Ursache und Umfang sind nachvollziehbar;
- gefährdeter Zugriff oder falscher Effekt ist gestoppt;
- Integrität, Tenant-/PII-Grenzen und relevante Smokes sind grün;
- Audit-/Ledger-Historie blieb erhalten;
- Monitoring-/Testlücke besitzt einen Follow-up-Owner;
- Legal-/Privacy-Entscheid ist dokumentiert, wenn personenbezogene Daten
  betroffen sein könnten.

## Noch offene Go-live-Gates

- benannter Incident Commander/Owner und Stellvertretung;
- On-call/Pager, Alarmrouting und getesteter Kommunikationskanal;
- reale Staging-Übung;
- bestätigte Retention, RPO/RTO und Backup-Owner;
- Legal-/Privacy-/Tax- sowie Real-Provider-Freigaben.

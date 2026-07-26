# Phase 23 — Produktionsbetrieb, Provider-Gates und autonome Worker

> **Status: GEPLANT / NICHT BEGONNEN.** Lokale Runbooks, Health Checks und
> Recovery-Drills existieren; echte Staging-/Production-Infrastruktur,
> autonome Ausführung, Monitoring und On-call sind offen.

## Ziel

Eine reale, beobachtbare und wiederherstellbare Betriebsplattform schaffen,
auf der fällige Domaincommands und Providerzustellungen autonom, idempotent und
operativ beherrschbar laufen.

## Ausgangslage und Problem-IDs

- `STH-008`: echte Environments, Secrets, Ingress, Monitoring, Pager, Incident
  Owner, produktive Backups und freigegebene RPO/RTO fehlen.
- `STH-009`: robuste manuelle Projektoren existieren, kein Scheduler/Worker.
- `STH-004` Lead-Verantwortung: Provider müssen einzeln freigegeben werden.
  E-Mail/Storage/Payment gehören den Phasen 20/21/24; AI, Commute und Job-Room
  dürfen deaktiviert bleiben, solange kein Produktversprechen sie benötigt.

## In Scope

- Preview/Staging/Production mit getrennten Datenbanken, Secrets und Domains.
- IaC, reproduzierbare Deployments, expand/contract Migration, Rollback.
- HTTPS/Ingress/HSTS, Health/Readiness, Logs, Traces, Error Tracking.
- SLOs, Alertregeln, Pager, Incident Owner, Escalation und Drills.
- Verschlüsselte automatische Backups, Retention, Restore und freigegebene
  RPO/RTO.
- Durable Queue/Scheduler mit Lease, Retry, Backoff, DLQ, Replay und Backpressure.
- Handler für Outbox, Alerts, Job/Boost/Credit/Subscription/Invitation-Ablauf,
  Privacy Retention/Erasure und Reconciliation.
- Provider Registry/Health/Mode, Secretrotation und fail-closed Start.
- Konsolidiertes Provider Ledger je Use Case mit Owner-Phase, Modus pro
  Environment, DPA/Region, Secret-Klasse, Health, Contract-/Sandbox-Evidence,
  LIVE-Gate und begründeter Deaktivierung.

## Out of Scope

- Neue parallele Geschäftslogik im Worker.
- Automatisches Fallback von Real auf Mock.
- Aktivierung optionaler AI/Maps/Job-Room-Funktionen ohne Bedarf und Freigabe.
- Multi-region active-active, globale Expansion oder unbewiesene SLOs.

## Rollen und Prozesse

System Worker führt nur registrierte Commands aus. Ops/SRE sieht Queue- und
Providerzustand; Support erhält keine Secret-/Payloadsicht. Security/Privacy/
Finance besitzen getrennte Escalations. Alle Endnutzer sind indirekt betroffen.

## Betroffene Dateien und Module

- neue Worker-/Queue-/Scheduler-Komposition unter `lib/` und `scripts/`
- bestehende Commands in Candidate, Billing, Jobs, Boosts, Invitations,
  Privacy, Analytics und Notifications
- `lib/config/env-schema.ts`, Provider Composition Roots und Health
- `.github/workflows/**`, Deployment-/Rollback-/Recovery-Runbooks
- Admin System/Queue Cockpit, Audit und Observability
- `prisma/schema.prisma`, additive Queue-/Lease-/Attempt-Modelle

## Datenmodelländerungen

Durable Job/Lease/Attempt/DLQ/Replay-Evidence oder klar dokumentierter Managed-
Queue-Vertrag. Fachliche Dedupe-Keys bleiben in den Domains. Queuepayloads sind
versionierte Referenzen, keine vollständigen PII-Snapshots. Provider Health ist
operativ und nie Quelle für Entitlements oder Zahlung.

## Sicherheits- und Datenschutzfolgen

- Workload Identity und Least-Privilege-Secrets pro Prozess.
- Queue-/Log-/Trace-Payloads werden allowlist-basiert redigiert.
- Replay verlangt Capability, Step-up, Reason und Audit. Bis Phase 25 die
  personell getrennten Grants liefert, bleibt Replay ausserhalb isolierter
  Sandbox/Tests fail-closed.
- Backup-/Restore-Secrets liegen außerhalb Repository und Artefakt.
- Production startet nicht bei Mockmodus, fehlender Migration, falscher DB,
  ungültiger Keyring- oder Providerkonfiguration.

## Migrations- und Deploymentstrategie

- [ ] Staging zuerst; kein DNS-/Production-Switch vor grünem Gate.
- [ ] Expand/dual-write/backfill/verify/contract für Schemaänderungen.
- [ ] Worker-Handler vor Scheduleraktivierung idempotent deployen.
- [ ] Queue zunächst pausiert, dann kleine Canaries und kontrollierte Ramp-up.
- [ ] Rollback trennt App-, Worker- und Migration-Rollback.
- [ ] Backup vor riskanter Migration und getesteter Restore danach.

## Implementierungsschritte

- [ ] Hosting/DB/Queue/Secret/Region/Owner-ADR und Threat Model freigeben.
- [ ] IaC und getrennte Environments mit immutable Buildartefakt.
- [ ] Deployment-, Migration-, Rollback- und Feature-Flag-Pipeline.
- [ ] Observability-Standard, SLOs, Alerts, Pager und Incident-Prozess.
- [ ] Queue/Scheduler/Lease/Attempt/DLQ/Replay-Framework.
- [ ] Bestehende Projektoren ohne doppelte Domainlogik als Handler registrieren.
- [ ] Outbox-/Providerhandler aus Phase 20 und Storagejobs aus Phase 21 anbinden.
- [ ] Provider Registry und Health/Degradation-Cockpit implementieren.
- [ ] Provider Ledger für E-Mail, Storage, Payment und jeden übrigen
  Composition Root erstellen; die Freigabe eines Providers darf keinen
  anderen implizit aktivieren.
- [ ] Automatische Backup-/Retention-/Restore-Läufe und RPO/RTO messen.
- [ ] Failure-, Restart-, Deploy-, Poison-Job- und Incident-Drills durchführen.

## Abhängigkeiten

Phase 19; Phasen 20–22 liefern technisch verifizierte, bounded ausführbare
Handler und Adapter-Hooks. Hosting-/DB-/Queue-/Secret-/Pager-Vendor, Budget,
DPA, Domains/TLS und benannte Owner. Phase 25 ist das Aktivierungs-Gate für
privilegierte Cockpit-/Replay-Aktionen ausserhalb Sandbox.

## Risiken und Regressionen

- Doppelverarbeitung und verlorene Lease.
- Poison Job blockiert gesunde Jobs.
- Request und Worker führen denselben Übergang konkurrierend aus.
- Migration/Worker-Versionen sind inkompatibel.
- Backup ist vorhanden, aber nicht restorable.
- Falsch gesetzte Provider-Flags leaken Demo- oder Produktionsdaten.

## Abwärtskompatibilität und Rollback

Bestehende explizite Commands bleiben während Übergang manuell ausführbar.
Scheduler kann pausiert werden, ohne effektive Read-Semantik zu brechen.
Queue-Schema ist additiv; ältere Worker dürfen unbekannte Payloadversionen nicht
claimen. Rollback-Runbook nennt App, Worker, DB und Provider getrennt.

## Akzeptanzkriterien und Tests

### Unit / Integration

- [ ] Lease, Heartbeat, Timeout, Backoff, Max Attempts, DLQ und Replay.
- [ ] Zwei Worker, Crash vor/nach Side Effect, Restart und Deploy.
- [ ] Poison Isolation, Backpressure und Clock-/DST-Grenzen.
- [ ] Jeder Handler beweist fachliche Idempotenz und Audit.
- [ ] Replay-/Cockpit-Denial ohne Capability, bei stale Step-up sowie über
  direkten Command-/Action-Aufruf; Sandbox-Ausnahme ist explizit isoliert.

### Environment / E2E

- [ ] Staging Deploy, Migration, Seed/Fixture Guard und Rollback.
- [ ] Alerts, Outbox, Invitations, Jobs, Boosts, Credits, Subscriptions,
  Privacy und Retention autonom.
- [ ] Provider Timeout/Bounce/429/5xx und Recovery.
- [ ] TLS/Ingress/HSTS, Secret-/Keyrotation und fail-closed Boot.
- [ ] Automatische Backups, getrennte Restores, Integrität und gemessene
  RPO/RTO.
- [ ] Alert Fire → Page → Ack → Escalation und Incident Tabletop.

## Evidence und Definition of Done

- [ ] Kein zeitkritischer freigegebener Prozess hängt nur von manueller Aktion.
- [ ] Staging und Production sind getrennt, reproduzierbar und beobachtbar.
- [ ] Queue/DLQ/Replay und Providerzustände sind operativ beherrschbar.
- [ ] Das Provider Ledger ist vollständig; jeder Use Case ist entweder
  verifiziert aktiviert oder mit eigenem fail-closed Gate begründet
  deaktiviert.
- [ ] Backups laufen automatisch und Restores sind wiederholt belegt.
- [ ] SLO/RPO/RTO und Owner sind ausdrücklich freigegeben.
- [ ] Empty-, Healthy-, Loading-, Paused-, Degraded-, Error-, Retry-, DLQ- und
  Recovery-Zustände sind in Commands, Cockpit und Runbooks eindeutig.
- [ ] Deployment- und Rollback-Drill nutzen dasselbe immutable Artefakt.
- [ ] Optional deaktivierte Provider werden nicht als produktiv behauptet.

## Offene externe Voraussetzungen

Hosting, Datenbank, Queue, Secret Manager, Pager/Error-Tracking, Domains/TLS,
Budget, Verträge/DPA, Incident Owner, On-call und Business-Freigabe von
SLO/RPO/RTO.

## PortalGERM Execution Contract

| Feld | Verbindlicher Vertrag |
|---|---|
| Business Value | Zuverlässiger unbeaufsichtigter Betrieb statt manueller Demo-Commands. |
| Problem-IDs | STH-008, STH-009; Lead für STH-004. |
| Prerequisites | 19; erste Handler aus 20–22; externe Infra/Owner. |
| Deliverables | Environments, IaC, Worker/Queue/DLQ, Observability, Backup/Restore, Incident. |
| Security / Privacy | Workload Identity, redigierte Payloads, fail-closed Provider/Secrets. |
| Tests | Concurrency, crash/restart, staging deploy/rollback, provider failure, restore/pager. |
| Expected Result | Zeitkritische Vorgänge laufen autonom und sind recoverable. |
| Risks / Limits | Kein Real→Mock-Fallback und keine unbewiesene Multi-region-Aussage. |

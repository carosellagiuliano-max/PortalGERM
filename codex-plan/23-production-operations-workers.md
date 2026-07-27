# Phase 23 — Produktionsbetrieb, Provider-Gates und autonome Worker

> **Planstatus:** TECHNISCH ABGESCHLOSSEN
> **Technikstatus:** `PASS` — Local-/CI-Vertrag auf Candidate `d16a2d9`
> commitgebunden verifiziert
> **Quality-Gate:** lokales G3 `PASS`; reales Staging-/Aktivierungs-G4
> verbindlich an Phase 32 übergeben
> **Aktivierung:** DISABLED / BLOCKED BY EXTERNAL GATE
> **Evidence:** [2026-07-27-phase-23.md](./evidence/2026-07-27-phase-23.md)
>
> Queue-/Lease-/Retry-/DLQ-/Replay-Runtime, Scheduler, Handler-/Provider-
> Ledger, read-only Ops-Cockpit, Capacity-/Chaos-Tests und fail-closed
> Evidence-Validatoren existieren im Phase-23-Worktree. Runtime und Provider
> bleiben standardmässig pausiert. Reale Staging-/Production-Infrastruktur,
> Pager/On-call, automatische Backupquelle, genehmigte SLO/RPO/RTO und reale
> Provider-Sandbox-Evidence fehlen weiterhin und blockieren jede reale
> Aktivierung, nicht mehr den lokalen Technikabschluss.
>
> **Sequenzentscheid vom 27. Juli 2026:** Staging wird auf ausdrückliche
> Product-Owner-Vorgabe erst am Ende eingerichtet. Die realen Anteile von
> `23-AC-05` bis `23-AC-09` und `23-AC-12` werden nicht erlassen, sondern als
> zwingendes Phase-32-/G4-Aktivierungsgate weitergeführt.

## 1. Status in vier Dimensionen

IaC, Worker Runtime und Provider Ledger können technisch abgeschlossen und in
Staging qualitätsgeprüft sein, während Production wegen Verträgen, Budget,
On-call, Capacity oder Business-SLO weiterhin `BLOCKED BY EXTERNAL GATE`
bleibt. Jeder Provider und jede Worker-Capability besitzt eine eigene
Aktivierung `DISABLED|SANDBOX|ALLOWLIST|LIVE`; ein globales „Production =
alles real“ ist verboten.

## 2. Ziel und messbarer Business-/Nutzerwert

Alle für eine freigegebene Launchklasse zeitkritischen Domaincommands laufen
autonom, idempotent, beobachtbar und wiederherstellbar. Provider können nur
über ein versioniertes, geprüftes Ledger aktiviert werden. Ops kennt
Arrival Rate, Backlog, nachhaltigen Durchsatz, Unit Cost, manuelle
Bearbeitungszeit und Aufnahmegrenzen.

Messbarer Zielzustand:

- 0 verlorene Work Items und genau eine fachliche Wirkung je Dedupe-Key bei
  Crash, Restart, Lease-Takeover und Duplicate Delivery;
- 100 % registrierter LIVE-Use-Cases besitzen Owner, Runbook, Alert,
  Provider-/Worker-Activation und getesteten Kill Switch;
- Poison Jobs blockieren 0 gesunde Jobs und erreichen nach bounded Attempts
  eine sichtbare DLQ;
- nachhaltige Kapazität deckt freigegebene p95 Arrival Rate plus mindestens
  50 % Headroom; andernfalls greift Backpressure/Aufnahme-Stopp;
- Backup und Restore liegen innerhalb schriftlich genehmigter RPO/RTO. Die
  heutigen ≤24 h/≤8 h sind nur unbestätigte Hypothesen.

## 3. Tatsächlicher Repositoryzustand

- `prisma/migrations/20260727230000_phase_23_worker_operations/migration.sql`
  liefert additive Work Items, Attempts, DLQ, Effect Receipts, Worker Runs,
  Handler-/Provider-Activation Events und Capacity Samples mit Constraints,
  Claim-Indizes und append-only Guards.
- `lib/ops/worker-runtime.ts`, `worker-service.ts`, `worker-scheduler.ts`,
  `worker-retry-policy.ts` und `work-replay.ts` implementieren PostgreSQL-
  Claim/Lease/Heartbeat/Fencing, bounded Retry, DLQ, Effect-Dedupe,
  Sandbox-Replay und registrierte bestehende Domaincommands.
- `scripts/phase23-worker.ts` ist ein One-shot-/autonomer Prozess mit
  Graceful Drain. `WORKER_RUNTIME=paused` ist Default; `sandbox_command`
  bleibt Local/CI-only und `autonomous` benötigt das exakte persistierte
  Activation Ledger.
- `lib/ops/provider-activation-policy.ts` und
  `operations-ledger.ts` lösen Provider strikt nach Environment, Use Case,
  Adapter/Version, Evidence, DPA/Vertrag, Secret-Version, Region, Health,
  Kapazität und Kill Switch auf. Es gibt kein Mockfallback.
- `/admin/system` zeigt redigierte Queue-/DLQ-/Worker-/Activation-/
  Capacity-Zustände read-only. Production-Mutationen bleiben bis Phase 25
  absent.
- Die isolierten PostgreSQL-, Chaos-, 10’000-Item-/4-Worker-, Desktop- und
  360-px-Tests sowie das lokale Clean-Clone-Gate bestehen commitgebunden auf
  `d16a2d9`. Das formale Gesamt-G3 bleibt wegen der realen externen
  Pflichtgates offen.
- `scripts/phase23-staging-deploy-smoke.ts`,
  `phase23-incident-drill.ts` und `phase23-backup-restore-drill.ts` validieren
  ausschliesslich absolute, externe, SHA-256-gebundene reale Evidence und
  bleiben ohne Staging/Pager/Restore korrekt blockiert.
- `.github/workflows/ci.yml` deployt weiterhin keine reale Staging-/
  Production-Infrastruktur. Pager/On-call, automatischer Backup-Lifecycle,
  genehmigte SLO/RPO/RTO und namentliche externe Owner sind nicht bewiesen.

## 4. Findings und Requirements

| Finding / Requirement | Verantwortung dieser Phase | Launchpriorität |
| --- | --- | --- |
| `STH-008`, `REQ-OPS-001/002/003` | Environments, Deploy/Migration/Rollback, Observability, Backup/Restore, Incident | LC1 P3; LC2–LC6 P0 |
| `STH-009`, `REQ-OPS-005` | autonome Queue/Scheduler/Worker Runtime | LC1 P3; LC2 P1; LC3–LC6 P0 |
| Lead `STH-004`, `REQ-INT-002` | Provider Activation Ledger; fachliche Adapter bleiben owning Phases 20/21/24/26/30 | je aktiviertem Provider P0 |
| autonomer Anteil `STH-013`, `REQ-NOT-001` | Outboxbetrieb, Retry, DLQ, Monitoring | LC2–LC6 P0 |
| Beitrag `STH-031`, `REQ-TRUST-001` | Incident-/Risk-Job-Eskalation, Revocation und Failure Drill | LC2–LC6 P0 |
| Workeranteil `STH-032`, `REQ-JOB-007` | spätere Freshness-/Reminder-Commands betreibbar; Fachpolicy bleibt 30D | LC4–LC6 P0 bei Aktivierung |
| Telemetriebeitrag `STH-034`, `REQ-OPS-004` | Arrival/Backlog/Handling Time/Capacity/Unit Cost; Staffing-Entscheid bleibt 31A | LC2–LC6 P0 |
| optionaler Anteil `STH-035`, `REQ-BIL-010` | Service-Recovery-Worker erst nach Phase-24-/31-Go | LC5/6 P0, sonst P4/disabled |
| `REQ-QA-003` | 28-Punkte-/AC→Test-Vertrag | alle P0 |

## 5. In Scope

- getrennte Preview-/Staging-/Production-Environments, Datenbanken, Domains,
  Secrets, Workload Identities und immutable Buildartefakte;
- IaC, Migration-, Deploy-, Rollback-, Roll-forward- und Secretrotation;
- `/health/live`/`ready`, strukturierte Logs, Metriken, Traces, Error Tracking,
  SLOs, Alerts, Pager, Incident Owner und Übungen;
- verschlüsselte automatische Backups, Lifecycle, isolierter Restore und
  genehmigte RPO/RTO;
- PostgreSQL-backed Work Items, Claims/Leases, Heartbeats, Attempts,
  Retryklassen/Backoff, DLQ, Replay, Shutdown und Backpressure;
- autonome Ausführung vorhandener sowie Phase-20–22-Commands ohne doppelte
  Domainlogik;
- versioniertes Provider Activation Ledger pro Environment und Use Case;
- Capacity-/Cost-Telemetrie für automatische und manuelle Queues;
- Worker-/Provider-/Queue-Cockpit mit Need-to-know und fail-closed Replay.

## 6. Out of Scope und deaktivierte Nachbarfunktionen

- neue Fachentscheidungen im Worker oder Umgehung der Domainservices;
- automatisches Real→Mock-Fallback;
- Aktivierung von AI, Maps/Commute, Job-Room, Payment, Imports oder anderen
  optionalen Providern ohne owning Requirement/Phase und Produktbedarf;
- Multi-region active-active oder unbelegte „unbegrenzte“ Skalierung;
- Staffing-/Preis-/WTP-Entscheid: Phase 31A;
- Payment-/Service-Recovery ohne Phase 24/31;
- Job-Freshness-Regeln ohne Phase 30D;
- freies Production-Replay vor Phase-25-Capability/Step-up.

Unfreigegebene Provider/Handler bleiben registriert `DISABLED` oder vollständig
absent; UI/API/Worker/Marketing dürfen sie nicht implizit anbieten.

## 7. Benutzerrollen und organisatorische Owner

| Rolle | Verantwortung | Owner |
| --- | --- | --- |
| Worker Identity | nur registrierte Handler/Queue/Secrets | Platform Engineering |
| Ops/SRE | Deploy, Queue, Provider Health, Backup, Incident | benannter Ops Owner |
| Security | Workload Identity, Secrets, Redaction, Security Incident | Security |
| Privacy | Privacy-Worker/Retention/Hold-Eskalation | Privacy |
| Finance | Payment-/Reconciliation-/Paid-Recovery-Worker, falls aktiviert | Finance |
| Support/Trust | begrenzte Case-/Queue-Sicht, kein Secret/Payloadinhalt | Support/Trust |
| Product/Commercial | Cohort, Servicelevel, Capacity-/Aufnahmeentscheid | Product/Commercial |

On-call besitzt namentliche Primär-/Sekundärvertretung und Eskalationsfristen;
„Engineering allgemein“ ist kein ausreichender Owner.

## 8. Portale, Routen, Services, Provider und Worker

Bestehend sind `/admin/system`, lokale Health-/Ops-Skripte und Domaincommands.
Geplantes Route-/Prozessdelta:

- `/health/live` und `/health/ready` mit strikt begrenzter Ausgabe;
- capability-getrennte Worker-/DLQ-/Provider-/Capacity-Ansichten unter
  `/admin/system` oder einem konsolidierten Opsbereich;
- keine Public Controls und kein Production-`/dev/mailbox`.

Initiale Handlerfamilien:

- Phase 20: Notification Outbox, Verify-/Suppression-Cleanup;
- Candidate: Job Alert Digests;
- Jobs/Billing: Expiry/Projection für Job, Boost, Credit, Subscription und
  Invitation;
- Radar: Contact Expiry/Cooldown;
- Phase 21: Scan und Object Reconciliation;
- Phase 22: Export/Correction/Erasure/Retention/Analytics Cleanup;
- später nur nach eigenem Gate: Payment/Reconciliation, Trust/Freshness,
  Service Recovery und Search-Projektionen.

## 9. Datenmodelle, Constraints, Indizes und Klassifikation

ADR-034 wird vor Migration konkretisiert. Mindestens:

- `WorkItem`: handler key/version, subject reference, fachlicher Dedupe-Key,
  priority, `availableAt`, status, attempt limit und minimale Payloadreferenz;
- `WorkLease`/Claimfelder: worker identity, claim/expiry/heartbeat,
  fencing token;
- append-only `WorkAttempt` und terminales `DeadLetter`;
- `WorkerRun`/Deployment Digest/Shutdown Outcome;
- `ProviderActivation`: environment, use case, adapter/version, mode,
  secret/KMS version reference, region, DPA/contract, sandbox/LIVE approval,
  health, quota/capacity, unit-cost source, owner, runbook, kill switch,
  evidence digest, effective/expiry/revoked;
- `OperationalCapacitySample`: queue, arrival/completion/backlog age,
  worker/provider units, bounded handling minutes und cost source;
- Incident-/Replay-Auditreferenzen ohne Payloadkopie.

Queuepayloads enthalten typisierte IDs/Versionen, keine freien PII-Snapshots.
Unique Dedupe, claimable- und due-Indizes sowie Checkconstraints verhindern
unbounded/ungültige States. Provider Health ist keine fachliche Autorität für
Entitlement, Zahlung oder Trust.

## 10. Expand–Migrate–Contract, Backfill und Kompatibilität

1. additive Queue-/Ledger-/Attempt-/Capacity-Modelle auf leerer und
   realistischer Bestandsdatenbank;
2. Handler registry wird vor Scheduler deployed; unbekannte Payloadversion
   wird nicht geclaimt;
3. bestehende manuelle Commands erzeugen zunächst dual-observe Work Items,
   ohne Doppelwirkung;
4. Backfill fälliger Arbeit nutzt fachliche Dedupe-Keys und logische Uhr;
5. Worker startet `PAUSED`, dann ein Handler/eine Cohort als Canary;
6. App- und Worker-Versionen unterstützen ein dokumentiertes
   Kompatibilitätsfenster; Contract erst nach Drain/Golden;
7. unterbrochener Backfill, paralleler alter/neuer Producer, Count-/Due-/
   Orphan-/Duplicate-/Tenantabgleich werden getestet;
8. keine Migration im Requestpfad; Backup vor riskantem Cutover.

## 11. Serverlogik, Queue, Lease, Heartbeat, Retry und DLQ

- Claim erfolgt atomar mit `SKIP LOCKED`/gleichwertigem PostgreSQL-Vertrag,
  Lease und monotonem Fencing Token.
- Heartbeat verlängert nur die aktuelle Lease. Ein alter Worker darf nach
  Leaseverlust keinen Effect committen.
- Handler ruft den owning Domaincommand mit Dedupe-/Effect-Key auf; Worker
  implementiert keine parallele Businesslogik.
- Retryklassifikation: transient Timeout/429/5xx mit jittered Backoff,
  permanent Validation/4xx direkt terminal, unbekannt bounded und alarmiert.
- Nach konfiguriertem Max Attempt wird genau ein DLQ-Outcome geschrieben.
  Poison Isolation verhindert Head-of-line Blocking.
- Crash vor Side Effect, nach Side Effect vor Ack, während Heartbeat, beim
  Deploy und während Providerannahme besitzt eigene Tests.
- Replay erzeugt neues auditiertes Attempt gegen dasselbe fachliche
  Dedupe-/Effect-Key, keine neue Businesswirkung.
- Graceful Shutdown stoppt Claims, beendet/verlängert bounded Arbeit oder
  lässt Lease kontrolliert auslaufen.
- Backpressure berücksichtigt DB-Pool, Providerquota, Error Rate, oldest age,
  Memory/CPU und Downstream Health; Aufnahme/Dispatch wird pro Handler
  gedrosselt oder pausiert, nicht global blind.

## 12. UI-/Ops-Zustandsvertrag

Health, Queue, Provider, DLQ, Capacity und Runbook zeigen Empty, Healthy,
Loading, Paused, Canary, Backpressured, Degraded, Rate-limited, Retry,
Lease-lost, Poison/DLQ, Partial, Alerting, Recovery, Draining und Success.
Cockpit nennt Handler/Version, redigierten Grund, oldest age, Attempt,
Owner/Runbook und erlaubte Action. Es rendert keine freien Payloads, Secrets
oder personenbezogenen Inhalte.

## 13. 360 px, Touch, Keyboard, Screenreader und Accessibility

Kritische Ops-Actions funktionieren auf 360×800 und Desktop als responsive
Listen statt unbedienbarer Breitabelle. Queue-/Providerstatus nutzt Text,
Icon und Farbe; Liveupdates sind gedrosselt und screenreadergeeignet.
Keyboard-Fokus, Confirm/Reason, Pause/Resume und Fehlerzustände sind vollständig.
0 `critical`/`serious` Axe, 0 Clipping. Mobile ist Incident-Triage, kein
Versprechen vollständiger Infrastrukturadministration.

## 14. Authentisierung, Step-up, Autorisierung und Tenantgrenzen

Workload Identity besitzt pro Prozess/Provider Least-Privilege-Secrets.
Menschliche Queue-, Provider-, Backup-, DLQ- und Replay-Rechte sind getrennte
Capabilities; Support sieht nur zugewiesene/need-to-know Metadaten.
Pause/Resume, Provideraktivierung, Secretrotation, Restore und Replay verlangen
frischen actor-/session-/action-/resourcegebundenen Step-up sowie bei
hochkritischen Aktionen Dual Approval.

Bis Phase 25 diese Grants liefert, bleiben mutierende Production-Ops-Actions
ausserhalb Sandbox/CLI-Runbook fail-closed. Direct Command/Server Action wird
gleich geprüft wie UI. Queuepayload/Tenantreferenz wird erst nach Capability
gelesen.

## 15. Datenschutz, Zweck, Retention, Export, Löschung und Audit

Logs/Traces/Queuepayloads besitzen eine geschlossene Redaction-/Attribut-
Allowlist; keine Tokens, E-Mails, CVs, Messages, Signed URLs, Paymentpayloads
oder freie Errorbodys. Work Items/Attempts/DLQ/Capacity haben purpose-
spezifische Retention und Phase-22-Processor-Outcomes. Handling-Time-Metrik
misst Prozesskapazität, nicht heimliche Mitarbeiterleistung; nur aggregierte,
zweckgebundene Werte werden berichtet. Backup-, Log- und Provider-Retention
stehen im Data Inventory.

## 16. Abuse-, Fraud-, ATO-, Enumeration-, Replay- und Insider-Szenarien

- Queue-Flood, manipulierte Handler-/Payloadversion, Poison Job,
  Retry-Storm, DLQ-Flood und Replay-Schleife;
- Worker Credential Theft, stale Lease/Fencing, Secret-/Key-Rotation-Race,
  Provider-Callback/Duplicate Delivery;
- Insider aktiviert Provider ohne DPA/Approval, liest Payload oder restored
  Production in falsche DB;
- kompromittierte Firma, Massennachricht, Reveal-/Export-Anomalie oder
  Job-/Payment-Fraud erzeugt priorisierte, idempotente Incident-/Revocation-
  Arbeit; fachliche Risk Decision bleibt owning Phase 25/26/30/24;
- Telemetry Poisoning versucht Capacity/Aufnahmeentscheid zu manipulieren.

False-positive/Appeal-Evidence wird nicht im Worker entschieden, aber
Eskalation und reversible Pause müssen vollständig auditiert sein.

## 17. Externe und organisatorische Voraussetzungen

Hosting, PostgreSQL/Queue, Object/Backup Storage, Secret Manager/KMS,
Observability/Error Tracking/Pager, Domains/TLS, Datenregion, AVV/DPA,
Providerverträge, Budget, Security/Privacy/Finance-Freigaben, namentliche
On-call-Primär-/Sekundärbesetzung, genehmigte SLO/RPO/RTO,
Staffing-/Vertretung und Aufnahme-Stopp-Owner. Jede Voraussetzung besitzt im
Activation Ledger Ablauf/Review und Evidence-Digest.

## 18. Harte Abhängigkeiten

- Phase 19 grünes Baseline-/Release-Gate und ADR-034;
- Phasen 20–22 liefern versionierte, bounded und idempotent getestete Handler;
- Phase 25 für Production-Cockpit/Replay/Provideraktivierung mit Step-up;
- Phase 24/26/30 liefern weitere Fachhandler erst nach eigenem Gate;
- Phase 31A genehmigt Staffing, Servicelevel und Unit-Cost-Grenzen;
- Phase 32 verlangt den finalen G4-Drill auf dem deployten Artefakt.

Workergrundlage darf vor allen Fachhandlern gebaut werden; sie aktiviert
keinen Handler ohne dessen owning G1/G3.

## 19. Geordnete Implementierungsschritte

1. Infrastruktur-/Queue-/Provider-/SLO-/Threat-ADR und Owner festlegen.
2. Provider-/Handlerinventar und Activation-Ledger-Schema migrieren.
3. Queue/Claim/Lease/Fencing/Heartbeat/Attempt/DLQ ohne Fachhandler.
4. Workerprozess, graceful shutdown, Deployment Digest und Health.
5. Retry/Backoff/Backpressure, redigierte Observability und Alerts.
6. bestehende idempotente Domaincommands einzeln registrieren.
7. Phase-20-Outbox, Phase-21-Scan/Reconcile und Phase-22-Processor anbinden.
8. getrennte Environments/IaC/Deploy/Migration/Rollback.
9. automatische verschlüsselte Backups und isolierte Restores.
10. Capacity-/Handling-Time-/Unit-Cost-Telemetrie und Aufnahme-Policy.
11. Ops-Cockpit/Runbooks; Mutation bis Phase 25 gesperrt.
12. Chaos-, Capacity-, Provider-, Deploy-, Pager-, Restore- und G3-Drills.
13. canaryweise Aktivierung je Handler/Provider, danach dokumentierter Go.

## 20. Feature-/Provider-/Cohort-Flags und Aktivierungsreihenfolge

Hierarchie: Build Digest → Environment → Worker Runtime → Handler/version →
Provider/use case → Legal/Product → Cohort → Runtime Health. Jedes Gate ist
persistiert/auditiert. `NODE_ENV` allein aktiviert nichts.

Reihenfolge: Staging IaC → Queue paused → no-op/diagnostic handler → einzelne
Domainhandler → Sandboxprovider → Cohort Canary → Allowlist → LIVE.
Kill Switches pausieren Claims, einzelnen Handler, Provider oder Cohort.
Backlog bleibt durable. Production fällt nie auf Mock zurück; ein
erforderlicher Provider ohne gültiges Ledger lässt den Use Case fail-closed
und alarmiert.

## 21. Akzeptanzkriterien und vollständige AC→Test-Matrix

Die geplanten Dateien/Skripte sind Phase-23-Deliverables. Der lokale
Technikabschluss und das spätere externe G4 werden getrennt ausgewiesen. Das
lokale `PASS` erlaubt Folgephasen nur mit deaktivierten Realprovidern; es
ersetzt keine Staging-/Pager-/Provider-/Restore-Evidence für eine Aktivierung.

| Criterion | Requirement | Risiko | Testart | Testfall | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung | Exakter Befehl/manueller Ablauf | Messbare Erwartung | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `23-AC-01` | `STH-009`, `REQ-OPS-005` | Doppelclaim/verlorene Lease, P0 | Unit + PostgreSQL Concurrency | zwei/vier Worker claimen, heartbeat, lease expiry, fencing | jedes Item genau einmal gleichzeitig geclaimt; gültiger Heartbeat verlängert | stale heartbeat/fencing und 100 parallele Claims bewirken 0 Doppelcommit | System Worker | Queue/PostgreSQL | 10.000 Items, Fake Clock, vier Worker | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.config.ts tests/unit/ops/worker-lease-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/ops/worker-runtime-postgres.test.ts` | 0 gleichzeitige gültige Doppelclaims; stale Worker 0 Effects; 100 % Items terminal oder retryable | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Platform + Data | LOCAL/CI PASS |
| `23-AC-02` | `REQ-OPS-005`, `REQ-NOT-001` | Crash erzeugt Verlust/Doppelwirkung, P0 | Chaos + PostgreSQL | Crash vor Effect, nach Effect vor Ack, während heartbeat/restart/deploy | nächster Worker übernimmt und Domain-Dedupe schützt Effect | Kill -9 an jeder Grenze, duplicate provider receipt und alte Worker-Version verursachen keine zweite Wirkung | System Worker | Worker/Domain/Provider | repräsentativer Outbox-, Alert-, Expiry- und Privacy-Handler | isoliertes PostgreSQL + Workerprozesse | `npx vitest run --config vitest.integration.config.ts tests/integration/ops/worker-effect-idempotency-postgres.test.ts`; `npx tsx scripts/phase23-worker-chaos.ts --scenario=before-effect,after-effect-before-ack,heartbeat-loss,restart,rolling-deploy` | 0 verlorene Items; je fachlichem Key genau 1 Effect; Recovery innerhalb Testlease+Backoff | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Platform + Domain Owner | LOCAL/CI PASS |
| `23-AC-03` | `STH-009`, `REQ-OPS-005`, Beitrag `STH-031` | Retry-Storm/Poison/Insider-Replay, P0 | Unit + PostgreSQL Security | timeout/429/5xx, permanent 4xx, unknown, max attempts, DLQ, Replay | transient retryt mit Backoff; autorisiertes Replay nutzt gleichen Effect-Key | Poison blockiert keine gesunden Jobs; unauthorisiert/stale/cross-resource Replay 0 Claims/Reads | System/Ops | Retry/DLQ/Cockpit | Failurematrix, zwei Capabilities, stale Step-up | Unit + isoliertes PostgreSQL | `npx vitest run --config vitest.config.ts tests/unit/ops/worker-retry-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/ops/worker-dlq-replay-postgres.test.ts` | Max Attempts exakt; 100 gesunde Jobs trotz Poison abgeschlossen; 1 DLQ; Denials vor Payloadread; Replay 1 auditierter Attempt/0 Doppeleffect | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Platform + Security | LOCAL/CI PASS; PRODUCTION REPLAY DISABLED |
| `23-AC-04` | `STH-009`, `REQ-OPS-005`, Worker `REQ-JOB-007` | fällige Prozesse bleiben manuell/Zeitrace, P0 | PostgreSQL Contract | Outbox, Alert, Invitation, Job/Boost/Credit/Subscription/Contact, Scan/Privacy je vor/an/nach Grenze | jeder aktivierte Handler läuft autonom genau an fachlicher Grenze | disabled/unfreigegebener Handler, DST-Doppelstunde, restart und Request/Worker-Race erzeugen 0 falsche Transition | System | Scheduler/Domaincommands | logische Zurich-Uhr und alle Statusgrenzen | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/ops/scheduled-domain-handlers-postgres.test.ts` | 100 % Registryhandler haben Owner/Test/SLO; je Due-Key 1 Transition; disabled 0; DST ohne Doppelwirkung | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Platform + alle Domain Owner | LOCAL/CI PASS; OWNING-PHASE HANDLER DISABLED |
| `23-AC-05` | `STH-004`, `REQ-INT-002`, ADR-034 | impliziter/falscher Realprovider, P0 | Unit + PostgreSQL + Sandbox | Activation Ledger completeness, expiry/revoke, config/secret/evidence digest und unabhängige Use Cases | exakt freigegebener Sandboxprovider startet für einen Use Case | fehlende DPA/region/secret/runbook/evidence, expired/revoked entry oder anderer Provider bleibt disabled; kein Mockfallback | Ops/System | Provider Registry/Boot | alle Composition Roots, good/bad ledger rows | isoliertes PostgreSQL + Provider Sandbox | `npx vitest run --config vitest.config.ts tests/unit/ops/provider-activation-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/ops/provider-activation-postgres.test.ts`; `npx tsx scripts/phase23-provider-activation-smoke.ts --environment=staging --mode=sandbox --all-registered` | 100 % Use Cases genau ein Ledgeroutcome; unvollständig Exit ≠0; Aktivierung eines Providers ändert 0 andere; 0 Secrets | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Ops + Security + Fachowner | LEDGER LOCAL PASS; REAL SANDBOX DEFERRED TO G4 |
| `23-AC-06` | `STH-034`, `REQ-OPS-004/005` | unbekannte Kapazität/COGS/Backlog, P0 LC2+ | Load + PostgreSQL | Arrival, Durchsatz, Backlog, oldest age, Providerquota, Handling minutes, Unit Cost und Backpressure | nachhaltiger Durchsatz ≥1,5× p95 Arrival, Utilization ≤70 % | 80/90-%-Schwellen drosseln/stoppen; Provider-/DB-Degradation führt nicht zu OOM/Retry-Storm | Ops/Commercial/System | Worker/Capacity Ledger | LC2/LC3-Profile, 10.000 Items, Kostenfixtures | isolierte Lastumgebung + Staging | `npx vitest run --config vitest.config.ts tests/unit/ops/capacity-backpressure-policy.test.ts`; `npx vitest run --config vitest.integration.config.ts tests/integration/ops/operational-capacity-postgres.test.ts`; `npx tsx scripts/phase23-capacity-benchmark.ts --profile=lc3 --items=10000 --workers=4` | ≥1,5× Headroom; 0 Loss/OOM; Warnung ≥80 %, Intake/Dispatch-Pause ≥90 %; Unit Cost/Item und p50/p95 Handling Time vorhanden | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Ops + Commercial + Finance | FIXTURE LOAD PASS; REAL ARRIVAL/COST DEFERRED TO G4 |
| `23-AC-07` | `STH-008`, `REQ-OPS-001` | Environment-/Artefakt-/Migrationsdrift, P0 | Staging Deploy/E2E | immutable Build → migrate → app/worker deploy → canary → rollback | Stagingdigest entspricht Testdigest, Readiness grün | falsche DB, pending migration, Demo seed, inkompatibler Worker, bad secret booten 0 Traffic/Claims | Ops/System | CI/IaC/Staging | leere + Upgrade-DB, bad configs; `TESTED_ARTIFACT_DIGEST` aus signiertem Buildmanifest | echte Stagingumgebung | `npx tsx scripts/phase23-staging-deploy-smoke.ts --environment=staging --artifact-digest=$env:TESTED_ARTIFACT_DIGEST --scenario=deploy,migrate,canary,rollback`; `npm run env:validate`; `npm run db:migrate:status` | Digest exakt; bad scenarios fail-closed; Rollback innerhalb genehmigtem Budget; keine Production-/Demo-Daten | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Ops + Release QA | DEFERRED TO PHASE 32/G4 — REAL STAGING |
| `23-AC-08` | `STH-008`, `REQ-OPS-002`, Beitrag `STH-031` | unsichtbarer Ausfall/kein Owner, P0 | Observability + Incident Drill | Queue age/DLQ/error/provider/backup Alarm → Page → Ack → Escalate → Recover | richtige Primärperson bestätigt und führt Runbook aus | Pager unavailable, keine Ack, PII canary in log, Alertflap oder unowned service blockiert | Ops/Security/Privacy | Metrics/Logs/Pager/Runbook | synthetische Correlation IDs und PII Canaries | Staging + Pager Sandbox | `npx tsx scripts/phase23-incident-drill.ts --environment=staging --scenario=queue-age,dlq,provider-outage,backup-failure,pii-canary`; manueller Ack-/Eskalationsablauf aus `codex-plan/runbooks/incident-response.md` | Alert innerhalb 2 Messintervalle; Ack/Eskalation innerhalb freigegebener Frist; 0 PII/Secrets; Owner/Runbook 100 % | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Ops + Security | DEFERRED TO PHASE 32/G4 — PAGER/ON-CALL |
| `23-AC-09` | `STH-008`, `REQ-OPS-003` | Backup nicht restorable/RPO-RTO unbewiesen, P0 | Recovery | automatische verschlüsselte Backups, Retention, isolierter Restore, App/Worker-Smoke | neueste erlaubte Sicherung restauriert vollständig | corrupt checksum, falsche identity, gleiche/source DB, abgelaufene Retention und fehlende Approval blockieren | Ops/System | Backup Store/PostgreSQL | Source-, Backup-, leere Restore-DB, Corrupt Canary; getrennte IDs in `PHASE23_SOURCE_DB_ID`/`PHASE23_RESTORE_DB_ID` | Staging + isolierter Restore | `npm run test:release`; `npx tsx scripts/phase23-backup-restore-drill.ts --environment=staging --source=$env:PHASE23_SOURCE_DB_ID --restore=$env:PHASE23_RESTORE_DB_ID` | Checksum/Counts/Schema gleich; DBs verschieden; RPO/RTO gemessen und ≤ schriftlich genehmigter Werte; ohne Approval kein LIVE-Pass | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Ops + Business Owner | LOCAL RESTORE PASS; REAL LIFECYCLE DEFERRED TO G4 |
| `23-AC-10` | `REQ-SEC-002/003`, `REQ-QA-002` | Ops-IDOR/Secretleak/unbedienbares Incident UI, P0 | Security + E2E + A11y | Health/Queue/Provider/DLQ/Capacity read/action matrix | berechtigter Actor sieht redigierten Zustand und erlaubte Sandboxaction | Public/Support/falsche Capability, direct action, stale step-up und payload/secret canary lesen/wirken 0 | Public/Support/Ops | Health/Admin System | Rollenmatrix, Secret-/PII-Canaries | PostgreSQL + Production Browser Desktop/360 | `npx vitest run --config vitest.integration.config.ts tests/integration/ops/ops-authorization-postgres.test.ts`; `npx playwright test --config=playwright.config.ts tests/e2e/flows/phase23-ops-control.spec.ts --project=chromium-journeys`; `npx playwright test --config=playwright.config.ts tests/e2e/quality/phase23-ops-quality.spec.ts --project=chromium-mobile-360` | Public health allowlist exakt; 0 Canary leak; Denial vor payloadread; 0 critical/serious Axe/Clipping | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Security + UX + Ops | LOCAL/CI PASS |
| `23-AC-11` | ADR-034, `REQ-QA-003` | Queue-Migration verliert/dupliziert Arbeit, P0 | Migration/PostgreSQL | leer, Bestands-Due-Items, Partial Backfill, Parallelproducer, Wiederholung, alte Worker | jedes fällige Fachobjekt genau ein Work Item, kompatibles Drain | unknown version nicht geclaimt; Duplicate/Orphan/Lockbudget-Verletzung blockiert Cutover | System/Data | Prisma/Queue | realistische Phase-22-Statusmatrix | isoliertes PostgreSQL 16 | `npx vitest run --config vitest.integration.config.ts tests/integration/schema/phase23-worker-runtime-migration-postgres.test.ts`; `npm run db:migrate`; `npm run db:migrate:status` | 0 verlorene Due-Objekte; 0 Doppel-Dedupe; Wiederholung 0 Delta; Lock-/Batchbudget eingehalten | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | Data + Platform | LOCAL/CI PASS |
| `23-AC-12` | `REQ-QA-001`, `REQ-QA-003` | systemweite Regression/anderer Deploydigest, P0 | G3 Portal-Golden | vollständige Unit/Integration/Browser/Worker/Provider/Recovery-Suite | ein Commit/Digest besteht alle Gates | Skip, Retry, Flake, anderes Artefakt oder offenes P0 blockiert | alle | Repository/Staging | deterministischer Seed + Provider Sandboxes | Clean Clone, PostgreSQL 16, Production Build/Staging | nacheinander `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e:http`, `npm run test:e2e:browser`, `npm run test:e2e:hsts`, `npm run test:release` sowie AC-05–09-Skripte | alle Exit 0; Browser Retry 0; keine unerklärten Skips; getesteter/deployter Digest identisch | [Phase-23-Evidence](./evidence/2026-07-27-phase-23.md) | QA + Ops | LOCAL G3 PASS; EXTERNAL G4 DEFERRED |

## 22. Performance-, Query-, Queue-, Latenz-, Last- und Kostenlimits

- Default Claim Batch ≤100, Lease 60 s, Heartbeat ≤20 s; Handler dürfen
  strengere, versionierte Werte besitzen.
- Default Max Attempts 8; Retrybackoff ist bounded/jittered und pro Klasse
  dokumentiert. Permanente Fehler umgehen sinnlose Retries.
- Referenzbenchmark: 10.000 Items, vier Worker, nachhaltiger Durchsatz
  mindestens 1,5× gemessene LC3-p95-Arrival-Rate, 0 Loss/Doppeleffect/OOM.
- Normalbetrieb ≤70 % nachhaltiger Kapazität; Warn-/Drosselgrenze 80 %,
  harte Intake-/Dispatch-Pause 90 %, jeweils mit Owner/Runbook. Safety-/
  Privacy-Revoke-Commands dürfen eine getrennte reservierte Prioritätskapazität
  besitzen.
- Jede Queue hat p50/p95 Start-/Endlatenz, oldest age, Arrival/Completion,
  Retry/DLQ/Error und Providerquota. Fach-SLOs werden pro Handler genehmigt.
- Unit Cost umfasst Workerzeit, DB-Queries/IO, Queue, Providercalls, Storage/
  Egress und purpose-limited manuelle Handling-Minuten; Demo-Werte sind kein
  Marktbeleg.
- Queryplan/Indexbudget für Claim darf bei 10.000 due Items keinen Full Scan
  ungebundener Payloadtabellen zeigen.
- RPO≤24 h/RTO≤8 h bleiben nur Hypothesen, bis Business/Ops sie schriftlich
  freigeben und Stagingmessung sie unterschreitet.

## 23. Geschützte Phase-01–18-Invarianten und Owning-Regressionen

```powershell
npx vitest run --config vitest.integration.config.ts tests/integration/candidate/job-alerts-postgres.test.ts tests/integration/jobs/effective-status-postgres.test.ts tests/integration/privacy/talent-radar-contact-request-postgres.test.ts tests/integration/employer/team-invitations-postgres.test.ts tests/integration/billing/subscription-plan-transitions-postgres.test.ts tests/integration/billing/phase12-credit-expiry-boundary-migration-postgres.test.ts tests/integration/privacy/privacy-case-service.test.ts tests/integration/audit tests/integration/auth/rate-limit-postgres.test.ts
npx vitest run --config vitest.config.ts tests/unit/billing tests/unit/security
npm run test:e2e:browser
npm run test:release
```

Geschützt bleiben fachliche Zeitgrenzen, Zurich/DST, Dedupe/Idempotenz,
Ledger/Entitlement, Tenant/Assignment/Capability, Radar-Privacy,
Application/Notification, Audit/Redaction, Seed-/Production-Guard,
verschlüsselter Backup-/Restore- und Mock-/LIVE-Ehrlichkeitsvertrag.

## 24. Rollback oder Roll-forward-only

Scheduler, Handler, Provider und Cohort können getrennt pausiert werden.
Queue-/Attempt-/Ledger-Schema bleibt additiv bis erfolgreichem Drain.
App-, Worker-, Migration- und Providerrollback sind getrennte Runbookschritte.
Nach externem Side Effect, Providerreceipt, Erasure oder Payment gilt
Roll-forward mit Dedupe/Reconciliation; DB-Rollback darf Wirkung nicht
„vergessen“. Alte Worker claimen unbekannte Versionen nie. Restore erfolgt nur
in vorgeprüfte getrennte Zielumgebung.

## 25. Benötigte Evidence und Artefakte

Phase-23-Technik-Evidence enthält Commit/Artefaktdigest, Migration,
vollständiges Handler- und Provider Activation Ledger,
Lease/Fencing-/Crash-/DLQ-/Replay-Timelines, Capacity-/Arrival-/Backlog-/
Handling-/Fixture-Cost-Report, Queryplans, Secret-/PII-Redaction, lokalen
isolierten Restore, Mobile/A11y, Flags/Kill-Switches und lokales G3.
Phase 32 übernimmt zwingend IaC-/Environment-, Stagingdeploy/-rollback-,
Provider-Sandbox-, SLO/Alert/Pager-/Incident-, automatische Backupretention-,
genehmigte RPO/RTO-, Owner-/Vertretungs- und G4-Evidence.

## 26. Definition of Done für Technik und Quality-Gate

Der lokale Technikstatus verlangt autonome Worker mit Lease/Heartbeat/Retry/
DLQ, vollständiges fail-closed Provider Ledger, lokale Observability,
Backpressure/Capacity, verschlüsselten isolierten Restore, Runbooks und alle
lokal ausführbaren AC-/G3-Gates auf demselben Commit. Dieser Vertrag ist auf
`d16a2d9` erfüllt.

Reproduzierbare reale Environments/IaC, Provider-Sandbox, Staging-Deployment,
Pager/On-call, automatischer Backup-Lifecycle, genehmigte SLO/RPO/RTO und das
deploygebundene G4 bleiben ein nicht erlassenes Phase-32-Aktivierungsgate.
Kein Realprovider oder autonomer Productionprozess darf vorher starten;
optional deaktivierte Handler bleiben ehrlich dokumentiert.

## 27. Gate für abhängige Folgephasen

Phase 24/25/26/30 dürfen auf dem grünen lokalen Worker-/Ledgervertrag
implementieren und testen. Provider-/Trust-/Freshness-/Payment-Handler dürfen
real erst aktiviert werden, wenn deren Domain-G1/G3 grün, der konkrete
Activation-Ledger-Eintrag gültig und das Phase-32-G4 bestanden ist. LC3+
benötigt grüne Kernworker; LC4–LC6 zusätzlich freigegebene
SLO/Capacity/On-call. Phase 32 darf nur den exakt getesteten/deployten Digest
übernehmen.

## 28. Ausdrücklich nicht bewiesene Aussagen und Referenzen

Nicht bewiesen sind Productionverfügbarkeit, genehmigte RPO/RTO/SLO,
On-call-Kapazität, Unit Economics, Provider-LIVE, Multi-region,
Exactly-once-Netzwerkzustellung oder unbegrenzte Skalierung. Ein lokaler
Worker-/Restore-Pass ist keine externe Productionfreigabe. Aktivierte
Provider werden einzeln bewiesen; ein grüner E-Mail-Smoke beweist weder
Storage noch Payment.

Verbindlich ergänzend gelten
[`remediation-execution-contract.md`](./remediation-execution-contract.md),
ADR-031–036 in [`decisions.md`](./decisions.md),
[`requirements-matrix.md`](./requirements-matrix.md),
[`remediation-traceability.md`](./remediation-traceability.md),
[`route-role-matrix.md`](./route-role-matrix.md) und die bestehenden
Deployment-/Rollback-/Backup-/Incident-Runbooks.

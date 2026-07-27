# Worker-Operations-Runbook

> **Status:** Die Phase-23-Runtime ist lokal und in CI ausführbar. Sie startet
> standardmässig `PAUSED`. Autonomer Staging-/Production-Betrieb bleibt bis
> zu realem Hosting, Monitoring/Pager, genehmigten SLOs und Phase-25-
> Berechtigungen `BLOCKED BY EXTERNAL GATE`.

## Sicherheits- und Aktivierungsvertrag

- `WORKER_RUNTIME=paused` ist der sichere Default und öffnet keine DB-
  Verbindung.
- `sandbox_command` ist ausschliesslich für `APP_ENV=local|ci` zulässig und
  erlaubt nur einen expliziten One-shot-Lauf.
- `autonomous` benötigt zusätzlich einen exakt passenden, nicht widerrufenen
  `WorkerHandlerActivation`-Eintrag für Environment, Handler-Version und
  Deployment-Digest.
- Ein Handler mit Providerabhängigkeit claimt oder schedult ohne gültigen
  `ProviderActivation`-Eintrag keine Arbeit. Es gibt kein Real→Mock-Fallback.
- Mutierendes Production-Replay, Provideraktivierung und Pause/Resume bleiben
  bis Phase 25 ausserhalb der UI gesperrt.
- Payloads, Secrets, URLs und freie Providerfehler werden weder im Cockpit
  noch in Worker-Ausgaben geschrieben.

## Runtime-Defaults

| Vertrag | Wert |
| --- | --- |
| Claim-Batch | 25, hart maximal 100 |
| Lease | 60 Sekunden |
| Heartbeat | 20 Sekunden, höchstens ein Drittel der Lease |
| Attempt-Budget | 8, hart maximal 64 |
| Backpressure | Warnung/Throttle ab 80 %, Pause ab 90 % |
| Headroom | nachhaltig mindestens 1,5× p95 Arrival |

Claims laufen atomar über PostgreSQL `FOR UPDATE SKIP LOCKED`. Jeder Takeover
erhöht das Fencing-Token. Ein alter Worker darf danach weder Heartbeat noch
Effect oder Ack committen. Der fachliche Effect-Key ist zusätzlich eindeutig;
ein Crash nach Effect und vor Ack erzeugt beim nächsten Attempt keinen zweiten
fachlichen Effekt.

## Lokaler Sandbox-Ablauf

1. In `.env.local` setzen:

   ```text
   APP_ENV=local
   WORKER_RUNTIME=sandbox_command
   WORKER_SANDBOX_REPLAY=true
   ```

2. Einen 64-stelligen SHA-256 für technische Evidence und Step-up-Evidence
   bereitstellen. Keine Secrets als Digest-Eingabe verwenden.
3. Den Diagnosehandler explizit aktivieren:

   ```text
   npm run worker:sandbox -- --action=activate-handler --handler=ops.diagnostic-effect --actor=<ACTOR_REF> --reason=LOCAL_DIAGNOSTIC --evidence-digest=<SHA256> --step-up-digest=<SHA256>
   ```

4. Einen deduplizierten Diagnosejob enqueuen:

   ```text
   npm run worker:sandbox -- --action=enqueue-diagnostic --key=<SAFE_KEY> --effect-digest=<SHA256>
   ```

5. Genau einen Zyklus ausführen:

   ```text
   npm run worker:once -- --worker-id=local-diagnostic-1
   ```

6. `/admin/system` als Admin prüfen. Die Ansicht ist read-only und zeigt nur
   redigierte Queue-, DLQ-, Run-, Activation- und Capacity-Daten.

Wird `WORKER_RUNTIME` nicht explizit gesetzt, muss `npm run worker:once`
`PAUSED` melden und ohne Claim enden.

## Provideraktivierung im Local-/CI-Sandboxvertrag

Die Aktivierung verlangt den registrierten Use Case/Adapter sowie DPA-,
Vertrags-, Approval-, Region-, Secret-Version-, Kapazitäts-, Kosten- und
Evidence-Referenzen:

```text
npm run worker:sandbox -- --action=activate-provider --use-case=<USE_CASE> --adapter=<ADAPTER> --actor=<ACTOR_REF> --reason=LOCAL_PROVIDER_CONTRACT --approval-ref=<REF> --contract-ref=<REF> --dpa-ref=<REF> --region=<REGION> --secret-version-ref=<SECRET_VERSION_REF> --capacity=<ITEMS_PER_MINUTE> --unit-cost-micros=<MICROS> --unit-cost-source=<REF> --evidence-digest=<SHA256> --step-up-digest=<SHA256>
```

Nur eine Secret-Version-Referenz, nie der Secret-Wert selbst, darf persistiert
werden. Die vollständige Providerprozedur steht in
[provider-activation.md](./provider-activation.md).

## Retry, DLQ und Replay

- Timeout, `408`, `429` und `5xx` sind transient und erhalten bounded,
  deterministisch gejitterten Backoff.
- Validierungsfehler und permanente `4xx` gehen direkt terminal.
- Konfigurationsfehler pausieren statt eine Retry-Schleife zu erzeugen.
- Unbekannte Fehler sind bounded; nach dem Attempt-Budget existiert genau ein
  `WorkDeadLetter`.
- Replay verwendet dasselbe Work Item, denselben Dedupe-/Effect-Key, erhöht
  nur ein begrenztes Attempt-Budget und schreibt `WorkReplayAudit`.

Sandbox-Replay:

```text
npm run worker:sandbox -- --action=replay --work-item-id=<ID> --actor=<ACTOR_REF> --reason=<REASON_CODE> --step-up-digest=<SHA256> --attempt-budget=1
```

Der Befehl muss ausserhalb Local/CI, ohne `WORKER_SANDBOX_REPLAY=true`, ohne
Step-up-Digest oder für ein nicht terminales Item fail-closed enden.

## Monitoring und Aufnahmeentscheidung

Mindestens Queue-Tiefe, oldest age, Arrival/Completion, Retry/DLQ/Error,
Worker-Heartbeat, Providerquota/-health, DB-Pool, p50/p95 Handling Time,
Sustainable Throughput und Unit Cost werden je Handler/Provider bewertet.

| Zustand | Reaktion |
| --- | --- |
| `NORMAL` | normale Claims/Intake |
| `HEADROOM_LOW` | Claim-Batch halbieren, Kapazitätsowner alarmieren |
| `THROTTLED` | Claim-Batch halbieren, keine Kohorte erweitern |
| `PAUSED` | Intake und Dispatch stoppen, Backlog erhalten |
| `DEGRADED` | betroffenen Handler/Provider pausieren, kein Mockfallback |

Ein fehlender oder veralteter Capacity-Sample ist kein Beweis ausreichender
Kapazität. Production bleibt ohne genehmigte Arrival-/SLO-/Kosten-Grenzen
gesperrt.

## Verifikation und Incident

```text
npm run worker:chaos
npm run worker:benchmark
npm run providers:smoke -- --environment=<ENV> --mode=<sandbox|allowlist|live> --all-registered
```

Chaos muss Crash vor Effect, Crash nach Effect/vor Ack, Heartbeatverlust,
Restart und Rolling Deploy mit genau einer Wirkung bestehen. Der Benchmark
muss 10’000 Items/4 Worker ohne Loss, Doppelwirkung, OOM oder Full Scan der
ungebundenen Payloadtabelle verarbeiten.

Bei oldest-age-, DLQ-, Provider-, Backup- oder PII-Alarm gilt
[incident-response.md](./incident-response.md). Claims zuerst für den
betroffenen Handler pausieren; Work Items, Attempts, DLQ, Receipts und
Activation Events bleiben unverändert als Evidence erhalten.

## Graceful Shutdown und Rollback

`SIGINT`/`SIGTERM` stoppt neue Claims, markiert den `WorkerRun` als
`DRAINING` und beendet ihn bounded als `DRAINED`. Bei Prozessabbruch läuft
die Lease kontrolliert aus. Schema und Backlog bleiben additiv erhalten.
Handler, Provider und Runtime werden getrennt pausiert; externe Effekte
werden niemals durch Löschen von Queue-/Ledgerzeilen „zurückgerollt“.

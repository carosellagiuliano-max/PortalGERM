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

| Vertrag        | Wert                                         |
| -------------- | -------------------------------------------- |
| Claim-Batch    | 25, hart maximal 100                         |
| Lease          | 60 Sekunden                                  |
| Heartbeat      | 20 Sekunden, höchstens ein Drittel der Lease |
| Attempt-Budget | 8, hart maximal 64                           |
| Backpressure   | Warnung/Throttle ab 80 %, Pause ab 90 %      |
| Headroom       | nachhaltig mindestens 1,5× p95 Arrival       |

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

| Zustand        | Reaktion                                                  |
| -------------- | --------------------------------------------------------- |
| `NORMAL`       | normale Claims/Intake                                     |
| `HEADROOM_LOW` | Claim-Batch halbieren, Kapazitätsowner alarmieren         |
| `THROTTLED`    | Claim-Batch halbieren, keine Kohorte erweitern            |
| `PAUSED`       | Intake und Dispatch stoppen, Backlog erhalten             |
| `DEGRADED`     | betroffenen Handler/Provider pausieren, kein Mockfallback |

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

## Revoke-, Generation- und Effect-Receipt-Grenze

Jede Autoritätsänderung an `WorkerHandlerActivation` erhöht ihre monotone
`generation`. Claim, jeder noch nicht begonnene Concurrency-Restblock und
jeder Lease-Heartbeat vergleichen Aktivierungs-ID **und** Generation. Ein
Revoke/Kill-Switch stoppt damit neue Effekte; bereits geclaimte, noch nicht
gestartete Items werden mit `WORKER_ACTIVATION_REVOKED` pausiert und behalten
ihren Backlog.

Ein bereits laufender Provider-/DB-Aufruf lässt sich nicht atomar
„zurückrufen“. Wenn er eine bekannte Wirkung zurückliefert, muss derselbe
Fencing-Owner deshalb das append-only `WorkEffectReceipt` noch schreiben,
auch wenn sein Heartbeat inzwischen wegen Revoke fehlgeschlagen oder seine
Leasefrist abgelaufen ist. Ein zwischenzeitlicher Takeover erhöht dagegen das
Fencing-Token und sperrt den alten Writer weiterhin. Receipt und terminaler
`WorkAttempt` bewahren die verwendete Aktivierungs-ID/-Generation sowie
`handlerActivationCurrentAtReceipt` beziehungsweise
`handlerActivationCurrentAtCompletion`. `false` ist bewusste
Revoke-Race-Evidence und darf nicht als aktuelle Autorität ausgewertet werden.

Für den unvermeidbaren Prozessabbruch nach externer Wirkung, aber vor
persistierbarem Receipt, bleibt zusätzlich die fachliche Provider-
Idempotency-ID und Reconciliation verbindlich. Ein Revoke ersetzt diese
Providergarantie nicht. Operations vergleichen bei einem solchen Incident
Effect-Key, Providerreceipt, Fencing-Token und die gespeicherte
Aktivierungsgeneration, bevor ein Replay freigegeben wird.

## Graceful Shutdown und Rollback

`SIGINT`/`SIGTERM` stoppt neue Claims, markiert den `WorkerRun` als
`DRAINING` und beendet ihn bounded als `DRAINED`. Bei Prozessabbruch läuft
die Lease kontrolliert aus. Schema und Backlog bleiben additiv erhalten.
Handler, Provider und Runtime werden getrennt pausiert; externe Effekte
werden niemals durch Löschen von Queue-/Ledgerzeilen „zurückgerollt“.

## Notification-Suppression-HMAC-Cutover

Der exakte Deployment-Zeitpunkt des Phase-33-Cutovers wird als Release-
Evidence festgehalten. Seit diesem Zeitpunkt schreiben Dispatcher und
Provider-Webhooks ausschließlich den HMAC mit dem aktiven
`NOTIFICATION_DELIVERY_KEYS`-Schlüssel; Lesezugriffe prüfen während der
Rotation zusätzlich alle ausdrücklich zurückbehaltenen Schlüsselversionen.

Vor dem Cutover erzeugte, aktive 64-Zeichen-SHA-256-Suppressions lassen sich
ohne die Klartextadresse nicht in einen HMAC umwandeln. Sie bleiben deshalb
ein ausschließlich lesender Kompatibilitätskandidat im Dispatcher. Webhooks
und andere Writer dürfen diesen alten Hash weder neu erzeugen noch persistieren.

Die Kompatibilität darf nicht allein aufgrund des Zeilenalters entfernt
werden. Eine Entfernung ist erst zulässig, wenn alle folgenden Nachweise als
Release-Evidence vorliegen:

1. Privacy und Legal haben eine maximale Aufbewahrungs- und Freigabefrist für
   Suppressions genehmigt und diese Frist ist seit dem dokumentierten Cutover
   vollständig abgelaufen.
2. Das Inventar zeigt keine aktive, vor dem Cutover erzeugte Suppression mehr,
   oder jede solche Zeile wurde anhand authentifizierter Provider-Evidence
   ausdrücklich freigegeben beziehungsweise durch einen HMAC ersetzt:

   ```sql
   SELECT count(*)
     FROM "NotificationSuppression"
    WHERE "releasedAt" IS NULL
      AND "createdAt" < :phase33_cutover_at;
   ```

3. Das Rollbackfenster ist beendet. Bis zur tatsächlichen Entfernung bleibt
   der Postgres-Upgradetest für alte Suppressions grün.

Suppressions werden niemals gelöscht oder umgeschrieben, nur um den
Inventarzähler auf null zu bringen. Klartextadressen werden für diese
Migration weder rekonstruiert noch gespeichert.

## Notification-Provider-Outcome und Webhook-Reconciliation

Vor dem ersten Resend-Netzwerkeffekt friert der Dispatcher die vollständige
Provideranfrage (Empfänger, Template, Betreff, Body und Template-Daten) als
AES-256-GCM-Envelope ein. Persistiert werden nur Ciphertext, Key-Version,
Digest, Erstellungszeit und die exakte `ProviderActivation`-ID. Ein Retry darf
weder Nutzerdaten neu auflösen noch Inhalt oder Activation wechseln; er
entschlüsselt denselben Snapshot und verwendet denselben
`providerDedupeKey`.

Ein Timeout, Netzwerkfehler oder eine 2xx-Antwort ohne gültiges Receipt gilt
als ungewisser Provider-Outcome. Der Dispatcher wiederholt ihn nur bounded mit
dem unveränderten Snapshot und Effect-Key. Ist das Versuchslimit erreicht,
wechselt die Outbox auf `PAUSED` mit
`PROVIDER_OUTCOME_RECONCILIATION_REQUIRED`; sie wird nicht mehr automatisch
geclaimt. Der verschlüsselte Snapshot wird unabhängig davon spätestens 23
Stunden nach seiner Erstellung vernichtet. Diese Frist darf weder durch einen
Incident noch durch einen manuellen Abgleich verlängert werden.

Der produktive, redigierte Operationspfad liegt unter
`/admin/system/notification-reconciliation`. Er verlangt
`ADMIN_SYSTEM_TASK_MANAGE`, eine frische einmalige AAL2-Bestätigung, die an
Outbox-ID **und** Resolution gebunden ist, einen SHA-256-Evidence-Digest, eine
nicht sensible Belegreferenz sowie einen Grundcode. Vor jeder Änderung sperrt
er die Outboxzeile und die aktuellste Provider-Aktivierung, validiert deren
vollständigen aktiven Vertrag und prüft die unveränderlichen
`providerActivationId`, `providerRequestDigest`, `providerDedupeKey`, den
letzten `TIMED_OUT`-Attempt und das authentisierte Request-Envelope. Nur der
exakte obige Pausezustand ist zulässig.

Die drei Resolutionen bedeuten verbindlich:

- `ACCEPTED`: Ein extern belegtes Provider-Receipt terminalisiert die Outbox
  idempotent als `DELIVERED`, schreibt einen vollständigen append-only
  Acceptance-Attempt und vernichtet Request-/gegebenenfalls Adressmaterial.
  Der Pfad besitzt absichtlich keinen Provider-Port und erzeugt keine zweite
  Sendewirkung.
- `DEFINITIVELY_NOT_ACCEPTED`: Nur ein Beleg, dass der Provider den Request
  sicher **nicht** angenommen hat, setzt denselben Outboxdatensatz auf `RETRY`.
  Ciphertext, Activation-ID, Request-Digest, Inhalt und `providerDedupeKey`
  bleiben byte-/identitätsgleich; der Dispatcher prüft die Autorität vor dem
  nächsten Netzwerkeffekt erneut. Nach Ablauf oder Vernichtung des Materials
  ist diese Resolution fail-closed.
- `UNKNOWN`: Schreibt ausschließlich die minimierte, digestgebundene
  Audit-Evidence und lässt Outbox, Attemptzahl und Providerwirkung pausiert.

Jede erfolgreiche Resolution wird mit dem Idempotency-Key als
Audit-Correlation und ohne Empfänger, Betreff, Body oder Rohbeleg persistiert.
Konkurrierende Wiederholungen desselben Keys ergeben genau einen Übergang und
einen Auditdatensatz. Eine andere Resolution, ein anderer Beleg, eine
revokte/ersetzte Aktivierung, fehlendes oder abgelaufenes Material und
Receipt-Kollisionen bleiben wirkungslos. Der Operator darf bei fehlender
autoritativ abfragbarer Providerlage niemals aus Plausibilität „nicht
angenommen“ wählen; der sichere Default ist `UNKNOWN`.

Signierte Resend-Webhooks schreiben nie allein aufgrund einer Empfängeradresse
eine Suppression. Die Projektion verlangt genau einen akzeptierten
DeliveryAttempt mit demselben Receipt, Adapter, Environment, Secret-Version,
Send-Activation, Request-Digest und Sendzeit-HMAC. Trifft der Webhook vor dem
API-Receipt ein, bleibt er `RECEIVED`; der spätere Delivery-Commit projiziert
ihn unter demselben Receipt-Advisory-Lock. Fremde oder mehrdeutige Receipts
bleiben wirkungslos und werden über den Inbox-Backlog eskaliert.

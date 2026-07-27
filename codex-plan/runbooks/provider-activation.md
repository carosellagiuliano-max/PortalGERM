# Provider-Activation-Runbook

> **Status:** Versioniertes Provider-Ledger und fail-closed Resolution sind
> technisch implementiert. Local-/CI-Sandboxaktivierung ist möglich. Reale
> Staging-/LIVE-Aktivierung bleibt ohne Providervertrag, DPA/Region,
> Secret-Manager, Owner, Monitoring und signierte Evidence blockiert.

## Grundvertrag

Eine Provideraktivierung gilt exakt für:

```text
Environment × Use Case × Adapter Key × Adapter Version × Mode
```

Sie darf keinen anderen Use Case aktivieren. Der Resolver akzeptiert nur
einen registrierten Adapter, ein gültiges Zeitfenster, `HEALTHY`, einen
aktiven Kill Switch, positive nachhaltige Kapazität und vollständige
Governance-Referenzen. `expired`, `revoked`, `degraded`, `paused`,
unvollständig oder nicht exakt passend bedeutet `DISABLED`.

Ein API-Key oder eine Env-Variable allein aktiviert keinen Provider.
Production fällt nie automatisch auf einen Mock/Sandboxadapter zurück.

## Pflichtfelder vor einer Aktivierung

- namentlicher Fach- und Operations-Owner;
- Use Case, Adapter-Key und Adapter-Version aus dem registrierten Katalog;
- Modus `SANDBOX`, `ALLOWLIST` oder `LIVE`;
- DPA/AVV-/Subprozessor- und Datenregionsreferenz;
- Vertrags-/Quota-/SLA-Referenz;
- Approval-Referenz für genau Environment, Use Case und Modus;
- Secret-Manager-/KMS-Versionsreferenz, niemals Secretmaterial;
- Runbook und Kill-Switch;
- nachhaltige Kapazität und Unit-Cost-Quelle;
- Healthstatus;
- SHA-256 der unveränderlichen Contract-/Sandbox-/Security-Evidence;
- Gültigkeits-/Reviewzeitraum und Revoke-Owner.

Fehlt eines davon, darf die Aktivierung weder geschrieben noch beim Boot
aufgelöst werden.

## Local-/CI-Sandbox

Nur mit `APP_ENV=local|ci` und `WORKER_RUNTIME=sandbox_command`:

```text
npm run worker:sandbox -- --action=activate-provider --use-case=<USE_CASE> --adapter=<ADAPTER> --actor=<ACTOR_REF> --reason=<REASON_CODE> --approval-ref=<REF> --contract-ref=<REF> --dpa-ref=<REF> --region=<REGION> --secret-version-ref=<SECRET_VERSION_REF> --capacity=<ITEMS_PER_MINUTE> --unit-cost-micros=<MICROS> --unit-cost-source=<REF> --evidence-digest=<SHA256> --step-up-digest=<SHA256>
```

Danach prüft der read-only Smoke alle registrierten Use Cases:

```text
npm run providers:smoke -- --environment=local --mode=sandbox --all-registered
```

Der Smoke muss Exit-Code ungleich `0` liefern, sobald ein registrierter Use
Case keinen exakt passenden gültigen Ledger-Eintrag besitzt. Das ist
beabsichtigtes fail-closed Verhalten und keine Aufforderung, ungenutzte
Provider blind zu aktivieren.

## Staging-/LIVE-Prozedur

1. Owning Phase und Requirement des Use Cases müssen technisch grün sein.
2. Vertrag, DPA/Region, Security Review, Budget/Quota und fachliche Approval
   werden ausserhalb des Repositories signiert/versioniert.
3. Secret wird durch eine getrennte Workload Identity im Secret Manager
   provisioniert; nur die Versionsreferenz kommt ins Ledger.
4. Provider-Sandbox-Smoke, Timeout/429/5xx, Duplicate/Replay,
   Redaction/PII-Canary und Kill-Switch werden auf dem getesteten Artefakt
   ausgeführt.
5. Erst Phase 25 darf eine menschliche Staging-/Production-Mutation mit
   Least Privilege, frischem resourcegebundenem Step-up und gegebenenfalls
   Dual Approval bereitstellen.
6. Canary/Allowlist wird vor `LIVE` aktiviert. Health, Quota, Kosten und
   Error Budget werden überwacht.
7. Der Evidence-Digest und alle Owner/Fristen werden im append-only
   Activation Event festgehalten.

Ein Repository-Commit, ein lokaler Smoke oder ein vorhandener SDK-Adapter
ersetzt keinen dieser Schritte.

## Revoke und Kill Switch

Bei DPA-/Secret-/Region-/Quota-/Health-/Security-Abweichung:

1. betroffenen Use Case pausieren/revoken, nicht global alle Provider;
2. neue Claims für abhängige Handler stoppen; Backlog durable erhalten;
3. kein Mockfallback aktivieren;
4. Providerreceipts, Work Attempts und Activation Events unverändert sichern;
5. Secret nach Evidence-Sicherung rotieren/widerrufen;
6. Incident Owner und Owning Domain benachrichtigen;
7. erst nach neuer Evidence eine neue versionierte Aktivierung erzeugen.

Bereits ausgeführte Zustellung, Speicherung oder Zahlung wird nicht als
ungeschehen markiert. Reconciliation beziehungsweise der owning
kompensierende Use Case entscheidet die fachliche Folge.

## Evidence

Der Record enthält Environment/Use Case/Adapter/Version/Mode, Owner,
Approval-/Contract-/DPA-/Region-/Secret-Version-/Runbook-Referenzen,
Aktivierungs- und Ablaufzeit, Quota/Kapazität/Unit-Cost-Quelle, Health- und
Kill-Switch-Test, Sandbox-/Canary-Ergebnis, Evidence-SHA-256 sowie Revoke- und
Rollbackentscheidung. Er enthält keine Secrets, Providerpayloads oder PII.

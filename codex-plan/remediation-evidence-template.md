# Phase-19+-Evidence-Template

> Dieses leere Template gilt nur für neue Remediation-Evidence ab Phase 19.
> Es verändert keine historische Phase-01–18-Evidence. Ein Record wird erst
> auf dem unveränderlichen Zielcommit angelegt; geplante Ergebnisse oder
> Häkchen sind verboten.

## 1. Identität und Status

| Feld                   | Wert                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Phase/Track            | `XX/XXA`                                                                                                        |
| Evidence-ID            | `YYYY-MM-DD-phase-XX[-track]`                                                                                   |
| Zielcommit             | `OFFEN`                                                                                                         |
| Branch                 | `OFFEN`                                                                                                         |
| Artefakt-/Image-Digest | `OFFEN / N/A begründen`                                                                                         |
| Umgebung/DB            | `OFFEN`                                                                                                         |
| Operator               | `OFFEN`                                                                                                         |
| unabhängiger Reviewer  | `OFFEN`                                                                                                         |
| Planstatus             | `PLANNED / IN_PROGRESS / COMPLETED / BLOCKED / DEFERRED`                                                        |
| Technical Status       | `NOT_IMPLEMENTED / PENDING / IMPLEMENTED / TECHNICALLY_READY_FOR_LC4 / TECHNICALLY_READY_FOR_LC5_CONFIGURATION` |
| Quality Status         | `NOT_RUN / PENDING / FAILED / PASSED`                                                                           |
| Activation Status      | `DISABLED / SANDBOX / ALLOWLIST / LIVE / ACTIVATION_BLOCKED_BY_EXTERNAL_GATES`                                  |
| Zielklasse             | `LC1 / LC2 / LC3 / LC4 / LC5 / LC6`                                                                             |

## 2. Scope, Requirements und Schutzgrenzen

| Finding/Requirement | Priorität in Zielklasse | Abnahmekriterium | Owner   | Status/Evidence |
| ------------------- | ----------------------- | ---------------- | ------- | --------------- |
| `STH-/REQ-`         | `P0–P4`                 | `messbar`        | `OFFEN` | `OFFEN`         |

- geschützte Phase-01–18-Invarianten:
- explizit ausgeschlossener Scope:
- vorausgesetzte Migrationen/Provider/externe Gates:
- nachgelagerte Consumer:

## 3. Preflight und Migration

| Check                          | Exakter Befehl/Ablauf                             | Erwartung                                               | Ergebnis/Artefakt |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------- | ----------------- |
| Gitidentität/sauberer Worktree | `git rev-parse HEAD`; `git status --short`        | Zielcommit eindeutig; keine fremden Änderungen          | `OFFEN`           |
| Env/DB-Identität               | redigierter Env-/DB-Check                         | erlaubte getrennte Ziele; keine Secret-Ausgabe          | `OFFEN`           |
| Migration clean                | `npm run db:migrate`; `npm run db:migrate:status` | Exit 0; keine offene Migration                          | `OFFEN`           |
| Seed deterministisch 1         | `npm run db:seed`; `npm run seed:verify`          | Exit 0; Manifest A                                      | `OFFEN`           |
| Seed deterministisch 2         | `npm run db:seed`; `npm run seed:verify`          | Exit 0; Manifest identisch A                            | `OFFEN`           |
| Backfill/Restore               | phasenspezifischer exakter Drill                  | Counts/Checksums/Orphans/Lockzeit/RTO innerhalb Vertrag | `OFFEN`           |

## 4. AC→Test→Evidence

Jede AC-Zeile aus der Detailphase wird ohne Zusammenlegen übernommen.

| Kriterium / Requirement | Risiko | Testart                                     | Testfall    | Positivfall | Negativ-/Abuse-Fall | Rolle | Portal/System | Testdaten | Umgebung                        | Exakter Befehl / manueller Ablauf | Erwartetes Resultat und objektive Pass-/Fail-Schwelle | Evidence | Owner | Status    |
| ----------------------- | ------ | ------------------------------------------- | ----------- | ----------- | ------------------- | ----- | ------------- | --------- | ------------------------------- | --------------------------------- | ----------------------------------------------------- | -------- | ----- | --------- |
| `AC-XX-01 / REQ-*`      | `...`  | `Unit/PG/E2E/Security/Perf/Manual/External` | `tests/...` | `...`       | `...`               | `...` | `...`         | `fixture` | `local PG/staging/LIVE console` | `exact`                           | `number/state/SLO`                                    | `OFFEN`  | `...` | `NOT RUN` |

## 5. G0–G4

| Gate                    | Umfang                                                                                                                    | Resultat                                                         | Evidence |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| G0 Governance/Preflight | Scope, IDs, Baseline, 28 Felder, AC-Matrix, keine Fremdänderung                                                           | `OFFEN`                                                          | `OFFEN`  |
| G1 Targeted             | betroffene Unit-/PG-/HTTP-/E2E-/Security-/Perf-Tests                                                                      | `OFFEN`                                                          | `OFFEN`  |
| G2 Integration          | Downstream-Consumer und geschützte Phase-01–18-Suites                                                                     | `OFFEN`                                                          | `OFFEN`  |
| G3 Phase Close          | Lint, Typecheck, Build, Plan/Route/Security, Migration/Seed/Restore nach Vertrag                                          | `OFFEN`                                                          | `OFFEN`  |
| G4 Release              | Clean Clone, Full Suite, Provider-/Worker-/Failure-/Restore-Drills und manueller Rollen-Walkthrough auf gleichem Artefakt | `OFFEN / für Phase 32 und 33 verpflichtend; sonst N/A begründen` | `OFFEN`  |

## 6. UX, Security, Operations und externe Evidence

| Bereich                    | Pflichtnachweis                                                                                    | Ergebnis    |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| UX/A11y                    | Default/Loading/Empty/Error/Locked/Conflict/Success; Desktop/360; Tastatur/Screenreader nach Scope | `OFFEN`     |
| Security/Privacy           | Cross-tenant/IDOR, step-up, redaction, rate/fraud/abuse, canary leak                               | `OFFEN`     |
| Worker/Provider            | timeout, retry, duplicate, out-of-order, DLQ, replay, degradation, kill switch                     | `OFFEN/N/A` |
| Phase-33 Notification      | getrennte Delivery-AES-/Recipient-HMAC- und API-/Webhook-Secret-Versionen; Key-Version-Inventar; 23 h/31 d/exakt `400 × 24 h`; providerunabhängige Minuten-Retention; Unknown-Outcome→`PAUSED`/manuelle Reconciliation; Activation-TX-Lock; monotone Inbox/Suppression | `OFFEN/N/A` |
| SLO/Capacity/Cost          | Lastprofil, p95/error/backlog, Headroom, Vollkosten, Alert/Owner                                   | `OFFEN/N/A` |
| Legal/Privacy/Finance/Data | datierter Owner-Entscheid, Scope, Quelle, Ablauf/Review                                            | `OFFEN/N/A` |
| Moderated Research         | Segment, Aufgaben, n, Task Success/Zeit/Fehler/Abbruch/Verständnis                                 | `OFFEN/N/A` |

## 7. Abweichungen, Rollback und Abschluss

- fehlgeschlagene/übersprungene Checks mit Grund:
- bekannte Limitationen:
- Deferred P2/P3 mit Istwert, Headroom, Trigger, Forecast, Alert, Owner:
- Rollback-/Roll-forward-/Reconciliation-Ergebnis:
- Cleanup von Testdaten, Credentials und Artefakten:
- post-activation SLO/Reviewdatum/Owner:

Eine technische Implementierungs-/Closure-Phase darf erst `[x]` werden, wenn
ihr technischer Scope vollständig ist, das Statusquartett ausdrücklich
getrennt wurde, jede zielklassenspezifische technische P0-Zeile und die
vollständige AC-Matrix belegt sind und der erforderliche Repository-Gate-Lauf
grün ist. Externe Aktivierungsentscheidungen müssen dafür nicht fälschlich als
genehmigt gelten: Sie müssen vollständig als `EXTERNAL` beziehungsweise
`BLOCKED` mit Owner, benötigter Evidence, betroffener Wirkung und sicherem
deaktiviertem Zustand klassifiziert sein und jedes Aktivierungsurteil weiter
blockieren. Eine Phase, deren eigenes Ziel die reale Aktivierung ist, bleibt
hingegen bis zur geschützten externen Freigabe offen.

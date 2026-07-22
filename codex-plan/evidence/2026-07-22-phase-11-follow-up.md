# Evidence — Phase 11 Follow-up-Audit

> **STATUS: ABGESCHLOSSEN.** Die gemeldeten Aussagen wurden einzeln gegen den
> aktuellen Phase-12-Baum geprüft. Bestätigte Lücken wurden im unveränderlichen
> Code-Commit `ee57eecca4dcee70764fcd48aeebd7b413b5ad54` korrigiert. Veraltete oder
> überzeichnete Aussagen wurden nicht blind umgesetzt.

## Identität und Ergebnis

- **Datum:** 22. Juli 2026, Europe/Berlin (UTC+02:00)
- **Branch:** `codex/phase-12-billing-entitlements`
- **Geprüfter Code-Commit:** `ee57eecca4dcee70764fcd48aeebd7b413b5ad54`
- **Commit-Identität:** `Giuliano Carosella <carosellagiuliano@gmail.com>`
- **Code-/Testumfang:** 25 Dateien, 394 Ergänzungen, 62 Löschzeilen, 0 gelöschte Dateien
- **Ergebnis:** keine offene Phase-11-P0/P1-Lücke aus dem geprüften Bericht

## Bewertung der Aussagen

| Aussage | Urteil im aktuellen Baum | Korrektur |
|---|---|---|
| Cockpit-Aktionskarten sind statisch | Bestätigt | Seed-erreichbare Signale besitzen jetzt echte Form-Aktionen: vorbefüllte, serverseitig bereinigte Lead-Notiz sowie den kanonischen Lead-Status-/Folgetermin-Workflow. Signale ohne bestehenden Lead öffnen ehrlich den Firmen-/Sales-Kontext statt eine Mutation vorzutäuschen. |
| Cluster-Launch ist schlafender Code | Bestätigt | Der deterministische Seed enthält ein erreichbares DEMO-Assessment. DEMO darf Product/Ops-Review zeigen, aber nie LIVE aktivieren. Ein PostgreSQL-Test erzeugt getrennt echte LIVE-Testevidenz und beweist Product approve → Ops approve → activate → revoke samt vier Events und Audits. |
| Nachfrage Kanton/Kategorie wird nicht gerendert | Materiell bestätigt; im geprüften Code wurde nur Supply nach Kategorie abgefragt, keine vollständige Paar-Projektion zurückgegeben | Das Cockpit projiziert und rendert nun LIVE-Bewerbungen im rollierenden 30-Tage-Fenster gegenüber aktiven Jobs je Kanton×Kategorie, einschließlich belastbarem Empty State. |
| Firmendetail ohne Abuse/Subscription | Abuse bestätigt; Subscription veraltet/falsch | Abuse Reports gegen Firma oder zugehörige Jobs werden angezeigt. Der bereits durch Phase 12 vorhandene Abo-Verlauf blieb unverändert. |
| Reports ohne Target-/Assignee-Filter und ohne Zuweisung | Bestätigt | Beide Filter, sichtbare Zuständigkeit und ein servervalidiertes Assignee-Feld in der Triage wurden ergänzt. |
| Lead-Filter nur URL-Semantik | Bestätigt | Sichtbare Status-, Owner- und Überfälligkeitsfilter mit erhaltener Auswahl wurden ergänzt. |
| Support-Queue ohne Bereich/Assignee | Bestätigt | Kategorie/Bereich und Zuständigkeit werden je Queue-Zeile gerendert. |
| Severity geht beim Re-Sort verloren | Bestätigt | Der zweite, Overdue-priorisierte Sort hält Severity als Tiebreaker. |
| `JOB_FLAGGED` ist tot | Bestätigt | Eine angewendete `HIDE_JOB`-Restriktion schreibt zusätzlich genau ein `JOB_FLAGGED`-Audit; der Replay-Test verhindert Duplikate. |
| Support-Read-Denial und Oversize-Import ungetestet | Bestätigt | Capability-Denial für Liste/Detail/Mutation und ein multibyte UTF-8-Payload unterhalb des Zeichen-, aber oberhalb des Byte-Limits sind PostgreSQL-getestet. |
| `ACTOR_OR_IP_TARGET` fehlt im Audit-Scope | Bestätigt | Rate-Limit-Scopes haben jetzt eine gemeinsame Source of Truth; alle realen Scopes validieren im Audit-Test. Der ungenutzte `TARGET`-Scope wurde entfernt. Abuse-Denials schreiben nun ein best-effort `RATE_LIMITED`-Audit, ohne aus 429 einen 500er machen zu können. Die behauptete zwingende 500-Folge war im aktuellen Pfad überzeichnet, die Allowlist-Drift und fehlende Abuse-Denial-Evidenz waren jedoch real. |
| Phase-11-Navigationstest wird unter Phase 12 rot | Veraltet/falsch | Der bestehende Test erwartet bereits die 15 aktuellen Einträge einschließlich Phase-12-Billing-Routen und schützt weiterhin das Verbot globaler Rollenmutation. |
| Durchgehender Employer→Admin→Public Browser-E2E fehlt | Richtig, aber kein nachträglicher Phase-11-Codeblocker | Phase 11 belegt die Owning-Domain mit PostgreSQL. Der kontinuierliche Cross-Role-Browserflow ist ausdrücklich E2E-02 in Phase 17 und bleibt dort offen. Der Phase-11-Vertrag wurde entsprechend präzisiert. |

## Verifikation

| Gate | Ergebnis |
|---|---|
| `npm run lint -- --quiet` | Exit 0 |
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; 192 Dateien, 1.538/1.538 Tests |
| `npm run test:integration` | Exit 0; 57 Dateien, 275/275 PostgreSQL-Tests |
| `npm run build` | Exit 0; Production-Build und 16 statische Seiten erfolgreich |
| `npm run db:seed` | Exit 0; `phase-12-demo-v11`, Billing/Ops-Block 605 Records, insgesamt 4.255 Identitäten |
| `npm run seed:verify` | Exit 0; read-only gegen Manifest `2a8e64ef850b90782796a30a5f8029410c935158408803523d5a3eec6b2957ec` |

Der erste vollständige Unit-Lauf zeigte nach der absichtlichen Seed-Erweiterung
die alte feste Erwartung 604 statt 605 sowie zwei lastbedingte 5-Sekunden-
Timeouts. Die Vertragszahl wurde korrigiert, die Timeout-Fälle bestanden
fokussiert 11/11, und der anschließende unveränderte Gesamtbefehl bestand
1.538/1.538. Der erste Integrationstestversuch traf eine ausgeschaltete lokale
Docker-Engine; nach Start der projektgebundenen Testdatenbank bestanden der
fokussierte und der vollständige Lauf.

## Bewusste Grenze

Der lokale Browser war mit einer Nicht-Admin-Rolle angemeldet und bestätigte
korrekt den 403-Guard. Die Session wurde für diese Prüfung nicht verändert.
Die gerenderten Admin-Routen sind durch Typecheck, Production-Build und reale
PostgreSQL-Read-/Write-Tests belegt; der rollenübergreifende Browser-E2E bleibt
ehrlich Phase 17.

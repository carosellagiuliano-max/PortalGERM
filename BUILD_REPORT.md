# SwissTalentHub Build Report — Phase 18

> **Technischer Abschluss:** bestanden auf dem unveränderlichen Code-Commit
> `f7158c7999b25da467f172d228b9d475ec00c127`.
>
> **Zulässige Aussage:** Demo-ready, serverseitig gegatet, mit lokalen
> Mock-Providern.
>
> **Keine Freigabe als pilot-ready oder production-ready.** Staging, echte
> Provider, Legal/Privacy/Tax und mehrere organisatorische Ops-Gates bleiben
> offen.

## Release-Identität

| Feld | Ergebnis |
| --- | --- |
| Datum / Zeitzone | 24. Juli 2026 · Europe/Berlin (UTC+02:00) |
| Branch | `codex/phase-18-release-audit` |
| verifizierter Code-Commit | `f7158c7999b25da467f172d228b9d475ec00c127` |
| Commit-Identität | `Giuliano Carosella <carosellagiuliano@gmail.com>` |
| Runtime | Windows x64 · Node `24.18.0` · npm `11.16.0` · Playwright `1.61.1` |
| Datenbank-/Ops-Tools | PostgreSQL-Tools `16.13` · Docker `29.5.2` · Compose `5.1.3` · Age `1.3.1` |
| Phase-18-Evidence | [`codex-plan/evidence/2026-07-24-phase-18.md`](./codex-plan/evidence/2026-07-24-phase-18.md) |

Der Code-Commit ist der reproduzierte Produktstand. Dieser Report, die
Evidence und die Plan-Häkchen werden im nachfolgenden reinen
Dokumentationscommit geschlossen. Die Werte des Plan-, Link-, Secret-,
License-, Dependency- und Diff-Audits stammen aus diesem Close-out-Stand und
werden nicht rückwirkend dem Code-Commit zugeschrieben.

## Umgesetzter Umfang

Phase 18 liefert:

- einen projektspezifischen README-/Env-/Setup-/Architektur-/Rollen-/
  Provider-/Deployment-Vertrag;
- Deployment-, Rollback-, Incident- und verschlüsselte
  Backup-/Restore-Runbooks;
- eine geprüfte Route-/Rollenmatrix und ein Inventar mit exakt 100 Seiten und
  7 Handlern;
- Plan-/Evidence-, Route-, Secret-, Lizenz- und Dependency-Audits;
- den Clean-Clone-/Recovery-Gate E2E-08 mit Production-Demo-Guard;
- die vollständige Qualitätsmatrix für alle 100 Seiten auf Desktop und
  360 px;
- mobile Containment-Korrekturen für Admin-, Billing- und
  Arbeitgeber-Operationsansichten;
- die bewusste Entfernung breiter privater Streaming-Grenzen, die echte
  Action- und 404-Semantik verfälscht hatten.

## Ausgeführte Qualitätsgates

| Gate | Ergebnis |
| --- | --- |
| `npm run lint` | Exit `0` |
| `npm run typecheck` | Exit `0` |
| `npm run build` | Exit `0` |
| `npm test` | **246/246 Testdateien, 1.970/1.970 Tests**, Exit `0` |
| `npm run test:integration` | **75/75 Testdateien, 369/369 echte PostgreSQL-Tests**, Exit `0` |
| `npm run test:e2e:http` | HTTP-, CSP-/Nonce-, Header-, Health-, Auth- und Privacy-Smoke bestanden |
| `npm run test:e2e:browser` | **219/219**, Retry `0`, keine Failures/Skips/Timeouts/Interrupts |
| `npm run test:e2e:hsts` | Production-HSTS-Headervertrag bestanden; kein Nachweis einer realen TLS-/Ingress-Kette |
| `npm run route:audit` | 100 Seiten, 7 Handler; geschützte Layouts vorhanden, keine breiten privaten `loading.tsx` |
| `npm run plan:audit` nach Close-out | 18 abgeschlossene Phasen, 1.087 belegte Häkchen in 19 Dateien, 271 auflösbare lokale Links |
| `npm run security:release-scan` | 1.118 tracked Dateien im Close-out-Stand, kein erkannter Secret-/Key-/Token-/Backup-Befund |
| `npm run license:audit` | 910 Lockfile-Pakete; 0 verbotene Lizenzen; technische, keine rechtliche Freigabe |
| `npm audit --audit-level=moderate` | 0 Schwachstellen |
| `npm run db:validate` | Prisma-Schema gültig |
| `npm run db:migrate:status` | 43 Migrationen; lokale Schema-Basis aktuell |
| `npm run db:smoke` | `SELECT 1` bestanden; keine Domainzeile geschrieben |
| `git diff --check` | sauber |

Der Browserlauf prüfte sieben persistierte Cross-role-Journeys, 202 exhaustive
Routenfälle und zehn vertiefte Critical-Route-Fälle. Das Browsermanifest
referenziert den Zielcommit, Playwright `1.61.1`, beide Projekte und
`retryPolicy: 0`; sein SHA-256 lautet
`49b46009bf3f6f8dc4eae6e4514704fc9b4d967d47f8a7a1e345b84e1136b3a1`.

Der PostgreSQL-Satz meldete beim Prisma-PG-Adapter die bekannte
`client.query()`-Deprecation-Warnung für das kommende `pg@9`. Alle 369 Tests
blieben grün. Der Phase-15-Benchmark mit 2.006 berechtigten Jobs maß im
Hauptlauf p95 `108,17 ms`.

### Transparenz zur persönlichen lokalen Demo-Datenbank

Ein zusätzlicher, nicht als Release-Gate verwendeter `seed:verify`-Aufruf
gegen die bereits veränderte persönliche Demo-Datenbank endete mit
`SeedLifecycleError`. Diese Datenbank wurde bewusst weder überschrieben noch
neu geseedet. Der maßgebliche reproduzierbare Nachweis erfolgte anschließend
in E2E-08: zwei identische Seeds und die Read-only-Verifikation in einer
frischen isolierten Datenbank bestanden.

## E2E-08 — Clean Release und Recovery

`npm run test:release` lief vom Code-Commit
`f7158c7999b25da467f172d228b9d475ec00c127`.

| Feld | Finaler Wert |
| --- | --- |
| Status / Run-ID | `passed` / `f3326073d23d6fd7` |
| Zeitraum | `2026-07-24T15:25:17.629Z` bis `2026-07-24T15:31:51.825Z` |
| Clean Clone | echter `git clone --no-local`, detached auf Zielcommit |
| Seed-Manifest SHA-256 | `a48db9e0e3e2716d01cdde4973cb0676c24731eb7d7a8e10f2afd06d4a126ddc` |
| Source-DB | `swisstalenthub_release_test_f3326073d23d6fd7` |
| Restore-DB | `swisstalenthub_restore_test_f3326073d23d6fd7` |
| Production-Guard-DB | `swisstalenthub_guard_test_f3326073d23d6fd7` |
| verschlüsseltes Backup | 1.078.279 Byte |
| Ciphertext SHA-256 | `e3f8f0dbfa08f9fabf3af8d14fc64e38b24ca2d5f3642e46a7ca6e2e10dafe8d` |
| RPO / RTO | 128 s / 66 s |
| Manifest SHA-256 | `afbf742e28df10ab8925356582f956a5c3d1e324c3319d38acca2d7e8d5c0c53` |
| Cleanup | Clone, Backup, Age-Identity und alle drei Drill-DBs entfernt |

Der Production-Demo-Seed scheiterte absichtlich vor dem ersten Demo-Write
mit Exit `1`; das Gate wertete genau diese erwartete Verweigerung als Pass.
Alle übrigen 20 Manifestbefehle hatten Exit `0`. Backupdaten wurden direkt
von `pg_dump -Fc` durch Age gestreamt; es wurde keine Klartext-Dumpdatei
angelegt. Nach dem Restore bestanden Migration/Manifest/DB-Smoke,
Public-/Vier-Rollen-Smoke und die Passwort-Reset-Browserreise. Die
Abwesenheit aller drei Drill-Datenbanken wurde nach dem Cleanup zusätzlich
per PostgreSQL-Abfrage bestätigt.

RPO ≤24 h und RTO ≤8 h sind weiterhin unbestätigte Architekturhypothesen,
keine durch diesen lokalen Einzel-Drill genehmigten Betriebs-SLAs.

## Manueller Produktions-Walkthrough

Gegen `next start` wurden Candidate-Dashboard, Employer Talent Radar,
Recruiter-Jobs im Kontext NovaRigi und Admin-Systemstatus jeweils auf Desktop
und in der 360-px-Klasse geprüft. In allen acht Zuständen:

- erwartete Rolle, Route und H1 sichtbar;
- Dokumentbreite nicht größer als Viewport;
- keine unallowlisteten abgeschnittenen Bedienelemente;
- Skip-Link per Tastatur sichtbar fokussierbar;
- abschließend 0 Browserwarnungen und 0 Browserfehler.

Die exakten Viewport-/Dokumentwerte stehen im
[Phase-18-Record](./codex-plan/evidence/2026-07-24-phase-18.md#manueller-vier-rollen-walkthrough).

## Mock-Provider und spätere Integrationen

**Implemented with mock provider:** Payment, E-Mail, AI, Job-Room, Storage und
Commute. Die Ports und Austauschschritte sind im
[README](./README.md#mock-integrationen) beschrieben.

**Ready for later real provider integration** bedeutet ausschließlich, dass
explizite Ports und inaktive Env-Platzhalter vorhanden sind. Vor Aktivierung
braucht jeder reale Provider eine separate Security-/Legal-/Ops-Freigabe,
DPA, Secret-Verwaltung, Webhook-/Retry-/Idempotenzvertrag, Monitoring,
Fallback und getestetes Runbook.

Analytics-Aggregation und HTML-Rechnungsrendering sind interne Services, keine
externen Provider. Mock Payment ist weder Stripe noch ein echter Geldfluss;
HTML-Rechnungen sind keine PDFs; Success Fee bleibt deaktiviert.

## Bewusst offene Gates

- echte Preview-/Staging-/Production-Umgebungen mit getrennten Secrets und
  Datenbanken;
- Staging-Smoke sowie reale HTTPS-/Ingress-/HSTS-Wirkung;
- Legal-, Privacy- und Tax-Freigaben;
- reale Provider samt DPA, Webhooks, Retry, Monitoring und Fallback;
- produktiver verschlüsselter Backup-Lifecycle `30 daily + 12 monthly`;
- Business-/Owner-Freigabe von RPO/RTO;
- benannter Incident Owner, On-call/Pager und organisatorischer Drill;
- reale Export-, Lösch- und Retention-Prozesse;
- autonomer Worker für Renewal, Alerts und fällige Projektionen;
- das separat gegatete P1-Paket `REQ-REC-002`.

Diese offenen Punkte blockieren Pilot- und Produktionsfreigabe, nicht den
lokal verifizierten technischen Abschluss von Phase 18.

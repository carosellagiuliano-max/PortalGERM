# Phase-18 Release-Checkliste

> **Arbeitsdokument, kein Pass-Nachweis.** Ein Häkchen wird erst nach einem
> erfolgreichen Lauf auf dem unveränderlichen Zielcommit gesetzt und im
> datierten Phase-18-Evidence-Record belegt. Externe Go-live-Gates bleiben
> offen, auch wenn der lokale technische Release-Drill grün ist.

## Release-Identität

| Feld | Wert |
| --- | --- |
| Release-Commit | offen |
| Branch | `codex/phase-18-release-audit` |
| Start/Ende | offen |
| Operator/Reviewer | offen |
| Phase-18-Evidence | noch nicht erstellt |
| BUILD_REPORT | noch nicht erstellt |

## Preflight

- [ ] Phasen 01–17 und ihre Ziel-Evidence sind verlinkt.
- [ ] Der Release-Commit ist unveränderlich benannt; der zu prüfende Clone ist sauber.
- [ ] Node `24.18.0`, npm `11.16.0`, PostgreSQL `16`, Docker/Compose, Age und Playwright-Version sind erfasst.
- [ ] `DATABASE_URL` und `TEST_DATABASE_URL` zeigen auf getrennte, ausdrücklich erlaubte Ziele.
- [ ] Env-Werte wurden validiert und weder ausgegeben noch committed.
- [ ] Lokale Nutzeränderungen, `.env*`, Backup-, Identity-, Build- und Testartefakte sind ausserhalb des Release-Diffs.
- [ ] [Deployment](./runbooks/deployment.md), [Rollback](./runbooks/rollback.md), [Recovery](./runbooks/backup-restore.md) und [Incident Response](./runbooks/incident-response.md) wurden reviewed.

## Reproduzierbare Qualitätsgates

- [ ] `npm ci`
- [ ] `npm run env:validate`
- [ ] `npm run db:generate`
- [ ] `npm run db:validate`
- [ ] `npm run db:migrate`
- [ ] `npm run db:migrate:status`
- [ ] `npm run db:seed` zweimal mit identischem vollständigem Manifest
- [ ] `npm run seed:verify`
- [ ] `npm run db:smoke`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] `npm run build`
- [ ] `npm run test:e2e:http`
- [ ] `npm run test:e2e:browser` mit Retry `0`
- [ ] `npm run test:e2e:hsts`

Jeder Eintrag benötigt Exit-Code, Laufzeit/Ergebnis und Zielcommit im
Evidence-Record. Ein früherer Phase-17-Lauf ist Regressionsbasis, ersetzt aber
keinen Lauf auf dem Phase-18-Release-Commit.

## E2E-08 — Clean Release und Recovery

- [ ] `npm run test:release` lief aus dem Release-Commit.
- [ ] Ein echter `git clone --no-local` wurde detached auf den Zielcommit gestellt.
- [ ] `env:init -- --ci` validierte vorab bereitgestellte Variablen und schrieb keine Env-Datei.
- [ ] Leere Source-, Restore- und Production-Guard-Datenbanken hatten allowlist-konforme, verschiedene Namen.
- [ ] Der Production-Demo-Seed scheiterte vor dem ersten User-/Manifest-Write.
- [ ] Backup streamte ohne Klartext über `pg_dump -Fc` und Age in eine externe `.dump.age`.
- [ ] Ciphertext und `.sha256` waren vorhanden; Digest und verschlüsselte Bytezahl wurden erfasst.
- [ ] Restore erfolgte nur in die leere, getrennte Restore-DB.
- [ ] Migration, Seed-Manifest und DB-Smoke bestanden nach Restore.
- [ ] Public Desktop/360px sowie Candidate-, Employer-, Recruiter- und Admin-Login bestanden nach Restore.
- [ ] Forgot Password → geschützte lokale Mailbox → einmaliges Reset → Login bestand.
- [ ] RPO/RTO wurden gemessen und nur gegen die noch unbestätigten Hypothesen verglichen.
- [ ] Clone, Identity, Ciphertext/Sidecar und alle drei Drill-Datenbanken wurden entfernt.
- [ ] `test-results/phase18/run-manifest.json` meldet `passed` und enthält keine Secrets/Backup-Bytes.

## Trace-, Route- und Security-Audit

- [ ] `npm run route:audit` stimmt mit `codex-plan/route-inventory.json` überein.
- [ ] [Route-/Rollen-Matrix](./route-role-matrix.md) deckt alle 100 Seiten und 7 Handler ab.
- [ ] Candidate-/Employer-/Admin-Mutationen besitzen Pending-Zustände; keine
  breite private Streaming-Grenze verdeckt echte Tenant-/Owner-404-Status;
  Fehler-/404-/Locked-Zustände sind nachvollziehbar.
- [ ] Der manuelle Vier-Rollen-Walkthrough nennt Route, Fixture, Desktop/360px, Tastatur/Fokus und Resultat.
- [ ] `npm run plan:audit` meldet keine `[x]` ohne erreichbare Target-Evidence und keine gebrochenen lokalen Links.
- [ ] Alle 51 P0-/P0-P1-Zeilen und E2E-01–08 besitzen im Abschlussrecord Requirement → Test → Evidence.
- [ ] `npm run security:release-scan` ist grün.
- [ ] `npm run license:audit` ist technisch grün; offene rechtliche Bewertung bleibt separat.
- [ ] `npm audit --audit-level=moderate` hat keinen ungelösten Befund.
- [ ] Git-Diff-/Deletion-/Whitespace- und generierter-Artefakt-Audit sind sauber.

## Dokumentation und Übergabe

- [ ] README beschreibt Produkt, Stack, Architektur, Setup, Env, DB/Seed, Demo-Konten, Routen/Rollen, Monetarisierung, Mocks, Security, Grenzen, Provider-Swap, Deployment und Disclaimer.
- [ ] `.env.example` entspricht dem finalen Env-Vertrag und enthält nur erkennbare Platzhalter.
- [ ] Evidence-Index enthält alle abgeschlossenen Records.
- [ ] `BUILD_REPORT.md` nennt Befehle, Ergebnisse, Mocks, Grenzen und offene Gates.
- [ ] Phase-18-Detaildatei wird zuerst anhand der Evidence aktualisiert.
- [ ] Erst danach wird Phase 18 im Masterplan abgeschlossen.

## Externe Gates — bewusst offen

Diese Punkte dürfen nicht durch einen lokalen Test auf `[x]` wechseln:

- [ ] echte Preview-/Staging-/Production-Umgebungen mit getrennten Secrets/DBs;
- [ ] Staging-Smoke und reale HTTPS-/Ingress-/HSTS-Wirkung;
- [ ] Legal-/Privacy-/Tax-Freigabe;
- [ ] Freigabe realer Provider, DPA, Webhooks/Retry/Monitoring;
- [ ] produktiver verschlüsselter Storage-Lifecycle `30 daily + 12 monthly`;
- [ ] Business-Freigabe RPO ≤24 h und RTO ≤8 h;
- [ ] benannter Incident Owner, On-call/Pager und getestete Übung;
- [ ] reale Export-/Lösch-/Retention-Prozesse;
- [ ] autonomer Worker für Renewal, Alerts und fällige Projektionen.

## Abschlussentscheidung

| Status | Zulässige Aussage |
| --- | --- |
| technische Checkliste/E2E-08 grün, externe Gates offen | „Demo-ready, serverseitig gegatet, mit lokalen Mock-Providern“ |
| Staging oder externe Gates fehlen | **nicht** „pilot-ready“ und **nicht** „production-ready“ |
| ein P0-, Security-, Privacy-, Tenant-, Backup- oder Cleanup-Gate rot | Phase 18 bleibt offen |

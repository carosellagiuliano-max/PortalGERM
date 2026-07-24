# Phase-18 Release-Checkliste

> **Arbeitsdokument, kein eigenständiger Pass-Nachweis.** Runtime-Häkchen
> beziehen sich auf den unveränderlichen Code-Commit; Plan-, Link-, Secret-,
> License-, Dependency- und Diff-Häkchen auf den nachfolgenden reinen
> Dokumentations-Close-out. Beide Prüfstände sind im datierten
> Phase-18-Evidence-Record getrennt belegt. Externe Go-live-Gates bleiben
> offen, auch wenn der lokale technische Release-Drill grün ist.

## Release-Identität

| Feld | Wert |
| --- | --- |
| verifizierter Code-Commit | `a9f24e7190681c23886de84add321db32b43651e` |
| Branch | `codex/phase-18-release-audit` |
| E2E-08 Start/Ende | `2026-07-24T16:26:24.308Z` / `2026-07-24T16:32:37.438Z` |
| Operator/Reviewer | Codex · technischer Selbstreview; keine unabhängige Fach-/Go-live-Freigabe |
| Phase-18-Evidence | [`evidence/2026-07-24-phase-18.md`](./evidence/2026-07-24-phase-18.md) |
| BUILD_REPORT | [`../BUILD_REPORT.md`](../BUILD_REPORT.md) |

## Preflight

- [x] Phasen 01–17 und ihre Ziel-Evidence sind verlinkt.
- [x] Der verifizierte Code-Commit ist unveränderlich benannt; der zu prüfende Clone ist sauber.
- [x] Node `24.18.0`, npm `11.16.0`, PostgreSQL `16`, Docker/Compose, Age und Playwright-Version sind erfasst.
- [x] `DATABASE_URL` und `TEST_DATABASE_URL` zeigen auf getrennte, ausdrücklich erlaubte Ziele.
- [x] Env-Werte wurden validiert und weder ausgegeben noch committed.
- [x] Lokale Nutzeränderungen, `.env*`, Backup-, Identity-, Build- und Testartefakte sind ausserhalb des Release-Diffs.
- [x] [Deployment](./runbooks/deployment.md), [Rollback](./runbooks/rollback.md), [Recovery](./runbooks/backup-restore.md) und [Incident Response](./runbooks/incident-response.md) wurden technisch reviewed.

## Reproduzierbare Qualitätsgates

- [x] `npm ci`
- [x] `npm run env:validate`
- [x] `npm run db:generate`
- [x] `npm run db:validate`
- [x] `npm run db:migrate`
- [x] `npm run db:migrate:status`
- [x] `npm run db:seed` zweimal mit identischem vollständigem Manifest
- [x] `npm run seed:verify`
- [x] `npm run db:smoke`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run test:integration`
- [x] `npm run build`
- [x] `npm run test:e2e:http`
- [x] `npm run test:e2e:browser` mit Retry `0`
- [x] `npm run test:e2e:hsts`

Jeder Eintrag benötigt Exit-Code, Laufzeit/Ergebnis und Zielcommit im
Evidence-Record. Ein früherer Phase-17-Lauf ist Regressionsbasis, ersetzt aber
keinen Lauf auf dem Phase-18-Release-Commit.

## E2E-08 — Clean Release und Recovery

- [x] `npm run test:release` lief aus dem Release-Commit.
- [x] Ein echter `git clone --no-local` wurde detached auf den Zielcommit gestellt.
- [x] `env:init -- --ci` validierte vorab bereitgestellte Variablen und schrieb keine Env-Datei.
- [x] Leere Source-, Restore- und Production-Guard-Datenbanken hatten allowlist-konforme, verschiedene Namen.
- [x] Der Production-Demo-Seed scheiterte vor dem ersten User-/Manifest-Write.
- [x] Backup streamte ohne Klartext über `pg_dump -Fc` und Age in eine externe `.dump.age`.
- [x] Ciphertext und `.sha256` waren vorhanden; Digest und verschlüsselte Bytezahl wurden erfasst.
- [x] Restore erfolgte nur in die leere, getrennte Restore-DB.
- [x] Migration, Seed-Manifest und DB-Smoke bestanden nach Restore.
- [x] Public Desktop/360px sowie Candidate-, Employer-, Recruiter- und Admin-Login bestanden nach Restore.
- [x] Forgot Password → geschützte lokale Mailbox → einmaliges Reset → Login bestand.
- [x] RPO/RTO wurden gemessen und nur gegen die noch unbestätigten Hypothesen verglichen.
- [x] Clone, Identity, Ciphertext/Sidecar und alle drei Drill-Datenbanken wurden entfernt.
- [x] `test-results/phase18/run-manifest.json` meldet `passed` und enthält keine Secrets/Backup-Bytes.

## Trace-, Route- und Security-Audit

- [x] `npm run route:audit` stimmt mit `codex-plan/route-inventory.json` überein.
- [x] [Route-/Rollen-Matrix](./route-role-matrix.md) deckt alle 100 Seiten und 7 Handler ab.
- [x] Candidate-/Employer-/Admin-Mutationen besitzen Pending-Zustände; keine
  breite private Streaming-Grenze verdeckt echte Tenant-/Owner-404-Status;
  Fehler-/404-/Locked-Zustände sind nachvollziehbar.
- [x] Der manuelle Vier-Rollen-Walkthrough nennt Route, Fixture, Desktop/360px, Tastatur/Fokus und Resultat.
- [x] `npm run plan:audit` meldet keine `[x]` ohne erreichbare Target-Evidence und keine gebrochenen lokalen Links.
- [x] Alle 51 P0-/P0-P1-Zeilen und E2E-01–08 besitzen im Abschlussrecord Requirement → Test → Evidence.
- [x] `npm run security:release-scan` ist grün.
- [x] `npm run license:audit` ist technisch grün; offene rechtliche Bewertung bleibt separat.
- [x] `npm audit --audit-level=moderate` hat keinen ungelösten Befund.
- [x] Git-Diff-/Deletion-/Whitespace- und generierter-Artefakt-Audit sind sauber.

## Dokumentation und Übergabe

- [x] README beschreibt Produkt, Stack, Architektur, Setup, Env, DB/Seed, Demo-Konten, Routen/Rollen, Monetarisierung, Mocks, Security, Grenzen, Provider-Swap, Deployment und Disclaimer.
- [x] `.env.example` entspricht dem finalen Env-Vertrag und enthält nur erkennbare Platzhalter.
- [x] Evidence-Index enthält alle abgeschlossenen Records.
- [x] `BUILD_REPORT.md` nennt Befehle, Ergebnisse, Mocks, Grenzen und offene Gates.
- [x] Phase-18-Detaildatei wurde zuerst anhand der Evidence aktualisiert.
- [x] Erst danach wird Phase 18 im Masterplan abgeschlossen.

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

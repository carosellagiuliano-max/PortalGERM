# Deployment-Runbook

> **Status:** kontrollierter Release-Vertrag für das Mock-MVP. Dieses Runbook
> ist keine Staging- oder Produktionsfreigabe. Zum Zeitpunkt der Phase-18-
> Erstellung ist kein Deployment-Provider und keine echte Staging-Umgebung
> mit diesem Repository verbunden.
> Der geplante Phase-19+-Produktionsvertrag steht separat im
> [Remediation-Runbookziel](./remediation-production-target.md) und ist noch
> nicht ausgeführt.
>
> Phase 23 ergänzt eine lokal/CI-geprüfte, standardmässig pausierte Worker-
> Runtime und strikte externe Evidence-Validatoren. Es wurde dadurch noch
> keine Staging-/Production-Infrastruktur verbunden.

## Zweck und Grenzen

Dieses Runbook beschreibt den reproduzierbaren Build-, Migrations- und
Startpfad. Es gilt für einen exakt benannten Release-Commit. Es erlaubt keine
Demo-Daten in Staging oder Production und ersetzt weder die
[Rollback-Anweisung](./rollback.md) noch den
[Backup-/Restore-Vertrag](./backup-restore.md).

Der lokale Befehl `npm run test:release` ist ein destruktionsbegrenzter
Recovery-Drill. Er erzeugt und entfernt ausschliesslich zufällig benannte
Loopback-Datenbanken aus seiner festen Allowlist. Er ist **kein**
Produktions-Deployment-Befehl und verweigert unbekannte, gemeinsame,
Staging- oder Production-Ziele.

## Umgebungen

| Umgebung | Daten/Secrets | Demo-Seed | Aktueller Nachweis |
| --- | --- | --- | --- |
| Local | lokale, ignorierte `.env.local`; Loopback-PostgreSQL | erlaubt und sichtbar als DEMO markiert | unterstützt |
| CI | vorab bereitgestellte flüchtige Variablen; separate CI-/Test-DB | erlaubt | GitHub Actions für Linux/PostgreSQL und Windows |
| Preview | eigene DB und Secrets, HTTPS, exakte Proxy-Hop-Zahl | nur nach explizitem Preview-Vertrag | **offen; nicht verbunden** |
| Staging | eigene DB und Secrets, HTTPS, exakte Proxy-Hop-Zahl | verboten | **offen; keine Staging-URL/Evidence** |
| Production | eigene DB und Secrets, HTTPS, exakte Proxy-Hop-Zahl | verboten | **offen; keine Go-live-Freigabe** |

Preview, Staging und Production dürfen nie dieselbe Datenbank, Keyrings oder
Provider-Credentials verwenden. `TEST_DATABASE_URL` bleibt in Staging und
Production leer. Ein `APP_BUILD_ID` identifiziert dort exakt den Release-
Commit. `RATE_LIMIT_BACKEND=postgres` ist ausserhalb Local verpflichtend.

## Voraussetzungen

- freigegebener, unveränderlicher Commit und sauberer Git-Arbeitsbaum;
- Node.js `24.18.0`, npm `11.16.0`, PostgreSQL `16`;
- alle erforderlichen Variablen aus `.env.example` über einen Secret Store,
  nicht über committed Env-Dateien;
- `APP_URL=https://…`, sichere Cookies und korrekt konfigurierte
  `TRUSTED_PROXY_HOPS` für Preview/Staging/Production (bei direktem
  Vercel-Ingress `1`; bei vorgeschaltetem Proxy neu ermitteln);
- der Adminbereich bleibt in Preview/Staging/Production vollständig gesperrt,
  solange `ADMIN_MFA_REQUIRED=false` ist. Erst nach RP-ID-/Origin-,
  Recovery-Owner- und Enrollment-Freigabe auf `true` schalten; danach erzwingt
  jede Adminseite aktuelle AAL2-Assurance;
- ein vorab dokumentierter Migrations-/Rollback-Entscheid;
- bei Supabase/Supavisor: Runtime über den zum Hosting passenden Poolermodus,
  Migration über eine geeignete direkte/Session-Verbindung und wirksame
  Rollen-/Datenbankwerte von höchstens fünf Sekunden für `statement_timeout`
  und `idle_in_transaction_session_timeout`; Transaction-Pooling darf nicht
  auf Session-`SET` als Schutzgrenze vertrauen;
- erfolgreicher technischer Release-Record;
- für einen echten Pilot zusätzlich separate Legal-/Privacy-/Tax-,
  Retention-/RPO-/RTO-, Incident-Owner- und Provider-Freigaben.

## Release-Befehle

Die folgenden Befehle laufen im Repository-Root und sind plattformneutral:

```text
npm ci
npm run env:validate
npm run db:generate
npm run db:validate
npm run lint
npm run typecheck
npm test
npm run db:migrate
npm run db:migrate:status
npm run test:integration
npm run build
npm run test:e2e:http
npm run test:e2e:browser
npm run test:e2e:hsts
npm run worker:chaos
npm run worker:benchmark
```

`prisma db push`, `prisma migrate reset` und ein Demo-Seed sind in Staging und
Production verboten. `npm run db:seed` gehört nur in den isolierten
Local-/CI-/Preview-Demopfad; der Phase-18-Release-Drill beweist separat, dass
der gleiche Versuch in Production vor dem ersten DEMO-Write scheitert.

## Ablauf

1. Release-Commit, Branch, Operator, Startzeit und Zielumgebung erfassen.
2. Bestätigen, dass Datenbank und Secrets exklusiv zur Zielumgebung gehören.
3. `npm ci` aus dem committed Lockfile und `npm run env:validate` ausführen.
4. Vor einer risikobehafteten Migration den freigegebenen externen
   Backup-Prozess und die Restore-Fähigkeit bestätigen. Die lokalen
   Phase-18-Wrapper dürfen nicht auf Production zeigen.
5. `npm run db:migrate` und danach `npm run db:migrate:status` ausführen.
6. `npm run build` ausführen. Der Build erzeugt keine Go-live-Freigabe.
7. Artefakt mit `npm run start` hinter dem vorgesehenen HTTPS-Ingress starten.
   Worker zunächst mit `WORKER_RUNTIME=paused` deployen.
8. Queue-/Provider-Migration und Activation Ledger prüfen. Erst danach genau
   einen Diagnosehandler für den exakten Deployment-Digest als Canary
   aktivieren. Die Prozedur steht in
   [worker-operations.md](./worker-operations.md) und
   [provider-activation.md](./provider-activation.md).
9. `GET /health/live` und `GET /health/ready` prüfen. `ready` muss `200`
   liefern und bestätigt dabei auch die effektiven PostgreSQL-Timeoutwerte;
   ein `503` blockiert den Rollout.
10. Öffentliche Kernrouten und die erlaubten Rollen mit nicht-demonstrativen
   Staging-Konten prüfen. In Production dürfen keine Demo-Konten existieren.
11. Security-Header, `no-store`/`noindex`, CSP, HSTS am echten HTTPS-Rand und
    redigierte Logs kontrollieren.
12. Release-Entscheid, Endzeit, Commit, Migrationen, Worker-/Providerstatus,
    Smoke-Ergebnisse und
    bekannte offene Gates in der Evidence festhalten.

## Phase-23-Staging-Evidence

Der Staging-Smoke akzeptiert kein lokal erfundenes „Pass“. Er verlangt eine
absolute JSON-Evidence-Datei ausserhalb des Repositories und deren erwarteten
SHA-256:

```text
APP_ENV=staging
TESTED_ARTIFACT_DIGEST=<IMMUTABLE_DIGEST>
PHASE23_STAGING_DEPLOY_EVIDENCE_PATH=<ABSOLUTER_EXTERNER_PFAD>
PHASE23_STAGING_DEPLOY_EVIDENCE_SHA256=<SHA256>
npm run ops:staging-smoke -- --environment=staging --artifact-digest=<IMMUTABLE_DIGEST> --scenario=deploy,migrate,canary,rollback
```

Der Vertrag prüft identischen Test-/Deploydigest, leere und Upgrade-DB,
keine pending Migration/Demozeile, Live/Ready/Worker-Canary sowie einen
erfolgreichen Rollback innerhalb eines vorher genehmigten Budgets. Ohne reale
Staging-Evidence muss der Befehl Exit-Code ungleich `0` liefern.

## Abbruchkriterien

Der Rollout wird abgebrochen, wenn mindestens eines gilt:

- Env-Validierung, Migration, Build, Test oder Readiness ist rot;
- Ziel-DB oder Secret-Zugehörigkeit ist nicht zweifelsfrei;
- Demo-Daten oder lokale Mailbox sind in Staging/Production aktiv;
- ein kritischer Security-, Privacy-, Tenant- oder Datenintegritätsbefund ist
  offen;
- der Migrationsschritt besitzt keinen sicheren Vorwärts-/Rollback-Entscheid;
- das erforderliche externe Backup oder der Incident Owner fehlt.

Dann gilt [rollback.md](./rollback.md). Keine Fehlermeldung rechtfertigt
`db push`, `migrate reset`, eine manuelle Ledger-Korrektur oder das Einspielen
eines ungeprüften Dumps.

## Release-Evidence

Der Record enthält mindestens:

- vollständigen Commit, Umgebung, Operator und Zeitfenster;
- Node/npm/PostgreSQL- und Deployment-Runtime-Versionen;
- Befehle mit Exit-Code und redigierter Beobachtung;
- Zielmigration und `APP_BUILD_ID`;
- Live-/Ready-/Smoke-Ergebnisse und echte HTTPS-Headerprüfung;
- Rollback-Entscheid und Backup-Referenz ohne Credentials oder Backup-Bytes;
- offene externe Gates und zuständigen Owner.

## Offene externe Gates

Diese Punkte bleiben unabhängig von einem grünen lokalen Release-Drill offen:

- echte Preview-/Staging-/Production-Infrastruktur und getrennte Secrets/DBs;
- Staging-Smoke und HTTPS-/Ingress-Nachweis;
- Workerhosting, Metrics/Error-Tracking und getesteter Handler-Canary;
- Legal-/Privacy-/Tax-Freigabe;
- reale Payment-, E-Mail-, AI-, Storage-, Job-Room- und Commute-Provider;
- produktive verschlüsselte Retention sowie genehmigte RPO/RTO;
- benannter Incident Owner, On-call/Pager und Kommunikationsweg.

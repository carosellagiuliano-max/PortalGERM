# SwissTalentHub / PortalGERM

PortalGERM befindet sich in **Phase 01: technische Foundation**. Vorhanden sind eine reproduzierbare Next.js-/TypeScript-Basis, UI-Primitives, Env-Validierung, Prisma/PostgreSQL-Grundlage, Health-Routen und Test-/CI-Infrastruktur.

Noch **nicht** implementiert sind Jobsuche, Authentifizierung, Kandidaten-, Arbeitgeber- und Adminportale, fachliche Datenmodelle, Billing sowie Mock- oder Real-Provider. Die Startseite weist diesen Umfang ausdrücklich aus; es gibt keine Fake-Logins, Fake-Jobs oder funktionslosen Produkt-CTAs. Ein vorhandenes File oder eine grüne Oberfläche ist kein Implementierungsnachweis.

## Verbindliche Runtime

- Node.js **24.18.0**
- npm **11.16.0**
- PostgreSQL **16**

Die Node-Version ist in `.node-version` und `.nvmrc`, die npm-Version in `package.json#packageManager` und den Engines gepinnt. `engine-strict=true` verhindert Installationen mit einer abweichenden Runtime.

Prüfen:

```powershell
node --version
npm --version
```

Erwartet werden `v24.18.0` und `11.16.0`.

## Voraussetzungen

- Git und eine PowerShell- oder vergleichbare Shell
- Node.js/npm in den oben genannten exakten Versionen
- Docker Desktop beziehungsweise Docker Engine mit Compose für die lokale PostgreSQL-Instanz
- freie lokale Ports `3000`, `5434` und bei Integrationstests `5435`

## Lokales Setup

```powershell
npm ci
npm run env:init
npm run env:validate
docker compose up -d postgres
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:seed
npm run db:smoke
npm run dev
```

Danach ist die Foundation unter [http://127.0.0.1:3000](http://127.0.0.1:3000) erreichbar.

`npm ci` verwendet ausschliesslich das committed Lockfile und eine versionsgenaue Allowlist für geprüfte Dependency-Install-Scripts. `npm run env:init` erzeugt einmalig eine ignorierte `.env.local` mit lokal gültigen, voneinander verschiedenen Zufallsschlüsseln. Der Befehl überschreibt keine vorhandene Datei, läuft nur lokal, übernimmt keine URL aus dem Shell-Environment und setzt auf unterstützenden Dateisystemen Modus `0600`. `.env.example` ist absichtlich nicht direkt lauffähig und enthält nur erkennbare Platzhalter.

## Umgebungsvariablen

`npm run env:validate` prüft unter anderem:

- ein explizites `APP_ENV`; Prozesskonfiguration und lokale Env-Dateien werden nie still gemischt;
- PostgreSQL-URLs und absolute `APP_URL`;
- einen 32-Byte-Base64-`SESSION_SECRET`;
- getrennte, versionierte 32-Byte-Keyrings für Audit-IP-HMAC, Radar-Lookup, Radar-Verschlüsselung, Reveal-Bestätigung und PII-Reveal;
- keine wiederverwendeten Schlüssel;
- `RATE_LIMIT_BACKEND=postgres` und deaktivierte lokale Mock-Mailbox in Staging/Production;
- einen credential-, query- und fragmentfreien `APP_URL`-Origin;
- leere, noch nicht freigegebene Real-Provider-Variablen;
- falls gesetzt, einen absoluten `BACKUP_AGE_IDENTITY_FILE`-Pfad ausserhalb des Repositories.

Fehler nennen nur Variablenname und Regel, niemals den Secret-Wert. `.env.local`, `.env` und andere lokale Env-Dateien dürfen nicht committed oder in Logs ausgegeben werden. Ops-Backup-Werte bleiben leer, bis der separate Betriebsprozess freigegeben ist; private Age-Identitäten gehören nie ins Repository.

## PostgreSQL und Compose

| Dienst | Zweck | Host-Port | Persistenz |
|---|---|---:|---|
| `postgres` | lokale Entwicklung | `127.0.0.1:5434` | Named Volume `swisstalenthub-postgres` |
| `postgres-test` | isolierte Integrationstests | `127.0.0.1:5435` | flüchtiges `tmpfs` |

Entwicklungsdatenbank starten:

```powershell
docker compose up -d postgres
```

Zusätzliche Testdatenbank starten:

```powershell
docker compose --profile test up -d postgres-test
```

Beide Dienste und die Linux-CI verwenden PostgreSQL `16.13-alpine` mit festem
Image-Digest. `DATABASE_URL` und `TEST_DATABASE_URL` sind getrennt. CI verwendet
ausschliesslich eine kurzlebige Service-Datenbank; keine CI-Aktion kennt oder
akzeptiert eine Production-URL.

## Prisma, Migration, Seed und DB-Smoke

```powershell
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:seed
npm run db:smoke
```

- `db:generate` erzeugt den ignorierten Prisma Client neu.
- `db:validate` prüft Schema und Konfiguration ohne Datenbankmutation.
- `db:migrate` verwendet `prisma migrate deploy` gegen die explizite `DATABASE_URL`.
- Die Phase-01-Baseline enthält bewusst keine Fachmodelle. Sie beweist nur den Migrationspfad.
- `db:seed` prüft per `SELECT 1` die Erreichbarkeit und schreibt keine Demo- oder Domainzeilen.
- `db:smoke` führt ebenfalls nur einen read-only `SELECT 1` aus; bei `APP_ENV=ci` verwendet es `TEST_DATABASE_URL`.

Die interaktiven Befehle `npm run db:migrate:dev` und `npm run db:studio` besitzen zusätzlich einen Fail-closed-Guard: Sie akzeptieren nur `APP_ENV=local`, einen Loopback-Host und keine production-/staging-bezeichnete Datenbank. `db:migrate` bleibt der nicht-interaktive Deploy-Pfad für eine ausdrücklich vollständig konfigurierte Zielumgebung.

Fachmodelle und fachliche Seeds gehören erst in Phase 02 beziehungsweise Phase 05. Es gibt in Phase 01 keinen automatischen Reset und keinen Production-Seed.

## Qualitätsbefehle

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

`test:integration` und `test:e2e` verlangen `APP_ENV=local|ci` sowie eine
eindeutig test-bezeichnete, von `DATABASE_URL` getrennte `TEST_DATABASE_URL`.
`test:e2e` startet nach einem erfolgreichen Build selbst einen Production-Server
auf einem freien Loopback-Port, prüft Inhalt, Health/404, Security-, Correlation-
und No-store-Header sowie eine Secret-Canary und beendet den Prozess wieder.

Zusätzliche Konfigurationschecks:

```powershell
npm run env:validate
npm run db:generate
npm run db:validate
docker compose config --quiet
```

Die Linux-CI führt Clean Install, Env-Validierung, Prisma Generate/Validate, Lint, Typecheck, Unit-Tests, Baseline-Migration, technischen Seed, DB-Smoke, PostgreSQL-Integrationstests, Production Build und einen HTTP-Smoke aus. Ein separater `windows-latest`-Job wiederholt ohne Docker mindestens Install, Env-, Prisma-, Lint-, Typecheck-, Unit- und Build-Prüfung und belegt damit die npm-cmd-Portabilität.

## Health-Routen

- `GET /health/live` liefert `200 {"status":"ok"}`, prüft nur die Prozess-Liveness und ist `no-store`.
- `GET /health/ready` führt einen auf drei Sekunden begrenzten PostgreSQL-Check aus; Pool-Verbindungs- und Query-Timeouts verhindern unbegrenztes Warten. Bei erreichbarer DB liefert die Route `200 {"status":"ready"}`, sonst `503 {"status":"unavailable"}`. Sie gibt weder URL noch Credentials oder Tabelleninhalte aus und ist ebenfalls `no-store`.

Health-Routen sind Betriebschecks, keine Produktfeatures und keine Autorisierungsgrenze.

## Sicherheits- und Scope-Hinweise

- Keine echten Secrets, Provider-Keys, persönlichen Daten oder Produktionsdaten in Repository, Fixtures oder CI.
- Keine automatische oder unbeabsichtigte Verbindung zu einer unbekannten oder Production-Datenbank; Tests verwenden immer die isolierte Testdatenbank. Der Deploy-Migrationspfad benötigt eine ausdrücklich konfigurierte Zielumgebung.
- Keine Real-Provider werden durch Env-Keys automatisch aktiviert; deren Variablen müssen leer bleiben.
- Der Phase-01-Logger redigiert sensitive Werte; Stacktraces und Konfiguration gehören nicht in Nutzerantworten.
- Basisheader sind vorbereitet. Vollständige CSP/HSTS-, Auth-, Rate-Limit- und Autorisierungshärtung folgen in ihren besitzenden Phasen.
- Die Foundation ist weder ein demo-fertiges Produkt noch produktionsbereit oder vollständig DSG-konform.

## Plan und Evidence

1. [`AGENTS.md`](./AGENTS.md) — Implementierungs- und Evidence-Regeln.
2. [`codex-plan/00-PLAN.md`](./codex-plan/00-PLAN.md) — Masterplan und Status.
3. [`codex-plan/01-setup-foundation.md`](./codex-plan/01-setup-foundation.md) — verbindlicher Phase-01-Vertrag.
4. [`codex-plan/decisions.md`](./codex-plan/decisions.md) — Architekturentscheidungen.
5. [`codex-plan/requirements-matrix.md`](./codex-plan/requirements-matrix.md) — Traceability.
6. [`codex-plan/implementation-plan.md`](./codex-plan/implementation-plan.md) — Ausführungsschritte 01–18.

Ein Checkbox-Häkchen bedeutet „im Zielrepository implementiert und verifiziert“. Evidence nennt mindestens Datum, Zielcommit, Umgebung, OS, Node/npm-Version, Befehl beziehungsweise manuellen Check, Exit-Code/Ergebnis und bekannte Limitation. Zuerst wird die Detailphase aktualisiert, danach gegebenenfalls der Masterplan.

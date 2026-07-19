# SwissTalentHub / PortalGERM

**Phasen 01 und 02 sind implementiert und verifiziert; Phase 03 wurde noch nicht begonnen.** Vorhanden sind die reproduzierbare Next.js-/TypeScript-Foundation sowie der persistente Prisma/PostgreSQL-Domänenvertrag für Identity, Kandidaten, Firmen, Jobs, Bewerbungen, Talent Radar/Privacy, Billing und Operations.

Noch **nicht** implementiert sind Authentifizierungs- und Produkt-Use-Cases, Jobsuche, Kandidaten-, Arbeitgeber- und Adminportale, Katalog-/Demo-Fixtures, Billing-Abläufe sowie Mock- oder Real-Provider. Phase 02 liefert Persistenz und Datenintegrität, aber noch keine Nutzerfunktion. Die Startseite weist diesen Umfang ausdrücklich aus; es gibt keine Fake-Logins, Fake-Jobs oder funktionslosen Produkt-CTAs.

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
npm run db:migrate:status
npm run db:seed
npm run db:smoke
npm run dev
```

Danach ist die technische App-Shell unter [http://127.0.0.1:3000](http://127.0.0.1:3000) erreichbar.

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
npm run db:migrate:status
npm run db:seed
npm run db:smoke
```

- `db:generate` erzeugt den ignorierten Prisma Client neu.
- `db:validate` prüft Schema und Konfiguration ohne Datenbankmutation.
- `db:migrate` verwendet `prisma migrate deploy` gegen die explizite `DATABASE_URL`.
- `db:migrate:status` bestätigt, dass alle committed Migrationen angewandt sind.
- Auf die leere Phase-01-Baseline folgt die Phase-02-Domänenmigration. Sie enthält zusätzlich zu Prisma-SQL benannte Checks, Composite-FKs, Partial-/Exclusion-Indizes sowie Lifecycle-, Append-only- und Concurrency-Trigger.
- `db:seed` prüft die Erreichbarkeit repräsentativer Phase-02-Tabellen und schreibt keine Katalog-, Demo- oder Domainzeilen.
- `db:smoke` führt ebenfalls nur einen read-only `SELECT 1` aus; bei `APP_ENV=ci` verwendet es `TEST_DATABASE_URL`.

Die interaktiven Befehle `npm run db:migrate:dev` und `npm run db:studio` besitzen zusätzlich einen Fail-closed-Guard: Sie akzeptieren nur `APP_ENV=local`, einen Loopback-Host und keine production-/staging-bezeichnete Datenbank. `db:migrate` bleibt der nicht-interaktive Deploy-Pfad für eine ausdrücklich vollständig konfigurierte Zielumgebung.

Vollständige positive und negative fachliche Fixtures gehören in Phase 05. Es gibt keinen automatischen Reset und keinen Production-Seed. Die Gruppierung der Modelle und der Umgang mit dem strengeren SQL-Vertrag sind in [`prisma/README.md`](./prisma/README.md) dokumentiert.

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
`typecheck` erzeugt davor mit `next typegen` die von Next verwaltete und bewusst
ignorierte `next-env.d.ts`; dadurch hinterlassen `dev` und `build` keinen
versionsabhängigen Diff im Repository.

Zusätzliche Konfigurationschecks:

```powershell
npm run env:validate
npm run db:generate
npm run db:validate
docker compose config --quiet
```

Die Linux-CI führt Clean Install, Env-Validierung, Prisma Generate/Validate, Lint, Typecheck, Unit-Tests, alle committed Migrationen samt Statusprüfung, technischen Phase-02-Seed, DB-Smoke, PostgreSQL-Integrationstests, Production Build und einen HTTP-Smoke aus. Ein separater `windows-latest`-Job wiederholt ohne Docker mindestens Install, Env-, Prisma-, Lint-, Typecheck-, Unit- und Build-Prüfung und belegt damit die npm-cmd-Portabilität.

## Health-Routen

- `GET /health/live` liefert `200 {"status":"ok"}`, prüft nur die Prozess-Liveness und ist `no-store`.
- `GET /health/ready` führt einen auf drei Sekunden begrenzten PostgreSQL-Check aus; Pool-Verbindungs- und Query-Timeouts verhindern unbegrenztes Warten. Bei erreichbarer DB liefert die Route `200 {"status":"ready"}`, sonst `503 {"status":"unavailable"}`. Sie gibt weder URL noch Credentials oder Tabelleninhalte aus und ist ebenfalls `no-store`.

Health-Routen sind Betriebschecks, keine Produktfeatures und keine Autorisierungsgrenze.

## Sicherheits- und Scope-Hinweise

- Keine echten Secrets, Provider-Keys, persönlichen Daten oder Produktionsdaten in Repository, Fixtures oder CI.
- Keine automatische oder unbeabsichtigte Verbindung zu einer unbekannten oder Production-Datenbank; Tests verwenden immer die isolierte Testdatenbank. Der Deploy-Migrationspfad benötigt eine ausdrücklich konfigurierte Zielumgebung.
- Keine Real-Provider werden durch Env-Keys automatisch aktiviert; deren Variablen müssen leer bleiben.
- Der Foundation-Logger redigiert sensitive Werte; Stacktraces und Konfiguration gehören nicht in Nutzerantworten.
- Basisheader sind vorbereitet. Vollständige CSP/HSTS-, Auth-, Rate-Limit- und Autorisierungshärtung folgen in ihren besitzenden Phasen.
- Das technische Fundament und Schema sind weder ein demo-fertiges Produkt noch produktionsbereit oder vollständig DSG-konform.

## Plan und Evidence

1. [`AGENTS.md`](./AGENTS.md) — Implementierungs- und Evidence-Regeln.
2. [`codex-plan/00-PLAN.md`](./codex-plan/00-PLAN.md) — Masterplan und Status.
3. [`codex-plan/01-setup-foundation.md`](./codex-plan/01-setup-foundation.md) — verbindlicher Phase-01-Vertrag.
4. [`codex-plan/02-prisma-schema.md`](./codex-plan/02-prisma-schema.md) — verbindlicher Phase-02-Schema- und Migrationsvertrag.
5. [`codex-plan/decisions.md`](./codex-plan/decisions.md) — Architekturentscheidungen.
6. [`codex-plan/requirements-matrix.md`](./codex-plan/requirements-matrix.md) — Traceability.
7. [`codex-plan/implementation-plan.md`](./codex-plan/implementation-plan.md) — Ausführungsschritte 01–18.
8. [`codex-plan/evidence/2026-07-19-phase-01.md`](./codex-plan/evidence/2026-07-19-phase-01.md) — reproduzierbarer Phase-01-Abnahmenachweis.

Ein Checkbox-Häkchen bedeutet „im Zielrepository implementiert und verifiziert“. Evidence nennt mindestens Datum, Zielcommit, Umgebung, OS, Node/npm-Version, Befehl beziehungsweise manuellen Check, Exit-Code/Ergebnis und bekannte Limitation. Zuerst wird die Detailphase aktualisiert, danach gegebenenfalls der Masterplan.
